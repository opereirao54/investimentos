'use strict';

// Visão de negócio do painel do admin: receita recorrente, previsão,
// receita realizada, volumetria, conversão e retenção.
//
// Funções PURAS — recebem os documentos já lidos e o instante "agora" — para
// que cada número tenha teste (test/admin-painel-negocio.test.js). O endpoint
// (api/admin/stats.js) só lê o Firestore e o Auth e chama montarPainel().
//
// Regras que os números seguem (e que o painel antigo errava):
//   - cancelamento é subscriptionStatus INACTIVE (é o que o webhook, o
//     /cancel e a sincronização gravam); DELETED/INACTIVATED ficam por
//     compatibilidade;
//   - assinante com a fatura do mês seguinte em aberto (PENDING) continua
//     assinante — antes saía do MRR toda vez que o Asaas gerava a fatura;
//   - quem pagou avulso (paymentMode one_shot) e está dentro do mês comprado
//     é pagante, mas não é receita RECORRENTE: aparece à parte;
//   - cortesia (liberada pelo admin) nunca conta como receita;
//   - receita realizada usa a data do pagamento (paymentDate), não a hora em
//     que o webhook gravou o documento, e soma também as contas excluídas
//     (registro fiscal em contasExcluidas);
//   - meses e dias no fuso de Brasília.

const { courtesyState, isLegacyGrant, paidUntilMs } = require('./access');

