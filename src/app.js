// The page fills what the build drew: the summary, every tile, the current state, the 24-hour strip, the two probe
// rows and the official status. It never invents a state: if the data cannot be loaded, everything says so and the
// verdict stays "cannot judge".
import { verdict, summary, STATE, stateClass, duration, errKey } from "./model.mjs";
import { SERVICES, byId, byCat } from "./services.mjs";

const D = JSON.parse(document.getElementById("data").textContent);
const L = window.L || {}, LANG = window.LANG || D.lang || "en";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };

const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
const rtfShort = new Intl.RelativeTimeFormat(LANG, { numeric: "auto", style: "short" });
const dtf = new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const time = at => at ? dtf.format(new Date(at)) : L.na;
const agoIn = (at, f) => {
  if (!at) return L.na;
  const m = Math.round((Date.now() - at) / 60000);
  if (m <= 0) return L.just_now || L.na;
  if (m < 90) return f.format(-m, "minute");
  const h = Math.round(m / 60);
  return h < 48 ? f.format(-h, "hour") : f.format(-Math.round(h / 24), "day");
};
const ago = at => agoIn(at, rtf), agoShort = at => agoIn(at, rtfShort);
const pct = v => v == null ? L.na : (v >= 99.95 ? "100" : v.toFixed(1)) + "%";
const durTxt = d => d ? new Intl.NumberFormat(LANG, { style: "unit", unit: d.unit, unitDisplay: "long" }).format(d.n) : L.na;
const label = state => state === STATE.OK ? (L.st_online || "ok") : (L["st_" + state] ?? state);
const cls = state => stateClass(state);
const places = v => (v.places || []).map(p => L["loc_" + p] || p).join(L.sep || ", ");
const nameOf = s => (s.names && s.names[LANG]) || s.name;

/* ---------- share: the public dialog, with the live page as the link ---------- */
let lastData = null, shareMod = null;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const stateColor = st => st === STATE.OK ? cssVar("--t1")
  : st === STATE.RECOVERED || st === STATE.PARTIAL ? cssVar("--warn")
  : st === STATE.UNREACHABLE || st === STATE.LONGFAIL ? cssVar("--t5") : cssVar("--muted");
function shareHeadline(c) {
  if (c.unknown === c.n) return t("sum_unknown", { n: c.n });
  if (c.bad) return t("sum_some", { n: c.bad });
  if (c.unknown) return t("sum_unknown", { n: c.unknown });
  return t("sum_all_ok");
}
async function openShare() {
  if (!lastData) return;
  const now = Date.now(), url = location.origin + location.pathname;
  if (!shareMod) shareMod = await import("/assets/share/share.js?v=10");
  const fg = () => cssVar("--fg") || "#141416", muted = () => cssVar("--muted") || "#6e6e78";
  const base = { lang: LANG, name: L.app_name, file: "down-check", show: [], never: [], canShow: false,
    link: () => url, home: url, ts: newestProbeAt(lastData) || now, height: 630, foot: () => [L.share_foot] };
  let cfg;
  if (D.type === "svc") {
    const s = byId.get(D.id);
    if (!s) return;
    const v = verdict(s, lastData, now), name = nameOf(s), st = label(v.state), color = stateColor(v.state);
    cfg = { ...base, file: "down-" + s.id, text: () => `${name}: ${st} — ${url}`,
      draw: async (ctx, kit) => {
        ctx.fillStyle = fg(); kit.fit(ctx, name, kit.W - kit.P * 2, 56, 32); ctx.fillText(name, kit.P, kit.top + 34);
        ctx.fillStyle = color; kit.fit(ctx, st, kit.W - kit.P * 2, 104, 48); ctx.fillText(st, kit.P, kit.top + 162);
        ctx.fillStyle = muted(); ctx.font = `500 30px ${kit.F}`;
        ctx.fillText(`${L.k_up24}: ${pct(v.up24)}  ·  ${L.k_up7}: ${pct(v.up7)}`, kit.P, kit.top + 232);
      } };
  } else {
    const c = summary(D.type === "home" ? SERVICES : byCat(D.cat), lastData, now);
    const title = document.querySelector("h1")?.textContent || L.app_name;
    const head = shareHeadline(c), color = c.bad ? cssVar("--t5") : c.unknown ? cssVar("--muted") : cssVar("--t1");
    const counts = t("sum_counts", { ok: c.ok, bad: c.bad, unknown: c.unknown });
    cfg = { ...base, text: () => `${head} — ${url}`,
      draw: async (ctx, kit) => {
        ctx.fillStyle = fg(); kit.fit(ctx, title, kit.W - kit.P * 2, 48, 30); ctx.fillText(title, kit.P, kit.top + 30);
        ctx.fillStyle = color; kit.fit(ctx, head, kit.W - kit.P * 2, 76, 40); ctx.fillText(head, kit.P, kit.top + 146);
        ctx.fillStyle = muted(); ctx.font = `500 30px ${kit.F}`; ctx.fillText(counts, kit.P, kit.top + 216);
      } };
  }
  shareMod.share(cfg).open();
}
$("#shareBtn")?.addEventListener("click", openShare);

