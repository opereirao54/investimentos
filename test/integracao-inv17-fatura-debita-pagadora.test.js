'use strict';

// INV-17 — Baixa de cartão debita a conta pagadora do cartão.
//
// O cartão é a única categoria que NÃO exige banco no lançamento: a compra
// entra na fatura, e só quando a fatura é paga é que sai dinheiro de uma conta.
// Por isso a conta pagadora vive no CARTÃO, não no lançamento, e é copiada
// para a transação no momento do pagamento.
//
// Duas travas seguram isto:
//   app.js:469        contaPagadoraId é obrigatória no cadastro do cartão
//   controle:1681     ao pagar, cartao.contaPagadoraId → transacao.contaId
//
// Se qualquer uma cair, a fatura paga cai em "A reconciliar" (viola INV-01) e
// a queixa é "paguei a fatura e o saldo do banco não mudou".
//
// Ver .claude/integracoes/mapa.json → INV-17 e cadeiasDeEfeito CADEIA-03.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();

function cenario(fields) {
  const s = carregarApp(fields || {}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 5000 });
  s.cartoes = [
    {
      id: 'card_1',
      nome: 'Visa',
      limite: 3000,
      diaFechamento: 1,
      diaVencimento: 10,
      contaPagadoraId: conta.id,
    },
  ];
  return { s, conta };
}

test('INV-17: pagar a fatura carimba a conta pagadora e debita o caixa', () => {
  const fields = {};
  const { s, conta } = cenario(fields);
  s.transacoes.push({
    id: 'fat_1',
    categoria: 'cartao_credito',
    cartaoId: 'card_1',
    descricao: 'Mercado',
    valor: 300,
    mes: HOJE.getMonth(),
    ano: HOJE.getFullYear(),
    dataVencimento: `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-10`,
    pago: false,
  });
  fields['input-pago-fat_1'] = '300,00';

  // Antes de pagar: nada saiu da conta.
  assert.equal(s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa, 5000);

  s.confirmarPagamento('fat_1');

  const t = s.transacoes[0];
  assert.equal(t.pago, true);
  assert.equal(t.contaId, conta.id, 'a conta pagadora do cartão foi carimbada na transação');
  assert.equal(
    s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa,
    4700,
    'e o caixa do banco desceu de verdade'
  );
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-17: cadastrar cartão sem conta pagadora é BLOQUEADO', () => {
  const fields = {
    novoCartaoNome: 'Master',
    novoCartaoLimite: '2.000,00',
    novoCartaoDiaFech: '1',
    novoCartaoDiaVenc: '10',
    novoCartaoContaPagadora: '', // o usuário não escolheu
  };
  const { s } = cenario(fields);
  const antes = s.cartoes.length;

  s.salvarNovoCartaoConfig();

  assert.equal(s.cartoes.length, antes, 'nenhum cartão pode ser criado sem conta pagadora');
  assert.equal(s.__ultimoToast.tipo, 'erro');
  assert.match(s.__ultimoToast.msg, /conta que paga|Cadastre uma conta/i);
});

test('INV-17: cartão sem contaPagadoraId é acusado pelo validador', () => {
  const v = validarEstado(
    {
      contas: [{ id: 'c1', nome: 'Nubank' }],
      cartoes: [{ id: 'card_1', nome: 'Visa' }],
      transacoes: [],
    },
    { apenas: ['INV-17'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /A reconciliar/);
});

test('INV-17: fatura paga sem debitar a pagadora é acusada', () => {
  const v = validarEstado(
    {
      contas: [
        { id: 'c1', nome: 'Nubank' },
        { id: 'c2', nome: 'Outro' },
      ],
      cartoes: [{ id: 'card_1', nome: 'Visa', contaPagadoraId: 'c1' }],
      transacoes: [
        {
          id: 'fat_1',
          categoria: 'cartao_credito',
          cartaoId: 'card_1',
          valor: 300,
          contaId: 'c2', // debitou a conta errada
          mes: 0,
          ano: 2026,
          dataVencimento: '2026-01-10',
          pago: true,
        },
      ],
    },
    { apenas: ['INV-17'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem debitar a conta pagadora/);
});
