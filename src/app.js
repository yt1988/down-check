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
// "Los Angeles, Tokyo and Shanghai", not a comma list: the sentence reads "From {places}, X is not answering"
const places = v => (v.places || []).map(p => L["loc_" + p] || p).join(L.places_sep || L.sep || ", ");
// The places that got no answer, when at least one did: only then is "online" worth qualifying. A place that was
// refused or challenged is a different fact ("unconfirmed"), already on its own row, so it is not in this sentence.
const missText = v => (v.views || []).filter(x => x.present && x.fresh && !x.ok && !x.unknown).map(x => L["loc_" + x.place] || x.place).join(L.places_sep || L.sep || ", ");
// one line per place, as the place rows show it, for the report dialog's one-tap answers
const placeText = v => (v.views || []).filter(x => x.kind === "probe" && x.present)
  .map(x => `${L["loc_" + x.place] || x.place}: ${x.ok ? (x.ms != null ? Math.round(x.ms) + " ms" : L.na) : x.unknown ? label(STATE.UNCONFIRMED) : t(errKey(x.err))}`)
  .join(" · ");
const nameOf = s => (s.names && s.names[LANG]) || s.name;

/* ---------- share: the public dialog, with the live page as the link ---------- */
let lastData = null, shareMod = null;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const stateColor = st => st === STATE.OK ? cssVar("--t1")
  : st === STATE.RECOVERED ? cssVar("--warn")
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
// The 24-hour bar: 144 merged cells, one per ten minutes. Each cell also carries what each place saw in that window, so
// the reader can ask "why is this one red?" and get the three places, not a guess.
const barTip = () => $("#barTip");
let barCells = [];        // { from, to, merged, places } for the service currently drawn
function paintBar(el, h24, v) {
  if (!el) return;
  const s = (h24 || "").padStart(144, "-").slice(-144);
  barCellEls(el).forEach((i, k) => {
    const c = s[k];
    i.className = c === "o" ? "ok" : c === "x" ? "bad" : c === "u" ? "unk" : "";
  });
  // Align each place's own buckets to the merged ones, so cell k answers "what did each place see from T to T+10m".
  const at = v && v.merged && v.merged.at ? Math.round(v.merged.at / 1000) : null;
  const per = PLACES.map(p => {
    const view = v ? probeOf(v, p) : null;
    const m = new Map();
    if (!view || !view.h24 || !view.at) return m;
    const anchor = Math.floor(view.at / 1000 / 600) * 600;
    const chars = view.h24.padStart(144, "-").slice(-144);
    for (let i = 0; i < chars.length; i++) m.set(anchor - (chars.length - 1 - i) * 600, chars[i]);
    return m;
  });
  barCells = [];
  for (let k = 0; k < 144; k++) {
    const end = at != null ? at - (143 - k) * 600 : null;
    barCells.push({ from: end, to: end != null ? end + 600 : null, merged: s[k],
      places: per.map(m => (end != null ? m.get(end) || "-" : "-")) });
  }
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  el.setAttribute("tabindex", "0");
  let idx = -1, hideTimer = 0;
  const stateWord = c => c === "o" ? t("tip_ok") : c === "u" ? t("tip_refused") : c === "x" ? t("tip_none") : t("tip_notmeasured");
  function show(i, viaKey) {
    const cell = barCells[i], tip = barTip();
    if (!cell || !tip) return;
    idx = i;
    if (cell.from == null) { tip.hidden = true; return; }
    const clock = s2 => new Date(s2 * 1000).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
    const rows = PLACES.map((p, j) => `<span class="dn-tip-p">${flagImg(p)}${esc2(L["loc_" + p] || p)}<b>${esc2(stateWord(cell.places[j]))}</b></span>`).join("");
    const mWord = cell.merged === "x" ? t("tip_incident") : cell.merged === "-" ? t("tip_notmeasured") : label(cell.merged === "o" ? STATE.OK : STATE.UNCONFIRMED);
    tip.innerHTML = `<span class="dn-tip-h">${esc2(t("tip_head", { from: clock(cell.from), to: clock(cell.to) }))}</span>${rows}`
      + `<span class="dn-tip-m">${esc2(t("tip_merged", { state: mWord }))}</span>`;
    tip.hidden = false;
    tip.classList.toggle("dn-tip-key", !!viaKey);
    // On a mouse the card follows the cell and flips below when the cell is near the top. On a touch it is a fixed card
    // under the bar, where a thumb cannot cover it and nothing is cut off by the screen edge.
    const bar = el.getBoundingClientRect(), cellEl = barCellEls(el)[i].getBoundingClientRect(), tw = tip.offsetWidth;
    const coarse = matchMedia("(pointer: coarse)").matches;
    if (coarse) { tip.style.left = "0px"; tip.style.width = "100%"; }
    else {
      tip.style.width = "";
      let left = cellEl.left - bar.left + cellEl.width / 2 - tw / 2;
      left = Math.max(4, Math.min(left, el.clientWidth - tw - 4));
      tip.style.left = left + "px";
    }
    tip.classList.toggle("dn-tip-below", !!viaKey || coarse);
  }
  const hide = () => { idx = -1; pinned = false; const tip = barTip(); if (tip) tip.hidden = true; };
  // A touch leaves the pointer "outside" right after the tap, which would close what the tap opened: a tap pins the
  // card until the next tap elsewhere.
  let pinned = false;
  const debounceHide = () => { if (pinned) return; clearTimeout(hideTimer); hideTimer = setTimeout(hide, 120); };
  el.addEventListener("pointermove", e => {
    const box = el.getBoundingClientRect();
    const k = Math.floor(((e.clientX - box.left) / box.width) * 144);
    clearTimeout(hideTimer);
    if (k >= 0 && k < 144) show(k, false); else hide();
  });
  el.addEventListener("pointerleave", debounceHide);
  el.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") pinned = false; });
  el.addEventListener("focus", () => show(idx < 0 ? 143 : idx, true));
  el.addEventListener("blur", hide);
  el.addEventListener("keydown", e => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -999 : e.key === "End" ? 999 : 0;
    if (!step) return;
    e.preventDefault();
    show(Math.max(0, Math.min(143, (idx < 0 ? 143 : idx) + step)), true);
  });
  // touch: a tap pins the cell, a tap elsewhere lets it go. The browser sends touchstart and then a click for the same
  // tap, so a tap on the bar is remembered and that click does not close what the tap just opened.
  let lastTap = 0;
  el.addEventListener("touchstart", e => {
    const t0 = e.touches[0]; if (!t0) return;
    const box = el.getBoundingClientRect();
    const k = Math.floor(((t0.clientX - box.left) / box.width) * 144);
    lastTap = Date.now(); pinned = true;
    if (k >= 0 && k < 144) show(k, true);
  }, { passive: true });
  document.addEventListener("click", e => {
    if (el.contains(e.target) || Date.now() - lastTap < 700) return;
    hide();
  });
}
const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// the bar holds 144 <i> cells and the hover card; only the cells are cells
const barCellEls = el => [...el.querySelectorAll(":scope > i")];
// the same three flags the place rows use, one size down
const FLAG = { losangeles: "us", tokyo: "jp", shanghai: "cn" };
const flagImg = p => `<img class="dn-tip-f" src="/assets/flags/${FLAG[p]}.svg" alt="" width="14" height="10" loading="lazy">`;
const PLACES = ["losangeles", "tokyo", "shanghai"];
function probeOf(v, place) { return v.views.find(x => x.kind === "probe" && x.place === place); }
function newestProbeAt(data) {
  const times = [];
  for (const place of PLACES) {
    const doc = data?.[place];
    if (!doc?.services) continue;
    for (const s of Object.values(doc.services)) if (s.t) times.push(s.t * 1000);
  }
  return times.length ? Math.max(...times) : null;
}
function newestAt(data) {
  const times = [];
  for (const place of PLACES) {
    const doc = data?.[place];
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
    paintSpark(tile.querySelector(".dn-spark"), failed ? null : v.h24);
  }
  filter();
  const c = summary(SERVICES, failed ? null : data, now);
  wireReport(`${L.app_name} · ${ageLine(data, failed)}`,
    { page: "home", at: data ? newestProbeAt(data) : null, counts: c }, [ageLine(data, failed)]);
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
    paintSpark(row.querySelector(".dn-spark"), failed ? null : v.h24);
  }
  const c = summary(list, failed ? null : data, now);
  wireReport(`${L.app_name} · ${ageLine(data, failed)}`,
    { page: "cat", group: D.cat, at: data ? newestProbeAt(data) : null, counts: c }, [ageLine(data, failed)]);
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
    else if (st === STATE.RECOVERED) text = t("v_recovered", { places: places(v), name: nameOf(s) });
    else if (st === STATE.OK) {
      // "one of three cannot reach it" and "all three can" are different answers; the banner says only "online"
      const miss = missText(v);
      text = miss ? t("v_online_some", { ok: places(v), bad: miss }) : t("v_online", { places: places(v), name: nameOf(s) });
    }
    else if (st === STATE.UNCONFIRMED) text = L.v_unconfirmed;
    else if (st === STATE.STALE) text = L.v_stale;
    else text = L.v_nodata;
    sentence.textContent = text;
    sentence.hidden = st === STATE.OK;
  }
  // Every number below and the bar come from the merged series: they cannot disagree with the state above them.
  if ($("#up24")) $("#up24").textContent = pct(v.up24);
  if ($("#kUp24")) $("#kUp24").textContent = pct(v.up24);
  if ($("#kUp7")) $("#kUp7").textContent = pct(v.up7);
  if ($("#kInc")) $("#kInc").textContent = failed ? L.na : new Intl.NumberFormat(LANG).format(v.out.length);
  paintBar($("#bar24"), v.h24, v);

  // Red on a place row only when every place failed; then the rows and the banner agree that nobody reached it.
  const allDown = st === STATE.UNREACHABLE || st === STATE.LONGFAIL;
  for (const row of $$(".dn-loc[data-kind]")) {
    const view = failed ? null : probeOf(v, row.dataset.kind);
    const dot = row.querySelector(".ic"), val = row.querySelector(".dn-loc-v"), age = row.querySelector(".dn-loc-age");
    if (!view || !view.present) {
      dot.className = "ic"; val.textContent = L.st_nodata; val.className = "dn-loc-v"; age.textContent = ""; continue;
    }
    // One place failing is not the service being down: it means we could not reach it from that city. That row is grey
    // and says so ("timeout · cannot reach it from here"). Red on a row only when every place failed, so the rows and
    // the banner above agree that nobody reached it.
    if (!view.fresh) { dot.className = "ic"; val.textContent = L.st_stale; val.className = "dn-loc-v"; }
    else if (view.ok) { dot.className = "ic ok"; val.textContent = view.ms != null ? Math.round(view.ms) + " ms" : L.na; val.className = "dn-loc-v ok"; }
    else if (view.unknown) { dot.className = "ic unknown"; val.textContent = label(STATE.UNCONFIRMED); val.className = "dn-loc-v"; }
    else {
      dot.className = "ic " + (allDown ? "bad" : "unknown");
      const err = L[errKey(view.err)] ?? L.err_other;
      val.textContent = allDown ? err : t("loc_fail", { err });
      val.className = "dn-loc-v" + (allDown ? " bad" : "");
    }
    age.textContent = ago(view.at);
  }

  const outs = $("#outs");
  if (outs) {
    // The interruptions of the merged series: a run where no place answered. A single place failing is that place's
    // row, not an interruption of the service.
    const list = failed ? [] : (v.out || []);
    outs.innerHTML = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "dn-out dn-out-empty";
      li.textContent = failed || !v.at ? L.incidents_unknown : L.incidents_none;
      outs.appendChild(li);
    } else {
      for (const o of list.slice(0, 10)) {
        const li = document.createElement("li");
        li.className = "dn-out";
        const b = document.createElement("b");
        // newest run first; a run that reaches the newest sample is still going
        const end = o.to * 1000 >= (v.at || 0) - 1.5 * 600 * 1000 ? L.incidents_ongoing : o.runs === 1 ? null : time(o.to * 1000);
        b.textContent = end ? `${time(o.from * 1000)} – ${end}` : time(o.from * 1000);
        const sp = document.createElement("span");
        sp.textContent = t("incidents_checks", { n: o.runs });
        li.append(b, sp);
        outs.appendChild(li);
      }
    }
  }

  const retry = $("#retry");
  if (retry) { retry.hidden = !failed; retry.textContent = L.retry; retry.onclick = load; }
  wireReport(`${nameOf(s)}: ${label(st)} · ${ageLine(data, failed)}`,
    { service: s.id, state: st, at: v.at, places: v.places, up24: v.up24, up7: v.up7,
      losangeles: probeOf(v, "losangeles") && { ok: probeOf(v, "losangeles").ok, unknown: probeOf(v, "losangeles").unknown, at: probeOf(v, "losangeles").at, ms: probeOf(v, "losangeles").ms, err: probeOf(v, "losangeles").err },
      tokyo: probeOf(v, "tokyo") && { ok: probeOf(v, "tokyo").ok, unknown: probeOf(v, "tokyo").unknown, at: probeOf(v, "tokyo").at, ms: probeOf(v, "tokyo").ms, err: probeOf(v, "tokyo").err },
      shanghai: probeOf(v, "shanghai") && { ok: probeOf(v, "shanghai").ok, unknown: probeOf(v, "shanghai").unknown, at: probeOf(v, "shanghai").at, ms: probeOf(v, "shanghai").ms, err: probeOf(v, "shanghai").err } },
    [label(st), placeText(v), ageLine(data, failed)]);
}

