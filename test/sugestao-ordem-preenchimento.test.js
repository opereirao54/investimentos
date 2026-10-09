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
 *
 * ═══ SÓ A CATEGORIA, NUNCA O TIPO ═══
 *
 * Relato: "diversos" sugeriu "Cartão de crédito · Diversos"; o "Usar" trocou
 * o tipo para cartão, a data virou o vencimento da fatura (mês que vem), a
 * pessoa voltou para despesa, lançou sem ver a data e não achou mais o
 * lançamento. A sugestão agora só propõe a categoria de despesa, e o "Usar"
 * só preenche esse campo. Ver também test/sugestao-so-categoria.test.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const M = require('../web/appliquei-insights.js');

const OPCOES = ['', 'mercado', 'moradia', 'lazer', 'diversos'].map((value) => ({ value }));

/** Formulário mínimo: os dois selects que decidem a guarda. */
function montarTela(contabil, fina) {
  const els = {
    categoriaTransacao: { value: contabil || '' },
    categoriaDespesa: { value: fina || '', options: OPCOES },
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
  return {
    ctx,
    els,
    acrescenta: (sug) => vm.runInContext('insightsSugestaoAcrescenta', ctx)(sug),
    usar: (sug) => {
      vm.runInContext('insightsSugestaoAtual = ' + JSON.stringify(sug), ctx);
      vm.runInContext('insightsSugestaoUsar()', ctx);
    },
  };
}

const SUG = { categoria: 'despesa_variavel', categoriaDespesa: 'mercado' };

test('formulário sem tipo escolhido: não sugere (o tipo é de quem lança)', () => {
  // Sem tipo, o campo de categoria nem aparece; sugerir aqui era o caminho
  // que levava o "Usar" a escolher o tipo pela pessoa.
  assert.equal(montarTela('', '').acrescenta(SUG), false);
});

test('chip tocado antes de digitar não cala a sugestão', () => {
  // O defeito antigo: selecionarChipTipo('saida') grava 'despesa_variavel' em
  // categoriaTransacao; a categoria de despesa continua vazia, e é ela que a
  // sugestão tem a oferecer.
  assert.equal(
    montarTela('despesa_variavel', '').acrescenta(SUG),
    true,
    'tocar no chip antes da descrição desligava a sugestão para o resto do lançamento'
  );
});

test('a sugestão cala quando a categoria já é a sugerida', () => {
  assert.equal(montarTela('despesa_variavel', 'mercado').acrescenta(SUG), false);
});

test('o tipo do histórico não importa: só a categoria', () => {
  // O histórico diz cartão; a pessoa escolheu Saída hoje. A sugestão vale
  // (pela categoria) e não discute o tipo.
  const sug = { categoria: 'cartao_credito', categoriaDespesa: 'diversos' };
  assert.equal(montarTela('despesa_variavel', '').acrescenta(sug), true);
  // E o contrário também.
  assert.equal(montarTela('cartao_credito', '').acrescenta(SUG), true);
  // Mesmo tipo, categoria igual: nada a dizer, ainda que o tipo do histórico
  // seja outro.
  assert.equal(
    montarTela('despesa_fixa', 'mercado').acrescenta({
      categoria: 'despesa_variavel',
      categoriaDespesa: 'mercado',
    }),
    false
  );
});

test('entrada não tem categoria de despesa: não sugere', () => {
  assert.equal(montarTela('receita', '').acrescenta(SUG), false);
});

test('sem categoria de despesa a oferecer, não há sugestão', () => {
  assert.equal(
    montarTela('despesa_variavel', '').acrescenta({
      categoria: 'despesa_fixa',
      categoriaDespesa: null,
    }),
    false,
    'sugerir só o tipo é justamente o que não se faz mais'
  );
});

test('categoria que não existe mais no select não é sugerida', () => {
  assert.equal(
    montarTela('despesa_variavel', '').acrescenta({
      categoria: 'despesa_variavel',
      categoriaDespesa: 'apagada',
    }),
    false
  );
});

test('"Usar" preenche só a categoria — tipo e data ficam como estão', () => {
  const t = montarTela('despesa_variavel', '');
  t.els.dataVencimento = { value: '2026-10-08' };
  // Nem o chip nem a regra do cartão podem ser chamados.
  t.ctx.selecionarChipTipo = () => assert.fail('o "Usar" trocou o tipo');
  t.ctx.verificarRegraCartao = () => assert.fail('o "Usar" mexeu na regra do cartão');
  t.usar({ categoria: 'cartao_credito', categoriaDespesa: 'diversos' });
  assert.equal(t.els.categoriaDespesa.value, 'diversos');
  assert.equal(t.els.categoriaTransacao.value, 'despesa_variavel', 'o tipo não muda');
  assert.equal(t.els.dataVencimento.value, '2026-10-08', 'a data não muda');
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
