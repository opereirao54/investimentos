'use strict';

// INV-04 — Nenhuma perna de caixa órfã.
//
// O id `tx_origem_{operacaoId}` embute a chave estrangeira. Se a operação some
// e a perna fica, o saldo continua descontado de uma compra que já não existe:
// débito fantasma.
//
// Já quebrou nesta base — por isso existe uma rotina de LIMPEZA em
// patrimonio.js:1188. A limpeza é o remendo; este teste é a trava.
//
// Ver .claude/integracoes/mapa.json → INV-04.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const HOJE = new Date();

function estadoComCompra() {
  return {
    contas: [{ id: 'conta_1', nome: 'Nubank', tipo: 'banco', arquivada: false }],
    historicoCompras: [{ id: 77, ticker: 'PETR4', categoria: 'renda_variavel' }],
    transacoes: [
      {
        id: '77',
        operacaoId: 77,
        descricao: 'Compra: 10x PETR4',
        valor: 1000,
        categoria: 'investimento_variavel',
        mes: HOJE.getMonth(),
        ano: HOJE.getFullYear(),
        pago: true,
        temLegCaixa: true,
      },
      {
        id: 'tx_origem_77',
        operacaoId: 77,
        descricao: 'Transferência → PETR4 (Rico)',
        valor: 1000,
        categoria: 'transferencia_saida',
        contaId: 'conta_1',
        mes: HOJE.getMonth(),
        ano: HOJE.getFullYear(),
        pago: true,
      },
    ],
  };
}

test('INV-04: com a operação presente, as pernas são válidas', () => {
  assert.equal(validarEstado(estadoComCompra()).length, 0);
});

test('INV-04: apagar a operação e deixar a perna é acusado como débito fantasma', () => {
  const e = estadoComCompra();
  e.historicoCompras = []; // a operação foi apagada; as transações ficaram

  const v = validarEstado(e, { apenas: ['INV-04'] });
  assert.equal(v.length, 1, 'a perna tx_origem_77 ficou órfã');
  assert.match(v[0].mensagem, /órfã/);
  assert.match(v[0].mensagem, /77/);
});

test('INV-04: a rotina de limpeza do Patrimônio remove a perna órfã', () => {
  const s = carregarApp();
  const e = estadoComCompra();
  s.contas = e.contas;
  s.transacoes = e.transacoes;
  s.historicoCompras = [];

  // mpLimparTransacoesOrfas (patrimonio.js) é o remendo existente.
  assert.equal(
    typeof s.mpLimparTxOrigemOrfas,
    'function',
    'mpLimparTxOrigemOrfas sumiu de patrimonio.js — INV-04 perdeu a rede de segurança. ' +
      'Se foi renomeada, atualize este teste e .claude/integracoes/mapa.json junto.'
  );
  s.mpLimparTxOrigemOrfas();

  assert.ok(
    !s.transacoes.some((t) => t.id === 'tx_origem_77'),
    'a perna órfã tem de ser removida'
  );
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-04'] }).length, 0);
});
