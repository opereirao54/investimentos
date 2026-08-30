'use strict';

// INV-15 — Dividendo é idempotente por (ticker, ano, mês).
//
// lancarDividendosNoCaixa roda toda vez que a aba de dividendos é aberta. Sem
// chave de idempotência, cada abertura lançaria os mesmos proventos de novo e
// o caixa da corretora inflaria a cada visita.
//
// A chave é `divKey = {ticker}_{ano}_{mes}`, e o id da transação é
// `div_{divKey}` — a ligação está embutida no próprio id.
//
// Ver .claude/integracoes/mapa.json → INV-15.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const CONTAS = [{ id: 'conta_1', nome: 'Rico', tipo: 'corretora', arquivada: false }];

function dividendo(key, extra) {
  return Object.assign(
    {
      id: 'div_' + key,
      divKey: key,
      descricao: 'Dividendos: PETR4',
      valor: 120,
      categoria: 'dividendo',
      banco: 'Rico',
      contaId: 'conta_1',
      mes: 7,
      ano: 2026,
      pago: true,
      gerado: true,
    },
    extra || {}
  );
}

test('INV-15: dividendos com chaves distintas convivem', () => {
  const e = {
    contas: CONTAS,
    transacoes: [
      dividendo('PETR4_2026_7'),
      dividendo('PETR4_2026_8', { mes: 8 }),
      dividendo('VALE3_2026_7'),
    ],
  };
  assert.equal(validarEstado(e).length, 0);
});

test('INV-15: divKey repetida é acusada como dividendo em dobro', () => {
  const e = {
    contas: CONTAS,
    transacoes: [dividendo('PETR4_2026_7'), dividendo('PETR4_2026_7', { id: 'div_outro' })],
  };
  const v = validarEstado(e, { apenas: ['INV-15'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /duplicada/);
  assert.match(v[0].mensagem, /inflado/);
});

test('INV-15: dividendo sem divKey é acusado (perdeu a idempotência)', () => {
  const e = {
    contas: CONTAS,
    transacoes: [dividendo('PETR4_2026_7', { divKey: undefined, id: 'tx_solto' })],
  };
  const v = validarEstado(e, { apenas: ['INV-15'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem divKey/);
});

test('INV-15: o id carrega a divKey — a ligação vive no próprio id', () => {
  const d = dividendo('PETR4_2026_7');
  assert.equal(d.id, 'div_' + d.divKey);
});
