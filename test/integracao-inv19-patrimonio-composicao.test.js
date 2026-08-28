'use strict';

// INV-19 — Patrimônio total = saldo + investido + bens.
//
// O KPI do topo do Meu Patrimônio é a soma de três parcelas que vêm de três
// módulos diferentes (contas, historicoCompras, bens). O card logo abaixo
// mostra as parcelas separadas. Se a soma não bater com as partes, o usuário vê
// a incoerência na mesma tela.
//
// Bem arquivado sai da conta — bensAtivos() filtra por !arquivado.
//
// Ver .claude/integracoes/mapa.json → INV-19.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = require('./_harness-integracao.js').ORDEM_BASE.concat(['web/appliquei-bens.js']);

test('INV-19: o total é exatamente a soma das três parcelas', () => {
  const s = carregarApp({}, ORDEM);
  s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 5000 });
  s.bens = [
    { id: 'bem_1', tipo: 'imovel', nome: 'Apto', valorAtual: 300000, arquivado: false },
    { id: 'bem_2', tipo: 'veiculo', nome: 'Carro', valorAtual: 50000, arquivado: false },
  ];

  const saldo = s.mpCalcularSaldoTotal(Date.now());
  const bensTotal = s.totalBensAtual();

  assert.equal(saldo, 5000);
  assert.equal(bensTotal, 350000);
  assert.equal(saldo + bensTotal, 355000, 'saldo + bens, sem investimentos neste cenário');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-19: bem arquivado sai do patrimônio', () => {
  const s = carregarApp({}, ORDEM);
  s.bens = [
    { id: 'bem_1', tipo: 'imovel', nome: 'Apto', valorAtual: 300000, arquivado: false },
    { id: 'bem_2', tipo: 'veiculo', nome: 'Carro vendido', valorAtual: 50000, arquivado: true },
  ];
  assert.equal(s.bensAtivos().length, 1, 'só o bem ativo conta');
  assert.equal(s.totalBensAtual(), 300000, 'o carro vendido não pode inflar o patrimônio');
});

test('INV-19: arquivar um bem desce o total na hora', () => {
  const s = carregarApp({}, ORDEM);
  s.bens = [{ id: 'bem_1', tipo: 'veiculo', nome: 'Carro', valorAtual: 50000, arquivado: false }];
  assert.equal(s.totalBensAtual(), 50000);
  s.bens[0].arquivado = true;
  assert.equal(s.totalBensAtual(), 0);
});

test('INV-19: bem com valor negativo é acusado', () => {
  const v = validarEstado(
    { contas: [], transacoes: [], bens: [{ id: 'bem_1', nome: 'Apto', valorAtual: -1000 }] },
    { apenas: ['INV-19'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /negativo/);
});
