# AGENTS.md

For anyone working in this repository, people and AI agents alike. What the tool does is in [README.md](README.md);
the deployment on 1ms.dog (hostname, shell entry, probe timers) is in the private shell repository.

## The rule this tool exists for

The verdict comes **only from our probes in Tokyo and Shanghai**. The service's own status page is a link, not a
factor. Never turn a probe failure or a refusal into "down":

- `403`, `429`, `cf-mitigated: challenge`, a challenge page, a 5xx response → **unconfirmed** (grey dot), not offline.
- **One place answering is enough: online** (or recovered if the answering place had an interruption in the last 24
  hours). A failure in the other place is shown on that place's row, not as a service state — some services genuinely
  cannot be reached from some regions.
- Only when **no place answers**: offline (or offline for days after 24 h); if any place refused, unconfirmed.
- A source older than **20 minutes** (two missed 10-minute rounds) → **data is stale**; every source stale or
  missing → **cannot judge**. Grey, never red.

Keep this in `src/model.mjs` and its cases in `test/model.test.mjs`. The UI has one label per state
(`st_online`, `st_unconfirmed`, …) and one colour class; do not add a second vocabulary.

## Commands

```bash
npm ci
npm run build     # src/ + static/ → public/ (not committed: 2,320 pages)
npm run dev       # build, then http://localhost:8791/ (reads probe/out/)
npm test          # build, then node --test test/*.test.mjs
node scripts/icons.mjs   # fetch missing service favicons into static/icons/ (commit them)
npm run assets    # re-render static/og/*.png after changing a headline; commit the PNGs
cd probe && go test ./... && go build -o down-probe .
```

Workers Builds runs `npm ci && npm test` before `npx wrangler deploy`. The test builds first, so a stale `public/`
cannot deploy.

## Adding or removing a service

The registry is generated; do not edit `src/services.mjs` by hand.

1. Update the vendored snapshots in `data/` (copies of `yt1988/1ms.dog`'s and `yt1988/unlock-check`'s service lists;
   both MIT) or the merge rules in `scripts/gen-services.mjs`.
2. `node scripts/gen-services.mjs` — writes `src/services.mjs` and `probe/services.json`, and fails on a duplicate id.
3. Add translations to `names` for a brand whose script is not Latin; brand names are otherwise not translated.
4. `node scripts/icons.mjs` and commit the new PNGs. A missing icon falls back to a monogram.
5. `npm test`.

A group id must not equal a language folder (`ru` would collide with `/ru/`; the Russia group is `cis`). A service id
never changes after its page is published.

## Status pages

`src/status-sources.mjs` maps a service to its own status page, linked at the bottom of the service page. It is not
fetched and not part of the verdict. Add only a page that really covers that service; do not point a service at
another service's page.

## Data flow

1. `probe/` runs every 10 minutes on each machine and writes `latest.json` (plus `days/`) with per-service `t`, `h`,
   `up24`, `up7`, `out`.
2. `src/worker.js` fetches Tokyo and Shanghai (`PROBE_TOKYO_URL`, `PROBE_SHANGHAI_URL`; no default — set them in the
   deployment, never in this repository), trims them with
   `src/data.mjs` (published ids, last 144 samples only), caches 60 s, and keeps the last good copy for a week. If both
   are missing it returns 503. There is no cron and no KV.
3. The page fetches `/api/status.json` once and fills the build's placeholders. It never talks to an upstream directly.

The upstream data address never appears in a page (a test checks it). A 403/429 must stay unconfirmed end to end.

## Page rules

- One `<h1>` and one `<main>`; the shell injects the bar, the footer line and the tool list.
- Current state first: the full-width state banner on a service page, the pill on a group row, the icon badge on the
  board. Online tiles do not repeat a word; issues are marked by the dot/border.
- Every service shows its own icon before its name in every list (board tiles, group rows, related chips, the service
  H1). The icons are served from `/icons/`; `node scripts/icons.mjs` fetches missing ones at build time. Audit them
  when adding services: a favicon service can return a placeholder or another brand's icon.
- Status dots are **9px** everywhere, circular, and colour-coded: green online, amber recovered, red
  offline, grey filled unconfirmed/stale. No other shapes.
- The hero is centred; the search (home) is left and the legend right on one row; the age line reserves its height so
  nothing moves when the data arrives. There is no summary block and no "only problems" filter.
- The 24-hour strip is one cell per hour (six 10-minute samples); the service page shows the last 144 samples. No chart
  library, no axes.
- Ten languages, every key and the same `{placeholders}` (`npm test`); no English fallback at runtime. Runtime strings
  are the `RUNTIME` set in `scripts/build.mjs`; everything else is written into the HTML.
- Wording: conclusion first, short sentences, our machines by city (Tokyo, Shanghai), "your network" not "China".
- The brand and the header icons are never red; red means offline.

## Deployment

- Worker `down-check`, `workers_dev = false`, `preview_urls = false`, no custom domain (the shell routes it).
- `wrangler.toml` has assets + `main` only: no cron, no KV, no bindings.
- `public/` is generated and git-ignored (2,320 pages). Do not commit it.
- After deploying: the shell's `npm run check -- down`, `npm run mobile -- down`; check the live `/api/status.json`
  has the Tokyo file and, once it exists, the Shanghai file.

## Known limits

- Shanghai's file must be published somewhere the Worker can read (`PROBE_SHANGHAI_URL`); until then the Shanghai row
  says "no data".
- The probe is on a 10-minute timer; a round takes about 48 s and 35 MB (see `probe/README.md`).
- The service's own status page is a reference link only; it never changes the verdict.
- The share link is the live page, not an encoded result: the card is a timestamped snapshot, the page shows the
  latest state when opened.
