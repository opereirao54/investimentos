'use strict';

// Alertas automáticos do bot do Telegram.
//
//   1. as regras (telegram-alertas.js) sobre um mundo com data fixa;
//   2. a rodada (telegram-alertas-envio.js) contra o Firestore de mentira:
//      janela, uma mensagem por janela, nada repetido, preferências, pausa,
//      bot bloqueado, assinatura, paginação;
//   3. o painel 🔔 e os botões 🔕 pelo webhook;
//   4. o endpoint do agendador (CRON_SECRET).

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'scripts/lib/mock-billing'));

let user;
let A;
let E;
const enviados = [];
let respostaTelegram = () => ({ ok: true, result: {} });

const UID = 'u1';
const CHAT = 5550001;
// 08/10/2026 08:30 em Brasília (janela da manhã) e 20:30 (janela da noite).
const MANHA = new Date('2026-10-08T11:30:00Z');
const NOITE = new Date('2026-10-08T23:30:00Z');
const FORA = new Date('2026-10-08T17:00:00Z'); // 14h em Brasília
let updateSeq = 5000;

function tx(o) {
  return Object.assign({ mes: 9, ano: 2026, pago: false }, o);
}

function mundo() {
  return {
    appliquei_contas: JSON.stringify([
      { id: 'c_itau', nome: 'Itaú', tipo: 'banco', principal: true, saldoInicial: 3000 },
    ]),
    futurorico_cartoes: JSON.stringify([
      { id: 'card_nu', nome: 'Nubank', diaFechamento: 10, diaVencimento: 17 },
      { id: 'card_c6', nome: 'C6', diaFechamento: 1, diaVencimento: 9 },
      { id: 'card_velho', nome: 'Velho', diaFechamento: 1, diaVencimento: 9, arquivado: true },
    ]),
    futurorico_transacoes: JSON.stringify([
      tx({ id: 'rec', categoria: 'receita', valor: 5000, contaId: 'c_itau', pago: true }),
      tx({
        id: 'alug',
        categoria: 'despesa_fixa',
        descricao: 'Aluguel',
        valor: 1800,
        dataVencimento: '2026-10-09',
        categoriaDespesa: 'moradia',
      }),
      tx({
        id: 'luz',
        categoria: 'despesa_fixa',
        descricao: 'Luz',
        valor: 200,
        dataVencimento: '2026-10-08',
        categoriaDespesa: 'moradia',
      }),
      tx({
        id: 'net',
        categoria: 'despesa_fixa',
        descricao: 'Internet',
        valor: 100,
        dataVencimento: '2026-10-06',
      }),
      tx({
        id: 'velha',
        categoria: 'despesa_fixa',
        descricao: 'Velha',
        valor: 10,
        dataVencimento: '2026-09-01',
        mes: 8,
      }),
      tx({
        id: 'paga',
        categoria: 'despesa_fixa',
        descricao: 'Paga',
        valor: 10,
        dataVencimento: '2026-10-08',
        pago: true,
      }),
      tx({ id: 'rfut', categoria: 'receita', valor: 1, dataVencimento: '2026-10-08' }),
      tx({
        id: 'nu1',
        categoria: 'cartao_credito',
        cartaoId: 'card_nu',
        descricao: 'Mercado',
        valor: 300,
        dataVencimento: '2026-10-17',
        categoriaDespesa: 'alimentacao',
      }),
      tx({
        id: 'c61',
        categoria: 'cartao_credito',
        cartaoId: 'card_c6',
        descricao: 'Tênis',
        valor: 450,
        dataVencimento: '2026-10-09',
      }),
      tx({
        id: 'vel1',
        categoria: 'cartao_credito',
        cartaoId: 'card_velho',
        valor: 99,
        dataVencimento: '2026-10-09',
      }),
    ]),
  };
}

function dadosPuros() {
  const k = mundo();
  return {
    transacoes: JSON.parse(k.futurorico_transacoes),
    contas: JSON.parse(k.appliquei_contas),
    cartoes: JSON.parse(k.futurorico_cartoes),
    rotulos: E.rotulosCategorias([]),
  };
}

