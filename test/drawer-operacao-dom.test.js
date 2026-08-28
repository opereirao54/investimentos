'use strict';

// Trava para a classe de bug que quebrou a edição de operação em silêncio.
//
// `alternarTipoOperacao` lia `document.getElementById('painelOperacaoCard')` e
// escrevia direto em `.style`. Esse id ficou para trás quando o formulário de
// operação virou drawer — o elemento não existe mais no HTML. Resultado:
// TypeError na primeira linha do bloco, a função abortava, e como
// `editarOperacao` a chama ANTES de preencher os campos, o drawer abria vazio.
// Foi exatamente o sintoma relatado: "a edição não traz os dados da compra".
//
// Os testes de unidade não pegavam isso porque o DOM falso do harness devolve
// um nó para QUALQUER id. Só o navegador expõe o `null`. Este teste fecha a
// lacuna sem precisar de browser: lê o HTML de verdade e confere que todo id
// que as funções do drawer tocam existe lá.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

// Ids presentes no HTML (atributo id="..." em qualquer elemento).
const IDS_NO_HTML = new Set(Array.from(HTML.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));

// Funções que compõem o fluxo do drawer de operação, com o arquivo onde vivem.
const FUNCOES = [
  ['web/appliquei-app.js', 'alternarTipoOperacao'],
  ['web/appliquei-app.js', 'abrirDrawerOperacao'],
  ['web/appliquei-app.js', 'fecharDrawerOperacao'],
  ['web/appliquei-app.js', 'ajustarCamposPorCategoria'],
  ['web/appliquei-app.js', 'popularOrigemRecurso'],
  ['web/appliquei-app.js', 'popularDestinoRecurso'],
  ['web/appliquei-app.js', 'ajustarOrigemRecursoCampos'],
  ['web/appliquei-app.js', 'preencherPrecoAutomatico'],
  ['web/appliquei-app.js', 'calcularTotalCompra'],
  ['web/appliquei-app.js', 'renderizarCalendarioDia'],
  ['web/appliquei-app.js', 'selecionarDiaRecorrencia'],
  ['web/appliquei-app.js', 'sincronizarRotuloDiaRecorrencia'],
  ['web/appliquei-renda-fixa.js', 'registrarOperacaoAtivo'],
  ['web/appliquei-renda-fixa.js', 'editarOperacao'],
];

// Recorta o corpo de uma função top-level pelo balanço de chaves.
function corpoDaFuncao(fonte, nome) {
  const marca = `function ${nome}(`;
  const ini = fonte.indexOf(marca);
  if (ini === -1) return null;
  const abre = fonte.indexOf('{', ini);
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '{') nivel++;
    else if (fonte[i] === '}') {
      nivel--;
      if (nivel === 0) return fonte.slice(ini, i + 1);
    }
  }
  return null;
}

const fontes = new Map();
function fonteDe(arquivo) {
  if (!fontes.has(arquivo)) fontes.set(arquivo, fs.readFileSync(path.join(ROOT, arquivo), 'utf8'));
  return fontes.get(arquivo);
}

for (const [arquivo, nome] of FUNCOES) {
  test(`${nome}: todo getElementById aponta para um id que existe no HTML`, () => {
    const corpo = corpoDaFuncao(fonteDe(arquivo), nome);
    assert.ok(corpo, `${nome} não encontrada em ${arquivo}`);

    const ids = Array.from(corpo.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g), (m) => m[1]);
    const fantasmas = [...new Set(ids)].filter((id) => !IDS_NO_HTML.has(id));

    assert.deepEqual(
      fantasmas,
      [],
      `${arquivo}:${nome} referencia id que não existe no HTML: ${fantasmas.join(', ')}.\n` +
        `getElementById devolve null e o primeiro acesso a .value/.style lança TypeError, ` +
        `abortando a função no meio — sem erro visível para o usuário. Remova a referência ` +
        `morta ou devolva o elemento ao HTML.`
    );
  });
}

test('os campos que o formulário de operação lê continuam existindo', () => {
  // Lista explícita do contrato do drawer: se um destes sumir do HTML, a
  // gravação da operação quebra em algum ponto do meio do caminho.
  const OBRIGATORIOS = [
    'drawerOperacao',
    'tipoOperacao',
    'compraTicker',
    'compraCategoria',
    'compraSubcategoria',
    'compraQtd',
    'compraPreco',
    'compraData',
    'compraCorretora',
    'compraVencimento',
    'compraRentabilidade',
    'compraOrigemRecurso',
    'compraDestinoRecurso',
    'compraTotalOp',
    'btnConfirmarOp',
    'btnTabCompra',
    'btnTabVenda',
    'prevRecorrente',
    'prevDiaRecorrencia',
    'prevDuracaoAnos',
    'prevTaxaMensal',
    'prevSaldoInicial',
    // Acrescentados junto com o cadastro retroativo e o calendário do dia.
    'dicaOrigemRecurso',
    'avisoEdicaoOperacao',
    'avisoRecorrenciaSemConta',
    'popoverDiaRecorrencia',
    'gradeDiasRecorrencia',
    'rotuloDiaRecorrencia',
    'wrapDiaRecorrencia',
  ];
  const faltando = OBRIGATORIOS.filter((id) => !IDS_NO_HTML.has(id));
  assert.deepEqual(faltando, [], `ids do drawer ausentes no HTML: ${faltando.join(', ')}`);
});

test('"Posição por categoria" saiu da aba Meus investimentos', () => {
  assert.ok(!IDS_NO_HTML.has('quadroCategoriasInferior'), 'o quadro foi removido do HTML');
  assert.ok(!IDS_NO_HTML.has('cardsCategoriaInferior'));
  for (const arquivo of ['web/appliquei-app.js', 'web/appliquei-aba1-charts.js']) {
    assert.ok(
      !/quadroCategoriasInferior|cardsCategoriaInferior|renderizarCardsCategoriaInferior/.test(
        fonteDe(arquivo)
      ),
      `${arquivo} ainda referencia o quadro removido`
    );
  }
});

test('o botão de editar/excluir da timeline passa o id entre aspas', () => {
  // Sem aspas, `editarOperacao(${op.id})` vira um literal numérico. Depois de
  // uma volta pela nuvem o id volta como string e o find por igualdade estrita
  // falha — "Operação não encontrada" ao clicar em editar.
  const fonte = fonteDe('web/appliquei-renda-fixa.js');
  assert.match(fonte, /editarOperacao\('\$\{op\.id\}'\)/, 'editarOperacao com id entre aspas');
  assert.match(fonte, /excluirOperacao\('\$\{op\.id\}'\)/, 'excluirOperacao com id entre aspas');
});
