import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function load(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

export async function save(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, 0));
}

export function purge(seen, hours) {
  const cutoff = Date.now() - hours * 3600_000;
  for (const [k, ts] of Object.entries(seen)) if (ts < cutoff) delete seen[k];
  return seen;
}
