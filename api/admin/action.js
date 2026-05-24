const { db, auth, timestamp, fieldValue } = require('../_lib/firebase-admin');
const { cors } = require('../_lib/auth');

// Ações administrativas pontuais sobre um utilizador específico.
// Autenticação igual à de `stats.js`: header `Authorization: Bearer <ADMIN_API_TOKEN>`.
//
// Cada ação executada é registada em `adminAuditLog/{autoId}` para rastreio.
// Custo: 1 lookup auth + 1-2 ops Firestore + 1 write audit por chamada.

const DESTRUCTIVE_ACTIONS = new Set(['reset_billing', 'make_pro', 'disable_user', 'suspend_trial']);

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

  const { action, email: inputEmail, actionValue } = req.body || {};
  if (!action || !inputEmail) return res.status(400).json({ error: 'missing_params' });

  // Identificador opcional do actor para auditoria (não autentica, só rastreia).
  const actor = (req.headers['x-admin-actor'] || '').toString().slice(0, 120) || 'admin';

  try {
    let userRecord;
    if (inputEmail.indexOf('@') === -1 && inputEmail.length >= 20) {
      try {
        userRecord = await auth().getUser(inputEmail);
      } catch (e) {
        userRecord = await auth().getUserByEmail(inputEmail);
      }
    } else {
      userRecord = await auth().getUserByEmail(inputEmail);
    }
    const uid = userRecord.uid;
    const email = userRecord.email || inputEmail;
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

    if (action === 'suspend_trial') {
      const beforeSnap = await docRef.get();
      const beforeData = beforeSnap.data() || {};
      const beforeTrial = beforeData.trialEndsAt;
      const beforeMs = beforeTrial && typeof beforeTrial.toMillis === 'function' ? beforeTrial.toMillis() : null;
      // Idempotente: se trial já expirou (ou não existe), nada a fazer.
      if (!beforeMs || beforeMs <= Date.now()) {
        return res.json({ success: true, message: 'Trial já estava expirado/inexistente — nada a alterar.' });
      }
      const newTrialEndsAt = timestamp().now();
      await docRef.set({ trialEndsAt: newTrialEndsAt }, { merge: true });
      await writeAudit({
        action, email, uid, actor,
        before: { trialEndsAt: new Date(beforeMs).toISOString() },
        after: { trialEndsAt: newTrialEndsAt.toDate().toISOString() },
      });
      return res.json({ success: true, message: 'Trial suspenso (expirado agora).' });
    }

    if (action === 'gift_pro_days') {
      const days = parseInt(actionValue) || 7;
      const newTrialEndsAt = timestamp().fromMillis(Date.now() + days * 24 * 3600 * 1000);
      const beforeSnap = await docRef.get();
      const beforeTrial = beforeSnap.data() && beforeSnap.data().trialEndsAt;
      await docRef.set({ trialEndsAt: newTrialEndsAt }, { merge: true });
      await writeAudit({
        action, email, uid, actor,
        before: { trialEndsAt: beforeTrial ? beforeTrial.toDate().toISOString() : null },
        after: { trialEndsAt: newTrialEndsAt.toDate().toISOString() },
        extra: `Gifted ${days} days`
      });
      return res.json({ success: true, message: `Trial estendido por ${days} dias.` });
    }

    if (action === 'send_verify_link') {
      const link = await auth().generateEmailVerificationLink(email);
      await writeAudit({ action, email, uid, actor, after: { generated: true } });
      return res.json({ success: true, message: 'Link de verificação gerado.', link });
    }

    if (action === 'view_payments') {
      // Pagamentos vivem em users/{uid}/payments (subcoll do user doc),
      // NÃO em users/{uid}/billing/account/payments. Ver webhook.js:36-42.
      const userRef = db().collection('users').doc(uid);
      const snap = await userRef.collection('payments').get();
      const payments = [];
      snap.forEach(d => {
        const p = d.data();
        payments.push({
          id: d.id,
          status: p.status || '',
          value: p.value || 0,
          billingType: p.billingType || '',
          dueDate: p.dueDate || '',
          paymentDate: p.paymentDate || '',
          event: p.event || '',
          receivedAtMs: p.receivedAt && typeof p.receivedAt.toMillis === 'function' ? p.receivedAt.toMillis() : 0
        });
      });
      payments.sort((a, b) => b.receivedAtMs - a.receivedAtMs);
      return res.json({ success: true, payments });
    }

    if (action === 'full_xray') {
      const snap = await docRef.get();
      const b = snap.data() || {};
      // Pagamentos em users/{uid}/payments (ver webhook.js:36-42), não dentro de billing/account.
      const userRef = db().collection('users').doc(uid);
      const paySnap = await userRef.collection('payments').get();
      const payments = [];
      paySnap.forEach(d => {
        const p = d.data();
        payments.push({
          id: d.id,
          status: p.status || '',
          value: p.value || 0,
          billingType: p.billingType || '',
          dueDate: p.dueDate || '',
          paymentDate: p.paymentDate || '',
          event: p.event || '',
          receivedAtMs: p.receivedAt && typeof p.receivedAt.toMillis === 'function' ? p.receivedAt.toMillis() : 0
        });
      });
      payments.sort((a, b) => b.receivedAtMs - a.receivedAtMs);
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
      const authInfo = {
        emailVerified: !!userRecord.emailVerified,
        disabled: !!userRecord.disabled,
        creationTime: userRecord.metadata && userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata && userRecord.metadata.lastSignInTime,
        providerIds: userRecord.providerData ? userRecord.providerData.map(p => p.providerId) : []
      };
      return res.json({ uid, authInfo, resumo, payments, raw_billing: b });
    }

    if (action === 'force_verify') {
      await auth().updateUser(uid, { emailVerified: true });
      await writeAudit({ action, email, uid, actor, after: { emailVerified: true } });
      return res.json({ success: true, message: 'E-mail marcado como verificado.' });
    }

    if (action === 'password_reset_link') {
      const link = await auth().generatePasswordResetLink(email);
      await writeAudit({ action, email, uid, actor, after: { generated: true } });
      return res.json({ success: true, message: 'Link de reset gerado.', link });
    }

    if (action === 'disable_user') {
      await auth().updateUser(uid, { disabled: true });
      await writeAudit({ action, email, uid, actor, after: { disabled: true } });
      return res.json({ success: true, message: 'Conta suspensa (utilizador não consegue autenticar-se).' });
    }

    if (action === 'enable_user') {
      await auth().updateUser(uid, { disabled: false });
      await writeAudit({ action, email, uid, actor, after: { disabled: false } });
      return res.json({ success: true, message: 'Conta reativada.' });
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
