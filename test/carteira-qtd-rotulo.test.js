// "1 cotas" aparecia no plano de compras: a unidade ia sempre no plural.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../web/appliquei-motor-carteira.js');

test('uma unidade vai no singular, mais de uma no plural', () => {
  assert.strictEqual(M.qtdRotulo({ classe: 'fii', quantidade: 1, unidade: 'cotas' }), '1 cota');
  assert.strictEqual(M.qtdRotulo({ classe: 'fii', quantidade: 17, unidade: 'cotas' }), '17 cotas');
  assert.strictEqual(M.qtdRotulo({ classe: 'acao', quantidade: 1, unidade: 'ações' }), '1 ação');
  assert.strictEqual(M.qtdRotulo({ classe: 'acao', quantidade: 11, unidade: 'ações' }), '11 ações');
});

test('cripto mostra só a quantidade e sem quantidade não mostra nada', () => {
  assert.strictEqual(
    M.qtdRotulo({ classe: 'cripto', quantidade: 0.0012, unidade: 'unidades' }),
    '0.0012'
  );
  assert.strictEqual(M.qtdRotulo({ classe: 'rf', quantidade: null, unidade: null }), '');
});
