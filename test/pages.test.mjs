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

test("every language has the home, every group and every service, and the sitemap lists exactly the pages", async () => {
  const sitemap = await readFile(new URL("sitemap.xml", pub), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const expected = LANGS.length * (1 + CATS.length + SERVICES.length);
  assert.equal(pages.length, expected);
  assert.equal(locs.length, expected);
  for (const p of pages) assert.ok(locs.includes(urlOf(p)), p);
});

test("each page has one h1 and one main, a canonical for itself, and every language", async () => {
  for (const p of pages) {
    const html = await readFile(new URL(p, pub), "utf8");
    const rel = p;
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, rel + " h1");
    assert.equal((html.match(/<main[\s>]/g) || []).length, 1, rel + " main");
    assert.ok(html.includes(`<link rel="canonical" href="${urlOf(rel)}">`), rel + " canonical");
    assert.ok(html.includes("<title>"), rel + " title");
    assert.ok(/<meta name="description" content="[^"]+">/.test(html), rel + " description");
    assert.equal((html.match(/hreflang=/g) || []).length, LANGS.length + 1, rel + " hreflang");
    assert.ok(html.includes("hreflang=\"x-default\""), rel + " x-default");
    assert.ok(!html.includes("{{"), rel + " leftover placeholder");
  }
});

test("the data block parses and the page's scripts and styles exist", async () => {
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

test("the home lists every group and every service", async () => {
  const html = await readFile(new URL("index.html", pub), "utf8");
  for (const c of CATS) assert.ok(html.includes(`href="/${c.id}/"`), c.id);
  for (const s of SERVICES) assert.ok(html.includes(`href="/${s.cat}/${s.id}/"`), s.id);
});

test("a service page names the service, what we check and its official status page", async () => {
  const s = SERVICES.find(x => x.id === "chatgpt");
  const html = await readFile(new URL("ai/chatgpt/index.html", pub), "utf8");
  assert.ok(html.includes(s.name));
  assert.ok(html.includes(s.site));
  assert.ok(html.includes(s.status));
  assert.ok(html.includes('data-kind="base"'));
  assert.ok(html.includes("dn-outs"));
});

test("services without an official status page say so instead of linking nothing", async () => {
  const html = await readFile(new URL("video/netflix/index.html", pub), "utf8");
  assert.ok(html.includes("没有我们可以链接的官方状态页") || html.includes("does not publish an official status page"));
});

test("the upstream data address never reaches a visitor's page", async () => {
  for (const p of pages) assert.ok(!(await readFile(new URL(p, pub), "utf8")).includes("data.1ms.dog"), p);
});
