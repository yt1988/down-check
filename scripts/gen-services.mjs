#!/usr/bin/env node
// Builds src/services.mjs and probe/services.json from the two lists this site measures, vendored in data/:
//   data/baseline.json  yt1988/1ms.dog src/services.mjs (MIT): 82 services, each with the small URL the hourly Tokyo
//                       baseline requests, and the local packs (cn, tw, jp, kr, ru, in, sea, eu, latam, na, me).
//   data/unlock.json    yt1988/unlock-check src/services.mjs (MIT): 154 streaming/AI services, with `site` and the one
//                       country a regional service serves (`only`).
//
// One page per brand: exact-id duplicates are merged (the baseline's URL wins), Disney+ appears once, ESPN and ESPN+
// share one page. Two unlock ids become their own product pages because they are a different service from the
// baseline id with the same name: bbc -> bbc-iplayer, coupang -> coupang-play.
//
// Groups: the seven global ones, then the regions. A service with a single country goes to its region; the rest stay in
// their global group. `hk`, `oceania` and `uk` exist only for unlock services.
// Run after editing data/: node scripts/gen-services.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const data = new URL("../data/", import.meta.url);
const baseline = JSON.parse(readFileSync(new URL("baseline.json", data), "utf8"));
const unlock = JSON.parse(readFileSync(new URL("unlock.json", data), "utf8"));

const GLOBAL = ["ai", "video", "social", "dev", "game", "web", "cdn"];
// `cis`, not `ru`: /ru/ is the Russian language folder
const REGIONS = ["cn", "tw", "hk", "jp", "kr", "sea", "in", "oceania", "uk", "eu", "na", "latam", "me", "cis"];

const PACK_REGION = { cn: "cn", tw: "tw", jp: "jp", kr: "kr", ru: "cis", in: "in", sea: "sea", eu: "eu", na: "na", latam: "latam", me: "me" };
const ONLY_REGION = {
  CN: "cn", TW: "tw", HK: "hk", JP: "jp", KR: "kr", RU: "cis",
  SG: "sea", MY: "sea", TH: "sea", ID: "sea", PH: "sea", VN: "sea",
  AU: "oceania", NZ: "oceania",
  GB: "uk",
  DE: "eu", FR: "eu", CH: "eu", IT: "eu", ES: "eu", NL: "eu",
  US: "na", CA: "na",
};
// Brands the vendored lists carry in Latin only, and the Chinese-script names Japanese also reads. Merged into the
// baseline's own `names`; a key here wins.
const EXTRA_NAMES = {
  bahamut: { en: "Bahamut Anime Crazy", "zh-CN": "巴哈姆特动画疯", "zh-TW": "巴哈姆特動畫瘋", ja: "バハムートアニメ", ko: "바하무트 애니", es: "Bahamut Anime Crazy", fr: "Bahamut Anime Crazy", de: "Bahamut Anime Crazy", pt: "Bahamut Anime Crazy", ru: "Bahamut Anime Crazy" },
  // the Chinese brands keep their Chinese name in Japanese: 百度, 微信, 抖音 are what Japanese pages write
  baidu: { ja: "百度" }, wechat: { ja: "微信" }, douyin: { ja: "抖音" }, bilibili: { ja: "ビリビリ" },
};
const namesFor = (id, own) => (own || EXTRA_NAMES[id]) ? { ...(own || {}), ...(EXTRA_NAMES[id] || {}) } : null;

