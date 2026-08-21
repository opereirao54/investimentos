'use strict';

// Filtro por categoria da aba Info Mercado.
//
// O ponto que sustenta a feature: a API de notícias continua sendo UMA só.
// Quem separa "Bancos" de "Criptomoedas" é a classificação no cliente, então
// é ela que precisa de rede de proteção — um filtro que rotula errado é pior
// do que não ter filtro, porque a pessoa marca "Bancos" e some notícia de
// banco da tela sem nenhum aviso.
//
// Os casos cobrem, além do óbvio:
//  - multi-rótulo (uma notícia pode ser Empresas + Mercado + Brasil);
//  - "Banco Central" NÃO virar notícia de Bancos (a armadilha da palavra
//    "banco" solta);
//  - casamento por palavra inteira (nada de "bb" achado dentro de "abbott");
//  - as duas fontes fortes de rótulo: `categories` do feed e a seção da URL.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ARQUIVO = 'web/appliquei-aba-info-mercado.js';

function makeDeadNode() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => makeDeadNode(),
    querySelectorAll: () => [],
    innerHTML: '',
    textContent: '',
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
  };
}

// Sandbox mínimo: o módulo é classic script, só toca DOM dentro das funções
// de render — o que estes testes não exercitam.
function carregar(opcoes) {
  const cfg = opcoes || {};
  const elementos = cfg.elementos || {};
  const win = {
    document: {
      getElementById: (id) => elementos[id] || null,
      querySelectorAll: () => [],
      createElement: () => makeDeadNode(),
    },
    localStorage: cfg.localStorage || makeStorage(),
    fetch: cfg.fetch || (async () => ({ json: async () => ({ status: 'error' }) })),
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Promise,
    Error,
    isNaN,
    encodeURIComponent,
    Intl,
  };
  win.window = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, ARQUIVO), 'utf8'), ctx, { filename: ARQUIVO });
  return win;
}

const win = carregar();
// O vm tem realm próprio: um array criado lá dentro NÃO compartilha protótipo
// com o do teste, e assert.deepEqual (strict) reprova por isso. Array.from
// traz o valor de volta para o realm do teste antes de comparar.
const classificar = (n) => Array.from(win.imClassificar(n));
const noticia = (title, extra) => Object.assign({ title, link: '', categories: [] }, extra || {});

// ---- normalização -----------------------------------------------------

test('imNormalizar tira acento, HTML e pontuação, e cerca com espaço', () => {
  assert.equal(win.imNormalizar('<p>Inflação &amp; Juros!</p>'), ' inflacao juros ');
  assert.equal(win.imNormalizar(null), ' ');
  assert.equal(win.imNormalizar('   '), '  ');
});

test('imTemTermo casa palavra inteira, não pedaço de palavra', () => {
  const texto = win.imNormalizar('Abbott e Bancoop anunciam acordo');
  assert.equal(win.imTemTermo(texto, 'bb'), false);
  assert.equal(win.imTemTermo(texto, 'banco'), false);
  assert.equal(win.imTemTermo(win.imNormalizar('Banco do Brasil (BB) lucra mais'), 'bb'), true);
});

test('imTemTermo aceita o plural simples em "s"', () => {
  const texto = win.imNormalizar('Bancos digitais crescem');
  assert.equal(win.imTemTermo(texto, 'banco'), true);
});

// ---- classificação por palavra-chave ----------------------------------

test('notícia de banco cai em Bancos', () => {
  const cats = classificar(noticia('Itaú e Bradesco elevam lucro do trimestre'));
  assert.ok(cats.includes('bancos'), cats.join(','));
});

test('"Banco Central" é Economia, e NÃO entra em Bancos', () => {
  const cats = classificar(noticia('Banco Central mantém a Selic em 10,5% ao ano'));
  assert.ok(cats.includes('economia'), cats.join(','));
  assert.ok(!cats.includes('bancos'), 'Banco Central não é notícia de banco: ' + cats.join(','));
});

test('notícia de cripto cai em Criptomoedas', () => {
  const cats = classificar(noticia('Bitcoin renova máxima histórica após aval do ETF'));
  assert.ok(cats.includes('cripto'), cats.join(','));
});

test('notícia de política cai em Política', () => {
  const cats = classificar(noticia('Câmara dos Deputados aprova PEC em segundo turno'));
  assert.ok(cats.includes('politica'), cats.join(','));
});

