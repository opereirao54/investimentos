'use strict';

// Bot do Telegram de ponta a ponta no servidor: vínculo pelo código, mensagem
// virando item na caixa de entrada, escolha de cartão, Desfazer, troca de
// categoria, idempotência por update_id, e as travas (segredo do webhook,
// chat de grupo, assinatura bloqueada, botão de outro chat).
//
// Firestore de mentira (scripts/lib/mock-billing.js) e `fetch` de mentira que
// grava o que o bot "mandou" ao Telegram.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'scripts/lib/mock-billing'));

let user;
let bot;
const enviados = [];

function carregar() {
  // setup() instala o Firestore de mentira no lugar de api/_lib/firebase-admin.
  M.setup({ root: ROOT });
  user = require(path.join(ROOT, 'api/user.js'));
  bot = require(path.join(ROOT, 'api/_lib/telegram-bot.js'));
  bot.definirIA(null);
}

const SEGREDO = 'segredo-de-teste-123';
const UID = 'u1';
const CHAT = 5550001;
let updateSeq = 1000;
let msgSeq = 1;

function reset() {
  M.store.docs.clear();
  enviados.length = 0;
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_BOT_USERNAME = 'AppliqueiBot';
  process.env.TELEGRAM_WEBHOOK_SECRET = SEGREDO;
  delete process.env.GEMINI_API_KEY;
  global.fetch = async (url, opts) => {
    const metodo = String(url).split('/').pop();
    enviados.push({ metodo, payload: JSON.parse(opts.body) });
    return { status: 200, json: async () => ({ ok: true, result: {} }) };
  };
  // Dados do usuário como o app grava (JSON por chave em data/main).
  M.store.docs.set(`users/${UID}/data/main`, {
    keys: {
      appliquei_contas: JSON.stringify([
        { id: 'c_itau', nome: 'Itaú', tipo: 'banco', principal: true },
        { id: 'c_nu', nome: 'Nubank', tipo: 'banco' },
      ]),
      futurorico_cartoes: JSON.stringify([
        { id: 'card_nu', nome: 'Nubank', diaFechamento: 2, diaVencimento: 10 },
        { id: 'card_c6', nome: 'C6', diaFechamento: 20, diaVencimento: 28 },
      ]),
    },
  });
  // Trial ativo.
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() + 5 * 86400000),
  });
}

async function webhook(update, segredo = SEGREDO) {
  return M.call(user, {
    method: 'POST',
    query: { op: 'telegram' },
    headers: segredo ? { 'x-telegram-bot-api-secret-token': segredo } : {},
    body: update,
  });
}

function mensagem(texto, opts = {}) {
  return {
    update_id: updateSeq++,
    message: {
      message_id: opts.messageId || msgSeq++,
      from: { id: opts.chat || CHAT, first_name: 'Ana', username: 'ana' },
      chat: { id: opts.chat || CHAT, type: opts.tipo || 'private' },
      text: texto,
    },
  };
}

function botao(dados, opts = {}) {
  return {
    update_id: updateSeq++,
    callback_query: {
      id: 'cb' + updateSeq,
      data: dados,
      message: {
        message_id: opts.messageId || 99,
        chat: { id: opts.chat || CHAT, type: 'private' },
        text: opts.texto || '✅ Despesa lançada\nMercado · R$ 52,90\n🛒 Alimentação',
      },
    },
  };
}

function api(op, method, body, uid = UID) {
  return M.call(user, {
    method,
    query: { op },
    headers: { authorization: `Bearer fake:${uid}:${uid}@example.com` },
    body,
  });
}

function inbox(uid = UID) {
  const out = {};
  for (const [p, d] of M.store.docs) {
    const pre = `users/${uid}/telegramInbox/`;
    if (p.startsWith(pre)) out[p.slice(pre.length)] = d;
  }
  return out;
}

function ultimoTexto() {
  const m = enviados.filter((e) => e.metodo === 'sendMessage' || e.metodo === 'editMessageText');
  return m.length ? m[m.length - 1].payload.text : '';
}

async function conectar() {
  const r = await api('telegram-link', 'POST', {});
  assert.equal(r.status, 200);
  await webhook(mensagem(`/start ${r.body.codigo}`));
}

test.before(() => {
  reset();
  carregar();
});
test.beforeEach(() => reset());

