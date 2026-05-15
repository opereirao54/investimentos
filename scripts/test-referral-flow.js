'use strict';

// =============================================================================
// Test harness for the Applicash referral flow.
// Mocks firebase-admin (Firestore) and asaas in-memory; runs the actual
// handlers (init.js, subscribe.js, webhook.js) end-to-end.
// =============================================================================

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
  if (isTimestamp(v)) return v; // immutable
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

// ---------- Doc & Collection refs ----------
class DocRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  get parent() { return new CollRef(this.path.substring(0, this.path.lastIndexOf('/'))); }
  collection(name) { return new CollRef(this.path + '/' + name); }
  async get() {
    const data = store.docs.get(this.path);
    return {
      exists: data !== undefined,
      id: this.id,
      ref: this,
      data: () => data ? deepClone(data) : undefined,
    };
  }
  async set(data, options) {
    const existing = store.docs.get(this.path);
    const next = (options && options.merge && existing)
      ? mergeData(existing, data)
      : resolveValue(data, existing || {});
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

// ---------- Mock firebase-admin module ----------
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
      // token format "fake:<uid>:<email>"
      const [, uid, email] = token.split(':');
      if (!uid) throw new Error('bad token');
      return { uid, email };
    },
  }),
};

// ---------- Mock asaas module ----------
const asaasState = {
  customers: new Map(),
  subscriptions: new Map(),
  payments: new Map(),
  seq: 1,
};

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

// ---------- Inject mocks via require.cache ----------
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require.cache[require.resolve(path.join(ROOT, 'api/_lib/firebase-admin'))] = { exports: mockFirebaseAdmin };
require.cache[require.resolve(path.join(ROOT, 'api/_lib/asaas'))] = { exports: mockAsaas };

// ---------- Env required by handlers ----------
process.env.ASAAS_WEBHOOK_TOKEN = 'test_webhook_token';

// ---------- Load handlers AFTER mock injection ----------
const initHandler = require(path.join(ROOT, 'api/billing/init'));
const subscribeHandler = require(path.join(ROOT, 'api/billing/subscribe'));
const webhookHandler = require(path.join(ROOT, 'api/billing/webhook'));
const meHandler = require(path.join(ROOT, 'api/billing/me'));

// ---------- Fake req/res ----------
function makeReq({ method = 'POST', body, headers = {} }) {
  return {
    method, body, headers, socket: { remoteAddress: '127.0.0.1' },
    on() {}, // body parsing path uses readBody but with body object set, it shortcircuits
  };
}
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
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

// ---------- Test runner ----------
let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { console.log('   \x1b[32m✓\x1b[0m ' + msg); pass++; }
  else { console.log('   \x1b[31m✗ ' + msg + '\x1b[0m'); fail++; }
}
function step(n, title) { console.log('\n\x1b[36m== STEP ' + n + ' — ' + title + '\x1b[0m'); }
function log(...a) { console.log('   ', ...a); }

