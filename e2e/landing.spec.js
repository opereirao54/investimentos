'use strict';

// Smoke da landing — porta de entrada do trial. Se quebrar, ninguém
// converte. Asserções deliberadamente alto-nível: presença de seções,
// CTAs e ano no footer (proxy de execução do JS inline).

const { test, expect } = require('@playwright/test');
const { attachConsoleCollector } = require('./_helpers');

test.describe('landing.html', () => {
  test('renderiza nav, hero, planos e FAQ sem erro crítico de console', async ({ page }) => {
    const consoleMessages = attachConsoleCollector(page);

    await page.goto('/landing.html');

    await expect(page).toHaveTitle(/Appliquei/);

    // Âncoras conhecidas no <main>.
    await expect(page.locator('#funcionalidades')).toBeVisible();
    await expect(page.locator('#planos')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();

    // Footer com ano injetado por JS inline — proxy de "JS executou".
    const year = await page.locator('#year').textContent();
    expect(year).toMatch(/^20\d{2}$/);

    // Deve haver ao menos um CTA visível com texto de trial.
    const ctaCount = await page
      .getByRole('link', { name: /começar|grátis|trial|teste/i })
      .count();
    expect(ctaCount).toBeGreaterThan(0);

    expect(
      consoleMessages,
      `Console limpo esperado. Mensagens:\n${JSON.stringify(consoleMessages, null, 2)}`,
    ).toEqual([]);
  });
});
