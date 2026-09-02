'use strict';

// "Ao incluir um investimento futuro, deve aparecer a lista dos bancos cfe
// saldos futuros."
//
// O seletor de conta pagadora listava sempre o saldo de HOJE. Agendar um aporte
// para depois do salário cair era impossível: a conta aparecia zerada (ou não
// aparecia) e a compra era barrada por "saldo insuficiente" contra um saldo que
// já não seria o daquele dia.
//
// A projeção parte da foto de hoje e aplica o que está agendado até a data da
// operação — receitas E despesas, pagas ou não. Só receitas deixaria o saldo
// otimista: mostraria o salário do dia 5 e esconderia o aluguel do dia 10.
//
// Granularidade é o DIA: mpTimestampTransacao devolve o 1º do mês da
// competência (correto para o Controle, grosso demais aqui), então a projeção
// usa mpDataMovimento — a data real do lançamento.
//
// DUAS ASSERÇÕES DESTE ARQUIVO ESTÃO PARADAS (`todo`), e não por serem falsas.
//
// Elas dizem que o saldo de HOJE não pode conter a receita agendada — e o
// produto discorda: mpTransacaoComputaCaixa conta entrada pela COMPETÊNCIA
// (o 1º dia do mês), esteja paga ou não, então no dia 1º o salário do dia 10 já
// aparece no saldo. Não é descuido: a tela do Controle não deixa marcar receita
// como recebida (o botão é escondido para `categoria === 'receita'`), logo
// `pago` nunca fica true e exigi-lo zeraria o saldo de todo mundo.
//
// O caminho para valer o que está escrito aqui é outro: contar entrada pela
// DATA REAL (mpDataMovimento), como a projeção já faz. Isso muda o número da
// dobra do Meu Patrimônio de quem informa vencimento na receita, e por isso é
// decisão do dono, não de quem passou por aqui. Ver INV-24 no mapa.
//
// Estas asserções ficaram verdes desde 28/08 por sorte de calendário: com
// prazos de "+10 e +20 dias", só nos últimos dez dias do mês eles caem no mês
// seguinte e a competência ainda não começou. A varredura por dia do mês está
// em test/integracao-inv23-projecao-nao-otimista.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const DIA = 86400000;
const emDias = (n) => new Date(Date.now() + n * DIA);
const iso = (d) => d.toISOString().slice(0, 10);

function campos(extra) {
  return Object.assign(
    {
      compraTicker: 'PETR4',
      tipoOperacao: 'compra',
      compraCategoria: 'renda_variavel',
      compraCorretora: 'Rico',
      compraData: '',
      compraVencimento: '',
      compraRentabilidade: '',
      compraQtd: '10',
      compraPreco: '100,00',
      compraSubcategoria: 'acoes',
      compraOrigemRecurso: '',
      compraOrigemBanco: '',
      compraDestinoRecurso: '',
      prevSaldoInicial: '',
      prevRecorrente: false,
      prevDiaRecorrencia: '',
      prevDuracaoAnos: '',
      prevTaxaMensal: '',
      compraTotalOp: '',
    },
    extra || {}
  );
}

// Nubank zerado hoje, salário de 5.000 em +10 dias, aluguel de 1.500 em +20.
function cenario(extra) {
  const fields = campos(extra);
  const s = carregarApp(fields);
  s.abrirDrawerOperacao = () => {};
  s.calcularTotalCompra = () => {};
  s.atualizarProjecaoForm = () => {};

  const nubank = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  const salario = emDias(10);
  s.transacoes.push({
    id: 'r1',
    categoria: 'receita',
    valor: 5000,
    contaId: nubank.id,
    data: salario.toISOString(),
    dataVencimento: iso(salario),
    mes: salario.getMonth(),
    ano: salario.getFullYear(),
    pago: false,
  });
  const aluguel = emDias(20);
  s.transacoes.push({
    id: 'd1',
    categoria: 'despesa_fixa',
    valor: 1500,
    contaId: nubank.id,
    data: aluguel.toISOString(),
    dataVencimento: iso(aluguel),
    mes: aluguel.getMonth(),
    ano: aluguel.getFullYear(),
    pago: false,
  });
  return { s, fields, nubank };
}

