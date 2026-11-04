'use strict';

// Redução de cliques do Controle (docs/AVALIACAO-CLIQUES-CONTROLE-2026-11.md).
//
// Trava as regras que tiram toques sem decidir nada pela pessoa:
//   · a conta lembrada (última do mesmo tipo, a do mesmo nome, a única);
//   · excluir avulso sai na hora com "Desfazer"; série, sonho e transferência
//     continuam perguntando;
//   · o desfazer devolve o lançamento igual, na mesma posição, sem duplicar.

const test = require('node:test');
const assert = require('node:assert/strict');

const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ORDEM_UI = ORDEM_CONTROLE.concat(['web/appliquei-lancamento-ui.js']);

function app(fields) {
  const s = carregarApp(fields || {}, ORDEM_UI);
  const nu = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  const itau = s.criarConta({ nome: 'Itaú', tipo: 'banco' });
  return { s, nu, itau };
}

function lanc(s, o) {
  const t = Object.assign(
    {
      id: 'tx' + s.transacoes.length,
      descricao: 'Algo',
      categoria: 'despesa_variavel',
      valor: 10,
      mes: 10,
      ano: 2026,
      dataVencimento: '2026-11-04',
      pago: true,
    },
    o
  );
  s.transacoes.push(t);
  return t;
}

test('conta lembrada: a do último lançamento do mesmo tipo', () => {
  const { s, nu, itau } = app();
  lanc(s, { categoria: 'despesa_variavel', contaId: itau.id, banco: 'Itaú' });
  lanc(s, { categoria: 'receita', contaId: nu.id, banco: 'Nubank' });
  assert.equal(s.lancUiContaLembrada('saida', s.transacoes), 'Itaú');
  assert.equal(s.lancUiContaLembrada('entrada', s.transacoes), 'Nubank');
  // Cartão não tem conta no formulário.
  assert.equal(s.lancUiContaLembrada('cartao', s.transacoes), '');
});

test('conta lembrada: pelo nome, "Mercado" sai de onde saiu da última vez', () => {
  const { s, nu, itau } = app();
  lanc(s, { descricao: 'Mercado', contaId: nu.id, banco: 'Nubank' });
  lanc(s, { descricao: 'Aluguel (3/12)', categoria: 'despesa_fixa', contaId: itau.id });
  lanc(s, { descricao: 'Farmácia', contaId: itau.id, banco: 'Itaú' });
  assert.equal(s.lancUiContaLembrada('saida', s.transacoes, 'mercado'), 'Nubank');
  // A série guarda "(3/12)" no nome; a comparação é pela raiz.
  assert.equal(s.lancUiContaLembrada('saida', s.transacoes, 'Aluguel'), 'Itaú');
  // Nome nunca lançado: nada a trocar (fica a conta que já está no campo).
  assert.equal(s.lancUiContaLembrada('saida', s.transacoes, 'Cinema'), '');
});

test('conta lembrada: sem histórico, só escolhe quando há uma conta', () => {
  const s1 = app().s;
  assert.equal(s1.lancUiContaLembrada('saida', []), '', 'duas contas: a pessoa escolhe');
  const s2 = carregarApp({}, ORDEM_UI);
  s2.criarConta({ nome: 'Inter', tipo: 'banco' });
  s2.criarConta({ nome: 'XP', tipo: 'corretora' });
  assert.equal(s2.lancUiContaLembrada('saida', []), 'Inter', 'corretora não conta');
});

test('conta lembrada: conta arquivada não volta', () => {
  const { s, nu, itau } = app();
  lanc(s, { contaId: itau.id, banco: 'Itaú' });
  lanc(s, { contaId: nu.id, banco: 'Nubank' });
  s.arquivarConta(nu.id);
  assert.equal(s.lancUiContaLembrada('saida', s.transacoes), 'Itaú');
});

test('exclusão desfazível: só o lançamento avulso e simples', () => {
  const { s } = app();
  const d = s.controleExclusaoDesfazivel;
  assert.equal(d({ id: 'a', categoria: 'despesa_variavel' }), true);
  assert.equal(d({ id: 'a', groupId: 'g' }), false, 'série pergunta só este / os futuros');
  assert.equal(d({ id: 'a', sonhoId: 's' }), false, 'sonho tem caminho próprio');
  assert.equal(d({ id: 'a', transferenciaId: 't' }), false, 'transferência é um par');
  assert.equal(d({ id: 'a', operacaoId: 'o' }), false, 'ligado a uma operação');
  assert.equal(d(null), false);
});

test('excluir avulso: sai na hora, sem janela, e o Desfazer devolve igual', () => {
  const { s, nu } = app();
  lanc(s, { id: 'a1', descricao: 'Padaria' });
  const alvo = lanc(s, { id: 'a2', descricao: 'Mercado', contaId: nu.id, valor: 52.9 });
  lanc(s, { id: 'a3', descricao: 'Feira' });
  let desfazer = null;
  s.mostrarToastDesfazer = (msg, fn) => {
    desfazer = fn;
  };
  s.deletarTransacao('a2');
  assert.ok(!s.transacoes.some((t) => t.id === 'a2'), 'excluído sem confirmar');
  assert.equal(typeof desfazer, 'function', 'o aviso traz o Desfazer');
  desfazer();
  assert.deepEqual(
    s.transacoes.map((t) => t.id),
    ['a1', 'a2', 'a3'],
    'volta na mesma posição'
  );
  assert.equal(s.transacoes[1], alvo, 'o mesmo lançamento, sem cópia mexida');
  desfazer();
  assert.equal(s.transacoes.filter((t) => t.id === 'a2').length, 1, 'não duplica');
});

test('excluir série: continua perguntando (sem exclusão imediata)', () => {
  const { s } = app();
  lanc(s, { id: 'f1', groupId: 'g1', categoria: 'despesa_fixa' });
  s.mostrarToastDesfazer = () => {
    throw new Error('série não usa o Desfazer');
  };
  s.deletarTransacao('f1');
  assert.ok(
    s.transacoes.some((t) => t.id === 'f1'),
    'espera a escolha'
  );
  s.executarDelecao('unica');
  assert.ok(!s.transacoes.some((t) => t.id === 'f1'));
});
