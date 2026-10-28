'use strict';

// "Novo lançamento" — o layout de 27/10 (web/appliquei-lancamento-ui.js).
//
// Os botões novos (tipo, categoria, conta, Variável × Fixa, cartão, − / +,
// "Já começou a pagar esta compra?") só preenchem os campos que já existiam;
// o salvamento lê os mesmos campos. Este spec trava exatamente isso: cada
// botão preenche o campo certo, a edição de um lançamento acende os botões
// certos, e salvar um parcelado que começou na parcela 2 cria 2/10..10/10.

const { test, expect } = require('@playwright/test');
const { semearParidade } = require('./_seed-paridade');

const APP = '/Appliquei_v13.0.html';
const SEM_GATES = '#authGate,#ppBoasVindas,#ppGuia,[id*="rimeirosPassos"]{display:none!important}';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Os gráficos vêm de CDN e não estão sob teste: um Chart de mentira deixa o
// app carregar igual com ou sem rede.
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

async function abrirApp(page) {
  await page.addInitScript(semGraficos);
  await page.addInitScript(semearParidade);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof mudarAba === 'function' && !!document.querySelector('.section.ativa')
  );
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: SEM_GATES });
  await page.evaluate(() => {
    cartoes.length = 0;
    cartoes.push(
      {
        id: 'card_nu',
        nome: 'Nubank',
        diaVencimento: 5,
        diaFechamento: 28,
        contaPagadoraId: (contas[0] || {}).id,
      },
      {
        id: 'card_mp',
        nome: 'Mercado Pago',
        diaVencimento: 10,
        diaFechamento: 3,
        contaPagadoraId: (contas[0] || {}).id,
      }
    );
    abrirPainelLancamento();
  });
}

const campo = (page, id) => page.evaluate((i) => document.getElementById(i).value, id);

test('saída: cada botão preenche o campo de sempre, e o resumo diz o que vai ser salvo', async ({
  page,
}) => {
  await abrirApp(page);
  await page.click('#chipSaida');
  await expect(page.locator('#chipSaida')).toHaveClass(/\bon\b/);
  await page.fill('#valorTransacao', '5290');
  await page.fill('#descTransacao', 'Mercado');

  // Categoria: o botão é a opção do select.
  const chip = page.locator('#lancCatChips .lanc-chip:not(.mais)').first();
  const v = await chip.getAttribute('data-v');
  await chip.click();
  expect(await campo(page, 'categoriaDespesa')).toBe(v);
  // "Todas" abre a lista completa (e a criação de categoria).
  await expect(page.locator('#categoriaDespesa')).toBeHidden();
  await page.click('#lancCatChips .lanc-chip.mais');
  await expect(page.locator('#categoriaDespesa')).toBeVisible();

  // Salvar sem conta: nada é gravado e os botões de conta pedem atenção
  // (o campo de texto está escondido, então o foco vai para eles).
  await page.evaluate(() => {
    document.getElementById('bancoTransacao').value = '';
    lancUiSincronizar();
  });
  const n0 = await page.evaluate(() => transacoes.length);
  await page.click('#btnSalvarControle');
  await expect(page.locator('#lancContaChips')).toHaveClass(/lanc-falta/);
  expect(await page.evaluate(() => transacoes.length)).toBe(n0);

  // Conta: o botão preenche o campo de texto, que só aparece em "Outra".
  const conta = page.locator('#lancContaChips .lanc-chip:not(.mais)').first();
  const nomeConta = await conta.getAttribute('data-v');
  await conta.click();
  expect(await campo(page, 'bancoTransacao')).toBe(nomeConta);
  await expect(page.locator('#bancoTransacao')).toBeHidden();
  await page.click('#lancContaChips .lanc-chip.mais');
  await expect(page.locator('#bancoTransacao')).toBeVisible();

  // Variável × Fixa é a categoria de antes; Fixa liga "Repetir todo mês".
  await page.click('#lancTipoGasto button[data-cat="despesa_fixa"]');
  expect(await campo(page, 'categoriaTransacao')).toBe('despesa_fixa');
  await expect(page.locator('#transacaoFixa')).toBeChecked();
  await page.click('#lancTipoGasto button[data-cat="despesa_variavel"]');
  expect(await campo(page, 'categoriaTransacao')).toBe('despesa_variavel');
  await expect(page.locator('#transacaoFixa')).not.toBeChecked();

  await expect(page.locator('#lancResumo')).toContainText('Saída de R$ 52,90');
  // O Salvar fica à vista sem rolar a folha.
  await expect(page.locator('#btnSalvarControle')).toBeInViewport();
});

test('cartão: parcelado que já começou — pergunta recolhida, 9 parcelas de 2/10 a 10/10', async ({
  page,
}) => {
  await abrirApp(page);
  await page.click('#chipCartao');
  await expect(page.locator('#lancImportarTopo')).toBeVisible();
  await page.click('#lancCartaoChips .lanc-chip[data-v="card_nu"]');
  expect(await campo(page, 'selectCartao')).toBe('card_nu');
  await page.fill('#valorTransacao', '300000');
  await page.fill('#descTransacao', 'TV da sala');
  for (let i = 0; i < 9; i++) await page.click('button[aria-label="Mais uma parcela"]');
  expect(await campo(page, 'qtdParcelas')).toBe('10');

  // Quem compra hoje não vê a pergunta; ela fica atrás do link.
  await expect(page.locator('#grupoParcelaInicial')).toBeHidden();
  await page.click('#lancParcelaInicialAbrir');
  await expect(page.locator('#grupoParcelaInicial')).toBeVisible();
  expect(await campo(page, 'parcelaInicial')).toBe('2');
  await expect(page.locator('#lancResumo')).toContainText('9× de R$ 300,00');
  await expect(page.locator('#lancResumo')).toContainText('parcelas 2 a 10');

  const antes = await page.evaluate(() => transacoes.length);
  await page.click('#btnSalvarControle');
  const tv = await page.evaluate(() =>
    transacoes.filter((t) => /^TV da sala/.test(t.descricao)).map((t) => t.descricao)
  );
  expect(tv.length).toBe(9);
  expect(tv[0]).toBe('TV da sala (2/10)');
  expect(tv[8]).toBe('TV da sala (10/10)');
  expect(await page.evaluate(() => transacoes.length)).toBe(antes + 9);
  // Formulário limpo: a pergunta volta a ficar recolhida.
  await expect(page.locator('#grupoParcelaInicial')).toBeHidden();
});

test('editar um lançamento acende os botões dele', async ({ page }) => {
  await abrirApp(page);
  const conta = await page.evaluate(() => contas[0].nome);
  await page.evaluate((nomeConta) => {
    transacoes.push({
      id: 'e2e_luz',
      descricao: 'Conta de luz',
      valor: 180,
      categoria: 'despesa_fixa',
      categoriaDespesa: 'moradia',
      banco: nomeConta,
      dataVencimento: '2026-11-10',
      mes: 10,
      ano: 2026,
      pago: false,
    });
    prepararEdicao('e2e_luz');
  }, conta);
  await expect(page.locator('#chipSaida')).toHaveClass(/\bon\b/);
  await expect(page.locator('#lancTipoGasto button[data-cat="despesa_fixa"]')).toHaveClass(
    /\bon\b/
  );
  await expect(page.locator(`#lancContaChips .lanc-chip.on[data-v="${conta}"]`)).toHaveCount(1);
  await expect(page.locator('#lancCatChips .lanc-chip.on[data-v="moradia"]')).toHaveCount(1);
});
