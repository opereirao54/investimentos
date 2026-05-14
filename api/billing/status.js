const { db, fieldValue } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const { computeAccess } = require('../_lib/access');
const asaas = require('../_lib/asaas');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const billingRef = db().collection('users').doc(user.uid).collection('billing').doc('account');
    let snap = await billingRef.get();
    let billing = snap.exists ? snap.data() : null;
    let access = computeAccess(billing);

    // Fallback: se tem subscriptionId mas acesso não é 'active', sincronizar com Asaas
    if (billing && billing.subscriptionId && access.status !== 'active' && access.status !== 'trial') {
      try {
        console.log('[status] access not active, syncing with Asaas for subscription', billing.subscriptionId);
        const payments = await asaas.listPaymentsBySubscription(billing.subscriptionId);
        const paid = payments && payments.data && payments.data.find(p =>
          p.status === 'CONFIRMED' || p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH'
        );
        if (paid) {
          console.log('[status] found paid payment from Asaas, updating billing', paid.id, paid.status);
          const update = {
            subscriptionStatus: 'ACTIVE',
            lastPaymentStatus: paid.status,
            lastPaymentId: paid.id,
            lastPaidAt: fieldValue().serverTimestamp(),
            lastEvent: 'PAYMENT_' + paid.status,
            updatedAt: fieldValue().serverTimestamp(),
          };
          await billingRef.set(update, { merge: true });

          // Reler o billing atualizado
          snap = await billingRef.get();
          billing = snap.exists ? snap.data() : null;
          access = computeAccess(billing);
        }
      } catch (syncErr) {
        console.warn('[status] Asaas sync fallback failed', syncErr.message || syncErr);
      }
    }

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

