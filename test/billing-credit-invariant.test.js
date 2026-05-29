'use strict';

// Testes de BORDA da contabilidade Applicash (crédito/cupom).
//
// O medo concreto: stats.pendingDiscountCents e stats.totalReferralEarningsCents
// são contadores ACUMULADOS, somados/subtraídos em ~6 caminhos (gera crédito,
// aplica, reverte por refund, solta crédito de fatura apagada, ajuste admin,
// reconcile). Se QUALQUER caminho errar por 1 centavo, o saldo desgarra da
// soma real dos documentos de crédito — para sempre, sem ninguém perceber.
//
// Estratégia: dirigir os HANDLERS REAIS (init/subscribe/webhook) pelo mock
// in-memory e, após cada mutação, asseverar o INVARIANTE:
//
//     stats.pendingDiscountCents      == Σ(créditos !voided && !applied)
//     stats.totalReferralEarningsCents == Σ(créditos !voided)
//
// A fonte de verdade é a MESMA função usada pela reconciliação
// (computeCreditTotals) — então estes testes travam exatamente a regressão
// que o cron de reconciliação só corrigiria depois do estrago.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const M = require('../scripts/lib/mock-billing');
// setup() injeta os mocks de firebase-admin/asaas no require.cache ANTES de
// carregarmos handlers e o módulo de reconcile (que resolve o mock).
const H = M.setup();
const { store, asaasState, call } = M;
const ROOT = path.resolve(__dirname, '..');
const { computeCreditTotals } = require(path.join(ROOT, 'api/_lib/reconcile'));

const WEBHOOK_HEADERS = { 'asaas-access-token': 'test_webhook_token' };

// ---------- helpers ----------

function reset() {
  store.docs.clear();
  store.now = Date.now();
  asaasState.customers.clear();
  asaasState.subscriptions.clear();
  asaasState.payments.clear();
  asaasState.deletedUids.clear();
  asaasState.seq = 1;
}

function billingOf(uid) {
  return store.docs.get('users/' + uid + '/billing/account') || {};
}

function statsOf(uid) {
  return billingOf(uid).stats || {};
}

// Lê todos os documentos de crédito do indicador direto do store (sem passar
// pelos contadores) — esta é a soma "verdade".
function creditsOf(uid) {
  const prefix = 'users/' + uid + '/billing/account/credits/';
  const out = [];
  for (const [p, data] of store.docs) {
    if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out.push(data);
  }
  return out;
}

// O coração de todos os testes: os contadores batem com a soma canônica dos
// créditos? computeCreditTotals é a MESMA regra de me.js e da reconciliação.
function assertInvariant(uid, label) {
  const truth = computeCreditTotals(creditsOf(uid));
  const s = statsOf(uid);
  assert.equal(
    s.pendingDiscountCents || 0,
    truth.pendingDiscountCents,
    `[${label}] pendingDiscountCents (${s.pendingDiscountCents || 0}) != Σ créditos pendentes (${truth.pendingDiscountCents})`
  );
  assert.equal(
    s.totalReferralEarningsCents || 0,
    truth.totalReferralEarningsCents,
    `[${label}] totalReferralEarningsCents (${s.totalReferralEarningsCents || 0}) != Σ créditos (${truth.totalReferralEarningsCents})`
  );
}

function tok(uid) {
  return 'fake:' + uid + ':' + uid + '@example.com';
}

function paymentForSub(subId) {
  return Array.from(asaasState.payments.values()).find((p) => p.subscription === subId);
}

// Monta o par indicador→indicado e leva o indicado a pagar, gerando UM crédito
// pendente de 135 cents (10% de R$13,50) para o indicador. Retorna os ids.
async function setupPairWithPendingCredit() {
  // Alice: indicadora (sem cupom).
  await call(H.init, { headers: { authorization: 'Bearer ' + tok('alice') }, body: {} });
  const aliceCode = billingOf('alice').referralCode;

  // Bob: indicado (usa o cupom da Alice → 10% de desconto recorrente).
  await call(H.init, {
    headers: { authorization: 'Bearer ' + tok('bob') },
    body: { referralCode: aliceCode },
  });
  await call(H.subscribe, {
    headers: { authorization: 'Bearer ' + tok('bob') },
    body: { cpfCnpj: '10000000442', name: 'Bob Friend' },
  });
  const bobSub = billingOf('bob').subscriptionId;
  const bobPay = paymentForSub(bobSub);

  // Bob paga → webhook gera crédito pendente para a Alice.
  bobPay.status = 'CONFIRMED';
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: { id: 'evt_bob_paid', event: 'PAYMENT_CONFIRMED', payment: { ...bobPay } },
  });

  return { aliceCode, bobSub, bobPay };
}