function carregar() {
  M.setup({ root: ROOT });
  user = require(path.join(ROOT, 'api/user.js'));
  A = require(path.join(ROOT, 'api/_lib/telegram-alertas.js'));
  E = require(path.join(ROOT, 'api/_lib/telegram-alertas-envio.js'));
}

function reset() {
  M.store.docs.clear();
  enviados.length = 0;
  respostaTelegram = () => ({ ok: true, result: {} });
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'seg';
  process.env.CRON_SECRET = 'cron-123';
  global.fetch = async (url, opts) => {
    const metodo = String(url).split('/').pop();
    const payload = JSON.parse(opts.body);
    enviados.push({ metodo, payload });
    const r = respostaTelegram(metodo, payload);
    return { status: r.ok ? 200 : 403, json: async () => r };
  };
  M.store.docs.set(`users/${UID}/data/main`, {
    keys: mundo(),
    updatedAt: M.makeTimestamp(MANHA.getTime() - 3600000),
  });
  M.store.docs.set(`telegramLinks/${CHAT}`, { uid: UID });
  M.store.docs.set(`users/${UID}/integracoes/telegram`, { chatId: CHAT });
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() + 5 * 86400000),
  });
}

const mensagens = () => enviados.filter((e) => e.metodo === 'sendMessage');
const estado = () => M.store.docs.get(`users/${UID}/integracoes/telegramAlertas`) || {};

test.before(() => {
  reset();
  carregar();
});
test.beforeEach(() => reset());

// ─── regras ─────────────────────────────────────────────────────────────────

test('janelas: 8–11h manhã, 20–22h noite, fora disso nada (horário de Brasília)', () => {
  const C = require(path.join(ROOT, 'api/_lib/telegram-consultas.js'));
  const h = (iso) => A.janelaDaHora(C.agoraBrasilia(new Date(iso)));
  assert.equal(h('2026-10-08T10:59:00Z'), null); // 07:59
  assert.equal(h('2026-10-08T11:00:00Z'), 'manha');
  assert.equal(h('2026-10-08T14:59:00Z'), 'manha'); // 11:59
  assert.equal(h('2026-10-08T15:00:00Z'), null);
  assert.equal(h('2026-10-08T23:00:00Z'), 'noite'); // 20:00
  assert.equal(h('2026-10-09T01:59:00Z'), 'noite'); // 22:59
  assert.equal(h('2026-10-09T02:00:00Z'), null);
});

test('manhã: contas de hoje e amanhã, vencidas há até 3 dias, faturas', () => {
  const C = require(path.join(ROOT, 'api/_lib/telegram-consultas.js'));
  const avisos = A.avaliar(dadosPuros(), C.agoraBrasilia(MANHA), 'manha');
  const chaves = avisos.map((a) => a.chave);
  assert.deepEqual(chaves, [
    'venc:luz:2026-10-08:h',
    'venc:alug:2026-10-09:a',
    'vencida:net:2026-10-06',
    'ff:card_nu:2026-10-10',
    'fv:card_c6:2026-10-09:a',
  ]);
  // Paga, receita, vencida há mais de 3 dias e cartão arquivado ficam de fora.
  assert.ok(!chaves.some((c) => /paga|rfut|velha|card_velho/.test(c)));
  assert.match(avisos[0].texto, /<b>Hoje<\/b> vence <b>Luz<\/b>/);
  assert.match(avisos[3].texto, /Nubank<\/b> fecha <b>sábado \(10\/10\)<\/b> com R\$\s300,00/);
  assert.deepEqual(avisos[4].pagar.alvos, ['c61']);
});

