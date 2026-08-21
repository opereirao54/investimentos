/**
 * Appliquei — ABA 6: Info Mercado (radar de notícias com filtro por categoria).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script. Sem deps
 * em app.js — só fetch + DOM. Pode carregar antes ou depois.
 *
 * COMO O FILTRO FUNCIONA
 * ----------------------
 * A fonte continua sendo UMA só (o feed RSS do InfoMoney via rss2json). Não
 * existe uma API por categoria: o que existe é uma etapa de CLASSIFICAÇÃO no
 * cliente. Cada notícia que chega recebe zero ou mais rótulos ("economia",
 * "bancos", "criptomoedas"...) e os chips da tela só escondem/mostram o que
 * já está em memória. Trocar de categoria não dispara request nenhum.
 *
 * A classificação combina três sinais, do mais confiável para o mais amplo:
 *   1. `categories` do próprio feed (o InfoMoney publica as editorias);
 *   2. a seção na URL da matéria (…/economia/…, …/mercados/…);
 *   3. palavras-chave no título + resumo.
 * Uma notícia pode cair em várias categorias ao mesmo tempo — "Petrobras
 * dispara após decisão do Copom" é Empresas + Mercado financeiro + Brasil.
 * Notícia que não casa com nada continua aparecendo em "Todos".
 */

// --- ABA 6: INFO MERCADO ---

// Fonte única de notícias (o feed do InfoMoney), alcançada por dois
// caminhos. `/api/market?op=news` busca o RSS do nosso próprio servidor:
// sem CORS, sem cota de terceiro. O rss2json fica de rede de segurança
// para quando a nossa function estiver fora ou o token tiver expirado.
//
// NÃO passe `count` para o rss2json: sem api_key ele responde status
// "error" e a aba inteira cai — foi exatamente assim que ela quebrou.
var IM_FEED_URL = 'https://www.infomoney.com.br/feed/';
var IM_API_BASE = 'https://api.rss2json.com/v1/api.json';
var IM_API_PROPRIA = '/api/market?op=news';

// Cache do feed. Prefixo propositalmente FORA de futurorico_/appliquei_ para
// o cloud-sync não empurrar payload de notícia pro Firestore (ver
// shouldSyncKey em appliquei-cloud-sync.js).
var IM_CACHE_KEY = 'im_noticias_cache_v1';
var IM_CACHE_TTL_MS = 15 * 60 * 1000;

// Teto e validade do acervo acumulado. O feed do InfoMoney só devolve as
// últimas horas — com 10 categorias, uma carga isolada deixaria "Política"
// e "Mundo" quase sempre em zero. Guardando as cargas anteriores, cada
// categoria junta massa ao longo dos dias sem UMA chamada a mais.
var IM_MAX_ACERVO = 90;
var IM_JANELA_DIAS = 7;

// Preferência de categoria. Esta SIM usa o prefixo sincronizado: o assunto
// que a pessoa acompanha deve viajar junto com ela entre celular e PC.
var IM_PREF_KEY = 'futurorico_infoMercadoCategoria';

// Quantos cards por "página" antes do botão "Carregar mais".
var IM_PAGINA = 9;

// Catálogo de categorias. `id` é o valor persistido — não renomeie sem
// migração. `cor` alimenta os data-cat no CSS (chips e tags dos cards).
var IM_CATEGORIAS = [
  { id: 'todos', label: 'Todos', icone: 'ph-squares-four' },
  { id: 'economia', label: 'Economia', icone: 'ph-chart-line-up' },
  { id: 'politica', label: 'Política', icone: 'ph-scales' },
  { id: 'mercado', label: 'Mercado financeiro', icone: 'ph-chart-line' },
  { id: 'bancos', label: 'Bancos', icone: 'ph-bank' },
  { id: 'investimentos', label: 'Investimentos', icone: 'ph-trend-up' },
  { id: 'empresas', label: 'Empresas', icone: 'ph-buildings' },
  { id: 'cripto', label: 'Criptomoedas', icone: 'ph-currency-btc' },
  { id: 'brasil', label: 'Brasil', icone: 'ph-flag' },
  { id: 'mundo', label: 'Mundo', icone: 'ph-globe-hemisphere-west' },
];

// Sinal 1 — editorias que o próprio feed manda em `categories`, e sinal 2 —
// primeira pasta da URL da matéria. Os dois caem no mesmo mapa porque o
// InfoMoney usa os mesmos slugs nos dois lugares.
var IM_MAPA_SECAO = {
  economia: ['economia'],
  politica: ['politica'],
  poder: ['politica'],
  mercados: ['mercado'],
  mercado: ['mercado'],
  'onde-investir': ['investimentos'],
  'onde investir': ['investimentos'],
  investimentos: ['investimentos'],
  'minhas-financas': ['investimentos'],
  'minhas financas': ['investimentos'],
  negocios: ['empresas'],
  business: ['empresas'],
  empresas: ['empresas'],
  consumo: ['empresas'],
  carreira: ['empresas'],
  'do-zero-ao-topo': ['investimentos'],
  'do zero ao topo': ['investimentos'],
  'me-poupe': ['investimentos'],
  criptomoedas: ['cripto'],
  cripto: ['cripto'],
  'bolsa-de-valores': ['mercado'],
  'bolsa de valores': ['mercado'],
  ibovespa: ['mercado', 'brasil'],
  'renda-fixa': ['investimentos'],
  'renda fixa': ['investimentos'],
  'fundos-imobiliarios': ['investimentos'],
  'fundos imobiliarios': ['investimentos'],
  imposto: ['economia', 'brasil'],
  tudo: [],
};

