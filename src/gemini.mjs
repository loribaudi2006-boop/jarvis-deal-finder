// Gemini: builds the studied report + optional resale second opinion.
// Rotates across the provided API keys on quota / transient errors.

// primary first, then higher-free-quota fallbacks on 429
const MODELS = (process.env.GEMINI_MODEL || "gemini-flash-latest,gemini-flash-lite-latest")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const KEYS = (process.env.GEMINI_API_KEY || "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

let keyIdx = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(payload, preferModel = null) {
  let lastErr;
  const models = preferModel ? [preferModel, ...MODELS.filter((m) => m !== preferModel)] : MODELS;
  const combos = [];
  for (const model of models) for (const key of KEYS) combos.push({ model, key });
  if (!combos.length) throw new Error("Gemini: no API key configured");

  for (let attempt = 0; attempt < combos.length; attempt++) {
    const { model, key } = combos[(keyIdx + attempt) % combos.length];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(45000),
        }
      );
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Gemini ${res.status} (${model})`);
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const data = await res.json();
      keyIdx++;
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Gemini: all combos failed");
}

// fetch the listing photo as an inlineData part (best-effort)
async function imagePart(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4_000_000) return null;
    const mime = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return { inlineData: { mimeType: mime, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

function greeting(d = new Date()) {
  const h = Number(
    new Intl.DateTimeFormat("it-IT", { hour: "2-digit", hour12: false, timeZone: "Europe/Rome" }).format(d)
  );
  return h >= 5 && h < 18 ? "Buongiorno" : "Buonasera";
}

// Returns { min, max } or null
export async function resaleSecondOpinion(item) {
  const img = await imagePart(item.photoThumb || item.photo);
  const parts = [
    {
      text:
        "Sei un perito dell'usato in Italia. Guarda la FOTO e il titolo di questo annuncio Vinted. " +
        "ATTENZIONE: il titolo puo' essere fuorviante — verifica dalla foto COSA si vende davvero " +
        "(es. solo un gioco/accessorio e non la console; una custodia e non il dispositivo; scatola vuota). " +
        "Stima la forchetta realistica di prezzo di RIVENDITA rapida dell'usato in Italia per l'oggetto EFFETTIVAMENTE in vendita. " +
        'Rispondi SOLO con JSON: {"min": numero, "max": numero, "cosa": "breve descrizione di cosa si vende davvero"}.\n\n' +
        `Titolo: ${item.title}\nMarca: ${item.brand || "n/d"}\nCondizione: ${item.status || "n/d"}\n` +
        `Prezzo richiesto: ${item.price} EUR`,
    },
  ];
  if (img) parts.push(img);
  const txt = await call(
    {
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    },
    img ? "gemini-flash-lite-latest" : null
  );
  try {
    const j = JSON.parse(txt);
    if (Number.isFinite(j.min) && Number.isFinite(j.max)) return j;
  } catch {}
  return null;
}

function ratingLineFor(item) {
  const pct = item.seller.rating != null ? Math.round(item.seller.rating * 100) : null;
  return pct != null
    ? `${(item.seller.rating * 5).toFixed(1)}/5 (${item.seller.count ?? "?"} valutazioni, ${pct}% positivi)`
    : "sconosciuto";
}

// used when Gemini is unavailable (quota/errors) — same 6-block structure, no API
export function localReport({ item, eval: ev, resaleRange }) {
  const resale = resaleRange ? `${resaleRange.min}–${resaleRange.max} €` : `${ev.resaleEUR} €`;
  return (
    `${greeting()} Signore, ho trovato questo:\n\n` +
    `📦 <b>${item.title}</b>\n\n` +
    `💰 Acquisto: ${ev.itemPrice} € + ${ev.protection} € (commissione Vinted) + ${ev.shipping} € (spedizione) = <b>${ev.buyTotal} €</b>\n` +
    `📈 Rivendita stimata: ${resale}\n` +
    `🟢 Margine stimato: <b>${ev.margin} €</b>\n\n` +
    `⭐ Venditore: ${ratingLineFor(item)}\n\n` +
    `⚠️ Problemi/risoluzioni: valutare di persona da foto e descrizione dell'annuncio.\n\n` +
    `🔗 ${item.url}`
  );
}

