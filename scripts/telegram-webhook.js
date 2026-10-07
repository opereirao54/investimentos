#!/usr/bin/env node
'use strict';

// Liga (ou confere, ou desliga) o webhook do bot de lançamentos no Telegram.
// Roda uma vez depois do deploy — e de novo só se o domínio ou o segredo mudar.
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
//     node scripts/telegram-webhook.js https://SEU-DOMINIO
//   node scripts/telegram-webhook.js --info      # mostra o estado atual
//   node scripts/telegram-webhook.js --remover   # desliga o webhook
//
// O que faz ao ligar:
//   1. setWebhook → https://SEU-DOMINIO/api/telegram, com o secret_token que o
//      servidor confere em cada entrega (api/_lib/telegram-bot.js → segredoConfere)
//      e só os tipos de update que o bot usa;
//   2. setMyCommands → o menu "/" do bot;
//   3. getWebhookInfo → imprime o resultado, para conferir na hora.
//
// Doc da API: https://core.telegram.org/bots/api#setwebhook

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SEGREDO = process.env.TELEGRAM_WEBHOOK_SECRET;

async function chamar(metodo, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${metodo}: ${j.description || r.status}`);
  return j.result;
}

async function info() {
  const i = await chamar('getWebhookInfo');
  console.log('URL:              ', i.url || '(nenhuma — webhook desligado)');
  console.log('Pendentes:        ', i.pending_update_count);
  console.log('Tipos de update:  ', (i.allowed_updates || []).join(', ') || '(todos)');
  if (i.last_error_date) {
    console.log(
      'Último erro:      ',
      new Date(i.last_error_date * 1000).toLocaleString('pt-BR'),
      '—',
      i.last_error_message
    );
  } else {
    console.log('Último erro:       nenhum');
  }
}

async function main() {
  if (!TOKEN) {
    console.error('Defina TELEGRAM_BOT_TOKEN (o token que o @BotFather entregou).');
    process.exit(1);
  }
  const arg = process.argv[2] || '';

  if (arg === '--info') return info();
  if (arg === '--remover') {
    await chamar('deleteWebhook', { drop_pending_updates: false });
    console.log('Webhook desligado.');
    return info();
  }

  if (!/^https:\/\/[^/]+/.test(arg)) {
    console.error(
      'Uso: node scripts/telegram-webhook.js https://SEU-DOMINIO  (ou --info / --remover)'
    );
    process.exit(1);
  }
  if (!SEGREDO || !/^[A-Za-z0-9_-]{16,256}$/.test(SEGREDO)) {
    console.error(
      'Defina TELEGRAM_WEBHOOK_SECRET com 16 a 256 caracteres (letras, números, _ ou -).\n' +
        "Gere um com:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
    process.exit(1);
  }

  const url = arg.replace(/\/+$/, '') + '/api/telegram';
  await chamar('setWebhook', {
    url,
    secret_token: SEGREDO,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 10,
  });
  console.log('Webhook ligado em', url);

  await chamar('setMyCommands', {
    commands: [
      { command: 'ajuda', description: 'Como lançar despesas e receitas' },
      { command: 'desfazer', description: 'Desfaz o último lançamento' },
      { command: 'desconectar', description: 'Desliga este Telegram da sua conta' },
    ],
  });
  console.log('Menu de comandos configurado.');

  const eu = await chamar('getMe');
  console.log(`Bot: @${eu.username}  (use este nome em TELEGRAM_BOT_USERNAME)`);
  await info();
}

main().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
