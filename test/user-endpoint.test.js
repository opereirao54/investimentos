'use strict';

// /api/user — feedback (Dúvidas & Sugestões) e reenvio de verificação.
//
// POR QUE O ENDPOINT EXISTE (e por que estes testes existem)
//
// O formulário escrevia e lia a coleção `feedback` direto pelo SDK do cliente,
// o que depende da Security Rule `match /feedback/{id}` estar PUBLICADA no
// projeto. A regra e o formulário entraram no mesmo commit (836024c) e não há
// passo de CI que publique `firestore.rules` — o deploy é manual. Sem ele vale
// a negação implícita: todo envio volta `permission-denied` mesmo com o e-mail
// verificado, e o histórico fica em "0 total". Era o relato: "eu nunca
// consegui enviar nada por lá".
//
// O Admin SDK não passa por Security Rules. O que estes testes travam é que as
// garantias que a regra dava não se perderam na mudança: uid vindo do TOKEN,
// texto entre 10 e 1000 caracteres, leitura restrita ao próprio usuário e
// status/reply escritos só pelo servidor.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const AUTH_PATH = require.resolve('../api/_lib/auth');
const SENTRY_PATH = require.resolve('../api/_lib/sentry');
const ADMIN_PATH = require.resolve('../api/_lib/firebase-admin');
const RL_PATH = require.resolve('../api/_lib/rate-limit');

function stubModule(id, exports) {
  const m = new Module(id);
  m.exports = exports;
  m.loaded = true;
  m.filename = id;
  Module._cache[id] = m;
}

// --- Firestore de mentira: só o que o endpoint usa -------------------------
const store = { docs: [], addFalha: null };
let ultimoWhere = null;

function fakeCollection(nome) {
  assert.equal(nome, 'feedback', 'o endpoint só toca a coleção de feedback');
  return {
    add(doc) {
      if (store.addFalha) return Promise.reject(store.addFalha);
      const id = 'doc' + (store.docs.length + 1);
      store.docs.push({ id, data: doc });
      return Promise.resolve({ id });
    },
    where(campo, op, valor) {
      ultimoWhere = { campo, op, valor };
      return {
        get() {
          const achados = store.docs.filter((d) => d.data[campo] === valor);
          return Promise.resolve({
            forEach(cb) {
              achados.forEach((d) => cb({ id: d.id, data: () => d.data }));
            },
          });
        },
      };
    },
  };
}

stubModule(ADMIN_PATH, {
  init: () => {},
  db: () => ({ collection: fakeCollection }),
  auth: () => ({
    generateEmailVerificationLink: async (email) => 'https://link/' + email,
  }),
  fieldValue: () => ({ serverTimestamp: () => 'SERVER_TS' }),
  timestamp: () => ({ fromMillis: (n) => n }),
});

let rlPermite = true;
stubModule(RL_PATH, {
  check: async () => ({ allowed: rlPermite, count: 1, retryAfterMs: rlPermite ? 0 : 30000 }),
  ipFrom: () => '127.0.0.1',
});

let usuario = { uid: 'u1', email: 'a@b.c', email_verified: true };
stubModule(AUTH_PATH, {
  cors: (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return true;
    }
    return false;
  },
  requireUser: async (req, res) => {
    if (!usuario) {
      res.status(401).json({ error: 'missing_token' });
      return null;
    }
    return usuario;
  },
  requireVerifiedUser: async (req, res) => Module._cache[AUTH_PATH].exports.requireUser(req, res),
  requireFreshVerifiedUser: async (req, res) =>
    Module._cache[AUTH_PATH].exports.requireUser(req, res),
});

stubModule(SENTRY_PATH, {
  captureError: () => {},
  captureMessage: () => {},
  ensureInit: () => null,
});

const endpoint = require('../api/user.js');

function makeReq({ method = 'POST', body, query } = {}) {
  return {
    method,
    body: body !== undefined ? body : {},
    // `op` é o sub-router do arquivo (mesmo padrão de api/market.js).
    query: Object.assign({ op: 'feedback' }, query || {}),
    headers: { authorization: 'Bearer x' },
    socket: { remoteAddress: '127.0.0.1' },
    on(ev, cb) {
      if (ev === 'end') setImmediate(cb);
    },
  };
}
function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      this.headersSent = true;
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    },
  };
}
async function chamar(opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await endpoint(req, res);
  return { status: res.statusCode, body: res.body };
}

function limpar() {
  store.docs = [];
  store.addFalha = null;
  rlPermite = true;
  usuario = { uid: 'u1', email: 'a@b.c', email_verified: true };
}

