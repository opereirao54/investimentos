const { db } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const { computeAccess } = require('../_lib/access');

function tsToIso(t) {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  return null;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const D = db();
    const billingRef = D.collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await billingRef.get();
    if (!snap.exists) return res.json({ access: computeAccess(null), billing: null });
    const billing = snap.data();

    const activeReferralsQ = await D.collectionGroup('billing')
      .where('referredByUserId', '==', user.uid)
      .where('subscriptionStatus', '==', 'ACTIVE')
      .get();
    const activeReferrals = activeReferralsQ.size;

    const totalReferralsQ = await D.collectionGroup('billing')
      .where('referredByUserId', '==', user.uid)
      .get();
    const totalReferrals = totalReferralsQ.size;

    const creditsQ = await billingRef.collection('credits')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const credits = creditsQ.docs.map(d => {
      const c = d.data();
      return {
        id: d.id,
        fromEmail: c.fromEmail || null,
        amountCents: c.amountCents || 0,
        appliedAt: tsToIso(c.appliedAt),
        appliedToPaymentId: c.appliedToPaymentId || null,
        createdAt: tsToIso(c.createdAt),
      };
    });

    let pendingDiscountCents = 0;
    let totalReferralEarningsCents = 0;
    for (const c of credits) {
      totalReferralEarningsCents += c.amountCents;
      if (!c.appliedAt) pendingDiscountCents += c.amountCents;
    }

    const monthlyCents = billing.subscriptionBaseValueCents || billing.monthlyPriceCents || 1500;
    const projectedNextCents = Math.max(100, monthlyCents - Math.min(pendingDiscountCents, monthlyCents - 100));

    return res.json({
      access: computeAccess(billing),
      referralCode: billing.referralCode || null,
      referredByCode: billing.referredByCode || null,
      referredByUserId: billing.referredByUserId || null,
      recurringDiscountPercent: billing.recurringDiscountPercent || 0,
      monthlyPriceCents: billing.monthlyPriceCents || 1500,
      subscriptionBaseValueCents: monthlyCents,
      subscriptionStatus: billing.subscriptionStatus || null,
      lastPaymentStatus: billing.lastPaymentStatus || null,
      activeReferrals,
      totalReferrals,
      pendingDiscountCents,
      totalReferralEarningsCents,
      projectedNextBillCents: projectedNextCents,
      credits,
    });
  } catch (e) {
    console.error('[me]', e);
    return res.status(500).json({ error: 'me_failed', detail: e.message });
  }
};
