# AGENTS.md

For anyone working in this repository, people and AI agents alike. What the tool does is in [README.md](README.md).
1ms.dog's operations notes (the actual hostname, the shell entry, the VPS jobs) are in the private shell repository.

## The one rule this tool exists for

A single probe proves **reachability from Tokyo**, not an outage. The page must never turn "we cannot reach it" into
"it is down", and never turn missing or stale data into "down" either:

- `unreachable` — neither endpoint answers now, for less than a day.
- `longfail` — neither has answered for more than a day (more likely our check than the service).
- `stale` / `nodata` — the page says it cannot judge. The dot is grey, never red.

Only an official status feed may say "outage"; this version links it and does not fetch it. If you add the feed,
`fault` requires the official feed (major/critical), or two independent places failing, or one place failing while
the official feed is not `none`. Keep that test in `src/model.mjs` and its cases in `test/model.test.mjs`.

## Commands

```bash
npm ci
npm run build     # src/ + static/ → public/ (not committed)
npm run dev       # build, then http://localhost:8791/
npm test          # build, then node --test test/*.test.mjs
npm run assets    # re-render static/og/*.png after changing a headline; commit the PNGs
```

`npm test` builds first, so Workers Builds can run exactly `npm ci && npm test` before `npx wrangler deploy`.

## Adding or removing a service

Edit `src/services.mjs`:

- `id` is the URL (`/<group>/<id>/`) and never changes after the page is published.
- `cat` is one of `CATS`.
- `src.base` / `src.unlock` are the ids in the two upstream files. `BASE_IDS` / `UNLOCK_IDS` are derived from them.
- `status` must be an official status page that actually covers this service. Check it returns 200/301 before adding
  it; if there is none, omit it and the page says so.
- Brand names are not translated. Everything else is in `src/i18n/`.

The build generates one page per service per language, the sitemap, and the category pages. Nothing else needs editing.

## Data flow

1. `src/worker.js` fetches the two upstream files (4 s timeout), trims them with `src/data.mjs` to the published
   services, and caches the answer for 60 s; the last good copy is kept for 7 days. If an upstream fails, the page
   gets the kept copy with `stale: true`; if there is none, a 503 and the page says it cannot read the data.
2. The page loads `/api/status.json` once and computes the verdict with `src/model.mjs` (inlined into the bundle).
3. Every block is drawn by the build before the fetch: cards, rows, KPI tiles, two source rows and a fixed-height
   outage list. The script only fills them, so the page does not jump when data arrives.

The upstream address is never written into a page (a test checks this); the browser only talks to its own origin.

## Page and copy rules

- One `<h1>` and one `<main>` per page; the shell injects the navigation bar, the footer line and the cross-tool list.
- Ten languages, each file with every key and the same `{placeholders}` (`npm test`). Do not fall back to English at
  runtime: a missing key fails the build.
- Runtime strings are the `RUNTIME` set in `scripts/build.mjs`; everything else is written into the HTML at build
  time (titles, descriptions, category copy, the FAQ, the "what we check" text).
- Wording follows the 1ms.dog translation guide: the conclusion first, short sentences, "your network" not "China",
  our machines by city (Tokyo, Shanghai). The page says "from Tokyo" wherever it shows a result.
- The status colors are the shared ladder: green = answering, amber = partial / recovered, red = not answering,
  grey = unknown. Text always accompanies the color.

## Links to other tools

The service pages link to the latency page on the home tool, the unlock tool and the connection checkup. The hrefs are
built at runtime from the shell's `<meta name="<id>">` tags and hidden when those tags are absent (self-hosted). Do
not hard-code `1ms.dog` hostnames in the page; the repo must work on its own.

## Deployment

- Worker `down`, `workers_dev = false`, `preview_urls = false`, no custom domain. The shell routes the hostname.
- Workers Builds: `npm ci && npm test`, deploy `npx wrangler deploy`.
- `public/` is generated and git-ignored on purpose (380 pages). Do not commit it.
- After deploying, run the shell's `npm run check -- down` (structure, headers, SEO) and `npm run mobile -- down`.

## Known limits of this version

- Only Tokyo, and only hourly. A later phase adds a 10-minute probe in Tokyo and Shanghai; that is an infrastructure
  change and needs the site owner's approval first.
- The 154 unlock services are not published yet; the registry publishes 30 to get the structure and copy reviewed.
  Adding the rest is a data edit, not new code.
- No share dialog: a status snapshot is stale within the hour, and the page URL is the thing worth sharing.
