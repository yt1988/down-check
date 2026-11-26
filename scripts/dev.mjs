#!/usr/bin/env node
// Local preview: serves public/ and answers /api/status.json from the three probe files.
// By default it reads probe/out/la/latest.json (Los Angeles), probe/out/latest.json (Tokyo) and
// probe/out/sh/latest.json (Shanghai) if they exist; set DOWN_PROBE_LAX / DOWN_PROBE_TOKYO / DOWN_PROBE_SHANGHAI to
// another path or URL. Usage: npm run dev, open http://localhost:8791/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { trimProbe } from "../src/data.mjs";

const PORT = Number(process.env.PORT || 8791);
const ROOT = new URL("../public/", import.meta.url);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" };

const DEFAULT_LAX = fileURLToPath(new URL("../probe/out/la/latest.json", import.meta.url));
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
// existing hourly summary — the real hourly uptime — and use its up24/up7. Set DOWN_BASELINE_URL to that JSON (the
// address is not in this repository); without it the strip simply starts empty. Production does not do this.
let baselineCache = null, baselineAt = 0;
async function baseline() {
  if (!process.env.DOWN_BASELINE_URL) return null;
  if (baselineCache && Date.now() - baselineAt < 10 * 60e3) return baselineCache;
  try {
    const r = await fetch(process.env.DOWN_BASELINE_URL, { signal: AbortSignal.timeout(5000) });
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/status.json") {
    const [lax, tokyo, shanghai] = await Promise.all([probe("DOWN_PROBE_LAX", DEFAULT_LAX), probe("DOWN_PROBE_TOKYO", DEFAULT_TOKYO), probe("DOWN_PROBE_SHANGHAI", DEFAULT_SH)]);
    const any = lax || tokyo || shanghai;
    const body = { v: 4, generated: new Date().toISOString(), lax, tokyo, shanghai };
    res.writeHead(any ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(any ? body : { error: "unavailable" }));
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
