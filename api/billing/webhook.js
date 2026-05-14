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

async function creditIndicatorFromIndicado(indicadoBilling, payment) {
  const indicatorUid = indicadoBilling.referredByUserId;
  if (!indicatorUid) return null;

  const indicatorBillingRef = db().collection('users').doc(indicatorUid).collection('billing').doc('account');
  const indicatorSnap = await indicatorBillingRef.get();
  if (!indicatorSnap.exists) return null;

  const paidCents = Math.round((payment.value || 0) * 100);
  const generated = Math.round(paidCents * REFERRAL_PERCENT / 100);
  if (generated <= 0) return null;

  const creditId = payment.id;
  await indicatorBillingRef.collection('credits').doc(creditId).set({
    fromUid: indicadoBilling.uid,
    fromEmail: indicadoBilling.email || null,
    paymentId: payment.id,
    amountCents: generated,
    appliedAt: null,
    appliedToPaymentId: null,
    createdAt: fieldValue().serverTimestamp(),
  }, { merge: true });

  await indicatorBillingRef.set({
    stats: {
      totalReferralEarningsCents: fieldValue().increment(generated),
      pendingDiscountCents: fieldValue().increment(generated),
    },
    updatedAt: fieldValue().serverTimestamp(),
  }, { merge: true });

  return generated;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  const received = req.headers['asaas-access-token'] || req.headers['Asaas-Access-Token'];
  if (expected && received !== expected) {
    return res.status(401).json({ error: 'invalid_webhook_token' });
  }

  let body;
  try { body = await readBody(req); } catch (_) { return res.status(400).json({ error: 'bad_json' }); }

  const event = body.event;
  const payment = body.payment || null;
  const subscription = body.subscription || null;

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

    if (event && event.startsWith('PAYMENT_')) {
      update.lastPaymentId = payment.id;
      update.lastPaymentStatus = payment.status;

      if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
        update.subscriptionStatus = 'ACTIVE';
        update.lastPaidAt = fieldValue().serverTimestamp();
      } else if (event === 'PAYMENT_OVERDUE') {
        update.subscriptionStatus = 'OVERDUE';
      } else if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_DELETED') {
        update.subscriptionStatus = 'INACTIVE';
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

      if ((event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') && billing.referredByUserId) {
        try {
          const generated = await creditIndicatorFromIndicado(billing, payment);
          if (generated) paymentExtra.referralGeneratedDiscountCents = generated;
        } catch (e) {
          console.error('[webhook] creditIndicatorFromIndicado failed', e);
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
      if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
        update.subscriptionStatus = 'INACTIVE';
      } else if (subscription && subscription.status) {
        update.subscriptionStatus = subscription.status;
      }
    }

    await doc.ref.set(update, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[webhook]', e);
    return res.status(500).json({ error: 'webhook_failed' });
  }
};
