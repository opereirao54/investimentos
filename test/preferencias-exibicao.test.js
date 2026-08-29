'use strict';

// Tema e olho — as duas preferências de exibição da barra superior.
//
// O tema não gravava nada: quem escolhia o escuro reabria o app no claro toda
// vez. E as duas eram aplicadas por app.js, que é o ÚLTIMO <script> da página —
// a tela pintava inteira no claro (ou com os valores à mostra) e só depois se
// corrigia. Quem fecha o olho justamente para o vizinho não ver os números,
// via os números.
//
// A aplicação mudou para um bloco inline no topo do <body>, antes de qualquer
// conteúdo. app.js só sincroniza os ícones. Estes testes travam as duas pontas:
// a gravação (JS) e o momento da aplicação (HTML).

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');

test('a escolha de tema é gravada', () => {
  assert.match(
    APP,
    /localStorage\.setItem\(\s*'appliquei_tema'/,
    'toggleDarkMode precisa gravar a escolha — sem isto o tema morre no reload'
  );
});

test('o bloco que aplica as preferências roda ANTES do conteúdo', () => {
  const iniBody = HTML.indexOf('<body');
  const fimBody = HTML.indexOf('>', iniBody) + 1;
  // Primeiros 2 KB depois da abertura do <body>: qualquer coisa mais para
  // baixo já pinta antes.
  const topo = HTML.slice(fimBody, fimBody + 2000);
  assert.match(topo, /appliquei_tema/, 'o tema tem de ser aplicado no topo do body');
  assert.match(
    topo,
    /appliquei_valores_ocultos/,
    'o olho tem de ser aplicado no topo do body — senão os valores piscam à mostra'
  );
  assert.match(topo, /classList\.add\('dark'\)/);
  assert.match(topo, /classList\.add\('valores-ocultos'\)/);
});

test('o bloco de pré-pintura tolera localStorage bloqueado', () => {
  // Modo privativo e navegadores com cookies desligados lançam ao ler
  // localStorage. Sem try/catch aqui, a exceção acontece antes de TODO o
  // resto da página — o app não abre.
  const iniBody = HTML.indexOf('<body');
  const topo = HTML.slice(iniBody, iniBody + 2000);
  const bloco = topo.slice(topo.indexOf('<script>'), topo.indexOf('</script>'));
  assert.match(bloco, /try\s*\{/, 'o acesso ao localStorage precisa de try/catch');
  assert.match(bloco, /catch/);
});

test('app.js não repinta o tema — só sincroniza os ícones', () => {
  // Se a inicialização voltasse a aplicar a classe, teríamos duas fontes de
  // verdade e o flash de volta.
  assert.match(APP, /function sincronizarIconeTema\(\)/);
  assert.match(
    APP,
    /aplicarEstadoValoresOcultos\(document\.body\.classList\.contains\('valores-ocultos'\)\)/,
    'a inicialização lê a classe que o bloco inline já pôs, não o localStorage de novo'
  );
});

// ---------------------------------------------------------------------------
// O varredor de valores
// ---------------------------------------------------------------------------

// Extrai as funções de marcação de app.js e roda contra um DOM mínimo. Não vale
// simular o app inteiro aqui: o que se quer provar é a REGRA — o que conta como
// dinheiro e qual elemento leva a classe.
function carregarVarredor() {
  const ini = APP.indexOf('var RE_MOEDA');
  const fim = APP.indexOf('function aplicarEstadoValoresOcultos');
  assert.ok(ini > -1 && fim > ini, 'o varredor precisa estar em app.js');
  const trecho = APP.slice(ini, fim);

  // DOM mínimo: só o que o varredor toca (querySelectorAll, childNodes,
  // classList, nodeType, nodeValue).
  function no(texto, filhos) {
    const classes = new Set();
    const n = {
      childNodes: [],
      _filhos: filhos || [],
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
      },
      get classes() {
        return Array.from(classes);
      },
    };
    if (texto != null) n.childNodes.push({ nodeType: 3, nodeValue: texto });
    for (const f of n._filhos) n.childNodes.push(Object.assign({ nodeType: 1 }, f));
    return n;
  }
  const contexto = { MutationObserver: undefined, document: null };
  const fn = new Function(
    'document',
    'MutationObserver',
    trecho + '\nreturn { RE_MOEDA, _marcarValoresVisiveis };'
  );
  return { fn, no, contexto };
}

test('o varredor reconhece dinheiro em português', () => {
  const { fn } = carregarVarredor();
  const { RE_MOEDA } = fn({}, undefined);
  for (const s of [
    'R$ 1.234,56',
    'R$1.234,56',
    'Caixa R$ 43.500,00 · Investido R$ 0,00',
    '(+R$ 33.050,00 do mês anterior)',
    'R$ 0,00',
    '-R$ 3.840,00',
    'até R$ 4.627,00/mês aos seus sonhos',
  ]) {
    assert.ok(RE_MOEDA.test(s), `devia reconhecer dinheiro em: ${s}`);
  }
  for (const s of ['12 unidades', '35%', 'R$', 'Reais', '2026', '1.234']) {
    assert.ok(!RE_MOEDA.test(s), `NÃO devia marcar: ${s}`);
  }
});

test('o varredor marca o MENOR elemento com o texto — não o pai inteiro', () => {
  const { fn, no } = carregarVarredor();
  // Um cartão que contém um rótulo e um valor: só o valor pode borrar; borrar
  // o cartão apagaria o rótulo junto e deixaria a tela ilegível.
  const rotulo = no('Saldo livre');
  const valor = no('R$ 39.660,00');
  const cartao = no(null, []);
  cartao.childNodes.push({ nodeType: 1 }, { nodeType: 1 });
  const todos = [cartao, rotulo, valor];
  const doc = { body: { querySelectorAll: () => todos } };
  const { _marcarValoresVisiveis } = fn(doc, undefined);
  _marcarValoresVisiveis(doc.body);

  assert.deepEqual(valor.classes, ['valor-mascarado'], 'o valor tem de ser marcado');
  assert.deepEqual(rotulo.classes, [], 'o rótulo não');
  assert.deepEqual(cartao.classes, [], 'o cartão que só embrulha, também não');
});

test('o varredor é idempotente — passar duas vezes não muda nada', () => {
  const { fn, no } = carregarVarredor();
  const valor = no('R$ 10,00');
  const doc = { body: { querySelectorAll: () => [valor] } };
  const { _marcarValoresVisiveis } = fn(doc, undefined);
  _marcarValoresVisiveis(doc.body);
  _marcarValoresVisiveis(doc.body);
  assert.deepEqual(valor.classes, ['valor-mascarado']);
});

test('o varredor só liga com o olho fechado', () => {
  // Marcar sempre custaria uma varredura a cada render para quem nunca usa o
  // olho — e é a maioria.
  assert.match(
    APP,
    /if \(oculto\) _ligarVarredorValores\(\);\s*\n\s*else _desligarVarredorValores\(\);/,
    'o observador precisa ser desligado quando o olho abre'
  );
});
