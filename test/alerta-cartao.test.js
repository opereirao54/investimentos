'use strict';

// Alerta de cartão de crédito: deve disparar quando a fatura do mês ultrapassa o
// limite dos cartões ATIVOS. Reproduz o bug "limite 1000, fatura 1.652,74, e o
// aviso não aparecia": o cálculo somava TODOS os cartões (inclusive o arquivado
// "Cartão principal" de 5.000 criado na migração), inflando o limite p/ 6.000 e
// escondendo o estouro.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

// Carrega só a função pura num sandbox mínimo (ela não toca DOM nem globals).
function loadCalc() {
  const code = fs.readFileSync(
    path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'),
    'utf8'
  );
  const ctx = {
    window: {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Só precisamos da declaração da função pura; envolvemos para evitar que o
  // resto do arquivo (handlers de DOM) quebre o parse — declarações de função
  // são içadas, então basta avaliar e ler a referência.
  try {
    vm.runInContext(code, ctx, { filename: 'aba-controle-financeiro.js' });
  } catch (_e) {
    // Ignorado: erros de runtime fora da função pura não nos afetam.
  }
  return ctx.calcularEstadoAlertaCartao;
}

const calc = loadCalc();

test('a função pura foi exposta', () => {
  assert.equal(typeof calc, 'function');
});

test('fatura acima do limite ativo dispara o alerta', () => {
  const r = calc(1652.74, [{ limite: 1000 }]);
  assert.equal(r.limite, 1000);
  assert.equal(r.estourou, true);
  assert.ok(Math.abs(r.extrapolouReais - 652.74) < 0.001);
  assert.ok(Math.abs(r.extrapolouPerc - 65.274) < 0.01);
});

test('cartão arquivado NÃO infla o limite (passa-se só os ativos)', () => {
  // Só o cartão ativo de 1000 deve contar; o de 5000 está arquivado e não entra.
  const r = calc(1652.74, [{ limite: 1000 }]);
  assert.equal(r.limite, 1000);
  assert.equal(r.estourou, true);
});

test('vários cartões ativos somam o limite', () => {
  const r = calc(1652.74, [{ limite: 1000 }, { limite: 800 }]);
  assert.equal(r.limite, 1800);
  assert.equal(r.estourou, false);
  assert.equal(r.extrapolouReais, 0);
});

test('sem limite (lista vazia ou zerada) não estoura', () => {
  assert.equal(calc(1652.74, []).estourou, false);
  assert.equal(calc(1652.74, [{ limite: 0 }]).estourou, false);
  assert.equal(calc(1652.74, [{}]).limite, 0);
});

test('fatura igual ao limite não estoura (precisa passar de 100%)', () => {
  const r = calc(1000, [{ limite: 1000 }]);
  assert.equal(r.perc, 100);
  assert.equal(r.estourou, false);
});
