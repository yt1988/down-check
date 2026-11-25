// Official status pages, by service id. `api` is a machine-readable Statuspage answer (summary.json or status.json);
// only services with one can be part of the verdict. `page` is what a visitor opens either way.
//
// Keep this list honest: an entry means the service itself publishes this page. Verify it still answers before adding
// one, and do not point a service at another service's page. The page labels every official row with the service's
// own page as its source; we never present the official word as our own measurement.
export const STATUS = {
  chatgpt: { page: "https://status.openai.com/", api: "https://status.openai.com/api/v2/summary.json" },
  claude: { page: "https://status.anthropic.com/", api: "https://status.anthropic.com/api/v2/summary.json" },
  copilot: { page: "https://status.cloud.microsoft/" },
  microsoft: { page: "https://status.cloud.microsoft/" },
  gemini: { page: "https://status.cloud.google.com/" },
  github: { page: "https://www.githubstatus.com/", api: "https://www.githubstatus.com/api/v2/summary.json" },
  npm: { page: "https://status.npmjs.org/", api: "https://status.npmjs.org/api/v2/summary.json" },
  dockerhub: { page: "https://status.docker.com/" },
  huggingface: { page: "https://status.huggingface.co/" },
  cloudflare: { page: "https://www.cloudflarestatus.com/", api: "https://www.cloudflarestatus.com/api/v2/status.json" },
  cloudfront: { page: "https://health.aws.amazon.com/health/status" },
  akamai: { page: "https://status.akamai.com/", api: "https://status.akamai.com/api/v2/summary.json" },
  azure: { page: "https://azure.status.microsoft/" },
  fastly: { page: "https://status.fastly.com/" },
  apple: { page: "https://www.apple.com/support/systemstatus/" },
  wikipedia: { page: "https://www.wikimediastatus.net/" },
  discord: { page: "https://discordstatus.com/", api: "https://discordstatus.com/api/v2/summary.json" },
  reddit: { page: "https://www.redditstatus.com/", api: "https://www.redditstatus.com/api/v2/summary.json" },
  twitch: { page: "https://status.twitch.com/", api: "https://status.twitch.com/api/v2/summary.json" },
  instagram: { page: "https://metastatus.com/" },
  facebook: { page: "https://metastatus.com/" },
  whatsapp: { page: "https://metastatus.com/" },
  zoom: { page: "https://status.zoom.us/", api: "https://status.zoom.us/api/v2/summary.json" },
  epic: { page: "https://status.epicgames.com/", api: "https://status.epicgames.com/api/v2/summary.json" },
  playstation: { page: "https://status.playstation.com/" },
  xbox: { page: "https://support.xbox.com/en-US/xbox-live-status" },
};

export const OFFICIAL_IDS = Object.keys(STATUS).filter(id => STATUS[id].api);
