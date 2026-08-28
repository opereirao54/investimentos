'use strict';

// INV-13 — Recalcular o plano do sonho não duplica compromissos.
//
// gerarLancamentosMensaisSonho pode rodar várias vezes na vida de um sonho:
// ao criar o plano, ao editar o valor ou o prazo, ao pular um mês. Cada
// passagem tem de REAPROVEITAR a série (groupIdControle estável) e pular os
// meses que já têm compromisso — nunca empilhar uma segunda parcela no mesmo
// mês, que dobraria o "a pagar".
//
// Ver .claude/integracoes/mapa.json → INV-13.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();

function cenario() {
  const s = carregarApp({}, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });
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

test('INV-13: rodar a geração duas vezes não duplica nenhuma parcela', () => {
  const { s, sonho } = cenario();

  const primeira = s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  assert.equal(primeira, 6);

  const segunda = s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  assert.equal(segunda, 0, 'a segunda passagem não pode criar nada — os meses já têm parcela');

  assert.equal(s.transacoes.filter((t) => t.categoria === 'sonho').length, 6);
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-13'] }).length, 0);
});

test('INV-13: o groupId é estável entre passagens', () => {
  const { s, sonho } = cenario();
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  const grupo1 = sonho.groupIdControle;

  s.gerarLancamentosMensaisSonho(sonho, 1500, 6);
  assert.equal(sonho.groupIdControle, grupo1, 'o recálculo reaproveita a série, não cria outra');

  const grupos = new Set(s.transacoes.filter((t) => t.categoria === 'sonho').map((t) => t.groupId));
  assert.equal(grupos.size, 1, 'todas as parcelas do sonho vivem numa série só');
});

test('INV-13: estender o prazo acrescenta só os meses novos', () => {
  const { s, sonho } = cenario();
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  assert.equal(s.transacoes.filter((t) => t.categoria === 'sonho').length, 3);

  const novos = s.gerarLancamentosMensaisSonho(sonho, 1000, 6);
  assert.equal(novos, 3, 'só os 3 meses que faltavam');
  assert.equal(s.transacoes.filter((t) => t.categoria === 'sonho').length, 6);
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-13'] }).length, 0);
});

test('INV-13: duas parcelas na mesma competência são acusadas', () => {
  const { s, sonho } = cenario();
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);

  // Simula a regressão: uma segunda parcela empilhada no mesmo mês.
  const original = s.transacoes.find((t) => t.categoria === 'sonho');
  s.transacoes.push(Object.assign({}, original, { id: 'tx_duplicada' }));

  const v = validarEstado(estadoDe(s), { apenas: ['INV-13'] });
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /mesma competência/);
  assert.match(v[0].mensagem, /dobrado/);
});

test('INV-13: aporte extra no mesmo mês da parcela NÃO é duplicata', () => {
  const { s, sonho } = cenario();
  s.gerarLancamentosMensaisSonho(sonho, 1000, 3);
  const hojeStr = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;

  // Pagar a parcela E fazer um aporte extra no mesmo mês é legítimo.
  s.finalizarAporteSonho(sonho.id, 500, hojeStr, 'esporadico', null);

  assert.equal(
    validarEstado(estadoDe(s), { apenas: ['INV-13'] }).length,
    0,
    'aporteExtra fica fora da contagem de compromissos — são coisas diferentes'
  );
});
