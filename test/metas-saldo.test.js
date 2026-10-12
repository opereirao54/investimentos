'use strict';

// Metas de saldo (Configurações → Metas de saldo).
//
// Defeito que estas travas seguram: no celular a pessoa digita a meta e volta
// ("‹ Configurações") ou fecha — como em qualquer app — e a meta "não ficava
// salva": só o botão "Salvar metas" gravava, e sair descartava o digitado. E o
// Controle lia o CAMPO da tela, não o valor salvo, então a meta salva era
// ignorada sempre que o campo não tivesse sido preenchido no carregamento.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'web/appliquei-app.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'web/appliquei-utils.js'), 'utf8');

/** Recorta uma função de topo do arquivo pelo nome (até a próxima `function` de topo). */
function recortar(src, nome) {
  const re = new RegExp('^(?:        )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, 'função ausente: ' + nome);
  const resto = src.slice(m.index + 1);
  const prox = resto.search(/\n(?:        )?(?:function |var |\/\/ ---)/);
  return src.slice(m.index, m.index + 1 + (prox === -1 ? resto.length : prox));
}

function montar(salvoInicial) {
  const store = new Map(Object.entries(salvoInicial || {}));
  const campos = { metaVerde: { value: '' }, metaVermelha: { value: '' } };
  const toasts = [];
  let telaAtualizada = 0;
  const ctx = vm.createContext({
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    document: { getElementById: (id) => campos[id] || null },
    mostrarToast: (m) => toasts.push(m),
    atualizarTelaControle: () => telaAtualizada++,
    _cfgCelular: () => false,
    cfgAbrirPainel: () => {},
    Number,
    Date,
    String,
  });
  const fontes = [
    recortar(UTILS, 'parseBRL'),
    recortar(UTILS, 'formatarBRLInput'),
    recortar(UTILS, 'setValorBRLInput'),
    recortar(APP, 'obterMetas'),
    recortar(APP, '_cfgMetasDigitadas'),
    recortar(APP, '_cfgMetasMudaram'),
    'var _cfgMetasSalvasEm = 0;',
    recortar(APP, 'cfgSalvarMetasAuto'),
    recortar(APP, 'salvarMetasEAtualizar'),
    recortar(APP, 'carregarMetas'),
  ];
  vm.runInContext(fontes.join('\n'), ctx);
  return { ctx, store, campos, toasts, telaAtualizada: () => telaAtualizada };
}

test('sem nada salvo, as metas são o padrão 3.000 / 1.000', () => {
  const { ctx } = montar();
  assert.equal(JSON.stringify(ctx.obterMetas()), '{"verde":3000,"vermelha":1000}');
});

test('digitar e sair (voltar/fechar) salva as duas metas', () => {
  const { ctx, store, campos, toasts } = montar();
  campos.metaVerde.value = '7.200,00';
  campos.metaVermelha.value = '2.100,00';
  assert.equal(ctx.cfgSalvarMetasAuto(), true);
  assert.equal(store.get('futurorico_metaVerde'), '7200');
  assert.equal(store.get('futurorico_metaVermelha'), '2100');
  assert.equal(JSON.stringify(ctx.obterMetas()), '{"verde":7200,"vermelha":2100}');
  assert.equal(toasts.length, 1, 'a pessoa vê que salvou');
});

test('sair sem mudar nada não grava nem avisa', () => {
  const { ctx, store, campos, toasts } = montar({ futurorico_metaVerde: '5000' });
  ctx.carregarMetas();
  assert.equal(campos.metaVerde.value, '5.000,00');
  assert.equal(ctx.cfgSalvarMetasAuto(), false);
  assert.equal(toasts.length, 0);
  assert.equal(store.get('futurorico_metaVerde'), '5000');
});

test('campo apagado não zera a meta salva', () => {
  const { ctx, store, campos } = montar({
    futurorico_metaVerde: '5000',
    futurorico_metaVermelha: '1500',
  });
  campos.metaVerde.value = '';
  campos.metaVermelha.value = '1.800,00';
  ctx.cfgSalvarMetasAuto();
  assert.equal(store.get('futurorico_metaVerde'), '5000', 'vazio mantém a anterior');
  assert.equal(store.get('futurorico_metaVermelha'), '1800');
  assert.equal(campos.metaVerde.value, '5.000,00', 'o campo volta a mostrar o salvo');
});

test('valor salvo inválido cai no padrão em vez de virar meta zero', () => {
  const { ctx } = montar({ futurorico_metaVerde: 'abc', futurorico_metaVermelha: '0' });
  assert.equal(JSON.stringify(ctx.obterMetas()), '{"verde":3000,"vermelha":1000}');
});

test('fechar e voltar salvam; o Controle lê o valor salvo, não o campo', () => {
  const fechar = recortar(APP, 'fecharModalConfig');
  assert.match(fechar, /cfgSalvarMetasAuto\(\)/, 'fechar salva as metas');
  assert.ok(
    fechar.indexOf('cfgSalvarMetasAuto') < fechar.indexOf("style.display = 'none'"),
    'salva antes de esconder'
  );
  assert.match(recortar(APP, 'cfgVoltarLista'), /cfgSalvarMetasAuto\(\)/, 'voltar salva');
  assert.match(recortar(APP, 'abrirModalConfig'), /carregarMetas\(\)/, 'abrir mostra o salvo');
  const ctrl = fs.readFileSync(path.join(ROOT, 'web/appliquei-aba-controle-financeiro.js'), 'utf8');
  assert.match(ctrl, /obterMetas\(\)/);
  assert.doesNotMatch(ctrl, /getElementById\('metaVerde'\)\.value/);
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  assert.match(html, /id="metaVerde"[^>]*onchange="cfgSalvarMetasAuto\(\)"/);
  assert.match(html, /id="metaVermelha"[^>]*onchange="cfgSalvarMetasAuto\(\)"/);
});
