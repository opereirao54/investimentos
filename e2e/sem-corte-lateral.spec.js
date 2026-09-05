'use strict';

// Trava contra "a tela corta de um lado".
//
// O relato foi: em certos momentos o app aparece cortado à direita ou à
// esquerda no telemóvel. O print mostrava o painel de lançamento com o
// teclado aberto e o chip "Cartão" partido ao meio.
//
// A investigação achou DUAS causas independentes, e por isso há dois testes:
//
//  1. ZOOM AUTOMÁTICO DO iOS — a causa do print. O Safari do iOS amplia a
//     página sozinho quando o utilizador toca num campo cuja fonte é menor
//     que 16px. Com a página ampliada, a viewport VISÍVEL fica menor que a de
//     layout e a tela aparece cortada — de que lado, depende de onde estava o
//     campo tocado. Nenhum browser de desktop reproduz isto, e é por isso que
//     o layout medido aqui sempre pareceu correto: ele ESTÁ correto. Eram 81
//     dos 135 campos abaixo de 16px, a tela de login entre eles.
//
//  2. ESTOURO DE LAYOUT — um elemento largo demais que empurra a página.
//     Este SIM é mensurável no Chromium, e é o que o segundo teste varre.
//
// O primeiro teste é o que mais importa e o mais barato: mede a fonte
// computada de cada campo com `pointer: coarse` ligado. Não depende de ter
// um iPhone no CI — verifica a PRÉ-CONDIÇÃO que dispara o zoom.

const { test, expect } = require('@playwright/test');

const LARGURAS = [320, 360, 390, 414];
const PAGINAS = ['/Appliquei_v13.0.html', '/admin.html'];

// Campos que não abrem teclado e portanto nunca disparam o zoom do iOS.
const SEM_TECLADO = ['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button'];

/** Deixa tudo visível e mensurável: seções ativas, gate de auth fora. */
async function revelarTudo(page) {
  await page.evaluate(() => {
    const g = document.getElementById('authGate');
    if (g) g.style.display = 'none';
    document.querySelectorAll('.section').forEach((s) => s.classList.add('ativa'));
  });
}

