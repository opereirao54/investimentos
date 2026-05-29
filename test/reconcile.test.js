'use strict';

// Testes do invariante de crédito Applicash e da varredura de reconciliação.
// Usa o mock in-memory de firebase-admin/asaas (scripts/lib/mock-billing) —
// setup() injeta os mocks no require.cache antes de carregarmos o módulo.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const M = require('../scripts/lib/mock-billing');

// setup() injeta os mocks; só então exigimos reconcile (resolve o mock).
M.setup();
const { store } = M;
const ROOT = path.resolve(__dirname, '..');
const { computeCreditTotals, reconcileCreditInvariant, runReconcileSweep } = require(
  path.join(ROOT, 'api/_lib/reconcile')
);
const { db } = require(path.join(ROOT, 'api/_lib/firebase-admin'));

function reset() {
  store.docs.clear();
  store.now = Date.now();
}

function seedAccount(uid, billing, credits) {
  store.docs.set('users/' + uid + '/billing/account', billing);
  for (const c of credits || []) {
    store.docs.set('users/' + uid + '/billing/account/credits/' + c.id, c);
  }
}

test('computeCreditTotals: ignora anulados e separa pendente de aplicado', () => {
  const totals = computeCreditTotals([
    { amountCents: 150 }, // pendente
    { amountCents: 150, appliedAt: 'ts' }, // aplicado: conta em earnings, não em pending
    { amountCents: 150, voidedAt: 'ts' }, // anulado: fora de tudo
  ]);
  assert.equal(totals.totalReferralEarningsCents, 300);
  assert.equal(totals.pendingDiscountCents, 150);
});

test('computeCreditTotals: aceita docs com .data()', () => {
  const totals = computeCreditTotals([
    { data: () => ({ amountCents: 100 }) },
    { data: () => ({ amountCents: 50, voidedAt: 'ts' }) },
  ]);
  assert.equal(totals.totalReferralEarningsCents, 100);
  assert.equal(totals.pendingDiscountCents, 100);
});

test('reconcileCreditInvariant: corrige contador que desgarrou para baixo', async () => {
  reset();
  seedAccount(
    'u1',
    { uid: 'u1', stats: { pendingDiscountCents: 0, totalReferralEarningsCents: 0 } },
    [
      { id: 'pay_a', amountCents: 150 },
      { id: 'pay_b', amountCents: 150 },
    ]
  );
  const billingRef = db().collection('users').doc('u1').collection('billing').doc('account');

  const drift = await reconcileCreditInvariant(billingRef);
  assert.ok(drift, 'deve detectar drift');
  assert.equal(drift.pending.from, 0);
  assert.equal(drift.pending.to, 300);
  assert.equal(drift.pending.drift, 300);

  const fixed = (await billingRef.get()).data().stats;
  assert.equal(fixed.pendingDiscountCents, 300);
  assert.equal(fixed.totalReferralEarningsCents, 300);
});

test('reconcileCreditInvariant: no-op quando os contadores já batem', async () => {
  reset();
  seedAccount(
    'u2',
    { uid: 'u2', stats: { pendingDiscountCents: 150, totalReferralEarningsCents: 150 } },
    [{ id: 'pay_c', amountCents: 150 }]
  );
  const billingRef = db().collection('users').doc('u2').collection('billing').doc('account');
  const before = (await billingRef.get()).data().updatedAt;

  const drift = await reconcileCreditInvariant(billingRef);
  assert.equal(drift, null, 'sem drift retorna null');
  // Sem escrita: updatedAt não muda.
  assert.equal((await billingRef.get()).data().updatedAt, before);
});

test('reconcileCreditInvariant: crédito aplicado não infla pendingDiscount', async () => {
  reset();
  seedAccount('u3', { uid: 'u3', stats: { pendingDiscountCents: 300 } }, [
    { id: 'pay_d', amountCents: 150 }, // pendente
    { id: 'pay_e', amountCents: 150, appliedAt: 'ts' }, // já aplicado
  ]);
  const billingRef = db().collection('users').doc('u3').collection('billing').doc('account');

  const drift = await reconcileCreditInvariant(billingRef);
  assert.ok(drift);
  assert.equal(drift.pending.to, 150, 'só o crédito pendente conta');
  assert.equal((await billingRef.get()).data().stats.totalReferralEarningsCents, 300);
});

test('runReconcileSweep: varre todas as contas e conta correções', async () => {
  reset();
  // Conta com drift de crédito.
  seedAccount('a', { uid: 'a', stats: { pendingDiscountCents: 0 } }, [
    { id: 'p1', amountCents: 150 },
  ]);
  // Conta saudável (sem crédito, contador zerado).
  seedAccount('b', { uid: 'b', stats: { pendingDiscountCents: 0 } }, []);

  const summary = await runReconcileSweep({});
  assert.equal(summary.scanned, 2);
  assert.equal(summary.creditInvariantCorrected, 1);
  assert.equal(summary.errors, 0);
  assert.equal(summary.corrections.length, 1);
  assert.equal(summary.corrections[0].uid, 'a');
});

test('runReconcileSweep: ignora subcoleção credits na varredura de contas', async () => {
  reset();
  seedAccount(
    'a',
    { uid: 'a', stats: { pendingDiscountCents: 150, totalReferralEarningsCents: 150 } },
    [{ id: 'p1', amountCents: 150 }]
  );
  const summary = await runReconcileSweep({});
  // Apenas o doc 'account' deve ser escaneado, não os créditos.
  assert.equal(summary.scanned, 1);
  assert.equal(summary.creditInvariantCorrected, 0);
});
