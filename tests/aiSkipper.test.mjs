// The AI skipper (src/ai/skipper.js) on the real physics, headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sail, windFn, polarTargets, crewBoat, KN, DEG } from './helpers/skipper-sim.mjs';

const kn = 12, wind = windFn({ kn });
const bestVmg = polarTargets(kn * KN).up.vmg;

test('beat 2 km to windward: VMG >= 90 % of the polar best at skill 1, clearly less at 0.2', () => {
  const run = (skill) => { const L = sail({ windAt: wind, skill, seed: 3, seconds: 1800 }); return { L, vmg: L.reached ? 2000 / L.t / KN : (-L.state.z) / L.t / KN }; };
  const a = run(1), b = run(0.2);
  console.log(`beat 12 kn: polar best ${bestVmg.toFixed(2)} kn; skill 1 ${a.vmg.toFixed(2)} kn (${(100 * a.vmg / bestVmg).toFixed(0)} %, ${a.L.tacks.length} tacks, ${a.L.t.toFixed(0)} s, heel max ${(a.L.maxHeel / DEG).toFixed(1)}°); skill 0.2 ${b.vmg.toFixed(2)} kn (${(100 * b.vmg / bestVmg).toFixed(0)} %, ${b.L.tacks.length} tacks)`);
  assert.ok(a.L.reached, 'skill 1 reaches the mark');
  assert.ok(a.vmg >= 0.9 * bestVmg, `skill 1 VMG ${a.vmg.toFixed(2)} vs 0.9 x ${bestVmg.toFixed(2)}`);
  assert.ok(b.vmg < 0.93 * a.vmg && b.vmg < 0.9 * bestVmg, `skill 0.2 ${b.vmg.toFixed(2)} is noticeably less than ${a.vmg.toFixed(2)}`);
});

test('a 10 degree header: it tacks within 40 s; the same run without the header does not', () => {
  const T0 = 60;
  const hdr = windFn({ kn, shift: (t) => (t < T0 ? 0 : -10) }), flat = windFn({ kn });
  const a = sail({ windAt: hdr, seed: 5, seconds: 200, wp: [0, -4000] }), b = sail({ windAt: flat, seed: 5, seconds: 200, wp: [0, -4000] });
  const first = a.tacks.find((t) => t >= T0);
  console.log(`header at ${T0} s: tack at ${first?.toFixed(0)} s (${a.rep.why ?? ''}); without: tacks ${b.tacks.map((t) => t.toFixed(0))}`);
  assert.ok(first !== undefined && first - T0 < 40, `tacked ${first} after the header at ${T0}`);
  assert.ok(!b.tacks.some((t) => t >= T0 && t < T0 + 40), 'no tack without the header');
});

test('a gust (12 to 20 kn) on the water ahead: it eases, and heel stays under the limit and under the crew boat', () => {
  // a patch of 1.7x wind drifting south with the air; the boat meets it beating
  const v = 12 * KN;
  const gust = (x, z, t) => 1 + 0.7 * Math.exp(-(((z - (-900 + v * t)) / 90) ** 2));
  const w = windFn({ kn, gust });
  let eased = 0, trav = 0, back = 0, base = 0;
  const L = sail({ windAt: w, seconds: 220, wp: [0, -4000], autoReef: false, onTick: (t, s, sk, ctl) => { if (t < 5) base = ctl.sheet ?? base; eased = Math.max(eased, ctl.sheet - s.crewSheet); trav = Math.min(trav, ctl.traveller); back = Math.max(back, ctl.backstay); } });
  const c = crewBoat({ windAt: w, seconds: 220 });
  console.log(`gust 12 to 20 kn: skipper peak heel ${(L.maxHeel / DEG).toFixed(1)}° at ${L.maxHeelT.toFixed(0)} s (sheet eased up to ${(eased / DEG).toFixed(0)}°, traveller ${trav.toFixed(2)}, backstay ${back.toFixed(2)}); crew boat ${(c.maxHeel / DEG).toFixed(1)}°`);
  assert.ok(trav < -0.3 && back > 0.3, 'the traveller drops and the backstay goes on');
  assert.ok(L.maxHeel < 26 * DEG, `heel ${(L.maxHeel / DEG).toFixed(1)}° under 26°`);
  assert.ok(L.maxHeel < c.maxHeel + 1 * DEG, 'no worse than the crew boat');
});

test('run 2 km downwind: gybes by VMG and holds >= 85 % of the polar best downwind', () => {
  const best = polarTargets(kn * KN).down.vmg;
  const L = sail({ windAt: wind, seed: 2, start: [0, -2000], heading: 150 * DEG, wp: [0, 0], seconds: 1500 });
  const vmg = L.reached ? 2000 / L.t / KN : L.state.z / L.t / KN;
  console.log(`run 12 kn: polar best ${best.toFixed(2)} kn; skipper ${vmg.toFixed(2)} kn (${(100 * vmg / best).toFixed(0)} %), ${L.t.toFixed(0)} s`);
  assert.ok(L.reached);
  assert.ok(vmg >= 0.85 * best, `${vmg.toFixed(2)} vs ${best.toFixed(2)}`);
});

test('a tack costs little: speed back to 90 % within 25 s, and the boat never stops', () => {
  let minU = 9, tackAt = null, back = null, u0 = 0;
  const L = sail({ windAt: wind, seed: 4, seconds: 400, wp: [0, -4000], onTick: (t, s, sk) => {
    if (sk.man && tackAt === null && sk.man.type === 'tack') { tackAt = t; u0 = s.u; }
    if (tackAt !== null && back === null) { minU = Math.min(minU, s.u); if (t > tackAt + 4 && s.u >= 0.9 * u0) back = t - tackAt; }
  } });
  console.log(`tack at ${tackAt?.toFixed(0)} s from ${(u0 / KN).toFixed(1)} kn: lowest ${(minU / KN).toFixed(1)} kn, back to 90 % in ${back?.toFixed(0)} s`);
  assert.ok(tackAt !== null && back !== null && back < 25, `recovery ${back}`);
  assert.ok(minU > 0.4 * u0);
});

test('deterministic: the same seed and world give the same track; another seed does not', () => {
  const run = (seed) => sail({ windAt: wind, seed, skill: 0.5, seconds: 200, wp: [0, -4000] }).track.flat().join();
  assert.equal(run(9), run(9));
  assert.notEqual(run(9), run(10));
});

test('a heavy-air beat (22 kn): heel stays under 30 degrees (the pro controls and the crew reef)', () => {
  const w = windFn({ kn: 22 });
  const L = sail({ windAt: w, seed: 6, seconds: 300, wp: [0, -4000] });
  console.log(`22 kn beat: heel max ${(L.maxHeel / DEG).toFixed(1)}°, reef ${L.state.reef}, backstay ${L.sk.out.backstay.toFixed(2)}, traveller ${L.sk.out.traveller.toFixed(2)}, twist ${L.sk.out.twist.toFixed(2)}`);
  assert.ok(L.maxHeel < 30 * DEG);
});
