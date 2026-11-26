import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trimProbe } from "../src/data.mjs";
import { SERVICES } from "../src/services.mjs";

const raw = {
  at: "2026-11-25T07:00:00Z", every: 600, from: "Tokyo, JP", complete: true,
  services: {
    chatgpt: { ok: true, unknown: false, ms: 42, http: 200, t: 1795590000, ok_at: 1795590000, up24: 100, up7: 99.9, h: "o".repeat(200), out: [] },
    mystery: { ok: true, ms: 1 },
  },
};

test("the probe trim keeps published services and their history, without the fields a page never shows", () => {
  const d = trimProbe(raw);
  assert.deepEqual(Object.keys(d.services), ["chatgpt"]);
  assert.equal(d.services.chatgpt.ms, 42);
  // the history stays whole: the page merges it and draws 24 h from the same series
  assert.equal(d.services.chatgpt.h, "o".repeat(200));
  assert.equal("h24" in d.services.chatgpt, false);
  assert.equal(d.every, 600);
  assert.equal(d.complete, true);
});

test("a history longer than a week is cut to the newest 1008 samples", () => {
  const long = { ...raw, services: { chatgpt: { ...raw.services.chatgpt, h: "o".repeat(2000) } } };
  assert.equal(trimProbe(long).services.chatgpt.h.length, 1008);
});

test("a document without services is null", () => {
  assert.equal(trimProbe(null), null);
  assert.equal(trimProbe({}), null);
});

test("probe/services.json matches the registry, one target per service", async () => {
  const list = JSON.parse(await readFile(new URL("../probe/services.json", import.meta.url), "utf8"));
  assert.equal(list.length, SERVICES.length);
  for (const s of SERVICES) {
    const hit = list.find(x => x.id === s.id);
    assert.ok(hit, s.id);
    assert.equal(hit.url, s.probe, s.id);
  }
});
