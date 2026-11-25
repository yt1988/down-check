// What the Worker keeps from a probe file: only the services this site publishes, and only the fields a page shows.
// Both the Worker and the local dev server use this, so they answer the same shape.
import { SERVICES } from "./services.mjs";

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
      h24: typeof s.h === "string" ? s.h.slice(-144) : null,
      out: Array.isArray(s.out) ? s.out.slice(0, 10) : [],
    };
  }
  return { at: raw.at, every: raw.every || 600, from: raw.from || "", complete: raw.complete !== false, services };
}
