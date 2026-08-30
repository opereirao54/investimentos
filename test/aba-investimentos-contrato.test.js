'use strict';

// Contrato da aba "Meus investimentos" (#patrimonio).
//
// A aba foi redesenhada por inteiro — layout, CSS e hierarquia mudaram. Os
// MOTORES não: quem calcula carteira, evolução, dividendos e patrimônio
// continua exatamente o mesmo código. O acoplamento entre os dois é uma lista
// de ids que o JS escreve e de handlers que o HTML chama; um id perdido no
// meio de uma remodelagem some sem erro (getElementById devolve null, o render
// desiste no primeiro `if (!el) return`) e o número simplesmente não aparece.
//
// Este teste é a rede: a lista abaixo é o inventário levantado ANTES do
// redesenho. Mexer no layout é livre; remover um destes ids ou handlers, não.
//
// Companheiro de drawer-operacao-dom.test.js, que faz o inverso (garante que
// o JS não referencia id inexistente).

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');

function secaoPatrimonio() {
  const ini = HTML.indexOf('<section id="patrimonio"');
  assert.ok(ini > -1, 'a seção #patrimonio tem de existir');
  // Fecha na próxima abertura de <section (as seções são irmãs no HTML).
  const prox = HTML.indexOf('<section id="', ini + 10);
  return HTML.slice(ini, prox > -1 ? prox : HTML.length);
}

const SECAO = secaoPatrimonio();
const IDS = new Set(Array.from(SECAO.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));

// ---------------------------------------------------------------------------
// Ids que os motores escrevem/leem. Agrupados por quem os consome, para que a
// falha aponte o render que quebraria.
// ---------------------------------------------------------------------------
const IDS_POR_MOTOR = {
  'KPIs e gráfico de evolução (aba1-charts.js)': [
    'resumoPatrimonio',
    'resumoRentabilidade',
    'resumoRentabilidadeBadge',
    'iconResumoRent',
    'resumoInvestido',
    'kpiInvestidoDesde',
    'tituloRendimento',
    'resumoRendimento',
    'resumoDividendosAcum',
    'resumoDividendosPeriodo',
    'graficoEvolucaoCarteira',
    'legendaEvolucao',
    'msgEvolucaoVazia',
    'filtroEvolucaoTipo',
    'filtroEvolucaoAtivo',
  ],
  'Distribuição da carteira (donut)': [
    'graficoDistribuicaoCarteira',
    'donutCenter',
    'distMaiorPos',
    'distMaiorDetalhe',
    'legendaDistribuicao',
    'msgDistribuicaoVazia',
  ],
  'Próximo evento (previdencia.js)': [
    'cardProximoEvento',
    'tituloProximoEvento',
    'iconAbrirDividendosMes',
    'resumoProximoEvento',
    'resumoProximoEventoDetalhe',
  ],
  'Sub-abas (app.js mudarSubAbaPatrimonio)': [
    'subAbaCarteira',
    'subAbaOperacoes',
    'subAbaDividendos',
    'subtabBtnCarteira',
    'subtabBtnOperacoes',
    'subtabBtnDividendos',
    'subtabMiniStat',
    'filtrosCategoria',
    'btnAtualizarDividendos',
  ],
  'Carteira (rich rows)': [
    'richRowsContainer',
    'carteiraVaziaMsg',
    'avisoRentabilidadeRF',
    'tabelaCarteira',
    'tabelaCarteiraCorpo',
  ],
  'Operações (timeline, renda-fixa.js)': [
    'timelineContainer',
    'operacoesVaziaMsg',
    'opsSummary',
    'opsToolbar',
    'filtroOperacoesTicker',
  ],
  'Dividendos (aba-dividendos.js)': [
    'bannerDividendosAviso',
    'chkIncluirEncerradas',
    'dividendosTotal',
    'dividendos12m',
    'dividendosYOC',
    'dividendosMedia',
    'graficoDividendosMensal',
    'msgDivChartVazio',
    'divRanking',
    'tabelaDividendosCorpo',
    'dividendosVaziaMsg',
    'chipFiltroPagamentos',
    'filtroPagamentosLabel',
    'tabelaPagamentosCorpo',
    'pagamentosVaziaMsg',
  ],
  Diversos: ['badgePrecosEstimados'],
};

for (const [motor, ids] of Object.entries(IDS_POR_MOTOR)) {
  test(`${motor}: os ids continuam na aba`, () => {
    const faltando = ids.filter((id) => !IDS.has(id));
    assert.deepEqual(
      faltando,
      [],
      `ids sumiram da seção #patrimonio: ${faltando.join(', ')}.\n` +
        `O motor segue calculando, mas getElementById devolve null e o valor não ` +
        `chega à tela — falha silenciosa. Reponha o elemento no novo layout.`
    );
  });
}

