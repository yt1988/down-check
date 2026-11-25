// The verdict, as pure functions: the build and the tests use this file, and scripts/build.mjs inlines it into the
// browser bundle. Nothing here knows about the DOM or about 1ms.dog.
//
// Two facts, never one: what our own probes see from Tokyo, and (from the second phase on) what the service's official
// status page says. A single probe that cannot reach a service proves "we cannot reach it from here", not "it is down".
// So the worst state our own probes can produce is `unreachable` ("from Tokyo it does not answer"), and a failure that
// has lasted more than a day is `longfail` ("from Tokyo it has not answered for N days; maybe it is us") — neither is
// called an outage. Missing or stale data is `stale`/`nodata`, never "down".

export const STATE = {
  OK: "ok",               // our probes answered just now
  RECOVERED: "recovered", // answering now, but there was a failure in the last 24 hours
  PARTIAL: "partial",     // one of our two endpoints answers, the other does not
  UNREACHABLE: "unreachable", // neither endpoint answers now, for less than a day
  LONGFAIL: "longfail",   // neither has answered for more than a day: more likely our check than the service
  STALE: "stale",         // the data is older than 3 × its expected interval
  NODATA: "nodata",       // no data for this service at all
};

// The first version reads the hourly baseline; the second phase's own probe declares 600.
export const EXPECTED_EVERY = 3600;
export const FRESH_FACTOR = 3;
const DAY = 24 * 3600 * 1000;

const pct = (ok, n) => (n ? (ok * 100) / n : null);

// One probe's view of one service.
export function sourceView(kind, doc, id, now) {
  const none = { kind, present: false, fresh: false, ok: false, at: null, ageMs: null };
  if (!doc || !doc.at || !doc.services) return none;
  const s = doc.services[id];
  if (!s) return none;
  const at = Date.parse(doc.at);
  const ageMs = Number.isFinite(at) ? Math.max(0, now - at) : null;
  const every = (doc.every || EXPECTED_EVERY) * 1000;
  const fresh = ageMs != null && ageMs <= FRESH_FACTOR * every;
  const v = { kind, present: true, fresh, at, ageMs, stale: !!doc.stale, every: doc.every || EXPECTED_EVERY, ok: false, ms: null, err: null, since: null, okAt: null, recent: false, up24: null, up7: null, checks24: null, h: null };

  if (kind === "base") {
    v.ok = !s.err && typeof s.ms === "number" && s.ms >= 0;
    v.ms = v.ok ? s.ms : null;
    v.err = v.ok ? null : s.err || null;
    v.up24 = s.up24 ?? null;
    v.up7 = s.up7 ?? null;
    v.okAt = v.ok ? at : null;
    v.checks24 = doc.every ? Math.round(86400 / doc.every) : 24;
    if (!v.ok) {
      const o = (s.out || [])[0];
      // out is newest first; the newest entry is the run in progress when it is the latest one
      if (o && o.from) v.since = o.from * 1000;
    } else if (Array.isArray(s.out)) {
      v.recent = s.out.some(o => o.to * 1000 >= now - DAY) || (v.up24 != null && v.up24 < 99.5);
    }
    return v;
  }

  // unlock: s.s is "ok" or "bad"; h is the last N runs, oldest first, "o" / "b" / "-"
  v.ok = s.s === "ok";
  v.ms = typeof s.ms === "number" && s.ms >= 0 ? s.ms : null;
  v.err = v.ok ? null : s.err || null;
  if (!v.ok && s.since) v.since = Date.parse(s.since);
  const h = typeof s.h === "string" ? s.h : "";
  v.h = h;
  v.okAt = s.ok_at ? Date.parse(s.ok_at) : null;
  const counted = h.replace(/-/g, "");
  if (counted.length) {
    v.up7 = pct((counted.match(/o/g) || []).length, counted.length);
    const last24 = h.slice(-24);
    const n24 = last24.replace(/-/g, "");
    if (n24.length) {
      v.up24 = pct((n24.match(/o/g) || []).length, n24.length);
      v.checks24 = n24.length;
    }
    v.recent = !v.ok || (n24.includes("b") && v.up24 != null && v.up24 < 100);
  }
  return v;
}

// The verdict for one service, from every probe that knows it.
export function verdict(service, data, now = Date.now()) {
  const views = [];
  if (service.src.base) views.push(sourceView("base", data && data.index, service.src.base, now));
  if (service.src.unlock) views.push(sourceView("unlock", data && data.unlock, service.src.unlock, now));

  const present = views.filter(v => v.present);
  const avail = present.filter(v => v.fresh);
  const at = present.length ? Math.max(...present.map(v => v.at || 0)) : null;
  const ageMs = at ? Math.max(0, now - at) : null;

  if (!avail.length) {
    const state = present.length ? STATE.STALE : STATE.NODATA;
    return { state, views, at, ageMs, since: null, up24: null, up7: null, partialStale: false };
  }

  const fails = avail.filter(v => !v.ok);
  const oks = avail.filter(v => v.ok);
  const up24 = pickUp(avail, "up24"), up7 = pickUp(avail, "up7");
  const partialStale = avail.length < present.length;

  if (fails.length) {
    if (oks.length) return { state: STATE.PARTIAL, views, at, ageMs, since: null, up24, up7, partialStale };
    const since = Math.max(...fails.map(v => v.since || 0)) || null;
    const state = since && now - since >= DAY ? STATE.LONGFAIL : STATE.UNREACHABLE;
    return { state, views, at, ageMs, since, up24, up7, partialStale };
  }

  const recent = avail.some(v => v.recent);
  return { state: recent ? STATE.RECOVERED : STATE.OK, views, at, ageMs, since: null, up24, up7, partialStale };
}

// Prefer the baseline's own numbers; the unlock history is a fallback for services only it watches.
function pickUp(views, key) {
  const withNumber = views.filter(v => v[key] != null);
  if (!withNumber.length) return null;
  return withNumber[0][key];
}

export function summary(list, data, now = Date.now()) {
  const counts = { ok: 0, bad: 0, unknown: 0, n: list.length };
  for (const s of list) {
    const v = verdict(s, data, now);
    if (v.state === STATE.OK || v.state === STATE.RECOVERED) counts.ok++;
    else if (v.state === STATE.STALE || v.state === STATE.NODATA) counts.unknown++;
    else counts.bad++;
  }
  return counts;
}

// How long it has been failing, in the unit the page says it in.
export function duration(ms) {
  if (ms == null || ms < 0) return null;
  if (ms < 3600e3) return { n: Math.max(1, Math.round(ms / 60e3)), unit: "minute" };
  if (ms < 48 * 3600e3) return { n: Math.round(ms / 3600e3), unit: "hour" };
  return { n: Math.round(ms / 86400e3), unit: "day" };
}

// Errors as the probes write them, to a key every language has.
export function errKey(err) {
  const e = String(err || "").toLowerCase();
  if (!e) return "err_other";
  if (e.includes("timeout") || e.includes("deadline")) return "err_timeout";
  if (e.includes("reset")) return "err_reset";
  if (e.includes("http")) return "err_http";
  if (e.includes("eof")) return "err_eof";
  if (e.includes("dns") || e.includes("resolve")) return "err_dns";
  if (e.includes("tls") || e.includes("handshake") || e.includes("certificate")) return "err_tls";
  if (e.includes("cancel")) return "err_cancel";
  return "err_other";
}

export const stateClass = s => s === STATE.OK ? "ok" : s === STATE.RECOVERED || s === STATE.PARTIAL ? "warn"
  : s === STATE.UNREACHABLE || s === STATE.LONGFAIL ? "bad" : "unknown";
