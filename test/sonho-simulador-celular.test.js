'use strict';

// Sonhos e simulador no celular com cara de app (web/appliquei-mobile.js).
//
// O cadastro do sonho virou quatro telas (o sonho, quanto custa, para quando,
// de onde sai o dinheiro) e o simulador ganhou controles deslizantes. Nada
// disso pode criar um segundo caminho de gravação: os atalhos escrevem nos
// campos de sempre e quem valida, monta a prévia e salva continua sendo o
// código do desktop. Este arquivo trava essa costura.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'web/appliquei-mobile.js'), 'utf8');
const SON = fs.readFileSync(path.join(ROOT, 'web/appliquei-sonhos.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');

/** Um elemento de mentira: o bastante para os atalhos do celular. */
function no(id, props) {
  const attrs = {};
  return Object.assign(
    {
      id,
      value: '',
      dataset: {},
      style: {},
      options: [],
      children: [],
      childElementCount: 0,
      innerHTML: '',
      textContent: '',
      firstElementChild: { scrollTop: 0 },
      setAttribute: (k, v) => (attrs[k] = String(v)),
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      dispatchEvent: () => true,
      addEventListener: () => {},
      querySelectorAll: () => [],
      focus: () => {},
      attrs,
    },
    props
  );
}

function carregar() {
  const els = {};
  const toasts = [];
  const botoesPrazo = [6, 12, 24, 36, 60, 120].map((m) =>
    no('', { dataset: { meses: String(m) } })
  );
  const add = (n) => (els[n.id] = n);
  add(no('modalSonho'));
  add(no('sonhoWizPasso'));
  add(no('sonhoNome'));
  add(no('sonhoValorTotal'));
  add(no('sonhoPrazo', { value: '12' }));
  add(no('sonhoPrazoUnidade', { value: 'meses' }));
  add(no('sonhoWizCats'));
  add(
    no('sonhoCategoria', {
      value: 'viagem',
      options: [
        { value: 'viagem', textContent: '✈️ Viagem' },
        { value: 'imovel', textContent: '🏠 Imóvel' },
      ],
    })
  );
  const document = {
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '#sonhoWizPrazos button' ? botoesPrazo : []),
    addEventListener: () => {},
    body: no('body', { classList: { toggle() {}, add() {}, remove() {}, contains: () => false } }),
    documentElement: no('html'),
  };
  const window = {
    matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),
    addEventListener: () => {},
    visualViewport: null,
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    navigator: {},
    localStorage: { getItem: () => null, setItem() {} },
    Event: function Event(t) {
      this.type = t;
    },
    MutationObserver: function () {
      this.observe = () => {};
    },
    mostrarToast: (m) => toasts.push(m),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // parseBRL vem dos utils; o resto dos utils não é preciso aqui.
  const i = UTILS.indexOf('function parseBRL');
  const fim = UTILS.indexOf('\n}\n', i) + 3;
  vm.runInContext(UTILS.slice(i, fim), ctx);
  vm.runInContext(MOB, ctx);
  return { ctx, els, toasts, botoesPrazo };
}

test('cada campo do cadastro de sonho diz em qual das quatro telas aparece', () => {
  const ini = HTML.indexOf('id="sonhoPasso1"');
  const passo1 = HTML.slice(ini, HTML.indexOf('<!-- /sonhoPasso1 -->', ini));
  const etapaDo = (campo) => {
    const j = passo1.indexOf('id="' + campo + '"');
    assert.ok(j > -1, campo + ' precisa estar no passo 1');
    const grupo = passo1.lastIndexOf('class="form-group"', j);
    return (passo1.slice(grupo, j).match(/data-sonho-etapa="(\d)"/) || [])[1];
  };
  assert.equal(etapaDo('sonhoNome'), '1');
  assert.equal(etapaDo('sonhoCategoria'), '1');
  assert.equal(etapaDo('sonhoDescricao'), '1');
  assert.equal(etapaDo('sonhoValorTotal'), '2');
  assert.equal(etapaDo('sonhoValorInicial'), '2');
  assert.equal(etapaDo('sonhoPrazo'), '3');
  assert.equal(etapaDo('sonhoMesInicio'), '3');
  assert.equal(etapaDo('sonhoContaOrigem'), '4');
  assert.equal(etapaDo('sonhoEsforco'), '4');
  for (const n of [1, 2, 3, 4]) {
    assert.match(passo1, new RegExp('sonho-wiz-cab" data-sonho-etapa="' + n + '"'));
  }
});