async function main() {
  console.log('\x1b[1mCenário: Alice envia o cupom para o colega (Bob)\x1b[0m');

  // ============ STEP 1: Alice cria conta ============
  step(1, 'Alice cria a conta (sem cupom; é a indicadora)');
  const aliceTok = 'fake:alice_uid:alice@example.com';
  const r1 = await call(initHandler, { headers: { authorization: 'Bearer ' + aliceTok }, body: {} });
  check(r1.status === 200, 'init status 200');
  const aliceB = store.docs.get('users/alice_uid/billing/account');
  log('cupom da Alice =', aliceB.referralCode);
  check(/^APP-[A-Z0-9]{6}$/.test(aliceB.referralCode), 'cupom no formato APP-XXXXXX');
  const aliceCode = aliceB.referralCode;
  check(store.docs.has('referralCodes/' + aliceCode), 'cupom registado em referralCodes/' + aliceCode);
  check(aliceB.customerId && aliceB.customerId.startsWith('cus_'), 'customer Asaas criado');
  check(aliceB.signupIp === '127.0.0.1', 'signupIp registado (M6)');

  // ============ STEP 2: Alice gera o link ============
  step(2, 'Alice copia o link de indicação');
  const link = 'https://app.appliquei.com/?ref=' + encodeURIComponent(aliceCode);
  log('link →', link);

  // ============ STEP 3: Bob clica no link e cria conta com cupom ============
  step(3, 'Bob clica no link, abre o app, cria a conta usando o cupom da Alice');
  log('(no frontend: ?ref capturado da URL -> sessionStorage -> body.referralCode no /init)');
  const bobTok = 'fake:bob_uid:bob@example.com';
  const r3 = await call(initHandler, { headers: { authorization: 'Bearer ' + bobTok }, body: { referralCode: aliceCode } });
  check(r3.status === 200, 'init status 200');
  const bobB = store.docs.get('users/bob_uid/billing/account');
  check(bobB.referredByUserId === 'alice_uid', 'Bob vinculado à Alice');
  check(bobB.referredByCode === aliceCode, 'cupom gravado no billing de Bob');
  check(bobB.recurringDiscountPercent === 10, '10% de desconto recorrente para Bob');
  check(!!bobB.referralUsedAt, 'referralUsedAt timestamp registado');

  // ============ STEP 4: Cupom inválido ============
  step(4, 'Charlie tenta criar conta com cupom inexistente');
  const charlieTok = 'fake:charlie_uid:charlie@example.com';
  const r4 = await call(initHandler, { headers: { authorization: 'Bearer ' + charlieTok }, body: { referralCode: 'APP-NOPE99' } });
  check(r4.status === 400, 'status 400');
  check(r4.body.error === 'referral_code_not_found', 'erro = referral_code_not_found');
  const charlieB = store.docs.get('users/charlie_uid/billing/account');
  check(!charlieB || !charlieB.customerId, 'nenhum customer Asaas criado para Charlie (rollback ok)');
  check(!charlieB || !charlieB.initLock, 'init lock liberado após erro de cupom');

  // ============ STEP 5: Bob assina ============
  step(5, 'Bob completa /subscribe com CPF próprio');
  const r5 = await call(subscribeHandler, { headers: { authorization: 'Bearer ' + bobTok }, body: { cpfCnpj: '12345678901', name: 'Bob Friend' } });
  check(r5.status === 200, 'subscribe ok');
  const bobB2 = store.docs.get('users/bob_uid/billing/account');
  check(!!bobB2.subscriptionId, 'subscription criada no Asaas');
  check(bobB2.subscriptionBaseValueCents === 1350, 'valor recorrente = R$ 13,50 (15 - 10%)');
  log('valueCents Bob =', bobB2.subscriptionBaseValueCents);

  // ============ STEP 6: Pagamento confirmado do Bob ============
  step(6, 'Asaas dispara PAYMENT_CONFIRMED do Bob → gera crédito para Alice');
  const bobPay = Array.from(asaasState.payments.values()).find(p => p.subscription === bobB2.subscriptionId);
  bobPay.status = 'CONFIRMED';
  const r6 = await call(webhookHandler, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { ...bobPay } },
  });
  check(r6.status === 200, 'webhook ok');
  const aliceCredit = store.docs.get('users/alice_uid/billing/account/credits/' + bobPay.id);
  check(!!aliceCredit, 'crédito criado em users/alice_uid/billing/account/credits/' + bobPay.id);
  check(aliceCredit.amountCents === 135, 'crédito = 10% de R$ 13,50 = R$ 1,35');
  check(aliceCredit.fromUid === 'bob_uid', 'crédito vem de Bob');
  check(aliceCredit.appliedAt === null, 'crédito ainda não aplicado (pending)');
  const aliceAfter6 = store.docs.get('users/alice_uid/billing/account');
  check(aliceAfter6.stats && aliceAfter6.stats.totalReferralEarningsCents === 135, 'stats.totalReferralEarningsCents = 135');
  check(aliceAfter6.stats.pendingDiscountCents === 135, 'stats.pendingDiscountCents = 135');

  // ============ STEP 7: webhook duplicado ============
  step(7, 'Asaas retransmite o MESMO evento — idempotência (C2)');
  const r7 = await call(webhookHandler, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { ...bobPay } },
  });
  check(r7.body && r7.body.duplicate === true, 'duplicado marcado como duplicate');
  const aliceAfter7 = store.docs.get('users/alice_uid/billing/account');
  check(aliceAfter7.stats.totalReferralEarningsCents === 135, 'totalReferralEarningsCents permanece 135 (sem duplicar)');
  check(aliceAfter7.stats.pendingDiscountCents === 135, 'pendingDiscountCents permanece 135');

  // ============ STEP 8: Alice assina e ganha desconto no próximo invoice ============
  step(8, 'Alice ativa subscription; webhook PAYMENT_CREATED aplica o crédito acumulado');
  await call(subscribeHandler, { headers: { authorization: 'Bearer ' + aliceTok }, body: { cpfCnpj: '99988877766', name: 'Alice Indicator' } });
  const aliceB3 = store.docs.get('users/alice_uid/billing/account');
  const alicePay = Array.from(asaasState.payments.values()).find(p => p.subscription === aliceB3.subscriptionId);
  log('fatura inicial da Alice =', alicePay.value);
  const r8 = await call(webhookHandler, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_002', event: 'PAYMENT_CREATED', payment: { ...alicePay } },
  });
  check(r8.status === 200, 'webhook ok');
  log('fatura da Alice após aplicar crédito =', alicePay.value);
  check(alicePay.value === 15 - 1.35, 'fatura agora = R$ 13,65');
  const aliceCreditAfter = store.docs.get('users/alice_uid/billing/account/credits/' + bobPay.id);
  check(!!aliceCreditAfter.appliedAt, 'crédito marcado como aplicado');
  check(aliceCreditAfter.appliedToPaymentId === alicePay.id, 'crédito apontado para a fatura da Alice');

  // ============ STEP 9: same-CPF self-referral block ============
  step(9, 'Atacante (Dave) tenta auto-indicação: 2ª conta com MESMO CPF da 1ª');
  const dave1Tok = 'fake:dave1_uid:dave1@example.com';
  await call(initHandler, { headers: { authorization: 'Bearer ' + dave1Tok }, body: {} });
  const dave1Code = store.docs.get('users/dave1_uid/billing/account').referralCode;
  await call(subscribeHandler, { headers: { authorization: 'Bearer ' + dave1Tok }, body: { cpfCnpj: '55544433322', name: 'Dave One' } });
  log('Dave1 cupom =', dave1Code, '(CPF 555.444.333-22)');

  const dave2Tok = 'fake:dave2_uid:dave2@example.com';
  await call(initHandler, { headers: { authorization: 'Bearer ' + dave2Tok }, body: { referralCode: dave1Code } });
  const dave2Sub = await call(subscribeHandler, { headers: { authorization: 'Bearer ' + dave2Tok }, body: { cpfCnpj: '55544433322', name: 'Dave Two' } });
  check(dave2Sub.status === 409 && dave2Sub.body && dave2Sub.body.error === 'cpfcnpj_in_use',
        'subscribe da 2ª conta recusado (cpfcnpj_in_use)');
  log('resposta =', dave2Sub.status, JSON.stringify(dave2Sub.body));

  // ============ STEP 10: Refund do Bob estorna crédito da Alice ============
  step(10, 'PAYMENT_REFUNDED do Bob — crédito da Alice deve ser estornado');
  const r10 = await call(webhookHandler, {
    headers: { 'asaas-access-token': 'test_webhook_token' },
    body: { id: 'evt_003', event: 'PAYMENT_REFUNDED', payment: { ...bobPay, status: 'REFUNDED' } },
  });
  check(r10.status === 200, 'webhook ok');
  const aliceCreditAfterRefund = store.docs.get('users/alice_uid/billing/account/credits/' + bobPay.id);
  check(!!aliceCreditAfterRefund.voidedAt, 'crédito da Alice marcado com voidedAt');
  check(aliceCreditAfterRefund.voidedReason === 'payment_refunded', 'voidedReason = payment_refunded');
  const aliceAfter10 = store.docs.get('users/alice_uid/billing/account');
  check(aliceAfter10.stats.totalReferralEarningsCents === 0, 'totalReferralEarningsCents estornado para 0');

  // ============ STEP 11: webhook sem token ============
  step(11, 'Webhook sem ASAAS_WEBHOOK_TOKEN ou com token errado é recusado (C1)');
  const r11 = await call(webhookHandler, {
    headers: { 'asaas-access-token': 'wrong_token' },
    body: { id: 'evt_attack', event: 'PAYMENT_CONFIRMED', payment: { id: 'forged', subscription: bobB2.subscriptionId, value: 9999 } },
  });
  check(r11.status === 401, 'status 401 com token errado');
  check(r11.body.error === 'invalid_webhook_token', 'erro = invalid_webhook_token');

  // ============ STEP 12: /me devolve email mascarado (A7) ============
  step(12, 'Alice consulta /me — e-mail do indicado vem mascarado (A7)');
  const r12 = await call(meHandler, { method: 'GET', headers: { authorization: 'Bearer ' + aliceTok } });
  check(r12.status === 200, 'me ok');
  const ref = r12.body.referrals.find(r => r.uid === 'bob_uid');
  log('referral retornado para a UI =', JSON.stringify(ref));
  check(!!ref, 'Bob está na lista de referrals');
  check(ref.email && ref.email !== 'bob@example.com' && ref.email.includes('***'),
        'e-mail mascarado (não vaza endereço real)');

  // ============ Resumo ============
  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + '== Resultado: ' + pass + ' ok, ' + fail + ' falha(s)\x1b[0m');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('\nFalha inesperada:\n', e); process.exit(2); });
