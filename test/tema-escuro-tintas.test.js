'use strict';

// Trava para a classe de defeito que deixou o modo escuro ilegível.
//
// O sintoma: 113 trechos de texto abaixo de 4,5:1 no tema escuro. A causa não
// era "faltou ajustar o dark" — era que a cor do texto NASCIA como hex de tema
// claro, escrita à mão dentro de `style="color:#7c3aed"`. Um hex não tem duas
// versões. No tema escuro o roxo-escuro ia parar sobre o verde-quase-preto:
// 2,4:1, invisível.
//
// A regra que ficou: SATURADO preenche (barra, ponto, fatia de gráfico, arco);
// TINTA escreve. Toda tinta sai de --tinta-*, que tem par claro/escuro. Um
// `color:` com hex de marca cravado é a volta do defeito, e é o que estes
// testes procuram.
//
// Companheiro de aba-investimentos-contrato.test.js e drawer-operacao-dom.js:
// os três leem o fonte de verdade em vez de simular DOM.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Cores de marca do app, por família. Qualquer uma delas atrás de `color:` é
// uma tinta cravada.
const MARCA = {
  verde: ['#10b981', '#059669', '#047857', '#34d399', '#065f46'],
  vermelho: ['#ef4444', '#dc2626', '#b91c1c', '#f87171', '#991b1b'],
  roxo: ['#7c3aed', '#8b5cf6', '#6d28d9', '#a78bfa'],
  azul: ['#0ea5e9', '#0369a1', '#2563eb', '#60a5fa'],
  ambar: ['#f59e0b', '#d97706', '#b45309', '#fbbf24', '#92400e'],
};
const TODAS = new Set(Object.values(MARCA).flat());

// Arquivos que produzem tela do app. Ficam de fora:
//  · appliquei-billing.js — a assinatura tem o próprio sistema (--ma-*) com
//    override de body.dark, e o hero/CTA vivem sobre gradiente saturado, onde
//    o branco é a leitura certa nos dois temas;
//  · appliquei-auth-gate.js e o bloco .rm-print — desenham FORA do app (portão
//    antes do tema carregar, e o PDF, que é um iframe sem a folha de estilo).
const RENDERIZADORES = [
  'web/appliquei-app.js',
  'web/appliquei-aba1-charts.js',
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-relatorio-mensal.js',
  'web/appliquei-sonhos.js',
  'web/appliquei-bens.js',
  'web/appliquei-patrimonio.js',
  'web/appliquei-renda-fixa.js',
  'web/appliquei-contas.js',
];

// Recorta o trecho do relatório impresso, onde o hex fixo é obrigatório.
function semBlocoImpressao(src) {
  const ini = src.indexOf('.rm-print');
  if (ini === -1) return src;
  const fim = src.indexOf('</style>', ini);
  return src.slice(0, ini) + src.slice(fim === -1 ? src.length : fim);
}