test('o passo a passo não avança sem o que a tela pede', () => {
  const { ctx, els, toasts } = carregar();
  ctx.mobSonhoIrPasso(1);
  ctx.mobSonhoPasso(1);
  assert.equal(els.modalSonho.dataset.sonhoEtapa, '1', 'sem nome fica na tela 1');
  assert.match(toasts.pop(), /nome/);

  els.sonhoNome.value = 'Viagem';
  ctx.mobSonhoPasso(1);
  assert.equal(els.modalSonho.dataset.sonhoEtapa, '2');

  ctx.mobSonhoPasso(1);
  assert.equal(els.modalSonho.dataset.sonhoEtapa, '2', 'sem valor fica na tela 2');
  els.sonhoValorTotal.value = '20.000,00';
  ctx.mobSonhoPasso(1);
  ctx.mobSonhoPasso(1);
  assert.equal(els.modalSonho.dataset.sonhoEtapa, '4');
  assert.equal(els.sonhoWizPasso.textContent, 'Passo 4 de 4');

  // Da quarta tela em diante quem segue é "Ver prévia" (irParaPreviaSonho).
  ctx.mobSonhoPasso(1);
  assert.equal(els.modalSonho.dataset.sonhoEtapa, '4');
  ctx.mobSonhoPasso(-1);
  assert.equal(els.modalSonho.dataset.sonhoEtapa, '3');
});

test('os atalhos escrevem nos campos de sempre', () => {
  const { ctx, els, botoesPrazo } = carregar();
  ctx.mobSonhoPrazo(24);
  assert.equal(els.sonhoPrazo.value, '2');
  assert.equal(els.sonhoPrazoUnidade.value, 'anos');
  assert.equal(botoesPrazo[2].getAttribute('aria-pressed'), 'true');
  ctx.mobSonhoPrazo(6);
  assert.equal(els.sonhoPrazo.value, '6');
  assert.equal(els.sonhoPrazoUnidade.value, 'meses');
  ctx.mobSonhoCategoria('imovel');
  assert.equal(els.sonhoCategoria.value, 'imovel');
});

test('a prévia e o salvar continuam sendo os do desktop', () => {
  // O celular só marca a tela; irParaPreviaSonho valida e salvarSonho grava.
  const previa = SON.slice(SON.indexOf('function irParaPreviaSonho'));
  assert.match(previa.slice(0, previa.indexOf('\n}\n')), /mobSonhoIrPasso\('previa'\)/);
  const reset = SON.slice(SON.indexOf('function resetarPassosSonho'));
  assert.match(reset.slice(0, reset.indexOf('\n}\n')), /mobSonhoIrPasso\(1\)/);
  const fn = MOB.slice(
    MOB.indexOf('var MOB_SONHO_PASSOS'),
    MOB.indexOf('// Carteira no celular: a lista')
  );
  assert.doesNotMatch(fn, /sonhos\.push|salvarSonhos\(|salvarSonho\(/);
});

test('simulador: cada controle deslizante aponta para um campo que existe', () => {
  const ids = [...HTML.matchAll(/class="mob-sim-range" data-mob-range-de="(\w+)"/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(ids.sort(), [
    'metaCapital',
    'metaPrazo',
    'metaTaxa',
    'metaValor',
    'simAporte',
    'simCapital',
    'simTaxa',
    'simTempo',
  ]);
  for (const id of ids) {
    assert.match(HTML, new RegExp('id="' + id + '"'), id);
    assert.match(MOB, new RegExp('\\b' + id + ': '), 'limites de ' + id);
  }
  // No desktop nada disso aparece.
  assert.match(HTML, /\.mob-sim-range, \.mob-sim-prazos, \.mob-sim-inss \{ display: none; \}/);
});
