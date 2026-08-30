'use strict';

// O "+" global não pode tapar botão nenhum.
//
// O relato foi direto: "o botão de + tá tampando alguns botões, ex. na parte
// de editar ou deletar um ativo ele tá na frente e eu não consigo excluir".
// Reproduzido: no celular, o clique no ícone de lixeira da última operação ia
// para o botão flutuante — a operação não era excluída.
//
// A varredura achou 24 alvos com o clique roubado em 7 das 11 abas: "Excluir"
// e "Arquivar" de conta, cards de sonho, itens do FAQ, o botão da trilha.
//
// A causa é estrutural: o "+" é `position: fixed` no canto inferior direito, e
// nada reservava aquele espaço. Um alvo que caísse ali no FIM da página ficava
// preso — não havia rolagem que o libertasse.
//
// A correção tem duas partes, e as duas são necessárias:
//
//   1. O rodapé reserva a área do botão (`--fab-reserva`), o que liberta o
//      último alvo de cada página. Sozinha, ainda deixa o "+" por cima de
//      linhas no meio da lista.
//   2. O "+" some enquanto a lista corre. É rolando que se procura a linha
//      para editar ou excluir; sumindo aí, qualquer alvo coberto fica a um
//      toque de distância.
//
// A trava de comportamento (nenhum alvo PRESO em nenhuma aba, nas duas
// larguras) é a sonda de navegador em scratchpad/dark/probe-fab-alcance.mjs.
// Aqui ficam as peças que ela depende, para que não sumam num refactor.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');

/** Todas as declarações de padding de `.main-content`, na ordem do arquivo. */
function paddingsDoRolador() {
  const re = /\.main-content\s*\{[^}]*?padding:\s*([^;]+);/g;
  const out = [];
  let m;
  while ((m = re.exec(HTML))) out.push(m[1].trim());
  return out;
}

// ---------------------------------------------------------------------------
// 1. A reserva do rodapé
// ---------------------------------------------------------------------------

test('a reserva existe como token, não como número solto', () => {
  // O valor precisa acompanhar a geometria do botão. Espalhado em quatro
  // regras, a primeira mudança de tamanho do "+" já deixaria uma para trás.
  assert.match(HTML, /--fab-reserva:\s*100px/, 'valor de desktop no :root');
  assert.match(HTML, /--fab-reserva:\s*88px/, 'e o do celular, onde o botão é menor');
});

test('TODA regra de padding do rolador reserva a área do botão', () => {
  // Quem rola é `.main-content` (o body tem overflow:hidden). São quatro
  // regras em quatro breakpoints, e duas delas com `!important` — foi
  // exatamente por essas duas que a primeira correção passou batido: o token
  // resolvia para 88px e o padding continuava 24px.
  const paddings = paddingsDoRolador();
  assert.ok(paddings.length >= 4, `esperava ao menos 4 regras, achei ${paddings.length}`);
  for (const p of paddings) {
    assert.match(p, /var\(--fab-reserva\)/, `regra sem reserva: padding: ${p}`);
  }
});

test('a reserva cobre a altura real do botão mais o afastamento', () => {
  // 26 de afastamento + 58 de botão = 84. Menos do que isso e o último alvo
  // continua debaixo do "+", que é o bug que a reserva existe para matar.
  const pega = (re) => Number((HTML.match(re) || [])[1]);
  const reservaPC = pega(/--fab-reserva:\s*(\d+)px/);
  const fundoPC = pega(/#fabNovoLancamento \{[\s\S]*?bottom:\s*(\d+)px/);
  const alturaPC = pega(/#fabNovoLancamento \{[\s\S]*?height:\s*(\d+)px/);
  assert.ok(
    reservaPC > fundoPC + alturaPC,
    `reserva ${reservaPC}px não passa de ${fundoPC}+${alturaPC}=${fundoPC + alturaPC}px`
  );

  const movel = HTML.match(
    /#fabNovoLancamento \{ width: (\d+)px; height: (\d+)px; bottom: (\d+)px/
  );
  assert.ok(movel, 'a regra de celular precisa existir');
  const reservaMovel = pega(/--fab-reserva:\s*(88)px/);
  assert.ok(
    reservaMovel > Number(movel[3]) + Number(movel[2]),
    `reserva de celular ${reservaMovel}px não passa de ${movel[3]}+${movel[2]}px`
  );
});

// ---------------------------------------------------------------------------
// 2. Sair da frente enquanto a lista corre
// ---------------------------------------------------------------------------

test('o botão some durante a rolagem, e sem receber clique', () => {
  // `opacity: 0` sozinho continuaria roubando o clique — um botão invisível
  // que engole o toque é pior que um visível.
  const i = HTML.indexOf('body.fab-rolando #fabNovoLancamento');
  assert.ok(i > -1, 'a regra precisa existir');
  const regra = HTML.slice(i, HTML.indexOf('}', i));
  assert.match(regra, /opacity:\s*0/);
  assert.match(regra, /pointer-events:\s*none/, 'sem isto ele some mas continua na frente');
});

test('a transição inclui opacity — senão ele pisca em vez de sumir', () => {
  const i = HTML.indexOf('#fabNovoLancamento {');
  assert.match(HTML.slice(i, HTML.indexOf('}', i)), /transition:[^;]*opacity/);
});

test('o ouvinte de rolagem vai no elemento que realmente rola', () => {
  // `window.scroll` não dispara: o body tem overflow:hidden e quem rola é
  // `.main-content`. Ouvir a janela daria um ouvinte que nunca acorda.
  const i = APP.indexOf('function _ligarEsconderFabNaRolagem');
  assert.ok(i > -1, 'a função precisa existir');
  const fn = APP.slice(i, i + 900);
  assert.match(fn, /querySelector\('\.main-content'\)/);
  assert.match(fn, /addEventListener\(\s*'scroll'/);
  assert.match(fn, /passive: true/, 'rolagem é caminho quente');
  assert.match(fn, /dataset\.fabRolagem/, 'e não empilha ouvinte a cada chamada');
});

test('o botão volta sozinho quando a rolagem para', () => {
  const i = APP.indexOf('function _ligarEsconderFabNaRolagem');
  const fn = APP.slice(i, i + 900);
  assert.match(fn, /setTimeout\(/);
  assert.match(fn, /classList\.remove\('fab-rolando'\)/);
  assert.match(fn, /clearTimeout\(_fabRolagemTimer\)/, 'cada rolagem reinicia a contagem');
});

test('com o menu aberto o botão não some no meio da escolha', () => {
  const i = APP.indexOf('function _ligarEsconderFabNaRolagem');
  assert.match(
    APP.slice(i, i + 900),
    /if \(document\.body\.classList\.contains\('fab-aberto'\)\) return;/
  );
  // E abrir o menu cancela um esconde em curso — uma rolagem por inércia
  // poderia ter apagado o botão no instante do toque.
  const j = APP.indexOf('function abrirMenuCadastro');
  assert.match(APP.slice(j, j + 300), /classList\.remove\('fab-rolando'\)/);
});

test('o ouvinte é ligado na carga da página', () => {
  assert.match(APP, /_ligarEsconderFabNaRolagem\(\)/);
  const i = APP.lastIndexOf("document.addEventListener('DOMContentLoaded'");
  assert.ok(
    APP.slice(i).includes('_ligarEsconderFabNaRolagem'),
    'precisa rodar no DOMContentLoaded'
  );
});
