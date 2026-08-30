'use strict';

// INV-02 — Banco é obrigatório nas categorias que movimentam caixa direto.
//
// É a porta de entrada que faz INV-01 valer na prática: se o formulário deixar
// salvar uma despesa sem instituição, a transação nasce já violando INV-01 e o
// saldo do banco fica inflado para sempre.
//
// Duas funções decidem isso e TÊM de cobrir o mesmo conjunto:
//   controleCategoriaUsaBanco    → mostra o campo
//   controleBancoObrigatorio     → exige o campo
// Se divergirem, existe categoria que mostra o campo e não o exige (o usuário
// acha que é opcional) ou que exige um campo que nunca apareceu (trava sem
// explicação).
//
// Regressão real já corrigida: antes só receita/resgate eram obrigatórios, e as
// despesas sem banco caíam num bucket "Sem banco". Ver o comentário em
// web/appliquei-aba-controle-financeiro.js:75.
//
// Ver .claude/integracoes/mapa.json → INV-02.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado, CATEGORIAS_BANCO_OBRIGATORIO } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();

function campos(extra) {
  return Object.assign(
    {
      descTransacao: 'Mercado',
      valorTransacao: '200,00',
      categoriaTransacao: 'despesa_variavel',
      transacaoFixa: false,
      qtdParcelas: '1',
      dataVencimento: '',
      obsTransacao: '',
      tipoCartaoSelecionado: '',
      selectCartao: '',
      bancoTransacao: '',
      categoriaDespesaTransacao: 'alimentacao',
    },
    extra || {}
  );
}

test('INV-02: as duas funções cobrem exatamente o mesmo conjunto de categorias', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const todas = [
    'receita',
    'dividendo',
    'resgate_investimento',
    'transferencia_entrada',
    'transferencia_saida',
    'investimento_fixo',
    'investimento_variavel',
    'despesa_fixa',
    'despesa_variavel',
    'cartao_credito',
    'sonho',
    'previdencia',
  ];
  const mostra = todas.filter((c) => s.controleCategoriaUsaBanco(c));
  const exige = todas.filter((c) => s.controleBancoObrigatorio(c));

  assert.deepEqual(
    exige,
    mostra,
    'controleCategoriaUsaBanco e controleBancoObrigatorio divergiram: ' +
      `mostra=[${mostra}] exige=[${exige}]. Uma categoria que mostra o campo sem ` +
      'exigir deixa o usuário salvar sem instituição e viola INV-01.'
  );
});

test('INV-02: o conjunto do código bate com o declarado no mapa', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  for (const cat of CATEGORIAS_BANCO_OBRIGATORIO) {
    assert.equal(
      s.controleBancoObrigatorio(cat),
      true,
      `o mapa declara "${cat}" como banco-obrigatório, mas o código não exige. ` +
        'Atualize .claude/integracoes/mapa.json ou o código — não podem divergir.'
    );
  }
});

test('INV-02: salvar despesa sem banco é BLOQUEADO', () => {
  const f = campos({ bancoTransacao: '' });
  const s = carregarApp(f, ORDEM_CONTROLE);
  s.executarInsercao();

  assert.equal(s.transacoes.length, 0, 'nada pode ser gravado sem instituição');
  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.match(s.__ultimoToast.msg, /banco|instituição/i);
});

test('INV-02: salvar despesa COM banco grava e já carimba o contaId', () => {
  const f = campos({ bancoTransacao: 'Nubank' });
  const s = carregarApp(f, ORDEM_CONTROLE);
  s.executarInsercao();

  assert.equal(s.transacoes.length, 1);
  const t = s.transacoes[0];
  assert.equal(t.banco, 'Nubank');
  assert.ok(t.contaId, 'obterOuCriarContaPorNome tem de carimbar o contaId na hora');
  const conta = s.obterConta(t.contaId);
  assert.ok(conta, 'o contaId aponta para uma conta que existe');
  assert.equal(conta.nome, 'Nubank', 'a conta foi criada com o nome informado');

  // O registro nasce válido perante todas as invariantes da Onda 1.
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-02: receita sem banco também é bloqueada', () => {
  const f = campos({ categoriaTransacao: 'receita', descTransacao: 'Salário', bancoTransacao: '' });
  const s = carregarApp(f, ORDEM_CONTROLE);
  s.executarInsercao();
  assert.equal(s.transacoes.length, 0);
  assert.equal(s.__ultimoToast.tipo, 'erro');
});

test('INV-02: o validador acusa registro gravado sem instituição', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [
        {
          id: 'x',
          categoria: 'despesa_fixa',
          valor: 100,
          mes: HOJE.getMonth(),
          ano: HOJE.getFullYear(),
          pago: false,
        },
      ],
    },
    { apenas: ['INV-02'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /exige instituição/);
});
