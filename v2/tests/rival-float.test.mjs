// The rivals float as the player's boat does (fix/v2-rival-float, 2026-11-18; owner: "the other boats don't float following the physics
// properly: they vibrate up and down a lot, unlike the user's sailboat"). No browser:
//   - a wind sea in the water's three tiles (the 600 m tile's swell, the 85 m tile's chop, the 12 m tile's ripples, each scaled by the
//     wind level), the hull's view of it as v2/sim/surface.js weightsFor gives it: the rivals' float (regatta/rivalFloat.js) against the
//     player's own (src/sim/boat/ride.js through v2/sim/boat.js waterFor), sailing beside her: the RMS of the frame-to-frame height
//     change within 1.5 x the player's at every level, and the old pose (the drawn surface at the hull's middle) fails it
//   - the readback's whole tiles: a rival far outside the player's window reads the sea (heightAt's { coarse: true }); the window alone
//     gave her nothing
//   - the race in node: every rival's drawn pose (the near slots, the props) is her float's, one pose whatever her band
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRivalFloats } from '../regatta/rivalFloat.js';
import { BoatOnWater } from '../../src/sim/boat/ride.js';
import { vesselDims } from '../../src/sim/boat/dims.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { waterFor, createBoatSim } from '../sim/boat.js';
import { createSurface, COARSE_OFFSETS, COARSE_N, WINDOW_FLOATS, LENGTHS, N } from '../sim/surface.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createRegatta } from '../regatta/index.js';

const G = 9.81, TAU = 2 * Math.PI;
// a sea by wind level (1 calm … 4 fresh): per tile, a few components (wavelength m, amplitude m per level, direction rad, phase)
const BANDS = [
  { tile: 0, comps: [[48, 0.6, 0.1, 0.3], [30, 1.0, -0.25, 1.9], [21, 0.8, 0.4, 4.1]], amp: [0.004, 0.012, 0.025, 0.04] },
  { tile: 1, comps: [[11, 1.0, 0.05, 0.7], [7.3, 0.9, -0.3, 2.6], [4.6, 0.7, 0.35, 5.0], [2.8, 0.5, -0.1, 3.3]], amp: [0.012, 0.03, 0.055, 0.08] },
  { tile: 2, comps: [[1.7, 1.0, 0.2, 0.2], [1.1, 0.8, -0.4, 1.4], [0.7, 0.6, 0.5, 2.8], [0.45, 0.5, -0.2, 4.4]], amp: [0.004, 0.008, 0.013, 0.018] },
];
const W = createSurface();   // its weightsFor: the hull's view (the Smith effect per tile, no 12 m tile)
function seaAt(level) {
  const ONE = [1, 1, 1];
  const comps = BANDS.flatMap((b) => b.comps.map(([L, a, dir, ph]) => ({ tile: b.tile, k: TAU / L, w: Math.sqrt(G * TAU / L), a: a * b.amp[level - 1], cx: Math.cos(dir), sz: Math.sin(dir), ph })));
  let clock = 0;
  const heightAt = (x, z, o = null) => {
    const hull = o && (o.depthM > 0 || o.filterM > 0), w = hull ? W.weightsFor(o, [0, 0, 0]) : ONE, t = o?.t ?? clock;
    let h = 0;
    for (const c of comps) if (w[c.tile] > 0) h += w[c.tile] * c.a * Math.cos(c.k * (x * c.cx + z * c.sz) - c.w * t + c.ph);
    return h;
  };
  return { heightAt, set t(v) { clock = v; }, get t() { return clock; } };
}
const rms = (xs) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
const jitter = (h) => rms(h.slice(1).map((y, i) => y - h[i]));

