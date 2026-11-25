// v1's boat models on v2's GPU (M3b): the GLB set from render/boat/models.js (one vertex set, a material table, the
// ranges), drawn with v1's materials ported to WGSL: hullMaterials.js's gelcoat (ivory, wear, chalk, yellowing, the scum
// line, tannin streaks, fender scuffs, the hull-deck joint, the print-through in the clear coat), the moulded non-skid
// diamonds (their bump faded under ≈ 2 px into roughness), the mottled antifouling, the tea-stained 316 stainless, the
// laid teak from the UVs (planks, caulked seams, butt joints, grain, silver bloom); the glTF materials as they are (base
// colour × COLOR_0 × the base texture, roughness / metal × their texture, the normal map on a cotangent frame from the
// derivatives, the clear coat as a second lobe); cockpitLook.js's cabin (unlit, baked light × the day) behind its
// depth-only portal, the clear dodger vinyl and the smoked side panels (blended, after the water and the sky).
// Streaming: nothing here exists in the first frame of a live page. A worker (boat/worker.js) fetches the packed GLBs
// (tools/v2-boat-pack.mjs), parses and builds the set and decodes the images with their mips; the page then uploads a
// slice a frame (≤ UPLOAD_BYTES of vertices, or one image) and, once all is resident, swaps the procedural M3 hull out with
// a dissolve (render/boat.js). Every pipeline is declared with the boat's at load.
//   const gm = createBoatModels({ device, reg, layout pieces… });  gm.start(urls, opts) (live) | await gm.loadAll(urls, opts)
//   each frame: gm.pump() while gm.queued; gm.ready; gm.drawOpaque(pass, c, slots); gm.drawGlass(pass, c); gm.shadow(pass, c)
import { MAT_FLOATS, KIND, RANGES } from './boat/models.js';

export const MODEL_UPLOAD_BYTES = 1 << 20;   // a frame's slice of the vertex set (as the terrain's)
export const TEX_SIZE = Object.freeze([1024, 512]);   // every image's layer (the dodger's are 1024 × 512; the 512² ones stretch)
export const LOD = Object.freeze({ nearM: 15, detailM: 24, band: 1, hyst: 0.05 });   // cockpitLook.js NEAR_M (± 5 %), hullDetailLod (24 ± 1 m)
export const STANCHION_Z = Object.freeze([-3.5, -1.23, 1.05, 3.33, -0.74]);   // hullMaterials.js: the stanchion bases and the chainplate

// the WGSL that every GLB pipeline shares (on top of render/boat.js's MODEL + LIGHT_FN)
export const GLB_HEAD = `
struct Mat { base: vec4f, mr: vec4f, kind: vec4f, ex: vec4f }   // base rgba; (metal, rough, coat, coatRough); (kind, texBase, texNormal, texMR); (vcol, scale, opacity, 0)
@group(3) @binding(0) var<storage, read> MATS: array<Mat>;
@group(3) @binding(1) var texC: texture_2d_array<f32>;
@group(3) @binding(2) var texD: texture_2d_array<f32>;
@group(3) @binding(3) var sRep: sampler;
struct GV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) nl: vec3f, @location(2) uv: vec2f, @location(3) col: vec4f, @location(4) lp: vec3f, @location(5) yl: f32, @location(6) @interpolate(flat) mat: u32, @location(7) air: vec3f }
fn gv(p: vec3f, n: vec3f, uv: vec2f, c: vec4f, m: u32) -> GV {
  let w = M.m * vec4f(p, 1.0);
  var o: GV; o.pos = F.viewProj * w; o.world = w.xyz; o.nl = n; o.uv = uv; o.col = c; o.lp = p; o.mat = m;
  o.yl = (M.q.w + p.y) * M.q.z + (1.0 - M.q.z) * 1.0; o.air = w.xyz;
  return o;
}
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) c: vec4f, @location(4) m: u32) -> GV { return gv(p, n, uv, c, m); }
// the opaque hull's: what is under the drawn water is placed where the refracted eye ray finds it (render/boat.js uwPlace); the
// cabin and the portal keep vs (the companionway's trick needs the hull's own frame)
@vertex fn vsW(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) c: vec4f, @location(4) m: u32) -> GV {
  var o = gv(p, n, uv, c, m);
  let ap = uwPlace(o.world, o.yl); o.air = ap.air; o.pos = F.viewProj * vec4f(ap.p, 1.0);
  return o;
}
// value-free gradient noise (a Perlin-style lattice on an integer hash: no sin() precision loss at 70 cycles a metre)
fn hashu(x: u32) -> u32 { let v = x * 747796405u + 2891336453u; let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
fn gradAt(c: vec3i) -> vec3f {
  let h = hashu((bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u));
  return normalize(vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 511.5 - 1.0 + 1e-4);
}
fn noise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p); let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = dot(gradAt(i), f); let n100 = dot(gradAt(i + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
  let n010 = dot(gradAt(i + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0)); let n110 = dot(gradAt(i + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
  let n001 = dot(gradAt(i + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0)); let n101 = dot(gradAt(i + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
  let n011 = dot(gradAt(i + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0)); let n111 = dot(gradAt(i + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
  return 1.6 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
fn n01(p: vec3f) -> f32 { return noise3(p) * 0.5 + 0.5; }
// the screen-door dissolve of the swap (render/boat.js): interleaved gradient noise per pixel
fn ign(px: vec2f) -> f32 { return fract(52.9829189 * fract(dot(px, vec2f(0.06711056, 0.00583715)))); }
struct Surf { alb: vec3f, rough: f32, metal: f32, coat: f32, coatRough: f32, n: vec3f, coatN: vec3f, f0s: f32 }
`;

