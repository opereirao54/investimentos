'use strict';

// A lista de bancos/instituições (web/appliquei-combobox.js) ROLA com o dedo.
//
// Relato: "a lista de bancos no lançamento no mobile eu não consigo rolar pra
// cima ou pra baixo com os dedos, ele seleciona". A escolha era no
// `pointerdown`: encostar o dedo para rolar já escolhia o banco embaixo dele e
// fechava a lista. Medido aqui mesmo com o código antigo: o arrasto escolheu
// "Banco 5" e a lista não rolou nada.
//
// Este spec usa toque de verdade (eventos de toque do Chromium, não clique
// simulado) num celular emulado, e confere também o mouse do desktop.

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
test.use({ launchOptions: LAUNCH });

// O CSS e o script do app, sem o resto da página: o que está sob teste é a
// lista, e assim o spec não depende de login.
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
const CSS = HTML.match(/\/\* ===== Combobox custom[\s\S]*?\.appq-combo-usar:hover[^\n]*/)[0];
const JS = fs.readFileSync(path.join(ROOT, 'web/appliquei-combobox.js'), 'utf8');
const OPCOES = Array.from({ length: 40 }, (_, i) => `<option value="Banco ${i}">`).join('');
const PAGINA =
  '<!doctype html><meta name="viewport" content="width=device-width">' +
  `<style>:root{--cor-branco:#fff;--cor-borda:#ccc}${CSS}</style>` +
  '<div style="padding:20px"><input id="banco" list="listaBancosTransacao">' +
  `<datalist id="listaBancosTransacao">${OPCOES}</datalist></div>` +
  `<script>${JS}</script>`;

const estado = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.appq-combo-panel');
    return {
      valor: document.getElementById('banco').value,
      rolou: p.scrollTop,
      aberto: p.classList.contains('aberto'),
    };
  });

test.describe('celular', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

  test('arrastar o dedo rola a lista e não escolhe; tocar escolhe', async ({ page, context }) => {
    await page.setContent(PAGINA);
    await page.tap('#banco');
    const caixa = await page.locator('.appq-combo-panel').boundingBox();

    // Arrasto de baixo para cima, como quem rola a lista.
    const cdp = await context.newCDPSession(page);
    const x = caixa.x + 60;
    const y0 = caixa.y + 200;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y0 - i * 15 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    const depois = await estado(page);
    expect(depois.valor, 'o arrasto escolheu um banco').toBe('');
    expect(depois.aberto, 'o arrasto fechou a lista').toBe(true);
    expect(depois.rolou, 'a lista não rolou').toBeGreaterThan(0);

    await page.locator('.appq-combo-opt').nth(8).tap();
    await expect(page.locator('#banco')).toHaveValue('Banco 8');
    expect((await estado(page)).aberto).toBe(false);
  });
});

test('desktop: clicar com o mouse escolhe e mantém o foco no campo', async ({ page }) => {
  await page.setContent(PAGINA);
  await page.click('#banco');
  await page.locator('.appq-combo-opt').nth(3).click();
  await expect(page.locator('#banco')).toHaveValue('Banco 3');
  await expect(page.locator('#banco')).toBeFocused();
});

test('digitar filtra e o clique escolhe a opção filtrada', async ({ page }) => {
  await page.setContent(PAGINA);
  await page.fill('#banco', 'Banco 2');
  await page.locator('.appq-combo-opt', { hasText: 'Banco 21' }).click();
  await expect(page.locator('#banco')).toHaveValue('Banco 21');
});
