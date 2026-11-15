'use strict';

// Cupons promocionais — campanha com código que o próprio usuário digita.
//
// Não confundir com os dois códigos que já existiam:
//   · Applicash (APP-XXXXXX, api/_lib/codes.js): código de INDICAÇÃO, um por
//     usuário, liga indicado a indicador;
//   · Convite (BETA-XXXX-XXXX, api/_lib/convites.js): uso único, libera o
//     cadastro na fase de testes.
// O cupom promocional é um código de CAMPANHA (ex.: LANCAMENTO50), criado no
// painel admin, que várias pessoas usam — uma vez cada.
//
// O desenho segue o que o mercado convencionou (Stripe, Shopify, Hotmart):
// separa QUANDO o cupom pode ser resgatado de POR QUANTO TEMPO o benefício
// vale depois de resgatado.
//
//   Prazo de resgate   validoDe / validoAte ('aaaa-mm-dd', horário de
//                      Brasília, o dia inteiro). Sem validoAte = sem prazo.
//   Limite de uso      maxResgates (null = ilimitado) + uma vez por conta.
//   Público            'novos' (quem nunca pagou) ou 'todos'.
//   Benefício          'desconto'    → percent% na mensalidade, por `ciclos`
//                                      mensalidades pagas (null = para sempre);
//                      'dias_gratis' → `dias` de acesso, somados ao que a
//                                      conta já tem (cortesia com prazo).
//   Interruptor        status 'ativo' | 'pausado' — pausar não tira o
//                      benefício de quem já resgatou.
//
// Regras de dinheiro (as mesmas da skill de pagamentos):
//   · Não acumula: vale o MAIOR desconto entre o permanente da conta
//     (recurringDiscountPercent — convite ou indicação) e o do cupom.
//   · Um cupom de desconto por vez na conta.
//   · O ciclo só é contado quando uma cobrança que SAIU com o desconto é
//     paga, uma vez por payment.id (o Asaas manda CONFIRMED e RECEIVED).
//   · Quando os ciclos acabam, o valor da assinatura no Asaas volta ao preço
//     sem o cupom. Se o Asaas recusar, fica `promo.ajustePendente` e a
//     próxima passagem tenta de novo — o erro é sempre a favor do usuário
//     (ele segue pagando menos, nunca mais).
//
// Coleções (só o Admin SDK lê e escreve):
//   cupons/{CODIGO}                 a definição + contador `resgates`
//   cupons/{CODIGO}/resgates/{uid}  quem já usou (trava de uma vez por conta)
//   users/{uid}/billing/account     .promo { codigo, percent, ciclosTotal,
//                                   ciclosUsados, pagamentos[], resgatadoEm,
//                                   encerradaEm, ajustePendente }

const asaas = require('./asaas');
const { minPaymentCents } = require('./credits');
const { toMillis, paidUntilMs } = require('./access');
const { dataValida } = require('./convites');

const COLECAO = 'cupons';
const RE_CODIGO = /^[A-Z0-9]{4,20}$/;
const MAX_NOTA = 120;
const MAX_CICLOS = 36;
const MAX_DIAS = 365;
const PRECO_TABELA_CENTS = 1500;
const DIA_MS = 86400000;

const MENSAGENS = {
  cupom_invalido: 'Cupom não encontrado. Confira se digitou certo.',
  cupom_indisponivel: 'Este cupom não está mais disponível.',
  cupom_nao_iniciado: 'Este cupom ainda não começou a valer.',
  cupom_expirado: 'O prazo deste cupom já acabou.',
  cupom_esgotado: 'Este cupom atingiu o limite de usos.',
  cupom_ja_usado: 'Você já usou este cupom.',
  cupom_so_novos: 'Este cupom vale só para a primeira assinatura.',
  cupom_ja_ativo: 'Você já tem um cupom de desconto em uso. Um cupom por vez.',
  cupom_sem_vantagem: 'Sua conta já tem um benefício igual ou maior que o deste cupom.',
  cupom_dias_com_assinatura:
    'Este cupom dá dias grátis e sua assinatura já está ativa. Ele não se aplica a ela.',
  cupom_conta_bloqueada: 'Não foi possível aplicar o cupom nesta conta. Fale com o suporte.',
  cupom_falha_gateway:
    'Não foi possível aplicar o desconto na sua assinatura agora. Tente de novo em instantes.',
  billing_not_initialized: 'Sua conta ainda não terminou de ser criada. Tente de novo.',
};

