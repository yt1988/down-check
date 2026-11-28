// One list of measurement cities, checked at every place it has to appear. PLACES in src/model.mjs is the list, the
// build draws one row per place (data-kind, in that order), and the browser gets each place's local name from
// assets/l.<lang>.<hash>.js — which only carries the keys RUNTIME lists. A place that misses any one of those three
// steps is a raw key on a live page ("nuremberg"), so every check here names the place it is looking for instead of
// counting rows: the count is right even when one city is missing and another is drawn twice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { LANGS } from "../src/config.mjs";
import { PLACES } from "../src/model.mjs";

const pub = new URL("../public/", import.meta.url);
const servicePage = dir => new URL((dir ? dir + "/" : "") + "ai/chatgpt/index.html", pub);

// The strings the page loads, read the way the browser reads them: the bundle sets window.L.
async function runtimeStrings(html, where) {
  const m = /<script src="\/(assets\/l\.[^"]+\.js)"/.exec(html);
  assert.ok(m, where + " loads its runtime strings");
  const ctx = { window: {} };
  vm.runInNewContext(await readFile(new URL(m[1], pub), "utf8"), ctx);
  return ctx.window.L;
}

// A place row is <div class="dn-loc" data-kind="…"><span class="ic"></span><b>flag + name</b>…
const ROW = /<div class="dn-loc" data-kind="([^"]+)"><span class="ic"><\/span><b>(?:<img [^>]*>)?([^<]*)<\/b>/g;

test("every language draws the four places in one fixed order, each with its own name", async () => {
  for (const [lang, dir] of LANGS) {
    const html = await readFile(servicePage(dir), "utf8");
    const rows = [...html.matchAll(ROW)].map(m => ({ kind: m[1], name: m[2].trim() }));
    assert.deepEqual(rows.map(r => r.kind), PLACES, lang + " place rows, in order");
    for (const p of PLACES) {
      const row = rows.find(r => r.kind === p);
      assert.ok(row && row.name, `${lang}: the ${p} row has no name`);
    }
    assert.equal(new Set(rows.map(r => r.name)).size, PLACES.length, lang + " gives two places the same name");
  }
});

test("every place's name reaches the browser in all ten languages", async () => {
  for (const [lang, dir] of LANGS) {
    const html = await readFile(servicePage(dir), "utf8");
    const L = await runtimeStrings(html, lang);
    for (const p of PLACES) {
      assert.ok(L["loc_" + p] && L["loc_" + p].trim(), `${lang}: loc_${p} is not shipped to the browser`);
    }
  }
});

test("the row a reader sees and the string the page loads agree, place by place", async () => {
  for (const [lang, dir] of LANGS) {
    const html = await readFile(servicePage(dir), "utf8");
    const rows = [...html.matchAll(ROW)].map(m => ({ kind: m[1], name: m[2].trim() }));
    const L = await runtimeStrings(html, lang);
    for (const { kind, name } of rows) assert.equal(L["loc_" + kind], name, `${lang}: the ${kind} row says "${name}"`);
  }
});
