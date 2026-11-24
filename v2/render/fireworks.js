// The fireworks on v2's GPU: v1's own engine (src/fireworks/engine.js, TSL there) in WGSL. The stars live in one storage
// buffer (v1's seven vec4 a star, interleaved) and the streaks in a history ring (HISTORY points a star); one compute
// dispatch a frame runs v1's starStep on the slots still drawing (src/fireworks/physics.js, line for line: the drag on the
// speed through the air, the wind, the gravity, the kick, the history); one instanced draw draws each star as v1 does (a
// tapered ribbon through its history, the long exposure's streak, and a round head with its halo), additive HDR, at
// screen levels / the exposure. The water reflects them as v1's composite does (src/fireworks/composite.js): the stars drawn
// again into their own quarter-size target, and each open-water pixel's mirrored ray, bent by the live wave normal and v1's
// fine ripples, followed out to the show's distance, picks the stars up there (a long broken streak under each burst that
// shimmers with the waves, the crests carrying the light), plus the air's glow mirrored as broad colour.
// The smoke (v1's puffs, lit by the flash bank), the air's glow round the bursts (v1's skyFlash, on the sky), the barges,
// tugs and patrol boats (low-poly boxes as v1's, lit by the bursts) and their lamps. The scheduler (which shells, which
// slots) is v2/sim/fireworks.js. Every pipeline is declared at boot (only on a page that can have the show: the
// highlight day, ?fireworks not 0); nothing draws or dispatches outside the show and the barges' evening.
//   const fw = createFireworksRender({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa, depthFormat, state })
//   fw.seek(t)                    the show at t (the GPU replays the last seconds on v1's fixed 1/60 s step)
//   fw.frame(dt, o)               before the graph: spawn, upload, the clock, the uniforms (o: { gain, pixRad, night, lamps, simT, barges })
//   fw.run(pass, c)               the compute (inside the frame's 'forest' pass)
//   fw.drawSolid(pass, c)         the barges (opaque, before the water: the water covers their hulls below the line)
//   fw.encodePost(enc, c, ts, frameBG, offsets, targets, msaa)   an own pass after the scene while the show is up at night: v1's
//                                 composite (POST: the stars in their own target graded on the sum, the bloom, the water's
//                                 reflection, the show's night, the bursts' wash on the land and the boat)
//   fw.wantsDepth()               the scene pass keeps its depth for the post this frame
//   fw.drawLight(pass, c)         the glow, the lamps (additive, after the sky); the stars, the smoke and the water's
//                                 reflection too when the post is off
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { WARP_WGSL } from './bed.js';
import { STAR_FLOATS, PUFF_FLOATS, LOOK, STEP, LOOKAHEAD, FLASH_SLOTS, SMOKE_PILE, SHOW_LENGTH, bargeProps, patrolInto, BOX_FLOATS, boxRecord } from '../sim/fireworks.js';
import { buildPropMeshes, LOD_M, VF as MESH_VF } from './bargeMesh.js';

// v1's FLASH_LOOK sky glow (src/fireworks/light.js skyFlash)
export const GLOW_LOOK = Object.freeze({ skyCore: 0.03, skyWide: 0.01, coreRad2: 0.02, wideRad2: 0.3, airCap: 0.2, slots: 4 });   // slots: v2 reads the bank's brightest 4 (v1 all 8). 2026-11-18 (the finale stays coloured): skyWide 0.01, airCap 0.2 (were 0.03, 0.4: the wide glow of every burst summed to a grey sky)
// the bursts' light on the props (screen levels per bank unit at 150 m: the barges lit by the show)
// v1's fireworks layer is graded before it is added (light.js FLASH_LOOK.sat: its chroma × 1.8 about its luminance);
// here each star's colour is, before the sum
export const SAT = 1.8;
export const PROP_FLASH = Object.freeze({ k: 0.35, m: 150 });
// the bursts in the water: v1's composite (src/fireworks/composite.js, FLASH_LOOK in src/fireworks/light.js), ported. Each
// open-water pixel's ray, mirrored by the wave normal × wave plus v1's fine ripples (ripple), steepened × lift (v1's game: the
// bursts overhead paint the water nearer the eye), followed out to the show's distance, reads the stars' own target there in
// four taps down the screen; the ripple crests facing the burst carry it (thin broken streaks), weighted by the water's
// Fresnel (× 2.5 + 0.04, at most 1) and v1's reflect, through v1's soft shoulder (limit, screen levels). The air's glow round
// the bursts is mirrored off the smoother normal (water) on a weight never under floor: the broad colour. The water takes no
// other flash (v1: "the water takes the flash through its reflection only"). With the post on (the show at night: POST below)
// the post draws it on the water's own pixels (found by the scene's depth); else a plane just over the mean surface round the
// eye (planeY, R), depth-tested so only open water takes it. res: the stars' target's share of the frame's size (a side).
// bloom: v1's reflectBloom (the bloom, POST, mirrored off a calmer normal, broadWave: the broad colour on the water under the
// glints; v2's wind-driven waves broke it into streaks at the full wave normal; 2026-11-18, the v1-grade round: 12, was 5 on
// a 2 × 2 box of the stars' target before v2 had a bloom); blur: unused since the bloom.
// rippleNear..rippleFar: the fine ripples and the crests fade out with distance (they aliased into a per-pixel sparkle).
// quads: the streak's quads drawn into the stars' target (the newest; 4 in all); cascades: the slope cascades read
// for the normal (3: the 600, 85 and 12 m ones; v1's ripples stand in for the 2.1 m one)
export const REFLECT = Object.freeze({ rippleNear: 60, rippleFar: 260, broadWave: 0.35, wave: 1.6, ripple: 0.2, lift: 4, reflect: 2.2, limit: 1.4, water: 0.8, floor: 0.22, tap: 0.0025, planeY: 0.35, R: 2000, res: 0.25, format: 'rgba16float', bloom: 6, blur: 3, cascades: 3, quads: 2 });
// a streak point under this level (screen levels) is drawn with no width (the long tails' faint ends: fill for nothing;
// 2026-11-18: compared in screen levels, as meant: it had been compared × 1 / the exposure, about 21 × too high at night,
// so the launch trails and the willows' tails were cut)
export const RIB_SEEN = 0.002;
// the streak drawn through every RIB_STEP-th point of v1's history. 1 (2026-11-18, the v1-grade round; was 2 for the fill
// budget): every point, as v1 (at 2 a big near willow's curves showed as kinked polylines)
export const RIB_STEP = 1;
export const ribPoints = (H8, step = RIB_STEP) => Math.floor(H8 / step) + 1;
// the post's weight at show time t: 0 until a minute before the show, up over POST.ramp s, down over POST.ramp s to a minute after
export const showRamp = (t) => Math.min(1, Math.max(0, (t + 60) / POST.ramp), Math.max(0, (SHOW_LENGTH + 60 - t) / POST.ramp));

const U_WGSL = `
struct FWU { wind: vec4f, look: vec4f, misc: vec4f, lamp: vec4f, refl: vec4f, bankPos: array<vec4f, ${FLASH_SLOTS}>, bankCol: array<vec4f, ${FLASH_SLOTS}> }
struct Star { p: vec4f, v: vec4f, c: vec4f, tr: vec4f, f: vec4f, k: vec4f, x: vec4f }`;
// wind: the wind × scale (xyz), the gravity × scale; look: 1 / exposure, rad per px, the head's gain, the trail's gain;
// misc: the slots drawn, the scale, 0, the night; lamp: work, nav, blue, the sim time (the blink); refl: the show's horizontal
// distance from the eye (m: v1's FW.dist, how far the water's rays look), the show clock (v1's FW.time: the ripples), 0, 0

export const STEP_WGSL = (H8, trails) => `${U_WGSL}
@group(0) @binding(0) var<storage, read_write> stars: array<Star>;
@group(0) @binding(1) var<storage, read_write> hist: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> clk: array<f32, 4>;   // t0, dt, k, t (t = t0 + k dt)
@group(0) @binding(3) var<uniform> U: FWU;
const H8 = ${H8}u;
@compute @workgroup_size(1) fn tick() { clk[2] = clk[2] + 1.0; clk[3] = clk[0] + clk[2] * clk[1]; }
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) g: vec3u) { let i = g.x; if (i >= arrayLength(&stars)) { return; } stars[i].p.w = 1e9; }
// v1's kernel (engine.js): physics.js starStep, plus the kick and the history ring
@compute @workgroup_size(64) fn stepStars(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= arrayLength(&stars)) { return; }
  let s = stars[i];
  let t = clk[3]; let dt = clk[1];
  let born = s.p.w; let burn = s.c.w; let age = t - born;
  if (!(age > 0.0 && age - dt < burn)) { return; }
  let h = min(dt, age);
  ${trails ? 'if (age - dt <= 0.0) { for (var j = 0u; j < H8; j++) { hist[i * H8 + j] = vec4f(s.p.xyz, born); } }' : ''}
  var vel = s.v.xyz;
  let kickAge = s.k.w;
  if (kickAge > 0.0 && age >= kickAge && age - h < kickAge) { vel += s.k.xyz; }
  var rel = vel - U.wind.xyz;
  rel /= 1.0 + s.v.w * length(rel) * h;
  vel = rel + U.wind.xyz;
  vel.y -= U.wind.w * h;
  let pos = s.p.xyz + vel * h;
  stars[i].p = vec4f(pos, born);
  stars[i].v = vec4f(vel, s.v.w);
  ${trails ? `let I = s.f.y;
  let a0 = floor((age - h) / I); let a1 = floor(min(age, burn) / I);
  if (a1 > a0) { hist[i * H8 + (u32(a1) % H8)] = vec4f(pos, t); }` : ''}
}`;

