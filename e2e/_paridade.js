'use strict';

// Paridade desktop × celular — a lógica do teste e2e/paridade-mobile.spec.js.
//
// Regra do produto: NÃO pode existir funcionalidade que só se usa no
// computador. O celular ganhou layout próprio (barra inferior, abas,
// carrosséis, folhas), e cada uma dessas mudanças esconde ou move coisas;
// basta um `display: none` descuidado para uma ação virar "só web".
//
// Como a trava funciona: abre cada tela nos dois tamanhos, percorre os
// estados que revelam conteúdo (abas internas, blocos recolhíveis, detalhes
// de ativo, formulários e janelas) e coleta toda ação visível. A chave de
// uma ação é a função que ela chama (onclick/onchange/oninput); sem função,
// o id; sem id, o texto. Toda chave vista no desktop precisa aparecer no
// celular — ou estar em EQUIVALENTES, com o caminho que a substitui.

const ABAS = [
  'controle',
  'meu_patrimonio',
  'patrimonio',
  'carteira',
  'relatorio_mensal',
  'simulador',
  'meus_sonhos',
  'aulas',
  'noticias',
  'applicash',
  'duvidas_sugestoes',
];

/** Estados visitados NOS DOIS tamanhos: abas internas e modos de cada tela. */
const ESTADOS = {
  patrimonio: [
    "mudarSubAbaPatrimonio('carteira')",
    "mudarSubAbaPatrimonio('operacoes')",
    "mudarSubAbaPatrimonio('dividendos')",
    "mudarSubAbaPatrimonio('futuro')",
  ],
  duvidas_sugestoes: [
    "trocarTabDuvidas('faq')",
    "trocarTabDuvidas('sugestao')",
    "trocarTabDuvidas('regulamento')",
    "trocarTabDuvidas('privacidade')",
  ],
  simulador: ["mudarModoSim('projetar')", "mudarModoSim('meta')"],
};

/** Estados que só existem no celular: as abas que a casca de app criou. */
const ESTADOS_MOB = {
  controle: [
    "mobSegControle('resumo')",
    "mobSegControle('extrato')",
    "mobSegControle('projecao')",
    "mobSegControle('projecao'); mobDreAlternarTabela()",
    // Os avisos de "O que notamos" abrem em tela cheia, com o cartão do desktop.
    "mobSegControle('resumo'); mobStoryAbrir(0)",
    // "Hoje" só aparece fora do mês corrente (no mês corrente não faria nada).
    'mobStoryFechar(); mudarMesVisao(1)',
    'irParaMesAtual()',
  ],
  // Os cartões de banco/corretora abrem com as ações (Transferir, Extrato, Editar).
  meu_patrimonio: [
    'mobPatAbrirCarteira(0)',
    'mpToggleExtrato(0)',
    // Contas e bens abrem as ações ao toque na linha.
    "contas.length && mobListaAbrir('conta', String(contas[0].id))",
    "bens.length && mobListaAbrir('bem', String(bens[0].id))",
  ],
  // O questionário mostra uma pergunta por vez; o plano abre item a item.
  carteira: [
    'mobCartIrPasso(2)',
    'mobCartIrPasso(3)',
    'mobCartIrPasso(4)',
    'mobCartAbrirItem(0)',
    // Ranking, simulação, critérios e procedência ficam atrás de uma linha.
    "['rank', 'sim', 'crit', 'dados'].forEach((n) => mobCartSecao(n, true))",
  ],
};

/**
 * Formulários e janelas: o DOM é o mesmo nos dois tamanhos, mas o CSS do
 * celular pode esconder algo lá dentro. [aba, como abrir, raiz].
 */
const OVERLAYS = [
  ['controle', 'abrirPainelLancamento()', '#painelNovoLancamento'],
  ['patrimonio', 'abrirDrawerOperacao()', '#drawerOperacao'],
  ['controle', 'abrirModalConfig()', '#modalConfiguracoes'],
  ['meus_sonhos', 'abrirCadastroSonho()', '#modalSonho'],
  ['meu_patrimonio', 'abrirNovoBemForm()', '#modalBem'],
  ['meu_patrimonio', 'abrirNovaContaForm()', '#formNovaConta'],
];

/**
 * Ações que o celular alcança por outro caminho. Cada entrada diz QUAL, para
 * que ninguém use esta lista para silenciar uma perda de verdade.
 */
const EQUIVALENTES = {
  'fn:abrirPainelLancamento':
    'no celular o "Novo lançamento" largo sai do Controle; o "+" da barra inferior abre o menu de cadastro → Lançamento (cadastrarEm → abrirPainelLancamento)',
  'fn:alternarPainelVencimentos':
    'no celular os vencimentos ficam sempre abertos, em "Próximos dias" (carrossel do Início): não há o que recolher; Baixar e Ver fatura estão em cada cartão',
};

