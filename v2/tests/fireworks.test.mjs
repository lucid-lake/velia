// v2's July 4th show (v2/sim/fireworks.js, the plug-in's rules): when it is built and when it runs, no boat place for
// it (open world, 2026-11-15), the scheduler against v1's script (the shells written at their launch, on the barges' decks, the live stars as
// v1's count, the seek's replay window), determinism, the smoke's draw list, the barges' props and the lamps. Behaviour
// only: each call's output, never the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShowState, gameShow, showTimeAt, showClock, showOn, bargeProps, BARGE, bargesWorld, lampLevels, nightOf, bargesOut,
  STEP, LOOKAHEAD, DECK_Y, STAR_FLOATS, PUFF_FLOATS, TIERS, VIEW, AIM, SCALE, SHOW_START_HOUR, SHOW_LENGTH, puffLevel, PUFF_SEEN,
} from '../sim/fireworks.js';
import { liveStarsAt, makeShow, shellStars, shellLife } from '../../src/fireworks/show.js';
import { parseV2Flags } from '../engine/flags.js';

const SHOW1 = gameShow(1);   // built once (the script and its risers: ≈ 1 s)
const replay = (S, t) => { const { n } = S.seekPlan(t); for (let k = 0; k < n; k++) { S.spawnDue(S.t + STEP + LOOKAHEAD); S.advance(STEP); } S.setTime(t); S.after(t); };

test('the show runs on v1\'s clock: 21:44 is show time 0, four game seconds a show second, nothing outside its window', () => {
  assert.equal(showTimeAt(SHOW_START_HOUR), 0);
  assert.ok(Math.abs(showTimeAt(SHOW_START_HOUR + 100 * 4 / 3600) - 100) < 1e-9);
  assert.equal(showTimeAt(13), null);
  assert.equal(showTimeAt(20), null);
  assert.equal(showTimeAt(SHOW_START_HOUR + (SHOW_LENGTH + 200) * 4 / 3600), null);
});

test('a v2 page plays the show in real time from the hour it opened at; ?fwt pins it; a running day clock follows the hour', () => {
  const live = showClock({ hour0: SHOW_START_HOUR + 40 * 4 / 3600 });
  assert.ok(Math.abs(live(0, 0) - 40) < 1e-9);
  assert.ok(Math.abs(live(12.5, 0) - 52.5) < 1e-9);
  assert.equal(showClock({ hour0: 13 })(5, 13), null);
  assert.equal(showClock({ pin: 100, hour0: 13 })(2, 13), 102);
  const day = showClock({ hour0: 21, timerate: 60 });
  assert.equal(day(0, 21.9), showTimeAt(21.9));
  assert.equal(showClock({ pin: SHOW_LENGTH + 119 })(5, 0), null);   // past the smoke's window
});

test('v1\'s rule for the show being built: the highlight day, ?fireworks not 0; the flags reach v2', () => {
  assert.equal(showOn(parseV2Flags('?hour=21.9'), true), true);
  assert.equal(showOn(parseV2Flags('?fireworks=0'), true), false);
  assert.equal(showOn(parseV2Flags(''), false), false);
  const f = parseV2Flags('?fwt=100&fwsound=0');
  assert.equal(f.fwt, '100'); assert.equal(f.fwsound, false); assert.equal(f.fireworks, true);
});

test('open world (owner, 2026-11-15): the show offers no start pose of its own; its barges sit 250 m off the viewing spot', async () => {
  const mod = await import('../sim/fireworks.js');
  assert.equal(mod.showStart, undefined);   // nothing for the page to move the boat with
  assert.ok(Number.isFinite(AIM));
  // the barges 250 m off the viewing spot (stage.js)
  for (const b of bargesWorld()) assert.ok(Math.abs(Math.hypot(b.x - VIEW[0], b.z - VIEW[1]) - 250) < 1e-6);
});

