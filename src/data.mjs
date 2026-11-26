// What the Worker keeps from a probe file: only the services this site publishes, and only the fields a page shows.
// Both the Worker and the local dev server use this, so they answer the same shape.
//
// The history is kept whole (7 days, 1008 buckets): the page needs it to draw the merged bar and to compute a 7-day
// figure from the same timeline. `h` is the raw string, trimmed to the newest 1008 samples.
import { SERVICES } from "./services.mjs";
import { mergeService, charsOf, outagesOf, WEEK_SLOTS, DAY_SLOTS } from "./series.mjs";

const IDS = new Set(SERVICES.map(s => s.id));

export function trimProbe(raw) {
  if (!raw || !raw.services) return null;
  const services = {};
  for (const id of IDS) {
    const s = raw.services[id];
    if (!s) continue;
    services[id] = {
      ok: !!s.ok,
      unknown: !!s.unknown,
      ms: typeof s.ms === "number" ? s.ms : null,
      http: s.http || null,
      err: s.err || null,
      t: s.t || null,
      ok_at: s.ok_at || null,
      up24: s.up24 ?? null,
      up7: s.up7 ?? null,
      h: typeof s.h === "string" ? s.h.slice(-WEEK_SLOTS) : null,
      out: Array.isArray(s.out) ? s.out.slice(0, 10) : [],
    };
  }
  return { at: raw.at, every: raw.every || 600, from: raw.from || "", complete: raw.complete !== false, services };
}

// What one browser gets: each place's current sample and its own last 24 h (the bar's tooltip shows them side by side),
// plus the merged timeline and the figures computed from it. The 7-day history stays in the Worker.
export function pagePayload(docs, merged, generated = new Date().toISOString()) {
  const body = { v: 5, generated, merged: merged.services };
  for (const [p, d] of Object.entries(docs)) {
    body[p] = d ? { at: d.at, every: d.every, from: d.from, services: {} } : null;
    if (!d) continue;
    for (const [id, s] of Object.entries(d.services)) {
      const { h, ...rest } = s;
      body[p].services[id] = { ...rest, h24: h ? h.slice(-DAY_SLOTS) : null };
    }
  }
  return body;
}

// The merged view: for every published service, one timeline built from all places, and the figures that come from it.
// A place with no data for a service contributes nothing; two of three is still a verdict.
export function merge(docs) {
  const places = Object.keys(docs);
  const ids = new Set();
  for (const d of Object.values(docs)) for (const id of Object.keys(d?.services || {})) if (IDS.has(id)) ids.add(id);
  const services = {};
  for (const id of ids) {
    const rows = places.map(p => docs[p]?.services?.[id] ? { t: docs[p].services[id].t, h: docs[p].services[id].h } : null);
    const m = mergeService(rows, { slots: WEEK_SLOTS });
    if (!m) continue;
    let t = null;
    for (const d of Object.values(docs)) { const x = d?.services?.[id]?.t; if (x && (!t || x > t)) t = x; }
    services[id] = {
      up24: m.up24, up7: m.up7,
      h24: charsOf(m, DAY_SLOTS),
      downs24: m.slots.slice(-DAY_SLOTS).filter(s => s.c === "x").length,
      out: outagesOf(m, WEEK_SLOTS),
      since: m.since,
      at: m.at * 1000,
      t,
    };
  }
  return { places, services };
}
