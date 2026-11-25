// The page fills what the build drew: the verdict, the numbers, the two source rows and the outage list. It never
// invents a state: if the data cannot be loaded, every block says so and the verdict stays "cannot judge".
import { verdict, summary, STATE, stateClass, duration, errKey } from "./model.mjs";
import { SERVICES, CATS, byId, byCat } from "./services.mjs";

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
const ago = at => agoIn(at, rtf);
const agoShort = at => agoIn(at, rtfShort);
const pct = v => v == null ? L.na : (v >= 99.95 ? "100" : v.toFixed(1)) + "%";
const durTxt = d => d ? new Intl.NumberFormat(LANG, { style: "unit", unit: d.unit, unitDisplay: "long" }).format(d.n) : L.na;
const label = state => L["st_" + state] ?? state;
const cls = state => stateClass(state);

/* ---------- the header: theme and language, as on every 1ms.dog tool ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const TH = ["system", "light", "dark"], thBtn = $("#theme");
const applyTheme = th => {
  if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th);
  else document.documentElement.removeAttribute("data-theme");
  thBtn.dataset.th = th;
  thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
};
applyTheme(TH.includes(store.get("down:theme")) ? store.get("down:theme") : "system");
thBtn.onclick = () => {
  const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3];
  store.set("down:theme", n); applyTheme(n);
};
$("#lang").onchange = e => {
  const lang = e.target.value;
  store.set("down:lang", lang);
  location.href = D.paths[lang] || "/";
};

/* ---------- the help dialog ---------- */
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

/* ---------- data ---------- */
function metaLine(data, failed) {
  const el = $("#liveMeta");
  if (!el) return;
  el.classList.toggle("warn", !!failed);
  if (failed) { el.textContent = L.meta_fail; return; }
  const docs = [data.index, data.unlock].filter(Boolean);
  if (!docs.length) { el.textContent = L.meta_fail; el.classList.add("warn"); return; }
  const at = Math.max(...docs.map(d => Date.parse(d.at) || 0));
  const every = Math.max(...docs.map(d => d.every || 3600));
  const stale = docs.some(d => d.stale) || !at || Date.now() - at > 3 * every * 1000;
  if (stale) { el.textContent = t("meta_stale", { t: time(at) }); el.classList.add("warn"); return; }
  el.textContent = t("meta_at", { t: time(at) }) + " · " + ago(at) + " · " + t("meta_interval", { n: Math.round(every / 60) });
  el.classList.remove("warn");
}

function homeView(data, failed, now) {
  const c = failed ? { ok: 0, bad: 0, unknown: SERVICES.length, n: SERVICES.length } : summary(SERVICES, data, now);
  const nTotal = c.n;
  const v = $("#verdict"), txt = $("#vText");
  if (!v || !txt) return;
  if (c.unknown === nTotal) { txt.textContent = t("sum_unknown", { n: nTotal }); v.className = "page-verdict dn-verdict"; }
  else if (c.bad) { txt.textContent = t("sum_some", { bad: c.bad, n: nTotal }); v.className = "page-verdict dn-verdict bad"; }
  else { txt.textContent = t("sum_ok", { ok: c.ok, n: nTotal }); v.className = "page-verdict dn-verdict " + (c.unknown ? "" : "ok"); }
  for (const s of SERVICES) {
    const card = document.querySelector(`.dn-svc[data-s="${s.id}"]`);
    if (!card) continue;
    const st = failed ? STATE.NODATA : verdict(s, data, now).state;
    card.querySelector(".dot").className = "dot " + cls(st);
    const lab = card.querySelector(".dn-svc-st");
    lab.textContent = label(st);
    lab.className = "dn-svc-st " + cls(st);
  }
  for (const c of CATS) {
    const el = document.getElementById("catN-" + c.id);
    if (!el || failed) continue;
    const list = byCat(c.id);
    const cc = summary(list, data, now);
    el.textContent = `${cc.ok}/${cc.n}`;
  }
}

