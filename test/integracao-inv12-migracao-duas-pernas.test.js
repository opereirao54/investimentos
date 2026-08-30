'use strict';

// INV-12 — Migração para sonho gera duas pernas que se anulam no orçamento.
//
// Quando o usuário migra um investimento existente para dentro de um sonho, o
// dinheiro NÃO é gasto novo — ele só mudou de lugar. Por isso o fluxo grava
// duas transações pagas de mesmo valor:
//
//   categoria 'sonho'                 → o aporte entrando no sonho
//   categoria 'resgate_investimento'  → a compensação, para o mês não parecer
//                                       ter um gasto que não houve
//
// Sem a segunda, o orçamento do mês fica no vermelho sem motivo.
//
// Ver .claude/integracoes/mapa.json → INV-12.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();
const HOJE_STR = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;

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

test('INV-12: migração grava o aporte E o resgate compensatório', () => {
  const { s, sonho } = cenario();
  s.finalizarAporteSonho(sonho.id, 2000, HOJE_STR, 'migracao', { origemAtivo: 'CDB Banco X' });

  const aporte = s.transacoes.find((t) => t.categoria === 'sonho' && t.aporteExtra);
  const resgate = s.transacoes.find((t) => t.categoria === 'resgate_investimento');

  assert.ok(aporte, 'a perna do aporte existe');
  assert.ok(resgate, 'a perna do resgate compensatório existe');
  assert.equal(aporte.valor, resgate.valor, 'as duas pernas têm o mesmo valor');
  assert.equal(resgate.sonhoId, sonho.id, 'o resgate aponta para o mesmo sonho');
  assert.equal(aporte.pago, true);
  assert.equal(resgate.pago, true);
  assert.match(aporte.obs, /migra/i, 'a observação registra que foi migração');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-12: as duas pernas se anulam — o mês não fica no vermelho', () => {
  const { s, sonho, conta } = cenario();
  const saldoAntes = s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa;

  s.finalizarAporteSonho(sonho.id, 2000, HOJE_STR, 'migracao', { origemAtivo: 'CDB Banco X' });

  const saldoDepois = s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa;
  assert.equal(
    saldoDepois,
    saldoAntes,
    'migração é dinheiro mudando de lugar: o caixa da conta não pode se mover'
  );
});

test('INV-12: aporte esporádico (não-migração) tem UMA perna só e debita mesmo', () => {
  const { s, sonho, conta } = cenario();
  const saldoAntes = s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa;

  s.finalizarAporteSonho(sonho.id, 500, HOJE_STR, 'esporadico', null);

  assert.equal(
    s.transacoes.filter((t) => t.categoria === 'resgate_investimento').length,
    0,
    'aporte esporádico não gera resgate compensatório — é dinheiro novo entrando no sonho'
  );
  const saldoDepois = s.mpCalcularSaldoPorInstituicao(Date.now())[conta.id].caixa;
  assert.equal(saldoDepois, saldoAntes - 500, 'e por isso o caixa desce de verdade');
  assert.equal(validarEstado(estadoDe(s)).length, 0);
});

test('INV-12: migração sem a perna de resgate é acusada', () => {
  const { s, sonho } = cenario();
  s.finalizarAporteSonho(sonho.id, 2000, HOJE_STR, 'migracao', { origemAtivo: 'CDB Banco X' });

  // Simula a regressão: a perna compensatória some.
  const idx = s.transacoes.findIndex((t) => t.categoria === 'resgate_investimento');
  s.transacoes.splice(idx, 1);

  const v = validarEstado(estadoDe(s), { apenas: ['INV-12'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /sem a perna de resgate/);
});