// Faz a Alice assinar e devolve a fatura inicial PENDING dela.
async function aliceSubscribes() {
  await call(H.subscribe, {
    headers: { authorization: 'Bearer ' + tok('alice') },
    body: { cpfCnpj: '10000000523', name: 'Alice Indicator' },
  });
  const aliceSub = billingOf('alice').subscriptionId;
  return { aliceSub, alicePay: paymentForSub(aliceSub) };
}

// ---------- testes ----------

test('invariante: ciclo completo crédito → aplica → release (fatura apagada) → re-aplica', async () => {
  reset();
  const { bobPay } = await setupPairWithPendingCredit();

  // (1) Crédito recém-gerado: pendente.
  let s = statsOf('alice');
  assert.equal(s.pendingDiscountCents, 135, 'crédito pendente = 135');
  assert.equal(s.totalReferralEarningsCents, 135, 'earnings = 135');
  assertInvariant('alice', 'crédito gerado');

  // (2) Alice assina e a primeira fatura (PAYMENT_CREATED) consome o crédito.
  const { aliceSub, alicePay } = await aliceSubscribes();
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: { id: 'evt_alice_inv1', event: 'PAYMENT_CREATED', payment: { ...alicePay } },
  });
  s = statsOf('alice');
  assert.equal(s.pendingDiscountCents, 0, 'após aplicar: pendente zera');
  assert.equal(s.totalReferralEarningsCents, 135, 'earnings permanece 135');
  assertInvariant('alice', 'crédito aplicado');

  // (3) A fatura da Alice é APAGADA no Asaas → releaseAppliedCredits devolve o
  //     crédito ao saldo pendente (senão ficaria preso: aplicado a uma fatura
  //     que não existe mais).
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: { id: 'evt_alice_inv1_del', event: 'PAYMENT_DELETED', payment: { ...alicePay } },
  });
  s = statsOf('alice');
  assert.equal(s.pendingDiscountCents, 135, 'após release: pendente volta a 135');
  assert.equal(s.totalReferralEarningsCents, 135, 'earnings inalterado');
  assertInvariant('alice', 'crédito liberado');

  // (4) Nova fatura PENDING da Alice re-aplica o crédito devolvido.
  const reapplyPay = {
    id: 'pay_alice_inv2',
    subscription: aliceSub,
    customer: billingOf('alice').customerId,
    value: 15,
    status: 'PENDING',
  };
  asaasState.payments.set(reapplyPay.id, { ...reapplyPay });
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: { id: 'evt_alice_inv2', event: 'PAYMENT_CREATED', payment: reapplyPay },
  });
  s = statsOf('alice');
  assert.equal(s.pendingDiscountCents, 0, 'após re-aplicar: pendente zera de novo');
  assert.equal(s.totalReferralEarningsCents, 135, 'earnings permanece 135');
  assertInvariant('alice', 'crédito re-aplicado');

  // bobPay continua sendo a chave do único crédito (sanidade).
  assert.equal(creditsOf('alice').length, 1, 'apenas um documento de crédito existe');
  assert.ok(
    store.docs.has('users/alice/billing/account/credits/' + bobPay.id),
    'crédito chaveado pelo payment.id do indicado'
  );
});

test('invariante: refund do pagamento do indicado anula crédito PENDENTE (0/0)', async () => {
  reset();
  const { bobPay } = await setupPairWithPendingCredit();
  assertInvariant('alice', 'pré-refund');

  // Bob é reembolsado antes de a Alice usar o crédito → crédito anulado.
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: {
      id: 'evt_bob_refund',
      event: 'PAYMENT_REFUNDED',
      payment: { ...bobPay, status: 'REFUNDED' },
    },
  });

  const s = statsOf('alice');
  assert.equal(s.pendingDiscountCents, 0, 'crédito pendente estornado → 0');
  assert.equal(s.totalReferralEarningsCents, 0, 'earnings estornado → 0');
  const credit = creditsOf('alice')[0];
  assert.ok(credit.voidedAt, 'crédito marcado como voided');
  assertInvariant('alice', 'pós-refund pendente');
});

test('invariante: refund do indicado APÓS crédito aplicado corrige earnings sem desgarrar', async () => {
  reset();
  const { bobPay } = await setupPairWithPendingCredit();

  // Alice consome o crédito numa fatura...
  const { alicePay } = await aliceSubscribes();
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: { id: 'evt_alice_inv1', event: 'PAYMENT_CREATED', payment: { ...alicePay } },
  });
  assert.equal(statsOf('alice').pendingDiscountCents, 0, 'crédito aplicado: pendente 0');
  assertInvariant('alice', 'aplicado antes do refund');

  // ...e SÓ DEPOIS o Bob é reembolsado. O desconto já foi consumido na fatura
  // passada (não desfazemos isso), mas o earnings total tem de refletir o
  // estorno. O risco clássico: mexer no pending (já 0) e deixá-lo negativo.
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: {
      id: 'evt_bob_refund',
      event: 'PAYMENT_REFUNDED',
      payment: { ...bobPay, status: 'REFUNDED' },
    },
  });

  const s = statsOf('alice');
  assert.equal(s.totalReferralEarningsCents, 0, 'earnings corrigido para 0');
  assert.equal(s.pendingDiscountCents, 0, 'pendente permanece 0 (não vai a negativo)');
  assertInvariant('alice', 'refund após aplicado');
});

