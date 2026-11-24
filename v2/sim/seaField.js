// The sea across the lake (BACKLOG-v2 #25) and the shallows' calm (#21), 2026-11-14. v2 runs one FFT whose table is v1's sea
// at the boat (spectrum.js composeSea); v1 mixes its sea per point (src/water.js mulOf, effHs, ultraDamp: the open lake builds
// bigger, a bay's lee stays calm, the long swell dies under 14 m and the chop under 2 m). Here, at the lowest cost: a coarse
// fetch map over the lake (128², 312 m cells, r16float, traced upwind on a 512² land mask, rebuilt only when the wind's
// direction moves 2° as v1's setFetch) and a 64-byte uniform; the water's vertex shader turns them into a gain per cascade
// (seaGains below), the ratio of v1's sea at the point to v1's sea at the boat (energy-matched per tile, the boat's own
// sea at the map's value there so the gain at the boat is exactly 1: the near water keeps the feel the owner tuned), times
// v1's depth damping. The CPU twin (gainsAt) gives the readback surface the same gains, so the hull floats on what is drawn.
// Pure: node tests run it on v1's heights.
//   const S = createSeaField({ heightAt });     heightAt(x, z) → m above the lake (land ≥ 0)
//   S.update(travelRad, budget) → true when a new map is ready (upload S.half)   budget: cells this call (Infinity: all)
//   S.setRef({ U, T, wt, x, z })   the boat's sea this frame (the uniform's numbers; T the tables, wt their weights)
//   S.gainsAt(x, z, depth, out)    out[0..3]: the four cascades' gains (the CPU twin of seaGains)
//   S.uniform                      Float32Array(16), FIELD_BYTES
import { hsLaw, V1_SEA, tileEnergies } from './spectrum.js';
import { DAMP } from './surface.js';

const G = 9.81;
export const FIELD = Object.freeze({ cx: 4000, cz: -15000, extent: 40000, n: 128, maskN: 512, maxM: V1_SEA.fetchMaxM,
  rmax: 20,            // the largest gain a tile takes (the open lake seen from a bay's lee: Hs about 3 ×; the long tile's ratio is larger)
  turnRad: 2 * Math.PI / 180 });   // v1's setFetch: a new map when the wind's direction moves 2°
export const FIELD_FLOATS = 16, FIELD_BYTES = FIELD_FLOATS * 4;

// f16 (the map's texture format): the CPU twin reads the same rounded values the GPU samples
const f32b = new Float32Array(1), u32b = new Uint32Array(f32b.buffer);
export function toHalf(v) {
  f32b[0] = v; const x = u32b[0], sign = (x >>> 16) & 0x8000, m = x & 0x7fffff; let e = ((x >>> 23) & 0xff) - 112;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) { if (e < -10) return sign; const mm = m | 0x800000, sh = 14 - e; return sign | ((mm + (1 << (sh - 1))) >> sh); }
  let h = sign | (e << 10) | (m >> 13);
  if (m & 0x1000) h++;
  return h;
}
export function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

import { smooth } from '../../src/sim/core/math.js';
// each displacement tile's raw energy in the two tables: spectrum.js tileEnergies (cached; re-exported here)
export { tileEnergies };

// v1's per-point sea (spectrum.js seaWeights, allocation-free): the tiles' lake weights and the bay weight at a point of fetch F
// (m) for the wind U (m/s), the open lake's swell through the mouth (swellHs at the mouth, m). out: [L0, L1, L2, Bw]
export function pointWeights(U, F, x, z, hsRef, hsBay, swellHs, out) {
  const M = V1_SEA.mouth, u = Math.max(U, 0.1);
  const loc = Math.min(Math.sqrt(Math.max(F, 1) / G) * u * 0.0016, u * u * 0.21 / G);
  const t = (x - M.bx) * M.ax + (z - M.bz) * M.az, sw = swellHs * (t < 0 ? Math.exp(-Math.hypot(x - M.bx, z - M.bz) / M.decayM) : 1);
  const m = Math.min(1.5, Math.sqrt(loc * loc + sw * sw) / Math.max(hsRef, 1e-3));
  const beta = 1 - smooth(0.35, 0.8, m), feel = V1_SEA.feelLake + (V1_SEA.feelBay - V1_SEA.feelLake) * beta;
  const sB = Math.min(1.4, loc / Math.max(hsBay, 1e-3)) * V1_SEA.bayGain;
  out[0] = m * m * m * feel; out[1] = Math.pow(m, 1.6) * (1 - beta) * feel; out[2] = (1 + 0.7 * (1 - Math.min(m, 1))) * (1 - beta) * feel; out[3] = beta * sB * feel;
  return out;
}

