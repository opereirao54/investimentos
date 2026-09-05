'use strict';

// A explicação atrás do "?" e a data de referência que não pode ser inventada.
//
// As duas regras aqui são de conteúdo, não de layout: o que fica escondido
// atrás de um clique e o que NUNCA pode ficar; e o que a página afirma sobre
// a data da carteira quando não há carteira publicada.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-carteira-recomendada.js'), 'utf8');

function secaoCarteira() {
  const ini = HTML.indexOf('<section id="carteira"');
  const fim = HTML.indexOf('<section ', ini + 10);
  return HTML.slice(ini, fim > 0 ? fim : undefined).replace(/\s+/g, ' ');
}

test('a explicação do ranking nasce fechada, atrás do "?"', () => {
  const sec = secaoCarteira();
  assert.ok(sec.includes('id="cartAjudaScoresBtn"'), 'o botão de ajuda sumiu');
  assert.match(
    sec,
    /class="cart-ajuda-balao" id="cartAjudaScores" hidden/,
    'o balão tem de nascer com [hidden] — é o que deixa a página limpa'
  );
  assert.ok(sec.includes('aria-expanded="false"'));
});

test('o "?" é clicável, não hover', () => {
  // O .icon-tooltip-premium que já existia abre só no :hover, e no celular
  // hover não existe: a explicação ficava inalcançável onde mais fazia falta.
  const sec = secaoCarteira();
  assert.ok(sec.includes('onclick="cartAlternarAjuda(\'cartAjudaScores\')"'));
  assert.ok(
    !/cart-ajuda-btn:hover::after|cart-ajuda-balao[^{]*:hover/.test(HTML),
    'o balão não pode depender de hover para abrir'
  );
  assert.ok(
    HTML.includes('.cart-ajuda-btn::after'),
    'a área de toque ampliada sumiu — 17px não se acerta com o polegar'
  );
});

test('a cláusula de conformidade NÃO fica atrás de um clique', () => {
  // "não constituem recomendação de investimento" é conformidade, não
  // explicação. Escondê-la atrás do "?" seria trocar risco legal por estética.
  const sec = secaoCarteira();
  const frase = 'Não constituem recomendação de investimento';
  const pos = sec.indexOf(frase);
  assert.ok(pos > 0, 'a cláusula sumiu da aba');
  const balao = sec.indexOf('cart-ajuda-balao');
  const fechaBalao = sec.indexOf('</span>', balao);
  assert.ok(
    pos < balao || pos > fechaBalao,
    'a cláusula de conformidade foi parar dentro do balão escondido'
  );
});

test('sem carteira publicada, a página não inventa um mês de referência', () => {
  // 'Mai/2026' estava literal no default: dizia "esta é a carteira de Maio"
  // a quem abria a aba em Agosto, e a afirmação era falsa desde o dia
  // seguinte a ter sido escrita.
  assert.ok(
    !/mesAno:\s*'[A-Z][a-z]{2}\/\d{4}'/.test(JS),
    'voltou uma data fixa em mesAno — ela envelhece calada'
  );
  assert.match(JS, /mesAno:\s*null/, 'o default tem de ser null, não uma data');
  assert.ok(
    !JS.includes('mesAno: c.mesAno || dbCarteira.mesAno'),
    'o cache do modelo publicado voltou a herdar o default'
  );
});

test('o subtítulo repõe o texto da página quando não há referência', () => {
  // Um cache antigo pode ter a data inventada gravada. Sem repor, ela ficaria
  // na tela mesmo depois de a busca nova voltar sem referência.
  assert.ok(JS.includes('cartSubtituloPadrao'), 'sumiu a reposição do subtítulo');
  assert.match(
    JS,
    /partesDesc\.length \? partesDesc\.join\(' · '\) : cartSubtituloPadrao/,
    'o ramo else desapareceu — a data velha voltaria a fixar-se na tela'
  );
});
