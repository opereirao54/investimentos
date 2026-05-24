const { db, timestamp } = require('./_lib/firebase-admin');
const { requireUser, cors } = require('./_lib/auth');

// Endpoint único de mercado — consolidado num arquivo só para respeitar o
// limite de 12 functions do Vercel Hobby. Sub-roteamento via ?op=:
//   - GET  /api/market?op=quote&tickers=PETR4,VALE3   (auth: Firebase Bearer)
//   - POST /api/market?op=warmup                       (auth: Bearer CRON_SECRET)
//
// Cache em Firestore: marketQuotes/{TICKER}.
// BRAPI grátis ~15k req/mês; cada chamada cobre N tickers num único batch.

const BRAPI_BASE = 'https://brapi.dev/api/quote';
const MAX_TICKERS_PER_REQUEST = 50;
const BATCH_SIZE = 50;
const CACHE_COLLECTION = 'marketQuotes';

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
  const clean = t.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 4 || clean.length > 10) return null;
  return clean;
}

async function fetchBrapi(tickers) {
  if (!tickers.length) return {};
  const url = `${BRAPI_BASE}/${encodeURIComponent(tickers.join(','))}`;
  const token = process.env.BRAPI_TOKEN;
  const headers = { 'Accept': 'application/json' };
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
  for (const r of (json.results || [])) {
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
  const requested = Array.from(new Set(
    rawTickers.split(',').map(sanitizeTicker).filter(Boolean)
  )).slice(0, MAX_TICKERS_PER_REQUEST);

  if (!requested.length) {
    return res.status(400).json({ error: 'missing_tickers', detail: 'Use ?op=quote&tickers=PETR4,VALE3' });
  }

  const today = todayYmdBRT();
  const database = db();
  const refs = requested.map(t => database.collection(CACHE_COLLECTION).doc(t));
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
        batch.set(database.collection(CACHE_COLLECTION).doc(t), {
          ...f,
          dateYmd: today,
          updatedAt: timestamp().now(),
          source: 'brapi',
        }, { merge: true });
      }
      await batch.commit().catch(e => console.warn('[market/quote] cache_write_failed', e.message));
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
  snapshot.forEach(doc => {
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
  let updated = 0, failed = 0;
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
      writeBatch.set(database.collection(CACHE_COLLECTION).doc(r.ticker), {
        ...r,
        dateYmd: today,
        updatedAt: timestamp().now(),
        source: 'brapi-cron',
      }, { merge: true });
      updated++;
    }
    await writeBatch.commit().catch(e => {
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

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  const op = (req.query.op || '').toString();
  if (op === 'quote') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return handleQuote(req, res);
  }
  if (op === 'warmup') {
    if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return handleWarmup(req, res);
  }
  return res.status(400).json({ error: 'unknown_op', detail: 'Use ?op=quote or ?op=warmup' });
};