// ---------------------------------------------------------------------------
// Ações que o usuário precisa continuar conseguindo disparar.
// ---------------------------------------------------------------------------
const ACOES = [
  ['registrar operação', /abrirDrawerOperacao\(\)/],
  ['trocar para a sub-aba Carteira', /mudarSubAbaPatrimonio\('carteira'\)/],
  ['trocar para a sub-aba Operações', /mudarSubAbaPatrimonio\('operacoes'\)/],
  ['trocar para a sub-aba Dividendos', /mudarSubAbaPatrimonio\('dividendos'\)/],
  ['filtrar carteira por Tudo', /filtrarCarteiraPorCategoria\(''\)/],
  ['filtrar carteira por Renda Variável', /filtrarCarteiraPorCategoria\('renda_variavel'\)/],
  ['filtrar carteira por Renda Fixa', /filtrarCarteiraPorCategoria\('renda_fixa'\)/],
  ['filtrar carteira por Previdência', /filtrarCarteiraPorCategoria\('previdencia'\)/],
  ['filtrar carteira por Reserva', /filtrarCarteiraPorCategoria\('reserva_emergencia'\)/],
  ['filtrar operações: todos', /filtrarOpsTimeline\('todos', this\)/],
  ['filtrar operações: compras', /filtrarOpsTimeline\('compra', this\)/],
  ['filtrar operações: vendas', /filtrarOpsTimeline\('venda', this\)/],
  ['buscar operação por ticker', /renderizarOperacoes\(\)/],
  ['exportar operações em CSV', /exportarOperacoesCSV\(\)/],
  ['atualizar dividendos', /carregarDividendos\(true\)/],
  ['incluir posições encerradas', /carregarDividendos\(\)/],
  ['limpar filtro de pagamentos', /alternarFiltroPagamentosTicker\(''\)/],
  ['re-renderizar evolução ao trocar filtro', /renderizarGraficoEvolucao\(\)/],
];
for (const meses of [1, 3, 6, 12, 0]) {
  ACOES.push([
    `período do gráfico: ${meses || 'tudo'}`,
    new RegExp(`setPeriodoEvolucao\\(${meses}\\)`),
  ]);
}

test('todas as ações da aba continuam disparáveis pelo HTML', () => {
  const perdidas = ACOES.filter(([, re]) => !re.test(SECAO)).map(([nome]) => nome);
  assert.deepEqual(
    perdidas,
    [],
    `ações que ficaram sem gatilho no HTML: ${perdidas.join(' · ')}.\n` +
      `A função continua no bundle, mas nada na tela a chama — a funcionalidade ` +
      `sumiu para o usuário.`
  );
});

test('os cinco chips de categoria carregam o data-cat que filtrarCarteiraPorCategoria marca', () => {
  // filtrarCarteiraPorCategoria acende o chip ativo por [data-cat="..."].
  // Sem o atributo o filtro funciona mas nenhum chip fica marcado.
  for (const cat of ['', 'renda_variavel', 'renda_fixa', 'previdencia', 'reserva_emergencia']) {
    assert.match(
      SECAO,
      new RegExp(`data-cat="${cat}"`),
      `chip de categoria "${cat || 'tudo'}" sem data-cat`
    );
  }
});

test('as pílulas de período carregam o data-periodo que setPeriodoEvolucao marca', () => {
  for (const p of [1, 3, 6, 12, 0]) {
    assert.match(
      SECAO,
      new RegExp(`data-periodo="${p}"`),
      `pílula de período ${p} sem data-periodo`
    );
  }
});

test('os chips de filtro de operações carregam data-ops-filtro', () => {
  for (const f of ['todos', 'compra', 'venda']) {
    assert.match(
      SECAO,
      new RegExp(`data-ops-filtro="${f}"`),
      `chip de operações "${f}" sem atributo`
    );
  }
});

// ---------------------------------------------------------------------------
// Classes que o JS procura por querySelector — mudar de nome quebra em silêncio.
// ---------------------------------------------------------------------------
test('as classes usadas por querySelector no JS sobrevivem ao novo layout', () => {
  const CLASSES = [
    ['.ops-chip', 'filtrarOpsTimeline apaga o "ativo" dos irmãos por esta classe'],
    ['.chip-cat', 'filtrarCarteiraPorCategoria acende o chip por esta classe'],
    ['.period-pill', 'setPeriodoEvolucao acende a pílula por esta classe'],
  ];
  const faltando = CLASSES.filter(
    ([c]) =>
      !SECAO.includes(`class="${c.slice(1)}`) &&
      !SECAO.includes(`${c.slice(1)}"`) &&
      !SECAO.includes(`${c.slice(1)} `)
  ).map(([c, porque]) => `${c} (${porque})`);
  assert.deepEqual(faltando, [], `classes ausentes: ${faltando.join(' · ')}`);
});