test('webhook sem o header secreto é recusado e não processa nada', async () => {
  const r = await webhook(mensagem('mercado 50'), null);
  assert.equal(r.status, 401);
  const r2 = await webhook(mensagem('mercado 50'), 'errado-errado-errado');
  assert.equal(r2.status, 401);
  assert.equal(enviados.length, 0);
});

test('webhook sem TELEGRAM_WEBHOOK_SECRET configurado recusa tudo', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const r = await webhook(mensagem('mercado 50'), '');
  assert.equal(r.status, 401);
});

test('chat não conectado recebe instrução para conectar pelo app', async () => {
  await webhook(mensagem('mercado 50'));
  assert.match(ultimoTexto(), /ainda não está ligado/);
  assert.deepEqual(inbox(), {});
});

test('telegram-link exige login', async () => {
  const r = await M.call(user, { method: 'POST', query: { op: 'telegram-link' }, body: {} });
  assert.equal(r.status, 401);
});

test('vínculo: link → /start CÓDIGO conecta, e o código não serve duas vezes', async () => {
  const r = await api('telegram-link', 'POST', {});
  assert.equal(r.body.url, `https://t.me/AppliqueiBot?start=${r.body.codigo}`);
  assert.match(r.body.codigo, /^[A-Za-z0-9]{12}$/);

  await webhook(mensagem(`/start ${r.body.codigo}`));
  assert.match(ultimoTexto(), /Conectado/);
  assert.match(ultimoTexto(), /Itaú/, 'informa a conta principal');

  const st = await api('telegram-status', 'GET');
  assert.equal(st.body.conectado, true);
  assert.equal(st.body.username, 'ana');

  // Outro chat tentando reusar o código.
  await webhook(mensagem(`/start ${r.body.codigo}`, { chat: 777 }));
  assert.match(ultimoTexto(), /expirou ou já foi usado/);
  assert.equal(M.store.docs.has('telegramLinks/777'), false);
});

test('código expirado não conecta', async () => {
  const r = await api('telegram-link', 'POST', {});
  const doc = M.store.docs.get(`telegramCodigos/${r.body.codigo}`);
  doc.expiraEmMs = Date.now() - 1;
  await webhook(mensagem(`/start ${r.body.codigo}`));
  assert.match(ultimoTexto(), /expirou/);
  assert.equal(M.store.docs.has(`telegramLinks/${CHAT}`), false);
});

test('despesa simples vai para a caixa de entrada com a conta principal', async () => {
  await conectar();
  await webhook(mensagem('mercado 52,90', { messageId: 10 }));
  const id = `tg${CHAT}_10`;
  const item = inbox()[id];
  assert.ok(item, 'item na caixa de entrada');
  assert.equal(item.tipo, 'lancamento');
  assert.equal(item.lanc.categoria, 'despesa_variavel');
  assert.equal(item.lanc.valor, 52.9);
  assert.equal(item.lanc.contaId, 'c_itau');
  assert.equal(item.lanc.banco, 'Itaú');
  assert.equal(item.lanc.categoriaDespesa, 'alimentacao');
  assert.match(ultimoTexto(), /Despesa lançada/);
  const ultimo = enviados[enviados.length - 1].payload;
  assert.deepEqual(
    ultimo.reply_markup.inline_keyboard[0].map((b) => b.callback_data),
    [`u:${id}`, `c:${id}`]
  );
  // E o bot NÃO tocou nas transações.
  assert.equal(M.store.docs.get(`users/${UID}/data/main`).keys.futurorico_transacoes, undefined);
});

test('a mesma entrega do Telegram duas vezes não lança duas vezes', async () => {
  await conectar();
  const u = mensagem('uber 18', { messageId: 11 });
  await webhook(u);
  const n = enviados.length;
  const r = await webhook(u);
  assert.equal(r.body.ignorado, 'repetido');
  assert.equal(enviados.length, n, 'não responde de novo');
  assert.equal(Object.keys(inbox()).length, 1);
});

test('mensagem de grupo é ignorada', async () => {
  await conectar();
  // O link é por chat; um grupo tem outro id, mas mesmo que coincidisse:
  const r = await webhook(mensagem('mercado 50', { tipo: 'group' }));
  assert.equal(r.body.ignorado, 'nao_privado');
  assert.deepEqual(inbox(), {});
});

test('assinatura bloqueada não lança', async () => {
  await conectar();
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 30 * 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() - 20 * 86400000),
  });
  await webhook(mensagem('mercado 50'));
  assert.match(ultimoTexto(), /assinatura .* inativa/);
  assert.deepEqual(inbox(), {});
});

