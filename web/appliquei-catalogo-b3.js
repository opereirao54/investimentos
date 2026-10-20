/**
 * Catálogo de ativos da B3: que tipo é cada código e como achá-lo pelo
 * ticker ou pelo nome.
 *
 * POR QUE ISTO EXISTE
 * A busca do formulário de operação só conhecia os ~45 ativos de uma lista
 * escrita à mão. Qualquer outro código (KLBN11, ITSA4, o FII que a pessoa
 * acabou de comprar) aparecia como "Ativo não catalogado", sem nome e sem
 * preço. E o tipo era adivinhado pelo sufixo: todo código terminado em 11
 * virava FII — inclusive as units (KLBN11, TAEE11, SANB11), que são ações.
 *
 * O catálogo completo mora no servidor (api/market.js?op=catalogo), montado
 * da CVM, da lista de setores e das cotações, e a busca por nome passa pela
 * fonte de mercado (op=busca). Este arquivo guarda o que os DOIS lados
 * precisam decidir igual: o tipo do ativo e a ordem dos resultados.
 *
 * Classic script no app (funções viram globais) e módulo no servidor.
 */

// Units: certificados que juntam ações ON e PN. Terminam em 11, como os FIIs.
// O nome da fonte costuma dizer "UNT"; esta lista cobre quando o nome falta.
var CATALOGO_UNITS_B3 = [
  'ALUP',
  'BIDI',
  'BPAC',
  'BRBI',
  'CPLE',
  'ENGI',
  'IGTI',
  'KLBN',
  'MODL',
  'PPLA',
  'RNEW',
  'SANB',
  'SAPR',
  'SULA',
  'TAEE',
  'TIET',
];

// ETFs listados (também terminam em 11). O nome desempata quando o código
// não está aqui ("ETF", "iShares", "Índice").
var CATALOGO_ETFS_B3 = [
  'ACWI',
  'B5MB',
  'B5P2',
  'BBOV',
  'BITH',
  'BOVA',
  'BOVB',
  'BOVV',
  'BOVX',
  'BRAX',
  'DIVD',
  'DIVO',
  'ECOO',
  'ESGB',
  'ETHE',
  'EURP',
  'FIND',
  'FIXA',
  'GOLD',
  'GOVE',
  'HASH',
  'IB5M',
  'IMAB',
  'IMBB',
  'IRFM',
  'IVVB',
  'LFTB',
  'LFTS',
  'NASD',
  'PIBB',
  'QBTC',
  'QETH',
  'SMAC',
  'SMAL',
  'SOLH',
  'SPXB',
  'SPXI',
  'TECK',
  'WRLD',
  'XBOV',
  'XFIX',
  'XINA',
];

var CATALOGO_CRIPTOS = [
  'BTC',
  'ETH',
  'SOL',
  'ADA',
  'BNB',
  'XRP',
  'DOT',
  'AVAX',
  'LINK',
  'MATIC',
  'DOGE',
  'LTC',
  'UNI',
  'USDT',
  'USDC',
];