/* ---------- "Wrong result?": the shell's report dialog, next to the result ---------- */
// The button sits with the share button, where the visitor is reading the answer. It is shown only when the shell's
// dialog exists (not in embed mode) and there is a result to be wrong. `picks` are one-tap answers, in the visitor's
// language, for when they send the button's own words and nothing else.
function wireReport(summary, data, picks) {
  const btn = $("#reportBtn");
  if (!btn) return;
  const can = typeof window.msOpenReport === "function";
  btn.hidden = !can;
  if (!can) return;
  window.msReport = () => ({ summary, data, picks: picks.filter(Boolean).slice(0, 8) });
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
  const q = $("#q");
  if (!q) return;
  q.addEventListener("input", filter);
  // "/" is what people try when they want to find one service: focus the box, unless they are already typing in a field
  document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = document.activeElement, tag = a && a.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a && a.isContentEditable)) return;
    e.preventDefault();
    q.focus(); q.select();
  });
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

/* ---------- auto refresh ----------
   The probes write every ten minutes, so the page asks every five: often enough that "updated 3 minutes ago" keeps
   moving, rarely enough to be polite. It is on by default and has no switch (owner's call, 2026-11-26). Nothing is
   reloaded: the JSON is fetched again and the same views repaint, so scroll position, the search box and an open dialog
   stay as they are. A failed fetch is not shown as "data is stale" — staleness is a fact about the data's own
   timestamps — it just retries, and the ring says so. */
