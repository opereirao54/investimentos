'use strict';

// Aviso de risco na aba Carteira sugerida.
//
// É requisito de conformidade, não de estética: o produto exibe sugestões de
// investimento a cliente pagante, e a ausência do aviso é um problema legal
// que nenhum teste de motor ou de render apanharia — o bloco é HTML estático,
// fora do alcance das funções de desenho.
//
// Um `git revert` distraído ou um refactor de layout apaga o bloco sem
// quebrar nada visível. Este teste é o que impede isso de chegar a produção.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const disclaimer = require('../web/appliquei-disclaimer.js');

/** Só a seção da carteira — o aviso tem de estar NELA, não noutra aba. */
function secaoCarteira() {
  const ini = html.indexOf('<section id="carteira"');
  assert.ok(ini > 0, 'seção da carteira não encontrada');
  const fim = html.indexOf('<section ', ini + 10);
  const bruto = html.slice(ini, fim > 0 ? fim : undefined);
  // Espaço normalizado: a indentação do HTML parte as frases do aviso no meio,
  // e uma asserção sobre o texto cru cobraria o formatador em vez do conteúdo.
  return bruto.replace(/\s+/g, ' ');
}

test('o aviso de risco está na aba, com as quatro afirmações obrigatórias', () => {
  const sec = secaoCarteira();
  assert.ok(sec.includes('Aviso de risco'), 'o título do aviso');
  assert.ok(sec.includes('id="cartRiscoWrap"'), 'o ponto onde o aviso é montado sumiu da aba');

  // O texto deixou de ser HTML estático e passou a vir de
  // appliquei-disclaimer.js, partilhado com a aba Regulamento. A exigência
  // não mudou: as afirmações têm de CHEGAR ao usuário, e chegar SEM CLIQUE.
  // Um aviso atrás de um botão fechado é um aviso que não foi dado.
  const bloco = disclaimer.disclaimerHtmlBloco('cartRisco');
  const visivel = bloco.slice(0, bloco.indexOf('<div class="disc-corpo"'));
  assert.ok(visivel.length > 0, 'não foi possível separar a parte visível do bloco');

  // Cada frase carrega uma afirmação distinta e nenhuma é decorativa:
  // caráter educacional, projeção meramente ilustrativa, risco de perda do
  // capital, e passado que não garante futuro.
  const obrigatorias = [
    'caráter informativo e educacional',
    'não representam garantia de resultados',
    'meramente ilustrativas',
    'inclusive do capital investido',
    'Rentabilidade passada não garante rentabilidade futura',
  ];
  for (const frase of obrigatorias) {
    assert.ok(
      visivel.includes(frase),
      `frase obrigatória fora da parte visível do aviso: "${frase}"`
    );
  }
});

test('a aba não exibe a grade de seleção duplicada', () => {
  // A grade "Ativos selecionados" repetia o plano do motor e dividia o
  // aporte igualmente entre os ativos — divisão igual disfarçada de
  // recomendação, que é o que a regra do projeto proíbe.
  const sec = secaoCarteira();
  assert.ok(!sec.includes('cartSelecaoWrap'), 'a grade duplicada voltou ao HTML');
  assert.ok(!sec.includes('Ativos selecionados'), 'o título da grade duplicada voltou');
  // O contentor dos critérios continua no lugar que o JS procura.
  assert.ok(sec.includes('id="cartCriterios"'), 'o contentor dos critérios sumiu');
});

test('a tela não chama a carteira de "recomendada" nem expõe o consultor', () => {
  // Produto vendido: "recomendação" tem peso regulatório que "sugestão" não
  // tem, e "consultor" é vocabulário interno.
  const sec = secaoCarteira();
  assert.ok(sec.includes('<h1>Carteira sugerida</h1>'));
  assert.ok(!/<h1>Carteira recomendada<\/h1>/.test(html), 'o título antigo continua algures');
  assert.ok(!/menu-btn-label">Carteira recomendada</.test(html), 'o menu continua no nome antigo');
});

test('a simulação vem ANTES dos critérios e do aviso', () => {
  // Ordem pedida: primeiro o que a carteira teria feito, depois como ela foi
  // calculada, e o texto legal por último. Sem asserção, um refactor de
  // layout devolve os blocos à ordem antiga sem quebrar nada visível.
  const sec = secaoCarteira();
  const pos = (marca) => {
    const i = sec.indexOf(marca);
    assert.ok(i > 0, `bloco não encontrado: ${marca}`);
    return i;
  };
  const sim = pos('id="cartSimCard"');
  const criterios = pos('id="cartCriterios"');
  const risco = pos('class="cart-risco"');
  assert.ok(sim < criterios, 'a simulação tem de vir antes dos critérios');
  assert.ok(criterios < risco, 'os critérios têm de vir antes do aviso de risco');
});

test('o aviso de risco sobrevive ao motor não carregar', () => {
  // cartMotorWrap é escondido inteiro quando `motorRanquear` não existe
  // (ver cartRenderizarMotor). Enquanto o aviso vivia lá dentro, uma falha
  // a carregar um <script> levava junto o texto de conformidade.
  const sec = secaoCarteira();
  const abreWrap = sec.indexOf('id="cartMotorWrap"');
  const fechaWrap = sec.indexOf('id="cartSimCard"');
  const risco = sec.indexOf('id="cartRiscoWrap"');
  assert.ok(abreWrap > 0 && fechaWrap > abreWrap);
  assert.ok(
    risco > fechaWrap,
    'o aviso voltou para dentro do cartMotorWrap — some quando o motor falha'
  );
});
