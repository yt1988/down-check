import test from "node:test";
import assert from "node:assert/strict";
import { trimIndex, trimUnlock } from "../src/data.mjs";
import { BASE_IDS, UNLOCK_IDS } from "../src/services.mjs";

const rawIndex = {
  v: 1, at: "2026-11-25T05:00:00Z", every: 3600, from: "Tokyo, JP",
  services: {
    chatgpt: { name: "ChatGPT", cat: "ai", last: { ms: 6.7, err: undefined, pop: "NRT" }, h24: [1, null, 3], up24: 100, up7: 99.4, out: [{ from: 1, to: 2, runs: 2, err: "timeout" }] },
    mystery: { name: "Not published", cat: "x", last: { ms: 1 } },
  },
};

test("the index trim keeps only published services and only the fields a page uses", () => {
  const d = trimIndex(rawIndex);
  assert.deepEqual(Object.keys(d.services), ["chatgpt"]);
  assert.equal(d.services.chatgpt.ms, 6.7);
  assert.equal(d.services.chatgpt.err, null);
  assert.equal(d.services.chatgpt.pop, "NRT");
  assert.equal(d.services.chatgpt.up24, 100);
  assert.deepEqual(d.services.chatgpt.out, rawIndex.services.chatgpt.out);
  assert.equal(d.at, rawIndex.at);
  assert.ok(BASE_IDS.includes("chatgpt"));
});

test("an index document without services is null", () => {
  assert.equal(trimIndex(null), null);
  assert.equal(trimIndex({}), null);
});

test("the unlock trim keeps the history and the last good time", () => {
  const raw = { at: "2026-11-25T05:13:00Z", every: 3600, from: "JP", services: {
    chatgpt: { s: "ok", err: null, streak: 10, since: "2026-11-01T00:00:00Z", ok_at: "2026-11-25T05:13:00Z", ms: 333, h: "ooo", extra: "drop me" },
    mystery: { s: "ok" },
  } };
  const d = trimUnlock(raw);
  assert.deepEqual(Object.keys(d.services), ["chatgpt"]);
  assert.equal(d.services.chatgpt.ok_at, "2026-11-25T05:13:00Z");
  assert.equal(d.services.chatgpt.h, "ooo");
  assert.equal("extra" in d.services.chatgpt, false);
  assert.ok(UNLOCK_IDS.includes("chatgpt"));
});
