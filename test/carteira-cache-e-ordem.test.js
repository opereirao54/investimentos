'use strict';

// Carteira sugerida — por que era preciso clicar em "Atualizar dados", e por
// que a carteira ficava a 2.046px do topo no celular.
//
// 1) O CACHE ENVENENADO. `cartMotor.buscadoEm` fazia três trabalhos ao mesmo
//    tempo: "já busquei", "não precisa buscar de novo" e "tenho material para
//    calcular". O catch da busca carimbava esse campo — ou seja, uma FALHA de
//    rede passava a valer como cache. A partir daí toda reentrada na aba caía
//    no atalho `if (cartMotor.buscadoEm && !forcar) return cartRecalcularMotor()`
//    e reusava o estado degradado (sem score, sem distribuir o aporte) pelo
//    resto da sessão. "Atualizar dados" zerava o campo — era o único jeito de
//    furar o cache, e por isso parecia que o botão é que "trazia" a carteira.
//
//    Agora são três campos: buscadoEm (sucesso), falhouEm (falha) e temDados
//    (há material em memória). Separá-los é o que faz a aba tentar sozinha.
//
// 2) A ORDEM DA PÁGINA. O que a pessoa abre a aba para ver — o plano de aporte
//    — vinha depois do perfil, do painel educativo com um parágrafo por classe,
//    do donut e do status do motor. A informação principal ficava a duas telas
//    e meia de rolagem no celular.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const CART = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-carteira-recomendada.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

