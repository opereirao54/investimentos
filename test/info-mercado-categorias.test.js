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
    fetch: cfg.fetch || (async () => ({ ok: true, json: async () => ({ status: 'error' }) })),
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

// ---- HTML do feed que vaza para o card --------------------------------

test('atributo com HTML dentro não vaza para o resumo do card', () => {
  // Forma real do feed: o WordPress do InfoMoney põe <p>…</p> DENTRO do
  // atributo. Um /<[^>]*>/ encerra a tag no ">" do atributo e despeja o
  // resto como texto — foi o que apareceu no card em produção.
  const desc =
    '<figure><img src="a.jpg" data-image-caption="<p>Wall Street em alta. ' +
    'Imagem gerada com uso de IA</p>" data-image-title="Wall Street">' +
    '</figure><p>Texto de verdade da matéria.</p>';
  const resumo = win.imNormalizarResumo(desc);
  assert.equal(resumo, 'Texto de verdade da matéria.');
  assert.ok(!resumo.includes('data-image'), resumo);
  assert.ok(!resumo.includes('"'), resumo);
});

test('o mesmo lixo de atributo não entra na classificação', () => {
  // imNormalizar alimenta as regras: atributo vazado viraria palavra-chave.
  const texto = win.imNormalizar('<img data-image-caption="<p>x</p>" alt="banco">ok');
  assert.equal(texto.indexOf('data'), -1, texto);
  assert.equal(texto.indexOf('caption'), -1, texto);
  assert.equal(texto.trim(), 'ok');
});

test('imTirarTags aguenta tag sem fechar e texto sem tag nenhuma', () => {
  assert.equal(win.imTirarTags('sem tag aqui'), 'sem tag aqui');
  assert.equal(win.imTirarTags('antes <div class="x" ').trim(), 'antes');
  assert.equal(win.imTirarTags('').trim(), '');
  assert.equal(win.imTirarTags(null).trim(), '');
});

test('entidade escapada não é confundida com tag', () => {
  // Tags saem antes de as entidades serem decodificadas; na ordem inversa
  // "&lt;b&gt;" viraria tag de verdade e sumiria do resumo.
  assert.equal(
    win.imNormalizarResumo('alta de &lt;b&gt;5%&lt;/b&gt; hoje'),
    'alta de <b>5%</b> hoje'
  );
});

// ---- lugar com nome de país -------------------------------------------

test('"Jardim Europa" não vira notícia do Mundo', () => {
  const cats = classificar(
    noticia('Casa é vendida por R$ 6,7 milhões', {
      description: 'O imóvel fica no Jardim Europa, em São Paulo.',
    })
  );
  assert.ok(!cats.includes('mundo'), 'bairro paulistano virou Mundo: ' + cats.join(','));
  assert.ok(cats.includes('brasil'), cats.join(','));
});

test('Europa de verdade continua caindo em Mundo', () => {
  assert.ok(
    classificar(noticia('Banco Central Europeu corta juros na zona do euro')).includes('mundo')
  );
  assert.ok(classificar(noticia('Governo francês aprova orçamento')).includes('mundo'));
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
      return { ok: true, json: async () => ({ status: 'error' }) };
    },
  });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.filtrarNoticiasPorCategoria('bancos');
  w.filtrarNoticiasPorCategoria('cripto');
  assert.equal(chamadas, 0, 'filtro de categoria não pode disparar request');
});

// ---- carga, cache e falha de rede -------------------------------------

