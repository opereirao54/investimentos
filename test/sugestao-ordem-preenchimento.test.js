'use strict';

/**
 * A sugestão de categoria sobrevive à ORDEM em que o formulário é preenchido.
 *
 * ═══ O DEFEITO ═══
 *
 * Relato: "ontem eu lancei muitas despesas, mas ela só apareceu no primeiro
 * lançamento e nos outros não."
 *
 * A guarda era `if (selCat.value) return` — "categoria já escolhida não se
 * questiona". A intenção é boa; o sinal é que estava errado. No celular os
 * chips Entrada/Saída/Cartão ficam ACIMA do campo de descrição, e
 * `selecionarChipTipo` grava `despesa_variavel` nesse mesmo campo. Tocar no
 * chip antes de digitar — que é o que a mão faz depois do primeiro lançamento
 * — desligava a sugestão para sempre.
 *
 * Medido no navegador, mesmo histórico nos dois casos:
 *   descrição primeiro, chip depois → sugeriu
 *   chip primeiro, descrição depois → NÃO sugeriu
 *
 * ═══ O CONTRATO AGORA ═══
 *
 * A pergunta deixou de ser "já tem alguma coisa preenchida?" e passou a ser
 * "o que eu tenho a dizer já está escrito?". O chip preenche só a
 * classificação GROSSA; a sugestão carrega também a categoria de despesa
 * (mercado, transporte), que chip nenhum preenche — e é ela que poupa o
 * trabalho. A sugestão cala quando as duas já batem, que era o objetivo
 * original da guarda, agora pelo motivo certo.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const M = require('../web/appliquei-insights.js');

/** Formulário mínimo: os dois selects que decidem a guarda. */
function montarTela(contabil, fina) {
  const els = {
    categoriaTransacao: { value: contabil || '' },
    categoriaDespesa: { value: fina || '' },
    descTransacao: { value: '' },
    sugestaoCategoria: { innerHTML: '' },
  };
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    window: { AppliqueiInsights: M },
    console,
    setTimeout,
    clearTimeout,
    Object,
    Array,
    String,
    Number,
    Math,
    JSON,
  };
  ctx.window.AppliqueiInsightsUI = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/appliquei-insights-ui.js'), 'utf8'), ctx, {
    filename: 'web/appliquei-insights-ui.js',
  });
  return { ctx, els, acrescenta: (sug) => vm.runInContext('insightsSugestaoAcrescenta', ctx)(sug) };
}

const SUG = { categoria: 'despesa_variavel', categoriaDespesa: 'mercado' };

test('formulário limpo: a sugestão é toda ela nova', () => {
  assert.equal(montarTela('', '').acrescenta(SUG), true);
});

test('chip tocado antes de digitar não cala a sugestão', () => {
  // ESTE é o defeito relatado. selecionarChipTipo('saida') grava
  // 'despesa_variavel' em categoriaTransacao; a categoria de despesa continua
  // vazia, e é ela que a sugestão tem a oferecer.
  assert.equal(
    montarTela('despesa_variavel', '').acrescenta(SUG),
    true,
    'tocar no chip antes da descrição desligava a sugestão para o resto do lançamento'
  );
});

test('a sugestão cala quando os dois campos já batem', () => {
  // O objetivo original da guarda, preservado: sem nada a acrescentar, não
  // ocupa espaço na tela.
  assert.equal(montarTela('despesa_variavel', 'mercado').acrescenta(SUG), false);
});

test('discordar do que está preenchido é justamente quando ela vale mais', () => {
  // Tocou "Saída", mas o histórico diz que isso é despesa fixa.
  assert.equal(
    montarTela('despesa_variavel', 'mercado').acrescenta({
      categoria: 'despesa_fixa',
      categoriaDespesa: 'moradia',
    }),
    true
  );
  // Mesma classificação grossa, categoria de despesa diferente.
  assert.equal(montarTela('despesa_variavel', 'lazer').acrescenta(SUG), true);
});

test('sem categoria de despesa a oferecer, concordar é calar', () => {
  assert.equal(
    montarTela('despesa_variavel', '').acrescenta({
      categoria: 'despesa_variavel',
      categoriaDespesa: null,
    }),
    false,
    'repetir o que o chip já disse não é sugestão, é ruído'
  );
});

test('a guarda antiga não pode voltar', () => {
  const fonte = fs
    .readFileSync(path.join(ROOT, 'web/appliquei-insights-ui.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/if\s*\(\s*selCat\s*&&\s*selCat\.value\s*\)\s*return/.test(fonte),
    'a guarda cega por "tem valor" voltou — ela desliga a sugestão no chip'
  );
  assert.match(fonte, /insightsSugestaoAcrescenta\(sug\)/, 'a decisão tem de olhar a sugestão');
});
