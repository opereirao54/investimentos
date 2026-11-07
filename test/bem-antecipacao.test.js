'use strict';

// Registrar antecipação pelo painel do bem (canvas "Antecipar parcelas").
// O dinheiro sai do caixa da conta como ajuste (fora do resultado do mês) e
// a dívida cai o mesmo tanto: o patrimônio líquido não muda.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-bens.js']));
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 60000 });
  const b = s.criarBem({
    nome: 'Apartamento',
    tipo: 'imovel',
    valorAtual: 520000,
    financiamento: {
      ativo: true,
      sistema: 'sac',
      saldoDevedor: 190000,
      parcelasRestantes: 120,
      taxaMensal: 0.008,
      valorParcela: 3103,
    },
  });
  return { s, conta, b };
}

const caixa = (s, conta) =>
  s.mpSaldoInicialConta(s.obterConta(conta.id), Date.now()) +
  s.mpSomaAjustesConta(s.obterConta(conta.id), Date.now());

test('reduzir o prazo: saldo cai, parcelas encurtam, caixa sai o mesmo tanto', () => {
  const { s, conta, b } = mundo();
  const antesCaixa = caixa(s, conta);
  const antesDivida = s.totalDividaBens();
  const r = s.bemRegistrarAntecipacao(b.id, 20000, 'prazo', conta.id);
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.saldoDevedor, 170000);
  assert.ok(fin.parcelasRestantes < 120);
  assert.equal(fin.parcelasRestantes, r.sim.prazo.parcelas);
  assert.equal(fin.antecipacoes.length, 1);
  assert.equal(caixa(s, conta), antesCaixa - 20000);
  assert.equal(s.totalDividaBens(), antesDivida - 20000);
  // Ajuste não é transação: o resultado do mês não vê a antecipação.
  assert.equal(s.transacoes.length, 0);
});

test('reduzir a parcela: prazo igual, parcela menor', () => {
  const { s, conta, b } = mundo();
  s.bemRegistrarAntecipacao(b.id, 20000, 'parcela', conta.id);
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.parcelasRestantes, 120);
  assert.ok(fin.valorParcela < 3103);
});

test('antecipar mais que o saldo quita e não tira do caixa além da dívida', () => {
  const { s, conta, b } = mundo();
  const antes = caixa(s, conta);
  s.bemRegistrarAntecipacao(b.id, 999999, 'prazo', conta.id);
  const fin = s.obterBem(b.id).financiamento;
  assert.equal(fin.saldoDevedor, 0);
  assert.equal(fin.parcelasRestantes, 0);
  assert.equal(caixa(s, conta), antes - 190000);
});

test('valores sugeridos e mês da quitação', () => {
  const { s } = mundo();
  assert.deepEqual(Array.from(s.bemValoresAntecipar(190000)), [10000, 20000, 50000]);
  assert.deepEqual(Array.from(s.bemValoresAntecipar(30000)), [3000, 7500, 15000]);
  const q = s.bemQuitacao(12, new Date(2026, 10, 7));
  assert.equal(q.getFullYear(), 2027);
  assert.equal(q.getMonth(), 10);
});
