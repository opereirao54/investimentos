const { db, fieldValue, timestamp } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');
const { computeAccess, TRIAL_DAYS } = require('../_lib/access');
const codes = require('../_lib/codes');

const MONTHLY_PRICE_CENTS = 1500;
const REFERRAL_DISCOUNT_PERCENT = 10;

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

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const body = await readBody(req);
  const rawCode = body.referralCode ? codes.normalize(body.referralCode) : null;

  try {
    const D = db();
    const ref = D.collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;

    if (existing && existing.customerId) {
      return res.json({ access: computeAccess(existing), billing: safeBilling(existing) });
    }

    let referredByUserId = null;
    let referredByCode = null;
    let discountPercent = (existing && existing.recurringDiscountPercent) || 0;

    if (rawCode && !(existing && existing.referredByUserId)) {
      if (!codes.isValid(rawCode)) {
        return res.status(400).json({ error: 'invalid_referral_code' });
      }
      const owner = await codes.lookupOwner(D, rawCode);
      if (!owner) return res.status(400).json({ error: 'referral_code_not_found' });
      if (owner.uid === user.uid) {
        return res.status(400).json({ error: 'self_referral_not_allowed' });
      }
      referredByUserId = owner.uid;
      referredByCode = owner.code;
      discountPercent = REFERRAL_DISCOUNT_PERCENT;
    }

    const ownCode = (existing && existing.referralCode)
      ? existing.referralCode
      : await codes.reserveUniqueCode(D, user.uid, timestamp());

    const customer = await asaas.createCustomer({
      email: user.email,
      name: user.name || user.email,
      uid: user.uid,
    });

    const now = Date.now();
    const trialEnd = now + TRIAL_DAYS * 86400000;

    const data = {
      uid: user.uid,
      email: user.email || null,
      customerId: customer.id,
      createdAt: (existing && existing.createdAt) || timestamp().fromMillis(now),
      trialStartsAt: timestamp().fromMillis(now),
      trialEndsAt: timestamp().fromMillis(trialEnd),
      subscriptionId: null,
      subscriptionStatus: null,
      lastPaymentStatus: null,
      lastPaymentId: null,
      referralCode: ownCode,
      monthlyPriceCents: MONTHLY_PRICE_CENTS,
      recurringDiscountPercent: discountPercent,
      updatedAt: fieldValue().serverTimestamp(),
    };
    if (referredByUserId) {
      data.referredByUserId = referredByUserId;
      data.referredByCode = referredByCode;
      data.referralUsedAt = timestamp().fromMillis(now);
    }
    await ref.set(data, { merge: true });

    return res.json({ access: computeAccess(data), billing: safeBilling(data) });
  } catch (e) {
    console.error('[init]', e, e.data);
    return res.status(500).json({
      error: 'init_failed',
      detail: e.message,
      asaasStatus: e.status || null,
      asaasErrors: (e.data && e.data.errors) || e.data || null,
    });
  }
};

function safeBilling(b) {
  return {
    customerId: b.customerId || null,
    subscriptionId: b.subscriptionId || null,
    subscriptionStatus: b.subscriptionStatus || null,
    lastPaymentStatus: b.lastPaymentStatus || null,
    trialEndsAt: tsToIso(b.trialEndsAt),
    createdAt: tsToIso(b.createdAt),
    referralCode: b.referralCode || null,
    referredByCode: b.referredByCode || null,
    recurringDiscountPercent: b.recurringDiscountPercent || 0,
    monthlyPriceCents: b.monthlyPriceCents || MONTHLY_PRICE_CENTS,
  };
}
function tsToIso(t) {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  if (typeof t === 'number') return new Date(t).toISOString();
  return null;
}
