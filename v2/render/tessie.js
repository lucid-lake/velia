// Tessie's drawing (M1; desktop only: living/tessie-policy.js). Three pipelines, all in the deferred
// group 'tessie' (built after the first frame, never on a phone):
//   tessie-body    the Blender model (blender/tessie_concept.py --export-glb → v2/assets/tessie/tessie.glb: the B body in a
//                  straight rest pose, x along the spine from the snout, y up, z to her left; COLOR_0 the masks: r the dorsal
//                  scutes, g the side rows, b the part: 0 body, 0.33 fins, 0.66 eyes, 1 barbels) bent along the sim's 64
//                  spine frames in the vertex shader (a Catmull-Rom through the frames: the "spine skin"); lit as the
//                  kayaks are (the sun through the transmittance LUT, the sky, the terrain's shadow, the aerial perspective,
//                  the clouds). The look2 material ("Granite", natural skin: owner, 2026-11-17: not a kid's toy): matte
//                  granite scutes with salt-and-pepper specks, lichen and a pale mineral crust, algae-dark wrinkled skin
//                  between them, scars, a warm belly; the specular low and broken; a wet film only near the waterline, in
//                  drip streaks and just after she surfaces, drying over seconds; small dark eyes with a wet highlight.
//                  Under the surface she is seen through the water as the bed is (render/underwater.js): drawn where
//                  the refracted eye ray finds her (so the surface, always nearer, blends over her with its Fresnel), lit
//                  by the light left at her depth, her image fading into the water's own body by the water's K and the
//                  image's scatter, plus the weather's turbidity (wind, rain, storm): a soft dark shape a few metres
//                  down in a calm clear noon, next to nothing past 1–2 m in chop, rain or a storm.
//   tessie-mirror  the part above the water flipped through the surface, after the water (its Fresnel share, dimmed, faded
//                  with depth), its depth at the surface along the view ray so the boat and her body still hide it.
//   tessie-water   one compute over a 128² map (64 m) centred on her, written after the wake's two maps in the wake's own
//                  buffer (render/wake.js WAKEU.cr): her rings and her V by the wake's Cauchy–Poisson impulse maths, the
//                  foam at her waterline and round young rings, the slick (the calmed ripples) on her track. The water reads
//                  it as it reads the boat's wake (the mirror bends, the foam's look, the slick).
// Nothing is drawn, dispatched or written while she is not in the water.
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { WATER_WGSL } from './terrain.js';
import { UNDERWATER_WGSL } from './underwater.js';
import { UNDER_WGSL } from './underMedium.js';   // play as Tessie, phase 2a
import { underPipe } from './underState.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { CREATURE, WATER_COMPUTE_WGSL } from './creature-map.js';
export { CREATURE, WATER_COMPUTE_WGSL };   // the creature map's maths: shared with the osprey's strike (living/birds-splash.js)
import { parseGlb, sceneNodes, meshPrimitives } from '../engine/gltf.js';

const SPINE_N = 64;
const TU_FLOATS = SPINE_N * 8 + 12;   // the spine (pos, up) + p (L, N, wetAge, t) + q (bed, played, paddle phase, paddle amp) + r (gape, 0, 0, 0)
// play as Tessie (step 7): the flipper's paddle and the jaw's gape, two vertex terms on her rest pose (the
// skin closed: no inside, no teeth). Sightings send 0 for both, so their frames are the same as before
export const POSE = Object.freeze({ fore: Object.freeze([5.0, -0.25, 0.56]), hind: Object.freeze([10.2, -0.28, 0.64]), split: 7.6, sweep: 0.35,   // the flipper roots (rest x, y, |z| m), the pair's split, the stroke's fore-aft share
  hinge: 0.95, mouth: 0.44, corner: 0.20, cheekW: 0.36, jawY: Object.freeze([-0.03, -0.05]), back: 0.15, crease: 0.03, dark: 0.6, gapeMax: 15 });   // the jaw: its hinge (rest x m), the mouth's line under the snout (x 0.44 m, 0.20 m further back at the corners), the cheek's half-width, the jaw's line y = a + b x, the gape's pull back, the crease's width (m) and darkening
const CU_VEC4 = 2 + CREATURE.maxK + CREATURE.maxR + CREATURE.maxC;

