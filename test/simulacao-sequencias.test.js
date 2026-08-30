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

const test = require('node:test');
const assert = require('node:assert/strict');
const { rodarSequencia } = require('./_sequencias.js');

for (let semente = 1; semente <= 40; semente++) {
  test(`sequência aleatória, semente ${semente}`, () => {
    const r = rodarSequencia(semente, 12);
    assert.equal(r.falhou, false, r.mensagem);
  });
}
