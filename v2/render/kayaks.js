// The kayaks' drawing (v2 living lake): v1's three levels of detail (src/kayaks/fleet.js) on v2's GPU.
//   full  v1's kayak and its UBC paddler (tools/v2-kayak-bake.mjs → v2/assets/kayak/kayak.kyb.gz): the kayak's middle shell
//         with its deck hardware inside 90 m (v1's light shell beyond), the paddler and the held paddle skinned on the GPU
//         from a per-kayak palette (v2/sim/kayak-clip.js: v1's baked strokes at v1's pace), 2 draws a kayak
//   mid   v1's 300-triangle hull, PFD torso, dark head and paddle swung by v1's sine at the stroke rate: one instanced draw
//   far   v1's impostor: a sliver of the kayak's colour and a dark figure turned to the camera: one instanced draw
// One pipeline for full and mid ('kayak-skin': 4 bone slots a vertex, a palette of rigid slots per instance), one for far
// ('kayak-far'); both declared before the first frame. Lit as the boat is (the sun through the transmittance LUT, the sky,
// the lake's upwelling, the boat's night light, the aerial perspective, the clouds; no terrain shadow); nothing under the kayak's own waterline
// is drawn (v1's opaque water: the water's blend covers it, as the boat's hull: render/boat.js).
// The asset streams after the first frame (a capture: before it); until then the full tier draws as mid (v1's rule).
import { ATMO_WGSL, SKY_READ, AP_READ, LAND_SKY } from './sky.js';
import { WATER_WGSL } from './terrain.js';
import { UNDER_WGSL } from './underMedium.js';   // play as Tessie, phase 2a
import { underPipe } from './underState.js';
import { SEEN } from './underwater.js';   // the mirrors' sway and wind (render/boat.js's mirror terms)
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { BOAT_LIGHT_WGSL } from './boat.js';
import { parseKayakAsset, CLASSES } from './kayak/asset.js';
import { createClips, poseRows } from '../sim/kayak-clip.js';
import { mulRows, invRigid, blendRows } from '../sim/kayak-rigid.js';
import { kayakColours, linear } from '../sim/kayaks.js';

export const MAX_FULL = 4, MAX_MID = 8, MAX_FAR = 8;
// by the kayak's length on screen: the middle shell over 260 px (else v1's light shell: rows 64), the small parts (eyes,
// brows, shoes, deck hardware) over 120 px; v1 switched by metres at its own resolution (90 m, 60 m)
export const LOD_PX = Object.freeze({ shell: 260, detail: 120 });
export const COMP = Object.freeze({ sat: 1.8, dark: 0.7 });   // the sun side's chroma gain and darkening in v2's ACES (v1's AgX: 3.6, 0.10)
export const SLOTS = 67;
const INST = MAX_FULL + MAX_MID;            // the skin pipeline's instance records
export const IREC = 13;                     // vec4 per instance record (exported: the glass boat's paddlers fill their own, v2/render/tourBoat.js)
const PAL_SLOTS = MAX_FULL * SLOTS + MAX_MID * 2;
const FAR_REC = 3;                          // vec4 per far record
const DEG = Math.PI / 180;

