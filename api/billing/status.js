const { db } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const { computeAccess } = require('../_lib/access');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const snap = await db().collection('users').doc(user.uid).collection('billing').doc('account').get();
    const billing = snap.exists ? snap.data() : null;
    const access = computeAccess(billing);
    return res.json({
      access,
      billing: billing ? {
        customerId: billing.customerId || null,
        subscriptionId: billing.subscriptionId || null,
        subscriptionStatus: billing.subscriptionStatus || null,
        lastPaymentStatus: billing.lastPaymentStatus || null,
        trialEndsAt: tsToIso(billing.trialEndsAt),
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
