'use strict';

// Relatório Mensal em PDF pelo Telegram, contra o Firestore de mentira:
//   1. o bot: botão 📄 Relatório, escolha do mês, pedido + acionamento do
//      workflow na API do GitHub, e as travas;
//   2. o script do workflow (scripts/relatorio-telegram.js): lê o pedido,
//      gera, manda o PDF (sendDocument multipart) e nunca o faz duas vezes.
// A geração do documento em si está em relatorio-pdf.test.js; a impressão,
// em e2e/relatorio-pdf.spec.js.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'scripts/lib/mock-billing'));

let user;
let script;
let C;
const chamadas = [];
let respostaGithub = 204;
let respostaTelegram = () => ({ ok: true, result: {} });

const UID = 'u1';
const CHAT = 5550001;
let seq = 9000;

function carregar() {
  M.setup({ root: ROOT });
  user = require(path.join(ROOT, 'api/user.js'));
  script = require(path.join(ROOT, 'scripts/relatorio-telegram.js'));
  C = require(path.join(ROOT, 'api/_lib/telegram-consultas.js'));
}

function reset() {
  M.store.docs.clear();
  chamadas.length = 0;
  respostaGithub = 204;
  respostaTelegram = () => ({ ok: true, result: {} });
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'seg';
  process.env.GITHUB_DISPATCH_TOKEN = 'ghp_teste';
  delete process.env.GITHUB_REPO;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://api.github.com/')) {
      chamadas.push({ tipo: 'github', url: u, opts, body: JSON.parse(opts.body) });
      return { status: respostaGithub, json: async () => ({}) };
    }
    const metodo = u.split('/').pop();
    const body = opts.body instanceof FormData ? opts.body : JSON.parse(opts.body);
    chamadas.push({ tipo: 'telegram', metodo, body });
    const r = respostaTelegram(metodo);
    return { status: r.ok ? 200 : 400, json: async () => r };
  };
  M.store.docs.set(`telegramLinks/${CHAT}`, { uid: UID });
  M.store.docs.set(`users/${UID}/integracoes/telegram`, { chatId: CHAT });
  M.store.docs.set(`users/${UID}/data/main`, { keys: {} });
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() + 5 * 86400000),
  });
}

const tg = () => chamadas.filter((c) => c.tipo === 'telegram');
const ultimo = () => tg().pop();
const pedidos = () =>
  [...M.store.docs]
    .filter(([p]) => p.startsWith('telegramRelatorios/'))
    .map(([p, d]) => [p.split('/')[1], d]);

async function webhook(update) {
  return M.call(user, {
    method: 'POST',
    query: { op: 'telegram' },
    headers: { 'x-telegram-bot-api-secret-token': 'seg' },
    body: Object.assign({ update_id: seq++ }, update),
  });
}
const texto = (t) =>
  webhook({
    message: { message_id: seq, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: t },
  });
const botao = (data) =>
  webhook({
    callback_query: {
      id: 'cb',
      data,
      message: { message_id: 77, chat: { id: CHAT, type: 'private' }, text: 'x' },
    },
  });