test('sem conta principal e sem conta citada: pede para escolher, não lança', async () => {
  M.store.docs.get(`users/${UID}/data/main`).keys.appliquei_contas = JSON.stringify([
    { id: 'c_itau', nome: 'Itaú', tipo: 'banco' },
    { id: 'c_nu', nome: 'Nubank', tipo: 'banco' },
  ]);
  await conectar();
  await webhook(mensagem('padaria 12'));
  assert.match(ultimoTexto(), /conta principal/);
  assert.deepEqual(inbox(), {});
  // Citando a conta funciona.
  await webhook(mensagem('itaú padaria 12', { messageId: 50 }));
  assert.equal(inbox()[`tg${CHAT}_50`].lanc.contaId, 'c_itau');
});

test('receita cai na conta principal', async () => {
  await conectar();
  await webhook(mensagem('+3500 salário', { messageId: 12 }));
  const l = inbox()[`tg${CHAT}_12`].lanc;
  assert.equal(l.categoria, 'receita');
  assert.equal(l.contaId, 'c_itau');
  assert.match(ultimoTexto(), /Receita lançada/);
});

test('cartão citado com parcelas', async () => {
  await conectar();
  await webhook(mensagem('nubank 300 tênis 3x', { messageId: 13 }));
  const l = inbox()[`tg${CHAT}_13`].lanc;
  assert.equal(l.categoria, 'cartao_credito');
  assert.equal(l.cartaoId, 'card_nu');
  assert.equal(l.parcelas, 3);
  assert.equal(l.contaId, null, 'compra no cartão não sai da conta agora');
  assert.match(ultimoTexto(), /3x de R\$\s?100,00/);
});

test('"cartão" com dois cartões: pergunta, e o botão conclui', async () => {
  await conectar();
  await webhook(mensagem('cartão 89 farmácia', { messageId: 14 }));
  const id = `tg${CHAT}_14`;
  assert.deepEqual(inbox(), {}, 'ainda não lança');
  const teclado = enviados[enviados.length - 1].payload.reply_markup.inline_keyboard;
  assert.deepEqual(
    teclado.map((l) => l[0].callback_data),
    [`p:${id}:0`, `p:${id}:1`]
  );
  await webhook(botao(`p:${id}:1`));
  const l = inbox()[id].lanc;
  assert.equal(l.cartaoId, 'card_c6');
  assert.equal(l.valor, 89);
  assert.equal(M.store.docs.has(`telegramPendentes/${id}`), false);
});

test('Desfazer: tira da caixa e deixa a ordem de desfazer', async () => {
  await conectar();
  await webhook(mensagem('mercado 50', { messageId: 15 }));
  const id = `tg${CHAT}_15`;
  await webhook(botao(`u:${id}`));
  const cx = inbox();
  assert.equal(cx[id], undefined);
  assert.deepEqual(
    { tipo: cx[`desfazer_${id}`].tipo, alvo: cx[`desfazer_${id}`].alvo },
    { tipo: 'desfazer', alvo: id }
  );
  assert.match(ultimoTexto(), /Desfeito/);
});

test('/desfazer desfaz o último lançamento', async () => {
  await conectar();
  await webhook(mensagem('mercado 50', { messageId: 16 }));
  await webhook(mensagem('/desfazer'));
  assert.ok(inbox()[`desfazer_tg${CHAT}_16`]);
});

test('botão de um chat não mexe em lançamento de outro chat', async () => {
  await conectar();
  await webhook(mensagem('mercado 50', { messageId: 17 }));
  // Outro usuário conectado em outro chat tenta desfazer o lançamento do primeiro.
  M.store.docs.set('telegramLinks/888', { uid: 'u2' });
  await webhook(botao(`u:tg${CHAT}_17`, { chat: 888 }));
  assert.ok(inbox()[`tg${CHAT}_17`], 'lançamento intacto');
  assert.deepEqual(inbox('u2'), {});
});

test('trocar categoria: atualiza o item, deixa o ajuste e aprende a palavra', async () => {
  await conectar();
  await webhook(mensagem('presente 150', { messageId: 18 }));
  const id = `tg${CHAT}_18`;
  assert.equal(inbox()[id].lanc.categoriaDespesa, null);
  await webhook(botao(`c:${id}`));
  const teclado = enviados[enviados.length - 1].payload.reply_markup.inline_keyboard;
  const lazer = teclado.flat().find((b) => /Lazer/.test(b.text));
  await webhook(botao(lazer.callback_data));
  assert.equal(inbox()[id].lanc.categoriaDespesa, 'lazer');
  assert.equal(inbox()[`cat_${id}`].categoriaDespesa, 'lazer');
  assert.match(ultimoTexto(), /Lazer/);
  // Próxima mensagem com "presente" já vem em Lazer.
  await webhook(mensagem('presente 80', { messageId: 19 }));
  assert.equal(inbox()[`tg${CHAT}_19`].lanc.categoriaDespesa, 'lazer');
});

