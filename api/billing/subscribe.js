const { db, fieldValue } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');
const asaas = require('../_lib/asaas');

function formatDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    if (!snap.exists || !snap.data().customerId) {
      return res.status(400).json({ error: 'billing_not_initialized' });
    }
    const billing = snap.data();

    if (billing.subscriptionId) {
      const payments = await asaas.listPaymentsBySubscription(billing.subscriptionId).catch(() => null);
      const pending = payments && payments.data && payments.data.find(p => p.status === 'PENDING' || p.status === 'OVERDUE');
      if (pending) {
        return res.json({
          subscriptionId: billing.subscriptionId,
          invoiceUrl: pending.invoiceUrl,
          status: pending.status,
        });
      }
      return res.json({ subscriptionId: billing.subscriptionId, alreadyActive: true });
    }

    const nextDue = formatDate(new Date(Date.now() + 24 * 3600 * 1000));
    const sub = await asaas.createSubscription({
      customerId: billing.customerId,
      uid: user.uid,
      nextDueDate: nextDue,
    });

    await ref.set({
      subscriptionId: sub.id,
      subscriptionStatus: sub.status || 'ACTIVE',
      updatedAt: fieldValue().serverTimestamp(),
    }, { merge: true });

    let invoiceUrl = null;
    try {
      const payments = await asaas.listPaymentsBySubscription(sub.id);
      const first = payments && payments.data && payments.data[0];
      if (first) invoiceUrl = first.invoiceUrl;
    } catch (_) {}

    return res.json({ subscriptionId: sub.id, invoiceUrl, status: sub.status });
  } catch (e) {
    console.error('[subscribe]', e, e.data);
    return res.status(500).json({ error: 'subscribe_failed', detail: e.message });
  }
};