const REFRESH_MS = 300 * 1000;
let refreshState = "idle", nextAt = 0, ticker = 0, refreshing = false;

function paintRefresh() {
  const line = $("#refreshLine");
  if (!line) return;
  line.hidden = false;
  const left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
  const text = $("#refreshText");
  line.classList.toggle("is-failed", refreshState === "failed");
  line.classList.toggle("is-paused", refreshState === "paused");
  line.classList.toggle("is-soon", refreshState !== "failed" && refreshState !== "paused" && left <= 60);
  line.dataset.state = refreshState;
  if (refreshState === "failed") text.textContent = t("refresh_failed", { n: left });
  else if (refreshState === "paused") text.textContent = t("refresh_paused");
  else if (refreshing) text.textContent = t("refresh_ready");
  else text.textContent = t("refresh_next", { n: left });
  // the ring: full at the start of the wait, empty when the next fetch is due
  const fg = $("#ringFg");
  if (fg) {
    const C = 2 * Math.PI * 6.4;   // r in the 16×16 viewBox
    fg.style.strokeDasharray = C;
    const frac = refreshState === "paused" ? 1 : Math.max(0, Math.min(1, left * 1000 / REFRESH_MS));
    fg.style.strokeDashoffset = C * (1 - frac);
  }
}

function scheduleIn(seconds) {
  nextAt = Date.now() + seconds * 1000;
  clearInterval(ticker);
  paintRefresh();
  // a second-by-second countdown, but the age line only re-renders once every five seconds: the two must not fight
  ticker = setInterval(() => {
    if (document.hidden) return;
    paintRefresh();
    if (Date.now() >= nextAt) refreshNow();
  }, 1000);
}