test('notícia de investimento pessoal cai em Investimentos', () => {
  const cats = classificar(noticia('Os FIIs que mais pagaram dividendos em janeiro'));
  assert.ok(cats.includes('investimentos'), cats.join(','));
});

test('notícia internacional cai em Mundo, e não em Brasil', () => {
  // Com o link real: a editoria "Mercados" do InfoMoney cobre Nova York
  // tanto quanto a B3, então ela sozinha não pode carimbar Brasil.
  const cats = classificar(
    noticia('Fed sinaliza corte de juros nos Estados Unidos', {
      link: 'https://www.infomoney.com.br/mercados/fed-juros/',
      categories: ['Mercados'],
    })
  );
  assert.ok(cats.includes('mundo'), cats.join(','));
  assert.ok(cats.includes('mercado'), cats.join(','));
  assert.ok(!cats.includes('brasil'), 'notícia do Fed entrou em Brasil: ' + cats.join(','));
});

test('"crédito ao setor imobiliário" na China não vira notícia de Bancos', () => {
  const cats = classificar(
    noticia('China anuncia pacote de estímulo', {
      description: 'O pacote inclui crédito ao setor imobiliário.',
    })
  );
  assert.ok(!cats.includes('bancos'), cats.join(','));
  assert.ok(classificar(noticia('Bancos ampliam a carteira de crédito')).includes('bancos'));
});

test('notícia doméstica cai em Brasil', () => {
  const cats = classificar(noticia('IPCA do Brasil desacelera em março, aponta o IBGE'));
  assert.ok(cats.includes('brasil'), cats.join(','));
});

test('uma notícia pode ter vários rótulos ao mesmo tempo', () => {
  const cats = classificar(noticia('Petrobras dispara na B3 após decisão do Copom'));
  for (const esperado of ['empresas', 'mercado', 'brasil']) {
    assert.ok(cats.includes(esperado), `faltou ${esperado} em ${cats.join(',')}`);
  }
});

test('notícia sem tema reconhecível fica sem rótulo (só aparece em Todos)', () => {
  assert.deepEqual(classificar(noticia('Receita de bolo de fubá da vovó')), []);
});

test('o resumo também alimenta a classificação, não só o título', () => {
  const cats = classificar(
    noticia('Confira os destaques do dia', {
      description: '<p>O <b>Ibovespa</b> fechou em alta puxado pelo minério de ferro.</p>',
    })
  );
  assert.ok(cats.includes('mercado'), cats.join(','));
});

// ---- armadilhas de palavra ambígua ------------------------------------
//
// Cada caso abaixo já rotulou errado numa passada real do feed. São palavras
// que existem em dois mundos: "política monetária" (economia) x "política"
// (partidária), "safra" (agro) x "Banco Safra", "vale a pena" (verbo) x
// "Vale" (mineradora). Sem estes testes o filtro volta a mentir em silêncio.

test('"Política Monetária" não transforma notícia de juros em Política', () => {
  const cats = classificar(
    noticia('Copom mantém a Selic', {
      description: 'O Comitê de Política Monetária decidiu por unanimidade.',
    })
  );
  assert.ok(cats.includes('economia'), cats.join(','));
  assert.ok(!cats.includes('politica'), 'política monetária virou Política: ' + cats.join(','));
});

test('"política de dividendos" também não vira Política', () => {
  const cats = classificar(noticia('Empresa revisa política de dividendos para 2027'));
  assert.ok(!cats.includes('politica'), cats.join(','));
});

test('notícia partidária de verdade continua caindo em Política', () => {
  const cats = classificar(noticia('Senado aprova indicação do novo ministro do STF'));
  assert.ok(cats.includes('politica'), cats.join(','));
});

test('"Bolsa Família" não vira notícia de bolsa de valores', () => {
  const cats = classificar(noticia('Bolsa Família terá reajuste no próximo mês'));
  assert.ok(!cats.includes('mercado'), 'programa social virou Mercado: ' + cats.join(','));
});

test('"safra" de grãos não vira notícia de banco', () => {
  const cats = classificar(noticia('Safra recorde de grãos derruba preço da soja'));
  assert.ok(!cats.includes('bancos'), cats.join(','));
  assert.ok(classificar(noticia('Banco Safra amplia carteira de crédito')).includes('bancos'));
});

test('"vale a pena" não vira notícia da Vale', () => {
  const cats = classificar(noticia('Vale a pena investir em CDB de banco médio?'));
  assert.ok(!cats.includes('empresas'), 'verbo virou mineradora: ' + cats.join(','));
  assert.ok(classificar(noticia('Vale (VALE3) fecha acordo bilionário')).includes('empresas'));
});