function respostaFeed(items) {
  return { ok: true, json: async () => ({ status: 'ok', items }) };
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

test('atualizarNoticias devolve a promise da busca', async () => {
  const espiao = espionarFetch([['rss2json', () => ok(ITENS_OK)]]);
  const w = carregar({ fetch: espiao.fetch });
  const p = w.atualizarNoticias();
  assert.ok(p && typeof p.then === 'function', 'atualizarNoticias não devolveu promise');
  await p;
  assert.equal(w.imNoticias.length, 1, 'promise resolveu antes de a busca terminar');
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
    fetch: async () => ({ ok: true, json: async () => ({ status: 'error' }) }),
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

// ---- cadeia de fontes -------------------------------------------------
//
// A aba já caiu inteira em produção por causa de um parâmetro a mais na URL
// do rss2json: sem api_key, `count` faz o serviço responder 200 com
// status "error", e a tela virou "não deu para falar com o feed". Daí as
// duas travas: a URL não pode ganhar parâmetro novo por descuido, e uma
// fonte fora do ar não pode derrubar a aba.

function espionarFetch(rotas) {
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    for (const [trecho, resposta] of rotas) {
      if (String(url).includes(trecho)) return resposta();
    }
    throw new Error('rota não simulada: ' + url);
  };
  return { fetch, chamadas };
}

const ITENS_OK = [
  {
    title: 'Ibovespa fecha em alta',
    link: 'https://ex.com/mercados/a/',
    pubDate: '',
    categories: [],
  },
];
const ok = (items) => ({ ok: true, json: async () => ({ status: 'ok', items }) });

test('URL do rss2json não leva "count" — sem api_key ele derruba a aba', async () => {
  const espiao = espionarFetch([['rss2json', () => ok(ITENS_OK)]]);
  const w = carregar({ fetch: espiao.fetch });
  await w.carregarNoticias(true);
  const url = espiao.chamadas.map((c) => c.url).find((u) => u.includes('rss2json'));
  assert.ok(url, 'rss2json nem foi chamado');
  assert.ok(!/[?&]count=/.test(url), 'count voltou para a URL: ' + url);
  assert.ok(url.includes('rss_url='), url);
});

test('sem sessão, cai direto no rss2json em vez de falhar', async () => {
  const espiao = espionarFetch([['rss2json', () => ok(ITENS_OK)]]);
  const w = carregar({ fetch: espiao.fetch });
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 1);
  assert.ok(!espiao.chamadas.some((c) => c.url.includes('/api/market')));
});

test('com sessão, tenta a API própria primeiro e nem chama o terceiro', async () => {
  const espiao = espionarFetch([['/api/market', () => ok(ITENS_OK)]]);
  const w = carregar({ fetch: espiao.fetch });
  w.firebase = { auth: () => ({ currentUser: { getIdToken: async () => 'tok-123' } }) };
  await w.carregarNoticias(true);
  const nossa = espiao.chamadas.find((c) => c.url.includes('/api/market'));
  assert.ok(nossa, 'API própria não foi tentada');
  assert.equal(nossa.opcoes.headers.Authorization, 'Bearer tok-123');
  assert.ok(!espiao.chamadas.some((c) => c.url.includes('rss2json')), 'não devia usar o fallback');
  assert.equal(w.imNoticias.length, 1);
});

test('API própria fora do ar: o rss2json assume e a aba continua de pé', async () => {
  const espiao = espionarFetch([
    ['/api/market', () => ({ ok: false, status: 502, json: async () => ({}) })],
    ['rss2json', () => ok(ITENS_OK)],
  ]);
  const w = carregar({ fetch: espiao.fetch });
  w.firebase = { auth: () => ({ currentUser: { getIdToken: async () => 'tok' } }) };
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 1, 'fallback não entrou');
  assert.equal(w.imUltimoErro, '');
});

