const { db, fieldValue, timestamp } = require('../_lib/firebase-admin');
const asaas = require('../_lib/asaas');

const REFERRAL_PERCENT = 10;
const MIN_PAYMENT_CENTS = parseInt(process.env.MIN_PAYMENT_CENTS || '100', 10);

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function findBillingByCustomer(customerId) {
  const q = await db().collectionGroup('billing').where('customerId', '==', customerId).limit(1).get();
  if (q.empty) return null;
  return q.docs[0];
}
async function findBillingBySubscription(subscriptionId) {
  const q = await db().collectionGroup('billing').where('subscriptionId', '==', subscriptionId).limit(1).get();
  if (q.empty) return null;
  return q.docs[0];
}

function userRefFromBilling(doc) {
  return doc.ref.parent.parent;
}

function paymentsCol(billingDoc) {
  return userRefFromBilling(billingDoc).collection('payments');
}
function creditsCol(billingDoc) {
  return billingDoc.ref.collection('credits');
}

async function applyPendingCreditsTo(indicatorBillingDoc, paymentId, paymentValueReais) {
  const billing = indicatorBillingDoc.data();
  const monthlyCents = billing.subscriptionBaseValueCents || billing.monthlyPriceCents || 1500;
  const paymentCents = Math.round((paymentValueReais || (monthlyCents / 100)) * 100);
  const maxDiscountCents = Math.max(0, paymentCents - MIN_PAYMENT_CENTS);

  const q = await creditsCol(indicatorBillingDoc).where('appliedAt', '==', null).get();
  if (q.empty) return { applied: 0, used: [] };

  let appliedCents = 0;
  const used = [];
  for (const d of q.docs) {
    if (appliedCents >= maxDiscountCents) break;
    const c = d.data();
    const room = maxDiscountCents - appliedCents;
    const take = Math.min(c.amountCents || 0, room);
    if (take <= 0) continue;
    appliedCents += take;
    used.push({ ref: d.ref, amountCents: c.amountCents, partial: take });
  }
  if (appliedCents <= 0) return { applied: 0, used: [] };

  const newValueReais = Math.max(MIN_PAYMENT_CENTS, paymentCents - appliedCents) / 100;
  await asaas.updatePayment(paymentId, { value: newValueReais });

  const batch = db().batch();
  for (const u of used) {
    batch.set(u.ref, {
      appliedAt: fieldValue().serverTimestamp(),
      appliedToPaymentId: paymentId,
      appliedAmountCents: u.partial,
    }, { merge: true });
  }
  await batch.commit();

  return { applied: appliedCents, used };
}

const INDICATOR_BLOCKED_STATUSES = new Set([
  'INACTIVE',
  'CHARGEBACK',
  'CHARGEBACK_REVERSAL_PENDING',
  'PAYMENT_REPROVED',
]);

async function creditIndicatorFromIndicado(indicadoBilling, payment) {
  const indicatorUid = indicadoBilling.referredByUserId;
  if (!indicatorUid) return null;

  const indicatorBillingRef = db().collection('users').doc(indicatorUid).collection('billing').doc('account');
  const indicatorSnap = await indicatorBillingRef.get();
  if (!indicatorSnap.exists) return null;
  const indicator = indicatorSnap.data();

  // A6: indicador inativo/em chargeback não gera nem recebe novos créditos.
  if (INDICATOR_BLOCKED_STATUSES.has(indicator.subscriptionStatus)) {
    console.warn('[webhook] indicator blocked, skipping credit', indicatorUid, indicator.subscriptionStatus);
    return null;
  }

  // C4: bloqueia auto-indicação por mesma identidade fiscal (multi-conta).
  if (
    indicator.cpfCnpj &&
    indicadoBilling.cpfCnpj &&
    indicator.cpfCnpj === indicadoBilling.cpfCnpj
  ) {
    console.warn('[webhook] same-CPF referral blocked', indicatorUid, '<-', indicadoBilling.uid);
    return null;
  }

  const paidCents = Math.round((payment.value || 0) * 100);
  const generated = Math.round(paidCents * REFERRAL_PERCENT / 100);
  if (generated <= 0) return null;

  // Idempotência por payment.id: se já existe crédito para este pagamento,
  // não duplica nem incrementa stats novamente.
  const creditId = payment.id;
  const creditRef = indicatorBillingRef.collection('credits').doc(creditId);
  const existingCredit = await creditRef.get();
  if (existingCredit.exists) {
    return null;
  }

  await creditRef.set({
    fromUid: indicadoBilling.uid,
    fromEmail: indicadoBilling.email || null,
    paymentId: payment.id,
    amountCents: generated,
    appliedAt: null,
    appliedToPaymentId: null,
    createdAt: fieldValue().serverTimestamp(),
  });

  await indicatorBillingRef.set({
    stats: {
      totalReferralEarningsCents: fieldValue().increment(generated),
      pendingDiscountCents: fieldValue().increment(generated),
    },
    updatedAt: fieldValue().serverTimestamp(),
  }, { merge: true });

  return generated;
}

