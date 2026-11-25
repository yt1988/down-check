// What the Worker keeps from each upstream file: only the services this site publishes, and only the fields a page
// shows. Both the Worker and the local dev server use this, so they answer the same shape.
import { BASE_IDS, UNLOCK_IDS } from "./services.mjs";

export function trimIndex(raw) {
  if (!raw || !raw.services) return null;
  const services = {};
  for (const id of BASE_IDS) {
    const s = raw.services[id];
    if (!s) continue;
    const last = s.last || {};
    services[id] = {
      ms: typeof last.ms === "number" ? last.ms : null,
      err: last.err || null,
      pop: last.pop || null,
      up24: s.up24 ?? null,
      up7: s.up7 ?? null,
      h24: Array.isArray(s.h24) ? s.h24 : null,
      out: Array.isArray(s.out) ? s.out.slice(0, 12) : [],
    };
  }
  return { at: raw.at, every: raw.every || 3600, from: raw.from || "", services };
}

export function trimUnlock(raw) {
  if (!raw || !raw.services) return null;
  const services = {};
  for (const id of UNLOCK_IDS) {
    const s = raw.services[id];
    if (!s) continue;
    services[id] = {
      s: s.s ?? null,
      err: s.err || null,
      streak: s.streak ?? null,
      since: s.since || null,
      ok_at: s.ok_at || null,
      ms: typeof s.ms === "number" ? s.ms : null,
      h: typeof s.h === "string" ? s.h : "",
    };
  }
  return { at: raw.at, every: raw.every || 3600, from: raw.from || "", services };
}
