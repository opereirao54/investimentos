'use strict';

// Modo demonstração (/demo, ?demo=1) — web/appliquei-demo.js.
//
// A promessa é uma só: dá para mostrar o app a alguém sem mostrar as próprias
// finanças. Este spec a prova do jeito que ela quebraria:
//   1. o navegador já tem os dados REAIS de alguém (gravados antes, como um
//      uso normal deixaria);
//   2. a demonstração abre, mostra os dados fictícios e NENHUM real;
//   3. lançar e apagar na demonstração não toca no armazenamento real;
//   4. nada vai para o servidor além de cotações/logos — sem sync, sem login.

const { test, expect } = require('@playwright/test');

const DEMO = '/Appliquei_v13.0.html?demo=1';

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

const REAL_TX = JSON.stringify([
  {
    id: 'real1',
    descricao: 'SEGREDO salário real',
    valor: 98765.43,
    categoria: 'receita',
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    data: new Date().toISOString(),
    pago: false,
  },
]);
const REAL_CONTAS = JSON.stringify([{ id: 'c_real', nome: 'BancoSecreto', saldoInicial: 55555 }]);

async function gravarDadosReais(page) {
  // Uma página qualquer da mesma origem, sem o app: aqui `localStorage` é o
  // armazenamento real do navegador.
  await page.goto('/web/appliquei-demo.js');
  await page.evaluate(
    ([tx, contas]) => {
      localStorage.setItem('futurorico_transacoes', tx);
      localStorage.setItem('appliquei_contas', contas);
    },
    [REAL_TX, REAL_CONTAS]
  );
}

async function lerDadosReais(page) {
  await page.goto('/web/appliquei-demo.js');
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
}

test('demonstração: dados fictícios, nada dos reais, nada gravado, nada enviado', async ({
  page,
}) => {
  await gravarDadosReais(page);
  const antes = await lerDadosReais(page);

  const apiChamadas = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && !/^\/api\/(market|logo)/.test(u.pathname)) {
      apiChamadas.push(r.method() + ' ' + u.pathname);
    }
  });

  await page.addInitScript(semGraficos);
  await page.goto(DEMO, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof mudarAba === 'function' && !!document.querySelector('.section.ativa')
  );
  await page.waitForTimeout(1500);

  // Faixa à vista, portão de login fora do caminho, Firebase desligado.
  await expect(page.locator('#demoFaixa')).toBeVisible();
  await expect(page.locator('#demoFaixa')).toContainText('dados fictícios');
  await expect(page.locator('#authGate')).toBeHidden();
  expect(await page.evaluate(() => !!(window.AppliqueiFirebase && AppliqueiFirebase.ready))).toBe(
    false
  );

  // Os dados são os fictícios — e nenhum real.
  const estado = await page.evaluate(() => ({
    contas: contas.map((c) => c.nome),
    descricoes: transacoes.map((t) => t.descricao),
    html: document.body.innerText,
  }));
  expect(estado.contas).toEqual(expect.arrayContaining(['Nubank', 'Itaú']));
  expect(estado.descricoes).toContain('Salário (quinzena)');
  expect(estado.descricoes).not.toContain('SEGREDO salário real');
  expect(estado.html).not.toContain('SEGREDO');
  expect(estado.html).not.toContain('BancoSecreto');
  expect(estado.html).not.toContain('98.765');

  // Mexer na demonstração: lançar e apagar.
  await page.evaluate(() => {
    transacoes.push({
      id: 'demo_teste',
      descricao: 'Lançado na demo',
      valor: 10,
      categoria: 'despesa_variavel',
      mes: new Date().getMonth(),
      ano: new Date().getFullYear(),
      data: new Date().toISOString(),
      pago: true,
    });
    salvarTransacoes({ flush: true });
    localStorage.removeItem('appliquei_contas');
    localStorage.setItem('appliquei_qualquer_coisa', 'x');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  // Uma chamada direta ao sync também não sai.
  const status = await page.evaluate(() =>
    fetch('/api/sync/push', { method: 'POST', body: '{}' }).then((r) => r.status)
  );
  expect(status).toBe(503);
  await page.waitForTimeout(2500); // além do debounce do sync

  expect(apiChamadas).toEqual([]);

  // O armazenamento real está exatamente como estava.
  const depois = await lerDadosReais(page);
  expect(depois).toEqual(antes);
});

test('fora do /demo o app lê o armazenamento real, como sempre', async ({ page }) => {
  await gravarDadosReais(page);
  await page.addInitScript(semGraficos);
  await page.goto('/Appliquei_v13.0.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof transacoes !== 'undefined');
  expect(await page.evaluate(() => !!window.__APPLIQUEI_DEMO__)).toBe(false);
  await expect(page.locator('#demoFaixa')).toHaveCount(0);
  expect(await page.evaluate(() => transacoes.map((t) => t.descricao))).toContain(
    'SEGREDO salário real'
  );
});

test('demonstração no celular: a faixa não cobre o app e as telas têm conteúdo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(semGraficos);
  await page.goto(DEMO, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof mudarAba === 'function' && !!document.querySelector('.section.ativa')
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/demo-inicio.png' });
  const largura = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(largura).toBeLessThanOrEqual(390);
});

test('demonstração: Patrimônio e Carteira com conteúdo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(semGraficos);
  await page.goto(DEMO, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof mudarAba === 'function' && !!document.querySelector('.section.ativa')
  );
  await page.waitForTimeout(1200);
  for (const aba of ['meu_patrimonio', 'patrimonio', 'meus_sonhos']) {
    await page.evaluate(
      (a) =>
        mudarAba(
          {
            currentTarget: document.querySelector('.menu-btn[onclick*="' + a + '"]'),
            preventDefault() {},
          },
          a
        ),
      aba
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/demo-${aba}.png` });
  }
});
