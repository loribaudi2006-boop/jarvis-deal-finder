# Jarvis — deal finder Telegram bot

Autonomo, indipendente dagli altri bot. Gira **solo su GitHub Actions** + un
Cloudflare Worker come "sveglino". Cerca su Vinted articoli rivendibili con
**margine ≥ 10 €**, genera un resoconto con Gemini e lo invia su Telegram con foto.

## Flusso
1. `run_loop.sh` → `src/main.mjs` fa N passate (default 4) a ~60s l'una
2. `src/vinted.mjs` legge l'API JSON di Vinted (veloce, con cookie di sessione anonima)
3. `src/pricing.mjs` calcola: prezzo + commissione Vinted + spedizione vs rivendita stimata
4. rivendita stimata = mediana annunci attivi simili × fattore, + secondo parere Gemini
5. `src/gemini.mjs` scrive il resoconto in 6 punti (saluto, titolo, costi, rating, problemi, link)
6. `src/telegram.mjs` invia `sendPhoto`
7. stato in `data/seen.json`, auto-pulizia dopo 46h

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
