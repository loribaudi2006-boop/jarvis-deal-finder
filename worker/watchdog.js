/**
 * Cloudflare Worker — Jarvis watchdog / pacemaker.
 * Cron triggers every 2 min: if the newest jarvis.yml run is finished (or old),
 * dispatch a fresh one. This keeps read latency low without paying for
 * always-on infra, exactly like the Vinted-Deal-Finder setup.
 *
 * Env vars (Settings -> Variables, encrypt GH_TOKEN):
 *   GH_TOKEN  = fine-grained PAT, repo jarvis-deal-finder, Actions: Read/Write
 *   GH_REPO   = loribaudi2006-boop/jarvis-deal-finder
 *   WORKFLOW  = jarvis.yml
 *   BRANCH    = main
 *   MAX_GAP_MIN = 4
 */

const GH = "https://api.github.com";

async function gh(env, path, init = {}) {
  return fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "jarvis-watchdog",
      ...(init.headers || {}),
    },
  });
}

async function tick(env) {
  const wf = env.WORKFLOW || "jarvis.yml";
  const branch = env.BRANCH || "main";
  const maxGap = Number(env.MAX_GAP_MIN || 4) * 60_000;

  const res = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${wf}/runs?per_page=5`);
  if (!res.ok) return { dispatched: false, error: `runs ${res.status}` };
  const { workflow_runs = [] } = await res.json();

  const active = workflow_runs.find((r) => ["queued", "in_progress", "waiting"].includes(r.status));
  if (active) return { dispatched: false, reason: "already running" };

  const last = workflow_runs[0];
  const lastTs = last ? new Date(last.updated_at).getTime() : 0;
  if (Date.now() - lastTs < maxGap) return { dispatched: false, reason: "recent run" };

  const d = await gh(env, `/repos/${env.GH_REPO}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: branch }),
  });
  return { dispatched: d.ok, status: d.status };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
  async fetch(_req, env) {
    return new Response(JSON.stringify(await tick(env), null, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};
