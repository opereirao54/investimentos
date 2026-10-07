'use strict';

/**
 * As grades do Simulador colapsam no celular — e continuam colapsando depois
 * que o JS mexe nelas.
 *
 * ═══ O DEFEITO ═══
 *
 * Relato, com print: no "Simule sua liberdade" os campos ficavam em 2 e 3
 * colunas num telefone, com rótulo quebrado e valor cortado ("R$ 15.000,").
 *
 * As regras responsivas casavam o TEXTO do atributo style:
 *
 *   #simulador div[style*="grid-template-columns:repeat(3,minmax(0,1fr))"]
 *
 * Isso funciona exatamente até alguém tocar no elemento pelo DOM.
 * `atualizarCamposMeta()` faz `el.style.display = 'grid'` para trocar o
 * objetivo, e o navegador reescreve o atributo inteiro na forma canônica —
 * `repeat(3, minmax(0px, 1fr))`, com espaços e com `0px`. O seletor deixa de
 * casar e a grade volta às três colunas.
 *
 * Medido no Chromium a 390px, no mesmo elemento:
 *   atributo intacto (primeira pintura) → 1fr
 *   depois de trocar o objetivo         → repeat(2, minmax(0px, 1fr))
 *
 * Era por isso que a tela parecia certa até a pessoa usar o seletor — e por
 * que a correção anterior (a seta do select) não resolveu: são dois defeitos
 * diferentes na mesma tela.
 *
 * ═══ O CONTRATO ═══
 *
 * Grade de campo do Simulador é classe (`.sim-campos-2` / `.sim-campos-3`).
 * Classe não tem string para o navegador reescrever.
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const SIM = HTML.slice(
  HTML.indexOf('<section id="simulador"'),
  HTML.indexOf('<section id="noticias"')
);

test('nenhuma grade de campo do Simulador declara colunas no style inline', () => {
  const inline = [];
  for (const m of SIM.matchAll(/<div[^>]*style="([^"]*)"[^>]*>/g)) {
    if (/grid-template-columns/.test(m[1]) && !/linear-gradient/.test(m[1])) {
      inline.push(m[1].slice(0, 90));
    }
  }
  assert.deepEqual(
    inline,
    [],
    'grade com colunas inline volta a depender da grafia que o navegador reescreve'
  );
});

test('as grades usam as classes, e as classes existem no CSS', () => {
  assert.ok(
    (SIM.match(/class="sim-campos sim-campos-[23]"/g) || []).length >= 6,
    'as grades de campo do Simulador perderam a classe'
  );
  for (const regra of ['.sim-campos \\{', '.sim-campos-2 \\{', '.sim-campos-3 \\{']) {
    assert.match(HTML, new RegExp(regra), 'falta a regra base ' + regra);
  }
});

test('as regras responsivas casam classe, não texto de atributo', () => {
  // O seletor por string é o defeito em si — se voltar, volta o sintoma.
  assert.ok(
    !/#simulador div\[style\*="grid-template-columns:repeat/.test(HTML),
    'voltou o seletor que casa o texto do style — ele morre quando o JS toca no elemento'
  );
  assert.match(
    HTML,
    /\.sim-campos-3 \{ grid-template-columns: 1fr 1fr/,
    'falta o passo de 2 colunas'
  );
  assert.match(
    HTML,
    /\.sim-campos-2,\s*\n\s*\.sim-campos-3 \{ grid-template-columns: 1fr; \}/,
    'falta o colapso final para uma coluna'
  );
});

test('o texto do objetivo cabe na largura de um celular', () => {
  // Medido no Chromium a 360px (o mais estreito em uso): o select tem 261px
  // úteis depois do padding e do espaço da seta. "Acumular um valor
  // específico" pede 235px; "Me aposentar com uma renda", 238px. A versão
  // antiga ("Quero me aposentar com uma renda mensal") pedia 294px e era
  // cortada no meio da palavra.
  const bloco = SIM.slice(SIM.indexOf('id="metaObjetivo"'));
  const opcoes = Array.from(bloco.slice(0, 500).matchAll(/<option[^>]*>([^<]+)<\/option>/g), (m) =>
    m[1].trim()
  );
  assert.equal(opcoes.length, 2, 'esperava os dois objetivos');
  for (const o of opcoes) {
    assert.ok(
      o.length <= 32,
      'objetivo longo demais para 360px: "' + o + '" (' + o.length + ' caracteres)'
    );
  }
});
