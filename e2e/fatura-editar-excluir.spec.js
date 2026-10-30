'use strict';

// Editar e excluir um lançamento pela tela da FATURA.
//
// Relato: um amigo do fundador quis excluir uma compra do cartão pela fatura
// e não conseguiu — o lápis levava ao formulário, que não tinha "Excluir".
// Agora tocar no lançamento mostra Editar e Excluir logo abaixo, e o
// formulário de edição também tem "Excluir lançamento". A confirmação é a do
// extrato: parcela pergunta "só este mês" ou "este e os futuros".

const { test, expect } = require('@playwright/test');
const { semearParidade } = require('./_seed-paridade');

const APP = '/Appliquei_v13.0.html';
const SEM_GATES = '#authGate,#ppBoasVindas,#ppGuia,[id*="rimeirosPassos"]{display:none!important}';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Os gráficos vêm de CDN e não estão sob teste.
function semGraficos() {
  const C = function () {
    return { destroy() {}, update() {}, data: { datasets: [] }, options: {} };
  };
  C.register = () => {};
  C.defaults = {
    font: {},
    plugins: { legend: { labels: {} }, tooltip: {} },
    scale: { grid: {}, ticks: {} },
  };
  Object.defineProperty(window, 'Chart', { get: () => C, set: () => {}, configurable: true });
  window.ChartDataLabels = {};
}

const VENC = '2026-11-05';

async function abrirFatura(page) {
  await page.addInitScript(semGraficos);
  await page.addInitScript(semearParidade);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof mudarAba === 'function' && !!document.querySelector('.section.ativa')
  );
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: SEM_GATES });
  await page.evaluate((venc) => {
    cartoes.length = 0;
    cartoes.push({ id: 'card_e2e', nome: 'Nubank', diaVencimento: 5, diaFechamento: 28 });
    const base = {
      categoria: 'cartao_credito',
      cartaoId: 'card_e2e',
      pago: false,
      obs: '',
      data: '2026-10-20T12:00:00.000Z',
    };
    transacoes.push(
      Object.assign({}, base, {
        id: 'e2e_pizza',
        descricao: 'Pizzaria',
        valor: 80,
        dataVencimento: venc,
        mes: 10,
        ano: 2026,
      })
    );
    // Uma série de 3 parcelas: nov, dez, jan.
    ['2026-11-05', '2026-12-05', '2027-01-05'].forEach((v, i) =>
      transacoes.push(
        Object.assign({}, base, {
          id: 'e2e_tv' + i,
          groupId: 'e2e_tv',
          descricao: 'TV (' + (i + 1) + '/3)',
          valor: 300,
          dataVencimento: v,
          mes: Number(v.slice(5, 7)) - 1,
          ano: Number(v.slice(0, 4)),
        })
      )
    );
    abrirFaturas('card_e2e', venc);
  }, VENC);
}

test('tocar no lançamento mostra Editar e Excluir; excluir tira da fatura na hora', async ({
  page,
}) => {
  await abrirFatura(page);
  const linha = page.locator('.fat-item[data-id="e2e_pizza"]');
  await expect(linha).toBeVisible();
  await linha.click();
  await expect(page.locator('.fat-item-acoes')).toBeVisible();
  await page.click('.fat-item-excluir[data-id="e2e_pizza"]');
  // A confirmação abre por cima da fatura.
  await expect(page.locator('#modalConfirmacao')).toBeVisible();
  await page.click('#modalAcoes button:has-text("Sim, excluir")');
  await expect(page.locator('.fat-item[data-id="e2e_pizza"]')).toHaveCount(0);
  expect(await page.evaluate(() => transacoes.some((t) => t.id === 'e2e_pizza'))).toBe(false);
  await expect(page.locator('#telaFaturas')).toBeVisible();
});

test('parcela: "este e os futuros" apaga a série daqui para frente', async ({ page }) => {
  await abrirFatura(page);
  await page.click('.fat-item[data-id="e2e_tv0"]');
  await page.click('.fat-item-excluir[data-id="e2e_tv0"]');
  await page.click('#modalAcoes button:has-text("Excluir este e os futuros")');
  expect(await page.evaluate(() => transacoes.filter((t) => t.groupId === 'e2e_tv').length)).toBe(
    0
  );
});

test('Editar abre o formulário, que agora também tem "Excluir lançamento"', async ({ page }) => {
  await abrirFatura(page);
  await page.click('.fat-item[data-id="e2e_pizza"]');
  await page.click('.fat-item-acoes button:has-text("Editar")');
  await expect(page.locator('#telaFaturas')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('editTransacaoId').value)).toBe(
    'e2e_pizza'
  );
  await page.click('#btnExcluirEdicao');
  await page.click('#modalAcoes button:has-text("Sim, excluir")');
  expect(await page.evaluate(() => transacoes.some((t) => t.id === 'e2e_pizza'))).toBe(false);
  // O formulário sai do modo edição: nada fica apontando para o que sumiu.
  expect(await page.evaluate(() => document.getElementById('editTransacaoId').value)).toBe('');
  await expect(page.locator('#btnExcluirEdicao')).toBeHidden();
});