// Armadilhas do verbo "vale". "Vale a pena investir em X?" é manchete
// comum no feed e NÃO é notícia da mineradora — sem esta lista, metade da
// aba viraria "Empresas".
var IM_VALE_AMBIGUO = [
  'vale a pena',
  'nao vale',
  'vale lembrar',
  'vale destacar',
  'vale dizer',
  'vale ressaltar',
  'vale notar',
  'vale mais',
  'vale menos',
  'vale refeicao',
  'vale alimentacao',
  'vale transporte',
  'vale tudo',
];

// Sinal 3 — palavras-chave. `remover` tira do texto expressões ambíguas
// ANTES de procurar os termos daquela categoria: sem isso "Banco Central
// sobe juros" viraria notícia de Bancos por causa da palavra "banco".
var IM_REGRAS = [
  {
    id: 'economia',
    remover: [],
    termos: [
      'inflacao',
      'deflacao',
      'ipca',
      'igp m',
      'inpc',
      'pib',
      'selic',
      'copom',
      'juros',
      'taxa basica',
      'politica monetaria',
      'aperto monetario',
      'desemprego',
      'desocupacao',
      'caged',
      'salario minimo',
      'cesta basica',
      'custo de vida',
      'poder de compra',
      'balanca comercial',
      'superavit',
      'deficit',
      'fiscal',
      'arcabouco',
      'orcamento',
      'tesouro nacional',
      'divida publica',
      'atividade economica',
      'ibc br',
      'boletim focus',
      'cpi',
      'banco central',
      'bancos centrais',
      'fed',
      'fomc',
      'recessao',
      'crescimento economico',
      'economia',
      'pacote de corte',
      'imposto de renda',
      'reforma tributaria',
      'cambio',
      'dolar',
      'euro',
    ],
  },
  {
    id: 'politica',
    // "Comitê de Política Monetária", "política de dividendos": a palavra
    // "política" aparece muito mais em contexto econômico do que partidário.
    remover: [
      'politica monetaria',
      'politica economica',
      'politica fiscal',
      'politica cambial',
      'politica comercial',
      'politica de dividendos',
      'politica de precos',
      'politica de privacidade',
      'politicas publicas',
    ],
    termos: [
      'eleicao',
      'eleicoes',
      'eleitoral',
      'congresso',
      'senado',
      'camara dos deputados',
      'deputado',
      'deputados',
      'senador',
      'senadores',
      'planalto',
      'governo federal',
      'governo lula',
      'lula',
      'ministro',
      'ministra',
      'ministerio',
      'stf',
      'supremo',
      'tse',
      'tcu',
      'comissao parlamentar',
      'pec',
      'medida provisoria',
      'projeto de lei',
      'relator',
      'oposicao',
      'base aliada',
      'impeachment',
      'votacao no congresso',
      'reforma administrativa',
      'reforma tributaria',
      'sancao presidencial',
      'veto',
      'trump',
      'casa branca',
      'biden',
      'geopolitica',
      'sancoes',
      'tarifaco',
      'politica',
    ],
  },
  {
    id: 'mercado',
    remover: ['bolsa familia', 'bolsa de estudos', 'bolsa auxilio', 'bolsa de valores social'],
    termos: [
      'ibovespa',
      'ibov',
      'bolsa',
      'b3',
      'pregao',
      'dow jones',
      'nasdaq',
      's p 500',
      'sp500',
      'wall street',
      'futuros',
      'volatilidade',
      'circuit breaker',
      'commodities',
      'minerio de ferro',
      'petroleo',
      'brent',
      'ouro',
      'acoes',
      'papeis',
      'ticker',
      'mercado financeiro',
      'mercados',
      'abertura do mercado',
      'fechamento do mercado',
      'radar do mercado',
      'day trade',
      'analise tecnica',
      'liquidez',
      'derivativos',
      'small caps',
      'blue chips',
    ],
  },
  {
    id: 'bancos',
    remover: ['banco central', 'bancos centrais', 'banco mundial', 'banco de dados'],
    termos: [
      'banco',
      'bancos',
      'bancario',
      'bancaria',
      'itau',
      'itausa',
      'bradesco',
      'santander',
      'banco do brasil',
      'bb',
      'caixa economica',
      'nubank',
      'nu holdings',
      'btg',
      'btg pactual',
      'banco inter',
      'c6 bank',
      'banco safra',
      'banrisul',
      'abc brasil',
      'febraban',
      'basileia',
      'spread bancario',
      'inadimplencia',
      'carteira de credito',
      'credito bancario',
      'credito imobiliario',
      'credito consignado',
      'oferta de credito',
      'concessao de credito',
      'linha de credito',
      'mercado de credito',
      'emprestimo',
      'consignado',
      'financiamento imobiliario',
      'cheque especial',
      'pix',
      'open finance',
      'fintech',
      'fintechs',
      'agencia bancaria',
      'jp morgan',
      'goldman sachs',
      'morgan stanley',
      'citi',
      'ubs',
      'credit suisse',
    ],
  },
  {
    id: 'investimentos',
    remover: [],
    termos: [
      'investimento',
      'investimentos',
      'investidor',
      'investidores',
      'investir',
      'fii',
      'fiis',
      'fundo imobiliario',
      'fundos imobiliarios',
      'renda fixa',
      'renda variavel',
      'cdb',
      'lci',
      'lca',
      'cri',
      'cra',
      'lcd',
      'tesouro direto',
      'tesouro selic',
      'tesouro ipca',
      'tesouro prefixado',
      'debenture',
      'debentures',
      'poupanca',
      'previdencia privada',
      'pgbl',
      'vgbl',
      'etf',
      'etfs',
      'bdr',
      'bdrs',
      'dividendos',
      'dividend yield',
      'jcp',
      'juros sobre capital proprio',
      'carteira recomendada',
      'carteira de investimentos',
      'alocacao',
      'diversificacao',
      'come cotas',
      'rentabilidade',
      'aporte',
      'corretora',
      'fundo multimercado',
      'fundo de acoes',
      'cdi',
      'proventos',
      'aposentadoria',
    ],
  },
  {
    id: 'empresas',
    remover: IM_VALE_AMBIGUO,
    termos: [
      'balanco',
      'balancos',
      'lucro liquido',
      'prejuizo',
      'resultado trimestral',
      'receita liquida',
      'ebitda',
      'guidance',
      'fusao',
      'aquisicao',
      'ipo',
      'oferta publica',
      'follow on',
      'recuperacao judicial',
      'demissoes',
      'ceo',
      'cfo',
      'conselho de administracao',
      'acionistas',
      'companhia',
      'empresa',
      'empresas',
      'varejo',
      'industria',
      'petrobras',
      'vale',
      'vale3',
      'ambev',
      'magazine luiza',
      'magalu',
      'americanas',
      'jbs',
      'suzano',
      'weg',
      'embraer',
      'gerdau',
      'csn',
      'braskem',
      'eletrobras',
      'cemig',
      'sabesp',
      'natura',
      'renner',
      'cvc',
      'azul',
      'gol',
      'localiza',
      'raia drogasil',
      'cosan',
      'klabin',
      'marfrig',
      'brf',
      'hapvida',
      'rede d or',
      'totvs',
      'stone',
      'pagseguro',
      'mercado livre',
      'apple',
      'microsoft',
      'google',
      'alphabet',
      'amazon',
      'tesla',
      'nvidia',
      'meta platforms',
      'facebook',
      'instagram',
      'openai',
      'netflix',
    ],
  },
  {
    id: 'cripto',
    remover: [],
    termos: [
      'bitcoin',
      'btc',
      'ethereum',
      'eth',
      'criptomoeda',
      'criptomoedas',
      'cripto',
      'blockchain',
      'altcoin',
      'altcoins',
      'solana',
      'xrp',
      'ripple',
      'dogecoin',
      'binance',
      'coinbase',
      'halving',
      'stablecoin',
      'usdt',
      'tether',
      'defi',
      'nft',
      'nfts',
      'web3',
      'satoshi',
      'memecoin',
      'drex',
      'token',
      'tokenizacao',
      'mineracao de bitcoin',
      'exchange de cripto',
    ],
  },
  {
    id: 'brasil',
    remover: IM_VALE_AMBIGUO,
    termos: [
      'brasil',
      'brasileiro',
      'brasileira',
      'brasileiros',
      'brasileiras',
      'brasilia',
      'ibovespa',
      'b3',
      'selic',
      'copom',
      'ipca',
      'igp m',
      'banco central do brasil',
      'bacen',
      'governo federal',
      'congresso nacional',
      'receita federal',
      'inss',
      'fgts',
      'bolsa familia',
      'sao paulo',
      'rio de janeiro',
      'minas gerais',
      'lula',
      'petrobras',
      'vale',
      'itau',
      'bradesco',
      'nubank',
      'magalu',
      'embraer',
      'tesouro nacional',
      'tesouro direto',
      'pix',
      'drex',
      'anbima',
      'cvm',
      'susep',
    ],
  },
  {
    id: 'mundo',
    // Bairro paulistano com nome de continente. Sem isto, "casa no Jardim
    // Europa" entra no filtro Mundo — aconteceu em produção.
    remover: ['jardim europa'],
    termos: [
      'eua',
      'estados unidos',
      'china',
      'europa',
      'uniao europeia',
      'zona do euro',
      'japao',
      'alemanha',
      // 'franca' fica de fora de propósito: normalizado, o país colide com a
      // cidade de Franca (SP) e com o adjetivo ("conversa franca").
      'frances',
      'francesa',
      'reino unido',
      'russia',
      'ucrania',
      'argentina',
      'india',
      'mexico',
      'oriente medio',
      'israel',
      'opep',
      'fed',
      'fomc',
      'powell',
      'banco central europeu',
      'bce',
      'wall street',
      'nasdaq',
      'dow jones',
      's p 500',
      'fmi',
      'omc',
      'onu',
      'global',
      'internacional',
      'exterior',
      'guerra',
      'tarifas',
      'trump',
      'biden',
      'mundial',
    ],
  },
];