test('as duas fontes fora: erro guarda o motivo de cada uma', async () => {
  const elementos = {
    'container-noticias': makeDeadNode(),
    'loader-noticias': makeDeadNode(),
    'filtros-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
  const espiao = espionarFetch([
    ['/api/market', () => ({ ok: false, status: 401, json: async () => ({}) })],
    // Exatamente a forma como o rss2json reprova `count` sem api_key.
    [
      'rss2json',
      () => ({ ok: true, json: async () => ({ status: 'error', message: 'API key required' }) }),
    ],
  ]);
  const w = carregar({ elementos, fetch: espiao.fetch });
  w.firebase = { auth: () => ({ currentUser: { getIdToken: async () => 'tok' } }) };
  await w.carregarNoticias(true);
  assert.match(w.imUltimoErro, /api: http_401/);
  assert.match(w.imUltimoErro, /rss2json: API key required/);
  // O motivo tem que chegar à tela — um print do erro precisa ser acionável.
  assert.match(elementos['container-noticias'].innerHTML, /http_401/);
  assert.match(elementos['container-noticias'].innerHTML, /Tentar de novo/);
});

test('token que estoura não derruba a busca — segue para o fallback', async () => {
  const espiao = espionarFetch([['rss2json', () => ok(ITENS_OK)]]);
  const w = carregar({ fetch: espiao.fetch });
  w.firebase = {
    auth: () => {
      throw new Error('auth ainda não inicializou');
    },
  };
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 1);
});

// ---- categoria zerada: por quê? ---------------------------------------
//
// "Criptomoedas 0" tem duas causas possíveis e opostas: não saiu matéria do
// assunto, ou a rota daquele assunto no servidor não respondeu. Sem separar
// as duas, um slug trocado no site vira um zero mudo na tela e ninguém
// descobre.

function elementosDeTela() {
  return {
    'container-noticias': makeDeadNode(),
    'loader-noticias': makeDeadNode(),
    'filtros-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
}

test('fonte que caiu chega do servidor e fica registrada', async () => {
  const w = carregar({
    fetch: async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        items: ITENS_OK,
        feedsFailed: [{ id: 'cripto', error: '/criptomoedas/feed/: http_404' }],
      }),
    }),
  });
  w.firebase = { auth: () => ({ currentUser: { getIdToken: async () => 'tok' } }) };
  await w.carregarNoticias(true);
  assert.equal(Array.from(w.imFontesFalhas).length, 1);
  assert.ok(w.imFonteCaiuPara('cripto'), 'não reconheceu a fonte caída');
  assert.equal(w.imFonteCaiuPara('bancos'), null);
});

test('categoria vazia POR FALTA DE NOTÍCIA explica que o feed é rotativo', () => {
  const elementos = elementosDeTela();
  const w = carregar({ elementos });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.imCategoriaAtiva = 'politica';
  w.imRenderizarLista();
  const html = elementos['container-noticias'].innerHTML;
  assert.match(html, /feed é rotativo/);
  assert.ok(!/não respondeu/.test(html), 'não pode culpar a fonte sem motivo');
});

test('categoria vazia POR FONTE CAÍDA diz isso, e mostra o motivo técnico', () => {
  const elementos = elementosDeTela();
  const w = carregar({ elementos });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.imFontesFalhas = [{ id: 'cripto', error: '/criptomoedas/feed/: http_404' }];
  w.imCategoriaAtiva = 'cripto';
  // ACERVO tem uma notícia de bitcoin; tiramos para a categoria zerar.
  w.imNoticias = w.imNoticias.filter((n) => n.cats.indexOf('cripto') === -1);
  w.imRenderizarLista();
  const html = elementos['container-noticias'].innerHTML;
  assert.match(html, /Nada em Criptomoedas/);
  assert.match(html, /não respondeu/, 'a tela precisa distinguir falha de fonte');
  assert.match(html, /http_404/, 'o motivo técnico tem que aparecer');
  assert.ok(!/feed é rotativo/.test(html), 'não pode dar a explicação errada');
});

test('uma fonte caída não contamina a explicação das outras categorias', () => {
  const elementos = elementosDeTela();
  const w = carregar({ elementos });
  w.imNoticias = ACERVO.map(w.imPrepararNoticia);
  w.imFontesFalhas = [{ id: 'cripto', error: 'http_404' }];
  w.imCategoriaAtiva = 'politica';
  w.imRenderizarLista();
  assert.match(elementos['container-noticias'].innerHTML, /feed é rotativo/);
});