// the scene's depth under a fragment (reversed: 0 at the far plane). post > 0: the post's full-size target, pixel for pixel;
// post < 0: the quarter-size target (the bloom's and the water's source), its pixel scaled up to the scene's (owner, 2026-11-18:
// nothing glows through the island: the bloom is built from the stars the eye sees)
const DEPTH_AT = (post) => (post === 0 ? '' : `fn sceneDepth(p: vec2f) -> f32 {
  let d = vec2i(textureDimensions(tDepth));
  return textureLoad(tDepth, clamp(vec2i(p * ${post > 0 ? '1.0' : (1 / REFLECT.res).toFixed(4)}), vec2i(0), d - vec2i(1)), 0);
}`);
// v1's star material (engine.js starMaterial), vertex for vertex
// post: 0 into the scene, graded per star (no post: the hot core and the shoulder on each star); -n raw (the quarter-size target, tested against the scene's depth of n samples:
// the bloom and the water grade the sums); n > 0 raw into the post's own full-size target, tested by hand against the scene's
// depth (group 2, its sample count n: the post grades the sums as v1's composite does)
export const STAR_WGSL = (fs, H8, trails, post = 0) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${U_WGSL}
@group(1) @binding(0) var<storage, read> stars: array<Star>;
@group(1) @binding(1) var<storage, read> hist: array<vec4f>;
@group(1) @binding(2) var<storage, read> clk: array<f32, 4>;
@group(1) @binding(3) var<uniform> U: FWU;
const H8 = ${H8}u;
${post !== 0 ? `@group(2) @binding(0) var tDepth: ${Math.abs(post) > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};` : ''}
${DEPTH_AT(post)}
const RIB = ${trails ? 2 * ribPoints(H8) : 0}u;
const RS = ${RIB_STEP}.0;
struct SV { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) info: vec3f }
fn hash2(a: f32, b: f32) -> f32 { return fract(sin(dot(vec2f(a, b), vec2f(12.9898, 78.233))) * 43758.5453); }
fn bit(flick: f32, b: f32) -> f32 { return floor(flick / b) % 2.0; }
fn histAt(i: u32, k: f32) -> vec4f { return hist[i * H8 + (u32(k) % H8)]; }
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) ii: u32) -> SV {
  var o: SV;
  let i = ii;
  var j: f32; var side: f32; var kind: f32;
  if (vid < RIB) { j = f32(vid / 2u) * RS; side = select(-1.0, 1.0, (vid % 2u) == 1u); kind = 0.0; }
  else { let c = vid - RIB; j = select(-1.0, 1.0, c == 1u || c == 2u); side = select(-1.0, 1.0, c >= 2u); kind = 1.0; }
  let s = stars[i];
  let t = clk[3];
  let born = s.p.w; let burn = s.c.w; let tau = s.tr.w; let age = t - born;
  let flick = s.f.x; let interval = s.f.y; let width = s.f.z; let headPx = s.f.w; let kickAge = s.k.w; let change = s.x.w;
  let hiddenNow = bit(flick, 16.0) * step(age, kickAge);
  let live = step(0.0, age) * step(age, burn + tau * 3.0);
  let headOn = step(0.0, age) * step(age, burn) * (1.0 - hiddenNow);
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0); o.col = vec3f(0.0); o.info = vec3f(0.0);
  if (live < 0.5 || (kind > 0.5 && headOn < 0.5)) { return o; }   // nothing to draw: off screen (no zero-colour quads)
  let fi = f32(i);
  let cam = F.cam.xyz;
  var pos: vec3f; var colour: vec3f;
  ${trails ? 'if (kind < 0.5) {' : 'if (false) {'}
    // the streak's vertex (v1's ribbon): only what it needs (the head's terms are the head's vertices' work)
    let lastIdx = floor(min(max(age, 0.0), burn) / interval);
    let jb = min(j + RS, f32(H8));
    var q0 = histAt(i, clamp(lastIdx - j + 1.0, 0.0, lastIdx));
    if (j < 0.5 && headOn > 0.5) { q0 = vec4f(s.p.xyz, t); }
    var qb = histAt(i, clamp(lastIdx - jb + 1.0, 0.0, lastIdx));
    if (jb < 0.5 && headOn > 0.5) { qb = vec4f(s.p.xyz, t); }
    let qa = q0;
    let p0 = q0.xyz; let tn = normalize(qa.xyz - qb.xyz + vec3f(0.0, 1e-4, 0.0));
    let d0 = length(p0 - cam); let vw = (p0 - cam) / d0;
    let cr = cross(tn, vw); let crl = length(cr);
    let sideV = select(normalize(cross(vw, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-6, 0.0, 0.0)), cr / max(crl, 1e-9), crl > 1e-6);   // a star flying straight at the eye: no NaN corners (black dots)
    let u = j / f32(H8);
    let w = max(width * U.misc.y * mix(1.0, 0.35, u), U.look.y * d0 * ${LOOK.trailPx.toFixed(3)});
    let shown = select(1.0, step(born + kickAge, q0.w), bit(flick, 16.0) > 0.5);
    let sparkle = mix(1.0, 0.3 + hash2(fi * 13.0 + j, floor(t * 20.0)) * 1.4, bit(flick, 4.0));
    let speed = length(qa.xyz - qb.xyz) / max(qa.w - qb.w, 1e-3);
    let dwell = clamp(${LOOK.vRef.toFixed(1)} * U.misc.y / max(speed, 0.1), 0.06, 2.0);
    let trailI = live * shown * exp(-(t - q0.w) / tau) * mix(1.0, 0.35, u) * sparkle * dwell;
    let ptCol = mix(s.tr.rgb, s.x.rgb * 0.75, step(0.001, change) * step(change, q0.w - born));
    colour = ptCol * trailI * U.look.w;
    pos = p0 + sideV * (w * side * step(${RIB_SEEN}, max(colour.r, max(colour.g, colour.b))));   // too faint to see (screen levels): no width, no fragments
  } else {
    // the head's vertex (v1's head and halo)
    let seed = fract(sin(fi * 12.9898) * 43758.5453);
    let glit = mix(1.0, 0.2 + pow(hash2(fi, floor(t * 24.0)), 3.0) * 2.2, bit(flick, 1.0));
    let strobe = mix(1.0, step(0.55, fract(t * (seed * 5.0 + 7.0) + seed)) * 1.7, bit(flick, 2.0));
    let ramp = clamp(age / 0.03, 0.0, 1.0); let fade = 1.0 - smoothstep(burn * 0.7, burn, age) * 0.75;
    let pop = clamp(1.0 - (age - kickAge) / max(burn - kickAge, 0.01), 0.0, 1.0) * 3.0;
    let dying = smoothstep(burn * ${(1 - LOOK.dying).toFixed(4)}, burn, age) * (1.0 - bit(flick, 8.0));
    let sputter = mix(1.0, 0.25 + hash2(fi * 7.31, floor(t * 30.0) + seed * 11.0) * 1.3, dying);
    let headI = headOn * ramp * mix(fade, pop, bit(flick, 8.0)) * glit * strobe * sputter;
    let chg = step(0.001, change) * step(change, age);
    let flame = mix(s.c.rgb, s.x.rgb, chg);
    let ember = vec3f(1.0, 0.42, 0.12) * max(flame.r, max(flame.g, flame.b)) * 0.7;
    let headCol = mix(flame, ember, dying * ${LOOK.ember.toFixed(3)});
    let centre = s.p.xyz;
    let toC = centre - cam; let dist = length(toC); let vd = toC / dist;
    let right = normalize(cross(vd, vec3f(0.0, 1.0, 0.0))); let up = cross(right, vd);
    let hw = headPx * ${(LOOK.headPx * 2).toFixed(3)} * U.look.y * dist * headOn;
    pos = centre + right * (j * hw) + up * (side * hw);
    colour = headCol * headI * U.look.z;
  }
  let clip = F.viewProj * vec4f(pos, 1.0);
  let lum = dot(colour, vec3f(0.2126, 0.7152, 0.0722));
  o.pos = clip; o.col = max(vec3f(lum) + (colour - vec3f(lum)) * ${SAT.toFixed(2)}, vec3f(0.0)) * U.look.x; o.info = vec3f(kind, j, side);
  return o;
}
@fragment fn fs(v: SV) -> @location(0) vec4f {
  let r2 = v.info.y * v.info.y + v.info.z * v.info.z;
  let headProfile = (exp(r2 * -14.0) + exp(r2 * -3.0) * 0.07) * (1.0 - smoothstep(0.75, 1.0, r2));
  let ribProfile = 1.0 - v.info.z * v.info.z;
  let prof = select(ribProfile, headProfile, v.info.x > 0.5);
  // v1's white-hot core (composite.js hot): where the star is bright its colour goes toward white, its halo stays coloured
  let c = v.col * prof; let m = max(c.r, max(c.g, c.b));
${post ? `  if (v.pos.z < sceneDepth(v.pos.xy)) { discard; }   // behind the land, the island, the trees, the boat or the barges (reversed depth)
  return vec4f(c, 1.0);` : `  let hot = smoothstep(${POST.hotFrom.toFixed(2)}, ${POST.hotTo.toFixed(2)}, m / max(U.look.x, 1e-9)) * ${POST.hot.toFixed(2)};
  // then v1's soft shoulder in screen levels (its composite's, on the star itself: a burst's pop stays a coloured spark, not a white disc)
  let gS = max(U.look.x, 1e-9); let w = mix(c, vec3f(m), hot) / gS;
  return vec4f(w / (max(w.r, max(w.g, w.b)) / ${POST.limit.toFixed(2)} + 1.0) * gS, 1.0);`}
}`;

// v1's smoke (engine.js: soft puffs lit by the flash bank only: a later burst glows inside an earlier one's smoke)
// SMOKE_GAIN (2026-11-18, the finale stays coloured: the owner's "white blob"): the lit smoke's level on screen; a finale's
// puffs lit by every burst at once summed to a milky white haze over the show (the A/B: smoke off, the bursts read coloured)
export const SMOKE_GAIN = 0.35;
export const SMOKE_EXTENT = 0.85;   // the quad's half size over the puff's radius (its density is under 1 % of the core's past it)
// post n > 0: into the post's full-size target with the stars (v1: the smoke in its fireworks target, graded with them: a
// finale's white flashes no longer pile the puffs into a white fog), tested by hand against the scene's depth (sample count n)
export const SMOKE_WGSL = (fs, scale, post = 0) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${U_WGSL}
@group(1) @binding(0) var<storage, read> puffs: array<vec4f>;   // two a puff: pos.xyz radius; alpha, seed
@group(1) @binding(1) var<uniform> U: FWU;
${post !== 0 ? `@group(2) @binding(0) var tDepth: ${Math.abs(post) > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};` : ''}
${DEPTH_AT(post)}
struct PV { @builtin(position) pos: vec4f, @location(0) c: vec4f, @location(1) lit: vec3f }
// the bank's light at a point (v1's per pixel; here at the quad's corners, interpolated: it varies over 100 m, the quad's size)
fn bankLight(w: vec3f) -> vec3f {
  var L = vec3f(0.0);
  for (var k = 0; k < ${FLASH_SLOTS}; k++) {
    let bp = U.bankPos[k]; let bc = U.bankCol[k];
    let d = length(w - bp.xyz) / ${(LOOK.smokeM * scale).toFixed(2)};
    L += bc.rgb * (bp.w + bc.w) / (d * d + 1.0);
  }
  return L * ${LOOK.smoke.toFixed(2)} + ${LOOK.smokeBase};
}
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) ii: u32) -> PV {
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = cs[vid] * ${SMOKE_EXTENT}; let pf = puffs[ii * 2u]; let pf2 = puffs[ii * 2u + 1u];
  let vd = normalize(pf.xyz - F.cam.xyz);
  let right = normalize(cross(vd, vec3f(0.0, 1.0, 0.0))); let up = cross(right, vd);
  let w = pf.xyz + right * (c.x * pf.w) + up * (c.y * pf.w);
  var o: PV; o.pos = F.viewProj * vec4f(w, 1.0); o.c = vec4f(c, pf2.x, pf2.y);
  o.lit = bankLight(w) * U.look.x * vec3f(0.85, 0.88, 0.95) * ${(SMOKE_PILE * SMOKE_GAIN).toFixed(4)};
  return o;
}
@fragment fn fs(v: PV) -> @location(0) vec4f {
  let r2 = dot(v.c.xy, v.c.xy);
  let n = sin(v.c.x * 5.1 + v.c.w * 40.0) * sin(v.c.y * 4.3 - v.c.w * 23.0) * 0.1 + 0.9;
  let dens = v.c.z * exp(r2 * -2.6) * n * pow(max(1.0 - r2, 0.0), 2.0);
${post !== 0 ? '  if (v.pos.z < sceneDepth(v.pos.xy)) { discard; }   // behind the land (reversed depth)' : ''}
  return vec4f(v.lit * dens, 1.0);
}`;

