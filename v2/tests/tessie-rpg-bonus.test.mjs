// The Tessie RPG: Sonar and Lure earn XP indirectly (a boat a ping marked or a lure called pays x 1.5), and a first wreck of a type
// says so once. Behaviour on the real player as her, with a still runabout ahead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { BOUNTY, normalise } from '../sim/tessieBounty.js';
import { skillRow } from '../ui/tessieLog.js';

const DT = 1 / 30;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
import { scoreInto, blankSave } from '../sim/tessieBounty.js';
import { createTessiePlayer as makePlayer, MARKED_LINE, FIRST_LINES } from '../living/tessiePlayer.js';
import { classOf, TIP, createLeanSkipper, LEAN, LEAN_CLASS } from '../ui/leanSkipper.js';

// her at the surface `d` m from a runabout lying still (it is hit for real: the traffic's own hit), a save at `xp` with Lure and Sonar
// open; notes: the skipper's line as it shows, in order, through the real lean skipper (the 20 s gap, once ever; her other teaching
// lines marked as seen, so only the RPG's lines under test ask)
function runaboutRig({ xp = 70, d = 75, notes = [] } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: () => 40 });
  const at = { x: 2000, z: 2000 };
  const boat = { id: 'p0', kind: 'power', x: at.x, z: at.z - d, heading: Math.PI / 2, L: 6.6, B: 2.4 }, hits = [];
  const traffic = () => [{ targets: () => (hits.length ? [] : [{ ...boat }]), hit: (id) => { hits.push(id); return true; } }];
  const quiet = Object.keys(LEAN_CLASS).filter((k) => k.startsWith('tip.tessie.') && !/^tip\.tessie\.(level|first\.|marked)/.test(k));
  const lean = createLeanSkipper({ storage: memStore({ [LEAN.storeKey]: JSON.stringify(quiet) }), busy: () => false });
  const hint = { phoneQuiet: lean, note: (text, a, b, o) => { if (lean.allow(o?.kind)) notes.push({ kind: o?.kind ?? null, text, t: lean.state.t }); }, drop() {} };
  const storage = memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp, ranks: { dash: 1, lure: 1, sonar: 1 } }) });
  const P = makePlayer({ plugin: { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 }, B, depthAt: () => 40, headless: true, veil: () => {}, storage, rpg: true, traffic, services: () => ({ get: (k) => (k === 'hint' ? hint : null) }), day: () => '2026-07-04' });
  const bb = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 }, view = { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 };
  sim.ambush(at.x, at.z, 0, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: bb, view });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 }); assert.ok(P.become('swap').ok);
  const step = (secs) => { for (let k = 0; k < Math.round(secs / DT); k++) { lean.update(DT, {}); sim.step(DT, { playing: true, boat: bb, view }); P.step(DT); } };
  return { P, step, hits };
}
const wreck = (R) => { R.P.pin({ nose: 0.75, chase: 'p0' }); for (let i = 0; i < 40 && !R.hits.length; i++) R.step(0.5); R.step(0.5); return R.P.stats().log.bounty.at(-1); };

test('pure: a boat marked by Sonar or lured pays × 1.5, with the other multipliers; never on its own a first', () => {
  const s = blankSave(); s.byType.sail.wrecked = 1;
  assert.equal(scoreInto(s, { kind: 'sail', depthM: 1 }).xp, 3);
  const m = scoreInto(s, { kind: 'sail', depthM: 1, marked: true });
  assert.equal(m.xp, 5, '3 × 1.5 = 4.5, rounded'); assert.equal(m.marked, true);
  assert.equal(scoreInto(s, { kind: 'sail', depthM: 1, marked: true, seen: true }).xp, 7, '3 × 1.5 seen × 1.5 marked = 6.75');
  assert.equal(scoreInto(s, { kind: 'glass', depthM: 1, marked: true }).xp, 27, 'a first glass boat marked: 6 × 3 × 1.5');
  assert.equal(BOUNTY.marked, 1.5);
});

test('as her: a runabout wrecked after a Sonar ping pays half again; the reason is said once (a TIP); without the ping, the plain bounty', () => {
  const plain = wreck(runaboutRig());
  assert.equal(plain.kind, 'runabout'); assert.ok(!plain.marked, 'no ping: not marked');
  const R = runaboutRig(); R.step(0.1);
  assert.equal(R.P.pressSlot('sonar'), 'fire', 'the ping marks the runabout 75 m off');
  const marked = wreck(R);
  assert.equal(marked.marked, true, 'the wreck came while the ping\'s bonus held');
  assert.ok(marked.xp > plain.xp && Math.abs(marked.xp - plain.xp * 1.5) <= 1, `× 1.5 (each rounded): ${plain.xp} → ${marked.xp} XP`);
  assert.equal(classOf(MARKED_LINE.kind), TIP, 'a TIP: once ever, the 20 s gap');
  assert.ok(R.P.stats().log.tips.includes(MARKED_LINE.kind) || R.P.stats().tipsWant.includes(MARKED_LINE.kind), 'the skipper\'s line says why');
});


test('the Logbook says it on the Lure and Sonar rows only', () => {
  const s = normalise({ _v: BOUNTY.v, xp: 70, ranks: { dash: 1, lure: 2, sonar: 1 } });
  assert.match(skillRow(s, 'lure').g, / · its boats pay \+50 %$/); assert.match(skillRow(s, 'sonar').g, / · its boats pay \+50 %$/);
  for (const id of ['dash', 'surge', 'breach']) assert.doesNotMatch(skillRow(s, id).g, /pay/);
});

test('a first wreck of a type says so once, after the level-up line when the same wreck levels her up', () => {
  for (const [id, text] of Object.entries(FIRST_LINES)) { assert.equal(classOf(`tip.tessie.first.${id}`), TIP, id); assert.ok(text.length <= 40 && /^First /.test(text), `${id}: "${text}" (short)`); }
  // no level reached (70 → 79 XP): the first runabout's line comes on its own
  const n1 = []; const a = runaboutRig({ notes: n1 }); const r1 = wreck(a); a.step(25);
  assert.equal(r1.first, true);
  assert.deepEqual(n1.filter((n) => n.kind?.startsWith('tip.tessie.first')).map((n) => n.text), [FIRST_LINES.runabout]);
  // a level reached by the same wreck (65 + 9 = 74 XP: level 5): the level line first, then the first line
  const n2 = []; const b = runaboutRig({ xp: 65, notes: n2 }); const r2 = wreck(b); b.step(1);
  assert.deepEqual(r2.levels, [5], 'this wreck reached level 5');
  const pick = () => n2.map((n) => n.kind).filter((k) => k === 'tip.tessie.level' || k === 'tip.tessie.first.runabout');
  assert.deepEqual(pick(), ['tip.tessie.level'], 'the level line at once: the first line does not push it back');
  b.step(25);
  assert.deepEqual(pick(), ['tip.tessie.level', 'tip.tessie.first.runabout'], 'the first line once the 20 s gap is over');
});
