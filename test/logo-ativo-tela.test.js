'use strict';

/**
 * A marca do ativo nas telas: monograma sempre, logo por cima quando existe.
 *
 * O DESENHO. Antes cada lista tinha o seu quadradinho com a inicial, feito à
 * mão e com regra própria de tamanho. O logo entrou como uma camada ACIMA
 * disso, não no lugar: FII, Tesouro, cripto e ticker recém-listado não têm
 * imagem, e é a maioria de uma carteira brasileira típica. Se o <img> falha
 * ele se remove e o monograma reaparece — mesma caixa, zero salto de layout.
 *
 * O que estes testes cercam é justamente o chão: que nenhuma lista fique com
 * buraco, que o HTML injetado não seja um vetor de injeção, e que a decisão
 * de gastar (ou não) uma requisição por linha seja explícita.
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = ler('Appliquei_v13.0.html');

// utils.js é classic script e toca localStorage/document no topo; o pedaço de
// cor em diante é puro, e é onde a marca vive.
const UTILS = ler('web/appliquei-utils.js');
const { logoAtivoHTML, monogramaAtivo, corMonogramaAtivo } = new Function(
  UTILS.slice(UTILS.indexOf('var TINTA_CLARA')) +
    '\nreturn { logoAtivoHTML, monogramaAtivo, corMonogramaAtivo };'
).call({ window: {}, Math });

// --------------------------------------------------------------- o monograma

test('o monograma nunca sai vazio', () => {
  // Uma lista com um buraco no lugar do avatar lê como falha de carregamento.
  for (const t of ['PETR4', 'BTLG11', 'BTC-USD', 'TESOURO_IPCA_2035', 'X', '', null, undefined]) {
    const m = monogramaAtivo(t);
    assert.ok(m && m.length >= 1 && m.length <= 2, 'monograma ruim para ' + JSON.stringify(t));
  }
});

test('o número da classe não entra na inicial', () => {
  // "PE" identifica; "P4" não diz nada — o 4 é o tipo da ação, não a empresa.
  assert.equal(monogramaAtivo('PETR4'), 'PE');
  assert.equal(monogramaAtivo('BTLG11'), 'BT');
  assert.equal(monogramaAtivo('VALE3'), 'VA');
  assert.equal(monogramaAtivo('BTC-USD'), 'BT');
});

test('a cor do monograma é estável por ticker', () => {
  // Se mudasse a cada render, a mesma empresa apareceria de uma cor na
  // carteira e de outra nos dividendos.
  assert.equal(corMonogramaAtivo('PETR4'), corMonogramaAtivo('PETR4'));
  assert.notEqual(corMonogramaAtivo('PETR4'), corMonogramaAtivo('ITUB4'));
  for (const t of ['PETR4', 'VALE3', 'MXRF11']) {
    assert.match(corMonogramaAtivo(t), /^#[0-9a-f]{6}$/);
  }
});

// ------------------------------------------------------------------ a marcação

test('a imagem vem do nosso domínio, com o ticker no caminho', () => {
  const html = logoAtivoHTML('PETR4', { tamanho: 24 });
  assert.match(html, /src="\/api\/logo\/PETR4"/);
  assert.ok(!/https?:\/\//.test(html), 'nenhum host de terceiro pode aparecer na marcação');
});

test('o rewrite do /api/logo leva o ticker até o handler', () => {
  // O cap de 12 functions do Hobby obriga a pendurar tudo em api/market.js
  // por `?op=`. Se o rewrite não carregar o ticker, o proxy responde 400 a
  // TODA imagem e nenhum logo aparece nunca — falha silenciosa e total.
  // Por isso o ticker vai por segmento nomeado, e não confiando na fusão da
  // query string pelo roteador.
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rw = (vercel.rewrites || []).find((r) => r.source === '/api/logo/:ticker');
  assert.ok(rw, 'falta o rewrite de /api/logo/:ticker');
  assert.match(rw.destination, /op=logo/, 'o rewrite tem de cair na sub-op certa');
  assert.match(rw.destination, /ticker=:ticker/, 'o ticker tem de chegar ao handler');

  // Casa o que o cliente REALMENTE pede com o que o rewrite escuta.
  const pedido = logoAtivoHTML('PETR4', { tamanho: 24 }).match(/src="([^"]+)"/)[1];
  const padrao = new RegExp('^' + rw.source.replace(/:[a-z]+/gi, '[^/]+') + '$');
  assert.match(
    pedido,
    padrao,
    'o cliente pede "' + pedido + '", o rewrite escuta "' + rw.source + '"'
  );
});

test('a imagem se remove sozinha quando não há logo', () => {
  // As listas são montadas por innerHTML: não há onde pendurar listener
  // depois, então o handler tem de ir inline. Sem isto sobra a moldura vazia
  // do <img> quebrado por cima do monograma.
  const html = logoAtivoHTML('PETR4', { tamanho: 24 });
  assert.match(html, /onerror="this\.remove\(\)"/);
  assert.match(html, /naturalWidth/, '204 carrega sem erro e sem pixel: onerror sozinho não pega');
  assert.match(html, /class="ativo-marca-inicial"/, 'o monograma tem de estar por baixo');
});

test('a imagem é decorativa para quem usa leitor de tela', () => {
  // O ticker já está escrito ao lado, em texto. Um alt com o nome do ativo
  // faria o leitor dizer tudo duas vezes.
  const html = logoAtivoHTML('PETR4', { tamanho: 24 });
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /loading="lazy"/, 'lista longa não pode buscar tudo de uma vez');
});

test('ticker sujo não vira injeção de HTML', () => {
  const html = logoAtivoHTML('<img src=x onerror=alert(1)>', { tamanho: 24 });
  assert.ok(!html.includes('<img src=x'), 'HTML de dado entrou cru na marcação');
  assert.ok(!html.includes('alert(1)'));
});

test('sem ticker não sai requisição', () => {
  // Renda fixa sem papel, conta bancária: não há logo a buscar e uma
  // requisição por linha para receber 204 é gasto puro.
  const html = logoAtivoHTML('', { tamanho: 24 });
  assert.ok(!html.includes('<img'), 'buscou imagem para um item sem ticker');
  assert.match(html, /ativo-marca/);
});

test('semBusca desenha só o monograma', () => {
  const html = logoAtivoHTML('TESOURO_IPCA_2035', { tamanho: 24, semBusca: true });
  assert.ok(!html.includes('<img'), 'Tesouro não tem emissor listado — nada a buscar');
});

test('sem tamanho quem dimensiona é o CSS', () => {
  // #patrimonio .rich-avatar encolhe para 36px em telas estreitas. Um
  // width inline venceria essa regra e a linha estouraria a grade.
  const semTamanho = logoAtivoHTML('PETR4', { classe: 'rich-avatar ativo-marca' });
  assert.ok(!/width:\s*\d/.test(semTamanho), 'width inline venceria a media query da tela');
  const comTamanho = logoAtivoHTML('PETR4', { tamanho: 26 });
  assert.match(comTamanho, /width:26px;height:26px/);
  assert.match(comTamanho, /font-size:10px/, 'a inicial tem de acompanhar a caixa');
});

// ------------------------------------------------------------ as telas em si

const TELAS = [
  ['web/appliquei-aba1-charts.js', 'lista de ativos do Patrimônio'],
  ['web/appliquei-aba-dividendos.js', 'proventos'],
  ['web/appliquei-renda-fixa.js', 'timeline de operações'],
  ['web/appliquei-previdencia.js', 'proventos do mês'],
  ['web/appliquei-aba-carteira-recomendada.js', 'ranking da Carteira Recomendada'],
  ['web/appliquei-app.js', 'drawer de operação'],
];

test('toda tela que lista ativo desenha a marca', () => {
  for (const [arquivo, nome] of TELAS) {
    assert.match(ler(arquivo), /logoAtivoHTML\(/, nome + ' ficou sem a marca do ativo');
  }
});

test('nenhuma tela desenha o quadradinho à mão', () => {
  // Era esse o problema original: cada lista com o seu, e o logo teria de ser
  // acrescentado em seis lugares diferentes toda vez.
  const charts = ler('web/appliquei-aba1-charts.js');
  assert.ok(
    !/<div class="rich-avatar" style="background:/.test(charts),
    'a lista do Patrimônio voltou a montar o avatar por conta própria'
  );
});

test('o helper é carregado antes de quem o usa', () => {
  // utils.js é classic script; se entrar depois, `logoAtivoHTML` é
  // ReferenceError no meio de um innerHTML e a lista inteira some.
  const pos = (f) => HTML.indexOf('/web/' + f);
  const utils = pos('appliquei-utils.js');
  assert.ok(utils > 0, 'utils.js saiu do HTML');
  for (const [arquivo] of TELAS) {
    const p = pos(path.basename(arquivo));
    assert.ok(p > utils, arquivo + ' carrega antes de utils.js');
  }
});

test('o CSS da marca existe e empilha logo sobre monograma', () => {
  assert.match(HTML, /\.ativo-marca \{/, 'falta o CSS da marca');
  assert.match(
    HTML,
    /\.ativo-marca-img \{[^}]*position: absolute/,
    'a imagem tem de cobrir a caixa'
  );
  assert.match(
    HTML,
    /\.ativo-marca \{[^}]*overflow: hidden/,
    'logo retangular vazaria do quadrado'
  );
  assert.match(
    HTML,
    /\.ativo-marca-img \{[^}]*object-fit: contain/,
    'cover cortaria o logo; contain preserva a marca inteira'
  );
  assert.match(
    HTML,
    /\.ativo-marca-img \{[^}]*background: #fff/,
    'logo de empresa é feito para fundo claro e sumiria sobre o verde'
  );
});

test('toda classe de marca inventada pelas telas tem CSS', () => {
  const classes = new Set();
  for (const [arquivo] of TELAS) {
    for (const m of ler(arquivo).matchAll(/logoAtivoHTML\([^)]*?classe:\s*'([^']+)'/gs)) {
      for (const c of m[1].split(/\s+/)) classes.add(c);
    }
  }
  assert.ok(classes.size >= 4, 'o extrator de classes quebrou');
  for (const c of classes) {
    assert.match(HTML, new RegExp('\\.' + c + '[\\s,{:]'), 'classe sem CSS: .' + c);
  }
});

// ------------------------------------------------- a confirmação da operação

test('o drawer confirma qual empresa foi digitada', () => {
  // Entre digitar o código e a operação estar gravada não havia nenhuma
  // confirmação: VALE3 e VALE5 diferem por um caractere.
  const app = ler('web/appliquei-app.js');
  assert.match(HTML, /id="compraIdentidade"/, 'falta o bloco de identidade no drawer');
  assert.match(app, /function atualizarIdentidadeAtivo/);
  assert.match(app, /atualizarIdentidadeAtivo\(/, 'ninguém chama a atualização');
  assert.match(
    app,
    /if \(alvo\.dataset\.ticker === tk\) return;/,
    'sem guarda, oninput recria o <img> a cada tecla — uma requisição por tecla'
  );
});

test('o bloco de identidade nasce oculto e é anunciado quando muda', () => {
  const pos = HTML.indexOf('id="compraIdentidade"');
  const tag = HTML.slice(HTML.lastIndexOf('<', pos), HTML.indexOf('>', pos) + 1);
  assert.match(tag, /hidden/, 'nasce visível e vazio, reservando espaço em branco');
  assert.match(tag, /aria-live="polite"/, 'quem não vê a tela precisa ouvir o ativo reconhecido');
});
