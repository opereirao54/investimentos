'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAccess } = require('../api/_lib/access');

const NOW = Date.UTC(2026, 0, 15);
const DAY = 86400 * 1000;

test('sem billing -> bloqueado', () => {
  const r = computeAccess(null, NOW);
  assert.equal(r.status, 'blocked');
  assert.equal(r.reason, 'no_billing');
});

test('OVERDUE bloqueia mesmo com subscription ACTIVE', () => {
  const r = computeAccess({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'OVERDUE' }, NOW);
  assert.equal(r.status, 'blocked');
  assert.equal(r.reason, 'overdue');
});

test('CHARGEBACK_REQUESTED bloqueia', () => {
  const r = computeAccess(
    { subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'CHARGEBACK_REQUESTED' },
    NOW
  );
  assert.equal(r.status, 'blocked');
  assert.equal(r.reason, 'chargeback');
});

test('REFUNDED bloqueia', () => {
  const r = computeAccess({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'REFUNDED' }, NOW);
  assert.equal(r.status, 'blocked');
  assert.equal(r.reason, 'refunded');
});

test('ACTIVE + CONFIRMED -> active/paid', () => {
  const r = computeAccess(
    {
      subscriptionStatus: 'ACTIVE',
      lastPaymentStatus: 'CONFIRMED',
      lastPaidAt: NOW - DAY,
    },
    NOW
  );
  assert.equal(r.status, 'active');
  assert.equal(r.reason, 'paid');
});

test('ACTIVE + RECEIVED -> active/paid', () => {
  const r = computeAccess(
    {
      subscriptionStatus: 'ACTIVE',
      lastPaymentStatus: 'RECEIVED',
      lastPaidAt: NOW - 5 * DAY,
    },
    NOW
  );
  assert.equal(r.status, 'active');
});