// Estado em memória da aba.
var imNoticias = [];
var imCategoriaAtiva = 'todos';
var imVisiveis = IM_PAGINA;
var imCarregando = false;
var imAvisoCache = '';
var imAtualizadoEm = 0;
var imUltimoErro = '';

// ============================================================
// Classificação
// ============================================================

/**
 * Tira as tags HTML respeitando aspas.
 *
 * O regex ingênuo /<[^>]*>/ não serve para este feed: o WordPress do
 * InfoMoney põe HTML DENTRO de atributo —
 * data-image-caption="<p>legenda</p>" — e o regex encerra a tag no primeiro
 * ">", que está dentro do atributo. O resto do atributo vaza como texto e
 * vai parar no card ("... uso de IA " data-image-caption=" ..."). Foi
 * exatamente o que apareceu em produção.
 */
function imTirarTags(html) {
  var s = String(html == null ? '' : html);
  var saida = '';
  var i = 0;
  while (i < s.length) {
    var abre = s.indexOf('<', i);
    if (abre === -1) {
      saida += s.slice(i);
      break;
    }
    saida += s.slice(i, abre);
    var j = abre + 1;
    var aspa = '';
    while (j < s.length) {
      var c = s.charAt(j);
      if (aspa) {
        if (c === aspa) aspa = '';
      } else if (c === '"' || c === "'") {
        aspa = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    saida += ' ';
    // Tag sem fechar: joga fora o resto em vez de deixar markup vazar.
    if (j >= s.length) break;
    i = j + 1;
  }
  return saida;
}

/**
 * Texto comparável: sem HTML, sem acento, minúsculo, só [a-z0-9] e espaço,
 * cercado por espaços. O padding é o truque que dá "casamento por palavra
 * inteira" de graça: procurar ' banco ' nunca acha "bancoop".
 */
function imNormalizar(txt) {
  if (txt == null) return ' ';
  // <br> e </p> viram espaço para o texto não colar entre parágrafos.
  // Sem isto o lixo de atributo entraria na CLASSIFICAÇÃO, não só no card.
  var s = imTirarTags(txt);
  s = s.replace(/&[a-z]+;|&#\d+;/gi, ' ');
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return ' ' + s.trim() + ' ';
}

/** Termo presente como palavra inteira (aceita o plural simples com "s"). */
function imTemTermo(textoNormalizado, termo) {
  if (!termo) return false;
  var t = String(termo).trim();
  if (!t) return false;
  return (
    textoNormalizado.indexOf(' ' + t + ' ') !== -1 ||
    textoNormalizado.indexOf(' ' + t + 's ') !== -1
  );
}

/**
 * Apaga trechos do texto normalizado. O laço existe porque duas ocorrências
 * coladas ("banco central banco central") compartilham o espaço do meio —
 * um único split deixaria a segunda passar.
 */
function imRemoverTrechos(texto, trechos) {
  if (!trechos || !trechos.length) return texto;
  for (var i = 0; i < trechos.length; i++) {
    var alvo = ' ' + trechos[i] + ' ';
    while (texto.indexOf(alvo) !== -1) texto = texto.replace(alvo, ' ');
  }
  return texto;
}

/** Slug da seção na URL: https://site.com.br/economia/x/ -> "economia". */
function imSecaoDaUrl(link) {
  if (!link) return '';
  var s = String(link).replace(/^https?:\/\/[^/]+/i, '');
  var partes = s.split('?')[0].split('#')[0].split('/');
  for (var i = 0; i < partes.length; i++) {
    if (partes[i]) return imNormalizar(partes[i]).trim();
  }
  return '';
}

/**
 * Rótulos de uma notícia. Devolve array (pode ser vazio) sem "todos" —
 * "todos" não é rótulo, é a ausência de filtro.
 */
function imClassificar(noticia) {
  var achadas = {};
  var n = noticia || {};

  function marcar(ids) {
    if (!ids) return;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i]) achadas[ids[i]] = true;
    }
  }

  // Sinal 1: editorias declaradas pelo feed.
  var cats = Array.isArray(n.categories) ? n.categories : [];
  for (var c = 0; c < cats.length; c++) {
    var chave = imNormalizar(cats[c]).trim();
    if (IM_MAPA_SECAO[chave]) marcar(IM_MAPA_SECAO[chave]);
    else if (IM_MAPA_SECAO[chave.replace(/ /g, '-')])
      marcar(IM_MAPA_SECAO[chave.replace(/ /g, '-')]);
  }

  // Sinal 2: seção na URL da matéria.
  var secao = imSecaoDaUrl(n.link);
  if (secao && IM_MAPA_SECAO[secao]) marcar(IM_MAPA_SECAO[secao]);

  // Sinal 3: palavras-chave no título + resumo + editorias.
  var base = imNormalizar([n.title, n.description, n.content, cats.join(' ')].join(' '));
  for (var r = 0; r < IM_REGRAS.length; r++) {
    var regra = IM_REGRAS[r];
    var texto = imRemoverTrechos(base, regra.remover);
    for (var t = 0; t < regra.termos.length; t++) {
      if (imTemTermo(texto, regra.termos[t])) {
        achadas[regra.id] = true;
        break;
      }
    }
  }

  // Ordena na ordem do catálogo — a tag do card fica previsível.
  var saida = [];
  for (var k = 0; k < IM_CATEGORIAS.length; k++) {
    var id = IM_CATEGORIAS[k].id;
    if (id !== 'todos' && achadas[id]) saida.push(id);
  }
  return saida;
}

