'use strict';

// Ingestão dos dados abertos da CVM -> Firestore (marketFundamentals).
//
// POR QUE ISTO EXISTE
// Com o plano grátis da fonte de mercado, 13 dos 16 indicadores de ação
// chegam nulos e nenhum ativo é pontuado. Pagar resolve, mas amarra o
// produto ao plano comercial de um terceiro. A CVM publica de graça, sem
// chave e sem cota, o documento que a companhia é LEGALMENTE OBRIGADA a
// entregar — e é auditável pelo cliente, que é o que sustenta a confiança
// num produto pago.
//
// POR QUE É UM JOB E NÃO UM ENDPOINT
// As functions do Vercel neste projeto têm maxDuration 15s e 256 MB
// (vercel.json), e os arquivos da CVM são ZIPs de dezenas de MB. Além
// disso, os 2 crons do plano Hobby já estão ocupados. Então isto roda no
// GitHub Actions e escreve na MESMA coleção que api/market.js?op=fundamentals
// já lê — o cliente não muda em nada, só passa a receber dado melhor.
//
// GARANTIA CENTRAL: nunca escrever número que não se sustenta. Coluna que
// não aparece, conta que não existe e resultado fora da faixa plausível
// viram null com motivo registado. Uma empresa cujos indicadores não
// validam é PULADA e reportada, nunca gravada pela metade.
//
// USO
//   node scripts/ingest-cvm.js --dry-run            # não escreve; imprime o que achou
//   node scripts/ingest-cvm.js --dry-run --anos=1   # mais rápido, para conferir layout
//   FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/ingest-cvm.js --gravar
//
// O --dry-run é o passo de validação: como os nomes de coluna e códigos de
// conta da CVM já mudaram de forma antes, a primeira execução deve ser
// conferida por um humano — ele imprime qual ticker casou com qual empresa
// e quais colunas não foram encontradas.

const path = require('node:path');
const { lerZip } = require('./lib/zip');
const P = require('./lib/cvm-parser');
const MAPA = require('./lib/mapa-cvm.json');

const BASE_CIA = 'https://dados.cvm.gov.br/dados/CIA_ABERTA';
const BASE_FII = 'https://dados.cvm.gov.br/dados/FII';
const COLECAO = 'marketFundamentals';
const TIMEOUT_MS = 120000;

function log(...a) {
  console.log(...a);
}

function argValor(args, nome, padrao) {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=')[1] : padrao;
}

async function baixar(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: '*/*' } });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Baixa um CSV solto da CVM (latin-1). */
async function baixarCsv(url) {
  const buf = await baixar(url);
  return P.parseCsvCvm(buf.toString('latin1'));
}

/**
 * Baixa um ZIP e devolve os CSVs que interessam, por sufixo do nome.
 * Ex.: prefixos ['BPA_con', 'BPP_con'] -> { BPA_con: {...}, BPP_con: {...} }
 */
async function baixarZipCsvs(url, prefixos) {
  const buf = await baixar(url);
  const entradas = lerZip(buf);
  const out = {};
  const nomes = entradas.map((e) => e.nome);
  for (const prefixo of prefixos) {
    const alvo = entradas.find((e) =>
      P.normalizarChave(e.nome).includes(P.normalizarChave(prefixo))
    );
    if (alvo) out[prefixo] = P.parseCsvCvm(alvo.dados.toString('latin1'));
  }
  return { csvs: out, nomesNoZip: nomes };
}

/**
 * Casa cada ticker do mapa com uma linha do cadastro da CVM.
 *
 * Por nome e não por código: código decorado num arquivo envelhece e
 * ninguém confere. Ambiguidade (mais de uma empresa contendo o termo) é
 * REPORTADA e o ticker é pulado — casar com a empresa errada é o pior
 * resultado possível, pior do que não casar.
 */