test('o saldo de hoje não muda — a projeção só existe para datas futuras', () => {
  const { s, nubank } = cenario();
  assert.equal(s.saldoCaixaPorConta()[nubank.id] || 0, 0);
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 0);
  assert.equal(s.contasComSaldo().length, 0, 'hoje não há conta com saldo');
});

test('projeta receitas agendadas até a data da operação', () => {
  const { s, nubank } = cenario();
  assert.equal(s.saldoCaixaPorConta(emDias(15).getTime())[nubank.id], 5000);
  const lista = s.contasComSaldo(emDias(15).getTime());
  assert.equal(lista.length, 1);
  assert.equal(lista[0].saldo, 5000, 'o Nubank aparece com o salário já creditado');
});

test('projeta também as despesas agendadas — o saldo futuro não é otimista', () => {
  const { s, nubank } = cenario();
  // +25d já passou do aluguel: 5000 − 1500.
  assert.equal(s.saldoCaixaPorConta(emDias(25).getTime())[nubank.id], 3500);
});

test('a projeção é por DIA, não por mês de competência', () => {
  const { s, nubank } = cenario();
  // Salário (+10) e aluguel (+20) caem no mesmo mês de competência. Em +15 o
  // aluguel ainda não venceu e não pode estar descontado.
  assert.equal(s.saldoCaixaPorConta(emDias(15).getTime())[nubank.id], 5000);
  assert.equal(s.saldoCaixaPorConta(emDias(25).getTime())[nubank.id], 3500);
});

test('compra agendada passa contra o saldo projetado e é barrada contra o de hoje', () => {
  const { s, fields, nubank } = cenario();
  fields.compraOrigemRecurso = nubank.id;

  fields.compraData = iso(new Date());
  s.registrarOperacaoAtivo();
  assert.equal(s.__ultimoToast.tipo, 'erro', 'hoje o Nubank está zerado');
  assert.equal(s.historicoCompras.length, 0);

  Object.assign(fields, campos({ compraData: iso(emDias(15)), compraOrigemRecurso: nubank.id }));
  s.registrarOperacaoAtivo();
  assert.equal(s.__ultimoToast.tipo, 'sucesso', s.__ultimoToast.msg);
  assert.equal(s.historicoCompras.length, 1);
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('compra agendada acima do saldo projetado é bloqueada, com a data no aviso', () => {
  const { s, fields, nubank } = cenario();
  Object.assign(fields, {
    compraData: iso(emDias(25)),
    compraQtd: '40', // 4.000 > 3.500 projetados
    compraOrigemRecurso: nubank.id,
  });
  s.registrarOperacaoAtivo();

  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.match(s.__ultimoToast.msg, /Saldo insuficiente/);
  assert.match(s.__ultimoToast.msg, /\d{2}\/\d{2}\/\d{4}/, 'o aviso diz de que dia é o saldo');
  assert.equal(s.historicoCompras.length, 0);
});

test('aportes já agendados consomem o saldo projetado do dia seguinte', () => {
  const { s, fields, nubank } = cenario();
  // Primeiro aporte de 2.000 em +15d (projetado 5.000).
  Object.assign(fields, campos({ compraData: iso(emDias(15)), compraQtd: '20' }));
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();
  assert.equal(s.__ultimoToast.tipo, 'sucesso', s.__ultimoToast.msg);

  // Em +25d sobram 5.000 − 1.500 (aluguel) − 2.000 (aporte) = 1.500.
  assert.equal(s.saldoCaixaPorConta(emDias(25).getTime())[nubank.id], 1500);

  Object.assign(fields, campos({ compraData: iso(emDias(25)), compraQtd: '20' }));
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();
  assert.equal(s.__ultimoToast.tipo, 'erro', 'o segundo aporte de 2.000 não cabe');
  assert.deepEqual(validarEstado(estadoDe(s)), []);
});

test('o seletor mostra o saldo projetado quando a data da operação é futura', () => {
  const { s, fields, nubank } = cenario();
  fields.compraData = iso(emDias(15));

  const html = s.optionsContasComSaldo({ refMs: s.dataOperacaoRefMs() });
  assert.match(html, new RegExp(nubank.id), 'a conta aparece na lista');
  assert.match(html, /5\.000,00/, 'com o saldo projetado para aquele dia');
});