export const COMMON = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${WATER_WGSL}
${SHADOW_STRUCT}
@group(2) @binding(2) var tShadowK: texture_depth_2d;
@group(2) @binding(3) var sShadowK: sampler_comparison;
@group(2) @binding(4) var<uniform> SH: Shadow;
${SHADOW_READ('tShadowK', 'sShadowK')}
// fix(v2) kayak light (2026-11-18: the kayaks read dark at every hour): lit as the boat beside them, term for term
// (render/boat.js sunPerp, BOAT_LIGHT_WGSL): × the storm cell's shade at the eye as the boat's
fn sunPerp() -> vec3f { let rC = Rg + F.sky.z; let s = normalize(F.sun.xyz); return F.sky.x * transAt(rC, s.y) * step(0.0, raySphere(vec3f(0.0, rC, 0.0), s, Rg) * -1.0) * F.storm.y; }
fn ggxSpec(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let a2 = max(rough * rough * rough * rough, 1e-4);
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0); let nv = max(dot(n, v), 1e-3); let nl = max(dot(n, l), 0.0); let vh = max(dot(v, h), 0.0);
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let f = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  let vis = 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2) + 1e-5);
  return d * f * vis * nl;
}
${BOAT_LIGHT_WGSL}
const KAYAK_SKY_DESAT = ${LAND_SKY.desat.toFixed(2)};
fn shade(world: vec3f, nIn: vec3f, alb: vec3f, rough: f32, metal: f32, sheen: f32) -> vec3f {
  let V = normalize(F.cam.xyz - world);
  var n = normalize(nIn);
  let s = normalize(F.sun.xyz);
  let nl = max(dot(n, s), 0.0);
  // no terrain shadow: the boat and the water beside them take none (a ridge's evening shadow over the bay left the pair
  // in shade beside a sunlit boat on sunlit water: 33 against the boat's 109 at 19:30); the shadow read stays bound (shadowAt)
  let eSun = sunPerp();
  // the sky light by day drawn toward its own grey as the land's (render/sky.js landSky, LAND_SKY.desat: the world's rule for the
  // blue sky light on coloured things); the warm hulls, PFDs and skin lost their colour and a third of their light under the
  // blue side light (v1's shade-side white balance did the same job by cutting the colour's green and blue: it is gone)
  let eSky0 = ambientAt(n);
  let eSky = mix(eSky0, vec3f(dot(eSky0, vec3f(0.2126, 0.7152, 0.0722))), KAYAK_SKY_DESAT * boatDay());
  let f0 = mix(vec3f(0.04), alb, metal);
  let diff = alb * (1.0 - metal) / PI * (eSun * nl + eSky);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let env = skyMirror(R) * fres * (1.0 - 0.8 * rough);
  let spec = ggxSpec(n, V, s, rough, f0) * eSun;
  // fabric's soft sheen at grazing view (v1's sheen on the knits and the PFD), lit by the sun and the sky
  let sh = sheen * pow(1.0 - max(dot(n, V), 0.0), 4.0) * alb * (eSun * nl + eSky) / PI * 0.6;
  return diff + env + spec + sh;
}
// the mirrors in the water (2026-11-19; render/boat.js's helpers, the same terms)
fn uwWindK() -> f32 { return smoothstep(${SEEN.wind[0].toFixed(3)}, ${SEEN.wind[1].toFixed(3)}, F.wind.x); }
const UW_SWAY0 = ${SEEN.sway[0].toFixed(3)}; const UW_SWAY1 = ${SEEN.sway[1].toFixed(3)};
fn mirSway(wp: vec3f) -> vec3f {
  var w = wp; let dd = min(-w.y, 12.0); let tt = F.cam.w; let sw = mix(UW_SWAY0, UW_SWAY1, uwWindK()) * 1.6;
  w.x += sw * dd * sin(w.z * 0.9 + tt * 1.7); w.z += sw * dd * sin(w.x * 0.8 - tt * 1.3); return w;
}
fn mirHash(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn mirNoise(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mirHash(i), mirHash(i + vec2f(1.0, 0.0)), u.x), mix(mirHash(i + vec2f(0.0, 1.0)), mirHash(i + vec2f(1.0, 1.0)), u.x), u.y); }
fn mirAlpha(world: vec3f, srcY: f32, fadeM: f32) -> f32 {
  let dir = world - F.cam.xyz; let cosV = abs(normalize(dir).y);
  let fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0); let tt = F.cam.w;
  let rip = 0.55 + 0.45 * mirNoise(vec2f(world.x * 0.9 + world.y * 2.0, world.z * 0.9 + tt * 0.8)) * mirNoise(vec2f(world.x * 3.1 + tt * 1.3, world.z * 3.1));
  return fres * 0.6 * exp(-srcY / fadeM) * rip * (1.0 - 0.55 * uwWindK()) * (1.0 - 0.85 * F.storm.x);
}
fn mirDepth(world: vec3f) -> f32 { let eye = F.cam.xyz; let k = (eye.y - 0.12) / max(eye.y - world.y, 1e-3); let cp = F.viewProj * vec4f(eye + (world - eye) * k, 1.0); return cp.z / cp.w; }
struct MirOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 }
fn finish(col: vec3f, px: vec2f, world: vec3f) -> vec4f {
  var Tair = vec3f(1.0);
  let inS = aerialParts(px, world, &Tair);
  var out = col * Tair + inS;
  let toP = world - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, 1.0);
}`;

// the full and mid tiers: the vertex is v1's bind-frame point; the kayak frame is Σ w · S_slot (the instance's palette);
// the world is the instance's rows (the float's pose)
export const SKIN_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> PAL: array<vec4f>;
@group(2) @binding(1) var<storage, read> INS: array<vec4f>;
struct KV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) cls: u32, @location(3) c: vec3f, @location(4) yl: f32, @location(5) @interpolate(flat) inst: u32, @location(6) lp: vec3f }
@vertex fn vs(@location(0) p: vec4f, @location(1) n: vec4f, @location(2) j: vec4u, @location(3) w: vec4f, @location(4) c: vec4u, @builtin(instance_index) ii: u32) -> KV { return skinVs(p, n, j, w, c, ii, false); }
@vertex fn vsMirror(@location(0) p: vec4f, @location(1) n: vec4f, @location(2) j: vec4u, @location(3) w: vec4f, @location(4) c: vec4u, @builtin(instance_index) ii: u32) -> KV { return skinVs(p, n, j, w, c, ii, true); }
fn skinVs(p: vec4f, n: vec4f, j: vec4u, w: vec4f, c: vec4u, ii: u32, flip: bool) -> KV {
  let base = bitcast<u32>(INS[ii * ${IREC}u + 3u].x);
  let p0 = vec4f(p.xyz * ${(2.5).toFixed(1)}, 1.0); let n0 = vec4f(n.xyz, 0.0);
  var kp = vec3f(0.0); var kn = vec3f(0.0);
  for (var k = 0u; k < 4u; k++) {
    if (w[k] > 0.0) { let o = (base + j[k]) * 3u; let a = PAL[o]; let b = PAL[o + 1u]; let cc = PAL[o + 2u]; kp += w[k] * vec3f(dot(a, p0), dot(b, p0), dot(cc, p0)); kn += w[k] * vec3f(dot(a.xyz, n0.xyz), dot(b.xyz, n0.xyz), dot(cc.xyz, n0.xyz)); }
  }
  let r0 = INS[ii * ${IREC}u]; let r1 = INS[ii * ${IREC}u + 1u]; let r2 = INS[ii * ${IREC}u + 2u];
  let kp4 = vec4f(kp, 1.0); let kn4 = vec4f(kn, 0.0);
  var wp = vec3f(dot(r0, kp4), dot(r1, kp4), dot(r2, kp4)); var wn = vec3f(dot(r0, kn4), dot(r1, kn4), dot(r2, kn4));
  if (flip) { wp = mirSway(vec3f(wp.x, -wp.y, wp.z)); wn.y = -wn.y; }
  var o: KV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn;
  // the waterline: the kayak's own (its frame's draft), or the world's water level (a capsize: the hull rolled far, the
  // paddler in the water; INS[3].z set, .w the level)
  let i3 = INS[ii * ${IREC}u + 3u];
  o.cls = c.x; o.c = vec3f(c.yzw) / 255.0; o.yl = select(kp.y - i3.y, wp.y - i3.w, i3.z > 0.5); o.inst = ii; o.lp = kp; return o;
}
fn hash3(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
// v1's sun-side compensation (src/props/kayak/materials.js, look.js compensated): the saturated colours keep their hue in
// sun and shade. In v2's ACES the sun side needs less than under v1's AgX (COMP below, not v1's 3.6 / 0.10). The shade side's
// partial white balance (v1's: the albedo × 1.22, 0.68, 0.45 off the sun) is now the sky light's own, drawn toward grey (shade)
fn compensate(base: vec3f, n: vec3f, strength: f32) -> vec3f {
  let s = normalize(F.sun.xyz); let sunK = smoothstep(0.0, 0.174, s.y);
  let lit = max(dot(n, s), 0.0) * sunK + (n.y * 0.5 + 0.5) * 0.35 * sunK;
  let tl = smoothstep(0.05, 0.80, lit) * strength;
  let lum0 = vec3f(dot(base, vec3f(0.2126, 0.7152, 0.0722)));
  let cmax = max(base.x, max(base.y, base.z)); let cmin = min(base.x, min(base.y, base.z));
  let chroma = clamp((cmax - cmin) / max(cmax, 1e-3), 0.0, 1.0);
  let rich = max(lum0 + (base - lum0) * mix(1.0, ${COMP.sat}, chroma), vec3f(-0.04)) * mix(1.0, ${COMP.dark}, chroma);
  return max(mix(base, rich, tl), vec3f(0.0));
}
@fragment fn fs(v: KV, @builtin(front_facing) ff: bool) -> @location(0) vec4f { return finish(skinLit(v, ff), v.pos.xy, v.world); }
// the kayak and its paddler in the water's mirror: above its waterline only, the faces the mirrored view sees, shaded where it is
@fragment fn fsMirror(v: KV, @builtin(front_facing) ff: bool) -> MirOut {
  if (v.yl < 0.02 || dot(v.n, F.cam.xyz - v.world) < 0.0) { discard; }
  var src = v; src.world = vec3f(v.world.x, -v.world.y, v.world.z); src.n = vec3f(v.n.x, -v.n.y, v.n.z);
  let col = finish(skinLit(src, !ff), v.pos.xy, v.world).rgb;
  let a = mirAlpha(v.world, -v.world.y, 2.5);
  var o: MirOut; o.c = vec4f(col * a, a); o.depth = mirDepth(v.world); return o;
}
fn skinLit(v: KV, ff: bool) -> vec3f {
  // below the kayak's own waterline nothing is drawn (v1's opaque water); the last 2 cm blend into the water column
  if (v.yl < -0.02) { discard; }
  let I = v.inst * ${IREC}u;
  let col = v.c;
  let nF = normalize(select(-v.n, v.n, ff));
  var alb = vec3f(0.5); var rough = 0.6; var metal = 0.0; var sheen = 0.0;
  switch (v.cls) {
    case ${CLASSES.hull}u: {
      // the polyethylene shell (v1's materials.js): the kayak's colour; the non-slip pad's grooves darker; grime in the
      // cavities; a faint sun-faded mottle
      alb = compensate(INS[I + 4u].rgb * (0.94 + 0.08 * vnoise3(v.lp * 7.0)), nF, 1.0) * (1.0 - 0.25 * col.y) * (1.0 - 0.35 * col.z);
      rough = 0.42 + 0.25 * col.y;
    }
    case ${CLASSES.kayak_nylon}u, ${CLASSES.kayak_paddle_rings}u: { alb = vec3f(0.032, 0.032, 0.034); rough = 0.6; }
    case ${CLASSES.kayak_cord}u: { alb = vec3f(0.024, 0.024, 0.026); rough = 0.85; }
    case ${CLASSES.kayak_holes}u: { alb = vec3f(0.0103, 0.0122, 0.0129); rough = 0.8; }
    case ${CLASSES.kayak_seatback}u: { alb = vec3f(0.012, 0.013, 0.016); rough = 0.95; }
    case ${CLASSES.kayak_seat_frame}u: { alb = vec3f(0.075, 0.078, 0.082); rough = 0.42; metal = 0.5; }
    case ${CLASSES.kayak_paddle_shaft}u: { alb = vec3f(0.018, 0.018, 0.020); rough = 0.4; metal = 0.25; }
    case ${CLASSES.kayak_paddle_blades}u: { alb = INS[I + 12u].rgb; rough = 0.5; }
    case ${CLASSES.paddler_body}u: {
      // v1's body: the skin tone (× 0.82, its diffuse under the swatch), the top, the shorts and the shoes painted by the
      // garment weights; the knits a little rougher and sheened
      var b = INS[I + 9u].rgb * 0.82;
      b = mix(b, INS[I + 6u].rgb, col.x); b = mix(b, INS[I + 7u].rgb, col.y); b = mix(b, INS[I + 8u].rgb, col.z);
      alb = b; rough = mix(0.58, 0.88, max(col.x, max(col.y, col.z))); sheen = 0.3;
    }
    case ${CLASSES.paddler_pfd}u: {
      // the PFD (v1's look.js): quilted channels, the dark front zip, the hem binding, black side straps
      let around = col.x; let up = col.y;
      let zip = (1.0 - smoothstep(0.004, 0.012, min(around, 1.0 - around)));
      let channels = (1.0 - smoothstep(0.02, 0.18, abs(sin(up * 3.14159265 * 6.0))));
      let hem = (1.0 - smoothstep(0.03, 0.06, up));
      var pc = compensate(INS[I + 5u].rgb * (1.0 - channels * 0.22), nF, 1.0);
      pc = mix(pc, vec3f(0.03, 0.03, 0.035), max(zip, hem * 0.9));
      pc = mix(pc, vec3f(0.025, 0.025, 0.03), smoothstep(0.75, 0.8, col.z));
      alb = pc; rough = 0.6 + channels * 0.15; sheen = 0.5;
    }
    case ${CLASSES.paddler_hair}u: { alb = INS[I + 10u].rgb; rough = 0.7; }
    case ${CLASSES.paddler_brows}u: { alb = INS[I + 10u].rgb * 0.75; rough = 0.8; }
    case ${CLASSES.paddler_eyes}u: { alb = vec3f(0.48, 0.45, 0.40) * 0.62; rough = 0.5; }
    case ${CLASSES.paddler_hat}u: { alb = compensate(INS[I + 11u].rgb, nF, 0.7); rough = 0.85; sheen = 0.3; }
    case ${CLASSES.paddler_shoe_l}u: { alb = mix(INS[I + 8u].rgb * 0.6, vec3f(0.22, 0.22, 0.21), col.x); rough = 0.8; }
    case ${CLASSES.mid_torso}u: { alb = compensate(INS[I + 5u].rgb, nF, 1.0); rough = 0.8; }
    case ${CLASSES.mid_head}u: { alb = vec3f(0.0232, 0.0194, 0.0159); rough = 0.85; }
    case ${CLASSES.mid_paddle}u: { alb = vec3f(0.0168, 0.0319, 0.0685); rough = 0.5; }
    default: {}
  }
  var lit = shade(v.world, nF, alb, rough, metal, sheen);
  // the last 2 cm under the waterline: into the water column's own colour (render/boat.js underwater)
  let d = max(-v.yl, 0.0); let T = exp(-WK * 2.4 * d) * 0.25;
  let column = WUP * (LIGHT.sun.rgb + LIGHT.sky.rgb) / PI * (alb * T + RINF * (1.0 - T));
  lit = mix(column, lit, smoothstep(-0.02, 0.0, v.yl));
  return lit;
}`;

