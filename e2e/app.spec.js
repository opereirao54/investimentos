'use strict';

// Smoke do app principal — Appliquei_v13.0.html.
//
// Não temos credenciais de teste no CI, então as asserções cobrem o estado
// pré-login: o #authGate aparece, os campos do form de auth estão lá, e a
// alternância entre as tabs Entrar/Criar conta funciona.
//
// Quando houver conta Firebase de staging, dá pra estender para login
// real (issue de seguimento listada em AUDITORIA.md).

const { test, expect } = require('@playwright/test');
const { attachConsoleCollector } = require('./_helpers');

test.describe('Appliquei_v13.0.html (app)', () => {
  test('mostra authGate, alterna tabs e expõe campos de login', async ({ page }) => {
    const consoleMessages = attachConsoleCollector(page);

    await page.goto('/Appliquei_v13.0.html');

    // O gate começa com display:block antes do JS rodar. Esperar o form
    // ficar pronto (mode='form' setado por appliquei-auth-gate.js após
    // detectar config Firebase válida).
    const gate = page.locator('#authGate');
    await expect(gate).toBeVisible();

    const form = page.locator('#authGateForm');
    await expect(form).toHaveClass(/ativo/, { timeout: 10_000 });

    // Tabs presentes e funcionais.
    const tabLogin = page.locator('#authTabLogin');
    const tabReg = page.locator('#authTabReg');
    await expect(tabLogin).toBeVisible();
    await expect(tabReg).toBeVisible();
    await expect(tabLogin).toHaveClass(/ativo/);

    await tabReg.click();
    await expect(tabReg).toHaveClass(/ativo/);
    await expect(tabLogin).not.toHaveClass(/ativo/);

    // Campos do form de email/senha estão lá.
    await expect(page.locator('#authEmail')).toBeVisible();
    await expect(page.locator('#authSenha')).toBeVisible();
    await expect(page.locator('#authBtnSubmit')).toBeVisible();
    await expect(page.locator('#authBtnGoogle')).toBeVisible();

    expect(
      consoleMessages,
      `Console limpo esperado. Mensagens:\n${JSON.stringify(consoleMessages, null, 2)}`,
    ).toEqual([]);
  });
});
