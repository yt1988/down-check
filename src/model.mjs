// The verdict, as pure functions: the build and the tests use this file, and scripts/build.mjs inlines it into the
// browser bundle. Nothing here knows about the DOM or about 1ms.dog.
//
// Three facts, never one: what our probe in Tokyo saw, what our probe in Shanghai saw, and what the service's own
// official status page says. A probe that cannot reach a service proves "we cannot reach it from here"; a 403, 429 or
// a challenge page proves nothing either way (`unknown`). Only the official status page may say "outage" — and most
// services do not publish a machine-readable one, so for them the worst state is "not answering from both places".
// Missing or stale data is `stale`/`nodata`, never "down".

export const STATE = {
  OK: "ok",                 // our probes answer just now (or the official page says all systems operational)
  RECOVERED: "recovered",   // answering now, but a failure in the last 24 hours
  PARTIAL: "partial",       // one place answers and another does not, or the official page reports a minor issue
  UNCONFIRMED: "unconfirmed", // every answer was a 403/429/challenge: we cannot say either way
  UNREACHABLE: "unreachable", // no place answers now, for less than a day
  LONGFAIL: "longfail",     // no place has answered for more than a day: more likely our check than the service
  FAULT: "fault",           // the service's own official status page reports a major or critical outage
  STALE: "stale",           // every source is older than STALE_MS
  NODATA: "nodata",         // no source has this service at all
};

// Ten-minute probes; two missed rounds is "cannot judge".
export const EXPECTED_EVERY = 600;
export const STALE_MS = 20 * 60 * 1000;
const DAY = 24 * 3600 * 1000;

const pct = (ok, n) => (n ? (ok * 100) / n : null);

// One probe's view of one service. `doc` is one machine's latest.json; the time is the service's own `t`, because a
// round takes about a minute and a service measured first in it is a minute older than one measured last.
export function probeView(doc, id, now, place = "") {
  const none = { kind: "probe", place, present: false, fresh: false, ok: false, unknown: false, at: null, ageMs: null };
  if (!doc || !doc.services) return none;
  const s = doc.services[id];
  if (!s) return none;
  const at = (s.t ? s.t * 1000 : Date.parse(doc.at)) || null;
  const ageMs = at ? Math.max(0, now - at) : null;
  const fresh = ageMs != null && ageMs <= STALE_MS;
  const v = { kind: "probe", place, from: doc.from || "", present: true, fresh, at, ageMs, ok: !!s.ok, unknown: !!s.unknown,
    ms: typeof s.ms === "number" ? s.ms : null, http: s.http || null, err: s.err || null,
    up24: s.up24 ?? null, up7: s.up7 ?? null, since: null, okAt: s.ok_at ? s.ok_at * 1000 : null,
    recent: false, out: Array.isArray(s.out) ? s.out : [], h: s.h || "", h24: s.h24 || null, every: doc.every || EXPECTED_EVERY };
  if (!v.ok && !v.unknown) {
    const o = v.out[0];
    if (o && o.from) v.since = o.from * 1000;
  } else if (v.ok) {
    v.recent = v.out.some(o => o.to * 1000 >= now - DAY) || (v.up24 != null && v.up24 < 99.5);
  }
  return v;
}

// The official status page's view. `indicator` is Statuspage's: none / minor / major / critical / maintenance.
export function officialView(doc, id, now) {
  const none = { kind: "official", present: false, fresh: false, level: null, at: null, ageMs: null };
  if (!doc || !doc.services) return none;
  const s = doc.services[id];
  if (!s) return none;
  const at = s.at ? s.at * 1000 : null;
  const ageMs = at ? Math.max(0, now - at) : null;
  const fresh = ageMs != null && ageMs <= STALE_MS;
  const level = s.indicator || "unknown";
  return { kind: "official", present: true, fresh, at, ageMs, level, description: s.description || "",
    updatedAt: s.updated_at || null, page: s.page || null,
    ok: level === "none", degraded: level === "minor" || level === "maintenance", bad: level === "major" || level === "critical" };
}