test('the scheduler writes each shell at its launch: the riser on its barge\'s deck, born at the launch, rising at v0 × the scale', () => {
  const show = SHOW1, S = createShowState({ show });
  S.seekPlan(0);
  const e = show.events.find((x) => !x.ground);
  assert.ok(S.spawnDue(e.t) >= 1);
  const d = S.takeDirty(); assert.ok(d.length >= 1);
  const [start] = d[0], o = start * STAR_FLOATS, a = S.staging;
  assert.ok(Math.abs(a[o + 1] - DECK_Y) < 1e-4, 'the mortar on the deck');
  assert.ok(Math.abs(a[o + 3] - show.events[0].t) < 1e-4, 'born at the first launch');
  const b = bargesWorld()[show.events[0].barge % 2];
  assert.ok(Math.hypot(a[o] - b.x, a[o + 2] - b.z) < 60 * SCALE, 'on its barge');
  if (!show.events[0].ground) assert.ok(Math.abs(a[o + 5] - show.events[0].v0 * SCALE) < 1e-2, 'the riser\'s muzzle speed, scaled');
});

test('a seek replays v1\'s window: the stars in the air are v1\'s count (show.js), each shell\'s written from its launch', () => {
  const show = SHOW1;
  for (const t of [20, 100, 280]) {
    const S = createShowState({ show });
    replay(S, t);
    // v1's engine writes a shell's stars at its launch and keeps them to its life's end (+0.5 s): the same count from show.js
    const v1 = show.events.filter((e) => t >= e.t && t <= e.burst + shellLife(e.type, e.inches) + 0.5).reduce((n, e) => n + shellStars(e.type, e.inches), 0), v2 = S.stats().live;
    assert.ok(v2 >= liveStarsAt(show, t), `t=${t}: at least the stars burning`);
    assert.ok(Math.abs(v2 - v1) <= 0.1 * v1 + 20, `t=${t}: v1 ${v1}, v2 ${v2}`);
    assert.ok(S.drawn >= v2 - 0 && S.drawn <= S.N, 'the draw covers every live slot');
    assert.equal(S.stats().overflow, 0);
  }
});

test('deterministic: two replays write the same bytes and the same smoke', () => {
  const a = createShowState({ show: SHOW1 }), b = createShowState({ show: SHOW1 });
  replay(a, 150); replay(b, 150);
  assert.deepEqual(Buffer.from(a.staging.buffer), Buffer.from(b.staging.buffer));
  assert.equal(a.puffCount, b.puffCount);
  assert.deepEqual(Array.from(a.puffData.subarray(0, a.puffCount * PUFF_FLOATS)), Array.from(b.puffData.subarray(0, b.puffCount * PUFF_FLOATS)));
});

test('the smoke: at most the tier\'s draw list, the brightest, each lit enough to see; the flash bank lights it', () => {
  const S = createShowState({ show: SHOW1 });
  replay(S, 280);
  assert.ok(S.puffCount > 0 && S.puffCount <= TIERS.desktop.draw);
  for (let i = 0; i < S.puffCount; i++) {
    const q = { pos: Array.from(S.puffData.subarray(i * PUFF_FLOATS, i * PUFF_FLOATS + 3)), alpha: S.puffData[i * PUFF_FLOATS + 4] };
    assert.ok(puffLevel(q, S.flash) >= PUFF_SEEN);
  }
  const dark = { pos: [0, 0, 0], alpha: 0.07 }, none = { pos: new Float32Array(32), col: new Float32Array(32) };
  assert.ok(puffLevel(dark, none) < PUFF_SEEN, 'unlit smoke is not drawn');
  const p = createShowState({ show: SHOW1, tier: 'phone' }); replay(p, 280);
  assert.ok(p.puffCount <= TIERS.phone.draw && p.N === TIERS.phone.capacity && !p.trails);
});

test('no stars, no draw: before the show and long after it, nothing is drawn or lit', () => {
  const S = createShowState({ show: SHOW1 });
  replay(S, -200);
  assert.equal(S.drawn, 0); assert.equal(S.puffCount, 0); assert.equal(S.active, false);
  assert.ok(S.flash.sum.every((x) => x === 0));
});

