// THELÉMACO · /api/news — captura RSS gratis, traduce + clasifica con IA (Claude Haiku / OpenRouter) y añade imagen OG.
// Cachea el resultado para no gastar llamadas de IA en cada visita. Coste objetivo: céntimos/día.
const Parser = require('rss-parser');
const parser = new Parser({ timeout: 9000, headers: { 'User-Agent': 'Mozilla/5.0 (Thelemaco Radar)' } });

// Fuentes RSS gratuitas (puedes añadir/quitar). cat = pista de carpeta.
const FEEDS = [
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',                 source: 'WSJ Markets',      domain: 'wsj.com',          cat: 'MACRO' },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',         source: 'CNBC Markets',     domain: 'cnbc.com',         cat: 'ACCIONES' },
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',          source: 'CNBC Economy',     domain: 'cnbc.com',         cat: 'MACRO' },
  { url: 'https://www.investing.com/rss/news_25.rss',                     source: 'Investing',        domain: 'investing.com',    cat: 'ACCIONES' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',               source: 'CoinDesk',         domain: 'coindesk.com',     cat: 'CRIPTO' },
  { url: 'https://www.investing.com/rss/news_11.rss',                     source: 'Investing Commodities', domain: 'investing.com', cat: 'MATERIAS' },
  { url: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews',     source: 'WSJ World',        domain: 'wsj.com',          cat: 'GEOPOLITICA' },
  { url: 'https://finance.yahoo.com/news/rssindex',                       source: 'Yahoo Finanzas',   domain: 'finance.yahoo.com',cat: 'ACCIONES' },
];

const TTL = 15 * 60 * 1000;          // 15 min de caché
let cache = { time: 0, data: null };

function clean(s, n = 280) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}
function host(link) { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; } }

async function collectFeeds() {
  const results = await Promise.allSettled(FEEDS.map(f => parser.parseURL(f.url).then(r => ({ f, r }))));
  const items = [];
  const since = Date.now() - 36 * 3600 * 1000;        // últimas 36 h
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const { f, r } = res.value;
    for (const it of (r.items || []).slice(0, 8)) {
      const ts = it.isoDate ? Date.parse(it.isoDate) : Date.now();
      if (ts < since) continue;
      items.push({
        title: clean(it.title, 200),
        summary: clean(it.contentSnippet || it.content || it.summary, 320),
        link: it.link || '',
        source: f.source,
        domain: f.domain || host(it.link),
        cat_hint: f.cat,
        ts
      });
    }
  }
  // dedupe por título y ordena por fecha desc
  const seen = new Set(); const dedup = [];
  for (const it of items.sort((a, b) => b.ts - a.ts)) {
    const key = it.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue; seen.add(key); dedup.push(it);
  }
  return dedup.slice(0, 30);
}

// Modelos GRATUITOS de respaldo (rotación). Si uno falla o te limita (429), prueba el siguiente.
// El catálogo :free cambia a menudo; revisa https://openrouter.ai/models y ajusta esta lista.
const FREE_FALLBACKS = [
  'deepseek/deepseek-chat-v3-0324:free',          // buen español + JSON (recomendado)
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-4-maverick:free',
  'mistralai/mistral-small-3.1-24b-instruct:free'
];

