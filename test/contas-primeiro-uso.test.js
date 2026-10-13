'use strict';

// Primeiro uso, relatado: "cadastrei uma receita que entra na NuInvest, depois
// cadastrei uma despesa e ele não trouxe a conta com dinheiro — tive que criar
// outra". O salário tinha data futura (a receber): a lista da despesa só
// mostrava contas com saldo positivo HOJE, vinha vazia, e o nome digitado
// virava uma segunda conta. O mesmo valia para "de onde sai o dinheiro" e para
// a corretora em Investimentos. O que este arquivo tranca:
//
//   1. a despesa lista TODAS as contas — a sem saldo diz por quê ("recebe
//      R$ 5.000 em 18/10") — e o saldo é o projetado para a data do lançamento;
//   2. o mesmo nome escrito de outro jeito ("Nu Invest", "nu-invest") encontra
//      a conta existente em vez de criar outra.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const HOJE = new Date();
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const emDias = (n) => new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + n, 12);

function comSalarioAReceber() {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'NuInvest', tipo: 'banco' });
  const venc = emDias(5);
  s.transacoes.push({
    id: 'sal',
    descricao: 'Salário',
    categoria: 'receita',
    valor: 5000,
    contaId: conta.id,
    banco: 'NuInvest',
    mes: venc.getMonth(),
    ano: venc.getFullYear(),
    data: HOJE.toISOString(),
    dataVencimento: ymd(venc),
    pago: false,
  });
  return { s, conta, venc };
}

test('despesa: a conta do salário a receber aparece, dizendo quando o dinheiro entra', () => {
  const { s, venc } = comSalarioAReceber();
  const hoje = s.sugestoesContasDeSaida(Date.now());
  assert.equal(hoje.length, 1, 'antes vinha vazia');
  assert.equal(hoje[0].nome, 'NuInvest');
  assert.match(hoje[0].rotulo, /recebe R\$\s?5\.000,00 em/);
  assert.ok(hoje[0].rotulo.includes(String(venc.getDate()).padStart(2, '0') + '/'));
});

test('despesa depois do salário: o saldo é o projetado para a data dela', () => {
  const { s } = comSalarioAReceber();
  const depois = s.sugestoesContasDeSaida(emDias(10).getTime());
  assert.equal(depois[0].nome, 'NuInvest');
  assert.ok(Math.abs(depois[0].saldo - 5000) < 0.01);
  assert.match(depois[0].rotulo, /previsto nessa data/);
});

test('a conta com dinheiro vem antes da que está zerada', () => {
  const { s } = comSalarioAReceber();
  s.criarConta({ nome: 'Itaú', tipo: 'banco', saldoInicial: 800 });
  const lista = s.sugestoesContasDeSaida(Date.now());
  assert.deepEqual(
    Array.from(lista, (x) => x.nome),
    ['Itaú', 'NuInvest']
  );
});

test('o mesmo nome escrito de outro jeito encontra a conta existente', () => {
  const { s, conta } = comSalarioAReceber();
  for (const n of ['Nu Invest', 'nu-invest', 'NUINVEST', ' NuInvest ']) {
    assert.equal((s.obterContaPorNome(n) || {}).id, conta.id, n);
    assert.equal((s.obterContaPorNomeOuAlias(n) || {}).id, conta.id, n);
  }
  const antes = s.contas.length;
  s.obterOuCriarContaPorNome('Nu Invest');
  assert.equal(s.contas.length, antes, 'não cria a segunda conta');
  assert.equal(s.obterContaPorNome('Nubank'), null, 'nome diferente continua diferente');
  assert.equal(s.mesmaInstituicao('NuInvest', 'nu invest'), true);
  assert.equal(s.mesmaInstituicao('Nubank', 'NuInvest'), false);
});

test('conta arquivada não é ressuscitada pela busca tolerante', () => {
  const { s, conta } = comSalarioAReceber();
  s.arquivarConta(conta.id);
  // A busca exata continua achando (histórico); a tolerante só olha as ativas.
  assert.equal(s.obterContaPorNome('Nu Invest'), null);
});