test('limite de 60%: mesma régua do termômetro do app, uma vez por faixa', () => {
  const C = require(path.join(ROOT, 'api/_lib/telegram-consultas.js'));
  const d = dadosPuros();
  // receita 5000; gasto de outubro = fixas 1800+200+100+10 + cartão 300+450+99 = 2959 → 59%
  // (a "velha" é de setembro)
  let t = A.termometro60(d, 9, 2026);
  assert.equal(Math.round(t.gasto), 2959);
  assert.equal(t.faixa, 'atencao');
  let av = A.avaliar(d, C.agoraBrasilia(NOITE), 'noite').filter((a) => a.tipo === 'limite60');
  assert.equal(av.length, 1);
  assert.equal(av[0].chave, 'l60:2026-9:atencao');
  assert.match(av[0].texto, /59% da receita de outubro/);
  assert.match(av[0].texto, /Quem mais pesou: 🏠 Moradia/);

  d.transacoes.push(tx({ id: 'x', categoria: 'despesa_variavel', valor: 500, pago: true }));
  t = A.termometro60(d, 9, 2026);
  assert.equal(t.faixa, 'ultrapassado');
  av = A.avaliar(d, C.agoraBrasilia(NOITE), 'noite').filter((a) => a.tipo === 'limite60');
  assert.equal(av[0].chave, 'l60:2026-9:ultrapassado');
  assert.deepEqual(av[0].implica, ['l60:2026-9:atencao']);

  // Sem receita: o app diz "Sem dados" e não há aviso.
  d.transacoes = d.transacoes.filter((x) => x.categoria !== 'receita');
  assert.equal(A.termometro60(d, 9, 2026).faixa, 'sem_dados');
});

test('limite de 60%: a conta bate com calcularResumoMes do app', () => {
  const { criarMundo } = require('./_simulador.js');
  const { estadoDe } = require('./_harness-integracao.js');
  const { s } = criarMundo();
  const hoje = new Date();
  const r = s.calcularResumoMes(hoje.getMonth(), hoje.getFullYear());
  const t = A.termometro60(
    JSON.parse(JSON.stringify(estadoDe(s))),
    hoje.getMonth(),
    hoje.getFullYear()
  );
  assert.equal(Math.round(t.receita * 100), Math.round(r.receita * 100));
  assert.equal(Math.round(t.gasto * 100), Math.round((r.despFixa + r.despVar + r.cartao) * 100));
});

// ─── rodada ─────────────────────────────────────────────────────────────────

test('rodada da manhã manda UMA mensagem com tudo e não repete na hora seguinte', async () => {
  const r = await E.rodar({ agoraReal: MANHA });
  assert.equal(r.janela, 'manha');
  assert.deepEqual(r.motivos, { enviado: 1 });
  assert.equal(r.proximo, null);
  const m = mensagens();
  assert.equal(m.length, 1);
  assert.equal(m[0].payload.chat_id, String(CHAT));
  const texto = m[0].payload.text;
  assert.match(texto, /Bom dia/);
  assert.match(texto, /Luz/);
  assert.match(texto, /Aluguel/);
  assert.match(texto, /Internet<\/b> venceu 06\/10/);
  assert.match(texto, /Dados do app de/);
  assert.match(texto, /Para escolher quais receber/, '1ª mensagem explica como desligar');
  const botoes = m[0].payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(botoes.includes('a:o:vencimentos'));
  assert.ok(botoes.includes('a:o:fatura_fecha'));
  assert.ok(botoes.includes('a:v'));

  // Uma hora depois, mesma janela: nada.
  const r2 = await E.rodar({ agoraReal: new Date(MANHA.getTime() + 3600000) });
  assert.deepEqual(r2.motivos, { ja_tratado: 1 });
  assert.equal(mensagens().length, 1);
});

test('aviso já enviado não sai de novo no dia seguinte; o novo sai, sem a explicação', async () => {
  await E.rodar({ agoraReal: MANHA });
  // Dia 09, manhã: Aluguel vence HOJE (chave nova), Luz ficou vencida (nova),
  // C6 vence hoje (nova). Internet e o fechamento do Nubank já foram.
  await E.rodar({ agoraReal: new Date('2026-10-09T11:30:00Z') });
  const m = mensagens();
  assert.equal(m.length, 2);
  const t = m[1].payload.text;
  assert.match(t, /<b>Hoje<\/b> vence <b>Aluguel/);
  assert.match(t, /Luz<\/b> venceu 08\/10/);
  assert.doesNotMatch(t, /Internet/);
  assert.doesNotMatch(t, /Para escolher quais receber/);
});

