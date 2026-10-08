'use strict';

// O Relatório Mensal pelo Telegram, impresso de verdade.
//
// O gerador (scripts/lib/relatorio-pdf.js) roda o app numa sandbox e imprime
// o documento que o app manda para a impressão, num Chromium. Este spec roda
// onde o Chromium existe (job e2e do CI) e prova que sai um PDF A4, de uma
// página, e que o texto do relatório está nele — o mesmo que o usuário vê no
// app ao abrir o documento na página.

const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const G = require(path.join(ROOT, 'scripts/lib/relatorio-pdf.js'));

// Fora do CI, um Chromium já instalado pode ser usado (CHROMIUM_PATH) — o
// mesmo parâmetro que o script do workflow aceita.
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
test.use({ launchOptions: LAUNCH });

const HOJE = new Date();
const YM = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}`;

const CHAVES = {
  appliquei_contas: JSON.stringify([
    { id: 'c1', nome: 'Itaú', tipo: 'banco', saldoInicial: 1000, principal: true },
  ]),
  futurorico_transacoes: JSON.stringify([
    {
      id: 't1',
      categoria: 'receita',
      descricao: 'Salário',
      valor: 5000,
      contaId: 'c1',
      banco: 'Itaú',
      mes: HOJE.getMonth(),
      ano: HOJE.getFullYear(),
      data: HOJE.toISOString(),
    },
    {
      id: 't2',
      categoria: 'despesa_variavel',
      descricao: 'Mercado',
      valor: 800,
      contaId: 'c1',
      banco: 'Itaú',
      categoriaDespesa: 'alimentacao',
      mes: HOJE.getMonth(),
      ano: HOJE.getFullYear(),
      data: HOJE.toISOString(),
      pago: true,
    },
  ]),
};

test('o relatório sai em PDF A4 de uma página, com o conteúdo do app', async ({ page }) => {
  const { html } = await G.documentoDoRelatorio({ chaves: CHAVES, ym: YM });
  const pdf = await G.imprimirPdf(html, LAUNCH);

  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  // Uma página, tamanho A4 (595 x 842 pontos).
  const bruto = pdf.toString('latin1');
  expect(bruto.match(/\/Type\s*\/Page(?!s)/g) || []).toHaveLength(1);
  expect(bruto).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+59[45](\.\d+)?\s+84[12](\.\d+)?\s*\]/);

  // O mesmo documento, na tela, tem o que o PDF imprimiu.
  await page.setContent(html);
  await expect(page.locator('h1')).toHaveText('Relatório Mensal');
  await expect(page.getByText('Para onde foi o dinheiro')).toBeVisible();
  await expect(page.getByText('Termômetro financeiro')).toBeVisible();
});