function catView(data, failed, now) {
  const list = byCat(D.cat);
  const c = failed ? { ok: 0, bad: 0, unknown: list.length, n: list.length } : summary(list, data, now);
  const v = $("#verdict"), txt = $("#vText");
  if (v && txt) {
    if (c.unknown === c.n) { txt.textContent = t("sum_unknown", { n: c.n }); v.className = "page-verdict"; }
    else if (c.bad) { txt.textContent = t("sum_some", { bad: c.bad, n: c.n }); v.className = "page-verdict bad"; }
    else { txt.textContent = t("sum_ok", { ok: c.ok, n: c.n }); v.className = "page-verdict " + (c.unknown ? "" : "ok"); }
  }
  for (const s of list) {
    const row = document.querySelector(`.dn-row[data-s="${s.id}"]`);
    if (!row) continue;
    const r = failed ? { state: STATE.NODATA, up24: null } : verdict(s, data, now);
    row.querySelector(".dot").className = "dot " + cls(r.state);
    const st = row.querySelector(".dn-row-st");
    st.textContent = label(r.state);
    st.className = "dn-row-st " + cls(r.state);
    const u = row.querySelector(".dn-row-u");
    u.textContent = pct(r.up24);
    u.className = "dn-row-u " + (r.up24 == null ? "" : r.up24 < 95 ? "bad" : r.up24 < 99.5 ? "warn" : "ok");
  }
}

function lastOk(v) {
  const times = v.views.filter(x => x.present).map(x => {
    if (x.ok) return x.okAt || x.at;
    if (x.kind === "unlock") return x.okAt;
    return x.since ? x.since - (x.every || 3600) * 1000 : null;
  }).filter(Boolean);
  return times.length ? Math.max(...times) : null;
}

function outagesOf(s, data, v) {
  const b = v.views.find(x => x.kind === "base" && x.present && x.fresh);
  const bd = b && data.index && data.index.services[s.src.base];
  if (bd && Array.isArray(bd.out) && bd.out.length) {
    return bd.out.slice(0, 12).map(o => ({ from: o.from * 1000, to: o.to * 1000, runs: o.runs, err: o.err || null, at: Date.parse(data.index.at), every: data.index.every || 3600 }));
  }
  const u = v.views.find(x => x.kind === "unlock" && x.present && x.fresh && x.h);
  if (u) {
    const h = u.h, every = (u.every || 3600) * 1000, at = u.at, out = [];
    let i = 0;
    while (i < h.length) {
      if (h[i] !== "b") { i++; continue; }
      let j = i;
      while (j + 1 < h.length && h[j + 1] === "b") j++;
      out.push({ from: at - (h.length - 1 - i) * every, to: at - (h.length - 1 - j) * every, runs: j - i + 1, err: null, at, every: every / 1000 });
      i = j + 1;
    }
    return out.reverse().slice(0, 12);
  }
  return [];
}