const COMMON = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${WATER_WGSL}
${UNDERWATER_WGSL}
${SHADOW_STRUCT}
@group(2) @binding(1) var tShadowK: texture_depth_2d;
@group(2) @binding(2) var sShadowK: sampler_comparison;
@group(2) @binding(3) var<uniform> SH: Shadow;
${SHADOW_READ('tShadowK', 'sShadowK')}
fn sunPerp() -> vec3f { let rC = Rg + F.sky.z; let s = normalize(F.sun.xyz); return F.sky.x * transAt(rC, s.y) * step(0.0, raySphere(vec3f(0.0, rC, 0.0), s, Rg) * -1.0); }
fn ggxSpec(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let a2 = max(rough * rough * rough * rough, 1e-4);
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0); let nv = max(dot(n, v), 1e-3); let nl = max(dot(n, l), 0.0); let vh = max(dot(v, h), 0.0);
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let f = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  let vis = 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2) + 1e-5);
  return d * f * vis * nl;
}
fn ambientAt(n: vec3f) -> vec3f {
  let up = clamp(n.y, -1.0, 1.0);
  let side = 1.0 - abs(up);
  let dir = normalize(vec3f(n.x, max(n.y, 0.06), n.z));
  let sky = LIGHT.sky.rgb * (0.5 + 0.5 * up) + skyRadiance(dir) * PI * 0.5 * side;
  let lake = (LIGHT.sky.rgb + LIGHT.sun.rgb) * 0.04 * (0.5 - 0.5 * up);
  return max(sky, vec3f(0.0)) + lake;
}
fn finish(col: vec3f, px: vec2f, world: vec3f) -> vec3f {
  var Tair = vec3f(1.0);
  let inS = aerialParts(px, world, &Tair);
  var out = col * Tair + inS;
  let toP = world - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return out;
}`;

// the body and the mirror: one module, two entry pairs
export const BODY_WGSL = (fs) => `${COMMON(fs)}
struct TessU { sp: array<vec4f, ${SPINE_N * 2}>, p: vec4f, q: vec4f, r: vec4f }
@group(2) @binding(0) var<uniform> TU: TessU;
const NS = ${SPINE_N}u;
// play as Tessie: her rest pose posed before the spine bends it. The flippers (part 0.33) paddle about their roots (an axis along her
// spine: the stroke up and down, the left and right together, the fore and hind pairs half a stroke apart, a little fore-aft feathering);
// the jaw: the head under the jaw's line and behind the mouth's line swings down about its hinge by the gape (the skin stretched closed)
const PO_FORE = vec3f(${POSE.fore.map((v) => v.toFixed(3)).join(', ')}); const PO_HIND = vec3f(${POSE.hind.map((v) => v.toFixed(3)).join(', ')});
const PO_SPLIT = ${POSE.split.toFixed(3)}; const PO_SWEEP = ${POSE.sweep.toFixed(3)};
const JAW_HINGE = ${POSE.hinge.toFixed(3)}; const JAW_MOUTH = ${POSE.mouth.toFixed(3)}; const JAW_CORNER = ${POSE.corner.toFixed(3)}; const JAW_W = ${POSE.cheekW.toFixed(3)};
const JAW_Y0 = ${POSE.jawY[0].toFixed(3)}; const JAW_Y1 = ${POSE.jawY[1].toFixed(3)}; const JAW_BACK = ${POSE.back.toFixed(3)}; const JAW_CREASE = ${POSE.crease.toFixed(3)}; const JAW_DARK = ${POSE.dark.toFixed(3)};
fn mouthX(z: f32) -> f32 { let a = min(abs(z) / JAW_W, 1.0); return JAW_MOUTH + JAW_CORNER * a * a; }
// the jaw's share at a rest point (0 the snout and the skull, 1 the lower jaw), soft across the mouth's line and the jaw's line
fn jawK(p: vec3f) -> f32 {
  let behind = smoothstep(mouthX(p.z) - 0.02, mouthX(p.z) + 0.04, p.x);
  let below = 1.0 - smoothstep(JAW_Y0 + JAW_Y1 * p.x - 0.03, JAW_Y0 + JAW_Y1 * p.x + 0.03, p.y);
  return behind * below * (1.0 - smoothstep(JAW_HINGE - 0.15, JAW_HINGE, p.x));
}
struct Posed { p: vec3f, n: vec3f }
fn pose(p: vec3f, n: vec3f, m: vec4f) -> Posed {
  var o: Posed; o.p = p; o.n = n;
  let amp = TU.q.w; let gape = TU.r.x;
  if (amp > 0.0 && m.b > 0.2 && m.b <= 0.5) {
    let fore = p.x < PO_SPLIT;
    let root = select(PO_HIND, PO_FORE, fore);
    let ph = TU.q.z + select(3.14159265, 0.0, fore);
    let sg = sign(p.z);
    let a = amp * sin(ph) * sg;   // + the tip down on her left (z > 0), mirrored on her right
    let rel = vec2f(p.y - root.y, p.z - sg * root.z);
    let c = cos(a); let s = sin(a);
    o.p.y = root.y + rel.x * c - rel.y * s;
    o.p.z = sg * root.z + rel.x * s + rel.y * c;
    o.p.x = p.x + (abs(p.z) - root.z) * PO_SWEEP * amp * cos(ph);   // the stroke feathers fore and aft a little (a paddle, not a wing)
    o.n = vec3f(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
  }
  if (gape > 0.0 && p.x < JAW_HINGE) {
    let k = jawK(p);
    let arm = JAW_HINGE - p.x;
    o.p.y = o.p.y - sin(gape) * arm * k;
    o.p.x = o.p.x + (1.0 - cos(gape)) * arm * k + JAW_BACK * sin(gape) * k * (1.0 - arm);
  }
  return o;
}
// the mouth's crease darkens as the jaw opens (the fragment's share: 0 closed)
fn creaseDark(p: vec3f) -> f32 {
  if (TU.r.x <= 0.0 || p.x > JAW_HINGE) { return 0.0; }
  let below = 1.0 - smoothstep(JAW_Y0 + JAW_Y1 * p.x, JAW_Y0 + JAW_Y1 * p.x + 0.06, p.y);
  return JAW_DARK * clamp(TU.r.x / ${(POSE.gapeMax * Math.PI / 180).toFixed(4)}, 0.0, 1.0) * exp(-pow((p.x - mouthX(p.z)) / JAW_CREASE, 2.0)) * below;
}
fn spP(i: i32) -> vec3f {
  // the frame's position; past either end, extrapolated (the Catmull-Rom's outer points)
  if (i < 0) { return 2.0 * TU.sp[0].xyz - TU.sp[2].xyz; }
  if (i >= i32(NS)) { return 2.0 * TU.sp[(NS - 1u) * 2u].xyz - TU.sp[(NS - 2u) * 2u].xyz; }
  return TU.sp[u32(i) * 2u].xyz;
}
struct Frm { p: vec3f, t: vec3f, up: vec3f, left: vec3f }
fn frameAt(s: f32) -> Frm {
  let f = clamp(s / TU.p.x, 0.0, 1.0) * f32(NS - 1u);
  let i = min(i32(floor(f)), i32(NS) - 2); let u = f - f32(i);
  let p0 = spP(i - 1); let p1 = spP(i); let p2 = spP(i + 1); let p3 = spP(i + 2);
  let a = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3; let b = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
  var o: Frm;
  o.p = 0.5 * (2.0 * p1 + (p2 - p0) * u + a * u * u + b * u * u * u);
  o.t = normalize(0.5 * ((p2 - p0) + 2.0 * a * u + 3.0 * b * u * u) + vec3f(1e-6, 0.0, 0.0));
  let up0 = mix(TU.sp[u32(i) * 2u + 1u].xyz, TU.sp[u32(i + 1) * 2u + 1u].xyz, u);
  o.up = normalize(up0 - o.t * dot(up0, o.t));
  o.left = cross(o.t, o.up);
  return o;
}
struct BV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) nr: vec3f, @location(4) m: vec4f, @location(5) oy: f32, @location(6) air: vec3f }   // world: where she is (her light); air: the eye ray's surface crossing (the air's path)
fn place(p0: vec3f, n0: vec3f, m: vec4f, flip: bool) -> BV {
  let po = pose(p0, n0, m); let p = po.p; let n = po.n;
  let fr = frameAt(p.x);
  var wp = fr.p + fr.up * p.y + fr.left * p.z;
  var wn = fr.t * n.x + fr.up * n.y + fr.left * n.z;
  var o: BV; o.oy = wp.y;
  var drawn = wp; o.air = wp;
  if (flip) { wp.y = -wp.y; wn.y = -wn.y; drawn = wp; o.air = wp; }
  else if (wp.y < 0.0) {
    // under the surface: the refraction's sway (the shape seen through the moving surface), growing with depth and with the
    // wind's slopes; then drawn where the refracted eye ray finds her (render/underwater.js): farther along the ray than the
    // surface crossing, so the water's surface is always in front of her
    let dd = min(-wp.y, 5.0); let tt = F.cam.w; let sw = mix(UW_SWAY0, UW_SWAY1, uwWindK());
    wp.x += sw * dd * sin(wp.z * 0.9 + tt * 1.7) ; wp.z += sw * dd * sin(wp.x * 0.8 - tt * 1.3);
    let ap = uwApparent(wp); drawn = ap.p; o.air = ap.air;
  }
  o.pos = F.viewProj * vec4f(drawn, 1.0); o.world = wp; o.n = wn; o.rest = p0; o.nr = n0; o.m = m; return o;
}
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec4f, @location(2) m: vec4f) -> BV { return place(p, n.xyz, m, false); }
@vertex fn vsMirror(@location(0) p: vec3f, @location(1) n: vec4f, @location(2) m: vec4f) -> BV { return place(p, n.xyz, m, true); }

