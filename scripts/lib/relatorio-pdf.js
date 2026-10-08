'use strict';

// O Relatório Mensal em PDF, gerado fora do navegador — o MESMO do app.
//
// Não há cópia de regra aqui. O app abre numa sandbox (app-sandbox.js) com os
// dados sincronizados do usuário no localStorage, exatamente como o navegador
// dele abre, e quem monta o documento é a função do próprio app,
// rmDocumentoImprimivel (web/appliquei-relatorio-mensal.js) — a mesma que o
// botão "Exportar PDF" manda para a impressão. A impressão é a de um Chromium
// de verdade (Playwright), o mesmo motor do "Salvar como PDF" do navegador.
//
// Duas coisas que o app faz ao abrir e que o relatório usa também acontecem
// aqui, pelas funções do app:
//   - os lançamentos do Telegram ainda na caixa de entrada são aplicados
//     (telegramAplicarItens) — sem gravar nada de volta;
//   - os dividendos são buscados na mesma fonte (carregarDividendos → brapi,
//     Yahoo de reserva), porque o app não os guarda.

const { carregarApp } = require('./app-sandbox');

// Os scripts que o relatório consome, na ordem do Appliquei_v13.0.html
// (a ordem importa: classic scripts compartilham estado por window).
const ORDEM_RELATORIO = [
  'web/appliquei-utils.js',
  'web/appliquei-yahoo-finance.js',
  'web/appliquei-app.js',
  'web/appliquei-combobox.js',
  'web/appliquei-contas.js',
  'web/appliquei-aba1-charts.js',
  'web/appliquei-renda-fixa.js',
  'web/appliquei-previdencia.js',
  'web/appliquei-aba-dividendos.js',
  'web/appliquei-aba-controle-financeiro.js',
  'web/appliquei-relatorio-mensal.js',
  'web/appliquei-bens.js',
  'web/appliquei-patrimonio.js',
  'web/appliquei-jornada-conteudo.js',
  'web/appliquei-jornada.js',
  'web/appliquei-sonhos.js',
  'web/appliquei-telegram.js',
];

const RE_YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIVIDENDOS_PRAZO_MS = 25000;

/**
 * O HTML do relatório, como o app o manda imprimir.
 *
 * @param {object}   o
 * @param {object}   o.chaves     chaves sincronizadas do usuário ({chave: string JSON})
 * @param {string}   o.ym         'aaaa-mm'
 * @param {object[]} [o.inbox]    itens da caixa de entrada do Telegram
 * @param {Function} [o.fetch]    fetch para os dividendos (sem ele: dividendos 0)
 * @param {number}   [o.prazoDividendosMs]
 * @returns {Promise<{html: string, aplicados: number, dividendos: boolean}>}
 */
async function documentoDoRelatorio(o) {
  if (!RE_YM.test(String(o.ym || ''))) throw new Error('mes_invalido');
  const w = carregarApp({}, ORDEM_RELATORIO, {
    storage: o.chaves || {},
    fetch: o.fetch,
    manterEstado: true,
    // O que a busca de dividendos do app usa do navegador (prazo da requisição,
    // e a animação de valores que o carregamento dispara).
    globais: { AbortController, AbortSignal, performance },
  });

  let aplicados = 0;
  const itens = (o.inbox || []).filter((i) => i && i.id);
  if (itens.length && typeof w.telegramAplicarItens === 'function') {
    const r = w.telegramAplicarItens(itens);
    aplicados = (r && (r.lancados || 0) + (r.pagos || 0) + (r.desfeitos || 0)) || 0;
  }

  // Dividendos: o app busca ao abrir. Com prazo — uma fonte lenta não pode
  // segurar o relatório; sem eles o KPI sai R$ 0,00, como no app offline.
  let dividendos = false;
  if (o.fetch && typeof w.carregarDividendos === 'function') {
    try {
      await Promise.race([
        w.carregarDividendos(),
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error('prazo')),
            o.prazoDividendosMs || DIVIDENDOS_PRAZO_MS
          ).unref()
        ),
      ]);
      dividendos = true;
    } catch (_) {
      dividendos = false;
    }
  }

  return { html: w.rmDocumentoImprimivel(o.ym), aplicados, dividendos };
}

/**
 * Imprime o HTML num Chromium, como o "Salvar como PDF" do navegador:
 * o @page do documento manda (A4, margens) e as cores de fundo saem.
 *
 * @param {string} html
 * @param {object} [opcoes]
 * @param {string} [opcoes.executablePath]  Chromium já instalado (ex.: /opt/pw-browsers/chromium)
 * @returns {Promise<Buffer>}
 */
async function imprimirPdf(html, opcoes) {
  opcoes = opcoes || {};
  // Carregado só aqui: o Playwright é dependência de desenvolvimento e só
  // existe onde o PDF é gerado (o workflow do GitHub Actions). É o pacote
  // declarado no package.json (@playwright/test), que exporta o chromium.
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch(
    opcoes.executablePath ? { executablePath: opcoes.executablePath } : {}
  );
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}

module.exports = { documentoDoRelatorio, imprimirPdf, ORDEM_RELATORIO, RE_YM };
