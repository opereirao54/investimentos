'use strict';

// INV-20 — cartaoId aponta para um cartão que existe.
//
// A armadilha específica desta base: obterCartao faz
//
//     cartoes.find((c) => c.id === id) || cartoes[0]
//
// O `|| cartoes[0]` é um FALLBACK SILENCIOSO. Um cartaoId apontando para um
// cartão apagado não dá erro nem aviso: o lançamento passa a ser lido como se
// fosse do primeiro cartão da lista — com o vencimento dele, a fatura dele e a
// conta pagadora dele. O dinheiro sai da conta errada e ninguém percebe.
//
// Ver .claude/integracoes/mapa.json → INV-20 e entidades.cartao.fragilidade.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

test('INV-20: obterCartao devolve o cartão certo quando o id existe', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.cartoes = [
    { id: 'card_1', nome: 'Visa', contaPagadoraId: 'c1', diaVencimento: 10 },
    { id: 'card_2', nome: 'Master', contaPagadoraId: 'c2', diaVencimento: 25 },
  ];
  assert.equal(s.obterCartao('card_2').nome, 'Master');
});

test('INV-20: o fallback silencioso existe — e é por isso que a trava é necessária', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  s.cartoes = [
    { id: 'card_1', nome: 'Visa', contaPagadoraId: 'c1', diaVencimento: 10 },
    { id: 'card_2', nome: 'Master', contaPagadoraId: 'c2', diaVencimento: 25 },
  ];
  const achado = s.obterCartao('card_apagado');
  assert.equal(
    achado.nome,
    'Visa',
    'obterCartao NÃO devolve null para id inexistente: cai em cartoes[0]. ' +
      'Se este assert falhar porque agora devolve null, ótimo — mas então há chamadores ' +
      'que assumem objeto e precisam ser revisados antes de relaxar INV-20.'
  );
});

test('INV-20: lançamento apontando para cartão inexistente é acusado', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      cartoes: [{ id: 'card_1', nome: 'Visa', contaPagadoraId: 'c1' }],
      transacoes: [
        {
          id: 'fat_1',
          categoria: 'cartao_credito',
          cartaoId: 'card_apagado',
          valor: 300,
          mes: 0,
          ano: 2026,
          dataVencimento: '2026-01-10',
          pago: false,
        },
      ],
    },
    { apenas: ['INV-20'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /não existe/);
  assert.match(v[0].mensagem, /silenciosamente/);
});

test('INV-20: lançamento de cartão sem cartaoId é acusado', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      cartoes: [{ id: 'card_1', nome: 'Visa', contaPagadoraId: 'c1' }],
      transacoes: [
        { id: 'fat_1', categoria: 'cartao_credito', valor: 300, mes: 0, ano: 2026, pago: false },
      ],
    },
    { apenas: ['INV-20'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem cartaoId/);
});

test('INV-20: a inserção real recusa cartão inválido', () => {
  const s = carregarApp(
    {
      descTransacao: 'Mercado',
      valorTransacao: '300,00',
      categoriaTransacao: 'cartao_credito',
      transacaoFixa: false,
      qtdParcelas: '1',
      dataVencimento: '',
      obsTransacao: '',
      tipoCartaoSelecionado: 'parcelado',
      selectCartao: '__novo__', // o usuário não escolheu um cartão de verdade
      bancoTransacao: '',
    },
    ORDEM_CONTROLE
  );
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  s.cartoes = [{ id: 'card_1', nome: 'Visa', contaPagadoraId: conta.id }];
  s.executarInsercao();

  assert.equal(s.transacoes.length, 0, 'nada gravado sem cartão válido');
  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.match(s.__ultimoToast.msg, /cartão/i);
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});
