// The only thing this Worker does: one small JSON for the pages, merged from the two checks that already run in Tokyo
// and cut down to the services this site publishes. Every page is a static asset and never reaches this code.
// If an upstream is down, the last good copy keeps being served for a week (marked `stale`), so a page can say "data is
// old" instead of "down". If there is no copy at all, the page gets a 503 and says it cannot read the data.
import { trimIndex, trimUnlock } from "./data.mjs";

const INDEX_URL = "https://data.1ms.dog:2083/index/summary.json";
const UNLOCK_URL = "https://data.1ms.dog:2083/unlock/status.json";
const FRESH = 60;            // seconds an upstream answer is reused
const KEEP = 7 * 86400;      // seconds the last good answer is kept
const TIMEOUT = 4000;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status.json") return status();
    return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};

async function status() {
  const cache = caches.default;
  const [index, unlock] = await Promise.all([
    source(cache, "index", INDEX_URL, trimIndex),
    source(cache, "unlock", UNLOCK_URL, trimUnlock),
  ]);
  if (!index && !unlock) return json({ error: "unavailable" }, 503, "no-store");
  const stale = !!(index && index.stale) || !!(unlock && unlock.stale);
  return json({ v: 1, generated: new Date().toISOString(), index, unlock }, 200, stale ? "no-store" : "public, max-age=30");
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
