import test from "node:test";
import assert from "node:assert/strict";
import { verdict, STATE, duration, errKey, stateClass } from "../src/model.mjs";

const NOW = Date.parse("2026-11-25T06:00:00Z");
const AT = "2026-11-25T05:00:00Z";
const svc = { id: "x", name: "X", src: { base: "x", unlock: "x" } };
const baseOnly = { id: "y", name: "Y", src: { base: "y" } };

const base = (o = {}) => ({ ms: 10, err: null, up24: 100, up7: 100, h24: [], out: [], ...o });
const un = (o = {}) => ({ s: "ok", err: null, since: null, ok_at: AT, ms: 10, h: "o".repeat(48), ...o });
const doc = (services, { at = AT, every = 3600, stale = false } = {}) => ({ at, every, stale, services });

test("both endpoints answer: ok", () => {
  const v = verdict(svc, { index: doc({ x: base() }), unlock: doc({ x: un() }) }, NOW);
  assert.equal(v.state, STATE.OK);
  assert.equal(v.up24, 100);
});

test("one endpoint answers, the other does not: partial, never an outage", () => {
  const v = verdict(svc, { index: doc({ x: base({ err: "timeout", ms: -1 }) }), unlock: doc({ x: un() }) }, NOW);
  assert.equal(v.state, STATE.PARTIAL);
});

test("both endpoints fail for a few hours: unreachable", () => {
  const since = new Date(NOW - 3 * 3600e3).toISOString();
  const v = verdict(svc, {
    index: doc({ x: base({ err: "timeout", ms: -1, out: [{ from: Math.floor((NOW - 3 * 3600e3) / 1000), to: Math.floor((NOW - 3600e3) / 1000), runs: 3, err: "timeout" }] }) }),
    unlock: doc({ x: un({ s: "bad", err: "http", since, h: "o".repeat(45) + "bbb" }) }),
  }, NOW);
  assert.equal(v.state, STATE.UNREACHABLE);
  assert.equal(v.since, Date.parse(since));
});

test("both endpoints fail for more than a day: longfail, still not called an outage", () => {
  const since = new Date(NOW - 50 * 3600e3).toISOString();
  const v = verdict(svc, {
    index: doc({ x: base({ err: "timeout", ms: -1, out: [{ from: Math.floor((NOW - 50 * 3600e3) / 1000), to: Math.floor((NOW - 3600e3) / 1000), runs: 50, err: "timeout" }] }) }),
    unlock: doc({ x: un({ s: "bad", err: "http", since, h: "b".repeat(48) }) }),
  }, NOW);
  assert.equal(v.state, STATE.LONGFAIL);
  assert.match(duration(NOW - v.since).unit, /day|hour/);
});

test("a single endpoint that fails is partial only when another one answers; alone it is unreachable", () => {
  const v = verdict(baseOnly, { index: doc({ y: base({ err: "reset", ms: -1 }) }) }, NOW);
  assert.equal(v.state, STATE.UNREACHABLE);
});

test("answered now but an interruption within 24 hours: recovered", () => {
  const v = verdict(baseOnly, { index: doc({ y: base({ out: [{ from: Math.floor((NOW - 6 * 3600e3) / 1000), to: Math.floor((NOW - 4 * 3600e3) / 1000), runs: 2, err: "timeout" }] }) }) }, NOW);
  assert.equal(v.state, STATE.RECOVERED);
});

test("the unlock history alone shows a recent bad run: recovered", () => {
  const v = verdict({ id: "z", name: "Z", src: { unlock: "z" } }, { unlock: doc({ z: un({ h: "o".repeat(45) + "bbo" }) }) }, NOW);
  assert.equal(v.state, STATE.RECOVERED);
});

test("stale data is stale, not ok and not down", () => {
  const old = "2026-11-25T01:00:00Z"; // 5 hours old, interval 1 hour
  const v = verdict(svc, { index: doc({ x: base() }, { at: old }), unlock: doc({ x: un() }, { at: old }) }, NOW);
  assert.equal(v.state, STATE.STALE);
  assert.ok(v.views.every(x => !x.fresh));
});

test("a stale upstream does not hide a fresh one", () => {
  const v = verdict(svc, { index: doc({ x: base() }, { at: "2026-11-25T01:00:00Z" }), unlock: doc({ x: un() }) }, NOW);
  assert.equal(v.state, STATE.OK);
  assert.equal(v.partialStale, true);
});

test("no data at all: nodata", () => {
  assert.equal(verdict(svc, null, NOW).state, STATE.NODATA);
  assert.equal(verdict(svc, { index: doc({}), unlock: doc({}) }, NOW).state, STATE.NODATA);
});

test("one source missing but the other answers: ok (the page shows the missing one)", () => {
  assert.equal(verdict(svc, { index: doc({ x: base() }), unlock: null }, NOW).state, STATE.OK);
});

test("a service missing from one stale source still uses the fresh one", () => {
  const v = verdict(svc, { index: doc({ x: base({ err: "timeout", ms: -1 }) }), unlock: doc({}, { at: "2026-11-25T00:00:00Z" }) }, NOW);
  assert.equal(v.state, STATE.UNREACHABLE);
  assert.equal(v.partialStale, false);
});

test("errors map to the words pages have", () => {
  assert.equal(errKey("timeout"), "err_timeout");
  assert.equal(errKey("EOF"), "err_eof");
  assert.equal(errKey("http"), "err_http");
  assert.equal(errKey("something new"), "err_other");
});

test("colors: unknown never looks like a failure", () => {
  assert.equal(stateClass(STATE.OK), "ok");
  assert.equal(stateClass(STATE.UNREACHABLE), "bad");
  assert.equal(stateClass(STATE.STALE), "unknown");
  assert.equal(stateClass(STATE.NODATA), "unknown");
});
