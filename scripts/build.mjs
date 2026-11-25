#!/usr/bin/env node
// Builds public/ from src/ and static/ (public/ is not committed: Workers Builds runs this, then deploys):
//   index.html, <lang>/index.html                    the overview per language
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

const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url), stat = new URL("../static/", import.meta.url);
const t0 = Date.now();

// language, URL folder, og:locale; the first is the root
const TR = { "zh-CN": "zh-cn", "zh-TW": "zh-tw" };
const dirOf = lang => LANGS.find(l => l[0] === lang)[1];
const pathOf = (lang, rest = "") => "/" + (dirOf(lang) ? dirOf(lang) + "/" : "") + rest;
const catPath = (lang, cat) => pathOf(lang, cat + "/");
const svcPath = (lang, s) => pathOf(lang, s.cat + "/" + s.id + "/");

// Runs before first paint: apply the saved theme and, on the English root only, send the visitor to their language.
const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("down:theme");s=localStorage.getItem("down:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en"&&location.pathname===P.en)location.replace(P[l]+location.search+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");
const json = x => JSON.stringify(x).replace(/</g, "\\u003c");
const T = (i18n, lang, key) => i18n[lang][key] ?? i18n.en[key] ?? key;
const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';

// What the browser needs at runtime; everything else is written into the page at build time.
const RUNTIME = new Set(["name", "lang_label", "a_lang", "a_theme", "a_help", "a_close", "a_prev", "a_next",
  "th_system", "th_light", "th_dark",
  "st_loading", "st_ok", "st_recovered", "st_partial", "st_unreachable", "st_longfail", "st_stale", "st_nodata",
  "v_ok", "v_recovered", "v_partial", "v_unreachable", "v_longfail", "v_stale", "v_nodata",
  "meta_at", "meta_interval", "meta_stale", "meta_fail",
  "sum_ok", "sum_some", "sum_unknown", "k_up24", "k_up7", "k_lastok", "k_checks",
  "src_base_row", "src_unlock_row", "src_ok", "src_no_ms", "src_err", "src_nodata_val",
  "err_timeout", "err_reset", "err_http", "err_eof", "err_dns", "err_tls", "err_cancel", "err_other",
  "loading", "retry", "na", "just_now", "out_none", "out_none_window", "out_unknown", "out_ongoing", "out_checks", "cross_home", "cross_unlock", "cross_check",
  "report_result", "report_prefill"]);

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

function homeMain(Tt, lang) {
  const cats = CATS.map(c => {
    const list = byCat(c.id);
    return `<section class="dn-cat" aria-labelledby="cat-${c.id}">
      <div class="dn-cat-h"><h2 id="cat-${c.id}"><a href="${catPath(lang, c.id)}">${esc(Tt(c.name))}</a></h2><span class="dn-cat-n" id="catN-${c.id}">${list.length}</span></div>
      <ul class="dn-grid">${list.map(s => `<li><a class="dn-svc" href="${svcPath(lang, s)}" data-s="${s.id}"><span class="dot"></span><span class="dn-svc-n">${esc(s.name)}</span><span class="dn-svc-st">${esc(Tt("st_loading"))}</span></a></li>`).join("")}</ul>
    </section>`;
  }).join("");
  return `<section class="dn-hero">
      <h1 class="page-h">${esc(Tt("h1_home"))}</h1>
      <p class="dn-intro">${esc(Tt("intro_home"))}</p>
      <p class="dn-live" id="liveMeta">${esc(Tt("st_loading"))}</p>
      <div class="page-verdict dn-verdict" id="verdict"><span class="dot"></span><span id="vText">${esc(Tt("st_loading"))}</span></div>
    </section>
    <div class="dn-cats">${cats}</div>
    <section class="card card-pad"><h2>${esc(Tt("honesty_h"))}</h2><p class="dn-p">${esc(Tt("honesty_t"))}</p></section>`;
}

function catMain(Tt, lang, cat) {
  const list = byCat(cat.id);
  const rows = list.map(s => `<li><a class="dn-row" href="${svcPath(lang, s)}" data-s="${s.id}">
      <span class="dot"></span><span class="dn-row-n">${esc(s.name)}</span>
      <span class="dn-row-u">—</span><span class="dn-row-st">${esc(Tt("st_loading"))}</span></a></li>`).join("");
  return `<nav class="dn-crumbs"><a href="${pathOf(lang)}">${esc(Tt("back_home"))}</a><span aria-hidden="true">/</span><span class="dn-crumb-here">${esc(Tt(cat.name))}</span></nav>
    <header class="dn-hero">
      <h1 class="page-h">${esc(fill(Tt("h1_cat"), { cat: Tt(cat.name) }))}</h1>
      <p class="dn-intro">${esc(Tt(cat.desc))}</p>
      <p class="dn-live" id="liveMeta">${esc(Tt("st_loading"))}</p>
      <div class="page-verdict" id="verdict"><span class="dot"></span><span id="vText">${esc(Tt("st_loading"))}</span></div>
    </header>
    <div class="dn-cols" aria-hidden="true"><span></span><span></span><span>24h</span><span>${esc(Tt("h_state"))}</span></div>
    <ul class="dn-rows">${rows}</ul>
    <section class="card card-pad"><h2>${esc(Tt("honesty_h"))}</h2><p class="dn-p">${esc(Tt("honesty_t"))}</p></section>`;
}

function svcMain(Tt, lang, s) {
  const cat = CATS.find(c => c.id === s.cat);
  const siteUrl = esc(s.site);
  const siteHost = (() => { try { return new URL(s.site).host; } catch { return s.site; } })();
  const srcText = esc(Tt("src_text")).replace(/\{site\}/g, `<a class="dn-ext" href="${siteUrl}" target="_blank" rel="noopener">${esc(siteHost)}${EXT}</a>`);
  const rows = [
    s.src.base ? `<div class="dn-src" data-kind="base"><span class="dot"></span><span class="dn-src-n">${esc(Tt("src_base_row"))}</span><span class="dn-src-v">${esc(Tt("st_loading"))}</span></div>` : "",
    s.src.unlock ? `<div class="dn-src" data-kind="unlock"><span class="dot"></span><span class="dn-src-n">${esc(Tt("src_unlock_row"))}</span><span class="dn-src-v">${esc(Tt("st_loading"))}</span></div>` : "",
  ].join("");
  const off = s.status
    ? `<p class="dn-p"><a class="dn-ext" href="${esc(s.status)}" target="_blank" rel="noopener">${esc(Tt("off_go"))}${EXT}</a></p>`
    : `<p class="dn-p hint">${esc(Tt("off_none"))}</p>`;
  const chips = byCat(s.cat).filter(x => x.id !== s.id).map(x => `<li><a class="dn-chip" href="${svcPath(lang, x)}">${esc(x.name)}</a></li>`).join("");
  return `<nav class="dn-crumbs"><a href="${pathOf(lang)}">${esc(Tt("back_home"))}</a><span aria-hidden="true">/</span><a href="${catPath(lang, s.cat)}">${esc(Tt(cat.name))}</a><span aria-hidden="true">/</span><span class="dn-crumb-here">${esc(s.name)}</span></nav>
    <header><h1 class="page-h">${esc(fill(Tt("h1_svc"), { name: s.name }))}</h1></header>
    <section class="card card-pad dn-verdict-card">
      <div class="page-verdict" id="verdict"><span class="dot"></span><span id="vText">${esc(Tt("st_loading"))}</span></div>
      <p class="dn-scope">${esc(Tt("v_scope"))}</p>
      <p class="dn-live" id="liveMeta">${esc(Tt("st_loading"))}</p>
      <div class="kpis">
        <div class="kpi"><b id="kUp24">—</b><span>${esc(Tt("k_up24"))}</span></div>
        <div class="kpi"><b id="kUp7">—</b><span>${esc(Tt("k_up7"))}</span></div>
        <div class="kpi"><b id="kLast">—</b><span>${esc(Tt("k_lastok"))}</span></div>
      </div>
      <div class="dn-srcs" id="srcs">${rows}</div>
      <button class="btn ghost sm" id="retry" type="button" hidden>${esc(Tt("retry"))}</button>
    </section>
    <section class="card card-pad">
      <div class="dn-sec-h"><h2>${esc(Tt("out_h"))}</h2><span class="hint" id="outCount"></span></div>
      <ul class="dn-outs" id="outs"><li class="dn-out dn-out-empty">${esc(Tt("st_loading"))}</li></ul>
    </section>
    <section class="card card-pad"><h2>${esc(Tt("src_h"))}</h2><p class="dn-p">${srcText}</p></section>
    <section class="card card-pad"><h2>${esc(Tt("off_h"))}</h2>${off}</section>
    <nav class="dn-related"><h2>${esc(Tt("related_h"))}</h2><ul class="dn-chips">${chips}</ul></nav>
    <div class="dn-cross">
      <a class="dn-cross-link" data-tool="home" data-id="${s.id}" hidden>${esc(Tt("cross_home"))}${EXT}</a>
      <a class="dn-cross-link" data-tool="unlock" hidden>${esc(Tt("cross_unlock"))}${EXT}</a>
      <a class="dn-cross-link" data-tool="check" hidden>${esc(Tt("cross_check"))}${EXT}</a>
    </div>
    <div class="dn-report"><button class="btn ghost sm" id="reportBtn" type="button" data-ms-report="${esc(Tt("report_prefill"))}" hidden>${esc(Tt("report_result"))}</button></div>`;
}

export async function build() {
  await rm(pub, { recursive: true, force: true });
  await mkdir(pub, { recursive: true });
  const I = await loadI18n();
  const langs = LANGS.filter(([l]) => I[l]).map(([l]) => l);

  // the same keys and placeholders in every language
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

  // styles and code
  const css = (await Promise.all(["fonts.css", "base.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  const cssName = `app.${hash(css)}.css`;
  await mkdir(new URL("assets/", pub), { recursive: true });
  await writeFile(new URL("assets/" + cssName, pub), css);

  const js = (await bundle({
    entryPoints: [fileURLToPath(new URL("app.js", src))], bundle: true, format: "iife", target: "es2019",
    minify: true, legalComments: "none", write: false,
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

  // static files, copied as they are
  for (const f of ["assets", "og"]) {
    try { await cp(new URL(f + "/", stat), new URL(f + "/", pub), { recursive: true }); } catch {}
  }
  try { await cp(new URL("fonts/", stat), new URL("assets/fonts/", pub), { recursive: true }); } catch {}
  for (const f of ["favicon.ico", "favicon-32.png"]) {
    try { await cp(new URL(f, stat), new URL(f, pub)); } catch {}
  }

  const tpl = await readFile(new URL("page.html", src), "utf8");
  const urls = [];
  let pages = 0;

  async function writePage({ lang, type, cat, service, title, desc, kw, main, graph, altsRest }) {
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
      .replace("{{faq_h}}", () => esc(Tt("faq_h")))
      .replace("{{helpNav}}", () => nav)
      .replace("{{helpC}}", () => body)
      .replace("{{data}}", () => json({ lang, type, id: service ? service.id : undefined, cat: cat ? cat.id : undefined, paths }))
      .replace("{{strings}}", () => strings[lang])
      .replace("{{js}}", () => jsName);
    for (const k of ["a_lang", "a_theme", "a_help", "a_close", "a_prev", "a_next", "lang_label"]) {
      html = html.split(`{{a:${k}}}`).join(esc(Tt(k))).split(`{{${k}}}`).join(esc(Tt(k)));
    }
    html = html.split("{{lang_label}}").join(esc(Tt("lang_label")));
    const rel = (type === "home" ? (dirOf(lang) ? dirOf(lang) + "/" : "") : type === "cat" ? (dirOf(lang) ? dirOf(lang) + "/" : "") + cat.id + "/" : (dirOf(lang) ? dirOf(lang) + "/" : "") + service.cat + "/" + service.id + "/");
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
      await writePage({ lang, type: "cat", cat, title: fill(Tt("seo_title_cat"), { cat: Tt(cat.name) }),
        desc: fill(Tt("seo_desc_cat"), { cat: Tt(cat.name) }), kw: Tt("seo_kw_home"),
        main: catMain(Tt, lang, cat), graph: [appSchema(lang, Tt(cat.name) + " · 1ms.dog", SITE + catPath(lang, cat.id), Tt(cat.desc))] });
    }
    for (const s of SERVICES) {
      await writePage({ lang, type: "svc", service: s, title: fill(Tt("seo_title_svc"), { name: s.name }),
        desc: fill(Tt("seo_desc_svc"), { name: s.name }), kw: Tt("seo_kw_home"),
        main: svcMain(Tt, lang, s),
        graph: [appSchema(lang, fill(Tt("h1_svc"), { name: s.name }) + " · 1ms.dog", SITE + svcPath(lang, s), fill(Tt("seo_desc_svc"), { name: s.name })), faqGraph(Tt)] });
    }
  }

  // sitemap, robots, llms
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>
`;
  await writeFile(new URL("sitemap.xml", pub), sitemap);
  await writeFile(new URL("robots.txt", pub), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const en = I.en;
  await writeFile(new URL("llms.txt", pub), `# ${en.app_name} · 1ms.dog

> Live status of ${SERVICES.length} services people search for during an outage: whether our own server in Tokyo can
> reach each one, checked hourly, with the interruptions of the last 7 days and a link to each service's official
> status page. A single probe proves reachability from Tokyo, not an outage: when the data is missing or older than
> three checks, the page says it cannot judge instead of calling the service down. No visitor data is collected.

- Overview: ${SITE}/ (also ${langs.slice(1).map(l => "/" + dirOf(l) + "/").join(", ")})
- Groups: ${CATS.map(c => SITE + catPath("en", c.id)).join(", ")}
- One page per service: ${SITE}/<group>/<service>/ (${SERVICES.length} services)
- Source code: ${REPO}
`);

  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'", "font-src 'self'",
    "img-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
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