const valido = { aba: 'controle', tipo: 'bug', texto: 'Uma sugestão com mais de dez caracteres.' };

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

test('POST grava a sugestão e devolve o id', async () => {
  limpar();
  const r = await chamar({ body: valido });
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
  assert.equal(store.docs.length, 1);
  const d = store.docs[0].data;
  assert.equal(d.texto, valido.texto);
  assert.equal(d.tipo, 'bug');
  assert.equal(d.aba, 'controle');
});

test('o uid vem do TOKEN, nunca do corpo', async () => {
  // Era a garantia da regra: request.resource.data.uid == request.auth.uid.
  limpar();
  await chamar({ body: Object.assign({ uid: 'invasor' }, valido) });
  // `strict()` no schema recusa o campo a mais — mas mesmo que passasse, o
  // documento é montado a partir do token.
  assert.equal(store.docs.length, 0, 'campo desconhecido no corpo é recusado');

  await chamar({ body: valido });
  assert.equal(store.docs[0].data.uid, 'u1');
  assert.equal(store.docs[0].data.email, 'a@b.c');
});

test('status e reply são do servidor — o cliente não os define', async () => {
  limpar();
  await chamar({ body: valido });
  assert.equal(store.docs[0].data.status, 'aberto');
  assert.equal(store.docs[0].data.reply, null);
  assert.equal(store.docs[0].data.createdAt, 'SERVER_TS', 'a data é a do servidor');
});

