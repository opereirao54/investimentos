const TRIAL_DAYS = 7;

const PAID_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const BAD_PAYMENT_STATUSES = new Set([
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'OVERDUE',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

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

  // Defesa em profundidade: se o último pagamento está em estado ruim
  // (vencido, em chargeback, reembolso), bloqueia mesmo que subStatus
  // ainda esteja como ACTIVE por dessincronia.
  if (lastPaymentStatus && BAD_PAYMENT_STATUSES.has(lastPaymentStatus)) {
    if (lastPaymentStatus === 'OVERDUE') {
      return { status: 'blocked', reason: 'overdue', trialDaysLeft: 0 };
    }
    if (lastPaymentStatus.startsWith('CHARGEBACK') || lastPaymentStatus === 'AWAITING_CHARGEBACK_REVERSAL') {
      return { status: 'blocked', reason: 'chargeback', trialDaysLeft: 0 };
    }
    return { status: 'blocked', reason: 'refunded', trialDaysLeft: 0 };
  }

  // Pagamento confirmado pelo webhook — acesso total
  if (subStatus === 'ACTIVE' && PAID_PAYMENT_STATUSES.has(lastPaymentStatus)) {
    return { status: 'active', reason: 'paid', trialDaysLeft: 0 };
  }

  // Assinatura ativa + já pagou antes (fallback se lastPaymentStatus não foi
  // atualizado, ex.: durante geração do próximo invoice em PENDING).
  // Só vale se o último status conhecido não é um estado problemático.
  if (subStatus === 'ACTIVE' && hasPaidBefore && (!lastPaymentStatus || lastPaymentStatus === 'PENDING' || PAID_PAYMENT_STATUSES.has(lastPaymentStatus))) {
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
  if (subStatus === 'AWAITING_RISK_ANALYSIS') {
    return { status: 'pending_payment', reason: 'risk_analysis', trialDaysLeft: 0 };
  }
  if (subStatus === 'OVERDUE') {
    return { status: 'blocked', reason: 'overdue', trialDaysLeft: 0 };
  }
  if (subStatus === 'PAYMENT_REPROVED') {
    return { status: 'blocked', reason: 'card_reproved', trialDaysLeft: 0 };
  }
  if (subStatus === 'CHARGEBACK' || subStatus === 'CHARGEBACK_REVERSAL_PENDING') {
    return { status: 'blocked', reason: 'chargeback', trialDaysLeft: 0 };
  }
  if (subStatus === 'INACTIVE') {
    return { status: 'blocked', reason: 'cancelled', trialDaysLeft: 0 };
  }
  return { status: 'blocked', reason: 'trial_expired', trialDaysLeft: 0 };
}

module.exports = { TRIAL_DAYS, computeAccess, toMillis };
