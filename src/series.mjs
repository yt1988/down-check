// One timeline for all the places. The Worker merges with it, the page reads its rules for the bar's tooltip, and the
// tests use it directly — so the bar, the uptime numbers, the incident count and the verdict cannot disagree.
//
// Every place writes its history every ten minutes. A service's own `t` is when *it* was measured inside a round (a
// round is spread over 45 s), so two places never land on the same second. Everything is bucketed by floor(t / 600): the
// same ten-minute window from anywhere is the same bucket. Wall-clock time is never used to place a sample — a place
// that writes an hour late writes an hour late, and its samples stay where they were measured.

export const SLOT = 600;            // one bucket: a ten-minute round
export const DAY_SLOTS = 144;       // 24 h
export const WEEK_SLOTS = 1008;     // 7 days

// 'o' answered, 'u' refused or challenged, 'x' no answer, '-' not measured. Merged: any place answering wins; if none
// answered, a refusal anywhere means "unconfirmed" (we cannot call it down); only "no answer everywhere" is down.
export const mergeChar = cs => {
  let any = false, refused = false;
  for (const c of cs) {
    if (!c || c === "-") continue;
    if (c === "o") return "o";
    any = true;
    if (c === "u") refused = true;
  }
  return !any ? "-" : refused ? "u" : "x";
};

// one place's history → Map(bucketStartSeconds → char)
export function bucketsOf(t, chars) {
  const m = new Map();
  if (!t || !chars) return m;
  const anchor = Math.floor(t / SLOT) * SLOT;
  const s = String(chars);
  for (let k = 0; k < s.length; k++) m.set(anchor - (s.length - 1 - k) * SLOT, s[k]);
  return m;
}

// Uptime counts only what we know: answered ÷ (answered + no answer). A refusal is not a failure, and a bucket no place
// measured is not evidence either way.
const pct = (ok, down) => (ok + down ? Math.round((ok * 100) / (ok + down) * 10) / 10 : null);

// The merged timeline of one service.
// rows: [{ t, h }] — each place's own measurement time and history (a place without data is null).
// Returns { slots: [{ at, c, places }], up24, up7, since } newest last; `at` is the bucket start in seconds.
//   slots.slots are WEEK_SLOTS long (or fewer, when the probes are younger than a week).
//   c is the merged char; places is the per-place char, in the order the rows were given.
export function mergeService(rows, { slots = WEEK_SLOTS, now = null } = {}) {
  const given = rows.map((r, i) => ({ i, m: r ? bucketsOf(r.t, r.h) : new Map() }));
  const maps = given.filter(g => g.m.size);
  if (!maps.length) return null;
  let newest = -Infinity, oldest = Infinity;
  for (const g of maps) for (const b of g.m.keys()) { if (b > newest) newest = b; if (b < oldest) oldest = b; }
  const from = Math.max(oldest, newest - (slots - 1) * SLOT);
  const out = [];
  let ok24 = 0, down24 = 0, ok7 = 0, down7 = 0, since = null;
  const dayFrom = newest - (DAY_SLOTS - 1) * SLOT;
  for (let b = from; b <= newest; b += SLOT) {
    const places = given.map(g => g.m.get(b) || "-");
    const c = mergeChar(places);
    out.push({ at: b, c, places });
    if (c === "x") { down7++; if (b >= dayFrom) down24++; if (since == null) since = b; }
    else {
      since = null;        // answered, refused or not measured: the run of "nobody answered" is over
      if (c === "o") { ok7++; if (b >= dayFrom) ok24++; }
    }
  }
  return { at: newest, slots: out, up24: pct(ok24, down24), up7: pct(ok7, down7), since: since == null ? null : since * 1000 };
}

// The merged series as a plain string for the last `n` buckets, for the bar.
export const charsOf = (merged, n = DAY_SLOTS) => (merged ? merged.slots.slice(-n).map(s => s.c).join("") : "");

// The runs of "no place answered" in a merged series, newest first.
export function outagesOf(merged, n = DAY_SLOTS) {
  const runs = [];
  let cur = null;
  for (const s of (merged ? merged.slots.slice(-n) : [])) {
    if (s.c === "x") {
      if (!cur) cur = { from: s.at, to: s.at, runs: 1 };
      else { cur.to = s.at; cur.runs++; }
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.reverse().slice(0, 10);
}
