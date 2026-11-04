'use strict';

// Excluir lançamento avulso sem confirmação, com "Desfazer" no aviso
// (avaliação de cliques, docs/AVALIACAO-CLIQUES-CONTROLE-2026-11.md).
//
// A janela "Tem certeza?" saiu; o que protege agora é o Desfazer. Por isso a
// simulação cobra três coisas que a janela cobria de graça: o Desfazer devolve
// o patrimônio ao centavo, apertar duas vezes não duplica, e o que não é
// avulso (série, transferência, investimento) continua sem sair sem pergunta.

const test = require('node:test');
const assert = require('node:assert/strict');

const { criarMundo, executar, problemas } = require('./_simulador.js');

function comDesfazer(m) {
  m.s.mostrarToastDesfazer = (msg, fn) => {
    m.desfazer = fn;
  };
}

test('receita paga: sai na hora, o Desfazer devolve o patrimônio ao centavo', () => {
  const m = criarMundo();
  comDesfazer(m);
  const excluir = executar(m, {
    nome: 'excluir a receita',
    fn: (s) => s.deletarTransacao('sim_receita'),
  });
  assert.equal(problemas(excluir, { deltaPatrimonio: -8000 }), '');
  assert.ok(!m.s.transacoes.some((t) => t.id === 'sim_receita'), 'sem janela: já saiu');

  const volta = executar(m, { nome: 'Desfazer', fn: () => m.desfazer() });
  assert.equal(problemas(volta, { deltaPatrimonio: 8000 }), '');

  const deNovo = executar(m, { nome: 'Desfazer de novo', fn: () => m.desfazer() });
  assert.equal(problemas(deNovo, { semMudarPatrimonio: true }), '');
  assert.equal(m.s.transacoes.filter((t) => t.id === 'sim_receita').length, 1, 'não duplica');
});

test('compra avulsa no cartão: sai e volta sem tocar no caixa', () => {
  const m = criarMundo();
  comDesfazer(m);
  const rel = executar(m, { nome: 'excluir', fn: (s) => s.deletarTransacao('sim_fatura') });
  assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
  const volta = executar(m, { nome: 'Desfazer', fn: () => m.desfazer() });
  assert.equal(problemas(volta, { semMudarPatrimonio: true }), '');
  assert.ok(m.s.transacoes.some((t) => t.id === 'sim_fatura'));
});

test('Desfazer depois de outras ações: devolve só o excluído', () => {
  const m = criarMundo();
  comDesfazer(m);
  executar(m, { nome: 'excluir', fn: (s) => s.deletarTransacao('sim_fatura') });
  const [a, b] = m.s.contasAtivas();
  executar(m, {
    nome: 'transferir no meio',
    fn: (s) => s.criarTransferencia(a.id, b.id, 100, new Date().toISOString().slice(0, 10)),
  });
  const n = m.s.transacoes.length;
  const volta = executar(m, { nome: 'Desfazer', fn: () => m.desfazer() });
  assert.equal(problemas(volta, { semMudarPatrimonio: true }), '');
  assert.equal(m.s.transacoes.length, n + 1);
});

test('perna de investimento: continua pedindo confirmação (nada sai sozinho)', () => {
  const m = criarMundo();
  comDesfazer(m);
  const inv = executar(m, {
    nome: 'excluir a perna do investimento',
    fn: (s) => s.deletarTransacao('9001'),
  });
  assert.equal(problemas(inv, { semMudarPatrimonio: true }), '');
  assert.ok(
    m.s.transacoes.some((t) => t.id === '9001'),
    'espera a confirmação'
  );
  assert.equal(m.desfazer, undefined);
});

test('id que não existe mais (outro aparelho apagou): nada muda', () => {
  const m = criarMundo();
  comDesfazer(m);
  const rel = executar(m, {
    nome: 'excluir fantasma',
    fn: (s) => s.deletarTransacao('nao_existe'),
  });
  assert.equal(problemas(rel, { semMudarPatrimonio: true }), '');
  assert.equal(rel.mudou, false);
});
