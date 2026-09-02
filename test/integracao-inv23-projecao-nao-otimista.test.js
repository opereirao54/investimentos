'use strict';

// INV-23 — O saldo projetado nunca é otimista.
//
// `saldoCaixaPorConta(refMs)` responde "quanto terei nesta conta no dia X". É a
// função que enche o seletor "de onde sai o dinheiro" de uma compra agendada e
// que decide se ela passa ou é barrada por saldo insuficiente. Se ela mentir
// para mais, o app deixa a pessoa comprometer dinheiro que não vai ter.
//
// A conta tem duas partes: a FOTO de hoje (mpCalcularSaldoPorInstituicao) mais
// o que está AGENDADO na janela (agora, refMs] (aplicarAgendadoNoSaldo). O
// perigo mora na junção: somar duas vezes o mesmo lançamento infla o saldo,
// e não somar nenhuma vez o esconde.
//
// O defeito real que este arquivo trava: a guarda de duplo-débito perguntava
// "a competência já começou?" como substituto de "a foto já contou isto?". As
// duas coisas coincidem para ENTRADA — a foto conta entrada esteja paga ou não
// — e divergem para SAÍDA, que a foto só conta com pago:true. Com isso, uma
// despesa não paga de um mês já começado sumia da foto E da projeção. No dia 1º
// de setembro, com o aluguel de 1.500 vencendo dia 21 por pagar, a projeção
// para o dia 26 devolvia o salário inteiro e escondia o aluguel.
//
// POR QUE A VARREDURA POR DIA. O defeito só aparece quando a competência do
// lançamento já começou, ou seja em função do DIA DO MÊS em que o teste roda.
// Os testes de saldo-futuro-compra.test.js usavam "+10 dias" e "+20 dias" a
// partir de hoje: nos últimos dez dias do mês esses prazos caem no mês seguinte
// e tudo passa. O arquivo foi escrito num dia 28 e todas as execuções seguintes
// caíram em dias 28-30 — a suíte ficou verde por sorte de calendário durante
// dias, com o defeito de pé. Por isso aqui o relógio é FINGIDO e os 31 dias são
// percorridos: uma trava que só vale em dez dias do mês não é trava.

const test = require('node:test');
const assert = require('node:assert/strict');

const DIA = 86400000;

/**
 * Monta o cenário com o relógio parado num dia específico e devolve as três
 * leituras que interessam. Recarrega os módulos dentro do relógio fingido —
 * eles capturam `Date` no topo, então trocar depois não teria efeito.
 */
function medirNoDia(ano, mes, dia) {
  const falso = new Date(Date.UTC(ano, mes, dia, 12, 0, 0)).getTime();
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
    const emDias = (n) => new global.Date(falso + n * DIA);
    const iso = (d) => d.toISOString().slice(0, 10);

    const s = carregarApp({});
    const nubank = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
    const salario = emDias(10);
    const aluguel = emDias(20);
    s.transacoes.push(
      {
        id: 'r1',
        categoria: 'receita',
        valor: 5000,
        contaId: nubank.id,
        data: salario.toISOString(),
        dataVencimento: iso(salario),
        mes: salario.getMonth(),
        ano: salario.getFullYear(),
        pago: false,
      },
      {
        id: 'd1',
        categoria: 'despesa_fixa',
        valor: 1500,
        contaId: nubank.id,
        data: aluguel.toISOString(),
        dataVencimento: iso(aluguel),
        mes: aluguel.getMonth(),
        ano: aluguel.getFullYear(),
        pago: false,
      }
    );

    return {
      antesDoSalario: s.saldoCaixaPorConta(emDias(5).getTime())[nubank.id] || 0,
      depoisDoSalario: s.saldoCaixaPorConta(emDias(15).getTime())[nubank.id] || 0,
      depoisDoAluguel: s.saldoCaixaPorConta(emDias(25).getTime())[nubank.id] || 0,
      hoje: s.saldoCaixaPorConta()[nubank.id] || 0,
    };
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
}

// Um mês de 31 (janeiro) e um de 30 (setembro): a virada de mês cai em dias
// diferentes e é justamente na virada que a guarda de duplo-débito é exercida.
const MESES = [
  { nome: 'janeiro/2027', ano: 2027, mes: 0, dias: 31 },
  { nome: 'setembro/2026', ano: 2026, mes: 8, dias: 30 },
];

