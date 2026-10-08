'use strict';

// As lentes da Carteira sugerida, no celular, rolam de ponta a ponta da tela:
// a regra móvel usa `margin: 0 -16px` para o trilho sair do recuo da página.
// Isso só funciona se a LARGURA crescer junto. A regra base do trilho tem
// `max-width: 100%`, que travava a largura na do pai — o trilho saía 16px
// para a esquerda e acabava 32px antes da borda direita, deixando uma faixa
// vazia à direita dos chips (relato real, só nessa tela). Medido no Chromium
// a 390px: antes o trilho ia de 0 a 358; com a correção, de 0 a 390.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'Appliquei_v13.0.html'), 'utf8');

test('o trilho das lentes no celular cresce junto com a margem negativa', () => {
  const m = HTML.match(/#carteira \.cart-motor-lentes \{([^}]*)\}/);
  assert.ok(m, 'regra móvel do trilho das lentes não encontrada');
  const regra = m[1];
  assert.match(regra, /margin:\s*0 -16px/, 'a regra ainda sangra 16px de cada lado');
  assert.match(
    regra,
    /max-width:\s*none/,
    'sem max-width:none, a regra base trava a largura no pai'
  );
  assert.match(regra, /width:\s*calc\(100% \+ 32px\)/, 'a largura precisa compensar os 2×16px');
});