/** Recorta o corpo de uma função top-level pelo balanço de chaves. */
function corpo(fonte, nome) {
  const marca = new RegExp(`(async\\s+)?function ${nome}\\s*\\(`);
  const m = marca.exec(fonte);
  if (!m) return null;
  const abre = fonte.indexOf('{', m.index);
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '{') nivel++;
    else if (fonte[i] === '}') {
      nivel--;
      if (nivel === 0) return fonte.slice(m.index, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// O cache
// ---------------------------------------------------------------------------

test('uma falha de busca NÃO carimba o cache de sucesso', () => {
  const fn = corpo(CART, 'cartRenderizarMotor');
  assert.ok(fn, 'cartRenderizarMotor não encontrada');
  const iCatch = fn.indexOf('} catch (e) {');
  assert.ok(iCatch > -1, 'a busca precisa de catch');
  const bloco = fn.slice(iCatch);
  assert.ok(
    !/cartMotor\.buscadoEm\s*=\s*Date\.now\(\)/.test(bloco),
    'o catch não pode carimbar buscadoEm: isso prende a aba no estado degradado ' +
      'até alguém clicar em "Atualizar dados"'
  );
  assert.match(bloco, /cartMotor\.falhouEm = Date\.now\(\)/, 'a falha tem campo próprio');
});

test('a falha ainda deixa material em memória para desenhar a carteira modelo', () => {
  // Sem `temDados`, `cartRecalcularMotor` desiste na primeira linha e a aba
  // fica em branco — pior do que a carteira sem score.
  const fn = corpo(CART, 'cartRenderizarMotor');
  const bloco = fn.slice(fn.indexOf('} catch (e) {'));
  assert.match(bloco, /cartMotor\.temDados = true/);
  assert.match(bloco, /cartRecalcularMotor\(\)/);
});

test('o sucesso limpa a marca de falha', () => {
  const fn = corpo(CART, 'cartRenderizarMotor');
  const bloco = fn.slice(0, fn.indexOf('} catch (e) {'));
  assert.match(bloco, /cartMotor\.buscadoEm = Date\.now\(\)/);
  assert.match(bloco, /cartMotor\.falhouEm = null/, 'senão a falha antiga forçaria rebusca eterna');
  assert.match(bloco, /cartMotor\.temDados = true/);
});

test('depois de falhar, a próxima entrada na aba tenta de novo sozinha', () => {
  const fn = corpo(CART, 'cartRenderizarMotor');
  assert.match(
    fn,
    /if \(cartMotor\.falhouEm && !forcar && Date\.now\(\) - cartMotor\.falhouEm < \d+\)/,
    'o respiro curto evita martelar a API, mas a retentativa tem de ser automática'
  );
});

test('os recálculos locais olham "tem material", não "tem cache"', () => {
  // Trocar de lente, personalizar ou desfazer uma troca não vai à rede: só
  // recalcula. Amarrar isso ao cache de sucesso era o que fazia a tela
  // congelar depois de uma falha.
  assert.match(corpo(CART, 'cartRecalcularMotor'), /if \(!cartMotor\.temDados\) return;/);
  assert.ok(
    !/if \(!cartMotor\.buscadoEm\) cartRenderizarCustom\(\)/.test(CART),
    'os guards de render devem usar temDados'
  );
  assert.ok(
    CART.split('if (!cartMotor.temDados) cartRenderizarCustom();').length - 1 >= 4,
    'todos os pontos de personalização precisam do guard novo'
  );
});

test('"Atualizar dados" limpa os dois carimbos', () => {
  const fn = corpo(CART, 'cartAtualizarMotor');
  assert.match(fn, /cartMotor\.buscadoEm = null/);
  assert.match(fn, /cartMotor\.falhouEm = null/, 'senão o respiro barraria o clique explícito');
});

// ---------------------------------------------------------------------------
// A ordem da página
// ---------------------------------------------------------------------------

function secaoCarteira() {
  const ini = HTML.indexOf('<section id="carteira"');
  assert.ok(ini > -1);
  const prox = HTML.indexOf('<section id="', ini + 10);
  return HTML.slice(ini, prox > -1 ? prox : HTML.length);
}
const SECAO = secaoCarteira();

test('a carteira sugerida vem antes do material de apoio', () => {
  const pos = (s) => {
    const i = SECAO.indexOf(s);
    assert.ok(i > -1, `não achei ${s}`);
    return i;
  };
  const perfil = pos('id="cartPerfilHeader"');
  const motor = pos('id="cartMotorWrap"');
  const donut = pos('id="cartDonutCard"');
  const edu = pos('id="cartEduDetails"');
  const sim = pos('id="cartSimCard"');

  assert.ok(motor > perfil, 'o perfil abre a página');
  assert.ok(donut > motor, 'a distribuição vem depois da carteira em si');
  assert.ok(edu > motor, 'o painel educativo não pode empurrar a carteira para baixo');
  assert.ok(sim > motor, 'a simulação histórica é o fecho, não a abertura');
});

test('dentro do motor, o plano vem antes da procedência', () => {
  const iPlano = SECAO.indexOf('id="cartMotorPlano"');
  const iStatus = SECAO.indexOf('id="cartMotorStatus"');
  assert.ok(iPlano > -1 && iStatus > -1);
  assert.ok(
    iStatus > iPlano,
    'cobertura de dados e lente ativa são a PROCEDÊNCIA da recomendação, não a ' +
      'recomendação — acima do plano, empurravam para baixo o que a pessoa veio ver'
  );
});

test('o painel educativo nasce recolhido', () => {
  const m = /<details class="cart-edu-details" id="cartEduDetails"([^>]*)>/.exec(SECAO);
  assert.ok(m, 'o bloco educativo precisa ser um <details>');
  assert.ok(!/\bopen\b/.test(m[1]), 'aberto por padrão, ele volta a comer meia tela de celular');
});

test('a distribuição por classe aparece uma vez só', () => {
  // Ela vivia em três lugares ao mesmo tempo: no donut, na legenda do donut e
  // em cada linha do painel educativo. Três números para conferir, meia tela
  // gasta, e nada novo dito.
  const edu = corpo(CART, 'cartRenderizarEdu');
  assert.ok(!/cart-edu-item-meta/.test(edu), 'o valor por classe sai do painel educativo');
  assert.ok(!/cart-edu-item-pct/.test(edu), 'a percentagem por classe também');
  assert.match(CART, /cartDonutLegend/, 'ela continua existindo — no donut');
});

test('o educativo e o donut entram e saem junto com o resto da carteira', () => {
  // Um bloco que só aparece depois do questionário e nunca some ao editar o
  // perfil deixa a tela num estado meio-a-meio.
  const concluir = corpo(CART, 'cartConcluirQuestionario') || CART;
  assert.match(CART, /getElementById\('cartEduDetails'\)/);
  assert.match(CART, /getElementById\('cartDonutCard'\)/);
  const ligar = CART.split("eduBox.style.display = 'block'").length - 1;
  const desligar = CART.split("eduOff.style.display = 'none'").length - 1;
  assert.equal(ligar, 1, 'tem de ser mostrado ao concluir o questionário');
  assert.equal(desligar, 1, 'e escondido ao reabri-lo');
});

// ---------------------------------------------------------------------------
// Densidade no celular
// ---------------------------------------------------------------------------

test('as lentes ficam numa faixa que rola, não em quatro linhas', () => {
  assert.match(
    HTML,
    /\.cart-motor-lentes \{[^}]*overflow-x: auto/s,
    '"Valor & Margem de Segurança" quebrava em quatro linhas no celular'
  );
});

test('os três números do plano não são espremidos em três colunas no celular', () => {
  // "R$ 10.000,00" em monoespaçada não cabe num terço de 390px — saía cortado
  // no meio do número.
  const m =
    /@media \(max-width: 620px\) \{\s*\/\*[^*]*\*\/\s*\.cart-plano-resumo \{ grid-template-columns: repeat\((\d)/s.exec(
      HTML
    );
  assert.ok(m, 'a regra de celular do resumo do plano sumiu');
  assert.equal(m[1], '2', 'duas colunas no celular');
});

test('a descrição do perfil é recolhida sem o rótulo cair sobre o texto', () => {
  // O clamp aplicado no container fazia o ::after do rótulo contar como linha
  // e ser impresso POR CIMA do texto cortado. O corte tem de ser no texto.
  // Só nas telas em que o parágrafo estoura: no monitor ele cabe inteiro e o
  // rótulo seria ruído.
  assert.match(
    HTML,
    /@media \(max-width: 920px\) \{\s*#carteira \.cart-perfil-msg-txt \{[^}]*-webkit-line-clamp: 2/s
  );
  assert.match(CART, /class="cart-perfil-msg-txt"/, 'o texto precisa do próprio elemento');
  assert.match(CART, /class="cart-perfil-msg-mais"/, 'e o rótulo, de um irmão');
});
