'use strict';

/**
 * Campo de formulário não corta o próprio conteúdo no celular.
 *
 * ═══ O DEFEITO ═══
 *
 * Relato com print: no Simulador, "🏖️ Quero me aposentar com uma renda me" —
 * o texto passava por baixo da seta e os descendentes ficavam cortados por
 * baixo.
 *
 * A causa é sempre a mesma e já mordeu esta base antes (ver o comentário do
 * `.form-group select` no HTML: "a seta NATIVA come a última letra... era o
 * 'meses' cortado no prazo do sonho"). Sete selects do Simulador/Meta
 * repetiam à mão, em `style=`, o que a classe já dava — borda, raio, fundo,
 * fonte — e, ao escrever `padding: 10px 10px`, o atalho apagava o
 * `padding-right: 34px` que reserva o espaço da seta. Estilo inline vence
 * qualquer seletor, então a classe não tinha como se defender.
 *
 * ═══ O CONTRATO ═══
 *
 * Select dentro de `.form-group` não declara pintura inline. Só layout
 * (`flex`, `width`, `margin`). Quem pinta é a classe — um lugar só, que já
 * sabe da seta, da altura de toque e do tema escuro.
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

/**
 * Selects DENTRO de `.form-group`, com o style inline separado.
 *
 * O escopo importa: o conflito só existe onde a classe também pinta. Select
 * solto (o filtro compacto da composição, o das dúvidas) desenha o próprio
 * botão com a seta nativa, que reserva o espaço dela sozinha.
 */
function selectsDeFormGroup() {
  const out = [];
  for (const m of HTML.matchAll(/<select\b[^>]*>/g)) {
    const antes = HTML.slice(Math.max(0, m.index - 1200), m.index);
    const abre = antes.lastIndexOf('<div class="form-group');
    if (abre === -1) continue;
    // Só conta se nenhuma <div> fechou entre o form-group e o select.
    const meio = antes.slice(abre);
    if ((meio.match(/<\/div>/g) || []).length > (meio.match(/<div/g) || []).length - 1) continue;
    const style = (m[0].match(/style="([^"]*)"/) || [])[1];
    if (!style) continue;
    out.push({ id: (m[0].match(/id="([^"]*)"/) || [])[1] || '(sem id)', style });
  }
  return out;
}

// Propriedades que a classe .form-group select já entrega e que, redeclaradas
// inline, quebram a que não foi redeclarada junto.
const PINTURA = ['padding', 'border', 'border-radius', 'background', 'font-size', 'font-family'];

test('nenhum select de form-group repete a pintura da classe', () => {
  const infratores = [];
  for (const s of selectsDeFormGroup()) {
    const achadas = PINTURA.filter((p) => new RegExp('(^|;)\\s*' + p + '\\s*:').test(s.style));
    if (achadas.length) infratores.push(`${s.id}: ${achadas.join(', ')}`);
  }
  assert.deepEqual(
    infratores,
    [],
    'select repintando inline — o `padding` do atalho apaga o padding-right da seta'
  );
});

test('a regra que reserva o espaço da seta continua de pé', () => {
  assert.match(
    HTML,
    /\.form-group select \{[^}]*padding-right: 34px/,
    'sem a reserva, a seta volta a comer a última letra'
  );
  assert.match(
    HTML,
    /\.form-group select \{[^}]*appearance: none/,
    'a seta desenhada é o que torna a reserva previsível'
  );
});

test('os sete selects do Simulador e da Meta sobraram só com layout', () => {
  // São os que o print mostrou. Se algum voltar a carregar pintura, o teste
  // acima já pega — este nomeia os culpados históricos.
  const ALVOS = [
    'simTipoTaxa',
    'simTipoTempo',
    'simVinculo',
    'simSexo',
    'metaObjetivo',
    'metaTipoPrazo',
    'metaTipoTaxa',
  ];
  for (const id of ALVOS) {
    const tag = (HTML.match(new RegExp('<select id="' + id + '"[^>]*>')) || [])[0];
    assert.ok(tag, 'sumiu o select ' + id);
    const style = (tag.match(/style="([^"]*)"/) || [])[1] || '';
    assert.match(
      style,
      /^(flex:1;|width:100%;)$/,
      id + ' voltou a ter estilo próprio: ' + JSON.stringify(style)
    );
  }
});

test('a altura de toque continua maior que a de mouse', () => {
  // 40px com fonte de 16px deixa 17px úteis e corta os descendentes — foi
  // medido e está escrito no HTML. O bloco (pointer: coarse) é o que evita.
  assert.match(HTML, /--altura-campo: 40px/, 'sumiu a altura padrão');
  assert.match(
    HTML,
    /@media \(pointer: coarse\)[\s\S]{0,900}--altura-campo: 44px/,
    'sem a altura maior no toque, todo campo do app volta a cortar no celular'
  );
});