test('"meta" de inflação não vira notícia da Meta Platforms', () => {
  const cats = classificar(noticia('Inflação fecha o ano acima da meta do Banco Central'));
  assert.ok(!cats.includes('empresas'), cats.join(','));
});

test('imRemoverTrechos limpa até ocorrências coladas', () => {
  const texto = win.imNormalizar('banco central banco central sobe juros');
  const limpo = win.imRemoverTrechos(texto, ['banco central']);
  assert.equal(limpo.indexOf('banco central'), -1, limpo);
  assert.ok(limpo.includes('sobe juros'));
});

test('imRemoverTrechos sem lista devolve o texto intacto', () => {
  assert.equal(win.imRemoverTrechos(' abc ', []), ' abc ');
  assert.equal(win.imRemoverTrechos(' abc ', null), ' abc ');
});

// ---- sinais fortes: editoria do feed e seção da URL --------------------

test('editoria declarada pelo feed vira rótulo', () => {
  const cats = classificar(
    noticia('Título neutro sem palavra-chave', { categories: ['Economia'] })
  );
  assert.ok(cats.includes('economia'), cats.join(','));
});

test('seção da URL vira rótulo mesmo com título neutro', () => {
  const cats = classificar(
    noticia('Título neutro sem palavra-chave', {
      link: 'https://www.infomoney.com.br/politica/algum-texto/',
    })
  );
  assert.ok(cats.includes('politica'), cats.join(','));
});

test('imSecaoDaUrl pega a primeira pasta e ignora query/hash', () => {
  assert.equal(win.imSecaoDaUrl('https://www.infomoney.com.br/mercados/x/?utm=1#a'), 'mercados');
  assert.equal(win.imSecaoDaUrl(''), '');
});

test('rótulos saem na ordem do catálogo, sem "todos" e sem repetição', () => {
  const cats = classificar(
    noticia('Bitcoin e Ibovespa sobem com o Copom no Brasil', { categories: ['Mercados'] })
  );
  assert.ok(!cats.includes('todos'));
  assert.deepEqual(cats, [...new Set(cats)], 'não pode repetir rótulo');
  const ordemCatalogo = Array.from(win.IM_CATEGORIAS, (c) => c.id).filter((id) =>
    cats.includes(id)
  );
  assert.deepEqual(cats, ordemCatalogo);
});

// ---- higiene do catálogo de regras ------------------------------------

test('nenhuma regra tem termo repetido ou fora do formato normalizado', () => {
  for (const regra of win.IM_REGRAS) {
    const termos = Array.from(regra.termos);
    const vistos = new Set();
    for (const termo of termos) {
      assert.ok(!vistos.has(termo), `termo repetido em ${regra.id}: "${termo}"`);
      vistos.add(termo);
      // Termos são comparados contra texto já normalizado: acento, maiúscula
      // ou hífen no catálogo viram termo que nunca casa com nada.
      assert.equal(
        win.imNormalizar(termo).trim(),
        termo,
        `termo fora do formato normalizado em ${regra.id}: "${termo}"`
      );
    }
    for (const trecho of Array.from(regra.remover)) {
      assert.equal(win.imNormalizar(trecho).trim(), trecho, `remover fora do formato: "${trecho}"`);
    }
  }
});

test('toda regra aponta para uma categoria do catálogo, e vice-versa', () => {
  const doCatalogo = new Set(Array.from(win.IM_CATEGORIAS, (c) => c.id));
  const comRegra = new Set(Array.from(win.IM_REGRAS, (r) => r.id));
  for (const id of comRegra) assert.ok(doCatalogo.has(id), `regra órfã: ${id}`);
  for (const id of doCatalogo) {
    if (id !== 'todos') assert.ok(comRegra.has(id), `categoria sem regra: ${id}`);
  }
});

test('mapa de seção só aponta para categorias que existem', () => {
  const doCatalogo = new Set(Array.from(win.IM_CATEGORIAS, (c) => c.id));
  for (const chave of Object.keys(win.IM_MAPA_SECAO)) {
    for (const id of Array.from(win.IM_MAPA_SECAO[chave])) {
      assert.ok(doCatalogo.has(id), `seção "${chave}" aponta para categoria inexistente: ${id}`);
    }
  }
});

// ---- preparo do item --------------------------------------------------