/** Notícia crua do rss2json -> objeto que a tela consome. */
function imPrepararNoticia(bruta) {
  var n = bruta || {};
  var quando = n.pubDate ? new Date(String(n.pubDate).replace(' ', 'T')) : null;
  if (!quando || isNaN(quando.getTime())) quando = n.pubDate ? new Date(n.pubDate) : null;
  if (quando && isNaN(quando.getTime())) quando = null;
  return {
    titulo: String(n.title || '').trim(),
    link: String(n.link || '').trim(),
    resumo: imNormalizarResumo(n.description || n.content || ''),
    autor: String(n.author || '').trim(),
    // Guardadas porque a editoria é o sinal mais confiável da classificação
    // e o acervo salvo precisa poder ser reclassificado sem o item cru.
    editorias: Array.isArray(n.categories) ? n.categories.slice(0, 6) : [],
    ts: quando ? quando.getTime() : 0,
    cats: imClassificar(n),
  };
}

/**
 * Identidade da notícia, para dedupe entre cargas. O link sem query/hash é
 * estável; sem link, o título normalizado serve de âncora.
 */
function imChaveNoticia(n) {
  if (!n) return '';
  var link = String(n.link || '')
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (link) return link;
  return imNormalizar(n.titulo || '').trim();
}

/**
 * Junta a carga nova ao acervo guardado, sem repetir notícia.
 *
 * A janela de dias vale só para o que veio do cache: o que o feed acabou de
 * mandar entra sempre, mesmo que a data pareça velha. Cortar item recém-
 * chegado por causa de `pubDate` esquisito deixaria a aba vazia por um
 * detalhe de formatação da fonte.
 */
