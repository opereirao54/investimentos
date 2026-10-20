'use strict';

// Cotações da B3 → Firestore (marketQuotes), fora da Vercel.
//
// POR QUE ISTO EXISTE
// O Yahoo limita pedidos pelo IP de saída, e o da Vercel é partilhado com
// milhares de sites: medido, 429 em sete tentativas seguidas. Com o Yahoo
// como fonte grátis, a cotação ao vivo do servidor falhava e o app mostrava
// preço de semanas atrás ("WEGE3 a R$ 51,27 com o fechamento a R$ 47,67").
// O job de ingestão da CVM já roda no GitHub Actions pelo mesmo motivo.
//
// COMO FUNCIONA
// A cada 15 minutos no pregão (e uma vez depois do fechamento), cota todo
// ticker que alguém pediu nos últimos 30 dias — o op=quote marca
// `ultimoPedidoMs` — e grava no mesmo documento que o op=quote lê. A busca é
// a mesma do servidor (fetchCotacoesMercado): BRAPI se houver token, a
// planilha Google (GOOGLEFINANCE), Yahoo em lote, Yahoo um a um, Google Finance.
// O op=quote aceita o que o job gravou há até 75 min sem marcar "atrasado".
//
// USO
//   node scripts/cotacoes-job.js --dry-run [--tickers=WEGE3,ITUB4]
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/cotacoes-job.js --gravar

const path = require('node:path');

const DIAS = 30;
const ORCAMENTO_MS = 120000;

function arg(args, nome) {
  const a = args.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=')[1] : null;
}

/** Os tickers do job: pedidos (ou cotados) nos últimos 30 dias. */
async function tickersDoJob(database, agora) {
  const desde = agora - DIAS * 24 * 3600 * 1000;
  const col = database.collection('marketQuotes');
  // Documentos gravados antes do job só têm dateYmd ('2026-10-03'): sem esta
  // terceira consulta, a primeira rodada achou "0 tickers para cotar".
  const desdeYmd = new Date(desde - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const [pedidos, cotados, antigos] = await Promise.all([
    col.where('ultimoPedidoMs', '>', desde).get(),
    col.where('fetchedAtMs', '>', desde).get(),
    col.where('dateYmd', '>=', desdeYmd).get(),
  ]);
  const s = new Set();
  pedidos.forEach((d) => s.add(d.id));
  cotados.forEach((d) => s.add(d.id));
  antigos.forEach((d) => s.add(d.id));
  return Array.from(s).sort();
}

function resumo(fetched, tickers, erros) {
  const porFonte = {};
  const sem = [];
  for (const t of tickers) {
    const q = fetched[t];
    if (q && typeof q.price === 'number') {
      const f = q.fonteCotacao || 'brapi';
      porFonte[f] = (porFonte[f] || 0) + 1;
    } else sem.push(t);
  }
  const motivos = {};
  for (const e of erros) {
    const chave = `${e.fonte}: ${e.erro}`;
    motivos[chave] = (motivos[chave] || 0) + 1;
  }
  return { cotados: tickers.length - sem.length, porFonte, sem, motivos };
}

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes('--gravar');
  const market = require(path.join(__dirname, '..', 'api', 'market.js'));
  const agora = Date.now();

  let tickers = (arg(args, 'tickers') || '')
    .split(',')
    .map((t) => market.fontes.sanitizeTicker(t))
    .filter(Boolean);
  let database = null;
  if (gravar || !tickers.length) {
    const { db } = require(path.join(__dirname, '..', 'api', '_lib', 'firebase-admin.js'));
    database = db();
  }
  if (!tickers.length) tickers = await tickersDoJob(database, agora);
  tickers = tickers.map((t) => market.fontes.sanitizeTicker(t)).filter(Boolean);
  console.log(`· ${tickers.length} tickers para cotar`);
  if (!tickers.length) return;

  // Planilha: códigos novos entram antes e o Google tem alguns segundos para
  // calcular — assim a rodada já os traz, em vez de só a próxima.
  if (market.planilha.planilhaId()) {
    try {
      const { lerServiceAccount } = require(
        path.join(__dirname, '..', 'api', '_lib', 'firebase-admin.js')
      );
      console.log(
        `· planilha ${market.planilha.planilhaId()} · conta ${lerServiceAccount().client_email}`
      );
      const { presentes } = await market.planilha.lerPlanilha(fetch, 15000);
      const novos = tickers.filter((t) => !presentes.has(t));
      if (novos.length) {
        await market.planilha.acrescentarNaPlanilha(novos, fetch, 15000);
        console.log(`· ${novos.length} códigos novos na planilha; aguardando o GOOGLEFINANCE`);
        await new Promise((r) => setTimeout(r, 12000));
      }
    } catch (e) {
      console.log(`· planilha indisponível: ${e.message}`);
    }
  }

  const erros = [];
  const fetched = await market.fontes.fetchCotacoesMercado(tickers, erros, ORCAMENTO_MS);
  const r = resumo(fetched, tickers, erros);
  console.log(`· cotados: ${r.cotados}/${tickers.length}`, JSON.stringify(r.porFonte));
  if (r.sem.length) console.log(`· sem preço: ${r.sem.slice(0, 40).join(', ')}`);
  if (Object.keys(r.motivos).length) console.log('· motivos:', JSON.stringify(r.motivos));

  if (gravar && r.cotados) {
    const { timestamp } = require(path.join(__dirname, '..', 'api', '_lib', 'firebase-admin.js'));
    const hoje = market.fontes.todayYmdBRT(agora);
    const prontos = tickers.filter((t) => fetched[t] && typeof fetched[t].price === 'number');
    for (let i = 0; i < prontos.length; i += 400) {
      const batch = database.batch();
      for (const t of prontos.slice(i, i + 400)) {
        const f = fetched[t];
        batch.set(
          database.collection('marketQuotes').doc(t),
          {
            ...f,
            dateYmd: hoje,
            fetchedAtMs: Date.now(),
            updatedAt: timestamp().now(),
            source: f.fonteCotacao || 'brapi',
            origem: 'job',
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
    console.log(`· gravados: ${prontos.length}`);
  }
  // Nenhum preço de nada é falha de verdade: o job fica vermelho para ser visto.
  if (!r.cotados) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('✗', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  });
}

module.exports = { tickersDoJob, resumo };
