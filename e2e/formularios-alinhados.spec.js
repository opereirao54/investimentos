'use strict';

// Trava contra "o campo está fora do esquadro".
//
// O relato foi sobre o campo de data do cadastro de sonho. Medido: com
// padding, fonte e borda IDÊNTICOS, o browser dá alturas diferentes a
// controles diferentes — input[type=text] fechava em 38px e
// input[type=month], input[type=number] e select em 40px. Numa grade de duas
// colunas isso põe dois campos lado a lado desencontrados em 2px numa das
// bordas: "Valor total necessário" e "Quando começar?" dividem a linha, e a
// diferença aparecia.
//
// A correção foi um `min-height` na regra compartilhada, nivelando todos pelo
// maior. Este teste guarda a propriedade que interessa — dentro de um mesmo
// formulário, todo campo de uma linha tem a MESMA altura — em vez de guardar
// o número 40, que pode mudar legitimamente se o desenho mudar.
//
// `textarea` fica de fora: ser mais alto é o desenho dele.

const { test, expect } = require('@playwright/test');

/** Abre a tela e devolve as alturas dos controles de um container. */
async function alturasDe(page, seletorContainer) {
  return page.evaluate((sel) => {
    const raiz = document.querySelector(sel);
    if (!raiz) return { erro: 'container não encontrado: ' + sel };
    const campos = [...raiz.querySelectorAll('.form-group input, .form-group select')];
    const porAltura = {};
    campos.forEach((el) => {
      if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return;
      const r = el.getBoundingClientRect();
      if (r.height === 0) return;
      const h = Math.round(r.height * 10) / 10;
      (porAltura[h] = porAltura[h] || []).push(el.id || el.name || el.tagName);
    });
    return { porAltura };
  }, seletorContainer);
}

test.describe('formulários no esquadro', () => {
  test('cadastro de sonho: todos os campos com a mesma altura', async ({ page }) => {
    await page.goto('/Appliquei_v13.0.html');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const g = document.getElementById('authGate');
      if (g) g.style.display = 'none';
      document
        .querySelectorAll('[id*="rimeirosPassos"]')
        .forEach((e) => (e.style.display = 'none'));
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
      document.getElementById('meus_sonhos').classList.add('ativa');
      window.abrirCadastroSonho();
    });
    await page.waitForTimeout(300);

    const { porAltura, erro } = await alturasDe(page, '#sonhoPasso1');
    expect(erro).toBeUndefined();
    expect(
      Object.keys(porAltura),
      `Campos com alturas diferentes no mesmo formulário — é isso que tira a ` +
        `linha do esquadro quando dois campos dividem a grade: ${JSON.stringify(porAltura)}`
    ).toHaveLength(1);
  });

  test('cadastro de sonho: os pares da grade alinham topo e base', async ({ page }) => {
    await page.goto('/Appliquei_v13.0.html');
    await page.waitForTimeout(1200);
    const pares = await page.evaluate(() => {
      const g = document.getElementById('authGate');
      if (g) g.style.display = 'none';
      document
        .querySelectorAll('[id*="rimeirosPassos"]')
        .forEach((e) => (e.style.display = 'none'));
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
      document.getElementById('meus_sonhos').classList.add('ativa');
      window.abrirCadastroSonho();

      const medir = (a, b) => {
        const A = document.getElementById(a).getBoundingClientRect();
        const B = document.getElementById(b).getBoundingClientRect();
        return {
          par: a + ' / ' + b,
          topo: Math.round((B.top - A.top) * 10) / 10,
          base: Math.round((B.bottom - A.bottom) * 10) / 10,
        };
      };
      return [
        medir('sonhoValorTotal', 'sonhoMesInicio'),
        medir('sonhoValorInicial', 'sonhoCategoria'),
      ];
    });

    for (const p of pares) {
      expect(Math.abs(p.topo), `${p.par}: topos desencontrados em ${p.topo}px`).toBeLessThanOrEqual(
        1
      );
      expect(Math.abs(p.base), `${p.par}: bases desencontradas em ${p.base}px`).toBeLessThanOrEqual(
        1
      );
    }
  });

  test('todo select mostra a seta de abrir', async ({ page }) => {
    // `appearance: none` tira a seta nativa. Se a seta de substituição não
    // vier junto, o select deixa de parecer um select — foi o que acontecia
    // no painel de lançamento, onde uma regra mais específica usava o ATALHO
    // `background:` e apagava o background-image da seta.
    await page.goto('/Appliquei_v13.0.html');
    await page.waitForTimeout(1200);
    const semSeta = await page.evaluate(() => {
      const g = document.getElementById('authGate');
      if (g) g.style.display = 'none';
      document
        .querySelectorAll('[id*="rimeirosPassos"]')
        .forEach((e) => (e.style.display = 'none'));
      document.querySelectorAll('.section').forEach((s) => s.classList.add('ativa'));
      if (typeof window.abrirPainelLancamento === 'function') window.abrirPainelLancamento();
      const ruins = [];
      document.querySelectorAll('select').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || !el.getClientRects().length) return;
        const semNativa = cs.appearance === 'none' || cs.webkitAppearance === 'none';
        const temImagem = cs.backgroundImage && cs.backgroundImage !== 'none';
        if (semNativa && !temImagem) ruins.push(el.id || el.name || 'select sem id');
      });
      return ruins;
    });
    expect(
      semSeta,
      `Selects sem seta nenhuma (appearance:none e sem background-image): ${JSON.stringify(semSeta)}`
    ).toEqual([]);
  });
});