function ymDe(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

test.before(() => {
  reset();
  carregar();
});
test.beforeEach(() => reset());

// ─── bot ────────────────────────────────────────────────────────────────────

test('📄 Relatório pergunta o mês: o atual e os 5 anteriores, do mais recente', async () => {
  await texto('📄 Relatório');
  const m = ultimo().body;
  assert.match(m.text, /Relatório Mensal/);
  const botoes = m.reply_markup.inline_keyboard.flat();
  assert.equal(botoes.length, 6);
  const agora = C.agoraBrasilia();
  assert.equal(botoes[0].callback_data, `rl:${ymDe(agora)}`);
  assert.equal(
    botoes[1].callback_data,
    `rl:${ymDe(new Date(agora.getFullYear(), agora.getMonth() - 1, 1))}`
  );
  // /relatorio e "relatório mensal" também
  await texto('/relatorio');
  assert.match(ultimo().body.text, /De qual mês/);
  await texto('Relatório mensal');
  assert.match(ultimo().body.text, /De qual mês/);
});

test('escolher o mês grava o pedido e aciona o workflow no GitHub só com o id', async () => {
  const ym = ymDe(C.agoraBrasilia());
  await botao(`rl:${ym}`);
  const ps = pedidos();
  assert.equal(ps.length, 1);
  const [id, p] = ps[0];
  assert.match(id, /^r[0-9a-f]{24}$/);
  assert.equal(p.uid, UID);
  assert.equal(p.chatId, CHAT);
  assert.equal(p.ym, ym);
  assert.equal(p.status, 'pendente');

  const gh = chamadas.find((c) => c.tipo === 'github');
  assert.equal(
    gh.url,
    'https://api.github.com/repos/opereirao54/investimentos/actions/workflows/relatorio-telegram.yml/dispatches'
  );
  assert.equal(gh.opts.headers.Authorization, 'Bearer ghp_teste');
  assert.deepEqual(gh.body, { ref: 'main', inputs: { pedido: id } });
  assert.match(
    ultimo().body.text,
    /Gerando o relatório de <b>.+<\/b>…\nEle chega aqui em 1 a 2 minutos/
  );
});

test('sem o token do GitHub: explica que ainda não foi ativado e não grava pedido', async () => {
  delete process.env.GITHUB_DISPATCH_TOKEN;
  await botao(`rl:${ymDe(C.agoraBrasilia())}`);
  assert.deepEqual(pedidos(), []);
  assert.match(ultimo().body.text, /ainda não foi ativado/);
});

test('GitHub recusou: avisa o usuário e marca o pedido', async () => {
  respostaGithub = 403;
  await botao(`rl:${ymDe(C.agoraBrasilia())}`);
  assert.equal(pedidos()[0][1].status, 'erro_disparo');
  assert.match(ultimo().body.text, /Não consegui pedir o relatório/);
});

test('mês futuro, inválido ou forjado não gera pedido', async () => {
  const agora = C.agoraBrasilia();
  await botao(`rl:${ymDe(new Date(agora.getFullYear(), agora.getMonth() + 1, 1))}`);
  await botao('rl:2026-13');
  await botao('rl:../../x');
  assert.deepEqual(pedidos(), []);
  assert.equal(chamadas.filter((c) => c.tipo === 'github').length, 0);
});

test('assinatura inativa não pede relatório', async () => {
  M.store.docs.set(`users/${UID}/billing/account`, {
    trialStartedAt: M.makeTimestamp(Date.now() - 30 * 86400000),
    trialEndsAt: M.makeTimestamp(Date.now() - 20 * 86400000),
  });
  await botao(`rl:${ymDe(C.agoraBrasilia())}`);
  assert.deepEqual(pedidos(), []);
});

test('no máximo 6 relatórios por hora por usuário', async () => {
  const ym = ymDe(C.agoraBrasilia());
  for (let i = 0; i < 8; i++) await botao(`rl:${ym}`);
  assert.equal(pedidos().length, 6);
});

test('o teclado fixo tem o botão 📄 Relatório', async () => {
  await texto('/ajuda');
  const linhas = ultimo().body.reply_markup.keyboard.map((l) => l.map((b) => b.text));
  assert.deepEqual(linhas[2], ['📄 Relatório']);
  assert.match(ultimo().body.text, /\/relatorio/);
});

// ─── script do workflow ─────────────────────────────────────────────────────

function pedido(extra) {
  const id = 'r' + 'a1'.repeat(12);
  M.store.docs.set(
    `telegramRelatorios/${id}`,
    Object.assign(
      { uid: UID, chatId: CHAT, ym: '2026-09', status: 'pendente', criadoEmMs: Date.now() },
      extra || {}
    )
  );
  return id;
}

const PDF_FALSO = Buffer.from('%PDF-1.4 falso');
const deps = { imprimirPdf: async () => PDF_FALSO, fetch: null };

test('script: gera, manda o PDF por sendDocument e marca enviado; rodar de novo não reenvia', async () => {
  const id = pedido();
  let html = null;
  const r = await script.processarPedido(id, {
    imprimirPdf: async (h) => {
      html = h;
      return PDF_FALSO;
    },
    fetch: null,
  });
  assert.equal(r.status, 'enviado');
  assert.match(html, /Relatório Mensal/);
  assert.match(html, /Setembro\/2026/);
  const env = tg().find((c) => c.metodo === 'sendDocument');
  assert.ok(env.body instanceof FormData);
  assert.equal(env.body.get('chat_id'), String(CHAT));
  assert.equal(env.body.get('document').name, 'relatorio-mensal-2026-09.pdf');
  assert.equal(env.body.get('document').type, 'application/pdf');
  assert.equal(
    Buffer.from(await env.body.get('document').arrayBuffer()).toString(),
    '%PDF-1.4 falso'
  );
  assert.match(env.body.get('caption'), /Relatório Mensal — Setembro\/2026/);
  assert.equal(M.store.docs.get(`telegramRelatorios/${id}`).status, 'enviado');

  const de_novo = await script.processarPedido(id, deps);
  assert.equal(de_novo.status, 'ja_tratado');
  assert.equal(tg().filter((c) => c.metodo === 'sendDocument').length, 1);
});

test('script: pedido inexistente, inválido ou velho (30 min) não gera nada', async () => {
  assert.equal((await script.processarPedido('r' + 'f'.repeat(24), deps)).status, 'nao_encontrado');
  assert.equal((await script.processarPedido('../x', deps)).status, 'id_invalido');
  const id = pedido({ criadoEmMs: Date.now() - 31 * 60000 });
  assert.equal((await script.processarPedido(id, deps)).status, 'expirado');
  assert.equal(tg().length, 0);
});

test('script: falha ao gerar ou enviar avisa o usuário, marca erro e não vaza a exceção', async () => {
  const id = pedido();
  const r = await script.processarPedido(id, {
    imprimirPdf: async () => {
      throw new Error('Saldo do Fulano: R$ 1.234,56 deu pau');
    },
    fetch: null,
  });
  assert.equal(r.status, 'erro');
  assert.equal(r.erro, 'Error', 'só o tipo do erro, nunca a mensagem');
  assert.equal(M.store.docs.get(`telegramRelatorios/${id}`).status, 'erro');
  assert.match(ultimo().body.text, /Não consegui gerar o relatório agora/);

  const id2 = 'r' + 'b2'.repeat(12);
  M.store.docs.set(`telegramRelatorios/${id2}`, {
    uid: UID,
    chatId: CHAT,
    ym: '2026-09',
    status: 'pendente',
    criadoEmMs: Date.now(),
  });
  respostaTelegram = (metodo) =>
    metodo === 'sendDocument' ? { ok: false, description: 'x' } : { ok: true };
  const r2 = await script.processarPedido(id2, deps);
  assert.equal(r2.erro, 'envio_telegram');
});

test('script: aplica os lançamentos do Telegram ainda na caixa de entrada', async () => {
  M.store.docs.set(`users/${UID}/data/main`, {
    keys: {
      appliquei_contas: JSON.stringify([
        { id: 'c1', nome: 'Itaú', tipo: 'banco', principal: true },
      ]),
    },
  });
  M.store.docs.set(`users/${UID}/telegramInbox/tg5550001_1`, {
    tipo: 'lancamento',
    criadoEmMs: 1,
    lanc: {
      categoria: 'despesa_variavel',
      valor: 77,
      descricao: 'Mercado',
      dataCompra: '2026-09-10',
      contaId: 'c1',
      banco: 'Itaú',
    },
  });
  let html = '';
  await script.processarPedido(pedido(), {
    imprimirPdf: async (h) => {
      html = h;
      return PDF_FALSO;
    },
    fetch: null,
  });
  assert.match(html, /Despesas de consumo<\/div><div class="k-val"[^>]*>R\$\s77,00/);
  assert.match(
    tg()
      .find((c) => c.metodo === 'sendDocument')
      .body.get('caption'),
    /Já inclui o que você lançou aqui/
  );
  // e nada foi gravado de volta: a caixa de entrada continua lá para o app
  assert.ok(M.store.docs.get(`users/${UID}/telegramInbox/tg5550001_1`));
});