// v1's materials (hullMaterials.js) as a surface: the local position lp and normal nl are the HULL frame's (the merged
// set is baked there), the derivatives taken once in uniform flow by the caller
const SURFACE_FN = `
const GEL_IVORY = vec3f(0.97, 0.925, 0.84); const ALBEDO_MAX = 0.72;
fn gelcoat(lp: vec3f, nl: vec3f, vc: vec3f, scale: f32, s: ptr<function, Surf>) {
  let p = lp; let y = p.y;
  let wear = smoothstep(0.25, 0.9, n01(p * 0.9));
  let up = smoothstep(0.72, 0.95, nl.y); let side = (1.0 - smoothstep(0.1, 0.45, abs(nl.y)));
  let drift = noise3(p * vec3f(0.55, 0.9, 0.42) + 3.1); let drift2 = noise3(p * vec3f(1.7, 2.2, 1.3) + 9.7);
  let chalk = up * smoothstep(-0.2, 0.7, drift2);
  let nearWater = (1.0 - smoothstep(0.18, 0.80, y)) * side; let nearStern = smoothstep(3.2, 4.2, p.z) * side;
  var base = vc * scale * mix(vec3f(1.0), vec3f(0.985, 0.975, 0.95), wear);
  base = base * GEL_IVORY * (1.0 + drift * 0.06);
  base = base * mix(vec3f(1.0), vec3f(0.96, 0.89, 0.70), max(nearWater * 0.55, nearStern * 0.38) * (drift2 * 0.25 + 0.8));
  base = mix(base, base * vec3f(0.93, 0.92, 0.89) + 0.012, chalk * 0.8);
  let sc = smoothstep(0.160, 0.185, y) * (1.0 - smoothstep(0.222, 0.272, y)) * side;
  let scn = n01(vec3f(p.z * 2.4, y * 26.0, p.x * 1.1));
  base = mix(base, vec3f(0.36, 0.29, 0.18) * 0.8, sc * smoothstep(0.1, 0.5, scn) * 0.7);
  var st = 0.0;
  ${STANCHION_Z.map((z) => `{ let d = abs(p.z - (${z.toFixed(3)})); st = max(st, exp(d * d * ${(-1 / (0.022 * 0.022)).toFixed(3)})); }`).join(' ')}
  let stn = n01(vec3f(p.z * 40.0, y * 2.2, p.x));
  let streak = st * smoothstep(0.35, 0.8, stn + 0.25) * smoothstep(0.30, 0.62, y + stn * 0.3) * side;
  base = mix(base, vec3f(0.42, 0.32, 0.20), streak * 0.5);
  let sf = n01(vec3f(p.z * 2.6, y * 34.0, p.x * 1.3));
  let sparse = smoothstep(0.35, 0.65, n01(vec3f(p.z * 0.7, 0.0, p.x * 0.5) + 5.5));
  let fender = smoothstep(0.40, 0.50, y) * (1.0 - smoothstep(0.60, 0.70, y)) * side;
  let scuff = smoothstep(0.66, 0.80, sf) * sparse * fender;
  base = mix(base, vec3f(0.20), scuff * 0.7);
  let joint = smoothstep(0.80, 0.93, y) * side * (noise3(p * vec3f(3.5, 8.0, 3.5)) * 0.3 + 0.7);
  base = mix(base, base * vec3f(0.78, 0.79, 0.78), joint * 0.8);
  (*s).alb = min(base, vec3f(ALBEDO_MAX)); (*s).metal = 0.0; (*s).f0s = 1.1;   // ior 1.54
  (*s).rough = mix(0.16, 0.3, wear) + chalk * 0.18 + scuff * 0.1;
  (*s).coat = 0.55 * (1.0 - chalk * 0.55); (*s).coatRough = 0.07;
  // the print-through: the clear coat's normal tilted by a faint long-wave ripple (≈ 0.018 rad over a metre)
  let q = p * vec3f(1.3, 2.6, 0.55);
  (*s).coatN = normalize(nl + vec3f(noise3(q), noise3(q + 17.3), noise3(q + 41.7)) * 0.018);
}
// the race livery (the look round of 2026-11-25) on the hull's own skin (boat/models.js hullSkin; KIND.livery): v1's gelcoat
// under it, then, on the side faces, a cream boot top over the antifouling, the topsides in the boat's colour (M.p.w: the
// player's navy, a rival's or a lake boat's tint; 0 keeps the white gelcoat: the Regatta's white fleet) at a race hull's gloss
// and without the cruiser's yellowing, streaks and scuffs, and two stripes under the sheer that follow it (d: the depth under the
// sheer line, baked in uv.x): a gold cove line and a thin cream pinstripe. All edges 6 mm soft: crisp at any distance
const LIV_BOOT0 = 0.028; const LIV_BOOT1 = 0.118; const LIV_COVE = 0.19; const LIV_COVE_W = 0.030; const LIV_PIN = 0.248; const LIV_PIN_W = 0.011; const LIV_E = 0.006;
const LIV_CREAM = vec3f(0.80, 0.77, 0.70); const LIV_GOLD = vec3f(0.62, 0.41, 0.12);
fn livery(lp: vec3f, nl: vec3f, vc: vec3f, scale: f32, d: f32, tint: f32, s: ptr<function, Surf>) {
  gelcoat(lp, nl, vc, scale, s);
  let y = lp.y; let side = 1.0 - smoothstep(0.45, 0.7, abs(nl.y));
  let boot = smoothstep(LIV_BOOT0 - LIV_E, LIV_BOOT0 + LIV_E, y) * (1.0 - smoothstep(LIV_BOOT1 - LIV_E, LIV_BOOT1 + LIV_E, y)) * side;
  let tops = smoothstep(LIV_BOOT1 - LIV_E, LIV_BOOT1 + LIV_E, y) * side;
  let cove = (1.0 - smoothstep(LIV_COVE_W * 0.5 - LIV_E, LIV_COVE_W * 0.5 + LIV_E, abs(d - LIV_COVE))) * tops;
  let pin = (1.0 - smoothstep(LIV_PIN_W * 0.5 - LIV_E, LIV_PIN_W * 0.5 + LIV_E, abs(d - LIV_PIN))) * tops;
  var a = (*s).alb;
  if (tint > 0.5) {
    let gloss = 1.0 + noise3(lp * vec3f(0.55, 0.9, 0.42) + 3.1) * 0.05;   // the coat's faint unevenness (gelcoat's drift)
    a = mix(a, tintOf(tint) * gloss, tops);
    (*s).rough = mix((*s).rough, 0.10, tops); (*s).coat = mix((*s).coat, 0.78, tops); (*s).coatRough = mix((*s).coatRough, 0.05, tops);
  }
  a = mix(a, LIV_CREAM, boot);
  a = mix(a, LIV_GOLD, cove);
  a = mix(a, LIV_CREAM, pin);
  (*s).alb = a;
  (*s).rough = mix((*s).rough, 0.14, max(boot, max(cove, pin)));
}
const PITCH = 0.010;
fn nonskid(lp: vec3f, nl: vec3f, vc: vec3f, scale: f32, dpx: vec3f, dpy: vec3f, s: ptr<function, Surf>) {
  let k = 1.0 / PITCH; let kk = k * 0.7071;
  let p2 = vec2f(lp.x + lp.z, lp.x - lp.z) * kk;
  let f = fract(p2) - 0.5; let ax = abs(f.x); let ay = abs(f.y); let d = max(ax, ay);
  let h = (1.0 - smoothstep(0.30, 0.42, d));
  let slope = ((1.0 - smoothstep(0.30, 0.42, d - 0.02)) - (1.0 - smoothstep(0.30, 0.42, d + 0.02))) / 0.04;
  let xMajor = ax > ay;
  let gx = select(0.0, sign(f.x), xMajor); let gy = select(sign(f.y), 0.0, xMajor);
  let sl = -kk * slope;
  let cells = max(kk * (abs(dpx.x + dpx.z) + abs(dpy.x + dpy.z)), kk * (abs(dpx.x - dpx.z) + abs(dpy.x - dpy.z)));
  let fade = (1.0 - smoothstep(0.45, 0.85, cells));
  let amp = 0.0007 * fade;
  let dhdx = (gx + gy) * sl * amp; let dhdz = (gx - gy) * sl * amp;
  (*s).n = normalize(nl - (vec3f(dhdx, 0.0, dhdz) - nl * (nl.x * dhdx + nl.z * dhdz)));
  let grime = n01(lp * 2.1);
  let px = abs(lp.x); let pz = lp.z; let py = lp.y;
  let sideDeck = smoothstep(0.98, 1.10, px) * (1.0 - smoothstep(1.26, 1.40, px)) * smoothstep(-3.0, -2.4, pz) * (1.0 - smoothstep(1.2, 1.7, pz));
  let sole = (1.0 - smoothstep(0.50, 0.62, px)) * (1.0 - smoothstep(0.45, 0.58, py)) * smoothstep(0.9, 1.4, pz);
  let path = max(sideDeck, sole) * (noise3(lp * vec3f(2.3, 2.3, 1.1) + 2.2) * 0.25 + 0.8);
  let groove = 1.0 - h;
  let dirt = mix(vec3f(1.0), vec3f(0.70, 0.70, 0.67), groove * fade * (1.0 - path * 0.7) * 0.9);
  let trodden = mix(vec3f(1.0), vec3f(0.84, 0.81, 0.74), path * 0.9);
  (*s).alb = vc * mix(1.0, mix(0.90, 1.02, h), fade) * mix(1.0, 0.84, grime * grime) * (0.96 + noise3(lp * vec3f(0.7, 1.0, 0.5)) * 0.06) * dirt * trodden * scale;
  (*s).rough = mix(0.74, mix(0.80, 0.58, h), fade) - path * 0.1; (*s).metal = 0.0; (*s).coat = 0.0;
}
fn stainless(lp: vec3f, s: ptr<function, Surf>) {
  let spot = smoothstep(0.62, 0.78, n01(lp * 70.0)) * smoothstep(-0.1, 0.5, noise3(lp * 4.0 + 8.0));
  let haze = n01(lp * 9.0);
  (*s).alb = mix(vec3f(0.58, 0.575, 0.56), vec3f(0.42, 0.33, 0.24), spot * 0.55);
  (*s).rough = mix(0.15, 0.27, haze) + spot * 0.2; (*s).metal = 1.0; (*s).coat = 0.0;
}
const TEAK_W = 0.055;
fn rndPlank(idx: f32, k: f32) -> f32 { return fract(sin(idx * 12.9898 + k * 78.233) * 43758.5453); }
fn teak(lp: vec3f, uv: vec2f, duvx: vec2f, duvy: vec2f, vc: vec3f, s: ptr<function, Surf>) {
  let u = uv.x; let v = uv.y; let idx = floor(u); let f = fract(u);
  let r1 = rndPlank(idx, 1.0); let r2 = rndPlank(idx, 2.0); let r3 = rndPlank(idx, 3.0);
  let S = 0.0035 / TEAK_W;
  let fu = max(abs(duvx.x) + abs(duvy.x), 1e-5); let fv = max(abs(duvx.y) + abs(duvy.y), 1e-5);
  let du = min(f, 1.0 - f);
  let seamU = smoothstep(S + fu, S - fu, du);
  let L = 2.2; let jv = fract((v + r2 * L) / L) * L; let dv = min(jv, L - jv);
  let seamV = smoothstep(fv + 0.0035, 0.0035 - fv, dv);
  let aaU = smoothstep(0.12, 0.45, fu); let aaV = smoothstep(0.004, 0.02, fv);
  let seam = max(mix(seamU, S * 2.0, aaU), mix(seamV, 0.0035 * 2.0 / 2.2, aaV));
  let g1 = n01(vec3f(f * TEAK_W * 160.0, v * 1.6, idx * 1.37)); let g2 = n01(vec3f(f * TEAK_W * 45.0, v * 0.5, idx * 2.11 + 7.0));
  let late = smoothstep(0.55, 0.85, g1) * 0.7 + smoothstep(0.6, 0.9, g2) * 0.4;
  var wood = mix(vec3f(0.125, 0.042, 0.008), vec3f(0.058, 0.018, 0.003), min(late, 1.0)) * (0.82 + r1 * 0.36);
  let bloom = 0.08 + r3 * 0.10 + noise3(lp * vec3f(1.4, 1.4, 0.8) + 4.4) * 0.10;
  let trod = (1.0 - smoothstep(0.45, 0.60, lp.y)) * (1.0 - smoothstep(0.25, 0.55, abs(lp.x))) * 0.12;
  wood = mix(wood, vec3f(0.13, 0.095, 0.060), min(bloom + trod, 0.6));
  (*s).alb = mix(wood, vec3f(0.022, 0.021, 0.020), seam) * vc;
  (*s).rough = mix(0.82 - late * 0.06, 0.6, seam); (*s).metal = 0.0; (*s).coat = 0.0; (*s).f0s = 0.45;   // dry oiled wood: a weak sheen
}
// K2 (2026-11-17: "the boat bottom should not be that clean"): the underbody a well-kept boat has a few months into the season, seen
// only when she is on her side (kw: the knockdown's large-angle switch, M.q.x; 0 upright: never called, the approved look bit for
// bit). In the hull frame (y up from the waterline, z aft): the antifouling matte and uneven (the roller's laps along the hull, faded
// chalky patches), a thin green-brown slime in the band under the waterline, light growth darker toward the keel and the rudder,
// faint streaks running down, and the keel's bottom and leading edge scuffed to the grey under the paint.
fn underbody(lp: vec3f, kw: f32, s: ptr<function, Surf>) {
  let p = lp; let deep = clamp(-p.y / 1.7, 0.0, 1.0);
  var a = (*s).alb;
  let roller = n01(vec3f(p.z * 1.1, p.y * 0.25, p.x * 3.0) + 1.7); a = a * mix(0.9, 1.08, roller);
  let chalk = smoothstep(0.5, 0.8, n01(p * vec3f(0.7, 1.4, 0.7) + 2.3)) * (1.0 - deep * 0.5);
  a = mix(a, mix(a, vec3f(dot(a, vec3f(0.33))), 0.6) * 1.9 + 0.035, chalk * 0.75);
  let streak = smoothstep(0.62, 0.9, n01(vec3f(p.z * 7.0, p.y * 0.35, p.x * 7.0) + 4.4)); a = a * (1.0 - 0.14 * streak);
  let film = smoothstep(-0.5, -0.08, p.y) * (1.0 - smoothstep(0.02, 0.1, p.y)) * (0.6 + 0.4 * n01(p * vec3f(2.2, 9.0, 2.2) + 8.1));
  a = mix(a, vec3f(0.16, 0.16, 0.07), film * 0.85);
  let grow = smoothstep(0.25, 0.95, deep) * smoothstep(0.32, 0.78, n01(p * vec3f(2.6, 3.4, 2.6) + 7.1));
  a = mix(a, vec3f(0.07, 0.08, 0.042), grow * 0.6);
  let keel = (1.0 - smoothstep(-0.85, -0.62, p.y)) * (1.0 - smoothstep(0.12, 0.3, abs(p.x)));
  let scr = smoothstep(0.8, 0.9, n01(vec3f(p.z * 13.0, p.y * 38.0, p.x * 13.0) + 0.6)) + smoothstep(0.86, 0.94, n01(vec3f(p.z * 3.0, p.y * 24.0, p.x * 30.0) + 5.2));
  a = mix(a, vec3f(0.30, 0.29, 0.27), keel * min(scr, 1.0) * 0.7);
  (*s).alb = mix((*s).alb, a, kw);
  (*s).rough = mix((*s).rough, 0.95 - film * 0.25, kw);   // the slime a little wet
}
// the boot stripe and the topsides just over the waterline stained by the scum line (only on her side, as above)
fn bootStain(lp: vec3f, nl: vec3f, kw: f32, s: ptr<function, Surf>) {
  let side = 1.0 - smoothstep(0.1, 0.45, abs(nl.y));
  let band = (1.0 - smoothstep(0.02, 0.22, lp.y)) * smoothstep(-0.05, 0.0, lp.y) * side;
  let st = band * (0.5 + 0.5 * n01(vec3f(lp.z * 3.5, lp.y * 30.0, lp.x * 2.0) + 3.3));
  (*s).alb = mix((*s).alb, (*s).alb * vec3f(0.66, 0.62, 0.44), st * 0.8 * kw);
}
// the cotangent frame (three's perturbNormal2Arb) from the world derivatives: a tangent-space normal map on n
fn perturb(n: vec3f, q0: vec3f, q1: vec3f, st0: vec2f, st1: vec2f, mapN: vec3f) -> vec3f {
  let q1p = cross(q1, n); let q0p = cross(n, q0);
  let T = q1p * st0.x + q0p * st1.x; let B = q1p * st0.y + q0p * st1.y;
  let det = max(dot(T, T), dot(B, B));
  let sc = select(inverseSqrt(det), 0.0, det == 0.0);
  return normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + n * mapN.z);
}
// the material record → the surface (in the HULL frame; the caller turns the normals to the world)
fn surfaceOf(v: GV, mt: Mat, ff: bool, dpx: vec3f, dpy: vec3f, duvx: vec2f, duvy: vec2f) -> Surf {
  var s: Surf;
  let nl0 = normalize(v.nl) * select(-1.0, 1.0, ff);   // two-sided: the normal on the camera's side
  s.n = nl0; s.coatN = nl0; s.f0s = 1.0;
  let vc = select(vec3f(1.0), v.col.rgb, mt.ex.x > 0.5);
  let kind = i32(mt.kind.x + 0.5);
  s.alb = mt.base.rgb * vc; s.metal = mt.mr.x; s.rough = mt.mr.y; s.coat = mt.mr.z; s.coatRough = mt.mr.w;
  if (mt.kind.y >= 0.0) { s.alb *= textureSampleGrad(texC, sRep, v.uv, i32(mt.kind.y), duvx, duvy).rgb; }
  if (mt.kind.w >= 0.0) { let t = textureSampleGrad(texD, sRep, v.uv, i32(mt.kind.w), duvx, duvy); s.rough *= t.g; s.metal *= t.b; }
  if (kind == ${KIND.gelcoat}) { gelcoat(v.lp, nl0, vc, mt.ex.y, &s); if (M.q.x > 0.0) { bootStain(v.lp, nl0, clamp(M.q.x, 0.0, 1.0), &s); } }
  else if (kind == ${KIND.livery}) { livery(v.lp, nl0, vc, mt.ex.y, v.uv.x, M.p.w, &s); if (M.q.x > 0.0) { bootStain(v.lp, nl0, clamp(M.q.x, 0.0, 1.0), &s); } }
  else if (kind == ${KIND.nonskid}) { nonskid(v.lp, nl0, vc, mt.ex.y, dpx, dpy, &s); }
  else if (kind == ${KIND.antifouling}) { s.alb = vc * mix(0.85, 1.12, n01(v.lp * vec3f(3.0, 6.0, 3.0))); s.rough = 0.9; s.metal = 0.0; if (M.q.x > 0.0) { underbody(v.lp, clamp(M.q.x, 0.0, 1.0), &s); } }
  else if (kind == ${KIND.stainless}) { stainless(v.lp, &s); }
  else if (kind == ${KIND.teak}) { teak(v.lp, v.uv, duvx, duvy, vc, &s); }
  return s;
}
`;

