'use strict';

// Pacote de controle por categoria (nov/2026):
//   1. Chips do extrato somam só o que a aba de cima mostra.
//   2. Ritmo do limite: quanto cabe por semana/dia e "acima do ritmo",
//      com o fixo da categoria saindo do limite antes.
//   3. Categoria repetida: "FARMACIA" aponta para Saúde; nome em caixa alta
//      é normalizado.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

function mundo() {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.transacoes.length = 0;
  return s;
}

// ---------------------------------------------------------------------------
// 1. Chips do extrato
// ---------------------------------------------------------------------------

const ITENS = [
  { tipo: 'receita', cat: 'tipo:receita', origem: 'conta:a', valor: 6700 },
  { tipo: 'despesa', cat: 'alimentacao', origem: 'conta:a', valor: -750 },
  { tipo: 'despesa', cat: 'moradia', origem: 'conta:a', valor: -984.29 },
  { tipo: 'despesa', cat: 'moradia', origem: 'conta:b', valor: -1250 },
  { tipo: 'cartao', cat: 'alimentacao', origem: 'cartao:x', valor: -100 },
];

test('em Saídas, os chips não trazem a receita e somam só saídas', () => {
  const s = mundo();
  const r = s.extratoTotaisCategoria(ITENS, 'despesa', '');
  assert.deepEqual(
    r.map(([k]) => k),
    ['moradia', 'alimentacao']
  );
  assert.equal(r[0][1], 2234.29);
  assert.equal(r[1][1], 750, 'a compra do cartão fica na aba Cartão');
});

test('em Todos, cada categoria tem o seu total; a conta escolhida também filtra', () => {
  const s = mundo();
  const todos = s.extratoTotaisCategoria(ITENS, 'todos', '');
  assert.equal(todos[0][0], 'tipo:receita');
  assert.equal(todos.find(([k]) => k === 'alimentacao')[1], 850);
  const contaB = s.extratoTotaisCategoria(ITENS, 'despesa', 'conta:b');
  assert.deepEqual(JSON.parse(JSON.stringify(contaB)), [['moradia', 1250]]);
});

// ---------------------------------------------------------------------------
// 2. Ritmo do limite
// ---------------------------------------------------------------------------

const NOV = 10;
const ANO = 2026;
const DIA8 = new Date(ANO, NOV, 8, 12);

function lanc(s, id, valor, extra) {
  s.transacoes.push(
    Object.assign(
      {
        id,
        descricao: id,
        valor,
        categoria: 'despesa_variavel',
        categoriaDespesa: 'alimentacao',
        mes: NOV,
        ano: ANO,
      },
      extra || {}
    )
  );
}

test('dia 8: R$ 750 de R$ 1.200 está acima do ritmo, mesmo abaixo de 80%', () => {
  const s = mundo();
  s.definirLimiteCategoria('alimentacao', 1200);
  lanc(s, 'm1', 618);
  lanc(s, 'm2', 132);
  const r = s.ritmoLimiteCategoria('alimentacao', NOV, ANO, DIA8);
  assert.equal(r.estado, 'acima');
  assert.equal(Math.round(r.esperado), 320); // 1200 × 8/30
  assert.equal(Math.round(r.acima), 430);
  assert.equal(r.diasRestantes, 23);
  assert.equal(Math.round(r.porSemana), 137); // 450 / 23 × 7
  assert.match(s.textoRitmoLimite(r), /acima do ritmo$/);
  assert.equal(s.situacaoLimiteCategoria(750, 1200).estado, 'ok');
});

test('no ritmo: mostra quanto cabe por semana; na última semana, por dia', () => {
  const s = mundo();
  s.definirLimiteCategoria('alimentacao', 1200);
  lanc(s, 'm1', 200);
  const r = s.ritmoLimiteCategoria('alimentacao', NOV, ANO, DIA8);
  assert.equal(r.estado, 'ok');
  assert.match(s.textoRitmoLimite(r), /^cabe .* por semana$/);
  const fim = s.ritmoLimiteCategoria('alimentacao', NOV, ANO, new Date(ANO, NOV, 27, 12));
  assert.equal(fim.diasRestantes, 4);
  assert.match(s.textoRitmoLimite(fim), /^cabe .* por dia$/);
});

test('o fixo da categoria sai do limite antes: o dízimo não acende o ritmo no dia 1', () => {
  const s = mundo();
  s.definirLimiteCategoria('lazer', 800);
  lanc(s, 'f1', 676, { categoria: 'despesa_fixa', categoriaDespesa: 'lazer', groupId: 'g' });
  lanc(s, 'v1', 10, { categoriaDespesa: 'lazer' });
  const r = s.ritmoLimiteCategoria('lazer', NOV, ANO, new Date(ANO, NOV, 1, 12));
  assert.equal(r.fixo, 676);
  assert.equal(r.variavel, 10);
  assert.equal(r.livre, 124);
  assert.equal(r.estado, 'ok');
});