/** Aceita como a pessoa digitar: minúsculas, espaços, hífens. null se inválido. */
function normalizar(bruto) {
  if (typeof bruto !== 'string') return null;
  const s = bruto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return RE_CODIGO.test(s) ? s : null;
}

function refCupom(D, codigo) {
  return D.collection(COLECAO).doc(codigo);
}

/** 00:00 do dia, em Brasília (UTC−3, sem horário de verão). */
function inicioDoDiaMs(data) {
  const [a, m, d] = data.split('-').map(Number);
  return Date.UTC(a, m - 1, d, 3, 0, 0);
}

/** Primeiro instante em que o cupom JÁ NÃO vale: 00:00 do dia seguinte. */
function fimDoDiaMs(data) {
  return inicioDoDiaMs(data) + DIA_MS;
}

/**
 * Em que pé o cupom está agora. É a ÚNICA função que decide se um cupom pode
 * ser resgatado — o admin mostra o mesmo rótulo que o resgate usa.
 */
function situacao(c, agora = Date.now()) {
  if (!c) return 'invalido';
  if (c.status !== 'ativo') return 'pausado';
  if (c.validoDe && agora < inicioDoDiaMs(c.validoDe)) return 'agendado';
  if (c.validoAte && agora >= fimDoDiaMs(c.validoAte)) return 'expirado';
  if (c.maxResgates != null && (c.resgates || 0) >= c.maxResgates) return 'esgotado';
  return 'ativo';
}

const ERRO_DA_SITUACAO = {
  invalido: 'cupom_invalido',
  pausado: 'cupom_indisponivel',
  agendado: 'cupom_nao_iniciado',
  expirado: 'cupom_expirado',
  esgotado: 'cupom_esgotado',
};

function inteiro(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/** Maior desconto que ainda deixa a mensalidade no piso do gateway. */
function percentMaximo(precoCents = PRECO_TABELA_CENTS) {
  return Math.floor(100 - (minPaymentCents() * 100) / precoCents);
}

/** Datas e limite de uso — as partes que também podem ser editadas depois. */
function validarJanela({ validoDe, validoAte, maxResgates }) {
  const de = validoDe ? dataValida(validoDe) : null;
  const ate = validoAte ? dataValida(validoAte) : null;
  if (validoDe && !de) return { ok: false, erro: 'data_invalida' };
  if (validoAte && !ate) return { ok: false, erro: 'data_invalida' };
  if (de && ate && ate < de) return { ok: false, erro: 'validade_invertida' };
  const max = inteiro(maxResgates);
  if (Number.isNaN(max) || (max !== null && (max < 1 || max > 1000000)))
    return { ok: false, erro: 'limite_invalido' };
  return { ok: true, validoDe: de, validoAte: ate, maxResgates: max };
}

/** Confere a definição vinda do admin e devolve o documento a gravar. */
function validarDefinicao(bruto) {
  const x = bruto || {};
  const codigo = normalizar(String(x.codigo || ''));
  if (!codigo) return { ok: false, erro: 'codigo_invalido' };
  // Não pode parecer um código de indicação nem um convite: a tela decide
  // para onde mandar o que a pessoa digitou pelo formato.
  if (/^APP[A-Z0-9]{6}$/.test(codigo) || /^BETA[A-Z0-9]{8}$/.test(codigo))
    return { ok: false, erro: 'codigo_reservado' };

  const janela = validarJanela(x);
  if (!janela.ok) return janela;

  const out = {
    codigo,
    tipo: x.tipo,
    percent: null,
    ciclos: null,
    dias: null,
    validoDe: janela.validoDe,
    validoAte: janela.validoAte,
    maxResgates: janela.maxResgates,
    publico: x.publico === 'todos' ? 'todos' : 'novos',
    status: 'ativo',
    nota:
      String(x.nota || '')
        .trim()
        .slice(0, MAX_NOTA) || null,
    resgates: 0,
  };

  if (x.tipo === 'desconto') {
    const pct = inteiro(x.percent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 99)
      return { ok: false, erro: 'percent_invalido' };
    // 100% (ou perto) deixaria a cobrança abaixo do que o Asaas aceita.
    // Para "grátis por um tempo" existe o tipo dias_gratis.
    if (pct > percentMaximo()) return { ok: false, erro: 'percent_acima_do_piso' };
    const ciclos = inteiro(x.ciclos);
    if (Number.isNaN(ciclos) || (ciclos !== null && (ciclos < 1 || ciclos > MAX_CICLOS)))
      return { ok: false, erro: 'ciclos_invalido' };
    out.percent = pct;
    out.ciclos = ciclos;
  } else if (x.tipo === 'dias_gratis') {
    const dias = inteiro(x.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS)
      return { ok: false, erro: 'dias_invalido' };
    out.dias = dias;
  } else {
    return { ok: false, erro: 'tipo_invalido' };
  }
  return { ok: true, cupom: out };
}

async function criar(D, bruto, actor, ts) {
  const v = validarDefinicao(bruto);
  if (!v.ok) return v;
  const ref = refCupom(D, v.cupom.codigo);
  const criado = await D.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) return false;
    tx.set(ref, { ...v.cupom, criadoEm: ts.now(), criadoPor: actor || 'admin' });
    return true;
  });
  if (!criado) return { ok: false, erro: 'codigo_ja_existe' };
  return { ok: true, codigo: v.cupom.codigo };
}