function imMesclar(acervo, novos) {
  var vistos = {};
  var saida = [];
  function absorver(lista, exigirJanela, corte) {
    for (var i = 0; i < (lista || []).length; i++) {
      var n = lista[i];
      if (!n || !n.titulo) continue;
      if (exigirJanela && n.ts && n.ts < corte) continue;
      var k = imChaveNoticia(n);
      if (!k || vistos[k]) continue;
      vistos[k] = true;
      saida.push(n);
    }
  }
  // Novos primeiro: em caso de repetição, vence a versão mais fresca.
  absorver(novos, false, 0);
  absorver(acervo, true, Date.now() - IM_JANELA_DIAS * 24 * 3600 * 1000);
  saida.sort(function (a, b) {
    return b.ts - a.ts;
  });
  return saida.slice(0, IM_MAX_ACERVO);
}

/** Resumo em texto puro, cortado no limite de leitura de um card. */
function imNormalizarResumo(html) {
  // Tags primeiro, entidades depois: na ordem inversa um "&lt;b&gt;" do
  // feed viraria tag de verdade e seria removido como markup.
  var s = imTirarTags(html)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= 160) return s;
  var corte = s.slice(0, 160);
  var espaco = corte.lastIndexOf(' ');
  return (espaco > 100 ? corte.slice(0, espaco) : corte) + '…';
}

// ============================================================
// Cache local do feed
// ============================================================

/** Forma enxuta do item no localStorage — 90 notícias precisam caber. */
function imParaCache(n) {
  return { t: n.titulo, l: n.link, r: n.resumo, d: n.ts, e: n.editorias || [] };
}

/**
 * Volta do cache RECLASSIFICANDO. Guardar o rótulo junto seria mais barato,
 * mas congelaria o acervo nas regras da versão que o gravou — um ajuste de
 * palavra-chave só valeria para notícia nova.
 */
function imDoCache(salvo) {
  var n = salvo || {};
  var editorias = Array.isArray(n.e) ? n.e : [];
  return {
    titulo: String(n.t || ''),
    link: String(n.l || ''),
    resumo: String(n.r || ''),
    autor: '',
    editorias: editorias,
    ts: Number(n.d) || 0,
    cats: imClassificar({
      title: n.t,
      description: n.r,
      link: n.l,
      categories: editorias,
    }),
  };
}

function imLerCache() {
  try {
    var cru = localStorage.getItem(IM_CACHE_KEY);
    if (!cru) return null;
    var obj = JSON.parse(cru);
    if (!obj || !Array.isArray(obj.items) || !obj.items.length) return null;
    return { items: obj.items.map(imDoCache), ts: Number(obj.ts) || 0 };
  } catch (_) {
    return null;
  }
}