const RE_COLOR = /color:\s*(#[0-9a-fA-F]{6})/g;

for (const arquivo of RENDERIZADORES) {
  test(`${arquivo}: nenhuma cor de marca cravada em color:`, () => {
    const src = semBlocoImpressao(ler(arquivo));
    const achados = [];
    for (const linha of src.split('\n')) {
      RE_COLOR.lastIndex = 0;
      let m;
      while ((m = RE_COLOR.exec(linha))) {
        if (TODAS.has(m[1].toLowerCase()))
          achados.push(`${m[1]} em: ${linha.trim().slice(0, 110)}`);
      }
    }
    assert.deepEqual(
      achados,
      [],
      `tinta de tema claro cravada em ${arquivo}:\n  ${achados.join('\n  ')}\n` +
        `Um hex não tem versão escura: no tema escuro esse texto cai para 2–3:1. ` +
        `Use var(--tinta-verde|vermelho|roxo|azul|ambar), que troca com o tema. ` +
        `Se a cor for PREENCHIMENTO (barra, ponto, fatia), ela não deve estar ` +
        `atrás de "color:".`
    );
  });
}

test('as tintas existem nos dois temas', () => {
  const familias = ['verde', 'vermelho', 'roxo', 'azul', 'ambar', 'ciano'];
  const raiz = HTML.slice(HTML.indexOf(':root {'), HTML.indexOf('body.dark {'));
  const escuro = HTML.slice(HTML.indexOf('body.dark {'), HTML.indexOf('body.dark {') + 3000);
  for (const f of familias) {
    assert.match(raiz, new RegExp(`--tinta-${f}:`), `--tinta-${f} não definida no tema claro`);
    assert.match(escuro, new RegExp(`--tinta-${f}:`), `--tinta-${f} não definida no tema escuro`);
  }
});

test('os pares de superfície do tema escuro têm contraparte clara', () => {
  // Um par declarado só no body.dark deixa o tema claro sem valor nenhum: a
  // var() cai vazia e a regra some. Foi o que aconteceu com --rm-faixa-*
  // quando ela nasceu dentro de #relatorio_mensal.
  const PARES = [
    '--dre-destaque',
    '--dre-destaque-forte',
    '--rm-faixa-vermelho-bg',
    '--rm-faixa-amarelo-bg',
    '--rm-faixa-verde-bg',
    '--rm-faixa-vermelho-tinta',
    '--rm-faixa-amarelo-tinta',
    '--rm-faixa-verde-tinta',
    '--rm-gauge-trilho',
    '--rm-gauge-cubo',
    '--rm-gauge-aro',
    '--rm-gauge-agulha',
  ];
  const raiz = HTML.slice(HTML.indexOf(':root {'), HTML.indexOf('body.dark {'));
  for (const v of PARES) {
    assert.ok(raiz.includes(v + ':'), `${v} precisa de valor no :root, não só no body.dark`);
  }
});

test('a régua do score e o termômetro não guardam pastel fixo no HTML', () => {
  // O arco do termômetro era #eef2f7 e o cubo do ponteiro #fff, escritos no
  // próprio SVG: no tema escuro sobrava um semicírculo branco no cartão.
  const svg = HTML.slice(
    HTML.indexOf('<svg id="rmGaugeSvg"'),
    HTML.indexOf('</svg>', HTML.indexOf('<svg id="rmGaugeSvg"'))
  );
  for (const cor of ['#eef2f7', '#cbd5e1', '#0f172a']) {
    assert.ok(!svg.includes(cor), `${cor} voltou ao SVG do termômetro`);
  }
  assert.match(svg, /var\(--rm-gauge-trilho\)/);
  assert.match(svg, /var\(--rm-gauge-agulha\)/);
});

test('a coluna do mês corrente da DRE sai de variável', () => {
  const src = ler('web/appliquei-aba-controle-financeiro.js');
  assert.ok(!src.includes('#eff6ff'), 'o azul claro do mês corrente voltou cravado');
  assert.ok(!src.includes('#d1fae5'), 'o verde claro do mês corrente voltou cravado');
  assert.match(src, /background-color: var\(--dre-destaque\)/);
  assert.match(src, /background-color: var\(--dre-destaque-forte\)/);
});

test('tintaSobre decide pela luminância do bloco, não pelo tema', () => {
  // A função vive em utils.js (classic script, primeiro da fila). O corte fica
  // em ~0,19 de luminância relativa: abaixo dele o branco ganha, acima a tinta
  // escura ganha. Testado nas cores que o app realmente pinta.
  const src = ler('web/appliquei-utils.js');
  const ctx = { window: {}, Math };
  // Só o pedaço de cor — o resto do utils toca localStorage/document.
  const ini = src.indexOf('var TINTA_CLARA');
  const trecho = src.slice(ini);
  const fn = new Function(trecho + '\nreturn { tintaSobre, luminanciaRelativa, corParaRGB };');
  const { tintaSobre, corParaRGB } = fn.call(ctx);

  assert.deepEqual(corParaRGB('#f59e0b'), [245, 158, 11]);
  assert.deepEqual(corParaRGB('#fff'), [255, 255, 255]);
  assert.deepEqual(corParaRGB('rgb(16, 185, 129)'), [16, 185, 129]);
  assert.equal(corParaRGB('var(--cor-primaria)'), null);

  // Claras demais para branco por cima.
  for (const c of ['#f59e0b', '#10b981', '#fbbf24', '#34d399', '#6ee7b7', '#0ea5e9', '#8b5cf6']) {
    assert.equal(tintaSobre(c), '#0b0f0c', `${c} pede tinta escura`);
  }
  // Escuras o bastante para o branco.
  for (const c of ['#7c3aed', '#dc2626', '#2563eb', '#065f46']) {
    assert.equal(tintaSobre(c), '#ffffff', `${c} pede tinta clara`);
  }
  // Cor que não dá para ler (gradiente, var, currentColor) mantém o antigo.
  assert.equal(tintaSobre('linear-gradient(90deg,#000,#fff)'), '#ffffff');
  assert.equal(tintaSobre(undefined), '#ffffff');
});

test('o avatar da carteira pinta a inicial pela cor do próprio bloco', () => {
  // Branco sobre o verde-menta da categoria dava 2,54:1. A regra da classe
  // continua branca como padrão; quem conhece o fundo manda a tinta inline.
  const src = ler('web/appliquei-aba1-charts.js');
  assert.match(
    src,
    /class="rich-avatar" style="background:\$\{avatarBg\};color:\$\{tintaSobre\(avatarBg\)\};"/,
    'o avatar voltou a escrever sempre em branco'
  );
});
