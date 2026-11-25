# Down Check

**Live:** https://down.1ms.dog

Which services are down right now? Down Check watches 210 services people search for during an outage — ChatGPT,
GitHub, Discord, Cloudflare, Netflix, Steam and the rest — from two places: our own probes in Tokyo and Shanghai, every
10 minutes. Each page shows the current state first, the last 24 hours as a strip, the interruptions of the last 7 days,
and a link to the service's own official status page.

- **Current state first.** A large online / partial / offline / unconfirmed state, then the history. A service is never
  called "down" because one probe failed: only the service's own official status page may report an outage.
- **Unconfirmed is a state.** A 403, a 429 or a challenge page is shown as unconfirmed, not offline. Missing data or
  data older than 20 minutes (two missed rounds) is "cannot judge".
- **10 languages**: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский.
- **All services, all languages**: `/`, `/<group>/` and `/<group>/<service>/`.

## How a verdict is made

| State | What it means |
|---|---|
| Online | Our probes in Tokyo and/or Shanghai answered. |
| Recovered | Answering now; there was an interruption in the last 24 hours. |
| Partial | One place answers and the other does not; or the official page reports a minor issue or maintenance. |
| Unconfirmed | Every answer was a refusal (403/429) or a challenge page: no way to say either way. |
| Offline | No place answers now, for less than a day. |
| Offline for days | No place has answered for more than a day: more likely our check than the service. |
| Official outage | The service's own official status page reports a major or critical outage. |
| Data is stale / No data | Every source is older than 20 minutes, or a source has no data. Grey, never red. |

The official status page is the service's own word; the page labels it with its source and never presents it as our
measurement. Only services that publish a machine-readable Statuspage feed take part in the verdict; the rest still link
their official page.

## Run it locally

```bash
npm ci
npm run build                        # src/ + static/ → public/ (not committed: 2,320 pages)
npm run dev                          # build, then http://localhost:8791/
npm test                             # build, then the model, strings, data and page tests
```

To see live probe data, build and run the probe first (Go 1.22+):

```bash
cd probe && go build -o ../../down-probe . && cd ..
./down-probe --out probe/out --services probe/services.json --from "Tokyo, JP"
npm run dev
```

`npm run dev` reads `probe/out/latest.json` (Tokyo) and `probe/out/sh/latest.json` (Shanghai, optional), and fetches the
official status pages itself. With no probe file the probe rows say "no data" — the correct degraded state, not an
error. For local design work, `scripts/dev.mjs` fills the part of the 24-hour strip the probe does not have yet from
the existing hourly baseline; production does not do that.

## Deploy

The Worker serves static assets, one endpoint (`/api/status.json`) and one cron:

- **`/api/status.json`** merges the two probe files and the official snapshot, trims to what a page shows, caches 60 s,
  and keeps the last good copy for a week (marked `stale`).
- **Cron every 10 minutes** reads the services' own Statuspage answers and writes one KV key with the snapshot. One
  write per run, never one key per service.
- `public/` is not committed: Workers Builds runs `npm ci && npm test` and then `npx wrangler deploy`; the test builds
  the site first. No custom domain: on 1ms.dog the shell routes the hostname to this Worker.
- Before the first deploy, create the KV namespace and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml`.
  Without the binding the pages still work; the official rows say "no data".
- To self-host, bind your own domain and point `PROBE_TOKYO_URL` / `PROBE_SHANGHAI_URL` (Worker variables) at your own
  probe output; the defaults are 1ms.dog's data host.

## Data

`probe/latest.json` (one per machine): `at`, `every`, `from`, `complete`, and per service `ok`, `unknown`, `ms`,
`http`, `err`, `t` (this service's own measurement time), `h` (history, 10-minute samples), `up24`, `up7`, `out`.
The Worker trims it to the published services and the last 144 samples (`h24`) before any browser sees it.

The official snapshot in KV: one `{ at, every, services: { <id>: { at, indicator, description, updated_at, page } } }`.
`indicator` is Statuspage's `none / minor / major / critical / maintenance`.

Nothing about visitors is collected: the page reads one same-origin JSON and sets no cookies.

## Layout

```
src/services.mjs        the 210 services and 21 groups (generated from data/)
src/model.mjs           verdict, freshness and error mapping (shared by the page and the tests)
src/status-sources.mjs  official status pages and their machine-readable feeds
src/data.mjs            what the Worker keeps from each upstream file
src/worker.js           /api/status.json, the cron, one KV key
src/app.js              fills the page from the JSON
scripts/gen-services.mjs  data/baseline.json + data/unlock.json → src/services.mjs + probe/services.json
scripts/build.mjs       2,320 static pages, sitemap, robots, llms.txt, _headers
scripts/assets.mjs      link-preview images, one per language
probe/                  the 10-minute probe (Go), its systemd units and measured cost
```

<!-- 1ms-repos: generated by the 1ms.dog shell repository's scripts/repos.mjs; edit sites.js or that script, not here -->
<!-- /1ms-repos -->

## License

MIT. The service names are their owners' trademarks; this page only records whether they answered.
