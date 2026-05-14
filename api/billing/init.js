const { db, fieldValue, timestamp } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');
const { computeAccess, TRIAL_DAYS } = require('../_lib/access');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();

    if (snap.exists && snap.data().customerId) {
      const billing = snap.data();
      return res.json({ access: computeAccess(billing), billing: safeBilling(billing) });
    }

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
      createdAt: snap.exists && snap.data().createdAt ? snap.data().createdAt : timestamp().fromMillis(now),
      trialStartsAt: timestamp().fromMillis(now),
      trialEndsAt: timestamp().fromMillis(trialEnd),
      subscriptionId: null,
      subscriptionStatus: null,
      lastPaymentStatus: null,
      lastPaymentId: null,
      updatedAt: fieldValue().serverTimestamp(),
    };
    await ref.set(data, { merge: true });

    return res.json({ access: computeAccess(data), billing: safeBilling(data) });
  } catch (e) {
    console.error('[init]', e);
    return res.status(500).json({ error: 'init_failed', detail: e.message });
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
  };
}
function tsToIso(t) {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  if (typeof t === 'number') return new Date(t).toISOString();
  return null;
}