function casarCadastro(cadastro, mapaTickers, colunaNome, colunaChave) {
  const resultados = [];
  const registros = cadastro.registros || [];
  for (const [ticker, info] of Object.entries(mapaTickers)) {
    const alvo = P.normalizarChave(info.denominacao);
    const candidatos = registros.filter((r) =>
      P.normalizarChave(r[colunaNome] || '').includes(alvo)
    );
    if (!candidatos.length) {
      resultados.push({ ticker, status: 'sem_correspondencia', denominacao: info.denominacao });
      continue;
    }
    // Preferência por correspondência exata; senão, o nome mais curto (o
    // mais curto que contém o termo costuma ser a holding, não a subsidiária
    // com sufixo).
    const exato = candidatos.find((r) => P.normalizarChave(r[colunaNome]) === alvo);
    const escolhido =
      exato ||
      candidatos
        .slice()
        .sort((a, b) => String(a[colunaNome]).length - String(b[colunaNome]).length)[0];
    resultados.push({
      ticker,
      status: candidatos.length > 1 && !exato ? 'ambiguo' : 'ok',
      denominacao: info.denominacao,
      casouCom: escolhido[colunaNome],
      chave: String(escolhido[colunaChave] || '').trim(),
      alternativas: candidatos.length > 1 ? candidatos.slice(0, 5).map((r) => r[colunaNome]) : null,
    });
  }
  return resultados;
}