// WebKit leaves focus on <main> or <body> after a modal closes; the tool's universal focus ring would paint the page.
document.addEventListener("close", e => {
  const t = e.target;
  if (!t || t.tagName !== "DIALOG") return;
  const a = document.activeElement;
  if (a && (a === document.body || a === document.documentElement || a.tagName === "MAIN")) a.blur();
}, true);

/* ---------- header: theme and language, as on every 1ms.dog tool ---------- */
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const TH = ["system", "light", "dark"], thBtn = $("#theme");
const applyTheme = th => {
  if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th);
  else document.documentElement.removeAttribute("data-theme");
  thBtn.dataset.th = th;
  thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
};
applyTheme(TH.includes(store.get("down:theme")) ? store.get("down:theme") : "system");
thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set("down:theme", n); applyTheme(n); };
$("#lang").onchange = e => { store.set("down:lang", e.target.value); location.href = D.paths[e.target.value] || "/"; };

/* ---------- help dialog ---------- */
const help = $("#help");
let lastFocus = null, helpIdx = 0;
const qs = $$("#helpNav [data-hq]");
const closeHelp = () => { help.hidden = true; document.documentElement.style.removeProperty("overflow"); if (lastFocus) lastFocus.focus(); };
const showHelp = i => {
  helpIdx = Math.max(0, Math.min(qs.length - 1, i));
  qs.forEach(b => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
  $$("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
  $("#helpSel").value = helpIdx;
  $$("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= qs.length; });
  $("#helpC").scrollTop = 0;
};
if ($("#helpSel")) $("#helpSel").innerHTML = qs.map((b, i) => `<option value="${i}">${i + 1} / ${qs.length} · ${b.textContent.replace(/[&<>"]/g, "")}</option>`).join("");
$("#helpBtn").onclick = () => { lastFocus = document.activeElement; showHelp(helpIdx); help.hidden = false; document.documentElement.style.overflow = "hidden"; help.querySelector("[data-close]").focus(); };
qs.forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
$$("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });
$("#helpSel").onchange = e => showHelp(+e.target.value);
help.addEventListener("click", e => { if (e.target === help || e.target.closest("[data-close]")) closeHelp(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !help.hidden) closeHelp(); });

/* ---------- drawing helpers ---------- */
// 144 ten-minute samples → 24 hourly cells: red if any sample failed, green if any answered, grey if only refusals.
function sparkClasses(h24) {
  const s = (h24 || "").padStart(144, "-").slice(-144), out = [];
  for (let h = 0; h < 24; h++) {
    const g = s.slice(h * 6, h * 6 + 6);
    out.push(g.includes("x") ? "bad" : g.includes("o") ? "ok" : g.includes("u") ? "unk" : "");
  }
  return out;
}
function paintSpark(el, h24) {
  if (!el) return;
  if (!el.children.length) for (let i = 0; i < 24; i++) el.appendChild(document.createElement("i"));
  // a service with almost no history yet gets a plain track, not a barcode of one sample
  const known = (h24 || "").replace(/-/g, "").length;
  const cs = known < 6 ? [] : sparkClasses(h24);
  [...el.children].forEach((i, k) => { i.className = cs[k] || ""; });
}
function paintBar(el, h24) {
  if (!el) return;
  const s = (h24 || "").padStart(144, "-").slice(-144);
  [...el.children].forEach((i, k) => {
    const c = s[k];
    i.className = c === "o" ? "ok" : c === "x" ? "bad" : c === "u" ? "unk" : "";
  });
}
function probeOf(v, place) { return v.views.find(x => x.kind === "probe" && x.place === place); }
function bestProbe(v) { return probeOf(v, "tokyo")?.present ? probeOf(v, "tokyo") : probeOf(v, "shanghai"); }
function newestProbeAt(data) {
  const times = [];
  for (const doc of [data?.tokyo, data?.shanghai]) {
    if (!doc?.services) continue;
    for (const s of Object.values(doc.services)) if (s.t) times.push(s.t * 1000);
  }
  return times.length ? Math.max(...times) : null;
}
function newestAt(data) {
  const times = [];
  for (const doc of [data?.tokyo, data?.shanghai]) {
    if (!doc?.services) continue;
    for (const s of Object.values(doc.services)) if (s.t) times.push(s.t * 1000);
  }
  return times.length ? Math.max(...times) : null;
}
function ageLine(data, failed) {
  if (failed) return L.st_stale;
  const at = newestProbeAt(data) ?? newestAt(data);
  if (!at) return L.st_stale;
  return t("updated", { ago: ago(at) });
}
function paintAge(data, failed) {
  const el = $("#sumAge");
  if (el) el.textContent = ageLine(data, failed);
}

/* ---------- home: every service, grouped ---------- */
function homeView(data, failed, now) {
  paintAge(data, failed);
  for (const s of SERVICES) {
    const tile = document.querySelector(`.dn-tile[data-s="${s.id}"]`);
    if (!tile) continue;
    const v = failed ? verdict(s, null, now) : verdict(s, data, now);
    const st = v.state;
    tile.dataset.state = cls(st);
    tile.querySelector(".ic").className = "ic st " + cls(st);
    const text = `${nameOf(s)} — ${st === STATE.OK ? L.st_online : label(st)}`;
    tile.setAttribute("aria-label", text);
    tile.title = text;
    const p = failed ? null : bestProbe(v);
    paintSpark(tile.querySelector(".dn-spark"), p?.h24);
  }
  filter();
}

/* ---------- category ---------- */
function catView(data, failed, now) {
  const list = byCat(D.cat);
  paintAge(data, failed);
  for (const s of list) {
    const row = document.querySelector(`.dn-row[data-s="${s.id}"]`);
    if (!row) continue;
    const v = failed ? verdict(s, null, now) : verdict(s, data, now);
    const pill = row.querySelector(".dn-pill");
    pill.textContent = label(v.state);
    pill.className = "dn-pill " + cls(v.state);
    row.querySelector(".dn-row-up b").textContent = v.up24 == null ? L.st_nodata : pct(v.up24);
    const p = failed ? null : bestProbe(v);
    paintSpark(row.querySelector(".dn-spark"), p?.h24);
  }
}

/* ---------- service ---------- */
function svcView(data, failed, now) {
  const s = byId.get(D.id);
  if (!s) return;
  const v = failed ? verdict(s, null, now) : verdict(s, data, now);
  const st = v.state, panel = $("#statusPanel");
  if (panel) {
    panel.className = "dn-status-banner " + cls(st);
    $("#stateIcon").className = "ic " + cls(st);
    $("#stateText").textContent = label(st);
    const where = places(v);
    const when = ageLine(data, failed);
    $("#statusMeta").textContent = where ? when + " · " + where : when;
  }
  const sentence = $("#verdictSentence");
  if (sentence) {
    let text;
    if (st === STATE.LONGFAIL) text = t("v_longfail", { places: places(v), name: nameOf(s), dur: durTxt(duration(now - v.since)) });
    else if (st === STATE.UNREACHABLE) text = t("v_unreachable", { places: places(v), name: nameOf(s) });
    else if (st === STATE.PARTIAL) text = t("v_partial", { places: places(v), name: nameOf(s) });
    else if (st === STATE.RECOVERED) text = t("v_recovered", { places: places(v), name: nameOf(s) });
    else if (st === STATE.OK) text = t("v_online", { places: places(v), name: nameOf(s) });
    else if (st === STATE.UNCONFIRMED) text = L.v_unconfirmed;
    else if (st === STATE.STALE) text = L.v_stale;
    else text = L.v_nodata;
    sentence.textContent = text;
    sentence.hidden = st === STATE.OK;
  }
  const p = failed ? null : bestProbe(v);
  if ($("#up24")) $("#up24").textContent = pct(p?.up24 ?? null);
  if ($("#kUp24")) $("#kUp24").textContent = pct(p?.up24 ?? null);
  if ($("#kUp7")) $("#kUp7").textContent = pct(p?.up7 ?? null);
  if ($("#kInc")) $("#kInc").textContent = !p || !p.fresh ? L.na : new Intl.NumberFormat(LANG).format((p.out || []).length);
  paintBar($("#bar24"), p?.h24);

  for (const row of $$(".dn-loc[data-kind]")) {
    const view = failed ? null : probeOf(v, row.dataset.kind);
    const dot = row.querySelector(".ic"), val = row.querySelector(".dn-loc-v"), age = row.querySelector(".dn-loc-age");
    if (!view || !view.present) {
      dot.className = "ic"; val.textContent = L.st_nodata; val.className = "dn-loc-v"; age.textContent = ""; continue;
    }
    const vs = view.fresh ? (view.ok ? STATE.OK : view.unknown ? STATE.UNCONFIRMED : STATE.UNREACHABLE) : STATE.STALE;
    dot.className = "ic " + cls(vs);
    if (!view.fresh) { val.textContent = L.st_stale; val.className = "dn-loc-v"; }
    else if (view.ok) { val.textContent = view.ms != null ? Math.round(view.ms) + " ms" : L.na; val.className = "dn-loc-v ok"; }
    else if (view.unknown) { val.textContent = label(STATE.UNCONFIRMED); val.className = "dn-loc-v"; }
    else { val.textContent = L[errKey(view.err)] ?? L.err_other; val.className = "dn-loc-v bad"; }
    age.textContent = ago(view.at);
  }

  const outs = $("#outs");
  if (outs) {
    const view = failed ? null : (probeOf(v, "tokyo")?.present ? probeOf(v, "tokyo") : probeOf(v, "shanghai"));
    const list = !view || !view.fresh ? [] : (view.out || []);
    outs.innerHTML = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "dn-out dn-out-empty";
      li.textContent = failed || !view || !view.fresh ? L.incidents_unknown : L.incidents_none;
      outs.appendChild(li);
    } else {
      for (const o of list.slice(0, 10)) {
        const li = document.createElement("li");
        li.className = "dn-out";
        const ongoing = view.at && o.to * 1000 >= view.at - 1.5 * (view.every || 600) * 1000;
        const b = document.createElement("b");
        b.textContent = `${time(o.from * 1000)} – ${ongoing ? L.incidents_ongoing : time(o.to * 1000)}`;
        const sp = document.createElement("span");
        sp.textContent = (o.err ? t(errKey(o.err)) + " · " : "") + t("incidents_checks", { n: o.runs });
        li.append(b, sp);
        outs.appendChild(li);
      }
    }
  }

  const retry = $("#retry");
  if (retry) { retry.hidden = !failed; retry.textContent = L.retry; retry.onclick = load; }
  const report = $("#reportBtn");
  if (report) report.hidden = typeof window.msOpenReport !== "function";
  window.msReport = () => ({
    summary: `${nameOf(s)}: ${label(st)} · ${ageLine(data, failed)}`,
    data: { service: s.id, state: st, at: v.at, places: v.places, up24: v.up24, up7: v.up7,
      tokyo: probeOf(v, "tokyo") && { ok: probeOf(v, "tokyo").ok, unknown: probeOf(v, "tokyo").unknown, at: probeOf(v, "tokyo").at, ms: probeOf(v, "tokyo").ms, err: probeOf(v, "tokyo").err },
      shanghai: probeOf(v, "shanghai") && { ok: probeOf(v, "shanghai").ok, unknown: probeOf(v, "shanghai").unknown, at: probeOf(v, "shanghai").at, ms: probeOf(v, "shanghai").ms, err: probeOf(v, "shanghai").err } },
    picks: [nameOf(s), label(st), ageLine(data, failed)],
  });
}

/* ---------- the search box ---------- */
let filterBound = false;
function filter() {
  const q = ($("#q")?.value || "").trim().toLowerCase();
  let shown = 0;
  for (const cat of $$(".dn-cat")) {
    let inCat = 0;
    for (const li of cat.querySelectorAll(".dn-tile")) {
      const ok = !q || (li.dataset.name || "").includes(q);
      li.parentElement.hidden = !ok;
      if (ok) inCat++;
    }
    cat.hidden = inCat === 0;
    shown += inCat;
  }
  if ($("#noResults")) $("#noResults").hidden = shown !== 0;
}
function bindFilter() {
  if (filterBound) return;
  filterBound = true;
  $("#q")?.addEventListener("input", filter);
}

/* ---------- links to the other tools ---------- */
function wireTools() {
  const tool = id => { const m = document.querySelector(`meta[name="${id}"]`); return m ? m.content.replace(/\/+$/, "") : null; };
  // literal calls so the shell's link check can see them; no meta means hidden
  const known = { ping: tool("ping"), reach: tool("reach"), home: tool("home"), check: tool("check"), unlock: tool("unlock") };
  const dir = D.lang === "en" ? "" : D.lang.toLowerCase() + "/";
  for (const a of $$(".dn-cross-link")) {
    const id = a.dataset.tool, base = known[id];
    if (!base) continue;
    let href = base + "/" + dir;
    if (id === "home" && a.dataset.id) href = base + "/" + dir + a.dataset.id + "/";
    a.href = href; a.target = "_blank"; a.rel = "noopener"; a.hidden = false;
  }
}

/* ---------- load ---------- */
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  const retry = $("#retry");
  if (retry) retry.hidden = true;
  try {
    const r = await fetch("/api/status.json", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("http " + r.status);
    const data = await r.json();
    lastData = data;
    $("#shareBtn")?.removeAttribute("hidden");
    const now = Date.now();
    if (D.type === "home") homeView(data, false, now);
    else if (D.type === "cat") catView(data, false, now);
    else svcView(data, false, now);
  } catch {
    lastData = null;
    $("#shareBtn")?.setAttribute("hidden", "");
    const now = Date.now();
    if (D.type === "home") homeView(null, true, now);
    else if (D.type === "cat") catView(null, true, now);
    else svcView(null, true, now);
  } finally {
    loading = false;
    wireTools();
  }
}
bindFilter();
load();