/**
 * O que pode mudar depois de criado: pausar/reativar, prazo, limite e nota.
 * O BENEFÍCIO não muda — quem resgatou tem a cópia dele no próprio billing, e
 * um cupom que muda de valor no meio da campanha promete duas coisas com o
 * mesmo nome. Para outro benefício, cria-se outro código.
 */
async function atualizar(D, codigoBruto, mudancas, actor, ts) {
  const codigo = normalizar(String(codigoBruto || ''));
  if (!codigo) return { ok: false, erro: 'codigo_invalido' };
  const m = mudancas || {};
  const ref = refCupom(D, codigo);
  return D.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { ok: false, erro: 'cupom_inexistente' };
    const atual = s.data() || {};
    const patch = { atualizadoEm: ts.now(), atualizadoPor: actor || 'admin' };
    if (m.status !== undefined) {
      if (m.status !== 'ativo' && m.status !== 'pausado')
        return { ok: false, erro: 'status_invalido' };
      patch.status = m.status;
    }
    if (m.nota !== undefined)
      patch.nota =
        String(m.nota || '')
          .trim()
          .slice(0, MAX_NOTA) || null;
    if (m.validoDe !== undefined || m.validoAte !== undefined || m.maxResgates !== undefined) {
      const janela = validarJanela({
        validoDe: m.validoDe !== undefined ? m.validoDe : atual.validoDe,
        validoAte: m.validoAte !== undefined ? m.validoAte : atual.validoAte,
        maxResgates: m.maxResgates !== undefined ? m.maxResgates : atual.maxResgates,
      });
      if (!janela.ok) return janela;
      patch.validoDe = janela.validoDe;
      patch.validoAte = janela.validoAte;
      patch.maxResgates = janela.maxResgates;
    }
    tx.set(ref, patch, { merge: true });
    return { ok: true, codigo };
  });
}

/** Frase do benefício, igual no admin e na tela do usuário. */
function descreverBeneficio(c) {
  if (c.tipo === 'dias_gratis') return c.dias === 1 ? '1 dia grátis' : `${c.dias} dias grátis`;
  if (c.ciclos == null) return `${c.percent}% de desconto na mensalidade, sempre`;
  if (c.ciclos === 1) return `${c.percent}% de desconto na primeira mensalidade`;
  return `${c.percent}% de desconto nas ${c.ciclos} primeiras mensalidades`;
}

async function listar(D, agora = Date.now()) {
  const snap = await D.collection(COLECAO).get();
  const itens = (snap.docs || []).map((d) => {
    const x = d.data() || {};
    return {
      codigo: x.codigo || d.id,
      tipo: x.tipo,
      percent: x.percent || null,
      ciclos: x.ciclos == null ? null : x.ciclos,
      dias: x.dias || null,
      beneficio: descreverBeneficio(x),
      validoDe: x.validoDe || null,
      validoAte: x.validoAte || null,
      maxResgates: x.maxResgates == null ? null : x.maxResgates,
      resgates: x.resgates || 0,
      publico: x.publico || 'novos',
      status: x.status || 'pausado',
      situacao: situacao(x, agora),
      nota: x.nota || null,
      criadoEm: toMillis(x.criadoEm),
    };
  });
  itens.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  return itens;
}