export async function buildReport({ item, detail, eval: ev, resaleRange }) {
  const ratingLine = ratingLineFor(item);

  const facts = {
    saluto: greeting(),
    titolo: item.title,
    prezzo_oggetto: ev.itemPrice,
    commissione_vinted: ev.protection,
    spedizione: ev.shipping,
    costo_totale_acquisto: ev.buyTotal,
    rivendita_stimata: resaleRange
      ? `${resaleRange.min}-${resaleRange.max} EUR`
      : `${ev.resaleEUR} EUR`,
    oggetto_reale_dalla_foto: resaleRange?.cosa || null,
    margine_stimato: ev.margin,
    venditore_rating: ratingLine,
    descrizione: (detail.description || "").slice(0, 900),
    link: item.url,
  };

  const prompt =
    "Sei Jarvis, assistente personale che segnala affari su Vinted a un rivenditore. " +
    "Scrivi un resoconto in ITALIANO, tono formale ma asciutto (dai del 'Signore'), " +
    "seguendo ESATTAMENTE questo ordine, un blocco per riga, SENZA numeri di elenco e senza aggiungere altro:\n\n" +
    "- \"<saluto> Signore, ho trovato questo:\"\n" +
    "- Titolo dell'annuncio\n" +
    "- Costo di acquisto: prezzo oggetto + (commissione Vinted) + (spedizione) = totale; poi 'Rivendita stimata:' e 'Margine stimato:'\n" +
    "- Rating del venditore\n" +
    "- Eventuali problemi e relative risoluzioni (usa 'oggetto_reale_dalla_foto' e la condizione; se l'oggetto reale differisce dal titolo — es. solo il gioco e non la console — dillo SUBITO; se nessuno, 'Nessun problema evidente')\n" +
    "- Link diretto all'annuncio\n\n" +
    "Usa qualche emoji sobria. Dati:\n" +
    JSON.stringify(facts, null, 2);

  return call({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4 },
  });
}

export function hasKeys() {
  return KEYS.length > 0;
}

// Interprets a free-text Telegram message from the owner as an instruction
// to change which Vinted searches Jarvis monitors. Returns
// { replace: bool, searches: [{q, priceTo}], reply: string } or null.
export async function interpretSearchRequest(text, currentSearches, defaultSearches) {
  const prompt =
    "Sei Jarvis, un bot che monitora Vinted per trovare affari da rivendere con margine (flipping). " +
    "Il tuo proprietario ti ha scritto un messaggio per cambiare cosa cercare. " +
    "Traduci la richiesta in una lista di ricerche Vinted concrete.\n\n" +
    "Regole:\n" +
    "- Ogni ricerca e' un oggetto {\"q\": \"<query in italiano, 2-4 parole, come si cercherebbe su Vinted>\", " +
    "\"priceTo\": <prezzo massimo di ACQUISTO ragionevole in EUR per quella categoria, intero>}.\n" +
    "- Se la richiesta e' una categoria generica (es. 'scarpe', 'polo', 'videogiochi', 'console', 'elettronica'), " +
    "genera 2-5 ricerche specifiche e sensate dentro quella categoria (es. 'scarpe' -> marche/tipi comuni da rivendere), " +
    "con priceTo adatti a quella categoria.\n" +
    "- Se dice 'tutto', 'default', 'resetta', 'ricomincia' o simili, rispondi con replace:true e searches uguale " +
    "esattamente a DEFAULT_SEARCHES.\n" +
    "- Se il messaggio implica SOSTITUIRE le ricerche attuali (es. 'cerca solo X', 'cambia ricerca in X', o non specifica), " +
    "usa replace:true. Se implica AGGIUNGERE (es. 'aggiungi anche X', 'cerca anche X'), usa replace:false.\n" +
    "- Se il messaggio non ha senso come richiesta di ricerca (es. saluti, domande generiche), rispondi con " +
    '{"searches": [], "replace": false, "reply": "<risposta breve e cortese in italiano che spiega cosa puoi fare"}.\n' +
    "- \"reply\" e' sempre un breve messaggio di conferma in italiano, tono formale (dai del 'Signore'), da mandare su Telegram.\n\n" +
    'Rispondi SOLO con JSON: {"replace": bool, "searches": [{"q":.., "priceTo":..}, ...], "reply": "..."}.\n\n' +
    `MESSAGGIO: "${text}"\n\n` +
    `RICERCHE_ATTUALI: ${JSON.stringify(currentSearches)}\n` +
    `DEFAULT_SEARCHES: ${JSON.stringify(defaultSearches)}`;

  const txt = await call({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });
  try {
    const j = JSON.parse(txt);
    if (Array.isArray(j.searches)) return j;
  } catch {}
  return null;
}
