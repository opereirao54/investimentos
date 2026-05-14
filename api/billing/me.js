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
    const userRef = D.collection('users').doc(user.uid);
    const billingRef = userRef.collection('billing').doc('account');
    const snap = await billingRef.get();
    if (!snap.exists) return res.json({ access: computeAccess(null), billing: null });
    const billing = snap.data();

    const indicadosQ = await D.collectionGroup('billing')
      .where('referredByUserId', '==', user.uid)
      .get();

    const referrals = indicadosQ.docs.map(d => {
      const b = d.data();
      return {
        uid: b.uid,
        email: b.email || null,
        subscriptionStatus: b.subscriptionStatus || null,
        lastPaymentStatus: b.lastPaymentStatus || null,
        baseValueCents: b.subscriptionBaseValueCents || b.monthlyPriceCents || 1500,
        referralUsedAt: tsToIso(b.referralUsedAt),
        lastPaidAt: tsToIso(b.lastPaidAt),
      };
    });
    const activeReferrals = referrals.filter(r => r.subscriptionStatus === 'ACTIVE').length;
    const totalReferrals = referrals.length;

    const creditsQ = await billingRef.collection('credits')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const credits = creditsQ.docs.map(d => {
      const c = d.data();
      return {
        id: d.id,
        fromUid: c.fromUid || null,
        fromEmail: c.fromEmail || null,
        amountCents: c.amountCents || 0,
        appliedAt: tsToIso(c.appliedAt),
        appliedAmountCents: c.appliedAmountCents || null,
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

    const paymentsQ = await userRef.collection('payments')
      .orderBy('receivedAt', 'desc')
      .limit(20)
      .get();
    const payments = paymentsQ.docs.map(d => {
      const p = d.data();
      return {
        id: p.id || d.id,
        status: p.status || null,
        value: p.value || null,
        billingType: p.billingType || null,
        dueDate: p.dueDate || null,
        paymentDate: p.paymentDate || null,
        invoiceUrl: p.invoiceUrl || null,
        referralAppliedCents: p.referralAppliedCents || 0,
        event: p.event || null,
        receivedAt: tsToIso(p.receivedAt),
      };
    });

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
      subscriptionId: billing.subscriptionId || null,
      customerId: billing.customerId || null,
      lastPaymentStatus: billing.lastPaymentStatus || null,
      lastPaidAt: tsToIso(billing.lastPaidAt),
      trialEndsAt: tsToIso(billing.trialEndsAt),
      activeReferrals,
      totalReferrals,
      pendingDiscountCents,
      totalReferralEarningsCents,
      projectedNextBillCents: projectedNextCents,
      referrals,
      credits,
      payments,
    });
  } catch (e) {
    console.error('[me]', e);
    return res.status(500).json({ error: 'me_failed', detail: e.message });
  }
};