// ─── O cupom dentro do billing ─────────────────────────────────────────────

/** A conta tem um cupom de desconto ainda valendo? */
function promoAtiva(b) {
  const p = b && b.promo;
  if (!p || !p.codigo || !(p.percent > 0) || p.encerradaEm) return false;
  return p.ciclosTotal == null || (p.ciclosUsados || 0) < p.ciclosTotal;
}

/**
 * O desconto que vale AGORA para a conta. Não acumula: é o maior entre o
 * permanente (convite/indicação) e o do cupom promocional em uso.
 * Ponto único — /subscribe, /me e /init leem daqui.
 */
function percentualVigente(b) {
  const permanente = (b && b.recurringDiscountPercent) || 0;
  return promoAtiva(b) ? Math.max(permanente, b.promo.percent) : permanente;
}

function precoComPercent(b, pct) {
  const tabela = (b && b.monthlyPriceCents) || PRECO_TABELA_CENTS;
  return Math.round((tabela * (100 - pct)) / 100);
}

/** Quanto a mensalidade custa agora, em centavos, antes de crédito Applicash. */
function precoCents(b) {
  return precoComPercent(b, percentualVigente(b));
}

function assinaturaViva(b) {
  return !!(b && b.subscriptionId && b.subscriptionStatus !== 'INACTIVE');
}

function jaPagou(b) {
  return !!(b && (b.lastPaidAt || b.paidUntil));
}

/** O que a tela mostra sobre o cupom da conta (vai em /me e /init). */
function resumo(b) {
  const p = b && b.promo;
  if (!p || !p.codigo) return null;
  const ativa = promoAtiva(b);
  return {
    codigo: p.codigo,
    percent: p.percent,
    ciclosTotal: p.ciclosTotal == null ? null : p.ciclosTotal,
    ciclosRestantes:
      p.ciclosTotal == null ? null : Math.max(0, p.ciclosTotal - (p.ciclosUsados || 0)),
    ativa,
    precoCents: precoComPercent(b, Math.max(p.percent, b.recurringDiscountPercent || 0)),
    precoDepoisCents: precoComPercent(b, b.recurringDiscountPercent || 0),
  };
}

/**
 * Leva o valor da assinatura no Asaas (e das faturas em aberto já projetadas)
 * para o preço que vale agora. Idempotente: pode rodar duas vezes.
 *
 * O Asaas projeta as faturas dos próximos meses no ato da assinatura, com o
 * valor daquele dia — mudar só a assinatura deixaria todas elas no preço
 * antigo. Cada fatura aberta vai para (preço novo − crédito Applicash que já
 * tinha sido abatido nela), sem furar o piso do gateway.
 */
async function ajustarAssinatura(billingRef, b) {
  if (!assinaturaViva(b)) return { ajustou: false };
  const alvo = precoCents(b);
  const sub = await asaas.getSubscription(b.subscriptionId);
  if (!sub || typeof sub.value !== 'number') throw new Error('assinatura_nao_encontrada');
  if (Math.round(sub.value * 100) !== alvo) {
    await asaas.updateSubscription(b.subscriptionId, {
      value: alvo / 100,
      updatePendingPayments: false,
    });
  }

  const lista = await asaas.listPaymentsBySubscription(b.subscriptionId);
  if (!lista || !Array.isArray(lista.data)) throw new Error('faturas_ilegiveis');
  const abatido = new Map();
  const creditos = await billingRef.collection('credits').get();
  for (const d of creditos.docs || []) {
    const c = d.data() || {};
    if (!c.appliedAt || c.voidedAt || !c.appliedToPaymentId) continue;
    abatido.set(
      c.appliedToPaymentId,
      (abatido.get(c.appliedToPaymentId) || 0) + (c.appliedAmountCents || c.amountCents || 0)
    );
  }
  for (const p of lista.data) {
    if (!p || !p.id || p.status !== 'PENDING') continue;
    const novo = Math.max(minPaymentCents(), alvo - (abatido.get(p.id) || 0));
    if (Math.round((p.value || 0) * 100) === novo) continue;
    await asaas.updatePayment(p.id, { value: novo / 100 });
  }
  // Não espera o SUBSCRIPTION_UPDATED: a tela lê este campo para dizer quanto
  // vem na próxima fatura.
  if (b.subscriptionBaseValueCents !== alvo)
    await billingRef.set({ subscriptionBaseValueCents: alvo }, { merge: true });
  return { ajustou: true, valorCents: alvo };
}

