'use strict';

// Sequências aleatórias de ações — a parte que acha o que ninguém imaginou.
//
// O motor está em test/_sequencias.js, compartilhado com
// scripts/cacar-interacoes.js. Aqui rodam as 40 sementes fixas que entram no
// CI: rápidas o bastante para não atrasar o feedback, e determinísticas, para
// que uma falha reproduza igual em qualquer máquina.
//
// Quando este teste pegar algo, a saída imprime a sequência exata e o comando
// para reproduzir. Para caçar mais fundo (mais sementes, mais passos), rode
// `npm run cacar` — não no CI, porque leva minutos.
//
// Três defeitos reais saíram daqui, todos corrigidos:
//
//  1. trocar a conta do sonho pelo caminho DIRETO recarimbava os compromissos;
//     pelo caminho do MODAL de confirmação, não. Só a ordem das ações decide
//     qual dos dois roda — nenhum teste de uma ação só distinguiria.
//  2. a própria INV-22 acusava parcela PAGA, que é história legítima: ela
//     debitou a conta que debitou na época.
//  3. (ver test/simulacao-sonhos.test.js para os achados de ação única)
//  4. semente 1775 (issue #157): excluir um aporte deixava o valor guardado
//     do sonho em 1584.0000000000002; relido como texto pt-BR ao editar a
//     meta, virou 10^16, e somar R$ 79 nessa escala perdia R$ 1. Todo valor
//     acumulado do sonho passa agora por arredCentavos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { rodarSequencia } = require('./_sequencias.js');

// Sementes que a caça semanal (npm run cacar) já pegou: viram trava fixa,
// com os passos que a reproduziram.
const ACHADAS = [[1775, 40]];

for (const [semente, passos] of ACHADAS) {
  test(`sequência achada pela caça, semente ${semente}`, () => {
    const r = rodarSequencia(semente, passos);
    assert.equal(r.falhou, false, r.mensagem);
  });
}

for (let semente = 1; semente <= 40; semente++) {
  test(`sequência aleatória, semente ${semente}`, () => {
    const r = rodarSequencia(semente, 12);
    assert.equal(r.falhou, false, r.mensagem);
  });
}

test('excluir aporte não deixa resíduo de ponto flutuante no valor guardado', () => {
  // 1000 + 584 + 797,30 − 797,30 dava 1584.0000000000002.
  const { criarMundo } = require('./_simulador.js');
  const m = criarMundo();
  const s = m.s.sonhos[0];
  const H = new Date().toISOString().slice(0, 10);
  m.s.finalizarAporteSonho(s.id, 584, H, 'esporadico', null);
  m.s.finalizarAporteSonho(s.id, 797.3, H, 'esporadico', null);
  const ultimo = s.aportes[s.aportes.length - 1];
  m.s.confirmarExcluirAporteSonho(s.id, ultimo.id);
  const soma = s.aportes.reduce((x, a) => x + a.valor, 0);
  assert.equal(s.valorAtual, Math.round(soma * 100) / 100);
  assert.equal(String(s.valorAtual), String(Math.round(s.valorAtual * 100) / 100));
  assert.equal(m.s.arredCentavos(0.1 + 0.2), 0.3);
  assert.equal(m.s.arredCentavos(NaN), 0);
});
