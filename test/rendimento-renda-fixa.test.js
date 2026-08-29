'use strict';

// Motor de rendimento da aba Meus investimentos — e a unidade que o alimenta.
//
// O relato foi "está rendendo muito acima do esperado". A matemática estava
// certa: medida contra juros compostos calculados à mão, a valorização de renda
// fixa e de previdência bate com erro zero em todos os casos deste arquivo.
//
// O que estava errado era a UNIDADE que entrava. O campo da previdência pedia
// "% ao mês" e ninguém conversa rendimento assim — fala-se em % ao ano. Quem
// digitava 8 pensando "8% ao ano" gravava 8% AO MÊS, que é 151,8% ao ano:
//
//     R$ 10.000 · 1 ano  →  R$ 25.181
//     R$ 10.000 · 5 anos →  R$ 1.012.570
//
// Sem teto, sem conversão à vista e sem nenhum lugar na tela que dissesse a
// taxa da posição — não havia como a pessoa descobrir de onde vinha o número.
//
// Este arquivo tem duas metades: a primeira prova a matemática (para que uma
// mudança futura no motor não passe despercebida) e a segunda prova as travas
// de unidade.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./_harness-integracao.js');

const ROOT = path.resolve(__dirname, '..');
const RF = fs.readFileSync(path.join(ROOT, 'web/appliquei-renda-fixa.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

const DIA = 86400000;
const ANO = 365.25;
const atras = (dias) => new Date(Date.now() - dias * DIA).toISOString();

/** Referência: juros compostos, taxa ANUAL efetiva, tempo em dias. */
const compostoAnual = (v, taxaAnual, dias) => v * Math.pow(1 + taxaAnual, dias / ANO);
/** Referência: juros compostos, taxa MENSAL efetiva. */
const compostoMensal = (v, taxaMensal, dias) => v * Math.pow(1 + taxaMensal, dias / 30.4375);

/** Tolerância de um centavo em mil reais — sobra folga para arredondamento. */
function perto(a, b, msg) {
  assert.ok(
    Math.abs(a - b) < Math.max(0.01, Math.abs(b) * 1e-9),
    `${msg}: esperado ${b.toFixed(2)}, veio ${Number(a).toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// A matemática
// ---------------------------------------------------------------------------

function comPosicao(extra) {
  const s = carregarApp({});
  s.historicoCompras.push(
    Object.assign(
      {
        id: 'p1',
        ticker: 'T',
        categoria: 'renda_fixa',
        tipo: 'compra',
        quantidade: 1,
        preco_op: 10000,
      },
      extra
    )
  );
  return s;
}

test('prefixado: 12% a.a. em 1 ano e em 3 anos', () => {
  for (const anos of [1, 3, 10]) {
    const s = comPosicao({ rentabilidade: '12% a.a.', data_op: atras(ANO * anos) });
    perto(
      s.valorAtualRendaFixa('T', 'renda_fixa'),
      compostoAnual(10000, 0.12, ANO * anos),
      `12% a.a. em ${anos} ano(s)`
    );
  }
});

test('percentual de indexador: 110% do CDI', () => {
  const s = comPosicao({ rentabilidade: '110% CDI', data_op: atras(ANO) });
  const cdi = s.taxasMercado.cdi;
  perto(s.valorAtualRendaFixa('T', 'renda_fixa'), compostoAnual(10000, 1.1 * cdi, ANO), '110% CDI');
});

test('indexador + spread: IPCA+6% combina de forma multiplicativa', () => {
  // (1+IPCA)·(1+6%)−1, não IPCA+6 somados: somar subestima o juro real.
  const s = comPosicao({ rentabilidade: 'IPCA+6%', data_op: atras(ANO * 5) });
  const ipca = s.taxasMercado.ipca;
  perto(
    s.valorAtualRendaFixa('T', 'renda_fixa'),
    compostoAnual(10000, (1 + ipca) * 1.06 - 1, ANO * 5),
    'IPCA+6% em 5 anos'
  );
});

test('meio termo: 100% CDI em 6 meses', () => {
  const s = comPosicao({ rentabilidade: '100% CDI', data_op: atras(182.6) });
  perto(
    s.valorAtualRendaFixa('T', 'renda_fixa'),
    compostoAnual(10000, s.taxasMercado.cdi, 182.6),
    '100% CDI em 6 meses'
  );
});

test('sem taxa informada, a posição não rende — não inventa retorno', () => {
  const s = comPosicao({ data_op: atras(ANO * 3) });
  perto(s.valorAtualRendaFixa('T', 'renda_fixa'), 10000, 'sem rentabilidade');
});

test('aporte com data futura não entra na foto de hoje', () => {
  const s = comPosicao({
    rentabilidade: '12% a.a.',
    data_op: new Date(Date.now() + 30 * DIA).toISOString(),
  });
  perto(s.valorAtualRendaFixa('T', 'renda_fixa'), 0, 'aporte programado');
});

test('cadastro retroativo rende desde o CADASTRO, não desde a data antiga', () => {
  // O valor informado num retroativo é o de HOJE. Capitalizar desde 2019
  // inventaria rendimento — foi o defeito que fez R$ 10.000 aparecerem como
  // R$ 20.474.
  const s = comPosicao({
    rentabilidade: '12% a.a.',
    data_op: atras(ANO * 6),
    saldoInicial: true,
    cadastradoEm: new Date().toISOString(),
  });
  perto(s.valorAtualRendaFixa('T', 'renda_fixa'), 10000, 'retroativo cadastrado hoje');
});

test('previdência: taxaMensal é aplicada AO MÊS, com precisão', () => {
  const s = carregarApp({});
  s.historicoCompras.push({
    id: 'pv',
    ticker: 'PREV',
    categoria: 'previdencia',
    tipo: 'compra',
    quantidade: 1,
    preco_op: 10000,
    taxaMensal: 0.008,
    data_op: atras(ANO * 10),
  });
  perto(
    s.calcularSaldoPrevidencia('PREV'),
    compostoMensal(10000, 0.008, ANO * 10),
    '0,8% ao mês por 10 anos'
  );
});

test('previdência: o TEXTO de rentabilidade é anual e tem precedência', () => {
  // taxaMensalOperacao converte o texto (anual) para mensal antes de compor.
  // Sem essa conversão, "12% a.a." seria lido como 12% ao mês.
  const s = carregarApp({});
  s.historicoCompras.push({
    id: 'pv2',
    ticker: 'PREV2',
    categoria: 'previdencia',
    tipo: 'compra',
    quantidade: 1,
    preco_op: 10000,
    taxaMensal: 0.05, // ignorada: o texto vence
    rentabilidade: '12% a.a.',
    data_op: atras(ANO),
  });
  perto(s.calcularSaldoPrevidencia('PREV2'), compostoAnual(10000, 0.12, ANO), 'texto anual vence');
});

// ---------------------------------------------------------------------------
// A unidade
// ---------------------------------------------------------------------------

/** Extrai as funções de taxa sem precisar do app inteiro. */
function carregarTaxa(valorCampo, unidade) {
  const ini = RF.indexOf('var TAXA_MENSAL_ABSURDA');
  const fim = RF.indexOf('function taxaMensalOperacao');
  assert.ok(ini > -1 && fim > ini, 'as funções de taxa precisam estar em renda-fixa.js');
  const doc = {
    getElementById: (id) =>
      id === 'prevTaxaMensal'
        ? { value: valorCampo, style: {}, focus() {} }
        : id === 'prevTaxaUnidade'
          ? { value: unidade }
          : { className: '', innerHTML: '', style: {} },
  };
  return new Function(
    'document',
    'parseBRL',
    RF.slice(ini, fim) +
      '\nreturn { lerTaxaMensalPrevidencia, taxaMensalParaAnual, taxaAnualParaMensal, ' +
      'atualizarEquivalenciaTaxaPrev, TAXA_MENSAL_ABSURDA, TAXA_MENSAL_ALTA };'
  )(doc, (v) => parseFloat(String(v).replace(/\./g, '').replace(',', '.')));
}

test('mensal ↔ anual são inversas exatas', () => {
  const t = carregarTaxa('', 'mes');
  for (const anual of [0.05, 0.08, 0.1, 0.1275, 0.2]) {
    perto(t.taxaMensalParaAnual(t.taxaAnualParaMensal(anual)), anual, `ida e volta de ${anual}`);
  }
  // 0,8% ao mês é ~10,03% ao ano — o número que o app usa como padrão.
  perto(t.taxaMensalParaAnual(0.008), 0.100338, 'equivalência do padrão');
});

test('o campo respeita a unidade escolhida', () => {
  perto(carregarTaxa('0,80', 'mes').lerTaxaMensalPrevidencia(), 0.008, '0,80 ao mês');
  // 8% ao ANO tem de virar 0,6434% ao mês — não 8% ao mês.
  perto(
    carregarTaxa('8', 'ano').lerTaxaMensalPrevidencia(),
    Math.pow(1.08, 1 / 12) - 1,
    '8 ao ano'
  );
  assert.equal(carregarTaxa('', 'mes').lerTaxaMensalPrevidencia(), null, 'vazio devolve null');
  assert.equal(carregarTaxa('0', 'mes').lerTaxaMensalPrevidencia(), null, 'zero devolve null');
});

test('a equivalência classifica a taxa em três faixas', () => {
  const casos = [
    ['0,80', 'mes', '', 'plausível'],
    ['1,20', 'mes', '', 'plausível'],
    ['2', 'mes', 'alta', 'possível mas rara'],
    ['8', 'mes', 'absurda', 'erro de unidade'],
    ['12', 'ano', '', 'anual plausível'],
  ];
  for (const [valor, unidade, esperada, nome] of casos) {
    const t = carregarTaxa(valor, unidade);
    let classe = '';
    const doc = {
      getElementById: (id) =>
        id === 'prevTaxaEquivalente'
          ? {
              set className(v) {
                classe = v;
              },
              get className() {
                return classe;
              },
              innerHTML: '',
            }
          : id === 'prevTaxaMensal'
            ? { value: valor }
            : { value: unidade },
    };
    // Reexecuta com um documento que captura a classe aplicada.
    const ini = RF.indexOf('var TAXA_MENSAL_ABSURDA');
    const fim = RF.indexOf('function taxaMensalOperacao');
    new Function('document', 'parseBRL', RF.slice(ini, fim) + '\natualizarEquivalenciaTaxaPrev();')(
      doc,
      (v) => parseFloat(String(v).replace(',', '.'))
    );
    if (esperada) assert.match(classe, new RegExp(esperada), `${nome}: classe ${classe}`);
    else {
      assert.ok(!/absurda|alta/.test(classe), `${nome} não devia ser marcada: ${classe}`);
      assert.match(classe, /mostrar/, `${nome} devia mostrar a equivalência`);
    }
    void t;
  }
});

test('taxa impossível é barrada no salvamento, não só avisada', () => {
  // O aviso na tela evita o erro de quem lê. A trava evita o de quem não lê.
  assert.match(RF, /var TAXA_MENSAL_ABSURDA = 0\.03;/, '3% ao mês ≈ 42,6% ao ano');
  const i = RF.indexOf("if (categoria === 'previdencia') {\n    const tmCheck");
  assert.ok(i > -1, 'a validação precisa existir em registrarOperacaoAtivo');
  const bloco = RF.slice(i, i + 900);
  assert.match(bloco, /tmCheck > TAXA_MENSAL_ABSURDA/);
  assert.match(bloco, /return mostrarToast\(/, 'e impedir a gravação');
  assert.match(bloco, /impossível para uma previdência/);
});

test('a sugestão repete o número digitado, não um convertido', () => {
  // Quem digitou 8 queria 8% ao ano. Sugerir "0,64%" confundiria — o que muda
  // é a unidade, não o valor.
  const i = RF.indexOf('muito acima de qualquer previdência');
  const bloco = RF.slice(i - 300, i + 300);
  assert.match(bloco, /fmt\(tm\) \+\s*\n?\s*'% ao ano/, 'a frase usa o valor digitado');
  assert.ok(
    !/taxaAnualParaMensal\(tm\)/.test(bloco),
    'converter o número na frase de sugestão confunde'
  );
});

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

test('o campo tem seletor de unidade e área de equivalência', () => {
  assert.match(HTML, /id="prevTaxaUnidade"/);
  assert.match(HTML, /<option value="mes" selected>% ao mês<\/option>/, 'mensal continua o padrão');
  assert.match(HTML, /<option value="ano">% ao ano<\/option>/);
  assert.match(HTML, /id="prevTaxaEquivalente"/);
  assert.match(HTML, /oninput="atualizarEquivalenciaTaxaPrev\(\)"/, 'a conversão é ao vivo');
  assert.match(HTML, /onchange="atualizarEquivalenciaTaxaPrev\(\)"/);
});

test('o rótulo não afirma mais uma unidade que o campo não impõe', () => {
  assert.ok(
    !HTML.includes('Rentabilidade estimada (% ao mês)'),
    'a unidade agora é escolhida no seletor, não fixada no rótulo'
  );
});

test('editar uma posição repõe a unidade em que o dado foi gravado', () => {
  // O dado sempre foi taxa MENSAL. Repor o campo em "ao ano" mostraria 0,80
  // como se fosse 0,8% ao ano — dez vezes menos.
  const i = RF.indexOf('if (inpTaxaMensal) {');
  const bloco = RF.slice(i, i + 700);
  assert.match(bloco, /selUn\.value = 'mes'/);
  assert.match(
    bloco,
    /atualizarEquivalenciaTaxaPrev\(\)/,
    'e mostra a equivalência — é assim que quem cadastrou errado descobre'
  );
});

test('a unidade escolhida não vaza para o cadastro seguinte', () => {
  // O formulário é reaproveitado: quem salvou em "% ao ano" reabre o drawer e
  // encontra o campo vazio. Se a unidade ficasse em "ano", o prefill de 0,80 —
  // que é MENSAL, e é o que o texto de apoio promete — passaria a valer 0,80%
  // ao ano. Doze vezes menos, sem nada denunciando.
  const i = RF.indexOf("if (inpTaxaPrev) inpTaxaPrev.value = '';");
  assert.ok(i > -1, 'a limpeza do campo precisa existir');
  const bloco = RF.slice(i, i + 500);
  assert.match(bloco, /selUnPrev\.value = 'mes'/);
  assert.match(bloco, /atualizarEquivalenciaTaxaPrev\(\)/, 'e o aviso antigo sai da tela junto');
});

test('o prefill de 0,80 já nasce com a equivalência à vista', () => {
  // `inpTaxa.value = '0,80'` é atribuição direta: não dispara `oninput`. Sem
  // esta chamada, a linha "equivale a 10,03% ao ano" só apareceria depois do
  // primeiro toque no campo — justo para quem aceita o padrão e nunca toca.
  const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');
  const i = APP.indexOf("inpTaxa.value = '0,80'");
  assert.ok(i > -1, 'o prefill precisa existir');
  assert.match(APP.slice(i, i + 400), /atualizarEquivalenciaTaxaPrev\(\)/);
});
