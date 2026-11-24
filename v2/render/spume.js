// v1's spume on v2's water (2026-11-14, BACKLOG-v2 #18's leftover; owner: "port it. It's a wind effect, so it shows in any
// strong wind, storm or fair"). v1's recipe (src/wind-cues.js whitecapAt, numbers from src/sim/windCues.js), unchanged:
//   spume = smoothstep(12, 17, U) × max(lane, 0) × smoothstep(0.3, 0.8, breaking) × 0.6,   foam = min(caps + spume, 1)
// where U is the wind (m/s), breaking the crest-fold measure (0..1) and lane v1's wind lanes (streakAt): two octaves of
// MaterialX 2-D Perlin noise stretched along the wind (2.2 m across × 30 m along, and a finer set at half that), the
// coordinates warped by a slow 70 m noise (± 6 m) so a lane meanders, drifting downwind at 3 % of the wind and re-forming
// over ≈ 20 s; gated in from 3 to 8 m/s. v1 draws the lanes into its look map (src/water-look.js: ± 128 m round a point
// 0.3 × 256 m ahead of the camera, faded from 78 to 96 % of its half side) and fades them where a lane would alias
// (laneVisibility: the footprint dist × pixel angle / √vy from 0.3 to 0.9 m, and grazing views under vy 0.025–0.09). v2
// evaluates the same lane per pixel, only where the spume can show (past 12 m/s, on a fold, inside the look square, before
// the fade): no map, no pass, nothing below the onset. So the spume is v1's: the whitecaps' foam, heavier along the lanes
// on the folding crests, in the wind's direction, in v1's foam colour (albedo 0.9 under the sky and the sun, shaded a little
// by the normal: v1's foamCol as the wake ports it, render/wake.js WAKE_FOAM; v2's own whitecaps keep their subtle 0.55).
//   The breaking measure (since #56 M1 merged): the water's own whitecap density, the fold's depth under M1's J0 (v1's
//   coverage rule: the turbulence's quantile at Monahan's share), and the spume adds to M1's whitecap foam in its look.
//   U: the local wind (sim/windTex.js, audit W1–W3), as v1's; the lanes run along it.
// The JS functions below are the WGSL's reference (v2/tests/spume.test.mjs; the GPU parity: v2/tests/pages/spume.page.mjs).
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { SPUME_ONSET, STREAK_ONSET } from '../../src/sim/windCues.js';
import { WHITECAP } from '../../src/sim/water-spectrum.js';

export const SPUME = Object.freeze({
  onset: SPUME_ONSET,            // m/s: [12, 17] (23–33 kn)
  laneOnset: STREAK_ONSET,       // m/s: [3, 8], the lanes' own gate
  crest: [0.3, 0.8],             // the breaking measure's ramp
  width: WHITECAP.width,         // v1's fold band under the threshold J0 (0.06)
  capOnset: WHITECAP.onset,      // m/s: [4, 8], v1's whitecaps' gate on the breaking measure
  gain: 0.6,                     // the spume's foam at full strength
  acrossM: 2.2, alongM: 30,      // a lane: across and along the wind (m)
  warpM: 70, warpAmp: 6,         // the meander: a 70 m noise, ± 6 m
  warpRate: 0.004, evolve: 0.02, // the meander's and the lanes' slow change (1/s)
  drift: 0.03,                   // the lanes drift downwind at 3 % of the wind (integrated: laneDrift)
  binDeg: 10,                    // the lane sets' fixed directions, this far apart; the local wind cross-fades the nearest two
  anchor: CURRENT_WATERS.terrain.bayCentre,   // the lanes' origin (v1's bay centre: fp32 keeps centimetres)
  look: { extentM: 256, ahead: 0.3, fade: [0.78, 0.96] },   // v1's look map square round a point ahead of the camera
  albedo: 0.9, shade: [0.8, 0.25],                          // v1's foam colour (as render/wake.js WAKE_FOAM)
  vis: { fp: [0.3, 0.9], vy: [0.025, 0.09] },               // v1's laneVisibility
});

