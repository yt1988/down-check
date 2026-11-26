// The only thing this Worker does: one small JSON for the pages, merged from the three probe files (Los Angeles,
// Tokyo, Shanghai) and cut down to the services this site publishes. Every page is a static asset and never reaches
// this code.
//
// The upstream addresses come from the deployment (`PROBE_LAX_URL`, `PROBE_TOKYO_URL`, `PROBE_SHANGHAI_URL`); they are
// deliberately not in this repository. Without them the page says it cannot read the data.
//
// The verdict comes from these probes only; the service's own status page is a link on the page, not a factor.
// If a probe machine is down, the last good copy keeps being served for a week (marked `stale`), so a page can say
// "data is old" instead of "down". If there is no copy at all, the page gets a 503 and says it cannot read the data.
import { trimProbe } from "./data.mjs";

const FRESH = 60;          // seconds an upstream answer is reused
const KEEP = 7 * 86400;    // seconds the last good answer is kept
const TIMEOUT = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status.json") return status(env);
    return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};

async function status(env) {
  const cache = caches.default;
  const [losangeles, tokyo, shanghai] = await Promise.all([
    source(cache, "losangeles", env.PROBE_LAX_URL, trimProbe),
    source(cache, "tokyo", env.PROBE_TOKYO_URL, trimProbe),
    source(cache, "shanghai", env.PROBE_SHANGHAI_URL, trimProbe),
  ]);
  if (!losangeles && !tokyo && !shanghai) return json({ error: "unavailable" }, 503, "no-store");
  const stale = [losangeles, tokyo, shanghai].some(d => d && d.stale);
  return json({ v: 4, generated: new Date().toISOString(), losangeles, tokyo, shanghai }, 200, stale ? "no-store" : "public, max-age=30");
}

async function source(cache, name, url, trim) {
  if (!url) return null;
  const freshKey = new Request(`https://down-check.invalid/__cache/${name}`);
  const keepKey = new Request(`https://down-check.invalid/__keep/${name}`);
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
