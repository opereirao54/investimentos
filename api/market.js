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
// O cliente NÃO sabe destas URLs: recebe um acervo só, e continua
// classificando e filtrando por conta própria. O `id` existe só para dizer
// QUAL assunto ficou sem fonte quando um slug muda — sem isso, a categoria
// aparece zerada na tela e não há como distinguir "não saiu notícia disso
// hoje" de "a rota mudou de nome e ninguém percebeu".
//
// `urls` são alternativas, não somatório: vale a primeira que responder. O
// slug de uma seção muda quando o site é reformulado, e um 404 numa rota
// não pode zerar o assunto inteiro.
const NEWS_SOURCES = [
  { id: 'geral', urls: ['https://www.infomoney.com.br/feed/'] },
  { id: 'economia', urls: ['https://www.infomoney.com.br/economia/feed/'] },
  { id: 'politica', urls: ['https://www.infomoney.com.br/politica/feed/'] },
  { id: 'mercado', urls: ['https://www.infomoney.com.br/mercados/feed/'] },
  { id: 'empresas', urls: ['https://www.infomoney.com.br/negocios/feed/'] },
  { id: 'investimentos', urls: ['https://www.infomoney.com.br/onde-investir/feed/'] },
  { id: 'financas', urls: ['https://www.infomoney.com.br/minhas-financas/feed/'] },
  {
    id: 'cripto',
    urls: [
      'https://www.infomoney.com.br/criptomoedas/feed/',
      'https://www.infomoney.com.br/tag/criptomoedas/feed/',
      'https://www.infomoney.com.br/mercados/criptomoedas/feed/',
      'https://www.infomoney.com.br/tudo-sobre/criptomoedas/feed/',
    ],
  },
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
let newsCache = { at: 0, items: null, failed: [] };

// Mapa range -> meses (para corte e cache key).
const RANGE_MONTHS = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 };

// Premissas anuais dos ativos sem série de preço própria (Tesouro, CDI) e
// dos benchmarks sintéticos. Ficam aqui, e não dentro de quem usa, porque
// duas telas dependem delas: a simulação histórica desenha as curvas com
// estes números e a renda fixa converte taxa nominal em real com os mesmos.
// Divergir seria a mesma tela mostrar dois CDIs diferentes.
const PREMISSAS_ANUAIS = { CDI: 0.1325, SELIC: 0.1325, IBOV: 0.095, IFIX: 0.082, IPCA: 0.045 };