function svcView(data, failed, now) {
  const s = byId.get(D.id);
  if (!s) return;
  const v = failed || !data ? verdict(s, null, now) : verdict(s, data, now);
  const vd = $("#verdict"), vt = $("#vText");
  if (vd && vt) {
    vd.className = "page-verdict " + cls(v.state);
    if (v.state === STATE.LONGFAIL) vt.textContent = t("v_longfail", { name: s.name, dur: durTxt(duration(now - v.since)) });
    else if (v.state === STATE.UNREACHABLE) vt.textContent = t("v_unreachable", { name: s.name });
    else if (v.state === STATE.PARTIAL) vt.textContent = t("v_partial", { name: s.name });
    else if (v.state === STATE.RECOVERED) vt.textContent = t("v_recovered", { name: s.name });
    else if (v.state === STATE.OK) vt.textContent = t("v_ok", { name: s.name });
    else if (v.state === STATE.STALE) vt.textContent = t("v_stale", { name: s.name });
    else vt.textContent = t("v_nodata", { name: s.name });
  }
  const up24 = $("#kUp24"), up7 = $("#kUp7"), last = $("#kLast");
  if (up24) up24.textContent = pct(v.up24);
  if (up7) up7.textContent = pct(v.up7);
  if (last) last.textContent = agoShort(lastOk(v));
  for (const row of $$(".dn-src[data-kind]")) {
    const view = v.views.find(x => x.kind === row.dataset.kind);
    const dot = row.querySelector(".dot"), val = row.querySelector(".dn-src-v");
    if (!view || !view.present) { dot.className = "dot"; val.textContent = L.src_nodata_val; val.className = "dn-src-v"; continue; }
    dot.className = "dot " + (view.fresh ? cls(view.ok ? STATE.OK : STATE.UNREACHABLE) : "");
    if (!view.fresh) { val.textContent = `${time(view.at)} · ${L.st_stale}`; val.className = "dn-src-v warn"; continue; }
    if (view.ok) { val.textContent = view.ms != null ? t("src_ok", { ms: Math.round(view.ms) }) : L.src_no_ms; val.className = "dn-src-v ok"; }
    else { val.textContent = t("src_err", { err: L[errKey(view.err)] ?? L.err_other }); val.className = "dn-src-v bad"; }
  }
  const outs = $("#outs"), outCount = $("#outCount");
  if (outs) {
    const list = failed || !data ? [] : outagesOf(s, data, v);
    outs.innerHTML = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "dn-out dn-out-empty";
      const unknown = failed || v.state === STATE.STALE || v.state === STATE.NODATA;
      li.textContent = unknown ? L.out_unknown : (v.views.some(x => x.kind === "base" && x.present)) ? L.out_none : L.out_none_window;
      outs.appendChild(li);
      if (outCount) outCount.textContent = "";
    } else {
      for (const o of list.slice(0, 10)) {
        const li = document.createElement("li");
        li.className = "dn-out";
        const ongoing = o.to >= o.at - (o.every || 3600) * 1500;
        const b = document.createElement("b");
        b.textContent = `${time(o.from)} – ${ongoing ? L.out_ongoing : time(o.to)}`;
        const sp = document.createElement("span");
        sp.textContent = (o.err ? t(errKey(o.err)) + " · " : "") + t("out_checks", { n: o.runs });
        li.append(b, sp);
        outs.appendChild(li);
      }
      if (outCount) outCount.textContent = "";
    }
  }
  const retry = $("#retry");
  if (retry) { retry.hidden = !failed; retry.textContent = L.retry; retry.onclick = load; }
  const report = $("#reportBtn");
  if (report) report.hidden = typeof window.msOpenReport !== "function";
  window.msReport = () => ({
    summary: `${s.name}: ${label(v.state)} · ${t("meta_at", { t: time(v.at) })}`,
    data: { service: s.id, state: v.state, at: v.at, ageMs: v.ageMs, up24: v.up24, up7: v.up7, views: v.views.map(x => ({ kind: x.kind, ok: x.ok, fresh: x.fresh, at: x.at, ms: x.ms, err: x.err })) },
    picks: [s.name, label(v.state), t("meta_at", { t: time(v.at) })],
  });
}

function wireTools() {
  const tool = id => { const m = document.querySelector(`meta[name="${id}"]`); return m ? m.content.replace(/\/+$/, "") : null; };
  const dir = D.lang === "en" ? "" : D.lang.toLowerCase() + "/";
  const links = $$(".dn-cross-link");
  for (const a of links) {
    const id = a.dataset.tool, base = tool(id);
    if (!base) continue;
    let href = base + "/" + dir;
    if (id === "home" && a.dataset.id) href = base + "/" + dir + a.dataset.id + "/";
    a.href = href;
    a.target = "_blank"; a.rel = "noopener";
    a.hidden = false;
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
    const now = Date.now();
    metaLine(data, false);
    if (D.type === "home") homeView(data, false, now);
    else if (D.type === "cat") catView(data, false, now);
    else svcView(data, false, now);
  } catch {
    const now = Date.now();
    metaLine(null, true);
    if (D.type === "home") homeView(null, true, now);
    else if (D.type === "cat") catView(null, true, now);
    else svcView(null, true, now);
  } finally {
    loading = false;
    wireTools();
  }
}
load();