test('tipo desligado não sai; pausado não sai nada', async () => {
  await E.definirTipo(UID, 'vencimentos', false);
  await E.definirTipo(UID, 'vencidas', false);
  await E.rodar({ agoraReal: MANHA });
  const t = mensagens()[0].payload.text;
  assert.doesNotMatch(t, /Luz|Aluguel|Internet/);
  assert.match(t, /Nubank/);

  reset();
  await E.definirPausa(UID, true);
  const r = await E.rodar({ agoraReal: MANHA });
  assert.deepEqual(r.motivos, { pausado: 1 });
  assert.equal(mensagens().length, 0);
});

test('nada a avisar: não manda mensagem, e marca a janela', async () => {
  M.store.docs.get(`users/${UID}/data/main`).keys = { appliquei_contas: '[]' };
  const r = await E.rodar({ agoraReal: MANHA });
  assert.deepEqual(r.motivos, { nada: 1 });
  assert.equal(mensagens().length, 0);
  assert.ok(estado().janelas['2026-10-08:manha']);
});

test('fora da janela não lê nada nem manda nada', async () => {
  const r = await E.rodar({ agoraReal: FORA });
  assert.equal(r.janela, null);
  assert.equal(mensagens().length, 0);
  assert.equal(M.store.docs.get(`users/${UID}/integracoes/telegramAlertas`), undefined);
});

test('noite: limite de 60%; passar de faixa depois manda só a nova', async () => {
  await E.rodar({ agoraReal: NOITE });
  assert.match(mensagens()[0].payload.text, /Boa noite[\s\S]*59% da receita/);
  const dados = M.store.docs.get(`users/${UID}/data/main`);
  const t = JSON.parse(dados.keys.futurorico_transacoes);
  t.push(tx({ id: 'x', categoria: 'despesa_variavel', valor: 500, pago: true }));
  dados.keys.futurorico_transacoes = JSON.stringify(t);
  await E.rodar({ agoraReal: new Date('2026-10-09T23:30:00Z') });
  assert.equal(mensagens().length, 2);
  assert.match(mensagens()[1].payload.text, /passou do limite de 60%/);
  // e no dia seguinte, ainda acima: nada
  await E.rodar({ agoraReal: new Date('2026-10-10T23:30:00Z') });
  assert.equal(mensagens().length, 2);
});

test('usuário que bloqueou o bot: marca e para de tentar por 7 dias', async () => {
  respostaTelegram = () => ({ ok: false, error_code: 403, description: 'bot was blocked' });
  const r = await E.rodar({ agoraReal: MANHA });
  assert.deepEqual(r.motivos, { bot_bloqueado: 1 });
  assert.ok(estado().bloqueadoEmMs);
  assert.equal(estado().enviados, undefined, 'nada conta como enviado');
  respostaTelegram = () => ({ ok: true, result: {} });
  const r2 = await E.rodar({ agoraReal: new Date('2026-10-09T11:30:00Z') });
  assert.deepEqual(r2.motivos, { bot_bloqueado: 1 });
});

test('falha passageira do Telegram: nada marcado, a próxima rodada da janela tenta de novo', async () => {
  respostaTelegram = () => ({ ok: false, error_code: 429, description: 'too many' });
  await E.rodar({ agoraReal: MANHA });
  assert.equal(estado().janelas, undefined);
  respostaTelegram = () => ({ ok: true, result: {} });
  const r = await E.rodar({ agoraReal: new Date(MANHA.getTime() + 3600000) });
  assert.deepEqual(r.motivos, { enviado: 1 });
});

