'use strict';

// O mês por tipo (Receitas, Despesas, Cartão, Investimentos, Sonhos) em lista.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

function tx(s, cat, valor, mes, ano) {
  s.transacoes.push({ id: cat + mes + valor, categoria: cat, valor, mes, ano, descricao: cat });
}

test('cinco tipos com fatia da receita e variação contra o mês anterior', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.length = 0;
  tx(s, 'receita', 10000, 9, 2026);
  tx(s, 'receita', 8000, 10, 2026);
  tx(s, 'despesa_fixa', 2000, 9, 2026);
  tx(s, 'despesa_fixa', 3000, 10, 2026);
  tx(s, 'cartao_credito', 1000, 10, 2026);
  const d = s.ctlTiposDados(10, 2026);
  const por = Object.fromEntries(d.map((x) => [x.k, x]));
  assert.deepEqual(
    Array.from(d, (x) => x.k),
    ['receita', 'despesas', 'cartao', 'investimentos', 'sonhos']
  );
  assert.equal(por.receita.valor, 8000);
  assert.equal(Math.round(por.receita.variacao), -20);
  assert.equal(por.receita.bom, false, 'receita caiu: ruim');
  assert.equal(Math.round(por.despesas.variacao), 50);
  assert.equal(por.despesas.bom, false, 'despesa subiu: ruim');
  assert.equal(Math.round(por.despesas.fatia), 38);
  assert.equal(por.cartao.variacao, null, 'sem mês anterior para comparar');
  assert.match(s.ctlTiposHtml(10, 2026), /ctlIrParaTipo\('cartao'\)/);
});
