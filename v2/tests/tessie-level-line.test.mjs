// The Tessie RPG: the level-up line ("Level N: pick one skill to grow: [1] or [2].") comes before a why-line. It is the only door to
// the pick (a press picks only while it is up), so it jumps the lean skipper's 20 s gap (v2/ui/leanSkipper.js LEAN_JUMP): a Breach
// pressed with no boat ahead ("Breach needs a boat ahead, within 60 m.") just before used to win the row when the gap ended and push
// the level line 20 s later still. And a press that picks while the line is up is a pick only: no skill fires, no why-line.
// Behaviour on the real player as her, open water, no boat, through the real lean skipper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { LEVEL_UP } from '../sim/tessieLevelUp.js';
import { createTessiePlayer, SKILL_LINES } from '../living/tessiePlayer.js';
import { createLeanSkipper, LEAN, LEAN_CLASS } from '../ui/leanSkipper.js';

const DT = 1 / 30;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const WHY = SKILL_LINES.breachNone.kind;

// her at the surface on open water with a level 4 save, 2 points waiting and one free Breach; only her first tip, the Breach's
// why-line and the level line may ask (every other teaching line marked seen); notes: the skipper's line as it shows, in order
function rig({ notes = [] } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: () => 40 });
  const at = { x: 2000, z: 2000 };
  const quiet = Object.keys(LEAN_CLASS).filter((k) => k.startsWith('tip.tessie.') && ![LEVEL_UP.kind, WHY, 'tip.tessie.swim'].includes(k));
  const lean = createLeanSkipper({ storage: memStore({ [LEAN.storeKey]: JSON.stringify(quiet) }), busy: () => false });
  const hint = { phoneQuiet: lean, current: 'note', note: (text, a, b, o) => { if (lean.allow(o?.kind)) notes.push({ kind: o?.kind ?? null, text, t: +lean.state.t.toFixed(2) }); }, drop() {} };
  const storage = memStore({ [BOUNTY.key]: JSON.stringify({ _v: 2, xp: 52, level: 4, points: 2, ranks: { dash: 2, lure: 0, sonar: 0, surge: 0, breach: 0 }, trials: { lure: 5, sonar: 0, surge: 0, breach: 1 } }) });
  const P = createTessiePlayer({ plugin: { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 }, B, depthAt: () => 40, headless: true, veil: () => {}, storage, rpg: true, traffic: () => [], services: () => ({ get: (k) => (k === 'hint' ? hint : null) }), day: () => '2026-07-04' });
  const bb = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 }, view = { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 };
  sim.ambush(at.x, at.z, 0, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: bb, view });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 }); assert.ok(P.become('swap').ok);
  const t0 = lean.state.t;
  const step = (secs) => { for (let k = 0; k < Math.round(secs / DT); k++) { lean.update(DT, {}); sim.step(DT, { playing: true, boat: bb, view }); P.step(DT); } };
  return { P, step, lean, notes, since: () => lean.state.t - t0 };
}
const kinds = (notes) => notes.map((n) => n.kind);

test('a Breach pressed with no boat just after her first tip: the level line still comes first, well inside the 20 s gap', () => {
  // the Breach's press lands at several moments after her first tip (the race between the two lines' 1 s asking clocks)
  for (const pressAt of [1.5, 2.6, 3.6, 4.7, 6.2]) {
    const R = rig(); R.step(pressAt);
    assert.equal(R.P.stats().rpg.open, false, `${pressAt} s: no level line up yet when 5 is pressed`);
    R.P.pressSlot('breach');
    R.step(45 - pressAt);
    const k = kinds(R.notes);
    assert.equal(k[0], 'tip.tessie.swim', `${pressAt} s: her first tip first (${k})`);
    const lv = R.notes.find((n) => n.kind === LEVEL_UP.kind), why = R.notes.find((n) => n.kind === WHY);
    assert.ok(lv, `${pressAt} s: the level line shows (${k})`);
    assert.match(lv.text, /^Level 4: pick one skill to grow: /);
    assert.ok(!why || k.indexOf(LEVEL_UP.kind) < k.indexOf(WHY), `${pressAt} s: the level line before the why-line (${JSON.stringify(R.notes)})`);
    const first = R.notes[0].t;
    assert.ok(lv.t - first >= 7 - 1e-6 && lv.t - first < 12, `${pressAt} s: the level line once her first tip has been read (7 s), not after the 20 s gap (${(lv.t - first).toFixed(1)} s)`);
    assert.ok(why && why.t - lv.t >= LEAN.gapS - 1e-6, `${pressAt} s: the why-line waits its gap after the level line (${JSON.stringify(R.notes)})`);
  }
});

test('a why-line already up: a fresh level\'s line jumps the 20 s gap (after 7 s)', () => {
  const R = rig(); R.step(25);   // her first tip and the reminder level line have shown; a point still waits
  const n0 = R.notes.length;
  R.P.pressSlot('breach');   // the window is shut: the skill's own press, with no boat → the why-line
  for (let i = 0; i < 30 && !R.notes.slice(n0).some((n) => n.kind === WHY); i++) R.step(1);
  const why = R.notes.slice(n0).find((n) => n.kind === WHY);
  assert.ok(why, `the why-line shows (${JSON.stringify(R.notes)})`);
  R.step(1); R.P.levelUp.levelUp();
  R.step(10);
  const lv = R.notes.slice(n0).find((n) => n.kind === LEVEL_UP.kind && n.t > why.t);
  assert.ok(lv && lv.t - why.t >= 7 - 1e-6 && lv.t - why.t < 10, `the fresh level line 7 s after the why-line, not 20 s (${JSON.stringify(R.notes.slice(n0))})`);
});

test('a press that picks while the level line is up is a pick only: no skill fired, no why-line asked', () => {
  const R = rig(); for (let i = 0; i < 60 && !R.P.stats().rpg.open; i++) R.step(0.5);
  assert.equal(R.P.stats().rpg.open, true, 'the level line is up');
  const dash0 = R.P.stats().rpg.dash.count;
  assert.equal(R.P.pressSlot('lure'), 'pick');
  assert.equal(R.P.stats().rpg.dash.count, dash0);
  assert.deepEqual(R.P.stats().tipsWant, [], 'no line waits to be said');
  assert.equal(R.P.stats().log.lure ?? null, null, 'the Lure did not fire');
  const n0 = R.notes.length; R.step(30);
  assert.ok(!R.notes.slice(n0).some((n) => n.kind === WHY || /^tip\.tessie\.(try|tried|locked)/.test(n.kind ?? '')), `no why or trial line after the pick (${JSON.stringify(R.notes.slice(n0))})`);
});
