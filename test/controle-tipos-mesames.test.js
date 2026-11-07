'use strict';

// O mês por tipo (Receitas, Despesas, Cartão, Investimentos, Sonhos) e as
// despesas por categoria da tabela mês a mês.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

test('o mês por tipo separa despesas de cartão e mede contra o que entrou', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const t = s.ctlTiposDoMes({
    receita: 9000,
    resgate: 1000,
    despFixa: 2000,
    despVar: 1000,
    cartao: 1500,
    invFixo: 500,
    invVar: 500,
    sonho: 250,
  });
  const por = Object.fromEntries(t.map((x) => [x.tipo, x]));
  assert.equal(por.receita.v, 10000);
  assert.equal(por.despesa.v, 3000);
  assert.equal(por.despesa.pct, 30);
  assert.equal(por.cartao.v, 1500);
  assert.equal(por.investimento.v, 1000);
  assert.equal(por.sonho.pct, 3);
  assert.match(s.ctlTiposHtml({ receita: 100 }), /ctlIrParaTipo\('cartao'\)/);
});

test('categorias da tabela: todas as que tiveram gasto, da maior soma para a menor', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const ord = s.dreCategoriasOrdenadas([
    { categorias: { moradia: 2000, alimentacao: 500 } },
    { categorias: { alimentacao: 700, __sem_categoria__: 30, lazer: 0 } },
  ]);
  assert.deepEqual(
    ord.map((c) => c.slug),
    ['moradia', 'alimentacao', '__sem_categoria__']
  );
  assert.equal(ord[1].total, 1200);
});
