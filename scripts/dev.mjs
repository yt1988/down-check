#!/usr/bin/env node
// Local preview: serves public/ and answers /api/status.json by reading the same two upstream files the Worker reads
// (trimmed the same way). No Cloudflare cache, no shell bar. Usage: npm run dev, then open http://localhost:8791/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { trimIndex, trimUnlock } from "../src/data.mjs";

const PORT = Number(process.env.PORT || 8791);
const ROOT = new URL("../public/", import.meta.url);
const INDEX_URL = "https://data.1ms.dog:2083/index/summary.json";
const UNLOCK_URL = "https://data.1ms.dog:2083/unlock/status.json";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" };

async function upstream(url, trim) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error("http " + r.status);
    return trim(await r.json());
  } catch (e) {
    console.warn("upstream failed:", url, e.message);
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/status.json") {
    const [index, unlock] = await Promise.all([upstream(INDEX_URL, trimIndex), upstream(UNLOCK_URL, trimUnlock)]);
    res.writeHead(index || unlock ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(index || unlock ? { v: 1, generated: new Date().toISOString(), index, unlock } : { error: "unavailable" }));
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
