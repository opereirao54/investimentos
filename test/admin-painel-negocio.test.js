'use strict';

// Visão de negócio do painel do admin (api/_lib/painel-negocio.js).
//
// Cada trava aqui é um erro que o painel antigo cometia:
//   - churn sempre 0% (contava DELETED/INACTIVATED; o sistema grava INACTIVE);
//   - assinante saía do MRR quando o Asaas gerava a fatura seguinte (PENDING);
//   - quem pagou avulso não era pagante em lugar nenhum;
//   - cortesia contando como receita;
//   - conversão dividida por quem ainda está no teste;
//   - receita do mês pela hora do webhook (UTC), não pela data do pagamento;
//   - contas excluídas sumiam do histórico de receita.

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarPainel, situacaoComercial, inicioMesBR } = require('../api/_lib/painel-negocio');

const DIA = 24 * 3600 * 1000;
// 21/10/2026 12:00 em Brasília
const AGORA = Date.UTC(2026, 9, 21, 15, 0, 0);
const ts = (t) => ({ toMillis: () => t });
const data = (t) => new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);

function usuario(uid, criadoMs, extra) {
  return Object.assign(
    {
      uid,
      email: uid + '@x.com',
      emailVerified: true,
      disabled: false,
      metadata: {
        creationTime: new Date(criadoMs).toUTCString(),
        lastSignInTime: new Date(criadoMs).toUTCString(),
      },
    },
    extra || {}
  );
}

const assinante = {
  subscriptionId: 'sub_1',
  subscriptionStatus: 'ACTIVE',
  // A fatura do mês seguinte já foi gerada: continua assinante.
  lastPaymentStatus: 'PENDING',
  lastPaidAt: ts(AGORA - 20 * DIA),
  paidUntil: ts(AGORA + 10 * DIA),
  nextDueDate: data(AGORA + 10 * DIA),
  subscriptionBaseValueCents: 1500,
  paymentMethod: 'PIX',
};

test('situação comercial: cada caso cai em um lugar só', () => {
  assert.equal(situacaoComercial(assinante, AGORA), 'assinante');
  assert.equal(situacaoComercial({ ...assinante, lastPaymentStatus: 'OVERDUE' }, AGORA), 'atraso');
  assert.equal(
    situacaoComercial(
      { paymentMode: 'one_shot', lastPaidAt: ts(AGORA - 5 * DIA), paidUntil: ts(AGORA + 25 * DIA) },
      AGORA
    ),
    'avulso'
  );
  assert.equal(
    situacaoComercial(
      {
        ...assinante,
        subscriptionStatus: 'INACTIVE',
        cancelledAt: ts(AGORA - 40 * DIA),
        paidUntil: ts(AGORA - 30 * DIA),
      },
      AGORA
    ),
    'cancelado'
  );
  assert.equal(situacaoComercial({ trialEndsAt: ts(AGORA + DIA) }, AGORA), 'trial');
  assert.equal(situacaoComercial({ trialEndsAt: ts(AGORA - DIA) }, AGORA), 'trial_expirado');
  assert.equal(
    situacaoComercial({ courtesyPermanent: true, subscriptionStatus: 'ACTIVE' }, AGORA),
    'cortesia'
  );
  // "Tornar PRO" antigo: ACTIVE + CONFIRMED sem assinatura nem pagamento.
  assert.equal(
    situacaoComercial({ subscriptionStatus: 'ACTIVE', lastPaymentStatus: 'CONFIRMED' }, AGORA),
    'cortesia'
  );
  assert.equal(
    situacaoComercial(
      {
        subscriptionId: 's',
        subscriptionStatus: 'ACTIVE',
        lastPaymentStatus: 'PENDING',
        trialEndsAt: ts(AGORA - DIA),
      },
      AGORA
    ),
    'aguardando'
  );
});

