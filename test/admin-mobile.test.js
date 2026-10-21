'use strict';

// Admin no celular (web/appliquei-admin-mobile.js + o bloco ≤768px do
// admin.html). A regra é a mesma do app: no celular a sidebar some, então
// TODO destino e TODA ação dela precisa de outro caminho — a barra inferior
// ou o "Mais". Um item novo na sidebar sem par aqui seria uma função que só
// existe no computador.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'web/appliquei-admin-mobile.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'web/appliquei-admin.js'), 'utf8');

function bloco(id) {
  const i = HTML.indexOf(`id="${id}"`);
  assert.ok(i > -1, `falta #${id}`);
  const tag = HTML.lastIndexOf('<', i);
  const nome = HTML.slice(tag + 1, HTML.indexOf(' ', tag));
  return HTML.slice(i, HTML.indexOf(`</${nome}>`, i));
}

const SIDEBAR = bloco('mainSidebar');
const BARRA = bloco('admTabbar');
const MAIS = HTML.slice(
  HTML.indexOf('id="admMais"'),
  HTML.indexOf('<script', HTML.indexOf('id="admMais"'))
);

test('toda aba da sidebar tem caminho na barra ou no "Mais"', () => {
  const abas = [...SIDEBAR.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(abas.length >= 7, 'esperava as 7 abas do admin');
  for (const aba of abas) {
    const naBarra = BARRA.includes(`admIr('${aba}')`);
    const noMais = MAIS.includes(`admIr('${aba}')`);
    assert.ok(naBarra || noMais, `a aba "${aba}" ficou só no computador`);
  }
});

test('as ações da sidebar (CSV, tema, sair) estão no "Mais"', () => {
  for (const fn of ['downloadCsv()', 'toggleTheme()', 'logout()']) {
    assert.ok(MAIS.includes(fn), `${fn} ficou só no computador`);
  }
});

test('a barra tem os quatro destinos do dia a dia e o "Mais"', () => {
  const tabs = [...BARRA.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['dashboard', 'users', 'convites', 'feedback', 'mais']);
});

test('no celular a sidebar sai e a barra entra; no computador, o contrário', () => {
  assert.match(HTML, /\.adm-tabbar, \.adm-mais, \.adm-mais-fundo \{ display:none; \}/);
  const i = HTML.indexOf('/* ═══════ CELULAR (≤768px)');
  const css = HTML.slice(i, HTML.indexOf('/* Campo de formulário nunca abaixo', i));
  assert.match(
    css,
    /\.sidebar, \.sidebar-backdrop, \.mobile-toggle \{ display:none !important; \}/
  );
  assert.match(css, /\.adm-tabbar \{\s*display:flex;/);
  // Tabelas viram cartões com o rótulo da coluna.
  assert.match(css, /\.tbl thead \{ display:none; \}/);
  assert.match(css, /content:attr\(data-label\)/);
});

test('a barra acompanha qualquer troca de aba', () => {
  const i = ADMIN.indexOf('function mudarAba');
  const fn = ADMIN.slice(i, ADMIN.indexOf('\n}\n', i));
  assert.match(fn, /admSincronizar\(tab\)/);
});

test('o script do celular é carregado depois do admin e usa var no topo', () => {
  const a = HTML.indexOf('/web/appliquei-admin.js');
  const m = HTML.indexOf('/web/appliquei-admin-mobile.js');
  assert.ok(a > -1 && m > a, 'appliquei-admin-mobile.js precisa vir depois de appliquei-admin.js');
  assert.doesNotMatch(MOB, /^(let|const) /m, 'classic script: var no top-level');
});

test('a ficha do usuário também oferece "Excluir cadastro"', () => {
  assert.match(
    ADMIN,
    /inlineAction\('\$\{email[^`]*'delete_user'\)"><i class="ph ph-trash"><\/i> Excluir cadastro/
  );
});
