// The services this tool watches, and the two probes that report on them.
//
// id      the page: /<lang>/<cat>/<id>/. It never changes once a page is published.
// name    the brand's own spelling. Brand names are not translated; the words around them are.
// cat     a key of CATS (the page and the group in the bar).
// site    the service's own home page, linked from its page ("what we check").
// status  the service's official status page, when it has one that covers this service. Otherwise none: the page
//         says so instead of pointing at something that is not about it.
// src     the probes that know this service: `base` is the hourly Tokyo baseline (index/summary.json, ids as in
//         yt1988/1ms.dog's src/services.mjs), `unlock` is the hourly Tokyo unlock watch (unlock/status.json, ids as in
//         yt1988/unlock-check's src/services.mjs). Both are measured from Tokyo; they are two endpoints, not two places.
//
// This first version publishes 30 services so the page, the copy and the degradation path can be reviewed. The rest
// of the baseline list and the streaming services from the unlock watch (about 180 more) use the same shape and are
// generated from this file; nothing in the build is special-cased for these 30.

export const CATS = [
  { id: "ai", name: "cat_ai", desc: "cat_desc_ai" },
  { id: "social", name: "cat_social", desc: "cat_desc_social" },
  { id: "video", name: "cat_video", desc: "cat_desc_video" },
  { id: "dev", name: "cat_dev", desc: "cat_desc_dev" },
  { id: "game", name: "cat_game", desc: "cat_desc_game" },
  { id: "web", name: "cat_web", desc: "cat_desc_web" },
  { id: "cdn", name: "cat_cdn", desc: "cat_desc_cdn" },
];

export const SERVICES = [
  // AI
  { id: "chatgpt", name: "ChatGPT", cat: "ai", site: "https://chatgpt.com/", status: "https://status.openai.com/", src: { base: "chatgpt", unlock: "chatgpt" } },
  { id: "claude", name: "Claude", cat: "ai", site: "https://claude.ai/", status: "https://status.anthropic.com/", src: { base: "claude", unlock: "claude" } },
  { id: "gemini", name: "Gemini", cat: "ai", site: "https://gemini.google.com/", src: { base: "gemini", unlock: "gemini" } },
  { id: "copilot", name: "Copilot", cat: "ai", site: "https://copilot.microsoft.com/", status: "https://status.cloud.microsoft/", src: { base: "copilot", unlock: "copilot" } },
  { id: "grok", name: "Grok", cat: "ai", site: "https://grok.com/", src: { base: "grok", unlock: "grok" } },

  // Social
  { id: "x", name: "X", cat: "social", site: "https://x.com/", src: { base: "x", unlock: "x" } },
  { id: "instagram", name: "Instagram", cat: "social", site: "https://www.instagram.com/", status: "https://metastatus.com/", src: { base: "instagram", unlock: "instagram" } },
  { id: "facebook", name: "Facebook", cat: "social", site: "https://www.facebook.com/", status: "https://metastatus.com/", src: { base: "facebook", unlock: "facebook" } },
  { id: "whatsapp", name: "WhatsApp", cat: "social", site: "https://www.whatsapp.com/", status: "https://metastatus.com/", src: { base: "whatsapp", unlock: "whatsapp" } },
  { id: "telegram", name: "Telegram", cat: "social", site: "https://telegram.org/", src: { base: "telegram", unlock: "telegram" } },
  { id: "discord", name: "Discord", cat: "social", site: "https://discord.com/", status: "https://discordstatus.com/", src: { base: "discord", unlock: "discord" } },
  { id: "reddit", name: "Reddit", cat: "social", site: "https://www.reddit.com/", status: "https://www.redditstatus.com/", src: { base: "reddit", unlock: "reddit" } },
  { id: "tiktok", name: "TikTok", cat: "social", site: "https://www.tiktok.com/", src: { base: "tiktok", unlock: "tiktok" } },

  // Video & music
  { id: "youtube", name: "YouTube", cat: "video", site: "https://www.youtube.com/", src: { base: "youtube", unlock: "youtube" } },
  { id: "netflix", name: "Netflix", cat: "video", site: "https://www.netflix.com/", src: { base: "netflix", unlock: "netflix" } },
  { id: "twitch", name: "Twitch", cat: "video", site: "https://www.twitch.tv/", status: "https://status.twitch.com/", src: { base: "twitch", unlock: "twitch" } },
  { id: "spotify", name: "Spotify", cat: "video", site: "https://open.spotify.com/", src: { base: "spotify", unlock: "spotify" } },

  // Developer services
  { id: "github", name: "GitHub", cat: "dev", site: "https://github.com/", status: "https://www.githubstatus.com/", src: { base: "github" } },
  { id: "npm", name: "npm", cat: "dev", site: "https://www.npmjs.com/", status: "https://status.npmjs.org/", src: { base: "npm" } },
  { id: "dockerhub", name: "Docker Hub", cat: "dev", site: "https://hub.docker.com/", status: "https://status.docker.com/", src: { base: "dockerhub" } },
  { id: "huggingface", name: "Hugging Face", cat: "dev", site: "https://huggingface.co/", status: "https://status.huggingface.co/", src: { base: "huggingface" } },

  // Gaming
  { id: "steam", name: "Steam", cat: "game", site: "https://store.steampowered.com/", src: { base: "steam" } },
  { id: "playstation", name: "PlayStation", cat: "game", site: "https://www.playstation.com/", status: "https://status.playstation.com/", src: { base: "playstation" } },
  { id: "xbox", name: "Xbox", cat: "game", site: "https://www.xbox.com/", status: "https://support.xbox.com/en-US/xbox-live-status", src: { base: "xbox" } },

  // Everyday web
  { id: "google", name: "Google", cat: "web", site: "https://www.google.com/", src: { base: "google", unlock: "google" } },
  { id: "apple", name: "Apple", cat: "web", site: "https://www.apple.com/", status: "https://www.apple.com/support/systemstatus/", src: { base: "apple" } },
  { id: "microsoft", name: "Microsoft", cat: "web", site: "https://www.microsoft.com/", status: "https://status.cloud.microsoft/", src: { base: "microsoft" } },
  { id: "wikipedia", name: "Wikipedia", cat: "web", site: "https://www.wikipedia.org/", status: "https://www.wikimediastatus.net/", src: { base: "wikipedia", unlock: "wikipedia" } },

  // Clouds & CDNs
  { id: "cloudflare", name: "Cloudflare", cat: "cdn", site: "https://www.cloudflare.com/", status: "https://www.cloudflarestatus.com/", src: { base: "cloudflare" } },
  { id: "cloudfront", name: "Amazon CloudFront", cat: "cdn", site: "https://aws.amazon.com/cloudfront/", status: "https://health.aws.amazon.com/health/status", src: { base: "cloudfront" } },
];

export const byId = new Map(SERVICES.map(s => [s.id, s]));
export const byCat = cat => SERVICES.filter(s => s.cat === cat);
// the ids the Worker keeps out of each upstream document (everything else is dropped before it reaches a page)
export const BASE_IDS = [...new Set(SERVICES.map(s => s.src.base).filter(Boolean))];
export const UNLOCK_IDS = [...new Set(SERVICES.map(s => s.src.unlock).filter(Boolean))];
