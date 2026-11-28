// The strings the browser asks for at runtime; every other string is written into the page at build time.
// scripts/build.mjs ships these in assets/l.<lang>.<hash>.js, and test/strings.test.mjs checks both directions:
// every key here exists in en, and every string src/app.js looks up by name (the loc_* of each place) is here.
// A place added to model.mjs's PLACES without a line here is a raw key on the page ("nuremberg"), which is how
// Nuremberg first shipped.
export const RUNTIME = new Set([
  "name", "lang_label", "a_lang", "a_theme", "a_help", "a_close", "a_prev", "a_next",
  "th_system", "th_light", "th_dark", "just_now", "na", "retry", "loading", "sep", "places_sep",
  "sum_all_ok", "sum_some", "sum_unknown", "sum_counts", "k_up24", "k_up7", "updated",
  "st_online", "st_recovered", "st_unreachable", "st_longfail", "st_unconfirmed", "st_stale", "st_nodata", "st_loading",
  "v_online", "v_online_some", "v_recovered", "v_unreachable", "v_longfail", "v_unconfirmed", "v_stale", "v_nodata",
  "loc_losangeles", "loc_nuremberg", "loc_tokyo", "loc_shanghai", "loc_fail",
  "bar_label", "tip_head", "tip_merged", "tip_ok", "tip_refused", "tip_none", "tip_notmeasured", "tip_incident",
  "tip_hint", "refresh_ready", "refresh_next", "refresh_paused", "refresh_failed", "refreshed_now", "refresh_title",
  "official_none", "official_no_api",
  "incidents_none", "incidents_unknown", "incidents_ongoing", "incidents_checks",
  "err_challenge", "err_timeout", "err_reset", "err_http", "err_eof", "err_dns", "err_tls", "err_refused", "err_unreachable", "err_cancel", "err_other",
  "report_result", "report_prefill", "cross_home", "cross_unlock", "cross_check", "share_foot",
]);
