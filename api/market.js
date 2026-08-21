const { db, timestamp } = require('./_lib/firebase-admin');
const { requireUser } = require('./_lib/auth');
const { handler } = require('./_lib/handler');

// Endpoint único de mercado — consolidado num arquivo só para respeitar o
// limite de 12 functions do Vercel Hobby. Sub-roteamento via ?op=:
//   - GET  /api/market?op=quote&tickers=PETR4,VALE3              (auth: Firebase Bearer)
//   - GET  /api/market?op=history&ticker=PETR4&range=1y          (auth: Firebase Bearer)
//   - GET  /api/market?op=news                                    (auth: Firebase Bearer)
//   - POST /api/market?op=warmup                                  (auth: Bearer CRON_SECRET)
//
// Cache em Firestore: marketQuotes/{TICKER}, marketHistory/{TICKER}_{RANGE}.
// BRAPI grátis ~15k req/mês; cada chamada cobre N tickers num único batch.

const BRAPI_BASE = 'https://brapi.dev/api/quote';
// Feeds de notícia da aba Info Mercado. FIXOS no servidor de propósito: se a
// URL viesse do cliente, este endpoint viraria um proxy HTTP aberto (SSRF).
//
// São as editorias do MESMO site (WordPress serve /{editoria}/feed/), não
// fontes diferentes. O motivo é densidade: o feed principal traz só as
// últimas horas, então categorias como Bancos e Política ficavam zeradas na
// tela por não terem saído matéria do assunto nas últimas horas — e não por
// falta de notícia. Buscando as editorias, cada assunto chega com massa já
// na primeira visita.
//
// O cliente NÃO sabe desta lista: recebe um acervo só, e continua
// classificando e filtrando por conta própria.
const NEWS_FEEDS = [
  'https://www.infomoney.com.br/feed/',
  'https://www.infomoney.com.br/economia/feed/',
  'https://www.infomoney.com.br/politica/feed/',
  'https://www.infomoney.com.br/mercados/feed/',
  'https://www.infomoney.com.br/negocios/feed/',
  'https://www.infomoney.com.br/onde-investir/feed/',
  'https://www.infomoney.com.br/minhas-financas/feed/',
  'https://www.infomoney.com.br/criptomoedas/feed/',
];
// Teto por feed para uma editoria movimentada não abafar as outras.
const NEWS_MAX_PER_FEED = 20;
const NEWS_MAX_ITEMS = 120;
const NEWS_FEED_TIMEOUT_MS = 8000;
const NEWS_TTL_MS = 10 * 60 * 1000;
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const MAX_TICKERS_PER_REQUEST = 50;
const BATCH_SIZE = 50;
const CACHE_COLLECTION = 'marketQuotes';
const HISTORY_COLLECTION = 'marketHistory';

// Cripto: mapa de símbolo curto -> id do CoinGecko.
const CRYPTO_MAP = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  BNB: 'binancecoin',
  XRP: 'ripple',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  MATIC: 'matic-network',
};

// Cache do feed na memória do processo. A function serverless reusa o
// container entre invocações, então isto já segura a maior parte das visitas
// sem ida ao InfoMoney — e sem gravar nada no Firestore por notícia.
let newsCache = { at: 0, items: null };

// Mapa range -> meses (para corte e cache key).
const RANGE_MONTHS = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 };

