const TRIAL_DAYS = 7;

function toMillis(v) {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

function computeAccess(billing, now = Date.now()) {
  if (!billing) {
    return { status: 'blocked', reason: 'no_billing', trialDaysLeft: 0 };
  }
  const subStatus = billing.subscriptionStatus || null;
  const lastPaymentStatus = billing.lastPaymentStatus || null;
  const hasPaidBefore = !!toMillis(billing.lastPaidAt);

  // Pagamento confirmado pelo webhook — acesso total
  if (subStatus === 'ACTIVE' && (lastPaymentStatus === 'CONFIRMED' || lastPaymentStatus === 'RECEIVED' || lastPaymentStatus === 'RECEIVED_IN_CASH')) {
    return { status: 'active', reason: 'paid', trialDaysLeft: 0 };
  }

  // Assinatura ativa + já pagou antes (fallback se lastPaymentStatus não foi atualizado)
  if (subStatus === 'ACTIVE' && hasPaidBefore) {
    return { status: 'active', reason: 'paid', trialDaysLeft: 0 };
  }

  const trialEnd = toMillis(billing.trialEndsAt);
  if (trialEnd && now < trialEnd) {
    const left = Math.ceil((trialEnd - now) / 86400000);
    return { status: 'trial', reason: 'trial_active', trialDaysLeft: left };
  }

  if (subStatus === 'ACTIVE') {
    return { status: 'pending_payment', reason: 'awaiting_payment', trialDaysLeft: 0 };
  }
  if (subStatus === 'OVERDUE') {
    return { status: 'blocked', reason: 'overdue', trialDaysLeft: 0 };
  }
  return { status: 'blocked', reason: 'trial_expired', trialDaysLeft: 0 };
}

module.exports = { TRIAL_DAYS, computeAccess, toMillis };