/**
 * Resgata um cupom para a conta. Tudo que decide (prazo, limite, uma vez por
 * conta) acontece numa transação só: duas pessoas disputando o último uso de
 * um cupom limitado — ou a mesma pessoa clicando duas vezes — não passam as
 * duas.
 *
 * `fv` = fieldValue() (para apagar campos no rollback).
 */
async function resgatar(D, { uid, codigoBruto }, ts, fv) {
  const codigo = normalizar(String(codigoBruto || ''));
  if (!codigo) return { ok: false, erro: 'cupom_invalido' };
  const ref = refCupom(D, codigo);
  const refResgate = ref.collection('resgates').doc(uid);
  const billingRef = D.collection('users').doc(uid).collection('billing').doc('account');
  const agora = Date.now();

  const r = await D.runTransaction(async (tx) => {
    const [sCupom, sResgate, sBilling] = [
      await tx.get(ref),
      await tx.get(refResgate),
      await tx.get(billingRef),
    ];
    if (!sCupom.exists) return { ok: false, erro: 'cupom_invalido' };
    const c = sCupom.data() || {};
    const sit = situacao(c, agora);
    if (sit !== 'ativo') return { ok: false, erro: ERRO_DA_SITUACAO[sit] };
    if (sResgate.exists) return { ok: false, erro: 'cupom_ja_usado' };
    const b = sBilling.exists ? sBilling.data() : null;
    if (!b || !b.customerId) return { ok: false, erro: 'billing_not_initialized' };
    // Conta em estorno/chargeback não ganha benefício novo.
    if (/CHARGEBACK|REFUND/.test(String(b.subscriptionStatus || '') + (b.lastPaymentStatus || '')))
      return { ok: false, erro: 'cupom_conta_bloqueada' };
    if (c.publico !== 'todos' && jaPagou(b)) return { ok: false, erro: 'cupom_so_novos' };

    const patch = { updatedAt: ts.now() };
    if (c.tipo === 'desconto') {
      if (promoAtiva(b)) return { ok: false, erro: 'cupom_ja_ativo' };
      if (c.percent <= (b.recurringDiscountPercent || 0))
        return { ok: false, erro: 'cupom_sem_vantagem' };
      if (precoComPercent(b, c.percent) < minPaymentCents())
        return { ok: false, erro: 'cupom_indisponivel' };
      patch.promo = {
        codigo,
        percent: c.percent,
        ciclosTotal: c.ciclos == null ? null : c.ciclos,
        ciclosUsados: 0,
        pagamentos: [],
        resgatadoEm: ts.fromMillis(agora),
        encerradaEm: null,
        ajustePendente: false,
      };
    } else {
      if (b.courtesyPermanent === true) return { ok: false, erro: 'cupom_sem_vantagem' };
      // Cortesia não para a cobrança do Asaas: dar dias grátis a quem tem
      // assinatura viva seria cobrar durante o "grátis".
      if (assinaturaViva(b)) return { ok: false, erro: 'cupom_dias_com_assinatura' };
      // Soma ao que a conta já tem (avaliação, mês pago, cortesia anterior):
      // ninguém perde dia que já era seu.
      const base = Math.max(
        agora,
        toMillis(b.courtesyUntil) || 0,
        toMillis(b.trialEndsAt) || 0,
        paidUntilMs(b) || 0
      );
      patch.courtesyUntil = ts.fromMillis(base + c.dias * DIA_MS);
      patch.courtesyGrantedAt = ts.now();
      patch.courtesyGrantedBy = `cupom:${codigo}`;
    }

    tx.set(ref, { resgates: (c.resgates || 0) + 1 }, { merge: true });
    tx.set(refResgate, { uid, em: ts.fromMillis(agora) });
    // `promo` é trocado inteiro (não mesclado): um cupom anterior, já
    // encerrado, não pode deixar campo para trás no novo.
    if (patch.promo) tx.set(billingRef, { promo: fv.delete() }, { merge: true });
    tx.set(billingRef, patch, { merge: true });
    return { ok: true, cupom: c, billing: { ...b, ...patch } };
  });
  if (!r.ok) return r;

  // Quem já assina: o desconto tem de chegar às faturas que o Asaas já criou.
  // Se o Asaas recusar, desfaz o resgate — cupom "aplicado" que não baixa
  // fatura nenhuma é a pior das respostas.
  if (r.cupom.tipo === 'desconto' && assinaturaViva(r.billing)) {
    try {
      await ajustarAssinatura(billingRef, r.billing);
    } catch (e) {
      console.error('[cupons] ajuste da assinatura falhou no resgate', e && e.message);
      await D.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const n = (s.exists && s.data().resgates) || 0;
        tx.set(ref, { resgates: Math.max(0, n - 1) }, { merge: true });
        tx.delete(refResgate);
        tx.set(billingRef, { promo: fv.delete() }, { merge: true });
      });
      // O valor da assinatura pode ter mudado antes da falha: volta ao preço
      // sem cupom (best-effort; a sincronização horária confere de novo).
      try {
        await ajustarAssinatura(billingRef, { ...r.billing, promo: null });
      } catch (_) {}
      return { ok: false, erro: 'cupom_falha_gateway' };
    }
  }

  const final = (await billingRef.get()).data() || r.billing;
  return {
    ok: true,
    codigo,
    tipo: r.cupom.tipo,
    beneficio: descreverBeneficio(r.cupom),
    billing: final,
  };
}

