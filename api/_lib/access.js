const TRIAL_DAYS = 7;
const PAID_PERIOD_MS = 30 * 86400 * 1000;

const PAID_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const BAD_PAYMENT_STATUSES = new Set([
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'OVERDUE',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

function toMillis(v) {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

/**
 * Até quando o acesso já foi COMPRADO, em ms.
 *
 * `paidUntil` é a fonte canônica: o webhook acumula ciclos nele em vez de
 * reiniciar a contagem a cada pagamento (ver `extendPaidUntil`). Contas
 * antigas — pagas antes de o campo existir — não o têm, e para elas caímos
 * na regra anterior (`lastPaidAt + 30 dias`), que é exatamente o que elas
 * já viviam. Sem esse fallback, todo assinante antigo perderia o acesso no
 * deploy.
 */
function paidUntilMs(billing) {
  const explicit = toMillis(billing.paidUntil);
  if (explicit) return explicit;
  const lastPaid = toMillis(billing.lastPaidAt);
  return lastPaid ? lastPaid + PAID_PERIOD_MS : null;
}

/**
 * Até quando o acesso passa a valer depois de um pagamento confirmado.
 *
 * A regra é CRÉDITO DE TEMPO, não reinício: pagar cedo soma um ciclo ao que
 * o usuário ainda tinha, em vez de queimar o resto. Antes disto, quem
 * antecipava a renovação avulsa no dia 20 de 30 ficava com acesso até o dia
 * 50 em vez do 60 — pagava dois ciclos e recebia 50 dias. O mesmo vale para
 * o trial: quem assina no dia 3 de 7 leva os 4 dias restantes para dentro
 * do ciclo pago.
 *
 * Nunca encurta: a base é o MAIOR entre agora, a janela já paga e o fim do
 * trial. Um webhook atrasado não pode reduzir um direito já concedido.
 */
function nextPaidUntilMs(billing, now = Date.now(), cycleMs = PAID_PERIOD_MS) {
  const current = billing ? paidUntilMs(billing) : null;
  const trialEnd = billing ? toMillis(billing.trialEndsAt) : null;
  // Cortesia com prazo é tempo que o usuário já tem, como o trial: quem
  // ganhou 30 dias do admin e assina no dia 10 não pode queimar os 20 que
  // faltam. A permanente não entra — não há fim para somar depois dele.
  const courtesyEnd =
    billing && billing.courtesyPermanent !== true ? toMillis(billing.courtesyUntil) : null;
  let base = now;
  if (current && current > base) base = current;
  if (trialEnd && trialEnd > base) base = trialEnd;
  if (courtesyEnd && courtesyEnd > base) base = courtesyEnd;
  return base + cycleMs;
}

/**
 * Acesso Pro concedido pelo admin (Superpoderes), sem pagamento por trás.
 *
 * Vive em campos PRÓPRIOS — `courtesyPermanent` e `courtesyUntil` — e não
 * finge um pagamento. Antes, "Tornar PRO" gravava subscriptionStatus=ACTIVE
 * e lastPaymentStatus=CONFIRMED: o primeiro webhook do Asaas (uma fatura
 * PENDING criada, uma OVERDUE) sobrescrevia esses campos e o usuário caía em
 * "Aguardando confirmação do pagamento" ou era bloqueado — e a tela de
 * assinatura mostrava "Assinatura ativa · próxima cobrança" para quem nunca
 * assinou. Nenhum webhook toca nestes campos, então a cortesia só acaba
 * quando o prazo vence ou o admin revoga.
 *
 * Devolve null quando não há cortesia viva.
 */
function courtesyState(billing, now = Date.now()) {
  if (!billing) return null;
  if (billing.courtesyPermanent === true) return { permanent: true, untilMs: null };
  const until = toMillis(billing.courtesyUntil);
  if (until && now < until) return { permanent: false, untilMs: until };
  return null;
}

/**
 * Conta liberada pelo "Tornar PRO" ANTIGO, que fingia um pagamento:
 * subscriptionStatus=ACTIVE + lastPaymentStatus=CONFIRMED sem assinatura no
 * Asaas e sem nenhum pagamento registrado. O gate continua a honrá-la (regra
 * "paid" abaixo), mas a tela precisa saber que é cortesia — senão promete
 * "próxima cobrança" a quem nunca vai ser cobrado.
 */
function isLegacyGrant(billing) {
  return !!(
    billing &&
    !billing.subscriptionId &&
    billing.subscriptionStatus === 'ACTIVE' &&
    PAID_PAYMENT_STATUSES.has(billing.lastPaymentStatus) &&
    !billing.lastPaidAt &&
    !billing.paymentMode
  );
}

function computeAccess(billing, now = Date.now()) {
  if (!billing) {
    return { status: 'blocked', reason: 'no_billing', trialDaysLeft: 0 };
  }
  // Cortesia do admin vence tudo, inclusive fatura atrasada da assinatura:
  // foi uma decisão explícita de liberar a conta. Para retirar, o admin
  // revoga (Superpoderes → Revogar cortesia).
  if (courtesyState(billing, now)) {
    return { status: 'active', reason: 'courtesy', trialDaysLeft: 0 };
  }
  const subStatus = billing.subscriptionStatus || null;
  const lastPaymentStatus = billing.lastPaymentStatus || null;
  const lastPaidAtMs = toMillis(billing.lastPaidAt);
  const hasPaidBefore = !!lastPaidAtMs;
  const paidThroughMs = paidUntilMs(billing);
  // Janela já comprada e ainda viva. Distingue "não pagou a próxima" de
  // "não tem direito a nada": a primeira não pode revogar a segunda.
  const withinPaidWindow = !!(paidThroughMs && now < paidThroughMs);

  // Defesa em profundidade: se o último pagamento está em estado ruim
  // (vencido, em chargeback, reembolso), bloqueia mesmo que subStatus
  // ainda esteja como ACTIVE por dessincronia.
  if (lastPaymentStatus && BAD_PAYMENT_STATUSES.has(lastPaymentStatus)) {
    if (lastPaymentStatus === 'OVERDUE') {
      // OVERDUE é sempre sobre a fatura SEGUINTE — a atual já foi paga.
      // Bloquear na hora cortava o acesso de quem pagou boleto/PIX no dia
      // do vencimento (compensa em 1-3 dias úteis) e de quem ainda tem
      // ciclo comprado em pé. Só bloqueia quando a janela paga acabou.
      if (withinPaidWindow) {
        return { status: 'active', reason: 'paid_period_overdue_next', trialDaysLeft: 0 };
      }
      return { status: 'blocked', reason: 'overdue', trialDaysLeft: 0 };
    }
    if (
      lastPaymentStatus.startsWith('CHARGEBACK') ||
      lastPaymentStatus === 'AWAITING_CHARGEBACK_REVERSAL'
    ) {
      return { status: 'blocked', reason: 'chargeback', trialDaysLeft: 0 };
    }
    // Estorno/reembolso: o dinheiro voltou para o usuário. Aqui a janela
    // paga NÃO protege — não há mais pagamento que a sustente.
    return { status: 'blocked', reason: 'refunded', trialDaysLeft: 0 };
  }

  // Pagamento confirmado pelo webhook — acesso total
  if (subStatus === 'ACTIVE' && PAID_PAYMENT_STATUSES.has(lastPaymentStatus)) {
    return { status: 'active', reason: 'paid', trialDaysLeft: 0 };
  }

  // Assinatura ativa + já pagou antes (fallback se lastPaymentStatus não foi
  // atualizado, ex.: durante geração do próximo invoice em PENDING).
  // Só vale se o último status conhecido não é um estado problemático.
  if (
    subStatus === 'ACTIVE' &&
    hasPaidBefore &&
    (!lastPaymentStatus ||
      lastPaymentStatus === 'PENDING' ||
      PAID_PAYMENT_STATUSES.has(lastPaymentStatus))
  ) {
    return { status: 'active', reason: 'paid', trialDaysLeft: 0 };
  }

  const trialEnd = toMillis(billing.trialEndsAt);
  if (trialEnd && now < trialEnd) {
    const left = Math.ceil((trialEnd - now) / 86400000);
    return { status: 'trial', reason: 'trial_active', trialDaysLeft: left };
  }

  // Ciclo pago: ainda dentro da janela comprada e nenhum BAD status no topo
  // foi acionado. Cobre o caso "paguei, cancelei, ainda tenho direito
  // ao restante do mês" — CDC + prática SaaS padrão. Vem DEPOIS do trial
  // para preservar o estado "trial" enquanto a avaliação está viva.
  if (withinPaidWindow) {
    return { status: 'active', reason: 'paid_period', trialDaysLeft: 0 };
  }

  if (subStatus === 'ACTIVE') {
    return { status: 'pending_payment', reason: 'awaiting_payment', trialDaysLeft: 0 };
  }
  if (subStatus === 'AWAITING_RISK_ANALYSIS') {
    return { status: 'pending_payment', reason: 'risk_analysis', trialDaysLeft: 0 };
  }
  if (subStatus === 'OVERDUE') {
    return { status: 'blocked', reason: 'overdue', trialDaysLeft: 0 };
  }
  if (subStatus === 'PAYMENT_REPROVED') {
    return { status: 'blocked', reason: 'card_reproved', trialDaysLeft: 0 };
  }
  if (subStatus === 'CHARGEBACK' || subStatus === 'CHARGEBACK_REVERSAL_PENDING') {
    return { status: 'blocked', reason: 'chargeback', trialDaysLeft: 0 };
  }
  if (subStatus === 'INACTIVE') {
    return { status: 'blocked', reason: 'cancelled', trialDaysLeft: 0 };
  }
  return { status: 'blocked', reason: 'trial_expired', trialDaysLeft: 0 };
}

module.exports = {
  TRIAL_DAYS,
  PAID_PERIOD_MS,
  computeAccess,
  courtesyState,
  isLegacyGrant,
  toMillis,
  paidUntilMs,
  nextPaidUntilMs,
};
