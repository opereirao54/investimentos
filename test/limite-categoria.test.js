'use strict';

// Limite por mês de uma categoria de gasto (canvas "Categorias", nov/2026).
// O limite mora no mesmo array de ajustes de futurorico_categoriasDespesa
// ({ v, limite }); some sem deixar ajuste vazio, e não desfaz rótulo nem oculta.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.length = 0;
  return s;
}

const ajustes = (s) => JSON.parse(s.localStorage.getItem('futurorico_categoriasDespesa') || '[]');

test('definir e tirar o limite de uma categoria padrão não deixa lixo', () => {
  const s = mundo();
  s.definirLimiteCategoria('alimentacao', 800);
  assert.equal(s.obterLimiteCategoria('alimentacao'), 800);
  assert.deepEqual(ajustes(s), [{ v: 'alimentacao', limite: 800 }]);
  s.definirLimiteCategoria('alimentacao', 0);
  assert.equal(s.obterLimiteCategoria('alimentacao'), 0);
  assert.deepEqual(ajustes(s), []);
});

test('tirar o limite preserva o rótulo próprio e a categoria oculta', () => {
  const s = mundo();
  s.salvarCategoriasDespesaCustom([{ v: 'lazer', label: '🎮 Diversão' }]);
  s.definirLimiteCategoria('lazer', 300);
  assert.equal(s.rotuloCategoriaDespesa('lazer'), '🎮 Diversão');
  s.definirLimiteCategoria('lazer', null);
  assert.deepEqual(ajustes(s), [{ v: 'lazer', label: '🎮 Diversão' }]);
});

test('situação: ok abaixo de 80%, perto a partir de 80%, passou acima de 100%', () => {
  const s = mundo();
  assert.equal(s.situacaoLimiteCategoria(100, 0), null);
  assert.equal(s.situacaoLimiteCategoria(79, 100).estado, 'ok');
  assert.equal(s.situacaoLimiteCategoria(80, 100).estado, 'perto');
  assert.equal(s.situacaoLimiteCategoria(100, 100).estado, 'perto');
  assert.equal(s.situacaoLimiteCategoria(101, 100).estado, 'passou');
});

test('gastos por categoria trazem o limite; passar dele acende o alerta', () => {
  const s = mundo();
  const h = new Date();
  s.definirLimiteCategoria('alimentacao', 200);
  s.transacoes.push({
    id: 'a1',
    descricao: 'Mercado',
    valor: 250,
    categoria: 'despesa_variavel',
    categoriaDespesa: 'alimentacao',
    mes: h.getMonth(),
    ano: h.getFullYear(),
  });
  const l = s
    .gastosPorCategoriaComMedia(h.getMonth(), h.getFullYear())
    .find((x) => x.slug === 'alimentacao');
  assert.equal(l.limite, 200);
  assert.equal(l.limiteEstado, 'passou');
  assert.equal(l.alerta, true);
  assert.match(s.ctrlCatLimiteTexto(l), /^passou /);
  assert.match(s.complementoLimiteCategoria([s.transacoes[0]]), /passou do limite/);
});

test('aviso de 80% depois de salvar', () => {
  const s = mundo();
  const h = new Date();
  s.definirLimiteCategoria('saude', 100);
  const t = {
    id: 's1',
    descricao: 'Farmácia',
    valor: 85,
    categoria: 'despesa_variavel',
    categoriaDespesa: 'saude',
    mes: h.getMonth(),
    ano: h.getFullYear(),
  };
  s.transacoes.push(t);
  assert.match(s.complementoLimiteCategoria([t]), /chegou a 85% do limite/);
  s.definirLimiteCategoria('saude', 1000);
  assert.equal(s.complementoLimiteCategoria([t]), '');
});

// ---------------------------------------------------------------------------
// Metas do mês em % (réguas da Saúde do mês)
// ---------------------------------------------------------------------------

test('metas em %: padrão 60/30, valor gravado vale e fora da faixa volta ao padrão', () => {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-relatorio-mensal.js']));
  assert.deepEqual(JSON.parse(JSON.stringify(s.obterMetasPct())), { gasto: 60, investir: 30 });
  s.localStorage.setItem('futurorico_metaGastoPct', '50');
  s.localStorage.setItem('futurorico_metaInvestirPct', '0');
  assert.deepEqual(JSON.parse(JSON.stringify(s.obterMetasPct())), { gasto: 50, investir: 0 });
  s.localStorage.setItem('futurorico_metaGastoPct', '95');
  assert.equal(s.obterMetasPct().gasto, 60);
});

test('a régua de gasto escolhida muda o critério da Saúde do mês', () => {
  const s = carregarApp({}, ORDEM_CONTROLE.concat(['web/appliquei-relatorio-mensal.js']));
  const rep = {
    entradas: 1000,
    pctDespesas: 55,
    pctInvestimentos: 25,
    sonhos: { ativos: 0, noPrazo: 0 },
    jornadaModulosMes: 0,
  };
  let t = s.rmCalcularTermometro(rep);
  assert.equal(t.criterios[0].status, 'verde');
  assert.equal(t.criterios[1].status, 'amarelo');
  s.localStorage.setItem('futurorico_metaGastoPct', '50');
  s.localStorage.setItem('futurorico_metaInvestirPct', '20');
  t = s.rmCalcularTermometro(rep);
  assert.equal(t.criterios[0].status, 'amarelo');
  assert.equal(t.criterios[0].label, 'Despesas ≤ 50% da entrada');
  assert.equal(t.criterios[1].status, 'verde');
});