async function refreshNow() {
  if (refreshing) return;
  if (!lastData) { load(); scheduleIn(REFRESH_MS / 1000); return; }   // the first load failed: try again properly
  refreshing = true; refreshState = "live"; paintRefresh();
  try {
    const r = await fetch("/api/status.json", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("http " + r.status);
    const data = await r.json();
    lastData = data;
    const now = Date.now();
    if (D.type === "cat") catView(data, false, now);
    else if (D.type === "svc") svcView(data, false, now);
    refreshState = "live";
    flashAge();
  } catch {
    refreshState = "failed";       // keep what is on screen; the data's own age still decides "stale"
  } finally {
    refreshing = false;
    scheduleIn(REFRESH_MS / 1000);
  }
}

// A quiet sign that the page did take the new data: the age line pulses once. Off under prefers-reduced-motion.
function flashAge() {
  const age = $("#sumAge") || $("#statusMeta");
  if (!age) return;
  age.classList.remove("dn-flash");
  void age.offsetWidth;             // restart the animation
  age.classList.add("dn-flash");
}

function startRefresh() {
  if (D.type !== "cat" && D.type !== "svc") return;
  scheduleIn(REFRESH_MS / 1000);
  // a background tab does not poll; coming back refreshes at once, and the ring explains the pause meanwhile
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { refreshState = "paused"; paintRefresh(); return; }
    refreshState = "live";
    refreshNow();
  });
}

bindFilter();
load().finally(startRefresh);
