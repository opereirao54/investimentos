const { db, auth, timestamp, fieldValue } = require('../_lib/firebase-admin');
const asaas = require('../_lib/asaas');
const { handler } = require('../_lib/handler');
const { reconcileAccount } = require('../_lib/reconcile');
const { computeAccess, isLegacyGrant } = require('../_lib/access');
const convites = require('../_lib/convites');

// Ações administrativas pontuais sobre um usuário específico.
// Autenticação igual à de `stats.js`: header `Authorization: Bearer <ADMIN_API_TOKEN>`.
//
// Cada ação executada é registrada em `adminAuditLog/{autoId}` para rastreio.
// Custo: 1 lookup auth + 1-2 ops Firestore + 1 write audit por chamada.

/** O que a aba Convites do admin mostra. */
async function estadoConvites(D) {
  const cfg = await convites.lerConfig(D);
  return {
    obrigatorio: cfg.obrigatorio,
    dataLancamento: cfg.dataLancamento,
    fimCortesiaMs: convites.fimCortesiaMs(cfg.dataLancamento),
    ultimoDiaGratis: convites.ultimoDiaGratisTexto(cfg.dataLancamento),
    descontoPercent: convites.DESCONTO_TESTADOR,
    itens: await convites.listar(D),
  };
}

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

    // ── Ações de conteúdo (não operam sobre um usuário específico) ──
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
        return res.json({ success: true, message: 'Resposta enviada ao usuário.' });
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

    // ── Convites da fase de testes (api/_lib/convites.js) ──
    if (
      action === 'convites_listar' ||
      action === 'convites_gerar' ||
      action === 'convites_cancelar' ||
      action === 'convites_modo' ||
      action === 'convites_lancamento'
    ) {
      try {
        const D = db();
        const ts = timestamp();
        if (action === 'convites_modo') {
          const ligado = await convites.definirModo(
            D,
            body && body.obrigatorio === true,
            actor,
            ts
          );
          await writeAudit({
            action,
            email: '',
            uid: '',
            actor,
            extra: ligado
              ? 'cadastro só com convite: LIGADO'
              : 'cadastro só com convite: DESLIGADO',
          });
        }
        if (action === 'convites_gerar') {
          const criados = await convites.gerar(
            D,
            { quantidade: body && body.quantidade, nota: body && body.nota, actor },
            ts
          );
          await writeAudit({
            action,
            email: '',
            uid: '',
            actor,
            extra: `${criados.length} convite(s)${body && body.nota ? ' — ' + String(body.nota).slice(0, 120) : ''}`,
          });
          return res.json({ success: true, criados, ...(await estadoConvites(D)) });
        }
        let recalculados = null;
        if (action === 'convites_lancamento') {
          const r = await convites.aplicarLancamento(
            D,
            String((body && body.data) || '').trim(),
            actor,
            ts,
            fieldValue()
          );
          if (!r.ok) return res.status(400).json({ error: r.erro });
          recalculados = r.atualizados;
          await writeAudit({
            action,
            email: '',
            uid: '',
            actor,
            extra: `data de lançamento: ${r.dataLancamento || '(sem data)'} — ${r.atualizados} testador(es) recalculado(s)`,
          });
        }
        if (action === 'convites_cancelar') {
          const r = await convites.cancelar(D, body && body.codigo, actor, ts);
          if (!r.ok) return res.status(400).json({ error: r.erro });
          await writeAudit({
            action,
            email: '',
            uid: '',
            actor,
            extra: `convite ${r.codigo} cancelado`,
          });
        }
        return res.json({ success: true, recalculados, ...(await estadoConvites(D)) });
      } catch (e) {
        console.error('[admin/action] convites', e);
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
          cortesia:
            b.courtesyPermanent === true
              ? 'PRO sem prazo'
              : b.courtesyUntil && typeof b.courtesyUntil.toDate === 'function'
                ? 'até ' + b.courtesyUntil.toDate().toLocaleString('pt-BR')
                : 'não',
          acesso: computeAccess(b).status + ' (' + computeAccess(b).reason + ')',
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

      // Situação da assinatura no Asaas, para o admin saber se a cortesia
      // convive com cobranças reais. Cortesia libera o acesso, mas NÃO para
      // o Asaas: uma assinatura viva continua emitindo e cobrando faturas
      // (no cartão, debita sozinha). Avisar aqui evita o usuário Pro que
      // recebe e-mail de "fatura vencida" sem entender por quê.
      const liveSubWarning = (b) =>
        b && b.subscriptionId && b.subscriptionStatus && b.subscriptionStatus !== 'INACTIVE'
          ? ' Atenção: a assinatura no Asaas continua ativa e segue cobrando. Se a cortesia substitui o pagamento, use "Cancelar assinatura no Asaas".'
          : '';
      const courtesySnapshot = (b) =>
        b
          ? {
              courtesyPermanent: b.courtesyPermanent === true,
              courtesyUntil:
                b.courtesyUntil && typeof b.courtesyUntil.toDate === 'function'
                  ? b.courtesyUntil.toDate().toISOString()
                  : null,
            }
          : null;

      if (action === 'make_pro') {
        // PRO permanente = cortesia sem prazo. Não mexe em subscriptionStatus
        // nem lastPaymentStatus: esses campos são do Asaas, e fingir um
        // pagamento ali é o que fazia a conta "liberada" aparecer com
        // pagamento pendente (ver courtesyState em _lib/access.js).
        const beforeSnap = await docRef.get();
        const before = beforeSnap.data() || null;
        await docRef.set(
          {
            courtesyPermanent: true,
            courtesyUntil: fieldValue().delete(),
            courtesyGrantedAt: timestamp().now(),
            courtesyGrantedBy: actor,
          },
          { merge: true }
        );
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: courtesySnapshot(before),
          after: { courtesyPermanent: true, courtesyUntil: null },
        });
        return res.json({
          success: true,
          message: 'Acesso PRO liberado sem prazo (cortesia).' + liveSubWarning(before),
        });
      }

      if (action === 'revoke_pro') {
        const beforeSnap = await docRef.get();
        const before = beforeSnap.data() || null;
        // "PRO" antigo: o make_pro anterior gravava ACTIVE+CONFIRMED sem
        // assinatura nem pagamento por trás. Revogar também desfaz isso.
        const legacy = isLegacyGrant(before);
        if (!before || (before.courtesyPermanent !== true && !before.courtesyUntil && !legacy)) {
          return res.json({
            success: true,
            message: 'Usuário não tinha cortesia — nada a revogar.',
          });
        }
        await docRef.set(
          {
            courtesyPermanent: fieldValue().delete(),
            courtesyUntil: fieldValue().delete(),
            courtesyRevokedAt: timestamp().now(),
            courtesyRevokedBy: actor,
            ...(legacy
              ? {
                  subscriptionStatus: fieldValue().delete(),
                  lastPaymentStatus: fieldValue().delete(),
                }
              : {}),
          },
          { merge: true }
        );
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: courtesySnapshot(before),
          after: { courtesyPermanent: false, courtesyUntil: null },
        });
        return res.json({
          success: true,
          message:
            'Cortesia revogada. O acesso volta a depender de trial ou pagamento (ciclos já pagos continuam valendo).',
        });
      }

      if (action === 'cancel_asaas_sub') {
        // Mesmo efeito do "Cancelar assinatura" do próprio usuário
        // (api/billing/cancel.js): para as cobranças no Asaas — que apaga as
        // faturas projetadas — e marca INACTIVE. O ciclo já pago continua
        // valendo pelo paid_period.
        const beforeSnap = await docRef.get();
        const before = beforeSnap.data() || {};
        if (!before.subscriptionId) {
          return res.json({ success: true, message: 'Usuário não tem assinatura no Asaas.' });
        }
        try {
          await asaas.cancelSubscription(before.subscriptionId);
        } catch (e) {
          if (e.status !== 404) {
            return res.status(e.status || 500).json({ error: 'cancel_failed', detail: e.message });
          }
        }
        await docRef.set(
          {
            subscriptionStatus: 'INACTIVE',
            cancelledAt: timestamp().now(),
            updatedAt: timestamp().now(),
          },
          { merge: true }
        );
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: { subscriptionStatus: before.subscriptionStatus || null },
          after: { subscriptionStatus: 'INACTIVE' },
          extra: 'subscription ' + before.subscriptionId,
        });
        return res.json({
          success: true,
          message: 'Assinatura cancelada no Asaas. Nenhuma cobrança nova será emitida.',
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
        // Antes regravava trialEndsAt = agora + N: a conta aparecia como
        // "avaliação gratuita" e, pior, ENCURTAVA um trial ou presente maior
        // já existente. Agora é cortesia com prazo, e o prazo soma ao que o
        // usuário já tinha de cortesia — ninguém perde dias que já ganhou.
        const days = parseInt(actionValue, 10) || 7;
        if (days < 1 || days > 3650) return res.status(400).json({ error: 'invalid_value' });
        const beforeSnap = await docRef.get();
        const before = beforeSnap.data() || null;
        if (before && before.courtesyPermanent === true) {
          return res.json({
            success: true,
            message: 'Usuário já tem PRO sem prazo — nada a somar.',
          });
        }
        const currentUntil =
          before && before.courtesyUntil && typeof before.courtesyUntil.toMillis === 'function'
            ? before.courtesyUntil.toMillis()
            : 0;
        const base = Math.max(Date.now(), currentUntil);
        const newUntil = timestamp().fromMillis(base + days * 24 * 3600 * 1000);
        await docRef.set(
          {
            courtesyUntil: newUntil,
            courtesyGrantedAt: timestamp().now(),
            courtesyGrantedBy: actor,
          },
          { merge: true }
        );
        await writeAudit({
          action,
          email,
          uid,
          actor,
          before: courtesySnapshot(before),
          after: { courtesyUntil: newUntil.toDate().toISOString() },
          extra: `Gifted ${days} days`,
        });
        return res.json({
          success: true,
          message:
            `PRO de cortesia por +${days} dias — até ${newUntil.toDate().toLocaleDateString('pt-BR')}.` +
            liveSubWarning(before),
        });
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
          cortesia:
            b.courtesyPermanent === true
              ? 'PRO sem prazo'
              : b.courtesyUntil && typeof b.courtesyUntil.toDate === 'function'
                ? 'até ' + b.courtesyUntil.toDate().toLocaleString('pt-BR')
                : 'não',
          acesso: computeAccess(b).status + ' (' + computeAccess(b).reason + ')',
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
          message: 'Conta suspensa (usuário não consegue entrar).',
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
        // um usuário específico sem esperar a varredura noturna.
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
