// The storm's driver on the one wind field (wow/storm;: wind is one module, every effect reads it). Plain JS.
// The outflow is one of the field's modifiers (src/wind-modifiers.js stormOutflow): src/wind.js runs it in sample() and
// toTexture() when a storm is set (field.storm, plain data: the worker gets it with the field's state,
// src/wind-texture.js), so the boat, the water's roughness and gust look, the flags and the sails all feel the same
// outflow.
//
// What the outflow does at a point (x, z) and scene time t (state: { s0, t0, rate, ref: [x, z], seed }):
//   ahead of the front   a lull (the calm before it), × 0.82 at most, within ≈ 1.5 km of the line
//   the front            a gust line ≈ 140 m deep, × 1.55 more: the dark band crossing the water, ragged along its length
//   behind it            × 1.45, gusty (± 30 % in cells ≈ 250 m across, carried downwind), veered toward the outflow's
//                        direction (from the WSW, 250°) by up to 85 %
// all scaled by the arc's front envelope (0 before ≈ 50 s, gone by ≈ 260 s). No storm: wind.js never calls this.
import { arcTime, arcAt, FRONT, CELL, smooth, dirOf, fromDegOf } from './stormArc.js';

const OUTFLOW = { edge: 0.55, behind: 0.45, lull: 0.18, gusty: 0.3, veer: 0.85, cellM: 250 };

const hash2 = (i, j, seed) => {
  let h = (i * 374761393 + j * 668265263 + seed * 1442695041) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// a smooth value noise in [−1, 1] (bilinear, smoothstep weights)
function vnoise(x, z, seed) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return ((a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv) * 2 - 1;
}

// the front's position along DIR from the reference (m) at arc seconds s
export const frontAlong = (s) => (s - FRONT.atS) * FRONT.speedMs;

// { gain, fromDeg, w }: the speed factor, the direction the outflow blows from and how far the wind turns to it (0–1).
// stormWindFrameInto(state, t) does the per-frame part once and returns (x, z, o) → o, that written into o (no
// allocation per point: toTexture runs 65,536 texels a frame); stormWindFrame(state, t) returns (x, z) → a new object.
const CALM = { gain: 1, fromDeg: CELL.fromDeg, w: 0 };
export function stormWindFrameInto(state, t) {
  const s = arcTime(state, t), DIR = dirOf(state), fromDeg = fromDegOf(DIR);   // the drift: the state's steering (v2), else v1's fixed one
  const env = arcAt(s, state.ref, state.ref, DIR).front;
  if (env <= 0) return (x, z, o) => { o.gain = CALM.gain; o.fromDeg = fromDeg; o.w = CALM.w; return o; };
  const fa = frontAlong(s), drift = (s - FRONT.atS) * 14, seed = state.seed ?? 1, [rx, rz] = state.ref;
  return (x, z, o) => {
    const dx0 = x - rx, dz0 = z - rz;
    const a = dx0 * DIR[0] + dz0 * DIR[1], c = -dx0 * DIR[1] + dz0 * DIR[0];
    // ahead of the front (m, > 0 not yet reached), the line ragged along its length
    const dx = a - fa + 60 * Math.sin(c / 310 + 1.3) + 35 * Math.sin(c / 130 - 0.4);
    const edge = Math.exp(-((dx / FRONT.widthM) ** 2));
    const behind = 1 - smooth(-30, 60, dx);
    const ahead = smooth(0, 200, dx) * (1 - smooth(600, 1800, dx));
    // the gusts behind the line: cells carried downwind at the outflow's speed (the noise in the drifting frame)
    const g = behind > 0 ? vnoise((a - drift) / OUTFLOW.cellM, c / OUTFLOW.cellM, seed + 17)
      + 0.5 * vnoise((a - drift) / (OUTFLOW.cellM * 0.4), c / (OUTFLOW.cellM * 0.4), seed + 29) : 0;
    const gain = 1 + env * (OUTFLOW.edge * edge + OUTFLOW.behind * behind * (1 + OUTFLOW.gusty * g / 1.5) - OUTFLOW.lull * ahead);
    o.gain = Math.max(0.2, gain); o.fromDeg = fromDeg; o.w = env * OUTFLOW.veer * Math.max(behind, edge * 0.6);
    return o;
  };
}
function stormWindFrame(state, t) {
  const at = stormWindFrameInto(state, t);
  return (x, z) => at(x, z, {});
}
export const stormWindAt = (state, x, z, t) => stormWindFrame(state, t)(x, z);

// the wind vector (vx, vz, m/s) turned toward the outflow and scaled: the field's own flow after its terrain (a strong
// outflow runs over the bay's lee), so no new terrain bins are needed
const DEG = Math.PI / 180;
export const applyStorm = (vx, vz, f) => applyStormInto(vx, vz, f, [0, 0]);
// the same, written into out ([vx, vz]; no allocation)
export function applyStormInto(vx, vz, f, out) {
  if (f.gain === 1 && f.w === 0) { out[0] = vx; out[1] = vz; return out; }
  const sp = Math.hypot(vx, vz);
  if (sp < 1e-9) { const k = f.w * 3 * f.gain; out[0] = -Math.sin(f.fromDeg * DEG) * k; out[1] = Math.cos(f.fromDeg * DEG) * k; return out; }
  // the current FROM direction, turned by w of the way to the outflow's (the short way round)
  const from = Math.atan2(-vx, vz) / DEG;   // as src/wind.js: toward = (−sin, cos) of the FROM bearing
  const d = ((((f.fromDeg - from) % 360) + 540) % 360) - 180;
  const to = (from + d * f.w) * DEG, out0 = sp * f.gain;
  out[0] = -Math.sin(to) * out0; out[1] = Math.cos(to) * out0;
  return out;
}
