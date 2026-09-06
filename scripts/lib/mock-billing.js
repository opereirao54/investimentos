'use strict';

// In-memory mock of firebase-admin + asaas for billing handler tests.
// Usage:
//   const M = require('./lib/mock-billing');
//   const H = M.setup();          // injects mocks + loads handlers
//   await M.call(H.init, {...});

// ---------- Sentinels & helpers ----------
const SERVER_TS = Symbol('SERVER_TS');
const DELETE = Symbol('DELETE');
function increment(n) {
  return { __increment: n };
}
function isIncrement(v) {
  return v && typeof v === 'object' && '__increment' in v;
}
function isTimestamp(v) {
  return (
    v && typeof v === 'object' && typeof v.toMillis === 'function' && typeof v.toDate === 'function'
  );
}

function makeTimestamp(ms) {
  return {
    toMillis: () => ms,
    toDate: () => new Date(ms),
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
    isEqual: (o) => o && typeof o.toMillis === 'function' && o.toMillis() === ms,
  };
}

function deepClone(v) {
  if (v == null) return v;
  if (isTimestamp(v)) return v;
  if (Array.isArray(v)) return v.map(deepClone);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = deepClone(v[k]);
    return o;
  }
  return v;
}

// ---------- In-memory store ----------
const store = { docs: new Map(), now: Date.now() };

function resolveValue(value, existing) {
  if (value === SERVER_TS) return makeTimestamp(store.now);
  if (value === DELETE) return undefined;
  if (isIncrement(value)) {
    const cur = typeof existing === 'number' ? existing : 0;
    return cur + value.__increment;
  }
  if (isTimestamp(value)) return value;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, undefined));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      const r = resolveValue(value[k], existing ? existing[k] : undefined);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

function mergeData(existing, incoming) {
  const out = existing ? { ...existing } : {};
  for (const k of Object.keys(incoming)) {
    const inc = incoming[k];
    if (inc === DELETE) {
      delete out[k];
      continue;
    }
    if (isIncrement(inc)) {
      const cur = typeof out[k] === 'number' ? out[k] : 0;
      out[k] = cur + inc.__increment;
      continue;
    }
    if (inc === SERVER_TS) {
      out[k] = makeTimestamp(store.now);
      continue;
    }
    if (isTimestamp(inc)) {
      out[k] = inc;
      continue;
    }
    if (inc && typeof inc === 'object' && !Array.isArray(inc)) {
      out[k] = mergeData(out[k] || {}, inc);
    } else {
      out[k] = inc;
    }
  }
  return out;
}

class DocRef {
  constructor(path) {
    this.path = path;
    this.id = path.split('/').pop();
  }
  get parent() {
    return new CollRef(this.path.substring(0, this.path.lastIndexOf('/')));
  }
  collection(name) {
    return new CollRef(this.path + '/' + name);
  }
  async get() {
    const data = store.docs.get(this.path);
    return {
      exists: data !== undefined,
      id: this.id,
      ref: this,
      data: () => (data ? deepClone(data) : undefined),
    };
  }
  async set(data, options) {
    const existing = store.docs.get(this.path);
    const next =
      options && options.merge && existing
        ? mergeData(existing, data)
        : resolveValue(data, existing || {});
    store.docs.set(this.path, next);
  }
  async update(data) {
    // O Firestore real RECUSA update em documento inexistente (NOT_FOUND);
    // só `set` cria. Tratar os dois como iguais apagava uma diferença de
    // segurança: `api/user.js` usa `update` no contador de cliques justamente
    // para que um endpoint público não consiga criar reservas de cupom.
    if (!store.docs.has(this.path)) {
      const err = new Error('NOT_FOUND: no document to update: ' + this.path);
      err.code = 5;
      throw err;
    }
    return this.set(data, { merge: true });
  }
  async delete() {
    store.docs.delete(this.path);
  }
}

class CollRef {
  constructor(path) {
    this.path = path;
    this.id = path.split('/').pop();
  }
  get parent() {
    if (!this.path.includes('/')) return null;
    return new DocRef(this.path.substring(0, this.path.lastIndexOf('/')));
  }
  doc(id) {
    return new DocRef(this.path + '/' + (id || 'auto_' + Math.random().toString(36).slice(2, 10)));
  }
  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
  where(field, op, value) {
    return new Query(this.path, false, [{ field, op, value }]);
  }
  orderBy(field, dir) {
    return new Query(this.path, false, [], { field, dir: dir || 'asc' });
  }
  limit(n) {
    return new Query(this.path, false, [], null, n);
  }
  async get() {
    return new Query(this.path, false).get();
  }
}

