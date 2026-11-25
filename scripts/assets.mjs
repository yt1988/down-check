#!/usr/bin/env node
// Renders the link-preview images, 1200 × 630, one per language: static/og/<lang>.png. The build copies them into
// public/og/. Run when a headline or the subtitle changes; commit the output. Uses system fonts (macOS: PingFang SC,
// Hiragino Sans, Apple SD Gothic Neo, Helvetica; Windows: Segoe UI, Microsoft YaHei, Yu Gothic UI, Malgun Gothic).
// Usage: node scripts/assets.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { LANGS, SITE } from "../src/config.mjs";

const stat = new URL("../static/", import.meta.url), src = new URL("../src/", import.meta.url);
const HOST = new URL(SITE).host;
const FONT = { "zh-CN": "PingFang SC", "zh-TW": "PingFang TC", ja: "Hiragino Sans", ko: "Apple SD Gothic Neo" };
const ACCENT = "#f87186", FG = "#ededed", MUTED = "#a0a0a0", BG = "#1c1c1c";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64 = async f => Buffer.from(await readFile(new URL(f, stat))).toString("base64");
const render = svg => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" } }).render().asPng();

const wide = ch => /[　-鿿가-힯＀-￯]/.test(ch);
const width = (t, px) => [...t].reduce((a, ch) => a + (wide(ch) ? 1 : 0.55) * px, 0);
const wrap = (text, px, max) => {
  const out = []; let cur = "";
  for (const piece of text.split(/(?<=[ ，、,。.!?？：:；;·-])/)) {
    for (const part of width(piece, px) > max ? [...piece] : [piece]) {
      if (cur && width(cur + part, px) > max) { out.push(cur.trim()); cur = ""; }
      cur += part;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

// seven status dots: a normal day, one warning, one outage — the tool in one picture, no words
const DOTS = [["#3ecf8e", 1], ["#3ecf8e", 1], ["#f5a524", 1], ["#3ecf8e", 1], ["#f56565", 1], ["#3ecf8e", 1], ["#3ecf8e", 1]];

async function card(lang, d) {
  const fam = `${FONT[lang] ? `'${FONT[lang]}', ` : ""}'Segoe UI', 'PingFang SC', 'Hiragino Sans', 'Microsoft YaHei', sans-serif`;
  const logo = await b64("assets/logo-dark.svg");
  const appLines = wrap(d.app_name, 66, 980);
  const hLines = wrap(d.h1_home, 36, 1020);
  const subLines = wrap(d.og_sub, 24, 1020).slice(0, 2);
  let y = 236;
  const app = appLines.map(l => { const s = `<text x="72" y="${y}" font-size="66" font-weight="700" fill="${FG}">${esc(l)}</text>`; y += 78; return s; }).join("");
  y += 10;
  const h1 = hLines.slice(0, 2).map(l => { const s = `<text x="72" y="${y}" font-size="36" font-weight="600" fill="${ACCENT}">${esc(l)}</text>`; y += 48; return s; }).join("");
  y += 12;
  const sub = subLines.map(l => { const s = `<text x="72" y="${y}" font-size="24" fill="${MUTED}">${esc(l)}</text>`; y += 34; return s; }).join("");
  const dots = DOTS.map(([c], i) => `<circle cx="${86 + i * 44}" cy="540" r="11" fill="${c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${fam}">
<rect width="1200" height="630" fill="${BG}"/>
<image x="72" y="56" width="180" height="72" href="data:image/svg+xml;base64,${logo}"/>
${app}${h1}${sub}${dots}
<text x="72" y="596" font-size="24" font-weight="600" fill="${ACCENT}">${HOST}</text>
<text x="1128" y="596" font-size="20" fill="${MUTED}" text-anchor="end">Tokyo · hourly</text>
</svg>`;
}

await mkdir(new URL("og/", stat), { recursive: true });
for (const [lang, dir] of LANGS) {
  const d = (await import(new URL("i18n/" + lang + ".mjs", src).href)).default;
  const png = render(await card(lang, d));
  await writeFile(new URL(`og/${dir || "en"}.png`, stat), png);
  console.log(`og/${dir || "en"}.png ${Math.round(png.length / 1024)} KB`);
}