function cenario() {
  const billings = [
    { uid: 'ana', b: { ...assinante } },
    // Testador com 50% de desconto e R$ 3 de crédito para abater.
    {
      uid: 'bia',
      b: {
        ...assinante,
        subscriptionId: 'sub_2',
        lastPaymentStatus: 'CONFIRMED',
        subscriptionBaseValueCents: 750,
        paymentMethod: 'CREDIT_CARD',
        stats: { pendingDiscountCents: 300 },
      },
    },
    { uid: 'caio', b: { ...assinante, subscriptionId: 'sub_3', lastPaymentStatus: 'OVERDUE' } },
    {
      uid: 'duda',
      b: {
        paymentMode: 'one_shot',
        lastPaidAt: ts(AGORA - 5 * DIA),
        paidUntil: ts(AGORA + 25 * DIA),
      },
    },
    // Cancelou há 10 dias, depois de pagar.
    {
      uid: 'edu',
      b: {
        ...assinante,
        subscriptionId: 'sub_5',
        subscriptionStatus: 'INACTIVE',
        cancelledAt: ts(AGORA - 10 * DIA),
        lastPaidAt: ts(AGORA - 50 * DIA),
        paidUntil: ts(AGORA - 20 * DIA),
      },
    },
    { uid: 'fe', b: { trialEndsAt: ts(AGORA + 3 * 3600 * 1000) } },
    { uid: 'gil', b: { trialEndsAt: ts(AGORA - 2 * DIA) } },
    { uid: 'hel', b: { courtesyPermanent: true } },
  ];
  const pag = (uid, id, quando, valor, extra) =>
    Object.assign(
      {
        uid,
        id,
        status: 'RECEIVED',
        value: valor,
        netValue: valor - 0.99,
        paymentDate: data(quando),
        subscriptionId: 'sub',
        billingType: 'PIX',
      },
      extra || {}
    );
  const pagamentos = [
    pag('ana', 'p1', AGORA - 20 * DIA, 15),
    pag('bia', 'p2', AGORA - 2 * DIA, 7.5),
    pag('caio', 'p3', AGORA - 40 * DIA, 15),
    pag('duda', 'p4', AGORA - 5 * DIA, 15, { subscriptionId: null }),
    pag('edu', 'p5', AGORA - 50 * DIA, 15),
    // Estornado não é receita.
    pag('ana', 'p6', AGORA - 3 * DIA, 15, { status: 'REFUNDED' }),
    // Conta excluída (registro fiscal): ainda é receita do histórico.
    pag('zeca', 'p7', AGORA - 70 * DIA, 15),
    // O mesmo pagamento repetido não soma duas vezes.
    pag('bia', 'p2', AGORA - 2 * DIA, 7.5),
  ];
  const usuarios = [
    usuario('ana', AGORA - 60 * DIA),
    usuario('bia', AGORA - 3 * DIA),
    usuario('caio', AGORA - 45 * DIA),
    usuario('duda', AGORA - 10 * DIA),
    usuario('edu', AGORA - 70 * DIA),
    usuario('fe', AGORA - 4 * DIA),
    usuario('gil', AGORA - 9 * DIA, { emailVerified: false }),
    usuario('hel', AGORA - 1 * 3600 * 1000),
    usuario('ivo', AGORA - 2 * DIA, { disabled: true }),
  ];
  const uso = [
    {
      uid: 'ana',
      ultimoUsoMs: AGORA - 3600e3,
      areas: [{ area: 'Telegram', ms: 1 }],
      testador: false,
    },
    { uid: 'bia', ultimoUsoMs: AGORA - 3 * DIA, areas: [], testador: true },
    { uid: 'fe', ultimoUsoMs: AGORA - 20 * DIA, areas: [], testador: false },
    { uid: 'gil', ultimoUsoMs: 0, areas: [], testador: false },
  ];
  return montarPainel({ agora: AGORA, billings, pagamentos, usuarios, uso });
}

test('receita recorrente: MRR com quem tem fatura em aberto, sem cortesia nem avulso', () => {
  const r = cenario().receita;
  // ana 15 + bia 7,50. caio (atraso) vai para o MRR em risco; duda é avulso.
  assert.equal(r.mrrCents, 2250);
  assert.equal(r.arrCents, 27000);
  assert.equal(r.mrrRiscoCents, 1500);
  assert.equal(r.avulsoMensalCents, 1500);
  assert.equal(r.assinantes, 2);
  assert.equal(r.basePagante, 4);
  assert.equal(r.arpuCents, 1125);
  assert.equal(r.descontoMensalCents, 750);
  assert.equal(r.assinantesComDesconto, 1);
  assert.deepEqual(r.metodos, { PIX: 1, CREDIT_CARD: 1 });
});

test('churn e LTV: cancelamento INACTIVE conta', () => {
  const c = cenario().conversao;
  assert.equal(c.canceladosUlt30, 1);
  // 1 ÷ (2 assinantes + 1 em atraso + 1 cancelado)
  assert.equal(c.churnMensal, 0.25);
  assert.equal(c.ltvCents, 4500);
});

test('conversão: só quem já terminou o teste entra na conta', () => {
  const c = cenario().conversao;
  // Pagaram: ana, bia, caio, duda, edu. Terminou sem pagar: gil.
  // fe ainda está testando e hel é cortesia — ficam fora.
  assert.equal(c.coorte, 6);
  assert.equal(c.converteram, 5);
  assert.equal(c.trialsAtivos, 1);
  assert.equal(c.trialsAcabam48h, 1);
  assert.equal(c.trialExpiradoSemPagar, 1);
});

