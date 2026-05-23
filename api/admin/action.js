const { db, auth, timestamp, fieldValue } = require('../_lib/firebase-admin');
const { cors } = require('../_lib/auth');

// Ações administrativas pontuais sobre um utilizador específico.
// Autenticação igual à de `stats.js`: header `Authorization: Bearer <ADMIN_API_TOKEN>`.
//
// Cada ação executada é registada em `adminAuditLog/{autoId}` para rastreio.
// Custo: 1 lookup auth + 1-2 ops Firestore + 1 write audit por chamada.

const DESTRUCTIVE_ACTIONS = new Set(['reset_billing', 'make_pro']);

async function writeAudit({ action, email, uid, actor, before, after, extra }) {
  try {
    await db().collection('adminAuditLog').add({
      action,
      email,
      uid,
      actor: actor || 'unknown',
      before: before || null,
      after: after || null,
      extra: extra || null,
      at: timestamp().now(),
    });
  } catch (e) {
    console.warn('[admin/action] audit_write_failed', e.message);
  }
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: 'admin_disabled',
      detail: 'Defina ADMIN_API_TOKEN no Vercel para ativar este endpoint.',
    });
  }
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { action, email, actionValue } = req.body || {};
  if (!action || !email) return res.status(400).json({ error: 'missing_params' });

  // Identificador opcional do actor para auditoria (não autentica, só rastreia).
  const actor = (req.headers['x-admin-actor'] || '').toString().slice(0, 120) || 'admin';

  try {
    const userRecord = await auth().getUserByEmail(email);
    const uid = userRecord.uid;
    const docRef = db().collection('users').doc(uid).collection('billing').doc('account');

    if (action === 'xray') {
      const snap = await docRef.get();
      const b = snap.data() || {};
      const resumo = {
        statusAsaas: b.subscriptionStatus || 'NÃO ASSINANTE',
        ultimoPagamento: b.lastPaymentStatus || 'N/A',
        descontoPendente: (b.stats && b.stats.pendingDiscountCents)
          ? `R$ ${(b.stats.pendingDiscountCents / 100).toFixed(2)}`
          : 'R$ 0,00',
        trialExpiraEm: (b.trialEndsAt && typeof b.trialEndsAt.toDate === 'function')
          ? b.trialEndsAt.toDate().toLocaleString('pt-BR')
          : 'N/A',
        idAsaas: b.customerId || 'Sem cliente',
        emailVerified: !!userRecord.emailVerified,
      };
      return res.json({ uid, resumo, raw_billing: b });
    }

    if (action === 'set_discount') {
      const reais = parseFloat(actionValue);
      if (!isFinite(reais)) return res.status(400).json({ error: 'invalid_value' });
      const cents = Math.round(reais * 100);
      const beforeSnap = await docRef.get();
      const beforeCents = (beforeSnap.data() && beforeSnap.data().stats && beforeSnap.data().stats.pendingDiscountCents) || 0;
      await docRef.set({ stats: { pendingDiscountCents: cents } }, { merge: true });
      await writeAudit({
        action, email, uid, actor,
        before: { pendingDiscountCents: beforeCents },
        after: { pendingDiscountCents: cents },
      });
      return res.json({ success: true, message: `Desconto atualizado para R$ ${reais.toFixed(2)}` });
    }

    if (action === 'make_pro') {
      const beforeSnap = await docRef.get();
      const before = beforeSnap.data() || null;
      await docRef.set({
        subscriptionStatus: 'ACTIVE',
        lastPaymentStatus: 'CONFIRMED',
      }, { merge: true });
      await writeAudit({
        action, email, uid, actor,
        before: before ? { subscriptionStatus: before.subscriptionStatus, lastPaymentStatus: before.lastPaymentStatus } : null,
        after: { subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'CONFIRMED' },
      });
      return res.json({ success: true, message: 'Utilizador promovido a PRO (acesso liberado).' });
    }

    if (action === 'extend_trial') {
      const newTrialEndsAt = timestamp().fromMillis(Date.now() + 7 * 24 * 3600 * 1000);
      const beforeSnap = await docRef.get();
      const beforeTrial = beforeSnap.data() && beforeSnap.data().trialEndsAt;
      await docRef.set({ trialEndsAt: newTrialEndsAt }, { merge: true });
      await writeAudit({
        action, email, uid, actor,
        before: { trialEndsAt: beforeTrial ? beforeTrial.toDate().toISOString() : null },
        after: { trialEndsAt: newTrialEndsAt.toDate().toISOString() },
      });
      return res.json({ success: true, message: 'Trial estendido por 7 dias.' });
    }

    if (action === 'force_verify') {
      await auth().updateUser(uid, { emailVerified: true });
      await writeAudit({ action, email, uid, actor, after: { emailVerified: true } });
      return res.json({ success: true, message: 'E-mail marcado como verificado.' });
    }

    if (action === 'reset_billing') {
      const beforeSnap = await docRef.get();
      const before = beforeSnap.exists ? beforeSnap.data() : null;
      await docRef.delete();
      await writeAudit({ action, email, uid, actor, before, after: null });
      return res.json({ success: true, message: 'Documento de billing apagado.' });
    }

    return res.status(400).json({ error: 'invalid_action' });
  } catch (e) {
    console.error('[admin/action]', e);
    return res.status(500).json({ error: 'action_failed', detail: e.message });
  }
};
