'use strict';

// O Relatório Mensal gerado fora do navegador (scripts/lib/relatorio-pdf.js).
//
// O que importa provar: o documento é o do APP — mesma função, mesmos dados —
// e o gerador só acrescenta o que o app faz ao abrir (aplicar a caixa de
// entrada do Telegram, buscar dividendos). A impressão em PDF (Chromium) é
// provada em e2e/relatorio-pdf.spec.js, onde o navegador existe.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const G = require(path.join(ROOT, 'scripts/lib/relatorio-pdf.js'));
const { carregarApp } = require(path.join(ROOT, 'scripts/lib/app-sandbox.js'));
const { criarMundo } = require('./_simulador.js');

const HOJE = new Date();
const YM = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}`;
const HOJE_YMD = `${YM}-${String(HOJE.getDate()).padStart(2, '0')}`;

// As chaves sincronizadas de um usuário com dado em todas as telas — o que o
// servidor lê de users/{uid}/data/main.
function chavesDoMundo() {
  const { s, ref } = criarMundo();
  s.salvarTransacoes();
  s.salvarSonhos();
  s.salvarContas();
  s.localStorage.setItem('futurorico_compras', JSON.stringify(s.historicoCompras));
  s.localStorage.setItem('appliquei_bens', JSON.stringify(s.bens));
  const chaves = {};
  for (let i = 0; i < s.localStorage.length; i++) {
    const k = s.localStorage.key(i);
    chaves[k] = s.localStorage.getItem(k);
  }
  return { chaves, ref };
}

function kpi(html, rotulo) {
  const m = new RegExp(`${rotulo}</div><div class="k-val"[^>]*>([^<]*)<`).exec(html);
  return m ? m[1].replace(/\s/g, ' ') : null;
}

test('o documento é o que o app manda imprimir: rmDocumentoImprimivel do mês', async () => {
  const { chaves } = chavesDoMundo();
  const r = await G.documentoDoRelatorio({ chaves, ym: YM });
  // A mesma função, num app aberto com os mesmos dados.
  const app = carregarApp({}, G.ORDEM_RELATORIO, { storage: chaves, manterEstado: true });
  assert.equal(r.html, app.rmDocumentoImprimivel(YM));
  assert.match(r.html, /@page \{ size: A4 portrait; margin: 14mm 12mm; \}/);
  assert.match(r.html, /<h1>Relatório Mensal<\/h1>/);
  assert.match(r.html, /Para onde foi o dinheiro/);
  assert.match(r.html, /Termômetro financeiro/);
  assert.equal(kpi(r.html, 'Entradas'), 'R$ 8.000,00');
});

test('o botão Exportar PDF do app imprime o mesmo documento (rmDocumentoImprimivel)', () => {
  const { chaves } = chavesDoMundo();
  const app = carregarApp({}, G.ORDEM_RELATORIO, { storage: chaves, manterEstado: true });
  const doc = app.rmDocumentoImprimivel(YM);
  assert.ok(doc.includes(app.rmConstruirRelatorioImprimivel(YM)));
  assert.match(String(app.rmExportarPDF), /rmDocumentoImprimivel\(ym\)/);
});

test('lançamento do Telegram ainda na caixa de entrada entra no relatório, como o app faria', async () => {
  const { chaves, ref } = chavesDoMundo();
  const sem = await G.documentoDoRelatorio({ chaves, ym: YM });
  const com = await G.documentoDoRelatorio({
    chaves,
    ym: YM,
    inbox: [
      {
        id: 'tg77_1',
        tipo: 'lancamento',
        criadoEmMs: 1,
        lanc: {
          categoria: 'despesa_variavel',
          valor: 123,
          descricao: 'Telegram',
          dataCompra: HOJE_YMD,
          contaId: ref.nubank.id,
          banco: 'Nubank',
        },
      },
    ],
  });
  assert.equal(com.aplicados, 1);
  const n = (s) => Number(s.replace(/[^\d,]/g, '').replace(',', '.'));
  assert.equal(
    n(kpi(com.html, 'Despesas de consumo')) - n(kpi(sem.html, 'Despesas de consumo')),
    123
  );
});

test('dividendos: busca pela função do app (brapi), com prazo; sem rede o relatório sai igual', async () => {
  const { chaves } = chavesDoMundo();
  const urls = [];
  const r = await G.documentoDoRelatorio({
    chaves,
    ym: YM,
    fetch: async (u) => {
      urls.push(String(u));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ dividendsHistory: { cashDividends: [] } }] }),
      };
    },
  });
  assert.equal(r.dividendos, true);
  assert.ok(urls.some((u) => u.startsWith('https://brapi.dev/api/quote/PETR4')));

  // Fonte pendurada: o prazo vence e o relatório sai mesmo assim.
  const lento = await G.documentoDoRelatorio({
    chaves,
    ym: YM,
    fetch: () => new Promise(() => {}),
    prazoDividendosMs: 50,
  });
  assert.equal(lento.dividendos, false);
  assert.match(lento.html, /Relatório Mensal/);
});

test('mês inválido é recusado', async () => {
  await assert.rejects(G.documentoDoRelatorio({ chaves: {}, ym: '2026-13' }), /mes_invalido/);
  await assert.rejects(G.documentoDoRelatorio({ chaves: {}, ym: '../x' }), /mes_invalido/);
});

test('abrir o app na sandbox não contamina o Node (setItem no Object.prototype)', async () => {
  await G.documentoDoRelatorio({ chaves: chavesDoMundo().chaves, ym: YM });
  assert.equal({}.setItem, undefined);
  assert.equal({}.removeItem, undefined);
});
