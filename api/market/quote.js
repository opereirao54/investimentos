const { db, timestamp, fieldValue } = require('../_lib/firebase-admin');
const { requireUser, cors } = require('../_lib/auth');

// Endpoint de cotações de Renda Variável com cache em Firestore.
// Cliente envia ?tickers=PETR4,VALE3,ITUB4 (máx 50).
// Fluxo:
//   1. Lê cache em marketQuotes/{TICKER}; se mesma data BRT (yyyy-mm-dd), devolve.
//   2. Para tickers sem cache fresco, chama BRAPI em batch único.
//   3. Persiste cada cotação e devolve a lista consolidada.
//
// Trial gratuito da BRAPI permite ~15k req/mês. Cada hit cobre N tickers
// num único request, então o custo real escala com (#dias úteis × usuários
// que abrem a aba antes do cron diário rodar).

const BRAPI_BASE = 'https://brapi.dev/api/quote';
const MAX_TICKERS_PER_REQUEST = 50;
const CACHE_COLLECTION = 'marketQuotes';

function todayYmdBRT(now = Date.now()) {
  // BRT = UTC-3 (sem DST atualmente). Convertemos o instante atual em
  // milissegundos para "datetime BRT" subtraindo 3h e formatando como UTC.
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
  const timer = setTimeout(() => ctrl.abort(), 8000);
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

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const rawTickers = (req.query.tickers || '').toString();
  const requested = Array.from(new Set(
    rawTickers.split(',').map(sanitizeTicker).filter(Boolean)
  )).slice(0, MAX_TICKERS_PER_REQUEST);

  if (!requested.length) {
    return res.status(400).json({ error: 'missing_tickers', detail: 'Use ?tickers=PETR4,VALE3' });
  }

  const today = todayYmdBRT();
  const database = db();
  const refs = requested.map(t => database.collection(CACHE_COLLECTION).doc(t));

  // getAll é uma única round-trip vs N reads sequenciais.
  const snaps = await database.getAll(...refs);
  const fresh = {};
  const stale = [];
  snaps.forEach((snap, i) => {
    const t = requested[i];
    const d = snap.data();
    if (d && d.dateYmd === today && typeof d.price === 'number') {
      fresh[t] = d;
    } else {
      stale.push(t);
    }
  });

  let fetched = {};
  let fetchError = null;
  if (stale.length) {
    try {
      fetched = await fetchBrapi(stale);
      // Persiste novidades em paralelo. Se falhar a escrita, ainda devolve
      // ao cliente — o próximo request tenta novamente.
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
    if (fresh[t]) {
      quotes[t] = { ...fresh[t], cached: true };
    } else if (fetched[t]) {
      quotes[t] = { ...fetched[t], cached: false };
    } else {
      quotes[t] = { ticker: t, price: null, cached: false, error: 'unavailable' };
    }
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
};
