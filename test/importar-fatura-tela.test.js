'use strict';

// Importar fatura — a TELA (appliquei-importar-fatura-ui.js) rodando no app de
// verdade (sandbox), e o service worker do "Compartilhar" do Android.
//
// O que a revisão de UX pediu e estes testes travam:
//   1. a "parecida" decide entre "é a mesma compra" (o valor do app vira o do
//      banco e a fatura fecha) e "compras diferentes" (importa as duas);
//   2. a compra estornada que estava no app sai junto ("apagar") — e o
//      Desfazer devolve no mesmo lugar;
//   3. o Desfazer continua na tela da fatura enquanto nada foi pago;
//   4. o botão diz quantas parcelas vão para as próximas faturas;
//   5. o service worker só trata o POST do compartilhamento, guarda o arquivo
//      e abre o app na importação — o resto passa direto.

const test = require('node:test');
const assert = require('node:assert');
const { carregarApp, ORDEM_CONTROLE } = require('./_harness-integracao.js');

const ORDEM = ORDEM_CONTROLE.concat([
  'web/appliquei-insights.js',
  'web/appliquei-faturas.js',
  'web/appliquei-categorias-palavras.js',
  'web/appliquei-importar-fatura.js',
  'web/appliquei-importar-fatura-ui.js',
]);
const VENC = '2026-11-05';
const CARTAO = 'card_nu';

function app() {
  const win = carregarApp({}, ORDEM, { globais: { TextDecoder } });
  win.contas.push({ id: 'c_nu', nome: 'Nubank', tipo: 'banco' });
  win.cartoes.length = 0;
  win.cartoes.push({ id: CARTAO, nome: 'Nubank', diaVencimento: 5, contaPagadoraId: 'c_nu' });
  win.transacoes.length = 0;
  return win;
}

function tx(id, descricao, valor, extra) {
  return Object.assign(
    {
      id,
      descricao,
      valor,
      categoria: 'cartao_credito',
      cartaoId: CARTAO,
      dataVencimento: VENC,
      mes: 10,
      ano: 2026,
      pago: false,
      obs: '',
    },
    extra
  );
}

function revisar(win, csv) {
  win.impfatUi.cartaoId = CARTAO;
  win.impfatUi.passo = 'revisao';
  win.impfatUiProcessarBytes(
    new TextEncoder().encode('date,title,amount\n' + csv),
    'Nubank_' + VENC + '.csv'
  );
  return win.impfatUi.plano;
}

const item = (plano, trecho) => plano.itens.find((it) => it.titulo.indexOf(trecho) !== -1);
const totalFatura = (win) =>
  Math.round(
    win.transacoes.filter((t) => t.dataVencimento === VENC).reduce((s, t) => s + t.valor, 0) * 100
  ) / 100;

test('parecida, "é a mesma compra": o valor do app vira o do banco e a fatura fecha', () => {
  const win = app();
  win.transacoes.push(tx('tg1', 'pão doce', 18));
  const p = revisar(win, '2026-10-26,Padaria Sol Nascente,18.37\n2026-10-20,Livraria,40.00\n');
  assert.equal(item(p, 'Padaria').escolha, 'mesma');
  win.impfatUiConfirmar();
  assert.equal(win.transacoes.find((t) => t.id === 'tg1').valor, 18.37);
  assert.equal(totalFatura(win), 58.37, 'igual à do banco');
  assert.equal(win.impfatUi.resultado.totalApp, win.impfatUi.resultado.totalBanco);
});

test('parecida, "compras diferentes": importa esta também e o app mantém a sua', () => {
  const win = app();
  win.transacoes.push(tx('tg1', 'pão doce', 18));
  const p = revisar(win, '2026-10-26,Padaria Sol Nascente,18.37\n');
  win.impfatUiEscolha(item(p, 'Padaria').ref, 'diferente');
  win.impfatUiConfirmar();
  assert.equal(win.transacoes.find((t) => t.id === 'tg1').valor, 18);
  assert.equal(win.transacoes.filter((t) => t.dataVencimento === VENC).length, 2);
});

test('estornada no banco: "apagar" tira do app, e o Desfazer devolve no mesmo lugar', () => {
  const win = app();
  win.transacoes.push(tx('a', 'antes', 5), tx('ac', 'academia', 75), tx('b', 'depois', 7));
  const antes = JSON.stringify(win.transacoes);
  const p = revisar(
    win,
    '2026-10-02,Academia Forma,75.30\n2026-10-05,"Estorno de ""Academia Forma""",-75.30\n2026-10-06,Livraria,40\n'
  );
  assert.equal(item(p, 'Academia Forma').escolha, 'apagar');
  win.impfatUiConfirmar();
  assert.ok(!win.transacoes.some((t) => t.id === 'ac'), 'saiu do app');
  assert.equal(win.impfatUi.resultado.ajustes, 1);
  win.impfatUiDesfazer();
  assert.equal(JSON.stringify(win.transacoes), antes, 'tudo como era, na mesma ordem');
});