// 8 s at 60 frames a second, the sim at 2 x (the game's speed): the player and three rivals on a close reach at 3 m/s, abreast
function sail(level) {
  const sea = seaAt(level), dims = vesselDims(CURRENT_VESSEL), now = () => sea.t;
  const me = new BoatOnWater({ water: waterFor(sea.heightAt, { now }), dims });
  const F = createRivalFloats({ heightAt: sea.heightAt, now });
  const boats = [{ id: 'me', x: 0, z: 0 }, { id: 'wren', x: 22, z: 8 }, { id: 'tern', x: -30, z: 15 }, { id: 'heron', x: 45, z: -20 }];
  const heading = 1.1, u = 3, dt = 2 / 60, H = Object.fromEntries(boats.map((b) => [b.id, []])), old = Object.fromEntries(boats.map((b) => [b.id, []]));
  let pitch = 0;
  for (let f = 0; f < 480; f++) {
    const t = f * dt; sea.t = t;
    for (const b of boats) {
      const s = { x: b.x + Math.sin(heading) * u * t, z: b.z - Math.cos(heading) * u * t, heading, heel: 0.12, u };
      if (b.id === 'me') H.me.push(me.step(null, s, t, f ? dt : 0).heave);
      else { const p = F.step(b.id, s, t, f ? dt : 0); H[b.id].push(p.heave); pitch = Math.max(pitch, Math.abs(p.pitch)); }
      old[b.id].push(sea.heightAt(s.x, s.z) - 0.05);   // the code before the fix: the drawn surface at the hull's middle
    }
  }
  return { H, old, pitch };
}

test('the rivals\' heave jitter stays within 1.5 x the player\'s in every wind (the old single-point pose does not)', () => {
  const lines = [];
  let oldFails = 0;
  for (const level of [1, 2, 3, 4]) {
    const { H, old, pitch } = sail(level), jm = jitter(H.me);
    for (const id of ['wren', 'tern', 'heron']) {
      const jr = jitter(H[id]), jo = jitter(old[id]);
      lines.push(`L${level} ${id}: ${(jr / jm).toFixed(2)} x (old ${(jo / jm).toFixed(2)} x)`);
      assert.ok(jr <= 1.5 * jm, `wind ${level}, ${id}: jitter ${(100 * jr).toFixed(3)} cm within 1.5 x the player's ${(100 * jm).toFixed(3)} cm`);
      assert.ok(jr >= 0.5 * jm, `wind ${level}, ${id}: she still rides the sea (${(100 * jr).toFixed(3)} cm against ${(100 * jm).toFixed(3)} cm)`);
      if (jo > 1.5 * jm) oldFails++;
    }
    assert.ok(pitch > 0.002, `wind ${level}: the rivals pitch on the waves (${pitch.toFixed(4)} rad)`);
  }
  assert.ok(oldFails >= 6, `the measure can fail: the old pose is over 1.5 x in ${oldFails} of 12 cases (${lines.join('; ')})`);
});

test('the float re-seats on a jump (a restart\'s box, a cut) and resets with the race', () => {
  const sea = seaAt(4), F = createRivalFloats({ heightAt: sea.heightAt, now: () => sea.t });
  const s = { x: 0, z: 0, heading: 0, heel: 0 };
  for (let f = 0; f < 60; f++) { sea.t = f / 30; F.step('wren', s, sea.t, f ? 1 / 30 : 0); }
  const far = { x: 400, z: -300, heading: 0, heel: 0 }, p = F.step('wren', far, sea.t + 1 / 30, 1 / 30);
  const fresh = createRivalFloats({ heightAt: sea.heightAt, now: () => sea.t }).step('wren', far, sea.t + 1 / 30, 0);
  assert.ok(Math.abs(p.heave - fresh.heave) < 1e-9 && Math.abs(p.pitch - fresh.pitch) < 1e-9, `after a 500 m jump she sits on the water there at once (${p.heave.toFixed(3)} m, a new float ${fresh.heave.toFixed(3)} m)`);
  assert.equal(F.size, 1); F.reset(); assert.equal(F.size, 0); assert.equal(F.get('wren'), undefined);
  const flat = createRivalFloats();   // no water (a node race): flat
  const z0 = flat.step('a', s, 0, 0); assert.ok(z0.heave === 0 && z0.pitch === 0 && z0.roll === 0, 'flat water: level');
});