/** Um exercício de uma empresa, a partir dos quatro CSVs do ano. */
function exercicioDaEmpresa(csvs, cols, cdCvm, ano) {
  const pegar = (chave) => {
    const csv = csvs[chave];
    if (!csv) return [];
    const grupos = P.agruparPorEmpresa(csv.registros, cols);
    const daEmpresa = grupos.get(cdCvm);
    if (!daEmpresa) return [];
    // Exercício mais recente dentro do arquivo do ano.
    const chaves = Array.from(daEmpresa.keys()).sort();
    return daEmpresa.get(chaves[chaves.length - 1]) || [];
  };
  const blocos = {
    bpa: pegar('BPA_con'),
    bpp: pegar('BPP_con'),
    dre: pegar('DRE_con'),
    dfc: pegar('DFC_MI_con'),
  };
  if (!blocos.bpp.length && !blocos.dre.length) return null;
  const fin = P.extrairFinanceiro(blocos, cols);
  return { ano, dataReferencia: `${ano}-12-31`, ...fin };
}

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes('--gravar') || args.includes('--send');
  const anosAtras = Math.max(1, Math.min(6, parseInt(argValor(args, 'anos', '5'), 10) || 5));
  const soTickers = argValor(args, 'only', '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  log(`\n=== Ingestão CVM — ${gravar ? 'GRAVANDO' : 'DRY-RUN (não escreve)'} ===`);
  log(
    `Anos: ${anosAtras} · Tickers: ${soTickers.length ? soTickers.join(',') : 'todos do mapa'}\n`
  );

  const anoBase = new Date().getUTCFullYear() - 1; // DFP do ano corrente só sai depois do fechamento
  const anos = [];
  for (let i = 0; i < anosAtras; i++) anos.push(anoBase - i);

  // ── 1. Cadastro de companhias ──
  log('· Cadastro de companhias abertas…');
  const cadastro = await baixarCsv(`${BASE_CIA}/CAD/DADOS/cad_cia_aberta.csv`);
  const colNome = P.acharColuna(cadastro.colunas, P.COLUNAS.denominacao);
  const colCd = P.acharColuna(cadastro.colunas, P.COLUNAS.cdCvm);
  if (!colNome || !colCd) {
    log(`  ✗ cadastro sem colunas esperadas. Colunas reais: ${cadastro.colunas.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const mapaAcoes = soTickers.length
    ? Object.fromEntries(Object.entries(MAPA.acoes).filter(([t]) => soTickers.includes(t)))
    : MAPA.acoes;
  const casamentos = casarCadastro(cadastro, mapaAcoes, colNome, colCd);

  log('\n  Ticker  → empresa no cadastro da CVM (CONFIRA esta lista)');
  for (const c of casamentos) {
    const marca = c.status === 'ok' ? '  ' : c.status === 'ambiguo' ? ' ?' : ' ✗';
    log(
      `  ${marca} ${c.ticker.padEnd(8)} ${c.casouCom || '— ' + c.status} ${c.chave ? '(CD_CVM ' + c.chave + ')' : ''}`
    );
    if (c.alternativas) log(`       outras: ${c.alternativas.join(' | ')}`);
  }

  const utilizaveis = casamentos.filter((c) => c.status === 'ok' && c.chave);
  log(`\n  ${utilizaveis.length} de ${casamentos.length} tickers resolvidos.`);

  // ── 2. DFP por ano ──
  const porTicker = new Map();
  let colsResolvidas = null;
  for (const ano of anos) {
    log(`\n· DFP ${ano}…`);
    let pacote;
    try {
      pacote = await baixarZipCsvs(`${BASE_CIA}/DOC/DFP/DADOS/dfp_cia_aberta_${ano}.zip`, [
        'BPA_con',
        'BPP_con',
        'DRE_con',
        'DFC_MI_con',
      ]);
    } catch (e) {
      log(`  ✗ ${e.message} — ano ignorado`);
      continue;
    }
    const achados = Object.keys(pacote.csvs);
    log(
      `  arquivos usados: ${achados.join(', ') || 'nenhum'} (de ${pacote.nomesNoZip.length} no ZIP)`
    );
    if (!achados.length) {
      log(`  ✗ nenhum CSV reconhecido. Nomes no ZIP: ${pacote.nomesNoZip.slice(0, 8).join(', ')}`);
      continue;
    }

    const qualquer = pacote.csvs[achados[0]];
    const { mapa: cols, faltando } = P.resolverColunas(qualquer.colunas, [
      'cdCvm',
      'dataReferencia',
      'dataFimExercicio',
      'ordemExercicio',
      'codigoConta',
      'descricaoConta',
      'valorConta',
      'escalaMoeda',
    ]);
    if (faltando.length) {
      log(`  ! colunas não encontradas: ${faltando.join(', ')}`);
      log(`    colunas reais do arquivo: ${qualquer.colunas.join(', ')}`);
    }
    if (!cols.cdCvm || !cols.codigoConta || !cols.valorConta) {
      log('  ✗ colunas essenciais ausentes — ano ignorado (nada será gravado a partir dele)');
      continue;
    }
    colsResolvidas = cols;

    for (const c of utilizaveis) {
      const ex = exercicioDaEmpresa(pacote.csvs, cols, c.chave, ano);
      if (!ex) continue;
      if (!porTicker.has(c.ticker)) porTicker.set(c.ticker, []);
      porTicker.get(c.ticker).push(ex);
    }
    log(
      `  ${utilizaveis.filter((c) => porTicker.has(c.ticker)).length} empresas com dados até aqui`
    );
  }

  if (!colsResolvidas) {
    log('\n✗ Nenhum ano utilizável. Nada gravado.');
    process.exitCode = 1;
    return;
  }

  // ── 3. Indicadores ──
  log('\n· Indicadores calculados:\n');
  const documentos = [];
  for (const [ticker, exercicios] of porTicker) {
    const r = P.calcularIndicadores(exercicios);
    const ind = r.indicadores;
    const preenchidos = Object.values(ind).filter((v) => v !== null).length;
    const total = Object.keys(ind).length;
    log(
      `  ${ticker.padEnd(8)} ${String(preenchidos).padStart(2)}/${total} indicadores · ` +
        `${r.exerciciosUsados} exercícios · ROE ${ind.roe === null ? '—' : ind.roe.toFixed(1) + '%'} · ` +
        `dívLíq/EBITDA ${ind.dividaLiquidaEbitda === null ? '—' : ind.dividaLiquidaEbitda.toFixed(2) + 'x'}`
    );
    if (r.descartados.length) {
      for (const d of r.descartados)
        log(`           descartado ${d.campo}=${d.valor} (${d.motivo})`);
    }
    // Empresa sem nenhum indicador não vai para a base: gravar um documento
    // vazio faria a API servir "dado da CVM" que não tem dado nenhum.
    if (!preenchidos) {
      log(`           ✗ nada aproveitável — não será gravado`);
      continue;
    }
    documentos.push({
      ticker,
      dados: {
        ...ind,
        ...r.absolutos,
        classe: 'acao',
        fonte: 'cvm',
        fonteRotulo: `DFP ${r.ano} · CVM`,
        dataReferencia: r.dataReferencia,
        exerciciosUsados: r.exerciciosUsados,
        indicadoresPreenchidos: preenchidos,
      },
    });
  }

  // ── 4. Informe mensal de FII ──
  const mapaFiis = soTickers.length
    ? Object.fromEntries(Object.entries(MAPA.fiis).filter(([t]) => soTickers.includes(t)))
    : MAPA.fiis;
  if (Object.keys(mapaFiis).length) {
    log('\n· Informe mensal de FII…');
    try {
      const cadFii = await baixarCsv(`${BASE_FII}/CAD/DADOS/cad_fii.csv`);
      const colNomeFii = P.acharColuna(cadFii.colunas, ['DENOM_SOCIAL', 'NM_FUNDO', 'DENOM_FUNDO']);
      const colCnpjFii = P.acharColuna(cadFii.colunas, ['CNPJ_FUNDO', 'CNPJ_Fundo', 'CNPJ']);
      if (!colNomeFii || !colCnpjFii) {
        log(`  ! cadastro de FII sem colunas esperadas: ${cadFii.colunas.slice(0, 10).join(', ')}`);
      } else {
        const casFii = casarCadastro(cadFii, mapaFiis, colNomeFii, colCnpjFii);
        for (const c of casFii) {
          const marca = c.status === 'ok' ? '  ' : c.status === 'ambiguo' ? ' ?' : ' ✗';
          log(`  ${marca} ${c.ticker.padEnd(8)} ${c.casouCom || '— ' + c.status}`);
        }
        const anoInf = new Date().getUTCFullYear();
        const pacote = await baixarZipCsvs(
          `${BASE_FII}/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${anoInf}.zip`,
          ['complemento', 'geral', 'ativo_passivo']
        );
        const compl = pacote.csvs.complemento || pacote.csvs.geral;
        if (!compl) {
          log(`  ! nenhum CSV de informe reconhecido. No ZIP: ${pacote.nomesNoZip.join(', ')}`);
        } else {
          const { porCnpj, faltando } = P.extrairInformeFii(compl.registros, compl.colunas);
          if (faltando.length) log(`  ! campos de FII não encontrados: ${faltando.join(', ')}`);
          for (const c of casFii) {
            if (c.status !== 'ok' || !c.chave) continue;
            const inf = porCnpj.get(String(c.chave).replace(/\D/g, ''));
            if (!inf) {
              log(`  ✗ ${c.ticker} sem informe no período`);
              continue;
            }
            const preenchidos = ['patrimonioLiquido', 'numeroCotistas', 'ocupacao'].filter(
              (k) => inf[k] !== null
            ).length;
            log(
              `    ${c.ticker.padEnd(8)} PL ${inf.patrimonioLiquido ?? '—'} · cotistas ${inf.numeroCotistas ?? '—'} · ocupação ${inf.ocupacao ?? '—'}`
            );
            if (!preenchidos) continue;
            documentos.push({
              ticker: c.ticker,
              dados: {
                patrimonioLiquido: inf.patrimonioLiquido,
                numeroCotistas: inf.numeroCotistas,
                numeroImoveis: inf.numeroImoveis,
                ocupacao: inf.ocupacao,
                classe: 'fii',
                fonte: 'cvm',
                fonteRotulo: `Informe Mensal · CVM`,
                dataReferencia: inf.dataReferencia,
              },
            });
          }
        }
      }
    } catch (e) {
      log(`  ✗ informe de FII falhou: ${e.message}`);
    }
  }

  // ── 5. Gravação ──
  log(`\n=== ${documentos.length} documentos prontos ===`);
  if (!gravar) {
    log('DRY-RUN: nada foi gravado. Confira os casamentos acima e rode com --gravar.\n');
    return;
  }
  if (!documentos.length) {
    log('Nada a gravar.\n');
    process.exitCode = 1;
    return;
  }

  const { db, timestamp } = require(path.join(__dirname, '..', 'api', '_lib', 'firebase-admin'));
  const database = db();
  const agora = Date.now();
  let gravados = 0;
  for (let i = 0; i < documentos.length; i += 400) {
    const lote = documentos.slice(i, i + 400);
    const batch = database.batch();
    for (const doc of lote) {
      // Ramo `cvm` separado do ramo `mercado`: a API compõe os dois na
      // leitura. Gravar plano faria a próxima resposta da fonte de cotação,
      // cheia de nulls, apagar tudo o que este job acabou de calcular.
      batch.set(
        database.collection(COLECAO).doc(doc.ticker),
        { cvm: doc.dados, cvmFetchedAtMs: agora, updatedAt: timestamp().now() },
        { merge: true }
      );
      gravados++;
    }
    await batch.commit();
  }
  log(`Gravados ${gravados} documentos em ${COLECAO}.\n`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n✗ Falhou:', e.message);
    process.exitCode = 1;
  });
}

module.exports = { casarCadastro, exercicioDaEmpresa };
