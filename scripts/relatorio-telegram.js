#!/usr/bin/env node
'use strict';

// Gera o Relatório Mensal em PDF de um pedido feito pelo Telegram e o envia
// ao usuário. Roda no GitHub Actions (.github/workflows/relatorio-telegram.yml),
// acionado pelo bot (api/_lib/telegram-relatorio.js).
//
//   PEDIDO=r0123… node scripts/relatorio-telegram.js
//
// Env: FIREBASE_SERVICE_ACCOUNT_BASE64 (+ FIREBASE_PROJECT_ID), TELEGRAM_BOT_TOKEN,
//      CHROMIUM_PATH (opcional), TZ=America/Sao_Paulo (as datas do relatório).
//
// O REPOSITÓRIO É PÚBLICO E O LOG DESTE SCRIPT TAMBÉM. Nada do usuário vai
// para a saída: nem uid, nem chat, nem valores, nem mensagem de exceção (que
// poderia carregar um trecho de dado). Só o id do pedido, o desfecho e um
// código de erro.

const { db } = require('../api/_lib/firebase-admin');
const tg = require('../api/_lib/telegram-api');
const G = require('./lib/relatorio-pdf');

const RE_PEDIDO = /^r[0-9a-f]{24}$/;
// Pedido velho não é gerado: a pessoa já desistiu, e um workflow atrasado
// mandando o PDF horas depois seria estranho.
const VALIDADE_MS = 30 * 60 * 1000;

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function rotuloMes(ym) {
  const [a, m] = String(ym).split('-').map(Number);
  return `${MESES[m - 1]}/${a}`;
}

// Código de erro para o log: só nomes conhecidos, nunca a mensagem crua.
function codigoErro(e) {
  const msg = e && typeof e.message === 'string' ? e.message : '';
  if (/^[a-z_]{3,40}$/.test(msg)) return msg;
  return (e && e.name) || 'Error';
}

/**
 * @param {string} id
 * @param {object} [deps]  para teste: {imprimirPdf, fetch}
 * @returns {Promise<{status: string, bytes?: number, erro?: string}>}
 */
async function processarPedido(id, deps) {
  deps = deps || {};
  const imprimir = deps.imprimirPdf || G.imprimirPdf;
  const fetchDividendos = 'fetch' in deps ? deps.fetch : fetch;

  if (!RE_PEDIDO.test(String(id || ''))) return { status: 'id_invalido' };
  const ref = db().collection('telegramRelatorios').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { status: 'nao_encontrado' };
  const p = snap.data() || {};
  if (p.status !== 'pendente') return { status: 'ja_tratado' };
  if (!(Date.now() - (p.criadoEmMs || 0) < VALIDADE_MS)) {
    await ref.set({ status: 'expirado' }, { merge: true });
    return { status: 'expirado' };
  }
  if (!p.uid || !p.chatId || !G.RE_YM.test(String(p.ym || ''))) {
    await ref.set({ status: 'invalido' }, { merge: true });
    return { status: 'invalido' };
  }
  await ref.set({ status: 'gerando' }, { merge: true });

  try {
    const usuario = db().collection('users').doc(p.uid);
    const [dataSnap, inboxSnap] = await Promise.all([
      usuario.collection('data').doc('main').get(),
      usuario.collection('telegramInbox').orderBy('criadoEmMs', 'asc').limit(100).get(),
    ]);
    const chaves = (dataSnap.exists && (dataSnap.data() || {}).keys) || {};
    const inbox = inboxSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

    const doc = await G.documentoDoRelatorio({
      chaves,
      ym: p.ym,
      inbox,
      fetch: fetchDividendos,
    });
    const pdf = await imprimir(doc.html, { executablePath: process.env.CHROMIUM_PATH });

    let legenda = `📄 <b>Relatório Mensal — ${rotuloMes(p.ym)}</b>`;
    if (doc.aplicados > 0) {
      legenda += '\n<i>Já inclui o que você lançou aqui e o app ainda não tinha aplicado.</i>';
    }
    const r = await tg.enviarDocumento(p.chatId, pdf, `relatorio-mensal-${p.ym}.pdf`, legenda);
    if (!r || !r.ok) throw new Error('envio_telegram');
    await ref.set({ status: 'enviado', enviadoEmMs: Date.now() }, { merge: true });
    return { status: 'enviado', bytes: pdf.length };
  } catch (e) {
    await ref.set({ status: 'erro' }, { merge: true });
    await tg.enviar(
      p.chatId,
      '😕 Não consegui gerar o relatório agora. Tente de novo em alguns minutos. ' +
        'Se continuar, ele também sai pelo app: <b>Relatório mensal → Exportar PDF</b>.'
    );
    return { status: 'erro', erro: codigoErro(e) };
  }
}

async function main() {
  const id = process.env.PEDIDO || process.argv[2] || '';
  const r = await processarPedido(id);
  const extra = r.bytes ? ` (${Math.round(r.bytes / 1024)} KB)` : r.erro ? ` [${r.erro}]` : '';
  console.log(`pedido ${RE_PEDIDO.test(id) ? id : '(inválido)'}: ${r.status}${extra}`);
  process.exit(r.status === 'erro' ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`falhou: ${codigoErro(e)}`);
    process.exit(1);
  });
}

module.exports = { processarPedido, rotuloMes };