test('caixa de entrada pela API: lista em ordem e confirma só ids válidos', async () => {
  await conectar();
  await webhook(mensagem('mercado 50', { messageId: 20 }));
  await webhook(mensagem('uber 18', { messageId: 21 }));
  const r = await api('telegram-inbox', 'GET');
  assert.deepEqual(
    r.body.itens.map((i) => i.id),
    [`tg${CHAT}_20`, `tg${CHAT}_21`]
  );
  const bad = await api('telegram-inbox', 'POST', { ids: ['../../billing/account'] });
  assert.equal(bad.status, 400);
  const ok = await api('telegram-inbox', 'POST', { ids: [`tg${CHAT}_20`] });
  assert.equal(ok.body.removidos, 1);
  assert.deepEqual(Object.keys(inbox()), [`tg${CHAT}_21`]);
  // Outro usuário só enxerga a própria caixa.
  const r2 = await api('telegram-inbox', 'GET', undefined, 'u2');
  assert.deepEqual(r2.body.itens, []);
});

test('desconectar pelo app e pelo bot', async () => {
  await conectar();
  const r = await api('telegram-unlink', 'POST', {});
  assert.equal(r.body.ok, true);
  assert.equal(M.store.docs.has(`telegramLinks/${CHAT}`), false);
  assert.equal((await api('telegram-status', 'GET')).body.conectado, false);
  await webhook(mensagem('mercado 50'));
  assert.match(ultimoTexto(), /ainda não está ligado/);

  await conectar();
  await webhook(mensagem('/desconectar'));
  assert.equal(M.store.docs.has(`telegramLinks/${CHAT}`), false);
});

test('reconectar a conta em outro chat derruba o chat antigo', async () => {
  await conectar();
  const r = await api('telegram-link', 'POST', {});
  await webhook(mensagem(`/start ${r.body.codigo}`, { chat: 4242 }));
  assert.equal(M.store.docs.has(`telegramLinks/${CHAT}`), false);
  assert.equal(M.store.docs.get('telegramLinks/4242').uid, UID);
});

test('IA de reserva: só entra quando a regra não entende, e a regra valida o resultado', async () => {
  await conectar();
  const chamadas = [];
  bot.definirIA({
    reescrever: async (t) => {
      chamadas.push(['reescrever', t]);
      return 'mercado 50';
    },
    categorizar: async (d) => {
      chamadas.push(['categorizar', d]);
      return 'lazer';
    },
  });
  try {
    await webhook(mensagem('gastei cinquenta conto no mercado', { messageId: 30 }));
    assert.equal(inbox()[`tg${CHAT}_30`].lanc.valor, 50);
    assert.equal(chamadas[0][0], 'reescrever');

    // Regra entendeu e achou categoria: IA nem é chamada.
    chamadas.length = 0;
    await webhook(mensagem('uber 18', { messageId: 31 }));
    assert.deepEqual(chamadas, []);

    // Regra entendeu mas sem categoria: IA só categoriza.
    await webhook(mensagem('presente 99', { messageId: 32 }));
    assert.deepEqual(chamadas, [['categorizar', 'Presente']]);
    assert.equal(inbox()[`tg${CHAT}_32`].lanc.categoriaDespesa, 'lazer');

    // IA devolvendo lixo não vira lançamento.
    bot.definirIA({ reescrever: async () => 'blá blá', categorizar: async () => 'inexistente' });
    await webhook(mensagem('coisa estranha', { messageId: 33 }));
    assert.equal(inbox()[`tg${CHAT}_33`], undefined);
  } finally {
    bot.definirIA(null);
  }
});

test('segredo com acento e mesmo número de caracteres responde 401, não 500', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'segredo-de-teste-çã';
  const r = await webhook(mensagem('mercado 50'), 'segredo-de-teste-ca');
  assert.equal(r.status, 401);
});