const PRECO_CHEIO_CENTS = 1500;
const DIA = 24 * 3600 * 1000;
const FUSO_BR_MS = -3 * 3600 * 1000; // America/Sao_Paulo, sem horário de verão desde 2019
const PAGO = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const CANCELADO = new Set(['INACTIVE', 'DELETED', 'INACTIVATED', 'EXPIRED']);
const ESTORNO = new Set([
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

function ms(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v === 'string') {
    const t = Date.parse(v.length === 10 ? v + 'T12:00:00-03:00' : v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/** 'AAAA-MM-DD' e 'AAAA-MM' no horário de Brasília. */
function diaBR(t) {
  return new Date(t + FUSO_BR_MS).toISOString().slice(0, 10);
}
function mesBR(t) {
  return diaBR(t).slice(0, 7);
}
/** Início (ms) do mês de Brasília que contém t, deslocado `delta` meses. */
function inicioMesBR(t, delta) {
  const d = new Date(t + FUSO_BR_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (delta || 0), 1) - FUSO_BR_MS;
}

/** Valor mensal da assinatura, já com o desconto recorrente (testador, cupom). */
function valorMensal(b) {
  return b.subscriptionBaseValueCents || b.monthlyPriceCents || PRECO_CHEIO_CENTS;
}

/**
 * Situação comercial de uma conta — uma, e só uma:
 *   cortesia · assinante · atraso · avulso · trial · aguardando ·
 *   cancelado · trial_expirado · estornado · sem_assinatura
 * `avulso` = pago sem renovação automática (cobrança avulsa, ou assinou,
 * cancelou e ainda está no mês pago). `aguardando` = assinou, o teste
 * acabou e a primeira cobrança ainda não foi paga.
 */
function situacaoComercial(b, agora) {
  if (!b) return 'sem_assinatura';
  if (courtesyState(b, agora) || isLegacyGrant(b)) return 'cortesia';
  const ss = b.subscriptionStatus || null;
  const ls = b.lastPaymentStatus || null;
  const jaPagou = !!ms(b.lastPaidAt);
  if (ls && ESTORNO.has(ls)) return 'estornado';
  if (b.subscriptionId && ss && !CANCELADO.has(ss)) {
    if (ls === 'OVERDUE' || ss === 'OVERDUE') return 'atraso';
    if (jaPagou || PAGO.has(ls)) return 'assinante';
  }
  const fimTrialAss = ms(b.trialEndsAt);
  if (b.subscriptionId && ss && !CANCELADO.has(ss) && !jaPagou && fimTrialAss <= agora)
    return 'aguardando';
  const pagoAte = paidUntilMs(b) || 0;
  if (b.paymentMode === 'one_shot' && pagoAte > agora) return 'avulso';
  const fimTrial = ms(b.trialEndsAt);
  if (fimTrial > agora) return 'trial';
  // Assinou e cancelou, mas ainda tem o mês pago em pé: continua pagante
  // (avulso para fins de receita — não renova sozinho).
  if (pagoAte > agora) return 'avulso';
  if (b.subscriptionId && ss && CANCELADO.has(ss) && jaPagou) return 'cancelado';
  if (jaPagou) return 'cancelado';
  if (fimTrial) return 'trial_expirado';
  return 'sem_assinatura';
}

function vazioSituacoes() {
  return {
    assinante: 0,
    atraso: 0,
    avulso: 0,
    trial: 0,
    aguardando: 0,
    cortesia: 0,
    cancelado: 0,
    estornado: 0,
    trial_expirado: 0,
    sem_assinatura: 0,
  };
}

/** Pagamentos efetivamente recebidos, com a data em que o dinheiro entrou. */
function normalizarPagamentos(lista) {
  const vistos = new Set();
  const out = [];
  (lista || []).forEach((p) => {
    if (!p || !PAGO.has(p.status)) return;
    const id = p.id || null;
    if (id && vistos.has(id)) return;
    if (id) vistos.add(id);
    const quando = ms(p.paymentDate) || ms(p.receivedAt);
    if (!quando) return;
    const bruto = Math.round((Number(p.value) || 0) * 100);
    const liquido = p.netValue != null ? Math.round((Number(p.netValue) || 0) * 100) : bruto;
    out.push({
      uid: p.uid || null,
      quando,
      bruto,
      liquido,
      recorrente: !!p.subscriptionId,
      metodo: p.billingType || 'OUTRO',
    });
  });
  return out;
}

/**
 * Monta o bloco `negocio` do painel.
 *
 * entrada = {
 *   agora, billings: [{uid, b}], pagamentos: [{uid, ...payment}],
 *   usuarios: [authUser], uso: [{uid, ultimoUsoMs, areas, testador}] | null,
 *   truncado: bool
 * }
 */
function montarPainel(entrada) {
  const agora = entrada.agora || Date.now();
  const billings = entrada.billings || [];
  const usuarios = entrada.usuarios || [];
  const billingPorUid = new Map(billings.map((x) => [x.uid, x.b || {}]));
  const pagos = normalizarPagamentos(entrada.pagamentos);

  // ── Situação de cada conta ───────────────────────────────────────────
  const situacoes = vazioSituacoes();
  const situacaoPorUid = new Map();
  let mrr = 0;
  let mrrRisco = 0;
  let avulsoMes = 0;
  let descontoMes = 0;
  let assinantesComDesconto = 0;
  let creditoPendenteAssinantes = 0;
  const metodos = {};
  const renovacoes = []; // próximas cobranças de assinatura em 30 dias
  const avulsosVencendo = [];
  const trialsAcabando = [];
  let canceladosUlt30 = 0;
  let mrrCanceladoUlt30 = 0;

  billings.forEach(({ uid, b }) => {
    b = b || {};
    const s = situacaoComercial(b, agora);
    situacoes[s]++;
    situacaoPorUid.set(uid, s);
    const valor = valorMensal(b);
    const credito = Math.max(0, (b.stats && b.stats.pendingDiscountCents) || 0);

    if (s === 'assinante') {
      mrr += valor;
      if (valor < PRECO_CHEIO_CENTS) {
        descontoMes += PRECO_CHEIO_CENTS - valor;
        assinantesComDesconto++;
      }
      creditoPendenteAssinantes += Math.min(credito, Math.max(0, valor - 100));
      const metodo = b.paymentMethod || 'INDEFINIDO';
      metodos[metodo] = (metodos[metodo] || 0) + 1;
      const proxima = ms(b.nextDueDate) || paidUntilMs(b) || 0;
      if (proxima && proxima <= agora + 30 * DIA) {
        // O crédito do Applicash abate da fatura, até deixar R$ 1,00.
        const cobrado = Math.max(100, valor - Math.min(credito, valor - 100));
        renovacoes.push({ uid, quandoMs: proxima, valorCents: cobrado });
      }
    } else if (s === 'atraso') {
      mrrRisco += valor;
    } else if (s === 'avulso') {
      avulsoMes += valor;
      const fim = paidUntilMs(b) || 0;
      if (fim && fim <= agora + 30 * DIA)
        avulsosVencendo.push({ uid, quandoMs: fim, valorCents: valor });
    } else if (s === 'trial' || s === 'aguardando') {
      trialsAcabando.push({ uid, quandoMs: ms(b.trialEndsAt), valorCents: valor });
    }

    const cancelou = ms(b.cancelledAt);
    if (cancelou && cancelou >= agora - 30 * DIA && ms(b.lastPaidAt)) {
      canceladosUlt30++;
      mrrCanceladoUlt30 += valor;
    }
  });

  const assinantes = situacoes.assinante;
  const basePagante = assinantes + situacoes.atraso + situacoes.avulso;
  const arpu = assinantes > 0 ? Math.round(mrr / assinantes) : 0;

  // ── Conversão do teste grátis ────────────────────────────────────────
  // Coorte = quem já terminou o teste (ou pagou antes de terminar). Quem
  // ainda está testando não entra: ainda não teve a chance de converter.
  const pagouAlgumaVez = new Set(pagos.map((p) => p.uid).filter(Boolean));
  let coorteTeste = 0;
  let converteram = 0;
  billings.forEach(({ uid, b }) => {
    b = b || {};
    const pagou = pagouAlgumaVez.has(uid) || !!ms(b.lastPaidAt);
    const fimTrial = ms(b.trialEndsAt);
    const terminou = fimTrial && fimTrial <= agora;
    if (situacaoPorUid.get(uid) === 'cortesia' && !pagou) return;
    if (pagou || terminou) {
      coorteTeste++;
      if (pagou) converteram++;
    }
  });
  const taxaConversao = coorteTeste > 0 ? converteram / coorteTeste : null;

  // ── Churn mensal e LTV ───────────────────────────────────────────────
  // Churn de 30 dias = cancelaram nos últimos 30 dias ÷ (assinantes de hoje
  // + os que cancelaram no período), a base que existia no começo da janela.
  const baseInicio = assinantes + situacoes.atraso + canceladosUlt30;
  const churnMensal = baseInicio > 0 ? canceladosUlt30 / baseInicio : null;
  const ltv = churnMensal && churnMensal > 0 && arpu > 0 ? Math.round(arpu / churnMensal) : null;

  // ── Receita realizada ────────────────────────────────────────────────
  const ini = inicioMesBR(agora, 0);
  const iniAnt = inicioMesBR(agora, -1);
  const decorrido = agora - ini;
  let mesBruto = 0;
  let mesLiquido = 0;
  let mesQtd = 0;
  let mesAntMesmoPeriodo = 0;
  let mesAntBruto = 0;
  let ult30Bruto = 0;
  let ult30Qtd = 0;
  let totalBruto = 0;
  let totalLiquido = 0;
  const porMes = new Map();
  for (let i = 11; i >= 0; i--)
    porMes.set(mesBR(inicioMesBR(agora, -i)), { bruto: 0, liquido: 0, qtd: 0, recorrente: 0 });
  const novosPagantes30 = new Set();
  const primeiroPagamento = new Map();
  pagos.forEach((p) => {
    if (p.uid && (!primeiroPagamento.has(p.uid) || p.quando < primeiroPagamento.get(p.uid)))
      primeiroPagamento.set(p.uid, p.quando);
  });
  pagos.forEach((p) => {
    totalBruto += p.bruto;
    totalLiquido += p.liquido;
    if (p.quando >= ini) {
      mesBruto += p.bruto;
      mesLiquido += p.liquido;
      mesQtd++;
    }
    if (p.quando >= iniAnt && p.quando < ini) {
      mesAntBruto += p.bruto;
      if (p.quando < iniAnt + decorrido) mesAntMesmoPeriodo += p.bruto;
    }
    if (p.quando >= agora - 30 * DIA) {
      ult30Bruto += p.bruto;
      ult30Qtd++;
    }
    const m = porMes.get(mesBR(p.quando));
    if (m) {
      m.bruto += p.bruto;
      m.liquido += p.liquido;
      m.qtd++;
      if (p.recorrente) m.recorrente += p.bruto;
    }
  });
  primeiroPagamento.forEach((quando, uid) => {
    if (quando >= agora - 30 * DIA) novosPagantes30.add(uid);
  });
  let mrrNovo30 = 0;
  novosPagantes30.forEach((uid) => {
    if (situacaoPorUid.get(uid) === 'assinante')
      mrrNovo30 += valorMensal(billingPorUid.get(uid) || {});
  });

  // ── Previsão ─────────────────────────────────────────────────────────
  const somar = (arr) => arr.reduce((a, x) => a + x.valorCents, 0);
  const renovacoesCents = somar(renovacoes);
  const avulsosCents = somar(avulsosVencendo);
  // Trials viram receita na taxa de conversão observada; sem histórico, não
  // se inventa uma — a parte "provável" fica de fora e o painel diz isso.
  const trialsProvavel =
    taxaConversao != null ? Math.round(somar(trialsAcabando) * taxaConversao) : null;
  const mrrLiquidoNovo30 = mrrNovo30 - mrrCanceladoUlt30;
  const projecao = [3, 6, 12].map((meses) => ({
    meses,
    mrrCents: Math.max(0, mrr + mrrLiquidoNovo30 * meses),
  }));

  // ── Volumetria ───────────────────────────────────────────────────────
  const criado = (u) => ms(u.metadata && u.metadata.creationTime);
  const ultimoLogin = (u) => ms(u.metadata && u.metadata.lastSignInTime);
  const cont = (f) => usuarios.filter(f).length;
  const novos = (dias) => cont((u) => criado(u) >= agora - dias * DIA);
  const novosEntre = (de, ate) =>
    cont((u) => criado(u) >= agora - de * DIA && criado(u) < agora - ate * DIA);
  const hojeBR = diaBR(agora);
  const cadastrosPorDia = [];
  const mapaDia = new Map();
  for (let i = 89; i >= 0; i--) {
    const d = diaBR(agora - i * DIA);
    mapaDia.set(d, 0);
  }
  const cadastrosPorMes = new Map();
  for (let i = 11; i >= 0; i--) cadastrosPorMes.set(mesBR(inicioMesBR(agora, -i)), 0);
  usuarios.forEach((u) => {
    const c = criado(u);
    if (!c) return;
    const d = diaBR(c);
    if (mapaDia.has(d)) mapaDia.set(d, mapaDia.get(d) + 1);
    const m = mesBR(c);
    if (cadastrosPorMes.has(m)) cadastrosPorMes.set(m, cadastrosPorMes.get(m) + 1);
  });
  mapaDia.forEach((count, date) => cadastrosPorDia.push({ date, count }));

  const uso = entrada.uso || null;
  let ativos = null;
  if (uso) {
    const usaram = (dias) =>
      uso.filter((i) => i.ultimoUsoMs && i.ultimoUsoMs >= agora - dias * DIA).length;
    const d1 = usaram(1);
    const d7 = usaram(7);
    const d30 = usaram(30);
    ativos = {
      dia: d1,
      semana: d7,
      mes: d30,
      algumaVez: uso.filter((i) => i.ultimoUsoMs).length,
      nuncaUsaram: uso.filter((i) => !i.ultimoUsoMs).length,
      // Quanto do mês volta no dia a dia (DAU/MAU).
      aderencia: d30 > 0 ? d1 / d30 : null,
      telegram: uso.filter((i) => (i.areas || []).some((a) => a.area === 'Telegram')).length,
      testadores: uso.filter((i) => i.testador).length,
      pagantesAtivos30: uso.filter(
        (i) =>
          i.ultimoUsoMs >= agora - 30 * DIA &&
          ['assinante', 'atraso', 'avulso'].includes(situacaoPorUid.get(i.uid))
      ).length,
    };
  }

  const ordenar = (arr) => arr.sort((a, b) => a.quandoMs - b.quandoMs);

  return {
    geradoEm: agora,
    truncado: !!entrada.truncado,
    receita: {
      mrrCents: mrr,
      arrCents: mrr * 12,
      mrrRiscoCents: mrrRisco,
      avulsoMensalCents: avulsoMes,
      arpuCents: arpu,
      descontoMensalCents: descontoMes,
      assinantesComDesconto,
      creditoPendenteCents: creditoPendenteAssinantes,
      assinantes,
      atraso: situacoes.atraso,
      avulsos: situacoes.avulso,
      basePagante,
      metodos,
    },
    previsao: {
      proximos30: {
        renovacoesCents,
        renovacoesQtd: renovacoes.length,
        avulsosCents,
        avulsosQtd: avulsosVencendo.length,
        trialsQtd: trialsAcabando.length,
        trialsProvavelCents: trialsProvavel,
        atrasoCents: mrrRisco,
        // "Esperado" = o que já está contratado + a fatia provável dos trials.
        esperadoCents: renovacoesCents + (trialsProvavel || 0),
      },
      mrrNovo30Cents: mrrNovo30,
      mrrCancelado30Cents: mrrCanceladoUlt30,
      mrrLiquidoNovo30Cents: mrrLiquidoNovo30,
      projecao,
      renovacoes: ordenar(renovacoes).slice(0, 10),
    },
    realizado: {
      mesCents: mesBruto,
      mesLiquidoCents: mesLiquido,
      mesQtd,
      mesAnteriorMesmoPeriodoCents: mesAntMesmoPeriodo,
      mesAnteriorCents: mesAntBruto,
      ult30Cents: ult30Bruto,
      ult30Qtd,
      totalCents: totalBruto,
      totalLiquidoCents: totalLiquido,
      taxasCents: totalBruto - totalLiquido,
      porMes: [...porMes.entries()].map(([mes, v]) => Object.assign({ mes }, v)),
    },
    conversao: {
      taxa: taxaConversao,
      coorte: coorteTeste,
      converteram,
      trialsAtivos: situacoes.trial,
      aguardandoPrimeiroPagamento: situacoes.aguardando,
      trialsAcabam48h: trialsAcabando.filter(
        (t) => t.quandoMs > agora && t.quandoMs <= agora + 2 * DIA
      ).length,
      trialExpiradoSemPagar: situacoes.trial_expirado,
      churnMensal,
      canceladosUlt30,
      ltvCents: ltv,
      novosPagantes30: novosPagantes30.size,
    },
    volume: {
      cadastros: usuarios.length,
      verificados: cont((u) => u.emailVerified),
      suspensos: cont((u) => u.disabled),
      hoje: cont((u) => criado(u) && diaBR(criado(u)) === hojeBR),
      novos7: novos(7),
      novos30: novos(30),
      novos30Anterior: novosEntre(60, 30),
      loginUlt7: cont((u) => ultimoLogin(u) >= agora - 7 * DIA),
      loginUlt30: cont((u) => ultimoLogin(u) >= agora - 30 * DIA),
      iniciaramTeste: billings.length,
      ativos,
      cadastrosPorDia,
      cadastrosPorMes: [...cadastrosPorMes.entries()].map(([mes, count]) => ({ mes, count })),
    },
    situacoes,
  };
}

module.exports = {
  montarPainel,
  situacaoComercial,
  normalizarPagamentos,
  diaBR,
  mesBR,
  inicioMesBR,
  PRECO_CHEIO_CENTS,
};
