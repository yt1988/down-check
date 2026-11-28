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

// The other direction: a place in PLACES without its loc_* in RUNTIME ships a raw key ("nuremberg") to the browser,
// because assets/l.*.js only carries what RUNTIME lists. Nuremberg shipped that way once. `loc_h` is the heading the
// build writes into the page, so it is the one loc_* the browser never asks for.
test("every place and loc_* string the page looks up is in RUNTIME", async () => {
  const I = await load();
  const { RUNTIME } = await import("../src/runtime-keys.mjs");
  const { PLACES } = await import("../src/model.mjs");
  for (const p of PLACES) assert.ok(RUNTIME.has("loc_" + p), `loc_${p} missing from RUNTIME`);
  const missing = Object.keys(I.en).filter(k => k.startsWith("loc_") && k !== "loc_h" && !RUNTIME.has(k));
  assert.deepEqual(missing, [], "loc_* strings the browser asks for but the build does not ship");
  for (const k of RUNTIME) assert.ok(k in I.en, `RUNTIME key missing from en: ${k}`);
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

test("every service whose brand is not Latin has a name in all ten languages", async () => {
  const { SERVICES } = await import("../src/services.mjs");
  const { LANGS } = await import("../src/config.mjs");
  for (const s of SERVICES) {
    if (!s.names) continue;
    for (const [lang] of LANGS) assert.ok(s.names[lang], `${s.id} ${lang}`);
    for (const v of Object.values(s.names)) assert.ok(v.trim(), s.id);
  }
  for (const s of SERVICES) {
    if (/[^\x00-\x7F]/.test(s.name)) assert.ok(s.names, `${s.id} has a non-Latin name but no translations`);
  }
});