test('imPrepararNoticia limpa HTML do resumo e corta no limite do card', () => {
  const item = win.imPrepararNoticia({
    title: 'Ibovespa hoje',
    link: 'https://exemplo.com/mercados/a/',
    description: '<p>' + 'palavra '.repeat(60) + '</p>',
    pubDate: '2026-03-10 14:30:00',
  });
  assert.ok(!item.resumo.includes('<'), 'resumo não pode ter HTML');
  assert.ok(item.resumo.length <= 161, 'resumo longo demais: ' + item.resumo.length);
  assert.ok(item.resumo.endsWith('…'));
  assert.ok(item.ts > 0);
});

test('imPrepararNoticia aguenta pubDate ausente ou inválido', () => {
  assert.equal(win.imPrepararNoticia({ title: 'x' }).ts, 0);
  assert.equal(win.imPrepararNoticia({ title: 'x', pubDate: 'ontem de tarde' }).ts, 0);
});

test('imPrepararNoticia não quebra com item vazio', () => {
  const item = win.imPrepararNoticia(undefined);
  assert.deepEqual(
    { titulo: item.titulo, link: item.link, cats: Array.from(item.cats) },
    { titulo: '', link: '', cats: [] }
  );
});

// ---- filtro em memória ------------------------------------------------

function comAcervo(itens) {
  const w = carregar();
  w.imNoticias = itens.map(w.imPrepararNoticia);
  return w;
}

const ACERVO = [
  { title: 'Itaú lucra mais no trimestre', pubDate: '2026-03-10 10:00:00' },
  { title: 'Bitcoin dispara acima de US$ 100 mil', pubDate: '2026-03-11 10:00:00' },
  { title: 'Banco Central mantém a Selic', pubDate: '2026-03-12 10:00:00' },
  { title: 'Receita de bolo de fubá', pubDate: '2026-03-13 10:00:00' },
];

test('categoria "todos" devolve tudo; categoria específica só o que casa', () => {
  const w = comAcervo(ACERVO);
  w.imCategoriaAtiva = 'todos';
  assert.equal(w.imNoticiasFiltradas().length, 4);
  w.imCategoriaAtiva = 'bancos';
  const bancos = w.imNoticiasFiltradas();
  assert.equal(bancos.length, 1);
  assert.equal(bancos[0].titulo, 'Itaú lucra mais no trimestre');
});

test('lista filtrada sai da mais recente para a mais antiga', () => {
  const w = comAcervo(ACERVO);
  w.imCategoriaAtiva = 'todos';
  const ts = w.imNoticiasFiltradas().map((n) => n.ts);
  assert.deepEqual(
    ts,
    [...ts].sort((a, b) => b - a)
  );
});

test('contagem por categoria soma o multi-rótulo e bate com o filtro', () => {
  const w = comAcervo(ACERVO);
  const contas = w.imContagemPorCategoria();
  assert.equal(contas.todos, 4);
  assert.equal(contas.bancos, 1);
  assert.equal(contas.cripto, 1);
  for (const cat of w.IM_CATEGORIAS) {
    if (cat.id === 'todos') continue;
    w.imCategoriaAtiva = cat.id;
    assert.equal(
      w.imNoticiasFiltradas().length,
      contas[cat.id],
      `contador de ${cat.id} não bate com o filtro`
    );
  }
});

// ---- preferência do usuário -------------------------------------------

test('filtrar grava a preferência para o assunto sobreviver ao reload', () => {
  const store = makeStorage();
  const w = carregar({ localStorage: store });
  w.filtrarNoticiasPorCategoria('cripto');
  assert.equal(store.getItem('futurorico_infoMercadoCategoria'), 'cripto');
  assert.equal(w.imCategoriaAtiva, 'cripto');
  assert.equal(w.imLerPreferencia(), 'cripto');
});

test('categoria desconhecida (ou lixo no storage) cai em "todos"', () => {
  const store = makeStorage();
  const w = carregar({ localStorage: store });
  w.filtrarNoticiasPorCategoria('nao-existe');
  assert.equal(w.imCategoriaAtiva, 'todos');
  store.setItem('futurorico_infoMercadoCategoria', 'categoria-morta');
  assert.equal(w.imLerPreferencia(), 'todos');
});

test('trocar de categoria não vai à rede', async () => {
  let chamadas = 0;
  const w = carregar({
    fetch: async () => {
      chamadas++;
      return { json: async () => ({ status: 'error' }) };
    },
  });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.filtrarNoticiasPorCategoria('bancos');
  w.filtrarNoticiasPorCategoria('cripto');
  assert.equal(chamadas, 0, 'filtro de categoria não pode disparar request');
});

