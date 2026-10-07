'use strict';

// Trava: nenhuma funcionalidade pode existir só no computador.
//
// O celular tem layout próprio (barra inferior, abas no Controle, folhas no
// lugar de janelas). Cada mudança dessas esconde ou move coisas, e o risco
// é uma ação ficar alcançável só no desktop — o que inviabiliza o app.
//
// O teste abre o app nos dois tamanhos com os mesmos dados, percorre todas
// as telas, abas internas, blocos recolhíveis e janelas, e falha listando
// cada ação que o desktop mostra e o celular não alcança. A lógica está em
// e2e/_paridade.js; os dados, em e2e/_seed-paridade.js.

const { test, expect } = require('@playwright/test');
const { percorrer, soNoDesktop } = require('./_paridade');
const { semearParidade } = require('./_seed-paridade');

const APP = '/Appliquei_v13.0.html';
const SEM_GATES = '#authGate,#ppBoasVindas,#ppGuia,[id*="rimeirosPassos"]{display:none!important}';

const TAMANHOS = {
  desk: { viewport: { width: 1366, height: 900 } },
  mob: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

async function abrirApp(page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof mudarAba === 'function' && !!document.querySelector('.section.ativa')
  );
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: SEM_GATES });
}

async function relatorio(browser, modo) {
  const ctx = await browser.newContext(TAMANHOS[modo]);
  const page = await ctx.newPage();
  await page.addInitScript(semearParidade);
  await abrirApp(page);
  const rel = await percorrer(page, modo, () => abrirApp(page));
  await ctx.close();
  return rel;
}

test('toda ação do desktop é alcançável no celular', async ({ browser }) => {
  test.setTimeout(300_000);
  const [desk, mob] = await Promise.all([relatorio(browser, 'desk'), relatorio(browser, 'mob')]);

  // Sanidade: se a coleta voltou vazia, o teste não está olhando para nada.
  expect(Object.keys(desk.controle || {}).length, 'coleta do desktop vazia').toBeGreaterThan(10);
  expect(Object.keys(mob.controle || {}).length, 'coleta do celular vazia').toBeGreaterThan(10);

  const faltas = soNoDesktop(desk, mob);
  expect(faltas, 'Ações só no desktop:\n' + faltas.join('\n')).toEqual([]);
});
