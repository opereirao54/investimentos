'use strict';

// INV-21 — Aporte de compromisso é idempotente por geradoDoCompromissoTx.
//
// CADEIA-02: pagar a parcela de previdência/reserva no Controle MATERIALIZA
// uma posição em Patrimônio/Investimentos. O aporte programado vira aporte
// realizado.
//
// Duas travas:
//   idempotência  historicoCompras.some(o => o.geradoDoCompromissoTx === tx.id)
//   data          a competência da parcela, LIMITADA A HOJE — uma posição com
//                 data futura renderia a partir de um dia que não chegou
//
// Ver .claude/integracoes/mapa.json → INV-21 e cadeiasDeEfeito CADEIA-02.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();

function parcela(extra) {
  return Object.assign(
    {
      id: 'tx_compromisso_9_1',
      compromissoId: 9,
      compromissoCategoria: 'previdencia',
      categoria: 'investimento_fixo',
      descricao: 'Previdência: PGBL Itaú',
      aporteTicker: 'PGBL Itaú',
      valor: 500,
      mes: HOJE.getMonth(),
      ano: HOJE.getFullYear(),
      pago: true,
    },
    extra || {}
  );
}

test('INV-21: pagar a parcela materializa UMA posição no patrimônio', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 10000 });
  const tx = parcela({ contaId: conta.id });
  s.transacoes.push(tx);

  const criou = s.registrarAportePorPagamentoCompromisso(tx);
  assert.equal(criou, true, 'a posição foi criada');
  assert.equal(s.historicoCompras.length, 1);

  const op = s.historicoCompras[0];
  assert.equal(op.geradoDoCompromissoTx, tx.id, 'a posição aponta de volta para a parcela');
  assert.equal(op.preco_op, 500, 'pelo valor pago');
  assert.equal(op.categoria, 'previdencia');
  assert.equal(op.gerado, true);
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-21: pagar duas vezes não materializa duas posições', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 10000 });
  const tx = parcela({ contaId: conta.id });
  s.transacoes.push(tx);

  assert.equal(s.registrarAportePorPagamentoCompromisso(tx), true);
  assert.equal(
    s.registrarAportePorPagamentoCompromisso(tx),
    false,
    'a segunda chamada tem de ser recusada pela guarda de idempotência'
  );
  assert.equal(s.historicoCompras.length, 1, 'uma posição só');
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-21'] }).length, 0);
});

test('INV-21: a posição não nasce com data no futuro', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 10000 });
  // Parcela cuja competência ainda não chegou (paga adiantada).
  const futuro = new Date(HOJE.getFullYear() + 1, HOJE.getMonth(), 10);
  const tx = parcela({
    contaId: conta.id,
    mes: futuro.getMonth(),
    ano: futuro.getFullYear(),
    dataVencimento: `${futuro.getFullYear()}-${String(futuro.getMonth() + 1).padStart(2, '0')}-10`,
  });
  s.transacoes.push(tx);
  s.registrarAportePorPagamentoCompromisso(tx);

  const op = s.historicoCompras[0];
  assert.ok(
    new Date(op.data_op).getTime() <= Date.now() + 1000,
    'a data do aporte é limitada a hoje — posição não pode render no futuro'
  );
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-21'] }).length, 0);
});

test('INV-21: categoria fora de previdência/reserva não materializa nada', () => {
  const s = carregarApp({}, ORDEM_CONTROLE);
  const tx = parcela({ compromissoCategoria: 'renda_variavel' });
  s.transacoes.push(tx);
  assert.equal(s.registrarAportePorPagamentoCompromisso(tx), false);
  assert.equal(s.historicoCompras.length, 0);
});

test('INV-21: duas posições da mesma parcela são acusadas', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [],
      historicoCompras: [
        { id: 'op1', geradoDoCompromissoTx: 'tx_compromisso_9_1' },
        { id: 'op2', geradoDoCompromissoTx: 'tx_compromisso_9_1' },
      ],
    },
    { apenas: ['INV-21'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /em dobro no patrimônio/);
});

test('INV-21: posição com data_op no futuro é acusada', () => {
  const amanha = new Date(Date.now() + 5 * 86400000).toISOString();
  const v = validarEstado(
    {
      contas: [],
      transacoes: [],
      historicoCompras: [{ id: 'op1', geradoDoCompromissoTx: 'tx_1', data_op: amanha }],
    },
    { apenas: ['INV-21'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /data_op no futuro/);
});
