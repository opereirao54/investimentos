'use strict';

// In-memory mock of firebase-admin + asaas for billing handler tests.
// Usage:
//   const M = require('./lib/mock-billing');
//   const H = M.setup();          // injects mocks + loads handlers
//   await M.call(H.init, {...});

// ---------- Sentinels & helpers ----------
const SERVER_TS = Symbol('SERVER_TS');
const DELETE = Symbol('DELETE');
function increment(n) { return { __increment: n }; }
function isIncrement(v) { return v && typeof v === 'object' && '__increment' in v; }
function isTimestamp(v) { return v && typeof v === 'object' && typeof v.toMillis === 'function' && typeof v.toDate === 'function'; }

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
  if (Array.isArray(value)) return value.map(v => resolveValue(v, undefined));
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
    if (inc === DELETE) { delete out[k]; continue; }
    if (isIncrement(inc)) {
      const cur = typeof out[k] === 'number' ? out[k] : 0;
      out[k] = cur + inc.__increment;
      continue;
    }
    if (inc === SERVER_TS) { out[k] = makeTimestamp(store.now); continue; }
    if (isTimestamp(inc)) { out[k] = inc; continue; }
    if (inc && typeof inc === 'object' && !Array.isArray(inc)) {
      out[k] = mergeData(out[k] || {}, inc);
    } else {
      out[k] = inc;
    }
  }
  return out;
}

class DocRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  get parent() { return new CollRef(this.path.substring(0, this.path.lastIndexOf('/'))); }
  collection(name) { return new CollRef(this.path + '/' + name); }
  async get() {
    const data = store.docs.get(this.path);
    return { exists: data !== undefined, id: this.id, ref: this, data: () => data ? deepClone(data) : undefined };
  }
  async set(data, options) {
    const existing = store.docs.get(this.path);
    const next = (options && options.merge && existing) ? mergeData(existing, data) : resolveValue(data, existing || {});
    store.docs.set(this.path, next);
  }
  async update(data) { return this.set(data, { merge: true }); }
  async delete() { store.docs.delete(this.path); }
}

class CollRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  get parent() {
    if (!this.path.includes('/')) return null;
    return new DocRef(this.path.substring(0, this.path.lastIndexOf('/')));
  }
  doc(id) { return new DocRef(this.path + '/' + (id || 'auto_' + Math.random().toString(36).slice(2, 10))); }
  where(field, op, value) { return new Query(this.path, false, [{ field, op, value }]); }
  orderBy(field, dir) { return new Query(this.path, false, [], { field, dir: dir || 'asc' }); }
  limit(n) { return new Query(this.path, false, [], null, n); }
  async get() { return new Query(this.path, false).get(); }
}

class Query {
  constructor(basePath, isGroup, filters, order, limitN) {
    this.basePath = basePath; this.isGroup = !!isGroup;
    this.filters = filters || []; this.order = order || null; this.limitN = limitN || null;
  }
  where(f, op, v) { return new Query(this.basePath, this.isGroup, [...this.filters, { field: f, op, value: v }], this.order, this.limitN); }
  orderBy(f, d) { return new Query(this.basePath, this.isGroup, this.filters, { field: f, dir: d || 'asc' }, this.limitN); }
  limit(n) { return new Query(this.basePath, this.isGroup, this.filters, this.order, n); }
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
        if (f.op === '==' && val !== f.value) { ok = false; break; }
        if (f.op === '!=' && val === f.value) { ok = false; break; }
      }
      if (!ok) continue;
      const ref = new DocRef(p);
      out.push({ id: ref.id, ref, exists: true, data: () => deepClone(data) });
    }
    if (this.order) {
      out.sort((a, b) => {
        let av = a.data()[this.order.field]; let bv = b.data()[this.order.field];
        if (isTimestamp(av)) av = av.toMillis();
        if (isTimestamp(bv)) bv = bv.toMillis();
        if (av === bv) return 0;
        return this.order.dir === 'desc' ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1);
      });
    }
    if (this.limitN) out = out.slice(0, this.limitN);
    return { empty: out.length === 0, size: out.length, docs: out };
  }
}

