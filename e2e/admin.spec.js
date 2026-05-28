'use strict';

// Smoke do admin — admin.html.
//
// Admin gateia com ADMIN_API_TOKEN num overlay (#login-overlay). Sem
// token válido o painel não renderiza. Asserções cobrem a presença do
// overlay e o feedback de erro quando o token é inválido.

const { test, expect } = require('@playwright/test');
const { attachConsoleCollector } = require('./_helpers');

test.describe('admin.html', () => {
  test('mostra overlay de login e rejeita token inválido', async ({ page }) => {
    const consoleMessages = attachConsoleCollector(page);

    await page.goto('/admin.html');

    const overlay = page.locator('#login-overlay');
    await expect(overlay).toBeVisible();

    const tokenInput = page.locator('#admin-token');
    const loginBtn = page.locator('#login-btn');
    await expect(tokenInput).toBeVisible();
    await expect(loginBtn).toBeVisible();

    // Token errado dispara mensagem de erro. O backend rejeita com 401
    // se o ADMIN_API_TOKEN não bater — o front mostra #error-msg.
    await tokenInput.fill('token-invalido-para-teste');
    await loginBtn.click();

    await expect(page.locator('#error-msg')).toBeVisible({ timeout: 10_000 });

    expect(
      consoleMessages,
      `Console limpo esperado (erro de auth é exibido na UI, não no console). Mensagens:\n${JSON.stringify(consoleMessages, null, 2)}`,
    ).toEqual([]);
  });
});
