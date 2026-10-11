'use strict';

// Exclusão da conta pelo próprio usuário (LGPD, art. 18, VI).
//
// A ORDEM é a regra principal deste arquivo:
//
//   1. Asaas primeiro. Se a assinatura não puder ser cancelada, NADA é
//      apagado: apagar os dados e deixar o cartão sendo cobrado é o pior
//      desfecho possível — o usuário não teria mais conta para cancelar.
//   2. O registro fiscal (contasExcluidas/{uid}) antes de apagar: os
//      pagamentos precisam ser guardados pelo prazo da legislação fiscal, e
//      a Política de Privacidade promete isso ("exceto o que a lei nos obriga
//      a guardar"). Só ids, valores e datas — nada de e-mail; a identidade
//      fiscal (nome, CPF) fica no Asaas, que é quem emite a cobrança.
//   3. Os dados no Firestore.
//   4. O login (Firebase Auth) por ÚLTIMO. Se algo falhar no meio, o usuário
//      ainda entra e repete; tudo aqui é idempotente.
//
// Depois disso, um evento atrasado do Asaas (estorno, boleto pago) não
// ressuscita a conta: o webhook procura o billing, não acha e ignora. E o
// crédito de indicação de quem foi indicado por esta conta também não nasce,
// porque creditIndicatorFromIndicado exige o billing do indicador.
//
// O que NÃO se apaga, de propósito:
//   - referralCodes/{código}: só tem o uid. Apagar liberaria o código para
//     outra pessoa, e os cupons já espalhados passariam a creditar um estranho.
//   - O cliente no Asaas: é o registro fiscal de quem emitiu as cobranças.
//   - adminAuditLog: trilha de auditoria do painel (legítimo interesse).
//
// O que se anonimiza em vez de apagar, porque pertence a OUTRA pessoa:
//   - os créditos do Applicash que esta conta gerou para quem a indicou
//     (o dinheiro foi pago; o crédito continua valendo, sem o e-mail);
//   - o convite que esta conta usou (fica "usado", sem o e-mail).

const PAGAMENTO_PENDENTE = new Set(['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS']);

function ehNaoEncontrado(e) {
  return (
    !!e &&
    (e.status === 404 ||
      e.code === 'auth/user-not-found' ||
      (e.errorInfo && e.errorInfo.code === 'auth/user-not-found'))
  );
}

async function apagarConsulta(D, colecao, campo, valor, extra) {
  const snap = await D.collection(colecao).where(campo, '==', valor).get();
  let n = 0;
  for (const doc of snap.docs) {
    if (extra) await extra(doc);
    await doc.ref.delete();
    n++;
  }
  return n;
}

/**
 * Exclui a conta `uid`. `deps` = { db, auth, fieldValue, asaas, telegram }.
 * Devolve { ok, etapas, avisos } ou lança um erro com `.etapa` quando uma
 * etapa bloqueante falha (só o Asaas e a gravação do registro fiscal
 * bloqueiam — nesses casos nada foi apagado).
 */