test('texto curto demais é recusado com o motivo', async () => {
  limpar();
  const r = await chamar({ body: { aba: 'controle', tipo: 'bug', texto: 'curto' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_body');
  assert.ok(r.body.issues.some((i) => i.path === 'texto'));
  assert.equal(store.docs.length, 0);
});

test('texto acima de 1000 caracteres é recusado', async () => {
  limpar();
  const r = await chamar({ body: { aba: 'controle', tipo: 'bug', texto: 'x'.repeat(1001) } });
  assert.equal(r.status, 400);
  assert.equal(store.docs.length, 0);
});

test('aba obrigatória', async () => {
  limpar();
  const r = await chamar({ body: { aba: '', tipo: 'bug', texto: 'texto suficientemente longo' } });
  assert.equal(r.status, 400);
});

test('tipo desconhecido é recusado — o vocabulário é fechado', async () => {
  limpar();
  const r = await chamar({
    body: { aba: 'controle', tipo: 'sei-la', texto: 'texto bem longo aqui' },
  });
  assert.equal(r.status, 400);
});

test('outroTema só é guardado quando a aba é "outro"', async () => {
  limpar();
  await chamar({
    body: { aba: 'controle', tipo: 'melhoria', texto: 'texto bem longo aqui', outroTema: 'xis' },
  });
  assert.equal(store.docs[0].data.outroTema, '', 'tema solto em outra aba vira ruído no admin');

  limpar();
  await chamar({
    body: { aba: 'outro', tipo: 'melhoria', texto: 'texto bem longo aqui', outroTema: 'cripto' },
  });
  assert.equal(store.docs[0].data.outroTema, 'cripto');
});

test('sem sessão o endpoint devolve 401 e não grava', async () => {
  limpar();
  usuario = null;
  const r = await chamar({ body: valido });
  assert.equal(r.status, 401);
  assert.equal(store.docs.length, 0);
});

test('rate limit devolve 429 em vez de gravar', async () => {
  limpar();
  rlPermite = false;
  const r = await chamar({ body: valido });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate_limited');
  assert.equal(store.docs.length, 0);
});

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

test('GET devolve só as sugestões do próprio usuário', async () => {
  limpar();
  await chamar({ body: valido });
  store.docs.push({
    id: 'outro',
    data: { uid: 'u2', texto: 'de outra pessoa', aba: 'controle', createdAt: null },
  });

  const r = await chamar({ method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(ultimoWhere.campo, 'uid');
  assert.equal(ultimoWhere.valor, 'u1', 'o filtro é o uid do token');
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.items[0].texto, valido.texto);
});

test('GET não vaza uid nem e-mail de volta — o dono já sabe quem é', async () => {
  limpar();
  await chamar({ body: valido });
  const r = await chamar({ method: 'GET' });
  assert.ok(!('uid' in r.body.items[0]));
  assert.ok(!('email' in r.body.items[0]));
});

test('GET ordena da mais recente para a mais antiga', async () => {
  limpar();
  const comData = (id, ms) => ({
    id,
    data: { uid: 'u1', texto: id, aba: 'controle', createdAt: { toMillis: () => ms } },
  });
  store.docs.push(comData('antiga', 1000), comData('nova', 3000), comData('meio', 2000));
  const r = await chamar({ method: 'GET' });
  assert.deepEqual(
    r.body.items.map((i) => i.texto),
    ['nova', 'meio', 'antiga']
  );
});

test('GET com corpo vazio não cai em validação de corpo', async () => {
  // O wrapper valida bodySchema em TODO request; por isso a validação do POST
  // é feita dentro do handler. Sem isso, um GET morreria em 400.
  limpar();
  const r = await chamar({ method: 'GET' });
  assert.equal(r.status, 200);
});

test('GET sem sessão devolve 401', async () => {
  limpar();
  usuario = null;
  const r = await chamar({ method: 'GET' });
  assert.equal(r.status, 401);
});

test('método não suportado devolve 405', async () => {
  limpar();
  const r = await chamar({ method: 'DELETE' });
  assert.equal(r.status, 405);
});

test('falha do Firestore vira 500, não um 201 mentiroso', async () => {
  limpar();
  store.addFalha = new Error('firestore fora do ar');
  const r = await chamar({ body: valido });
  assert.equal(r.status, 500);
});

// ---------------------------------------------------------------------------
// O sub-router
// ---------------------------------------------------------------------------

test('op desconhecido devolve 400 em vez de cair em alguma rota por acaso', async () => {
  limpar();
  const r = await chamar({ method: 'GET', query: { op: 'nao-existe' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown_op');
});

test('sem op nenhum também é 400', async () => {
  limpar();
  const r = await chamar({ method: 'GET', query: { op: '' } });
  assert.equal(r.status, 400);
});

test('resend-verification continua respondendo — só mudou de arquivo', async () => {
  // A rota veio de api/auth/resend-verification.js: o Vercel Hobby permite 12
  // functions e o projeto já estava nas 12, então feedback e reenvio dividem
  // este arquivo. O caminho antigo segue vivo por rewrite em vercel.json.
  limpar();
  usuario = { uid: 'u1', email: 'a@b.c', email_verified: false };
  const r = await chamar({ method: 'POST', query: { op: 'resend-verification' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('resend-verification para quem já verificou não gera link novo', async () => {
  limpar();
  const r = await chamar({ method: 'POST', query: { op: 'resend-verification' } });
  assert.equal(r.body.alreadyVerified, true);
});

test('resend-verification só aceita POST', async () => {
  limpar();
  const r = await chamar({ method: 'GET', query: { op: 'resend-verification' } });
  assert.equal(r.status, 405);
});

test('feedback exige e-mail verificado quando o enforce está ligado', async () => {
  limpar();
  usuario = { uid: 'u1', email: 'a@b.c', email_verified: false };
  const antes = process.env.EMAIL_VERIFY_ENFORCE;
  process.env.EMAIL_VERIFY_ENFORCE = 'true';
  try {
    const r = await chamar({ body: valido });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'email_not_verified');
    assert.equal(store.docs.length, 0);
  } finally {
    if (antes === undefined) delete process.env.EMAIL_VERIFY_ENFORCE;
    else process.env.EMAIL_VERIFY_ENFORCE = antes;
  }
});

// ---------------------------------------------------------------------------
// O teto do Vercel
// ---------------------------------------------------------------------------

test('o projeto cabe nas 12 Serverless Functions do plano Hobby', () => {
  // Passar de 12 não degrada nada: o deploy INTEIRO falha. Já aconteceu uma vez
  // (commit 2cf4021, que consolidou os endpoints de market) e ia acontecer de
  // novo com um arquivo separado só para o feedback — por isso ele divide o
  // api/user.js com o reenvio de verificação. Quando precisar de rota nova,
  // some um `?op=` a um arquivo existente em vez de criar o 13º.
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.resolve(__dirname, '..', 'api');
  const funcoes = [];
  (function varrer(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) {
        if (nome !== '_lib') varrer(p);
      } else if (nome.endsWith('.js')) {
        funcoes.push(path.relative(raiz, p));
      }
    }
  })(raiz);
  assert.ok(
    funcoes.length <= 12,
    `${funcoes.length} functions — o teto é 12: ${funcoes.sort().join(', ')}`
  );
});

test('o caminho antigo do reenvio continua roteado', () => {
  // Uma aba já aberta com o bundle antigo ainda bate em
  // /api/auth/resend-verification. O arquivo saiu; o rewrite responde por ele.
  const fs = require('node:fs');
  const path = require('node:path');
  const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'vercel.json'), 'utf8'));
  const rw = (vercel.rewrites || []).find((r) => r.source === '/api/auth/resend-verification');
  assert.ok(rw, 'falta o rewrite do caminho antigo');
  assert.equal(rw.destination, '/api/user?op=resend-verification');
});
