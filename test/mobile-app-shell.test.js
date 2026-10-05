'use strict';

// Casca de app no celular (web/appliquei-mobile.js).
//
// No celular o app era o site de desktop espremido: o menu ficava atrás de
// um ☰ e cada troca de tela custava dois toques. A casca põe uma barra fixa
// embaixo e a tela "Mais". Ela não duplica lógica — navega clicando o botão
// da sidebar — então o que precisa ficar de pé é a costura entre as duas.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'web/appliquei-mobile.js'), 'utf8');

/** Seções que a sidebar sabe abrir: mudarAba(event,'<id>'). */
function abasDaSidebar() {
  const ids = new Set();
  const re = /class="menu-btn[^"]*"\s+onclick="mudarAba\(event,'([a-z_]+)'/g;
  let m;
  while ((m = re.exec(HTML))) ids.add(m[1]);
  return ids;
}

test('a barra tem Início, Patrimônio, cadastro, Investir e Mais', () => {
  const i = HTML.indexOf('id="mobTabbar"');
  assert.ok(i > -1, 'a barra precisa existir');
  const barra = HTML.slice(i, HTML.indexOf('</nav>', i));
  const abas = [...barra.matchAll(/data-aba="([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(abas, ['controle', 'meu_patrimonio', 'patrimonio', 'mais_mobile']);
  assert.match(barra, /id="mobTabCadastro"[^>]*onclick="alternarMenuCadastro\(\)"/);
});

test('todo destino da barra e do "Mais" tem botão na sidebar', () => {
  // mobIrPara navega clicando o botão da sidebar; um destino sem botão
  // seria um toque que não faz nada.
  const sidebar = abasDaSidebar();
  const destinos = [...HTML.matchAll(/mobIrPara\('([a-z_]+)'\)/g)].map((m) => m[1]);
  assert.ok(destinos.length >= 12, `esperava a barra e os tiles, achei ${destinos.length}`);
  for (const d of destinos) {
    if (d === 'mais_mobile') continue;
    assert.ok(sidebar.has(d), `"${d}" não tem botão na sidebar`);
    assert.match(HTML, new RegExp(`<section id="${d}"`), `"${d}" não é uma seção`);
  }
});

test('o "Mais" alcança toda seção que não está na barra', () => {
  const naBarra = new Set(['controle', 'meu_patrimonio', 'patrimonio']);
  const i = HTML.indexOf('<section id="mais_mobile"');
  const mais = HTML.slice(i, HTML.indexOf('</section>', i));
  for (const aba of abasDaSidebar()) {
    if (naBarra.has(aba)) continue;
    assert.ok(mais.includes(`mobIrPara('${aba}')`), `"${aba}" ficou inalcançável no celular`);
  }
});

test('mudarAba avisa a barra a cada troca de aba', () => {
  const i = APP.indexOf('function mudarAba');
  const fn = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.match(fn, /mobSincronizarAba\(idAba\)/);
});

test('a reserva do rodapé cobre a barra no celular', () => {
  // A barra é fixa; sem reservar a altura dela, o último item de cada tela
  // ficaria preso embaixo — o mesmo bug que a reserva do "+" já matou.
  assert.match(HTML, /--fab-reserva:\s*calc\(var\(--mob-barra\) \+ env\(safe-area-inset-bottom\)/);
});

test('nada da casca aparece no desktop', () => {
  assert.match(HTML, /\.mob-tabbar, \.mob-voltar \{ display: none; \}/);
  assert.match(
    HTML,
    /@media \(min-width: 769px\) \{\s*#mais_mobile \{ display: none !important; \}/
  );
  assert.match(MOB, /matchMedia\('\(max-width: 768px\)'\)/);
});