function imGravarCache(acervo) {
  var compacto = (acervo || []).map(imParaCache);
  try {
    localStorage.setItem(IM_CACHE_KEY, JSON.stringify({ ts: Date.now(), items: compacto }));
  } catch (_) {
    // Quota estourada: tenta guardar só a metade mais recente antes de
    // desistir. Meio acervo ainda é melhor do que recomeçar do zero amanhã.
    try {
      localStorage.setItem(
        IM_CACHE_KEY,
        JSON.stringify({ ts: Date.now(), items: compacto.slice(0, Math.ceil(compacto.length / 2)) })
      );
    } catch (__) {
      // Sem cache a aba continua funcionando — só perde o acúmulo.
    }
  }
}

function imLerPreferencia() {
  try {
    var v = localStorage.getItem(IM_PREF_KEY);
    if (!v) return 'todos';
    for (var i = 0; i < IM_CATEGORIAS.length; i++) {
      if (IM_CATEGORIAS[i].id === v) return v;
    }
    return 'todos';
  } catch (_) {
    return 'todos';
  }
}

function imGravarPreferencia(id) {
  try {
    localStorage.setItem(IM_PREF_KEY, id);
  } catch (_) {
    // Sem localStorage o filtro só não sobrevive ao reload.
  }
}

// ============================================================
// Carregamento
// ============================================================

/**
 * Ponto de entrada da aba (mudarAba passa esta função como callback).
 * `forcar` ignora o cache e vai na rede.
 */
async function carregarNoticias(forcar) {
  if (imCarregando) return;
  imCategoriaAtiva = imLerPreferencia();

  if (!forcar && imNoticias.length) {
    imRenderizar();
    return;
  }

  var cache = imLerCache();

  // Cache fresco: mostra o acervo guardado sem tocar na rede.
  if (!forcar && cache && Date.now() - cache.ts < IM_CACHE_TTL_MS) {
    imNoticias = cache.items;
    imAtualizadoEm = cache.ts;
    imAvisoCache = '';
    imRenderizar();
    return;
  }

  // Acervo antigo na tela enquanto a rede responde — nada de tela em branco
  // quando já existe conteúdo bom para ler.
  if (cache && !imNoticias.length) {
    imNoticias = cache.items;
    imAtualizadoEm = cache.ts;
    imRenderizar();
  }

  imCarregando = true;
  imMostrarLoader(!imNoticias.length);
  try {
    var itens = await imBuscarFeed();
    imNoticias = imMesclar(cache ? cache.items : [], itens.map(imPrepararNoticia));
    imGravarCache(imNoticias);
    imAtualizadoEm = Date.now();
    imAvisoCache = '';
    imUltimoErro = '';
    imVisiveis = IM_PAGINA;
    imRenderizar();
  } catch (_) {
    // Rede caiu: se houver acervo (mesmo vencido) é melhor mostrar notícia
    // velha avisando a idade do que uma tela de erro.
    if (cache) {
      imNoticias = cache.items;
      imAtualizadoEm = cache.ts;
      imAvisoCache =
        'Sem conexão com o feed — mostrando o que já estava salvo ' +
        imTempoRelativo(cache.ts) +
        '.';
      imRenderizar();
    } else {
      imRenderizarErro();
    }
  } finally {
    imCarregando = false;
    imMostrarLoader(false);
  }
}

/** Token do Firebase, quando o app já autenticou. Sem ele, seguimos sem. */
async function imTokenAuth() {
  try {
    if (typeof firebase === 'undefined' || !firebase.auth) return '';
    var u = firebase.auth().currentUser;
    return u ? await u.getIdToken() : '';
  } catch (_) {
    return '';
  }
}

/** Uma tentativa: devolve os itens ou lança com um motivo legível. */
async function imTentarFonte(url, cabecalhos) {
  var resposta = await fetch(url, cabecalhos ? { headers: cabecalhos } : undefined);
  if (!resposta.ok) throw new Error('http_' + resposta.status);
  var dados = await resposta.json();
  if (!dados || dados.status !== 'ok') {
    // rss2json devolve 200 com status "error" e a razão em `message`.
    throw new Error(
      String((dados && (dados.message || dados.error)) || 'resposta_invalida').slice(0, 120)
    );
  }
  if (!Array.isArray(dados.items) || !dados.items.length) throw new Error('feed_sem_itens');
  return dados.items;
}

/**
 * Busca o feed pelas duas fontes, em ordem. Guarda o motivo de cada falha em
 * imUltimoErro: sem isso, "não deu para falar com o feed" não diz nada a
 * quem precisa consertar.
 */
async function imBuscarFeed() {
  var falhas = [];

  var token = await imTokenAuth();
  if (token) {
    try {
      return await imTentarFonte(IM_API_PROPRIA, { Authorization: 'Bearer ' + token });
    } catch (e) {
      falhas.push('api: ' + e.message);
    }
  } else {
    falhas.push('api: sem sessão');
  }

  try {
    return await imTentarFonte(IM_API_BASE + '?rss_url=' + encodeURIComponent(IM_FEED_URL));
  } catch (e) {
    falhas.push('rss2json: ' + e.message);
  }

  imUltimoErro = falhas.join(' · ');
  throw new Error(imUltimoErro);
}

