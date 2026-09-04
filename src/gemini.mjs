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

async function call(payload) {
  let lastErr;
  const combos = [];
  for (const model of MODELS) for (const key of KEYS) combos.push({ model, key });
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
          signal: AbortSignal.timeout(30000),
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

function greeting(d = new Date()) {
  const h = Number(
    new Intl.DateTimeFormat("it-IT", { hour: "2-digit", hour12: false, timeZone: "Europe/Rome" }).format(d)
  );
  return h >= 5 && h < 18 ? "Buongiorno" : "Buonasera";
}

// Returns { min, max } or null
export async function resaleSecondOpinion(item) {
  const txt = await call({
    contents: [
      {
        parts: [
          {
            text:
              "Sei un perito dell'usato in Italia. Dato questo oggetto su Vinted, " +
              "stima la forchetta realistica di prezzo di RIVENDITA (usato, mercato italiano). " +
              'Rispondi SOLO con JSON: {"min": numero, "max": numero}.\n\n' +
              `Titolo: ${item.title}\nMarca: ${item.brand || "n/d"}\nCondizione: ${item.status || "n/d"}\n` +
              `Prezzo richiesto: ${item.price} EUR`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });
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
    margine_stimato: ev.margin,
    venditore_rating: ratingLine,
    descrizione: (detail.description || "").slice(0, 900),
    link: item.url,
  };

  const prompt =
    "Sei Jarvis, assistente personale che segnala affari su Vinted a un rivenditore." +
    "Scrivi un resoconto in ITALIANO, tono formale ma asciutto (dai del 'Signore'), " +
    "seguendo ESATTAMENTE questo ordine, un blocco per riga, SENZA numeri di elenco e senza aggiungere altro:\n\n" +
    "- \"<saluto> Signore, ho trovato questo:\"\n" +
    "- Titolo dell'annuncio\n" +
    "- Costo di acquisto: prezzo oggetto + (commissione Vinted) + (spedizione) = totale; poi 'Rivendita stimata:' e 'Margine stimato:'\n" +
    "- Rating del venditore\n" +
    "- Eventuali problemi e relative risoluzioni (dedotti da titolo/descrizione/condizione; se nessuno, scrivi 'Nessun problema evidente')\n" +
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