test('o Desfazer fica na tela da fatura até alguém pagar', () => {
  const win = app();
  revisar(win, '2026-10-20,Livraria,40.00\n2026-10-21,Cinema,30.00\n');
  win.impfatUiConfirmar();
  const reg = win.impfatUi.registro;
  let html = win.impfatHtmlLinhaImportada(CARTAO, VENC);
  assert.match(html, /Importada do arquivo/);
  // Pede confirmação na própria linha antes de desfazer.
  win.impfatUiPedirDesfazer(reg.id);
  html = win.impfatHtmlLinhaImportada(CARTAO, VENC);
  assert.match(html, /Apagar os 2 lançamento/);
  win.impfatUiDesfazerDaFatura(reg.id);
  assert.equal(win.transacoes.length, 0);
  assert.equal(win.impfatHtmlLinhaImportada(CARTAO, VENC), '');

  // Paga: o Desfazer some (a baixa já mexeu no caixa).
  revisar(win, '2026-10-20,Livraria,40.00\n');
  win.impfatUiConfirmar();
  win.transacoes.forEach((t) => (t.pago = true));
  assert.equal(win.impfatHtmlLinhaImportada(CARTAO, VENC), '');
});

test('o rodapé diz as parcelas futuras e até quando', () => {
  const win = app();
  const p = revisar(win, '2026-10-02,TV Loja - Parcela 1/4,250.00\n2026-10-03,Pão,10\n');
  const r = win.AppliqueiImportarFatura.resumo(p);
  assert.equal(r.qtdNovas, 2);
  assert.equal(r.parcelasFuturas, 3);
  assert.equal(r.ateVencimento, '2027-02-05');
  win._impRenderRodape();
  win.impfatUiConfirmar();
  assert.equal(win.impfatUi.resultado.futuras, 3);
  assert.equal(win.impfatUi.resultado.ate, '2027-02-05');
});

test('nada a mudar: o botão de importar fica desligado', () => {
  const win = app();
  win.transacoes.push(tx('x', 'livraria', 40));
  const p = revisar(win, '2026-10-20,Livraria,40.00\n');
  assert.equal(win._impMexe(p), false);
  win.impfatUiConfirmar();
  assert.equal(win.impfatUi.passo, 'revisao', 'não "importou" nada');
});

test('instruções completas só na primeira vez; depois, recolhidas', () => {
  const win = app();
  assert.match(win._impHtmlInicio(), /class="imp-como"/);
  assert.doesNotMatch(win._impHtmlInicio(), /imp-como-recolhido/);
  revisar(win, '2026-10-20,Livraria,40.00\n');
  win.impfatUiConfirmar();
  assert.match(win._impHtmlInicio(), /imp-como-recolhido/);
});

// ── Service worker do "Compartilhar" ───────────────────────────────────────

function carregarSw() {
  const ouvintes = {};
  const guardado = {};
  const self = {
    addEventListener: (nome, fn) => (ouvintes[nome] = fn),
    skipWaiting() {},
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: async () => ({
      put: async (url, resp) => {
        guardado[url] = {
          nome: resp.headers.get('X-Nome-Arquivo'),
          bytes: new Uint8Array(await resp.arrayBuffer()),
        };
      },
    }),
  };
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'web', 'sw-compartilhar.js'), 'utf8');
  vm.runInNewContext(codigo, { self, caches, Response, URL, module: undefined });
  return { ouvintes, guardado };
}

test('service worker: guarda o arquivo compartilhado e abre o app na importação', async () => {
  const { ouvintes, guardado } = carregarSw();
  const form = new FormData();
  form.append(
    'fatura',
    new File(['date,title,amount\n2026-10-20,Livraria,40.00\n'], 'Nubank_2026-11-05.csv')
  );
  const req = new Request('https://app.exemplo/web/compartilhar-fatura', {
    method: 'POST',
    body: form,
  });
  let resposta = null;
  ouvintes.fetch({ request: req, respondWith: (p) => (resposta = p) });
  const r = await resposta;
  assert.equal(r.status, 303);
  assert.match(r.headers.get('Location'), /\/app\?importar=compartilhado$/);
  const g = guardado['/web/fatura-compartilhada'];
  assert.equal(decodeURIComponent(g.nome), 'Nubank_2026-11-05.csv');
  assert.match(new TextDecoder().decode(g.bytes), /Livraria/);
});

test('service worker: qualquer outra requisição passa direto (nada de cache do app)', () => {
  const { ouvintes } = carregarSw();
  for (const req of [
    new Request('https://app.exemplo/app'),
    new Request('https://app.exemplo/web/appliquei-app.js'),
    new Request('https://app.exemplo/web/compartilhar-fatura'), // GET
  ]) {
    let tocou = false;
    ouvintes.fetch({ request: req, respondWith: () => (tocou = true) });
    assert.equal(tocou, false, req.method + ' ' + req.url);
  }
});