// brands whose own script is not Latin need a name per language, like the baseline's Entries for 百度 and 微信
const NAMES = {
  tencent: { en: "Tencent Video", "zh-CN": "腾讯视频", "zh-TW": "騰訊視頻", ja: "Tencent Video", ko: "텐센트 비디오", es: "Tencent Video", fr: "Tencent Video", de: "Tencent Video", pt: "Tencent Video", ru: "Tencent Video" },
  iqiyi: { en: "iQIYI", "zh-CN": "爱奇艺", "zh-TW": "愛奇藝", ja: "iQIYI", ko: "아이치이", es: "iQIYI", fr: "iQIYI", de: "iQIYI", pt: "iQIYI", ru: "iQIYI" },
  mgtv: { en: "Mango TV", "zh-CN": "芒果TV", "zh-TW": "芒果TV", ja: "Mango TV", ko: "망고 TV", es: "Mango TV", fr: "Mango TV", de: "Mango TV", pt: "Mango TV", ru: "Mango TV" },
  youku: { en: "Youku", "zh-CN": "优酷", "zh-TW": "優酷", ja: "Youku", ko: "유쿠", es: "Youku", fr: "Youku", de: "Youku", pt: "Youku", ru: "Youku" },
  netease: { en: "NetEase Cloud Music", "zh-CN": "网易云音乐", "zh-TW": "網易雲音樂", ja: "NetEase Cloud Music", ko: "넷이즈 클라우드 뮤직", es: "NetEase Cloud Music", fr: "NetEase Cloud Music", de: "NetEase Cloud Music", pt: "NetEase Cloud Music", ru: "NetEase Cloud Music" },
  bilibilitv: { en: "Bilibili TV", "zh-CN": "哔哩哔哩 TV", "zh-TW": "嗶哩嗶哩 TV", ja: "ビリビリ TV", ko: "빌리빌리 TV", es: "Bilibili TV", fr: "Bilibili TV", de: "Bilibili TV", pt: "Bilibili TV", ru: "Bilibili TV" },
};

// A few sites are too heavy or answer on another host for their front page; probe the favicon instead.
const PROBE = {
  directv: "https://www.directv.com/favicon.ico",
  nhk: "https://www3.nhk.or.jp/favicon.ico",
};

// brand spellings the source list names by their product instead
const DISPLAY = { mistral: "Mistral" };

// Other names people type for a service: the old brand, the company behind it, the thing it is known as. Search only;
// they are not shown. Keep them lowercase, and only where they really mean this page.
const ALIAS = {
  x: ["twitter"], chatgpt: ["openai", "chat gpt"], metaai: ["meta", "facebook ai"],
  grok: ["xai", "x ai"], copilot: ["bing copilot", "microsoft copilot"], perplexity: ["pplx"],
  gemini: ["bard", "google ai"], claude: ["anthropic"],
  facebook: ["fb"], instagram: ["ig", "insta"], youtube: ["yt"], whatsapp: ["wa"],
  disneyplus: ["disney plus", "disney+"], max: ["hbo", "hbo max"], paramount: ["paramount+"],
  youku: ["youku tudou"], mgtv: ["mango tv"], tencent: ["tencent"], netease: ["netease"],
  bilibili: ["b站"], douyin: ["tiktok china"], wechat: ["weixin"],
  naver: ["네이버"], kakao: ["카카오톡", "kakaotalk"], line: ["line app"],
  yandex: ["яндекс"], vk: ["vkontakte"],
  playstation: ["psn", "ps5", "ps4"], xbox: ["xbox live"], nintendo: ["switch online"],
};

// The probe asks one small URL per service. When that URL refuses or times out, it tries these in order, so a blocked
// favicon or a challenge page on the front page is not reported as a service problem. The default fallbacks are the
// same host's robots.txt and front page; a few services need a host that does not challenge datacenter addresses.
const ALT = {
  mistral: ["https://api.mistral.ai/v1/models"],
  bahamut: ["https://ani.gamer.com.tw/robots.txt"],
  telegram: ["https://telegram.org/", "https://web.telegram.org/"],
};
const altsFor = (id, site, probe) => {
  if (ALT[id]) return ALT[id].filter(u => u !== probe);
  let origin;
  try { origin = new URL(site).origin; } catch { return []; }
  return [...new Set([origin + "/robots.txt", origin + "/"])].filter(u => u !== probe);
};

