// language, URL folder, og:locale; the first is the root (same order as reach/ping)
export const LANGS = [["en", "", "en_US"], ["zh-CN", "zh-cn", "zh_CN"], ["zh-TW", "zh-tw", "zh_TW"], ["ja", "ja", "ja_JP"], ["ko", "ko", "ko_KR"],
  ["es", "es", "es_ES"], ["fr", "fr", "fr_FR"], ["de", "de", "de_DE"], ["pt", "pt", "pt_BR"], ["ru", "ru", "ru_RU"]];

export const SITE = (process.env.SITE_URL || "https://down.1ms.dog").replace(/\/+$/, "");
export const REPO = "https://github.com/yt1988/down-check";
export const THEME_KEY = "down:theme";
export const LANG_KEY = "down:lang";