test('the readback\'s whole tiles: a rival far outside the player\'s window reads the sea (coarse), the window alone gave none', () => {
  const S = createSurface(), v = new Float32Array(WINDOW_FLOATS);
  // the 85 m tile's whole copy: a long-crested wave along x (8.5 m), the 600 m tile's: a 60 m swell; every other texel of the tile
  const m = COARSE_N, wave = (c, i) => { const x = ((2 * i + 0.5) / N) * LENGTHS[c]; return c === 0 ? 0.2 * Math.cos(TAU * x / 60) : 0.1 * Math.cos(TAU * x / 8.5); };
  for (const c of [0, 1]) for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) v[(COARSE_OFFSETS[c] + j * m + i) * 4 + 1] = wave(c, i);
  S.adopt(v, { cx: 0, cz: 0, t: 0 });
  // 300 m east, 0 m south: outside every window round (0, 0); the 85 m tile's tile-break warp moves x by a few metres (surface.js warpAt)
  const x = 300, z = 0;
  assert.equal(S.heightAt(x, z), 0, 'the window alone: nothing out here (the old rival pose read this)');
  const h = S.heightAt(x, z, { coarse: true }), wx = x + 2.5 * Math.sin(0.0113 * x + 1.3) + 1.0 * Math.sin(0.113 * x + 0.7);
  const expect = 0.2 * Math.cos(TAU * x / 60) + 0.1 * Math.cos(TAU * wx / 8.5);
  assert.ok(Math.abs(h - expect) < 0.02, `coarse: the two tiles' sea at the point (${h.toFixed(3)} m, expected ${expect.toFixed(3)} m)`);
  // and at the player's own spot the coarse copy agrees with what she reads there (the window is empty here: both 0 for the window)
  assert.ok(Number.isFinite(S.heightAt(0, 0, { coarse: true })));
});

// the race in node, on a sea: every rival drawn from her float, near or mid
const fakeLines = () => ({ stats: { active: false, count: 0 }, setActive(on) { this.stats.active = on; }, write(f, n) { this.stats.count = n; } });
test('the race draws every rival from her float: the near slots and the props alike, pitch and the waves\' roll included', async () => {
  const sea = seaAt(4), put = [], near = [];
  const props = { stats: { instances: 0 }, setActive() {}, begin() { put.length = 0; }, put(kind, x, y, z, yaw, heel, boom, rgba, label, seed, pitch) { if (kind === 'sloop' || kind === 'far') put.push({ x, y, z, heel, pitch }); }, end() {} };
  const boat = { setRivals(n, poses) { near.length = 0; for (let i = 0; i < n; i++) near.push({ ...poses[i] }); } };
  const wind = { sample: (x, z, t) => { const w = steadyWind(7, 210)(x, z, t); return { vx: w.vx, vz: w.vz }; }, base: { dirDeg: 210, speedMs: 7 } };
  const clock = { get t() { return sea.t; } };
  const Bo = createBoatSim({ water: waterFor(sea.heightAt, { now: () => sea.t }), heightAt: () => -40, wind, headless: true });
  const R = createRegatta({ B: Bo, windField: wind, clock, water: { heightAt: sea.heightAt }, terrain: { field: { height: () => -40 } }, flags: { seed: '1', course: 'short' }, P: { headless: true }, lines: fakeLines(), props, boat });
  await R.enter();
  const vp = new Float32Array(16); vp[0] = vp[5] = vp[10] = vp[15] = 1;
  let pitched = 0;
  for (let f = 0; f < 90; f++) {
    Bo.step(1 / 30, { steer: 0, pull: 0 }, 1 / 60); sea.t = Bo.t; R.afterStep();
    R.frame(vp, 1280, 720, 1 / 60, [Bo.state.x, 5, Bo.state.z]);
    const all = [...near, ...put];
    assert.equal(all.length, R.session.rivals.length, 'every rival drawn once');
    for (const b of R.session.rivals) {
      const f0 = R.floats.get(b.id), q = b.phys.state, d = all.find((p) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6);
      assert.ok(f0 && d, `${b.id} has a float and a drawn pose`);
      assert.ok(Math.abs((d.heave ?? d.y) - f0.heave) < 1e-6 && Math.abs(d.pitch - f0.pitch) < 1e-6 && Math.abs(d.heel - ((q.heel ?? 0) + f0.roll)) < 1e-6, `${b.id}: her float's heave, pitch and roll`);
      if (Math.abs(f0.pitch) > 1e-3) pitched++;
    }
  }
  assert.ok(near.length > 0 && put.length >= 0, 'the near slots used');
  assert.ok(pitched > 0, 'the rivals pitch on the sea');
  R.leave();
});
