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

module.exports = { chamar, enviar, editar, responderBotao };