fn hash3(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
fn fbm3(p: vec3f) -> f32 { return 0.5 * vnoise3(p) + 0.3 * vnoise3(p * 2.03 + 1.7) + 0.2 * vnoise3(p * 4.11 + 3.1); }

// the look2 material (blender/tessie_concept.py --skin2: the palette and the rules are the Blender shader's)
struct Mat { alb: vec3f, rough: f32, n: vec3f, f0: f32, wet: f32 }
fn material(v: BV, nW: vec3f, sharp: f32) -> Mat {   // sharp: the image's share left under the water (1 above it): the fine detail goes first
  var o: Mat;
  let rp = v.rest; let nr = normalize(v.nr); let m = v.m;
  let part = m.b;
  let scute = clamp(max(m.r, m.g * 0.85), 0.0, 1.0);
  let fw = length(fwidth(rp));
  let fineK = (1.0 - smoothstep(0.02, 0.09, fw)) * sharp * sharp;   // the fine detail fades before it shimmers (a pixel over 2–9 cm), and under the water as her image scatters
  let big = fbm3(rp * vec3f(0.32, 0.9, 0.9) + vec3f(${(0).toFixed(1)}, 3.0, 7.0));
  let mid = vnoise3(rp * 2.4 + 7.1);
  let fine = vnoise3(rp * 13.0);
  // skin between the scutes: algae-dark olive-black, mottled (sturgeon), lighter on the flanks
  var skin = mix(vec3f(0.022, 0.026, 0.016), vec3f(0.048, 0.050, 0.032), big) * (0.82 + 0.36 * mid);
  // the scutes: weathered granite, grey with a warm cast, varied scute to scute
  let sid = floor(rp.x / 0.75);
  var gran = mix(vec3f(0.085, 0.080, 0.070), vec3f(0.19, 0.185, 0.17), vnoise3(rp * 2.2) * 0.7 + 0.3 * hash3(vec3f(sid, 1.0, 2.0)));
  // salt-and-pepper: pale feldspar and dark specks (2–3 cm cells)
  let sp = hash3(floor(rp * 55.0));
  gran = mix(gran, vec3f(0.42, 0.41, 0.38), step(0.86, sp) * fineK * 0.85 * (1.0 - 0.85 * TU.q.y));   // played: her wet back hides the pale specks
  gran = mix(gran, vec3f(0.025, 0.024, 0.022), step(sp, 0.12) * fineK * 0.8);
  let sk = smoothstep(0.05, 0.6, scute);
  var alb = mix(skin, gran, sk);
  // the pale mineral crust in the scutes' rims and cavities
  let rim = smoothstep(0.03, 0.10, scute) * (1.0 - smoothstep(0.16, 0.34, scute));
  alb = mix(alb, vec3f(0.40, 0.38, 0.34) * (0.8 + 0.3 * fine), rim * (0.45 + 0.4 * vnoise3(rp * 5.0)) * (1.0 - 0.7 * TU.q.y));
  // crustose lichen on the sun-facing scutes: pale grey-green patches, now and then ochre
  let lich = smoothstep(0.56, 0.70, fbm3(rp * 1.8 + 3.0)) * smoothstep(0.1, 0.7, nr.y) * sk;
  let ochre = step(0.78, vnoise3(rp * 0.7 + 11.0));
  alb = mix(alb, mix(vec3f(0.26, 0.28, 0.21), vec3f(0.33, 0.20, 0.06), ochre) * (0.85 + 0.3 * fine), lich * 0.85);
  // the belly: a warm pale under her
  let belly = (1.0 - smoothstep(-0.65, 0.1, nr.y)) * (1.0 - sk);
  alb = mix(alb, vec3f(0.15, 0.135, 0.105) * (0.85 + 0.3 * mid), belly);
  // old scars: a few long pale streaks on her flanks
  let sc = abs(sin(rp.x * 0.9 + rp.y * 2.6 + 3.0 * vnoise3(rp * 0.6)));
  alb = mix(alb, vec3f(0.13, 0.12, 0.10), (1.0 - smoothstep(0.0, 0.025, sc)) * step(0.62, vnoise3(rp * 0.35 + 5.0)) * (1.0 - belly) * 0.8);
  var rough = mix(0.78, 0.88, sk) + (vnoise3(rp * 3.0) - 0.5) * 0.12;
  var n = nW;
  // the leathery wrinkles round her body (between the scutes) and the scutes' pitted grain: a small normal tilt
  let fr = frameAt(rp.x);
  let wr = sin(rp.x * 38.0 + 6.0 * vnoise3(rp * 3.0)) * (1.0 - sk) * fineK;
  n = normalize(n + fr.t * wr * 0.22 + (fr.up * (fine - 0.5) + fr.left * (vnoise3(rp * 13.0 + 5.0) - 0.5)) * 0.35 * fineK);
  alb = mix(mix(skin, gran, sk) * 0.9 + vec3f(0.004), alb, sharp);   // under the water the speckle, lichen and scars blur into her mean tone
  // the parts: small dark eyes (a wet highlight), fins in the skin's colour, darker
  alb = alb * (1.0 - creaseDark(rp));   // the mouth's crease darkens as the jaw opens
  if (part > 0.5 && part < 0.8) { alb = vec3f(0.010, 0.007, 0.005); rough = 0.05; n = nW; }
  else if (part > 0.2 && part <= 0.5) { alb = skin * 0.85; rough = 0.78; }
  else if (part >= 0.8) { alb = skin * 0.9; rough = 0.8; }
  // wet: a film near the waterline, in drip streaks and just after she surfaces, drying over seconds
  let h = v.oy;
  let wl = 1.0 - smoothstep(0.0, 0.45, h);
  let drip = smoothstep(0.60, 0.78, vnoise3(vec3f(rp.x * 7.0, rp.y * 0.7 - TU.p.w * 0.25, rp.z * 7.0))) * smoothstep(0.0, 0.5, h);
  let fresh = exp(-TU.p.z / 9.0);
  var wet = clamp(max(wl, max(fresh * 0.75, drip * mix(0.35, 0.9, fresh))), 0.0, 1.0);
  if (part > 0.5 && part < 0.8) { wet = 1.0; }
  // played (TU.q.y: the player swims her, close behind her back): wet stone hides its feldspar, so the speckle and the crust calm into her
  // tone and the film shines: an animal's wet back, not a dry boulder (the sightings' look unchanged)
  wet = max(wet, 0.9 * TU.q.y * smoothstep(-0.2, 0.2, h));   // her back above the water is wet all the while the player swims her
  alb = mix(alb, mix(skin, gran * 0.7, sk), 0.85 * wet * TU.q.y);
  o.alb = alb * (1.0 - 0.42 * wet); o.rough = mix(rough, mix(0.22, 0.14, TU.q.y), wet); o.n = n; o.f0 = 0.02; o.wet = wet;
  return o;
}
fn shade(world: vec3f, M: Mat) -> vec3f {
  let V = normalize(F.cam.xyz - world);
  let n = M.n; let s = normalize(F.sun.xyz);
  let nl = max(dot(n, s), 0.0);
  let eSun = sunPerp() * shadowAt(world, nl);
  let eSky = ambientAt(n);
  let f0 = vec3f(M.f0);
  let diff = M.alb / PI * (eSun * nl + eSky);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  // the dry skin's reflection is broken by its roughness (a dull sheen at grazing); the wet film's is the water's own
  let env = skyRadiance(R) * fres * mix(0.15 * (1.0 - M.rough), 0.85, M.wet);
  let spec = ggxSpec(n, V, s, M.rough, f0) * eSun;
  return diff + env + spec + flashLit(world, M, V);
}
// M3: the lightning neck: a storm's flash (F.bow.z, the frame's flash lift: render/shaders.js FLASH_ADD) lights
// her skin and rims her outline, so the flash catches her neck and her silhouette against the bay (0 with no flash: no cost then
// but a multiply)
fn flashLit(world: vec3f, M: Mat, V: vec3f) -> vec3f {
  let f = F.bow.z;
  if (f <= 0.0) { return vec3f(0.0); }
  let rim = pow(1.0 - clamp(abs(dot(M.n, V)), 0.0, 1.0), 2.0);
  return (M.alb * (0.5 + 0.5 * max(M.n.y, 0.0)) + vec3f(0.55, 0.6, 0.7) * rim) * f * 0.42;
}
// under the surface (render/underwater.js; the bed's optics, render/bed.js): the light left at her depth (K down the refracted
// sun; the sky's light from above, Snell's window: a flank or a belly gets little; the water's upwelling under her), no
// gloss (a wet skin in water barely reflects: the indices nearly match), then her radiance carried up the refracted view
// and lost into the water's own body (its backscatter R∞ under the same light) at K plus the image's scatter and the
// weather's; WUP the share that crosses the surface (the bed's); the water's blend then covers her with its Fresnel
struct UwC { lit: vec3f, column: vec3f }
fn underwater(v: BV, M: Mat, d: f32) -> UwC {
  let s = normalize(F.sun.xyz);
  let sdy = uwSunDownY();
  let sunU = normalize(vec3f(s.x / NW, sdy, s.z / NW));
  let n = M.n;
  let sunDown = exp(-WK * d / sdy);
  let skyDown = exp(-WK * d);
  let eTop = 0.98 * (LIGHT.sun.rgb + LIGHT.sky.rgb);   // the light entering the water (the bed's E)
  let eSun = sunPerp() * F.storm.y * shadowAt(v.world, max(dot(n, s), 0.0)) * sunDown * 0.98;
  let fD = smoothstep(0.0, 0.35, s.y) * UW_DSHARE;
  let up01 = 0.5 + 0.5 * n.y;
  let eSky = LIGHT.sky.rgb * 0.98 * skyDown * up01 * up01 + eTop * skyDown * RINF * (1.0 - up01) * UW_UPWELL * 4.0;
  let lit = M.alb / PI * (eSun * max(dot(n, sunU), 0.0) * mix(0.6, 1.0, fD) + eSky);
  let column = eTop * RINF / PI;   // the water's own body between her and the surface (the bed's column: E R∞ (1 − T))
  let keep = select(1.0, F.look.x, F.look.x > 0.0);   // the water's and the bed's exposure keep (sim/exposure.js waterKeep)
  return UwC(WUP * keep * lit, WUP * keep * column);
}
@fragment fn fs(v: BV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let nW = normalize(select(-v.n, v.n, ff));
  let d = max(-v.world.y, 0.0);
  if (d <= 0.0) {
    let M = material(v, nW, 1.0);
    return vec4f(finish(shade(v.world, M), v.pos.xy, v.world), 1.0);
  }
  // the refracted path from the surface crossing to her (m), the image's share left at the surface per channel
  let path = max(distance(v.world, v.air), d);
  let sc = uwScatter();
  let img = exp(-(WK + vec3f(sc)) * path);
  let M = material(v, nW, exp(-sc * path * 1.5));
  let c = underwater(v, M, d);
  // the air's part as the bed takes it (render/terrain.js finishes the bed at its drawn point, the straight ray's): her image at
  // her drawn point, the water's body in front of her as the bed behind her is finished (the straight ray on to the bed's
  // depth under her, TU.q.x), so as her image fades she becomes the lake the bed shows round her, in any weather
  let k = d / max(F.cam.y, 0.05);
  let drawn = v.air + (v.air - F.cam.xyz) * k;
  let behind = v.air + (v.air - F.cam.xyz) * (max(TU.q.x, d) / max(F.cam.y, 0.05));
  return vec4f(finish(c.lit, v.pos.xy, drawn) * img + finish(c.column, v.pos.xy, behind) * (1.0 - img), 1.0);
}
struct MOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fsMirror(v: BV, @builtin(front_facing) ff: bool) -> MOut {
  if (v.oy < 0.01) { discard; }   // only what stands above the water is mirrored
  let nW = normalize(select(-v.n, v.n, !ff));
  let M = material(v, nW, 1.0);
  // shaded where she is (the mirrored point's own light: y flipped back)
  let src = vec3f(v.world.x, -v.world.y, v.world.z);
  let col = finish(shade(src, M), v.pos.xy, v.world);
  // the surface point along the view (its depth: the boat, her body and the waves' crests in front still hide the mirror)
  let eye = F.cam.xyz; let dir = v.world - eye;
  let k = (eye.y - 0.12) / max(eye.y - v.world.y, 1e-3);
  let hit = eye + dir * k;
  let cp = F.viewProj * vec4f(hit, 1.0);
  let cosV = abs(normalize(dir).y);
  let fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  let a = fres * 0.72 * exp(-v.oy / 4.0);   // dimmed, fading as the mirrored point lies deeper (the ripples break it)
  var o: MOut; o.c = vec4f(col * a, a); o.depth = cp.z / cp.w; return o;
}`;


// Play as Tessie, phase 2a: her body seen from under the water, appended to the body's own text in a module of its own
// (the body's module stays byte for byte): placed where she is (no refraction's sway: the eye is in the water), her look2 skin lit by the
// light left at her depth (umLit: the sun down the refracted ray on her own normal, the sky's light from above, the upwelling under her
// belly), no gloss under the water; then the straight path to the eye (umFog). What stands over the water is behind the surface.
// 2c: her body under the water reads clearly (owner, 2026-11-20): the window's rim light, the sun's forward scatter, the wet sheen, the wet granite
const UNDER_BODY = Object.freeze({ rim: 1.6, fwd: 2.0, sheen: 0.35, alb: 1.35 });
export const BODY_UNDER_WGSL = () => `
${UNDER_WGSL}
const UB_RIM = ${UNDER_BODY.rim.toFixed(3)}; const UB_FWD = ${UNDER_BODY.fwd.toFixed(3)}; const UB_SHEEN = ${UNDER_BODY.sheen.toFixed(3)}; const UB_ALB = ${UNDER_BODY.alb.toFixed(3)};
@vertex fn vsUnder(@location(0) p0: vec3f, @location(1) n: vec4f, @location(2) m: vec4f) -> BV {
  let po = pose(p0, n.xyz, m); let p = po.p;   // the paddle and the gape
  let fr = frameAt(p.x);
  let wp = fr.p + fr.up * p.y + fr.left * p.z;
  let wn = fr.t * po.n.x + fr.up * po.n.y + fr.left * po.n.z;
  var o: BV; o.oy = wp.y; o.air = wp;
  o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.rest = p0; o.nr = n.xyz; o.m = m; return o;
}
@fragment fn fsUnder(v: BV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let nW = normalize(select(-v.n, v.n, ff));
  let d = max(-v.world.y, 0.0);
  let M = material(v, nW, select(1.0, exp(-UM_IMG * distance(v.world, F.cam.xyz) * 1.5), d > 0.0));
  let s = normalize(F.sun.xyz);
  if (d <= 0.0) { return vec4f(shade(v.world, M), 1.0); }   // over the water: behind the surface (its window)
  // 2c (she read as a near-silhouette): the light of the window above her caught on her back and round her edges (the
  // water's own light looking up, brightest on a face turned up and toward the eye's edge), the sun's forward scatter when the eye looks
  // toward it past her, a soft wet sheen of the window on her back; her granite a touch lighter wet (UB_ALB). Believable, never a glow:
  // each term is the water's own light at her depth, so it fades with depth, at dusk and at night as the water does
  let V = normalize(F.cam.xyz - v.world);
  let ndv = clamp(dot(nW, V), 0.0, 1.0);
  let up = smoothstep(-0.25, 0.7, nW.y);
  let top = umLinf(vec3f(0.0, 1.0, 0.0), d);
  let mu = max(dot(-V, umSunU()), 0.0);
  let rim = top * UB_RIM * pow(1.0 - ndv, 2.5) * (0.35 + 0.65 * up) * (1.0 + UB_FWD * mu * mu * mu * mu);
  let sheen = top * UB_SHEEN * pow(max(dot(nW, normalize(V + vec3f(0.0, 1.0, 0.0))), 0.0), 18.0) * up;
  let lit = umLit(M.alb * UB_ALB, nW, d, shadowAt(v.world, max(dot(nW, s), 0.0))) + rim + sheen;
  return vec4f(umFog(lit, v.world), 1.0);
}`;

// M2: her effects: the shadow on the bed (a ribbon down the sun onto the bed under her, drawn before the water), the drops (the
// sheets off her back as she rises, the drips, the splashes of the break, the tail and the dive: camera-facing discs, opaque,
// before the water) and the mist of the big splashes (soft discs, blended after the water). One storage buffer:
// FX[0] = (shadow verts, drops, mists, focalPx); then FX_SH shadow verts (x, y, z, alpha); FX_DR drops (x, y, z, radius);
// FX_MI mists × 2 (x, y, z, radius) (alpha, 0, 0, 0)
export const FX = Object.freeze({ shadow: 32, drops: 900, mists: 24, minPx: 0.9, streakS: 0.03 });   // streakS: s of flight a drop's streak spans (the eye's own blur)
const FX_SH = 1, FX_DR = FX_SH + FX.shadow * 2, FX_MI = FX_DR + FX.drops * 2, FX_VEC4 = FX_MI + FX.mists * 2;   // drops: (x, y, z, r) (vx, vy, vz, life)
const FX_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> FXB: array<vec4f>;
fn fxHash(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn fxNoise(p: vec3f) -> f32 {   // smooth value noise (the mist's torn edge: no cells)
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxHash(i), fxHash(i + vec3f(1, 0, 0)), u.x), mix(fxHash(i + vec3f(0, 1, 0)), fxHash(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(fxHash(i + vec3f(0, 0, 1)), fxHash(i + vec3f(1, 0, 1)), u.x), mix(fxHash(i + vec3f(0, 1, 1)), fxHash(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
struct SV { @builtin(position) pos: vec4f, @location(0) a: f32, @location(1) u: f32 }
@vertex fn vsShadow(@builtin(vertex_index) vi: u32) -> SV {
  let seg = vi / 6u; let k = vi % 6u;
  let side = select(0u, 1u, k == 1u || k == 4u || k == 5u); let next = select(0u, 1u, k == 2u || k == 4u || k == 5u);
  let q = FXB[${FX_SH}u + (seg + next) * 2u + side];
  // on the bed as the bed is seen (render/underwater.js): drawn where the refracted eye ray lands on it; its contrast lost to
  // the weather's turbidity down the sun to the bed and up the view (the clear water's own fade is the CPU's: living/tessie-fx.js),
  // and gone under the storm cell's shade (no sun, no shadow)
  let ap = uwApparent(q.xyz);
  let dep = max(-q.y, 0.0);
  let turb = uwScatter() - UW_BIG;
  let lost = F.storm.y * exp(-turb * (dep / uwSunDownY() + max(distance(q.xyz, ap.air), dep)));
  var o: SV; o.pos = F.viewProj * vec4f(ap.p, 1.0); o.a = q.w * lost; o.u = select(-1.0, 1.0, side == 1u); return o;
}
@fragment fn fsShadow(v: SV) -> @location(0) vec4f {
  let a = v.a * (1.0 - smoothstep(0.25, 1.0, abs(v.u)));
  return vec4f(0.0, 0.0, 0.0, a);   // premultiplied: the bed under her darkened by a (its sun share)
}
struct DV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) uv: vec2f, @location(2) right: vec3f, @location(3) up: vec3f, @location(4) a: f32 }
fn disc(c: vec4f, vi: u32, minPx: f32) -> DV {
  let k = vi % 6u;
  let uv = vec2f(select(-1.0, 1.0, k == 1u || k == 2u || k == 4u), select(-1.0, 1.0, k == 2u || k == 4u || k == 5u));
  let toCam = F.cam.xyz - c.xyz; let dist = max(length(toCam), 0.05);
  let fwd = toCam / dist;
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd)); let up = cross(fwd, right);
  let rad = max(c.w, minPx * dist / max(FXB[0].w, 1.0));
  let wp = c.xyz + (right * uv.x + up * uv.y) * rad;
  var o: DV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.uv = uv; o.right = right; o.up = up; o.a = 1.0; return o;
}
// a drop: a streak along its flight on the screen (its own motion over streakS), thin and soft-edged, fading with its life
@vertex fn vsDrop(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DV {
  let c = FXB[${FX_DR}u + ii * 2u]; let vel = FXB[${FX_DR}u + ii * 2u + 1u];
  let k = vi % 6u;
  let uv = vec2f(select(-1.0, 1.0, k == 1u || k == 2u || k == 4u), select(-1.0, 1.0, k == 2u || k == 4u || k == 5u));
  let toCam = F.cam.xyz - c.xyz; let dist = max(length(toCam), 0.05); let fwd = toCam / dist;
  var ax = vel.xyz - fwd * dot(vel.xyz, fwd);
  let sp = length(ax);
  if (sp < 1e-3) { ax = vec3f(0.0, 1.0, 0.0) - fwd * fwd.y; } else { ax = ax / sp; }
  ax = normalize(ax);
  let side = normalize(cross(ax, fwd));
  let px = dist / max(FXB[0].w, 1.0);
  let w = max(c.w * 0.75, ${FX.minPx} * px); let len = max(c.w, ${FX.minPx} * px) + sp * ${FX.streakS};
  let wp = c.xyz - ax * sp * ${FX.streakS} * 0.5 + (side * uv.x * w + ax * uv.y * len);
  var o: DV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.uv = uv; o.right = side; o.up = ax; o.a = clamp(vel.w * 2.5, 0.0, 1.0) * clamp(w / (1.6 * px), 0.35, 1.0); return o;
}
fn lightAt(world: vec3f, n: vec3f) -> vec3f { let s = normalize(F.sun.xyz); return sunPerp() * max(dot(n, s), 0.0) + ambientAt(n); }
@fragment fn fsDrop(v: DV) -> @location(0) vec4f {
  // soft across (a rounded cross-section) and tapered at both ends: water in flight, never a hard ball
  let across = 1.0 - v.uv.x * v.uv.x; let along = 1.0 - smoothstep(0.35, 1.0, abs(v.uv.y));
  let a = v.a * across * along * 0.85;
  if (a < 0.004) { discard; }
  let toCam = normalize(F.cam.xyz - v.world);
  let n = normalize(v.right * v.uv.x * 0.9 + toCam * sqrt(max(0.0, 1.0 - 0.81 * v.uv.x * v.uv.x)));
  // water drops: a pale lit body, the sky in their rim and a glint toward the sun (the kayaks' splash, brighter)
  let s = normalize(F.sun.xyz);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, toCam), 0.0), 5.0);
  var R = reflect(-toCam, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let col = vec3f(0.80, 0.85, 0.88) * lightAt(v.world, n) / PI * 1.1 + skyRadiance(R) * fres * 0.6 + sunPerp() * pow(max(dot(R, s), 0.0), 60.0) * 0.4;
  return vec4f(finish(col, v.pos.xy, v.world) * a, a);
}
@vertex fn vsMist(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DV {
  var o = disc(FXB[${FX_MI}u + ii * 2u], vi, 2.0); o.a = FXB[${FX_MI}u + ii * 2u + 1u].x; return o;
}
@fragment fn fsMist(v: DV) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  if (r2 > 1.0) { discard; }
  // a soft, broken puff: the falloff cubed, torn by a smooth noise (no cells), and faded into the water below it and near the eye, so
  // it never meets the surface, a hull or the lens in a straight edge
  let nz = fxNoise(vec3f(v.uv * 2.3, v.a * 7.0) + v.world * 0.35);
  let low = smoothstep(0.0, 1.4, v.world.y);
  let near = smoothstep(2.0, 9.0, distance(F.cam.xyz, v.world));
  let a = v.a * 0.45 * pow(1.0 - r2, 3.0) * (0.55 + 0.45 * nz) * low * near;
  let col = finish(vec3f(0.75) * lightAt(v.world, vec3f(0.0, 1.0, 0.0)) / PI * 1.15, v.pos.xy, v.world);
  return vec4f(col * a, a);
}`;

// TK, the revenge's gloom ("the water around the boat darkens a touch"): one flat quad on the water round the
// boat, after the water, premultiplied black (the water under it × (1 − a)); a hole the hull's size (nothing over the boat), its
// most a ring 8–18 m out, gone by GLOOM.r. G[0] = (x, z, heading, a); G[1] = (r, y, 0, 0). Drawn only while a ≥ 0.002.
const GLOOM = Object.freeze({ r: 60, y: 0.35, holeL: 6.5, holeB: 3.2 });
const GLOOM_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
@group(1) @binding(0) var<uniform> G: array<vec4f, 2>;
struct GV { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
const GQ = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(1.0, -1.0), vec2f(-1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
@vertex fn vs(@builtin(vertex_index) vi: u32) -> GV {
  let q = GQ[vi]; let r = G[1].x;
  var o: GV; o.pos = F.viewProj * vec4f(G[0].x + q.x * r, G[1].y, G[0].y + q.y * r, 1.0); o.uv = q * r; return o;
}
@fragment fn fs(v: GV) -> @location(0) vec4f {
  // the boat's frame: f along her bow (sin h, −cos h), s to starboard (cos h, sin h)
  let h = G[0].z; let f = v.uv.x * sin(h) - v.uv.y * cos(h); let sd = v.uv.x * cos(h) + v.uv.y * sin(h);
  let e = length(vec2f(f / ${GLOOM.holeL}, sd / ${GLOOM.holeB}));   // 1 at the hull's ellipse
  let d = length(v.uv);
  let a = G[0].w * smoothstep(1.0, 2.2, e) * (1.0 - smoothstep(G[1].x * 0.3, G[1].x, d));
  return vec4f(0.0, 0.0, 0.0, a);
}`;

// the GLB → one interleaved vertex buffer (pos f32×3, normal snorm8×4, mask unorm8×4: 20 B) and u16/u32 indices
function packTessie(arrayBuffer) {
  const g = parseGlb(arrayBuffer);
  const nodes = sceneNodes(g).filter((n) => n.mesh != null);
  const parts = [];
  let nv = 0, ni = 0;
  for (const nd of nodes) for (const pr of meshPrimitives(g, nd.mesh)) { if (pr.mode !== 4) continue; parts.push({ nd, pr }); nv += pr.attributes.POSITION.count; ni += pr.indices ? pr.indices.count : pr.attributes.POSITION.count; }
  const lods = {};   // M2: the desk LODs (nodes lod0, lod1, lod2: near, mid, far); a model without them is one LOD
  if (!nv) throw new Error('tessie: no triangles in the GLB');
  const vb = new ArrayBuffer(nv * 20), f32 = new Float32Array(vb), i8 = new Int8Array(vb), u8 = new Uint8Array(vb);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0, minX = Infinity, maxX = -Infinity;
  for (const { nd, pr } of parts) {
    const W = nd.world, P = pr.attributes.POSITION, Nn = pr.attributes.NORMAL, Cc = pr.attributes.COLOR_0;
    for (let k = 0; k < P.count; k++) {
      const x = P.array[k * 3], y = P.array[k * 3 + 1], z = P.array[k * 3 + 2];
      const wx = W[0] * x + W[4] * y + W[8] * z + W[12], wy = W[1] * x + W[5] * y + W[9] * z + W[13], wz = W[2] * x + W[6] * y + W[10] * z + W[14];
      const o = (v0 + k) * 5;
      f32[o] = wx; f32[o + 1] = wy; f32[o + 2] = wz;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      let a = 0, b = 1, c = 0;
      if (Nn) { const nx = Nn.array[k * 3], ny = Nn.array[k * 3 + 1], nz = Nn.array[k * 3 + 2]; a = W[0] * nx + W[4] * ny + W[8] * nz; b = W[1] * nx + W[5] * ny + W[9] * nz; c = W[2] * nx + W[6] * ny + W[10] * nz; const l = Math.hypot(a, b, c) || 1; a /= l; b /= l; c /= l; }
      const bo = (v0 + k) * 20 + 12;
      i8[bo] = Math.round(a * 127); i8[bo + 1] = Math.round(b * 127); i8[bo + 2] = Math.round(c * 127); i8[bo + 3] = 0;
      const cs = Cc ? Cc.size : 4;
      for (let j = 0; j < 4; j++) u8[bo + 4 + j] = Math.round(Math.min(1, Math.max(0, Cc ? (j < cs ? Cc.array[k * cs + j] : 1) : (j === 3 ? 1 : 0))) * 255);
    }
    if (pr.indices) for (let k = 0; k < pr.indices.count; k++) idx[i0 + k] = pr.indices.array[k] + v0;
    else for (let k = 0; k < P.count; k++) idx[i0 + k] = v0 + k;
    const cnt = pr.indices ? pr.indices.count : P.count, m = /lod(\d)/i.exec(nd.name ?? '');
    const key = m ? `lod${m[1]}` : 'lod0';
    if (lods[key]) lods[key].count += cnt; else lods[key] = { first: i0, count: cnt };
    v0 += P.count; i0 += cnt;
  }
  for (const k of ['lod1', 'lod2']) if (!lods[k]) lods[k] = lods[k === 'lod2' ? 'lod1' : 'lod0'] ?? lods.lod0;
  // a model with only lod0: draw it whole at every distance
  if (Object.keys(lods).length && !/lod/i.test(nodes.map((n) => n.name).join(' '))) { lods.lod0 = lods.lod1 = lods.lod2 = { first: 0, count: ni }; }
  return { vertices: new Uint8Array(vb), indices: idx, count: ni, lods, verts: nv, triangles: ni / 3, L: maxX, x0: minX, colours: parts.every(({ pr }) => !!pr.attributes.COLOR_0) };
}

export function createTessieRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', wake, errors = [], under = false }) {   // under: phase 2a's body twin (src/core/features.js tessieUnder)
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT, CP = GPUShaderStage.COMPUTE;
  const tu = new Float32Array(TU_FLOATS);
  const ubuf = device.createBuffer({ label: 'tessie-spine', size: TU_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'tessie', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'uniform' } },
    { binding: 1, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 2, visibility: FR, sampler: { type: 'comparison' } }, { binding: 3, visibility: FR, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: shadow.view }, { binding: 2, resource: shadow.sampler }, { binding: 3, resource: { buffer: shadow.buffer } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] });
  const mB = reg.shader('tessie-body', BODY_WGSL(frameStruct));
  const vbuf = { arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }, { shaderLocation: 2, offset: 16, format: 'unorm8x4' }] };
  reg.add('tessie-body', { layout, vertex: { module: mB, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mB, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  if (under) {   // phase 2a: her body from under the water (its own module; the deferred 'under' group, after hers)
    const prevU = reg.group?.('under');
    const mU = reg.shader('tessie-body-under', BODY_WGSL(frameStruct) + BODY_UNDER_WGSL());
    reg.add('tessie-body-under', { layout, vertex: { module: mU, entryPoint: 'vsUnder', buffers: [vbuf] }, fragment: { module: mU, entryPoint: 'fsUnder', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  }
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('tessie-mirror', { layout, vertex: { module: mB, entryPoint: 'vsMirror', buffers: [vbuf] }, fragment: { module: mB, entryPoint: 'fsMirror', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });
  // M2: the effects: the bed's shadow (before the water), the drops (before the water), the mist (after the water)
  const fxData = new Float32Array(FX_VEC4 * 4);
  const fxBuf = device.createBuffer({ label: 'tessie-fx', size: fxData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bglFx = device.createBindGroupLayout({ label: 'tessie-fx', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 2, visibility: FR, sampler: { type: 'comparison' } }, { binding: 3, visibility: FR, buffer: { type: 'uniform' } }] });
  const bgFx = device.createBindGroup({ layout: bglFx, entries: [{ binding: 0, resource: { buffer: fxBuf } }, { binding: 1, resource: shadow.view }, { binding: 2, resource: shadow.sampler }, { binding: 3, resource: { buffer: shadow.buffer } }] });
  const layoutFx = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bglFx] });
  const mFx = reg.shader('tessie-fx', FX_WGSL(frameStruct));
  const noWrite = { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' };
  reg.add('tessie-shadow', { layout: layoutFx, vertex: { module: mFx, entryPoint: 'vsShadow' }, fragment: { module: mFx, entryPoint: 'fsShadow', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: noWrite, multisample: { count: msaa } });
  reg.add('tessie-drops', { layout: layoutFx, vertex: { module: mFx, entryPoint: 'vsDrop' }, fragment: { module: mFx, entryPoint: 'fsDrop', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: noWrite, multisample: { count: msaa } });   // translucent streaks, after the water
  reg.add('tessie-mist', { layout: layoutFx, vertex: { module: mFx, entryPoint: 'vsMist' }, fragment: { module: mFx, entryPoint: 'fsMist', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: noWrite, multisample: { count: msaa } });
  let nSh = 0, nDr = 0, nMi = 0;
  // TK: the revenge's gloom (one quad after the water; nothing drawn while it is off)
  const gData = new Float32Array(8);
  const gBuf = device.createBuffer({ label: 'tessie-gloom', size: gData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bglG = device.createBindGroupLayout({ label: 'tessie-gloom', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'uniform' } }] });
  const bgG = device.createBindGroup({ layout: bglG, entries: [{ binding: 0, resource: { buffer: gBuf } }] });
  const mG = reg.shader('tessie-gloom', GLOOM_WGSL(frameStruct));
  reg.add('tessie-gloom', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bglG] }), vertex: { module: mG, entryPoint: 'vs' }, fragment: { module: mG, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: noWrite, multisample: { count: msaa } });
  let gloomOn = false;
  // the creature map (in the wake's buffer, after its two maps)
  const cu = new Float32Array(CU_VEC4 * 4);
  const cbuf = device.createBuffer({ label: 'tessie-water', size: cu.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let bgC = null;
  if (wake && wake.sizes.creature) {
    const bglC = device.createBindGroupLayout({ label: 'tessie-water', entries: [{ binding: 0, visibility: CP, buffer: { type: 'uniform' } }, { binding: 1, visibility: CP, buffer: { type: 'storage' } }] });
    bgC = device.createBindGroup({ layout: bglC, entries: [{ binding: 0, resource: { buffer: cbuf } }, { binding: 1, resource: { buffer: wake.mapsBuffer } }] });
    reg.add('tessie-water', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglC] }), compute: { module: reg.shader('tessie-water', WATER_COMPUTE_WGSL({ size: wake.sizes.creature, offset: wake.creatureOffset })), entryPoint: 'main' } });
  }

  let asset = null, vb = null, ib = null, loading = null, live = false, waterLive = false, lod = 'lod0';
  const stats = { bytes: 0, loadMs: null, verts: 0, triangles: 0, calls: 0, dispatches: 0, L: null, lod: null, drops: 0, mists: 0, shadow: 0, gloom: 0 };
  // M2: the desk LODs by her length on screen (the kayaks' size rule): near over 260 px, mid over 90 px, far below
  const LOD_PX = { near: 260, mid: 90 };
  const self = {
    stats, get ready() { return !!asset; }, get L() { return asset?.L ?? null; },
    load(url) {
      loading ??= (async () => {
        const t = performance.now();
        const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const ab = await r.arrayBuffer(); stats.bytes = ab.byteLength;
        const a = packTessie(ab);
        vb = device.createBuffer({ label: 'tessie-vertices', size: a.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vb, 0, a.vertices);
        const ibytes = Math.ceil(a.indices.byteLength / 4) * 4;
        ib = device.createBuffer({ label: 'tessie-indices', size: ibytes, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        const ipad = new Uint8Array(ibytes); ipad.set(new Uint8Array(a.indices.buffer, a.indices.byteOffset, a.indices.byteLength));
        device.queue.writeBuffer(ib, 0, ipad);
        asset = a; stats.verts = a.verts; stats.triangles = a.triangles; stats.L = +a.L.toFixed(2); stats.loadMs = +(performance.now() - t).toFixed(1);
        return a;
      })().catch((e) => { errors.push(`tessie: ${e?.message ?? e}`); loading = null; throw e; });
      return loading;
    },
    // per frame, only while she is in the water: the spine and the creature map's sources (two writeBuffers)
    update(st, on = true, eye = null, focalPx = 0, bedDepth = 30, glow = 0) {   // bedDepth: m of water under her (the column behind her); glow: her night wake's share (M3)
      live = !!(on && asset && st?.visible);
      waterLive = live && !!bgC;
      // the creature map is hers while she is in the water (the osprey's strike writes it only when she has let it go)
      if (wake) { if (waterLive) { wake.creature.on = 1; wake.creature.writer = 'tessie'; wake.creature.glow = glow; } else if (wake.creature.writer === 'tessie' || wake.creature.writer == null) { wake.creature.on = 0; wake.creature.writer = null; } }
      if (!live) return;
      if (eye && focalPx) { const d = Math.hypot(st.centre[0] - eye[0], st.centre[1] - eye[2]), px = asset.L * focalPx / Math.max(1, d); lod = px > LOD_PX.near ? 'lod0' : px > LOD_PX.mid ? 'lod1' : 'lod2'; stats.lod = lod; }
      tu.set(st.spine.subarray(0, SPINE_N * 8), 0);
      for (let i = 0; i < SPINE_N; i++) tu[i * 8 + 3] = 1;
      const o = SPINE_N * 8; tu[o] = asset.L; tu[o + 1] = SPINE_N; tu[o + 2] = st.wetAge; tu[o + 3] = st.t; tu[o + 4] = Number.isFinite(bedDepth) ? Math.max(0, bedDepth) : 30; tu[o + 5] = st.played ? 1 : 0;
      tu[o + 6] = st.paddle?.phase ?? 0; tu[o + 7] = st.paddle?.amp ?? 0; tu[o + 8] = st.gape ?? 0;   // played: the player swims her (her wet back);: the paddle and the gape (0 for a sighting)
      device.queue.writeBuffer(ubuf, 0, tu);
      if (!waterLive) return;
      const E = CREATURE.extent, cell = E / CREATURE.size;
      const x0 = Math.round((st.centre[0] - E / 2) / cell) * cell, z0 = Math.round((st.centre[1] - E / 2) / cell) * cell;
      wake.creature.x0 = x0; wake.creature.z0 = z0; wake.creature.extent = E;
      const W = st.water, K = W.kelvin.slice(0, CREATURE.maxK), R = W.rings.slice(-CREATURE.maxR), Cn = W.contacts.slice(0, CREATURE.maxC);
      cu.fill(0);
      cu.set([x0, z0, E, 0, K.length, R.length, Cn.length, st.t], 0);
      K.forEach((e, i) => cu.set(e, 8 + i * 4));
      R.forEach((e, i) => cu.set(e, 8 + (CREATURE.maxK + i) * 4));
      Cn.forEach((e, i) => cu.set(e, 8 + (CREATURE.maxK + CREATURE.maxR + i) * 4));
      device.queue.writeBuffer(cbuf, 0, cu);
    },
    // the water-sim pass, after the wake's maps
    runWater(pass, c) {
      if (!waterLive) return;
      pass.setBindGroup(0, bgC); pass.setPipeline(reg.get('tessie-water'));
      const n = Math.ceil(CREATURE.size / 8); pass.dispatchWorkgroups(n, n); c.dispatches++; stats.dispatches = 1;
    },
    draw(pass, c) {
      if (!live) { stats.calls = 0; return; }
      pass.setPipeline(reg.get(underPipe(reg, 'tessie-body'))); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, asset.indices instanceof Uint32Array ? 'uint32' : 'uint16');
      const L0 = asset.lods[lod]; pass.drawIndexed(L0.count, 1, L0.first); c.calls++; c.triangles += L0.count / 3; stats.calls = 1;
    },
    // the effects' records (shadow: Float32Array (x, y, z, a) × 2 per ribbon point; drops: [x, y, z, r]; mists: [x, y, z, r, a])
    updateFx({ shadowPts = null, nShadow = 0, drops = [], mists = [], focalPx = 1000 } = {}) {
      nSh = live && nShadow >= 2 ? Math.min(FX.shadow, nShadow) : 0; nDr = Math.min(FX.drops, drops.length); nMi = Math.min(FX.mists, mists.length);
      if (!nSh && !nDr && !nMi) { stats.drops = stats.mists = stats.shadow = 0; return; }
      fxData[0] = nSh; fxData[1] = nDr; fxData[2] = nMi; fxData[3] = focalPx;
      if (nSh) fxData.set(shadowPts.subarray(0, nSh * 8), FX_SH * 4);
      for (let i = 0; i < nDr; i++) { const d = drops[i], o = (FX_DR + i * 2) * 4; fxData[o] = d.x; fxData[o + 1] = d.y; fxData[o + 2] = d.z; fxData[o + 3] = d.r; fxData[o + 4] = d.vx ?? 0; fxData[o + 5] = d.vy ?? 0; fxData[o + 6] = d.vz ?? 0; fxData[o + 7] = d.life ?? 1; }
      for (let i = 0; i < nMi; i++) { const m = mists[i], o = (FX_MI + i * 2) * 4; fxData[o] = m.x; fxData[o + 1] = m.y; fxData[o + 2] = m.z; fxData[o + 3] = m.r; fxData[o + 4] = m.a; }
      device.queue.writeBuffer(fxBuf, 0, fxData, 0, (nMi ? FX_MI + nMi * 2 : nDr ? FX_DR + nDr * 2 : FX_SH + nSh * 2) * 4);
      stats.drops = nDr; stats.mists = nMi; stats.shadow = nSh;
    },
    // before the water: the shadow on the bed (the drops are streaks after the water: drawMist)
    drawFx(pass, c) {
      if (!nSh) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bgFx);
      pass.setPipeline(reg.get('tessie-shadow')); pass.draw((nSh - 1) * 6); c.calls++; c.triangles += (nSh - 1) * 2;
    },
    // TK: the gloom round the boat ({ x, z, heading, a }; a < 0.002 or null: off)
    updateGloom(g = null) {
      gloomOn = !!g && g.a >= 0.002;
      stats.gloom = gloomOn ? +g.a.toFixed(3) : 0;
      if (!gloomOn) return;
      gData[0] = g.x; gData[1] = g.z; gData[2] = g.heading; gData[3] = g.a; gData[4] = GLOOM.r; gData[5] = GLOOM.y;
      device.queue.writeBuffer(gBuf, 0, gData);
    },
    // after the water: the gloom, then the mist
    drawMist(pass, c) {
      if (gloomOn) { pass.setBindGroup(1, bgG); pass.setPipeline(reg.get('tessie-gloom')); pass.draw(6); c.calls++; c.triangles += 2; }
      if (!nMi && !nDr) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bgFx);
      if (nDr) { pass.setPipeline(reg.get('tessie-drops')); pass.draw(6, nDr); c.calls++; c.triangles += nDr * 2; }   // the spray's streaks, translucent
      if (nMi) { pass.setPipeline(reg.get('tessie-mist')); pass.draw(6, nMi); c.calls++; c.triangles += nMi * 2; }
    },
    drawMirror(pass, c) {
      if (!live) return;
      pass.setPipeline(reg.get('tessie-mirror')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, asset.indices instanceof Uint32Array ? 'uint32' : 'uint16');
      const L0 = asset.lods[lod]; pass.drawIndexed(L0.count, 1, L0.first); c.calls++; c.triangles += L0.count / 3; stats.calls++;
    },
  };
  return self;
}
