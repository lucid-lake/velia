// The stage director (owner, 2026-11-17): the opening round (no kayak pair staged at the start
// since 2026-11-18: the busy lake is on the water from the start; Tessie about 25 s, the osprey's dive about 95 s, 30 s of plain sailing between), then weighted random acts every 60–150 s with
// cooldowns, one at a time, busy waits and skips, the device's features, races and captures off, ?stage= pins, the opening once
// a session, preloads one at a time after the first step, deterministic by seed, and a new act is one row. Behaviour only: the
// director is stepped and its timeline read; the acts are the real rows with stand-in starts (their own tests cover the sims).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageDirector, STAGE } from '../stage/director.js';
import { ACTS, actById } from '../stage/acts.js';
import { makeHandle } from '../stage/handle.js';
import { start as kayakStart, BEAT } from '../stage/act-kayaks.js';

// stand-in starts: each act on stage for its own seconds (the kayaks' beat 18 s, Tessie's sighting 28 s, the dive 15 s)
const ON_S = { kayaks: 18, tessie: 28, ospreyDive: 15 };
const stub = (a, o = {}) => ({ ...a, load: o.load ?? null, start: o.start ?? (() => { let t = 0; const s = ON_S[a.id] ?? 20; return makeHandle({ step(dt, h) { t += dt; if (t >= s) h.finish('played'); } }); }) });
const acts = (o) => ACTS.map((a) => stub(a, o));
const desk = () => true, phone = (f) => f !== 'tessie' && f !== 'ospreyDive';
function run({ secs = 600, dt = 0.1, seed = 1, isOn = desk, busy = () => null, race = () => false, cruise = () => false, list = acts(), ...o } = {}) {
  let T = 0;
  const d = createStageDirector({ acts: list, seed, isOn, busy: () => busy(T), race: () => race(T), cruise: () => cruise(T), ...o });
  for (let k = 0, n = Math.round(secs / dt); k < n; k++) { T = (k + 1) * dt; d.step(dt, { playing: true }); }
  return d;
}
// the acts as intervals [start, end) from the timeline
function shows(d) {
  const out = [], open = new Map();
  for (const e of d.timeline) {
    if (e.ev === 'start') open.set(e.id, e.t);
    if (e.ev === 'end') { out.push({ id: e.id, s: open.get(e.id), e: e.t, r: e.why }); open.delete(e.id); }
  }
  return out;
}

// owner, 2026-11-18: "If the lake is truly busy, we don't need to stage the kayaks at the opening (0 s)": the kayaks' act has no opening
// row (it stays in the random pool); the opening is Tessie, then the dive
test('the opening: no kayak pair at the start; Tessie about 25 s, the dive about 95 s; nothing in the first 15 s; 30 s of plain sailing between', () => {
  assert.equal(actById('kayaks').opening, null, 'the kayaks: no opening row');
  assert.ok(actById('kayaks').random, 'the kayaks: still in the random pool');
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = shows(run({ seed, secs: 200 }));
    const [t, o] = s;
    assert.deepEqual(s.slice(0, 2).map((x) => x.id), ['tessie', 'ospreyDive'], `seed ${seed}: the order`);
    assert.ok(!s.some((x) => x.id === 'kayaks' && x.s < o.e), `seed ${seed}: no kayaks in the opening`);
    assert.ok(t.s >= STAGE.QUIET_S, `seed ${seed}: nothing before ${STAGE.QUIET_S} s (${t.s} s)`);
    const tA = actById('tessie').opening, oA = actById('ospreyDive').opening;
    assert.ok(Math.abs(t.s + tA.leadS - tA.atS) <= tA.jitterS + 0.2, `seed ${seed}: Tessie's break at ${(t.s + tA.leadS).toFixed(1)} s`);
    assert.ok(Math.abs(o.s + oA.leadS - oA.atS) <= oA.jitterS + 0.2, `seed ${seed}: the strike at ${(o.s + oA.leadS).toFixed(1)} s`);
    assert.ok(t.s >= STAGE.QUIET_S && o.s - t.e >= STAGE.GAP_S - 0.11, `seed ${seed}: ${(o.s - t.e).toFixed(1)} s of plain sailing before the dive`);
  }
});

