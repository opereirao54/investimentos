'use strict';

/**
 * Simulador do processo de pagamento da Appliquei.
 *
 * `test/_simulador.js` pergunta "e se o usuário apertar este botão?". Este
 * pergunta a versão que envolve dinheiro de verdade: **"e se ele pagar — cedo,
 * tarde, duas vezes, com cupom, no cartão, no boleto, e depois estornar?"**.
 *
 * A diferença para os testes de billing que já existiam é o MUNDO. Eles
 * dirigiam os handlers reais contra um mock generoso: uma assinatura gerava
 * uma fatura, `updatePayment` aceitava tudo, cartão não capturava. O Asaas
 * real não é assim, e cada diferença escondia um defeito inteiro:
 *
 *   - o Asaas projeta as faturas dos próximos meses NO ATO da criação da
 *     assinatura. Todos os `PAYMENT_CREATED` do indicador acontecem antes de
 *     o primeiro indicado pagar — e o desconto dele nunca chegava a fatura
 *     nenhuma;
 *   - cartão captura na hora, então baixar o valor DEPOIS é 400 "cobrança já
 *     recebida" — o indicador pagava cheio com crédito parado na conta;
 *   - `CONFIRMED` e `RECEIVED` chegam para a MESMA cobrança, então tudo que
 *     soma tem de ser idempotente por `payment.id`.
 *
 * Por isso o mundo daqui liga os três knobs de fidelidade do mock
 * (`projectFutureInvoices`, `cardCapturesImmediately`, `strictUpdatePayment`).
 * Um teste de pagamento que roda com eles desligados está a testar um gateway
 * que não existe.
 *
 * A segunda peça é `verificar()`: depois de CADA ação, valida os invariantes
 * de dinheiro do sistema inteiro — não só o que a ação tocou. É o que faz um
 * pagamento antecipado que estraga o saldo Applicash aparecer.
 *
 * Ver .claude/skills/pagamentos/SKILL.md.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const M = require(path.join(ROOT, 'scripts/lib/mock-billing'));
const H = M.setup();
const { store, asaasState, call } = M;
const { computeAccess, paidUntilMs } = require(path.join(ROOT, 'api/_lib/access'));
const { computeCreditTotals } = require(path.join(ROOT, 'api/_lib/reconcile'));

const DIA = 86400000;
const WEBHOOK_HEADERS = { 'asaas-access-token': 'test_webhook_token' };
const PRECO_BASE_CENTS = 1500;
const PISO_GATEWAY_CENTS = parseInt(process.env.MIN_PAYMENT_CENTS || '500', 10);

// CPFs válidos distintos — /subscribe recusa dígito verificador errado e
// recusa o mesmo CPF em dois uids (antifraude de multi-conta).
const CPFS = ['10000000442', '10000000523', '10000000604', '10000000795', '10000000876'];
let cpfSeq = 0;
function proximoCpf() {
  return CPFS[cpfSeq++ % CPFS.length];
}

// ---------------------------------------------------------------------------
// O mundo
// ---------------------------------------------------------------------------

const RELOGIO_REAL = Date.now;

/**
 * Zera o estado e devolve um mundo de pagamentos.
 *
 * Por omissão o mundo é FIEL ao Asaas de produção. Desligar um knob é uma
 * decisão consciente do teste, não o default.
 *
 * O simulador também é dono do relógio.
 *
 * Sem isto o mundo tem DOIS tempos: os handlers leem `Date.now()` (o relógio
 * de verdade) e o mock do Firestore carimba `serverTimestamp()` com
 * `store.now`. Avançar 30 dias movia um e não o outro, e todo teste de
 * vencimento media a diferença entre os dois em vez do que queria medir.
 * Aqui `Date.now` passa a ler `store.now`, então `avancarDias` move o mundo
 * inteiro de uma vez.
 */
function criarMundoPagamentos(opts = {}) {
  store.docs.clear();
  store.now = opts.agora || RELOGIO_REAL.call(Date);
  Date.now = () => store.now;
  asaasState.customers.clear();
  asaasState.subscriptions.clear();
  asaasState.payments.clear();
  asaasState.deletedUids.clear();
  asaasState.seq = 1;
  cpfSeq = 0;

  asaasState.projectFutureInvoices = opts.faturasProjetadas != null ? opts.faturasProjetadas : 6;
  asaasState.cardCapturesImmediately =
    opts.cartaoCapturaNaHora != null ? opts.cartaoCapturaNaHora : true;
  asaasState.strictUpdatePayment = opts.asaasRigoroso != null ? opts.asaasRigoroso : true;
  asaasState.minPaymentValue = PISO_GATEWAY_CENTS / 100;

  return { pessoas: new Map(), t0: store.now };
}