/** Botão "Atualizar" do cabeçalho. */
function atualizarNoticias() {
  imVisiveis = IM_PAGINA;
  // Devolve a promise: sem ela ninguém consegue esperar o fim da atualização
  // (o onclick ignora, mas teste e código futuro precisam).
  return carregarNoticias(true);
}

// ============================================================
// Filtro
// ============================================================

/** Clique no chip de categoria. Não vai à rede — só re-renderiza. */
function filtrarNoticiasPorCategoria(id) {
  var valido = 'todos';
  for (var i = 0; i < IM_CATEGORIAS.length; i++) {
    if (IM_CATEGORIAS[i].id === id) valido = id;
  }
  imCategoriaAtiva = valido;
  imVisiveis = IM_PAGINA;
  imGravarPreferencia(valido);
  imRenderizar();
}

/** Notícias da categoria ativa, mais recentes primeiro. */
function imNoticiasFiltradas() {
  var lista =
    imCategoriaAtiva === 'todos'
      ? imNoticias.slice()
      : imNoticias.filter(function (n) {
          return n.cats.indexOf(imCategoriaAtiva) !== -1;
        });
  return lista.sort(function (a, b) {
    return b.ts - a.ts;
  });
}

/** Quantas notícias existem por categoria (alimenta o contador do chip). */
function imContagemPorCategoria() {
  var contas = { todos: imNoticias.length };
  for (var i = 0; i < IM_CATEGORIAS.length; i++) {
    if (IM_CATEGORIAS[i].id !== 'todos') contas[IM_CATEGORIAS[i].id] = 0;
  }
  for (var n = 0; n < imNoticias.length; n++) {
    var cats = imNoticias[n].cats;
    for (var c = 0; c < cats.length; c++) {
      if (contas[cats[c]] !== undefined) contas[cats[c]]++;
    }
  }
  return contas;
}

function imCarregarMais() {
  imVisiveis += IM_PAGINA;
  imRenderizar();
}

// ============================================================
// Render
// ============================================================

