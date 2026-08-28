'use strict';

// INV-11 — Aporte extra e transação são um par de ligação dupla.
//
//   sonho.aportes[i].txId  →  transacao.id
//   transacao.sonhoId      →  sonho.id
//
// As duas pontas têm de existir. Um aporte cujo txId aponta para o vazio conta
// no valorAtual do sonho (barra de progresso sobe) mas não existe no Controle:
// o sonho mostra dinheiro guardado que nunca saiu de conta nenhuma.
//
// Ver .claude/integracoes/mapa.json → INV-11.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();

function cenario() {
  const s = carregarApp({}, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 10000 });
  const sonho = {
    id: 'sonho_1',
    nome: 'Viagem',
    valorTotal: 12000,
    valorAtual: 0,
    aportes: [],
    contaOrigemId: conta.id,
    prazoMeses: 12,
    mesesRestantes: 12,
    dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
  };
  s.sonhos = [sonho];
  return { s, sonho, conta };
}

test('INV-11: aporte extra real cria o par completo nas duas pontas', () => {
  const { s, sonho, conta } = cenario();
  const hojeStr = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;

  s.finalizarAporteSonho(sonho.id, 500, hojeStr, 'esporadico', null);

  assert.equal(sonho.aportes.length, 1, 'o aporte foi registrado no sonho');
  const aporte = sonho.aportes[0];
  assert.ok(aporte.txId, 'o aporte guarda o id da transação');

  const tx = s.transacoes.find((t) => t.id === aporte.txId);
  assert.ok(tx, 'a transação existe no Controle');
  assert.equal(tx.sonhoId, sonho.id, 'e aponta de volta para o sonho');
  assert.equal(tx.aporteExtra, true);
  assert.equal(tx.valor, 500);
  assert.equal(tx.pago, true, 'aporte extra é dinheiro que já saiu');
  assert.equal(tx.contaId, conta.id, 'debitando a conta de origem do sonho');

  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-11: excluir o aporte remove as duas pontas', () => {
  const { s, sonho } = cenario();
  const hojeStr = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;
  s.finalizarAporteSonho(sonho.id, 500, hojeStr, 'esporadico', null);
  const txId = sonho.aportes[0].txId;

  s.confirmarExcluirAporteSonho(sonho.id, sonho.aportes[0].id);

  assert.equal(sonho.aportes.length, 0, 'o aporte saiu do sonho');
  assert.ok(
    !s.transacoes.some((t) => t.id === txId),
    'e o lançamento vinculado saiu do Controle junto'
  );
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-11: txId apontando para o vazio é acusado', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [],
      sonhos: [
        {
          id: 'sonho_1',
          nome: 'Viagem',
          valorAtual: 500,
          aportes: [{ id: 'ap1', valor: 500, txId: 'tx_que_nao_existe' }],
        },
      ],
    },
    { apenas: ['INV-11'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /não existe/);
  assert.match(v[0].mensagem, /nunca saiu de conta nenhuma/);
});

test('INV-11: ligação cruzada (txId certo, sonhoId errado) é acusada', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [
        {
          id: 'tx_1',
          categoria: 'sonho',
          sonhoId: 'sonho_OUTRO',
          valor: 500,
          mes: 0,
          ano: 2026,
          pago: false,
        },
      ],
      sonhos: [
        {
          id: 'sonho_1',
          nome: 'Viagem',
          valorAtual: 500,
          aportes: [{ id: 'ap1', valor: 500, txId: 'tx_1' }],
        },
      ],
    },
    { apenas: ['INV-11'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /Ligação dupla quebrada/);
});