function token(uid) {
  return 'fake:' + uid + ':' + uid + '@example.com';
}
function autorizado(uid) {
  return { authorization: 'Bearer ' + token(uid) };
}

/** Billing cru de um usuário, direto do store. */
function billing(uid) {
  return store.docs.get('users/' + uid + '/billing/account') || {};
}

/** Créditos Applicash de um usuário (a soma "verdade", sem passar por stats). */
function creditos(uid) {
  const prefixo = 'users/' + uid + '/billing/account/credits/';
  const out = [];
  for (const [p, data] of store.docs) {
    if (p.startsWith(prefixo) && !p.slice(prefixo.length).includes('/')) out.push(data);
  }
  return out;
}

/** Cobranças que o Asaas conhece para um usuário. */
function cobrancas(uid) {
  const cid = billing(uid).customerId;
  return Array.from(asaasState.payments.values()).filter((p) => p.customer === cid);
}

function acesso(uid, quando) {
  return computeAccess(billing(uid), quando != null ? quando : store.now);
}

/** Até quando o acesso está comprado, em dias desde o início do mundo. */
function acessoAteDia(mundo, uid) {
  const ms = paidUntilMs(billing(uid));
  return ms == null ? null : (ms - mundo.t0) / DIA;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

async function criarConta(mundo, uid, opts = {}) {
  const r = await call(H.init, {
    headers: autorizado(uid),
    body: opts.cupom ? { referralCode: opts.cupom } : {},
  });
  mundo.pessoas.set(uid, { uid, cpf: opts.cpf || proximoCpf() });
  return r;
}

const CARTAO = {
  number: '4111111111111111',
  holderName: 'TITULAR TESTE',
  expiryMonth: '12',
  expiryYear: '2035',
  ccv: '123',
};

async function assinar(mundo, uid, opts = {}) {
  const pessoa = mundo.pessoas.get(uid) || { cpf: proximoCpf() };
  const body = { cpfCnpj: pessoa.cpf, name: uid };
  if (opts.modo === 'avulso') body.mode = 'one_shot';
  if (opts.cartao) body.creditCard = CARTAO;
  return call(H.subscribe, { headers: autorizado(uid), body });
}

async function evento(nome, payload, id) {
  return call(H.webhook, {
    headers: WEBHOOK_HEADERS,
    body: Object.assign({ id: id || nome + ':' + asaasState.seq++, event: nome }, payload),
  });
}

/** Dispara PAYMENT_CREATED para toda cobrança recém-projetada — como o Asaas. */
async function anunciarFaturasNovas(uid) {
  for (const p of cobrancas(uid)) {
    if (p.status !== 'PENDING' || p.__anunciada) continue;
    p.__anunciada = true;
    await evento('PAYMENT_CREATED', { payment: Object.assign({}, p) }, 'created:' + p.id);
  }
}

/**
 * Paga uma cobrança. O Asaas emite CONFIRMED e, depois, RECEIVED para a MESMA
 * cobrança — `duplo` reproduz isso, que é onde a idempotência por payment.id
 * é posta à prova.
 */
async function pagar(uid, cobranca, opts = {}) {
  const p = typeof cobranca === 'string' ? asaasState.payments.get(cobranca) : cobranca;
  p.status = 'CONFIRMED';
  p.paymentDate = new Date(store.now).toISOString().slice(0, 10);
  await evento('PAYMENT_CONFIRMED', { payment: Object.assign({}, p) }, 'conf:' + p.id);
  if (opts.duplo !== false) {
    p.status = 'RECEIVED';
    await evento('PAYMENT_RECEIVED', { payment: Object.assign({}, p) }, 'recv:' + p.id);
  }
  return p;
}

/** Primeira cobrança em aberto do usuário (a que ele vai pagar a seguir). */
function faturaEmAberto(uid) {
  return cobrancas(uid)
    .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))[0];
}

async function vencer(uid, cobranca) {
  const p = cobranca || faturaEmAberto(uid);
  p.status = 'OVERDUE';
  return evento('PAYMENT_OVERDUE', { payment: Object.assign({}, p) }, 'over:' + p.id);
}