test('receita realizada: data do pagamento, sem estorno e sem duplicar', () => {
  const r = cenario().realizado;
  // Outubro (Brasília): bia 7,50 (dia 19) + duda 15 (dia 16). ana pagou dia 1.
  assert.equal(r.mesCents, 2250 + 1500);
  assert.equal(r.mesQtd, 3);
  assert.equal(r.ult30Cents, 1500 + 750 + 1500);
  // Total inclui a conta excluída e não inclui o estorno nem a repetição.
  assert.equal(r.totalCents, 1500 * 5 + 750);
  assert.equal(r.taxasCents, 6 * 99);
  assert.equal(r.porMes.length, 12);
  assert.equal(r.porMes[11].mes, '2026-10');
});

test('previsão: renovações com o crédito abatido e trials pela taxa observada', () => {
  const p = cenario().previsao;
  // ana 15 + bia 7,50 − 3,00 de crédito = 19,50. caio (atraso) fica à parte.
  assert.equal(p.proximos30.renovacoesCents, 1950);
  assert.equal(p.proximos30.renovacoesQtd, 2);
  assert.equal(p.proximos30.atrasoCents, 1500);
  assert.equal(p.proximos30.avulsosCents, 1500);
  // 1 trial × R$ 15 × 5/6
  assert.equal(p.proximos30.trialsProvavelCents, 1250);
  assert.equal(p.proximos30.esperadoCents, 1950 + 1250);
  // Novo MRR de 30 dias: primeiro pagamento de ana (há 20 dias) e de bia
  // (há 2) = 22,50; duda pagou avulso, não é recorrente. Cancelado: edu 15,00.
  assert.equal(p.mrrNovo30Cents, 2250);
  assert.equal(p.mrrCancelado30Cents, 1500);
  assert.equal(p.mrrLiquidoNovo30Cents, 750);
  assert.deepEqual(
    p.projecao.map((x) => x.mrrCents),
    [2250 + 3 * 750, 2250 + 6 * 750, 2250 + 12 * 750]
  );
});

test('volumetria: cadastros, uso real e séries no fuso de Brasília', () => {
  const v = cenario().volume;
  assert.equal(v.cadastros, 9);
  assert.equal(v.verificados, 8);
  assert.equal(v.suspensos, 1);
  assert.equal(v.hoje, 1);
  assert.equal(v.novos7, 4);
  assert.equal(v.novos30, 6);
  assert.equal(v.novos30Anterior, 2);
  assert.equal(v.iniciaramTeste, 8);
  assert.equal(v.cadastrosPorDia.length, 90);
  assert.equal(v.cadastrosPorDia[89].date, '2026-10-21');
  assert.equal(v.cadastrosPorMes[11].count, 6);
  assert.equal(v.ativos.dia, 1);
  assert.equal(v.ativos.semana, 2);
  assert.equal(v.ativos.mes, 3);
  assert.equal(v.ativos.nuncaUsaram, 1);
  assert.equal(v.ativos.algumaVez, 3);
  assert.equal(v.ativos.telegram, 1);
  assert.equal(v.ativos.testadores, 1);
  assert.equal(v.ativos.pagantesAtivos30, 2);
});

test('sem histórico de conversão, a previsão não inventa taxa', () => {
  const n = montarPainel({
    agora: AGORA,
    billings: [{ uid: 'a', b: { trialEndsAt: ts(AGORA + DIA) } }],
    pagamentos: [],
    usuarios: [usuario('a', AGORA - DIA)],
    uso: null,
  });
  assert.equal(n.conversao.taxa, null);
  assert.equal(n.previsao.proximos30.trialsProvavelCents, null);
  assert.equal(n.conversao.churnMensal, null);
  assert.equal(n.conversao.ltvCents, null);
  assert.equal(n.volume.ativos, null);
});

test('mês de Brasília: 31/10 às 22h já é outubro, não novembro', () => {
  const t = Date.UTC(2026, 10, 1, 1, 0, 0); // 31/10 22:00 em Brasília
  assert.equal(inicioMesBR(t, 0), Date.UTC(2026, 9, 1, 3, 0, 0));
});

test('projeção nunca fica negativa quando o mês perde mais do que ganha', () => {
  const n = montarPainel({
    agora: AGORA,
    billings: [
      {
        uid: 'x',
        b: {
          ...assinante,
          subscriptionStatus: 'INACTIVE',
          cancelledAt: ts(AGORA - DIA),
          paidUntil: ts(AGORA - DIA),
        },
      },
    ],
    pagamentos: [],
    usuarios: [],
    uso: [],
  });
  assert.deepEqual(
    n.previsao.projecao.map((x) => x.mrrCents),
    [0, 0, 0]
  );
});