// ─── consultas ──────────────────────────────────────────────────────────────
// Os números em si são provados contra o app em telegram-consultas.test.js.
// Aqui: roteamento, texto, teclados, aviso da caixa de entrada e as travas.

function ultimoEnvio() {
  const m = enviados.filter((e) => e.metodo === 'sendMessage' || e.metodo === 'editMessageText');
  return m.length ? m[m.length - 1].payload : {};
}

function semearTransacoes() {
  // O mês do bot é o de Brasília (o servidor roda em UTC).
  const agora = require(path.join(ROOT, 'api/_lib/telegram-consultas.js')).agoraBrasilia();
  const M0 = agora.getMonth();
  const A0 = agora.getFullYear();
  const dados = M.store.docs.get(`users/${UID}/data/main`);
  dados.keys.appliquei_contas = JSON.stringify([
    { id: 'c_itau', nome: 'Itaú', tipo: 'banco', principal: true, saldoInicial: 1000 },
    { id: 'c_nu', nome: 'Nubank', tipo: 'banco', saldoInicial: 250.5 },
    { id: 'c_rico', nome: 'Rico', tipo: 'corretora' },
  ]);
  dados.keys.futurorico_transacoes = JSON.stringify([
    { id: 't1', categoria: 'receita', valor: 5000, contaId: 'c_itau', mes: M0, ano: A0 },
    {
      id: 't2',
      categoria: 'despesa_variavel',
      valor: 300,
      contaId: 'c_itau',
      mes: M0,
      ano: A0,
      pago: true,
      categoriaDespesa: 'alimentacao',
    },
    {
      id: 't3',
      categoria: 'despesa_fixa',
      valor: 1200,
      contaId: 'c_itau',
      mes: M0,
      ano: A0,
      pago: false,
      categoriaDespesa: 'moradia',
    },
  ]);
  dados.updatedAt = M.makeTimestamp(Date.now());
}

test('/saldo responde o saldo por conta, esconde corretora zerada e manda o teclado fixo', async () => {
  semearTransacoes();
  await conectar();
  await webhook(mensagem('/saldo'));
  const p = ultimoEnvio();
  assert.match(p.text, /Saldo em conta/);
  assert.match(p.text, /Itaú: <b>R\$\s5\.700,00<\/b>/); // 1000 + 5000 − 300 (a fixa não foi paga)
  assert.match(p.text, /Nubank: <b>R\$\s250,50<\/b>/);
  assert.doesNotMatch(p.text, /Rico/);
  assert.match(p.text, /Total: R\$\s5\.950,50/);
  assert.match(p.text, /Dados do app de/);
  assert.ok(p.reply_markup.keyboard, 'teclado fixo');
  assert.deepEqual(inbox(), {}, 'consulta não grava nada');
});

test('o botão do teclado e a palavra solta também consultam; "mercado 50" continua lançamento', async () => {
  semearTransacoes();
  await conectar();
  await webhook(mensagem('💰 Saldo'));
  assert.match(ultimoTexto(), /Saldo em conta/);
  await webhook(mensagem('Fatura'));
  assert.match(ultimoTexto(), /💳 <b>Nubank<\/b>/);
  await webhook(mensagem('/saldo@AppliqueiBot'));
  assert.match(ultimoTexto(), /Saldo em conta/);
  await webhook(mensagem('mercado 50', { messageId: 70 }));
  assert.ok(inbox()[`tg${CHAT}_70`]);
});

test('/fatura soma o que já está na fatura aberta de cada cartão', async () => {
  semearTransacoes();
  await conectar();
  // Lança no cartão pelo bot e finge que o app aplicou: a transação vai para o
  // JSON com o vencimento que o app teria calculado.
  const consultas = require(path.join(ROOT, 'api/_lib/telegram-consultas.js'));
  const agora = consultas.agoraBrasilia();
  const venc = consultas.cartaoCalcularVencimento(agora, 2, 10);
  const dados = M.store.docs.get(`users/${UID}/data/main`);
  const tx = JSON.parse(dados.keys.futurorico_transacoes);
  tx.push({
    id: 'c1',
    categoria: 'cartao_credito',
    cartaoId: 'card_nu',
    valor: 89.9,
    dataVencimento: consultas.ymdLocal(venc),
    mes: venc.getMonth(),
    ano: venc.getFullYear(),
  });
  dados.keys.futurorico_transacoes = JSON.stringify(tx);
  await webhook(mensagem('/fatura'));
  const t = ultimoTexto();
  assert.match(t, /💳 <b>Nubank<\/b>\nAberta: <b>R\$\s89,90<\/b>/);
  assert.match(t, /💳 <b>C6<\/b>\nAberta: <b>R\$\s0,00<\/b>/);
});

