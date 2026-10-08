'use strict';

// Relatório Mensal em PDF pelo Telegram — o lado do bot.
//
// O PDF é o MESMO do app: quem o monta é o próprio código do app (numa
// sandbox) e quem o imprime é um Chromium. Isso não roda na Vercel (plano
// Hobby: sem navegador), então roda no GitHub Actions
// (.github/workflows/relatorio-telegram.yml → scripts/relatorio-telegram.js).
//
// Aqui só se registra o PEDIDO e se aciona o workflow:
//   telegramRelatorios/{id}  {uid, chatId, ym, status, criadoEmMs, expiraEm}
// O workflow recebe apenas o id (o repositório é público e os parâmetros de
// uma execução ficam visíveis); uid, chat e mês ele lê daqui, com o service
// account. Um id inventado não aponta para nada.

const crypto = require('crypto');
const { db, fieldValue, timestamp } = require('./firebase-admin');

const PEDIDO_TTL_MS = 24 * 60 * 60 * 1000;
const WORKFLOW = 'relatorio-telegram.yml';

function repo() {
  return process.env.GITHUB_REPO || 'opereirao54/investimentos';
}

function configurado() {
  return !!process.env.GITHUB_DISPATCH_TOKEN;
}

function novoId() {
  return 'r' + crypto.randomBytes(12).toString('hex');
}

/**
 * Aciona o workflow. Devolve {ok} ou {ok:false, motivo}.
 * 204 é o sucesso da API (https://docs.github.com/rest/actions/workflows).
 */
async function dispararWorkflow(pedidoId) {
  const url = `https://api.github.com/repos/${repo()}/actions/workflows/${WORKFLOW}/dispatches`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'appliquei-bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: process.env.GITHUB_REF_RELATORIO || 'main',
        inputs: { pedido: pedidoId },
      }),
    });
    if (r.status === 204) return { ok: true };
    // O corpo da API do GitHub não tem segredo; o status basta para o log.
    console.error('[telegram-relatorio] dispatch', r.status);
    return {
      ok: false,
      motivo: r.status === 401 || r.status === 403 || r.status === 404 ? 'token' : 'github',
    };
  } catch (e) {
    console.error('[telegram-relatorio] dispatch falhou', e && e.message);
    return { ok: false, motivo: 'rede' };
  }
}

/**
 * Registra o pedido e aciona o workflow.
 * @returns {Promise<{ok: boolean, motivo?: string, id?: string}>}
 */
async function pedirRelatorio(uid, chatId, ym) {
  if (!configurado()) return { ok: false, motivo: 'nao_configurado' };
  const id = novoId();
  const ref = db().collection('telegramRelatorios').doc(id);
  await ref.set({
    uid,
    chatId,
    ym,
    status: 'pendente',
    criadoEmMs: Date.now(),
    criadoEm: fieldValue().serverTimestamp(),
    expiraEm: timestamp().fromMillis(Date.now() + PEDIDO_TTL_MS),
  });
  const r = await dispararWorkflow(id);
  if (!r.ok) {
    await ref.set({ status: 'erro_disparo' }, { merge: true });
    return { ok: false, motivo: r.motivo };
  }
  return { ok: true, id };
}

module.exports = { pedirRelatorio, configurado, WORKFLOW };
