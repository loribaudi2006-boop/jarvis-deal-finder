import { readFile } from "node:fs/promises";
import { initSession, searchItems, sellerInfo, activePrices } from "./vinted.mjs";
import { resaleFromActive, evaluate } from "./pricing.mjs";
import * as gemini from "./gemini.mjs";
import * as tg from "./telegram.mjs";
import { load, save, purge } from "./state.mjs";

const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gate before spending a Gemini call: rough margin from the cheap active-median
// estimate must be within `geminiBuffer` of the target (Gemini may push it up or down).
const GEMINI_BUFFER = cfg.resale.geminiBufferEUR ?? 8;

async function collect() {
  const bySearch = [];
  for (const s of cfg.searches) {
    try {
      const items = await searchItems(cfg.vinted.domain, { ...s, perPage: cfg.vinted.perPage });
      bySearch.push({ s, items });
    } catch (e) {
      console.error(`search "${s.q}" failed:`, e.message);
    }
  }
  return bySearch;
}

async function seedIfFirstRun() {
  const seen = await load(cfg.state.seenFile);
  if (Object.keys(seen).length > 0) return false;
  console.log("first run — seeding seen list without alerting");
  await initSession(cfg.vinted.domain);
  const bySearch = await collect();
  const now = Date.now();
  for (const { items } of bySearch) for (const it of items) seen[it.id] = now;
  await save(cfg.state.seenFile, seen);
  if (tg.configured())
    await tg.sendMessage(
      `🤖 <b>Jarvis attivato.</b> Sto monitorando ${cfg.searches.length} ricerche su Vinted. ` +
        `Ti avviso solo quando trovo un affare con margine ≥ ${cfg.minProfitEUR} €.`
    );
  console.log(`seeded ${Object.keys(seen).length} listings`);
  return true;
}

async function onePass() {
  await initSession(cfg.vinted.domain);
  const seen = purge(await load(cfg.state.seenFile), cfg.state.purgeAfterHours);
  const bySearch = await collect();
  let hits = 0;

  for (const { s, items } of bySearch) {
    const fresh = items.filter((it) => !seen[it.id] && it.price && (!s.priceTo || it.price <= s.priceTo));
    for (const it of fresh) seen[it.id] = Date.now(); // mark now so a crash won't re-alert
    if (!fresh.length) continue;

    let comparables;
    try {
      comparables = await activePrices(cfg.vinted.domain, s.q, s.priceTo);
    } catch {
      comparables = [];
    }
    const baseResale = resaleFromActive(comparables, cfg.resale);

    for (const item of fresh) {
      // cheap gate
      const rough = evaluate(item, { shipping: null }, baseResale, cfg);
      if (rough.reason === "no_resale_estimate") continue;
      if (rough.margin < cfg.minProfitEUR - GEMINI_BUFFER) continue;

      // expensive enrichment only for plausible deals
      if (item.userId) {
        const si = await sellerInfo(cfg.vinted.domain, item.userId);
        if (si.rating != null) item.seller = { ...item.seller, ...si };
      }

      let resaleRange = null;
      if (cfg.resale.useGeminiSecondOpinion && gemini.hasKeys()) {
        try {
          resaleRange = await gemini.resaleSecondOpinion(item);
        } catch (e) {
          console.error("resale 2nd opinion failed:", e.message);
        }
      }

      // resale figure: prefer Gemini's conservative (low) end; fall back to the
      // active-listing estimate only when Gemini isn't required.
      let resale;
      if (resaleRange) {
        resale = Math.min(resaleRange.min, baseResale ?? resaleRange.min);
      } else if (cfg.resale.requireGemini) {
        continue; // no trustworthy resale estimate -> stay silent
      } else {
        resale = baseResale;
      }

      const ev = evaluate(item, { shipping: null }, resale, cfg);
      if (!ev.ok) continue;

      let caption;
      try {
        caption = await gemini.buildReport({ item, detail: { description: "" }, eval: ev, resaleRange });
      } catch (e) {
        console.error("report failed, using local fallback:", e.message);
        caption = gemini.localReport({ item, eval: ev, resaleRange });
      }

      console.log(`ALERT: "${item.title}" acquisto ${ev.buyTotal}€ / rivendita ${ev.resaleEUR}€ / margine ${ev.margin}€`);
      await tg.sendPhoto(item.photo, caption);
      hits++;
      await sleep(1200);
      if (hits >= (cfg.maxAlertsPerRun ?? 6)) {
        console.log("max alerts per run reached, stopping");
        await save(cfg.state.seenFile, seen);
        return;
      }
    }
  }

  await save(cfg.state.seenFile, seen);
  console.log(`pass done — ${hits} alert(s), ${Object.keys(seen).length} tracked`);
}

if (await seedIfFirstRun()) {
  process.exit(0);
}

const passes = Math.max(1, Number(process.env.JARVIS_PASSES) || cfg.loop.maxPassesPerRun);
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
