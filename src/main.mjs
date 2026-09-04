import { readFile } from "node:fs/promises";
import { initSession, searchItems, sellerInfo, activePrices } from "./vinted.mjs";
import { resaleFromActive, evaluate } from "./pricing.mjs";
import * as gemini from "./gemini.mjs";
import * as tg from "./telegram.mjs";
import { load, save, purge } from "./state.mjs";

const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function onePass() {
  await initSession(cfg.vinted.domain);
  const seen = purge(await load(cfg.state.seenFile), cfg.state.purgeAfterHours);
  let hits = 0;

  for (const s of cfg.searches) {
    let items = [];
    try {
      items = await searchItems(cfg.vinted.domain, { ...s, perPage: cfg.vinted.perPage });
    } catch (e) {
      console.error(`search "${s.q}" failed:`, e.message);
      continue;
    }

    let comparables = null;

    for (const item of items) {
      if (seen[item.id]) continue;
      seen[item.id] = Date.now(); // mark early so a crash doesn't re-alert

      if (!item.price || (s.priceTo && item.price > s.priceTo)) continue;

      if (!comparables) {
        try {
          comparables = await activePrices(cfg.vinted.domain, s.q, s.priceTo);
        } catch {
          comparables = [];
        }
      }
      let resale = resaleFromActive(comparables, cfg.resale);

      const detail = { description: "", shipping: null };
      if (item.userId) {
        const si = await sellerInfo(cfg.vinted.domain, item.userId);
        if (si.rating != null) item.seller = { ...item.seller, ...si };
      }

      let resaleRange = null;
      if (cfg.resale.useGeminiSecondOpinion && gemini.hasKeys()) {
        try {
          const r = await gemini.resaleSecondOpinion(item);
          if (r) {
            resaleRange = r;
            const mid = (r.min + r.max) / 2;
            resale = resale == null ? mid : +((resale + mid) / 2).toFixed(2);
          }
        } catch (e) {
          console.error("resale 2nd opinion failed:", e.message);
        }
      }

      const ev = evaluate(item, detail, resale, cfg);
      if (!ev.ok) continue;

      let caption;
      try {
        caption = await gemini.buildReport({ item, detail, eval: ev, resaleRange });
      } catch (e) {
        console.error("report failed, using fallback:", e.message);
        caption =
          `Ho trovato questo:\n<b>${item.title}</b>\n` +
          `Acquisto: ${ev.itemPrice}€ + ${ev.protection}€ comm. + ${ev.shipping}€ sped. = <b>${ev.buyTotal}€</b>\n` +
          `Rivendita stimata: ${ev.resaleEUR}€ — Margine: <b>${ev.margin}€</b>\n` +
          `${item.url}`;
      }

      await tg.sendPhoto(item.photo, caption);
      hits++;
      await sleep(1200); // stay polite with Telegram + Vinted
    }
  }

  await save(cfg.state.seenFile, seen);
  console.log(`pass done — ${hits} alert(s), ${Object.keys(seen).length} tracked`);
}

const passes = Math.max(1, cfg.loop.maxPassesPerRun);
for (let i = 0; i < passes; i++) {
  const t0 = Date.now();
  try {
    await onePass();
  } catch (e) {
    console.error("pass crashed:", e.message);
  }
  if (i < passes - 1) {
    const wait = cfg.loop.passIntervalSeconds * 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
}