async function reverseReferralCredit(indicatorUid, paymentId) {
  if (!indicatorUid || !paymentId) return false;
  const indicatorBillingRef = db().collection('users').doc(indicatorUid).collection('billing').doc('account');
  const creditRef = indicatorBillingRef.collection('credits').doc(paymentId);
  const snap = await creditRef.get();
  if (!snap.exists) return false;
  const c = snap.data();
  if (c.voidedAt) return false; // já revertido

  await creditRef.set({
    voidedAt: fieldValue().serverTimestamp(),
    voidedReason: 'payment_refunded',
  }, { merge: true });

  const updateStats = { updatedAt: fieldValue().serverTimestamp(), stats: {} };
  const amount = c.amountCents || 0;
  // Pendente: desconto ainda não aplicado → estorna pending + total.
  // Já aplicado: o desconto já consumido fica mantido na fatura passada,
  // mas o earnings total é corrigido para refletir o estorno.
  updateStats.stats.totalReferralEarningsCents = fieldValue().increment(-amount);
  if (!c.appliedAt) {
    updateStats.stats.pendingDiscountCents = fieldValue().increment(-amount);
  }
  await indicatorBillingRef.set(updateStats, { merge: true });
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // C1: token de webhook é OBRIGATÓRIO. Sem token configurado, recusa
  // todo o tráfego — evita que um deploy mal configurado permita
  // que qualquer um forje eventos de pagamento.
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected) {
    console.error('[webhook] ASAAS_WEBHOOK_TOKEN not configured — refusing all events');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }
  const received = req.headers['asaas-access-token'] || req.headers['Asaas-Access-Token'];
  if (received !== expected) {
    return res.status(401).json({ error: 'invalid_webhook_token' });
  }

  let body;
  try { body = await readBody(req); } catch (_) { return res.status(400).json({ error: 'bad_json' }); }

  const event = body.event;
  const payment = body.payment || null;
  const subscription = body.subscription || null;

  // C2: idempotência. Asaas retransmite eventos; sem guard, increments
  // de créditos referral disparam várias vezes. Usa `body.id` quando
  // existir (Asaas envia um id único do evento) e cai em uma chave
  // determinística como fallback.
  const eventKey = body.id
    || (event && payment && payment.id ? `${event}:${payment.id}:${payment.status || ''}` : null)
    || (event && subscription && subscription.id ? `${event}:sub:${subscription.id}` : null);
  if (eventKey) {
    try {
      const eventRef = db().collection('webhookEvents').doc(String(eventKey).replace(/[^A-Za-z0-9_:-]/g, '_'));
      const fresh = await db().runTransaction(async (tx) => {
        const snap = await tx.get(eventRef);
        if (snap.exists) return false;
        tx.set(eventRef, {
          event: event || null,
          paymentId: (payment && payment.id) || null,
          subscriptionId: (payment && payment.subscription) || (subscription && subscription.id) || null,
          paymentStatus: (payment && payment.status) || null,
          receivedAt: fieldValue().serverTimestamp(),
        });
        return true;
      });
      if (!fresh) {
        console.log('[webhook] duplicate event ignored event=%s', event || null);
        return res.json({ ok: true, duplicate: true });
      }
    } catch (e) {
      // Em erro de idempotência (ex.: Firestore transitório), prosseguir é
      // pior do que falhar — Asaas refaz retry.
      console.error('[webhook] idempotency guard failed', e && e.message);
      return res.status(500).json({ error: 'idempotency_check_failed' });
    }
  }

  try {
    let doc = null;
    if (payment && payment.subscription) {
      doc = await findBillingBySubscription(payment.subscription);
    } else if (subscription && subscription.id) {
      doc = await findBillingBySubscription(subscription.id);
    } else if (payment && payment.customer) {
      doc = await findBillingByCustomer(payment.customer);
    }
    if (!doc) {
      console.warn('[webhook] billing not found', event);
      return res.json({ ok: true, skipped: true });
    }

    const billing = doc.data();
    const update = { updatedAt: fieldValue().serverTimestamp(), lastEvent: event || null };
    // B1: log sem PII/IDs Asaas — basta o evento para troubleshooting.
    console.log('[webhook] event=%s uid=%s', event, billing.uid);

    if (event && event.startsWith('PAYMENT_')) {
      update.lastPaymentId = payment.id;
      update.lastPaymentStatus = payment.status;

      switch (event) {
        case 'PAYMENT_CONFIRMED':
        case 'PAYMENT_RECEIVED':
        case 'PAYMENT_RECEIVED_IN_CASH':
        case 'PAYMENT_APPROVED_BY_RISK_ANALYSIS':
          update.subscriptionStatus = 'ACTIVE';
          update.lastPaidAt = fieldValue().serverTimestamp();
          update.dunningRetryCount = fieldValue().delete();
          update.lastFailureReason = fieldValue().delete();
          break;
        case 'PAYMENT_AUTHORIZED':
          update.subscriptionStatus = billing.subscriptionStatus === 'ACTIVE' ? 'ACTIVE' : 'PENDING';
          break;
        case 'PAYMENT_AWAITING_RISK_ANALYSIS':
          update.subscriptionStatus = 'AWAITING_RISK_ANALYSIS';
          break;
        case 'PAYMENT_REPROVED_BY_RISK_ANALYSIS':
          update.subscriptionStatus = 'PAYMENT_REPROVED';
          update.lastFailureReason = 'risk_analysis_reproved';
          break;
        case 'PAYMENT_OVERDUE':
          update.subscriptionStatus = 'OVERDUE';
          break;
        case 'PAYMENT_DUNNING_REQUESTED':
        case 'PAYMENT_DUNNING_RECEIVED':
          update.dunningRetryCount = fieldValue().increment(1);
          update.lastDunningAt = fieldValue().serverTimestamp();
          break;
        case 'PAYMENT_CHARGEBACK_REQUESTED':
        case 'PAYMENT_CHARGEBACK_DISPUTE':
          update.subscriptionStatus = 'CHARGEBACK';
          update.lastFailureReason = 'chargeback';
          break;
        case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
          update.subscriptionStatus = 'CHARGEBACK_REVERSAL_PENDING';
          break;
        case 'PAYMENT_REFUND_IN_PROGRESS':
          update.subscriptionStatus = 'REFUND_IN_PROGRESS';
          break;
        case 'PAYMENT_REFUNDED':
        case 'PAYMENT_DELETED':
          update.subscriptionStatus = 'INACTIVE';
          break;
        default:
          break;
      }

      const pid = payment.id;
      const paymentExtra = {};

      if (event === 'PAYMENT_CREATED' && payment.status === 'PENDING') {
        try {
          const applied = await applyPendingCreditsTo(doc, pid, payment.value);
          if (applied.applied > 0) {
            paymentExtra.referralAppliedCents = applied.applied;
            const newPendingDelta = -applied.applied;
            update.stats = update.stats || {};
            update.stats.pendingDiscountCents = fieldValue().increment(newPendingDelta);
          }
        } catch (e) {
          console.error('[webhook] applyPendingCreditsTo failed', e, e.data);
        }
      }

      if ((event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_RECEIVED_IN_CASH') && billing.referredByUserId) {
        try {
          const generated = await creditIndicatorFromIndicado(billing, payment);
          if (generated) paymentExtra.referralGeneratedDiscountCents = generated;
        } catch (e) {
          console.error('[webhook] creditIndicatorFromIndicado failed', e);
        }
      }

      // A6 + refund handling: estorna crédito do indicador quando o
      // pagamento do indicado é reembolsado ou apagado.
      if ((event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_DELETED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') && billing.referredByUserId && payment && payment.id) {
        try {
          const reversed = await reverseReferralCredit(billing.referredByUserId, payment.id);
          if (reversed) paymentExtra.referralReversed = true;
        } catch (e) {
          console.error('[webhook] reverseReferralCredit failed', e);
        }
      }

      if (pid) {
        await paymentsCol(doc).doc(pid).set(Object.assign({
          id: pid,
          status: payment.status,
          value: payment.value || null,
          netValue: payment.netValue || null,
          billingType: payment.billingType || null,
          dueDate: payment.dueDate || null,
          paymentDate: payment.paymentDate || null,
          invoiceUrl: payment.invoiceUrl || null,
          subscriptionId: payment.subscription || null,
          event,
          receivedAt: fieldValue().serverTimestamp(),
        }, paymentExtra), { merge: true });
      }
    } else if (event && event.startsWith('SUBSCRIPTION_')) {
      if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED' || event === 'SUBSCRIPTION_CANCELLED') {
        update.subscriptionStatus = 'INACTIVE';
        update.cancelledAt = fieldValue().serverTimestamp();
      } else if (event === 'SUBSCRIPTION_UPDATED') {
        if (subscription) {
          if (subscription.status) update.subscriptionStatus = subscription.status;
          if (typeof subscription.value === 'number') update.subscriptionBaseValueCents = Math.round(subscription.value * 100);
          if (subscription.nextDueDate) update.nextDueDate = subscription.nextDueDate;
          if (subscription.billingType) update.paymentMethod = subscription.billingType;
        }
      } else if (subscription && subscription.status) {
        update.subscriptionStatus = subscription.status;
      }
    }

    // M3: subscriptionStatus INACTIVE só sai via novo /subscribe (criação
    // de nova subscription, que troca o subscriptionId). Eventos
    // PAYMENT_* de uma sub antiga não podem revivê-la.
    if (
      billing.subscriptionStatus === 'INACTIVE'
      && update.subscriptionStatus
      && update.subscriptionStatus !== 'INACTIVE'
    ) {
      console.warn('[webhook] refusing to revert INACTIVE -> %s via event %s', update.subscriptionStatus, event);
      delete update.subscriptionStatus;
    }

    await doc.ref.set(update, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[webhook]', e);
    return res.status(500).json({ error: 'webhook_failed' });
  }
};
