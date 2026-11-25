import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { LANGS, SITE } from "../src/config.mjs";
import { CATS, SERVICES } from "../src/services.mjs";

const pub = new URL("../public/", import.meta.url);
const urlOf = rel => SITE + "/" + rel.replace(/index\.html$/, "");

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) await walk(u, out);
    else if (e.name === "index.html") out.push(u.href.slice(pub.href.length));
  }
  return out;
}

const pages = await walk(pub);

test("every language has the board, every group and every service, and the sitemap lists exactly the pages", async () => {
  const sitemap = await readFile(new URL("sitemap.xml", pub), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const expected = LANGS.length * (1 + CATS.length + SERVICES.length);
  assert.equal(pages.length, expected);
  assert.equal(locs.length, expected);
  for (const p of pages) assert.ok(locs.includes(urlOf(p)), p);
});

test("each page has one h1 and one main, its own canonical, and every language", async () => {
  for (const p of pages) {
    const html = await readFile(new URL(p, pub), "utf8");
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, p + " h1");
    assert.equal((html.match(/<main[\s>]/g) || []).length, 1, p + " main");
    assert.ok(html.includes(`<link rel="canonical" href="${urlOf(p)}">`), p + " canonical");
    assert.ok(html.includes("<title>"), p + " title");
    assert.ok(/<meta name="description" content="[^"]+">/.test(html), p + " description");
    assert.equal((html.match(/hreflang=/g) || []).length, LANGS.length + 1, p + " hreflang");
    assert.ok(html.includes('hreflang="x-default"'), p + " x-default");
    assert.ok(!html.includes("{{"), p + " leftover placeholder");
  }
});

test("the data block parses and every script and style it names exists", async () => {
  for (const p of pages) {
    const html = await readFile(new URL(p, pub), "utf8");
    const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(m, p + " data");
    const data = JSON.parse(m[1]);
    assert.ok(data.lang && data.type && data.paths[data.lang], p + " data fields");
    const css = /<link rel="stylesheet" href="\/(assets\/[^"]+)">/.exec(html);
    assert.ok(css, p + " css");
    await stat(new URL(css[1], pub));
    for (const src of [...html.matchAll(/<script src="\/(assets\/[^"]+)"><\/script>/g)].map(x => x[1])) await stat(new URL(src, pub));
  }
});

test("the board names every group and every service, and its h1 asks about all of them", async () => {
  const html = await readFile(new URL("index.html", pub), "utf8");
  for (const c of CATS) assert.ok(html.includes(`href="/${c.id}/"`), c.id);
  for (const s of SERVICES) assert.ok(html.includes(`href="/${s.cat}/${s.id}/"`), s.id);
  assert.ok(html.includes("Which services are down right now?"));
  assert.ok(html.includes('id="q"'));
});

test("a category page lists its services with a current-state pill and a 24-hour strip", async () => {
  const cat = CATS.find(c => c.id === "ai");
  const list = SERVICES.filter(s => s.cat === "ai");
  const html = await readFile(new URL("ai/index.html", pub), "utf8");
  for (const s of list) assert.ok(html.includes(`href="/ai/${s.id}/"`), s.id);
  assert.equal((html.match(/class="dn-pill"/g) || []).length, list.length);
  assert.ok(html.includes('class="dn-spark"'));
});

test("a service page has the state first, both places, the official page and the history strip", async () => {
  const s = SERVICES.find(x => x.id === "chatgpt");
  const html = await readFile(new URL("ai/chatgpt/index.html", pub), "utf8");
  assert.ok(html.includes(s.name));
  assert.ok(html.includes('id="statusPanel"'));
  assert.ok(html.includes('id="bar24"'));
  assert.ok(html.includes('data-kind="tokyo"'));
  assert.ok(html.includes('data-kind="shanghai"'));
  assert.ok(html.includes("https://status.openai.com/"));
  assert.ok(html.includes('id="outs"'));
});

test("a service without an official status page says so instead of linking nothing", async () => {
  const html = await readFile(new URL("video/netflix/index.html", pub), "utf8");
  assert.ok(html.includes("does not publish a status page"));
});

test("the upstream data address never reaches a visitor's page", async () => {
  for (const p of pages) {
    const html = await readFile(new URL(p, pub), "utf8");
    assert.ok(!html.includes("/down/latest.json"), p);
    assert.ok(!html.includes("PROBE_TOKYO_URL"), p);
  }
});
