'use strict';

// INV-14 — valorAtual do sonho é a soma dos aportes.
//
// A barra de progresso do card lê valorAtual. Se ele for um número solto, em
// vez da soma do histórico, a barra mente: mostra guardado o que o histórico
// não sustenta. Acontece quando um caminho mexe no total sem mexer na lista
// (ou o contrário).
//
// Ver .claude/integracoes/mapa.json → INV-14.

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, estadoDe, ORDEM_CONTROLE } = require('./_harness-integracao.js');
const { validarEstado } = require('../scripts/lib/invariantes.js');

const ORDEM = ORDEM_CONTROLE.concat(['web/appliquei-sonhos.js']);
const HOJE = new Date();
const HOJE_STR = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;

function cenario(valorInicial) {
  const s = carregarApp({}, ORDEM);
  const conta = s.criarConta({ nome: 'Nubank', tipo: 'banco', saldoInicial: 50000 });
  const sonho = {
    id: 'sonho_1',
    nome: 'Viagem',
    valorTotal: 12000,
    valorAtual: valorInicial || 0,
    aportes: valorInicial ? [{ id: 'ap_inicial', valor: valorInicial, inicial: true }] : [],
    contaOrigemId: conta.id,
    prazoMeses: 12,
    mesesRestantes: 12,
    dataInicio: new Date(HOJE.getFullYear(), HOJE.getMonth(), 1).toISOString(),
  };
  s.sonhos = [sonho];
  return { s, sonho };
}

test('INV-14: cada aporte sobe o valorAtual exatamente pelo seu valor', () => {
  const { s, sonho } = cenario(1000);
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-14'] }).length, 0);

  s.finalizarAporteSonho(sonho.id, 500, HOJE_STR, 'esporadico', null);
  assert.equal(sonho.valorAtual, 1500);
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-14'] }).length, 0);

  s.finalizarAporteSonho(sonho.id, 250, HOJE_STR, 'esporadico', null);
  assert.equal(sonho.valorAtual, 1750);
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-14'] }).length, 0);
});

test('INV-14: excluir um aporte desce o valorAtual junto', () => {
  const { s, sonho } = cenario(1000);
  s.finalizarAporteSonho(sonho.id, 500, HOJE_STR, 'esporadico', null);
  const extra = sonho.aportes[sonho.aportes.length - 1];

  s.confirmarExcluirAporteSonho(sonho.id, extra.id);

  assert.equal(sonho.valorAtual, 1000, 'o total volta ao que era');
  assert.equal(validarEstado(estadoDe(s), { apenas: ['INV-14'] }).length, 0);
});

test('INV-14: total divergente da lista de aportes é acusado', () => {
  const v = validarEstado(
    {
      contas: [],
      transacoes: [],
      sonhos: [
        {
          id: 'sonho_1',
          nome: 'Viagem',
          valorAtual: 3000, // a barra diria 3000...
          aportes: [{ id: 'ap1', valor: 1000 }], // ...mas o histórico só tem 1000
        },
      ],
    },
    { apenas: ['INV-14'] }
  );
  assert.equal(v.length, 1);
  assert.match(v[0].mensagem, /o histórico não sustenta/);
});
