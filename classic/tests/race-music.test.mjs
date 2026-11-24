// Regatta's adaptive score (the state machine; the Web Audio part needs a browser). Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createScore, SCORE, URLS } from '../src/modes/regatta/raceMusic.js';

const run = (sc, from, to, input, dt = 0.1) => { const all = []; let a; for (let c = from; c < to; c += dt) { a = sc.step(dt, { clock: c, ...input }); all.push(...a.events); } return { a, events: all }; };

test('the countdown plays the pre-start piece from its top; the gun crossfades 1.5 s into the race loop', () => {
  const sc = createScore();
  const first = sc.step(0.1, { clock: -60 });
  assert.equal(first.state, 'prestart'); assert.deepEqual(first.events, ['prestart']); assert.equal(first.preOffsetS, 0);
  const { a, events } = run(sc, -59.9, -0.1, {});
  assert.equal(a.state, 'prestart'); assert.deepEqual(events, []);
  const gun = sc.step(0.1, { clock: 0 });
  assert.equal(gun.state, 'race'); assert.deepEqual(gun.events, ['race']); assert.equal(gun.xfade, SCORE.xfadeS);
  // joining late (a switch into the mode at -20 s) starts the piece where the countdown is
  assert.equal(createScore().step(0.1, { clock: -20 }).preOffsetS, 40);
  assert.equal(createScore().step(0.1, { clock: 12 }).state, 'race');
});

test('the lift: the final leg, or a gap under 10 s (off over 14 s); ~2 dB and a filter opening, eased', () => {
  const sc = createScore(); run(sc, -60, 5, {});
  let r = run(sc, 5, 30, { gapS: 40 }); assert.equal(r.a.liftOn, false); assert.ok(r.a.lift < 0.01);
  r = run(sc, 30, 40, { gapS: 8 }); assert.deepEqual(r.events, ['lift']); assert.ok(r.a.lift > 0.9 && Math.abs(r.a.liftDb - 2) < 0.2);
  assert.ok(r.a.cutoffHz > SCORE.liftHz[0] + 0.9 * (SCORE.liftHz[1] - SCORE.liftHz[0]));
  r = run(sc, 40, 50, { gapS: 12 }); assert.equal(r.a.liftOn, true, 'hysteresis: still lifted at 12 s');
  r = run(sc, 50, 80, { gapS: 20 }); assert.equal(r.a.liftOn, false); assert.ok(r.a.lift < 0.05);
  const fl = createScore(); run(fl, -60, 5, {});
  assert.equal(run(fl, 5, 10, { finalLeg: true, gapS: 60 }).a.liftOn, true);
  const pre = createScore(); assert.equal(run(pre, -60, -5, { finalLeg: true, gapS: 1 }).a.liftOn, false, 'no lift before the gun');
});

test('the duck under the race officer: fast down 6 dB, slower back', () => {
  const sc = createScore(); run(sc, -60, 5, {});
  let r = run(sc, 5, 6, { voice: true }); assert.ok(r.a.duckDb < -5, `${r.a.duckDb}`);
  r = run(sc, 6, 6.3, { voice: false }); assert.ok(r.a.duckDb < -1, 'not yet back');
  r = run(sc, 6.3, 12, { voice: false }); assert.ok(r.a.duckDb > -0.1);
});

test('the finish fades out into the results card; R starts it over from the countdown', () => {
  const sc = createScore(); run(sc, -60, 100, {});
  const out = sc.step(0.1, { clock: 100, over: true });
  assert.equal(out.state, 'out'); assert.deepEqual(out.events, ['out']); assert.equal(out.xfade, SCORE.outS);
  assert.deepEqual(sc.step(0.1, { clock: 100.1, over: true }).events, [], 'once');
  const again = sc.step(0.1, { clock: -60, over: false });
  assert.deepEqual(again.events, ['restart', 'prestart']); assert.equal(again.state, 'prestart');
});

test('the pieces are shipped and credited (Regatta builds the score: tests/pages/raceMusic.page.mjs (retired 2026-11-18))', () => {
  for (const u of Object.values(URLS)) { assert.ok(existsSync(new URL(`../..${u}`, import.meta.url)), u); assert.ok(existsSync(new URL(`../..${u.replace('.opus', '.m4a')}`, import.meta.url)), `${u} AAC twin`); }
  const att = readFileSync(new URL('../../ATTRIBUTION.md', import.meta.url), 'utf8');
  for (const n of ['race_prestart_a', 'race_main_a']) assert.match(att, new RegExp(`audio/music/${n}\\.opus.*MusicAPI`));
});
