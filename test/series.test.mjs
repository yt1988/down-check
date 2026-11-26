import test from "node:test";
import assert from "node:assert/strict";
import { mergeChar, bucketsOf, mergeService, outagesOf, charsOf, SLOT, DAY_SLOTS, WEEK_SLOTS } from "../src/series.mjs";

const T = 1795670400;                       // a round boundary, so buckets are easy to reason about
const doc = (chars, t = T) => ({ t, h: chars });

test("the merged shape: any answer wins; a refusal only matters when nobody answered", () => {
  assert.equal(mergeChar(["o", "x", "x"]), "o");     // one place answered
  assert.equal(mergeChar(["u", "x", "x"]), "u");     // nobody answered, but one refused: cannot call it down
  assert.equal(mergeChar(["u", "o", "x"]), "o");     // an answer beats a refusal
  assert.equal(mergeChar(["x", "x", "x"]), "x");     // nobody answered and nobody refused
  assert.equal(mergeChar(["-", "-", "-"]), "-");     // no place measured it
  assert.equal(mergeChar(["o", "-", "-"]), "o");
});

test("a sample lands in the ten-minute bucket it was measured in, whatever second of the round it was", () => {
  const a = bucketsOf(T + 3, "o");
  const b = bucketsOf(T + 44, "o");                  // the same round, another service later in it
  assert.deepEqual([...a.keys()], [...b.keys()]);
  assert.deepEqual([...a.keys()], [Math.floor(T / SLOT) * SLOT]);
});

test("the timeline is aligned by time, not by position in the string", () => {
  // Tokyo has six windows ending at T; Los Angeles joined later and has three, ending two rounds after T.
  const tokyo = doc("oooooo");
  const la = doc("oox", T + 2 * SLOT);
  const m = mergeService([la, tokyo, null]);
  // newest window: only Los Angeles measured, and it got no answer
  assert.equal(m.slots.at(-1).c, "x");
  assert.deepEqual(m.slots.at(-1).places, ["x", "-", "-"]);
  // the window before: Los Angeles answered, Tokyo did not reach it
  assert.equal(m.slots.at(-2).c, "o");
  assert.deepEqual(m.slots.at(-2).places, ["o", "-", "-"]);
  // the window before that: both measured, both answered
  assert.equal(m.slots.at(-3).c, "o");
  assert.deepEqual(m.slots.at(-3).places, ["o", "o", "-"]);
  // older than Los Angeles' history: Tokyo's own answers still count
  assert.equal(m.slots.at(-4).c, "o");
});

test("uptime counts answers against no-answers, never against refusals or gaps", () => {
  const one = doc("o".repeat(6) + "x".repeat(2) + "u".repeat(2));
  const m = mergeService([one, null, null]);
  assert.equal(m.up7, 75);                            // 6 of 8 known
  assert.equal(charsOf(m, 10), "oooooo" + "xx" + "uu");
});

test("a refusal or a gap ends a run: neither is a failure", () => {
  // o o u x x o: the u between the answers breaks nothing, and the two x are one run
  const m = mergeService([doc("oouxxo")], { slots: 6 });
  assert.equal(charsOf(m, 6), "oouxxo");
  assert.equal(outagesOf(m, 6).length, 1);
  // a gap (nobody measured) is not a failure either
  const g = mergeService([doc("oo--oo")], { slots: 6 });
  assert.equal(outagesOf(g, 6).length, 0);
  assert.equal(g.up7, 100);                            // 4 answered, nothing known to be down
});

test("a run where nobody answered is one interruption, with its span and its length", () => {
  const m = mergeService([doc("oo" + "xx" + "oo")], { slots: 6 });
  const out = outagesOf(m, 6);
  assert.equal(out.length, 1);
  assert.equal(out[0].runs, 2);
  assert.equal(out[0].to - out[0].from, SLOT);
});

test("'since' is the start of the run that is still going, and null once something answered", () => {
  const live = mergeService([doc("oo" + "xx")], { slots: 4 });
  assert.equal(live.since, (T - SLOT) * 1000);
  const over = mergeService([doc("xx" + "oo")], { slots: 4 });
  assert.equal(over.since, null);
  assert.equal(over.up24, 50);
});

test("a week of history is kept (1008 buckets), and 24 h is its tail", () => {
  const long = doc("o".repeat(WEEK_SLOTS));
  const m = mergeService([long]);
  assert.equal(m.slots.length, WEEK_SLOTS);
  assert.equal(charsOf(m, DAY_SLOTS).length, DAY_SLOTS);
  assert.equal(m.up7, 100);
});