test('assinatura bloqueada não recebe alerta', async () => {
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 30 * 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() - 20 * 86400000),
  });
  const r = await E.rodar({ agoraReal: MANHA });
  assert.deepEqual(r.motivos, { assinatura: 1 });
  assert.equal(mensagens().length, 0);
});

test('paginação: o cursor percorre todos os chats, e um erro não derruba os outros', async () => {
  for (let i = 1; i <= 30; i++)
    M.store.docs.set(`telegramLinks/90${String(i).padStart(2, '0')}`, { uid: 'u' + i });
  M.store.docs.set('telegramLinks/9999', {}); // link sem uid
  let cursor = null;
  let total = 0;
  let paginas = 0;
  do {
    const r = await E.rodar({ agoraReal: MANHA, cursor });
    total += r.processados;
    cursor = r.proximo;
    paginas++;
  } while (cursor && paginas < 10);
  assert.equal(total, 32);
  assert.equal(paginas, 2);
});

// ─── painel e botões ────────────────────────────────────────────────────────

async function webhook(update) {
  return M.call(user, {
    method: 'POST',
    query: { op: 'telegram' },
    headers: { 'x-telegram-bot-api-secret-token': 'seg' },
    body: Object.assign({ update_id: updateSeq++ }, update),
  });
}
const texto = (t) =>
  webhook({
    message: {
      message_id: updateSeq,
      chat: { id: CHAT, type: 'private' },
      from: { id: CHAT },
      text: t,
    },
  });
const botao = (data) =>
  webhook({
    callback_query: {
      id: 'cb',
      data,
      message: { message_id: 77, chat: { id: CHAT, type: 'private' }, text: 'x' },
    },
  });

test('🔔 Alertas abre o painel, e cada toque liga/desliga redesenhando o painel', async () => {
  await texto('🔔 Alertas');
  let ult = mensagens().pop().payload;
  assert.match(ult.text, /Seus alertas/);
  const linha = ult.reply_markup.inline_keyboard.find((l) => l[0].callback_data === 'a:t:limite60');
  assert.match(linha[0].text, /^✅ 🌙 Limite de 60%/);

  await botao('a:t:limite60');
  assert.equal(estado().desligados.limite60, true);
  const ed = enviados.filter((e) => e.metodo === 'editMessageText').pop().payload;
  assert.match(
    ed.reply_markup.inline_keyboard.find((l) => l[0].callback_data === 'a:t:limite60')[0].text,
    /^⬜/
  );
  await botao('a:t:limite60');
  assert.equal((estado().desligados || {}).limite60, undefined);

  await botao('a:p:1');
  assert.equal(estado().pausado, true);
  assert.match(
    enviados.filter((e) => e.metodo === 'editMessageText').pop().payload.text,
    /Pausados/
  );
  await botao('a:p:0');
  assert.equal(estado().pausado, false);
});

test('🔕 na mensagem de alerta desliga só aquele tipo, com ↩️ Desfazer', async () => {
  await botao('a:o:vencimentos');
  assert.equal(estado().desligados.vencimentos, true);
  const m = mensagens().pop().payload;
  assert.match(m.text, /não aviso mais sobre <b>contas vencendo<\/b>/);
  assert.equal(m.reply_markup.inline_keyboard[0][0].callback_data, 'a:u:vencimentos');
  await botao('a:u:vencimentos');
  assert.equal((estado().desligados || {}).vencimentos, undefined);
  // tipo inventado não grava nada
  await botao('a:o:hackear');
  assert.equal((estado().desligados || {}).hackear, undefined);
});

test('"parar alertas" e "ligar alertas" por texto', async () => {
  await texto('parar alertas');
  assert.equal(estado().pausado, true);
  assert.match(mensagens().pop().payload.text, /Alertas pausados/);
  await texto('Ligar os alertas');
  assert.equal(estado().pausado, false);
});

