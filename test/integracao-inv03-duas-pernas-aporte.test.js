'use strict';

// INV-03 — Compra de ativo tem duas pernas e só uma debita o caixa.
//
// registrarOperacaoAtivo grava DUAS transações para a mesma compra:
//
//   perna do ativo   categoria investimento_fixo|investimento_variavel
//                    temLegCaixa: true, sem contaId — serve à carteira/DRE
//   perna de caixa   id tx_origem_{operacaoId}, categoria transferencia_saida
//                    com contaId — é ESTA que debita o dinheiro
//
// mpTransacaoComputaCaixa devolve false para a perna do ativo por causa do
// temLegCaixa. É o que evita o duplo-débito.
//
// A fragilidade: `temLegCaixa` tem UM produtor (renda-fixa.js:906) e UM
// consumidor (patrimonio.js:288), e nada declara esse acordo. Um produtor novo
// de investimento_* que crie perna de caixa sem setar a flag faz o saldo cair
// duas vezes — sem erro, sem aviso, só o número errado.
//
// Ver .claude/integracoes/mapa.json → INV-03.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado, assertSemViolacoes } = require('../scripts/lib/invariantes.js');

const ONTEM = new Date(Date.now() - 86400000).toISOString();
const HOJE = new Date();

function camposCompraRV(extra) {
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

/** Sandbox com 5000 de salário no Nubank e a conta cadastrada. */
function comCaixa(fields) {
  const s = carregarApp(fields);
  s.transacoes.push({
    id: 'rec1',
    categoria: 'receita',
    valor: 5000,
    banco: 'Nubank',
    mes: HOJE.getMonth(),
    ano: HOJE.getFullYear(),
    data: ONTEM,
    pago: false,
  });
  const nubank = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  s.transacoes[0].contaId = nubank.id;
  return { s, nubank };
}

test('INV-03: a compra real gera as duas pernas, com o mesmo valor', () => {
  const fields = camposCompraRV();
  const { s, nubank } = comCaixa(fields);
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  const op = s.historicoCompras[0];
  assert.ok(op, 'a operação foi registrada');

  const ativo = s.transacoes.find((t) => t.categoria === 'investimento_variavel');
  const caixa = s.transacoes.find((t) => t.categoria === 'transferencia_saida');

  assert.ok(ativo, 'perna do ativo existe');
  assert.ok(caixa, 'perna de caixa existe');
  assert.equal(ativo.temLegCaixa, true, 'a perna do ativo tem de estar marcada');
  assert.equal(caixa.id, 'tx_origem_' + op.id, 'o id da perna de caixa embute o operacaoId');
  assert.equal(caixa.contaId, nubank.id, 'a perna de caixa carrega a conta escolhida');
  assert.equal(ativo.valor, caixa.valor, 'as duas pernas representam o mesmo dinheiro');
  assertSemViolacoes(assert, estadoDe(s));
});

test('INV-03: só a perna de caixa debita — o saldo cai UMA vez', () => {
  const fields = camposCompraRV();
  const { s, nubank } = comCaixa(fields);
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  const ativo = s.transacoes.find((t) => t.categoria === 'investimento_variavel');
  assert.equal(
    s.mpTransacaoComputaCaixa(ativo, Date.now()),
    false,
    'a perna do ativo NÃO pode contar no caixa'
  );
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 4000, '5000 - 1000, uma vez só');
  assert.equal(s.mpCalcularSaldoPorInstituicao(Date.now())[nubank.id].caixa, 4000);
});

test('INV-03: sem temLegCaixa o saldo cairia DUAS vezes — e o validador acusa', () => {
  const fields = camposCompraRV();
  const { s, nubank } = comCaixa(fields);
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  // Simula o produtor novo que esquece a flag (a regressão que a invariante teme).
  const ativo = s.transacoes.find((t) => t.categoria === 'investimento_variavel');
  delete ativo.temLegCaixa;

  // O sintoma, medido: 5000 - 1000 - 1000.
  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 3000, 'duplo-débito reproduzido');

  const v = validarEstado(estadoDe(s), { apenas: ['INV-03'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /DUPLO DÉBITO/);
  assert.equal(v[0].gravidade, 'critica');
});

test('INV-03: temLegCaixa sem perna de caixa = compra que não desconta de nada', () => {
  const fields = camposCompraRV();
  const { s, nubank } = comCaixa(fields);
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  // O erro oposto: a perna de caixa some (ou nunca foi criada).
  const idx = s.transacoes.findIndex((t) => t.categoria === 'transferencia_saida');
  s.transacoes.splice(idx, 1);

  assert.equal(s.mpCalcularSaldoTotal(Date.now()), 5000, 'a compra não descontou nada');

  const v = validarEstado(estadoDe(s), { apenas: ['INV-03'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /SEM perna de caixa/);
});

test('INV-03: pernas com valores diferentes são acusadas', () => {
  const fields = camposCompraRV();
  const { s, nubank } = comCaixa(fields);
  fields.compraOrigemRecurso = nubank.id;
  s.registrarOperacaoAtivo();

  const caixa = s.transacoes.find((t) => t.categoria === 'transferencia_saida');
  caixa.valor = 900; // divergiu do ativo (1000)

  const v = validarEstado(estadoDe(s), { apenas: ['INV-03'] });
  assert.ok(
    v.some((x) => /valores diferentes/.test(x.mensagem)),
    'divergência entre as pernas tem de ser acusada'
  );
});

test('INV-03: a compra sem conta-origem é bloqueada antes de gravar qualquer perna', () => {
  const fields = camposCompraRV({ compraOrigemRecurso: '' });
  const { s } = comCaixa(fields);
  const antes = s.transacoes.length;
  s.registrarOperacaoAtivo();

  assert.equal(s.historicoCompras.length, 0, 'não registra a compra');
  assert.equal(s.transacoes.length, antes, 'não cria perna nenhuma');
  assert.equal(s.__ultimoToast.tipo, 'erro');
});
