// The boat's wake and bow spray on v2's engine (the GPU side of v2/sim/wake.js and v2/sim/spray.js). v1's design
// (src/boat/wake.js, src/water.js § M10, src/boat/spray.js), ported to WGSL:
//   1. The KELVIN MAP: a boat-centred f16 map (in a storage buffer with the foam map) (256² over 128 m on a desktop, 192² on a phone) holding the
//      wake's height and its slope (∂h/∂x, ∂h/∂z), recomputed every frame as the sum of v1's Cauchy–Poisson impulses
//      along the recorded track (a bow crest and a stern trough every 0.25 s: η ∝ (τ/r²)·cos(gτ²/4r), the hull's
//      short-wave cutoff exp(−k·rc)); its stationary phase is the Kelvin pattern (the transverse waves at 2πU²/g, the
//      divergent crests, the 19.47° arms), bent and chirped on a turning or slowing track. The water reads its slope.
//   2. The FOAM MAP: (512² over 256 m; 384² on a phone): r = the foam strip's strength, g = the disturbed
//      water (the slick), made from the same track each frame (v2/sim/wake.js: v1's stamps with no history).
//   3. The water's read (WAKE_READ_WGSL, in render/water.js's wake block): the slope bends the normal (the mirror and
//      the glint), the slick damps the short cascades' ripples, the strip seen as v1's foamVisible (lanes along the
//      track, specks as it ages, ragged edges; MaterialX's Perlin noise as v1's TSL has it), the bow wave's white roll
//      analytic from the boat's pose.
//   4. The SPRAY: v1's droplets (v2/sim/spray.js) drawn as thin streaks along their motion relative to the boat, lit
//      by the frame's sky and sun with the backlit glint, blended after the sky (they write no depth).
// Both maps are snapped to whole texels of a world grid (a field recomputed on a moving grid crawled), and both
// compute dispatches run at the end of the water-sim pass. Nothing is allocated a frame; three pipelines, built at load.
//   const wake = createWakeFx({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa, depthFormat, variant });
//   createWater({ …, wake })   createBoatSim({ …, wake: wake.track, makeSpray: wake.makeSpray })
//   scene pass, after the sky: wake.drawSpray(pass, c)
import { createWakeTrack, WAKE, WAKE_SIZES, POINT_FLOATS, PROP } from '../sim/wake.js';
import { createSpraySim, SPRAY_LOOK } from '../sim/spray.js';
import { gustResponse } from '../../src/sim/water-spectrum.js';
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { HULL_MASK_WGSL } from './hullMask.js';   // K2: no water drawn inside the hull or the cockpit while she is knocked down