// The verdict for one service, from every source that knows it.
export function verdict(service, data, now = Date.now()) {
  const tokyo = probeView(data && data.tokyo, service.id, now, "tokyo");
  const shanghai = probeView(data && data.shanghai, service.id, now, "shanghai");
  const official = officialView(data && data.official, service.id, now);
  const views = [tokyo, shanghai, official];
  const present = views.filter(v => v.present);
  const probes = [tokyo, shanghai].filter(v => v.present && v.fresh);
  const offFresh = official.present && official.fresh;
  const at = present.length ? Math.max(...present.map(v => v.at || 0)) : null;
  const ageMs = at ? Math.max(0, now - at) : null;
  const up24 = pickUp(probes, "up24"), up7 = pickUp(probes, "up7");
  const base = { views, at, ageMs, since: null, up24, up7, places: probes.map(v => v.place).filter(Boolean), official };

  if (!probes.length && !offFresh) return { ...base, state: present.length ? STATE.STALE : STATE.NODATA };

  // The service's own word comes first: only it can say "outage".
  if (offFresh && official.bad) return { ...base, state: STATE.FAULT };
  if (offFresh && official.degraded) return { ...base, state: STATE.PARTIAL };

  if (probes.length) {
    const ok = probes.filter(v => v.ok);
    const fail = probes.filter(v => !v.ok && !v.unknown);
    const unknown = probes.filter(v => v.unknown);
    if (fail.length) {
      if (ok.length) return { ...base, state: STATE.PARTIAL };
      // the official page says it is fine, but neither of our places can reach it: still not an outage claim
      if (offFresh && official.ok) return { ...base, state: STATE.PARTIAL };
      const since = Math.max(...fail.map(v => v.since || 0)) || null;
      return { ...base, state: since && now - since >= DAY ? STATE.LONGFAIL : STATE.UNREACHABLE, since };
    }
    if (ok.length) return { ...base, state: probes.some(v => v.recent) ? STATE.RECOVERED : STATE.OK };
    if (unknown.length) return { ...base, state: STATE.UNCONFIRMED };
  }

  if (offFresh && official.ok) return { ...base, state: STATE.OK };
  return { ...base, state: STATE.STALE };
}

// Prefer Tokyo's numbers; Shanghai is the fallback when Tokyo has none.
function pickUp(views, key) {
  const withNumber = views.filter(v => v[key] != null);
  return withNumber.length ? withNumber[0][key] : null;
}

export function summary(list, data, now = Date.now()) {
  const counts = { ok: 0, bad: 0, unknown: 0, n: list.length };
  for (const s of list) {
    const v = verdict(s, data, now);
    if (v.state === STATE.OK || v.state === STATE.RECOVERED) counts.ok++;
    else if (v.state === STATE.STALE || v.state === STATE.NODATA || v.state === STATE.UNCONFIRMED) counts.unknown++;
    else counts.bad++;
  }
  return counts;
}

export function duration(ms) {
  if (ms == null || ms < 0) return null;
  if (ms < 3600e3) return { n: Math.max(1, Math.round(ms / 60e3)), unit: "minute" };
  if (ms < 48 * 3600e3) return { n: Math.round(ms / 3600e3), unit: "hour" };
  return { n: Math.round(ms / 86400e3), unit: "day" };
}

export function errKey(err) {
  const e = String(err || "").toLowerCase();
  if (!e) return "err_other";
  if (e.includes("challenge") || e.includes("403") || e.includes("429")) return "err_challenge";
  if (e.includes("timeout") || e.includes("deadline")) return "err_timeout";
  if (e.includes("reset")) return "err_reset";
  if (e.includes("http")) return "err_http";
  if (e.includes("eof")) return "err_eof";
  if (e.includes("dns") || e.includes("resolve") || e.includes("no such host")) return "err_dns";
  if (e.includes("tls") || e.includes("handshake") || e.includes("certificate")) return "err_tls";
  if (e.includes("refused")) return "err_refused";
  if (e.includes("unreachable") || e.includes("no route")) return "err_unreachable";
  if (e.includes("cancel")) return "err_cancel";
  return "err_other";
}

export const stateClass = s => s === STATE.OK ? "ok"
  : s === STATE.RECOVERED || s === STATE.PARTIAL ? "warn"
  : s === STATE.UNREACHABLE || s === STATE.LONGFAIL || s === STATE.FAULT ? "bad" : "unknown";
