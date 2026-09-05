// Reads new Telegram messages from the owner and lets them change, via
// natural language interpreted by Gemini, which Vinted searches Jarvis runs.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getUpdates, chatId, sendMessage } from "./telegram.mjs";
import { interpretSearchRequest } from "./gemini.mjs";
import { load, save } from "./state.mjs";

const OFFSET_FILE = "data/tg_offset.json";
const CONFIG_PATH = fileURLToPath(new URL("../config.json", import.meta.url));

export async function processCommands(cfg) {
  if (!chatId()) return cfg;

  const offsetState = await load(OFFSET_FILE);
  let updates;
  try {
    updates = await getUpdates(offsetState.offset);
  } catch (e) {
    console.error("getUpdates failed:", e.message);
    return cfg;
  }
  if (!updates.length) return cfg;

  let maxUpdateId = (offsetState.offset ?? 1) - 1;
  let changed = false;
  const defaultSearches = cfg.defaultSearches || cfg.searches;

  for (const upd of updates) {
    if (upd.update_id > maxUpdateId) maxUpdateId = upd.update_id;
    const msg = upd.message;
    const text = msg?.text?.trim();
    if (!text || String(msg.chat.id) !== String(chatId())) continue;

    console.log("comando ricevuto:", text);
    try {
      const parsed = await interpretSearchRequest(text, cfg.searches, defaultSearches);
      if (parsed && parsed.searches.length) {
        if (parsed.replace) {
          cfg.searches = parsed.searches;
        } else {
          const existingQ = new Set(cfg.searches.map((s) => s.q.toLowerCase()));
          for (const s of parsed.searches) if (!existingQ.has(s.q.toLowerCase())) cfg.searches.push(s);
        }
        changed = true;
        await sendMessage(
          parsed.reply || `Fatto, Signore. Ora monitoro: ${cfg.searches.map((s) => s.q).join(", ")}.`
        );
      } else {
        await sendMessage((parsed && parsed.reply) || "Non ho capito bene cosa cercare, Signore. Puo' riformulare?");
      }
    } catch (e) {
      console.error("comando fallito:", e.message);
      await sendMessage("Ho avuto un problema a capire la richiesta, Signore. Riprovi tra poco.");
    }
  }

  await save(OFFSET_FILE, { offset: maxUpdateId + 1 });
  if (changed) await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  return cfg;
}
