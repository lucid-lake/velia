// #56 M3, the shore (2026-11-14): the breakers, the swash on the sand and the spray, on the shore field baked offline
// (v2/sim/shoreField.js, tools/v2-shore-bake.mjs; v2/assets/shore/shore.vsf.gz, streamed after the first frame). The wave model
// is Ultra-Water's (src/water/OceanSurface.js SHORE_GLSL, shoreWaves, SWASH_GLSL; src/water/Spray.js), ported to WGSL on a
// lake's numbers:
//   Ultra-Water, https://github.com/Humpalumps/Ultra-Water @ ce9248f, copyright (c) 2026 Humpalumps, MIT License
//   (src/waters/ultra/LICENSE; ATTRIBUTION.md). The permission notice applies to the ported shore waves, swash and spray below.
// The JS twins (sim/shoreField.js shoreWaves, swash) are the same maths, line for line; v2/tests/shore.test.mjs holds them.
//   The field rides in one storage buffer (the water's fragment stage is at WebGPU's 16 sampled textures): the params a frame
//   (128 words), the header, the tile index (u16 pairs), 2 words a texel of the kept 32 m tiles, the spray's emitters.
//   The water reads it at render/water.js SHORE_BINDING (vertex: the trains' displacement and the film lifted over the sand;
//   fragment: the trains' slopes, the breaking foam on M1's foam, the swash, the wet sand). Nothing near a shore in view: the
//   params' on word is 0 and both stages skip it in one uniform branch (0 ms); a pixel off the band skips it on its depth.
//   S = createShore({ device, reg, frameBGL, frameBG, U, frameStruct, sky, terrainBGL, hdrTarget, msaa, depthFormat }); S.setLite(b): the phone's
//   path (the lite water: one train, no lean, lace or spray)
//   S.load() after the first frame; await S.prime() in a capture; S.update({ eye, viewProj, wind }) a frame; S.drawSpray(pass, c, terrainBG)
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { TERRAIN_BIND, TERRAIN_HEIGHT } from './terrain.js';
import { inflate } from '../terrain/decode.js';
import { frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { decodeShore, gpuWords, gpuLayout, SHORE, SHORE_BAKE, PARAM_WORDS, TILE_TEXELS, Q6, shoreParams } from '../sim/shoreField.js';
import { hsLaw, V1_SEA, seaState } from '../sim/spectrum.js';

export const SHORE_FILE = new URL('../assets/shore/shore.vsf.gz', import.meta.url);
// the field follows the start's detail level (South Lake's look): a page that starts on a region level (v2/terrain/region.js)
// fetches that level's own bake (tools/v2-shore-bake.mjs --region south) in place of the bay's; a start in the bay fetches
// the bay's alone, as before. shoreFile(levelKey) → the URL
export const SHORE_FILES = Object.freeze({ bay: SHORE_FILE, 'south-lake': new URL('../assets/shore/shore-south.vsf.gz', import.meta.url) });   // by the level's key (the region's id); the file by the level's folder
export const shoreFile = (levelKey) => SHORE_FILES[levelKey] ?? SHORE_FILE;
export const SHORE_CAP = 4 << 20;   // bytes: the buffer, made at load (the field is ≈ 2.9 MB of words; v2/tests/shore.test.mjs checks it fits)
// the south level's field holds 2,866 tiles (the Keys' canals and the marshes count as shore): 5.9 MB of words, so its buffer is 8 MB
export const SHORE_CAPS = Object.freeze({ bay: SHORE_CAP, 'south-lake': 8 << 20 });
export const shoreCap = (levelKey) => SHORE_CAPS[levelKey] ?? SHORE_CAP;
// the params' words (f32 unless marked): on (0 | 1: 0 skips everything), w0, w1, f0, f1, the wind's travel x, z, the spray's
// share, the bay's Hs (the spray's sea), parts (u32 bits: 1 second train, 2 lean, 4 lace), the whitewater's wind share, 0 …; from word 16: the spray's near
// tiles: count (u32), instances (u32), then per tile (its place I | J << 16, first emitter, count, the instances before it)
export const P = Object.freeze({ on: 0, w0: 1, w1: 2, f0: 3, f1: 4, dirX: 5, dirZ: 6, spray: 7, hsBay: 8, parts: 9, white: 10, near: 16, nearN: 16, nearI: 17, list: 18 });
export const PARTS = Object.freeze({ second: 1, lean: 2, lace: 4 });

// --- the WGSL the water includes (b: the binding in the water's group 2) ---
export const SHORE_READ_WGSL = (b, lite = false) => `
@group(2) @binding(${b}) var<storage, read> SH: array<u32>;
const SH_H = ${PARAM_WORDS}u;
const SH_DIN = ${SHORE.dIn.toFixed(2)}; const SH_LAND = ${SHORE.landMax.toFixed(2)}; const SH_G = 9.81;
const SH_AMP = ${SHORE.ampK.toFixed(3)}; const SH_SECOND = ${SHORE.second.toFixed(3)}; const SH_GAMMA = ${SHORE.gamma.toFixed(3)};
const SH_BLO = ${SHORE.breakLo.toFixed(3)}; const SH_BA0 = ${SHORE.breakAmp[0].toFixed(4)}; const SH_BA1 = ${SHORE.breakAmp[1].toFixed(4)};
const SH_LEE = ${SHORE.lee.toFixed(3)}; const SH_GR0 = ${SHORE.group[0].toFixed(3)}; const SH_GR1 = ${SHORE.group[1].toFixed(3)};
const SH_STEEP = ${SHORE.steep.toFixed(3)}; const SH_R0 = ${SHORE.runup[0].toFixed(3)}; const SH_R1 = ${SHORE.runup[1].toFixed(3)};
const SH_DRY = ${SHORE.dryS.toFixed(2)}; const SH_DMIN = ${SHORE_BAKE.dMin.toFixed(3)}; const SH_Q6 = ${Q6}.0;
fn shF(i: u32) -> f32 { return bitcast<f32>(SH[i]); }
fn shOn() -> bool { return SH[0] != 0u; }
fn shPart(bit: u32) -> bool { return (SH[${P.parts}u] & bit) != 0u; }
// Ultra's hash12 and value noise (sim/shoreField.js hash12, vnoise)
fn shHash(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn shNoise(p: vec2f) -> f32 {
  let i = floor(p); let f = p - i; let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(shHash(i), shHash(i + vec2f(1.0, 0.0)), u.x), mix(shHash(i + vec2f(0.0, 1.0)), shHash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn shPhase(xz: vec2f) -> f32 { return shNoise(xz * 0.011) * 7.0 + shNoise(xz * 0.031 + 7.0) * 2.2; }
fn shGroup(xz: vec2f, t: f32) -> f32 { return SH_GR0 + SH_GR1 * shNoise(vec2f(xz.x * 0.012 + t * 0.061, xz.y * 0.012 - t * 0.047)); }
fn shExpo(dir: vec2f) -> f32 { return SH_LEE + (1.0 - SH_LEE) * smoothstep(-0.2, 0.7, dot(dir, vec2f(shF(${P.dirX}u), shF(${P.dirZ}u)))); }
struct ShTex { t0: f32, t1: f32, dir: vec2f, rt: f32, beta: f32, fade: f32 }
// one texel of the field into o (weight w); w back if the texel's tile is kept, else 0
fn shTexel(i: i32, j: i32, o: ptr<function, ShTex>, w: f32) -> f32 {
  if (i < 0 || j < 0 || w <= 0.0) { return 0.0; }
  let ti = u32(i) >> 4u; let tj = u32(j) >> 4u;
  if (ti >= SH[SH_H + 4u] || tj >= SH[SH_H + 5u]) { return 0.0; }
  let cell = tj * SH[SH_H + 4u] + ti;
  let slot = (SH[SH[SH_H + 6u] + (cell >> 1u)] >> ((cell & 1u) * 16u)) & 0xffffu;
  if (slot == 0u) { return 0.0; }
  let k = SH[SH_H + 7u] + 2u * ((slot - 1u) * ${TILE_TEXELS}u + (u32(j) & 15u) * 16u + (u32(i) & 15u));
  let a = SH[k]; let b = SH[k + 1u];
  let ang = f32(b & 255u) * ${(2 * Math.PI / 256).toFixed(8)};
  (*o).t0 += w * f32(a & 0xffffu); (*o).t1 += w * f32(a >> 16u);
  (*o).dir += w * vec2f(cos(ang), sin(ang));
  (*o).rt += w * f32((b >> 8u) & 255u); (*o).beta += w * f32((b >> 16u) & 255u); (*o).fade += w * f32(b >> 24u);
  return w;
}
// the field at xz, bilinear over the kept texels (sim/shoreField.js sampleShore); fade 0 where there is none
fn shoreTex(xz: vec2f) -> ShTex {
  var o: ShTex;
  let g = (xz - vec2f(shF(SH_H), shF(SH_H + 1u))) * shF(SH_H + 2u) - 0.5;
  let gi = floor(g); let f = g - gi; let i0 = vec2i(gi);
  var ws = shTexel(i0.x, i0.y, &o, (1.0 - f.x) * (1.0 - f.y));
  ws += shTexel(i0.x + 1, i0.y, &o, f.x * (1.0 - f.y));
  ws += shTexel(i0.x, i0.y + 1, &o, (1.0 - f.x) * f.y);
  ws += shTexel(i0.x + 1, i0.y + 1, &o, f.x * f.y);
  if (ws < 1e-3) { o.fade = 0.0; return o; }
  let iw = 1.0 / ws; let st = shF(SH_H + 8u); let off = shF(SH_H + 9u);
  o.t0 = o.t0 * iw * st - off; o.t1 = o.t1 * iw * st - off;
  o.dir = o.dir / max(length(o.dir), 1e-4);
  o.rt = 0.3 + o.rt * iw / SH_Q6 * 2.2; o.beta = o.beta * iw / SH_Q6 * 0.5; o.fade = o.fade * iw / 255.0 * min(ws, 1.0);
  return o;
}
struct ShW { disp: vec3f, slope: vec2f, foam: f32, breaking: f32, lip: f32, residual: f32, a0: f32, k0: f32, w0: f32, ph0: f32, dir: vec2f }
// the shore trains (sim/shoreField.js shoreWaves): xz the rest point, d the bed's depth (m), hs the sea's Hs here (m), t (s)
fn shoreWaves(xz: vec2f, d: f32, hs: f32, t: f32, tx: ShTex) -> ShW {
  var o: ShW;
  if (tx.fade <= 0.0 || d > SH_DIN) { return o; }
  let dir = tx.dir; o.dir = dir;
  let expo = shExpo(dir);
  let env = (1.0 - smoothstep(SH_DIN * 0.45, SH_DIN, d)) * smoothstep(-0.05, 0.08, d) * smoothstep(0.1, 0.45, tx.fade);
  if (env <= 0.0) { return o; }
  let group = shGroup(xz, t); let np = shPhase(xz);
  var pinch = 0.85;
  let nTr = ${lite ? '1u' : 'select(1u, 2u, shPart(1u))'};
  for (var i = 0u; i < nTr; i++) {
    let w = select(shF(${P.w1}u), shF(${P.w0}u), i == 0u); let fm = select(shF(${P.f1}u), shF(${P.f0}u), i == 0u);
    let tau = mix(tx.t0, tx.t1, fm);
    let dCap = SH_G / (w * w);
    let cel = sqrt(SH_G * min(max(d, SH_DMIN), dCap));
    let k = w / cel;
    let L0 = 2.0 * PI * SH_G / (w * w);
    let green = min(1.6, max(1.0, pow(max(d, 0.05) / (0.06 * L0), -0.25)));
    let aFree = SH_AMP * hs * select(SH_SECOND, 1.0, i == 0u) * env * expo * group * tx.rt * green;
    let amax = SH_GAMMA * max(d, 0.0) * select(0.5, 1.0, i == 0u);
    let a = min(aFree, amax);
    let ph = w * (tau + t) + np * select(1.37, 1.0, i == 0u) + f32(i) * 2.1;
    let c = 0.5 + 0.5 * cos(ph); let s = sin(ph);
    let cp = pow(c, 0.6);
    let gam = aFree / max(SH_GAMMA * max(d, 0.01), 1e-4);
    let cycle = floor((ph + PI) / (2.0 * PI));
    let early = shNoise(vec2f(xz.x * 0.06 + cycle * 7.3, xz.y * 0.06 + cycle * 3.1 + f32(i) * 31.0));
    let breaking = smoothstep(SH_BLO + 0.1 * early, 1.0 + 0.25 * early, gam) * smoothstep(SH_BA0, SH_BA1, a) * shF(${P.white}u);
    let xi = min(tx.beta, 0.5) / sqrt(max(2.0 * a, 1e-3) / L0);
    let plunge = smoothstep(0.35, 0.6, xi) * (1.0 - smoothstep(2.5, 3.5, xi));
    let surge = smoothstep(2.5, 4.0, xi);
    var pitch = 0.0;
    ${lite ? '' : 'if (i == 0u && shPart(2u)) { pitch = 2.0 * SH_STEEP * a * smoothstep(1.0, 1.25, gam) * (1.0 - smoothstep(1.6, 2.4, gam)) * plunge; }'}
    pitch = min(pitch, 0.35 / (1.08 * k));
    pinch -= 1.08 * pitch * k;
    let qak = min(pinch, SH_STEEP * a * k * 8.0); pinch -= qak;
    let c5 = c * c * c * c * c;
    o.disp.y += a * (2.0 * cp * c - 0.78);
    let push = (qak / k) * s + pitch * c5 * c;
    o.disp.x += dir.x * push; o.disp.z += dir.y * push;
    o.slope += dir * (a * k * 1.6 * cp * s / max(1.0 - qak * cos(ph) + 3.0 * pitch * k * c5 * s, 0.2));
    let psi = ph + PI - 2.0 * PI * floor((ph + PI) / (2.0 * PI)) - PI;
    o.foam += breaking * (1.0 - 0.8 * surge) * smoothstep(-0.45, 0.0, psi) * exp(-max(psi, 0.0) * 0.8);
    if (i == 0u) {
      o.a0 = a; o.k0 = k; o.w0 = w; o.ph0 = ph; o.breaking = breaking * (1.0 - surge);
      o.lip = o.breaking * c5 * (1.0 - smoothstep(-0.2, 0.6, psi)) * plunge;
      let ph2 = ph - 2.0 * PI * floor(ph / (2.0 * PI));
      o.residual = smoothstep(1.0, 1.8, gam) * smoothstep(SH_BA0, SH_BA1, a) * shF(${P.white}u) * (0.3 + 0.45 * exp(-ph2 * 0.4)) * (1.0 - surge);
    }
  }
  return o;
}
// the swash on the sand (sim/shoreField.js swash): g the ground over the lake (m); x the film (m), y the bore's edge, z the wet,
// w the run-up (m)
fn swashAt(xz: vec2f, g: f32, hs: f32, t: f32, tx: ShTex) -> vec4f {
  if (tx.fade <= 0.0 || g < -0.3 || g > SH_LAND) { return vec4f(0.0); }
  let w0 = shF(${P.w0}u);
  let H0 = 2.0 * SH_AMP * hs * shExpo(tx.dir) * shGroup(xz, t);
  let L0 = 2.0 * PI * SH_G / (w0 * w0); let b = clamp(tx.beta, 0.02, 0.3);
  let HL = sqrt(max(H0 * L0, 0.0));
  let R = min(SH_R1, 0.75 * (0.35 * b * HL + 0.5 * sqrt(H0 * L0 * (0.563 * b * b + 0.004)))) * smoothstep(0.1, 0.45, tx.fade);
  if (R < SH_R0) { return vec4f(0.0, 0.0, 0.0, R); }
  if (g > R) { return vec4f(0.0, 0.0, 0.5 * (1.0 - smoothstep(R, 1.5 * R, g)), R); }
  let s = fract((w0 * t + shPhase(xz)) / (2.0 * PI));
  let eta = R * select(cos((s - 0.3) / 0.7 * 1.5707963), sin(s / 0.3 * 1.5707963), s < 0.3);
  let th = eta - g;
  var edge = 0.0; if (s < 0.35) { edge = smoothstep(-0.01, 0.0, th) * (1.0 - smoothstep(0.0, 0.04, th)); }
  let sPass = 0.3 + 0.7 * acos(clamp(g / R, 0.0, 1.0)) / 1.5707963;
  let dry = select(s + 1.0 - sPass, s - sPass, s > sPass) * 2.0 * PI / w0;
  return vec4f(max(th, 0.0), edge, select(exp(-dry / SH_DRY), 1.0, th > 0.0), R);
}`;
// without a field (tests, a page with ?shore=0): the same names, nothing on
export const SHORE_STUB_WGSL = `
const SH_DIN = ${SHORE.dIn.toFixed(2)}; const SH_LAND = ${SHORE.landMax.toFixed(2)};
fn shOn() -> bool { return false; }
struct ShTex { t0: f32, t1: f32, dir: vec2f, rt: f32, beta: f32, fade: f32 }
fn shoreTex(xz: vec2f) -> ShTex { var o: ShTex; return o; }
struct ShW { disp: vec3f, slope: vec2f, foam: f32, breaking: f32, lip: f32, residual: f32, a0: f32, k0: f32, w0: f32, ph0: f32, dir: vec2f }
fn shoreWaves(xz: vec2f, d: f32, hs: f32, t: f32, tx: ShTex) -> ShW { var o: ShW; return o; }
fn swashAt(xz: vec2f, g: f32, hs: f32, t: f32, tx: ShTex) -> vec4f { return vec4f(0.0); }
fn shPart(bit: u32) -> bool { return false; }
fn shF(i: u32) -> f32 { return 0.0; }`;

// --- the spray: Ultra's stateless breaker spray (Spray.js): an emitter in the surf zone throws a puff forward and up as a breaking
// crest passes it, ballistic with air drag; the vertex stage evaluates the same trains the water draws ---
export const SPRAY_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${TERRAIN_BIND(3)}
${TERRAIN_HEIGHT}
${SHORE_READ_WGSL(0)}
const PER = ${SHORE.spray.perEmitter}u;
struct PV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) alpha: f32, @location(2) light: vec3f, @location(3) seed: f32 }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PV {
  var o: PV; o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.alpha = 0.0;
  let e = ii / PER; let j = ii % PER;
  // the near tile this emitter is in (the CPU's list: its place, first emitter, count, the instances before it)
  let n = SH[${P.nearN}u];
  var tIx = 0u; var found = false;
  for (var q = 0u; q < ${SHORE.spray.maxTiles}u; q++) {
    if (q >= n) { break; }
    let b = ${P.list}u + q * 4u;
    if (e >= SH[b + 3u] && e < SH[b + 3u] + SH[b + 2u]) { tIx = q; found = true; break; }
  }
  if (!found) { return o; }
  let b = ${P.list}u + tIx * 4u; let ij = SH[b]; let first = SH[b + 1u]; let local = e - SH[b + 3u];
  let w = SH[SH[SH_H + 11u] + first + local];   // the emitter: x, z in its tile (u16 of the tile's side each)
  let tw = shF(SH_H + 3u) * 16.0;
  let ex = vec2f(shF(SH_H), shF(SH_H + 1u)) + (vec2f(f32(ij & 0xffffu), f32(ij >> 16u)) + vec2f(f32(w & 0xffffu), f32(w >> 16u)) / 65535.0) * tw;
  let toE = ex - F.cam.xz;
  if (dot(toE, toE) > ${(SHORE.spray.range * SHORE.spray.range).toFixed(1)}) { return o; }
  let t = F.cam.w;
  let d = -terrainHeight(ex.x, ex.y);
  let tx = shoreTex(ex);
  let s = shoreWaves(ex, d, shF(${P.hsBay}u), t, tx);
  let a = s.a0; let k = max(s.k0, 1e-3); let wv = max(s.w0, 1e-3);
  let strength = s.breaking * smoothstep(${SHORE.spray.amp.toFixed(3)}, ${(SHORE.spray.amp * 2.5).toFixed(3)}, a) * shF(${P.spray}u);
  if (strength <= 0.01) { return o; }
  let r1 = shHash(vec2f(f32(e) * 0.37 + f32(j) * 7.1, 3.3)); let r2 = shHash(vec2f(f32(j) * 1.9 + 2.0, f32(e) * 0.13));
  let psi = s.ph0 + PI - 2.0 * PI * floor((s.ph0 + PI) / (2.0 * PI)) - PI;
  let age = psi / wv - r1 * 0.3;
  let life = 0.6 + 1.0 * r2;
  if (age < 0.0 || age > life) { return o; }
  let KD = 1.9; let ex2 = (1.0 - exp(-KD * age)) / KD;
  let c = wv / k;
  let side = vec2f(-s.dir.y, s.dir.x) * (fract(r1 * 31.7) - 0.5) * 1.2;
  let xz = ex + side + s.dir * c * (0.25 + 0.45 * fract(r2 * 17.3)) * ex2;
  let vy = (1.0 + 2.6 * fract(r1 * 7.9)) * sqrt(a);
  let y = 1.1 * a + (vy + SH_G / KD) * ex2 - SH_G * age / KD;
  if (y < -0.2) { return o; }
  let size = (0.05 + 0.35 * age) * (0.6 + 0.8 * fract(r2 * 5.3)) * sqrt(a / 0.3);
  let p = vec3f(xz.x, y, xz.y);
  let toP = p - F.cam.xyz; let dist = length(toP); let vd = toP / max(dist, 1e-3);
  let right = normalize(cross(vd, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0)); let up = cross(right, vd);
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let q = cs[vi];
  o.pos = F.viewProj * vec4f(p + (right * q.x + up * q.y) * size, 1.0);
  o.uv = q;
  let mu = dot(vd, normalize(F.sun.xyz)); let g = 0.6;
  let phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  var Tair = vec3f(1.0); let inS = aerialParts(o.pos.xy, p, &Tair);
  o.light = 0.9 * (LIGHT.sun.rgb * (0.25 + 1.6 * phase) + LIGHT.sky.rgb * 1.1) / PI * Tair;
  o.seed = r1;
  o.alpha = strength * 0.55 * smoothstep(0.0, 0.1, age) * pow(1.0 - age / life, 1.5) * smoothstep(-0.2, 0.15, y)
          * (1.0 - smoothstep(${(SHORE.spray.range * 0.7).toFixed(1)}, ${SHORE.spray.range.toFixed(1)}, dist)) * smoothstep(2.5, 8.0, dist);
  return o;
}
@fragment fn fs(v: PV) -> @location(0) vec4f {
  let r = length(v.uv);
  let n = shNoise(v.uv * 2.3 + v.seed * 17.0) * 0.6 + shNoise(v.uv * 5.1 + v.seed * 5.0) * 0.4;
  let al = clamp((1.0 - smoothstep(0.35, 1.0, r)) * (0.55 + 0.6 * n), 0.0, 1.0) * v.alpha;
  return vec4f(v.light * al, al);
}`;

// --- the GPU side ---
export function createShore({ device, reg, frameBGL, frameBG, U, frameStruct, sky, terrainBGL, hdrTarget, msaa = 1, depthFormat = 'depth32float', on = true, sea = 'big', file = SHORE_FILE, cap = SHORE_CAP }) {   // file, cap: the field's URL and its buffer's bytes (shoreFile, shoreCap: the start level's)   // sea: the sea state (?sea=; v2/sim/spectrum.js SEA_STATES): the trains' period and the spray's sea
  const st = seaState(sea);
  let phone = false;
  const buf = device.createBuffer({ label: 'shore-field', size: cap, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const params = new Uint32Array(PARAM_WORDS), pf = new Float32Array(params.buffer);
  const stats = { ready: false, bytes: 0, words: 0, tiles: 0, emitters: 0, on: false, near: 0, sprayInstances: 0, loadMs: null, inView: 0, nearestM: null };
  let S = null, layout = null, tileXY = null, tileBox = null, loadP = null, enabled = on;
  const planes = new Float64Array(20);
  const t0 = performance.now();
  // the spray's pipeline (built at load with the rest; drawn only when the spray is on)
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const bglS = device.createBindGroupLayout({ label: 'shore-spray', entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }] });
  const bgS = device.createBindGroup({ layout: bglS, entries: [{ binding: 0, resource: { buffer: buf } }] });
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  {
    const m = reg.shader('shore-spray', SPRAY_WGSL(frameStruct));
    reg.add('shore-spray', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bglS, terrainBGL] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  }
  device.queue.writeBuffer(buf, 0, params);   // on = 0 until the field lands
  function land(raw) {
    S = decodeShore(raw);
    layout = gpuLayout(S.head);
    const words = gpuWords(S);
    if (words.byteLength > cap) throw new Error(`shore: ${words.byteLength} B over the buffer's ${cap}`);
    device.queue.writeBuffer(buf, PARAM_WORDS * 4, words.buffer, PARAM_WORDS * 4, words.byteLength - PARAM_WORDS * 4);
    // each kept tile's place (I, J) and its box (the frame's cull), from the index
    const H = S.head, tw = H.texel * H.tile;
    tileXY = new Uint16Array(H.nTiles * 2); tileBox = new Float32Array(H.nTiles * 2);
    for (let J = 0; J < H.tilesZ; J++) for (let I = 0; I < H.tilesX; I++) { const s = S.index[J * H.tilesX + I]; if (!s) continue; tileXY[2 * (s - 1)] = I; tileXY[2 * (s - 1) + 1] = J; tileBox[2 * (s - 1)] = H.x0 + (I + 0.5) * tw; tileBox[2 * (s - 1) + 1] = H.z0 + (J + 0.5) * tw; }
    stats.ready = true; stats.words = words.length; stats.tiles = H.nTiles; stats.emitters = H.nEmit;
    stats.loadMs = +(performance.now() - t0).toFixed(1);
  }
  async function load() {
    return (loadP ??= (async () => {
      const r = await fetch(file.href); if (!r.ok) throw new Error(`shore: ${r.status}`);
      const b = new Uint8Array(await r.arrayBuffer()); stats.bytes = b.length;
      land(b[0] === 0x1f && b[1] === 0x8b ? await inflate(b) : b);   // a host may have inflated the .gz already (Content-Encoding)
    })());
  }
  const near = new Float32Array(SHORE.spray.maxTiles), nearIx = new Int32Array(SHORE.spray.maxTiles);
  const hsAt = (U) => hsLaw(U, V1_SEA.bayFetchKm * 1000) * st.bayHs;   // the spray's sea: the bay's Hs × the sea state's (the water's trains read the fetch map)
  // a frame: on when a kept tile lies within SHORE.range of the eye and in the frustum (else the shaders skip it all); the
  // spray's near tiles (nearest first, ≤ maxTiles within its range, in view) when the wind blows it
  function update({ eye, viewProj, wind }) {
    let live = enabled && !!S;
    let inView = 0, nearest = Infinity, nn = 0;
    if (live) {
      frustumPlanes(viewProj, planes);
      const H = S.head, hw = H.texel * H.tile * 0.5, r = hw * 1.4143, R2 = SHORE.range * SHORE.range, sr2 = SHORE.spray.range + r;
      for (let i = 0; i < near.length; i++) { near[i] = Infinity; nearIx[i] = -1; }
      for (let s = 0; s < H.nTiles; s++) {
        const cx = tileBox[2 * s], cz = tileBox[2 * s + 1], dx = cx - eye[0], dz = cz - eye[2], d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        if (!boxInFrustum(planes, cx - hw, -2, cz - hw, cx + hw, 3, cz + hw)) continue;
        inView++; const d = Math.sqrt(d2); if (d < nearest) nearest = d;
        if (d < sr2 && S.emitN[s] > 0) {   // insert into the near list (sorted by distance)
          let k = near.length - 1; if (d >= near[k]) continue;
          while (k > 0 && near[k - 1] > d) { near[k] = near[k - 1]; nearIx[k] = nearIx[k - 1]; k--; }
          near[k] = d; nearIx[k] = s;
        }
      }
      live = inView > 0;
    }
    stats.on = live; stats.inView = inView; stats.nearestM = Number.isFinite(nearest) ? +nearest.toFixed(1) : null;
    params[P.on] = live ? 1 : 0;
    if (live) {
      const p = shoreParams({ U: wind.speedMs, travelRad: wind.travelRad, fetchM: wind.fetchM ?? V1_SEA.bayFetchKm * 1000, shapeKm: st.bayShapeKm });
      pf[P.w0] = p.w0; pf[P.w1] = p.w1; pf[P.f0] = p.f0; pf[P.f1] = p.f1; pf[P.dirX] = p.dirX; pf[P.dirZ] = p.dirZ;
      pf[P.spray] = phone ? 0 : p.spray; pf[P.hsBay] = hsAt(wind.speedMs); pf[P.white] = p.white;
      params[P.parts] = phone ? 0 : PARTS.second | PARTS.lean | PARTS.lace;
      let inst = 0;
      if (pf[P.spray] > 0) {
        for (let q = 0; q < near.length; q++) {
          const s = nearIx[q]; if (s < 0) break;
          const n = Math.min(S.emitN[s], Math.floor(SHORE.spray.maxInstances / SHORE.spray.perEmitter) - inst); if (n <= 0) break;
          const b = P.list + nn * 4; params[b] = (tileXY[2 * s] | (tileXY[2 * s + 1] << 16)) >>> 0; params[b + 1] = S.emitT[s]; params[b + 2] = n; params[b + 3] = inst;
          inst += n; nn++;
        }
      }
      params[P.nearN] = nn; params[P.nearI] = inst * SHORE.spray.perEmitter;
    }
    stats.near = nn; stats.sprayInstances = live ? params[P.nearI] : 0;
    device.queue.writeBuffer(buf, 0, params);
  }
  return {
    buffer: buf, stats, load, update, land,
    get field() { return S; },
    async prime() { await load(); },
    // the in-page A/B (tools/v2-ab-shore.mjs): off reads as no shore in view (the water's own path, the spray not drawn)
    get on() { return enabled; }, set on(v) { enabled = !!v; },
    setLite(v) { phone = !!v; },
    layoutEntry: (b) => ({ binding: b, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }),
    entry: (b) => ({ binding: b, resource: { buffer: buf } }),
    readWGSL: (b, lite) => SHORE_READ_WGSL(b, lite),
    drawSpray(pass, c, terrainBG) {
      if (phone || !stats.sprayInstances) return;
      pass.setPipeline(reg.get('shore-spray'));
      pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bgS); pass.setBindGroup(3, terrainBG);
      pass.draw(6, stats.sprayInstances); c.calls++;
    },
  };
}