// lighting a surface (the M3 solid's terms + the clear coat as a second lobe): sun through the shadow map, the sky and
// the lake, the sky's mirror, the GGX highlight; below the waterline the column, then the air
const SHADE_FN = `
fn shadeSurf(s: Surf, nW: vec3f, cW: vec3f, world: vec3f, yl: f32, px: vec2f, air: vec3f) -> vec3f {
  let V = normalize(F.cam.xyz - world);
  let sd = normalize(F.sun.xyz);
  let nl = max(dot(nW, sd), 0.0);
  let eSun = sunPerp() * shadowAt(world, nl);
  let eSky = ambientAt(nW);
  var rough = clamp(s.rough, 0.04, 1.0); let metal = clamp(s.metal, 0.0, 1.0);
  var f0s = s.f0s; var coat = s.coat; var coatRough = s.coatRough;
  // K2 (knocked down, the bottom and side read very shiny and unreal, 2026-11-17): on its side the hull turns faces the
  // upright boat never shows to the eye. Past 34° of heel (M.q.x, render/boat.js) the hull is shaded as a real one: what a face
  // reflects below the horizon is the lake (the sky mirrored at the water's Fresnel, over the deep water's own light), not the
  // horizon sky the clamp gave; the antifouling is matte (a rough surface's Fresnel stays low at grazing angles, a low f0); the
  // gelcoat's clear coat is satin, not a mirror; a thin wet sheen only where the water just ran off (the band over the waterline).
  // Upright (q.x 0) nothing here runs: the approved look, bit for bit.
  let kdK = clamp(M.q.x, 0.0, 1.0);
  var below = 0.0; var lakeR = vec3f(0.0); var lakeC = vec3f(0.0);
  if (kdK > 0.0) {
    let wet = (1.0 - smoothstep(0.0, 0.35, world.y - select(M.q.y, waterAt(world.xz), wpOn()))) * kdK;   // the band the water just ran off (the drawn water's height there)
    if (rough > 0.6) { rough = mix(rough, 0.97, kdK); f0s = mix(f0s, 0.5, kdK); }   // the antifouling (0.9): matte, a low sheen
    rough = mix(rough, rough * 0.55, wet);
    coatRough = mix(coatRough, mix(0.32, 0.12, wet), kdK); coat = mix(coat, coat * 0.6, kdK * (1.0 - wet));
    let Rr = reflect(-V, nW); below = (1.0 - smoothstep(-0.06, 0.0, Rr.y)) * kdK;
    let Rm = normalize(vec3f(Rr.x, abs(Rr.y), Rr.z));
    let Rcr = reflect(-V, cW); let Rcm = normalize(vec3f(Rcr.x, abs(Rcr.y), Rcr.z));
    let deep = WUP * (LIGHT.sun.rgb + LIGHT.sky.rgb) / PI * RINF;
    lakeR = skyMirror(Rm) * (0.02 + 0.98 * pow(1.0 - Rm.y, 5.0)) + deep;
    lakeC = skyMirror(Rcm) * (0.02 + 0.98 * pow(1.0 - Rcm.y, 5.0)) + deep;
    below = max(below, 0.0); lakeC = mix(skyMirror(normalize(vec3f(Rcr.x, max(Rcr.y, 0.02), Rcr.z))), lakeC, (1.0 - smoothstep(-0.06, 0.0, Rcr.y)));
  }
  let f0 = mix(vec3f(0.04 * f0s), s.alb, metal);
  let diff = s.alb * (1.0 - metal) / PI * (eSun * nl + eSky + navLightAt(world, nW));   // fix(v2) boat night light: her own lights
  var R = reflect(-V, nW); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let nv = max(dot(nW, V), 0.0);
  var fres = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  var envL = skyMirror(R);
  if (kdK > 0.0) { fres = mix(fres, f0 + (max(vec3f(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0), kdK); envL = mix(envL, lakeR, below); }   // a rough face's Fresnel (Fdez-Agüera 2019)
  let env = envL * fres * (1.0 - 0.7 * rough);
  let spec = ggxSpec(nW, V, sd, rough, f0) * eSun;
  var col = diff + env + spec;
  if (coat > 0.0) {
    let fc = 0.04 + 0.96 * pow(1.0 - max(dot(cW, V), 0.0), 5.0);
    var Rc = reflect(-V, cW); Rc = normalize(vec3f(Rc.x, max(Rc.y, 0.02), Rc.z));
    var skyC = skyMirror(Rc);
    if (kdK > 0.0) { skyC = mix(skyC, lakeC, kdK); }
    let coatL = skyC * fc * (1.0 - 0.7 * coatRough) + ggxSpec(cW, V, sd, max(coatRough, 0.04), vec3f(0.04)) * eSun;
    col = col * (1.0 - coat * fc) + coatL * coat;
  }
  col = underwater(col, s.alb, nW, world, air, yl);
  var Tair = vec3f(1.0);
  let inS = aerialParts(px, world, &Tair);
  return col * Tair + inS;
}
fn toWorld(n: vec3f) -> vec3f { return normalize((M.n * vec4f(n, 0.0)).xyz); }
`;

