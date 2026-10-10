'use strict';

// O lado do app do Telegram: itens da caixa de entrada viram transações pelo
// mesmo criarLancamentos() do formulário, sem duplicar, respeitando Desfazer e
// troca de categoria, e sem violar os contratos de integração (saldo da conta,
// cartão existente, competência).

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-telegram.js']);
const plano = (v) => JSON.parse(JSON.stringify(v));

const HOJE = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOJE_YMD = ymd(HOJE);

function app() {
  const win = carregarApp({}, ORDEM);
  win.contas.length = 0;
  win.contas.push(
    { id: 'c_itau', nome: 'Itaú', tipo: 'banco', principal: true },
    { id: 'c_nu', nome: 'Nubank', tipo: 'banco' }
  );
  win.cartoes.length = 0;
  win.cartoes.push({
    id: 'card_nu',
    nome: 'Nubank',
    limite: 5000,
    diaFechamento: 2,
    diaVencimento: 10,
    contaPagadoraId: 'c_nu',
  });
  win.transacoes.length = 0;
  return win;
}

function item(id, lanc, criadoEmMs = 1) {
  return { id, tipo: 'lancamento', criadoEmMs, lanc };
}

const MERCADO = {
  categoria: 'despesa_variavel',
  valor: 52.9,
  descricao: 'Mercado',
  dataCompra: HOJE_YMD,
  parcelas: 1,
  fixo: false,
  diaVencimento: null,
  contaId: 'c_itau',
  banco: 'Itaú',
  cartaoId: null,
  categoriaDespesa: 'alimentacao',
};

function semViolacoes(win) {
  const v = validarEstado({
    transacoes: win.transacoes,
    contas: win.contas,
    cartoes: win.cartoes,
  });
  assert.deepEqual(plano(v), []);
}

test('despesa do Telegram vira transação paga na conta, com id fixo', () => {
  const win = app();
  const r = win.telegramAplicarItens([item('tg1_10', MERCADO)]);
  assert.equal(r.lancados, 1);
  assert.deepEqual(plano(r.confirmar), ['tg1_10']);
  assert.equal(win.transacoes.length, 1);
  const t = win.transacoes[0];
  assert.equal(t.id, 'tg1_10_0');
  assert.equal(t.categoria, 'despesa_variavel');
  assert.equal(t.valor, 52.9);
  assert.equal(t.pago, true, 'compra à vista já sai do caixa');
  assert.equal(t.contaId, 'c_itau');
  assert.equal(t.banco, 'Itaú');
  assert.equal(t.categoriaDespesa, 'alimentacao');
  assert.equal(t.mes, HOJE.getMonth());
  assert.equal(t.ano, HOJE.getFullYear());
  assert.equal(t.obs, 'via Telegram');
  // Persistido no localStorage (é o que o sync sobe).
  const salvo = JSON.parse(win.localStorage.getItem('futurorico_transacoes'));
  assert.equal(salvo.length, 1);
  semViolacoes(win);
});

test('o mesmo item entregue de novo (confirmação perdida) não duplica', () => {
  const win = app();
  win.telegramAplicarItens([item('tg1_10', MERCADO)]);
  const r = win.telegramAplicarItens([item('tg1_10', MERCADO)]);
  assert.equal(r.lancados, 0);
  assert.deepEqual(plano(r.confirmar), ['tg1_10']);
  assert.equal(win.transacoes.length, 1);
});

test('item já aplicado e depois apagado à mão não ressuscita', () => {
  const win = app();
  win.telegramAplicarItens([item('tg1_10', MERCADO)]);
  win.transacoes.length = 0; // usuário excluiu pelo app
  win.telegramAplicarItens([item('tg1_10', MERCADO)]);
  assert.equal(win.transacoes.length, 0);
});

