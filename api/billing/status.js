const { db } = require('../_lib/firebase-admin');
const { requireVerifiedUser, cors } = require('../_lib/auth');
const { computeAccess } = require('../_lib/access');
const { syncBillingFromAsaas } = require('../_lib/billing-sync');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireVerifiedUser(req, res);
  if (!user) return;

  try {
    const billingRef = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await billingRef.get();
    let billing = snap.exists ? snap.data() : null;

    // Sync com Asaas se temos subscriptionId mas ainda não confirmámos pagamento.
    // Acionar mesmo durante o trial: o utilizador pode pagar antes do trial expirar
    // e o webhook pode falhar — sem este sync, ficaria preso no banner "Assinar agora".
    const synced = await syncBillingFromAsaas(billingRef, billing);
    billing = synced.billing;
    const access = computeAccess(billing);

    return res.json({
      access,
      billing: billing ? {
        customerId: billing.customerId || null,
        subscriptionId: billing.subscriptionId || null,
        subscriptionStatus: billing.subscriptionStatus || null,
        lastPaymentStatus: billing.lastPaymentStatus || null,
        trialEndsAt: tsToIso(billing.trialEndsAt),
        referralCode: billing.referralCode || null,
        referredByCode: billing.referredByCode || null,
        recurringDiscountPercent: billing.recurringDiscountPercent || 0,
        monthlyPriceCents: billing.monthlyPriceCents || 1500,
        subscriptionBaseValueCents: billing.subscriptionBaseValueCents || null,
      } : null,
    });
  } catch (e) {
    console.error('[status]', e);
    return res.status(500).json({ error: 'status_failed' });
  }
};

function tsToIso(t) {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  return null;
}

