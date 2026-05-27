const { db, fieldValue } = require('../_lib/firebase-admin');
const { handler } = require('../_lib/handler');
const asaas = require('../_lib/asaas');

module.exports = handler({
  method: 'POST',
  auth: 'verified',
  handle: async ({ res, user }) => {
    const ref = db().collection('users').doc(user.uid).collection('billing').doc('account');
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ error: 'billing_not_initialized' });
    const billing = snap.data();
    if (!billing.subscriptionId) return res.status(400).json({ error: 'no_subscription' });

    // Sempre tenta cancelar no Asaas: o estado local pode estar dessincronizado
    // (webhook perdido) e o utilizador continuaria a ser cobrado. Asaas DELETE
    // de uma subscription já cancelada devolve 404, que tratamos como sucesso.
    try {
      await asaas.cancelSubscription(billing.subscriptionId);
    } catch (e) {
      if (e.status === 404) {
        console.warn('[cancel] asaas subscription already gone', billing.subscriptionId);
      } else {
        console.error('[cancel] asaas delete failed', e, e.data);
        return res.status(e.status || 500).json({
          error: 'cancel_failed',
          detail: e.message,
          asaasErrors: (e.data && e.data.errors) || e.data || null,
        });
      }
    }
    if (billing.subscriptionStatus === 'INACTIVE') {
      return res.json({ ok: true, alreadyInactive: true });
    }

    await ref.set(
      {
        subscriptionStatus: 'INACTIVE',
        cancelledAt: fieldValue().serverTimestamp(),
        updatedAt: fieldValue().serverTimestamp(),
      },
      { merge: true }
    );

    return res.json({ ok: true });
  },
});