function _catalogoSemAcento(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Tipo do ativo: 'Ação', 'FII', 'ETF', 'BDR', 'Cripto' ou null (não parece
 * código de bolsa). `dica` é o que a fonte disse, quando disse: 'stock',
 * 'fund', 'bdr' (BRAPI), 'EQUITY', 'ETF' (Yahoo), 'acao', 'fii' (CVM).
 *
 * Ordem das evidências: cripto e BDR pelo código; ETF por código, dica ou
 * nome; no sufixo 11, fundo que se declara fundo, depois unit, depois a dica,
 * e só então o sufixo (FII). O nome vence a dica porque o Yahoo chama FII de
 * EQUITY e a BRAPI chama unit de 'stock' e ETF de 'fund'.
 */
function classificarAtivoB3(ticker, nome, dica) {
  var t = String(ticker || '')
    .toUpperCase()
    .trim();
  if (!t) return null;
  var n = _catalogoSemAcento(nome);
  var d = String(dica || '').toLowerCase();
  if (CATALOGO_CRIPTOS.indexOf(t) !== -1 || /-USD$/.test(t) || d === 'cripto') return 'Cripto';
  var base = t.replace(/^([A-Z0-9]{4}\d{1,2})F$/, '$1');
  var raiz = base.slice(0, 4);
  // Código de bolsa: letra, letra ou dígito (B3SA3), duas letras e o número.
  // Exigir as letras impede que "CDB25" ou "LCA2030" virem ação.
  if (/^[A-Z][A-Z0-9][A-Z]{2}3[1-9]$/.test(base) || d === 'bdr') return 'BDR';
  var nomeEtf = /\betf\b|ishares|\bindex\b|fundo de indice|fdo\.? ?(de )?indice|\bfi indice/.test(
    n
  );
  if (/^[A-Z][A-Z0-9][A-Z]{2}1[1-3]$/.test(base)) {
    if (CATALOGO_ETFS_B3.indexOf(raiz) !== -1 || d === 'etf' || nomeEtf) return 'ETF';
    if (/\bfii\b|imobili|fiagro|\bfi ?agro\b|fdo\.? ?inv|fundo de investimento/.test(n))
      return 'FII';
    if (CATALOGO_UNITS_B3.indexOf(raiz) !== -1 || /\bunt\b|\bunits?\b/.test(n)) return 'Ação';
    if (d === 'stock' || d === 'acao') return 'Ação';
    return 'FII';
  }
  if (d === 'etf' || nomeEtf) return 'ETF';
  if (/^[A-Z][A-Z0-9][A-Z]{2}[3-8]$/.test(base)) return 'Ação';
  if (d === 'fii' || d === 'fund') return 'FII';
  if (d === 'stock' || d === 'acao' || d === 'equity') return 'Ação';
  return null;
}

/** Subcategoria da renda variável no formulário (acoes, fiis, etfs, bdrs, cripto). */
function subcategoriaDoTipoB3(tipo) {
  return { Ação: 'acoes', FII: 'fiis', ETF: 'etfs', BDR: 'bdrs', Cripto: 'cripto' }[tipo] || null;
}

/**
 * Resultados da busca, do mais provável ao menos. `lista` é [{t, n, k}]
 * (ticker, nome, tipo). Código exato primeiro, depois código que começa
 * com o texto, nome que começa com ele, palavra do nome, e por fim o
 * texto em qualquer lugar.
 */
function buscarNoCatalogoB3(lista, q, limite) {
  var texto = _catalogoSemAcento(q).trim();
  if (!texto || !Array.isArray(lista)) return [];
  var tq = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  var out = [];
  for (var i = 0; i < lista.length; i++) {
    var a = lista[i];
    if (!a || !a.t) continue;
    var n = _catalogoSemAcento(a.n);
    var p = 0;
    if (tq && a.t === tq) p = 100;
    else if (tq && a.t.indexOf(tq) === 0) p = 80;
    else if (n && n.indexOf(texto) === 0) p = 60;
    else if (n && (' ' + n).indexOf(' ' + texto) !== -1) p = 50;
    else if (n && n.indexOf(texto) !== -1) p = 30;
    else if (tq.length >= 3 && a.t.indexOf(tq) !== -1) p = 20;
    if (p) out.push({ p: p, a: a });
  }
  out.sort(function (x, y) {
    return y.p - x.p || x.a.t.length - y.a.t.length || (x.a.t < y.a.t ? -1 : 1);
  });
  return out.slice(0, limite || 12).map(function (x) {
    return x.a;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    classificarAtivoB3: classificarAtivoB3,
    subcategoriaDoTipoB3: subcategoriaDoTipoB3,
    buscarNoCatalogoB3: buscarNoCatalogoB3,
    UNITS: CATALOGO_UNITS_B3,
    ETFS: CATALOGO_ETFS_B3,
  };
}
