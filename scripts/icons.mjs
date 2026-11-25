#!/usr/bin/env node
// Fetches each service's favicon once, at build time, into static/icons/<id>.png. The pages then serve them from our
// own origin: no third-party request at runtime, and no icon means the page falls back to a short monogram.
// Run when a service is added or its icon looks wrong; commit the PNGs. Usage: node scripts/icons.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICES } from "../src/services.mjs";

const out = new URL("../static/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
// the probe URL's host is not always the service's site (fe-static.deepseek.com, registry.npmjs.org, …)
const HOST = {
  deepseek: "deepseek.com", whatsapp: "whatsapp.com", npm: "npmjs.com", dockerhub: "hub.docker.com",
  playstation: "www.playstation.com", epic: "epicgames.com", cloudfront: "aws.amazon.com", "google-cdn": "google.com",
  xbox: "www.xbox.com", bilibili: "www.bilibili.com", douyin: "douyin.com", ptt: "www.ptt.cc", naver: "naver.com",
  niconico: "nicovideo.jp", flipkart: "flipkart.com", lazada: "www.lazada.sg", grab: "grab.com", nubank: "www.nubank.com.br",
  disneyplus: "disneyplus.com", metaai: "www.meta.ai", nbc: "www.nbc.com", bein: "beinsports.com", deezer: "deezer.com",
  soundcloud: "soundcloud.com", kktv: "www.kktv.me", lemino: "docomo.ne.jp", bahamut: "gamer.com.tw", sky: "www.sky.com",
  aetv: "www.aetv.com", directv: "www.directv.com", tencent: "qq.com", instagram: "instagram.com",
};
const hostOf = s => HOST[s.id] || (() => { try { return new URL(s.site).host; } catch { return null; } })();
const groups = new Map();
for (const s of SERVICES) {
  const h = hostOf(s);
  if (!h) continue;
  if (groups.has(h)) groups.get(h).push(s.id);
  else groups.set(h, [s.id]);
}
const todo = [...groups].filter(([h, ids]) => ids.some(id => !existsSync(new URL(id + ".png", out))));
console.log(`${todo.length} hosts to fetch`);
let done = 0, saved = 0, failed = [];
async function fetchIcon(host) {
  const urls = [
    `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "1ms.dog down-check icon fetch (build time)" } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 64 && buf[0] === 0x89 && buf[1] === 0x50) return buf;
    } catch {}
  }
  // last resort: the site's own /favicon.ico (often an ICO, converted with macOS sips at build time)
  try {
    const res = await fetch(`https://${host}/favicon.ico`, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "1ms.dog down-check icon fetch (build time)" } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 64 && buf[0] === 0x89 && buf[1] === 0x50) return buf;
      const tmp = join(tmpdir(), `down-icon-${process.pid}-${Math.random().toString(36).slice(2)}`);
      writeFileSync(tmp + ".ico", buf);
      const r = spawnSync("sips", ["-s", "format", "png", tmp + ".ico", "--out", tmp + ".png"], { stdio: "ignore" });
      if (r.status === 0 && existsSync(tmp + ".png")) {
        const png = readFileSync(tmp + ".png");
        if (png.length > 64 && png[0] === 0x89) return png;
      }
    }
  } catch {}
  return null;
}
async function worker(queue) {
  while (queue.length) {
    const [host, ids] = queue.shift();
    const buf = await fetchIcon(host);
    done++;
    if (buf) { saved++; for (const id of ids) if (!existsSync(new URL(id + ".png", out))) writeFileSync(new URL(id + ".png", out), buf); }
    else failed.push(host);
    if (done % 20 === 0) console.log(`${done}/${todo.length} hosts`);
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker(todo)));
console.log(`done: ${saved} icons written, ${failed.length} hosts failed`);
if (failed.length) console.log("failed:", failed.join(", "));