test('/mes mostra o resumo, as categorias e navega entre meses pelo botão', async () => {
  semearTransacoes();
  await conectar();
  await webhook(mensagem('/mes'));
  const p = ultimoEnvio();
  assert.match(p.text, /Receitas: <b>R\$\s5\.000,00<\/b>/);
  assert.match(p.text, /Despesas: <b>R\$\s1\.500,00<\/b>/);
  assert.match(p.text, /Resultado: <b>\+R\$\s3\.500,00<\/b>/);
  assert.match(p.text, /80% 🏠 Moradia · R\$\s1\.200,00/);
  assert.match(p.text, /20% 🛒 Alimentação · R\$\s300,00/);
  const voltar = p.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(voltar, /^m:\d{4}-\d{1,2}$/);

  await webhook(botao(voltar));
  const ed = ultimoEnvio();
  assert.equal(enviados[enviados.length - 1].metodo, 'editMessageText');
  assert.match(ed.text, /Nenhum lançamento neste mês/);

  // Mês inválido no botão: só responde o clique.
  const antes = enviados.length;
  await webhook(botao('m:2026-13'));
  assert.equal(enviados.length, antes + 1);
  assert.equal(enviados[enviados.length - 1].metodo, 'answerCallbackQuery');
});

test('consulta avisa os lançamentos do Telegram que o app ainda não aplicou', async () => {
  semearTransacoes();
  await conectar();
  await webhook(mensagem('mercado 50', { messageId: 80 }));
  await webhook(mensagem('uber 18', { messageId: 81 }));
  await webhook(mensagem('/saldo'));
  assert.match(ultimoTexto(), /2 lançamentos feitos aqui ainda não entraram no app/);
});

test('consulta sem conta nem cartão explica onde cadastrar', async () => {
  const dados = M.store.docs.get(`users/${UID}/data/main`);
  await conectar();
  dados.keys.appliquei_contas = '[]';
  dados.keys.futurorico_cartoes = '[]';
  await webhook(mensagem('/saldo'));
  assert.match(ultimoTexto(), /ainda não tem conta cadastrada/);
  await webhook(mensagem('/fatura'));
  assert.match(ultimoTexto(), /ainda não tem cartão cadastrado/);
});

test('assinatura bloqueada não consulta, nem pelo botão de mês', async () => {
  semearTransacoes();
  await conectar();
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 30 * 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() - 20 * 86400000),
  });
  await webhook(mensagem('/saldo'));
  assert.match(ultimoTexto(), /assinatura .* inativa/);
  assert.doesNotMatch(ultimoTexto(), /Total/);
  await webhook(botao('m:2026-0'));
  const ult = enviados[enviados.length - 1];
  assert.equal(ult.metodo, 'answerCallbackQuery');
  assert.match(ult.payload.text, /inativa/);
});

test('chat não conectado não consulta', async () => {
  semearTransacoes();
  await webhook(mensagem('/saldo', { chat: 777 }));
  assert.match(ultimoTexto(), /ainda não está ligado/);
});

test('/ajuda lista as consultas e manda o teclado fixo', async () => {
  await conectar();
  await webhook(mensagem('/ajuda'));
  const p = ultimoEnvio();
  assert.match(p.text, /\/saldo/);
  assert.deepEqual(
    p.reply_markup.keyboard[0].map((b) => b.text),
    ['💰 Saldo', '💳 Fatura', '📊 Mês']
  );
});

test('lançamento às 22h30 de 31/10 em Brasília (01/11 em UTC) cai em 31/10, não em novembro', async (t) => {
  await conectar();
  const agora = Date.parse('2026-11-01T01:30:00Z');
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(agora - 86400000),
    trialEndsAt: M.makeTimestamp(agora + 5 * 86400000),
  });
  t.mock.timers.enable({ apis: ['Date'], now: agora });
  try {
    await webhook(mensagem('mercado 50', { messageId: 90 }));
    await webhook(mensagem('ontem uber 18', { messageId: 91 }));
  } finally {
    t.mock.timers.reset();
  }
  assert.equal(inbox()[`tg${CHAT}_90`].lanc.dataCompra, '2026-10-31');
  assert.equal(inbox()[`tg${CHAT}_91`].lanc.dataCompra, '2026-10-30');
});
