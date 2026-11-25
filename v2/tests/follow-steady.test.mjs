// The Boat view's sky holds still in a sea (fix 2026-11-25: "the sky for both day and night is often shaking"). The boat's speed
// over the ground surges with every wave (the slopes and the orbital current: ±0.7 m/s at 16 kn on the bigger sea); the follow
// camera's lens, eye and aim read the speed (the speed camera, sim/speedFeel.js, and the follow camera's breath), so the lens
// pumped at the waves' encounter period and the sky far from the frame's centre moved ±2.5 px at 720p while the horizon held.
// The cameras now read a slow speed (the surge filtered out); the boat herself still heaves and pitches on screen.
// Behaviour only: the boat sim on a moving swell, B.camera() each frame, the pose projected as the page projects it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { mat4, lookDir, perspectiveReversed, multiply } from '../engine/math.js';
import { hullToWorld } from '../sim/shots.js';
import { createGust } from '../sim/gust.js';

const DEG = Math.PI / 180, G = 9.81, W = 1280, H = 720, HZ = 60;

// a long-crested swell travelling toward compass dirDeg: amplitude A (m), period T (s), deep water (k = ω² / g), its orbital
// current at the surface; the clock is the boat's own (B.t)
function swell(A, T, dirDeg, now) {
  const w = 2 * Math.PI / T, k = w * w / G, dx = Math.sin(dirDeg * DEG), dz = -Math.cos(dirDeg * DEG);
  const ph = (x, z) => k * (x * dx + z * dz) - w * now();
  return waterFor((x, z) => A * Math.cos(ph(x, z)), { now, velocityAt: (x, z, o, out) => { const u = A * w * Math.cos(ph(x, z)); out[0] = u * dx; out[1] = u * dz; return out; } });
}

// s seconds of the Boat view at 60 Hz on the swell, after a 20 s settle; per frame the screen (px, 1280 × 720) of a fixed star
// 20° up ahead of the first frame's aim and one 30° to its side, the horizon under it, the boat's mid deck, the lens, the boat's
// speed. The camera as the page builds it: B.camera(), then the gust's lean (main.js placeCamera: a share of the heel as a roll)
function sail({ A = 0.35, T = 2.7, waveDeg = 70, windMs = 8.2, windDeg = 161, s = 16, flags = {} } = {}) {
  let B = null;
  const water = swell(A, T, waveDeg, () => (B ? B.t : 0));
  const wind = { sample: (x, z, t) => { const v = steadyWind(windMs, windDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  B = createBoatSim({ water, heightAt: () => -40, wind, flags });
  B.viewOf = () => 'follow';
  B.settle(20);
  const gust = createGust({ on: true });
  const view = mat4(), proj = mat4(), vp = mat4(), fwd = [0, 0, 1];
  const project = (p, w) => {   // world point (w 1) or direction (w 0) → [x, y] px
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12] * w, y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13] * w;
    const q = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15] * w;
    return [(x / q * 0.5 + 0.5) * W, (0.5 - y / q * 0.5) * H];
  };
  const rows = []; let star = null, side = null, level = null;
  for (let i = 0; i < s * HZ; i++) {
    B.step(1 / HZ, { steer: 0, pull: 0 });
    const c = gust.lean(1 / HZ, B.camera(1 / HZ), B.camState ?? B.state);
    const d = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]], l = Math.hypot(...d);
    fwd[0] = d[0] / l; fwd[1] = d[1] / l; fwd[2] = d[2] / l;
    lookDir(view, c.pos, fwd, c.up ?? [0, 1, 0]); perspectiveReversed(proj, c.fov * DEG, W / H, 0.5, 120000); multiply(vp, proj, view);
    if (!star) { const h = Math.hypot(fwd[0], fwd[2]); star = [fwd[0] / h * Math.cos(20 * DEG), Math.sin(20 * DEG), fwd[2] / h * Math.cos(20 * DEG)]; level = [fwd[0] / h, 0, fwd[2] / h]; const a = Math.atan2(fwd[0], -fwd[2]) + 30 * DEG; side = [Math.sin(a) * Math.cos(20 * DEG), Math.sin(20 * DEG), -Math.cos(a) * Math.cos(20 * DEG)]; }
    rows.push({ t: i / HZ, star: project(star, 0), side: project(side, 0), horizon: project(level, 0), deck: project(hullToWorld(B.pose, [0, 1, 0]), 1), fov: c.fov, sog: B.state.sog });
  }
  return rows;
}
// what is left of a series once its slow part (a 1.5 s centred mean: the chase's pan, a gust's breath) is taken out: the shake
const shake = (a) => a.map((v, i) => { const j0 = Math.max(0, i - 45), j1 = Math.min(a.length, i + 46); let m = 0; for (let j = j0; j < j1; j++) m += a[j]; return v - m / (j1 - j0); }).slice(45, -45);
const pp = (a) => Math.max(...a) - Math.min(...a);
const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

test('the Boat view in a 16 kn sea: the sky and the horizon hold still (no lens pumping, no aim swinging at the waves\' period); the boat still heaves on screen', () => {
  // swells of 1.8 to 5 s at a lake's steepness (H / λ = 0.044, at most 1 m high): the bigger sea's periods at 7–11 m/s (v2/notes/water.md)
  for (const T of [1.8, 2.7, 3.6, 5]) {
    const lam = G * T * T / (2 * Math.PI), r = sail({ T, A: Math.min(0.5, 0.022 * lam) });
    const sog = shake(r.map((x) => x.sog));
    assert.ok(pp(sog) > 0.4, `T ${T} s: the sea surges the boat (${pp(sog).toFixed(2)} m/s), or the test proves nothing`);
    const starY = shake(r.map((x) => x.star[1])), starX = shake(r.map((x) => x.star[0])), sideY = shake(r.map((x) => x.side[1])), hor = shake(r.map((x) => x.horizon[1])), fov = shake(r.map((x) => x.fov));
    const deck = shake(r.map((x) => x.deck[1]));
    const msg = `T ${T} s: star y pp ${pp(starY).toFixed(2)} px (sd ${sd(starY).toFixed(2)}), x pp ${pp(starX).toFixed(2)}, side y pp ${pp(sideY).toFixed(2)}, horizon pp ${pp(hor).toFixed(2)}, lens pp ${pp(fov).toFixed(3)}°, deck pp ${pp(deck).toFixed(1)} px`;
    assert.ok(pp(starY) < 1.5 && pp(starX) < 1.5 && pp(sideY) < 1.5, `the sky holds (its wave-period motion under 1.5 px at 720p; it was 3–8 px): ${msg}`);
    assert.ok(pp(hor) < 0.3, `the horizon holds: ${msg}`);
    assert.ok(pp(fov) < 0.12, `the lens holds: ${msg}`);
    if (T >= 2.7) assert.ok(pp(deck) > 5, `the boat still rides the waves on screen: ${msg}`);   // a 1.8 s wave is shorter than the hull: little heave
  }
});

test('the speed feel still breathes with a real change of speed (a gust\'s run-up): the lens widens as she speeds up for good', () => {
  const slow = sail({ windMs: 3.5, A: 0.1, s: 12 }), fast = sail({ windMs: 8.2, A: 0.1, s: 12 });
  const end = (r) => r.slice(-60).reduce((s, x) => s + x.fov, 0) / 60;
  assert.ok(end(fast) - end(slow) > 1.5, `wider at speed: ${end(slow).toFixed(2)}° → ${end(fast).toFixed(2)}°`);
});
