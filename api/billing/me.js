const { db } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const { computeAccess } = require('../_lib/access');
const { syncBillingFromAsaas } = require('../_lib/billing-sync');

function tsToIso(t) {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  return null;
}

// Privacidade (LGPD): o indicador vê só uma máscara do e-mail do indicado.
function maskEmail(e) {
  if (!e || typeof e !== 'string') return null;
  const at = e.indexOf('@');
  if (at <= 0) return '***';
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const visible = user.length <= 2 ? user[0] : user[0] + '*' + user.slice(-1);
  const domParts = domain.split('.');
  const dom = domParts[0];
  const domMasked = dom.length <= 2 ? dom[0] + '*' : dom[0] + '***' + dom.slice(-1);
  const rest = domParts.slice(1).join('.');
  return visible + '***@' + domMasked + (rest ? '.' + rest : '');
}

function addMonthsYmd(ymd, months) {
  // ymd: 'YYYY-MM-DD' (UTC)
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo + months, d));
  return dt.toISOString().slice(0, 10);
}

function buildUpcoming(billing, payments, projectedNextCents, monthlyCents) {
  // Não há cobranças se não houver subscrição activa.
  if (!billing.subscriptionId || billing.subscriptionStatus === 'INACTIVE') return [];

  const pendingByDate = (payments || [])
    .filter(p => p.status === 'PENDING' || p.status === 'OVERDUE' || p.status === 'AWAITING_RISK_ANALYSIS')
    .map(p => ({
      date: p.dueDate || null,
      amountCents: Math.round((p.value || 0) * 100),
      status: p.status,
      source: 'invoice',
      paymentId: p.id,
      invoiceUrl: p.invoiceUrl || null,
    }))
    .filter(p => p.date);

  const seen = new Set(pendingByDate.map(p => p.date));
  const list = pendingByDate.slice();

  const baseDate = billing.nextDueDate || (pendingByDate[0] && pendingByDate[0].date) || null;
  if (baseDate) {
    for (let i = 0; i < 3; i++) {
      const d = i === 0 && !seen.has(baseDate) ? baseDate : addMonthsYmd(baseDate, i + (seen.has(baseDate) ? 1 : 0));
      if (!d || seen.has(d)) continue;
      seen.add(d);
      list.push({
        date: d,
        amountCents: i === 0 ? projectedNextCents : monthlyCents,
        status: 'FORECAST',
        source: 'forecast',
        paymentId: null,
        invoiceUrl: null,
      });
    }
  }

  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return list.slice(0, 3);
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
    const synced = await syncBillingFromAsaas(billingRef, snap.data());
    const billing = synced.billing;

    let referrals = [];
    try {
      const indicadosQ = await D.collectionGroup('billing')
        .where('referredByUserId', '==', user.uid)
        .get();
      referrals = indicadosQ.docs.map(d => {
        const b = d.data();
        return {
          uid: b.uid,
          email: maskEmail(b.email),
          subscriptionStatus: b.subscriptionStatus || null,
          lastPaymentStatus: b.lastPaymentStatus || null,
          baseValueCents: b.subscriptionBaseValueCents || b.monthlyPriceCents || 1500,
          referralUsedAt: tsToIso(b.referralUsedAt),
          lastPaidAt: tsToIso(b.lastPaidAt),
        };
      });
    } catch (e) {
      console.warn('[me] referrals query failed', e.code || '', e.message);
    }
    const activeReferrals = referrals.filter(r => r.subscriptionStatus === 'ACTIVE').length;
    const totalReferrals = referrals.length;

    let credits = [];
    try {
      const creditsQ = await billingRef.collection('credits')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      credits = creditsQ.docs.map(d => {
        const c = d.data();
        return {
          id: d.id,
          fromUid: c.fromUid || null,
          fromEmail: maskEmail(c.fromEmail),
          amountCents: c.amountCents || 0,
          appliedAt: tsToIso(c.appliedAt),
          appliedAmountCents: c.appliedAmountCents || null,
          appliedToPaymentId: c.appliedToPaymentId || null,
          createdAt: tsToIso(c.createdAt),
          voidedAt: tsToIso(c.voidedAt),
        };
      });
    } catch (e) {
      console.warn('[me] credits query failed', e.code || '', e.message);
    }

    let pendingDiscountCents = 0;
    let totalReferralEarningsCents = 0;
    for (const c of credits) {
      if (c.voidedAt) continue; // créditos revertidos por refund não contam
      totalReferralEarningsCents += c.amountCents;
      if (!c.appliedAt) pendingDiscountCents += c.amountCents;
    }

    let payments = [];
    try {
      const paymentsQ = await userRef.collection('payments')
        .orderBy('receivedAt', 'desc')
        .limit(20)
        .get();
      payments = paymentsQ.docs.map(d => {
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
    } catch (e) {
      console.warn('[me] payments query failed', e.code || '', e.message);
    }

    const monthlyCents = billing.subscriptionBaseValueCents || billing.monthlyPriceCents || 1500;
    const projectedNextCents = Math.max(100, monthlyCents - Math.min(pendingDiscountCents, monthlyCents - 100));

    const upcoming = buildUpcoming(billing, payments, projectedNextCents, monthlyCents);

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
      paymentMethod: billing.paymentMethod || null,
      cardBrand: billing.cardBrand || null,
      cardLast4: billing.cardLast4 || null,
      cardHolderName: billing.cardHolderName || null,
      nextDueDate: billing.nextDueDate || null,
      dunningRetryCount: billing.dunningRetryCount || 0,
      lastFailureReason: billing.lastFailureReason || null,
      cancelledAt: tsToIso(billing.cancelledAt),
      customer: {
        name: billing.customerName || null,
        email: billing.customerEmail || null,
        cpfCnpj: billing.cpfCnpj || null,
        phone: billing.customerPhone || null,
        postalCode: billing.customerPostalCode || null,
        address: billing.customerAddress || null,
        addressNumber: billing.customerAddressNumber || null,
        complement: billing.customerComplement || null,
        province: billing.customerProvince || null,
        city: billing.customerCity || null,
        state: billing.customerState || null,
      },
      upcomingCharges: upcoming,
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
