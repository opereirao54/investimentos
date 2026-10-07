'use strict';

// INV-23 (continuação) — o vencimento EM ABERTO também pesa na projeção.
//
// O arquivo irmão (integracao-inv23-projecao-nao-otimista.test.js) trava a
// despesa não paga com vencimento no FUTURO. Sobrava a que já venceu — ou
// vence hoje — e ainda não foi baixada.
//
// O DEFEITO. `aplicarAgendadoNoSaldo` cortava tudo com `ts <= deMs` ("se já
// passou, quem manda é a foto"). Só que a foto SÓ CONTA SAÍDA PAGA. O
// lançamento vencido e não baixado não estava na foto nem na projeção: sumia
// das duas, e o saldo projetado ficava otimista pelo valor exato do que a
// pessoa ainda deve.
//
// POR QUE A VARREDURA POR HORA. `mpDataMovimento` ancora o vencimento ao
// MEIO-DIA do dia. Com o filtro `ts > agora`, a conta que vence HOJE era
// contada de manhã e desaparecia à tarde — o mesmo app, os mesmos dados, dois
// resultados conforme a hora em que a tela fosse aberta. O relato que originou
// isto é um print das 21:05: saldo de R$ 599,79, R$ 770 vencendo no dia e
// R$ 659,90 no dia seguinte; o app anunciava faltar R$ 60,11 (= 599,79 −
// 659,90), tendo esquecido os R$ 770. Às 09:00 o mesmo cenário dava −R$ 830,11.
//
// Uma trava que só vale de manhã não é trava — por isso aqui o relógio é
// fingido e as 24 horas são percorridas.

const test = require('node:test');
const assert = require('node:assert/strict');

const DIA = 86400000;

/** Roda o cenário com o relógio parado em (ano, mes, dia, hora). */
function medirNaHora(ano, mes, dia, hora, montar) {
  const falso = new Date(ano, mes, dia, hora, 5, 0).getTime();
  const RealDate = Date;
  const realNow = Date.now;
  Date.now = () => falso;
  global.Date = class extends RealDate {
    constructor(...a) {
      return a.length ? new RealDate(...a) : new RealDate(falso);
    }
    static now() {
      return falso;
    }
  };
  try {
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    const { carregarApp } = require('./_harness-integracao.js');
    const s = carregarApp({});
    const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
    const emDias = (n) => new global.Date(falso + n * DIA);
    const iso = (d) => d.toISOString().slice(0, 10);
    const lancar = (o) => {
      const d = emDias(o.emDias);
      s.transacoes.push({
        id: o.id,
        descricao: o.id,
        categoria: o.categoria || 'despesa_fixa',
        categoriaDespesa: 'moradia',
        valor: o.valor,
        contaId: conta.id,
        data: d.toISOString(),
        dataVencimento: iso(d),
        mes: d.getMonth(),
        ano: d.getFullYear(),
        pago: !!o.pago,
      });
    };
    montar(lancar);
    return {
      saldoEm: (n) => s.saldoCaixaPorConta(falso + n * DIA)[conta.id] || 0,
      hoje: s.saldoCaixaPorConta()[conta.id] || 0,
    };
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
}

// Um dia no meio do mês; o irmão já varre os dias, aqui o eixo é a hora.
const ANO = 2026;
const MES = 8; // setembro
const DIA_MES = 10;

test('o vencimento de HOJE pesa na projeção a qualquer hora do dia', () => {
  // O defeito em estado puro: mesmo cenário, resultado diferente conforme o
  // relógio. Uma conta a pagar não deixa de existir ao meio-dia.
  const porHora = [];
  for (let h = 0; h < 24; h++) {
    const m = medirNaHora(ANO, MES, DIA_MES, h, (lancar) => {
      lancar({ id: 'entrada', categoria: 'receita', valor: 1000, emDias: -20, pago: true });
      lancar({ id: 'vence-hoje', valor: 770, emDias: 0 });
    });
    porHora.push({ h, amanha: Math.round(m.saldoEm(1)) });
  }
  const distintos = [...new Set(porHora.map((x) => x.amanha))];
  assert.equal(
    distintos.length,
    1,
    'a projeção mudou ao longo do dia: ' +
      porHora
        .filter((x, i, a) => i === 0 || x.amanha !== a[i - 1].amanha)
        .map((x) => `${x.h}h=${x.amanha}`)
        .join(' → ')
  );
  assert.equal(distintos[0], 230, 'R$ 1.000 menos os R$ 770 que vencem hoje');
});

test('o vencimento ATRASADO e não baixado continua sendo dinheiro a sair', () => {
  const m = medirNaHora(ANO, MES, DIA_MES, 21, (lancar) => {
    lancar({ id: 'entrada', categoria: 'receita', valor: 1000, emDias: -20, pago: true });
    lancar({ id: 'atrasada', valor: 300, emDias: -5 });
  });
  assert.equal(Math.round(m.hoje), 1000, 'a FOTO não desconta o que ainda não foi pago');
  assert.equal(Math.round(m.saldoEm(3)), 700, 'a PROJEÇÃO tem de contar o que ainda vai sair');
});

test('baixa esquecida há meses não afunda a projeção para sempre', () => {
  // O outro lado do risco: arrastar cadastro velho deixaria o alerta
  // cronicamente vermelho, e alerta que sempre aparece ninguém lê.
  const m = medirNaHora(ANO, MES, DIA_MES, 21, (lancar) => {
    lancar({ id: 'entrada', categoria: 'receita', valor: 1000, emDias: -20, pago: true });
    lancar({ id: 'fossil', valor: 9999, emDias: -40 });
  });
  assert.equal(Math.round(m.saldoEm(3)), 1000, 'lançamento de 40 dias atrás não pode entrar');
});

test('despesa PAGA não é descontada duas vezes', () => {
  // A foto já contou; somar de novo na projeção inflaria a dívida. É a guarda
  // de duplo-débito do INV-23, pelo outro lado.
  const m = medirNaHora(ANO, MES, DIA_MES, 21, (lancar) => {
    lancar({ id: 'entrada', categoria: 'receita', valor: 1000, emDias: -20, pago: true });
    lancar({ id: 'ja-paga', valor: 200, emDias: -2, pago: true });
  });
  assert.equal(Math.round(m.hoje), 800, 'a foto desconta a paga uma vez');
  assert.equal(Math.round(m.saldoEm(3)), 800, 'e a projeção não desconta de novo');
});

test('o cenário do relato: o que falta no pior dia', () => {
  // R$ 599,79 em conta, R$ 770 vencendo hoje, R$ 659,90 em dois dias.
  // O app anunciava -R$ 60,11 às 21h (esquecendo os R$ 770) e -R$ 830,11 às 9h.
  for (const h of [9, 21]) {
    const m = medirNaHora(ANO, MES, DIA_MES, h, (lancar) => {
      lancar({ id: 'entrada', categoria: 'receita', valor: 599.79, emDias: -20, pago: true });
      lancar({ id: 'enel+gas+cond', valor: 770, emDias: 0 });
      lancar({ id: 'plano-saude', valor: 659.9, emDias: 2 });
    });
    const pior = Math.min(...[1, 2, 3, 4].map((d) => m.saldoEm(d)));
    assert.equal(
      Math.round(pior * 100) / 100,
      -830.11,
      'às ' + h + 'h o pior dia deu outro número'
    );
  }
});
