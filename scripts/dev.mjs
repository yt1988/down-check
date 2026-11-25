#!/usr/bin/env node
// Local preview: serves public/ and answers /api/status.json from the probe files and the official status pages.
// By default it reads probe/out/latest.json (Tokyo) and probe/out/sh/latest.json (Shanghai) if they exist; set
// DOWN_PROBE_TOKYO / DOWN_PROBE_SHANGHAI to another path or URL. The official feeds are fetched here, cached 10 min,
// which is what the Worker's cron does in production. Usage: npm run dev, then open http://localhost:8791/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { trimProbe, trimOfficial, officialEntry } from "../src/data.mjs";
import { STATUS, OFFICIAL_IDS } from "../src/status-sources.mjs";

const PORT = Number(process.env.PORT || 8791);
const ROOT = new URL("../public/", import.meta.url);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" };

const DEFAULT_TOKYO = fileURLToPath(new URL("../probe/out/latest.json", import.meta.url));
const DEFAULT_SH = fileURLToPath(new URL("../probe/out/sh/latest.json", import.meta.url));

async function probe(env, fallback) {
  const where = process.env[env] || (existsSync(fallback) ? fallback : null);
  if (!where) return null;
  try {
    const raw = /^https?:/.test(where)
      ? await (await fetch(where, { signal: AbortSignal.timeout(5000) })).json()
      : JSON.parse(await readFile(where, "utf8"));
    return enrich(trimProbe(raw));
  } catch (e) {
    console.warn(env, "failed:", e.message);
    return null;
  }
}

// Dev only: the probe has just started, so its 24-hour strip is almost empty. Fill the part it does not have from the
// existing hourly baseline (index/summary.json) — the real hourly uptime — and use the baseline's up24/up7. Production
// does not do this; after a day the probe's own 10-minute history fills the strip.
let baselineCache = null, baselineAt = 0;
async function baseline() {
  if (baselineCache && Date.now() - baselineAt < 10 * 60e3) return baselineCache;
  try {
    const r = await fetch("https://data.1ms.dog:2083/index/summary.json", { signal: AbortSignal.timeout(5000) });
    baselineCache = r.ok ? await r.json() : null;
  } catch { baselineCache = null; }
  baselineAt = Date.now();
  return baselineCache;
}
async function enrich(doc) {
  if (!doc) return doc;
  const base = await baseline();
  for (const [id, s] of Object.entries(doc.services)) {
    const b = base?.services?.[id];
    if (b && Array.isArray(b.h24)) {
      const hourly = b.h24.map(v => (v == null ? "x" : "o")).map(c => c.repeat(6)).join("");
      s.h24 = (hourly + (s.h24 && s.h24.length < 144 ? s.h24.replace(/^-+/, "") : "")).slice(-144);
      if (b.up24 != null) s.up24 = b.up24;
      if (b.up7 != null) s.up7 = b.up7;
    }
  }
  return doc;
}

let officialCache = null, officialAt = 0;
async function official() {
  if (officialCache && Date.now() - officialAt < 10 * 60e3) return officialCache;
  const services = {};
  const at = Date.now();
  await Promise.all(OFFICIAL_IDS.map(async id => {
    try {
      const res = await fetch(STATUS[id].api, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
      if (!res.ok) return;
      const e = officialEntry(await res.json(), STATUS[id].page, at);
      if (e) services[id] = e;
    } catch {}
  }));
  officialCache = trimOfficial({ at, every: 600, services });
  officialAt = Date.now();
  return officialCache;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/status.json") {
    const [tokyo, shanghai, off] = await Promise.all([probe("DOWN_PROBE_TOKYO", DEFAULT_TOKYO), probe("DOWN_PROBE_SHANGHAI", DEFAULT_SH), official()]);
    const body = { v: 2, generated: new Date().toISOString(), tokyo, shanghai, official: off };
    res.writeHead(tokyo || shanghai || off ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(tokyo || shanghai || off ? body : { error: "unavailable" }));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  let file = new URL("." + rel, ROOT);
  if (!file.href.startsWith(ROOT.href)) { res.writeHead(403); res.end("forbidden\n"); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = new URL(file.href.replace(/\/?$/, "/") + "index.html", ROOT);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file.pathname)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}/`));