test('then random acts: 60–150 s apart, each after its cooldown, never the same twice in a row, never two at once', () => {
  const d = run({ seed: 3, secs: 3600, dt: 0.2 });
  const s = shows(d);
  assert.ok(s.length >= 20, `${s.length} acts in an hour`);
  const rand = s.slice(2);
  for (let i = 0; i < s.length; i++) {
    if (i > 0) assert.ok(s[i].s >= s[i - 1].e, `one at a time: ${s[i - 1].id} ends ${s[i - 1].e}, ${s[i].id} starts ${s[i].s}`);
    const prev = s.slice(0, i).reverse().find((x) => x.id === s[i].id);
    if (prev && i >= 2) assert.ok(s[i].s - prev.e >= actById(s[i].id).random.cooldownS - 0.21, `${s[i].id}'s cooldown: ${(s[i].s - prev.e).toFixed(0)} s`);
  }
  for (let i = 1; i < rand.length; i++) {
    assert.notEqual(rand[i].id, rand[i - 1].id, 'never twice in a row');
    const gap = rand[i].s - rand[i - 1].e;
    assert.ok(gap >= STAGE.RANDOM_S[0] - 0.21, `gap ${gap.toFixed(0)} s`);
  }
  const ids = new Set(rand.map((x) => x.id));
  assert.equal(ids.size, 3, 'every act comes round');
  assert.equal(d.state.phase, 'random');
});

test('busy: a due act waits while the player is busy (up to 20 s), then it is skipped to the pool', () => {
  // the chart open from 18 s to 30 s: Tessie waits and rises when it closes
  const w = run({ secs: 60, busy: (t) => (t > 18 && t < 30 ? 'chart' : null) });
  const t1 = shows(w).find((x) => x.id === 'tessie');
  assert.ok(t1.s >= 30 - 0.11 && t1.s < 30.5, `Tessie at ${t1.s} s`);
  assert.ok(w.timeline.some((e) => e.id === 'tessie' && e.ev === 'wait' && e.why === 'chart'), 'the wait logged with its reason');
  // tacking from 18 s to 60 s: Tessie skipped after 20 s; the dive still at its time; Tessie later from the pool
  const sk = run({ secs: 900, busy: (t) => (t > 18 && t < 60 ? 'tacking' : null) });
  const skip = sk.timeline.find((e) => e.id === 'tessie' && e.ev === 'skip');
  assert.ok(skip && skip.why === 'busy: tacking' && skip.t >= 18 + STAGE.WAIT_S, JSON.stringify(skip));
  const s = shows(sk);
  assert.equal(s[0].id, 'ospreyDive', 'the dive next');
  assert.ok(s.some((x) => x.id === 'tessie' && x.s > s[0].e), 'Tessie later, from the pool');
});

test('phones: no Tessie, no dive (their features off): no pair at the start; random kayaks after the pool\'s gap and their cooldown', () => {
  const d = run({ isOn: phone, secs: 1500 });
  const s = shows(d);
  assert.ok(s.length >= 3 && s.every((x) => x.id === 'kayaks'), s.map((x) => x.id).join(' '));
  assert.ok(s[0].s >= STAGE.RANDOM_S[0] - 0.11, `no pair at the start: the first at ${s[0].s} s`);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].s - s[i - 1].e >= actById('kayaks').random.cooldownS - 0.11, `${(s[i].s - s[i - 1].e).toFixed(0)} s apart`);
  assert.deepEqual(d.state.cast, ['kayaks']);
});

test('off in a race (a gap after it) and in a capture unless ?stage= pins an act; ?stage=off none', () => {
  const r = shows(run({ secs: 300, race: (t) => t < 120 }));
  assert.ok(r.length >= 1 && r[0].s >= 120 + STAGE.RACE_GAP_S - 0.11, `the first act at ${r[0]?.s} s, after the race`);
  assert.equal(shows(run({ secs: 600, enabled: false })).length, 0, 'a capture: no stage');
  assert.equal(run({ secs: 10, enabled: false }).state.phase, 'off');
  const pin = shows(run({ secs: 600, enabled: false, pin: 'ospreyDive' }));
  assert.ok(pin.length >= 2 && pin.every((x) => x.id === 'ospreyDive'), `pinned: ${pin.map((x) => x.id)}`);
  assert.ok(Math.abs(pin[0].s - (95 - 12)) <= 3.2, `its opening time (${pin[0].s} s)`);
  assert.equal(shows(run({ secs: 600, pin: 'off' })).length, 0, '?stage=off');
  // a pinned act whose feature is off on this device does not play
  assert.equal(shows(run({ secs: 200, pin: 'tessie', isOn: phone })).length, 0);
});

