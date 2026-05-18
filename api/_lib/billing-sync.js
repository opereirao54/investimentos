const { fieldValue } = require('./firebase-admin');
const asaas = require('./asaas');

const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

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

module.exports = { syncBillingFromAsaas };