// ---- carga, cache e falha de rede -------------------------------------

function respostaFeed(items) {
  return { json: async () => ({ status: 'ok', items }) };
}

test('carregarNoticias guarda o feed em cache fora do prefixo sincronizado', async () => {
  const store = makeStorage();
  const w = carregar({ localStorage: store, fetch: async () => respostaFeed(ACERVO) });
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 4);
  const cache = JSON.parse(store.getItem('im_noticias_cache_v1'));
  assert.equal(cache.items.length, 4);
  // Payload de notícia não pode entrar na fila do cloud-sync (shouldSyncKey
  // pega tudo que começa com futurorico_ / appliquei_).
  assert.ok(!/^(futurorico_|appliquei_)/.test('im_noticias_cache_v1'));
});

test('segunda visita à aba usa o cache fresco em vez de bater na API', async () => {
  const store = makeStorage();
  let chamadas = 0;
  const w = carregar({
    localStorage: store,
    fetch: async () => {
      chamadas++;
      return respostaFeed(ACERVO);
    },
  });
  await w.carregarNoticias(true);
  assert.equal(chamadas, 1);
  w.imNoticias = []; // simula recarregar a página com o cache ainda quente
  await w.carregarNoticias();
  assert.equal(chamadas, 1, 'cache fresco não deve gerar novo request');
  assert.equal(w.imNoticias.length, 4);
});

test('"Atualizar" ignora o cache e busca de novo', async () => {
  const store = makeStorage();
  let chamadas = 0;
  const w = carregar({
    localStorage: store,
    fetch: async () => {
      chamadas++;
      return respostaFeed(ACERVO);
    },
  });
  await w.carregarNoticias(true);
  await w.carregarNoticias(true);
  assert.equal(chamadas, 2);
});

test('feed com status de erro não apaga o que já estava em cache', async () => {
  const store = makeStorage();
  const bom = carregar({ localStorage: store, fetch: async () => respostaFeed(ACERVO) });
  await bom.carregarNoticias(true);

  const ruim = carregar({
    localStorage: store,
    fetch: async () => ({ json: async () => ({ status: 'error' }) }),
  });
  await ruim.carregarNoticias(true);
  assert.equal(ruim.imNoticias.length, 4, 'deveria cair no cache antigo');
  assert.ok(/sem conex/i.test(ruim.imAvisoCache), ruim.imAvisoCache);
});