export const GLB_WGSL = (head, mode) => `diagnostic(off, derivative_uniformity);
${head}
${GLB_HEAD}
${SURFACE_FN}
${SHADE_FN}
@fragment fn fs(v: GV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dpx = dpdx(v.lp); let dpy = dpdy(v.lp); let duvx = dpdx(v.uv); let duvy = dpdy(v.uv);
  let wdx = dpdx(v.world); let wdy = dpdy(v.world);
  ${mode === 'opaque' ? `if (M.p.z < 1.0 && ign(v.pos.xy) >= M.p.z) { discard; }   // the swap's dissolve in (render/boat.js)` : ''}
  let mt = MATS[v.mat];
  var s = surfaceOf(v, mt, ff, dpx, dpy, duvx, duvy);
  var nW = toWorld(s.n);
  if (mt.kind.z >= 0.0) {
    let t = textureSampleGrad(texD, sRep, v.uv, i32(mt.kind.z), duvx, duvy).xyz * 2.0 - 1.0;
    nW = perturb(nW, wdx, wdy, duvx, duvy, t);
  }
  let cW = select(nW, toWorld(s.coatN), i32(mt.kind.x + 0.5) == ${KIND.gelcoat});
  ${mode === 'glass'
    ? `let V = normalize(F.cam.xyz - v.world); let sd = normalize(F.sun.xyz);
  let a = mt.ex.z;
  let fres = 0.04 + 0.96 * pow(1.0 - abs(dot(nW, V)), 5.0);
  var R = reflect(-V, nW); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let nl = abs(dot(nW, sd));
  let lit = s.alb / PI * (sunPerp() * shadowAt(v.world, nl) * nl + ambientAt(nW)) * a;
  let refl = skyMirror(R) * fres * (1.0 - 0.7 * s.rough) + ggxSpec(nW, V, sd, max(s.rough, 0.04), vec3f(0.04)) * sunPerp();
  var Tair = vec3f(1.0); let inS = aerialParts(v.pos.xy, v.world, &Tair);
  let alpha = clamp(a + fres * (1.0 - a), 0.0, 1.0);
  return vec4f((lit + refl) * Tair + inS * alpha, alpha);`
    : `return vec4f(shadeSurf(s, nW, cW, v.world, v.yl, v.pos.xy, v.air), 1.0);`}
}`;

// the cabin seen through the companionway (cockpitLook.js): unlit, its baked vertex light × the base texture × the day's
// level (CABIN_LIGHT 0.55 of v1's luminance unit, a lit white ≈ 3.5 of it: a cabin in shade)
export const CABIN_LIGHT = 0.55 / 3.5;
export const CABIN_WGSL = (head) => `diagnostic(off, derivative_uniformity);
${head}
${GLB_HEAD}
@fragment fn fs(v: GV) -> @location(0) vec4f {
  let duvx = dpdx(v.uv); let duvy = dpdy(v.uv);
  let mt = MATS[v.mat];
  var c = v.col.rgb;
  if (mt.kind.y >= 0.0) { c *= textureSampleGrad(texC, sRep, v.uv, i32(mt.kind.y), duvx, duvy).rgb; }
  var lit = (sunPerp() * max(normalize(F.sun.xyz).y, 0.0) * 0.7 + LIGHT.sky.rgb) / PI * ${CABIN_LIGHT.toFixed(5)};
  // M5e: by night a red night light (v1's src/boat/nightLight.js NIGHT_FACE.cabin: 5 % of the day's level on screen, so its
  // value is divided by the frame's exposure factor), the brighter of the two
  lit = max(lit, vec3f(1.0, 0.36, 0.22) * (${CABIN_LIGHT.toFixed(5)} * 0.05 * 0.3 / max(F.params.x, 1e-4)) * F.night.w);
  var Tair = vec3f(1.0); let inS = aerialParts(v.pos.xy, v.world, &Tair);
  return vec4f(c * lit * Tair + inS, 1.0);
}`;
// the portal: depth only (no colour), after the cabin and before everything else of the boat
export const PORTAL_WGSL = (head) => `${head}
${GLB_HEAD}
@fragment fn fs(v: GV) -> @location(0) vec4f { return vec4f(0.0); }`;

// --- the GPU side ---
export function createBoatModels({ device, reg, layout, frameStruct, head, hdrTarget, msaa, depthFormat, glbBGL, errors = [], under = null }) {   // under: phase 2a: the opaque model text to its under-water twin (render/boat.js underTwin; null: none)
  const f3 = (loc) => ({ arrayStride: 12, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x3' }] });
  const BUFS = [f3(0), f3(1), { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
    { arrayStride: 4, attributes: [{ shaderLocation: 3, offset: 0, format: 'unorm8x4' }] }, { arrayStride: 4, attributes: [{ shaderLocation: 4, offset: 0, format: 'uint32' }] }];
  const depthOn = { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' };
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const mO = reg.shader('boat-glb', GLB_WGSL(head, 'opaque')), mG = reg.shader('boat-glb-glass', GLB_WGSL(head, 'glass'));
  const mC = reg.shader('boat-glb-cabin', CABIN_WGSL(head)), mP = reg.shader('boat-glb-portal', PORTAL_WGSL(head));
  const prim = { topology: 'triangle-list', cullMode: 'none' };
  reg.add('boat-glb', { layout, vertex: { module: mO, entryPoint: 'vsW', buffers: BUFS }, fragment: { module: mO, entryPoint: 'fs', targets: [hdrTarget] }, primitive: prim, depthStencil: depthOn, multisample: { count: msaa } });
  if (under) {
    const prevU = reg.group?.('under');
    const mOU = reg.shader('boat-glb-under', under(GLB_WGSL(head, 'opaque')));
    reg.add('boat-glb-under', { layout, vertex: { module: mOU, entryPoint: 'vsW', buffers: BUFS }, fragment: { module: mOU, entryPoint: 'fs', targets: [hdrTarget] }, primitive: prim, depthStencil: depthOn, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  }
  reg.add('boat-glb-glass', { layout, vertex: { module: mG, entryPoint: 'vs', buffers: BUFS }, fragment: { module: mG, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] }, primitive: prim, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  reg.add('boat-glb-cabin', { layout, vertex: { module: mC, entryPoint: 'vs', buffers: BUFS }, fragment: { module: mC, entryPoint: 'fs', targets: [hdrTarget] }, primitive: prim, depthStencil: depthOn, multisample: { count: msaa } });
  reg.add('boat-glb-portal', { layout, vertex: { module: mP, entryPoint: 'vs', buffers: BUFS }, fragment: { module: mP, entryPoint: 'fs', targets: [{ ...hdrTarget, writeMask: 0 }] }, primitive: prim, depthStencil: depthOn, multisample: { count: msaa } });

  const st = { phase: 'idle', bytes: 0, wireBytes: 0, files: 0, queued: 0, uploadMsMax: 0, uploadFrames: 0, buildMs: 0, decodeMs: 0, startMs: null, residentMs: null, error: null, triangles: null, materials: 0, images: 0 };
  let set = null, gpu = null, jobs = [], bg = null, worker = null;
  const lod = { near: true, detail: true };
  const now = () => performance.now();

  // the upload plan: every vertex array and the index in slices, then one image (all its mips) a job
  function plan(s, bitmaps) {
    const CD = GPUBufferUsage.COPY_DST;
    const mk = (label, arr, usage) => device.createBuffer({ label, size: Math.max(16, Math.ceil(arr.byteLength / 4) * 4), usage: usage | CD });
    gpu = {
      pos: mk('glb-pos', s.position, GPUBufferUsage.VERTEX), nrm: mk('glb-nrm', s.normal, GPUBufferUsage.VERTEX), uv: mk('glb-uv', s.uv, GPUBufferUsage.VERTEX),
      col: mk('glb-col', s.color, GPUBufferUsage.VERTEX), mat: mk('glb-mat', s.mat, GPUBufferUsage.VERTEX), idx: mk('glb-idx', s.index, GPUBufferUsage.INDEX),
      mats: mk('glb-mats', s.materials, GPUBufferUsage.STORAGE),
    };
    const nC = Math.max(1, s.images.filter((i) => i.array === 'C').length), nD = Math.max(1, s.images.filter((i) => i.array === 'D').length);
    const mips = Math.floor(Math.log2(Math.max(...TEX_SIZE))) + 1;
    gpu.texC = device.createTexture({ label: 'glb-texC', size: [TEX_SIZE[0], TEX_SIZE[1], nC], format: 'rgba8unorm-srgb', mipLevelCount: mips, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    gpu.texD = device.createTexture({ label: 'glb-texD', size: [TEX_SIZE[0], TEX_SIZE[1], nD], format: 'rgba8unorm', mipLevelCount: mips, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    gpu.samp = device.createSampler({ label: 'glb-rep', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
    jobs = [];
    const slices = (buf, arr) => { const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let o = 0; o < u8.byteLength; o += MODEL_UPLOAD_BYTES) { const n = Math.min(MODEL_UPLOAD_BYTES, u8.byteLength - o); jobs.push({ bytes: n, run: () => { const pad = (n + 3) & ~3; if (pad === n) device.queue.writeBuffer(buf, o, u8, o, n); else { const t = new Uint8Array(pad); t.set(u8.subarray(o, o + n)); device.queue.writeBuffer(buf, o, t); } } }); } };
    slices(gpu.mats, s.materials); slices(gpu.idx, s.index); slices(gpu.pos, s.position); slices(gpu.nrm, s.normal);
    slices(gpu.uv, s.uv); slices(gpu.col, s.color); slices(gpu.mat, s.mat);
    s.images.forEach((im, k) => {
      const levels = bitmaps[k];
      jobs.push({ bytes: TEX_SIZE[0] * TEX_SIZE[1] * 4, run: () => {
        const tex = im.array === 'C' ? gpu.texC : gpu.texD;
        levels.forEach((b, l) => { device.queue.copyExternalImageToTexture({ source: b, flipY: false }, { texture: tex, mipLevel: l, origin: [0, 0, im.layer], premultipliedAlpha: false }, [b.width, b.height, 1]); b.close?.(); });
      } });
    });
    st.queued = jobs.length;
  }
  function finish() {
    bg = device.createBindGroup({ label: 'glb', layout: glbBGL, entries: [
      { binding: 0, resource: { buffer: gpu.mats } }, { binding: 1, resource: gpu.texC.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: gpu.texD.createView({ dimension: '2d-array' }) }, { binding: 3, resource: gpu.samp }] });
    st.phase = 'resident'; st.residentMs = now();
  }
  function landed(msg) {
    set = msg.set;
    st.buildMs = msg.buildMs; st.decodeMs = msg.decodeMs; st.wireBytes = msg.wireBytes; st.files = msg.files; st.triangles = set.triangles; st.materials = set.materialNames.length; st.images = set.images.length;
    st.bytes = ['position', 'normal', 'uv', 'color', 'mat', 'index', 'materials'].reduce((a, k) => a + set[k].byteLength, 0);
    plan(set, msg.bitmaps);
    st.phase = 'uploading';
  }
  const request = (urls, opts) => new Promise((ok, no) => {
    worker = new Worker(new URL('./boat/worker.js', import.meta.url), { type: 'module', name: 'velia-boat' });
    worker.onmessage = (e) => { worker.terminate(); worker = null; if (e.data.error) no(new Error(e.data.error)); else ok(e.data); };
    worker.onerror = (e) => { worker?.terminate(); worker = null; no(new Error(e.message ?? 'boat worker')); };
    worker.postMessage({ urls, ...opts, texSize: TEX_SIZE });
  });

  const api = {
    get ready() { return st.phase === 'resident'; },
    get queued() { return jobs.length; },
    get set() { return set; },
    stats: st,
    lod,
    // live: fetch + build in the worker after the first frame; the frame pumps the uploads
    start(urls, opts) {
      st.phase = 'fetching'; st.startMs = now();
      return request(urls, opts).then(landed, (e) => { st.phase = 'failed'; st.error = String(e?.message ?? e); errors.push(`boat models: ${st.error}`); });
    },
    // a capture: everything before the first frame
    async loadAll(urls, opts) { await api.start(urls, opts); while (jobs.length) api.pump(Infinity); },
    pump(budget = MODEL_UPLOAD_BYTES) {
      if (!jobs.length) return;
      const t = now(); let spent = 0;
      while (jobs.length && (spent === 0 || spent + jobs[0].bytes <= budget)) { const j = jobs.shift(); j.run(); spent += j.bytes; }
      st.uploadFrames++; st.uploadMsMax = Math.max(st.uploadMsMax, now() - t); st.queued = jobs.length;
      if (!jobs.length) finish();
    },
    // v1's LODs from the boat's distance to the eye: the cockpit's near set inside 15 m (± 5 %), the small parts inside 24 ± 1 m
    updateLod(dist) {
      lod.near = lod.near ? dist < LOD.nearM * (1 + LOD.hyst) : dist < LOD.nearM * (1 - LOD.hyst);
      lod.detail = lod.detail ? dist < LOD.detailM + LOD.band : dist < LOD.detailM - LOD.band;
    },
    bindVB(pass, all = true) {
      pass.setVertexBuffer(0, gpu.pos);
      if (all) { pass.setVertexBuffer(1, gpu.nrm); pass.setVertexBuffer(2, gpu.uv); pass.setVertexBuffer(3, gpu.col); pass.setVertexBuffer(4, gpu.mat); }
      pass.setIndexBuffer(gpu.idx, 'uint32');
    },
    range(name) { return set.ranges[name]; },
    // the static ranges this frame (the LOD's choice), in draw order
    staticRanges(out) { out.length = 0; out.push('always'); if (lod.detail) out.push('detail'); out.push(lod.near ? 'near' : 'far'); return out; },
    get bg() { return bg; },
  };
  return api;
}
export { RANGES, MAT_FLOATS };