/**
 * Chamado pelo webhook a cada pagamento confirmado. Conta um ciclo do cupom
 * quando a cobrança paga saiu com o desconto, e encerra o cupom no último.
 *
 * Idempotente por payment.id (CONFIRMED e RECEIVED chegam para a mesma
 * cobrança). Devolve { contou, encerrou }.
 */
async function registrarPagamento(D, billingRef, payment, ts) {
  if (!payment || !payment.id) return { contou: false, encerrou: false };
  const r = await D.runTransaction(async (tx) => {
    const s = await tx.get(billingRef);
    const b = s.exists ? s.data() : null;
    if (!b || !b.promo) return { contou: false, encerrou: false };
    const p = b.promo;
    // Ajuste que ficou devendo de uma passagem anterior: tenta de novo.
    if (!promoAtiva(b)) return { contou: false, encerrou: false, pendente: !!p.ajustePendente, b };
    if (p.ciclosTotal == null) return { contou: false, encerrou: false };
    const pagos = Array.isArray(p.pagamentos) ? p.pagamentos : [];
    if (pagos.includes(payment.id)) return { contou: false, encerrou: false };
    // Só conta cobrança que saiu COM o desconto. Uma fatura criada cheia
    // antes do resgate não gasta um ciclo do cupom.
    const pagoCents = Math.round((payment.value || 0) * 100);
    if (pagoCents > precoComPercent(b, p.percent)) return { contou: false, encerrou: false };

    const usados = (p.ciclosUsados || 0) + 1;
    const encerrou = usados >= p.ciclosTotal;
    const promo = {
      ...p,
      ciclosUsados: usados,
      pagamentos: pagos.concat(payment.id),
      encerradaEm: encerrou ? ts.now() : null,
      ajustePendente: encerrou,
    };
    tx.set(billingRef, { promo }, { merge: true });
    return { contou: true, encerrou, pendente: encerrou, b: { ...b, promo } };
  });

  if (r.pendente) await concluirAjuste(billingRef, r.b);
  return { contou: !!r.contou, encerrou: !!r.encerrou };
}

/** Fim do cupom: devolve a assinatura ao preço sem ele. Nunca lança. */
async function concluirAjuste(billingRef, b) {
  try {
    await ajustarAssinatura(billingRef, b);
    await billingRef.set({ promo: { ajustePendente: false } }, { merge: true });
    return true;
  } catch (e) {
    console.error('[cupons] ajuste de fim de cupom falhou — fica pendente', e && e.message);
    return false;
  }
}

/** Rede de proteção (reconciliação diária): refaz o ajuste que ficou devendo. */
async function reconciliar(billingRef, b) {
  if (!b || !b.promo || !b.promo.ajustePendente || promoAtiva(b)) return false;
  return concluirAjuste(billingRef, b);
}

module.exports = {
  MENSAGENS,
  RE_CODIGO,
  normalizar,
  situacao,
  percentMaximo,
  validarDefinicao,
  criar,
  atualizar,
  listar,
  descreverBeneficio,
  promoAtiva,
  percentualVigente,
  precoCents,
  resumo,
  ajustarAssinatura,
  resgatar,
  registrarPagamento,
  reconciliar,
};
