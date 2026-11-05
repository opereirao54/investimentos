'use strict';

// INV-28 — Ajuste de saldo só mexe no caixa da conta.
//
// O "Conferir saldo" grava a diferença entre o saldo do banco e o do app em
// conta.ajustes[]. Duas provas, como manda a skill validar-integracoes:
//   1. o fluxo REAL respeita a regra (estado válido depois de ajustar,
//      desfazer e fundir);
//   2. o validador ACUSA o ajuste quebrado — senão a trava passaria com o
//      validador vazio.

const test = require('node:test');
const assert = require('node:assert/strict');

const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado, formatar } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-conferir-saldo.js']);

function soInv28(s) {
  return validarEstado(
    { transacoes: s.transacoes, contas: s.contas, cartoes: s.cartoes },
    { apenas: ['INV-28'] }
  );
}

test('INV-28: ajustar, desfazer e fundir deixam o estado válido', () => {
  const s = carregarApp({}, ORDEM);
  const a = s.criarConta({ nome: 'Nubank', tipo: 'banco' });
  const b = s.criarConta({ nome: 'Inter', tipo: 'banco' });
  s.conferirAjustar(a.id, 2150);
  s.conferirAjustar(b.id, -80);
  const aj = s.conferirAjustar(a.id, 2000);
  assert.equal(formatar(soInv28(s)), '');
  s.conferirDesfazerAjuste(a.id, aj.id);
  s.fundirContas(a.id, [b.id]);
  assert.equal(formatar(soInv28(s)), '');
  assert.equal(Math.round(s.mpCalcularSaldoTotal(Date.now()) * 100) / 100, 2070);
});

test('INV-28: o validador acusa ajuste sem data, com NaN ou repetido', () => {
  const base = { id: 'c1', nome: 'Nubank' };
  const acusa = (ajustes) =>
    validarEstado({ contas: [{ ...base, ajustes }] }, { apenas: ['INV-28'] }).length;
  assert.equal(acusa([{ id: 'a', valor: 10, data: '2026-11-04T12:00:00Z' }]), 0);
  assert.ok(acusa([{ id: 'a', valor: 10 }]) > 0, 'sem data');
  assert.ok(acusa([{ id: 'a', valor: 'x', data: '2026-11-04' }]) > 0, 'valor NaN');
  assert.ok(acusa([{ valor: 10, data: '2026-11-04' }]) > 0, 'sem id');
  assert.ok(
    acusa([
      { id: 'a', valor: 10, data: '2026-11-04' },
      { id: 'a', valor: 10, data: '2026-11-04' },
    ]) > 0,
    'repetido'
  );
  assert.ok(acusa({}) > 0, 'fora de lista');
});

test('INV-05 continua barrando "ajuste_saldo" como transação', () => {
  const v = validarEstado(
    { transacoes: [{ id: 't', categoria: 'ajuste_saldo', valor: 10, mes: 0, ano: 2026 }] },
    { apenas: ['INV-05'] }
  );
  assert.ok(v.length > 0, 'ajuste mora na conta, nunca em transacoes');
});