// --- MaterialX 2-D Perlin noise (mx_noise.glsl's mx_perlin_noise_float, as three's TSL mx_noise_float runs it) ---
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
function bjfinal(a, b, c) {
  c = ((c ^ b) - rotl(b, 14)) >>> 0; a = ((a ^ c) - rotl(c, 11)) >>> 0; b = ((b ^ a) - rotl(a, 25)) >>> 0;
  c = ((c ^ b) - rotl(b, 16)) >>> 0; a = ((a ^ c) - rotl(c, 4)) >>> 0; b = ((b ^ a) - rotl(a, 14)) >>> 0;
  c = ((c ^ b) - rotl(b, 24)) >>> 0;
  return c;
}
const SEED2 = (0xdeadbeef + (2 << 2) + 13) >>> 0;
const hash2 = (x, y) => bjfinal((SEED2 + (x >>> 0)) >>> 0, (SEED2 + (y >>> 0)) >>> 0, SEED2);
const grad = (h, x, y) => { h &= 7; const u = h < 4 ? x : y, v = 2 * (h < 4 ? y : x); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function perlin2(px, py) {
  const X = Math.floor(px), Y = Math.floor(py), fx = px - X, fy = py - Y, u = fade(fx), v = fade(fy);
  const a = grad(hash2(X, Y), fx, fy), b = grad(hash2(X + 1, Y), fx - 1, fy);
  const c = grad(hash2(X, Y + 1), fx, fy - 1), d = grad(hash2(X + 1, Y + 1), fx - 1, fy - 1);
  return 0.6616 * ((1 - v) * (a * (1 - u) + b * u) + v * (c * (1 - u) + d * u));
}

import { smooth } from '../../src/sim/core/math.js';

// v1's streakAt at a rest point (x, z: world m), the wind U (m/s) travelling along `travelRad` (atan2(z, x)), t (s): −1..1.
// drift: the lanes' downwind drift so far, (x, z) m (the frame's integral of SPUME.drift × the wind: laneDrift below).
// fix (2026-11-24, the lanes ran 5–50 m/s across the water during a wind shift): v1's lanes are the pattern turned to the
// local wind about the bay centre, so a turn of dθ swept a lane at the boat sideways by its distance from the anchor × dθ
// (6 m/s at the Sail start in a 0.6°/s shift, 50 m/s 5 km out), and v1's drift t × U moved them by t × dU (minutes into a
// sail, a gust slid them tens of metres). Now each lane set lies along a fixed direction (SPUME.binDeg apart) and the
// local wind cross-fades the two nearest (variance kept): a turn fades one set into the next where it lies, and the drift
// is the water's own, integrated over the frames. Nothing moves faster than the surface drift.
function laneBin(rx, rz, a, t, drift) {
  const S = SPUME, wx = Math.cos(a), wz = Math.sin(a);
  const qx = rx / S.warpM, qz = rz / S.warpM;
  const r2x = rx + perlin2(qx + t * S.warpRate, qz) * S.warpAmp - drift[0], r2z = rz + perlin2(qz + 3.7, qx - t * S.warpRate) * S.warpAmp - drift[1];
  const along = r2x * wx + r2z * wz, across = -r2x * wz + r2z * wx;
  const ev = t * S.evolve;
  const nA = perlin2(across / S.acrossM + ev, along / S.alongM);
  const nB = perlin2(across / (S.acrossM * 0.5) + 7.3 - ev, along / (S.alongM * 0.5) + 2.1);
  return nA * 1.5 + nB * 0.6;
}
export function laneAt(x, z, U, travelRad, t, drift = [0, 0]) {
  const S = SPUME, Ue = Math.max(U, 0.1), step = S.binDeg * Math.PI / 180;
  const b = travelRad / step, k = Math.floor(b), w1 = b - k, w0 = 1 - w1;
  const rx = x - S.anchor[0], rz = z - S.anchor[1];
  const v = (laneBin(rx, rz, k * step, t, drift) * w0 + laneBin(rx, rz, (k + 1) * step, t, drift) * w1) / Math.sqrt(w0 * w0 + w1 * w1);
  return Math.min(1, Math.max(-1, v)) * smooth(S.laneOnset[0], S.laneOnset[1], Ue);
}
// the lanes' drift: SPUME.drift × the frame's wind (U m/s along travelRad) over dt sim s (at most 1 s a call) added into d ([x, z] m)
export function laneDrift(d, U, travelRad, dt) { const k = SPUME.drift * Math.max(U, 0) * Math.min(Math.max(dt, 0), 1); d[0] += Math.cos(travelRad) * k; d[1] += Math.sin(travelRad) * k; return d; }

// v1's laneVisibility × the look map's square: 1 near, 0 where a lane would alias or past the map.
// fpV: dist × the pixel's angle / √max(vy, 0.02) (m); vy: the view's vertical component; d: the point minus the look
// square's centre (m, x and z)
export function laneVis(fpV, vy, dx, dz) {
  const S = SPUME, r = Math.max(Math.abs(dx), Math.abs(dz)) / (S.look.extentM * 0.5);
  return (1 - smooth(S.vis.fp[0], S.vis.fp[1], fpV)) * smooth(S.vis.vy[0], S.vis.vy[1], vy) * (1 - smooth(S.look.fade[0], S.look.fade[1], r));
}

// v1's breaking measure: J the folds' sum, J0 the threshold (the quantile at Monahan's cover), U m/s → 0..1
export const breakingOf = (J, J0, U) => (1 - smooth(J0 - SPUME.width, J0, J)) * smooth(SPUME.capOnset[0], SPUME.capOnset[1], U);

// the spume's foam: U (m/s), breaking (0..1), lane (−1..1, already × laneVis)
export const spumeOf = (U, breaking, lane) => smooth(SPUME.onset[0], SPUME.onset[1], U) * Math.max(lane, 0) * smooth(SPUME.crest[0], SPUME.crest[1], breaking) * SPUME.gain;

const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
// the WGSL (needs the frame uniform F, its spume row: J0, on): the noise, the lanes, v1's breaking, the footprint and the lanes'
// fade, the spume (render/windWater.js's whitecaps call spumeOf with the lanes the water draws)
export const SPUME_WGSL = `
fn spRot(x: u32, k: u32) -> u32 { return (x << k) | (x >> (32u - k)); }
fn spHash(x: i32, y: i32) -> u32 {
  let s = 0xdeadbeefu + (2u << 2u) + 13u;
  var a = s + bitcast<u32>(x); var b = s + bitcast<u32>(y); var c = s;
  c = (c ^ b) - spRot(b, 14u); a = (a ^ c) - spRot(c, 11u); b = (b ^ a) - spRot(a, 25u);
  c = (c ^ b) - spRot(b, 16u); a = (a ^ c) - spRot(c, 4u); b = (b ^ a) - spRot(a, 14u);
  c = (c ^ b) - spRot(b, 24u);
  return c;
}
fn spGrad(hh: u32, x: f32, y: f32) -> f32 {
  let h = hh & 7u; let u = select(y, x, h < 4u); let v = 2.0 * select(x, y, h < 4u);
  return select(u, -u, (h & 1u) != 0u) + select(v, -v, (h & 2u) != 0u);
}
fn spFade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn spNoise(p: vec2f) -> f32 {   // MaterialX's 2-D Perlin (v1's mx_noise_float)
  let fl = floor(p); let X = i32(fl.x); let Y = i32(fl.y); let fx = p.x - fl.x; let fy = p.y - fl.y;
  let u = spFade(fx); let v = spFade(fy);
  let a = spGrad(spHash(X, Y), fx, fy); let b = spGrad(spHash(X + 1, Y), fx - 1.0, fy);
  let c = spGrad(spHash(X, Y + 1), fx, fy - 1.0); let d = spGrad(spHash(X + 1, Y + 1), fx - 1.0, fy - 1.0);
  return 0.6616 * ((1.0 - v) * (a * (1.0 - u) + b * u) + v * (c * (1.0 - u) + d * u));
}
// v1's streakAt (src/wind-cues.js): the lanes along the wind, −1..1; drift: the lanes' drift so far (m, F.spume.zw). Two lane
// sets on fixed directions ${SPUME.binDeg}° apart, cross-faded by the local wind (laneAt above: no set turns, none sweeps)
fn spLaneBin(r: vec2f, a: f32, t: f32, drift: vec2f) -> f32 {
  let wd = vec2f(cos(a), sin(a));
  let q = r / ${f(SPUME.warpM)};
  let r2 = r + vec2f(spNoise(vec2f(q.x + t * ${SPUME.warpRate}, q.y)), spNoise(vec2f(q.y + 3.7, q.x - t * ${SPUME.warpRate}))) * ${f(SPUME.warpAmp)} - drift;
  let along = dot(r2, wd); let across = dot(r2, vec2f(-wd.y, wd.x));
  let ev = t * ${SPUME.evolve};
  let nA = spNoise(vec2f(across / ${f(SPUME.acrossM)} + ev, along / ${f(SPUME.alongM)}));
  let nB = spNoise(vec2f(across / ${f(SPUME.acrossM * 0.5)} + 7.3 - ev, along / ${f(SPUME.alongM * 0.5)} + 2.1));
  return nA * 1.5 + nB * 0.6;
}
fn spLane(xz: vec2f, U0: f32, travel: f32, t: f32, drift: vec2f) -> f32 {
  let U = max(U0, 0.1); let step = ${(SPUME.binDeg * Math.PI / 180).toFixed(8)};
  let b = travel / step; let k = floor(b); let w1 = b - k; let w0 = 1.0 - w1;
  let r = xz - vec2f(${f(SPUME.anchor[0])}, ${f(SPUME.anchor[1])});
  let v = (spLaneBin(r, k * step, t, drift) * w0 + spLaneBin(r, (k + 1.0) * step, t, drift) * w1) / sqrt(w0 * w0 + w1 * w1);
  return clamp(v, -1.0, 1.0) * smoothstep(${f(SPUME.laneOnset[0])}, ${f(SPUME.laneOnset[1])}, U);
}
// v1's foam colour: albedo 0.9 under the sky's and the sun's light, shaded a little by the normal n against the sun s
fn spumeColour(n: vec3f, s: vec3f, eSky: vec3f, eSun: vec3f) -> vec3f {
  return ${SPUME.albedo} * (eSky + eSun) / PI * (${SPUME.shade[0]} + ${SPUME.shade[1]} * max(dot(n, s), 0.0));
}
// the footprint as v1 measures it (dist × the pixel's angle, 2 / (P11 × height), / √vy) and v1's laneVisibility × the look
// map's square (${SPUME.look.extentM} m round the point ${SPUME.look.ahead} × its side ahead of the camera; the view's forward is the reversed
// projection's w row of viewProj): 1 near, 0 where a lane would alias or past the map
fn v1Footprint(toEye: vec3f) -> f32 {
  let dist = length(toEye); let vy = toEye.y / max(dist, 1e-3);
  let p11 = length(vec3f(F.viewProj[0][1], F.viewProj[1][1], F.viewProj[2][1]));
  return dist * 2.0 / (p11 * F.res.y) / sqrt(max(vy, 0.02));
}
fn laneVisAt(rest: vec2f, toEye: vec3f, fpV: f32) -> f32 {
  let fw = vec2f(F.viewProj[0][3], F.viewProj[2][3]); let fl = max(length(fw), 1e-4);
  let d = rest - (F.cam.xz + fw / fl * ${f(SPUME.look.extentM * SPUME.look.ahead)});
  let rr = max(abs(d.x), abs(d.y)) / ${f(SPUME.look.extentM * 0.5)};
  let vy = toEye.y / max(length(toEye), 1e-3);
  return (1.0 - smoothstep(${f(SPUME.vis.fp[0])}, ${f(SPUME.vis.fp[1])}, fpV)) * smoothstep(${SPUME.vis.vy[0]}, ${SPUME.vis.vy[1]}, vy) * (1.0 - smoothstep(${SPUME.look.fade[0]}, ${SPUME.look.fade[1]}, rr));
}
// the spume: localU the local wind (m/s), crest v1's breaking 0..1, lane the lanes as drawn (signed); F.spume.y: on (the A/B)
fn spumeOf(localU: f32, crest: f32, lane: f32) -> f32 {
  return smoothstep(${f(SPUME.onset[0])}, ${f(SPUME.onset[1])}, localU) * F.spume.y * max(lane, 0.0) * smoothstep(${f(SPUME.crest[0])}, ${f(SPUME.crest[1])}, crest) * ${f(SPUME.gain)};
}`;