// Prêmio real típico de um Tesouro IPCA+ longo, usado só para desenhar a
// curva indicativa da simulação histórica. A taxa REAL de cada título vem
// do Tesouro (op=rendafixa) — isto aqui não decide alocação nenhuma.
const PREMIO_REAL_IPCA = 0.07;

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
async function fetchHistorySource(ticker, range, premissas) {
  const months = RANGE_MONTHS[range] || 12;
  const upper = ticker.toUpperCase();

  // Synthetic benchmarks/RF — usa premissas estáveis pra simulação histórica.
  const SYNTH = premissas || PREMISSAS_ANUAIS;
  if (SYNTH[upper] != null) return buildSyntheticSeries(upper, SYNTH[upper], months);
  // Títulos do Tesouro sem série própria. Antes eram três constantes soltas
  // que ninguém revisava; agora acompanham a Selic e a inflação correntes.
  if (upper.startsWith('TESOURO_SELIC')) return buildSyntheticSeries(upper, SYNTH.SELIC, months);
  if (upper.startsWith('TESOURO_IPCA'))
    return buildSyntheticSeries(upper, SYNTH.IPCA + PREMIO_REAL_IPCA, months);
  if (upper.startsWith('TESOURO_PREFIXADO')) return buildSyntheticSeries(upper, SYNTH.CDI, months);

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

  const { premissas } = await resolverPremissas(database);
  const series = await fetchHistorySource(rawTicker, range, premissas);
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

  // Indicadores do BCB junto do aquecimento de cotações: são a base de toda
  // conta de renda fixa e não podem depender de alguém abrir a aba.
  let indicadores = 'ok';
  try {
    const bcb = await carregarIndicadoresBcb();
    await database.collection(INDICADORES_COLLECTION).doc('bcb').set(
      {
        indicadores: bcb.indicadores,
        premissas: bcb.premissas,
        origem: bcb.origem,
        degradado: bcb.degradado,
        fetchedAtMs: Date.now(),
        dateYmd: todayYmdBRT(),
        updatedAt: timestamp().now(),
      },
      { merge: true }
    );
    if (bcb.degradado) indicadores = 'degradado';
  } catch (e) {
    console.warn('[market/warmup] indicadores_failed', e.message);
    indicadores = 'falhou:' + e.message;
  }

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
    return res.json({ success: true, tickers: 0, indicadores, durationMs: Date.now() - started });
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
    indicadores,
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

/** Primeira URL da fonte que responder; só falha se todas falharem. */
async function fetchSource(source) {
  const erros = [];
  for (const url of source.urls) {
    try {
      const items = await fetchOneFeed(url);
      return { id: source.id, url, items };
    } catch (e) {
      erros.push(url.replace('https://www.infomoney.com.br', '') + ': ' + e.message);
    }
  }
  throw new Error(erros.join(' | '));
}

/**
 * Busca todas as editorias em paralelo e devolve UM acervo ordenado.
 *
 * allSettled e não all: uma editoria que saiu do ar (ou mudou de slug) não
 * pode derrubar as outras. Basta uma responder para a aba ter conteúdo.
 */
async function fetchAllFeeds() {
  const resultados = await Promise.allSettled(NEWS_SOURCES.map(fetchSource));
  const vistos = new Set();
  const items = [];
  const failed = [];
  const used = [];

  resultados.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      failed.push({
        id: NEWS_SOURCES[i].id,
        error: (r.reason && r.reason.message) || 'erro',
      });
      return;
    }
    used.push({ id: r.value.id, url: r.value.url, items: r.value.items.length });
    for (const item of r.value.items) {
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
  return { items: items.slice(0, NEWS_MAX_ITEMS), failed, used };
}

async function handleNews(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (newsCache.items && Date.now() - newsCache.at < NEWS_TTL_MS) {
    return res.json({
      status: 'ok',
      source: 'cache',
      feedsFailed: newsCache.failed || [],
      items: newsCache.items,
    });
  }
  try {
    const { items, failed, used } = await fetchAllFeeds();
    newsCache = { at: Date.now(), items, failed };
    // `feedsFailed` viaja até a tela: quando um assunto zera porque a rota
    // dele caiu, a aba diz isso em vez de mostrar só um "0" mudo.
    // `feedsUsed` conta qual URL alternativa colou, para enxugar a lista
    // depois sem ter de adivinhar.
    return res.json({
      status: 'ok',
      source: 'feed',
      feedsFailed: failed,
      feedsUsed: used,
      items,
    });
  } catch (e) {
    // Feed velho ainda serve melhor que erro — o cliente decide se avisa.
    if (newsCache.items) {
      return res.json({
        status: 'ok',
        source: 'cache_stale',
        cachedAt: newsCache.at,
        feedsFailed: newsCache.failed || [],
        items: newsCache.items,
      });
    }
    return res.status(502).json({ status: 'error', error: 'feed_unavailable', detail: e.message });
  }
}

// ============================================================
// === op=indicadores — Selic, CDI e IPCA reais (BCB) ===
// ============================================================
//
// PREMISSAS_ANUAIS existia como constante no código. Isso apodrece em
// silêncio: a Selic muda várias vezes por ano e a taxa real de todo título
// do Tesouro é calculada em cima dela. Um cliente que sabe a taxa corrente e
// vê a conta feita com outra perde a confiança no produto inteiro — e não há
// nada na tela que denuncie o erro.
//
// O SGS do Banco Central é gratuito, sem chave e é a fonte primária. O Focus
// dá a expectativa de inflação, que é o número certo para deflacionar taxa
// contratada — melhor do que o IPCA passado e muito melhor do que 4,5% fixo.
//
// Nada aqui pode DERRUBAR a renda fixa: se o BCB não responder, cai para a
// constante e marca `degradado`. A tela mostra a procedência dos dois jeitos,
// então o utilizador sabe se está a ver taxa de hoje ou premissa de reserva.

const INDICADORES_COLLECTION = 'marketIndicadores';
const INDICADORES_TTL_MS = 6 * 60 * 60 * 1000;
const SGS_BASE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs';
const FOCUS_BASE =
  'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais';

// Séries candidatas por indicador, em ordem de preferência.
//
// A lista existe porque código de série do SGS não é algo que se confira num
// contrato: são milhares, os nomes mudam e um código errado devolve NÚMERO
// VÁLIDO de outra coisa — o que é pior do que erro, porque passa. Por isso
// cada candidata é validada contra uma faixa plausível antes de ser aceita:
// um CDI de 0,05% reprova e o motor passa à próxima, em vez de propagar.
const SGS_SERIES = {
  selic: {
    faixa: [0.5, 40],
    candidatas: [
      { codigo: 432, tipo: 'anual', rotulo: 'Meta Selic (SGS 432)' },
      { codigo: 4189, tipo: 'anual', rotulo: 'Selic anualizada (SGS 4189)' },
      { codigo: 11, tipo: 'diaria', rotulo: 'Selic diária (SGS 11)' },
    ],
  },
  cdi: {
    faixa: [0.5, 40],
    candidatas: [
      { codigo: 4389, tipo: 'anual', rotulo: 'CDI anualizado (SGS 4389)' },
      { codigo: 12, tipo: 'diaria', rotulo: 'CDI diário (SGS 12)' },
    ],
  },
  ipca12m: {
    faixa: [-5, 40],
    candidatas: [{ codigo: 13522, tipo: 'anual', rotulo: 'IPCA 12 meses (SGS 13522)' }],
  },
};

/** dd/MM/yyyy do SGS -> yyyy-mm-dd. */
function sgsData(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchSgs(codigo, ultimos) {
  const url = `${SGS_BASE}.${codigo}/dados/ultimos/${ultimos || 1}?formato=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`sgs_${codigo}_${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || !json.length) throw new Error(`sgs_${codigo}_vazio`);
  return json;
}

/** Taxa diária (% a.d.) -> anual (% a.a.), base 252 dias úteis. */
function anualizar252(pctDiario) {
  return (Math.pow(1 + pctDiario / 100, 252) - 1) * 100;
}

/**
 * Primeira candidata que responder com valor dentro da faixa plausível.
 * Devolve null quando nenhuma serve — quem decide o fallback é quem chama.
 */
async function resolverIndicadorSgs(nome, erros) {
  const spec = SGS_SERIES[nome];
  if (!spec) return null;
  for (const cand of spec.candidatas) {
    try {
      const dados = await fetchSgs(cand.codigo, 1);
      const ultimo = dados[dados.length - 1];
      const bruto = fundNum(ultimo && ultimo.valor);
      if (bruto === null) throw new Error('valor_nao_numerico');
      const valor = cand.tipo === 'diaria' ? anualizar252(bruto) : bruto;
      if (valor < spec.faixa[0] || valor > spec.faixa[1]) {
        throw new Error(`fora_da_faixa_${valor.toFixed(2)}`);
      }
      return {
        valor: Math.round(valor * 100) / 100,
        unidade: '% a.a.',
        fonte: cand.rotulo,
        data: sgsData(ultimo && ultimo.data),
      };
    } catch (e) {
      erros.push({ indicador: nome, serie: cand.codigo, erro: e.message });
    }
  }
  return null;
}

/**
 * Mediana do Focus para o IPCA do ano corrente.
 *
 * É a expectativa de inflação — o número certo para converter taxa nominal
 * em taxa real de um título que vence no futuro. O IPCA dos últimos 12 meses
 * responde outra pergunta.
 */
async function fetchFocusIpca(erros) {
  const ano = new Date().getUTCFullYear();
  const filtro = `Indicador eq 'IPCA' and DataReferencia eq ${ano}`;
  const url =
    `${FOCUS_BASE}?$top=1&$orderby=Data desc&$format=json` +
    `&$select=Data,Mediana,DataReferencia&$filter=${encodeURIComponent(filtro)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  try {
    if (!res.ok) throw new Error(`focus_${res.status}`);
    const json = await res.json();
    const linha = json && Array.isArray(json.value) ? json.value[0] : null;
    const mediana = fundNum(linha && linha.Mediana);
    if (mediana === null || mediana < -5 || mediana > 40)
      throw new Error('focus_valor_implausivel');
    return {
      valor: Math.round(mediana * 100) / 100,
      unidade: '% a.a.',
      fonte: 'Expectativa Focus (BCB)',
      data: linha.Data || null,
      horizonte: linha.DataReferencia || ano,
    };
  } catch (e) {
    erros.push({ indicador: 'ipcaEsperado', erro: e.message });
    return null;
  }
}

/** Busca tudo do BCB e monta o bloco de indicadores + premissas derivadas. */
async function carregarIndicadoresBcb() {
  const erros = [];
  const [selic, cdi, ipca12m, ipcaEsperado] = await Promise.all([
    resolverIndicadorSgs('selic', erros),
    resolverIndicadorSgs('cdi', erros),
    resolverIndicadorSgs('ipca12m', erros),
    fetchFocusIpca(erros),
  ]);

  const indicadores = { selic, cdi, ipca12m, ipcaEsperado };

  // Premissas em fração, no formato que o resto do arquivo já consome.
  // Cada uma cai para a constante individualmente: perder o Focus não pode
  // levar junto a Selic que veio certa.
  const premissas = { ...PREMISSAS_ANUAIS };
  const origem = { CDI: 'fallback', SELIC: 'fallback', IPCA: 'fallback' };
  if (selic) {
    premissas.SELIC = selic.valor / 100;
    origem.SELIC = selic.fonte;
  }
  if (cdi) {
    premissas.CDI = cdi.valor / 100;
    origem.CDI = cdi.fonte;
  } else if (selic) {
    // O CDI acompanha a Selic de perto (historicamente ~0,1 p.p. abaixo).
    // Derivar é melhor do que usar uma constante de anos atrás, mas a origem
    // tem de dizer que foi derivado — não é medição.
    premissas.CDI = (selic.valor - 0.1) / 100;
    origem.CDI = 'Derivado da Selic';
  }
  const inflacao = ipcaEsperado || ipca12m;
  if (inflacao) {
    premissas.IPCA = inflacao.valor / 100;
    origem.IPCA = inflacao.fonte;
  }

  const degradado = !selic || !cdi || !inflacao;
  return { indicadores, premissas, origem, degradado, erros };
}

/**
 * Premissas correntes para quem precisa delas numa conta.
 *
 * Lê o cache que op=indicadores mantém; nunca vai à rede. Endpoint que
 * calcula taxa não pode ficar refém da latência do BCB, e uma premissa de
 * seis horas atrás não muda a terceira casa de nada.
 */
async function resolverPremissas(database) {
  try {
    const snap = await database.collection(INDICADORES_COLLECTION).doc('bcb').get();
    const d = snap && snap.exists ? snap.data() : null;
    if (d && d.premissas && typeof d.premissas.CDI === 'number') {
      return {
        premissas: { ...PREMISSAS_ANUAIS, ...d.premissas },
        origem: d.origem || null,
        degradado: !!d.degradado,
        fetchedAt: d.fetchedAtMs || null,
      };
    }
  } catch (e) {
    console.warn('[market/premissas] leitura_falhou', e.message);
  }
  return {
    premissas: { ...PREMISSAS_ANUAIS },
    origem: { CDI: 'fallback', SELIC: 'fallback', IPCA: 'fallback' },
    degradado: true,
    fetchedAt: null,
  };
}

async function handleIndicadores(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const agora = Date.now();
  const database = db();
  const ref = database.collection(INDICADORES_COLLECTION).doc('bcb');
  const snap = await ref.get().catch(() => null);
  const cache = snap && snap.exists ? snap.data() : null;

  if (
    cache &&
    typeof cache.fetchedAtMs === 'number' &&
    agora - cache.fetchedAtMs < INDICADORES_TTL_MS
  ) {
    return res.json({
      success: true,
      cached: true,
      fetchedAt: cache.fetchedAtMs,
      indicadores: cache.indicadores || {},
      premissas: cache.premissas || PREMISSAS_ANUAIS,
      origem: cache.origem || null,
      degradado: !!cache.degradado,
    });
  }

  let resultado;
  try {
    resultado = await carregarIndicadoresBcb();
  } catch (e) {
    console.warn('[market/indicadores] bcb_failed', e.message);
    resultado = null;
  }

  // Nenhum indicador veio: devolve o cache vencido se houver, senão a
  // constante. Em nenhum caminho este endpoint responde erro — quem o chama
  // precisa de UM número para continuar a conta.
  if (!resultado || (!resultado.indicadores.selic && !resultado.indicadores.cdi)) {
    if (cache && cache.premissas) {
      return res.json({
        success: true,
        cached: true,
        stale: true,
        fetchedAt: cache.fetchedAtMs,
        indicadores: cache.indicadores || {},
        premissas: cache.premissas,
        origem: cache.origem || null,
        degradado: true,
      });
    }
    return res.json({
      success: true,
      cached: false,
      indicadores: (resultado && resultado.indicadores) || {},
      premissas: PREMISSAS_ANUAIS,
      origem: { CDI: 'fallback', SELIC: 'fallback', IPCA: 'fallback' },
      degradado: true,
      erros: (resultado && resultado.erros) || [{ erro: 'bcb_indisponivel' }],
    });
  }

  await ref
    .set(
      {
        indicadores: resultado.indicadores,
        premissas: resultado.premissas,
        origem: resultado.origem,
        degradado: resultado.degradado,
        fetchedAtMs: agora,
        dateYmd: todayYmdBRT(agora),
        updatedAt: timestamp().now(),
      },
      { merge: true }
    )
    .catch((e) => console.warn('[market/indicadores] cache_write_failed', e.message));

  return res.json({
    success: true,
    cached: false,
    fetchedAt: agora,
    indicadores: resultado.indicadores,
    premissas: resultado.premissas,
    origem: resultado.origem,
    degradado: resultado.degradado,
    erros: resultado.erros,
  });
}

// ============================================================
// === op=fundamentals — indicadores para o motor da carteira ===
// ============================================================
//
// O motor da Carteira Recomendada (web/appliquei-motor-carteira.js) pontua
// cada ativo a partir de indicadores fundamentalistas. Este bloco é quem os
// busca e, principalmente, quem os NORMALIZA: a BRAPI devolve razão em uns
// campos (returnOnEquity = 0.185) e percentagem em outros (debtToEquity =
// 45.3), e alguns indicadores que o motor usa não existem em campo nenhum —
// precisam ser derivados (dívida líquida/EBITDA, CAGR, payout, DY médio).
//
// Fazer isto no servidor e não no browser é deliberado:
//   - a conversão fica num lugar só, testável sem DOM;
//   - o cache poupa a cota da BRAPI (grátis ~15k req/mês);
//   - o cliente recebe sempre o mesmo contrato, mesmo quando a fonte muda.
//
// Cobertura parcial é o caso NORMAL, não erro: o plano grátis da BRAPI não
// devolve os módulos financeiros e vários campos chegam null. O motor lida
// com isso (encolhe o score na direção da média conforme a cobertura cai),
// então aqui devolvemos o que houver com `cobertura` explícita em vez de
// falhar a requisição inteira.

const FUNDAMENTALS_COLLECTION = 'marketFundamentals';
const RF_COLLECTION = 'marketRendaFixa';
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;
const RF_TTL_MS = 12 * 60 * 60 * 1000;
const BRAPI_MODULES = 'summaryProfile,defaultKeyStatistics,financialData,incomeStatementHistory';

// Endpoint público que alimenta o site do Tesouro Direto. É a única fonte
// oficial e leve de taxas correntes — o CSV do Tesouro Transparente traz a
// série histórica inteira (dezenas de MB), inviável numa serverless.
const TESOURO_URL =
  'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json';

// Ano de lançamento das criptos suportadas. A CoinGecko só devolve
// genesis_date no endpoint por moeda (1 request cada) — para 10 símbolos
// conhecidos, tabela estática sai mais barato e não expira.
const CRYPTO_GENESIS = {
  BTC: 2009,
  ETH: 2015,
  SOL: 2020,
  ADA: 2017,
  BNB: 2017,
  XRP: 2012,
  DOT: 2020,
  AVAX: 2020,
  LINK: 2017,
  MATIC: 2019,
};

function fundNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Campos que a BRAPI devolve como razão (0.185 = 18,5%). */
function fundRazaoParaPct(v) {
  const n = fundNum(v);
  return n === null ? null : n * 100;
}

function fundDiv(a, b) {
  const x = fundNum(a);
  const y = fundNum(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
}

function fundCagr(inicial, final, anos) {
  const i = fundNum(inicial);
  const f = fundNum(final);
  if (i === null || f === null || i <= 0 || f <= 0 || !(anos > 0)) return null;
  return (Math.pow(f / i, 1 / anos) - 1) * 100;
}

function fundAnosEntre(msInicio, msFim) {
  if (!msInicio || !msFim || msFim <= msInicio) return null;
  return (msFim - msInicio) / (365.25 * 24 * 3600 * 1000);
}

function fundData(v) {
  if (!v) return null;
  const t = typeof v === 'number' ? v * (v < 1e11 ? 1000 : 1) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Agrega o histórico de proventos num punhado de indicadores.
 *
 * `cashDividends` da BRAPI vem como lista de pagamentos avulsos. Para ação
 * são alguns por ano; para FII é mensal — e é justamente a regularidade
 * mensal que interessa pontuar, por isso `consistencia` conta MESES com
 * pagamento nos últimos 24, não pagamentos totais.
 */
function fundAgregarDividendos(lista, preco, agora) {
  const vazio = {
    dividendos12m: null,
    dividendos12mAnterior: null,
    dy: null,
    dyMedio5a: null,
    dyMedio36m: null,
    anosPagandoDividendo: null,
    consistenciaDividendos: null,
    crescimentoDividendo12m: null,
  };
  if (!Array.isArray(lista) || !lista.length) return vazio;
  const hoje = agora || Date.now();
  const ANO = 365.25 * 24 * 3600 * 1000;

  const pagamentos = [];
  for (const d of lista) {
    const valor = fundNum(d && (d.rate != null ? d.rate : d.value));
    const quando = fundData(d && (d.paymentDate || d.date || d.approvedOn || d.lastDatePrior));
    if (valor === null || valor <= 0 || quando === null) continue;
    pagamentos.push({ valor, quando });
  }
  if (!pagamentos.length) return vazio;

  function somaJanela(deMs, ateMs) {
    let s = 0;
    let houve = false;
    for (const p of pagamentos) {
      if (p.quando > deMs && p.quando <= ateMs) {
        s += p.valor;
        houve = true;
      }
    }
    return houve ? s : null;
  }

  const d12 = somaJanela(hoje - ANO, hoje);
  const d12ant = somaJanela(hoje - 2 * ANO, hoje - ANO);
  const d60 = somaJanela(hoje - 5 * ANO, hoje);
  const d36 = somaJanela(hoje - 3 * ANO, hoje);

  const anos = new Set();
  for (const p of pagamentos) {
    if (p.quando >= hoje - 21 * ANO) anos.add(new Date(p.quando).getUTCFullYear());
  }

  const mesesComPagamento = new Set();
  for (const p of pagamentos) {
    if (p.quando > hoje - 2 * ANO && p.quando <= hoje) {
      const dt = new Date(p.quando);
      mesesComPagamento.add(dt.getUTCFullYear() + '-' + dt.getUTCMonth());
    }
  }

  const p = fundNum(preco);
  // DY médio usa o preço de hoje sobre o dividendo médio dos anos passados.
  // É aproximação — o correto seria o preço de cada época, que a BRAPI não
  // devolve junto do provento. Serve para comparar ativos entre si na mesma
  // data, que é o uso no ranking.
  const dyDe = (soma, anosJanela) =>
    soma !== null && p !== null && p > 0 ? (soma / anosJanela / p) * 100 : null;

  return {
    dividendos12m: d12,
    dividendos12mAnterior: d12ant,
    dy: dyDe(d12, 1),
    dyMedio5a: dyDe(d60, 5),
    dyMedio36m: dyDe(d36, 3),
    anosPagandoDividendo: anos.size || null,
    consistenciaDividendos: mesesComPagamento.size ? (mesesComPagamento.size / 24) * 100 : null,
    crescimentoDividendo12m:
      d12 !== null && d12ant !== null && d12ant > 0 ? (d12 / d12ant - 1) * 100 : null,
  };
}

/** CAGR de receita e lucro a partir do histórico de DRE anual da BRAPI. */
function fundCrescimentoDre(historico) {
  const out = { cagrReceita5a: null, cagrLucro5a: null, anosDre: 0 };
  if (!Array.isArray(historico) || historico.length < 2) return out;
  const linhas = historico
    .map((h) => ({
      quando: fundData(h && (h.endDate || h.date)),
      receita: fundNum(h && (h.totalRevenue != null ? h.totalRevenue : h.revenue)),
      lucro: fundNum(h && (h.netIncome != null ? h.netIncome : h.netIncomeFromContinuingOps)),
    }))
    .filter((l) => l.quando !== null)
    .sort((a, b) => a.quando - b.quando);
  if (linhas.length < 2) return out;

  const primeira = linhas[0];
  const ultima = linhas[linhas.length - 1];
  const anos = fundAnosEntre(primeira.quando, ultima.quando);
  out.anosDre = linhas.length;
  out.cagrReceita5a = fundCagr(primeira.receita, ultima.receita, anos);
  out.cagrLucro5a = fundCagr(primeira.lucro, ultima.lucro, anos);
  return out;
}

/**
 * Um resultado da BRAPI -> o contrato de indicadores que o motor consome.
 * Toda chave ausente vira null de propósito: o motor distingue "sem dado"
 * de "dado ruim", e um zero fabricado aqui viraria nota zero lá.
 */
function mapBrapiFundamental(r, agora) {
  const stats = (r && r.defaultKeyStatistics) || {};
  const fin = (r && r.financialData) || {};
  const perfil = (r && r.summaryProfile) || {};
  const preco = fundNum(r && r.regularMarketPrice);
  const marketCap = fundNum(r && r.marketCap);

  const pvp =
    fundNum(r && r.priceToBook) !== null ? fundNum(r.priceToBook) : fundNum(stats.priceToBook);
  const patrimonioLiquido = pvp !== null && pvp > 0 && marketCap !== null ? marketCap / pvp : null;

  const caixa = fundNum(fin.totalCash);
  const dividaBruta = fundNum(fin.totalDebt);
  const dividaLiquida = dividaBruta !== null ? dividaBruta - (caixa || 0) : null;
  const ebitda = fundNum(fin.ebitda);

  const divPl =
    dividaLiquida !== null && patrimonioLiquido !== null && patrimonioLiquido > 0
      ? dividaLiquida / patrimonioLiquido
      : fundNum(fin.debtToEquity) !== null
        ? fundNum(fin.debtToEquity) / 100
        : null;

  const dividendos = fundAgregarDividendos(
    r && r.dividendsData && r.dividendsData.cashDividends,
    preco,
    agora
  );
  const lpa =
    fundNum(r && r.earningsPerShare) !== null
      ? fundNum(r.earningsPerShare)
      : fundNum(stats.trailingEps);
  const payout =
    dividendos.dividendos12m !== null && lpa !== null && lpa > 0
      ? (dividendos.dividendos12m / lpa) * 100
      : null;

  const dre = fundCrescimentoDre(r && r.incomeStatementHistory);
  const volume = fundNum(r && r.regularMarketVolume);

  const dados = {
    ticker: r && r.symbol ? String(r.symbol).toUpperCase() : null,
    nome: (r && (r.longName || r.shortName)) || null,
    setor: perfil.sector || perfil.industry || null,
    preco,
    marketCap,
    patrimonioLiquido,

    pl:
      fundNum(r && r.priceEarnings) !== null ? fundNum(r.priceEarnings) : fundNum(stats.trailingPE),
    pvp,
    evEbitda: fundNum(stats.enterpriseToEbitda),

    dy: dividendos.dy,
    dyMedio5a: dividendos.dyMedio5a,
    dyMedio36m: dividendos.dyMedio36m,
    payout,
    anosPagandoDividendo: dividendos.anosPagandoDividendo,
    consistenciaDividendos: dividendos.consistenciaDividendos,
    crescimentoDividendo12m: dividendos.crescimentoDividendo12m,

    cagrReceita5a: dre.cagrReceita5a,
    cagrLucro5a: dre.cagrLucro5a,
    crescimentoReceitaAno: fundRazaoParaPct(fin.revenueGrowth),

    dividaLiquidaEbitda: ebitda !== null && ebitda > 0 ? fundDiv(dividaLiquida, ebitda) : null,
    dividaLiquidaPl: divPl,
    liquidezCorrente: fundNum(fin.currentRatio),

    roe: fundRazaoParaPct(fin.returnOnEquity),
    roic: null, // BRAPI não expõe ROIC; ROA no lugar seria outro indicador.
    margemLiquida: fundRazaoParaPct(fin.profitMargins),
    margemEbitda: fundRazaoParaPct(fin.ebitdaMargins),
    liquidezDiaria: volume !== null && preco !== null ? volume * preco : null,
  };

  // Rótulo de procedência. Montado aqui porque é aqui que se sabe DE ONDE
  // cada campo veio — na tela só sobraria adivinhação. Sem os módulos
  // financeiros o rótulo diz "cotação", não "fundamentos": o utilizador
  // precisa distinguir os dois casos.
  const temFundamentos =
    dados.roe !== null || dados.dividaLiquidaEbitda !== null || dados.cagrReceita5a !== null;
  dados.fonte = 'brapi';
  dados.fonteRotulo = temFundamentos ? 'Fundamentos · BRAPI' : 'Cotação · BRAPI';
  dados.dataReferencia = null; // a BRAPI não informa o exercício de origem
  return dados;
}

/** Fração dos indicadores da classe que vieram preenchidos. */
function fundCobertura(dados, chaves) {
  if (!chaves || !chaves.length) return 0;
  let preenchidos = 0;
  for (const k of chaves) if (dados[k] !== null && dados[k] !== undefined) preenchidos++;
  return preenchidos / chaves.length;
}

const CHAVES_ACAO = [
  'pl',
  'pvp',
  'evEbitda',
  'dy',
  'dyMedio5a',
  'payout',
  'anosPagandoDividendo',
  'cagrReceita5a',
  'cagrLucro5a',
  'crescimentoReceitaAno',
  'dividaLiquidaEbitda',
  'dividaLiquidaPl',
  'liquidezCorrente',
  'roe',
  'margemLiquida',
  'liquidezDiaria',
];

const CHAVES_CRIPTO = ['marketCap', 'volume24h', 'anosExistencia', 'retorno12m'];

function ehCripto(t) {
  return Object.prototype.hasOwnProperty.call(CRYPTO_MAP, t);
}

async function fetchBrapiFundamentals(tickers) {
  if (!tickers.length) return {};
  const params = new URLSearchParams({
    fundamental: 'true',
    dividends: 'true',
    modules: BRAPI_MODULES,
  });
  const url = `${BRAPI_BASE}/${encodeURIComponent(tickers.join(','))}?${params}`;
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
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`brapi_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const out = {};
  const agora = Date.now();
  for (const r of json.results || []) {
    if (!r || !r.symbol) continue;
    const d = mapBrapiFundamental(r, agora);
    d.cobertura = fundCobertura(d, CHAVES_ACAO);
    d.fonte = 'brapi';
    out[d.ticker] = d;
  }
  return out;
}

/** Indicadores de cripto via CoinGecko (mesma fonte já usada no histórico). */
async function fetchCoingeckoFundamentals(simbolos) {
  if (!simbolos.length) return {};
  const ids = simbolos.map((s) => CRYPTO_MAP[s]).filter(Boolean);
  if (!ids.length) return {};
  const url =
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}` +
    `&price_change_percentage=1y&sparkline=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`coingecko_${res.status}`);
  const json = await res.json();
  const porId = {};
  for (const c of Array.isArray(json) ? json : []) if (c && c.id) porId[c.id] = c;

  const anoAtual = new Date().getUTCFullYear();
  const out = {};
  for (const s of simbolos) {
    const c = porId[CRYPTO_MAP[s]];
    if (!c) continue;
    const genesis = CRYPTO_GENESIS[s];
    const d = {
      ticker: s,
      nome: c.name || s,
      classe: 'cripto',
      setor: null,
      preco: fundNum(c.current_price),
      marketCap: fundNum(c.market_cap),
      volume24h: fundNum(c.total_volume),
      retorno12m: fundNum(c.price_change_percentage_1y_in_currency),
      anosExistencia: genesis ? anoAtual - genesis : null,
      volatilidade30d: null,
      fonte: 'coingecko',
      fonteRotulo: 'Mercado · CoinGecko',
      dataReferencia: null,
    };
    d.cobertura = fundCobertura(d, CHAVES_CRIPTO);
    out[s] = d;
  }
  return out;
}

