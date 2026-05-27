'use strict';

// Testes do api/_lib/handler.js. Substituímos auth e sentry via Module._cache
// para isolar do firebase-admin real. Cuidado: o stub precisa ter shape de
// Module completo (id/exports/loaded), senão require interno re-tenta carregar.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const AUTH_PATH = require.resolve('../api/_lib/auth');
const SENTRY_PATH = require.resolve('../api/_lib/sentry');

function stubModule(id, exports) {
  const m = new Module(id);
  m.exports = exports;
  m.loaded = true;
  m.filename = id;
  Module._cache[id] = m;
}

stubModule(AUTH_PATH, {
  cors: (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return true;
    }
    return false;
  },
  requireUser: async (req, res) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer fake:')) {
      res.status(401).json({ error: 'missing_token' });
      return null;
    }
    const [, uid, email] = h.replace('Bearer ', '').split(':');
    return { uid, email, email_verified: true };
  },
  requireVerifiedUser: async (req, res) => {
    const auth = Module._cache[AUTH_PATH].exports;
    return auth.requireUser(req, res);
  },
  requireFreshVerifiedUser: async (req, res) => {
    const auth = Module._cache[AUTH_PATH].exports;
    return auth.requireUser(req, res);
  },
});

stubModule(SENTRY_PATH, {
  captureError: () => {},
  captureMessage: () => {},
  ensureInit: () => null,
});

const { handler } = require('../api/_lib/handler');
const { z } = require('zod');

function makeReq({ method = 'POST', body, headers = {}, query } = {}) {
  // Stream stub: 'end' dispara no próximo tick para readBody resolver.
  // Sem isto o handler trava em await readBody(req) quando body=undefined.
  const listeners = {};
  return {
    method,
    body: body !== undefined ? body : {},
    query,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    on(ev, cb) {
      listeners[ev] = cb;
      if (ev === 'end') setImmediate(cb);
    },
  };
}
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
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
  return res;
}
async function invoke(h, opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await h(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

test('handler: method != allowed -> 405', async () => {
  const h = handler({ method: 'POST', handle: () => {} });
  const r = await invoke(h, { method: 'GET' });
  assert.equal(r.status, 405);
  assert.equal(r.body.error, 'method_not_allowed');
});

test('handler: CORS preflight OPTIONS -> 204', async () => {
  let called = false;
  const h = handler({ method: 'POST', handle: () => (called = true) });
  const r = await invoke(h, { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(called, false);
});

test('handler: auth user sem token -> 401', async () => {
  const h = handler({ auth: 'user', handle: () => {} });
  const r = await invoke(h, { headers: {} });
  assert.equal(r.status, 401);
});

test('handler: auth user com token -> handler recebe user', async () => {
  let received = null;
  const h = handler({
    auth: 'user',
    handle: async ({ user, res }) => {
      received = user;
      res.json({ ok: true });
    },
  });
  const r = await invoke(h, { headers: { authorization: 'Bearer fake:uid_a:a@b.com' } });
  assert.equal(r.status, 200);
  assert.equal(received.uid, 'uid_a');
});

test('handler: bodySchema inválido -> 400 com issues', async () => {
  const h = handler({
    bodySchema: z.object({ name: z.string().min(3) }),
    handle: () => {},
  });
  const r = await invoke(h, { body: { name: 'a' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_body');
  assert.ok(Array.isArray(r.body.issues));
  assert.equal(r.body.issues[0].path, 'name');
});

test('handler: bodySchema válido normaliza data', async () => {
  let received = null;
  const h = handler({
    bodySchema: z.object({ name: z.string().trim().min(3) }),
    handle: async ({ body, res }) => {
      received = body;
      res.json({ ok: true });
    },
  });
  const r = await invoke(h, { body: { name: '  Anna  ' } });
  assert.equal(r.status, 200);
  assert.equal(received.name, 'Anna');
});

test('handler: querySchema valida + normaliza query', async () => {
  let received = null;
  const h = handler({
    querySchema: z.object({ tickers: z.string().min(1) }),
    handle: async ({ query, res }) => {
      received = query;
      res.json({ ok: true });
    },
  });
  const r = await invoke(h, { body: {}, query: { tickers: 'PETR4,VALE3' } });
  assert.equal(r.status, 200);
  assert.equal(received.tickers, 'PETR4,VALE3');
});

test('handler: exceção no handle -> 500 padronizado', async () => {
  const h = handler({
    handle: async () => {
      throw new Error('boom');
    },
  });
  const r = await invoke(h, { body: {} });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'internal_error');
});

test('handler: handle pode res.json normalmente', async () => {
  const h = handler({
    handle: async ({ res }) => res.json({ hello: 'world' }),
  });
  const r = await invoke(h, { body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { hello: 'world' });
});

test('handler: auth inválido throws na construção', () => {
  assert.throws(() => handler({ auth: 'banana', handle: () => {} }), /auth inválido/);
});

test('handler: handle obrigatório', () => {
  assert.throws(() => handler({}), /handle.*obrigatório/);
});
