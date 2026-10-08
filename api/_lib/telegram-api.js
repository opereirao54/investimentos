'use strict';

// Cliente mínimo da Bot API do Telegram (https://core.telegram.org/bots/api).
// Só o que o bot de lançamentos usa. Sem dependência: `fetch` nativo do Node 20.
//
// Falha de envio NÃO derruba o webhook: o lançamento já foi gravado quando a
// resposta sai, e devolver erro ao Telegram faria ele reentregar a mensagem.
// Por isso `chamar` resolve sempre — com {ok:false} quando deu errado — e loga.

const BASE = 'https://api.telegram.org';

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

async function chamar(metodo, payload) {
  const tk = token();
  if (!tk) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN ausente; não enviei', metodo);
    return { ok: false, description: 'sem_token' };
  }
  try {
    const r = await fetch(`${BASE}/bot${tk}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error('[telegram]', metodo, r.status, j.description);
    return j;
  } catch (e) {
    console.error('[telegram]', metodo, 'falhou', e && e.message);
    return { ok: false, description: 'rede' };
  }
}

// `teclado`: lista de linhas de botões = teclado inline (preso à mensagem);
// objeto = reply_markup pronto (ex.: o teclado fixo do menu, embaixo do chat).
function enviar(chatId, texto, teclado) {
  let markup;
  if (Array.isArray(teclado)) markup = { inline_keyboard: teclado };
  else if (teclado) markup = teclado;
  return chamar('sendMessage', {
    chat_id: chatId,
    text: texto,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: markup,
  });
}

function editar(chatId, messageId, texto, teclado) {
  return chamar('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: texto,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: teclado || [] },
  });
}

function responderBotao(callbackId, texto) {
  return chamar('answerCallbackQuery', { callback_query_id: callbackId, text: texto || undefined });
}

/**
 * Manda um arquivo (sendDocument), em multipart. Mesma política de `chamar`:
 * nunca lança, devolve {ok:false} e loga só o método e o status.
 *
 * @param {number|string} chatId
 * @param {Buffer} conteudo
 * @param {string} nome     nome do arquivo que o usuário vê (ex.: relatorio-mensal-2026-10.pdf)
 * @param {string} [legenda] HTML
 * @param {string} [tipo]   media type (default application/pdf)
 */
async function enviarDocumento(chatId, conteudo, nome, legenda, tipo) {
  const tk = token();
  if (!tk) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN ausente; não enviei sendDocument');
    return { ok: false, description: 'sem_token' };
  }
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([conteudo], { type: tipo || 'application/pdf' }), nome);
    if (legenda) {
      form.append('caption', legenda);
      form.append('parse_mode', 'HTML');
    }
    const r = await fetch(`${BASE}/bot${tk}/sendDocument`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error('[telegram] sendDocument', r.status, j.description);
    return j;
  } catch (e) {
    console.error('[telegram] sendDocument falhou', e && e.message);
    return { ok: false, description: 'rede' };
  }
}

// O menu "☰ Menu" do bot (setMyCommands). Fonte única: o bot o aplica sozinho
// quando a lista muda (telegram-bot.js → garantirMenu) e o script do webhook
// também. Mudou aqui, o menu de todo mundo muda no próximo uso do bot.
const MENU_COMANDOS = [
  { command: 'saldo', description: '💰 Saldo de cada conta' },
  { command: 'fatura', description: '💳 Fatura aberta de cada cartão' },
  { command: 'mes', description: '📊 Resumo do mês por categoria' },
  { command: 'relatorio', description: '📄 Relatório Mensal em PDF' },
  { command: 'alertas', description: '🔔 Escolher os avisos automáticos' },
  { command: 'ajuda', description: '❓ Como lançar despesas e receitas' },
  { command: 'desfazer', description: '↩️ Desfaz o último lançamento' },
  { command: 'desconectar', description: 'Desliga este Telegram da sua conta' },
];

module.exports = { chamar, enviar, editar, responderBotao, enviarDocumento, MENU_COMANDOS };