/**
 * Junta o que a CVM sabe com o que a cotação sabe.
 *
 * As duas fontes gravam no MESMO documento, em ramos separados (`cvm` e
 * `mercado`), e isto é o que impede uma de apagar a outra: a resposta da
 * BRAPI traz null explícito em quase todo campo fundamentalista, e um
 * `merge: true` com esses nulls por cima limparia os indicadores que a
 * ingestão da CVM tinha acabado de gravar.
 *
 * A CVM vence onde tem dado — é a fonte primária, auditável e obrigatória.
 * O mercado entra com o que só ele tem: preço, valor de mercado, volume e
 * proventos. P/L e P/VP não existem em nenhuma das duas sozinha: nascem
 * aqui, do lucro e do patrimônio da CVM cruzados com o valor de mercado.
 */
function comporFundamentos(doc) {
  if (!doc || typeof doc !== 'object') return null;
  // Documentos gravados antes da separação em ramos são planos.
  const mercado = doc.mercado && typeof doc.mercado === 'object' ? doc.mercado : doc;
  const cvm = doc.cvm && typeof doc.cvm === 'object' ? doc.cvm : null;
  const out = { ...mercado };
  delete out.cvm;
  delete out.mercado;

  if (!cvm) {
    out.fetchedAtMs = doc.mercadoFetchedAtMs || doc.fetchedAtMs || null;
    return out;
  }

  for (const [chave, valor] of Object.entries(cvm)) {
    if (valor === null || valor === undefined) continue;
    if (['fonte', 'fonteRotulo', 'dataReferencia', 'classe'].includes(chave)) continue;
    out[chave] = valor;
  }

  const marketCap = fundNum(mercado.marketCap);
  const lucro = fundNum(cvm.lucroLiquido);
  const patrimonio = fundNum(cvm.patrimonioLiquido);
  // Lucro negativo não produz P/L: o motor trata "sem P/L" e "P/L negativo"
  // de formas diferentes, e inventar o segundo aqui seria mentir sobre a
  // origem. O alerta de prejuízo sai do lucro absoluto, que segue no doc.
  if (marketCap && lucro && lucro > 0) out.pl = marketCap / lucro;
  if (marketCap && patrimonio && patrimonio > 0) out.pvp = marketCap / patrimonio;

  out.fonte = 'cvm';
  out.fonteRotulo = cvm.fonteRotulo ? `${cvm.fonteRotulo} + cotação` : 'CVM + cotação';
  out.dataReferencia = cvm.dataReferencia || null;
  out.fetchedAtMs = doc.cvmFetchedAtMs || doc.mercadoFetchedAtMs || doc.fetchedAtMs || null;
  return out;
}

