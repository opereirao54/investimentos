'use strict';

// Botão global de cadastro.
//
// O "+" era um FAB de celular preso à aba Controle: para lançar uma despesa
// estando em Meus sonhos, a pessoa tinha de navegar até o Controle primeiro — e
// no PC o botão simplesmente não existia (a regra vivia dentro de uma media
// query de 768px). Agora ele acompanha todas as abas, nos dois tamanhos, e
// pergunta ONDE cadastrar em vez de assumir.
//
// Os botões dentro das páginas continuam de propósito: quem já está no Controle
// abre o painel com UM clique, contra dois pelo menu. O global é o atalho de
// quem está em outro lugar — e os dois nunca aparecem ativos ao mesmo tempo,
// porque o "+" some quando o formulário que ele abriria já está na tela.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');

/** Recorta o corpo de uma função top-level pelo balanço de chaves. */
function corpo(nome) {
  const marca = `function ${nome}(`;
  const ini = APP.indexOf(marca);
  if (ini === -1) return null;
  const abre = APP.indexOf('{', ini);
  let nivel = 0;
  for (let i = abre; i < APP.length; i++) {
    if (APP[i] === '{') nivel++;
    else if (APP[i] === '}') {
      nivel--;
      if (nivel === 0) return APP.slice(ini, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alcance
// ---------------------------------------------------------------------------

test('o botão não está mais preso à aba Controle', () => {
  assert.ok(
    !HTML.includes('body.controle-ativo #fabNovoLancamento'),
    'a regra que só o mostrava no Controle tem de sair'
  );
});

test('o botão não está mais preso ao celular', () => {
  // A regra base do FAB vivia DENTRO de @media (max-width: 768px) e o estado
  // fora dela era `display: none` — por isso ele não existia no PC.
  const ini = HTML.indexOf('#fabNovoLancamento {');
  assert.ok(ini > -1, 'a regra do botão precisa existir');
  const antes = HTML.slice(0, ini);
  const abertas = (antes.match(/@media/g) || []).length;
  const fechadas = (antes.match(/^\s{8}\}\s*$/gm) || []).length;
  assert.ok(abertas <= fechadas, 'a regra base do botão não pode estar dentro de uma media query');
  assert.match(HTML, /#fabNovoLancamento \{\s*\n\s*display: flex;/, 'e nasce visível');
});

test('some quando o formulário que ele abriria já está aberto', () => {
  // Um "+" por cima do formulário que ele mesmo abriu não tem o que fazer.
  assert.match(HTML, /body\.painel-lancamento-aberto #fabNovoLancamento,/);
  assert.match(HTML, /body\.drawer-operacao-aberto #fabNovoLancamento \{ display: none; \}/);
  assert.match(
    corpo('abrirDrawerOperacao'),
    /classList\.add\('drawer-operacao-aberto'\)/,
    'o drawer de investimento precisa marcar o body'
  );
  assert.match(corpo('fecharDrawerOperacao'), /classList\.remove\('drawer-operacao-aberto'\)/);
});

// ---------------------------------------------------------------------------
// O menu
// ---------------------------------------------------------------------------

test('o clique abre um menu com os dois destinos', () => {
  assert.match(HTML, /onclick="alternarMenuCadastro\(\)"/, 'o botão abre o menu, não o formulário');
  assert.match(HTML, /onclick="cadastrarEm\('lancamento'\)"/);
  assert.match(HTML, /onclick="cadastrarEm\('investimento'\)"/);
  // Cada opção diz o que é e onde vai parar — "Lançamento" sozinho não
  // distingue de "Investimento" para quem está começando.
  assert.match(HTML, /Controle financeiro<\/span>/);
  assert.match(HTML, /Meus\s*\n?\s*investimentos<\/span>/);
});

test('o menu é acessível', () => {
  assert.match(HTML, /aria-haspopup="menu"/);
  assert.match(HTML, /aria-controls="fabMenu"/);
  assert.match(HTML, /role="menu"/);
  assert.ok((HTML.match(/role="menuitem"/g) || []).length === 2);
  assert.match(corpo('abrirMenuCadastro'), /setAttribute\('aria-expanded', 'true'\)/);
  assert.match(corpo('fecharMenuCadastro'), /setAttribute\('aria-expanded', 'false'\)/);
  assert.match(APP, /ev\.key === 'Escape'.*fecharMenuCadastro/s, 'Esc fecha, como no resto do app');
});

test('há um jeito de fechar sem escolher nada', () => {
  assert.match(HTML, /id="fabBackdrop"[^>]*onclick="fecharMenuCadastro\(\)"/);
});

// ---------------------------------------------------------------------------
// A navegação
// ---------------------------------------------------------------------------

test('trocar de aba vem ANTES de abrir o formulário', () => {
  // O painel do Controle é uma coluna da própria seção: abri-lo com outra aba
  // na tela deixaria o formulário invisível.
  const fn = corpo('cadastrarEm');
  assert.ok(fn, 'cadastrarEm precisa existir');
  const iTroca = fn.indexOf('btn.click()');
  const iAbre = fn.indexOf('const abrir');
  assert.ok(iTroca > -1 && iAbre > iTroca, 'a troca de aba precisa vir primeiro');
  assert.match(fn, /setTimeout\(abrir, \d+\)/, 'com respiro para a seção pintar');
});

test('já estando na aba, abre na hora — sem respiro nem re-navegação', () => {
  const fn = corpo('cadastrarEm');
  assert.match(fn, /const jaEstaNaAba =/);
  assert.match(fn, /jaEstaNaAba \? abrir\(\) : setTimeout/);
});

test('cada destino abre o formulário certo', () => {
  const fn = corpo('cadastrarEm');
  assert.match(fn, /destino === 'investimento' \? 'patrimonio' : 'controle'/);
  assert.match(fn, /abrirDrawerOperacao\(\)/);
  assert.match(fn, /abrirPainelLancamento\(\)/);
});

test('escolher uma opção fecha o menu', () => {
  assert.match(
    corpo('cadastrarEm'),
    /^function cadastrarEm\(destino\) \{\s*\n\s*fecharMenuCadastro\(\);/
  );
});

// ---------------------------------------------------------------------------
// Os botões das páginas continuam
// ---------------------------------------------------------------------------

test('o botão dentro de cada aba não foi removido', () => {
  // Decisão registrada: um clique (botão da página) contra dois (menu global).
  // Remover custaria um clique a quem já está no lugar certo, que é o caso
  // comum. Eles não competem — o global some quando o formulário abre.
  assert.match(HTML, /onclick="abrirPainelLancamento\(\)"[^>]*>.*Novo lançamento/s);
  assert.match(HTML, /class="inv-btn-add" onclick="abrirDrawerOperacao\(\)"/);
});
