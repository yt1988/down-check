import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

const dir = new URL("../src/i18n/", import.meta.url);

async function load() {
  const out = {};
  for (const f of (await readdir(dir)).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL(f, dir).href)).default;
  return out;
}

test("every language has every key, and no empty string", async () => {
  const I = await load();
  const langs = Object.keys(I);
  assert.deepEqual(langs.sort(), ["de", "en", "es", "fr", "ja", "ko", "pt", "ru", "zh-CN", "zh-TW"]);
  const keys = Object.keys(I.en).sort();
  for (const l of langs) {
    assert.deepEqual(Object.keys(I[l]).sort(), keys, l + " keys");
    for (const k of keys) {
      assert.equal(typeof I[l][k], "string", `${l}.${k}`);
      assert.ok(I[l][k].trim().length > 0, `${l}.${k} is empty`);
    }
  }
});

test("the same placeholders in every language", async () => {
  const I = await load();
  for (const k of Object.keys(I.en)) {
    const want = [...I.en[k].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
    for (const l of Object.keys(I)) {
      const got = [...I[l][k].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
      assert.equal(got, want, `${l}.${k}`);
    }
  }
});

test("the ten languages have their own names", async () => {
  const I = await load();
  const names = new Set(Object.values(I).map(x => x.name));
  assert.equal(names.size, 10);
});
