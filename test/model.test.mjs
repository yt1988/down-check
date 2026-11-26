import test from "node:test";
import assert from "node:assert/strict";
import { verdict, STATE, duration, errKey, stateClass, summary } from "../src/model.mjs";

const NOW = Date.parse("2026-11-25T07:00:00Z");
const SEC = Math.floor(NOW / 1000);
const svc = { id: "x", name: "X" };

const probeDoc = (services, { from = "Tokyo, JP", age = 120 } = {}) => ({ at: new Date(NOW - age * 1000).toISOString(), every: 600, from, services });
const p = (o = {}) => ({ ok: true, unknown: false, ms: 20, http: 200, t: SEC - 120, ok_at: SEC - 120, up24: 100, up7: 100, h24: "o".repeat(144), out: [], ...o });
const LOSANGELES = { from: "Los Angeles, US" };
const data = (tokyo, shanghai, losangeles = null) => ({ losangeles, tokyo, shanghai });

test("all three places answer: ok", () => {
  const v = verdict(svc, data(probeDoc({ x: p() }), probeDoc({ x: p() }, { from: "Shanghai, CN" }), probeDoc({ x: p() }, LOSANGELES)), NOW);
  assert.equal(v.state, STATE.OK);
  assert.deepEqual(v.places, ["losangeles", "tokyo", "shanghai"]);
  assert.equal(v.up24, 100);
});

test("only Los Angeles answers: online, and that is the place the page names", () => {
  const v = verdict(svc, data(probeDoc({ x: p({ ok: false, err: "timeout" }) }), probeDoc({ x: p({ ok: false, err: "timeout" }) }, { from: "Shanghai, CN" }), probeDoc({ x: p() }, LOSANGELES)), NOW);
  assert.equal(v.state, STATE.OK);
  assert.deepEqual(v.places, ["losangeles"]);
});

test("a third place keeps a service out of the outage state", () => {
  const v = verdict(svc, data(probeDoc({ x: p({ ok: false, err: "timeout" }) }), probeDoc({ x: p({ ok: false, err: "reset" }) }, { from: "Shanghai, CN" }), probeDoc({ x: p() }, LOSANGELES)), NOW);
  assert.equal(v.state, STATE.OK);
  assert.deepEqual(v.places, ["losangeles"]);
});

test("one place answers, two do not: still online (some regions cannot reach some services)", () => {
  const v = verdict(svc, data(probeDoc({ x: p() }), probeDoc({ x: p({ ok: false, err: "timeout" }) }, { from: "Shanghai, CN" }), probeDoc({ x: p({ ok: false, err: "timeout" }) }, LOSANGELES)), NOW);
  assert.equal(v.state, STATE.OK);
  assert.deepEqual(v.places, ["tokyo"]);
});

test("every place fails for a few hours: unreachable", () => {
  const since = SEC - 2 * 3600;
  const v = verdict(svc, data(probeDoc({ x: p({ ok: false, err: "timeout", out: [{ from: since, to: SEC - 120, runs: 12, err: "timeout" }] }) }),
    probeDoc({ x: p({ ok: false, err: "reset", out: [{ from: since, to: SEC - 120, runs: 12, err: "reset" }] }) }, { from: "Shanghai, CN" })), NOW);
  assert.equal(v.state, STATE.UNREACHABLE);
  assert.equal(v.since, since * 1000);
});

test("every place fails for days: longfail, still not an outage", () => {
  const since = SEC - 50 * 3600;
  const v = verdict(svc, data(probeDoc({ x: p({ ok: false, err: "timeout", out: [{ from: since, to: SEC - 120, runs: 300, err: "timeout" }] }) }),
    probeDoc({ x: p({ ok: false, err: "timeout", out: [{ from: since, to: SEC - 120, runs: 300, err: "timeout" }] }) }, { from: "Shanghai, CN" })), NOW);
  assert.equal(v.state, STATE.LONGFAIL);
  assert.match(duration(NOW - v.since).unit, /day|hour/);
});

test("every answer is a refusal or a challenge: unconfirmed, not offline", () => {
  const v = verdict(svc, data(probeDoc({ x: p({ ok: false, unknown: true, err: "challenge", http: 403 }) }),
    probeDoc({ x: p({ ok: false, unknown: true, err: "challenge", http: 429 }) }, { from: "Shanghai, CN" })), NOW);
  assert.equal(v.state, STATE.UNCONFIRMED);
  assert.equal(stateClass(v.state), "unknown");
});

test("a failure and a refusal, no positive answer: unconfirmed, not offline", () => {
  const v = verdict(svc, data(probeDoc({ x: p({ ok: false, err: "timeout" }) }),
    probeDoc({ x: p({ ok: false, unknown: true, err: "challenge" }) }, { from: "Shanghai, CN" })), NOW);
  assert.equal(v.state, STATE.UNCONFIRMED);
});

test("stale probes are stale, not ok and not down", () => {
  const stale = p({ t: SEC - 30 * 60, ok_at: SEC - 30 * 60 });
  const v = verdict(svc, data(probeDoc({ x: stale }, { age: 30 * 60 }), null), NOW);
  assert.equal(v.state, STATE.STALE);
  assert.equal(stateClass(v.state), "unknown");
});

test("no data at all: nodata", () => {
  assert.equal(verdict(svc, null, NOW).state, STATE.NODATA);
  assert.equal(verdict(svc, data(probeDoc({}), probeDoc({})), NOW).state, STATE.NODATA);
});

test("one place missing, the other answers: ok, and the page shows the missing one", () => {
  const v = verdict(svc, data(probeDoc({ x: p() }), null), NOW);
  assert.equal(v.state, STATE.OK);
  assert.deepEqual(v.places, ["tokyo"]);
});

test("an interruption within 24 hours: recovered", () => {
  const v = verdict(svc, data(probeDoc({ x: p({ out: [{ from: SEC - 4 * 3600, to: SEC - 2 * 3600, runs: 12, err: "timeout" }] }) }), null), NOW);
  assert.equal(v.state, STATE.RECOVERED);
});

test("summary counts problems separately from unconfirmed", () => {
  const list = [{ id: "x" }, { id: "y" }, { id: "z" }];
  const d = data(probeDoc({ x: p(), y: p({ ok: false, err: "timeout" }), z: p({ ok: false, unknown: true, err: "challenge" }) }), null);
  const c = summary(list, d, NOW);
  assert.deepEqual({ ok: c.ok, bad: c.bad, unknown: c.unknown }, { ok: 1, bad: 1, unknown: 1 });
});

test("errors map to the words pages have", () => {
  assert.equal(errKey("challenge"), "err_challenge");
  assert.equal(errKey("timeout"), "err_timeout");
  assert.equal(errKey("http 503"), "err_http");
  assert.equal(errKey("connection refused"), "err_refused");
  assert.equal(errKey("something new"), "err_other");
});
