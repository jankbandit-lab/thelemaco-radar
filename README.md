# THELÉMACO · Radar de Impacto de Mercado

Portal de noticias para trading: captura titulares, los **traduce al español** y los **clasifica en 5 niveles de impacto** (con tus colores), lista los **activos afectados** y muestra una **cinta de cotizaciones** tipo CNN. Todo desplegable en Vercel por **~0 €/mes**.

---

## Resumen en 3 puntos
- **Frontend** (`index.html`): mosaico editorial + portada + cinta inferior. Funciona solo, con datos semilla, aunque el backend no esté configurado.
- **Backend** (`api/news.js`, `api/quotes.js`): captura RSS gratis → IA barata clasifica/traduce → cotizaciones reales gratis. Tu clave vive segura como variable de entorno.
- **Coste**: hosting 0 € (Vercel Hobby) + IA en céntimos/día (Claude Haiku) + datos 0 € (RSS y Yahoo). Total realista: **0–3 €/mes**.

---

## Arquitectura (el porqué del coste 0)

```
 Navegador (index.html)
     │  fetch /api/news        fetch /api/quotes
     ▼                              ▼
 api/news.js                   api/quotes.js
   1. RSS gratis (WSJ, CNBC, CoinDesk, Investing, Yahoo…)
   2. Claude Haiku / OpenRouter  → traduce + color + categoría + activos
   3. og:image de cada noticia   → imagen real
   4. caché 15 min               → no se paga IA en cada visita
                                  Yahoo Finance v8 (sin clave) / Finnhub opcional
```

- **Noticias**: RSS = 0 € (en vez de NewsAPI ~449 $/mes).
- **IA**: Claude **Haiku** clasifica 14 noticias por **fracciones de céntimo**; con caché de 15 min, son pocas llamadas al día. Si prefieres 0 € absoluto, usa un modelo `:free` de OpenRouter (menor calidad).
- **Cotizaciones**: Yahoo Finance v8 sin clave. Si te limita, añade una clave **gratuita** de Finnhub.
- **Imágenes**: se extrae la `og:image` real de cada noticia; si falla, el frontend usa captura/te­mática de respaldo. Nunca se ve roto.

---

## Despliegue en 5 minutos (Vercel, gratis)

### Opción rápida — desde la web de Vercel
1. Crea un repo en GitHub y sube esta carpeta (o usa "Deploy" arrastrando el ZIP en vercel.com).
2. En **vercel.com → Add New → Project**, importa el repo.
3. Framework preset: **Other** (no toques nada; Vercel detecta `/api` y sirve `index.html`).
4. En **Settings → Environment Variables**, añade las de `.env.example` (mínimo `OPENROUTER_API_KEY`).
5. **Deploy**. Tu radar estará en `https://tu-proyecto.vercel.app`.

### Opción CLI
```bash
npm i -g vercel
cd thelemaco-radar
vercel            # primer deploy (preview)
vercel env add OPENROUTER_API_KEY     # pega tu clave
vercel --prod     # producción
```

### Probar en local
```bash
npm i
npm i -g vercel
vercel dev        # abre http://localhost:3000
```

---

## Variables de entorno
| Variable | Obligatoria | Para qué |
|---|---|---|
| `LLM_PROVIDER` | no (def. `openrouter`) | `openrouter` o `anthropic` |
| `OPENROUTER_API_KEY` | sí (si usas OpenRouter) | clave de openrouter.ai |
| `ANTHROPIC_API_KEY` | sí (si usas Anthropic) | clave de console.anthropic.com |
| `LLM_MODEL` | no | modelo (def. `anthropic/claude-3.5-haiku`) |
| `FINNHUB_API_KEY` | no | cotizaciones más fiables (finnhub.io, gratis) |

## Modo 0 € absoluto (modelo `:free`)
Por defecto el backend usa **`deepseek/deepseek-chat-v3-0324:free`** vía OpenRouter (0 € en IA) y, si ese modelo falla o te limita, **rota automáticamente** a otros gratuitos (Llama 3.3 70B, Llama 4 Maverick, Mistral Small).

Límites del tramo gratuito de OpenRouter (jun 2026): **20 peticiones/min** y **50 peticiones/día** si has gastado menos de 10 $ en créditos (sube a **1.000/día** si alguna vez compras 10 $, que no caducan). Con la **caché de 15 min**, cada visita normal NO consume llamada: solo gastas una al refrescar de verdad, así que 50/día sobran para uso personal.

Contras honestos del `:free`: algo más lento, calidad de traducción/clasificación algo inferior a Haiku, y JSON ocasionalmente imperfecto (por eso hay rotación y parseo robusto). Si notas fallos, cambia `LLM_MODEL` a otro `:free` de la lista o pásate a Haiku de pago (céntimos/día).


---

## Personalización
- **Fuentes**: edita `FEEDS` en `api/news.js` (añade tus RSS favoritos y su carpeta).
- **Colores/criterios**: `COLORS` en `index.html`.
- **Carpetas**: `CATS` en `index.html` y la `categoria` que pide el prompt.
- **Cotizaciones de la cinta**: `SYMS` en `api/quotes.js`.
- **Frecuencia de actualización**: `TTL` en `api/news.js` (def. 15 min). Para refresco automático puedes añadir un Vercel Cron que llame a `/api/news?fresh=1`.

---

## Nota legal
Se usan RSS públicos, **resúmenes propios y cortos** (no se copia el artículo), enlace a la fuente original e imagen `og:image` (la que la propia web ofrece para compartir). Es la vía respetuosa con derechos de autor. No constituye recomendación de inversión; las cotizaciones de la cinta pueden ir con ligero retardo según el proveedor.
