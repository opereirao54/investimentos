const { db, timestamp } = require('../_lib/firebase-admin');

// Cron diário (Vercel Cron) que pré-aquece o cache de cotações para todos
// os tickers de RV referenciados em users/*/investimentos. Roda às 22:00 UTC
// (19:00 BRT, ~10min após fechamento B3) seg-sex.
//
// Auth: header `Authorization: Bearer <CRON_SECRET>`. O Vercel Cron envia
// esse header automaticamente quando CRON_SECRET está definida.
//
// Custo BRAPI: 1 chamada batch para cada N=50 tickers únicos da base.
// Custo Firestore: collectionGroup scan + batch.set por ticker.

const BRAPI_BASE = 'https://brapi.dev/api/quote';
const BATCH_SIZE = 50;
const CACHE_COLLECTION = 'marketQuotes';

function todayYmdBRT(now = Date.now()) {
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

async function fetchBatch(tickers) {
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
  if (!res.ok) throw new Error(`brapi_${res.status}`);
  const json = await res.json();
  return json.results || [];
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'cron_disabled' });
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const started = Date.now();
  const database = db();

  // Coleta tickers únicos varrendo subcoleções `investimentos`.
  // collectionGroup permite query cross-user em uma única operação.
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
    // Heurística: tickers B3 têm 4 letras + 1-2 dígitos (PETR4, ITSA4, TAEE11).
    // FIIs terminam em 11. BDRs em 32/33/34/35. Ignora códigos que parecem
    // de Renda Fixa (CDB, LCI etc) — não há cotação BRAPI para eles.
    if (clean && /^[A-Z]{4}\d{1,2}$/.test(clean)) {
      tickerSet.add(clean);
    }
  });

  const tickers = Array.from(tickerSet);
  if (!tickers.length) {
    return res.json({ success: true, tickers: 0, durationMs: Date.now() - started });
  }

  const today = todayYmdBRT();
  let updated = 0;
  let failed = 0;
  const errors = [];

  // Processa em batches sequenciais para respeitar rate-limit da BRAPI.
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const slice = tickers.slice(i, i + BATCH_SIZE);
    let results;
    try {
      results = await fetchBatch(slice);
    } catch (e) {
      failed += slice.length;
      errors.push({ batch: i / BATCH_SIZE, error: e.message });
      continue;
    }
    const writeBatch = database.batch();
    for (const r of results) {
      if (!r || !r.symbol || typeof r.regularMarketPrice !== 'number') continue;
      const sym = r.symbol.toUpperCase();
      writeBatch.set(database.collection(CACHE_COLLECTION).doc(sym), {
        ticker: sym,
        price: r.regularMarketPrice,
        previousClose: r.regularMarketPreviousClose ?? null,
        change: r.regularMarketChange ?? null,
        changePct: r.regularMarketChangePercent ?? null,
        currency: r.currency || 'BRL',
        shortName: r.shortName || r.longName || null,
        marketTime: r.regularMarketTime || null,
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
};