async function excluirConta(uid, deps) {
  const { db, auth, fieldValue, asaas, telegram } = deps;
  const D = db();
  const userRef = D.collection('users').doc(uid);
  const billingRef = userRef.collection('billing').doc('account');
  const snapB = await billingRef.get();
  const billing = snapB.exists ? snapB.data() || {} : {};
  const etapas = {};
  const avisos = [];

  // 1. Asaas: assinatura recorrente (o DELETE apaga as faturas projetadas).
  if (billing.subscriptionId) {
    try {
      await asaas.cancelSubscription(billing.subscriptionId);
    } catch (e) {
      if (!ehNaoEncontrado(e)) {
        const err = new Error('asaas_cancel_failed');
        err.etapa = 'asaas';
        err.status = 502;
        throw err;
      }
    }
    etapas.assinaturaCancelada = true;
  }
  // Cobrança avulsa ainda em aberto (boleto/PIX gerado e não pago): some, para
  // não ser paga depois por uma conta que já não existe. Não bloqueia: o
  // Asaas recusa apagar cobrança paga, e isso é o caso normal.
  if (billing.lastOneShotPaymentId) {
    try {
      const pay = await asaas.getPaymentLink(billing.lastOneShotPaymentId);
      if (pay && PAGAMENTO_PENDENTE.has(pay.status)) {
        await asaas.call('DELETE', '/payments/' + encodeURIComponent(billing.lastOneShotPaymentId));
        etapas.cobrancaAvulsaApagada = true;
      }
    } catch (e) {
      if (!ehNaoEncontrado(e)) avisos.push('cobranca_avulsa_nao_apagada');
    }
  }

  // 2. Registro fiscal: pagamentos (ids, valores, datas) + cliente no Asaas.
  const paySnap = await userRef.collection('payments').get();
  const pagamentos = paySnap.docs.map((d) => {
    const p = d.data() || {};
    return {
      id: p.id || d.id,
      status: p.status || null,
      value: typeof p.value === 'number' ? p.value : null,
      netValue: typeof p.netValue === 'number' ? p.netValue : null,
      billingType: p.billingType || null,
      dueDate: p.dueDate || null,
      paymentDate: p.paymentDate || null,
    };
  });
  try {
    // Uma exclusão repetida (a primeira caiu no meio) já não acha billing nem
    // pagamentos: o registro da primeira vez é mesclado, nunca sobrescrito
    // com vazio.
    const fiscalRef = D.collection('contasExcluidas').doc(uid);
    const anterior = (await fiscalRef.get()).data() || {};
    const porId = new Map();
    (anterior.pagamentos || []).concat(pagamentos).forEach((p) => porId.set(p.id, p));
    await fiscalRef.set({
      uid,
      customerId: billing.customerId || anterior.customerId || null,
      subscriptionId: billing.subscriptionId || anterior.subscriptionId || null,
      pagamentos: [...porId.values()],
      excluidaEm: anterior.excluidaEm || fieldValue().serverTimestamp(),
    });
  } catch (_e) {
    const err = new Error('registro_fiscal_failed');
    err.etapa = 'registro_fiscal';
    err.status = 500;
    throw err;
  }

  // 3a. O que pertence a outras pessoas: anonimiza.
  if (billing.referredByUserId) {
    const creds = await D.collection('users')
      .doc(billing.referredByUserId)
      .collection('billing')
      .doc('account')
      .collection('credits')
      .where('fromUid', '==', uid)
      .get();
    for (const c of creds.docs)
      await c.ref.set({ fromEmail: null, fromExcluida: true }, { merge: true });
    etapas.creditosAnonimizados = creds.docs.length;
  }
  const conv = await D.collection('convites').where('usadoPor', '==', uid).get();
  for (const c of conv.docs)
    await c.ref.set({ usadoEmail: null, usadoExcluida: true }, { merge: true });

  // 3b. Telegram: desfaz o vínculo (apaga o link do chat) e o que sobrou
  // fora da conta — códigos de vínculo, pendências e pedidos de relatório.
  try {
    await telegram.desvincular(uid);
  } catch (_e) {
    avisos.push('telegram_desvincular_falhou');
  }
  for (const col of ['telegramCodigos', 'telegramPendentes', 'telegramRelatorios']) {
    await apagarConsulta(D, col, 'uid', uid);
  }

  // 3c. Sugestões enviadas e as imagens anexadas a elas.
  etapas.sugestoesApagadas = await apagarConsulta(D, 'feedback', 'uid', uid, (doc) =>
    D.collection('feedback_anexos').doc(doc.id).delete()
  );

  // 3d. Tudo em users/{uid}: dados, billing (+ créditos), pagamentos,
  // consentimentos, integrações, caixa do Telegram.
  await D.recursiveDelete(userRef);
  etapas.dadosApagados = true;

  // 4. O login, por último.
  try {
    await auth().deleteUser(uid);
  } catch (e) {
    if (!ehNaoEncontrado(e)) throw Object.assign(e, { etapa: 'auth', status: 500 });
  }
  etapas.loginApagado = true;

  return { ok: true, etapas, avisos };
}

module.exports = { excluirConta };
