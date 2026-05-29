'use strict';

// Reconciliação proativa de billing — rede de proteção contra divergência
// silenciosa. Ataca dois medos concretos:
//
//  1. COBRANÇA × ACESSO DIVERGIR. Hoje syncBillingFromAsaas() só roda quando
//     o usuário REABRE o app (/api/billing/me, /api/billing/init). Se o
//     webhook do Asaas se perde E o usuário não volta, a divergência fica
//     presa: pagou e segue bloqueado, ou cancelou e segue com acesso. Este
//     módulo roda a MESMA sincronização proativamente (cron), varrendo todas
//     as contas independentemente de atividade.
//
//  2. APPLICASH/CUPOM ERRAR CONTA. stats.pendingDiscountCents e
//     stats.totalReferralEarningsCents são contadores ACUMULADOS, somados e
//     subtraídos em ~6 caminhos (webhook, release, reverse, ajuste manual no
//     admin). Qualquer incremento perdido faz o saldo desgarrar da soma real
//     dos documentos de crédito — e ninguém percebe. Aqui recomputamos a
//     verdade a partir dos créditos e corrigimos o contador quando diverge.
//
// Princípio: toda correção é REPORTADA (retorno estruturado + alerta Sentry).
// O objetivo é tornar a divergência VISÍVEL, não corrigir às cegas.

const { db, fieldValue } = require('./firebase-admin');
const { syncBillingFromAsaas } = require('./billing-sync');
const { captureMessage } = require('./sentry');

/**
 * Fonte de verdade do saldo Applicash: derivado dos documentos de crédito.
 * Espelha exatamente a regra de api/billing/me.js — crédito anulado (voidedAt)
 * sai da conta; crédito ainda não aplicado conta como desconto pendente.
 * Aceita tanto QuerySnapshot docs (com .data()) quanto objetos já mapeados.
 */
function computeCreditTotals(creditDocs) {
  let pendingDiscountCents = 0;
  let totalReferralEarningsCents = 0;
  for (const c of creditDocs || []) {
    const data = c && typeof c.data === 'function' ? c.data() : c;
    if (!data || data.voidedAt) continue;
    const amount = data.amountCents || 0;
    totalReferralEarningsCents += amount;
    if (!data.appliedAt) pendingDiscountCents += amount;
  }
  return { pendingDiscountCents, totalReferralEarningsCents };
}

/**
 * Verifica o invariante de crédito de UMA conta e corrige se desgarrou.
 * Retorna null quando os contadores já batem (nenhuma escrita); caso
 * contrário grava os valores canônicos e devolve o relatório de drift.
 */
async function reconcileCreditInvariant(billingRef) {
  const billingSnap = await billingRef.get();
  if (!billingSnap.exists) return null;
  const stats = (billingSnap.data() || {}).stats || {};

  const creditsSnap = await billingRef.collection('credits').get();
  const truth = computeCreditTotals(creditsSnap.docs);

  const curPending = stats.pendingDiscountCents || 0;
  const curEarnings = stats.totalReferralEarningsCents || 0;
  const pendingDrift = truth.pendingDiscountCents - curPending;
  const earningsDrift = truth.totalReferralEarningsCents - curEarnings;

  if (pendingDrift === 0 && earningsDrift === 0) return null;

  // Grava VALORES ABSOLUTOS (não increment): estamos corrigindo o contador
  // para a soma canônica dos créditos, não ajustando por delta.
  await billingRef.set(
    {
      stats: {
        pendingDiscountCents: truth.pendingDiscountCents,
        totalReferralEarningsCents: truth.totalReferralEarningsCents,
      },
      updatedAt: fieldValue().serverTimestamp(),
    },
    { merge: true }
  );

  return {
    pending: { from: curPending, to: truth.pendingDiscountCents, drift: pendingDrift },
    earnings: { from: curEarnings, to: truth.totalReferralEarningsCents, drift: earningsDrift },
  };
}

/**
 * Reconcilia UMA conta nos dois eixos (estado de cobrança + invariante de
 * crédito). Erros em um eixo não impedem o outro — cada falha vira uma
 * entrada de relatório em vez de derrubar a varredura inteira.
 */
async function reconcileAccount(userRef) {
  const billingRef = userRef.collection('billing').doc('account');
  const snap = await billingRef.get();
  if (!snap.exists) return { uid: userRef.id, changes: [] };

  const report = { uid: userRef.id, changes: [] };

  // Eixo 1: estado de cobrança × Asaas (reusa a sincronização já testada).
  try {
    const { updated } = await syncBillingFromAsaas(billingRef, snap.data());
    if (updated) report.changes.push({ type: 'billing_state' });
  } catch (e) {
    report.changes.push({ type: 'billing_state_error', detail: (e && e.message) || String(e) });
  }

  // Eixo 2: invariante de crédito Applicash.
  try {
    const drift = await reconcileCreditInvariant(billingRef);
    if (drift) report.changes.push({ type: 'credit_invariant', ...drift });
  } catch (e) {
    report.changes.push({ type: 'credit_invariant_error', detail: (e && e.message) || String(e) });
  }

  return report;
}

// Máximo de correções de crédito guardadas no histórico de uma varredura. O
// contador agregado (creditInvariantCorrected) é sempre exato; só a LISTA
// detalhada é truncada para não inchar o documento de histórico.
const MAX_PERSISTED_CORRECTIONS = 50;

// Deadline interno da varredura. A função Vercel tem maxDuration=15s; se a
// sweep não terminar dentro disso a plataforma MATA a função e devolve uma
// página de erro não-JSON ("An error occurred..."). Paramos bem antes, sempre
// devolvendo JSON válido + um cursor para retomar de onde paramos.
const SWEEP_SOFT_DEADLINE_MS = 12000;

