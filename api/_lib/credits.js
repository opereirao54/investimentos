'use strict';

/**
 * Reserva de crédito Applicash — a peça que faltava para o desconto do
 * INDICADOR chegar ao bolso dele.
 *
 * O desenho original só sabia descontar uma fatura que JÁ existia
 * (`applyPendingCreditsTo`, em api/billing/webhook.js): reservava os créditos
 * e depois chamava `asaas.updatePayment` para baixar o valor. Isso não serve
 * em dois casos reais:
 *
 *   1. Cobrança avulsa no CARTÃO. O `POST /payments` com dados de cartão
 *      captura na hora. Quando o webhook chega para descontar, o Asaas
 *      responde 400 "não é possível alterar o valor de uma cobrança já
 *      recebida" — o usuário foi cobrado cheio e o crédito voltou para a
 *      prateleira. Verificado no simulador de pagamentos.
 *
 *   2. Qualquer cobrança nova. Descontar depois de criar é sempre uma corrida
 *      contra a captura; descontar ANTES é determinístico.
 *
 * Daí a separação em três tempos, que é o que este módulo oferece:
 *
 *   reservePendingCredits()  marca os créditos como gastos numa transação,
 *                            devolvendo quanto se pode abater — ANTES de
 *                            falar com o Asaas.
 *   rebindReservation()      liga a reserva ao id real da cobrança, depois
 *                            de o Asaas a criar.
 *   releaseReservation()     desfaz tudo se o Asaas recusar.
 *
 * A transação é o que impede o gasto duplo: dois indicados a pagar no mesmo
 * instante liam ambos os mesmos créditos pendentes e cada um abatia na sua
 * fatura. Só um dos commits vê o saldo.
 */

const { db, fieldValue } = require('./firebase-admin');

// Piso do gateway. O Asaas recusa cobranças abaixo disto (≈ R$ 5,00 para
// PIX/boleto). Mesma env var lida em api/billing/webhook.js — um valor só
// para as duas pontas evitarem divergir.
function minPaymentCents() {
  return parseInt(process.env.MIN_PAYMENT_CENTS || '500', 10);
}

/**
 * Reserva atomicamente até `maxDiscountCents` do saldo pendente.
 *
 * `reservationId` é um rótulo temporário (ex.: 'oneshot:<uid>:<ts>') quando a
 * cobrança ainda não existe; `rebindReservation` troca-o pelo id real depois.
 *
 * Devolve `{ applied, used }` — `applied` em centavos, `used` com as refs e a
 * fatia consumida de cada crédito, para o rollback saber o que desfazer.
 */
async function reservePendingCredits(billingRef, maxDiscountCents, reservationId) {
  if (!billingRef || !(maxDiscountCents > 0)) return { applied: 0, used: [] };

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(billingRef.collection('credits').where('appliedAt', '==', null));
    if (snap.empty) return { applied: 0, used: [] };

    let appliedCents = 0;
    const used = [];
    const sobras = [];
    for (const d of snap.docs) {
      if (appliedCents >= maxDiscountCents) break;
      const c = d.data() || {};
      if (c.voidedAt) continue; // crédito anulado por estorno não vale saldo
      const valor = c.amountCents || 0;
      if (valor <= 0) continue;
      const room = maxDiscountCents - appliedCents;
      const take = Math.min(valor, room);
      if (take <= 0) continue;
      appliedCents += take;
      used.push({ ref: d.ref, partial: take, original: valor });

      // O crédito coube só em parte. O saldo é derivado dos DOCUMENTOS
      // (computeCreditTotals conta o crédito inteiro como gasto assim que
      // `appliedAt` existe), então marcar um crédito de R$ 1,35 como gasto
      // tendo abatido só R$ 0,55 fazia os R$ 0,80 restantes evaporarem — e
      // a reconciliação depois "corrigia" o contador para o valor menor,
      // cimentando a perda. Partimos o crédito em dois: a fatia consumida
      // fica neste documento, o resto vira um crédito novo, ainda pendente.
      if (take < valor) {
        sobras.push({
          ref: billingRef.collection('credits').doc(d.id + '-r' + take),
          data: {
            fromUid: c.fromUid || null,
            fromEmail: c.fromEmail || null,
            paymentId: c.paymentId || null,
            amountCents: valor - take,
            appliedAt: null,
            appliedToPaymentId: null,
            createdAt: c.createdAt || fieldValue().serverTimestamp(),
            splitFrom: d.id,
          },
        });
      }
    }
    if (appliedCents <= 0) return { applied: 0, used: [] };

    for (const u of used) {
      tx.set(
        u.ref,
        {
          appliedAt: fieldValue().serverTimestamp(),
          appliedToPaymentId: reservationId,
          appliedAmountCents: u.partial,
          amountCents: u.partial,
        },
        { merge: true }
      );
    }
    for (const s of sobras) tx.set(s.ref, s.data);
    return { applied: appliedCents, used, sobras: sobras.map((s) => s.ref) };
  });
}

/**
 * Devolve os créditos ao saldo pendente. Chamado quando o Asaas recusa a
 * cobrança depois de já termos reservado. Best-effort por desenho: falhar aqui
 * não pode derrubar o request, mas fica logado — e a reconciliação
 * (api/_lib/reconcile.js) corrige o contador na varredura seguinte.
 */
async function releaseReservation(reservation) {
  if (!reservation || !reservation.used || !reservation.used.length) return 0;
  try {
    const batch = db().batch();
    for (const u of reservation.used) {
      batch.set(
        u.ref,
        {
          appliedAt: null,
          appliedToPaymentId: null,
          appliedAmountCents: fieldValue().delete(),
          // Repõe o valor cheio: a reserva pode ter partido o crédito e
          // reduzido `amountCents` à fatia consumida. Sem isto, devolver
          // a reserva devolveria menos do que se tirou.
          amountCents: u.original != null ? u.original : u.partial,
        },
        { merge: true }
      );
    }
    // Desfaz as sobras criadas pela partição — senão o crédito devolvido
    // ficaria contado duas vezes (documento cheio + sobra).
    for (const ref of reservation.sobras || []) batch.delete(ref);
    await batch.commit();
    return reservation.applied || 0;
  } catch (e) {
    console.error('[credits] releaseReservation failed', (e && e.message) || e);
    return 0;
  }
}

/**
 * Troca o rótulo temporário da reserva pelo id real da cobrança criada.
 * Sem isto, `releaseAppliedCredits` (que procura por `appliedToPaymentId`)
 * nunca reencontraria estes créditos se a fatura fosse apagada ou estornada.
 */
async function rebindReservation(reservation, realPaymentId) {
  if (!reservation || !reservation.used || !reservation.used.length || !realPaymentId) return;
  try {
    const batch = db().batch();
    for (const u of reservation.used) {
      batch.set(u.ref, { appliedToPaymentId: realPaymentId }, { merge: true });
    }
    await batch.commit();
  } catch (e) {
    console.error('[credits] rebindReservation failed', (e && e.message) || e);
  }
}

/**
 * Quanto se pode abater de uma cobrança de `paymentCents` sem furar o piso do
 * gateway. Ponto único da regra — a UI e o motor não podem divergir sobre
 * quanto desconto é possível.
 */
function maxDiscountFor(paymentCents) {
  return Math.max(0, (paymentCents || 0) - minPaymentCents());
}

module.exports = {
  reservePendingCredits,
  releaseReservation,
  rebindReservation,
  maxDiscountFor,
  minPaymentCents,
};