// the five regional services without `only`
const NO_ONLY = { tvb: "hk", bahamut: "tw", skygo: "uk", joyn: "eu", skyde: "eu" };
// unlock ids that become a different page from the baseline id they collide with
const RENAME = { bbc: "bbc-iplayer", coupang: "coupang-play" };
// unlock ids that are the same brand as a baseline page and add nothing new
const MERGE_INTO = { disney: "disneyplus", espn: "espn" };

const byId = new Map(), out = [];
const add = s => {
  if (byId.has(s.id)) throw new Error("duplicate id " + s.id);
  byId.set(s.id, s); out.push(s);
};
const hostOf = u => { try { return new URL(u).host; } catch { return u; } };

for (const s of baseline) {
  const cat = s.pack ? PACK_REGION[s.pack] : s.cat;
  if (!cat || (!GLOBAL.includes(cat) && !REGIONS.includes(cat))) throw new Error(`no group for ${s.id} (${s.cat}/${s.pack})`);
  const site = new URL(s.url).origin + "/";
  add({ id: s.id, name: s.name, names: namesFor(s.id, s.names), alias: ALIAS[s.id] || null, cat, site, probe: s.url, alt: altsFor(s.id, site, s.url) });
}
for (const s of unlock) {
  if (byId.has(s.id) || MERGE_INTO[s.id]) continue;
  const id = RENAME[s.id] || s.id;
  const region = NO_ONLY[s.id] || ONLY_REGION[s.only] || null;
  const cat = region || (GLOBAL.includes(s.cat) ? s.cat : "video");
  const base = s.site.endsWith("/") ? s.site : s.site + "/";
  const probe = PROBE[id] || new URL("favicon.ico", base).href;
  add({ id, name: DISPLAY[id] || s.name, names: NAMES[id] || namesFor(id, null), alias: ALIAS[id] || null, cat, site: s.site, probe, alt: altsFor(id, s.site, probe) });
}

const CATS = [...GLOBAL, ...REGIONS].map(id => ({ id }));

const js = `// GENERATED by scripts/gen-services.mjs from data/baseline.json and data/unlock.json. Do not edit by hand:
// change the data files (which are vendored copies of yt1988/1ms.dog and yt1988/unlock-check, both MIT) or the
// generator, then run \`node scripts/gen-services.mjs\`.
//
// id      the page: /<lang>/<cat>/<id>/. It never changes once a page is published.
// name    the brand's own spelling; names holds the ten translations for a brand whose script is not Latin.
// cat     a key of CATS: seven global groups, then the regions.
// site    the service's home page (linked from its page).
// probe   the small same-host URL the 10-minute probe requests from Tokyo and Shanghai.
export const CATS = ${JSON.stringify(CATS, null, 2)};

export const SERVICES = [
${out.map(s => {
  const names = s.names ? `, names: ${JSON.stringify(s.names)}` : "";
  const alias = s.alias && s.alias.length ? `, alias: ${JSON.stringify(s.alias)}` : "";
  const alt = s.alt && s.alt.length ? `, alt: ${JSON.stringify(s.alt)}` : "";
  return `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}${names}${alias}, cat: ${JSON.stringify(s.cat)}, site: ${JSON.stringify(s.site)}, probe: ${JSON.stringify(s.probe)}${alt} },`;
}).join("\n")}
];

export const byId = new Map(SERVICES.map(s => [s.id, s]));
export const byCat = cat => SERVICES.filter(s => s.cat === cat);
`;
writeFileSync(new URL("../src/services.mjs", import.meta.url), js);

mkdirSync(new URL("../probe/", import.meta.url), { recursive: true });
const probe = out.map(s => (s.alt && s.alt.length ? { id: s.id, url: s.probe, alt: s.alt } : { id: s.id, url: s.probe }));
writeFileSync(new URL("../probe/services.json", import.meta.url), JSON.stringify(probe, null, 1) + "\n");

const counts = {};
for (const s of out) counts[s.cat] = (counts[s.cat] || 0) + 1;
console.log(`${out.length} services; ${Object.keys(counts).length} groups`);
console.log(counts);
console.log(`probe targets: ${probe.length}, unique URLs: ${new Set(probe.map(p => p.url)).size}`);
