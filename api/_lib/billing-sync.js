const { db, fieldValue } = require('./firebase-admin');
const asaas = require('./asaas');

const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const NON_FINAL_STATUSES = new Set(['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS', 'AUTHORIZED']);

/**
 * Liberta créditos referral que tinham sido aplicados a uma fatura que
 * foi apagada/reembolsada pelo Asaas. Sem isto, o desconto fica preso:
 * o crédito permanece marcado como `appliedAt`/`appliedToPaymentId` mas
 * a fatura onde ele ia abater já não existe — o utilizador perde o saldo.
 *
 * Repõe também `stats.pendingDiscountCents` para que a próxima fatura
 * volte a poder consumir esse saldo via `applyPendingCreditsTo`.
 * Idempotente: créditos já invalidados (`voidedAt`) não voltam, e
 * créditos sem `appliedAmountCents` ficam fora da soma.
 */
async function releaseAppliedCredits(billingRef, paymentId) {
  if (!billingRef || !paymentId) return 0;
  let snap;
  try {
    snap = await billingRef.collection('credits').where('appliedToPaymentId', '==', paymentId).get();
  } catch (e) {
    console.warn('[credits] release lookup failed', e && e.message);
    return 0;
  }
  if (snap.empty) return 0;

  const toRelease = [];
  let restored = 0;
  snap.docs.forEach((d) => {
    const c = d.data() || {};
    if (c.voidedAt) return; // crédito já anulado: não devolve saldo
    const amount = c.appliedAmountCents || 0;
    if (amount <= 0) return;
    restored += amount;
    toRelease.push(d.ref);
  });
  if (restored <= 0) return 0;

  const batch = db().batch();
  toRelease.forEach((ref) => {
    batch.set(ref, {
      appliedAt: null,
      appliedToPaymentId: null,
      appliedAmountCents: fieldValue().delete(),
    }, { merge: true });
  });
  batch.set(billingRef, {
    stats: { pendingDiscountCents: fieldValue().increment(restored) },
    updatedAt: fieldValue().serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return restored;
}

/**
 * Reconcilia registos locais de pagamentos que ainda estão em estado
 * não-final (PENDING/OVERDUE/...). Detecta pagamentos que foram
 * actualizados ou apagados no Asaas sem o webhook correspondente chegar
 * — caso típico de exclusão manual via painel Asaas, que não dispara
 * PAYMENT_DELETED em alguns cenários. Sem isto, o histórico continua a
 * mostrar "Pendente" para uma fatura que já não existe.
 */
async function reconcileNonFinalPayments(userRef, subscriptionId, remoteList) {
  if (!userRef || !subscriptionId) return;
  const remoteById = new Map();
  for (const p of (remoteList || [])) {
    if (p && p.id) remoteById.set(p.id, p);
  }
  let snap;
  try {
    snap = await userRef.collection('payments').orderBy('receivedAt', 'desc').limit(20).get();
  } catch (e) {
    console.warn('[billing-sync] read local payments failed', e && e.message);
    return;
  }
  const writes = [];
  const deletedPaymentIds = [];
  snap.docs.forEach((d) => {
    const local = d.data() || {};
    if (!NON_FINAL_STATUSES.has(local.status)) return;
    const remote = remoteById.get(local.id || d.id);
    if (!remote) {
      // Pagamento desapareceu do Asaas — foi apagado.
      writes.push(
        userRef.collection('payments').doc(d.id).set({
          status: 'DELETED',
          event: 'SYNC_DELETED',
          receivedAt: fieldValue().serverTimestamp(),
        }, { merge: true })
      );
      deletedPaymentIds.push(local.id || d.id);
      return;
    }
    if (remote.status && remote.status !== local.status) {
      writes.push(
        userRef.collection('payments').doc(d.id).set({
          status: remote.status,
          value: remote.value || null,
          netValue: remote.netValue || null,
          billingType: remote.billingType || null,
          dueDate: remote.dueDate || null,
          paymentDate: remote.paymentDate || null,
          invoiceUrl: remote.invoiceUrl || null,
          bankSlipUrl: remote.bankSlipUrl || null,
          transactionReceiptUrl: remote.transactionReceiptUrl || null,
          event: 'SYNC_' + remote.status,
          receivedAt: fieldValue().serverTimestamp(),
        }, { merge: true })
      );
    }
  });
  if (writes.length) {
    try { await Promise.all(writes); }
    catch (e) { console.warn('[billing-sync] reconcile payments write failed', e && e.message); }
  }
  // Devolve qualquer crédito que tinha sido aplicado a faturas apagadas
  // no Asaas sem webhook PAYMENT_DELETED ter chegado. Sequencial para
  // não disparar 12 transações batch em paralelo num cancelamento típico.
  if (deletedPaymentIds.length) {
    const billingRef = userRef.collection('billing').doc('account');
    for (const pid of deletedPaymentIds) {
      try { await releaseAppliedCredits(billingRef, pid); }
      catch (e) { console.warn('[billing-sync] release credits failed', e && e.message); }
    }
  }
}

/**
 * Garante que o billing local reflete o Asaas quando o webhook não chegou.
 * Retorna o snapshot/dados atualizados se houve mudança; caso contrário, devolve o original.
 *
 * Aciona quando há subscriptionId e ainda não temos confirmação de pagamento
 * registada (lastPaidAt vazio) — independentemente do status de acesso, para
 * cobrir pagamento feito durante o trial.
 */
async function syncBillingFromAsaas(billingRef, billing) {
  if (!billing || !billing.subscriptionId) return { billing, updated: false };

  // Quando já há lastPaidAt, ainda fazemos um re-check leve da própria
  // subscription (não os pagamentos) para apanhar cancelamento server-side
  // que perdemos via webhook. Limitado a 1x por hora para não inundar Asaas.
  if (billing.lastPaidAt) {
    const lastSync = billing.lastSubscriptionSyncAt && typeof billing.lastSubscriptionSyncAt.toMillis === 'function'
      ? billing.lastSubscriptionSyncAt.toMillis() : 0;
    const SYNC_INTERVAL_MS = 60 * 60 * 1000;
    if ((Date.now() - lastSync) < SYNC_INTERVAL_MS) {
      return { billing, updated: false };
    }
    try {
      const sub = await asaas.getSubscription(billing.subscriptionId);
      const remoteStatus = sub && sub.status;
      const update = { lastSubscriptionSyncAt: fieldValue().serverTimestamp() };
      // Asaas marcou como INACTIVE/EXPIRED mas o nosso ainda diz ACTIVE.
      if (remoteStatus && remoteStatus !== billing.subscriptionStatus
          && (remoteStatus === 'INACTIVE' || remoteStatus === 'EXPIRED')) {
        update.subscriptionStatus = 'INACTIVE';
        update.cancelledAt = fieldValue().serverTimestamp();
        update.lastEvent = 'SUBSCRIPTION_SYNC_INACTIVATED';
        update.updatedAt = fieldValue().serverTimestamp();
        await billingRef.set(update, { merge: true });
        const snap = await billingRef.get();
        return { billing: snap.exists ? snap.data() : billing, updated: true };
      }
      // Atualiza valor base e próxima data se mudaram em Asaas.
      if (sub && typeof sub.value === 'number') {
        const remoteCents = Math.round(sub.value * 100);
        if (remoteCents !== billing.subscriptionBaseValueCents) {
          update.subscriptionBaseValueCents = remoteCents;
        }
      }
      if (sub && sub.nextDueDate && sub.nextDueDate !== billing.nextDueDate) {
        update.nextDueDate = sub.nextDueDate;
      }
      await billingRef.set(update, { merge: true });

      // Reconcilia status de pagamentos pendentes (fatura apagada/avançada
      // sem webhook). Só rodamos isto na janela de sync horária acima
      // para não pesar em cada request.
      const userRef = billingRef.parent && billingRef.parent.parent;
      if (userRef) {
        try {
          const list = await asaas.listPaymentsBySubscription(billing.subscriptionId);
          // C7: o reconcile deduz "fatura apagada" pela ausência no array
          // remoto. Se o Asaas devolver uma resposta sem o campo `data` ou
          // com `data` não-array (erro HTTP mascarado em 200, body
          // truncado, mudança de schema), passar `[]` faria com que todas
          // as faturas locais pendentes virassem DELETED na próxima sync.
          // Exige forma estrita antes de prosseguir.
          if (list && Array.isArray(list.data)) {
            await reconcileNonFinalPayments(userRef, billing.subscriptionId, list.data);
          } else {
            console.warn('[billing-sync] skipping reconcile: unexpected listPayments shape');
          }
        } catch (e) {
          console.warn('[billing-sync] reconcile listPayments failed', e && e.message);
        }
      }
    } catch (e) {
      console.warn('[billing-sync] getSubscription failed', e.message || e);
    }
    return { billing, updated: false };
  }

  let payments;
  try {
    payments = await asaas.listPaymentsBySubscription(billing.subscriptionId);
  } catch (e) {
    console.warn('[billing-sync] listPayments failed', e.message || e);
    return { billing, updated: false };
  }
  const list = (payments && payments.data) || [];
  const paid = list.find(p => PAID_STATUSES.has(p.status));
  if (!paid) return { billing, updated: false };

  console.log('[billing-sync] applying paid payment', paid.id, paid.status, 'sub=', billing.subscriptionId);

  const update = {
    subscriptionStatus: 'ACTIVE',
    lastPaymentStatus: paid.status,
    lastPaymentId: paid.id,
    lastPaidAt: fieldValue().serverTimestamp(),
    lastEvent: 'PAYMENT_' + paid.status + '_SYNCED',
    updatedAt: fieldValue().serverTimestamp(),
  };
  await billingRef.set(update, { merge: true });

  const userRef = billingRef.parent.parent;
  if (userRef) {
    try {
      await userRef.collection('payments').doc(paid.id).set({
        id: paid.id,
        status: paid.status,
        value: paid.value || null,
        netValue: paid.netValue || null,
        billingType: paid.billingType || null,
        dueDate: paid.dueDate || null,
        paymentDate: paid.paymentDate || null,
        invoiceUrl: paid.invoiceUrl || null,
        bankSlipUrl: paid.bankSlipUrl || null,
        transactionReceiptUrl: paid.transactionReceiptUrl || null,
        subscriptionId: paid.subscription || billing.subscriptionId,
        event: 'SYNC_' + paid.status,
        receivedAt: fieldValue().serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn('[billing-sync] payments write failed', e.message || e);
    }
  }

  const snap = await billingRef.get();
  return { billing: snap.exists ? snap.data() : billing, updated: true };
}

module.exports = { syncBillingFromAsaas, releaseAppliedCredits };