function todayYmdBRT(now = Date.now()) {
  // BRT = UTC-3 (sem DST). Formata yyyy-mm-dd no fuso BRT.
  const brt = new Date(now - 3 * 3600 * 1000);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(brt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeTicker(t) {
  if (typeof t !== 'string') return null;
  const clean = t
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (clean.length < 4 || clean.length > 10) return null;
  return clean;
}

async function fetchBrapi(tickers) {
  if (!tickers.length) return {};
  const url = `${BRAPI_BASE}/${encodeURIComponent(tickers.join(','))}`;
  const token = process.env.BRAPI_TOKEN;
  const headers = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`brapi_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const out = {};
  for (const r of json.results || []) {
    if (!r || !r.symbol) continue;
    out[r.symbol.toUpperCase()] = {
      ticker: r.symbol.toUpperCase(),
      price: typeof r.regularMarketPrice === 'number' ? r.regularMarketPrice : null,
      previousClose: r.regularMarketPreviousClose ?? null,
      change: r.regularMarketChange ?? null,
      changePct: r.regularMarketChangePercent ?? null,
      currency: r.currency || 'BRL',
      shortName: r.shortName || r.longName || null,
      marketTime: r.regularMarketTime || null,
    };
  }
  return out;
}

// ---------- op=quote ----------
async function handleQuote(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const rawTickers = (req.query.tickers || '').toString();
  const requested = Array.from(
    new Set(rawTickers.split(',').map(sanitizeTicker).filter(Boolean))
  ).slice(0, MAX_TICKERS_PER_REQUEST);

  if (!requested.length) {
    return res
      .status(400)
      .json({ error: 'missing_tickers', detail: 'Use ?op=quote&tickers=PETR4,VALE3' });
  }

  const today = todayYmdBRT();
  const database = db();
  const refs = requested.map((t) => database.collection(CACHE_COLLECTION).doc(t));
  const snaps = await database.getAll(...refs);
  const fresh = {};
  const stale = [];
  snaps.forEach((snap, i) => {
    const t = requested[i];
    const d = snap.data();
    if (d && d.dateYmd === today && typeof d.price === 'number') fresh[t] = d;
    else stale.push(t);
  });

  let fetched = {};
  let fetchError = null;
  if (stale.length) {
    try {
      fetched = await fetchBrapi(stale);
      const batch = database.batch();
      for (const t of stale) {
        const f = fetched[t];
        if (!f || typeof f.price !== 'number') continue;
        batch.set(
          database.collection(CACHE_COLLECTION).doc(t),
          {
            ...f,
            dateYmd: today,
            updatedAt: timestamp().now(),
            source: 'brapi',
          },
          { merge: true }
        );
      }
      await batch
        .commit()
        .catch((e) => console.warn('[market/quote] cache_write_failed', e.message));
    } catch (e) {
      console.warn('[market/quote] brapi_failed', e.message);
      fetchError = e.message;
    }
  }

  const quotes = {};
  for (const t of requested) {
    if (fresh[t]) quotes[t] = { ...fresh[t], cached: true };
    else if (fetched[t]) quotes[t] = { ...fetched[t], cached: false };
    else quotes[t] = { ticker: t, price: null, cached: false, error: 'unavailable' };
  }

  return res.json({
    success: true,
    today,
    fromCache: Object.keys(fresh).length,
    fromApi: Object.keys(fetched).length,
    requested: requested.length,
    quotes,
    fetchError,
  });
}

// ---------- op=history ----------
// Retorna série mensal de fechamento p/ 1 ticker. Cache 24h em Firestore.
// Source resolution:
//   - Cripto (BTC, ETH...): CoinGecko vs BRL
//   - Tesouro/CDI/IBOV/IFIX (synthetic): gera curva determinística baseada em yield anual
//   - Demais (ações, FIIs, ETFs, BDRs): brapi /quote/:ticker?range=...&interval=1mo
//   - Fallback: Yahoo Finance v8 (BDRs internacionais, ETFs US)
async function fetchHistorySource(ticker, range) {
  const months = RANGE_MONTHS[range] || 12;
  const upper = ticker.toUpperCase();

  // Synthetic benchmarks/RF — usa premissas estáveis pra simulação histórica.
  const SYNTH = { CDI: 0.1325, SELIC: 0.1325, IBOV: 0.095, IFIX: 0.082, IPCA: 0.045 };
  if (SYNTH[upper] != null) return buildSyntheticSeries(upper, SYNTH[upper], months);
  if (upper.startsWith('TESOURO_SELIC')) return buildSyntheticSeries(upper, 0.1325, months);
  if (upper.startsWith('TESOURO_IPCA')) return buildSyntheticSeries(upper, 0.115, months);
  if (upper.startsWith('TESOURO_PREFIXADO')) return buildSyntheticSeries(upper, 0.115, months);

  // Cripto via CoinGecko
  if (CRYPTO_MAP[upper]) {
    const id = CRYPTO_MAP[upper];
    const days = Math.min(months * 31, 1800);
    const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=brl&days=${days}&interval=daily`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`coingecko_${res.status}`);
      const json = await res.json();
      const prices = (json.prices || []).map(([ts, p]) => ({ t: ts, p }));
      return downsampleMonthly(prices);
    } finally {
      clearTimeout(timer);
    }
  }

  // Brapi (ações, FIIs, ETFs, BDRs BR)
  try {
    const url = `${BRAPI_BASE}/${encodeURIComponent(upper)}?range=${range}&interval=1mo&fundamental=false`;
    const token = process.env.BRAPI_TOKEN;
    const headers = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const json = await res.json();
      const hist = json?.results?.[0]?.historicalDataPrice || [];
      if (hist.length) {
        return hist
          .filter((d) => typeof d.close === 'number' && d.date)
          .map((d) => ({ t: d.date * 1000, p: d.close }))
          .sort((a, b) => a.t - b.t);
      }
    }
  } catch (e) {
    console.warn(`[market/history] brapi_failed ${upper}:`, e.message);
  }

  // Fallback Yahoo
  try {
    const yahooRange = range === '5y' ? '5y' : range === '3y' ? '5y' : '1y';
    const url = `${YAHOO_BASE}/${encodeURIComponent(upper + '.SA')}?range=${yahooRange}&interval=1mo`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`yahoo_${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const out = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (typeof closes[i] === 'number') out.push({ t: timestamps[i] * 1000, p: closes[i] });
    }
    return out;
  } catch (e) {
    console.warn(`[market/history] yahoo_failed ${upper}:`, e.message);
  }

  return null;
}

function downsampleMonthly(series) {
  // Reduz para 1 ponto por mês (último dia disponível).
  if (!series.length) return [];
  const byMonth = new Map();
  for (const pt of series) {
    const d = new Date(pt.t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, pt);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.t - b.t);
}

function buildSyntheticSeries(ticker, annualYield, months) {
  const monthlyRate = Math.pow(1 + annualYield, 1 / 12) - 1;
  const start = Date.now() - months * 30 * 86400000;
  const out = [];
  let price = 100;
  for (let i = 0; i <= months; i++) {
    out.push({ t: start + i * 30 * 86400000, p: Number(price.toFixed(4)) });
    price *= 1 + monthlyRate;
  }
  return out;
}

async function handleHistory(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const rawTicker = (req.query.ticker || '').toString().trim().toUpperCase();
  const range = (req.query.range || '1y').toString().toLowerCase();
  if (!rawTicker || rawTicker.length < 2 || rawTicker.length > 30) {
    return res.status(400).json({ error: 'missing_ticker' });
  }
  if (!RANGE_MONTHS[range]) {
    return res.status(400).json({ error: 'invalid_range', detail: 'Use 1m,3m,6m,1y,3y,5y' });
  }

  const today = todayYmdBRT();
  const database = db();
  const cacheKey = `${rawTicker}_${range}`;
  const ref = database.collection(HISTORY_COLLECTION).doc(cacheKey);
  const snap = await ref.get();
  const cached = snap.data();
  if (cached && cached.dateYmd === today && Array.isArray(cached.series)) {
    return res.json({
      success: true,
      ticker: rawTicker,
      range,
      series: cached.series,
      cached: true,
    });
  }

  const series = await fetchHistorySource(rawTicker, range);
  if (!series || !series.length) {
    return res.status(502).json({ error: 'history_unavailable', ticker: rawTicker, range });
  }

  // Corta pelo range solicitado (CoinGecko volta tudo, brapi às vezes excede).
  const cutoff = Date.now() - RANGE_MONTHS[range] * 31 * 86400000;
  const trimmed = series.filter((p) => p.t >= cutoff);
  const finalSeries = trimmed.length >= 2 ? trimmed : series;

  await ref
    .set(
      {
        dateYmd: today,
        range,
        ticker: rawTicker,
        series: finalSeries,
        updatedAt: timestamp().now(),
      },
      { merge: true }
    )
    .catch((e) => console.warn('[market/history] cache_write_failed', e.message));

  return res.json({ success: true, ticker: rawTicker, range, series: finalSeries, cached: false });
}

// ---------- op=warmup (cron) ----------
async function handleWarmup(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'cron_disabled' });
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const started = Date.now();
  const database = db();

  let snapshot;
  try {
    snapshot = await database.collectionGroup('investimentos').get();
  } catch (e) {
    return res.status(500).json({ error: 'scan_failed', detail: e.message });
  }

  const tickerSet = new Set();
  snapshot.forEach((doc) => {
    const d = doc.data() || {};
    const candidate = d.ticker || d.codigo || d.symbol || d.ativo;
    const clean = sanitizeTicker(candidate);
    // Heurística: tickers B3 = 4 letras + 1-2 dígitos (FII termina em 11,
    // BDR em 32-35). Ignora códigos de RF (CDB, LCI etc) — sem cotação BRAPI.
    if (clean && /^[A-Z]{4}\d{1,2}$/.test(clean)) tickerSet.add(clean);
  });

  const tickers = Array.from(tickerSet);
  if (!tickers.length) {
    return res.json({ success: true, tickers: 0, durationMs: Date.now() - started });
  }

  const today = todayYmdBRT();
  let updated = 0,
    failed = 0;
  const errors = [];
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const slice = tickers.slice(i, i + BATCH_SIZE);
    let results;
    try {
      const fetched = await fetchBrapi(slice);
      results = Object.values(fetched);
    } catch (e) {
      failed += slice.length;
      errors.push({ batch: i / BATCH_SIZE, error: e.message });
      continue;
    }
    const writeBatch = database.batch();
    for (const r of results) {
      if (!r || !r.ticker || typeof r.price !== 'number') continue;
      writeBatch.set(
        database.collection(CACHE_COLLECTION).doc(r.ticker),
        {
          ...r,
          dateYmd: today,
          updatedAt: timestamp().now(),
          source: 'brapi-cron',
        },
        { merge: true }
      );
      updated++;
    }
    await writeBatch.commit().catch((e) => {
      console.warn('[market/warmup] batch_commit_failed', e.message);
      errors.push({ batch: i / BATCH_SIZE, error: 'commit:' + e.message });
    });
  }

  return res.json({
    success: true,
    today,
    tickers: tickers.length,
    updated,
    failed,
    errors,
    durationMs: Date.now() - started,
  });
}

// ============================================================
// === op=news — feed de notícias (aba Info Mercado) ===
// ============================================================
//
// Existe para a aba não ficar refém do rss2json: aquele serviço é gratuito,
// tem limite por IP e já derrubou a aba inteira em produção. Aqui o RSS é
// buscado do servidor (sem CORS, sem cota de terceiro) e devolvido no MESMO
// formato do rss2json, para o cliente tratar as duas fontes igual.
//
// O parse é por regex de propósito: o feed é WordPress, o formato é estável
// e um parser XML de verdade seria uma dependência nova só para isto.

/** Desembrulha CDATA e converte as entidades que o RSS realmente usa. */
function decodeXmlText(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    // &amp; por último: antes disso, "&amp;lt;" viraria "<" indevidamente.
    .replace(/&amp;/g, '&');
  return s.trim();
}

/** Conteúdo da primeira <tag> do bloco, já decodificado. */
function pickTag(bloco, tag) {
  const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(bloco);
  return m ? decodeXmlText(m[1]) : '';
}

/** Conteúdo de TODAS as <tag> do bloco (o RSS repete <category>). */
function pickTags(bloco, tag) {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(bloco))) {
    const v = decodeXmlText(m[1]);
    if (v) out.push(v);
  }
  return out;
}

/** RSS 2.0 -> itens no formato que a aba já consome. */
function parseRssItems(xml, limite) {
  const teto = limite || NEWS_MAX_ITEMS;
  const itens = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && itens.length < teto) {
    const bloco = m[1];
    const title = pickTag(bloco, 'title');
    const link = pickTag(bloco, 'link');
    if (!title || !link) continue;
    itens.push({
      title,
      link,
      pubDate: pickTag(bloco, 'pubDate'),
      // description antes de content:encoded — o resumo do card cabe em
      // 160 caracteres e o content traz o post inteiro.
      description: pickTag(bloco, 'description') || pickTag(bloco, 'content:encoded'),
      categories: pickTags(bloco, 'category').slice(0, 6),
    });
  }
  return itens;
}

async function fetchOneFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NEWS_FEED_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const xml = await res.text();
  const items = parseRssItems(xml, NEWS_MAX_PER_FEED);
  if (!items.length) throw new Error('sem_itens');
  return items;
}

/** Identidade da matéria — a mesma sai no feed principal e na editoria. */
function newsKey(link) {
  return String(link || '')
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/**
 * Busca todas as editorias em paralelo e devolve UM acervo ordenado.
 *
 * allSettled e não all: uma editoria que saiu do ar (ou mudou de slug) não
 * pode derrubar as outras sete. Basta uma responder para a aba ter conteúdo.
 */
async function fetchAllFeeds() {
  const resultados = await Promise.allSettled(NEWS_FEEDS.map(fetchOneFeed));
  const vistos = new Set();
  const items = [];
  const failed = [];

  resultados.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      failed.push({ feed: NEWS_FEEDS[i], error: (r.reason && r.reason.message) || 'erro' });
      return;
    }
    for (const item of r.value) {
      const k = newsKey(item.link);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      items.push(item);
    }
  });

  if (!items.length) {
    throw new Error('feeds_sem_itens:' + failed.map((f) => f.error).join(','));
  }

  // Sem data legível vai para o fim, não some: o cliente ainda mostra.
  items.sort((a, b) => {
    const ta = Date.parse(a.pubDate) || 0;
    const tb = Date.parse(b.pubDate) || 0;
    return tb - ta;
  });
  return { items: items.slice(0, NEWS_MAX_ITEMS), failed };
}

async function handleNews(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (newsCache.items && Date.now() - newsCache.at < NEWS_TTL_MS) {
    return res.json({ status: 'ok', source: 'cache', items: newsCache.items });
  }
  try {
    const { items, failed } = await fetchAllFeeds();
    newsCache = { at: Date.now(), items };
    // `failed` fica na resposta para uma editoria que mudou de slug aparecer
    // em vez de sumir calada.
    return res.json({ status: 'ok', source: 'feed', feedsFailed: failed, items });
  } catch (e) {
    // Feed velho ainda serve melhor que erro — o cliente decide se avisa.
    if (newsCache.items) {
      return res.json({
        status: 'ok',
        source: 'cache_stale',
        cachedAt: newsCache.at,
        items: newsCache.items,
      });
    }
    return res.status(502).json({ status: 'error', error: 'feed_unavailable', detail: e.message });
  }
}

// Dispatcher: handler wrapper aplica CORS + try/catch + Sentry. Cada
// sub-op cuida da própria auth (requireUser p/ quote+history;
// CRON_SECRET bearer p/ warmup).
module.exports = handler({
  method: ['GET', 'POST'],
  auth: 'none',
  handle: async ({ req, res }) => {
    const op = (req.query.op || '').toString();
    if (op === 'quote') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return handleQuote(req, res);
    }
    if (op === 'history') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return handleHistory(req, res);
    }
    if (op === 'news') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return handleNews(req, res);
    }
    if (op === 'warmup') {
      return handleWarmup(req, res);
    }
    return res.status(400).json({
      error: 'unknown_op',
      detail: 'Use ?op=quote, ?op=history, ?op=news or ?op=warmup',
    });
  },
});

// Internos do parse de RSS expostos para teste. São regex sobre XML de
// terceiro — a parte deste arquivo com mais chance de errar em silêncio e a
// que dá para exercitar sem rede nem Firestore.
module.exports.__test = {
  fetchAllFeeds,
  parseRssItems,
  decodeXmlText,
  pickTag,
  pickTags,
  newsKey,
  NEWS_FEEDS,
  NEWS_MAX_PER_FEED,
  NEWS_MAX_ITEMS,
};