async function anthropicCall(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.LLM_MODEL || 'claude-3-5-haiku-latest', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error('Anthropic ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function openrouterCall(model, prompt) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
      'HTTP-Referer': process.env.SITE_URL || 'https://thelemaco-radar.vercel.app',  // mejora límites/observabilidad
      'X-Title': 'Thelemaco Radar'
    },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error('OpenRouter[' + model + '] ' + r.status + ' ' + (await r.text()).slice(0, 140));
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

// Clasifica con rotación: intenta cada modelo gratuito hasta obtener un JSON válido.
async function classify(prompt) {
  if ((process.env.LLM_PROVIDER || 'openrouter').toLowerCase() === 'anthropic') {
    return parseJSON(await anthropicCall(prompt));
  }
  const models = [process.env.LLM_MODEL].filter(Boolean)
    .concat(FREE_FALLBACKS.filter(m => m !== process.env.LLM_MODEL));
  let lastErr;
  for (const m of models) {
    try {
      const j = parseJSON(await openrouterCall(m, prompt));
      if (j && Array.isArray(j.noticias) && j.noticias.length) return j;
      lastErr = new Error('JSON inválido de ' + m);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Todos los modelos gratuitos fallaron');
}

function buildPrompt(items) {
  const lista = items.map((it, i) => `#${i} [${it.source} · ${it.cat_hint}] ${it.title} :: ${it.summary}`).join('\n');
  return `Eres un analista financiero senior. A partir de estas noticias (con su índice #), elige las 14 MÁS RELEVANTES para un trader y procesa cada una.
Para cada noticia elegida devuelve un objeto con:
- "idx": número # de la noticia original (para enlazar fuente/URL).
- "titular" y "resumen": en ESPAÑOL DE ESPAÑA (resumen 1-2 frases). Si el original ya está en español, tradúcelo igualmente a un castellano natural.
- "titular_original","resumen_original": en el idioma original. "idioma": "EN","ES", etc.
- "color": rojo|amarillo|violeta|azul|blanco (rojo=crítico/cisne negro; amarillo=macro IPC/empleo/tipos; violeta=sector entero p.ej. materias/cripto; azul=empresa o activo concreto; blanco=bajo impacto).
- "categoria": ACCIONES|MACRO|MATERIAS|CRIPTO|GEOPOLITICA.
- "img": 2-3 palabras clave en inglés para una foto de archivo (ej "oil,tanker").
- "activos": lista AMPLIA y veraz (8-18) de activos afectados, cada uno {"t":ticker,"k":tipo,"d":direccion} con k ∈ acc|etf|idx|mat|fx|cri|bono y d ∈ "+" (se beneficia),"-" (se perjudica),"~" (expuesto/neutro).
- "analisis": 2-3 frases del PORQUÉ del color y el efecto esperado en mercado.
Marca "hero":true en la de mayor impacto. Devuelve EXCLUSIVAMENTE un JSON válido sin markdown: {"noticias":[...]}.

NOTICIAS:
${lista}`;
}

function parseJSON(txt) {
  if (!txt) throw new Error('respuesta vacía');
  let t = String(txt).replace(/```json/gi, '```').replace(/```/g, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('sin JSON en la respuesta');
  return JSON.parse(t.slice(s, e + 1));
}

async function ogImage(url) {
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 3500);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Thelemaco Radar)' } });
    clearTimeout(to);
    const html = (await r.text()).slice(0, 60000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
           || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    return m ? m[1] : null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const fresh = (req.url || '').includes('fresh=1');
  if (!fresh && cache.data && Date.now() - cache.time < TTL) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.json(cache.data);
  }
  try {
    const items = await collectFeeds();
    if (!items.length) throw new Error('Sin items RSS (revisa las URLs de FEEDS)');

    const json = await classify(buildPrompt(items));

    // fusiona la salida de la IA con la fuente real (url/fuente/dominio/hora)
    const noticias = (json.noticias || []).map(n => {
      const src = items[Number(n.idx)] || {};
      const fecha = src.ts ? new Date(src.ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : 'hoy';
      return {
        hero: !!n.hero, img: n.img || 'finance',
        titular: n.titular, resumen: n.resumen,
        titular_original: n.titular_original, resumen_original: n.resumen_original, idioma: n.idioma || 'EN',
        color: n.color, categoria: n.categoria, analisis: n.analisis,
        activos: Array.isArray(n.activos) ? n.activos : [],
        fuente: src.source || n.fuente, dominio: src.domain || n.dominio, url: src.link || n.url, hora: fecha
      };
    }).filter(n => n.titular && n.url);

    // imagen OG en paralelo (con timeout y respaldo en el frontend)
    await Promise.allSettled(noticias.map(async n => { n.imagen = await ogImage(n.url); }));

    const data = { news: noticias, updated: new Date().toISOString(), count: noticias.length };
    cache = { time: Date.now(), data };
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