/** Roda NA PÁGINA: coleta as ações visíveis sob `raizSel` (default: a aba ativa). */
function coletarNaPagina(raizSel) {
  const raiz = raizSel ? document.querySelector(raizSel) : document.querySelector('.section.ativa');
  if (!raiz) return { '!raiz-ausente': 1 };
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  };
  const out = {};
  raiz
    .querySelectorAll(
      'button, a, input:not([type=hidden]), select, textarea, [onclick], [role=button], summary'
    )
    .forEach((el) => {
      // As ações do extrato no celular moram num painel revelado por deslize
      // (ou toque): estão no DOM e a um gesto de distância.
      const porGesto = !!el.closest('#extratoUnificado [id^="acao-pagar-list-"]');
      if (!porGesto && !visivel(el)) return;
      const oc = (
        el.getAttribute('onclick') ||
        el.getAttribute('onchange') ||
        el.getAttribute('oninput') ||
        ''
      )
        .replace(/event\.(stopPropagation|preventDefault)\(\)\s*;?/g, '')
        .replace(/^\s*if\s*\([^)]*\)\s*/, '');
      const fn = (oc.match(/([A-Za-z_$][\w$]*)\s*\(/) || [])[1];
      const chave = fn
        ? 'fn:' + fn
        : el.id
          ? '#' + el.id.replace(/\d{6,}/g, 'N')
          : el.tagName +
            ':' +
            (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30);
      out[chave] = (out[chave] || 0) + 1;
    });
  return out;
}

/** Roda NA PÁGINA: abre tudo que é recolhível na aba ativa. */
function abrirRecolhiveisNaPagina() {
  const sec = document.querySelector('.section.ativa');
  if (!sec) return;
  sec.querySelectorAll('details').forEach((d) => (d.open = true));
  sec.querySelectorAll('[data-aberto]').forEach((d) => (d.dataset.aberto = '1'));
  sec.querySelectorAll('.rich-expand').forEach((d) => d.classList.add('aberto'));
}

/** Roda NA PÁGINA: troca de aba pelo botão da sidebar (o caminho real). */
function irParaAbaNaPagina(aba) {
  const btn = Array.from(document.querySelectorAll('#mainSidebar .menu-btn')).find((b) =>
    (b.getAttribute('onclick') || '').includes("'" + aba + "'")
  );
  if (btn) btn.click();
}

/**
 * Percorre todas as telas e janelas num `page` já aberto e pronto.
 * `modo` é 'desk' ou 'mob'; `recarregar` volta a página ao estado inicial
 * entre uma janela e outra (cada uma deixa o DOM sujo).
 */
async function percorrer(page, modo, recarregar) {
  const rel = {};
  for (const aba of ABAS) {
    await page.evaluate(irParaAbaNaPagina, aba);
    await page.waitForTimeout(600);
    await page.evaluate(abrirRecolhiveisNaPagina);
    const estados = [null].concat(ESTADOS[aba] || [], modo === 'mob' ? ESTADOS_MOB[aba] || [] : []);
    const acc = {};
    for (const e of estados) {
      if (e) {
        await page.evaluate(e);
        await page.waitForTimeout(300);
        await page.evaluate(abrirRecolhiveisNaPagina);
      }
      Object.assign(acc, await page.evaluate(coletarNaPagina, null));
    }
    rel[aba] = acc;
  }
  for (const [aba, abre, raiz] of OVERLAYS) {
    await page.evaluate(irParaAbaNaPagina, aba);
    await page.waitForTimeout(400);
    await page.evaluate(abre);
    await page.waitForTimeout(450);
    rel['janela ' + raiz] = await page.evaluate(coletarNaPagina, raiz);
    await recarregar();
  }
  return rel;
}

/** Compara os dois relatórios: o que o desktop tem e o celular não alcança. */
function soNoDesktop(desk, mob) {
  const faltas = [];
  for (const lugar of Object.keys(desk)) {
    for (const chave of Object.keys(desk[lugar])) {
      if (mob[lugar] && chave in mob[lugar]) continue;
      if (EQUIVALENTES[chave]) continue;
      faltas.push(lugar + ' → ' + chave);
    }
  }
  return faltas;
}

module.exports = {
  ABAS,
  ESTADOS,
  ESTADOS_MOB,
  OVERLAYS,
  EQUIVALENTES,
  coletarNaPagina,
  abrirRecolhiveisNaPagina,
  irParaAbaNaPagina,
  percorrer,
  soNoDesktop,
};
