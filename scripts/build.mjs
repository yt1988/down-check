#!/usr/bin/env node
// Builds public/ from src/ and static/ (public/ is not committed: Workers Builds runs this, then deploys):
//   index.html, <lang>/index.html                    the board of every service, per language
//   <lang>/<cat>/index.html                          one page per group
//   <lang>/<cat>/<service>/index.html                one page per service
//   assets/app.<hash>.css, assets/app.<hash>.js      the page's styles and code
//   assets/l.<lang>.<hash>.js                        the runtime strings, one file per language
//   sitemap.xml, robots.txt, llms.txt, _headers      SEO and security headers
//   static/…                                         copied as it is: fonts, logos, icons, og images
// Usage: node scripts/build.mjs
import { mkdir, readFile, readdir, writeFile, rm, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { LANGS, SITE, REPO } from "../src/config.mjs";
import { CATS, SERVICES, byCat } from "../src/services.mjs";
import { STATUS } from "../src/status-sources.mjs";

const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url), stat = new URL("../static/", import.meta.url);
const t0 = Date.now();

const dirOf = lang => LANGS.find(l => l[0] === lang)[1];
const pathOf = (lang, rest = "") => "/" + (dirOf(lang) ? dirOf(lang) + "/" : "") + rest;
const catPath = (lang, cat) => pathOf(lang, cat + "/");
const svcPath = (lang, s) => pathOf(lang, s.cat + "/" + s.id + "/");

const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("down:theme");s=localStorage.getItem("down:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en"&&location.pathname===P.en)location.replace(P[l]+location.search+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");
const json = x => JSON.stringify(x).replace(/</g, "\\u003c");
const T = (I, lang, key) => I[lang][key] ?? I.en[key] ?? key;
const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
const GLOBAL = new Set(["ai", "video", "social", "dev", "game", "web", "cdn"]);
const cells = n => "<i></i>".repeat(n);

// What the browser needs at runtime; everything else is written into the page at build time.
const RUNTIME = new Set(["name", "lang_label", "a_lang", "a_theme", "a_help", "a_close", "a_prev", "a_next",
  "th_system", "th_light", "th_dark", "just_now", "na", "retry", "loading", "sep", "places_sep",
  "sum_all_ok", "sum_some", "sum_unknown", "sum_counts", "k_up24", "k_up7", "updated",
  "st_online", "st_recovered", "st_partial", "st_unreachable", "st_longfail", "st_fault", "st_unconfirmed", "st_stale", "st_nodata", "st_loading",
  "v_online", "v_recovered", "v_partial", "v_official_partial", "v_official_online", "v_official_ok_unreachable", "v_unreachable", "v_longfail", "v_fault", "v_unconfirmed", "v_stale", "v_nodata",
  "loc_lax", "loc_tokyo", "loc_shanghai",
  "official_none", "official_no_api",
  "incidents_none", "incidents_unknown", "incidents_ongoing", "incidents_checks",
  "err_challenge", "err_timeout", "err_reset", "err_http", "err_eof", "err_dns", "err_tls", "err_refused", "err_unreachable", "err_cancel", "err_other", "chip_official",
  "report_result", "report_prefill", "cross_home", "cross_unlock", "cross_check", "share_foot"]);

async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

function head({ lang, title, desc, kw, image, url, alts, graph }) {
  const locale = LANGS.find(l => l[0] === lang)[2];
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="keywords" content="${esc(kw)}">`,
    `<meta name="robots" content="index, follow">`,
    `<meta name="application-name" content="1ms.dog">`,
    `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
    `<link rel="canonical" href="${url}">`,
    alts,
    `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${url}">`, `<meta property="og:locale" content="${locale}">`,
    `<meta property="og:image" content="${image}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(desc)}">`,
    `<script type="application/ld+json">${json({ "@context": "https://schema.org", "@graph": graph })}</script>`,
  ].join("\n");
}

