// Two jobs:
//   GET /api/status.json  merge what the two probes wrote (Tokyo, Shanghai) with the official status snapshot, cut to
//                         the fields a page shows, and cache it for 60 s. Every page is a static asset.
//   cron (every 10 minutes)  read the services' own Statuspage answers and write one snapshot to KV. One key, not one
//                         per service: a key per service would be 30k writes a day.
//
// Freshness is per source: the page uses each service's own measurement time, not the time of this request. If an
// upstream is down, the last good copy keeps being served for a week (marked `stale`), so a page can say "data is old"
// instead of "down". With nothing at all, the page gets a 503 and says it cannot read the data.
import { trimProbe, trimOfficial, officialEntry } from "./data.mjs";
import { STATUS, OFFICIAL_IDS } from "./status-sources.mjs";

const TOKYO_URL = "https://data.1ms.dog:2083/down/latest.json";
const SHANGHAI_URL = "https://data.1ms.dog:2083/down/sh/latest.json";
const OFFICIAL_KEY = "official:latest";
const FRESH = 60;          // seconds an upstream answer is reused
const KEEP = 7 * 86400;    // seconds the last good answer is kept
const TIMEOUT = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status.json") return status(env);
    return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(updateOfficial(env));
  },
};

async function status(env) {
  const cache = caches.default;
  const [tokyo, shanghai] = await Promise.all([
    source(cache, "tokyo", env.PROBE_TOKYO_URL || TOKYO_URL, trimProbe),
    source(cache, "shanghai", env.PROBE_SHANGHAI_URL || SHANGHAI_URL, trimProbe),
  ]);
  let official = null;
  if (env.OFFICIAL) {
    try {
      const raw = await env.OFFICIAL.get(OFFICIAL_KEY, "json");
      official = raw ? trimOfficial(raw) : null;
    } catch {}
  }
  if (!tokyo && !shanghai && !official) return json({ error: "unavailable" }, 503, "no-store");
  const stale = [tokyo, shanghai, official].some(d => d && d.stale);
  return json({ v: 2, generated: new Date().toISOString(), tokyo, shanghai, official }, 200, stale ? "no-store" : "public, max-age=30");
}

async function source(cache, name, url, trim) {
  const freshKey = new Request(`https://down.1ms.dog/__cache/${name}`);
  const keepKey = new Request(`https://down.1ms.dog/__keep/${name}`);
  const hit = await cache.match(freshKey);
  if (hit) {
    try { return await hit.json(); } catch {}
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error("upstream " + res.status);
    const doc = trim(await res.json());
    if (!doc) throw new Error("empty");
    await Promise.all([
      cache.put(freshKey, jsonResponse(doc, FRESH)),
      cache.put(keepKey, jsonResponse(doc, KEEP)),
    ]);
    return doc;
  } catch {
    const kept = await cache.match(keepKey);
    if (!kept) return null;
    try { return { ...(await kept.json()), stale: true }; } catch { return null; }
  }
}

// Every 10 minutes: one fetch per service with a machine-readable Statuspage feed, then one KV write.
async function updateOfficial(env) {
  if (!env.OFFICIAL) return;
  const prev = (await env.OFFICIAL.get(OFFICIAL_KEY, "json")) || { services: {} };
  const at = Date.now();
  const services = { ...(prev.services || {}) };
  await Promise.all(OFFICIAL_IDS.map(async id => {
    const src = STATUS[id];
    try {
      const res = await fetch(src.api, { signal: AbortSignal.timeout(TIMEOUT), cf: { cacheTtl: 0 }, headers: { accept: "application/json" } });
      if (!res.ok) return;
      const entry = officialEntry(await res.json(), src.page, at);
      if (entry) services[id] = entry;
    } catch {
      // keep the previous entry and its own time; the page will show it as old
    }
  }));
  await env.OFFICIAL.put(OFFICIAL_KEY, JSON.stringify({ at, every: 600, services }));
}

function jsonResponse(body, maxAge) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` },
  });
}
function json(body, code, cacheControl) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl },
  });
}