async function handleFundamentals(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const rawTickers = (req.query.tickers || '').toString();
  const requested = Array.from(
    new Set(
      rawTickers
        .split(',')
        .map((t) =>
          String(t || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
        .map((t) => (ehCripto(t) ? t : sanitizeTicker(t)))
        .filter(Boolean)
    )
  ).slice(0, MAX_TICKERS_PER_REQUEST);

  if (!requested.length) {
    return res
      .status(400)
      .json({ error: 'missing_tickers', detail: 'Use ?op=fundamentals&tickers=BBAS3,MXRF11,BTC' });
  }

  const agora = Date.now();
  const database = db();
  const refs = requested.map((t) => database.collection(FUNDAMENTALS_COLLECTION).doc(t));
  const snaps = await database.getAll(...refs);
  const fresh = {};
  const stale = [];
  const documentos = {};
  snaps.forEach((snap, i) => {
    const t = requested[i];
    const d = snap.data();
    if (d) documentos[t] = d;
    // Só a idade do ramo de MERCADO decide rebuscar: o ramo da CVM é
    // atualizado pelo job de ingestão e tem validade de meses (uma DFP é
    // anual), não de um dia.
    const idade = d && (d.mercadoFetchedAtMs || d.fetchedAtMs);
    if (typeof idade === 'number' && agora - idade < FUNDAMENTALS_TTL_MS) fresh[t] = d;
    else stale.push(t);
  });

  let fetched = {};
  const erros = [];
  if (stale.length) {
    const criptos = stale.filter(ehCripto);
    const bolsa = stale.filter((t) => !ehCripto(t));
    const [resBolsa, resCripto] = await Promise.all([
      bolsa.length
        ? fetchBrapiFundamentals(bolsa).catch((e) => {
            erros.push({ fonte: 'brapi', erro: e.message });
            return {};
          })
        : Promise.resolve({}),
      criptos.length
        ? fetchCoingeckoFundamentals(criptos).catch((e) => {
            erros.push({ fonte: 'coingecko', erro: e.message });
            return {};
          })
        : Promise.resolve({}),
    ]);
    fetched = { ...resBolsa, ...resCripto };

    const batch = database.batch();
    let gravou = 0;
    for (const t of Object.keys(fetched)) {
      batch.set(
        database.collection(FUNDAMENTALS_COLLECTION).doc(t),
        {
          mercado: fetched[t],
          mercadoFetchedAtMs: agora,
          dateYmd: todayYmdBRT(agora),
          updatedAt: timestamp().now(),
        },
        { merge: true }
      );
      documentos[t] = { ...(documentos[t] || {}), mercado: fetched[t], mercadoFetchedAtMs: agora };
      gravou++;
    }
    if (gravou) {
      await batch
        .commit()
        .catch((e) => console.warn('[market/fundamentals] cache_write_failed', e.message));
    }
  }

  const fundamentos = {};
  const indisponiveis = [];
  let comCvm = 0;
  for (const t of requested) {
    const composto = comporFundamentos(documentos[t]);
    if (!composto) {
      indisponiveis.push(t);
      continue;
    }
    if (composto.fonte === 'cvm') comCvm++;
    fundamentos[t] = { ...composto, cached: !!fresh[t] };
  }

  return res.json({
    success: true,
    today: todayYmdBRT(agora),
    requested: requested.length,
    fromCache: Object.keys(fresh).length,
    fromApi: Object.keys(fetched).length,
    comCvm,
    indisponiveis,
    fundamentos,
    erros,
  });
}

// ============================================================
// === op=rendafixa — taxas correntes do Tesouro Direto ===
// ============================================================
//
// Renda fixa não tem "ticker" nem cotação: o que define o ativo é a taxa
// contratada hoje. Sem esta op, a classe com maior peso na carteira de um
// Conservador seria a única sem dado real por trás do score.
//
// As taxas chegam em bases diferentes conforme o título (IPCA+ traz a taxa
// REAL, prefixado traz a nominal, Selic traz um spread sobre a Selic), e o
// motor precisa de tudo na mesma régua. A conversão usa as premissas de
// PREMISSAS_ANUAIS — as mesmas curvas sintéticas da simulação histórica,
// para as duas telas não discordarem entre si.

function rfClassificarTipo(nome) {
  const n = String(nome || '').toLowerCase();
  if (n.includes('ipca')) return 'ipca';
  if (n.includes('selic')) return 'selic';
  if (n.includes('renda+') || n.includes('renda +')) return 'ipca';
  if (n.includes('educa+') || n.includes('educa +')) return 'ipca';
  if (n.includes('prefixado')) return 'prefixado';
  return 'outro';
}

/**
 * Um título do Tesouro -> indicadores da classe `rf` do motor.
 *
 * `taxa` é sempre o número que o Tesouro publica para aquele título; o que
 * ele significa depende do tipo, e é isso que esta função resolve.
 */
function mapTesouroTitulo(bruto, premissas) {
  const ipca = (premissas && premissas.IPCA) != null ? premissas.IPCA * 100 : 4.5;
  const cdi = (premissas && premissas.CDI) != null ? premissas.CDI * 100 : 13.25;
  const selic = (premissas && premissas.SELIC) != null ? premissas.SELIC * 100 : cdi;

  const nome = bruto.nome;
  const taxa = fundNum(bruto.taxa);
  if (!nome || taxa === null) return null;
  const tipo = rfClassificarTipo(nome);

  let taxaRealAnual = null;
  let taxaNominal = null;
  if (tipo === 'ipca') {
    taxaRealAnual = taxa;
    taxaNominal = ((1 + taxa / 100) * (1 + ipca / 100) - 1) * 100;
  } else if (tipo === 'selic') {
    taxaNominal = selic + taxa;
    taxaRealAnual = ((1 + taxaNominal / 100) / (1 + ipca / 100) - 1) * 100;
  } else {
    taxaNominal = taxa;
    taxaRealAnual = ((1 + taxa / 100) / (1 + ipca / 100) - 1) * 100;
  }

  const n = nome.toLowerCase();
  const comCupom = n.includes('juros semestrais') || n.includes('renda+') || n.includes('educa+');

  return {
    ticker: bruto.ticker,
    nome,
    classe: 'rf',
    tipo,
    vencimento: bruto.vencimento || null,
    precoUnitario: fundNum(bruto.precoUnitario),
    investimentoMinimo: fundNum(bruto.investimentoMinimo),
    taxaContratada: taxa,
    taxaNominalAnual: taxaNominal,
    taxaRealAnual,
    premioSobreCdi: cdi > 0 && taxaNominal !== null ? (taxaNominal / cdi) * 100 : null,
    geraRendaPeriodica: comCupom ? 1 : 0,
    riscoEmissor: 10, // Tesouro Nacional: menor risco de crédito do mercado local.
    liquidezDias: 1, // Recompra diária garantida pelo Tesouro (D+1).
    isentoIR: 0, // Tributado pela tabela regressiva.
    fonte: 'tesouro_direto',
    fonteRotulo: 'Taxa de hoje · Tesouro Direto',
    dataReferencia: bruto.vencimento || null,
  };
}

/**
 * Extrai a lista de títulos da resposta do Tesouro.
 *
 * Os nomes de campo daquele endpoint são abreviados e já mudaram de forma
 * antes (`TrsrBdTradgList` / `TrsrBd`), então cada campo é procurado em mais
 * de um caminho e um título malformado é descartado sozinho, sem derrubar
 * os outros.
 */
function parseTesouroResposta(json) {
  const lista =
    (json && json.response && json.response.TrsrBdTradgList) ||
    (json && json.TrsrBdTradgList) ||
    (Array.isArray(json) ? json : []) ||
    [];
  const out = [];
  for (const item of lista) {
    const bd = (item && (item.TrsrBd || item.trsrBd)) || item || {};
    const nome = bd.nm || bd.name || bd.nome || null;
    const taxa = bd.anulInvstmtRate != null ? bd.anulInvstmtRate : bd.annualInvestmentRate;
    if (!nome || fundNum(taxa) === null) continue;
    out.push({
      ticker: String(nome)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
      nome,
      taxa,
      vencimento: bd.mtrtyDt || bd.maturityDate || null,
      precoUnitario: bd.untrInvstmtVal != null ? bd.untrInvstmtVal : bd.unitaryInvestmentValue,
      investimentoMinimo: bd.minInvstmtAmt != null ? bd.minInvstmtAmt : bd.minimumInvestmentAmount,
    });
  }
  return out;
}

async function fetchTesouroDireto(premissas) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(TESOURO_URL, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`tesouro_${res.status}`);
  const json = await res.json();
  const brutos = parseTesouroResposta(json);
  if (!brutos.length) throw new Error('tesouro_formato_inesperado');
  return brutos.map((b) => mapTesouroTitulo(b, premissas || PREMISSAS_ANUAIS)).filter(Boolean);
}

async function handleRendaFixa(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const agora = Date.now();
  const database = db();
  const ref = database.collection(RF_COLLECTION).doc('tesouroDireto');
  const snap = await ref.get().catch(() => null);
  const cache = snap && snap.exists ? snap.data() : null;

  if (cache && typeof cache.fetchedAtMs === 'number' && agora - cache.fetchedAtMs < RF_TTL_MS) {
    return res.json({
      success: true,
      cached: true,
      fetchedAt: cache.fetchedAtMs,
      premissas: cache.premissas || PREMISSAS_ANUAIS,
      origemPremissas: cache.origemPremissas || null,
      premissasDegradadas: !!cache.premissasDegradadas,
      titulos: cache.titulos || [],
    });
  }

  const { premissas, origem, degradado } = await resolverPremissas(database);

  let titulos;
  try {
    titulos = await fetchTesouroDireto(premissas);
  } catch (e) {
    console.warn('[market/rendafixa] tesouro_failed', e.message);
    // Cache vencido ainda vale mais do que classe vazia na tela: taxa de
    // ontem erra na terceira casa, ausência de taxa zera o score da classe.
    if (cache && cache.titulos) {
      return res.json({
        success: true,
        cached: true,
        stale: true,
        fetchedAt: cache.fetchedAtMs,
        premissas: cache.premissas || PREMISSAS_ANUAIS,
        origemPremissas: cache.origemPremissas || null,
        premissasDegradadas: true,
        titulos: cache.titulos,
        erro: e.message,
      });
    }
    return res.status(502).json({ error: 'tesouro_indisponivel', detail: e.message });
  }

  await ref
    .set(
      {
        titulos,
        premissas,
        origemPremissas: origem,
        premissasDegradadas: degradado,
        fetchedAtMs: agora,
        dateYmd: todayYmdBRT(agora),
        updatedAt: timestamp().now(),
      },
      { merge: true }
    )
    .catch((e) => console.warn('[market/rendafixa] cache_write_failed', e.message));

  return res.json({
    success: true,
    cached: false,
    fetchedAt: agora,
    premissas,
    origemPremissas: origem,
    premissasDegradadas: degradado,
    titulos,
  });
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
    if (op === 'fundamentals') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return handleFundamentals(req, res);
    }
    if (op === 'indicadores') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return handleIndicadores(req, res);
    }
    if (op === 'rendafixa') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
      return handleRendaFixa(req, res);
    }
    if (op === 'warmup') {
      return handleWarmup(req, res);
    }
    return res.status(400).json({
      error: 'unknown_op',
      detail:
        'Use ?op=quote, ?op=history, ?op=news, ?op=fundamentals, ?op=indicadores, ?op=rendafixa or ?op=warmup',
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
  fetchSource,
  newsKey,
  NEWS_SOURCES,
  NEWS_MAX_PER_FEED,
  NEWS_MAX_ITEMS,
  // Normalização de fundamentos: transforma resposta de terceiro em
  // indicador do motor. Pura, sem rede nem Firestore — a parte com mais
  // conversão de unidade e mais chance de errar em silêncio.
  fundAgregarDividendos,
  fundCrescimentoDre,
  fundCobertura,
  mapBrapiFundamental,
  comporFundamentos,
  mapTesouroTitulo,
  parseTesouroResposta,
  rfClassificarTipo,
  PREMISSAS_ANUAIS,
  CHAVES_ACAO,
  // BCB: escolha de série com validação de faixa. É onde um código errado
  // devolveria número válido de outra coisa e passaria despercebido.
  sgsData,
  anualizar252,
  resolverIndicadorSgs,
  carregarIndicadoresBcb,
  resolverPremissas,
  SGS_SERIES,
};