class Query {
  constructor(basePath, isGroup, filters, order, limitN) {
    this.basePath = basePath;
    this.isGroup = !!isGroup;
    this.filters = filters || [];
    this.order = order || null;
    this.limitN = limitN || null;
  }
  where(f, op, v) {
    return new Query(
      this.basePath,
      this.isGroup,
      [...this.filters, { field: f, op, value: v }],
      this.order,
      this.limitN
    );
  }
  orderBy(f, d) {
    return new Query(
      this.basePath,
      this.isGroup,
      this.filters,
      { field: f, dir: d || 'asc' },
      this.limitN
    );
  }
  limit(n) {
    return new Query(this.basePath, this.isGroup, this.filters, this.order, n);
  }
  async get() {
    let out = [];
    for (const [p, data] of store.docs) {
      const parts = p.split('/');
      if (this.isGroup) {
        if (parts.length < 2) continue;
        if (parts[parts.length - 2] !== this.basePath) continue;
      } else {
        const prefix = this.basePath + '/';
        if (!p.startsWith(prefix)) continue;
        if (p.substring(prefix.length).includes('/')) continue;
      }
      let ok = true;
      for (const f of this.filters) {
        const val = data[f.field];
        if (f.op === '==' && val !== f.value) {
          ok = false;
          break;
        }
        if (f.op === '!=' && val === f.value) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const ref = new DocRef(p);
      out.push({ id: ref.id, ref, exists: true, data: () => deepClone(data) });
    }
    if (this.order) {
      out.sort((a, b) => {
        let av = a.data()[this.order.field];
        let bv = b.data()[this.order.field];
        if (isTimestamp(av)) av = av.toMillis();
        if (isTimestamp(bv)) bv = bv.toMillis();
        if (av === bv) return 0;
        return this.order.dir === 'desc' ? (av < bv ? 1 : -1) : av < bv ? -1 : 1;
      });
    }
    if (this.limitN) out = out.slice(0, this.limitN);
    return { empty: out.length === 0, size: out.length, docs: out };
  }
}

class Batch {
  constructor() {
    this.ops = [];
  }
  set(ref, data, options) {
    this.ops.push({ op: 'set', ref, data, options });
    return this;
  }
  // `delete` faltava. O rollback de reserva de crédito (releaseReservation,
  // em api/_lib/credits.js) apaga as sobras criadas pela partição — sem este
  // método o caminho de compensação estourava TypeError, e nenhum teste
  // chegava lá porque só roda quando o Asaas recusa a cobrança.
  delete(ref) {
    this.ops.push({ op: 'delete', ref });
    return this;
  }
  update(ref, data) {
    this.ops.push({ op: 'update', ref, data });
    return this;
  }
  async commit() {
    for (const o of this.ops) {
      if (o.op === 'delete') await o.ref.delete();
      else if (o.op === 'update') await o.ref.update(o.data);
      else await o.ref.set(o.data, o.options);
    }
  }
}

const firestore = {
  collection: (n) => new CollRef(n),
  collectionGroup: (n) => new Query(n, true),
  batch: () => new Batch(),
  runTransaction: async (cb) => {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, options) => ref.set(data, options),
      update: (ref, data) => ref.update(data),
      delete: (ref) => ref.delete(),
    };
    return cb(tx);
  },
};