test('preferências sobrevivem a desconectar e reconectar', async () => {
  await E.definirTipo(UID, 'lembrete', false);
  const bot = require(path.join(ROOT, 'api/_lib/telegram-bot.js'));
  await bot.desvincular(UID);
  assert.equal(estado().desligados.lembrete, true);
});

// ─── endpoint ───────────────────────────────────────────────────────────────

function chamarRodada(headers, body) {
  return M.call(user, {
    method: 'POST',
    query: { op: 'telegram-alertas' },
    headers,
    body: body || {},
  });
}

test('endpoint: sem CRON_SECRET certo é 401; com ele roda (janela forçada para o teste manual)', async () => {
  assert.equal((await chamarRodada({})).status, 401);
  assert.equal((await chamarRodada({ authorization: 'Bearer errado-12' })).status, 401);
  const r = await chamarRodada({ authorization: 'Bearer cron-123' }, { janela: 'manha' });
  assert.equal(r.status, 200);
  assert.equal(r.body.janela, 'manha');
  assert.equal(r.body.processados, 1);
  delete process.env.CRON_SECRET;
  assert.equal((await chamarRodada({ authorization: 'Bearer cron-123' })).status, 503);
});

// ─── ✅ Já paguei (etapa 2b) ────────────────────────────────────────────────

const inbox = () => {
  const out = {};
  for (const [p, d] of M.store.docs) {
    const pre = `users/${UID}/telegramInbox/`;
    if (p.startsWith(pre)) out[p.slice(pre.length)] = d;
  }
  return out;
};

test('✅ Já paguei grava a ordem na caixa de entrada; ↩️ Desfazer troca por despagar', async () => {
  await E.rodar({ agoraReal: MANHA });
  const botoes = mensagens()[0].payload.reply_markup.inline_keyboard.flat();
  const pagar = botoes.filter((b) => b.callback_data.startsWith('pg:'));
  // Luz, Aluguel, Internet e a fatura do C6. O fechamento do Nubank não se paga.
  assert.deepEqual(
    pagar.map((b) => b.text),
    [
      '✅ Já paguei: Luz',
      '✅ Já paguei: Aluguel',
      '✅ Já paguei: Internet',
      '✅ Já paguei: fatura C6',
    ]
  );
  const k = pagar[3].callback_data.slice(3);
  await botao(`pg:${k}`);
  assert.deepEqual(inbox()[`pagar_${k}`].alvos, ['c61']);
  assert.equal(inbox()[`pagar_${k}`].tipo, 'pagar');
  const m = mensagens().pop().payload;
  assert.match(m.text, /fatura C6<\/b> marcado como pago/);
  assert.equal(m.reply_markup.inline_keyboard[0][0].callback_data, `pu:${k}`);

  await botao(`pu:${k}`);
  assert.equal(inbox()[`pagar_${k}`], undefined);
  assert.deepEqual(inbox()[`despagar_${k}`].alvos, ['c61']);
  // e pagar de novo apaga o despagar pendente
  await botao(`pg:${k}`);
  assert.equal(inbox()[`despagar_${k}`], undefined);
  assert.ok(inbox()[`pagar_${k}`]);
});

test('Já paguei com chave desconhecida, expirada ou forjada não grava nada', async () => {
  await botao('pg:AAAAAAAAAA');
  await botao('pg:../../billing');
  await botao('pu:AAAAAAAAAA');
  assert.deepEqual(inbox(), {});
  const resp = enviados
    .filter((e) => e.metodo === 'answerCallbackQuery')
    .map((e) => e.payload.text);
  assert.ok(resp.some((t) => /expirou/.test(t || '')));
});

test('Já paguei com assinatura bloqueada não grava', async () => {
  await E.rodar({ agoraReal: MANHA });
  const k = mensagens()[0]
    .payload.reply_markup.inline_keyboard.flat()
    .find((b) => b.callback_data.startsWith('pg:'))
    .callback_data.slice(3);
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 30 * 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() - 20 * 86400000),
  });
  await botao(`pg:${k}`);
  assert.deepEqual(inbox(), {});
});