const appSchema = (lang, name, url, desc) => ({ "@type": "WebApplication", name, url, applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any", browserRequirements: "Requires JavaScript", description: desc, inLanguage: lang, isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } });

function faqGraph(Tt) {
  return { "@type": "FAQPage", mainEntity: [1, 2, 3, 4].map(i => ({ "@type": "Question", name: Tt("q" + i), acceptedAnswer: { "@type": "Answer", text: Tt("a" + i) } })) };
}

function helpParts(Tt) {
  const nav = [1, 2, 3, 4].map((i, j) => `<button type="button" role="tab" data-hq="${j}" aria-selected="${j === 0}">${esc(Tt("q" + i))}</button>`).join("");
  const body = [1, 2, 3, 4].map((i, j) => `<article data-hqb="${j}"${j ? " hidden" : ""}><h3>${esc(Tt("q" + i))}</h3><p>${esc(Tt("a" + i))}</p></article>`).join("");
  return { nav, body };
}

const catName = (Tt, cat) => Tt("cat_" + cat.id);
function catDesc(Tt, cat, lang) {
  if (GLOBAL.has(cat.id)) return Tt("cat_desc_" + cat.id);
  const all = byCat(cat.id);
  const cut = all.length > 6;
  const list = (cut ? all.slice(0, 4) : all).map(s => nameOf(s, lang)).join(Tt("sep")) + (cut ? "…" : "");
  // no sentence-ending period after an ellipsis: "A、B、C、D…" not "A、B、C、D、…。"
  const desc = fill(Tt("cat_desc_region"), { region: catName(Tt, cat), list });
  return cut ? desc.replace(/[。.]\s*$/, "") : desc;
}
const searchOf = s => [s.name, s.id, ...(s.alias || []), ...(s.names ? Object.values(s.names) : [])].join(" ").toLowerCase();
let ICONS = new Set();
const initials = (s, lang) => {
  const n = nameOf(s, lang), latin = n.replace(/[^A-Za-z0-9]/g, "");
  return latin ? latin.slice(0, 2).toUpperCase() : [...n].slice(0, 1).join("");
};
const iconHtml = (s, lang, extra = "") => ICONS.has(s.id)
  ? `<img class="svc-img ${extra}" src="/icons/${s.id}.png" alt="" width="18" height="18" loading="lazy">`
  : `<span class="svc-mono ${extra}" aria-hidden="true">${esc(initials(s, lang))}</span>`;

const nameOf = (s, lang) => (s.names && s.names[lang]) || s.name;
const crumbs = (items, Tt) => `<nav class="dn-crumbs" aria-label="${esc(Tt("a_crumbs"))}">${items.map((x, i) => (i ? '<span class="dn-sep" aria-hidden="true">›</span>' : "") + x).join("")}</nav>`;


// the two probe places: a flag, then the city in the page's language. The flags are the same SVGs the other tools use.
const PLACE_FLAG = { lax: "us", tokyo: "jp", shanghai: "cn" };
const placeFlag = p => `<img class="dn-flag" src="/assets/flags/${PLACE_FLAG[p]}.svg" alt="" width="18" height="13" loading="lazy">`;
const reportBtn = Tt => `<button class="btn sm dn-report-btn" id="reportBtn" type="button" data-ms-report="${esc(Tt("report_prefill"))}" hidden>${esc(Tt("report_result"))}</button>`;

function legend(Tt) {
  return `<div class="dn-legend">
      <span><i class="ic ok"></i>${esc(Tt("legend_ok"))}</span>
      <span><i class="ic warn"></i>${esc(Tt("legend_warn"))}</span>
      <span><i class="ic bad"></i>${esc(Tt("legend_bad"))}</span>
      <span><i class="ic unknown"></i>${esc(Tt("legend_unknown"))}</span>
    </div>`;
}

function homeMain(Tt, lang) {
  const cats = CATS.map(cat => {
    const list = byCat(cat.id);
    const tiles = list.map(s => `<li><a class="dn-tile" href="${svcPath(lang, s)}" data-s="${s.id}" data-name="${esc(searchOf(s))}" data-state="loading" aria-label="${esc(nameOf(s, lang))}"><span class="svc-wrap">${iconHtml(s, lang)}<span class="ic st"></span></span><span class="dn-tile-n">${esc(nameOf(s, lang))}</span><span class="dn-spark" aria-hidden="true"></span></a></li>`).join("");
    return `<section class="dn-cat" data-cat="${cat.id}"><div class="dn-cat-h"><h2><a href="${catPath(lang, cat.id)}">${esc(catName(Tt, cat))}</a></h2></div><ul class="dn-tiles">${tiles}</ul></section>`;
  }).join("");
  return `<section class="dn-hero">
      <h1 class="page-h">${esc(Tt("h1_home"))}</h1>
      <p class="dn-intro">${esc(Tt("intro_home"))}</p>
      <p class="dn-age" id="sumAge">${esc(Tt("loading"))}</p>
      <div class="dn-hero-tools">
        <input id="q" type="search" placeholder="${esc(Tt("filter_ph"))}" aria-label="${esc(Tt("filter_ph"))}" autocomplete="off" spellcheck="false">
        <div class="dn-hero-right">${legend(Tt)}<button class="btn sm" id="shareBtn" type="button" hidden>${esc(Tt("share_btn"))}</button>${reportBtn(Tt)}</div>
      </div>
    </section>
    <div class="dn-board" id="board">${cats}</div>
    <p class="dn-empty" id="noResults" hidden>${esc(Tt("no_results"))}</p>`;
}

function catMain(Tt, lang, cat) {
  const list = byCat(cat.id);
  const rows = list.map(s => `<li><a class="dn-row" href="${svcPath(lang, s)}" data-s="${s.id}" data-name="${esc(searchOf(s))}" aria-label="${esc(nameOf(s, lang))}">
      <span class="dn-row-name">${iconHtml(s, lang)}<b>${esc(nameOf(s, lang))}</b></span>
      <span class="dn-pill">${esc(Tt("st_loading"))}</span>
      <span class="dn-spark" aria-hidden="true"></span>
      <span class="dn-row-up"><i>24h</i><b>—</b></span></a></li>`).join("");
  return `${crumbs([`<a href="${pathOf(lang)}">${esc(Tt("back_home"))}</a>`, `<span class="dn-crumb-here">${esc(catName(Tt, cat))}</span>`], Tt)}
    <div class="dn-hero">
      <h1 class="page-h">${esc(fill(Tt("h1_cat"), { cat: catName(Tt, cat) }))}</h1>
      <p class="dn-intro">${esc(catDesc(Tt, cat, lang))}</p>
      <div class="dn-hero-tools"><span class="dn-age" id="sumAge">${esc(Tt("loading"))}</span><div class="dn-hero-right">${legend(Tt)}<button class="btn sm" id="shareBtn" type="button" hidden>${esc(Tt("share_btn"))}</button>${reportBtn(Tt)}</div></div>
    </div>
    <div class="dn-list-h" aria-hidden="true"><span>${esc(Tt("h_service"))}</span><span>${esc(Tt("h_status"))}</span><span>${esc(Tt("h_24h"))}</span><span>${esc(Tt("h_uptime"))}</span></div>
    <ul class="dn-list">${rows}</ul>`;
}

function svcMain(Tt, lang, s) {
  const name = nameOf(s, lang);
  const cat = CATS.find(c => c.id === s.cat);
  const siteUrl = esc(s.site);
  const siteHost = (() => { try { return new URL(s.site).host; } catch { return s.site; } })();
  const what = esc(Tt("what_text")).replace(/\{site\}/g, `<a class="dn-ext" href="${siteUrl}" target="_blank" rel="noopener">${esc(siteHost)}${EXT}</a>`);
  const chips = byCat(s.cat).filter(x => x.id !== s.id).map(x => `<li><a class="dn-chip" href="${svcPath(lang, x)}">${iconHtml(x, lang, "sm")}<span>${esc(nameOf(x, lang))}</span></a></li>`).join("");
  const src = STATUS[s.id];
  const offBlock = src?.page
    ? `<p class="dn-p">${esc(Tt("official_note"))}</p><a class="dn-src-link" id="officialLink" href="${esc(src.page)}" target="_blank" rel="noopener">${esc(Tt("official_go"))}${EXT}</a>`
    : `<p class="dn-p hint">${esc(Tt("official_none"))}</p>`;
  return `${crumbs([`<a href="${pathOf(lang)}">${esc(Tt("back_home"))}</a>`, `<a href="${catPath(lang, s.cat)}">${esc(catName(Tt, cat))}</a>`, `<span class="dn-crumb-here">${esc(name)}</span>`], Tt)}
    <div class="dn-svc-head">
      <h1 class="page-h"><span class="svc-lg">${iconHtml(s, lang)}</span>${esc(fill(Tt("h1_svc"), { name }))}</h1>
      <p class="dn-p" id="verdictSentence"></p>
    </div>
    <div class="dn-status-banner" id="statusPanel">
      <span class="ic" id="stateIcon"></span>
      <b id="stateText">${esc(Tt("st_loading"))}</b>
      <span class="dn-status-meta" id="statusMeta"></span>
      <div class="dn-status-acts">
        <button class="btn sm" id="shareBtn" type="button" hidden>${esc(Tt("share_btn"))}</button>
        ${reportBtn(Tt)}
      </div>
    </div>
    <section class="card card-pad dn-history">
      <div class="dn-history-h"><h2>${esc(Tt("k_up24"))}</h2><span class="dn-up" id="up24">—</span></div>
      <div class="dn-bar" id="bar24" aria-hidden="true">${cells(144)}</div>
      <div class="dn-axis"><span>${esc(Tt("bar_past"))}</span><span>${esc(Tt("bar_now"))}</span></div>
      <div class="dn-kpis">
        <div><span>${esc(Tt("k_up7"))}</span><b id="kUp7">—</b></div>
        <div><span>${esc(Tt("k_incidents"))}</span><b id="kInc">—</b></div>
      </div>
    </section>
    <section class="card card-pad">
      <h2>${esc(Tt("loc_h"))}</h2>
      <div class="dn-loc" data-kind="lax"><span class="ic"></span><b>${placeFlag("lax")}${esc(Tt("loc_lax"))}</b><span class="dn-loc-v">—</span><span class="dn-loc-age"></span></div>
      <div class="dn-loc" data-kind="tokyo"><span class="ic"></span><b>${placeFlag("tokyo")}${esc(Tt("loc_tokyo"))}</b><span class="dn-loc-v">—</span><span class="dn-loc-age"></span></div>
      <div class="dn-loc" data-kind="shanghai"><span class="ic"></span><b>${placeFlag("shanghai")}${esc(Tt("loc_shanghai"))}</b><span class="dn-loc-v">—</span><span class="dn-loc-age"></span></div>
    </section>
    <section class="card card-pad">
      <h2>${esc(Tt("official_h"))}</h2>
      ${offBlock}
    </section>
    <section class="card card-pad">
      <h2>${esc(Tt("incidents_h"))}</h2>
      <ul class="dn-outs" id="outs"><li class="dn-out dn-out-empty">${esc(Tt("st_loading"))}</li></ul>
    </section>
    <section class="card card-pad"><h2>${esc(Tt("what_h"))}</h2><p class="dn-p">${what}</p></section>
    <nav class="dn-related" aria-labelledby="relatedH"><h2 id="relatedH">${esc(Tt("related_h"))}</h2><ul class="dn-chips">${chips}</ul></nav>
    <div class="dn-cross">
      <a class="dn-cross-link" data-tool="home" data-id="${s.id}" hidden>${esc(Tt("cross_home"))}${EXT}</a>
      <a class="dn-cross-link" data-tool="unlock" hidden>${esc(Tt("cross_unlock"))}${EXT}</a>
      <a class="dn-cross-link" data-tool="check" hidden>${esc(Tt("cross_check"))}${EXT}</a>
    </div>`;
}

export async function build() {
  await rm(pub, { recursive: true, force: true });
  await mkdir(pub, { recursive: true });
  const I = await loadI18n();
  const langs = LANGS.filter(([l]) => I[l]).map(([l]) => l);
  try { ICONS = new Set((await readdir(new URL("icons/", stat))).filter(f => f.endsWith(".png")).map(f => f.slice(0, -4))); } catch { ICONS = new Set(); }

  const enKeys = Object.keys(I.en).sort();
  for (const l of langs) {
    const keys = Object.keys(I[l]).sort();
    if (keys.join() !== enKeys.join()) throw new Error(`i18n ${l}: keys differ from en`);
    for (const k of enKeys) {
      const a = [...String(I.en[k]).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
      const b = [...String(I[l][k]).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
      if (a !== b) throw new Error(`i18n ${l}.${k}: placeholders differ`);
    }
  }
  for (const k of RUNTIME) if (!(k in I.en)) throw new Error("runtime key missing from en: " + k);

  const css = (await Promise.all(["fonts.css", "base.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  const cssName = `app.${hash(css)}.css`;
  await mkdir(new URL("assets/", pub), { recursive: true });
  await writeFile(new URL("assets/" + cssName, pub), css);

  const js = (await bundle({
    entryPoints: [fileURLToPath(new URL("app.js", src))], bundle: true, format: "iife", target: "es2019",
    minify: true, legalComments: "none", write: false, external: ["/assets/share/*"],
  })).outputFiles[0].text;
  const jsName = `app.${hash(js)}.js`;
  await writeFile(new URL("assets/" + jsName, pub), js);

  const strings = {};
  for (const l of langs) {
    const obj = {};
    for (const k of RUNTIME) obj[k] = I[l][k];
    const body = `window.L=${JSON.stringify(obj)};window.LANG=${JSON.stringify(l)};`;
    const name = `l.${dirOf(l) || "en"}.${hash(body)}.js`;
    await writeFile(new URL("assets/" + name, pub), body);
    strings[l] = name;
  }

  for (const f of ["assets", "og", "icons"]) {
    try { await cp(new URL(f + "/", stat), new URL(f + "/", pub), { recursive: true }); } catch {}
  }
  try { await cp(new URL("fonts/", stat), new URL("assets/fonts/", pub), { recursive: true }); } catch {}
  for (const f of ["favicon.ico", "favicon-32.png"]) {
    try { await cp(new URL(f, stat), new URL(f, pub)); } catch {}
  }

  const tpl = await readFile(new URL("page.html", src), "utf8");
  const urls = [];
  let pages = 0;

  async function writePage({ lang, type, cat, service, title, desc, kw, main, graph }) {
    const Tt = key => T(I, lang, key);
    const paths = {};
    for (const l of langs) paths[l] = type === "home" ? pathOf(l) : type === "cat" ? catPath(l, cat.id) : svcPath(l, service);
    const url = SITE + paths[lang];
    const alts = langs.map(l => `<link rel="alternate" hreflang="${l}" href="${SITE}${paths[l]}">`).join("") +
      `<link rel="alternate" hreflang="x-default" href="${SITE}${paths.en}">`;
    const { nav, body } = helpParts(Tt);
    const image = `${SITE}/og/${dirOf(lang) || "en"}.png`;
    const rootAttr = lang === "en" && type === "home" ? " data-root" : "";
    let html = tpl
      .replace("{{lang}}", () => lang)
      .replace("{{pathsAttr}}", () => esc(JSON.stringify(paths)))
      .replace("{{rootAttr}}", () => rootAttr)
      .replace("{{prepaint}}", () => PREPAINT)
      .replace("{{head}}", () => head({ lang, title, desc, kw, image, url, alts, graph }))
      .replace("{{css}}", () => cssName)
      .replace("{{homeHref}}", () => pathOf(lang))
      .replace("{{appName}}", () => esc(Tt("app_name")))
      .replace("{{langOpts}}", () => langs.map(l => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].name)}</option>`).join(""))
      .replace("{{repo}}", () => REPO)
      .replace("{{main}}", () => main)
      .replace("{{foot_src}}", () => esc(Tt("foot_src")))
      .replace("{{js_required}}", () => esc(Tt("js_required")))
      .replace("{{cross_ping}}", () => esc(Tt("cross_ping")))
      .replace("{{cross_reach}}", () => esc(Tt("cross_reach")))
      .replace("{{faq_h}}", () => esc(Tt("faq_h")))
      .replace("{{helpNav}}", () => nav)
      .replace("{{helpC}}", () => body)
      .replace("{{data}}", () => json({ lang, type, id: service ? service.id : undefined, cat: cat ? cat.id : undefined, paths }))
      .replace("{{strings}}", () => strings[lang])
      .replace("{{js}}", () => jsName);
    for (const k of ["a_lang", "a_theme", "a_help", "a_close", "a_prev", "a_next", "lang_label"]) {
      html = html.split(`{{a:${k}}}`).join(esc(Tt(k))).split(`{{${k}}}`).join(esc(Tt(k)));
    }
    const rel = (dirOf(lang) ? dirOf(lang) + "/" : "") + (type === "home" ? "" : type === "cat" ? cat.id + "/" : service.cat + "/" + service.id + "/");
    const file = new URL(rel + "index.html", pub);
    await mkdir(new URL(".", file), { recursive: true });
    await writeFile(file, html);
    urls.push(url);
    pages++;
  }

  for (const lang of langs) {
    const Tt = key => T(I, lang, key);
    await writePage({ lang, type: "home", title: Tt("seo_title_home"), desc: Tt("seo_desc_home"), kw: Tt("seo_kw_home"),
      main: homeMain(Tt, lang), graph: [appSchema(lang, Tt("app_name") + " · 1ms.dog", SITE + pathOf(lang), Tt("seo_desc_home")), faqGraph(Tt)] });
    for (const cat of CATS) {
      await writePage({ lang, type: "cat", cat, title: fill(Tt("seo_title_cat"), { cat: catName(Tt, cat) }),
        desc: fill(Tt("seo_desc_cat"), { cat: catName(Tt, cat) }), kw: Tt("seo_kw_home"),
        main: catMain(Tt, lang, cat), graph: [appSchema(lang, fill(Tt("h1_cat"), { cat: catName(Tt, cat) }) + " · 1ms.dog", SITE + catPath(lang, cat.id), catDesc(Tt, cat, lang))] });
    }
    for (const s of SERVICES) {
      await writePage({ lang, type: "svc", service: s, title: fill(Tt("seo_title_svc"), { name: nameOf(s, lang) }),
        desc: fill(Tt("seo_desc_svc"), { name: nameOf(s, lang) }), kw: Tt("seo_kw_home"),
        main: svcMain(Tt, lang, s),
        graph: [appSchema(lang, fill(Tt("h1_svc"), { name: nameOf(s, lang) }) + " · 1ms.dog", SITE + svcPath(lang, s), fill(Tt("seo_desc_svc"), { name: nameOf(s, lang) })), faqGraph(Tt)] });
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>
`;
  await writeFile(new URL("sitemap.xml", pub), sitemap);
  await writeFile(new URL("robots.txt", pub), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const en = I.en;
  await writeFile(new URL("llms.txt", pub), `# ${en.app_name} · 1ms.dog

> Live status of ${SERVICES.length} services people search for during an outage. Our probes in Tokyo and Shanghai
> request each service every 10 minutes; each page shows the current state, the last 24 hours as a strip, the last
> 7 days of interruptions, and a link to the service's own official status page. A 403, 429 or challenge page is
> shown as unconfirmed, not down; missing or stale data (over 20 minutes) is shown as cannot judge. No visitor data
> is collected.

- Overview: ${SITE}/ (also ${langs.slice(1).map(l => "/" + dirOf(l) + "/").join(", ")})
- Groups: ${CATS.map(c => SITE + catPath("en", c.id)).join(", ")}
- One page per service: ${SITE}/<group>/<service>/ (${SERVICES.length} services)
- Source code: ${REPO}
`);

  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'", "font-src 'self'",
    "img-src 'self' data: blob:", "connect-src 'self' https:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  await writeFile(new URL("_headers", pub), `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/share/*
  ! Cache-Control
  Cache-Control: public, max-age=0, must-revalidate
/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=604800
/og/*
  Cache-Control: public, max-age=604800
`);

  console.log(`${pages} pages (${langs.length} languages × ${1 + CATS.length + SERVICES.length} kinds); sitemap ${urls.length} URLs; ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  return { pages, sitemapUrls: urls.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
