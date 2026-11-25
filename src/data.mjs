// What the Worker keeps from each upstream file: only the services this site publishes, and only the fields a page
// shows. Both the Worker and the local dev server use this, so they answer the same shape.
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

// The official snapshot is already small: one entry per service that has a machine-readable feed.
export function trimOfficial(raw) {
  if (!raw || !raw.services) return null;
  const services = {};
  for (const [id, s] of Object.entries(raw.services)) {
    if (!IDS.has(id) || !s) continue;
    services[id] = { at: s.at || null, indicator: s.indicator || "unknown", description: s.description || "", updated_at: s.updated_at || null, page: s.page || null };
  }
  return { at: raw.at || null, every: raw.every || 600, services };
}

// Parse one Statuspage answer (summary.json or status.json) into the one entry the page needs.
export function officialEntry(body, page, at = Date.now()) {
  const st = body && body.status;
  if (!st || typeof st.indicator !== "string") return null;
  return { at, indicator: st.indicator, description: st.description || "", updated_at: (body.page && body.page.updated_at) || null, page };
}