class Batch {
  constructor() { this.ops = []; }
  set(ref, data, options) { this.ops.push({ ref, data, options }); return this; }
  async commit() { for (const o of this.ops) await o.ref.set(o.data, o.options); }
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
      return { uid, email };
    },
  }),
};

// ---------- Mock asaas ----------
const asaasState = { customers: new Map(), subscriptions: new Map(), payments: new Map(), seq: 1 };

const mockAsaas = {
  PLAN_VALUE: 15.0,
  call: async () => { throw new Error('asaas.call not implemented in mock'); },
  createCustomer: async ({ name, email, uid }) => {
    const id = 'cus_' + (asaasState.seq++);
    asaasState.customers.set(id, { id, name, email, externalReference: uid });
    return { id, name, email };
  },
  updateCustomer: async (id, fields) => {
    const c = asaasState.customers.get(id) || {};
    asaasState.customers.set(id, { ...c, ...fields, id });
    return asaasState.customers.get(id);
  },
  createSubscription: async ({ customerId, value, nextDueDate, billingType, creditCard }) => {
    const id = 'sub_' + (asaasState.seq++);
    const sub = { id, customer: customerId, value, nextDueDate, status: 'ACTIVE', billingType: billingType || 'UNDEFINED' };
    if (creditCard) sub.creditCard = { creditCardNumber: '************' + String(creditCard.number).slice(-4), creditCardBrand: 'VISA', creditCardToken: 'tok_' + (asaasState.seq++) };
    asaasState.subscriptions.set(id, sub);
    const pid = 'pay_' + (asaasState.seq++);
    asaasState.payments.set(pid, { id: pid, subscription: id, customer: customerId, value, status: 'PENDING', dueDate: nextDueDate, billingType: sub.billingType, invoiceUrl: 'https://sandbox.asaas/' + pid });
    return sub;
  },
  updateSubscription: async () => ({}),
  updateSubscriptionCard: async () => ({}),
  cancelSubscription: async (id) => { const s = asaasState.subscriptions.get(id); if (s) s.status = 'INACTIVE'; return { id, deleted: true }; },
  getSubscription: async (id) => asaasState.subscriptions.get(id),
  updatePayment: async (id, fields) => { const p = asaasState.payments.get(id); if (p) Object.assign(p, fields); return p; },
  listPaymentsBySubscription: async (subId) => ({ data: Array.from(asaasState.payments.values()).filter(p => p.subscription === subId) }),
  getPaymentLink: async (id) => asaasState.payments.get(id),
};

// ---------- Setup + handler loading ----------
function setup(opts = {}) {
  const path = require('path');
  const ROOT = opts.root || path.resolve(__dirname, '..', '..');
  require.cache[require.resolve(path.join(ROOT, 'api/_lib/firebase-admin'))] = { exports: mockFirebaseAdmin };
  require.cache[require.resolve(path.join(ROOT, 'api/_lib/asaas'))] = { exports: mockAsaas };
  process.env.ASAAS_WEBHOOK_TOKEN = opts.webhookToken || 'test_webhook_token';
  return {
    init: require(path.join(ROOT, 'api/billing/init')),
    subscribe: require(path.join(ROOT, 'api/billing/subscribe')),
    webhook: require(path.join(ROOT, 'api/billing/webhook')),
    me: require(path.join(ROOT, 'api/billing/me')),
    status: require(path.join(ROOT, 'api/billing/status')),
    cancel: require(path.join(ROOT, 'api/billing/cancel')),
    customer: require(path.join(ROOT, 'api/billing/customer')),
    computeAccess: require(path.join(ROOT, 'api/_lib/access')).computeAccess,
  };
}

// ---------- Fake req/res ----------
function makeReq({ method = 'POST', body, headers = {} }) {
  return { method, body, headers, socket: { remoteAddress: '127.0.0.1' }, on() {} };
}
function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    end() { return this; },
  };
}
async function call(handler, opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

module.exports = {
  setup, call, makeReq, makeRes,
  store, asaasState,
  SERVER_TS, DELETE, makeTimestamp,
};