test('compra parcelada no cartão: N parcelas na fatura aberta, pendentes', () => {
  const win = app();
  const r = win.telegramAplicarItens([
    item('tg1_11', {
      categoria: 'cartao_credito',
      valor: 300,
      descricao: 'Tênis',
      dataCompra: HOJE_YMD,
      parcelas: 3,
      tipoCartao: 'parcelado',
      fixo: false,
      contaId: null,
      cartaoId: 'card_nu',
      categoriaDespesa: 'cuidados_pessoais',
    }),
  ]);
  assert.equal(r.lancados, 1);
  assert.equal(win.transacoes.length, 3);
  const cand = win.cartaoFaturasCandidatas(HOJE, 2, 10);
  const venc1 = ymd(cand.aberta.vencimento);
  assert.equal(win.transacoes[0].dataVencimento, venc1, 'mesma fatura que o formulário escolheria');
  assert.deepEqual(
    plano(win.transacoes.map((t) => [t.id, t.descricao, t.valor, t.pago, t.cartaoId])),
    [
      ['tg1_11_0', 'Tênis (1/3)', 100, false, 'card_nu'],
      ['tg1_11_1', 'Tênis (2/3)', 100, false, 'card_nu'],
      ['tg1_11_2', 'Tênis (3/3)', 100, false, 'card_nu'],
    ]
  );
  assert.ok(win.transacoes.every((t) => t.groupId === 'tg1_11_'));
  semViolacoes(win);
});

test('receita entra na conta indicada', () => {
  const win = app();
  win.telegramAplicarItens([
    item('tg1_12', {
      categoria: 'receita',
      valor: 3500,
      descricao: 'Salário',
      dataCompra: HOJE_YMD,
      parcelas: 1,
      fixo: false,
      contaId: 'c_itau',
      banco: 'Itaú',
      categoriaDespesa: null,
    }),
  ]);
  const t = win.transacoes[0];
  assert.equal(t.categoria, 'receita');
  assert.equal(t.contaId, 'c_itau');
  assert.equal(t.categoriaDespesa, undefined);
  semViolacoes(win);
});

test('despesa fixa com dia: 60 meses, primeiro vencimento no próximo dia N', () => {
  const win = app();
  win.telegramAplicarItens([
    item('tg1_13', {
      ...MERCADO,
      categoria: 'despesa_fixa',
      descricao: 'Aluguel',
      valor: 1800,
      fixo: true,
      diaVencimento: 10,
      categoriaDespesa: 'moradia',
    }),
  ]);
  assert.equal(win.transacoes.length, 60);
  const esperado = win.telegramProximoDia(
    new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate(), 12),
    10
  );
  assert.equal(win.transacoes[0].dataVencimento, ymd(esperado));
  assert.equal(win.transacoes[0].pago, false, 'fixa é compromisso a vencer');
  semViolacoes(win);
});

test('compra de ontem que cai no mês anterior entra na competência dela', () => {
  const win = app();
  const ontem = new Date(HOJE.getFullYear(), HOJE.getMonth(), 0); // último dia do mês passado
  win.telegramAplicarItens([item('tg1_14', { ...MERCADO, dataCompra: ymd(ontem) })]);
  const t = win.transacoes[0];
  assert.equal(t.mes, ontem.getMonth());
  assert.equal(t.ano, ontem.getFullYear());
});

test('Desfazer remove as transações e impede o item de voltar', () => {
  const win = app();
  win.telegramAplicarItens([item('tg1_15', MERCADO, 1)]);
  assert.equal(win.transacoes.length, 1);
  const r = win.telegramAplicarItens([
    { id: 'desfazer_tg1_15', tipo: 'desfazer', alvo: 'tg1_15', criadoEmMs: 2 },
  ]);
  assert.equal(r.desfeitos, 1);
  assert.equal(win.transacoes.length, 0);
  assert.deepEqual(plano(r.confirmar), ['desfazer_tg1_15']);
  // Outro aparelho que ainda viu o lançamento não o traz de volta.
  win.telegramAplicarItens([item('tg1_15', MERCADO, 1)]);
  assert.equal(win.transacoes.length, 0);
});

test('Desfazer chegando junto com o lançamento: aplica e desfaz na ordem', () => {
  const win = app();
  win.telegramAplicarItens([
    { id: 'desfazer_tg1_16', tipo: 'desfazer', alvo: 'tg1_16', criadoEmMs: 5 },
    item('tg1_16', MERCADO, 1),
  ]);
  assert.equal(win.transacoes.length, 0);
});

test('troca de categoria alcança todas as parcelas', () => {
  const win = app();
  win.telegramAplicarItens([
    item('tg1_17', {
      categoria: 'cartao_credito',
      valor: 200,
      descricao: 'Presente',
      dataCompra: HOJE_YMD,
      parcelas: 2,
      tipoCartao: 'parcelado',
      cartaoId: 'card_nu',
      categoriaDespesa: null,
    }),
  ]);
  win.telegramAplicarItens([
    {
      id: 'cat_tg1_17',
      tipo: 'categoria',
      alvo: 'tg1_17',
      categoriaDespesa: 'lazer',
      criadoEmMs: 9,
    },
  ]);
  assert.deepEqual(plano(win.transacoes.map((t) => t.categoriaDespesa)), ['lazer', 'lazer']);
});

