const { db, fieldValue } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || null;
}

function brandFromNumber(n) {
  const d = String(n || '').replace(/\D+/g, '');
  if (/^4/.test(d)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'MASTERCARD';
  if (/^3[47]/.test(d)) return 'AMEX';
  if (/^(36|30[0-5]|3[89])/.test(d)) return 'DINERS';
  if (/^(6011|65|64[4-9])/.test(d)) return 'DISCOVER';
  return 'UNKNOWN';
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const body = await readBody(req);
  const creditCard = body.creditCard;
  const creditCardHolderInfo = body.creditCardHolderInfo;
  if (!creditCard || !creditCard.number || !creditCard.holderName || !creditCard.expiryMonth || !creditCard.expiryYear || !creditCard.ccv) {
    return res.status(400).json({ error: 'invalid_card' });
  }
  if (!creditCardHolderInfo || !creditCardHolderInfo.cpfCnpj) {
    return res.status(400).json({ error: 'invalid_holder_info' });
  }

  try {
    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ error: 'billing_not_initialized' });
    const billing = snap.data();
    if (!billing.subscriptionId) return res.status(400).json({ error: 'no_subscription' });

    const updated = await asaas.updateSubscriptionCard(billing.subscriptionId, {
      creditCard,
      creditCardHolderInfo,
      remoteIp: clientIp(req),
      updatePendingPayments: true,
    });

    const cc = (updated && updated.creditCard) || {};
    const last4 = (cc.creditCardNumber || '').replace(/\D+/g, '').slice(-4) || String(creditCard.number).replace(/\D+/g, '').slice(-4);

    const billingUpdate = {
      paymentMethod: 'CREDIT_CARD',
      cardBrand: cc.creditCardBrand || brandFromNumber(creditCard.number),
      cardLast4: last4 || null,
      cardHolderName: (creditCard.holderName || '').trim() || null,
      lastFailureReason: fieldValue().delete(),
      updatedAt: fieldValue().serverTimestamp(),
    };
    if (cc.creditCardToken) billingUpdate.cardToken = cc.creditCardToken;
    await ref.set(billingUpdate, { merge: true });

    return res.json({
      ok: true,
      paymentMethod: 'CREDIT_CARD',
      cardBrand: billingUpdate.cardBrand,
      cardLast4: billingUpdate.cardLast4,
    });
  } catch (e) {
    console.error('[card]', e, e.data);
    return res.status(e.status || 500).json({
      error: 'card_update_failed',
      detail: e.message,
      asaasErrors: (e.data && e.data.errors) || e.data || null,
    });
  }
};