test('invariante: evento e pagamento duplicados NÃO inflam contadores (idempotência C2 + por payment.id)', async () => {
  reset();
  const { bobPay } = await setupPairWithPendingCredit();
  assert.equal(statsOf('alice').totalReferralEarningsCents, 135, 'um crédito gerado');
  assertInvariant('alice', 'após 1º pagamento');

  // (a) Asaas RETRANSMITE o mesmo evento (mesmo body.id) → guard de duplicado.
  const dup = await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: { id: 'evt_bob_paid', event: 'PAYMENT_CONFIRMED', payment: { ...bobPay } },
  });
  assert.equal(dup.body && dup.body.duplicate, true, 'evento idêntico marcado como duplicate');
  assertInvariant('alice', 'após retransmissão idêntica');

  // (b) Evento DIFERENTE (outro body.id) mas MESMO payment.id, ex.: Asaas
  //     manda PAYMENT_RECEIVED depois de PAYMENT_CONFIRMED. A 2ª camada de
  //     idempotência (crédito já existe para payment.id) tem de impedir um
  //     segundo crédito.
  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: {
      id: 'evt_bob_received',
      event: 'PAYMENT_RECEIVED',
      payment: { ...bobPay, status: 'RECEIVED' },
    },
  });
  const s = statsOf('alice');
  assert.equal(s.totalReferralEarningsCents, 135, 'earnings continua 135 (sem 2º crédito)');
  assert.equal(s.pendingDiscountCents, 135, 'pendente continua 135');
  assert.equal(creditsOf('alice').length, 1, 'continua existindo um único crédito');
  assertInvariant('alice', 'após mesmo payment.id em evento distinto');
});

test('invariante: auto-indicação por mesmo CPF (C4) não gera crédito', async () => {
  reset();
  // Subscribe bloqueia mesmo CPF; aqui semeamos billing diretamente para
  // exercitar a guarda C4 que vive DENTRO do webhook (defesa em profundidade).
  store.docs.set('users/attacker/billing/account', {
    uid: 'attacker',
    cpfCnpj: '10000000604',
    subscriptionStatus: 'ACTIVE',
    referralCode: 'APP-ATTACK',
    stats: { pendingDiscountCents: 0, totalReferralEarningsCents: 0 },
  });
  store.docs.set('users/attacker2/billing/account', {
    uid: 'attacker2',
    cpfCnpj: '10000000604', // MESMO CPF do indicador
    referredByUserId: 'attacker',
    subscriptionId: 'sub_attacker2',
    subscriptionStatus: 'ACTIVE',
  });

  await call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: {
      id: 'evt_self_ref',
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_self', subscription: 'sub_attacker2', value: 15, status: 'CONFIRMED' },
    },
  });

  assert.equal(creditsOf('attacker').length, 0, 'nenhum crédito gerado para auto-indicação');
  const s = statsOf('attacker');
  assert.equal(s.totalReferralEarningsCents, 0, 'earnings permanece 0');
  assert.equal(s.pendingDiscountCents, 0, 'pendente permanece 0');
  assertInvariant('attacker', 'auto-indicação bloqueada');
});

test('invariante: indicador bloqueado (A6) não recebe crédito', async () => {
  reset();
  for (const status of ['INACTIVE', 'CHARGEBACK', 'PAYMENT_REPROVED']) {
    reset();
    store.docs.set('users/ind/billing/account', {
      uid: 'ind',
      cpfCnpj: '10000000442',
      subscriptionStatus: status, // bloqueado
      referralCode: 'APP-BLOCK',
      stats: { pendingDiscountCents: 0, totalReferralEarningsCents: 0 },
    });
    store.docs.set('users/idc/billing/account', {
      uid: 'idc',
      cpfCnpj: '10000000523',
      referredByUserId: 'ind',
      subscriptionId: 'sub_idc',
      subscriptionStatus: 'ACTIVE',
    });

    await call(H.webhook, {
      headers: WEBHOOK_HEADERS,
      body: {
        id: 'evt_blocked_' + status,
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_idc', subscription: 'sub_idc', value: 15, status: 'CONFIRMED' },
      },
    });

    assert.equal(creditsOf('ind').length, 0, `indicador ${status}: nenhum crédito gerado`);
    assertInvariant('ind', 'indicador ' + status);
  }
});