test('troca de descrição alcança todas as parcelas e mantém o "(n/N)"', () => {
  const win = app();
  win.telegramAplicarItens([
    item('tg1_30', {
      categoria: 'cartao_credito',
      valor: 300,
      descricao: 'tenis',
      dataCompra: HOJE_YMD,
      parcelas: 3,
      tipoCartao: 'parcelado',
      cartaoId: 'card_nu',
      categoriaDespesa: null,
    }),
    item('tg1_31', MERCADO, 2),
  ]);
  const r = win.telegramAplicarItens([
    {
      id: 'desc_tg1_30',
      tipo: 'descricao',
      alvo: 'tg1_30',
      descricao: 'Tênis Nike',
      criadoEmMs: 9,
    },
  ]);
  assert.deepEqual(plano(r.confirmar), ['desc_tg1_30']);
  assert.deepEqual(
    plano(win.transacoes.filter((t) => t.id.startsWith('tg1_30_')).map((t) => t.descricao)),
    ['Tênis Nike (1/3)', 'Tênis Nike (2/3)', 'Tênis Nike (3/3)']
  );
  // O outro lançamento não foi tocado.
  assert.equal(win.transacoes.find((t) => t.id.startsWith('tg1_31_')).descricao, 'Mercado');
  semViolacoes(win);
});

test('descrição vazia não apaga a descrição', () => {
  const win = app();
  win.telegramAplicarItens([item('tg1_32', MERCADO)]);
  win.telegramAplicarItens([
    { id: 'desc_tg1_32', tipo: 'descricao', alvo: 'tg1_32', descricao: '   ', criadoEmMs: 9 },
  ]);
  assert.equal(win.transacoes[0].descricao, 'Mercado');
});

test('cartão apagado depois da mensagem: não lança, avisa e libera a caixa', () => {
  const win = app();
  const r = win.telegramAplicarItens([
    item('tg1_18', {
      categoria: 'cartao_credito',
      valor: 50,
      descricao: 'Lanche',
      dataCompra: HOJE_YMD,
      parcelas: 1,
      tipoCartao: 'parcelado',
      cartaoId: 'card_que_nao_existe',
    }),
  ]);
  assert.equal(win.transacoes.length, 0);
  assert.equal(r.recusados[0].erro, 'cartao_sumiu');
  assert.deepEqual(plano(r.confirmar), ['tg1_18']);
});

test('conta do item renomeada/apagada: cai na conta principal de agora', () => {
  const win = app();
  win.telegramAplicarItens([item('tg1_19', { ...MERCADO, contaId: 'c_apagada', banco: '' })]);
  assert.equal(win.transacoes[0].contaId, 'c_itau');
  semViolacoes(win);
});

test('conta principal: a marcada; sem marca, a única; definir troca a flag', () => {
  const win = app();
  assert.equal(win.telegramContaPrincipal().id, 'c_itau');
  win.telegramDefinirContaPrincipal('c_nu');
  assert.equal(win.telegramContaPrincipal().id, 'c_nu');
  assert.deepEqual(plano(win.contas.filter((c) => c.principal).map((c) => c.id)), ['c_nu']);
  const salvas = JSON.parse(win.localStorage.getItem('appliquei_contas'));
  assert.equal(salvas.find((c) => c.principal).id, 'c_nu', 'gravada para o sync levar ao servidor');

  win.contas.length = 0;
  win.contas.push({ id: 'c_unica', nome: 'Carteira', tipo: 'carteira' });
  assert.equal(win.telegramContaPrincipal().id, 'c_unica');
  win.contas.push({ id: 'c_xp', nome: 'XP', tipo: 'corretora' });
  assert.equal(win.telegramContaPrincipal().id, 'c_unica', 'corretora não conta');
  win.contas.push({ id: 'c_2', nome: 'Inter', tipo: 'banco' });
  assert.equal(win.telegramContaPrincipal(), null, 'duas contas e nenhuma marcada: não adivinha');
});
