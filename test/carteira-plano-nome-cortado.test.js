'use strict';

// O nome do ativo cortado a um caractere no PC.
//
// Medido no Chromium a 1280px com a barra lateral: a coluna da classe fica
// com 236px e o corpo do item com 26px, para um ticker que precisa de 37.
// A causa não é a largura da tela — é a repartição da linha. Score (30px),
// valor (68px) e botão (30px) não encolhem, e `min-width: 0` no corpo (que
// existe para o ticker de 38 caracteres do Tesouro não empurrar a página no
// telemóvel) fazia dele o único a absorver o aperto inteiro.
//
// A grelha do plano é `repeat(4, minmax(0, 1fr))` e mantém as quatro colunas
// mesmo quando duas classes estão vazias, então o aperto acontece em
// qualquer monitor.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const HTML = fs.readFileSync(
  path.join(path.resolve(__dirname, '..'), 'Appliquei_v13.0.html'),
  'utf8'
);

test('a linha do plano pode quebrar quando o nome não cabe', () => {
  assert.match(
    HTML,
    /#carteira \.cart-plano-item \{ flex-wrap: wrap;/,
    'sem flex-wrap o valor não desce e volta a espremer o nome'
  );
});

test('o corpo do item tem um mínimo legível', () => {
  assert.match(
    HTML,
    /#carteira \.cart-plano-body \{ min-width: 96px; \}/,
    'sem o mínimo o corpo encolhe até um caractere — foi o defeito relatado'
  );
});

test('o mínimo NÃO desfaz o corte que segura o Tesouro', () => {
  // `min-width: 0` e o corte por reticências continuam: são eles que impedem
  // TESOURO_IPCA_COM_JUROS_SEMESTRAIS_2055 de empurrar a página a 320px.
  // O mínimo do corpo (96px) e o corte do ticker resolvem coisas diferentes,
  // e remover qualquer um traz de volta um dos dois defeitos.
  assert.match(HTML, /#carteira \.cart-plano-ticker \{[^}]*min-width: 0;/);
  assert.match(HTML, /#carteira \.cart-plano-ticker \{[^}]*text-overflow: ellipsis;/s);
  assert.match(HTML, /\.cart-plano-body \{ flex: 1; min-width: 0;/, 'o corpo continua encolhível');
});
