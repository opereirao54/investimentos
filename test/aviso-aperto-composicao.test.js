'use strict';

// "Nesse aviso, dá para trazer as contas que estão fazendo parte do cálculo?"
//
// O aviso de aperto ("Entre 15/10 e 16/10, sai antes de entrar · R$ 914,03")
// dizia QUANDO e QUANTO, mas não QUAIS contas. Agora "Por que estou vendo
// isto" lista o saldo de hoje nas contas e cada lançamento agendado até a
// volta ao positivo. O que este arquivo tranca:
//
//   1. a lista é a MESMA que o saldo projetado soma (movimentosAgendados):
//      saldo de hoje + lançamentos = saldo do último dia da janela, ao centavo;
//   2. vem em ordem de data, com a conta de cada lançamento;
//   3. o card desenha a lista — e corta em 12 dizendo quantos ficaram de fora.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-insights.js', 'web/appliquei-insights-ui.js']);
const HOJE = new Date();

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const emDias = (n) => new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + n, 12);

function cenario(qtdContas) {
  const s = carregarApp({}, ORDEM);
  const nu = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 300 });
  const pendente = (id, descricao, categoria, valor, dias) => {
    const d = emDias(dias);
    s.transacoes.push({
      id,
      descricao,
      categoria,
      valor,
      contaId: nu.id,
      banco: 'Nubank',
      mes: d.getMonth(),
      ano: d.getFullYear(),
      data: HOJE.toISOString(),
      dataVencimento: ymd(d),
      pago: false,
    });
  };
  for (let i = 0; i < (qtdContas || 2); i++)
    pendente('c' + i, 'Conta ' + i, 'despesa_fixa', 600, 2);
  pendente('sal', 'Salário', 'receita', 5000, 4);
  return { s, nu };
}

function aperto(s) {
  const saldoEm = s.insightsUiFonteDeSaldo();
  assert.ok(saldoEm, 'a projeção roda com as contas cadastradas');
  const ins = s.AppliqueiInsights.aperto({ saldoEm, diasJanelaAperto: 45 });
  assert.ok(ins, 'há aperto entre as contas e o salário');
  return { ins, saldoEm };
}

test('saldo de hoje + lançamentos listados = saldo projetado do último dia', () => {
  const { s } = cenario(2);
  const { ins, saldoEm } = aperto(s);
  const c = s.insightsUiComposicaoAperto(ins, saldoEm);
  assert.ok(Math.abs(c.saldoHoje - 300) < 0.01);
  const soma = c.saldoHoje + c.itens.reduce((a, i) => a + i.valor, 0);
  assert.ok(
    Math.abs(soma - saldoEm(c.ateMs)) < 0.01,
    `a lista explica o número: ${soma} vs ${saldoEm(c.ateMs)}`
  );
});

test('em ordem de data, com a conta de cada lançamento', () => {
  const { s } = cenario(2);
  const { ins, saldoEm } = aperto(s);
  const c = s.insightsUiComposicaoAperto(ins, saldoEm);
  assert.deepEqual(
    Array.from(c.itens, (i) => i.descricao),
    ['Conta 0', 'Conta 1', 'Salário']
  );
  assert.ok(c.itens.every((i) => i.conta === 'Nubank'));
  assert.deepEqual(
    Array.from(c.itens, (i) => i.valor),
    [-600, -600, 5000]
  );
});

test('o card desenha a lista e corta em 12, dizendo quantos ficaram de fora', () => {
  const { s } = cenario(15);
  const { ins, saldoEm } = aperto(s);
  ins.composicao = s.insightsUiComposicaoAperto(ins, saldoEm);
  const html = s.insightsUiCard(ins, null);
  assert.match(html, /Lançamentos que entram na conta/);
  assert.match(html, /Saldo nas suas contas/);
  assert.match(html, /Conta 0/);
  assert.equal((html.match(/class="ins-comp-linha/g) || []).length, 1 + 12);
  assert.match(html, /e mais 3 lançamentos até/);
});

test('sem composição, o card continua como era', () => {
  const { s } = cenario(2);
  const { ins } = aperto(s);
  const html = s.insightsUiCard(ins, null);
  assert.doesNotMatch(html, /ins-comp/);
  assert.match(html, /Primeiro dia no vermelho/);
});

test('aberto de manhã, a conta que vence amanhã fura AMANHÃ — não depois de amanhã', () => {
  // O vencimento conta a partir do meio-dia. Olhando `agora + 1 dia` às 6h, o
  // aluguel de amanhã ainda não tinha vencido e o aviso dizia "primeiro dia
  // no vermelho" um dia depois da data das contas que ele mesmo lista.
  const s = carregarApp({}, ORDEM);
  const manha = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate(), 6, 0, 0).getTime();
  const meioDiaAmanha = new Date(
    HOJE.getFullYear(),
    HOJE.getMonth(),
    HOJE.getDate() + 1,
    12
  ).getTime();
  const saldoEm = (ms) => (ms >= meioDiaAmanha ? -500 : 300);
  const ins = s.AppliqueiInsights.aperto({ saldoEm, agora: manha, diasJanelaAperto: 5 });
  assert.equal(ins.emDias, 1);
  assert.equal(new Date(ins.quandoMs).getDate(), new Date(meioDiaAmanha).getDate());
});

test('conta vencendo HOJE com o salário amanhã: o aviso aparece, com o furo hoje', () => {
  // Regressão real: ao olhar o fim de cada dia começando por amanhã, o salário
  // de amanhã já tinha entrado e o aviso sumia — justo no aperto mais urgente.
  const s = carregarApp({}, ORDEM);
  const manha = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate(), 6, 23).getTime();
  const meioDiaHoje = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate(), 12).getTime();
  const meioDiaAmanha = meioDiaHoje + 86400000;
  const saldoEm = (ms) => 286 - (ms >= meioDiaHoje ? 1200 : 0) + (ms >= meioDiaAmanha ? 5200 : 0);
  const ins = s.AppliqueiInsights.aperto({ saldoEm, agora: manha, diasJanelaAperto: 5 });
  assert.ok(ins, 'o aviso existe');
  assert.equal(ins.emDias, 0);
  assert.equal(new Date(ins.quandoMs).getDate(), new Date(meioDiaHoje).getDate());
  assert.equal(new Date(ins.recuperaMs).getDate(), new Date(meioDiaAmanha).getDate());
});
