import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trimProbe, trimOfficial, officialEntry } from "../src/data.mjs";
import { SERVICES } from "../src/services.mjs";

const raw = {
  at: "2026-11-25T07:00:00Z", every: 600, from: "Tokyo, JP", complete: true,
  services: {
    chatgpt: { ok: true, unknown: false, ms: 42, http: 200, t: 1795590000, ok_at: 1795590000, up24: 100, up7: 99.9, h: "o".repeat(200), out: [] },
    mystery: { ok: true, ms: 1 },
  },
};

test("the probe trim keeps published services, the last 144 samples and no full history", () => {
  const d = trimProbe(raw);
  assert.deepEqual(Object.keys(d.services), ["chatgpt"]);
  assert.equal(d.services.chatgpt.ms, 42);
  assert.equal(d.services.chatgpt.h24, "o".repeat(144));
  assert.equal("h" in d.services.chatgpt, false);
  assert.equal(d.every, 600);
  assert.equal(d.complete, true);
});

test("a document without services is null", () => {
  assert.equal(trimProbe(null), null);
  assert.equal(trimProbe({}), null);
});

test("the official trim keeps only published services and the five fields the page needs", () => {
  const d = trimOfficial({ at: "2026-11-25T07:00:00Z", every: 600, services: {
    chatgpt: { at: 1795590000, indicator: "minor", description: "Degraded", updated_at: "x", page: "https://status.openai.com/", extra: 1 },
    mystery: { at: 1, indicator: "none" },
  } });
  assert.deepEqual(Object.keys(d.services), ["chatgpt"]);
  assert.equal(d.services.chatgpt.indicator, "minor");
  assert.equal("extra" in d.services.chatgpt, false);
});

test("a Statuspage answer becomes one entry, and a non-Statuspage answer is null", () => {
  const e = officialEntry({ page: { updated_at: "2026-11-25T06:00:00Z" }, status: { indicator: "major", description: "Outage" } }, "https://status.example/", 123);
  assert.deepEqual(e, { at: 123, indicator: "major", description: "Outage", updated_at: "2026-11-25T06:00:00Z", page: "https://status.example/" });
  assert.equal(officialEntry({ status: "ok" }, "x", 1), null);
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