test('parcela e fixo mensal do cartão contam como comprometidos; compra avulsa não', () => {
  const s = mundo();
  assert.equal(
    s.lancamentoComprometido({ categoria: 'cartao_credito', descricao: 'TV (3/10)' }),
    true
  );
  assert.equal(
    s.lancamentoComprometido({ categoria: 'cartao_credito', cartaoFixoMensal: true }),
    true
  );
  assert.equal(
    s.lancamentoComprometido({ categoria: 'cartao_credito', descricao: 'Mercado', groupId: 'g' }),
    false
  );
  assert.equal(
    s.lancamentoComprometido({ categoria: 'despesa_variavel', descricao: 'Mercado' }),
    false
  );
});

test('sem ritmo: mês que não é o de hoje, sem limite, ou fixo maior que o limite', () => {
  const s = mundo();
  assert.equal(s.ritmoLimiteCategoria('alimentacao', NOV, ANO, DIA8), null);
  s.definirLimiteCategoria('alimentacao', 300);
  assert.equal(s.ritmoLimiteCategoria('alimentacao', NOV - 1, ANO, DIA8), null);
  lanc(s, 'f', 400, { categoria: 'despesa_fixa' });
  assert.equal(s.ritmoLimiteCategoria('alimentacao', NOV, ANO, DIA8), null);
});

test('Resumo e aviso de salvar falam do ritmo no mês corrente', () => {
  const s = mundo();
  const h = new Date();
  s.definirLimiteCategoria('alimentacao', 10000);
  const t = {
    id: 'x',
    descricao: 'Mercado',
    valor: 7000,
    categoria: 'despesa_variavel',
    categoriaDespesa: 'alimentacao',
    mes: h.getMonth(),
    ano: h.getFullYear(),
  };
  s.transacoes.push(t);
  const r = s.ritmoLimiteCategoria('alimentacao', h.getMonth(), h.getFullYear());
  const l = s
    .gastosPorCategoriaComMedia(h.getMonth(), h.getFullYear())
    .find((x) => x.slug === 'alimentacao');
  assert.equal(l.ritmo.estado, r.estado);
  assert.match(s.ctrlCatLimiteTexto(l), /^de R\$/);
  if (r.estado === 'acima') {
    assert.match(s.ctrlCatLimiteTexto(l), /acima do ritmo$/);
    assert.match(s.complementoLimiteCategoria([t]), /acima do ritmo do mês: cabem/);
  } else {
    assert.equal(s.complementoLimiteCategoria([t]), '');
  }
});

// ---------------------------------------------------------------------------
// 3. Categoria repetida
// ---------------------------------------------------------------------------

test('nomes do dia a dia apontam para a categoria padrão que já cobre o gasto', () => {
  const s = mundo();
  const casa = (n) => (s.categoriaParecida(n) || {}).v || null;
  assert.equal(casa('FARMACIA'), 'saude');
  assert.equal(casa('Farmácias'), 'saude');
  assert.equal(casa('CABELEIREIRO'), 'cuidados_pessoais');
  assert.equal(casa('Combustível'), 'transporte');
  assert.equal(casa('Mistura'), 'alimentacao');
  assert.equal(casa('Exames'), 'saude');
  assert.equal(casa('Pet'), 'pets');
  assert.equal(casa('Lazer'), 'lazer');
  assert.equal(casa('Cafezinho'), null, 'comer fora separado é escolha legítima');
  assert.equal(casa('Viagens'), null);
  assert.equal(casa('Dízimo e oferta'), null);
  assert.equal(casa('ab'), null);
});

test('categoria oculta não é sugerida; a criada repetida aparece, menos ela mesma', () => {
  const s = mundo();
  s.salvarCategoriasDespesaCustom([
    { v: 'saude', oculta: true },
    { v: 'farmacia', label: '💊 FARMACIA' },
  ]);
  assert.equal((s.categoriaParecida('Remédio') || {}).v || null, null);
  assert.equal(s.categoriaParecida('Farmacia').v, 'farmacia');
  assert.equal(s.categoriaParecida('Farmacia', 'farmacia'), null);
});

test('caixa alta vira nome normal; o resto só ganha a inicial maiúscula', () => {
  const s = mundo();
  assert.equal(s.normalizarNomeCategoria('FARMACIA'), 'Farmacia');
  assert.equal(s.normalizarNomeCategoria('  DIZIMO   E OFERTA '), 'Dizimo e Oferta');
  assert.equal(s.normalizarNomeCategoria('comer fora'), 'Comer fora');
  assert.equal(s.normalizarNomeCategoria('Lazer TV'), 'Lazer TV');
  assert.equal(s.normalizarNomeCategoria('PET'), 'PET', 'sigla curta fica');
  assert.equal(s.normalizarNomeCategoria('   '), '');
});
