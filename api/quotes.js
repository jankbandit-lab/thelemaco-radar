// THELÉMACO · /api/quotes — cotizaciones reales para la cinta inferior.
// Por defecto Yahoo Finance v8 (gratis, sin clave). Si defines FINNHUB_API_KEY, usa Finnhub (más fiable).
// Si todo falla, devuelve valores indicativos para que la cinta nunca quede vacía.

const SYMS = [
  { label: 'S&P 500', tv: 'SPX',     yahoo: '^GSPC',   seed: '5.981',  fb: '+0,5' },
  { label: 'NASDAQ',  tv: 'IXIC',    yahoo: '^IXIC',   seed: '19.624', fb: '+0,7' },
  { label: 'IBEX 35', tv: 'IBEX35',  yahoo: '^IBEX',   seed: '19.152', fb: '+1,8' },
  { label: 'EUROSTOXX', tv: 'SX5E',  yahoo: '^STOXX50E', seed: '5.412', fb: '+0,9' },
  { label: 'NVDA',    tv: 'NVDA',    yahoo: 'NVDA',    seed: '—',      fb: '+0,9', fh: 'NVDA' },
  { label: 'AAPL',    tv: 'AAPL',    yahoo: 'AAPL',    seed: '—',      fb: '+0,3', fh: 'AAPL' },
  { label: 'AMD',     tv: 'AMD',     yahoo: 'AMD',     seed: '—',      fb: '+1,1', fh: 'AMD' },
  { label: 'BTC',     tv: 'BTCUSD',  yahoo: 'BTC-USD', seed: '63.785', fb: '+1,2', fh: 'BINANCE:BTCUSDT' },
  { label: 'ETH',     tv: 'ETHUSD',  yahoo: 'ETH-USD', seed: '1.668',  fb: '-0,4', fh: 'BINANCE:ETHUSDT' },
  { label: 'CRUDO WTI', tv: 'USOIL', yahoo: 'CL=F',    seed: '85,1',   fb: '-2,0' },
  { label: 'BRENT',   tv: 'UKOIL',   yahoo: 'BZ=F',    seed: '88,3',   fb: '-1,8' },
  { label: 'ORO',     tv: 'XAUUSD',  yahoo: 'GC=F',    seed: '2.410',  fb: '-0,6' },
  { label: 'EUR/USD', tv: 'EURUSD',  yahoo: 'EURUSD=X', seed: '1,082', fb: '-0,3' },
  { label: 'DXY',     tv: 'DXY',     yahoo: 'DX-Y.NYB', seed: '104,8', fb: '+0,4' },
  { label: 'VIX',     tv: 'VIX',     yahoo: '^VIX',    seed: '19,4',   fb: '-5,1' },
];

const TTL = 60 * 1000;
let cache = { time: 0, data: null };

const fmtPrice = v => (v >= 1000 ? v.toLocaleString('es-ES', { maximumFractionDigits: 0 })
  : v.toLocaleString('es-ES', { maximumFractionDigits: v < 10 ? 3 : 2 }));
const fmtChg = p => (p >= 0 ? '+' : '') + p.toFixed(1).replace('.', ',');

async function yahoo(sym) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`,
      { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(to);
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    if (!m) return null;
    const price = m.regularMarketPrice, prev = m.chartPreviousClose || m.previousClose;
    if (price == null || !prev) return null;
    return { price, chg: ((price - prev) / prev) * 100 };
  } catch { clearTimeout(to); return null; }
}

async function finnhub(fh, key) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(fh)}&token=${key}`);
    const j = await r.json();
    if (j.c == null || !j.pc) return null;
    return { price: j.c, chg: ((j.c - j.pc) / j.pc) * 100 };
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (cache.data && Date.now() - cache.time < TTL) {
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.json(cache.data);
  }
  const key = process.env.FINNHUB_API_KEY;
  let live = 0;
  const quotes = await Promise.all(SYMS.map(async s => {
    let q = null;
    if (key && s.fh) q = await finnhub(s.fh, key);
    if (!q) q = await yahoo(s.yahoo);
    if (q) { live++; return { s: s.label, sym: s.tv, p: fmtPrice(q.price), c: fmtChg(q.chg) }; }
    return { s: s.label, sym: s.tv, p: s.seed, c: s.fb };   // respaldo indicativo
  }));
  const data = { quotes, live: live >= Math.ceil(SYMS.length / 2), updated: new Date().toISOString() };
  cache = { time: Date.now(), data };
  res.setHeader('Cache-Control', 's-maxage=60');
  return res.json(data);
};