// Onde o cron guarda o cursor entre execuções: como cada invocação só processa
// um lote (time-box), o cron retoma diariamente de onde parou e cobre toda a
// base ao longo de vários dias, em vez de reprocessar sempre o mesmo início.
function cronCursorRef() {
  return db().collection('reconcileState').doc('cron');
}

/**
 * Persiste o resultado de uma varredura em `reconcileRuns/{autoId}` para que o
 * painel admin tenha histórico — sem isto a divergência some no Sentry e o
 * admin nunca a vê. Best-effort: uma falha de escrita NUNCA derruba a
 * varredura (o trabalho de correção já foi feito; o log é secundário).
 */
async function persistRun(summary, source) {
  try {
    await db()
      .collection('reconcileRuns')
      .add({
        at: fieldValue().serverTimestamp(),
        source: source || 'manual',
        scanned: summary.scanned,
        billingStateCorrected: summary.billingStateCorrected,
        creditInvariantCorrected: summary.creditInvariantCorrected,
        errors: summary.errors,
        partial: !!summary.partial,
        nextCursor: summary.nextCursor || null,
        correctionsTruncated: summary.corrections.length > MAX_PERSISTED_CORRECTIONS,
        corrections: summary.corrections.slice(0, MAX_PERSISTED_CORRECTIONS),
      });
  } catch (e) {
    console.warn('[reconcile] persistRun failed', (e && e.message) || e);
  }
}

/**
 * Varre as contas de billing e reconcilia cada uma, em LOTES limitados pelo
 * tempo (SWEEP_SOFT_DEADLINE_MS) para nunca estourar o maxDuration da função.
 *
 * Opções:
 *   - limit: corta após N contas (teste/execução pontual).
 *   - source: 'cron' | 'manual' — rotula o histórico; 'cron' usa cursor
 *     persistido para avançar entre execuções diárias.
 *   - after: retoma a varredura logo após este uid (cursor do lote anterior).
 *   - deadlineMs: orçamento de tempo do lote (default SWEEP_SOFT_DEADLINE_MS).
 *
 * Devolve, além dos contadores, `partial` (true quando parou no deadline) e
 * `nextCursor` (uid a partir do qual retomar; null quando terminou tudo).
 */
async function runReconcileSweep({
  limit = 0,
  source = 'manual',
  after = null,
  deadlineMs = SWEEP_SOFT_DEADLINE_MS,
} = {}) {
  const startedAt = Date.now();
  const summary = {
    scanned: 0,
    billingStateCorrected: 0,
    creditInvariantCorrected: 0,
    errors: 0,
    corrections: [],
    partial: false,
    nextCursor: null,
  };

  // Cron retoma do cursor persistido quando o chamador não passa um explícito.
  let cursor = after;
  if (source === 'cron' && cursor == null) {
    try {
      const st = await cronCursorRef().get();
      cursor = (st.exists && st.data() && st.data().cursor) || null;
    } catch (e) {
      console.warn('[reconcile] cron cursor read failed', (e && e.message) || e);
    }
  }

  const billingSnap = await db().collectionGroup('billing').get();
  // Coleta as contas canônicas e ordena por uid para varredura determinística
  // e resumível (o cursor é um uid; retomamos a partir do próximo).
  const accounts = [];
  for (const doc of billingSnap.docs) {
    // collectionGroup('billing') também devolve a subcoleção credits em
    // alguns backends; só a conta canônica interessa aqui.
    if (doc.id !== 'account') continue;
    const userRef = doc.ref.parent && doc.ref.parent.parent;
    if (!userRef) continue;
    accounts.push(userRef);
  }
  accounts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const userRef of accounts) {
    if (cursor && userRef.id <= cursor) continue; // retoma após o cursor
    if (limit && summary.scanned >= limit) break;
    // Time-box: para antes do limite da função e devolve cursor para retomar.
    if (deadlineMs && Date.now() - startedAt > deadlineMs) {
      summary.partial = true;
      break;
    }
    summary.scanned++;

    const report = await reconcileAccount(userRef);
    for (const ch of report.changes) {
      if (ch.type === 'billing_state') summary.billingStateCorrected++;
      else if (ch.type === 'credit_invariant') {
        summary.creditInvariantCorrected++;
        summary.corrections.push({ uid: report.uid, ...ch });
      } else if (ch.type.endsWith('_error')) summary.errors++;
    }
    summary.nextCursor = userRef.id;
  }

  // Terminou a base inteira: zera o cursor para a próxima varredura começar do início.
  if (!summary.partial) summary.nextCursor = null;

  // Persiste o cursor do cron para a execução seguinte retomar (ou reiniciar).
  if (source === 'cron') {
    try {
      await cronCursorRef().set(
        { cursor: summary.nextCursor, updatedAt: fieldValue().serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('[reconcile] cron cursor write failed', (e && e.message) || e);
    }
  }

  if (summary.billingStateCorrected || summary.creditInvariantCorrected || summary.errors) {
    captureMessage(
      '[reconcile] billing=' +
        summary.billingStateCorrected +
        ' credits=' +
        summary.creditInvariantCorrected +
        ' errors=' +
        summary.errors,
      summary.errors ? 'error' : 'warning',
      summary
    );
  }

  await persistRun(summary, source);

  return summary;
}

module.exports = {
  computeCreditTotals,
  reconcileCreditInvariant,
  reconcileAccount,
  runReconcileSweep,
  MAX_PERSISTED_CORRECTIONS,
};