// how much the trail's slick damps the wind's ripples (v1's wakeCalm) and each cascade's share of it (v1's resp: the
// short cascades follow, the 600 m swell does not)
export const WAKE_CALM = 0.8;
// M3 (owner, 2026-11-18): Tessie's night wake glow, a soft pale teal at full share (HDR radiance: the night's exposure is about
// 360 × the day's, so this reads as a faint light, never a lamp); the water adds it where her map's disturbed water is
export const WAKE_GLOW = [0.00026, 0.00088, 0.00080];
export const WAKE_RESP = Object.freeze([0, gustResponse(5), gustResponse(0.9), gustResponse(0.2)]);
// the wake's slope fades out where a pixel's footprint nears its shortest waves (≥ 2.5 m): no aliasing far off
export const WAKE_FP = Object.freeze([0.6, 2.0]);
// the wake's foam: albedo 0.9 (v1's 'albedo ≈ 0.9 under the same light'; the whitecaps keep v2's subtle 0.55), shaded by the
// normal. bias: added to foamVisible's threshold. With v1's map and v1's formula as they are, v2's strip ended ≈ 3 m behind
// the transom where v1's reads white for ≈ 10 m at the same speed and pose (2026-11-13, after the sailing parity: both
// boats 5.7 kn): v1's foam colour (its horizon tint + 0.7 × the sun) sits far above white in its HDR, so v1's thin partial
// foam shows as solid white. The bias (0.6, fitted on the above-stern and 21 kn frames) gives v2's strip v1's visible length
export const WAKE_FOAM = Object.freeze({ albedo: 0.9, shade: [0.8, 0.25], bias: 0.6 });
const UNIFORM_FLOATS = 40;   // WakeU: 10 vec4 (the speed feel's lee foam: the 7th; Tessie's creature map: the 8th and 9th; the vessels' map: the 10th)
// speed feel (owner, 2026-11-17): the foam streaming along the lee side when she is heeled and fast, heavier with the lee rail
// in the water (v2/sim/speedFeel.js leeFoam: strength, wet, side, speed), drawn analytically by the hull in wakeAt (no map, no
// pass, nothing when upright or slow). fwd: where it starts (share of the waterline from the bow); aftM: how far past the
// transom it trails (m; the foam map's strip takes over); width: its reach out from the lee waterline (m) amidships and aft;
// streak, speck: the lanes' and the flecks' noise across and along (1/m): solid by the hull, torn lanes and flecks outboard; gain: its foam at full strength (the water's wake foam is at most 0.85)
// speed legible (research 101 #1): the bow wave's white roll by speed: its reach out and aft × (U/refMs)² in k (1 at refMs)
export const BOW_ROLL = Object.freeze({ refMs: 2.95, k: Object.freeze([0.4, 1.45]) });
export const LEE_FOAM = Object.freeze({ fwd: [0.2, 0.4], aftM: 6, width: [0.3, 1.1], streak: [3.2, 0.5], speck: [9, 2.2], gain: 0.85 });
// the WebGPU flags (node runs this module in the tests on a fake device)
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const TEX = globalThis.GPUTextureUsage ?? { TEXTURE_BINDING: 4, STORAGE_BINDING: 8 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

const WAKE_STRUCT = `struct WakeU { kc: vec4f, fc: vec4f, boat: vec4f, dims: vec4f, knobs: vec4f, box: vec4f, lee: vec4f, cr: vec4f, cr2: vec4f, vs: vec4f }
// kc: the Kelvin map's centre (x, z, relative to the boat), its extent m, 1 on; fc: the foam map's centre, extent, the
// point count; boat: world x, z, the heading's fx, fz; dims: speed m/s, the waterline length, the beam, the sim time s;
// knobs: rc, r0, the bow's gain, the trail's dt; box: the strip's box relative to the boat (x0, z0, x1, z1); lee: the speed
// feel's lee foam (strength, wet, side ±1, the hull's speed through the water m/s);
// cr: Tessie's creature map (render/tessie.js writes it after the wake's two maps, desktop only): its
// world corner x0, z0, its extent m, 1 on (0: never read); cr2: the hull's drawn heel, heave, pitch, 1 on (K2: the water kept
// out of the hull and the cockpit while she is knocked down, render/hullMask.js; 0: never tested); vs: the vessels' map (the other
// boats' wakes: render/vesselWake.js writes it after the creature map; desktop and tablet with the glass boat): its world corner x0,
// z0, its extent m, 1 on (0: never read)`;

// the strip's profile (v2/sim/wake.js stripProfile): [foam, rough] at distance d from the transom's path, `age` s on
const PROFILE_WGSL = `
const FOAM_S = ${WAKE.foamS.toFixed(1)}; const ROUGH_S = ${WAKE.roughS.toFixed(1)}; const SPREAD = ${WAKE.spreadM2s};
const CORE = ${WAKE.core}; const ROUGH_CORE = ${WAKE.roughCore}; const EDGE = ${WAKE.edgeM};
fn erfA(x: f32) -> f32 {   // Winitzki's erf
  let x2 = x * x; let v = sqrt(1.0 - exp(-x2 * (1.27323954 + 0.147 * x2) / (1.0 + 0.147 * x2)));
  return select(v, -v, x < 0.0);
}
// wk, lk: the foam band's width and life factors at the speed it was made at (v2/sim/wake.js WAKE_SPEED, packed per point)
fn stripProfile(d: f32, age: f32, go: f32, Bm: f32, ringS: f32, wk: f32, lk: f32) -> vec2f {
  let s = sqrt(EDGE * EDGE + SPREAD * max(age, 0.0)) * 1.41421356; let w = CORE * Bm * wk; let wr = ROUGH_CORE * Bm;
  let foam = 0.5 * (erfA((w - d) / s) + erfA((w + d) / s));
  let rough = 0.5 * (erfA((wr - d) / s) + erfA((wr + d) / s));
  let tail = go * (1.0 - smoothstep(ringS - 4.0, ringS, age));
  return vec2f(foam * exp(-age / (FOAM_S * lk)), rough * exp(-age / ROUGH_S)) * tail;
}`;

export const WAKE_COMPUTE_WGSL = ({ points, kelvin, foam }) => `${WAKE_STRUCT}
@group(0) @binding(0) var<uniform> W: WakeU;
@group(0) @binding(1) var<storage, read> P: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> M: array<vec2u>;   // the maps (WAKE_MAPS_WGSL): the Kelvin map, then the foam map
const NP = ${points}u; const KS = ${kelvin}u; const FS = ${foam}u; const G = 9.81; const MAXSEG = ${WAKE.maxSegM.toFixed(1)};
${PROFILE_WGSL}
const PV = ${POINT_FLOATS / 4}u;   // vec4s a point: (x, z, age, amp) (fx, fz, U, go) (prop, aft, widthK, lifeK)
var<workgroup> SP: array<vec4f, ${POINT_FLOATS / 4 * points}>;
fn loadPoints(li: u32) { for (var j = li; j < PV * NP; j += 64u) { SP[j] = P[j]; } workgroupBarrier(); }
// one source's height and slope at p: env·cos(gτ²/4r) and its radial derivative (the phase term; v1's)
fn source(p: vec2f, at: vec2f, amp: f32, g4: f32, r02: f32, rc: f32, acc: ptr<function, vec3f>) {
  let rv = p - at; let r2 = dot(rv, rv) + r02; let r = sqrt(r2);
  let k = g4 / r2; let ph = k * r;
  let env = amp / r2 * exp(-k * rc);
  let ds = env * sin(ph) * k / r;
  *acc += vec3f(env * cos(ph), ds * rv.x, ds * rv.y);
}
@compute @workgroup_size(8, 8) fn kelvin(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  loadPoints(li);
  if (g.x >= KS || g.y >= KS) { return; }
  var acc = vec3f(0.0);
  if (W.kc.w > 0.5) {
    let p = W.kc.xy + ((vec2f(g.xy) + 0.5) / f32(KS) - 0.5) * W.kc.z;
    let n = min(u32(W.fc.w), NP);
    let L = W.dims.y; let rc = W.knobs.x; let r02 = W.knobs.y * W.knobs.y; let bg = W.knobs.z; let dt = W.knobs.w;
    for (var i = 1u; i < n; i++) {
      let e = SP[PV * i]; let d = SP[PV * i + 1u];
      let tau = e.z;
      if (tau <= 0.02 || e.w <= 0.0) { continue; }
      let base = e.w * tau * dt; let g4 = tau * tau * G * 0.25;
      source(p, e.xy, -base, g4, r02, rc, &acc);                     // the stern: a trough at the recorded point
      source(p, e.xy + d.xy * L, base * bg, g4, r02, rc, &acc);      // the bow: a crest one waterline length ahead
    }
  }
  M[g.y * KS + g.x] = vec2u(pack2x16float(acc.xy), pack2x16float(vec2f(acc.z, 0.0)));
}
@compute @workgroup_size(8, 8) fn foam(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32) {
  loadPoints(li);
  if (g.x >= FS || g.y >= FS) { return; }
  var o = vec2f(0.0);
  let p = W.fc.xy + ((vec2f(g.xy) + 0.5) / f32(FS) - 0.5) * W.fc.z;
  if (W.kc.w > 0.5 && all(p >= W.box.xy) && all(p <= W.box.zw)) {
    let n = min(u32(W.fc.w), NP);
    let L = W.dims.y; let Bm = W.dims.z; let ringS = f32(NP - 1u) * W.knobs.w;
    for (var i = 0u; i + 1u < n; i++) {
      let a = SP[PV * i]; let b = SP[PV * (i + 1u)]; let ad = SP[PV * i + 1u]; let bd = SP[PV * (i + 1u) + 1u];
      let ab = b.xy - a.xy; let l2 = dot(ab, ab);
      if (l2 > MAXSEG * MAXSEG) { continue; }
      let t = clamp(dot(p - a.xy, ab) / max(l2, 1e-6), 0.0, 1.0);
      let d = length(p - a.xy - ab * t);
      if (d > Bm + 2.0) { continue; }
      let age = mix(a.z, b.z, t);
      let ap = SP[PV * i + 2u]; let bp = SP[PV * (i + 1u) + 2u];   // (prop, aft, widthK, lifeK)
      o = max(o, stripProfile(d, age, mix(ad.w, bd.w, t), Bm, ringS, mix(ap.z, bp.z, t), mix(ap.w, bp.w, t)));
      // #14 prop wash (marked; v2/sim/wake.js propProfile): v1's stamp along the prop point's history
      if (max(ap.x, bp.x) > 0.0) {
        let pa = a.xy - ad.xy * ap.y; let pb = b.xy - bd.xy * bp.y; let pe = pb - pa;
        let pt = clamp(dot(p - pa, pe) / max(dot(pe, pe), 1e-6), 0.0, 1.0);
        let pd = length(p - pa - pe * pt); let page = mix(a.z, b.z, pt);
        let k = mix(ap.x, bp.x, pt) * (1.0 - smoothstep(${PROP.disc[0].toFixed(2)}, ${PROP.disc[1].toFixed(2)}, pd));
        o = max(o, vec2f(${PROP.foam} * k * exp(-page / FOAM_S), k * exp(-page / ROUGH_S)));
      }
    }
  }
  M[KS * KS + g.y * FS + g.x] = vec2u(pack2x16float(o), 0u);
}`;

// MaterialX's 2-D Perlin noise (mx_perlin_noise_float: Jenkins' lookup3 hash, the 8 gradients, the quintic fade, the
// 0.6616 scale), which v1's TSL mx_noise_float is: about −1..1
export const MX_NOISE_WGSL = `
fn mxRot(x: u32, k: u32) -> u32 { return (x << k) | (x >> (32u - k)); }
fn mxHash(x: i32, y: i32) -> u32 {
  var a = 0xdeadbeefu + (2u << 2u) + 13u; var b = a; var c = a;
  a += bitcast<u32>(x); b += bitcast<u32>(y);
  c ^= b; c -= mxRot(b, 14u); a ^= c; a -= mxRot(c, 11u); b ^= a; b -= mxRot(a, 25u);
  c ^= b; c -= mxRot(b, 16u); a ^= c; a -= mxRot(c, 4u); b ^= a; b -= mxRot(a, 14u); c ^= b; c -= mxRot(b, 24u);
  return c;
}
fn mxGrad(h0: u32, x: f32, y: f32) -> f32 {
  let h = h0 & 7u; let u = select(y, x, h < 4u); let v = 2.0 * select(x, y, h < 4u);
  return select(u, -u, (h & 1u) != 0u) + select(v, -v, (h & 2u) != 0u);
}
fn mxFade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn mxNoise(p: vec2f) -> f32 {
  let fl = floor(p); let X = i32(fl.x); let Y = i32(fl.y); let f = p - fl;
  let u = mxFade(f.x); let v = mxFade(f.y);
  let r = mix(mix(mxGrad(mxHash(X, Y), f.x, f.y), mxGrad(mxHash(X + 1, Y), f.x - 1.0, f.y), u),
              mix(mxGrad(mxHash(X, Y + 1), f.x, f.y - 1.0), mxGrad(mxHash(X + 1, Y + 1), f.x - 1.0, f.y - 1.0), u), v);
  return 0.6616 * r;
}`;

// the water's reads (render/water.js binds the two maps and the uniform in its group 2 at `base`)
// the two maps live in one storage buffer (four f16 a texel, packed), read with a bilinear tap by hand: the water's
// fragment stage is at WebGPU's 16 sampled textures (the night's maps took the last), so the wake takes no texture slot
export const WAKE_READ_WGSL = (base, { kelvin, foam, creature = 0, vessel = 0 } = WAKE_SIZES.full) => `${WAKE_STRUCT}
@group(2) @binding(${base}) var<storage, read> WAKEM: array<vec2u>;
@group(2) @binding(${base + 1}) var<uniform> WAKEU: WakeU;
fn wakeTexel(i: u32) -> vec4f { let q = WAKEM[i]; return vec4f(unpack2x16float(q.x), unpack2x16float(q.y)); }
// a bilinear read of the S × S map at offset o, uv 0–1 (texel centres at (i + 0.5) / S, clamped at the rim)
fn wakeMap(o: u32, S: u32, uv: vec2f) -> vec4f {
  let p = uv * f32(S) - 0.5; let i0 = floor(p); let f = p - i0;
  let mx = i32(S) - 1;
  let x0 = u32(clamp(i32(i0.x), 0, mx)); let x1 = u32(clamp(i32(i0.x) + 1, 0, mx));
  let y0 = u32(clamp(i32(i0.y), 0, mx)); let y1 = u32(clamp(i32(i0.y) + 1, 0, mx));
  return mix(mix(wakeTexel(o + y0 * S + x0), wakeTexel(o + y0 * S + x1), f.x), mix(wakeTexel(o + y1 * S + x0), wakeTexel(o + y1 * S + x1), f.x), f.y);
}
const WAKE_KS = ${kelvin}u; const WAKE_FS = ${foam}u; const WAKE_CS = ${creature}u;   // Tessie's creature map (0: none on this page)
const WAKE_VS = ${vessel}u;   // the vessels' map (render/vesselWake.js; 0: none on this page)
${MX_NOISE_WGSL}
const WAKE_BWL = ${WAKE.bwl}; const WAKE_CALM = ${WAKE_CALM};
const WAKE_GLOW = vec3f(${WAKE_GLOW.map((x) => x.toFixed(6)).join(', ')});   // M3: Tessie's night wake, pale teal (HDR radiance at full glow)
const WAKE_RESP = array<f32, 4>(${WAKE_RESP.map((x) => x.toFixed(4)).join(', ')});
struct WakeS { slope: vec2f, foam: f32, rough: f32, roll: f32, glow: f32 }   // glow: Tessie's night wake (M3; 0 by day and on a phone)
${HULL_MASK_WGSL()}
// K2: the water's point inside the hull's envelope while she is knocked down (cr2.w on): the water draws nothing there
fn wakeInHull(p: vec3f) -> bool { if (WAKEU.cr2.w < 0.5) { return false; } return inHullEnv(hullLocal(p, WAKEU.boat, WAKEU.cr2)); }
// the maps at a rest point xz (world) and the bow's analytic part: the slope (fp: the pixel's footprint, m: the slope
// fades out before it aliases), the strip's strength and disturbed water, the bow wave's white roll
fn wakeAt(xz: vec2f, fp: f32) -> WakeS {
  var o: WakeS;
  if (WAKEU.kc.w < 0.5) { return o; }
  let rel = xz - WAKEU.boat.xy;
  let rk = rel - WAKEU.kc.xy; let hk = 0.5 * WAKEU.kc.z;
  if (max(abs(rk.x), abs(rk.y)) < hk) {
    let edge = clamp((1.0 - length(rk) / hk) * 6.0, 0.0, 1.0);   // v1's fade at the rim
    let ku = rk / WAKEU.kc.z + 0.5;
    o.slope = wakeMap(0u, WAKE_KS, ku).yz * edge * (1.0 - smoothstep(${WAKE_FP[0]}, ${WAKE_FP[1]}, fp));
  }
  let rf = rel - WAKEU.fc.xy; let hf = 0.5 * WAKEU.fc.z;
  if (max(abs(rf.x), abs(rf.y)) < hf) {
    let edge = clamp((1.0 - length(rf) / hf) * 8.0, 0.0, 1.0);
    let fu = rf / WAKEU.fc.z + 0.5;
    let m = wakeMap(WAKE_KS * WAKE_KS, WAKE_FS, fu) * edge;
    o.foam = m.x; o.rough = m.y;
  }
  // Tessie's creature map (render/tessie.js: her rings, her V and the foam at her waterline, made by the wake's impulse maths
  // on a 64 m map centred on her): added to the boat's; read only while she is in the water (cr.w), never on a phone (CS 0)
  if (WAKE_CS > 0u && WAKEU.cr.w > 0.5) {
    let cu = (xz - WAKEU.cr.xy) / WAKEU.cr.z;
    if (all(cu > vec2f(0.0)) && all(cu < vec2f(1.0))) {
      let edge = 1.0 - smoothstep(0.28, 0.49, length(cu - vec2f(0.5)));   // round and wide (18–31 m): its square's straight edges read as a milky panel
      let m = wakeMap(WAKE_KS * WAKE_KS + WAKE_FS * WAKE_FS, WAKE_CS, cu) * edge;
      o.slope += m.xy * (1.0 - smoothstep(${WAKE_FP[0]}, ${WAKE_FP[1]} * 1.5, fp)); o.foam = max(o.foam, m.z); o.rough = max(o.rough, m.w);
      // M3: a soft glow in her wake at night (cr.w − 1: the night's share, 0 by day; the map's disturbed water
      // on her track, her V and her rings, and her waterline's foam, softly)
      o.glow = clamp(m.w * 0.8 + m.z * 0.4, 0.0, 1.0) * clamp(WAKEU.cr.w - 1.0, 0.0, 1.0);
    }
  }
  // the other boats' wakes (render/vesselWake.js: their Kelvin V, their prop wash and its fading strip, the foam at their bows, on a
  // world map that follows them): added to the player's, read only while some boat is in it (vs.w); never on a phone (VS 0)
  if (WAKE_VS > 0u && WAKEU.vs.w > 0.5) {
    let vu = (xz - WAKEU.vs.xy) / WAKEU.vs.z;
    if (all(vu > vec2f(0.0)) && all(vu < vec2f(1.0))) {
      let edge = clamp((0.5 - max(abs(vu.x - 0.5), abs(vu.y - 0.5))) * 10.0, 0.0, 1.0);
      let m = wakeMap(WAKE_KS * WAKE_KS + WAKE_FS * WAKE_FS + WAKE_CS * WAKE_CS, WAKE_VS, vu) * edge;
      o.slope += m.xy * (1.0 - smoothstep(${WAKE_FP[0]}, ${WAKE_FP[1]} * 1.5, fp)); o.foam = max(o.foam, m.z); o.rough = max(o.rough, m.w);
    }
  }
  // ahead of the transom (v1's kelvinAt roll): a from the bow aft, c to starboard
  let fw = WAKEU.boat.zw; let L = WAKEU.dims.y; let Bm = WAKEU.dims.z; let U = WAKEU.dims.x;
  let rb = rel - fw * (0.5 * L);
  let a = -dot(rb, fw); let c = dot(rb, vec2f(-fw.y, fw.x));
  if (a > -1.0 && a < L + 0.5 && abs(c) < Bm + 1.0) {
    let hb = sqrt(clamp(a / (0.5 * L), 0.0, 1.0)) * Bm * 0.5 * WAKE_BWL;   // the waterline half-breadth here
    let off = abs(c) - hb;
    // the bow wave grows with speed (its height as U²): its white reaches further out and further aft toward hull speed
    // (BOW_ROLL: × (U/refMs)² clamped, 1 at refMs: the look fitted there is unchanged)
    let kb = clamp(pow(U / ${BOW_ROLL.refMs.toFixed(2)}, 2.0), ${BOW_ROLL.k[0].toFixed(2)}, ${BOW_ROLL.k[1].toFixed(2)});
    let roll = smoothstep(-0.2, 0.05, off) * (1.0 - smoothstep(0.1, max(0.6 - a / L, 0.2) * sqrt(kb), off));
    o.roll = roll * smoothstep(-0.3, 0.3, a) * (1.0 - smoothstep(L * 0.2 * kb, L * 0.4 * kb, a)) * smoothstep(1.3, 3.0, U) * 0.6;
  }
  // speed feel: the lee side's foam, hugging the heeled waterline (it moves out to the rail as she heels) from LEE_FOAM.fwd of the
  // waterline aft past the transom, widening aft, torn into lanes that run aft at the hull's speed; nothing when lee.x is 0
  if (WAKEU.lee.x > 0.001 && a > L * ${LEE_FOAM.fwd[0]} && a < L + ${LEE_FOAM.aftM.toFixed(1)}) {
    let cl = c * WAKEU.lee.z;
    let hb = sqrt(clamp(a / (0.5 * L), 0.0, 1.0)) * Bm * 0.5 * WAKE_BWL * (1.0 + 0.16 * WAKEU.lee.y);
    let off = cl - hb;
    let sa = clamp((a - L * ${LEE_FOAM.fwd[0]}) / (L * ${(1 - LEE_FOAM.fwd[0]).toFixed(2)} + ${LEE_FOAM.aftM.toFixed(1)}), 0.0, 1.0);
    let w = mix(${LEE_FOAM.width[0]}, ${LEE_FOAM.width[1]}, sa) * (0.6 + 0.4 * WAKEU.lee.y);
    if (off > -0.3 && off < w) {
      let band = smoothstep(-0.3, 0.0, off) * (1.0 - smoothstep(0.35 * w, w, off));
      let ends = smoothstep(L * ${LEE_FOAM.fwd[0]}, L * ${LEE_FOAM.fwd[1]}, a) * (1.0 - smoothstep(L, L + ${LEE_FOAM.aftM.toFixed(1)}, a));
      let along = a - WAKEU.lee.w * WAKEU.dims.w;   // the water's own frame: the lanes run aft at the hull's speed
      let n = mxNoise(vec2f(cl * ${LEE_FOAM.streak[0]}, along * ${LEE_FOAM.streak[1]}));
      let sp = mxNoise(vec2f(cl * ${LEE_FOAM.speck[0]}, along * ${LEE_FOAM.speck[1]}));
      let v = n * 1.5 + sp * 0.6 + band * 0.8 - 0.9 + 0.3 * WAKEU.lee.x;
      o.roll = max(o.roll, ${LEE_FOAM.gain} * WAKEU.lee.x * smoothstep(0.0, 0.3, v) * sqrt(band) * ends);
    }
  }
  return o;
}
// the slick (v1's slickAt): where the trail's disturbed water damps the wind's ripples, its edge torn along the track
fn wakeSlick(xz: vec2f, rough: f32, t: f32) -> f32 {
  // only on the trail (v1 read the noise everywhere: with no rough water its edge alone lifted calm patches ≤ 14 % over
  // the whole lake; here nothing changes off the trail, and the noise is not paid there)
  if (rough < 0.01) { return 0.0; }
  let fw = WAKEU.boat.zw; let along = dot(xz, fw); let across = dot(xz, vec2f(-fw.y, fw.x));
  let e = mxNoise(vec2f(across * 0.9 + t * 0.03, along * 0.3));
  return smoothstep(0.12, 0.6, rough + e * 0.25);
}
// a cascade's ripple gain in the slick (v1's mix(1, calm, resp[c]))
fn wakeGain(c: u32, calm: f32) -> f32 { return mix(1.0, calm, WAKE_RESP[min(c, 3u)]); }
// the strip as the eye sees it (v1's foamVisible): lanes along the track (≈ 0.6 m × 7 m streaks) and a fine speckle,
// thresholded by the strength: solid churned white at the transom, lanes by 20 m, specks by 40 m, ragged edges (a
// contrast fade by the footprint was tried: the threshold is not linear, so a flattened noise hid the strip)
fn wakeFoamVisible(xz: vec2f, foam: f32, t: f32, churn: f32, fp: f32) -> f32 {
  if (foam < 0.45) { return 0.0; }
  let fw = WAKEU.boat.zw; let along = dot(xz, fw); let across = dot(xz, vec2f(-fw.y, fw.x));
  let lanes = mxNoise(vec2f(across * 1.6 + t * 0.05, along * 0.14));
  let speck = mxNoise(vec2f(xz.x * 3.0 + t * 0.2, xz.y * 3.0));
  let n = lanes * 1.3 + speck * 0.4 + (churn - 0.5) * 0.3;
  return smoothstep(0.1, 0.6, n * 1.6 + foam * 3.0 - 2.6 + ${WAKE_FOAM.bias}) * smoothstep(0.45, 0.6, foam) * (smoothstep(-0.6, 0.6, speck) * 0.5 + 0.5);
}
// the wake foam's colour: albedo ${WAKE_FOAM.albedo} under the sky and the sun, shaded a little by the normal (v1's)
fn wakeFoamColour(n: vec3f, s: vec3f, eSky: vec3f, eSun: vec3f) -> vec3f {
  return ${WAKE_FOAM.albedo} * (eSky + eSun) / PI * (${WAKE_FOAM.shade[0]} + ${WAKE_FOAM.shade[1]} * max(dot(n, s), 0.0));
}`;

export const SPRAY_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
struct SprayU { look: vec4f, look2: vec4f, look3: vec4f, col: vec4f }
// look: capW, capL (rad), near0, near1 (m); look2: blurS, minSpread, spread, glintPow; look3: amb, glint, K2's sky lift; col: albedo
@group(2) @binding(0) var<storage, read> D: array<vec4f>;   // per droplet: (pos, width m), (velocity relative to the boat, alpha)
@group(2) @binding(1) var<uniform> SU: SprayU;
struct SV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) fade: f32, @location(2) glint: f32 }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SV {
  var o: SV;
  let a = D[2u * ii]; let b = D[2u * ii + 1u];
  if (a.w <= 0.0 || b.w <= 0.0) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); return o; }   // not in the air: clipped
  // the streak (v1's): the drop now and blurS later, its sweep across the view, never wider than capW or longer than
  // capL (rad), so a drop near the lens is a thin fast streak, never a disc
  let toP = a.xyz - F.cam.xyz; let z0 = max(length(toP), 0.05); let vd = toP / z0;
  let d = b.xyz * SU.look2.x; let dp = d - vd * dot(d, vd); let dl = length(dp);
  let wDraw = min(a.w, z0 * SU.look.x);
  let len = min(dl, z0 * SU.look.y) + wDraw;
  var ax = normalize(cross(vd, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  if (dl > 1e-5) { ax = dp / dl; }
  let ay = normalize(cross(vd, ax));
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let k = cs[vi];
  o.pos = F.viewProj * vec4f(a.xyz + ax * (k.x * 0.5 * len) + ay * (k.y * 0.5 * wDraw), 1.0);
  o.uv = k;
  o.fade = smoothstep(SU.look.z, SU.look.w, z0) * min(1.0, max(SU.look2.y, wDraw * SU.look2.z / len)) * b.w;
  o.glint = pow(max(dot(vd, normalize(F.sun.xyz)), 0.0), SU.look2.w);
  return o;
}
@fragment fn fs(v: SV) -> @location(0) vec4f {
  let q = abs(v.uv);
  let across = 1.0 - smoothstep(0.0, 1.0, q.y); let along = 1.0 - smoothstep(0.35, 1.0, q.x);
  let al = across * across * along * v.fade;
  let col = SU.col.rgb * (LIGHT.sky.rgb + LIGHT.sun.rgb) / PI * (SU.look3.x + v.glint * SU.look3.y) + SU.col.rgb * LIGHT.sky.rgb * SU.look3.z;   // look3.z: K2's lift, the sky's whole light on the knockdown's burst (0 upright)
  return vec4f(col * al, al);
}`;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function createWakeFx({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa = 1, depthFormat = 'depth32float', variant = 'full',
  on = true, sprayOn = true, length = 7.26, beam = 3.15, knobs = {}, creature = 0, vessel = 0 } = {}) {
  // vessel: the other boats' map's texels a side (render/vesselWake.js: 192 on a desktop or tablet page with the glass boat; 0 elsewhere)
  // creature: Tessie's map's texels a side (128 on a desktop page that loads her: living/tessie-policy.js; 0 elsewhere: the
  // buffer and the water's read stay as they were)
  const sizes = { ...WAKE_SIZES[variant === 'phone' ? 'phone' : 'full'], creature, vessel };
  const track = createWakeTrack({ length, beam });
  const NPTS = track.trailN + 1;
  const K = { rc: knobs.rc ?? WAKE.rc, r0: knobs.r0 ?? WAKE.r0, bowGain: knobs.bowGain ?? WAKE.bowGain };
  // the track's amplitude knob (v1's ?wake_amp=) scales every impulse: applied when the points are packed
  const ampK = knobs.amp != null ? knobs.amp / WAKE.amp : 1;

  // --- the maps ---
  const mapsBuf = device.createBuffer({ label: 'wake-maps', size: (sizes.kelvin ** 2 + sizes.foam ** 2 + creature ** 2 + vessel ** 2) * 8, usage: BUF.STORAGE });
  const ubuf = device.createBuffer({ label: 'wake-uniform', size: UNIFORM_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });
  const pbuf = device.createBuffer({ label: 'wake-points', size: NPTS * POINT_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const lee = { strength: 0, wet: 0, side: 1, speed: 0 };   // the speed feel's lee foam (fx.setLee)
  const hull = { heel: 0, heave: 0, pitch: 0, on: false };   // K2: the hull's mask for the water (fx.setHull)
  const uni = new Float32Array(UNIFORM_FLOATS), pts = new Float32Array(NPTS * POINT_FLOATS), box = new Float64Array(4);
  const CP = STAGE.COMPUTE;
  const bglC = device.createBindGroupLayout({ label: 'wake-compute', entries: [{ binding: 0, visibility: CP, buffer: { type: 'uniform' } }, { binding: 1, visibility: CP, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: CP, buffer: { type: 'storage' } }] });
  const bgC = device.createBindGroup({ layout: bglC, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: pbuf } }, { binding: 2, resource: { buffer: mapsBuf } }] });
  const mC = reg.shader('wake-compute', WAKE_COMPUTE_WGSL({ points: NPTS, kelvin: sizes.kelvin, foam: sizes.foam }));
  const plC = device.createPipelineLayout({ bindGroupLayouts: [bglC] });
  reg.add('wake-kelvin', { layout: plC, compute: { module: mC, entryPoint: 'kelvin' } });
  reg.add('wake-foam', { layout: plC, compute: { module: mC, entryPoint: 'foam' } });

  // --- the spray ---
  const spray = { sim: null };
  const SCOUNT = 640;
  const sprayData = new Float32Array(SCOUNT * 8);
  const sbuf = device.createBuffer({ label: 'spray-drops', size: sprayData.byteLength, usage: BUF.STORAGE | BUF.COPY_DST });
  const L = SPRAY_LOOK, col = [0xf2, 0xf0, 0xea].map((c) => srgbToLinear(c / 255));   // v1's sunlit white (0xf2f0ea)
  const sprayU = new Float32Array([L.capW, L.capL, L.near[0], L.near[1], L.blurS, L.minSpread, L.spread, L.glintPow, L.amb, L.glint, 0, 0, col[0], col[1], col[2], 1]);
  const subuf = device.createBuffer({ label: 'spray-look', size: sprayU.byteLength, usage: BUF.UNIFORM | BUF.COPY_DST });
  device.queue.writeBuffer(subuf, 0, sprayU);
  const VF = STAGE.VERTEX | STAGE.FRAGMENT;
  const bglS = device.createBindGroupLayout({ label: 'spray', entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: VF, buffer: { type: 'uniform' } }] });
  const bgS = device.createBindGroup({ layout: bglS, entries: [{ binding: 0, resource: { buffer: sbuf } }, { binding: 1, resource: { buffer: subuf } }] });
  const mS = reg.shader('spray', SPRAY_WGSL(frameStruct));
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const prevGroup = reg.group?.('boatfx');   // perf(v2) iOS pipelines: the bow spray is built after the first frame (main.js gates its draw)
  reg.add('spray', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bglS] }), vertex: { module: mS, entryPoint: 'vs' }, fragment: { module: mS, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  if (prevGroup != null) reg.group(prevGroup);
  let sprayVersion = -1, sprayAlive = 0;

  const stats = { points: 0, kelvin: sizes.kelvin, foam: sizes.foam, sprayAlive: 0, sprayUploads: 0, on };
  const snap = (v, cell) => Math.round(v / cell) * cell;
  const kCell = WAKE.kelvinExtentM / sizes.kelvin, fCell = WAKE.foamExtentM / sizes.foam;
  const gK = Math.ceil(sizes.kelvin / 8), gF = Math.ceil(sizes.foam / 8);

  const fx = {
    track, stats, sizes, mapsBuffer: mapsBuf, uniformBuffer: ubuf, uniforms: uni, points: pts,
    // Tessie's map this frame (render/tessie.js sets it before the water-sim pass; on: 0 when she is not in the water)
    creature: { on: 0, x0: 0, z0: 0, extent: 64, writer: null, glow: 0 },   // glow: Tessie's night wake (M3), her writer's only   // writer: who writes the map now ('tessie', 'birds' or none)
    get creatureOffset() { return sizes.kelvin ** 2 + sizes.foam ** 2; },
    // the vessels' map this frame (render/vesselWake.js sets it before the water-sim pass; on: 0 when no boat is in it)
    vessel: { on: 0, x0: 0, z0: 0, extent: 128 },
    get vesselOffset() { return sizes.kelvin ** 2 + sizes.foam ** 2 + creature ** 2; },
    get spray() { return spray.sim; },   // the flight (the harness, the tests)
    // on / off without a reload (the budget's A/B in one page: off is ?nowake=1's frame: the maps write 0, the reads see off)
    set(v) { on = !!v; stats.on = on; },
    // the speed feel's lee foam for the next run (v2/sim/speedFeel.js leeFoam's { strength, wet, side, speed }); none: off
    setLee(o) { lee.strength = o?.strength ?? 0; lee.wet = o?.wet ?? 0; lee.side = o?.side ?? 1; lee.speed = o?.speed ?? 0; return lee; },
    // K2: the hull's drawn pose for the water's mask (render/hullMask.js) while she is knocked down; on false: never tested
    // K2: the knockdown's burst takes the sky's whole light (the storm's dark lit it grey-black); 0: the spray as it was
    setSprayLift(v) { const x = Math.max(0, v || 0); if (x !== sprayU[10]) { sprayU[10] = x; device.queue.writeBuffer(subuf, 0, sprayU); } return x; },
    setHull(o) { hull.heel = o?.heel ?? 0; hull.heave = o?.heave ?? 0; hull.pitch = o?.pitch ?? 0; hull.on = !!o?.on; return hull; },
    get hull() { return hull; },
    get lee() { return lee; },
    // the spray for the shared ride (src/sim/boat/ride.js makeSpray): v1's flight, drawn here
    makeSpray: sprayOn ? ({ length: l = length, beam: b = beam, seed = 1 } = {}) => (spray.sim = createSpraySim({ length: l, beam: b, seed, count: SCOUNT })) : null,
    // the water's group 2 entries (render/water.js: the maps at base, the uniform at base + 1) and its WGSL reads
    layoutEntries: (base) => [{ binding: base, visibility: STAGE.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: base + 1, visibility: STAGE.FRAGMENT, buffer: { type: 'uniform' } }],
    entries: (base) => [{ binding: base, resource: { buffer: mapsBuf } }, { binding: base + 1, resource: { buffer: ubuf } }],
    readWGSL: (base) => WAKE_READ_WGSL(base, sizes),
    // this frame's points and uniform, then the two maps (at the end of the water-sim compute pass)
    run(pass, c, t = 0) {
      const b = track.boat, live = on && track.live;
      const n = live ? track.pack(pts, b.x, b.z, box) : 0;
      if (n && ampK !== 1) for (let i = 0; i < n; i++) pts[i * POINT_FLOATS + 3] *= ampK;
      stats.points = n;
      uni[0] = snap(b.x, kCell) - b.x; uni[1] = snap(b.z, kCell) - b.z; uni[2] = WAKE.kelvinExtentM; uni[3] = live ? 1 : 0;
      uni[4] = snap(b.x, fCell) - b.x; uni[5] = snap(b.z, fCell) - b.z; uni[6] = WAKE.foamExtentM; uni[7] = n;
      uni[8] = b.x; uni[9] = b.z; uni[10] = b.fx; uni[11] = b.fz;
      uni[12] = b.speed; uni[13] = track.length; uni[14] = track.beam; uni[15] = t;
      uni[16] = K.rc; uni[17] = K.r0; uni[18] = K.bowGain; uni[19] = track.dt;
      uni[20] = box[0]; uni[21] = box[1]; uni[22] = box[2]; uni[23] = box[3];
      uni[24] = live ? lee.strength : 0; uni[25] = lee.wet; uni[26] = lee.side; uni[27] = lee.speed;
      const cr = fx.creature; uni[28] = cr.x0; uni[29] = cr.z0; uni[30] = cr.extent; uni[31] = creature && cr.on ? 1 + (cr.writer === 'tessie' ? Math.max(0, Math.min(1, cr.glow ?? 0)) : 0) : 0;   // M3: 1 + her night glow's share
      uni[32] = hull.heel; uni[33] = hull.heave; uni[34] = hull.pitch; uni[35] = hull.on && on ? 1 : 0;
      const vs = fx.vessel; uni[36] = vs.x0; uni[37] = vs.z0; uni[38] = vs.extent; uni[39] = vessel && vs.on ? 1 : 0;
      device.queue.writeBuffer(ubuf, 0, uni);
      if (n) device.queue.writeBuffer(pbuf, 0, pts, 0, n * POINT_FLOATS);
      pass.setBindGroup(0, bgC);
      pass.setPipeline(reg.get('wake-kelvin')); pass.dispatchWorkgroups(gK, gK); c.dispatches++;
      pass.setPipeline(reg.get('wake-foam')); pass.dispatchWorkgroups(gF, gF); c.dispatches++;
      // the spray's droplets: uploaded only when the flight changed
      const s = spray.sim;
      sprayAlive = s ? s.alive : 0; stats.sprayAlive = sprayAlive;
      if (s && s.version !== sprayVersion) {
        sprayVersion = s.version;
        const { pos, rel, size, alpha } = s.core;
        for (let i = 0; i < SCOUNT; i++) {
          const o = i * 8;
          sprayData[o] = pos[3 * i]; sprayData[o + 1] = pos[3 * i + 1]; sprayData[o + 2] = pos[3 * i + 2]; sprayData[o + 3] = size[i];
          sprayData[o + 4] = rel[3 * i]; sprayData[o + 5] = rel[3 * i + 1]; sprayData[o + 6] = rel[3 * i + 2]; sprayData[o + 7] = alpha[i];
        }
        device.queue.writeBuffer(sbuf, 0, sprayData);
        stats.sprayUploads++;
      }
    },
    // the droplets in the air, after the sky (they write no depth); nothing drawn when none are
    sprayDraw: true,   // the droplets' draw on or off (the speed feel's in-page A/B, tools/v2-ab-speedfeel.mjs); the flight runs either way
    drawSpray(pass, c) {
      if (!sprayAlive || !fx.sprayDraw) return;
      pass.setPipeline(reg.get('spray'));
      pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bgS);
      pass.draw(6, SCOUNT); c.calls++; c.triangles += 2 * sprayAlive;
    },
  };
  return fx;
}
