const { db, fieldValue } = require('../_lib/firebase-admin');

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
      if (pid) {
        await doc.ref.parent.parent.collection('payments').doc(pid).set({
          id: pid,
          status: payment.status,
          value: payment.value || null,
          netValue: payment.netValue || null,
          billingType: payment.billingType || null,
          dueDate: payment.dueDate || null,
          paymentDate: payment.paymentDate || null,
          invoiceUrl: payment.invoiceUrl || null,
          event,
          receivedAt: fieldValue().serverTimestamp(),
        }, { merge: true });
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