test('the barges, pushboats and patrol boats: real size on their spots, the patrol boats on the 110 m zone, the lights', () => {
  const B = bargesWorld(), { boxes, lamps } = bargeProps(B);
  // the hull between its raked ends (36.6 m in all with them, 9.1 m beam), riding the barge's bob
  for (const b of B) assert.ok(boxes.some((x) => Math.hypot(x.c[0] - b.x, x.c[2] - b.z) < 0.01 && Math.abs(x.h[0] - (BARGE.length / 2 - 1.8)) < 1e-9 && Math.abs(x.h[2] - BARGE.beam / 2) < 1e-9 && x.mat === 1 && x.bob === 1), 'the 36.6 × 9.1 m hull');
  assert.equal(boxes.filter((x) => x.rake).length, 2 * B.length, 'two raked ends a barge');
  assert.ok(boxes.filter((x) => x.mat === 3).length >= 12 * B.length, 'the rack crates');
  const patrol = boxes.filter((x) => Math.abs(x.h[2] - 4.25) < 1e-9);
  assert.equal(patrol.length, 4);
  for (const p of patrol) assert.ok(B.some((b) => Math.abs(Math.hypot(p.c[0] - b.x, p.c[2] - b.z) - 110) < 0.5));
  assert.ok(lamps.filter((l) => l.kind === 4).length === 8 && lamps.filter((l) => l.kind === 0).length === 3 * B.length);
  assert.equal(lamps.filter((l) => l.kind === 2).length, B.length); assert.equal(lamps.filter((l) => l.kind === 3).length, B.length);
  assert.equal(lamps.filter((l) => l.kind === 1).length, 4 * B.length, 'two anchor lights and two masthead lights a barge');
});

test('the evening\'s lights: dark by day, the work lights dimmed once the show runs, the barges out 20:30–23:30', () => {
  assert.equal(nightOf(10), 0); assert.equal(nightOf(-9), 1);
  const day = lampLevels(null, 0); assert.equal(day.work + day.nav + day.blue, 0);
  const before = lampLevels(-300, 1), during = lampLevels(10, 1);
  assert.ok(during.work < before.work && during.nav === before.nav);
  assert.equal(bargesOut(20), false); assert.equal(bargesOut(21.9), true); assert.equal(bargesOut(23.6), false);
});

test('the game\'s show is v1\'s (stage.js wowShow over makeShow): the same events for the same seed', () => {
  const a = gameShow(1), b = SHOW1;
  assert.deepEqual(a.events.map((e) => [e.t, e.type, e.burst]), b.events.map((e) => [e.t, e.type, e.burst]));
  assert.ok(a.events.length > makeShow(1).events.length, 'the wow show joins a second script');
  assert.ok(!a.events.some((e) => e.type === 'niagara' || e.type === 'palm'));
});

test('leaving the show (fix 2026-11-18, owner: "the last fireworks are left in the sky"): reset drops every star, flash and puff at once', () => {
  const S = createShowState({ show: SHOW1 });
  replay(S, 120);
  assert.ok(S.active && S.drawn > 0 && S.puffCount > 0 && S.flash.sum.some((x) => x > 0), `mid-show: stars, smoke and a flash (${S.drawn}, ${S.puffCount})`);
  S.reset();
  assert.equal(S.active, false); assert.equal(S.drawn, 0); assert.equal(S.puffCount, 0);
  assert.ok(S.flash.sum.every((x) => x === 0) && S.flash.pos.every((x) => x === 0), 'no flash left to light the sky');
  assert.equal(S.takeDirty().length, 0, 'nothing waiting to upload');
  S.after(S.t);   // the frozen clock's next frame: nothing comes back
  assert.equal(S.drawn, 0); assert.equal(S.puffCount, 0); assert.equal(S.stats().live, 0);
  // back into the show from 10 s before it (Fireworks picked again): the shells spawn afresh from the first, as a fresh state's
  S.reset(-10);
  assert.equal(S.t, -10);
  const fresh = createShowState({ show: SHOW1 }); fresh.setTime(-10);
  for (const s of [S, fresh]) for (let k = 0; k < 20 * 60; k++) { s.spawnDue(s.t + STEP + LOOKAHEAD); s.takeDirty(); s.advance(STEP); }
  S.after(); fresh.after();
  assert.ok(S.drawn > 0 && S.drawn === fresh.drawn && S.stats().live === fresh.stats().live, `the show again as a fresh one (${S.drawn} vs ${fresh.drawn})`);
  // a reset to a time in the show skips the shells before it (the GPU then replays by a seek)
  const M = createShowState({ show: SHOW1 }); M.reset(100); M.spawnDue(100.001);
  assert.ok(M.stats().spawned <= SHOW1.events.filter((e) => e.t >= 100 && e.t <= 100.001).length, 'no shell before t is spawned');
});
