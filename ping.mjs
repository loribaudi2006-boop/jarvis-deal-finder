// Quick connectivity check: `node ping.mjs` — verifies Telegram + Gemini + Vinted.
import * as tg from "./src/telegram.mjs";
import * as gemini from "./src/gemini.mjs";
import { initSession, searchItems } from "./src/vinted.mjs";

const out = [];
try { await initSession("www.vinted.it"); const it = await searchItems("www.vinted.it", { q: "lego", perPage: 3 }); out.push(`Vinted OK (${it.length} risultati)`); }
catch (e) { out.push(`Vinted FAIL: ${e.message}`); }
try { const t = await (await import("./src/gemini.mjs")).resaleSecondOpinion({ title: "Nintendo Switch", brand: "Nintendo", status: "buono", price: 100 }); out.push(t ? `Gemini OK (${t.min}-${t.max})` : "Gemini: risposta vuota"); }
catch (e) { out.push(`Gemini FAIL: ${e.message}`); }

const msg = "🤖 <b>Jarvis</b> — test di connessione\n\n" + out.map((l) => "• " + l).join("\n");
if (tg.configured()) { await tg.sendMessage(msg); console.log("inviato su Telegram:\n" + msg); }
else { console.log("TELEGRAM non configurato\n" + msg); }