test('sem rede e sem cache, a aba entra em estado de erro em vez de girar para sempre', async () => {
  const elementos = {
    'container-noticias': makeDeadNode(),
    'loader-noticias': makeDeadNode(),
    'filtros-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
  const w = carregar({
    elementos,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  await w.carregarNoticias(true);
  assert.equal(elementos['loader-noticias'].style.display, 'none', 'loader tem que parar');
  assert.ok(/Tentar de novo/.test(elementos['container-noticias'].innerHTML));
});

// ---- render -----------------------------------------------------------

test('título de notícia é escapado antes de virar HTML', () => {
  const w = carregar();
  const html = w.imCardHtml(
    w.imPrepararNoticia({
      title: '<img src=x onerror=alert(1)>',
      pubDate: '2026-03-10 10:00:00',
      link: 'https://exemplo.com/a/',
    })
  );
  assert.ok(!html.includes('<img src=x'), 'título entrou cru no HTML');
  assert.ok(html.includes('&lt;img'), html.slice(0, 200));
});

test('link fora de http(s) não vira href — o card inteiro é clicável', () => {
  const w = carregar();
  for (const ruim of [
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    ' JaVaScRiPt:x',
  ]) {
    const html = w.imCardHtml(w.imPrepararNoticia({ title: 'x', link: ruim, pubDate: '' }));
    assert.ok(!html.includes('<a '), `virou link: ${ruim}`);
    assert.ok(!html.includes('href='), `href sobrou: ${ruim}`);
    assert.ok(html.includes('<article class="im-card">'));
    assert.ok(!html.includes('Ler matéria'), 'sem link não pode prometer leitura');
  }
});

test('link http(s) normal continua virando <a> com rel seguro', () => {
  const w = carregar();
  const html = w.imCardHtml(
    w.imPrepararNoticia({ title: 'x', link: 'https://www.infomoney.com.br/a/', pubDate: '' })
  );
  assert.ok(html.includes('href="https://www.infomoney.com.br/a/"'), html.slice(0, 160));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('target="_blank"'));
});

test('card mostra no máximo duas tags e resume o resto em "+N"', () => {
  const w = carregar();
  const item = w.imPrepararNoticia({
    title: 'Petrobras dispara na B3 após decisão do Copom no Brasil',
    pubDate: '2026-03-10 10:00:00',
  });
  assert.ok(item.cats.length > 2, 'caso de teste precisa de 3+ rótulos: ' + item.cats.join(','));
  const html = w.imCardHtml(item);
  const tags = html.match(/class="im-tag"/g) || [];
  assert.equal(tags.length, 2);
  assert.ok(html.includes('im-tag-mais'));
});

test('chips trazem todas as categorias, com contador e o ativo marcado', () => {
  const alvo = makeDeadNode();
  const w = carregar({ elementos: { 'filtros-noticias': alvo } });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.imCategoriaAtiva = 'bancos';
  w.imRenderizarChips();
  // (?: [^"]*)? e não [^"]* — senão o contador (class="im-chip-num") entraria na conta.
  const botoes = alvo.innerHTML.match(/class="im-chip(?: [^"]*)?"/g) || [];
  assert.equal(botoes.length, w.IM_CATEGORIAS.length);
  assert.ok(/data-cat="bancos" aria-pressed="true"/.test(alvo.innerHTML));
  assert.ok(/class="im-chip ativo" data-cat="bancos"/.test(alvo.innerHTML));
  // Categoria sem notícia fica marcada como vazia, mas continua na lista.
  assert.ok(/im-chip vazio" data-cat="politica"/.test(alvo.innerHTML));
});

test('categoria sem resultado mostra saída para "ver todas", não tela morta', () => {
  const elementos = {
    'container-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
  const w = carregar({ elementos });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.imCategoriaAtiva = 'politica';
  w.imRenderizarLista();
  const html = elementos['container-noticias'].innerHTML;
  assert.ok(/Nada em Política/.test(html), html);
  assert.ok(/filtrarNoticiasPorCategoria\('todos'\)/.test(html));
});

test('lista pagina e o botão "carregar mais" some no fim', () => {
  const elementos = {
    'container-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
  const w = carregar({ elementos });
  w.imNoticias = Array.from({ length: 14 }, (_, i) =>
    w.imPrepararNoticia({ title: 'Ibovespa fecha o pregão ' + i, pubDate: '2026-03-10 10:00:00' })
  );
  w.imCategoriaAtiva = 'todos';
  w.imRenderizarLista();
  assert.equal(
    (elementos['container-noticias'].innerHTML.match(/class="im-card"/g) || []).length,
    9
  );
  assert.equal(elementos['mais-noticias'].style.display, 'flex');

  w.imCarregarMais();
  assert.equal(
    (elementos['container-noticias'].innerHTML.match(/class="im-card"/g) || []).length,
    14
  );
  assert.equal(elementos['mais-noticias'].style.display, 'none');
});

// ---- contrato com a tela ----------------------------------------------

test('IDs usados pelo JS existem no HTML da aba', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  for (const id of [
    'filtros-noticias',
    'resumo-noticias',
    'loader-noticias',
    'container-noticias',
    'mais-noticias',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `#${id} sumiu do HTML`);
  }
});

test('handlers chamados pelo HTML são funções globais do script', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  const w = carregar();
  for (const fn of ['carregarNoticias', 'atualizarNoticias', 'filtrarNoticiasPorCategoria']) {
    assert.equal(typeof w[fn], 'function', `${fn} não é global`);
  }
  assert.ok(html.includes('onclick="atualizarNoticias()"'));
  assert.ok(html.includes("mudarAba(event,'noticias', carregarNoticias)"));
});

test('cada categoria do catálogo tem cor definida no CSS da página', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Appliquei_v13.0.html'), 'utf8');
  const w = carregar();
  for (const cat of w.IM_CATEGORIAS) {
    if (cat.id === 'todos') continue; // usa o par padrão de .im-chip/.im-tag
    assert.ok(
      html.includes(`.im-chip[data-cat="${cat.id}"]`),
      `sem cor no tema claro para ${cat.id}`
    );
    assert.ok(
      html.includes(`body.dark .im-chip[data-cat="${cat.id}"]`),
      `sem cor no tema escuro para ${cat.id}`
    );
  }
});