export function createSeaField({ heightAt, field = FIELD } = {}) {
  const { cx, cz, extent, n, maskN, maxM } = field;
  const mask = new Uint8Array(maskN * maskN);
  const fetch = new Float32Array(n * n), pend = new Float32Array(n * n), half = new Uint16Array(n * n);
  const uniform = new Float32Array(FIELD_FLOATS);
  let maskRow = 0, maskDone = false, building = false, row = 0, cellInRow = 0, ready = false, mapTravel = null, wantTravel = 0, version = 0;
  const step = extent / maskN;
  const land = (x, z) => {
    const i = Math.floor(((x - cx) / extent + 0.5) * maskN), j = Math.floor(((z - cz) / extent + 0.5) * maskN);
    return i < 0 || j < 0 || i >= maskN || j >= maskN ? 1 : mask[j * maskN + i];
  };
  // the fetch at a map cell's centre: the distance upwind to the mask's first land (one mask cell a step), capped at v1's 20 km
  function trace(x, z, dx, dz) {
    if (land(x, z)) return 0;
    for (let s = step; s < maxM; s += step) if (land(x - dx * s, z - dz * s)) return s;
    return maxM;
  }
  const at = (i, k) => (i + 0.5) / k * extent - extent / 2;
  // budget: work units this call (a mask row is maskN units, a map cell about maxM / step / 4)
  function update(travelRad, budget = Infinity) {
    let left = budget;
    while (!maskDone && left > 0) {
      const z = cz + at(maskRow, maskN);
      for (let i = 0; i < maskN; i++) mask[maskRow * maskN + i] = heightAt(cx + at(i, maskN), z) >= 0 ? 1 : 0;
      left -= maskN;
      if (++maskRow >= maskN) { maskDone = true; building = false; }
    }
    if (!maskDone) return false;
    const turned = mapTravel == null || Math.abs(Math.atan2(Math.sin(travelRad - mapTravel), Math.cos(travelRad - mapTravel))) >= field.turnRad;
    if (!building && turned) { building = true; row = 0; cellInRow = 0; wantTravel = travelRad; }
    if (!building) return false;
    const dx = Math.cos(wantTravel), dz = Math.sin(wantTravel), cost = Math.max(1, maxM / step / 4);
    while (left > 0 && row < n) {
      const z = cz + at(row, n);
      for (; cellInRow < n && left > 0; cellInRow++, left -= cost) pend[row * n + cellInRow] = trace(cx + at(cellInRow, n), z, dx, dz);
      if (cellInRow >= n) { cellInRow = 0; row++; }
    }
    if (row < n) return false;
    for (let i = 0; i < n * n; i++) { half[i] = toHalf(pend[i]); fetch[i] = fromHalf(half[i]); }
    building = false; ready = true; mapTravel = wantTravel; version++;
    return true;
  }
  // a new land mask (the terrain's finer grids came in): the mask and then the map are rebuilt; the old map stands meanwhile
  function invalidate() { maskRow = 0; maskDone = false; building = false; mapTravel = null; }
  // the map's fetch at (x, z), bilinear as the GPU's linear sample (texel centres at (i + 0.5) / n; the edges clamp: they are land)
  function fetchAt(x, z) {
    const fx = ((x - cx) / extent + 0.5) * n - 0.5, fz = ((z - cz) / extent + 0.5) * n - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
    const a = fetch[j * n + i], b = fetch[j * n + i + 1], c = fetch[(j + 1) * n + i], d = fetch[(j + 1) * n + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  // the boat's sea this frame: U the water's wind (m/s), T the tables (hL, hB, gL, gB), wt their weights as composed (lake[c],
  // bay: spectrum.js seaWeights × the Hs law's ratios), (x, z) the boat. The ratio's reference is v1's sea at the boat with the
  // map's fetch there, so the gain at the boat is 1 whatever the map's resolution
  const wRef = [0, 0, 0, 0];
  function setRef({ U, T, rL = 1, rB = 1, x, z }) {
    const S = V1_SEA, hsRef = hsLaw(U, S.lakeFetchKm * 1000), hsBay = hsLaw(U, S.bayFetchKm * 1000);
    const swellHs = hsRef * S.mouth.swell * Math.min(1, Math.max(0, (Math.max(U, 0.1) - 9) / 6));
    const E = tileEnergies(T), gl = T.gL * rL, gb = T.gB * rB;
    pointWeights(U, ready ? fetchAt(x, z) : 0, x, z, hsRef, hsBay, swellHs, wRef);
    uniform[0] = U; uniform[1] = hsRef; uniform[2] = hsBay; uniform[3] = swellHs;
    for (let c = 0; c < 3; c++) {
      const eL = E.L[c] * gl * gl, eB = E.B[c] * gb * gb, D = Math.max(wRef[c] * wRef[c] * eL + wRef[3] * wRef[3] * eB, 1e-30);
      uniform[4 + c] = eL / D; uniform[8 + c] = eB / D;
    }
    uniform[7] = ready ? 1 : 0; uniform[11] = field.rmax;
    uniform[12] = cx; uniform[13] = cz; uniform[14] = 1 / extent; uniform[15] = api.off ? 1 : 0;
    return uniform;
  }
  // the four cascades' gains at (x, z) over `depth` m of water (the CPU twin of seaGains): v1's damping × the ratio of v1's sea
  // here to the boat's (1 until the first map and reference are in)
  const wP = [0, 0, 0, 0];
  function gainsAt(x, z, depth, out) {
    if (api.off) { out[0] = out[1] = out[2] = 1; if (out.length > 3) out[3] = 1; return out; }
    const swell = smooth(DAMP.swell[0], DAMP.swell[1], depth), chop = smooth(DAMP.chop[0], DAMP.chop[1], depth);
    let r0 = 1, r1 = 1, r2 = 1;
    if (uniform[7] > 0.5) {
      pointWeights(uniform[0], fetchAt(x, z), x, z, uniform[1], uniform[2], uniform[3], wP);
      const B2 = wP[3] * wP[3], rm = uniform[11];
      r0 = Math.min(Math.sqrt(wP[0] * wP[0] * uniform[4] + B2 * uniform[8]), rm);
      r1 = Math.min(Math.sqrt(wP[1] * wP[1] * uniform[5] + B2 * uniform[9]), rm);
      r2 = Math.min(Math.sqrt(wP[2] * wP[2] * uniform[6] + B2 * uniform[10]), rm);
    }
    out[0] = r0 * swell; out[1] = r1 * chop; out[2] = r2 * chop; if (out.length > 3) out[3] = chop;
    return out;
  }
  // off: the A/B's switch (tools/v2-ab-sea.mjs): the shader skips the field and the depth (every gain 1, the old water), the CPU too
  const api = { field, mask, fetch, half, uniform, update, invalidate, fetchAt, setRef, gainsAt, land, off: false,
    get ready() { return ready; }, get version() { return version; }, get building() { return building || !maskDone; } };
  return api;
}

// the shader's side (render/water.js: the draw group's bindings b (the uniform) and b + 1 (the map), the vertex stage; sRep is
// the water's repeat sampler: the map's edges are land, so the repeat never shows). seaGains(x, z, depth) → the four cascades' gains
const M = V1_SEA.mouth;
export const SEA_FIELD_WGSL = (b) => `struct SeaField { a: vec4f, l: vec4f, b: vec4f, map: vec4f }
@group(2) @binding(${b}) var<uniform> SF: SeaField;
@group(2) @binding(${b + 1}) var tFetch: texture_2d<f32>;
fn sfSmooth(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// v1's damping by depth (swell, chop): the long swell dies under 14 m, the chop under 2 m
fn seaDamp(depth: f32) -> vec2f { return vec2f(sfSmooth(${DAMP.swell[0].toFixed(1)}, ${DAMP.swell[1].toFixed(1)}, depth), sfSmooth(${DAMP.chop[0].toFixed(1)}, ${DAMP.chop[1].toFixed(1)}, depth)); }
fn seaGains(x: f32, z: f32, dmp: vec2f) -> vec4f { var s = vec3f(-1.0); return seaGainsShare(x, z, dmp, &s); }
// #56 M1: the same, and each displacement tile's share of the bay sim's energy here into *share (left as it was without a
// map): render/water.js draws the bay's slopes steeper (v1's BAY_SLOPE)
fn seaGainsShare(x: f32, z: f32, dmp: vec2f, share: ptr<function, vec3f>) -> vec4f {
  var r = vec3f(1.0);
  if (SF.l.w > 0.5) {
    let F = textureSampleLevel(tFetch, sRep, vec2f((x - SF.map.x) * SF.map.z + 0.5, (z - SF.map.y) * SF.map.z + 0.5), 0.0).r;
    let U = max(SF.a.x, 0.1);
    let loc = min(sqrt(max(F, 1.0) / ${G}) * U * 0.0016, U * U * ${(0.21 / G).toFixed(8)});
    let dm = vec2f(x - ${M.bx.toFixed(1)}, z - ${M.bz.toFixed(1)});
    var sw = SF.a.w; if (dm.x * ${M.ax} + dm.y * ${M.az} < 0.0) { sw *= exp(-length(dm) / ${M.decayM.toFixed(1)}); }
    let m = min(1.5, sqrt(loc * loc + sw * sw) / max(SF.a.y, 1e-3));
    let beta = 1.0 - sfSmooth(0.35, 0.8, m); let feel = ${V1_SEA.feelLake.toFixed(2)} + ${(V1_SEA.feelBay - V1_SEA.feelLake).toFixed(2)} * beta;
    let sB = min(1.4, loc / max(SF.a.z, 1e-3)) * ${V1_SEA.bayGain.toFixed(2)};
    let L = vec3f(m * m * m, pow(m, 1.6) * (1.0 - beta), (1.0 + 0.7 * (1.0 - min(m, 1.0))) * (1.0 - beta)) * feel;
    let Bw = beta * sB * feel;
    let eB = Bw * Bw * SF.b.xyz; let eT = L * L * SF.l.xyz + eB;
    r = min(sqrt(eT), vec3f(SF.b.w));
    *share = eB / max(eT, vec3f(1e-12));
  }
  return vec4f(r.x * dmp.x, r.y * dmp.y, r.z * dmp.y, dmp.y);
}`;
