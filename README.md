# Jarvis — deal finder Telegram bot

Autonomo, indipendente dagli altri bot. Gira **solo su GitHub Actions** + un
Cloudflare Worker come "sveglino". Cerca su Vinted articoli rivendibili con
**margine ≥ 10 €**, genera un resoconto con Gemini e lo invia su Telegram con foto.

## Flusso
1. `run_loop.sh` → `src/main.mjs` fa N passate (default 4) a ~60s l'una
2. a inizio run, `src/commands.mjs` legge eventuali messaggi Telegram nuovi del
   proprietario e, tramite Gemini, li traduce in modifiche a `searches` (vedi sotto)
3. `src/vinted.mjs` legge l'API JSON di Vinted (veloce, con cookie di sessione anonima)
4. `src/pricing.mjs` calcola: prezzo + commissione Vinted + spedizione vs rivendita stimata
5. rivendita stimata = mediana annunci attivi simili × fattore, + secondo parere Gemini
6. `src/gemini.mjs` scrive il resoconto in 6 punti (saluto, titolo, costi, rating, problemi, link)
7. `src/telegram.mjs` invia `sendPhoto`
8. stato in `data/seen.json`, auto-pulizia dopo 46h

## Cambiare cosa cerca via Telegram
Basta scrivere al bot in linguaggio naturale, es. "cerca scarpe e polo",
"aggiungi anche videogiochi", "tutto" / "default" (ripristina `defaultSearches`).
Gemini interpreta il messaggio (`src/gemini.mjs::interpretSearchRequest`) e
aggiorna `config.json` (`searches`), che viene committato come lo stato.
L'offset dei messaggi letti sta in `data/tg_offset.json`. Solo i messaggi dalla
chat in `TELEGRAM_CHAT_ID` vengono considerati.

## Setup
### Secret del repo (Settings → Secrets and variables → Actions)
| nome | valore |
|---|---|
| `TELEGRAM_TOKEN` | token BotFather |
| `TELEGRAM_CHAT_ID` | `6640939998` |
| `GEMINI_API_KEY` | una o più chiavi separate da virgola |

Variabile opzionale (tab *Variables*): `GEMINI_MODEL` (default `gemini-flash-latest`).

### Permessi
Settings → Actions → General → **Read and write permissions**.

### Watchdog Cloudflare
`worker/` — `npx wrangler deploy`, poi `npx wrangler secret put GH_TOKEN`
(PAT fine-grained sul solo repo, Actions read/write).

## Config
Tutto in `config.json`: soglia profitto, parametri commissione/spedizione,
metodo di stima rivendita e **la lista `searches`** (query + prezzo massimo).
Modifica lì per aggiungere categorie.

## Test locale
```
TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=... GEMINI_API_KEY=... node src/main.mjs
```

## Regole operative
- **Non pushare codice mentre il bot gira** (rompe il salvataggio dello stato).
- Gli orari nei log di GitHub sono UTC (utente = UTC+2).