test.describe('nenhuma tela corta de lado', () => {
  for (const pagina of PAGINAS) {
    test(`${pagina}: todo campo tem 16px ou mais no toque`, async ({ browser }) => {
      // hasTouch liga `pointer: coarse`, que é onde a regra vive.
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await ctx.newPage();
      await page.goto(pagina);
      await page.waitForTimeout(1200);
      await revelarTudo(page);

      const pequenos = await page.evaluate((semTeclado) => {
        const out = [];
        document.querySelectorAll('input, select, textarea').forEach((el) => {
          if (semTeclado.includes((el.type || '').toLowerCase())) return;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 16) out.push({ id: el.id || el.name || el.tagName, fs });
        });
        return out;
      }, SEM_TECLADO);

      expect(
        pequenos,
        `Campos abaixo de 16px fazem o Safari do iOS ampliar a página ao serem ` +
          `tocados, e a tela passa a aparecer cortada de um lado. Mantenha a regra ` +
          `@media (pointer: coarse) no fim do <style>. Campos: ` +
          JSON.stringify(pequenos.slice(0, 12))
      ).toEqual([]);

      await ctx.close();
    });
  }

  // Uma seção de cada vez: é o estado real do app (só uma fica `.ativa`).
  // Ligar todas de uma vez empilha layouts que nunca coexistem e produz
  // acusação que ninguém consegue reproduzir na tela.
  const SECOES = [
    'controle',
    'patrimonio',
    'meu_patrimonio',
    'carteira',
    'simulador',
    'relatorio_mensal',
    'meus_sonhos',
    'applicash',
    'duvidas_sugestoes',
  ];

  for (const largura of LARGURAS) {
    test(`nenhuma aba estoura horizontalmente em ${largura}px`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: largura, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await ctx.newPage();
      await page.goto('/Appliquei_v13.0.html');
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        const g = document.getElementById('authGate');
        if (g) g.style.display = 'none';
      });

      const problemas = [];
      for (const secao of SECOES) {
        await page.evaluate((s) => {
          document.querySelectorAll('.section').forEach((x) => x.classList.remove('ativa'));
          const el = document.getElementById(s);
          if (el) el.classList.add('ativa');
        }, secao);
        await page.waitForTimeout(120);

        const culpados = await page.evaluate(() => {
          const W = document.documentElement.clientWidth;
          const fora = [];
          document.querySelectorAll('body *').forEach((el) => {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            if (!el.getClientRects().length) return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= W + 1) return;
            // Painel FECHADO fica estacionado inteiro fora da tela, à espera
            // de abrir — isso é o desenho, não estouro. O que caracteriza
            // "conteúdo cortado" é começar DENTRO da tela e passar da borda.
            if (r.left >= W) return;
            const p = el.parentElement;
            if (p && p !== document.body) {
              if (p.getBoundingClientRect().right > W + 1) return;
              if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return;
            }
            fora.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              cls: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
              excesso: Math.round(r.right - W),
            });
          });
          return fora.slice(0, 5);
        });
        if (culpados.length) problemas.push({ secao, culpados });
      }

      expect(problemas, `Conteúdo passando da borda: ${JSON.stringify(problemas)}`).toEqual([]);
      await ctx.close();
    });
  }

  test('o painel de lançamento cabe na tela do telemóvel', async ({ browser }) => {
    // O painel do print. Ele vive DENTRO de <section id="controle">: sem a
    // seção ativa ele fica display:none e mede zero — foi o que mascarou a
    // primeira medição desta investigação.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto('/Appliquei_v13.0.html');
    await page.waitForTimeout(1200);
    await revelarTudo(page);

    const medida = await page.evaluate(() => {
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
      document.getElementById('controle').classList.add('ativa');
      if (typeof window.abrirPainelLancamento === 'function') window.abrirPainelLancamento();
      const el = document.getElementById('painelNovoLancamento');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vp: window.innerWidth };
    });

    expect(medida, 'painel não encontrado').not.toBeNull();
    expect(
      medida.left,
      `painel começa fora da tela: ${JSON.stringify(medida)}`
    ).toBeGreaterThanOrEqual(-1);
    expect(medida.right, `painel ultrapassa a tela: ${JSON.stringify(medida)}`).toBeLessThanOrEqual(
      medida.vp + 1
    );
    await ctx.close();
  });
  test('campo de data/mês respeita a largura do container', async ({ browser }) => {
    // No iOS, input[type=date] e [type=month] com aparência NATIVA se medem
    // pelo conteúdo e ignoram `width:100%`. Em português o mês por extenso é
    // longo ("setembro de 2026"), então o campo saía do cartão do modal e
    // sangrava para fora — o "Quando começar?" cortado no cadastro de sonho.
    //
    // O Chromium não reproduz esse dimensionamento, então este teste guarda a
    // PRÉ-CONDIÇÃO em vez do sintoma: `appearance: none` é o que faz o iOS
    // tratar o campo como caixa comum e respeitar a largura. A prova de que a
    // relação é essa estava no próprio app — o campo de data do painel de
    // lançamento já tinha `appearance:none` e nunca teve o problema.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto('/Appliquei_v13.0.html');
    await page.waitForTimeout(1200);
    await revelarTudo(page);

    const nativos = await page.evaluate(() => {
      const ruins = [];
      document.querySelectorAll('input[type="date"], input[type="month"]').forEach((el) => {
        const cs = getComputedStyle(el);
        const nativo = cs.appearance !== 'none' && cs.webkitAppearance !== 'none';
        if (nativo) ruins.push({ id: el.id || el.name || el.type, appearance: cs.appearance });
      });
      return ruins;
    });

    expect(
      nativos,
      `Campos de data/mês com aparência nativa. No iOS eles se medem pelo ` +
        `conteúdo e estouram o container: ${JSON.stringify(nativos)}`
    ).toEqual([]);
    await ctx.close();
  });

  test('o modal de sonho cabe na tela do telemóvel', async ({ browser }) => {
    // Modais não entravam na varredura das abas, e foi por um modal que o
    // campo de mês escapou.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto('/Appliquei_v13.0.html');
    await page.waitForTimeout(1200);
    const fora = await page.evaluate(() => {
      const g = document.getElementById('authGate');
      if (g) g.style.display = 'none';
      document
        .querySelectorAll('[id*="rimeirosPassos"]')
        .forEach((e) => (e.style.display = 'none'));
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('ativa'));
      document.getElementById('meus_sonhos').classList.add('ativa');
      window.abrirCadastroSonho();

      const W = document.documentElement.clientWidth;
      const ruins = [];
      document.querySelectorAll('#modalSonho *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || !el.getClientRects().length) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= W + 1 || r.left >= W) return;
        const p = el.parentElement;
        if (p && p.getBoundingClientRect().right > W + 1) return;
        ruins.push({ id: el.id || el.tagName.toLowerCase(), excesso: Math.round(r.right - W) });
      });
      return ruins.slice(0, 5);
    });
    expect(fora, `Conteúdo do modal de sonho passando da borda: ${JSON.stringify(fora)}`).toEqual(
      []
    );
    await ctx.close();
  });
});