// v1's air glow round the bursts (light.js skyFlash), on the sky only (a fullscreen triangle at the far plane)
export const GLOW_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${U_WGSL}
@group(1) @binding(0) var<uniform> U: FWU;
struct GV { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> GV {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: GV; o.pos = vec4f(p[i], 0.0, 1.0); o.ndc = p[i]; return o;
}
@fragment fn fs(v: GV) -> @location(0) vec4f {
  let a = F.invViewProj * vec4f(v.ndc, 1.0, 1.0); let b = F.invViewProj * vec4f(v.ndc, 0.5, 1.0);
  let dir = normalize(b.xyz / b.w - a.xyz / a.w);
  var L = vec3f(0.0);
  for (var k = 0; k < ${GLOW_LOOK.slots}; k++) {
    let bp = U.bankPos[k]; let bc = U.bankCol[k];
    let bd = normalize(bp.xyz - F.cam.xyz);
    let th2 = 2.0 * (1.0 - dot(dir, bd));
    L += bc.rgb * (bp.w + bc.w) * (exp(-th2 / ${GLOW_LOOK.coreRad2}) * ${GLOW_LOOK.skyCore} + exp(-th2 / ${GLOW_LOOK.wideRad2}) * ${GLOW_LOOK.skyWide});
  }
  let m = max(L.r, max(L.g, L.b));
  return vec4f(L / (m / ${GLOW_LOOK.airCap} + 1.0) * U.look.x, 1.0);
}`;

// v1's composite's water, shared by the plane (no post) and the post (the water's pixels by the scene's depth): the bindings
// tWSlope, sSlope, tStars (the quarter-size target), sStars, tHalo (the bloom)
export const REFLECT_FN = () => `// v1's soft shoulder in screen levels, the same scale on all three channels (the hue holds)
fn shoulder(c: vec3f) -> vec3f {
  let s = c / max(U.look.x, 1e-9); let m = max(s.r, max(s.g, s.b));
  return s / (m / ${REFLECT.limit.toFixed(2)} + 1.0) * U.look.x;
}
// v1's skyFlash: the bursts' light in the night air along a direction (screen levels), through its soft cap
fn skyFlash(dir: vec3f) -> vec3f {
  var L = vec3f(0.0);
  for (var k = 0; k < ${GLOW_LOOK.slots}; k++) {
    let bp = U.bankPos[k]; let bc = U.bankCol[k];
    let bd = normalize(bp.xyz - F.cam.xyz);
    let th2 = 2.0 * (1.0 - dot(dir, bd));
    L += bc.rgb * (bp.w + bc.w) * (exp(-th2 / ${GLOW_LOOK.coreRad2}) * ${GLOW_LOOK.skyCore} + exp(-th2 / ${GLOW_LOOK.wideRad2}) * ${GLOW_LOOK.skyWide});
  }
  let m = max(L.r, max(L.g, L.b));
  return L / (m / ${GLOW_LOOK.airCap} + 1.0);
}
fn toScreen(p: vec3f) -> vec3f {
  let c = F.viewProj * vec4f(p, 1.0);
  let n = c.xy / max(c.w, 1e-6);
  return vec3f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5, c.w);
}
fn edge(uv: vec2f, e: f32) -> f32 { return smoothstep(0.0, e, uv.x) * (1.0 - smoothstep(1.0 - e, 1.0, uv.x)) * smoothstep(0.0, e, uv.y) * (1.0 - smoothstep(1.0 - e, 1.0, uv.y)); }
fn fwReflect(world: vec3f) -> vec3f {
  // the water's normal (v1's MRT normal: the waves the surface draws)
  let wp = warpOf(world.x, world.z);
  var sl = vec2f(0.0);
  for (var c = 0u; c < ${REFLECT.cascades}u; c++) {
    var xz = world.xz; if (c > 0u) { xz += wp; }
    sl += textureSample(tWSlope, sSlope, xz / F.water[c], i32(c)).xy;
  }
  let n0 = normalize(vec3f(-sl.x, 1.0, -sl.y));
  let cam = F.cam.xyz;
  let vW = normalize(world - cam);
  let fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(n0, -vW), 0.0, 1.0), 5.0);
  let k = ${REFLECT.wave.toFixed(2)};
  let pw = world; let rt = U.refl.y;
  // v1's fine ripples (cm-scale, moving): the reflection breaks into thin streaks and glints
  let rx = sin(pw.x * 3.1 + pw.z * 1.3 + rt * 1.9) * 0.55 + sin(pw.x * 9.7 - pw.z * 6.1 + rt * 3.3) * 0.3 + sin(pw.x * 23.0 + pw.z * 17.0 - rt * 5.1) * 0.15;
  let rz = sin(pw.z * 4.3 - pw.x * 0.9 + rt * 2.3) * 0.55 + sin(pw.z * 12.1 + pw.x * 4.7 - rt * 2.9) * 0.3 + sin(pw.z * 29.0 - pw.x * 13.0 + rt * 4.4) * 0.15;
  // past about 100 m the cm-scale ripples are under a pixel: they would alias into a flickering per-pixel sparkle (the
  // reflections stay broad and steady), so they and the crests fade out with distance (v1's sparkle at the hull kept)
  let near = 1.0 - smoothstep(${REFLECT.rippleNear.toFixed(1)}, ${REFLECT.rippleFar.toFixed(1)}, length(world - cam));
  let nW = normalize(vec3f(n0.x * k + rx * ${REFLECT.ripple} * near, n0.y, n0.z * k + rz * ${REFLECT.ripple} * near));
  let nS = normalize(vec3f(n0.x * ${REFLECT.broadWave.toFixed(2)}, n0.y, n0.z * ${REFLECT.broadWave.toFixed(2)}));   // the broad colour off a calmer normal (v2's wind-driven waves scattered it into streaks: v1's lake mirror)
  var col = vec3f(0.0);
  // the broad colour: the air's glow mirrored off the wave map's normal (no fine ripples), on a weight never under the floor
  let soft = max(min(fres * 2.5 + 0.04, 1.0), ${REFLECT.floor});
  let rS0 = reflect(vW, nS);
  let rS = vec3f(rS0.x, max(rS0.y, 0.02) * ${REFLECT.lift.toFixed(2)}, rS0.z);
  col += skyFlash(normalize(rS)) * U.look.x * soft * ${REFLECT.water};
  // v1's bloomed layer on the same ray (the stars' blurred target): the broad colour under the glints
  let sS = toScreen(cam + rS * (U.refl.x / max(length(rS.xz), 0.05)));
  let eS = select(0.0, edge(sS.xy, 0.08), sS.z > 0.0);
  if (eS > 0.0) {
    let b = textureSampleLevel(tHalo, sStars, sS.xy, 0.0).rgb * ${(POST.waterGain / POST.levels).toFixed(4)};
    col += shoulder(b) * eS * soft * ${REFLECT.bloom.toFixed(1)};
  }
  // the stars' streaks: the rippled ray out to the show's distance, the stars' target read there
  let rW0 = reflect(vW, nW);
  let rW = vec3f(rW0.x, rW0.y * ${REFLECT.lift.toFixed(2)}, rW0.z);
  if (rW.y > 0.002) {
    let t = U.refl.x / max(length(rW.xz), 0.05);
    let s = toScreen(cam + rW * t);
    let inside = select(0.0, edge(s.xy, 0.02), s.z > 0.0);
    if (inside > 0.0) {
      let uv = s.xy;
      let sp = vec2f(0.0, ${REFLECT.tap});
      let taps = (textureSampleLevel(tStars, sStars, uv, 0.0).rgb + textureSampleLevel(tStars, sStars, uv + sp, 0.0).rgb
        + textureSampleLevel(tStars, sStars, uv - sp, 0.0).rgb + textureSampleLevel(tStars, sStars, uv + sp * 2.2, 0.0).rgb) * 0.25;
      // the crests facing the burst carry the light, the troughs between go dark (v1's wow round: broken by the live normal)
      let irr = sin(pw.x * 1.37 + pw.z * 2.91 + n0.x * 9.0 + rt * 1.3) * sin(pw.z * 0.83 - pw.x * 3.7 + n0.z * 11.0 - rt * 0.9);
      let crest = mix(0.55, smoothstep(0.15, 0.85, rx * rz * 0.9 + irr * 0.7 + 0.45), near);
      let weight = min(fres * 2.5 + 0.04, 1.0) * crest * 1.6;
      col += shoulder(taps) * inside * weight * ${REFLECT.reflect};
    }
  }
  return col;
}`;

// v1's composite's water (src/fireworks/composite.js, the water branch), on a plane over the open water: the wave normal from
// the FFT's slope cascades (v1's water MRT normal), v1's fine ripples, the stars' target read along the mirrored ray
export const REFLECT_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${U_WGSL}
@group(1) @binding(0) var<uniform> U: FWU;
@group(1) @binding(1) var tWSlope: texture_2d_array<f32>;
@group(1) @binding(2) var sSlope: sampler;
@group(1) @binding(3) var tStars: texture_2d<f32>;
@group(1) @binding(4) var sStars: sampler;
@group(1) @binding(5) var tHalo: texture_2d<f32>;   // the bloom (render/fireworks.js POST): v1's bloomed layer
${WARP_WGSL}
struct WV { @builtin(position) pos: vec4f, @location(0) world: vec3f }
@vertex fn vs(@builtin(vertex_index) vid: u32) -> WV {
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let w = vec3f(F.cam.x + cs[vid].x * ${REFLECT.R.toFixed(1)}, ${REFLECT.planeY}, F.cam.z + cs[vid].y * ${REFLECT.R.toFixed(1)});
  var o: WV; o.pos = F.viewProj * vec4f(w, 1.0); o.world = w; return o;
}
${REFLECT_FN()}
@fragment fn fs(v: WV) -> @location(0) vec4f { return vec4f(fwReflect(v.world), 1.0); }`;

// the barges, their pushboats and the patrol boats as meshes (render/bargeMesh.js; owner, 2026-11-18, round 2: "bring them to the
// channel buoys' bar"), one instanced pipeline: a barge's high mesh within LOD_M of the camera, its low one past it, the patrol
// boats' small hull. Each instance rides its craft's bob (a slow heave, roll and pitch, on the sim clock). The light is the
// channel buoys' (render/navAids.js): the sky and the sun, a soft Blinn sheen per material, the sky's Fresnel on the grazing
// side, the normal turned back toward the eye; plus the bursts (the flash bank) and, at night, the barge's amber work lights
// pooled on its deck. The materials (bargeMesh.js SLOT): weathered charcoal steel (rust runs from the deck edge and the
// strakes, rust blooms, the waterline's stain, a wet band and slime under it), deck plating with welded seams and scuffs, sand
// with grain, the racks' weathered wood, the tubes' glossy black HDPE and their dark mouths, the container's paint (faded,
// rusted at the foot), galvanised pipe, tyre rubber, a life ring's orange, the pushboat's white paint and glass and navy hull
export const PROP_BOB = Object.freeze({ heave: 0.09, roll: 0.006, pitch: 0.0025, period: 5.6 });
export const PROP_WORK = Object.freeze({ k: 0.5, r: 14, col: [1.0, 0.62, 0.3] });
export const PROP_INST = 16;   // floats an instance: pos.xyz yaw | bob, seed, kind, 0 | container rgb, 0 | 0
export const PROP_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${U_WGSL}
@group(2) @binding(0) var<storage, read> I: array<vec4f>;   // four an instance (PROP_INST)
@group(2) @binding(1) var<uniform> U: FWU;
struct BV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) lp: vec3f, @location(2) n: vec3f,
  @location(3) @interpolate(flat) slot: f32, @location(4) @interpolate(flat) info: vec4f, @location(5) @interpolate(flat) tint: vec3f }