function imEscapar(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Só http(s) vira href — javascript:, data: e vbscript: viram card sem link. */
function imLinkSeguro(url) {
  var s = String(url == null ? '' : url).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function imLabel(id) {
  for (var i = 0; i < IM_CATEGORIAS.length; i++) {
    if (IM_CATEGORIAS[i].id === id) return IM_CATEGORIAS[i].label;
  }
  return id;
}

/** "há 3 h", "ontem", "12/03/2025" — o que for mais legível para a idade. */
function imTempoRelativo(ts) {
  if (!ts) return '';
  var diff = Date.now() - ts;
  if (diff < 0) diff = 0;
  var min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  var h = Math.floor(min / 60);
  if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
  var d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return 'há ' + d + ' dias';
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function imDataCompleta(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function imMostrarLoader(ligado) {
  var loader = document.getElementById('loader-noticias');
  if (loader) loader.style.display = ligado ? 'block' : 'none';
}

function imRenderizar() {
  imRenderizarChips();
  imRenderizarLista();
}

function imRenderizarChips() {
  var alvo = document.getElementById('filtros-noticias');
  if (!alvo) return;
  var contas = imContagemPorCategoria();
  var html = '';
  for (var i = 0; i < IM_CATEGORIAS.length; i++) {
    var cat = IM_CATEGORIAS[i];
    var qtd = contas[cat.id] || 0;
    var classes =
      'im-chip' + (cat.id === imCategoriaAtiva ? ' ativo' : '') + (qtd === 0 ? ' vazio' : '');
    html +=
      '<button type="button" class="' +
      classes +
      '" data-cat="' +
      imEscapar(cat.id) +
      '" aria-pressed="' +
      (cat.id === imCategoriaAtiva ? 'true' : 'false') +
      '" onclick="filtrarNoticiasPorCategoria(\'' +
      imEscapar(cat.id) +
      '\')"><i class="ph ' +
      imEscapar(cat.icone) +
      '"></i>' +
      imEscapar(cat.label) +
      '<span class="im-chip-num">' +
      qtd +
      '</span></button>';
  }
  alvo.innerHTML = html;
  alvo.style.display = 'flex';
}

function imRenderizarLista() {
  var container = document.getElementById('container-noticias');
  var resumo = document.getElementById('resumo-noticias');
  var rodape = document.getElementById('mais-noticias');
  if (!container) return;

  var lista = imNoticiasFiltradas();
  var visiveis = lista.slice(0, imVisiveis);

  if (resumo) {
    var texto = '';
    if (imAvisoCache) {
      texto =
        '<span class="im-aviso"><i class="ph ph-warning"></i> ' +
        imEscapar(imAvisoCache) +
        '</span>';
    } else if (lista.length) {
      texto =
        '<span><i class="ph ph-funnel"></i> ' +
        (imCategoriaAtiva === 'todos'
          ? lista.length + (lista.length === 1 ? ' notícia' : ' notícias')
          : visiveis.length +
            ' de ' +
            lista.length +
            ' em <strong>' +
            imEscapar(imLabel(imCategoriaAtiva)) +
            '</strong>') +
        '</span>';
      // A idade do acervo explica por que um assunto está com pouca coisa —
      // sem ela, "Política 1" parece defeito em vez de feed devagar.
      if (imAtualizadoEm) {
        texto +=
          '<span class="im-resumo-sep">·</span><span>atualizado ' +
          imEscapar(imTempoRelativo(imAtualizadoEm)) +
          '</span>';
      }
    }
    resumo.innerHTML = texto;
    resumo.style.display = texto ? 'flex' : 'none';
  }

  if (!lista.length) {
    container.style.display = 'block';
    container.innerHTML =
      '<div class="card-container im-vazio">' +
      '<i class="ph ph-newspaper"></i>' +
      '<p><strong>Nada em ' +
      imEscapar(imLabel(imCategoriaAtiva)) +
      ' agora.</strong></p>' +
      '<p class="im-vazio-dica">O feed é rotativo: assim que sair matéria desse assunto ela aparece aqui.</p>' +
      '<button type="button" class="btn-secundario" onclick="filtrarNoticiasPorCategoria(\'todos\')">Ver todas as notícias</button>' +
      '</div>';
    if (rodape) rodape.style.display = 'none';
    return;
  }

  var html = '';
  for (var i = 0; i < visiveis.length; i++) {
    html += imCardHtml(visiveis[i]);
  }
  container.innerHTML = html;
  container.style.display = 'grid';

  if (rodape) {
    if (lista.length > visiveis.length) {
      var faltam = lista.length - visiveis.length;
      rodape.innerHTML =
        '<button type="button" class="btn-secundario" onclick="imCarregarMais()">' +
        '<i class="ph ph-plus-circle"></i> Carregar mais ' +
        Math.min(faltam, IM_PAGINA) +
        '</button>';
      rodape.style.display = 'flex';
    } else {
      rodape.innerHTML = '';
      rodape.style.display = 'none';
    }
  }
}

function imCardHtml(n) {
  var tags = '';
  // Duas tags bastam no card; o resto vira "+N" para não virar sopa de chip.
  var mostra = n.cats.slice(0, 2);
  for (var i = 0; i < mostra.length; i++) {
    tags +=
      '<span class="im-tag" data-cat="' +
      imEscapar(mostra[i]) +
      '">' +
      imEscapar(imLabel(mostra[i])) +
      '</span>';
  }
  if (n.cats.length > mostra.length) {
    tags += '<span class="im-tag im-tag-mais">+' + (n.cats.length - mostra.length) + '</span>';
  }

  // O card inteiro é clicável, então o href vem de conteúdo de terceiro
  // direto para um contexto de navegação. Sem link http(s) o card vira
  // <article>: melhor um card sem saída do que um href que executa script.
  var href = imLinkSeguro(n.link);
  return (
    (href
      ? '<a class="im-card" href="' +
        imEscapar(href) +
        '" target="_blank" rel="noopener noreferrer">'
      : '<article class="im-card">') +
    (tags ? '<div class="im-card-tags">' + tags + '</div>' : '') +
    '<h3 class="im-card-titulo">' +
    imEscapar(n.titulo) +
    '</h3>' +
    (n.resumo ? '<p class="im-card-resumo">' + imEscapar(n.resumo) + '</p>' : '') +
    '<div class="im-card-rodape">' +
    '<span class="im-card-data" title="' +
    imEscapar(imDataCompleta(n.ts)) +
    '"><i class="ph ph-clock-counter-clockwise"></i> ' +
    imEscapar(imTempoRelativo(n.ts)) +
    '</span>' +
    (href
      ? '<span class="im-card-ler">Ler matéria <i class="ph ph-arrow-up-right"></i></span>'
      : '') +
    '</div>' +
    (href ? '</a>' : '</article>')
  );
}

function imRenderizarErro() {
  var container = document.getElementById('container-noticias');
  var resumo = document.getElementById('resumo-noticias');
  var rodape = document.getElementById('mais-noticias');
  var filtros = document.getElementById('filtros-noticias');
  if (filtros) filtros.style.display = 'none';
  if (resumo) resumo.style.display = 'none';
  if (rodape) rodape.style.display = 'none';
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML =
    '<div class="card-container im-vazio">' +
    '<i class="ph ph-broadcast" style="color:var(--cor-erro);"></i>' +
    '<p><strong>Não deu para falar com o feed de notícias.</strong></p>' +
    '<p class="im-vazio-dica">Pode ser a sua conexão ou uma instabilidade da fonte.</p>' +
    '<button type="button" class="btn-secundario" onclick="atualizarNoticias()"><i class="ph ph-arrows-clockwise"></i> Tentar de novo</button>' +
    // O motivo técnico fica discreto, mas visível: sem ele, um print da tela
    // de erro não permite descobrir qual das fontes caiu nem por quê.
    (imUltimoErro ? '<p class="im-vazio-motivo">' + imEscapar(imUltimoErro) + '</p>' : '') +
    '</div>';
}
