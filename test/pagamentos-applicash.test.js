'use strict';

/**
 * Applicash: o desconto tem de chegar às DUAS pontas.
 *
 * O programa promete duas coisas diferentes, e só uma funcionava:
 *
 *   INDICADO   entra com o cupom e paga 10% menos, para sempre.
 *              → aplicado em /subscribe, no valor da assinatura. Funcionava.
 *
 *   INDICADOR  recebe 10% de cada pagamento do indicado, abatido na fatura
 *              dele. → NÃO chegava. O único gatilho de abatimento era o
 *              evento PAYMENT_CREATED, e o Asaas projeta as faturas dos
 *              próximos meses no ato da criação da assinatura: todos os
 *              PAYMENT_CREATED do indicador já tinham acontecido, com saldo
 *              zero, antes de o primeiro indicado pagar. O crédito nascia,
 *              aparecia na tela como "sua próxima mensalidade já tem R$ X de
 *              abatimento" e ficava preso ali para sempre.
 *
 * Estes testes rodam contra o mundo FIEL (faturas projetadas, cartão que
 * captura na hora, Asaas que recusa alterar cobrança paga) — é a diferença
 * entre o mock generoso e a produção que escondia o defeito.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const S = require('./_simulador-pagamentos.js');

const DEZ_PCT_DE_1350 = 135; // o indicado paga R$ 13,50; o indicador ganha 10% disso

/** Alice indica, Bob entra pelo cupom. Devolve o par para os invariantes. */
async function parIndicacao(m, opts = {}) {
  await S.criarConta(m, 'alice');
  if (opts.aliceAssina !== false) {
    await S.assinar(m, 'alice', opts.aliceModo ? { modo: opts.aliceModo } : {});
    // O Asaas anuncia TODAS as faturas projetadas de uma vez, agora — muito
    // antes de existir qualquer crédito para abater.
    await S.anunciarFaturasNovas('alice');
  }
  const cupom = S.billing('alice').referralCode;
  assert.ok(cupom, 'a indicadora precisa de um cupom');
  await S.criarConta(m, 'bob', { cupom });
  return { cupom, pares: [['alice', 'bob']] };
}

test('o INDICADO paga 10% menos por entrar com cupom', async () => {
  const m = S.criarMundoPagamentos();
  const { pares } = await parIndicacao(m);

  await S.assinar(m, 'bob');
  const fatura = S.faturaEmAberto('bob');

  assert.equal(S.billing('bob').recurringDiscountPercent, 10, 'o vínculo dá 10%');
  assert.equal(Math.round(fatura.value * 100), 1350, 'R$ 15,00 − 10% = R$ 13,50');

  await S.pagar('bob', fatura);
  assert.equal(S.problemas(m, { paresApplicash: pares }), '');
});

test('o INDICADOR recebe: o crédito chega a uma fatura de verdade', async () => {
  const m = S.criarMundoPagamentos();
  const { pares } = await parIndicacao(m);

  const antes = S.cobrancas('alice').map((p) => p.value);
  assert.ok(
    antes.length > 1,
    'o mundo precisa das faturas projetadas — é elas que quebravam o desconto'
  );
  assert.ok(
    antes.every((v) => Math.round(v * 100) === 1500),
    'todas as faturas da Alice nascem cheias'
  );

  await S.assinar(m, 'bob');
  await S.pagar('bob', S.faturaEmAberto('bob'));

  const depois = S.cobrancas('alice')
    .filter((p) => p.status === 'PENDING')
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  assert.equal(
    Math.round(depois[0].value * 100),
    1500 - DEZ_PCT_DE_1350,
    'a próxima fatura da Alice tem de baixar para R$ 13,65'
  );
  assert.equal(
    (S.billing('alice').stats || {}).pendingDiscountCents,
    0,
    'o saldo foi consumido, não ficou preso'
  );
  assert.equal(S.problemas(m, { paresApplicash: pares }), '');
});