@vertex fn vs(@location(0) p0: vec3f, @location(1) n0: vec3f, @location(2) slot: f32, @builtin(instance_index) ii: u32) -> BV {
  let a = I[ii * 4u]; let b = I[ii * 4u + 1u]; let t = I[ii * 4u + 2u];
  let c = cos(a.w); let s = sin(a.w);
  var w = a.xyz + vec3f(p0.x * c + p0.z * s, p0.y, -p0.x * s + p0.z * c);
  let ph = b.y * 6.2832;
  let tt = U.lamp.w * 6.2832 / ${PROP_BOB.period.toFixed(2)};
  w.y += b.x * (${PROP_BOB.heave} * sin(tt + ph) + p0.z * ${PROP_BOB.roll} * sin(tt * 0.83 + ph * 1.7) + p0.x * ${PROP_BOB.pitch} * sin(tt * 0.61 + ph * 0.4));
  var o: BV; o.pos = F.viewProj * vec4f(w, 1.0); o.world = w; o.lp = p0; o.n = vec3f(n0.x * c + n0.z * s, n0.y, -n0.x * s + n0.z * c);
  o.slot = slot; o.info = b; o.tint = t.rgb; return o;
}
fn hsh(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vn(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2f(1.0, 0.0)), u.x), mix(hsh(i + vec2f(0.0, 1.0)), hsh(i + vec2f(1.0, 1.0)), u.x), u.y); }
fn fbm(p: vec2f) -> f32 { return vn(p) * 0.55 + vn(p * 2.3 + 7.1) * 0.3 + vn(p * 5.1 + 3.7) * 0.15; }
fn lin(h: vec3f) -> vec3f { return pow(h, vec3f(2.2)); }
@fragment fn fs(v: BV) -> @location(0) vec4f {
  var n = normalize(v.n);
  let V0 = normalize(F.cam.xyz - v.world); if (dot(n, V0) < 0.0) { n = -n; }   // two-sided (the meshes are built unwound)
  let lp = v.lp; let y = v.world.y; let slot = i32(v.slot + 0.5); let seed = v.info.y;
  let side = abs(n.y) < 0.5;
  let st = select(vec2f(lp.x + lp.z * 0.7, lp.y), lp.xz, !side);   // a face's own coordinate (m)
  var col = vec3f(0.5); var spec = 0.25; var rough = 0.6;
  switch slot {
    case 0, 12: {   // steel: the barge's charcoal, the pushboat's navy; rust runs, blooms, the waterline's stain, the wet band, slime
      col = select(lin(vec3f(0.169, 0.180, 0.188)), lin(vec3f(0.12, 0.165, 0.2)), slot == 12);
      col *= 0.85 + 0.25 * fbm(st * vec2f(0.6, 1.8) + seed * 9.0);
      let streak = smoothstep(0.6, 0.9, vn(vec2f(st.x * 4.3 + seed * 40.0, y * 0.35))) * smoothstep(0.5, 0.85, vn(vec2f(st.x * 13.0 + 3.1, 0.2)) + 0.25);
      col = mix(col, lin(vec3f(0.48, 0.23, 0.12)), streak * smoothstep(-0.2, 0.8, y) * (0.5 + 0.5 * vn(vec2f(st.x * 21.0, y * 3.0))) * 0.75);
      col = mix(col, lin(vec3f(0.42, 0.2, 0.1)), smoothstep(0.72, 0.9, fbm(st * vec2f(0.45, 1.2) + seed * 3.0)) * 0.5);
      let wl = (1.0 - smoothstep(0.0, 0.32, y)) * smoothstep(-0.1, 0.04, y);
      col = mix(col, lin(vec3f(0.24, 0.17, 0.1)), 0.7 * wl);   // the waterline's brown stain
      spec = 0.3 + 0.5 * wl; rough = mix(0.55, 0.25, wl);      // and its wet sheen
      if (y < -0.04) { col = mix(col, lin(vec3f(0.12, 0.2, 0.14)), 0.6) * 0.6; spec = 0.05; rough = 0.9; }
    }
    case 1: {   // deck plating: welded seams (plates 6 × 1.8 m), wear lanes, scuffs, rust in the seams
      col = lin(vec3f(0.34, 0.35, 0.36)) * (0.72 + 0.45 * fbm(lp.xz * 0.5 + seed * 13.0));
      let sx = abs(fract(lp.x / 6.0) - 0.5) * 6.0; let sz = abs(fract(lp.z / 1.8) - 0.5) * 1.8;
      let seam = 1.0 - smoothstep(0.0, 0.025, min(3.0 - sx, 0.9 - sz));
      col = mix(col, lin(vec3f(0.3, 0.16, 0.09)), seam * 0.55);
      col *= 1.0 - 0.18 * smoothstep(0.55, 0.9, vn(lp.xz * vec2f(3.0, 0.6) + 5.0));   // scuffs along the deck
      col = mix(col, lin(vec3f(0.38, 0.19, 0.1)), smoothstep(0.66, 0.84, fbm(lp.xz * 0.3 + 4.0)) * 0.6);
      spec = 0.2; rough = 0.75;
    }
    case 2: { col = lin(vec3f(0.62, 0.55, 0.41)) * (0.62 + 0.5 * fbm(lp.xz * 4.0 + lp.y * 3.0)) * (0.85 + 0.15 * vn(lp.xz * 23.0)); spec = 0.02; rough = 1.0; }   // sand: grain, damp patches
    case 3: {   // weathered wood: the grain along the boards, greyed
      let along = select(lp.z, lp.x, abs(n.z) > 0.5 || abs(n.y) > 0.5);
      col = lin(vec3f(0.55, 0.42, 0.28)) * (0.75 + 0.3 * vn(vec2f(along * 1.2, (lp.y + lp.z + lp.x) * 18.0))); spec = 0.05; rough = 0.9;
    }
    case 4: { col = vec3f(0.012); spec = 0.9; rough = 0.3; }                   // HDPE tube: glossy black
    case 5: { col = vec3f(0.004); spec = 0.0; rough = 1.0; }                   // the bore
    case 6: {   // the container's paint: faded, rusted at the foot and the corners
      col = v.tint * (0.82 + 0.25 * fbm(st * 0.7 + seed * 11.0));
      col = mix(col, lin(vec3f(0.4, 0.18, 0.08)), (1.0 - smoothstep(1.0, 1.45, lp.y)) * 0.55 * vn(vec2f(st.x * 3.0, 1.0)));
      spec = 0.35; rough = 0.5;
    }
    case 7: { col = lin(vec3f(0.6, 0.62, 0.64)) * (0.8 + 0.2 * vn(st * 6.0)); spec = 0.7; rough = 0.35; }   // galvanised pipe
    case 8: { col = vec3f(0.018); spec = 0.15; rough = 0.8; }                  // tyre rubber
    case 9: { col = lin(vec3f(0.88, 0.34, 0.11)); spec = 0.5; rough = 0.4; }   // the life ring
    case 10: { col = lin(vec3f(0.89, 0.87, 0.82)) * (0.92 + 0.1 * fbm(st * 1.5)); col = mix(col, lin(vec3f(0.5, 0.3, 0.18)), smoothstep(0.75, 0.95, vn(vec2f(st.x * 6.0, st.y * 0.8))) * 0.25); spec = 0.5; rough = 0.35; }   // white paint, rust weeping
    case 11: { col = vec3f(0.01, 0.015, 0.02); spec = 1.4; rough = 0.08; }     // glass
    case 13: { col = vec3f(0.03); spec = 0.5; rough = 0.4; }                   // black paint
    case 14: { col = lin(vec3f(0.52, 0.4, 0.26)) * (0.85 + 0.2 * vn(st * 4.0)); spec = 0.05; rough = 0.9; }   // cardboard
    case 15: { col = lin(vec3f(0.6, 0.6, 0.57)) * (0.85 + 0.2 * fbm(st * 1.2 + seed)); spec = 0.3; rough = 0.5; }   // grey paint
    default: {   // the low mesh's rack: wood, the tubes' black mouths on top (the high mesh models them)
      col = lin(vec3f(0.55, 0.42, 0.28)) * 0.8; spec = 0.05; rough = 0.9;
      if (n.y > 0.7) { let g = fract(lp.xz / 0.18) - 0.5; col = mix(col, vec3f(0.01), 1.0 - smoothstep(0.28, 0.36, length(g))); }
    }
  }
  // the light: the sky and the sun, the sheen and the sky's Fresnel (navAids), the bursts, the work lights on the deck at night
  let L = normalize(F.sun.xyz); let H = normalize(L + V0);
  let nl = max(dot(n, L), 0.0); let nv = max(dot(n, V0), 0.0);
  let hl = pow(max(dot(n, H), 0.0), mix(8.0, 90.0, 1.0 - rough)) * spec * nl;
  let fres = 0.05 + 0.6 * pow(1.0 - nv, 4.0);
  let E = LIGHT.sky.rgb * (0.65 + 0.35 * n.y) + LIGHT.sun.rgb * nl;
  var B = vec3f(0.0);
  for (var k = 0; k < ${FLASH_SLOTS}; k++) {
    let bp = U.bankPos[k]; let bc = U.bankCol[k];
    let Lb = bp.xyz - v.world; let d = length(Lb);
    B += bc.rgb * (bp.w + 0.5 * bc.w) * max(dot(n, Lb / d), 0.0) / (1.0 + (d / ${PROP_FLASH.m.toFixed(1)}) * (d / ${PROP_FLASH.m.toFixed(1)}));
  }
  let onBarge = select(0.0, 1.0, v.info.z < 0.5);
  let pool = onBarge * U.lamp.x * exp(-(lp.x * lp.x) / ${(PROP_WORK.r * PROP_WORK.r).toFixed(1)}) * smoothstep(0.9, 1.3, lp.y) * (0.12 + 0.88 * max(n.y, 0.0));
  let rgb = col * (E / PI + B * ${PROP_FLASH.k} * U.look.x + vec3f(${PROP_WORK.col.join(', ')}) * pool * ${PROP_WORK.k} * U.look.x)
    + LIGHT.sun.rgb * hl * 0.15 + LIGHT.sky.rgb * fres * spec * 0.25;
  return vec4f(aerial(rgb, v.pos.xy, v.world), 1.0);
}`;


// v1's post stage for the show (src/fireworks/composite.js, FLASH_LOOK in src/fireworks/light.js; owner, 2026-11-18: "Use
// v1's fireworks as reference to improve our v2 version"), after the scene pass, while the show is in the air at night:
//   the bloom: the stars and the lit smoke drawn into their quarter-size target (the water's reflection reads it next
//     frame), blurred down three levels and back up (the dual filter, Bjørge, SIGGRAPH 2015: 5 small passes; v1 ran
//     three's BloomNode, 8 passes); the halo added to the picture through v1's soft shoulder and its vivid push (halo);
//   the land: the far shore past farFrom..farTo m darkened to a silhouette (farDark; its lights and the stars over it kept:
//     v1's luma rule), each burst washing only the faces turned to it by 1 / (1 + (d / washM)²), through a soft cap;
//   the boat and all within nearFrom..nearTo m washed in the burst's colour by their own lightness (nearWash, nearCap);
//   the open water takes none of it (v1: the water takes the flash through its reflection only).
// The picture is copied first (the pass reads the colour under it: v1's luma rules), the depth kept by the scene pass.
// skyDark, landDark: the show's night, v1's darker night while the show is up (v2's night sky, clouds and land are brighter
// than v1's, so the bursts had less contrast: BACKLOG #19); the boat (within nearFrom..nearTo m) is not darkened
// halo: the bloom's strength (v1's bloom 3 on its BloomNode); bloomGain: our levels' mean against v1's BloomNode output, set
// by eye on matched frames (0.6: v1's halo round a burst; more read as a pink fog over the show); waterGain: the same for
// the water's broad colour (2.5: v1's warm lake under the finale); ramp: show s over which the land's night look eases in
// before the show and out after it (no pop at 21:44)
// 2026-11-18 (the finale stays coloured: the owner's "white blob";'s colour): halo 0.8 (was 3), limit 1.1
// (was 1.4), hot 0.25 (was 0.45); the water's broad colour REFLECT.bloom 6 (was 12)
export const POST = Object.freeze({ halo: 0.8, bloomGain: 0.6, waterGain: 2.5, limit: 1.1, sat: 1.8, hotFrom: 0.9, hotTo: 2.6, hot: 0.25, levels: 3,
  farFrom: 3500, farTo: 9000, farDark: 0.3, wash: 0.004, washCap: 0.05, washM: 650, nearWash: 0.25, nearCap: 0.45, nearFrom: 60, nearTo: 240, waterY: 0.8, ramp: 30, skyDark: 0.75, landDark: 0.5,
  waterDark: 0.5, waterNavy: 0.6, navy: [0.55, 0.8, 1.6] });   // fix/v2-fireworks-view-clouds: the water's own light in the show's night at every distance

// the bloom's two filters on a fullscreen triangle: down (the level above, five taps) and up (the level below, eight taps of
// a tent, plus this level's own down)
export const BLOOM_WGSL = `diagnostic(off, derivative_uniformity);
@group(0) @binding(0) var tA: texture_2d<f32>;
@group(0) @binding(1) var tB: texture_2d<f32>;
@group(0) @binding(2) var sL: sampler;
struct BV { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> BV {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BV; o.pos = vec4f(p[i], 0.0, 1.0); o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5); return o;
}
fn tap(t: texture_2d<f32>, uv: vec2f) -> vec3f { return textureSampleLevel(t, sL, uv, 0.0).rgb; }
@fragment fn down(v: BV) -> @location(0) vec4f {
  let h = 1.0 / vec2f(textureDimensions(tA));
  let c = tap(tA, v.uv) * 4.0 + tap(tA, v.uv + vec2f(-h.x, -h.y)) + tap(tA, v.uv + vec2f(h.x, -h.y)) + tap(tA, v.uv + vec2f(-h.x, h.y)) + tap(tA, v.uv + h);
  return vec4f(c / 8.0, 1.0);
}
@fragment fn up(v: BV) -> @location(0) vec4f {
  let h = 1.0 / vec2f(textureDimensions(tA));
  var c = (tap(tA, v.uv + vec2f(-2.0 * h.x, 0.0)) + tap(tA, v.uv + vec2f(2.0 * h.x, 0.0)) + tap(tA, v.uv + vec2f(0.0, -2.0 * h.y)) + tap(tA, v.uv + vec2f(0.0, 2.0 * h.y))) / 12.0;
  c += (tap(tA, v.uv + vec2f(-h.x, h.y)) + tap(tA, v.uv + h) + tap(tA, v.uv + vec2f(h.x, -h.y)) + tap(tA, v.uv - h)) / 6.0;
  return vec4f(c + tap(tB, v.uv), 1.0);
}`;

export const POST_WGSL = (fs, msaa, water) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${U_WGSL}
@group(1) @binding(0) var<uniform> U: FWU;
@group(1) @binding(1) var tCol: texture_2d<f32>;
@group(1) @binding(2) var tDepth: ${msaa > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
@group(1) @binding(3) var tHalo: texture_2d<f32>;
@group(1) @binding(4) var sStars: sampler;
@group(1) @binding(5) var tFull: texture_2d<f32>;   // the stars' own full-size target (raw sums, scene radiance)
${water ? `@group(1) @binding(6) var tWSlope: texture_2d_array<f32>;
@group(1) @binding(7) var sSlope: sampler;
@group(1) @binding(8) var tStars: texture_2d<f32>;   // the quarter-size target (the water's sharp streaks)
${WARP_WGSL}
${REFLECT_FN()}` : ''}
struct PV { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> PV {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: PV; o.pos = vec4f(p[i], 0.0, 1.0); o.ndc = p[i]; return o;
}
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
fn depthAt(px: vec2i) -> f32 {
  let d = vec2i(textureDimensions(tDepth));
  return textureLoad(tDepth, clamp(px, vec2i(0), d - vec2i(1)), 0);
}
fn worldAt(px: vec2i, z: f32) -> vec3f {
  let uv = (vec2f(px) + 0.5) * F.res.zw;
  let w = F.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, z, 1.0);
  return w.xyz / w.w;
}
// v1's soft shoulder in screen levels, the same scale on all three channels (the hue holds), then its vivid push
fn knee(c: vec3f, limit: f32) -> vec3f { let m = max(c.r, max(c.g, c.b)); return c / (m / limit + 1.0); }
fn vivid(c: vec3f) -> vec3f { let l = dot(c, LUMA); return max(mix(vec3f(l), c, ${POST.sat.toFixed(2)}), vec3f(0.0)); }
@fragment fn fs(v: PV) -> @location(0) vec4f {
  let px = vec2i(v.pos.xy);
  let g = max(U.look.x, 1e-9);   // 1 / the exposure: screen level → scene radiance
  var col = textureLoad(tCol, px, 0).rgb;
  // a pixel the scene left as NaN (the brightest streaks' edges: a black dot through the tone curve, v1 too) takes its neighbours
  if (any(col != col)) {
    var s = vec3f(0.0); var n = 0.0;
    for (var k = 0; k < 4; k++) { let o = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1))[k];
      let q = textureLoad(tCol, clamp(px + o, vec2i(0), vec2i(textureDimensions(tCol)) - vec2i(1)), 0).rgb;
      if (all(q == q)) { s += q; n += 1.0; } }
    col = s / max(n, 1.0);
  }
  // v1's composite: the star's core white-hot where it is bright, its bloom the coloured halo round it, the sum through the
  // soft shoulder in screen levels (overlapping finale bursts stay coloured), then the vivid push
  let star = textureLoad(tFull, px, 0).rgb / g; let sm = max(star.r, max(star.g, star.b));
  let hot = smoothstep(${POST.hotFrom.toFixed(2)}, ${POST.hotTo.toFixed(2)}, sm) * ${POST.hot.toFixed(2)};
  let halo = textureSampleLevel(tHalo, sStars, (vec2f(px) + 0.5) * F.res.zw, 0.0).rgb * ${(POST.halo * POST.bloomGain / POST.levels).toFixed(4)} / g;
  col += vivid(knee(mix(star, vec3f(sm), hot) + halo, ${POST.limit.toFixed(2)})) * g;
  let lum0 = max(col.r, max(col.g, col.b)) / g;
  let keep = smoothstep(0.5, 1.6, lum0);   // v1's luma rule: the lights, the stars and their halos are not darkened
  let z = depthAt(px);
  // the show's night (v1's darker night): the sky and the land darker while the show is up, so the bursts carry
  if (z <= 0.0) { return vec4f(col * mix(1.0, ${POST.skyDark}, U.misc.w * U.refl.z * (1.0 - keep)), 1.0); }   // the sky (reversed depth: 0 at the far plane)
  let P = worldAt(px, z);
  let Px = worldAt(px + vec2i(1, 0), depthAt(px + vec2i(1, 0)));
  let Py = worldAt(px + vec2i(0, 1), depthAt(px + vec2i(0, 1)));
  let cam = F.cam.xyz;
  let vW = normalize(P - cam);
  let n0 = normalize(cross(Px - P, Py - P));
  let nW = select(-n0, n0, dot(n0, vW) < 0.0);   // toward the camera
  let dist = length(P - cam);
  let lum = max(col.r, max(col.g, col.b)) / g;
  let show = U.refl.z;
  // the far land a silhouette at night (its lights and the stars and halos over it kept)
  let far = smoothstep(${POST.farFrom.toFixed(1)}, ${POST.farTo.toFixed(1)}, dist) * (1.0 - smoothstep(0.5, 1.6, lum)) * U.misc.w * show;
  col *= mix(1.0, ${POST.farDark}, far);
  // the open water (flat, at the lake's level): fix/v2-fireworks-view-clouds (filmed 2026-11-18: the start's shelf, 1-3 m deep, read
  // bright cyan with its boulders' rings round the boat, the land past 240 m at half): the water's own light takes the show's night at
  // every distance (waterDark), its colour pulled toward a night navy of the same lightness (waterNavy), so the bursts' broad, warm
  // reflection carries on a dark lake; the boat (not flat at the water's level), the lights and their columns (keep) untouched
  let wet = abs(P.y) < ${POST.waterY} && n0.y * n0.y > 0.64;
  let land = select(1.0, 0.0, wet);
  let nightK = U.misc.w * show * (1.0 - keep);
  if (wet) {
    let lw = dot(col, vec3f(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3f(${POST.navy.map((x) => x.toFixed(3)).join(', ')}) * lw, ${POST.waterNavy.toFixed(2)} * nightK) * mix(1.0, ${POST.waterDark}, nightK);
  } else {
    col *= mix(1.0, ${POST.landDark}, smoothstep(${POST.nearFrom.toFixed(1)}, ${POST.nearTo.toFixed(1)}, dist) * nightK);
  }
  var wash = vec3f(0.0); var nearL = vec3f(0.0);
  for (var k = 0; k < ${FLASH_SLOTS}; k++) {
    let bp = U.bankPos[k]; let bc = U.bankCol[k];
    let L = bp.xyz - P; let d = length(L);
    let facing = max(dot(nW, L / max(d, 1e-3)), 0.0);
    let fall = 1.0 / ((d / ${POST.washM.toFixed(1)}) * (d / ${POST.washM.toFixed(1)}) + 1.0);
    wash += bc.rgb * bp.w * facing * fall;
    nearL += bc.rgb * (bp.w + bc.w * 0.5) * (facing * 0.6 + 0.4) * fall;
  }
  // the open water (flat, at the lake's level) takes the bursts through its reflection only (v1's composite's water branch)
${water ? '  if (wet) { col += fwReflect(P); }' : ''}
  col += knee(wash * ${POST.wash}, ${POST.washCap}) * g * land;
  let nearK = (1.0 - smoothstep(${POST.nearFrom.toFixed(1)}, ${POST.nearTo.toFixed(1)}, dist)) * clamp(lum * 1.2 + 0.1, 0.1, 1.0);
  col += knee(nearL * ${POST.nearWash} * nearK, ${POST.nearCap}) * g * land;
  return vec4f(col, 1.0);
}`;