test('carga nova zera o registro de falhas da carga anterior', async () => {
  const w = carregar({
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok', items: ITENS_OK }) }),
  });
  w.imFontesFalhas = [{ id: 'cripto', error: 'http_404' }];
  await w.carregarNoticias(true);
  assert.equal(Array.from(w.imFontesFalhas).length, 0, 'falha velha não pode grudar');
});

test('token vem do AppliqueiFirebase, como no resto do app', async () => {
  const espiao = espionarFetch([['/api/market', () => ok(ITENS_OK)]]);
  const w = carregar({ fetch: espiao.fetch });
  // Sem o global `firebase` — só o objeto que o app de fato publica.
  w.AppliqueiFirebase = { ready: true, auth: { currentUser: { getIdToken: async () => 'tk' } } };
  await w.carregarNoticias(true);
  const nossa = espiao.chamadas.find((c) => c.url.includes('/api/market'));
  assert.ok(nossa, 'a API própria não foi usada — cairia no feed principal só');
  assert.equal(nossa.opcoes.headers.Authorization, 'Bearer tk');
});

// ---- acervo acumulado -------------------------------------------------
//
// O feed do InfoMoney devolve só as últimas horas. Se cada carga
// substituísse a anterior, "Política" e "Mundo" ficariam quase sempre em
// zero e o filtro que a aba promete não teria o que mostrar. Por isso as
// cargas se acumulam — mesma fonte, mesma quantidade de requests.

const HORA = 3600 * 1000;
const horasAtras = (h) => new Date(Date.now() - h * HORA).toISOString();

function feedComItens(itens) {
  return { ok: true, json: async () => ({ status: 'ok', items: itens }) };
}

function itemFeed(title, link, pubDate, extra) {
  return Object.assign({ title, link, pubDate, categories: [] }, extra || {});
}

test('segunda carga soma ao acervo em vez de substituir', async () => {
  const store = makeStorage();
  let lote = [
    itemFeed('Ibovespa fecha em alta', 'https://ex.com/mercados/a/', horasAtras(3)),
    itemFeed('Bitcoin sobe forte', 'https://ex.com/criptomoedas/b/', horasAtras(4)),
  ];
  const w = carregar({ localStorage: store, fetch: async () => feedComItens(lote) });
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 2);

  // O feed rodou: manchetes novas entraram, as antigas saíram da janela dele.
  lote = [
    itemFeed('Senado aprova projeto', 'https://ex.com/politica/c/', horasAtras(1)),
    itemFeed('Itaú divulga balanço', 'https://ex.com/negocios/d/', horasAtras(2)),
  ];
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 4, 'a carga anterior não pode ser jogada fora');
  const titulos = w.imNoticias.map((n) => n.titulo);
  assert.ok(titulos.includes('Bitcoin sobe forte'), titulos.join(' | '));
  assert.ok(titulos.includes('Senado aprova projeto'), titulos.join(' | '));
});

test('acúmulo dá massa para uma categoria que uma carga só deixaria vazia', async () => {
  const store = makeStorage();
  let lote = [itemFeed('Ibovespa fecha em alta', 'https://ex.com/mercados/a/', horasAtras(5))];
  const w = carregar({ localStorage: store, fetch: async () => feedComItens(lote) });
  await w.carregarNoticias(true);
  w.imCategoriaAtiva = 'politica';
  assert.equal(w.imNoticiasFiltradas().length, 0, 'nada de política ainda');

  lote = [itemFeed('Senado aprova projeto de lei', 'https://ex.com/politica/c/', horasAtras(1))];
  await w.carregarNoticias(true);
  w.imCategoriaAtiva = 'politica';
  assert.equal(w.imNoticiasFiltradas().length, 1);
  w.imCategoriaAtiva = 'todos';
  assert.equal(w.imNoticiasFiltradas().length, 2);
});