test('o INDICADOR avulso também recebe — o desconto entra ANTES do cartão capturar', async () => {
  // No avulso com cartão o Asaas captura no ato do POST /payments. Abater
  // depois, pelo webhook, é 400 "cobrança já recebida": o indicador pagava
  // cheio e o crédito voltava para a prateleira.
  const m = S.criarMundoPagamentos();
  const { pares } = await parIndicacao(m, { aliceAssina: false });

  await S.assinar(m, 'bob');
  await S.pagar('bob', S.faturaEmAberto('bob'));
  assert.equal(
    (S.billing('alice').stats || {}).pendingDiscountCents,
    DEZ_PCT_DE_1350,
    'sem fatura aberta, o crédito espera na conta da Alice'
  );

  const r = await S.assinar(m, 'alice', { modo: 'avulso', cartao: true });
  assert.equal(
    Math.round(r.body.value * 100),
    1500 - DEZ_PCT_DE_1350,
    'a cobrança avulsa já nasce com o desconto embutido'
  );
  assert.equal(r.body.referralAppliedCents, DEZ_PCT_DE_1350);
  assert.equal(S.problemas(m, { paresApplicash: pares }), '');
});

test('o mesmo crédito nunca é gasto duas vezes', async () => {
  const m = S.criarMundoPagamentos();
  const { pares } = await parIndicacao(m);

  await S.assinar(m, 'bob');
  await S.pagar('bob', S.faturaEmAberto('bob'));

  // Reprocessar o mesmo pagamento (retry do Asaas) não pode gerar outro
  // crédito nem abater outra fatura.
  const fatura = S.cobrancas('bob')[0];
  await S.evento('PAYMENT_CONFIRMED', { payment: { ...fatura } }, 'retry-tardio');
  await S.anunciarFaturasNovas('alice');

  const cs = S.creditos('alice').filter((c) => !c.voidedAt);
  assert.equal(cs.length, 1, 'um pagamento do indicado = um crédito');
  const abatidas = S.cobrancas('alice').filter((p) => Math.round(p.value * 100) < 1500);
  assert.equal(abatidas.length, 1, 'o crédito abateu UMA fatura, não duas');
  assert.equal(S.problemas(m, { paresApplicash: pares }), '');
});

test('estorno do indicado desfaz o crédito do indicador', async () => {
  const m = S.criarMundoPagamentos();
  await parIndicacao(m, { aliceAssina: false });

  await S.assinar(m, 'bob');
  const fatura = S.faturaEmAberto('bob');
  await S.pagar('bob', fatura);
  assert.equal((S.billing('alice').stats || {}).pendingDiscountCents, DEZ_PCT_DE_1350);

  await S.estornar('bob', fatura);
  assert.equal(
    (S.billing('alice').stats || {}).pendingDiscountCents,
    0,
    'o dinheiro voltou para o Bob: a Alice não pode ficar com o cashback'
  );
  assert.equal(S.problemas(m), '');
});

test('vários indicados acumulam e o excedente fica para o mês seguinte', async () => {
  const m = S.criarMundoPagamentos();
  await S.criarConta(m, 'alice');
  await S.assinar(m, 'alice');
  await S.anunciarFaturasNovas('alice');
  const cupom = S.billing('alice').referralCode;

  // Créditos suficientes para passar do valor da mensalidade. O piso do
  // gateway impede zerar a fatura, então o resto TEM de sobrar como saldo.
  const total = 20 * DEZ_PCT_DE_1350;
  for (let i = 0; i < 20; i++) {
    S.store.docs.set('users/alice/billing/account/credits/sim' + i, {
      fromUid: 'amigo' + i,
      amountCents: DEZ_PCT_DE_1350,
      appliedAt: null,
      appliedToPaymentId: null,
    });
  }
  S.billing('alice').stats = {
    pendingDiscountCents: total,
    totalReferralEarningsCents: total,
  };

  await S.criarConta(m, 'bob', { cupom });
  await S.assinar(m, 'bob');
  await S.pagar('bob', S.faturaEmAberto('bob'));

  const abatida = S.cobrancas('alice')
    .filter((p) => p.status === 'PENDING')
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  assert.equal(
    Math.round(abatida.value * 100),
    S.PISO_GATEWAY_CENTS,
    'a fatura desce até o piso do gateway, nunca abaixo'
  );

  const sobra = (S.billing('alice').stats || {}).pendingDiscountCents;
  assert.ok(sobra > 0, 'o crédito que não coube tem de continuar no saldo, não evaporar');
  assert.equal(S.problemas(m, { paresApplicash: [['alice', 'bob']] }), '');
});