// the far tier: two quads a kayak (v1's: the hull sliver as long as the kayak looks from here, a dark figure), turned to
// the camera about the vertical, their normals up (lit as the water is, so they never read black against the sun)
export const FAR_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> FAR: array<vec4f>;
struct FV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) @interpolate(flat) col: vec3f }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FV {
  let a = FAR[ii * ${FAR_REC}u]; let b = FAR[ii * ${FAR_REC}u + 1u]; let cc = FAR[ii * ${FAR_REC}u + 2u];
  let q = vi / 6u; let k = vi % 6u;
  let cx = select(-0.5, 0.5, k == 1u || k == 2u || k == 4u); let cy = select(0.0, 1.0, k == 2u || k == 4u || k == 5u);
  // q 0: the hull sliver (width a.w, 0.36 m tall from 0.12 m under the water); q 1: the figure (0.42 × 0.62 m from 0.2 m up)
  let w = select(0.42, a.w, q == 0u); let h = select(0.62, 0.36, q == 0u); let y0 = select(0.2, -0.12, q == 0u);
  let right = vec3f(cos(b.x), 0.0, -sin(b.x));
  let wp = vec3f(a.x, a.y + y0 + cy * h, a.z) + right * (cx * w);
  var o: FV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.col = select(vec3f(0.0242, 0.0232, 0.0232), cc.rgb, q == 0u); return o;
}
@fragment fn fs(v: FV) -> @location(0) vec4f { return finish(shade(v.world, vec3f(0.0, 1.0, 0.0), v.col, 0.6, 0.0, 0.0), v.pos.xy, v.world); }`;

// Play as Tessie, phase 2a: the kayaks seen from under the water. The twin module is the skin's own text with its
// waterline line swapped (the part under the surface lit by the light left at its depth, umLit, not the column seen from above) and an
// fsUnder entry (the straight path to the eye, umFog, in place of the air). The clear shells read from below in phase 2c.
export const SKIN_UNDER_SWAPS = Object.freeze([
  ['  lit = mix(column, lit, smoothstep(-0.02, 0.0, v.yl));', '  lit = mix(umLit(alb, nF, max(-v.world.y, 0.0), 1.0) + column * 0.0, lit, smoothstep(-0.02, 0.0, v.yl));'],
]);
export const SKIN_UNDER_WGSL = () => `
@fragment fn fsUnder(v: KV, @builtin(front_facing) ff: bool) -> @location(0) vec4f { return vec4f(umFog(skinLit(v, ff), v.world), 1.0); }`;

export function createKayaksRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', errors = [], mirrors = false, under = false }) {   // under: phase 2a's skin twin (src/core/features.js tessieUnder)
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const pal = device.createBuffer({ label: 'kayak-palette', size: PAL_SLOTS * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const ins = device.createBuffer({ label: 'kayak-instances', size: INST * IREC * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const far = device.createBuffer({ label: 'kayak-far', size: MAX_FAR * FAR_REC * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const palData = new Float32Array(PAL_SLOTS * 12), insData = new Float32Array(INST * IREC * 4), insU32 = new Uint32Array(insData.buffer), farData = new Float32Array(MAX_FAR * FAR_REC * 4);
  const shEntries = [{ binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }];
  const shRes = [{ binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }];
  const skinBGL = device.createBindGroupLayout({ label: 'kayak-skin', entries: [{ binding: 0, visibility: VX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: VX | FR, buffer: { type: 'read-only-storage' } }, ...shEntries] });
  const skinBG = device.createBindGroup({ layout: skinBGL, entries: [{ binding: 0, resource: { buffer: pal } }, { binding: 1, resource: { buffer: ins } }, ...shRes] });
  const farBGL = device.createBindGroupLayout({ label: 'kayak-far', entries: [{ binding: 0, visibility: VX, buffer: { type: 'read-only-storage' } }, ...shEntries] });
  const farBG = device.createBindGroup({ layout: farBGL, entries: [{ binding: 0, resource: { buffer: far } }, ...shRes] });
  const pl = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
  const mS = reg.shader('kayak-skin', SKIN_WGSL(frameStruct));
  const vbuf = { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'snorm16x4' }, { shaderLocation: 1, offset: 8, format: 'snorm8x4' }, { shaderLocation: 2, offset: 12, format: 'uint8x4' }, { shaderLocation: 3, offset: 16, format: 'unorm8x4' }, { shaderLocation: 4, offset: 20, format: 'uint8x4' }] };
  const depth = { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' };
  reg.add('kayak-skin', { layout: pl(frameBGL, sky.skyBGL, skinBGL), vertex: { module: mS, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mS, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth, multisample: { count: msaa } });
  if (under) {   // phase 2a: the skin's under-water twin (its own module; the deferred 'under' group)
    const prevU = reg.group?.('under');
    let t = SKIN_WGSL(frameStruct);
    for (const [x, y] of SKIN_UNDER_SWAPS) { if (!t.includes(x)) throw new Error('kayak under twin: ' + x.slice(0, 40)); t = t.replace(x, y); }
    const mSU = reg.shader('kayak-skin-under', t + UNDER_WGSL + SKIN_UNDER_WGSL());
    reg.add('kayak-skin-under', { layout: pl(frameBGL, sky.skyBGL, skinBGL), vertex: { module: mSU, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mSU, entryPoint: 'fsUnder', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  }
  if (mirrors) {
    const mb = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    reg.add('kayak-skin-mirror', { layout: pl(frameBGL, sky.skyBGL, skinBGL), vertex: { module: mS, entryPoint: 'vsMirror', buffers: [vbuf] }, fragment: { module: mS, entryPoint: 'fsMirror', targets: [{ ...hdrTarget, blend: mb }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });
  }
  const mF = reg.shader('kayak-far', FAR_WGSL(frameStruct));
  reg.add('kayak-far', { layout: pl(frameBGL, sky.skyBGL, farBGL), vertex: { module: mF, entryPoint: 'vs' }, fragment: { module: mF, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth, multisample: { count: msaa } });

  let asset = null, clips = null, vb = null, ib = null, parts = null, loading = null;
  const stats = { bytes: 0, loadMs: null, full: 0, mid: 0, far: 0, calls: 0, triangles: 0 };
  // the mid tier's mesh is v1's own little hull (baked with the rest): until the asset is in, nothing is drawn but far
  const colourCache = new Map();
  const colours = (rec) => { const k = `${rec.colour}|${rec.look?.seed ?? rec.pfd}|${rec.sex ?? ''}`; let c = colourCache.get(k); if (!c) colourCache.set(k, (c = kayakColours(rec))); return c; };
  let nFull = 0, nMid = 0, nFar = 0, fullRecs = [];
  const tmpRows = new Float32Array(12);
  // a capsize (v2/sim/kayaks.js capsized): the palette is in the kayak's frame (the instance's rows H take it to the world),
  // so a figure in the water (r.fig: its world rows) is H⁻¹ · fig · S on each of its slots, and a paddle let go floats
  // flat on the water at r.pad (blended from where the hands held it by r.pad.k): H⁻¹ · Q
  const Hinv = new Float32Array(12), M12 = new Float32Array(12), Qh = new Float32Array(12), Qf = new Float32Array(12);
  const FIG_SLOTS = SLOTS - 1;   // the figure's bones and the paddle (slot 65); slot 66 is the hull's own
  function capsizePalette(base, r) {
    invRigid(tmpRows, Hinv);
    if (r.fig) { mulRows(Hinv, r.fig, M12); for (let s = 0; s < FIG_SLOTS; s++) { const o = (base + s) * 12; mulRows(M12, palData, palData, 0, o, o); } }
    if (r.pad && r.pad.k > 0) {
      const o = (base + asset.json.paddleSlot) * 12, p = r.pad, cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      mulRows(tmpRows, palData, Qh, 0, o, 0);   // the paddle where the hands have it (world)
      const s = Math.hypot(Qh[0], Qh[4], Qh[8]) || 1;
      // flat on the water: its shaft (the bind x) level along the yaw, the bind z up (the rest pose's own way up)
      Qf[0] = cy * s; Qf[1] = -sy * s; Qf[2] = 0; Qf[3] = p.x;
      Qf[4] = 0; Qf[5] = 0; Qf[6] = s; Qf[7] = p.y;
      Qf[8] = -sy * s; Qf[9] = -cy * s; Qf[10] = 0; Qf[11] = p.z;
      blendRows(Qh, Qf, p.k, Qh);
      mulRows(Hinv, Qh, palData, 0, 0, o);
    }
  }
  // (dst, dstU: another set of records, the glass boat's paddlers' own buffers, same layout)
  function writeInst(i, rows, base, waterY, c, cut = null, dst = insData, dstU = insU32) {
    const o = i * IREC * 4;
    dst.set(rows, o);
    dstU[o + 12] = base; dst[o + 13] = waterY; dst[o + 14] = cut == null ? 0 : 1; dst[o + 15] = cut ?? 0;
    const cols = [c.hull, c.pfd, c.top, c.shorts, c.shoes, c.skin, c.hair, c.hat, c.blade];
    for (let k = 0; k < cols.length; k++) { dst[o + 16 + k * 4] = cols[k][0]; dst[o + 17 + k * 4] = cols[k][1]; dst[o + 18 + k * 4] = cols[k][2]; dst[o + 19 + k * 4] = 1; }
  }
  const self = {
    stats, MAX_FULL,
    // the glass boat's paddlers (v2/render/tourBoat.js) draw on this pipeline with their own palette and records: the layout, the
    // asset's buffers and parts, the record writer, the colours
    get share() { return asset ? { skinBGL, vb, ib, parts, writeInst, colours } : null; },
    get clips() { return clips; }, get ready() { return !!asset; },
    // fetch + parse + upload the asset (≈ 1 MB gzip); returns the clips for the fleet
    load(url) {
      loading ??= (async () => {
        const t = performance.now();
        const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const raw = new Uint8Array(await r.arrayBuffer()); stats.bytes = raw.length;
        const a = await parseKayakAsset(raw);
        vb = device.createBuffer({ label: 'kayak-vertices', size: a.vertexBytes.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vb, 0, a.vertexBytes);
        ib = device.createBuffer({ label: 'kayak-indices', size: Math.ceil(a.indices.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(ib, 0, a.indices.buffer, a.indices.byteOffset, Math.ceil(a.indices.byteLength / 4) * 4);
        parts = Object.fromEntries(a.json.parts.map((p) => [p.name, p]));
        asset = a; clips = createClips(a); stats.loadMs = +(performance.now() - t).toFixed(1);
        return clips;
      })().catch((e) => { errors.push(`kayaks: ${e?.message ?? e}`); loading = null; throw e; });
      return loading;
    },
    get json() { return asset?.json ?? null; },
    // per frame: the fleet's draw records → the palettes, the instance records and the far records (three writeBuffers)
    // focalPx: the lens's focal length in pixels (the shell and the figure's small parts by their size on screen)
    update(draws, focalPx = 1000) {
      nFull = nMid = nFar = 0; fullRecs = [];
      if (asset) {
        const seatY = asset.json.kayak.seatY, seatZ = asset.json.kayak.seatZ, waterY = asset.json.kayak.draft;
        for (const r of draws.full) {
          if (nFull >= MAX_FULL) break;
          const base = nFull * SLOTS;
          clips.pose(r.sex, r.w, r.phase, palData.subarray(base * 12, (base + SLOTS) * 12), r.body);   // (body: the paddler's head and manner, sim/kayak-stroke.js)
          writeInst(nFull, poseRows(r, tmpRows), base, waterY, colours(r), r.cut);
          if (r.fig || r.pad) capsizePalette(base, r);
          const px = 3.0 * focalPx / Math.max(1, r.d);   // the kayak's length on screen (px)
          r.lod = { shell: px > LOD_PX.shell ? 'near' : 'far', detail: px > LOD_PX.detail };
          fullRecs.push(r); nFull++;
        }
        // mid: the kayak frame from the hull model; the paddle slot (65) is v1's sine swing, the identity slot (66) the rest
        const midBase = MAX_FULL * SLOTS;
        for (const r of draws.mid) {
          if (nMid >= MAX_MID) break;
          const s0 = midBase + nMid * 2, base = s0 - 65;
          const go = r.go, ph = r.phase * Math.PI * 2;
          poseRows({ x: 0, y: seatY + 0.42 - 0.12 * (1 - go), z: seatZ - 0.40 + 0.18 * (1 - go), yaw: go * 0.42 * Math.cos(ph), pitch: 0, roll: go * 0.45 * Math.sin(ph) }, palData, s0 * 12);
          palData.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], (s0 + 1) * 12);
          writeInst(MAX_FULL + nMid, poseRows({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: 0, roll: r.roll }, tmpRows), base, waterY, colours(r), r.cut);
          nMid++;
        }
      }
      // far: v1's impostor turned to the camera (the eye's place from the fleet's cam)
      for (const r of draws.far) {
        if (nFar >= MAX_FAR) break;
        const o = nFar * FAR_REC * 4, cx = draws.camX ?? 0, cz = draws.camZ ?? 0, dx = cx - r.x, dz = cz - r.z, dl = Math.hypot(dx, dz) || 1;
        const w = Math.max(0.78, 3.0 * Math.abs(Math.sin(r.heading) * dz / dl + Math.cos(r.heading) * dx / dl));   // |axis × view| (v1's KAYAK.length, beam)
        const c = colours(r).hull;
        farData.set([r.x, r.y + (asset?.json.kayak.draft ?? 0.12), r.z, w, Math.atan2(dx, dz), 0, 0, 0, c[0], c[1], c[2], 1], o);
        nFar++;
      }
      if (nFull + nMid) {
        device.queue.writeBuffer(ins, 0, insData, 0, (MAX_FULL + nMid) * IREC * 4);
        device.queue.writeBuffer(pal, 0, palData, 0, (MAX_FULL * SLOTS + nMid * 2) * 12);
      }
      if (nFar) device.queue.writeBuffer(far, 0, farData, 0, nFar * FAR_REC * 4);
      stats.full = nFull; stats.mid = nMid; stats.far = nFar;
    },
    draw(pass, c) {
      let calls = 0, tris = 0;
      if (asset && nFull + nMid) {
        pass.setPipeline(reg.get(underPipe(reg, 'kayak-skin'))); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, skinBG);
        pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, 'uint16');
        const drawPart = (p, n, first, detail = true) => { const cnt = detail ? p.indexCount : p.coreIndexCount ?? p.indexCount; pass.drawIndexed(cnt, n, p.firstIndex, p.firstVertex, first); calls++; tris += cnt / 3 * n; };
        for (let i = 0; i < nFull; i++) { const r = fullRecs[i]; drawPart(r.lod.shell === 'near' ? parts.kayakNear : parts.kayakFar, 1, i, r.lod.detail); drawPart(parts[r.sex], 1, i, r.lod.detail); }
        if (nMid) drawPart(parts.mid, nMid, MAX_FULL);
      }
      if (nFar) { pass.setPipeline(reg.get('kayak-far')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, farBG); pass.draw(12, nFar); calls++; tris += 4 * nFar; }
      c.calls += calls; c.triangles += tris; stats.calls = calls; stats.triangles = tris;
    },
    // the kayaks' mirrors in the water, after the water (src/core/features.js boatMirrors): the full tier (the hull's far shell and the
    // paddler's core LOD) and the mid tier
    drawMirror(pass, c) {
      if (!mirrors || !asset || !(nFull + nMid)) return;
      let calls = 0, tris = 0;
      pass.setPipeline(reg.get('kayak-skin-mirror')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, skinBG);
      pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, 'uint16');
      const drawPart = (p, n, first) => { const cnt = p.coreIndexCount ?? p.indexCount; pass.drawIndexed(cnt, n, p.firstIndex, p.firstVertex, first); calls++; tris += cnt / 3 * n; };
      for (let i = 0; i < nFull; i++) { const r = fullRecs[i]; drawPart(parts.kayakFar, 1, i); drawPart(parts[r.sex], 1, i); }
      if (nMid) drawPart(parts.mid, nMid, MAX_FULL);
      c.calls += calls; c.triangles += tris; stats.mirrorCalls = calls; stats.mirrorTris = tris;
    },
  };
  return self;
}
export { linear, DEG };
