'use strict';

// "Seu plano do mês" (nov/2026): a soma dos limites por categoria contra a
// renda, como ela se divide, e o estado de cada limite olhando o que ainda
// pode mudar (o fixo da categoria não deixa ninguém "perto do limite").

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const NOV = 10;
const ANO = 2026;
const DIA9 = new Date(ANO, NOV, 9, 12);

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.length = 0;
  const L = (id, valor, categoria, categoriaDespesa, extra) =>
    s.transacoes.push(
      Object.assign(
        { id, descricao: id, valor, categoria, categoriaDespesa, mes: NOV, ano: ANO },
        extra || {}
      )
    );
  // O mês do print de 09/11.
  L('renda', 6700, 'receita');
  L('fin', 1250, 'despesa_fixa', 'moradia', { groupId: 'g1' });
  L('cond', 1038.92, 'despesa_fixa', 'moradia', { groupId: 'g2' });
  L('merc', 860.84, 'despesa_variavel', 'alimentacao');
  L('comb', 284, 'despesa_variavel', 'transporte');
  L('loja', 189.99, 'despesa_variavel', 'cuidados_pessoais');
  s.definirLimiteCategoria('moradia', 2300);
  s.definirLimiteCategoria('alimentacao', 491);
  s.definirLimiteCategoria('transporte', 300);
  return s;
}

test('estado: fixo dentro do limite é "ok", não "perto" — mesmo em 99%', () => {
  const s = mundo();
  assert.equal(s.estadoLimiteCategoria('moradia', NOV, ANO, 2288.92, 2300, DIA9), 'ok');
  assert.equal(s.estadoLimiteCategoria('alimentacao', NOV, ANO, 860.84, 491, DIA9), 'passou');
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 300, DIA9), 'perto');
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 0, DIA9), null);
});

test('estado "ritmo": dentro dos 80%, mas rápido demais para o dia do mês', () => {
  const s = mundo();
  s.definirLimiteCategoria('transporte', 1000);
  // 284 de 1000 no dia 9: o esperado era 300 → no ritmo.
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 1000, DIA9), 'ok');
  // No dia 3, o esperado era 100: R$ 184 acima, folga de R$ 100.
  const dia3 = new Date(ANO, NOV, 3, 12);
  assert.equal(s.estadoLimiteCategoria('transporte', NOV, ANO, 284, 1000, dia3), 'ritmo');
});

test('plano: soma dos limites, sobra planejada sobre a renda e quem passou', () => {
  const s = mundo();
  const p = s.planoDoMes(NOV, ANO, DIA9);
  assert.equal(p.renda, 6700);
  assert.equal(p.planejado, 3091);
  assert.equal(p.sobraPlanejada, 3609);
  assert.deepEqual(
    JSON.parse(JSON.stringify(p.cats.map((c) => c.slug))),
    ['moradia', 'alimentacao', 'transporte'],
    'do maior limite para o menor'
  );
  assert.equal(Math.round(p.gastoNoPlano * 100), Math.round((2288.92 + 860.84 + 284) * 100));
  assert.equal(p.passou, 1);
  assert.equal(p.atencao, 1);
  assert.equal(p.dentro, 1);
  assert.equal(p.fora.length, 1);
  assert.equal(p.fora[0].slug, 'cuidados_pessoais');
  assert.equal(p.foraDoPlano, 189.99);
});

test('cartão do plano: valores, sobra, aviso de passar e o caminho para ajustar', () => {
  const s = mundo();
  const html = s.htmlPlanoDoMes(s.planoDoMes(NOV, ANO, DIA9));
  assert.match(html, /Seu plano do mês/);
  assert.match(html, /planejados de/);
  assert.match(html, /Sobra planejada/);
  assert.match(html, /acima do planejado/);
  assert.match(html, /1 passou/);
  assert.match(html, /Fora do plano/);
  assert.match(html, /abrirModalConfig\('categorias'\)/);
});

test('plano maior que a renda vira aviso; sem limite nenhum, o convite para montar', () => {
  const s = mundo();
  s.definirLimiteCategoria('moradia', 9000);
  const p = s.planoDoMes(NOV, ANO, DIA9);
  assert.ok(p.sobraPlanejada < 0);
  assert.match(s.htmlPlanoDoMes(p), /Plano passa da renda/);
  ['moradia', 'alimentacao', 'transporte'].forEach((c) => s.definirLimiteCategoria(c, 0));
  assert.match(s.htmlPlanoDoMes(s.planoDoMes(NOV, ANO, DIA9)), /Montar meu plano/);
});

test('categoria quase toda fixa não mostra "cabe R$ 3 por semana"', () => {
  const s = mundo();
  const r = s.ritmoLimiteCategoria('moradia', NOV, ANO, DIA9);
  assert.equal(r.estado, 'ok');
  assert.equal(s.ritmoTemFolgaUtil(r), false);
  assert.equal(s.textoRitmoLimite(r), '');
});