test('a tela e a landing não podem prometer desconto que o motor não entrega', async () => {
  // TRAVA DE COERÊNCIA entre a copy e `api/_lib/credits.js`.
  //
  // A escada de marcos vive em DOIS lugares — APPLICASH_METAS no app e a
  // <ol class="apc-metas"> da landing — e o próprio comentário da landing
  // avisa que mexer num sem o outro "faz a página prometer um desconto que a
  // tela do assinante desmente". Antes, ambos anunciavam "12 indicações →
  // 100% · Mensalidade zerada", e o motor nunca conseguiu: MIN_PAYMENT_CENTS
  // trava a fatura no piso do gateway.
  //
  // Este teste falha se a promessa de fatura zerada voltar sem que o piso
  // tenha ido embora junto.
  const fs = require('fs');
  const path = require('path');
  const { maxDiscountFor, minPaymentCents } = require('../api/_lib/credits.js');

  const piso = minPaymentCents();
  assert.equal(
    maxDiscountFor(S.PRECO_BASE_CENTS),
    S.PRECO_BASE_CENTS - piso,
    'o desconto máximo é o preço menos o piso — nunca o preço inteiro'
  );

  const raiz = path.join(__dirname, '..');
  // Só a copy que o usuário LÊ. Comentários explicam justamente por que a
  // promessa saiu — citá-la ali não pode fazer o teste falhar.
  const semComentarios = (txt) =>
    txt
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const copy =
    semComentarios(fs.readFileSync(path.join(raiz, 'web/appliquei-applicash.js'), 'utf8')) +
    semComentarios(fs.readFileSync(path.join(raiz, 'landing.html'), 'utf8'));

  if (piso > 0) {
    assert.ok(
      !/mensalidade zerada|assinatura zerada|gr[áa]tis para sempre/i.test(copy),
      'com piso de gateway a fatura nunca zera — a copy não pode dizer que zera'
    );
    assert.ok(
      !/100%\s*de desconto/i.test(copy),
      'com piso de gateway 100% de desconto é impossível'
    );
  }

  // O piso que a copy do app cita tem de ser o piso de verdade.
  const appJs = fs.readFileSync(path.join(raiz, 'web/appliquei-applicash.js'), 'utf8');
  const declarado = appJs.match(/APPLICASH_PISO_CENTS\s*=\s*(\d+)/);
  assert.ok(declarado, 'a tela precisa declarar o piso que usa nos cálculos');
  assert.equal(parseInt(declarado[1], 10), piso, 'o piso da tela desgarrou de MIN_PAYMENT_CENTS');
});

test('Asaas recusa a cobrança: a reserva de crédito é devolvida inteira', async () => {
  // Caminho de compensação. Só roda quando o gateway recusa depois de já
  // termos reservado — e a partição de crédito torna isso delicado: devolver
  // sem apagar a sobra contaria o mesmo dinheiro duas vezes.
  const m = S.criarMundoPagamentos({ faturasProjetadas: 0 });
  await S.criarConta(m, 'alice');

  // Saldo que NÃO cabe inteiro na fatura: força a partição.
  S.store.docs.set('users/alice/billing/account/credits/grande', {
    fromUid: 'amigo',
    amountCents: 1400,
    appliedAt: null,
    appliedToPaymentId: null,
  });
  S.billing('alice').stats = {
    pendingDiscountCents: 1400,
    totalReferralEarningsCents: 1400,
  };

  const {
    reservePendingCredits,
    releaseReservation,
    maxDiscountFor,
  } = require('../api/_lib/credits.js');

  // A mesma referência que os handlers usam.
  const db = require('../api/_lib/firebase-admin').db();
  const alvo = db.collection('users').doc('alice').collection('billing').doc('account');

  const reserva = await reservePendingCredits(alvo, maxDiscountFor(1500), 'temp:1');
  assert.equal(reserva.applied, 1000, 'reserva até o teto (preço − piso)');
  assert.equal(reserva.sobras.length, 1, 'o que não coube virou crédito novo');

  const totalDepoisDaReserva = S.creditos('alice').reduce((a, c) => a + (c.amountCents || 0), 0);
  assert.equal(totalDepoisDaReserva, 1400, 'partir não pode criar nem sumir com dinheiro');

  await releaseReservation(reserva);

  const creditos = S.creditos('alice');
  assert.equal(creditos.length, 1, 'a sobra foi apagada — senão o crédito contaria em dobro');
  assert.equal(creditos[0].amountCents, 1400, 'o valor cheio voltou');
  assert.equal(creditos[0].appliedAt, null, 'e voltou a ficar pendente');
});