// their lamps: soft points of a fixed screen size (v1's sprites, sizeAttenuation off), additive
export const LAMP_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${U_WGSL}
@group(1) @binding(0) var<storage, read> lamps: array<vec4f>;   // two a lamp: pos.xyz px; colour.rgb kind
@group(1) @binding(1) var<uniform> U: FWU;
struct LV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f }
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) ii: u32) -> LV {
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = cs[vid]; let a = lamps[ii * 2u]; let b = lamps[ii * 2u + 1u];
  var clip = F.viewProj * vec4f(a.xyz, 1.0);
  let px = a.w * max(1.0, F.res.y / 720.0);
  clip = vec4f(clip.xy + c * px * 2.0 * F.res.zw * clip.w, clip.z, clip.w);
  let kind = u32(b.w);
  var lv = U.lamp.y;
  if (kind == 0u) { lv = U.lamp.x; }
  if (kind == 4u) { lv = U.lamp.z * step(0.5, fract(U.lamp.w * 1.25 + f32(ii % 2u) * 0.5)); }
  var o: LV; o.pos = clip; o.uv = c; o.col = b.rgb * lv * U.look.x; return o;
}
@fragment fn fs(v: LV) -> @location(0) vec4f {
  let f = clamp(1.0 - length(v.uv), 0.0, 1.0);
  return vec4f(v.col * f * f, 1.0);
}`;

export function createFireworksRender({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa = 1, msaaCounts = null, depthFormat = 'depth32float', state, scale, barges, slopeView = null, errors = [] }) {
  const S = state, N = S.N, H8 = S.history, trails = S.trails;
  const C = GPUShaderStage.COMPUTE, VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const STAR_BYTES = STAR_FLOATS * 4;
  const starBuf = device.createBuffer({ label: 'fw-stars', size: N * STAR_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(starBuf, 0, S.staging);   // every slot dead
  const histBuf = device.createBuffer({ label: 'fw-history', size: trails ? N * H8 * 16 : 16, usage: GPUBufferUsage.STORAGE });
  const clkBuf = device.createBuffer({ label: 'fw-clock', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const uBuf = device.createBuffer({ label: 'fw-uniform', size: (5 + 2 * FLASH_SLOTS) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uData = new Float32Array((5 + 2 * FLASH_SLOTS) * 4);
  const puffBuf = device.createBuffer({ label: 'fw-puffs', size: Math.max(16, S.puffData.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const props = bargeProps(barges);
  const boxData = new Float32Array(props.boxes.length * BOX_FLOATS);   // the props' plan (the patrol boats' records: patrolInto)
  props.boxes.forEach((b, i) => boxData.set(boxRecord(b), i * BOX_FLOATS));
  // the meshes (render/bargeMesh.js: the barge's high and low levels and the patrol boat, one vertex buffer) and their instances:
  // the barges first, then the patrol boats (props.patrols' order), rewritten when a barge's level or a patrol boat moves
  const meshes = buildPropMeshes();
  const meshBuf = device.createBuffer({ label: 'fw-props-mesh', size: meshes.all.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(meshBuf, 0, meshes.all);
  const nBarge = barges.length, nInst = nBarge + props.patrols.length, CONT = [[0.66, 0.196, 0.122], [0.243, 0.361, 0.463]].map((c) => c.map((x) => x ** 2.2));
  const instData = new Float32Array(nInst * PROP_INST), near = new Uint8Array(nBarge).fill(255);
  const instBuf = device.createBuffer({ label: 'fw-props', size: instData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bargeYaw = barges.map((b) => Math.atan2(-b.axis[1], b.axis[0]));
  let nearN = 0, eye = null;
  const writeInst = () => {   // the near barges first (the high mesh's run), then the far ones, then the patrol boats
    let k = 0;
    const put = (x, z, yaw, bob, seed, kind, col) => { instData.set([x, 0, z, yaw, bob, seed, kind, 0, ...col, 0, 0, 0, 0, 0], k * PROP_INST); k++; };
    for (const pass of [1, 0]) barges.forEach((b, i) => { if (near[i] === pass) put(b.x, b.z, bargeYaw[i], 1, (i * 0.37 + 0.11) % 1, 0, CONT[i % 2]); });
    for (const q of props.patrols) put(q.x, q.z, q.yaw, 0, 0.5, 1, [0, 0, 0]);
    device.queue.writeBuffer(instBuf, 0, instData);
  };
  const updateLod = () => {
    let changed = false; nearN = 0;
    barges.forEach((b, i) => { const v = eye && Math.hypot(b.x - eye[0], b.z - eye[2]) < LOD_M ? 1 : 0; if (v !== near[i]) { near[i] = v; changed = true; } nearN += v; });
    if (changed) writeInst();
  };
  const lampData = new Float32Array(props.lamps.length * 8);
  props.lamps.forEach((l, i) => lampData.set([...l.p, l.px, ...l.col, l.kind], i * 8));
  const lampBuf = device.createBuffer({ label: 'fw-lamps', size: lampData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(lampBuf, 0, lampData);
  // the star's index list (v1's geometry(): the ribbon's quads, then the head's)
  const idx = [];
  if (trails) for (let j = 0; j < ribPoints(H8) - 1; j++) { const a = 2 * j; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const s0 = trails ? 2 * ribPoints(H8) : 0;
  idx.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);
  const idxData = new Uint16Array(idx.length + (idx.length % 2));
  idxData.set(idx);
  const idxBuf = device.createBuffer({ label: 'fw-index', size: idxData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(idxBuf, 0, idxData);
  // the reflection's stars: the head and the streak's newest REFLECT.quads quads only (the brightest part of the tail; the
  // older, fainter quads cost the vertex work of the whole show again for little light on the water)
  const idxSrc = [...idx.slice(0, 6 * (trails ? Math.min(REFLECT.quads, ribPoints(H8) - 1) : 0)), ...idx.slice(idx.length - 6)];
  const idxSrcData = new Uint16Array(idxSrc.length + (idxSrc.length % 2)); idxSrcData.set(idxSrc);
  const idxSrcBuf = device.createBuffer({ label: 'fw-index-reflect', size: idxSrcData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(idxSrcBuf, 0, idxSrcData);

  const sb = (b, type, v) => ({ binding: b, visibility: v, buffer: { type } });
  const ub = (b, v) => ({ binding: b, visibility: v, buffer: { type: 'uniform' } });
  const cBGL = device.createBindGroupLayout({ label: 'fw-compute', entries: [sb(0, 'storage', C), sb(1, 'storage', C), sb(2, 'storage', C), ub(3, C)] });
  const cBG = device.createBindGroup({ layout: cBGL, entries: [{ binding: 0, resource: { buffer: starBuf } }, { binding: 1, resource: { buffer: histBuf } }, { binding: 2, resource: { buffer: clkBuf } }, { binding: 3, resource: { buffer: uBuf } }] });
  const dBGL = device.createBindGroupLayout({ label: 'fw-stars', entries: [sb(0, 'read-only-storage', VX), sb(1, 'read-only-storage', VX), sb(2, 'read-only-storage', VX), ub(3, VX | FR)] });
  const dBG = device.createBindGroup({ layout: dBGL, entries: [{ binding: 0, resource: { buffer: starBuf } }, { binding: 1, resource: { buffer: histBuf } }, { binding: 2, resource: { buffer: clkBuf } }, { binding: 3, resource: { buffer: uBuf } }] });
  const pBGL = (label) => device.createBindGroupLayout({ label, entries: [sb(0, 'read-only-storage', VX), ub(1, VX | FR)] });
  const smBGL = pBGL('fw-smoke'), lpBGL = pBGL('fw-lamps'), bxBGL = pBGL('fw-props');
  const smBG = device.createBindGroup({ layout: smBGL, entries: [{ binding: 0, resource: { buffer: puffBuf } }, { binding: 1, resource: { buffer: uBuf } }] });
  const lpBG = device.createBindGroup({ layout: lpBGL, entries: [{ binding: 0, resource: { buffer: lampBuf } }, { binding: 1, resource: { buffer: uBuf } }] });
  const bxBG = device.createBindGroup({ layout: bxBGL, entries: [{ binding: 0, resource: { buffer: instBuf } }, { binding: 1, resource: { buffer: uBuf } }] });
  const gBGL = device.createBindGroupLayout({ label: 'fw-glow', entries: [ub(0, FR)] });
  const gBG = device.createBindGroup({ layout: gBGL, entries: [{ binding: 0, resource: { buffer: uBuf } }] });
  // the reflection (v1's composite's water): the slope cascades and the stars' own half-size target (made at the first
  // frame of a show, remade when the frame's size changes; its bind group with it)
  const wBGL = slopeView ? device.createBindGroupLayout({ label: 'fw-reflect', entries: [ub(0, FR), { binding: 1, visibility: FR, texture: { viewDimension: '2d-array' } }, { binding: 2, visibility: FR, sampler: {} },
    { binding: 3, visibility: FR, texture: {} }, { binding: 4, visibility: FR, sampler: {} }, { binding: 5, visibility: FR, texture: {} }] }) : null;
  const slopeSampler = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
  const starSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  // the stars' quarter-size target (src: the water's reflection reads it in the next frame's scene, the bloom in this frame's
  // post), the bloom's levels (down 1/8, 1/16, 1/32 of the frame; up 1/16, 1/8), the picture's copy (the post reads the
  // colour under it); made at the first frame of a show, remade when the frame's size changes, their bind groups with them
  const src = { tex: null, view: null, bg: null, w: 0, h: 0, on: false, fw: 0, fh: 0, lv: [], copy: null, copyView: null, postBG: null, postKey: null };
  const bloomBGL = device.createBindGroupLayout({ label: 'fw-bloom', entries: [{ binding: 0, visibility: FR, texture: {} }, { binding: 1, visibility: FR, texture: {} }, { binding: 2, visibility: FR, sampler: {} }] });
  const tex = (label, w, h, extra = 0) => device.createTexture({ label, size: [w, h], format: REFLECT.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra });
  const sourceFor = (w, h) => {
    const sw = Math.max(1, Math.round(w * REFLECT.res)), sh = Math.max(1, Math.round(h * REFLECT.res));
    if (src.tex && src.w === sw && src.h === sh && src.fw === w && src.fh === h) return;
    src.tex?.destroy(); for (const l of src.lv) l.tex.destroy(); src.copy?.destroy();
    src.tex = tex('fw-reflect-stars', sw, sh);
    src.view = src.tex.createView(); src.w = sw; src.h = sh; src.fw = w; src.fh = h;
    srcDesc.colorAttachments[0].view = src.view;
    // the bloom's levels: d1 d2 d3 down, u2 u1 up (each with the bind group that draws it)
    const dims = [1, 2, 3].map((k) => [Math.max(1, Math.ceil(sw / 2 ** k)), Math.max(1, Math.ceil(sh / 2 ** k))]);
    const mk = (name, [lw, lh]) => { const t = tex(`fw-bloom-${name}`, lw, lh); return { tex: t, view: t.createView(), w: lw, h: lh, name }; };
    const d1 = mk('d1', dims[0]), d2 = mk('d2', dims[1]), d3 = mk('d3', dims[2]), u2 = mk('u2', dims[1]), u1 = mk('u1', dims[0]);
    const bg = (a, b) => device.createBindGroup({ layout: bloomBGL, entries: [{ binding: 0, resource: a }, { binding: 1, resource: b }, { binding: 2, resource: starSampler }] });
    d1.bg = bg(src.view, src.view); d1.entry = 'down'; d2.bg = bg(d1.view, d1.view); d2.entry = 'down'; d3.bg = bg(d2.view, d2.view); d3.entry = 'down';
    u2.bg = bg(d3.view, d2.view); u2.entry = 'up'; u1.bg = bg(u2.view, d1.view); u1.entry = 'up';
    src.lv = [d1, d2, d3, u2, u1];
    // the water's reflection: the stars' target (the sharp streaks) and the bloom (u1: v1's reflectBloom, the broad colour)
    src.bg = wBGL ? device.createBindGroup({ layout: wBGL, entries: [{ binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: slopeView }, { binding: 2, resource: slopeSampler },
      { binding: 3, resource: src.view }, { binding: 4, resource: starSampler }, { binding: 5, resource: u1.view }] }) : null;
    src.full?.destroy();
    src.full = tex('fw-stars-full', w, h); src.fullView = src.full.createView();
    src.copy = device.createTexture({ label: 'fw-post-copy', size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    src.copyView = src.copy.createView(); src.postBG = null; src.postKey = null;
  };
  // the post's bind group: the uniforms, the copy, the scene's depth (its sample count), the halo (u1)
  const postBGL = new Map((msaaCounts ?? [msaa]).map((n) => [n, device.createBindGroupLayout({ label: `fw-post@${n}x`, entries: [ub(0, FR), { binding: 1, visibility: FR, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: FR, texture: { sampleType: 'depth', multisampled: n > 1 } }, { binding: 3, visibility: FR, texture: {} }, { binding: 4, visibility: FR, sampler: {} }, { binding: 5, visibility: FR, texture: { sampleType: 'unfilterable-float' } },
    ...(slopeView ? [{ binding: 6, visibility: FR, texture: { viewDimension: '2d-array' } }, { binding: 7, visibility: FR, sampler: {} }, { binding: 8, visibility: FR, texture: {} }] : [])] })]));
  const postBGFor = (targets, n) => {
    if (src.postBG && src.postKey === targets.depthView) return src.postBG;
    src.postKey = targets.depthView;
    src.postBG = device.createBindGroup({ layout: postBGL.get(n), entries: [{ binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: src.copyView }, { binding: 2, resource: targets.depthView },
      { binding: 3, resource: src.lv[4].view }, { binding: 4, resource: starSampler }, { binding: 5, resource: src.fullView },
      ...(slopeView ? [{ binding: 6, resource: slopeView }, { binding: 7, resource: slopeSampler }, { binding: 8, resource: src.view }] : [])] });
    src.sdBG = device.createBindGroup({ layout: sdBGL.get(n), entries: [{ binding: 0, resource: targets.depthView }] });
    return src.postBG;
  };
  const srcDesc = { label: 'fw-reflect-stars', colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] };
  const bloomDesc = { label: 'fw-bloom', colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] };
  const fullDesc = { label: 'fw-stars-full', colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] };
  const postDesc = { label: 'fw-post', colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] };   // every pixel written (the copy under it)
  const pl = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
  const mC = reg.shader('fw-step', STEP_WGSL(H8, trails));
  for (const e of ['tick', 'clear', 'step']) reg.add(`fw-${e}`, { layout: pl(cBGL), compute: { module: mC, entryPoint: e === 'step' ? 'stepStars' : e } });
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
  const light = (name, code, layout, depthCompare = 'greater', blend = add) => {
    const m = reg.shader(name, code);
    reg.add(name, { layout, vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare }, multisample: { count: msaa } });
  };
  light('fw-stars', STAR_WGSL(frameStruct, H8, trails), pl(frameBGL, dBGL));
  light('fw-smoke', SMOKE_WGSL(frameStruct, scale), pl(frameBGL, smBGL));
  // the post (v1's composite): the stars' target takes the lit smoke too (v1: the smoke in its fireworks target, bloomed);
  // the bloom's filters; the post's fullscreen pass (one per sample count of the scene's depth)
  const srcPipe = (name, code, layout) => { const m = reg.shader(name, code);
    reg.add(name, { layout, vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: REFLECT.format, blend: add }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, multisample: { count: 1 } }); };
  // the stars' full-size target for the post, one per sample count of the scene's depth
  const sdBGL = new Map((msaaCounts ?? [msaa]).map((n) => [n, device.createBindGroupLayout({ label: `fw-stars-depth@${n}x`, entries: [{ binding: 0, visibility: FR, texture: { sampleType: 'depth', multisampled: n > 1 } }] })]));
  // the same stars and the lit smoke into the quarter-size target (the bloom's and the water's source: v1's 'fireworks' target),
  // one sample, additive, tested against the scene's depth (owner, 2026-11-18: nothing glows through the island)
  for (const [n, bgl] of sdBGL) {
    const sfx = n === msaa ? '' : `@${n}x`, mS = reg.shader(`fw-stars-src${sfx}`, STAR_WGSL(frameStruct, H8, trails, -n)), mK = reg.shader(`fw-smoke-src${sfx}`, SMOKE_WGSL(frameStruct, scale, -n));
    for (const [name, m, g] of [[`fw-stars-src${sfx}`, mS, dBGL], [`fw-smoke-src${sfx}`, mK, smBGL]]) reg.add(name, { layout: pl(frameBGL, g, bgl), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: REFLECT.format, blend: add }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, multisample: { count: 1 }, fixedSamples: true });
  }
  for (const [n, bgl] of sdBGL) srcPipe(n === msaa ? 'fw-stars-post' : `fw-stars-post@${n}x`, STAR_WGSL(frameStruct, H8, trails, n), pl(frameBGL, dBGL, bgl));
  for (const [n, bgl] of sdBGL) srcPipe(n === msaa ? 'fw-smoke-post' : `fw-smoke-post@${n}x`, SMOKE_WGSL(frameStruct, scale, n), pl(frameBGL, smBGL, bgl));
  const mB = reg.shader('fw-bloom', BLOOM_WGSL);
  for (const e of ['down', 'up']) reg.add(`fw-bloom-${e}`, { layout: pl(bloomBGL), vertex: { module: mB, entryPoint: 'vs' }, fragment: { module: mB, entryPoint: e, targets: [{ format: REFLECT.format }] }, primitive: { topology: 'triangle-list' } });
  for (const [n, bgl] of postBGL) { const name = n === msaa ? 'fw-post' : `fw-post@${n}x`, m = reg.shader(name, POST_WGSL(frameStruct, n, !!slopeView));
    reg.add(name, { layout: pl(frameBGL, bgl), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [hdrTarget] }, primitive: { topology: 'triangle-list' } }); }
  if (wBGL) light('fw-reflect', REFLECT_WGSL(frameStruct), pl(frameBGL, wBGL));
  light('fw-glow', GLOW_WGSL(frameStruct), pl(frameBGL, gBGL), 'greater-equal');
  light('fw-lamps', LAMP_WGSL(frameStruct), pl(frameBGL, lpBGL));
  const mP = reg.shader('fw-props', PROP_WGSL(frameStruct));
  reg.add('fw-props', { layout: pl(frameBGL, sky.skyBGL, bxBGL),
    vertex: { module: mP, entryPoint: 'vs', buffers: [{ arrayStride: MESH_VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] }] },
    fragment: { module: mP, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });

  const clk = new Float32Array(4);
  let dispatchN = 0, dt0 = 0, propsOn = false, lampsOn = false, glowOn = false, seeks = 0, postOn = false, clears = 0;
  const upload = () => { for (const [start, n] of S.takeDirty()) device.queue.writeBuffer(starBuf, start * STAR_BYTES, S.staging.buffer, start * STAR_BYTES, n * STAR_BYTES); };
  const slotsNow = () => Math.min(N, S.drawnAt());
  const self = {
    stats: { seeks: 0, clears: 0, dispatched: 0, drawn: 0, puffs: 0, props: false, reflect: false, post: false, glow: false },
    // the parts drawn (profiling: __velia.fireworks.gpu.parts = new Set(['stars']) toggles them on a live page, for an in-page A/B)
    parts: new Set(['stars', 'reflect', 'reflect-streaks', 'smoke', 'glow', 'lamps', 'post', 'bloom']),
    props,
    // L3: the patrol boats where the show's solids put them (src/fireworks/solids.js bodies: a bump shoves a light body off its
    // station; it swings back in ≈ 12 s): rewrites the moved ones' boxes and lamps in place, one writeBuffer each when any moved
    setPatrols(bodies) {
      let moved = false;
      for (const b of bodies) {
        if (b.kind !== 'patrol') continue;
        const p = props.patrols[b.barge * 2 + b.side];
        if (!p) continue;
        const yaw = -b.heading;
        if (Math.abs(b.x - p.x) < 1e-4 && Math.abs(b.z - p.z) < 1e-4 && Math.abs(yaw - p.yaw) < 1e-5) continue;
        p.x = b.x; p.z = b.z; p.yaw = yaw; moved = true;
        patrolInto(boxData, lampData, p, b.x, b.z, yaw);
      }
      if (moved) { writeInst(); device.queue.writeBuffer(lampBuf, 0, lampData); }
      return moved;
    },
    // the compute pipelines serve (a deferred group builds after the first frame: engine/pipelines.js); until then the plug-in
    // keeps the state only (no seek, no step)
    ready: () => !reg.has || (reg.has('fw-clear') && reg.has('fw-tick') && reg.has('fw-step')),
    // a seek (v1's engine.seek): every slot cleared on the GPU, then the last seconds replayed on the fixed step, each
    // shell's stars uploaded before the step that first runs them (a submit between, so a slot the ring reuses is never
    // written before its earlier star has run)
    seek(t, wind) {
      S.setWind(wind);
      const { t0, n } = S.seekPlan(t);
      clk.set([t0, STEP, 0, t0]); device.queue.writeBuffer(clkBuf, 0, clk);
      let enc = device.createCommandEncoder({ label: 'fw-seek' }), pass = enc.beginComputePass({ label: 'fw-seek' });
      pass.setBindGroup(0, cBG);
      pass.setPipeline(reg.get('fw-clear')); pass.dispatchWorkgroups(Math.ceil(N / 64));
      for (let k = 0; k < n; k++) {
        if (S.spawnDue(S.t + STEP + LOOKAHEAD) > 0) {
          pass.end(); device.queue.submit([enc.finish()]); upload();
          enc = device.createCommandEncoder({ label: 'fw-seek' }); pass = enc.beginComputePass({ label: 'fw-seek' }); pass.setBindGroup(0, cBG);
        }
        S.advance(STEP);
        const m = slotsNow();
        pass.setPipeline(reg.get('fw-tick')); pass.dispatchWorkgroups(1);
        if (m > 0) { pass.setPipeline(reg.get('fw-step')); pass.dispatchWorkgroups(Math.ceil(m / 64)); }
      }
      pass.end(); device.queue.submit([enc.finish()]);
      S.setTime(t); clk.set([t, 0, 0, t]); device.queue.writeBuffer(clkBuf, 0, clk);
      dispatchN = 0; seeks++; self.stats.seeks = seeks;
      S.after(t);
    },
    // leaving the show (a time pick, skipping time, a race, a cut out of its window; fix 2026-11-18, owner: "the last
    // fireworks are left in the sky"): every slot cleared on the GPU, the state emptied (stars, flashes, smoke), nothing
    // dispatched, drawn or posted until the show is up again; t: the show clock to hold (null: keep the state's)
    clear(t = null) {
      S.reset(t);
      if (self.ready()) {   // (not built yet: nothing was dispatched or drawn, and the next seek clears the slots)
        const enc = device.createCommandEncoder({ label: 'fw-clear' }), pass = enc.beginComputePass({ label: 'fw-clear' });
        pass.setBindGroup(0, cBG); pass.setPipeline(reg.get('fw-clear')); pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end();
        device.queue.submit([enc.finish()]);
      }
      clk.set([S.t, 0, 0, S.t]); device.queue.writeBuffer(clkBuf, 0, clk);
      dispatchN = 0; dt0 = 0; postOn = false; glowOn = false; src.on = false;
      clears++;
      Object.assign(self.stats, { dispatched: 0, drawn: 0, puffs: 0, reflect: false, post: false, glow: false, clears });
    },
    // a frame (before the graph): dt show s to step (0: frozen); fixed: v1's capture step (whole 1/60 s steps); o: the
    // frame's look (gain = 1 / the exposure factor, rad per px), the night, the lamps' levels, the sim time, the props on
    frame(dt, o) {
      if (o.eye) { eye = o.eye; if (o.props) updateLod(); }   // the barges' level of detail (the high mesh within LOD_M)
      S.setWind(o.wind);
      dispatchN = 0; dt0 = 0;
      if (o.fixedSteps > 0) {
        // a capture's step: v1's fw.step (whole fixed steps); several in one frame each need their own dispatch, so the
        // frame runs the first here and any more in their own submits (a capture's frames only)
        for (let k = 0; k < o.fixedSteps; k++) {
          S.spawnDue(S.t + STEP + LOOKAHEAD); upload(); S.advance(STEP);
          clk.set([S.t, STEP, 0, S.t]); device.queue.writeBuffer(clkBuf, 0, clk);
          const m = slotsNow();
          if (k < o.fixedSteps - 1) { if (m > 0) { const enc = device.createCommandEncoder(); const p = enc.beginComputePass(); p.setBindGroup(0, cBG); p.setPipeline(reg.get('fw-step')); p.dispatchWorkgroups(Math.ceil(m / 64)); p.end(); device.queue.submit([enc.finish()]); } }
          else { dispatchN = m; dt0 = STEP; }
        }
      } else if (dt > 0) {
        S.spawnDue(S.t + dt + LOOKAHEAD); upload(); S.advance(dt);
        clk.set([S.t, dt, 0, S.t]); device.queue.writeBuffer(clkBuf, 0, clk);
        dispatchN = slotsNow(); dt0 = dt;
      }
      if (!dt0) { clk.set([S.t, 0, 0, S.t]); device.queue.writeBuffer(clkBuf, 0, clk); }
      S.after(S.t);
      o.occlude?.(S.flash);   // the bursts' light behind the land weighed down (sim/fireworksOcclude.js)
      const drawn = S.drawn;
      uData.set([o.wind[0] * scale, (o.wind[1] ?? 0) * scale, o.wind[2] * scale, 9.81 * scale], 0);
      uData.set([o.gain, o.pixRad, LOOK.head, LOOK.trail], 4);
      uData.set([drawn, scale, 0, o.night], 8);
      uData.set([o.lamps.work, o.lamps.nav, o.lamps.blue, o.simT], 12);
      // the post: from a minute before the show to a minute after it, at night (the land's night look eased over POST.ramp s)
      const ramp = o.showT == null ? 0 : showRamp(o.showT);   // the page's show clock (null outside the show: the state's own t stays at its last value)
      postOn = self.parts.has('post') && o.night > 0 && ramp > 0;
      uData.set([o.showDist ?? 750, S.t, ramp, 0], 16);   // refl.z: the post's ramp
      uData.set(S.flash.pos, 20); uData.set(S.flash.col, 20 + FLASH_SLOTS * 4);
      device.queue.writeBuffer(uBuf, 0, uData);
      if (S.puffCount) device.queue.writeBuffer(puffBuf, 0, S.puffData, 0, S.puffCount * PUFF_FLOATS);
      propsOn = !!o.props; lampsOn = propsOn && (o.lamps.work + o.lamps.nav + o.lamps.blue) > 0;
      glowOn = S.flash.sum[0] + S.flash.sum[1] + S.flash.sum[2] > 1e-4;
      if (!postOn) src.on = false;
      Object.assign(self.stats, { dispatched: dispatchN, drawn, puffs: S.puffCount, props: propsOn, post: postOn, glow: glowOn });
    },
    run(pass, c) {
      if (!dispatchN) return;
      pass.setBindGroup(0, cBG); pass.setPipeline(reg.get('fw-step')); pass.dispatchWorkgroups(Math.ceil(dispatchN / 64)); c.dispatches++;
    },
    // the scene pass keeps its depth for the post (main.js depthStore)
    wantsDepth: () => postOn,
    // an own pass after the scene (main.js 'fw-post'), while the show is in the air at night: the stars and the lit smoke
    // into their quarter-size target (the water's reflection reads it in the next frame's scene), the bloom's five
    // passes, then v1's composite over the picture (the halo, the far land's silhouette, the bursts' wash on the land and
    // the boat); false: no show, no pass
    encodePost(enc, c, ts, frameBG, offsets, targets, n) {
      if (!postOn) { src.on = false; return false; }
      sourceFor(targets.w, targets.h);
      const drawn = self.parts.has('stars') ? S.drawn : 0, puffs = self.parts.has('smoke') ? S.puffCount : 0;
      // the frame's timer: the pass's start on the first render pass, its end on the last (none on the passes between)
      const stamp = (d, first, last) => { if (ts && (first || last)) d.timestampWrites = { querySet: ts.querySet, ...(first ? { beginningOfPassWriteIndex: ts.beginningOfPassWriteIndex } : {}), ...(last ? { endOfPassWriteIndex: ts.endOfPassWriteIndex } : {}) }; else delete d.timestampWrites; return d; };
      const postBG = postBGFor(targets, n), sfx = n === msaa ? '' : `@${n}x`;   // src.sdBG: the scene's depth (the quarter-size stars are tested against it)
      let pass = enc.beginRenderPass(stamp(srcDesc, true, false));
      pass.setBindGroup(0, frameBG, offsets); pass.setBindGroup(2, src.sdBG);
      if (drawn > 0) {
        pass.setBindGroup(1, dBG); pass.setPipeline(reg.get(`fw-stars-src${sfx}`)); pass.setIndexBuffer(idxSrcBuf, 'uint16');
        if (self.parts.has('reflect-streaks')) { pass.drawIndexed(idxSrc.length, drawn); c.triangles += (idxSrc.length / 3) * drawn; }
        else { pass.drawIndexed(6, drawn, idxSrc.length - 6, 0, 0); c.triangles += 2 * drawn; }   // the heads only (an A/B)
        c.calls++;
      }
      if (puffs > 0) { pass.setBindGroup(1, smBG); pass.setPipeline(reg.get(`fw-smoke-src${sfx}`)); pass.draw(6, puffs); c.calls++; c.triangles += 2 * puffs; }
      pass.end();
      src.on = wBGL != null && self.parts.has('reflect') && (drawn > 0 || glowOn); self.stats.reflect = src.on;
      const bloom = self.parts.has('bloom');
      if (bloom) for (const l of src.lv) {
        bloomDesc.colorAttachments[0].view = l.view;
        pass = enc.beginRenderPass(stamp(bloomDesc, false, false));
        pass.setBindGroup(0, l.bg); pass.setPipeline(reg.get(`fw-bloom-${l.entry}`)); pass.draw(3); pass.end(); c.calls++;
      }
      else { bloomDesc.colorAttachments[0].view = src.lv[4].view; enc.beginRenderPass(stamp(bloomDesc, false, false)).end(); }   // an A/B without the halo: u1 cleared
      // the stars at full size into their own target, behind what the scene drew in front of them (its depth)
      fullDesc.colorAttachments[0].view = src.fullView;
      pass = enc.beginRenderPass(stamp(fullDesc, false, false));
      if (drawn > 0) {
        pass.setBindGroup(0, frameBG, offsets); pass.setBindGroup(1, dBG); pass.setBindGroup(2, src.sdBG);
        pass.setPipeline(reg.get(n === msaa ? 'fw-stars-post' : `fw-stars-post@${n}x`)); pass.setIndexBuffer(idxBuf, 'uint16');
        pass.drawIndexed(idx.length, drawn); c.calls++; c.triangles += (idx.length / 3) * drawn;
      }
      if (puffs > 0) {
        pass.setBindGroup(0, frameBG, offsets); pass.setBindGroup(1, smBG); pass.setBindGroup(2, src.sdBG);
        pass.setPipeline(reg.get(n === msaa ? 'fw-smoke-post' : `fw-smoke-post@${n}x`)); pass.draw(6, puffs); c.calls++; c.triangles += 2 * puffs;
      }
      pass.end();
      // the picture under the post (its colour: v1's luma rules), then the post over it
      const pic = targets.resolve ?? targets.hdr;
      enc.copyTextureToTexture({ texture: pic }, { texture: src.copy }, [targets.w, targets.h]);
      postDesc.colorAttachments[0].view = targets.resolveView;
      pass = enc.beginRenderPass(stamp(postDesc, false, true));
      pass.setBindGroup(0, frameBG, offsets); pass.setBindGroup(1, postBG);
      pass.setPipeline(reg.get(n === msaa ? 'fw-post' : `fw-post@${n}x`)); pass.draw(3); pass.end(); c.calls++; c.triangles += 1;
      self.stats.post = true;
      return true;
    },
    drawSolid(pass, c) {
      if (!propsOn) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bxBG);
      pass.setPipeline(reg.get('fw-props')); pass.setVertexBuffer(0, meshBuf);
      const R = meshes.runs, draw = (r, n, first) => { if (n > 0) { pass.draw(r.count, n, r.first, first); c.calls++; c.triangles += (r.count / 3) * n; } };
      draw(R.bargeHigh, nearN, 0); draw(R.bargeLow, nBarge - nearN, nearN); draw(R.patrol, props.patrols.length, nBarge);
    },
    drawLight(pass, c) {
      const P = self.parts, drawn = P.has('stars') ? S.drawn : 0;
      // with the post on, the smoke goes to its target with the stars (encodePost)
      if (S.puffCount > 0 && P.has('smoke') && !postOn) { pass.setBindGroup(1, smBG); pass.setPipeline(reg.get('fw-smoke')); pass.draw(6, S.puffCount); c.calls++; c.triangles += 2 * S.puffCount; }
      if (src.on && P.has('reflect') && !postOn) {   // with the post on, the water's reflection is its own (by the scene's depth)
        pass.setBindGroup(1, src.bg); pass.setPipeline(reg.get('fw-reflect')); pass.draw(6); c.calls++; c.triangles += 2; }
      if (drawn > 0 && !postOn) {   // with the post on, the stars go to its own target (encodePost)
        pass.setBindGroup(1, dBG); pass.setPipeline(reg.get('fw-stars')); pass.setIndexBuffer(idxBuf, 'uint16');
        pass.drawIndexed(idx.length, drawn); c.calls++; c.triangles += (idx.length / 3) * drawn;
      }
      if (glowOn && P.has('glow')) { pass.setBindGroup(1, gBG); pass.setPipeline(reg.get('fw-glow')); pass.draw(3); c.calls++; c.triangles += 1; }
      if (lampsOn && P.has('lamps')) { pass.setBindGroup(1, lpBG); pass.setPipeline(reg.get('fw-lamps')); pass.draw(6, props.lamps.length); c.calls++; c.triangles += 2 * props.lamps.length; }
    },
  };
  return self;
}
