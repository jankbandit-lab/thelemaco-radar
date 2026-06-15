// THELÉMACO · /api/news v2 — OPTIMIZADO para Vercel Hobby (30s máx.)
// Menos feeds, menos noticias, sin og:image en el backend (el frontend lo resuelve), prompt corto.
const Parser = require('rss-parser');
const parser = new Parser({ timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (Thelemaco)' } });

// Solo 4 feeds rápidos y fiables (reducido para caber en 30s)
const FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',    source: 'CNBC',       domain: 'cnbc.com',       cat: 'ACCIONES' },
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',     source: 'CNBC Economy',domain: 'cnbc.com',       cat: 'MACRO' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',           source: 'CoinDesk',   domain: 'coindesk.com',   cat: 'CRIPTO' },
  { url: 'https://finance.yahoo.com/news/rssindex',                   source: 'Yahoo Finance',domain:'finance.yahoo.com',cat:'ACCIONES' },
];

const TTL = 20 * 60 * 1000; // 20 min caché (ahorra llamadas IA)
let cache = { time: 0, data: null };

function clean(s, n = 220) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

async function collectFeeds() {
  const results = await Promise.allSettled(FEEDS.map(f =>
    parser.parseURL(f.url).then(r => ({ f, r }))
  ));
  const items = [];
  const since = Date.now() - 24 * 3600 * 1000;
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const { f, r } = res.value;
    for (const it of (r.items || []).slice(0, 6)) {
      const ts = it.isoDate ? Date.parse(it.isoDate) : Date.now();
      if (ts < since) continue;
      items.push({
        title: clean(it.title, 160),
        summary: clean(it.contentSnippet || it.content || '', 200),
        link: it.link || '', source: f.source, domain: f.domain, cat_hint: f.cat, ts
      });
    }
  }
  const seen = new Set(); const dedup = [];
  for (const it of items.sort((a, b) => b.ts - a.ts)) {
    const key = it.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) continue; seen.add(key); dedup.push(it);
  }
  return dedup.slice(0, 18);
}

function buildPrompt(items) {
  const lista = items.map((it, i) => `#${i} [${it.source}/${it.cat_hint}] ${it.title}`).join('\n');
  return `Analista financiero: de estas noticias elige las 10 más relevantes para un trader de acciones US. Para cada una devuelve JSON con:
idx(número #),titular(español España),resumen(1 frase ES),titular_original,idioma(EN/ES),color(rojo|amarillo|violeta|azul|blanco),categoria(ACCIONES|MACRO|MATERIAS|CRIPTO|GEOPOLITICA),img(2 palabras EN para foto),activos(8-15 objetos {t:ticker,k:acc|etf|idx|mat|fx|cri|bono,d:+|-|~}),analisis(2 frases ES).
hero:true en la más importante. SOLO JSON: {"noticias":[...]}
NOTICIAS:
${lista}`;
}

function parseJSON(txt) {
  if (!txt) throw new Error('respuesta vacía');
  let t = String(txt).replace(/```json/gi, '```').replace(/```/g, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('sin JSON');
  return JSON.parse(t.slice(s, e + 1));
}

async function callHaiku(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'claude-haiku-4-5-20241001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const fresh = (req.url || '').includes('fresh=1');
  if (!fresh && cache.data && Date.now() - cache.time < TTL) {
    return res.json(cache.data);
  }
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en Vercel Environment Variables');

    // 1. RSS en paralelo (~3-5s)
    const items = await collectFeeds();
    if (!items.length) throw new Error('Sin items RSS');

    // 2. Haiku clasifica (~3-8s, es muy rápido)
    const txt = await callHaiku(buildPrompt(items));
    const json = parseJSON(txt);

    // 3. Fusionar con fuentes reales (sin og:image → el frontend lo resuelve)
    const noticias = (json.noticias || []).map(n => {
      const src = items[Number(n.idx)] || {};
      const fecha = src.ts ? new Date(src.ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : 'hoy';
      return {
        hero: !!n.hero, img: n.img || 'finance',
        titular: n.titular, resumen: n.resumen,
        titular_original: n.titular_original, idioma: n.idioma || 'EN',
        color: n.color, categoria: n.categoria, analisis: n.analisis,
        activos: Array.isArray(n.activos) ? n.activos : [],
        fuente: src.source, dominio: src.domain, url: src.link, hora: fecha
      };
    }).filter(n => n.titular && n.url);

    const data = { news: noticias, updated: new Date().toISOString(), count: noticias.length };
    cache = { time: Date.now(), data };
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