test('notícia repetida entre cargas não duplica na tela', async () => {
  const store = makeStorage();
  let lote = [itemFeed('Ibovespa fecha em alta', 'https://ex.com/mercados/a/', horasAtras(3))];
  const w = carregar({ localStorage: store, fetch: async () => feedComItens(lote) });
  await w.carregarNoticias(true);
  // Mesma matéria, agora com utm e barra final — é o mesmo link.
  lote = [
    itemFeed('Ibovespa fecha em alta', 'https://ex.com/mercados/a?utm_source=x', horasAtras(3)),
  ];
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 1, 'link com query virou notícia diferente');
});

test('na repetição vence a versão que acabou de chegar do feed', () => {
  const w = carregar();
  const antigo = [
    w.imPrepararNoticia(
      itemFeed('Título com erro de digitacao', 'https://ex.com/a/', horasAtras(3))
    ),
  ];
  const novo = [
    w.imPrepararNoticia(itemFeed('Título corrigido', 'https://ex.com/a/', horasAtras(3))),
  ];
  const junto = w.imMesclar(antigo, novo);
  assert.equal(junto.length, 1);
  assert.equal(junto[0].titulo, 'Título corrigido');
});

test('acervo velho envelhece e sai, mas carga nova entra mesmo com data estranha', () => {
  const w = carregar();
  const velho = [
    w.imPrepararNoticia(
      itemFeed('Notícia de duas semanas atrás', 'https://ex.com/velha/', horasAtras(24 * 14))
    ),
  ];
  assert.equal(w.imMesclar(velho, []).length, 0, 'notícia de 14 dias deveria sair do acervo');

  // Mesma data, mas vinda AGORA do feed: entra. Data esquisita da fonte não
  // pode esvaziar a aba.
  const recemChegada = [
    w.imPrepararNoticia(
      itemFeed('Chegou agora com data velha', 'https://ex.com/nova/', horasAtras(24 * 14))
    ),
  ];
  assert.equal(w.imMesclar([], recemChegada).length, 1);
});

test('acervo respeita o teto e guarda as mais recentes', () => {
  const w = carregar();
  const muitos = [];
  for (let i = 0; i < w.IM_MAX_ACERVO + 30; i++) {
    muitos.push(
      w.imPrepararNoticia(
        itemFeed('Notícia ' + i, 'https://ex.com/n' + i + '/', horasAtras(i * 0.5))
      )
    );
  }
  const junto = w.imMesclar([], muitos);
  assert.equal(junto.length, w.IM_MAX_ACERVO);
  assert.equal(junto[0].titulo, 'Notícia 0', 'a mais recente tem que sobrar');
  // Array.from: junto vem do vm, e deepEqual (strict) compara protótipo.
  const ts = Array.from(junto, (n) => n.ts);
  assert.deepEqual(
    ts,
    [...ts].sort((a, b) => b - a)
  );
});

test('item sem título é descartado em vez de virar card vazio', () => {
  const w = carregar();
  const junto = w.imMesclar([], [w.imPrepararNoticia({ link: 'https://ex.com/x/' })]);
  assert.equal(junto.length, 0);
});

// ---- cache: forma compacta e reclassificação --------------------------

test('cache guarda a forma enxuta, sem o rótulo calculado', async () => {
  const store = makeStorage();
  const w = carregar({
    localStorage: store,
    fetch: async () =>
      feedComItens([
        itemFeed('Bitcoin dispara', 'https://ex.com/criptomoedas/a/', horasAtras(2), {
          description: '<p>A <b>criptomoeda</b> subiu.</p>',
          categories: ['Criptomoedas'],
        }),
      ]),
  });
  await w.carregarNoticias(true);
  const salvo = JSON.parse(store.getItem('im_noticias_cache_v1'));
  assert.deepEqual(Object.keys(salvo.items[0]).sort(), ['d', 'e', 'l', 'r', 't']);
  assert.equal(salvo.items[0].r.indexOf('<'), -1, 'resumo salvo sem HTML');
  assert.deepEqual(Array.from(salvo.items[0].e), ['Criptomoedas']);
  const bruto = store.getItem('im_noticias_cache_v1');
  assert.ok(!bruto.includes('cats'), 'rótulo não deve ser congelado no cache');
});

