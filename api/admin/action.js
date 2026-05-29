const { db, auth, timestamp } = require('../_lib/firebase-admin');
const { handler } = require('../_lib/handler');
const { reconcileAccount } = require('../_lib/reconcile');

// Ações administrativas pontuais sobre um utilizador específico.
// Autenticação igual à de `stats.js`: header `Authorization: Bearer <ADMIN_API_TOKEN>`.
//
// Cada ação executada é registada em `adminAuditLog/{autoId}` para rastreio.
// Custo: 1 lookup auth + 1-2 ops Firestore + 1 write audit por chamada.

async function writeAudit({ action, email, uid, actor, before, after, extra }) {
  try {
    await db()
      .collection('adminAuditLog')
      .add({
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

// Admin endpoints usam token estático em vez de Firebase auth: gerenciamento
// fora-da-band do produto. auth: 'none' + check inline.
module.exports = handler({
  method: 'POST',
  auth: 'none',
  handle: async ({ req, res, body }) => {
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

    const { action, email: inputEmail, actionValue } = body || {};
    if (!action) return res.status(400).json({ error: 'missing_params' });

    // Identificador opcional do actor para auditoria (não autentica, só rastreia).
    const actor = (req.headers['x-admin-actor'] || '').toString().slice(0, 120) || 'admin';

    // ── Ações de conteúdo (não operam sobre um utilizador específico) ──
    // Tratadas antes da resolução por e-mail/UID, pois `inputEmail` é
    // irrelevante aqui (Dúvidas & Sugestões e carteira modelo do consultor).
    if (action === 'reply_feedback' || action === 'resolve_feedback') {
      try {
        const feedbackId = (body && body.feedbackId) || '';
        if (!feedbackId) return res.status(400).json({ error: 'missing_feedback_id' });
        const ref = db().collection('feedback').doc(feedbackId);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'feedback_not_found' });

        if (action === 'resolve_feedback') {
          await ref.set({ status: 'resolvido' }, { merge: true });
          await writeAudit({
            action,
            email: snap.data().email || '',
            uid: snap.data().uid || '',
            actor,
            extra: `feedback ${feedbackId} marcado como resolvido`,
          });
          return res.json({ success: true, message: 'Sugestão marcada como resolvida.' });
        }

        const replyText = ((body && body.replyText) || '').toString().trim();
        if (replyText.length < 2) return res.status(400).json({ error: 'empty_reply' });
        await ref.set(
          {
            reply: replyText.slice(0, 2000),
            status: 'respondido',
            repliedBy: actor,
            repliedAt: timestamp().now(),
          },
          { merge: true }
        );
        await writeAudit({
          action: 'reply_feedback',
          email: snap.data().email || '',
          uid: snap.data().uid || '',
          actor,
          extra: `feedback ${feedbackId} respondido`,
        });
        return res.json({ success: true, message: 'Resposta enviada ao utilizador.' });
      } catch (e) {
        console.error('[admin/action] feedback', e);
        return res.status(500).json({ error: 'action_failed', detail: e.message });
      }
    }

    if (action === 'save_carteira') {
      try {
        const carteira = body && body.carteira;
        if (!carteira || typeof carteira !== 'object') {
          return res.status(400).json({ error: 'missing_carteira' });
        }
        // Validação leve: alocações por perfil devem somar 100%.
        const alloc = carteira.alocacoes || {};
        for (const perfil of Object.keys(alloc)) {
          const soma = Object.values(alloc[perfil] || {}).reduce((s, v) => s + (Number(v) || 0), 0);
          if (Math.round(soma) !== 100) {
            return res
              .status(400)
              .json({ error: 'invalid_alloc', detail: `Perfil ${perfil} soma ${soma}%` });
          }
        }
        await db()
          .collection('config')
          .doc('carteiraModelo')
          .set(
            {
              versao: 2,
              mesAno: (carteira.mesAno || '').toString().slice(0, 40),
              descricao: (carteira.descricao || '').toString().slice(0, 400),
              alocacoes: alloc,
              ativos: carteira.ativos || {},
              updatedAt: timestamp().now(),
              updatedBy: actor,
            },
            { merge: false }
          );
        await writeAudit({
          action: 'save_carteira',
          actor,
          extra: `mesAno ${carteira.mesAno || ''}`,
        });
        return res.json({
          success: true,
          message: 'Carteira modelo publicada para todos os clientes.',
        });
      } catch (e) {
        console.error('[admin/action] save_carteira', e);
        return res.status(500).json({ error: 'action_failed', detail: e.message });
      }
    }

    if (!inputEmail) return res.status(400).json({ error: 'missing_params' });

    try {
      let userRecord;
      if (inputEmail.indexOf('@') === -1 && inputEmail.length >= 20) {
        try {
          userRecord = await auth().getUser(inputEmail);
        } catch (_e) {
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
          descontoPendente:
            b.stats && b.stats.pendingDiscountCents
              ? `R$ ${(b.stats.pendingDiscountCents / 100).toFixed(2)}`
              : 'R$ 0,00',
          trialExpiraEm:
            b.trialEndsAt && typeof b.trialEndsAt.toDate === 'function'
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
        const beforeCents =
          (beforeSnap.data() &&
            beforeSnap.data().stats &&
            beforeSnap.data().stats.pendingDiscountCents) ||
          0;
        await docRef.set({ stats: { pendingDiscountCents: cents } }, { merge: true });
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: { pendingDiscountCents: beforeCents },
          after: { pendingDiscountCents: cents },
        });
        return res.json({
          success: true,
          message: `Desconto atualizado para R$ ${reais.toFixed(2)}`,
        });
      }

      if (action === 'make_pro') {
        const beforeSnap = await docRef.get();
        const before = beforeSnap.data() || null;
        await docRef.set(
          {
            subscriptionStatus: 'ACTIVE',
            lastPaymentStatus: 'CONFIRMED',
          },
          { merge: true }
        );
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: before
            ? {
                subscriptionStatus: before.subscriptionStatus,
                lastPaymentStatus: before.lastPaymentStatus,
              }
            : null,
          after: { subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'CONFIRMED' },
        });
        return res.json({
          success: true,
          message: 'Utilizador promovido a PRO (acesso liberado).',
        });
      }

      if (action === 'extend_trial') {
        const newTrialEndsAt = timestamp().fromMillis(Date.now() + 7 * 24 * 3600 * 1000);
        const beforeSnap = await docRef.get();
        const beforeTrial = beforeSnap.data() && beforeSnap.data().trialEndsAt;
        await docRef.set({ trialEndsAt: newTrialEndsAt }, { merge: true });
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: { trialEndsAt: beforeTrial ? beforeTrial.toDate().toISOString() : null },
          after: { trialEndsAt: newTrialEndsAt.toDate().toISOString() },
        });
        return res.json({ success: true, message: 'Trial estendido por 7 dias.' });
      }

      if (action === 'suspend_trial') {
        const beforeSnap = await docRef.get();
        const beforeData = beforeSnap.data() || {};
        const beforeTrial = beforeData.trialEndsAt;
        const beforeMs =
          beforeTrial && typeof beforeTrial.toMillis === 'function' ? beforeTrial.toMillis() : null;
        // Idempotente: se trial já expirou (ou não existe), nada a fazer.
        if (!beforeMs || beforeMs <= Date.now()) {
          return res.json({
            success: true,
            message: 'Trial já estava expirado/inexistente — nada a alterar.',
          });
        }
        const newTrialEndsAt = timestamp().now();
        await docRef.set({ trialEndsAt: newTrialEndsAt }, { merge: true });
        await writeAudit({
          action,
          email,
          uid,
          actor,
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
          action,
          email,
          uid,
          actor,
          before: { trialEndsAt: beforeTrial ? beforeTrial.toDate().toISOString() : null },
          after: { trialEndsAt: newTrialEndsAt.toDate().toISOString() },
          extra: `Gifted ${days} days`,
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
        snap.forEach((d) => {
          const p = d.data();
          payments.push({
            id: d.id,
            status: p.status || '',
            value: p.value || 0,
            billingType: p.billingType || '',
            dueDate: p.dueDate || '',
            paymentDate: p.paymentDate || '',
            event: p.event || '',
            receivedAtMs:
              p.receivedAt && typeof p.receivedAt.toMillis === 'function'
                ? p.receivedAt.toMillis()
                : 0,
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
        paySnap.forEach((d) => {
          const p = d.data();
          payments.push({
            id: d.id,
            status: p.status || '',
            value: p.value || 0,
            billingType: p.billingType || '',
            dueDate: p.dueDate || '',
            paymentDate: p.paymentDate || '',
            event: p.event || '',
            receivedAtMs:
              p.receivedAt && typeof p.receivedAt.toMillis === 'function'
                ? p.receivedAt.toMillis()
                : 0,
          });
        });
        payments.sort((a, b) => b.receivedAtMs - a.receivedAtMs);
        const resumo = {
          statusAsaas: b.subscriptionStatus || 'NÃO ASSINANTE',
          ultimoPagamento: b.lastPaymentStatus || 'N/A',
          descontoPendente:
            b.stats && b.stats.pendingDiscountCents
              ? `R$ ${(b.stats.pendingDiscountCents / 100).toFixed(2)}`
              : 'R$ 0,00',
          trialExpiraEm:
            b.trialEndsAt && typeof b.trialEndsAt.toDate === 'function'
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
          providerIds: userRecord.providerData
            ? userRecord.providerData.map((p) => p.providerId)
            : [],
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
        return res.json({
          success: true,
          message: 'Conta suspensa (utilizador não consegue autenticar-se).',
        });
      }

      if (action === 'enable_user') {
        await auth().updateUser(uid, { disabled: false });
        await writeAudit({ action, email, uid, actor, after: { disabled: false } });
        return res.json({ success: true, message: 'Conta reativada.' });
      }

      if (action === 'reconcile_user') {
        // Reconcilia UMA conta sob demanda (eixo cobrança×Asaas + invariante de
        // crédito), reusando a mesma rotina do cron. Permite ao admin corrigir
        // um utilizador específico sem esperar a varredura noturna.
        const userRef = db().collection('users').doc(uid);
        const report = await reconcileAccount(userRef);
        const fixed = report.changes.filter((c) => !c.type.endsWith('_error'));
        const failed = report.changes.filter((c) => c.type.endsWith('_error'));
        await writeAudit({
          action,
          email,
          uid,
          actor,
          after: { changes: report.changes },
          extra: fixed.length
            ? `Corrigido: ${fixed.map((c) => c.type).join(', ')}`
            : 'Nenhuma divergência',
        });
        const msg = fixed.length
          ? `Reconciliado: ${fixed.length} correção(ões) aplicada(s).`
          : 'Conta já consistente — nada a corrigir.';
        return res.json({
          success: true,
          message: failed.length ? `${msg} (${failed.length} erro(s))` : msg,
          changes: report.changes,
        });
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
  },
});