const mockFirebaseAdmin = {
  db: () => firestore,
  fieldValue: () => ({
    serverTimestamp: () => SERVER_TS,
    increment: (n) => increment(n),
    delete: () => DELETE,
  }),
  timestamp: () => ({ fromMillis: (ms) => makeTimestamp(ms) }),
  auth: () => ({
    verifyIdToken: async (token) => {
      const [, uid, email] = token.split(':');
      if (!uid) throw new Error('bad token');
      // email_verified=true por padrão — espelha o que provedores OAuth
      // confiáveis (google.com) entregam e o que /init exige explicitamente.
      // Testes que precisam simular conta não verificada passam um token
      // com prefixo 'unverified:' no lugar de 'fake:'.
      const emailVerified = !token.startsWith('unverified:');
      return { uid, email, email_verified: emailVerified };
    },
    // Espelha o contrato de firebase-admin.auth().getUser(uid):
    // - retorna { uid, disabled } para uids "vivos"
    // - lança { code: 'auth/user-not-found' } para uids deletados
    // O conjunto de uids "deletados" é controlado por asaasState.deletedUids
    // (vazio por padrão — o test harness pode adicionar uids para simular
    // o caso de signup rejeitado/conta deletada).
    getUser: async (uid) => {
      if (!uid) {
        const err = new Error('uid required');
        err.code = 'auth/invalid-uid';
        throw err;
      }
      if (asaasState.deletedUids && asaasState.deletedUids.has(uid)) {
        const err = new Error('user not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      return { uid, disabled: false, emailVerified: true };
    },
  }),
};

// ---------- Mock asaas ----------

const PAID_ASAAS_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

// Avança N meses num 'YYYY-MM-DD' — é assim que o Asaas escalona as faturas
// projetadas de uma assinatura MONTHLY.
function addMonthsToYmd(ymd, months) {
  if (!months) return ymd;
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const d = new Date(
    Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1 + months, parseInt(m[3], 10))
  );
  return d.toISOString().slice(0, 10);
}
const asaasState = {
  customers: new Map(),
  subscriptions: new Map(),
  payments: new Map(),
  deletedUids: new Set(),
  seq: 1,

  // --- Fidelidade ao Asaas real (opt-in) ---------------------------------
  // O mock nasceu otimista: uma assinatura gerava UMA fatura e updatePayment
  // aceitava qualquer coisa. O Asaas de verdade não se comporta assim, e a
  // diferença esconde defeitos inteiros (crédito Applicash que nunca chega à
  // fatura, valor alterado depois do cartão já ter capturado). Os knobs abaixo
  // ligam o comportamento real; ficam desligados por omissão para não mudar o
  // significado dos testes escritos contra o mock antigo.

  // Quantas faturas FUTURAS o Asaas projeta ao criar a assinatura, além da
  // primeira. No Asaas real são 6-12 (ver api/billing/me.js, que as filtra do
  // histórico). Com 0, o mock mantém o comportamento antigo de fatura única.
  projectFutureInvoices: 0,

  // Cartão captura na hora: o payment nasce CONFIRMED em vez de PENDING.
  cardCapturesImmediately: false,

  // updatePayment recusa alterar o valor de uma cobrança já paga e recusa
  // valor abaixo do piso do gateway — como o Asaas faz.
  strictUpdatePayment: false,
  minPaymentValue: 5,
};

const mockAsaas = {
  PLAN_VALUE: 15.0,
  call: async () => {
    throw new Error('asaas.call not implemented in mock');
  },
  createCustomer: async ({ name, email, uid }) => {
    const id = 'cus_' + asaasState.seq++;
    asaasState.customers.set(id, { id, name, email, externalReference: uid });
    return { id, name, email };
  },
  updateCustomer: async (id, fields) => {
    const c = asaasState.customers.get(id) || {};
    asaasState.customers.set(id, { ...c, ...fields, id });
    return asaasState.customers.get(id);
  },
  createSubscription: async ({ customerId, value, nextDueDate, billingType, creditCard }) => {
    const id = 'sub_' + asaasState.seq++;
    const sub = {
      id,
      customer: customerId,
      value,
      nextDueDate,
      status: 'ACTIVE',
      billingType: billingType || 'UNDEFINED',
    };
    if (creditCard)
      sub.creditCard = {
        creditCardNumber: '************' + String(creditCard.number).slice(-4),
        creditCardBrand: 'VISA',
        creditCardToken: 'tok_' + asaasState.seq++,
      };
    asaasState.subscriptions.set(id, sub);
    const paidOnCreate = !!creditCard && asaasState.cardCapturesImmediately;
    const total = 1 + Math.max(0, asaasState.projectFutureInvoices | 0);
    for (let i = 0; i < total; i++) {
      const pid = 'pay_' + asaasState.seq++;
      asaasState.payments.set(pid, {
        id: pid,
        subscription: id,
        customer: customerId,
        value,
        // Só a primeira pode nascer capturada; as projetadas ficam PENDING.
        status: i === 0 && paidOnCreate ? 'CONFIRMED' : 'PENDING',
        dueDate: addMonthsToYmd(nextDueDate, i),
        billingType: sub.billingType,
        invoiceUrl: 'https://sandbox.asaas/' + pid,
      });
    }
    return sub;
  },
  createPayment: async ({
    customerId,
    value,
    billingType,
    dueDate,
    description,
    externalReference,
    creditCard,
  }) => {
    const id = 'pay_' + asaasState.seq++;
    const pay = {
      id,
      customer: customerId,
      value,
      // Sem `subscription`: é exatamente assim que o webhook distingue o
      // avulso (`const isOneShot = !payment.subscription`).
      status: creditCard && asaasState.cardCapturesImmediately ? 'CONFIRMED' : 'PENDING',
      dueDate,
      description: description || null,
      externalReference: externalReference || null,
      billingType: billingType || 'UNDEFINED',
      invoiceUrl: 'https://sandbox.asaas/' + id,
    };
    if (!creditCard) pay.bankSlipUrl = 'https://sandbox.asaas/boleto/' + id;
    asaasState.payments.set(id, pay);
    return pay;
  },
  updateSubscription: async () => ({}),
  updateSubscriptionCard: async () => ({}),
  cancelSubscription: async (id) => {
    const s = asaasState.subscriptions.get(id);
    if (s) s.status = 'INACTIVE';
    return { id, deleted: true };
  },
  getSubscription: async (id) => asaasState.subscriptions.get(id),
  updatePayment: async (id, fields) => {
    const p = asaasState.payments.get(id);
    if (asaasState.strictUpdatePayment) {
      if (!p) {
        const err = new Error('asaas_error_404');
        err.status = 404;
        err.data = {
          errors: [{ code: 'invalid_payment', description: 'Cobrança não encontrada.' }],
        };
        throw err;
      }
      // Cobrança já liquidada não muda de valor — o dinheiro já saiu do cartão.
      if (PAID_ASAAS_STATUSES.has(p.status)) {
        const err = new Error('asaas_error_400');
        err.status = 400;
        err.data = {
          errors: [
            {
              code: 'invalid_value',
              description: 'Não é possível alterar o valor de uma cobrança já recebida.',
            },
          ],
        };
        throw err;
      }
      if (typeof fields.value === 'number' && fields.value < asaasState.minPaymentValue) {
        const err = new Error('asaas_error_400');
        err.status = 400;
        err.data = {
          errors: [
            {
              code: 'invalid_value',
              description:
                'O valor mínimo da cobrança é R$ ' + asaasState.minPaymentValue.toFixed(2) + '.',
            },
          ],
        };
        throw err;
      }
    }
    if (p) Object.assign(p, fields);
    return p;
  },
  listPaymentsBySubscription: async (subId) => ({
    data: Array.from(asaasState.payments.values()).filter((p) => p.subscription === subId),
  }),
  getPaymentLink: async (id) => asaasState.payments.get(id),
};

// ---------- Setup + handler loading ----------
function setup(opts = {}) {
  const path = require('path');
  const ROOT = opts.root || path.resolve(__dirname, '..', '..');
  require.cache[require.resolve(path.join(ROOT, 'api/_lib/firebase-admin'))] = {
    exports: mockFirebaseAdmin,
  };
  require.cache[require.resolve(path.join(ROOT, 'api/_lib/asaas'))] = { exports: mockAsaas };
  process.env.ASAAS_WEBHOOK_TOKEN = opts.webhookToken || 'test_webhook_token';
  const me = require(path.join(ROOT, 'api/billing/me'));
  return {
    init: require(path.join(ROOT, 'api/billing/init')),
    subscribe: require(path.join(ROOT, 'api/billing/subscribe')),
    webhook: require(path.join(ROOT, 'api/billing/webhook')),
    me,
    // /status foi consolidado em /me (cap de 12 functions do Vercel Hobby).
    // Alias preserva a semântica do harness para os testes legados.
    status: me,
    cancel: require(path.join(ROOT, 'api/billing/cancel')),
    customer: require(path.join(ROOT, 'api/billing/customer')),
    computeAccess: require(path.join(ROOT, 'api/_lib/access')).computeAccess,
  };
}

// ---------- Fake req/res ----------
function makeReq({ method = 'POST', body, headers = {}, query = {} }) {
  // Auto-injeta user-agent único por uid quando o request não traz um.
  // Sem isto, o deviceFingerprint = hash(ip + ua) seria igual para todos
  // os usuários do harness (mesmo IP 127.0.0.1, sem UA) e a guard de
  // referral bloqueia 'same_device' entre indicador e indicado. Em
  // produção isso protege contra self-referral; nos testes precisamos
  // simular dispositivos distintos.
  const h = { ...headers };
  if (!h['user-agent']) {
    const auth = h.authorization || '';
    const m = auth.match(/Bearer\s+(?:fake|unverified):([^:]+):/);
    if (m) h['user-agent'] = 'test-ua/' + m[1];
  }
  // `query` faltava por completo, então nenhuma rota sub-roteada por `?op=`
  // (api/user.js, api/market.js) era testável: `req.query.op` chegava
  // undefined e o roteador caía sempre no ramo desconhecido.
  return {
    method,
    body,
    headers: h,
    query,
    socket: { remoteAddress: '127.0.0.1' },
    on() {},
  };
}
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
    end() {
      return this;
    },
  };
}
async function call(handler, opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

module.exports = {
  setup,
  call,
  makeReq,
  makeRes,
  store,
  asaasState,
  SERVER_TS,
  DELETE,
  makeTimestamp,
};