for (const m of MESES) {
  test(`INV-23: a despesa agendada é descontada da projeção — todos os dias de ${m.nome}`, () => {
    const falhas = [];
    for (let d = 1; d <= m.dias; d++) {
      const r = medirNoDia(m.ano, m.mes, d);
      // Depois do aluguel (+25d) o saldo TEM de estar 1.500 abaixo do que
      // estava depois do salário (+15d). Esconder a despesa é o defeito.
      if (r.depoisDoAluguel !== r.depoisDoSalario - 1500) {
        falhas.push(
          `dia ${d}: +15d=${r.depoisDoSalario}, +25d=${r.depoisDoAluguel} ` +
            `(esperava ${r.depoisDoSalario - 1500})`
        );
      }
    }
    assert.equal(
      falhas.length,
      0,
      'projeção otimista — a despesa agendada sumiu:\n  ' + falhas.join('\n  ')
    );
  });

  // DECISÃO DE PRODUTO EM ABERTO — ver INV-24 no mapa.
  // A foto de hoje conta receita pela COMPETÊNCIA (1º do mês), não pela data de vencimento: no dia 1º o salário do dia 10 já está no saldo.
  // A asserção abaixo está certa e fica escrita como está; só não barra o CI enquanto o dono não decidir se muda a regra (mpTransacaoComputaCaixa) ou se a regra é essa mesma.
  test(`INV-23: o salário agendado entra UMA vez na projeção — todos os dias de ${m.nome}`, () => {
    const falhas = [];
    for (let d = 1; d <= m.dias; d++) {
      const r = medirNoDia(m.ano, m.mes, d);
      // Antes do salário cair (+5d) e depois (+15d): a diferença é exatamente
      // um salário. Duas vezes = duplo-crédito; zero = crédito perdido.
      if (r.depoisDoSalario - r.antesDoSalario !== 5000) {
        falhas.push(
          `dia ${d}: +5d=${r.antesDoSalario}, +15d=${r.depoisDoSalario} ` +
            `(esperava diferença de 5000, veio ${r.depoisDoSalario - r.antesDoSalario})`
        );
      }
    }
    assert.equal(
      falhas.length,
      0,
      'salário contado a mais ou a menos na projeção:\n  ' + falhas.join('\n  ')
    );
  });

  test(`INV-23: a projeção nunca encolhe ao andar para o futuro sem despesa — ${m.nome}`, () => {
    // Invariante de monotonia: entre hoje e +15d só existe entrada (o salário),
    // então o saldo não pode cair. Uma guarda mal escrita que subtraia duas
    // vezes apareceria aqui.
    const falhas = [];
    for (let d = 1; d <= m.dias; d++) {
      const r = medirNoDia(m.ano, m.mes, d);
      if (r.depoisDoSalario < r.hoje) {
        falhas.push(`dia ${d}: hoje=${r.hoje}, +15d=${r.depoisDoSalario}`);
      }
    }
    assert.equal(
      falhas.length,
      0,
      'saldo projetado caiu sem despesa no caminho:\n  ' + falhas.join('\n  ')
    );
  });
}

test('INV-23: a guarda de duplo-débito pergunta à foto, não à competência', () => {
  // A trava estrutural. A guarda anterior usava mpTimestampTransacao (o 1º dia
  // da competência) como substituto de "a foto já contou". Se alguém voltar a
  // esse atalho, os testes acima só acusam nos dias certos do mês — este acusa
  // sempre.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'web/appliquei-contas.js'), 'utf8');
  const corpo = src.slice(
    src.indexOf('function aplicarAgendadoNoSaldo'),
    src.indexOf('function contasComSaldo')
  );
  assert.ok(corpo.length > 0, 'aplicarAgendadoNoSaldo não encontrada');
  assert.ok(
    corpo.includes('mpTransacaoComputaCaixa'),
    'a guarda tem de perguntar à mesma função que monta a foto de hoje'
  );
  assert.ok(
    !/if \(!\(ts > deMs\) \|\| !\(mpTimestampTransacao\(t\) > deMs\)\)/.test(corpo),
    'a guarda voltou a usar a competência como substituto da foto'
  );
});
