'use strict';

// Os cards de "Meu patrimônio" ganharam duas informações novas, e as duas
// dizem a MESMA coisa em lugares diferentes: a legenda da composição, no hero,
// e a "fatia do total" dentro de cada card. Duas leituras do mesmo número são
// duas chances de divergirem.
//
// O que este arquivo tranca:
//
//   1. As quatro fatias somam 100% do patrimônio — se sobrar ou faltar, é
//      porque alguma parcela entrou no total sem entrar na composição.
//   2. Patrimônio zero não vira "0,0% do total", que sugere fatia nula quando
//      o que não existe é o total. Nem NaN, nem divisão por zero.
//   3. A barra da fatia nunca escapa de 0-100%.
//   4. As porcentagens saem com vírgula — o app é em pt-BR e o valor ao lado
//      já é "R$ 24.000,00".
//   5. O HTML tem os ganchos das quatro fatias. Um id trocado deixaria o card
//      silenciosamente com o traço inicial para sempre.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp, ORDEM_BASE } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const PATR = fs.readFileSync(path.join(ROOT, 'web/appliquei-patrimonio.js'), 'utf8');

const COMPONENTES = ['saldo', 'investido', 'imoveis', 'veiculos'];

test('as quatro fatias somam o patrimônio inteiro', () => {
  const s = carregarApp({}, ORDEM_BASE);
  const partes = { saldo: 24000, investido: 37989.69, imoveis: 420000, veiculos: 78000 };
  const total = Object.values(partes).reduce((a, b) => a + b, 0);

  const soma = Object.values(partes).reduce((acc, v) => acc + (v / total) * 100, 0);
  assert.ok(Math.abs(soma - 100) < 1e-9, 'as parcelas mostradas têm de esgotar o total');

  // E a função que pinta cada card usa exatamente essa razão.
  for (const v of Object.values(partes)) {
    const g = s.mpFatiaDoTotal(v, total);
    assert.ok(Math.abs(g - (v / total) * 100) < 1e-9);
  }
});

test('patrimônio zero não vira "0,0%" nem NaN', () => {
  const s = carregarApp({}, ORDEM_BASE);
  assert.equal(s.mpFatiaDoTotal(0, 0), null, 'sem total não há fatia a mostrar');
  assert.equal(s.mpFatiaDoTotal(500, 0), null);
  assert.equal(s.mpFatiaDoTotal(0, 1000), 0, 'com total, uma parcela zerada é 0% de verdade');
});

test('a fatia fica sempre entre 0% e 100%', () => {
  const s = carregarApp({}, ORDEM_BASE);
  // Bens podem ter valor negativo digitado errado, e o saldo em conta pode
  // ficar negativo de verdade (conta no vermelho).
  assert.equal(s.mpFatiaDoTotal(-5000, 100000), 0, 'parcela negativa não puxa a barra para trás');
  assert.equal(s.mpFatiaDoTotal(150000, 100000), 100, 'nem estoura o trilho');
  assert.equal(s.mpFatiaDoTotal(NaN, 100000), 0);
});

test('as porcentagens usam vírgula, como o resto dos números do app', () => {
  const s = carregarApp({}, ORDEM_BASE);
  // Variação (leva sinal).
  assert.equal(s.mpFmtPct(15.94), '+15,9%');
  assert.equal(s.mpFmtPct(-3.5), '-3,5%');
  assert.equal(s.mpFmtPct(0), '+0,0%');
  assert.equal(s.mpFmtPct(Infinity), '—', 'sem base de comparação não se inventa percentual');
  // Participação (sem sinal): fatia do card, legenda, "% do patrimônio".
  assert.equal(s.mpPctBR(75), '75,0%');
  assert.equal(s.mpPctBR(4.28), '4,3%');
  assert.equal(s.mpPctBR(NaN), '—');
});

test('a largura das barras continua em CSS válido — ponto, não vírgula', () => {
  // A mesma porcentagem vai para dois lugares: o texto (pt-BR) e o
  // `style="width:...%"`. Trocar o ponto por vírgula no segundo faz o
  // navegador descartar a declaração inteira e o segmento sumir da barra —
  // um erro silencioso, sem exceção nenhuma no console.
  const largurasEmCss = PATR.match(/style="width:\$\{[^}]+\}%/g) || [];
  assert.ok(largurasEmCss.length > 0, 'as barras somem se este padrão mudar de forma');
  for (const t of largurasEmCss) {
    assert.ok(!/mpPctBR|replace\('\.'/.test(t), `largura de barra formatada em pt-BR: ${t}`);
  }
  const concatenadas =
    PATR.match(/'<div class="mp-composition-seg" style="width:' \+\s*[^\n]+/g) || [];
  for (const t of concatenadas) {
    assert.ok(/toFixed/.test(t) && !/mpPctBR/.test(t), `largura do segmento em pt-BR: ${t}`);
  }
});

test('cada card de componente tem o gancho da sua fatia', () => {
  const secao = HTML.slice(
    HTML.indexOf('<section id="meu_patrimonio"'),
    HTML.indexOf('mp-onde-card')
  );
  for (const c of COMPONENTES) {
    assert.ok(secao.includes('id="mp-kpi-' + c + '-fatia"'), `falta o rótulo da fatia de "${c}"`);
    assert.ok(
      secao.includes('id="mp-kpi-' + c + '-fatia-fill"'),
      `falta a barra da fatia de "${c}"`
    );
    assert.match(
      HTML,
      new RegExp('\\.mp-kpi-' + c + '\\s+\\.mp-kpi-fatia-fill'),
      `a barra de "${c}" ficaria sem cor`
    );
  }
  // O JS pinta as quatro; esquecer uma deixa o card no traço inicial.
  for (const c of COMPONENTES) {
    assert.ok(
      new RegExp("mpPintarFatia\\('" + c + "'").test(PATR),
      `mpRenderKPIs não pinta a fatia de "${c}"`
    );
  }
});

test('a legenda da composição mostra o valor em R$, não só a porcentagem', () => {
  // Era esse o buraco: "Imóveis 75.0%" dizia a proporção e escondia de quanto
  // se estava falando, no único lugar onde as quatro parcelas aparecem juntas.
  const ini = PATR.indexOf("var compBar = document.getElementById('mp-composition-bar')");
  assert.ok(ini > -1, 'o bloco da composição sumiu');
  const corpo = PATR.slice(ini, PATR.indexOf('mpPintarFatia(', ini));
  assert.ok(corpo.includes('mp-leg-valor'), 'a legenda tem de trazer o valor em R$');
  assert.ok(corpo.includes('mp-leg-share'), 'e a porcentagem em coluna própria');
  assert.ok(
    HTML.includes('body.valores-ocultos #meu_patrimonio .mp-leg-valor'),
    'o valor da legenda é dinheiro: tem de sumir no modo "ocultar valores"'
  );
});

test('o hero empilha em vez de partir o número quando a coluna aperta', () => {
  // Com a composição ao lado, a coluna do total virou metade do card. Em
  // tamanho fixo o overflow-wrap de emergência quebrava "R$ 1.496.814,74" em
  // duas linhas, no meio dos milhares.
  assert.match(
    HTML,
    /\.mp-kpi-hero \.mp-kpi-valor \{ font-size:clamp\(/,
    'o valor do hero precisa encolher antes de quebrar'
  );
  assert.match(
    HTML,
    /@media \(max-width: 1180px\) \{\s*\.mp-kpi-hero \{ grid-template-columns: 1fr;/,
    'abaixo de 1180px as duas colunas do hero não cabem lado a lado'
  );
});