async function estornar(uid, cobranca) {
  const p = cobranca;
  p.status = 'REFUNDED';
  return evento('PAYMENT_REFUNDED', { payment: Object.assign({}, p) }, 'refund:' + p.id);
}

async function cancelar(uid) {
  return call(H.cancel, { headers: autorizado(uid), body: {} });
}

async function verMinhaConta(uid) {
  const r = await call(H.me, { method: 'GET', headers: autorizado(uid) });
  return r.body;
}

function avancarDias(n) {
  store.now += n * DIA;
  return store.now;
}

/** Devolve o relógio de verdade. Chamar em `after()` se o processo continuar. */
function restaurarRelogio() {
  Date.now = RELOGIO_REAL;
}

// ---------------------------------------------------------------------------
// Invariantes de dinheiro
// ---------------------------------------------------------------------------

/**
 * Valida o sistema de cobrança inteiro. Cada regra aqui é um erro que já
 * aconteceu de verdade neste código, não uma hipótese.
 */
function verificar(mundo, opts = {}) {
  const falhas = [];
  const uids = Array.from(mundo.pessoas.keys());

  for (const uid of uids) {
    const b = billing(uid);
    if (!b.customerId) continue;
    const rotulo = '[' + uid + ']';

    // PAG01 — dia comprado não se perde. paidUntil só anda para a frente.
    // O defeito: pagar a renovação avulsa no dia 20 de 30 reiniciava a
    // contagem naquele dia; o usuário pagava dois ciclos e recebia 50 dias.
    const agora = paidUntilMs(b);
    const antes = mundo.__paidUntil && mundo.__paidUntil[uid];
    if (antes != null && agora != null && agora < antes) {
      falhas.push(
        rotulo +
          ' PAG01 paidUntil ANDOU PARA TRÁS: ' +
          new Date(antes).toISOString() +
          ' → ' +
          new Date(agora).toISOString()
      );
    }
    mundo.__paidUntil = mundo.__paidUntil || {};
    if (agora != null) mundo.__paidUntil[uid] = agora;

    // PAG02 — nunca cobrar antes do que já foi concedido. Uma cobrança com
    // vencimento anterior ao fim do trial ou ao fim da janela paga é o
    // usuário pagando por dias que já eram dele.
    const fimTrial = b.trialEndsAt && b.trialEndsAt.toMillis ? b.trialEndsAt.toMillis() : null;
    for (const p of cobrancas(uid)) {
      if (p.status !== 'PENDING' || !p.dueDate) continue;
      if (p.__conferida) continue;
      const venceMs = Date.parse(p.dueDate + 'T23:59:59Z');
      if (fimTrial && venceMs < fimTrial - DIA) {
        falhas.push(rotulo + ' PAG02 cobrança ' + p.dueDate + ' vence ANTES do fim do trial');
      }
    }

    // PAG03 — o saldo Applicash bate com a soma dos documentos de crédito.
    // Os contadores são acumulados por ~6 caminhos; um increment perdido
    // desgarra o saldo para sempre e ninguém percebe.
    const verdade = computeCreditTotals(creditos(uid));
    const stats = b.stats || {};
    if ((stats.pendingDiscountCents || 0) !== verdade.pendingDiscountCents) {
      falhas.push(
        rotulo +
          ' PAG03 pendingDiscountCents=' +
          (stats.pendingDiscountCents || 0) +
          ' ≠ Σ créditos pendentes=' +
          verdade.pendingDiscountCents
      );
    }
    if ((stats.totalReferralEarningsCents || 0) !== verdade.totalReferralEarningsCents) {
      falhas.push(
        rotulo +
          ' PAG04 totalReferralEarningsCents=' +
          (stats.totalReferralEarningsCents || 0) +
          ' ≠ Σ créditos=' +
          verdade.totalReferralEarningsCents
      );
    }

    // PAG05 — crédito marcado como gasto tem de ter virado desconto real.
    // Sem isto o saldo some da tela sem baixar fatura nenhuma: o pior dos
    // dois mundos para o indicador.
    for (const c of creditos(uid)) {
      if (!c.appliedAt || c.voidedAt) continue;
      const alvo = c.appliedToPaymentId;
      if (!alvo) {
        falhas.push(rotulo + ' PAG05 crédito gasto sem cobrança associada');
        continue;
      }
      const cob = asaasState.payments.get(alvo);
      if (!cob) continue; // cobrança apagada: releaseAppliedCredits trata
      const baseCents = b.subscriptionBaseValueCents || b.monthlyPriceCents || PRECO_BASE_CENTS;
      if (Math.round(cob.value * 100) >= baseCents) {
        falhas.push(
          rotulo +
            ' PAG05 crédito gasto na cobrança ' +
            alvo +
            ' mas ela continua em R$ ' +
            cob.value
        );
      }
    }

    // PAG06 — nenhuma cobrança negativa, nem acima do preço de tabela, nem
    // abaixo do piso que o gateway aceita.
    for (const p of cobrancas(uid)) {
      const cents = Math.round((p.value || 0) * 100);
      if (cents < 0) falhas.push(rotulo + ' PAG06 cobrança NEGATIVA: ' + p.value);
      if (cents > PRECO_BASE_CENTS) {
        falhas.push(rotulo + ' PAG06 cobrança ACIMA do preço de tabela: ' + p.value);
      }
      if (cents > 0 && cents < PISO_GATEWAY_CENTS) {
        falhas.push(rotulo + ' PAG06 cobrança abaixo do piso do gateway: ' + p.value);
      }
    }

    // PAG07 — cobrança dupla. Assinatura recorrente e avulso ativos ao mesmo
    // tempo significam o usuário a pagar duas vezes pelo mesmo mês.
    const subsAtivas = Array.from(asaasState.subscriptions.values()).filter(
      (sb) => sb.customer === b.customerId && sb.status !== 'INACTIVE'
    );
    if (subsAtivas.length > 1) {
      falhas.push(rotulo + ' PAG07 ' + subsAtivas.length + ' assinaturas ativas ao mesmo tempo');
    }

    // PAG08 — acesso liberado tem de ter uma razão de dinheiro por trás.
    const acc = computeAccess(b, store.now);
    if (acc.status === 'active') {
      const dentroDaJanela = agora != null && store.now < agora;
      const assinaturaViva = b.subscriptionStatus === 'ACTIVE';
      if (!dentroDaJanela && !assinaturaViva) {
        falhas.push(
          rotulo + ' PAG08 acesso ativo sem janela paga nem assinatura (' + acc.reason + ')'
        );
      }
    }
  }

  // PAG09 — as duas pontas do Applicash. Se o indicado pagou, o indicador
  // tem de ter recebido: crédito pendente OU já abatido numa fatura.
  if (opts.paresApplicash) {
    for (const [indicador, indicado] of opts.paresApplicash) {
      const bi = billing(indicado);
      if (!bi.lastPaidAt) continue; // o indicado ainda não pagou nada
      if (bi.referredByUserId !== indicador) continue; // vínculo caiu (antifraude)
      const cs = creditos(indicador).filter((c) => !c.voidedAt);
      const total = cs.reduce((a, c) => a + (c.amountCents || 0), 0);
      if (total <= 0) {
        falhas.push(
          '[' + indicador + '] PAG09 indicado ' + indicado + ' pagou e o indicador não recebeu nada'
        );
      }
      // ...e o INDICADO tem de ter pago menos que o preço de tabela.
      const pagas = cobrancas(indicado).filter(
        (p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED'
      );
      if (pagas.length && pagas.every((p) => Math.round(p.value * 100) >= PRECO_BASE_CENTS)) {
        falhas.push(
          '[' + indicado + '] PAG09 entrou com cupom mas pagou o preço cheio em toda cobrança'
        );
      }
    }
  }

  return falhas;
}

/** Igual a `verificar`, mas devolve string vazia quando está tudo são. */
function problemas(mundo, opts) {
  const f = verificar(mundo, opts);
  return f.length ? '\n  - ' + f.join('\n  - ') : '';
}

module.exports = {
  DIA,
  PRECO_BASE_CENTS,
  PISO_GATEWAY_CENTS,
  criarMundoPagamentos,
  criarConta,
  assinar,
  anunciarFaturasNovas,
  pagar,
  vencer,
  estornar,
  cancelar,
  verMinhaConta,
  avancarDias,
  restaurarRelogio,
  evento,
  faturaEmAberto,
  billing,
  creditos,
  cobrancas,
  acesso,
  acessoAteDia,
  verificar,
  problemas,
  store,
  asaasState,
  handlers: H,
};
