# AGENTS.md

For anyone working in this repository, people and AI agents alike. What the tool does is in [README.md](README.md);
the deployment on 1ms.dog (hostname, shell entry, KV namespace, the probe timers) is in the private shell repository.

## The rule this tool exists for

A probe proves **reachability from one place**, not an outage. Never turn a probe failure into "down", and never turn a
refusal or missing data into either:

- `403`, `429`, `cf-mitigated: challenge`, a challenge page → **unconfirmed**, not offline.
- Both probes failing → **offline** (or **offline for days** after 24 h). Not "outage".
- Only an official Statuspage `major`/`critical` → **official outage**.
- A source older than **20 minutes** (two missed 10-minute rounds) → **data is stale**; every source stale or missing →
  **cannot judge**. Grey, never red.

Keep this in `src/model.mjs` and its cases in `test/model.test.mjs`. The UI has one label per state
(`st_online`, `st_unconfirmed`, …) and one colour class; do not add a second vocabulary.

## Commands

```bash
npm ci
npm run build     # src/ + static/ → public/ (not committed: 2,320 pages)
npm run dev       # build, then http://localhost:8791/ (reads probe/out/ and the official feeds)
npm test          # build, then node --test test/*.test.mjs
npm run assets    # re-render static/og/*.png after changing a headline; commit the PNGs
cd probe && go test ./... && go build -o down-probe .
```

Workers Builds runs `npm ci && npm test` before `npx wrangler deploy`. The test builds first, so a stale `public/`
cannot deploy.

## Adding or removing a service

The registry is generated; do not edit `src/services.mjs` by hand.

1. Update the vendored snapshots in `data/` (copies of `yt1988/1ms.dog`'s `src/services.mjs` and
   `yt1988/unlock-check`'s `src/services.mjs`; both MIT) or the merge rules in `scripts/gen-services.mjs`.
2. `node scripts/gen-services.mjs` — writes `src/services.mjs` and `probe/services.json`, and fails on a duplicate id.
3. Add transliterations to `names` for a brand whose script is not Latin (the page's language may differ from the
   brand's). Brand names are not translated otherwise.
4. `npm test`.

A group id must not equal a language folder (`ru` would collide with `/ru/`; the Russia group is `cis`). A service id
never changes after its page is published.

## Official status pages

`src/status-sources.mjs` is curated by hand: `page` is what a visitor opens, `api` is a Statuspage feed
(`summary.json` or the smaller `status.json`). Add only a page that really covers that service, and verify it answers
before adding it. The cron writes one KV key; the page labels the official row with the service's own page. Do not
point a service at another service's page, and do not present the official word as our measurement.

## Data flow

1. `probe/` runs every 10 minutes on each machine and writes `latest.json` (plus `days/`) with per-service `t`, `h`,
   `up24`, `up7`, `out`.
2. `src/worker.js` fetches Tokyo and Shanghai (`PROBE_TOKYO_URL`, `PROBE_SHANGHAI_URL`), trims them with
   `src/data.mjs` (published ids, last 144 samples only), reads the official KV snapshot, caches 60 s, and keeps the last
   good copy for a week. If everything is missing it returns 503.
3. The cron (`*/10`) reads each `api` in `status-sources.mjs`, keeps the previous entry when a feed fails, and writes one
   key: `official:latest`.
4. The page fetches `/api/status.json` once and fills the build's placeholders. It never talks to an upstream directly.

The upstream data address never appears in a page (a test checks it). A 403/429 must stay unconfirmed end to end.

## Page rules

- One `<h1>` and one `<main>`; the shell injects the bar, the footer line and the tool list.
- Current state first: the big state on a service page, the pill on a group row, the dot on the board. Online tiles do
  not repeat a word; issues do.
- The 24-hour strip is one cell per hour (six 10-minute samples), coloured from the probe's own history; the service
  page shows the last 144 samples. No chart library, no axes: it is a status strip, not a latency chart.
- Ten languages, every key and the same `{placeholders}` (`npm test`); no English fallback at runtime. Runtime strings
  are the `RUNTIME` set in `scripts/build.mjs`; everything else is written into the HTML.
- Wording: conclusion first, short sentences, our machines by city (Tokyo, Shanghai), "your network" not "China".
- Status colours are the shared ladder: green online, amber partial/recovered, red offline/official outage, grey
  unconfirmed/stale. Text always accompanies colour.
- The brand and the header icons are never red; red means offline.

## Deployment

- Worker `down`, `workers_dev = false`, `preview_urls = false`, no custom domain (the shell routes it).
- `wrangler.toml`: `[triggers] crons = ["*/10 * * * *"]` and the KV binding `OFFICIAL`. The namespace must be created
  and its id put in place before the first deploy; without it the official rows say "no data".
- `public/` is generated and git-ignored (2,320 pages). Do not commit it.
- After deploying: the shell's `npm run check -- down`, `npm run mobile -- down`; check the live `/api/status.json` has
  both probe files and a fresh official snapshot.

## Known limits

- Only services with a machine-readable Statuspage feed can be part of an official verdict; the rest link their page.
- Shanghai's file must be published somewhere the Worker can read (`PROBE_SHANGHAI_URL`); until then the Shanghai row
  says "no data".
- The probe is on a 10-minute timer; a round takes about 48 s and 35 MB (see `probe/README.md`).
- No share dialog: a status snapshot is stale within ten minutes, and the page URL is what is worth sharing.