test('acervo salvo é reclassificado na leitura, com as regras da versão atual', async () => {
  const store = makeStorage();
  const w = carregar({
    localStorage: store,
    fetch: async () =>
      feedComItens([
        itemFeed('Título neutro', 'https://ex.com/x/', horasAtras(2), {
          categories: ['Criptomoedas'],
        }),
      ]),
  });
  await w.carregarNoticias(true);
  // Sessão nova lendo o mesmo storage: o rótulo tem que ser recalculado.
  const w2 = carregar({ localStorage: store });
  const cache = w2.imLerCache();
  assert.equal(cache.items.length, 1);
  assert.ok(Array.from(cache.items[0].cats).includes('cripto'), 'reclassificação não rodou');
  assert.equal(cache.items[0].titulo, 'Título neutro');
});

test('localStorage cheio não derruba a aba — grava metade e segue', async () => {
  let cheio = true;
  const store = makeStorage();
  const original = store.setItem;
  store.setItem = (k, v) => {
    // Estoura só na primeira tentativa (acervo inteiro); a metade passa.
    if (k === 'im_noticias_cache_v1' && cheio) {
      cheio = false;
      throw new Error('QuotaExceededError');
    }
    return original(k, v);
  };
  const itens = [];
  for (let i = 0; i < 10; i++) {
    itens.push(itemFeed('Notícia ' + i, 'https://ex.com/n' + i + '/', horasAtras(i)));
  }
  const w = carregar({ localStorage: store, fetch: async () => feedComItens(itens) });
  await w.carregarNoticias(true);
  assert.equal(w.imNoticias.length, 10, 'a tela não perde nada quando o cache falha');
  assert.equal(JSON.parse(store.getItem('im_noticias_cache_v1')).items.length, 5);
});

test('acervo salvo aparece na tela enquanto a rede ainda responde', async () => {
  const store = makeStorage();
  const semear = carregar({
    localStorage: store,
    fetch: async () =>
      feedComItens([itemFeed('Notícia guardada', 'https://ex.com/a/', horasAtras(2))]),
  });
  await semear.carregarNoticias(true);

  const elementos = {
    'container-noticias': makeDeadNode(),
    'loader-noticias': makeDeadNode(),
    'filtros-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
  let renderizouAntes = null;
  const w = carregar({
    localStorage: store,
    elementos,
    fetch: async () => {
      // No instante do request, o acervo antigo já tem que estar na tela.
      renderizouAntes = elementos['container-noticias'].innerHTML;
      return feedComItens([itemFeed('Notícia nova', 'https://ex.com/b/', horasAtras(1))]);
    },
  });
  await w.carregarNoticias(true);
  assert.ok(/Notícia guardada/.test(renderizouAntes || ''), 'tela ficou vazia esperando a rede');
  assert.equal(elementos['loader-noticias'].style.display, 'none');
  assert.equal(w.imNoticias.length, 2);
});

test('resumo diz quando o acervo foi atualizado', async () => {
  const elementos = {
    'container-noticias': makeDeadNode(),
    'loader-noticias': makeDeadNode(),
    'filtros-noticias': makeDeadNode(),
    'resumo-noticias': makeDeadNode(),
    'mais-noticias': makeDeadNode(),
  };
  const w = carregar({
    elementos,
    fetch: async () => feedComItens([itemFeed('Notícia', 'https://ex.com/a/', horasAtras(1))]),
  });
  await w.carregarNoticias(true);
  assert.ok(
    /atualizado agora/.test(elementos['resumo-noticias'].innerHTML),
    elementos['resumo-noticias'].innerHTML
  );
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