test('Cruise keeps the stage with longer gaps', () => {
  const s = shows(run({ secs: 3600, dt: 0.2, seed: 2, cruise: () => true })).slice(3);
  assert.ok(s.length >= 4);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].s - s[i - 1].e >= STAGE.RANDOM_S[0] * STAGE.CRUISE_K - 0.21, `${(s[i].s - s[i - 1].e).toFixed(0)} s`);
});

test('the opening plays once a session: a returning tab goes straight to the random pool; storage that throws still plays', () => {
  const box = new Map(), store = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  const first = shows(run({ secs: 200, storage: store }));
  assert.equal(first[0].id, 'tessie');
  assert.equal(box.get(STAGE.SESSION_KEY), '1', 'remembered once the opening has played');
  const again = run({ secs: 400, storage: store });
  const s = shows(again);
  assert.ok(s[0].s >= STAGE.RANDOM_S[0] - 0.11, `nothing until the pool's first gap (${s[0].s} s)`);
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(shows(run({ secs: 200, storage: bad }))[0].id, 'tessie', 'blocked storage: the opening plays');
});

test('deterministic by seed: the same seed, the same stage; another seed, another', () => {
  const a = run({ seed: 7, secs: 1800 }).timeline, b = run({ seed: 7, secs: 1800 }).timeline, c = run({ seed: 8, secs: 1800 }).timeline;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('a new showcase is one row: a dummy act plays in the opening and in the pool with no other change', () => {
  const dixie = { id: 'dixie', feature: null, opening: { order: 9, atS: 160 }, random: { weight: 5, cooldownS: 200 }, where: 'inView', durationS: [20, 30], budget: { deskMs: 0.1, phoneMs: 0.1 }, load: null,
    start: () => { let t = 0; return makeHandle({ step(dt, h) { t += dt; if (t >= 22) h.finish('played'); } }); } };
  const d = run({ secs: 2400, list: [...acts(), dixie] });
  const s = shows(d);
  assert.equal(s[2].id, 'dixie', 'third in the opening');
  assert.ok(Math.abs(s[2].s - 160) < 0.2, `at its atS (${s[2].s})`);
  assert.ok(s.slice(3).some((x) => x.id === 'dixie'), 'and in the random pool');
  // its budget while on stage, 0 otherwise
  const b = createStageDirector({ acts: [dixie], seed: 1, pin: 'dixie' });
  assert.deepEqual(b.budget(), { deskMs: 0, phoneMs: 0 });
  for (let i = 0; i < 1610; i++) b.step(0.1);
  assert.deepEqual(b.budget(), dixie.budget);
});

test('preload: never before the first step, one load at a time, in the gap before the act', async () => {
  const pending = [];
  const list = acts({ load: () => new Promise((r) => pending.push(r)) });
  const d = createStageDirector({ acts: list, seed: 1 });
  assert.equal(d.state.loads.length, 0, 'nothing before the first step');
  d.step(0.1);
  assert.deepEqual(d.state.loads.map((l) => l.id), ['tessie'], 'the first act\'s load');
  for (let i = 0; i < 100; i++) d.step(0.1);
  assert.equal(d.state.loads.length, 1, 'one at a time: the next waits for it');
  pending.shift()();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 500; i++) d.step(0.1);   // Tessie's sighting ends at ≈ 49 s: the gap before the dive (≈ 83 s)
  assert.deepEqual(d.state.loads.map((l) => l.id), ['tessie', 'ospreyDive']);
  const dive = shows(d).find((x) => x.id === 'ospreyDive');
  assert.ok(d.state.loads[1].t < (dive?.s ?? 83), 'the dive\'s load in the gap before it');
});

test('an act that cannot start, or never ends, does not hold the stage', () => {
  const list = acts().map((a) => (a.id === 'tessie' ? stub(a, { start: () => null }) : a.id === 'ospreyDive' ? stub(a, { start: () => makeHandle({}) }) : a));
  const d = run({ secs: 400, list });
  assert.ok(d.timeline.some((e) => e.id === 'tessie' && e.ev === 'skip' && e.why === 'cannot start'));
  const o = shows(d).find((x) => x.id === 'ospreyDive');
  assert.ok(o && o.r === 'stopped' && o.e - o.s <= actById('ospreyDive').durationS[1] + STAGE.OVER_S + 0.2, JSON.stringify(o));
});

test('the kayaks\' act: the opening waits for the plug-in\'s own first pair; a random act lays a new pair; on stage while a kayaker is by the boat', () => {
  const boat = { x: 0, z: 0 };
  let marks = [], laid = false, again = 0;
  const K = { get fleet() { return { laid, marks: () => marks }; }, again: () => { again++; marks = [{ x: 30, z: 0 }]; return { side: -1 }; } };
  const ctx = { kayaks: K, boat: () => boat, durationS: [40, 60] };
  // the opening: the pair laid at 2 s, near the boat until 20 s
  const h = kayakStart({ ...ctx, opening: true });
  let t = 0;
  for (; t < 60 && h.result === undefined; t += 0.1) { if (t >= 2) { laid = true; marks = t < 20 ? [{ x: 20, z: 0 }] : [{ x: 120, z: 0 }]; } h.step(0.1); }
  assert.equal(h.result, 'played');
  assert.ok(t >= 20 && t < 21, `off stage when they have passed (${t.toFixed(1)} s)`);
  // the player still on the home card: deferred after the wait (the plug-in lays it when play starts)
  laid = false;
  const w = kayakStart({ ...ctx, opening: true });
  for (let i = 0; i < 200 && w.result === undefined; i++) w.step(0.1);
  assert.equal(w.result, 'deferred');
  // random: a new pair now; no pair possible → null (the director moves on)
  laid = true; marks = [];
  const r = kayakStart({ ...ctx, opening: false });
  assert.ok(r && again === 1);
  assert.equal(kayakStart({ ...ctx, kayaks: { ...K, again: () => null }, opening: false }), null);
  assert.ok(BEAT.minS > 0);
});

test('the URL: ?stage= pins; ?tessie=<s> moves her opening; ?tessie=1 or <s> in a capture pins her; =now or =0 do not', async () => {
  const { stageOptions } = await import('../stage/options.js');
  assert.deepEqual(stageOptions({ flags: { stage: 'ospreyDive' } }), { pin: 'ospreyDive', overrides: {} });
  assert.deepEqual(stageOptions({ flags: { stage: 'off' }, headless: true }).pin, 'off');
  assert.deepEqual(stageOptions({ flags: { tessie: '24' } }), { pin: null, overrides: { tessie: { atS: 24 } } });
  assert.equal(stageOptions({ flags: { tessie: '1' }, headless: true }).pin, 'tessie');
  assert.equal(stageOptions({ flags: { tessie: '40' }, headless: true }).pin, 'tessie');
  for (const f of ['now', '0', null]) assert.equal(stageOptions({ flags: { tessie: f }, headless: true }).pin, null, `?tessie=${f}`);
  // the opening override: her break exactly at that time (no jitter)
  const d = run({ secs: 80, overrides: { tessie: { atS: 40 } } });
  const t = shows(d).find((x) => x.id === 'tessie');
  assert.ok(Math.abs(t.s - 36) < 0.11, `start ${t.s}`);
});

test('near her water Tessie comes more often (60–120 s apart, back to back allowed); away, her 4 min cooldown and never twice in a row', () => {
  const tA = actById('tessie');
  const nearRun = shows(run({ seed: 2, secs: 1800, near: (id, m) => id === tA.nearby.area && m === tA.nearby.withinM })).slice(3);
  const awayRun = shows(run({ seed: 2, secs: 1800 })).slice(3);
  const count = (s) => s.filter((x) => x.id === 'tessie').length;
  assert.ok(count(nearRun) >= 2 * count(awayRun) && count(nearRun) >= 8, `Tessie ${count(nearRun)} times near vs ${count(awayRun)} away in 30 min`);
  for (let i = 1; i < nearRun.length; i++) {
    const gap = nearRun[i].s - nearRun[i - 1].e;
    assert.ok(gap >= tA.nearby.gapS[0] - 0.11 && gap <= tA.nearby.gapS[1] + 0.11, `near: ${gap.toFixed(0)} s between acts`);
  }
  assert.ok(nearRun.some((x, i) => i > 0 && x.id === 'tessie' && nearRun[i - 1].id === 'tessie'), 'back to back in her water');
  const ts = awayRun.filter((x) => x.id === 'tessie');
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i].s - ts[i - 1].e >= tA.random.cooldownS - 0.11);
  for (let i = 1; i < awayRun.length; i++) assert.notEqual(awayRun[i].id, awayRun[i - 1].id);
});
