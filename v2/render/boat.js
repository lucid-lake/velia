// The sloop on the GPU (M3): the hull and deck, mast and boom (vertex-coloured solids lit by the M1 sun and sky, with
// the aerial perspective), the two sails (cream Dacron: the sun through the cloth from behind, crosscut seams, tapes,
// corner patches and batten pockets, the luff flutter on the GPU, as v1's sails.js), and the lines and wires as
// screen-space ribbons at least a pixel wide, faded by their coverage (v1's lines.js; the MSAA target smooths the rest).
// The boat's own sun shadow: a 2048² depth map round the hull, the frame's first pass, read by the solids and the cloth
// (4-tap PCF). The boat draws into the scene pass between the terrain and the water, opaque with the depth on, so the
// water's blend over its waterline hides the hull below it exactly as v1's render order does.
//   const boat = createBoat({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa, depthFormat, dims });
//   each frame: boat.update(pose, { t, focalPx, sun })  → the model matrices, the sails' shape (when the trim moved), the lines
//   graph: boat.shadow(enc, c, ts) as the first pass; boat.draw(pass, c) in the scene after the terrain
// M4: the compass card and the pedestal pod (render/boatInstruments.js) ride three more slots, drawn after v1's models.
import { wgslStruct } from '../engine/uniforms.js';
import { mat4, multiply, invert } from '../engine/math.js';
import { ATMO_WGSL, SKY_READ, AP_READ, LAND_SKY } from './sky.js';
import { WATER_WGSL } from './terrain.js';
import { UNDERWATER_WGSL } from './underwater.js';
import { UNDER_WGSL } from './underMedium.js';   // play as Tessie, phase 2a
import { underPipe } from './underState.js';
import { WATERLINE_WGSL, PATCH_FLOATS, fillPatch } from './boat/waterline.js';
import { drawnPose, drawnSail } from './boat/drawnTrim.js';
import { buildHull, buildFoils, buildRigParts, carbonSpars, sailGrid, fillSail, mainPoint, jibPoint, sailParams, SAIL_GRIDS, lineSet, ribbonArrays, fillRibbons, wireLines, travellerCarX } from './boat/mesh.js';
import { createBoatModels } from './boatModels.js';
import { createBoatDetails, TELL } from './boat/telltales.js';
const TELL_SEGS = TELL.segs;   // a yarn's segments: its index count is segs × 6
import { createBoatInstruments } from './boatInstruments.js';
import { cardLocal, podLocal } from './boat/instruments.js';
import { vhfLocal } from './boatInstruments.js';
import { hexLinear } from './boat/models.js';
import { canvasHex } from '../../src/sim/boat/canvasHex.js';
import { SHADOW_OFF_Y } from './shadow.js';   // the terrain shadow's cut: the boat's own map keeps the same (the day clock)
import { RIG } from '../../src/boat/rig.js';
import { navLevel, NAV_MODES } from '../../src/boat/details.js';
import { trackY } from '../../src/boat/cockpitPoints.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import { sailArtAtlas, sailArtOn, boatArt, packArt, SAIL_ART_WGSL } from './sailArt.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { gkDesc, gennakerPoint, GK_GRID, GK_DRAW } from './boat/gennaker.js';   //: the gennaker's cloth (kind 2), drawn only while it is up

// fix(v2) frame look: the boat's sky light under the storm's full dark (fitted at the follow camera, 147 s, against v1's sail)
export const STORM_BOAT_SKY = 5;   // the v1 grade (2026-11-18): 3 left the sail a dark grey in the rain where v1's reads light grey
export const SHADOW = Object.freeze({ size: 2048, half: 10.5, depth: 60, bias: 0.0012 });   // the light box: ±half m round the boat, depth m along the sun
// fix(v2) boat night light: the boat's own navigation lights light her locally (owner, 2026-11-18: "physically plausible, not a
// glow"): COLREGs' sectors from v1's lenses (src/boat/details.js, the same points as render/night.js's glows): the bow's red to
// port and green to starboard from dead ahead to 22.5° abaft the beam, the stern's white over the 135° astern, the anchor light
// all round at the truck (at anchor it replaces the others). k: the irradiance 1 m from a lens (HDR × m², ≈ 5 × the boat's
// moonless night light on a side face: the pulpit and the stern rail catch it, the topsides 2 m off a little), reach: m where it has gone
// (an inverse square to there, eased to 0 over its last 40 %); edge: the sectors' soft cut (deg)
export const NAV_LIGHT = Object.freeze({ k: 0.12, reach: 6, edge: 4, soft: 0.2 });
export const SHADOW_U_FLOATS = 20 + 16;   // the Shadow record: vp, dir, nav[4]
const NAV_ROWS = Object.freeze([['bow', 0], ['stern', 4], ['anchor', 8]]);
// writes the lenses into the Shadow record's nav rows: world points by the hull's matrix M (column-major), each lit row's level
// (v1's navLevel: sunset to sunrise), the hull's forward flattened in row 3
export function navLightsInto(u, M, sunElevDeg, anchored, H, mast) {
  const lv = navLevel(sunElevDeg), lit = NAV_MODES[anchored ? 'anchor' : 'sailing'];
  const pts = { bow: [H.navBow[0], H.navBow[1], H.navBow[2] - 0.05], stern: [H.navStern[0], H.navStern[1], H.navStern[2] + 0.05], anchor: mast };
  for (const [k, o] of NAV_ROWS) {
    const p = pts[k], i = 20 + o;
    u[i] = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12]; u[i + 1] = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13]; u[i + 2] = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14];
    u[i + 3] = lit.includes(k) ? lv : 0;
  }
  const fx = -M[8], fz = -M[10], fl = Math.hypot(fx, fz) || 1;   // the hull frame's z runs aft
  u[32] = fx / fl; u[33] = 0; u[34] = fz / fl; u[35] = 0;
  return u;
}
export const CLOTH = Object.freeze({ color: [0.8632, 0.7913, 0.6445], albedo: 0.80, roughness: 0.72, transmit: 0.22, panelM: { main: 1.05, jib: 0.95 }, flutter: 0.06, camberShade: 0.6 });   // #EFE6D2 linear (v1's sails.js CLOTH)
// the cloth's sky light on screen as v1's (AgX lifts and desaturates the shade side; measured, renders/m3b sail samples).
// #37: the lift is a shade side's; where the sun shines through the cloth from behind (back, 0–1) the panel is bright
// already and v1 shows it warm, by the sun through it: the lift fades to k × (1 − back.w × back^back.p) (measured on
// v1's 18:45 follow and 21 kn frames, sail-mask medians; noon's sunlit side has back 0 and keeps its match). It needs a
// sun to shine through: it fades in over the sun's height 0 → sunY (sin of its elevation; 8.6°), so the night's sail
// (the sky's light only) keeps its lift
export const CLOTH_AMB = Object.freeze({ k: 2.3, d: 0.45, back: Object.freeze({ w: 0.95, p: 1.25, sunY: 0.15 }) });
//: the gennaker's nylon, linear: navy #26386B, brass #C9A45A (the compass rose's gold); the head is the sails' cream
export const GK_CLOTH = Object.freeze({ navy: [0.0194, 0.0395, 0.147], brass: [0.584, 0.371, 0.102] });
const CLOTH_UV = Object.freeze({ leech: 0.16, foot: 0.12 });   // v1's furling jib's UV strip widths (m)
const UV_STRIP = hexLinear(canvasHex(0.78));                    // v1: the boat's canvas a shade darker (sun-side acrylic)
// M3b: glb (v1's models, the hull frame, dissolving in at the swap), wheel (the profile's socket, turned 4 x the rudder),
// trav (the traveller car on its track), rudder (about its stock), keel (stays when the M3 hull leaves); M4: inst (the
// HULL frame for the lubber line), card (the compass card, turned by the heading), pod (the wind-and-speed pod, tilted)
const SLOT = Object.freeze({ hull: 0, rig: 1, boom: 2, main: 3, jib: 4, glb: 5, wheel: 6, trav: 7, rudder: 8, keel: 9, inst: 10, card: 11, pod: 12, anchor: 13, vhf: 14, gk: 15, rivals: 16, N: 56 });   // gk: the gennaker (the rivals' slots one on)   // #8: anchor (hardware.glb's plough, lowered as the chain runs out); #35: vhf (v1's VHF set, tilted 22° toward the helm)
// R4 (Regatta's fleet): the near rivals at full detail, each with its own records after the player's (RIVAL_SLOT offsets from
// SLOT.rivals + i × RIVAL_SLOT.n): the M3 hull, the keel, the rudder, the rig, the boom, v1's models, the main, the jib
// 2026-11-18 (the race fixes): five, every rival of the six-boat cap, so a pack near the eye is all full detail (was 2: the third close
// boat drew the lite model and a pass swapped models in view). Each slot is bound to a boat (pose.key) while she stays near: her sails
// and colour never move to another slot's boat
export const MAX_NEAR_RIVALS = 5;
export const MIRROR_M = 450;   // m: a near rival's mirror in the water drawn within this of the eye (the player's always)
export const RIVAL_SLOT = Object.freeze({ hull: 0, keel: 1, rudder: 2, rig: 3, boom: 4, glb: 5, main: 6, jib: 7, n: 8 });
// a rival's topsides colour for Model p.w: 1 + the sRGB bytes packed (0 = no tint; exact in an f32 up to 1 + 0xffffff = 2^24)
export const packTint = (hex) => { const h = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : (hex ?? -1); return h >= 0 ? 1 + (h & 0xffffff) : 0; };
// the WGSL that turns p.w back into a linear colour and the topsides' mask (side-facing, above the scum line, below the hull-deck joint;
// yl the hull frame's height, ny the normal's up)
const TINT_FN = `
fn tintOf(pw: f32) -> vec3f { let u = u32(pw - 1.0 + 0.5); let c = vec3f(f32((u >> 16u) & 255u), f32((u >> 8u) & 255u), f32(u & 255u)) / 255.0; return pow(c, vec3f(2.2)); }
fn topsides(yl: f32, ny: f32) -> f32 { return (1.0 - smoothstep(0.45, 0.7, abs(ny))) * smoothstep(0.112, 0.124, yl) * (1.0 - smoothstep(0.88, 0.92, yl)); }`;   // the race livery: from the boot top (boatModels.js LIV_BOOT1) to just under the sheer (the M3 hull has no sheer datum: its trunk starts over 0.93)
// the player's hull colour (the race livery, 2026-11-25): the brand navy a shade lighter, so the gloss reads navy in the sun, not
// black; packed as a rival's tint (packTint) on her hull and model slots. pose.hullTint (a packed tint) overrides it; 0 is the white gelcoat
export const PLAYER_HULL = '#1E2A4D';
// the quantised trim a near rival's sails refill on (boom and clew 0.02 rad, fill and draft 0.1): CPU refills only when it moves
export function rivalSailKey(p) {   // a number, so a frame's comparison allocates nothing
  const q = (v, d, k) => Math.round((v ?? d) / k) + 512;
  return ((((((q(p.boomAngle, 0, 0.02) * 1024 + q(p.jibAngle, 0, 0.02)) * 32 + q(p.mainFill, 1, 0.1)) * 32 + q(p.jibFill, 1, 0.1)) * 32 + q(p.mainDraft, 1, 0.1)) * 32 + q(p.jibDraft, 1, 0.1)) * 2) + (p.jibBacked ? 1 : 0);
}
const DPOSE = {};   // the drawn pose, reused each frame (boat/drawnTrim.js)
const CREWF = { M: null, heel: 0, pitch: 0, boom: 0, rudder: 0, heave: 0, u: 0, yawRate: 0 };   // the crew's frame (crewFrame), reused
export const SWAP_S = 0.5;   // the dissolve from the M3 hull to v1's models (s, live pages only; a capture starts with the models)
const STRIDE = 256;   // one Model record a slot (all 256 B used: m, n, p, q, r, w[5])
export const MODEL_BYTES = 256;   // the Model struct's size (m, n, p, q, r, w[5]): every layout that binds it says so

// --- the WGSL ---
const MODEL = `struct Model { m: mat4x4f, n: mat4x4f, p: vec4f, q: vec4f, r: vec4f, w: array<vec4f, 5> }
struct Shadow { vp: mat4x4f, dir: vec4f, nav: array<vec4f, 4> }   // nav: the lenses (world xyz, level: bow, stern, anchor) and the hull's forward (xyz)
@group(2) @binding(0) var<uniform> M: Model;
@group(2) @binding(1) var tShadow: texture_depth_2d;
@group(2) @binding(2) var sShadow: sampler_comparison;
@group(2) @binding(3) var<uniform> SH: Shadow;`;
// p: (focalPx, time, luffLow, luffTop)  q: (hoist, chordFoot, kind, 0)  r (the main's print, ?sailart only): (boat + 1 (0: none), cloth, ink A, ink B)
// w: the water under the boat (render/boat/waterline.js; w[4].w 0: none)
// one record carries both (merge/v2-keel-on-sails): q, then r (floats 40-43), then w (44-63): 256 B, all of STRIDE; every layout binds MODEL_BYTES
const MODEL_ART = MODEL;   // design/v2-sail-graphics: the cloth's shader reads r (every record has it now)

// fix(v2) boat night light (owner, 2026-11-18: "the boat itself can't be this bright"): the boat is lit by the world's own
// night light, never a lift of its own. BOAT_LIGHT.nightDeg is the land's fade (render/sky.js LAND_SKY.nightDeg, landSky):
// over it the day's extra sky terms go (the horizon band on a side face, the cloth's v1 lift) and the night is the level
// sky by the tilt plus v1's NIGHT_LAND (nightLand(), the light the terrain, the forest and the lake's body take). The moon's
// share of that light (its lift, NIGHT.moonSky × its share) comes from the moon's direction: soft (moon.wrap of it reaches
// every face), cool (NIGHT_LAND's colour), the moonlit side brighter. The reflections mirror the sky as the water does
// (skyRadianceMirror: identical by day; by night the airglow at NIGHT.airMirror, not the whole glow the world is lit by).
export const BOAT_LIGHT = Object.freeze({ nightDeg: LAND_SKY.nightDeg, night: 0.5, moon: Object.freeze({ wrap: 0.35, dir: 1.3 }) });
const dayY = (deg) => Math.sin(deg * Math.PI / 180).toFixed(5);
// the diffuse light a surface with normal n gets from the sky and the lake: the level ground's sky irradiance scaled by
// the hemisphere it sees, plus, for a surface facing sideways, the sky's own radiance in its direction over half its
// hemisphere (the horizon band is brighter than the zenith: a sail edge-on to the sun still reads cream, as v1's), and
// the lake's upwelling under it. Shared by the boat, the cockpit, the gear and the kayaks (render/kayaks.js)
export const BOAT_LIGHT_WGSL = `
const STORM_BOAT_SKY = ${STORM_BOAT_SKY.toFixed(2)};
// 1 by day, 0 by night: the land's own fade (render/sky.js landSky)
fn boatDay() -> f32 { return smoothstep(${dayY(BOAT_LIGHT.nightDeg[0])}, ${dayY(BOAT_LIGHT.nightDeg[1])}, normalize(F.sun.xyz).y); }
// the world's night light on a face of normal n (0 by day): NIGHT_LAND by the tilt, its moonlit share from the moon
fn nightLightAt(n: vec3f) -> vec3f {
  let ms = moonShare(); let m = MOON_SKY * ms / (1.0 + MOON_SKY * ms);
  let tilt = 0.5 + 0.5 * clamp(n.y, -1.0, 1.0);
  let moonLit = ${BOAT_LIGHT.moon.wrap.toFixed(2)} * tilt + ${BOAT_LIGHT.moon.dir.toFixed(2)} * max(dot(n, normalize(F.moon.xyz)), 0.0);
  return nightLand() * (${BOAT_LIGHT.night.toFixed(3)} * mix(tilt, moonLit, m));
}
fn ambientAt(n: vec3f) -> vec3f {
  let up = clamp(n.y, -1.0, 1.0);
  let side = 1.0 - abs(up);
  let dir = normalize(vec3f(n.x, max(n.y, 0.06), n.z));
  let sky = LIGHT.sky.rgb * (0.5 + 0.5 * up) + skyRadiance(dir) * PI * 0.5 * side * boatDay();   // the night's horizon band goes as the land's
  let lake = (LIGHT.sky.rgb + LIGHT.sun.rgb) * 0.04 * (0.5 - 0.5 * up);
  // fix(v2) frame look, the storm: under the cell the sun is shaded (F.storm.y, down to 0.08) and the overcast deck scatters
  // its light down as sky light (the storm water's own reasoning: render/water.js STORM_WATER); the boat lacked it and read
  // dark grey where v1's sail and hull stay a light grey in the rain. × STORM_BOAT_SKY at the storm's full dark
  let amb = max(sky, vec3f(0.0)) + lake;   // the overcast's light is grey (the storm's steel, render/shaders.js stormGrade): its share neutral
  return amb + vec3f(0.86, 0.92, 1.0) * dot(amb, vec3f(0.2126, 0.7152, 0.0722)) * ((STORM_BOAT_SKY - 1.0) * F.storm.x * F.storm.z) + nightLightAt(n);
}
// the sky a glossy face mirrors: the water's (render/sky.js skyRadianceMirror)
fn skyMirror(d: vec3f) -> vec3f { return skyRadianceMirror(d); }`;

const LIGHT_FN = `
// the sun's irradiance across its rays at the camera's altitude (zero below the horizon), the sky's on level ground
fn sunPerp() -> vec3f { let rC = Rg + F.sky.z; let s = normalize(F.sun.xyz); return F.sky.x * transAt(rC, s.y) * step(0.0, raySphere(vec3f(0.0, rC, 0.0), s, Rg) * -1.0) * F.storm.y; }   // M5e: × the storm cell's shade at the eye
fn shadowAt(p: vec3f, nl: f32) -> f32 {
  let lp = SH.vp * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z < 0.0 || lp.z > 1.0) { return 1.0; }
  let bias = ${SHADOW.bias} * (1.0 + 2.0 * (1.0 - nl));
  let d = 1.0 / f32(textureDimensions(tShadow).x);   // perf(v2) phone: the map's own size (2048², 1024² at L2 and L3)
  var s = 0.0;
  s += textureSampleCompare(tShadow, sShadow, uv + vec2f(-0.5, -0.5) * d, lp.z - bias);
  s += textureSampleCompare(tShadow, sShadow, uv + vec2f(0.5, -0.5) * d, lp.z - bias);
  s += textureSampleCompare(tShadow, sShadow, uv + vec2f(-0.5, 0.5) * d, lp.z - bias);
  s += textureSampleCompare(tShadow, sShadow, uv + vec2f(0.5, 0.5) * d, lp.z - bias);
  return s * 0.25;
}
// fix(v2) boat night light: the boat's own navigation lights on her (NAV_LIGHT): each lit lens (SH.nav, level in w) an inverse
// square to NAV_LIGHT.reach, in its COLREGs sector in the hull's frame (the bow's red to port, green to starboard; the stern's
// white astern; the anchor light all round); 0 by day (their level) and on every boat but the player's within the reach
const NAV_K = ${NAV_LIGHT.k.toFixed(4)}; const NAV_REACH = ${NAV_LIGHT.reach.toFixed(2)}; const NAV_EDGE = ${(NAV_LIGHT.edge / 2).toFixed(2)}; const NAV_SOFT2 = ${(NAV_LIGHT.soft * NAV_LIGHT.soft).toFixed(4)};
fn navCut(x: f32) -> f32 { return smoothstep(-NAV_EDGE, NAV_EDGE, x); }
fn navLightAt(p: vec3f, n: vec3f) -> vec3f {
  let f = SH.nav[3].xyz; let st = vec3f(-f.z, 0.0, f.x);
  var e = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let L = SH.nav[i];
    if (L.w <= 0.0) { continue; }
    let d = p - L.xyz; let r2 = dot(d, d); let r = sqrt(r2);
    if (r > NAV_REACH || r < 1e-4) { continue; }
    let fall = L.w * NAV_K / (r2 + NAV_SOFT2) * (1.0 - smoothstep(0.6 * NAV_REACH, NAV_REACH, r)) * max(dot(n, -d / r), 0.0);
    let b = degrees(atan2(dot(d, st), dot(d, f)));   // the bearing from the bow, + to starboard
    var c = vec3f(1.0, 0.95, 0.85);
    if (i == 0) { c = vec3f(1.0, 0.22, 0.16) * navCut(-b) * navCut(112.5 + b) + vec3f(0.2, 1.0, 0.45) * navCut(b) * navCut(112.5 - b); }
    else if (i == 1) { c = c * navCut(abs(b) - 112.5); }
    e += c * fall;
  }
  return e;
}
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
// Under the water (fix/v2-keel-visible, 2026-11-18: the keel unseen in a knockdown; a dark fin through clear water is right as
// long as the physics holds, each water clarity its own). Below the drawn
// surface at its own world point (the boat's water patch, render/boat/waterline.js; not the hull frame's y < 0, which kept a
// raised keel hidden) a part is seen through the water as Tessie and the bed are (render/underwater.js): drawn where the
// refracted eye ray finds it (farther along the ray, so the surface is in front and its Fresnel blend covers it), lit by the
// light left at its depth (K down the refracted sun; the sky's light from above, Snell's window), and its image lost into the
// water's own body along the path up at K plus the image's scatter and the weather's (wind, rain, storm). A fin under clear
// shallow water reads as a softened dark shape; deeper, murkier, at night or in the storm it fades into the lake. Over the
// surface: drawn as before; a 10 cm blend under the waterline. The deck, the cockpit and the rig never take the water.
${UNDERWATER_WGSL}
${WATERLINE_WGSL}
// where a point under the water is drawn, and its surface crossing (uwApparent about the local water's height)
fn uwPlace(wp: vec3f, yl: f32) -> UwP {
  var o: UwP; o.p = wp; o.air = wp;
  if (!wpOn()) { return o; }
  let h = waterAt(wp.xz); let d = (h - wp.y) * wpGate(yl); let H = F.cam.y - h;
  if (d <= 0.0 || H <= 0.05) { return o; }
  let dv = wp.xz - F.cam.xz; let hz = length(dv);
  if (hz < 1e-6) { o.air = vec3f(F.cam.x, h, F.cam.z); return o; }
  let s = uwCrossing(H, hz, d); let u = dv / hz;
  let q = F.cam.xz + u * s * (H + d) / H;
  o.p = vec3f(q.x, wp.y, q.y); o.air = vec3f(F.cam.x + u.x * s, h, F.cam.z + u.y * s);
  return o;
}
// lit: the surface's colour in the air; alb its albedo, n its world normal; world the point, air its eye ray's crossing
fn underwater(lit: vec3f, alb: vec3f, n: vec3f, world: vec3f, air: vec3f, yl: f32) -> vec3f {
  let k = underWeight(world, yl);
  if (k <= 0.0) { return lit; }
  let d = max(waterAt(world.xz) - world.y, 0.0);
  let path = max(distance(world, air), d);
  let s = normalize(F.sun.xyz); let sdy = uwSunDownY();
  let sunU = normalize(vec3f(s.x / NW, sdy, s.z / NW));
  let eTop = 0.98 * (LIGHT.sun.rgb + LIGHT.sky.rgb);   // the light entering the water (the bed's E)
  let eSun = sunPerp() * shadowAt(world, max(dot(n, s), 0.0)) * exp(-WK * d / sdy) * 0.98;
  let fD = smoothstep(0.0, 0.35, s.y) * UW_DSHARE;
  let up01 = 0.5 + 0.5 * n.y; let skyDown = exp(-WK * d);
  let eSky = LIGHT.sky.rgb * 0.98 * skyDown * up01 * up01 + eTop * skyDown * RINF * (1.0 - up01) * UW_UPWELL * 4.0;
  let litU = alb / PI * (eSun * max(dot(n, sunU), 0.0) * mix(0.6, 1.0, fD) + eSky);
  let img = exp(-(WK + vec3f(uwScatter())) * path);
  let keep = select(1.0, F.look.x, F.look.x > 0.0);   // the water's and the bed's exposure keep (sim/exposure.js waterKeep)
  return mix(lit, WUP * keep * (litU * img + eTop * RINF / PI * (1.0 - img)), k);
}
// the boats' mirrors in the water (2026-11-19, after the glass boat's; render/tessie.js fsMirror's way): what stands above the
// water drawn flipped through it after the water, shaded where it really is, its Fresnel share, fading with height (fadeM: the sails
// are tall), broken by a moving shimmer and swayed by the waves (more with the wind), faint in a storm's rough water
fn mirSway(wp: vec3f) -> vec3f {
  var w = wp; let dd = min(-w.y, 12.0); let tt = F.cam.w; let sw = mix(UW_SWAY0, UW_SWAY1, uwWindK()) * 1.6;
  w.x += sw * dd * sin(w.z * 0.9 + tt * 1.7); w.z += sw * dd * sin(w.x * 0.8 - tt * 1.3); return w;
}
fn mirHash(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn mirNoise(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mirHash(i), mirHash(i + vec2f(1.0, 0.0)), u.x), mix(mirHash(i + vec2f(0.0, 1.0)), mirHash(i + vec2f(1.0, 1.0)), u.x), u.y); }
// the mirror's coverage at a flipped point (srcY: its height over the water) and its depth (the surface point along the view)
fn mirAlpha(world: vec3f, srcY: f32, fadeM: f32) -> f32 {
  let dir = world - F.cam.xyz; let cosV = abs(normalize(dir).y);
  let fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  let tt = F.cam.w;
  let rip = 0.55 + 0.45 * mirNoise(vec2f(world.x * 0.9 + world.y * 2.0, world.z * 0.9 + tt * 0.8)) * mirNoise(vec2f(world.x * 3.1 + tt * 1.3, world.z * 3.1));
  let rough = (1.0 - 0.55 * uwWindK()) * (1.0 - 0.85 * F.storm.x);
  return fres * 0.6 * exp(-srcY / fadeM) * rip * rough;
}
fn mirDepth(world: vec3f) -> f32 {
  let eye = F.cam.xyz; let k = (eye.y - 0.12) / max(eye.y - world.y, 1e-3);
  let cp = F.viewProj * vec4f(eye + (world - eye) * k, 1.0); return cp.z / cp.w;
}
struct MirOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 }`;

// the head every boat shader shares (M3b: the GLB pipelines build on it)
// Play as Tessie, phase 2a: the keels and the underbodies seen from under the water. The twin module is the solid's own
// text with two lines swapped (underTwin): the part under the drawn surface (the waterline patch decides, as from above) lit by the light
// left at its depth (umLit), no column and no crossing; then the straight path to the eye (umFog) in place of the air's perspective. The
// solid's own module is untouched (every frame above the water draws the pipeline it always drew).
export const BOAT_UNDER_FN = `
${UNDER_WGSL}
fn underwaterU(lit: vec3f, alb: vec3f, n: vec3f, world: vec3f, yl: f32) -> vec3f {
  let k = underWeight(world, yl);
  let d = max(waterAt(world.xz) - world.y, 0.0);
  let s = normalize(F.sun.xyz);
  let litU = umLit(alb, n, d, shadowAt(world, max(dot(n, s), 0.0)));
  return umFog(mix(lit, litU, k), world);
}`;
export function underTwin(text, swaps) {
  let out = text;
  for (const [a, b] of swaps) { if (!out.includes(a)) throw new Error(`underTwin: no "${a.slice(0, 40)}"`); out = out.replace(a, b); }
  return out + BOAT_UNDER_FN;
}
export const SOLID_UNDER_SWAPS = Object.freeze([
  ['col = underwater(col, alb, n, v.world, v.air, v.yl);', 'col = underwaterU(col, alb, n, v.world, v.yl);'],
  ['  return vec4f(col * Tair + inS, 1.0);', '  return vec4f(col + inS * 0.0 + Tair * 0.0, 1.0);'],
]);
export const GLB_UNDER_SWAPS = Object.freeze([
  ['col = underwater(col, s.alb, nW, world, air, yl);', 'col = underwaterU(col, s.alb, nW, world, yl);'],
  ['  return col * Tair + inS;', '  return col + (inS + Tair) * 0.0;'],
]);

export const BOAT_HEAD = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${WATER_WGSL}
${MODEL}
${LIGHT_FN}
${TINT_FN}`;

export const SOLID_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${WATER_WGSL}
${MODEL}
${LIGHT_FN}
${TINT_FN}
struct V { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) col: vec3f, @location(3) mr: vec2f, @location(4) yl: f32, @location(5) air: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f, @location(3) mr: vec2f) -> V {
  let w = M.m * vec4f(p, 1.0);
  var o: V; o.world = w.xyz; o.n = (M.n * vec4f(n, 0.0)).xyz; o.col = c; o.mr = mr; o.yl = (M.q.w + p.y) * M.q.z + (1.0 - M.q.z) * 1.0;
  let ap = uwPlace(w.xyz, o.yl); o.air = ap.air;   // under the water: where the refracted eye ray finds it
  o.pos = F.viewProj * vec4f(ap.p, 1.0);
  return o;
}
@vertex fn vsMirror(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f, @location(3) mr: vec2f) -> V {
  let w = M.m * vec4f(p, 1.0); var o: V; o.yl = (M.q.w + p.y) * M.q.z + (1.0 - M.q.z) * 1.0;
  let src = w.xyz; var f = vec3f(src.x, -src.y, src.z); o.air = src; f = mirSway(f);
  o.world = f; let nn = (M.n * vec4f(n, 0.0)).xyz; o.n = vec3f(nn.x, -nn.y, nn.z); o.col = c; o.mr = mr; o.pos = F.viewProj * vec4f(f, 1.0); return o;
}
@fragment fn fsMirror(v: V) -> MirOut {
  let srcY = -v.world.y;
  if (srcY < 0.03) { discard; }
  if (dot(v.n, F.cam.xyz - v.world) < 0.0) { discard; }   // the faces the mirrored view sees
  var s = v; s.world = vec3f(v.air.x, srcY, v.air.z); s.n = vec3f(v.n.x, -v.n.y, v.n.z); s.yl = 1.0;
  let col = solidCol(s);
  var Tair = vec3f(1.0); let inS = aerialParts(v.pos.xy, v.world, &Tair);
  let a = mirAlpha(v.world, srcY, 6.0);
  var o: MirOut; o.c = vec4f((col * Tair + inS) * a, a); o.depth = mirDepth(v.world); return o;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  if (M.p.z > 0.0 && fract(52.9829189 * fract(dot(v.pos.xy, vec2f(0.06711056, 0.00583715)))) < M.p.z) { discard; }   // M3b: the M3 hull dissolving out as v1's models come in (boatModels.js ign)
  let col = solidCol(v);
  var Tair = vec3f(1.0);
  let inS = aerialParts(v.pos.xy, v.world, &Tair);
  return vec4f(col * Tair + inS, 1.0);
}
fn solidCol(v: V) -> vec3f {
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(v.n);
  let s = normalize(F.sun.xyz);
  let nl = max(dot(n, s), 0.0);
  let eSun = sunPerp() * shadowAt(v.world, nl);
  let eSky = ambientAt(n);
  let metal = v.mr.x; let rough = clamp(v.mr.y, 0.05, 1.0);
  var alb = v.col;
  if (M.p.w > 0.5) { alb = mix(alb, tintOf(M.p.w), topsides(v.yl, n.y)); }   // R4: a rival's topsides colour (0 for the player: unchanged)
  let f0 = mix(vec3f(0.04), alb, metal);
  let diff = alb * (1.0 - metal) / PI * (eSun * nl + eSky + navLightAt(v.world, n));
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let env = skyMirror(R) * fres * (1.0 - 0.7 * rough);   // the sky's mirror, dull on a rough surface
  let spec = ggxSpec(n, V, s, rough, f0) * eSun;
  var col = diff + env + spec;
  col = underwater(col, alb, n, v.world, v.air, v.yl);
  return col;
}`;

export const CLOTH_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${WATER_WGSL}
${MODEL_ART}
${LIGHT_FN}
const CREAM = vec3f(${CLOTH.color.join(", ")}); const GK_NAVY = vec3f(${GK_CLOTH.navy.join(', ')}); const GK_BRASS = vec3f(${GK_CLOTH.brass.join(', ')}); const CALB = ${CLOTH.albedo}; const ROUGH = ${CLOTH.roughness}; const CTAU = ${CLOTH.transmit}; const FLUTTER = ${CLOTH.flutter};
const CLOTH_AMB_K = ${CLOTH_AMB.k}; const CLOTH_AMB_D = ${CLOTH_AMB.d}; const CLOTH_AMB_BW = ${CLOTH_AMB.back.w}; const CLOTH_AMB_BP = ${CLOTH_AMB.back.p}; const CLOTH_AMB_BS = ${CLOTH_AMB.back.sunY};
const UVSTRIP = vec3f(${UV_STRIP.map((x) => x.toFixed(5)).join(', ')}); const CAMBER = ${CLOTH.camberShade};
// the mainsail's graphics (render/sailArt.js; Mix, 2026-11-18): the shared glyph atlas, composed per fragment in the cloth's metres
@group(2) @binding(4) var tArt: texture_2d<f32>;
@group(2) @binding(5) var sArt: sampler;
${SAIL_ART_WGSL}
struct V { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) met: vec2f, @location(4) fn_: vec3f, @location(5) tu: vec3f, @location(6) slope: f32 }
fn wavePair(u: f32, v: f32, t: f32) -> vec2f {
  let TAU2 = 6.28318530718;
  let a1 = (u * 2.2 - t * 3.1) * TAU2 + v * 5.0; let a2 = (u * 3.7 - t * 4.3) * TAU2 + v * 2.0 + 1.3;
  return vec2f(sin(a1) * 0.6 + sin(a2) * 0.4, cos(a1) * 0.6 * 2.2 * TAU2 + cos(a2) * 0.4 * 3.7 * TAU2);
}
fn ampAt(u: f32, luff: f32) -> f32 { return luff * (1.0 - smoothstep(0.0, 0.35, u)) * 0.6 + smoothstep(0.4, 1.0, luff) * (u * 0.7 + 0.3); }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) met: vec2f, @location(4) fln: vec3f, @location(5) tu: vec3f) -> V { return clothVs(p, n, uv, met, fln, tu); }
fn clothVs(p: vec3f, n: vec3f, uv: vec2f, met: vec2f, fln: vec3f, tu: vec3f) -> V {
  // the luff flutter (rig.js flutter(), the same wave): along the normal, from the luff amount by height and the time
  let luff = mix(M.p.z, M.p.w, smoothstep(0.3, 0.75, uv.y));
  let chord = max(met.x / max(uv.x, 1e-3), 0.05);
  let w = wavePair(uv.x, uv.y, M.p.y);
  let a = ampAt(uv.x, luff);
  let pl = p + n * (a * FLUTTER * chord * w.x);
  let wp = M.m * vec4f(pl, 1.0);
  var o: V; o.pos = F.viewProj * wp; o.world = wp.xyz; o.n = (M.n * vec4f(n, 0.0)).xyz; o.uv = uv; o.met = met; o.fn_ = (M.n * vec4f(fln, 0.0)).xyz;
  o.tu = (M.n * vec4f(tu, 0.0)).xyz; o.slope = a * w.y * FLUTTER;   // v1: the normal tilted by the wave's slope along the chord
  return o;
}
fn band(x: f32, w: f32) -> f32 { return 1.0 - smoothstep(w, w + max(fwidth(x), 1e-4), x); }
fn line(x: f32, period: f32, width: f32) -> f32 { let d = abs(fract(x / period + 0.5) - 0.5) * period; let fw = max(fwidth(x), 1e-4); return 1.0 - smoothstep(width * 0.5, width * 0.5 + fw, d); }
// the cloth's sky light as v1 shows it: v1's terms (below), scaled by k and pulled toward neutral by d: v1's AgX tone map
// lifts and desaturates a sail's shade side that v2's ACES fit leaves dark and blue (measured on the 21 kn frame)
fn clothAmb(e: vec3f, k: f32, d: f32) -> vec3f { let l = dot(e, vec3f(0.2126, 0.7152, 0.0722)); return mix(e, vec3f(l), d) * k; }
@vertex fn vsMirror(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) met: vec2f, @location(4) fln: vec3f, @location(5) tu: vec3f) -> V {
  var o = clothVs(p, n, uv, met, fln, tu);
  let src = o.world; var f = mirSway(vec3f(src.x, -src.y, src.z));
  o.pos = F.viewProj * vec4f(f, 1.0); o.world = f;
  o.n = vec3f(o.n.x, -o.n.y, o.n.z); o.fn_ = vec3f(o.fn_.x, -o.fn_.y, o.fn_.z); o.tu = vec3f(o.tu.x, -o.tu.y, o.tu.z);
  return o;
}
@fragment fn fsMirror(v: V, @builtin(front_facing) ff: bool) -> MirOut {
  let srcY = -v.world.y;
  if (srcY < 0.3) { discard; }
  var s = v; s.world = vec3f(v.world.x, srcY, v.world.z); s.n = vec3f(v.n.x, -v.n.y, v.n.z); s.fn_ = vec3f(v.fn_.x, -v.fn_.y, v.fn_.z); s.tu = vec3f(v.tu.x, -v.tu.y, v.tu.z);
  let c = clothCol(s, !ff);
  var Tair = vec3f(1.0); let inS = aerialParts(v.pos.xy, v.world, &Tair);
  let a = mirAlpha(v.world, srcY, 9.0);
  var o: MirOut; o.c = vec4f((c.rgb * Tair + inS) * a, a); o.depth = mirDepth(v.world); return o;
}
@fragment fn fs(v: V, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let c = clothCol(v, ff);
  if (c.w > 0.0) { return c; }   // a debug view (?boatdebug)
  var Tair = vec3f(1.0);
  let inS = aerialParts(v.pos.xy, v.world, &Tair);
  return vec4f(c.rgb * Tair + inS, 1.0);
}
fn clothCol(v: V, ff: bool) -> vec4f {
  let V = normalize(F.cam.xyz - v.world);
  let hoist = M.q.x; let chordFoot = M.q.y; let isGk = M.q.z > 1.5; let isMain = M.q.z > 0.5 && !isGk;   // q.z: 0 the jib, 1 the main, 2 the gennaker
  let sx = v.met.x; let h = v.met.y; let chordHere = sx / max(v.uv.x, 1e-3);
  let fw = max(fwidth(sx) + fwidth(h), 1e-5);
  // --- v1's sails.js clothMaterial, term for term ---
  // the layers: crosscut seams (0.35), the tapes (1), the corner patches (2), the battens' pockets (1), the reef bands (0.5)
  let tilt = select(0.32, 0.08, isMain); let panel = select(${CLOTH.panelM.jib}, ${CLOTH.panelM.main}, isMain);
  let seam = line(h - sx * tilt, panel, 0.025);
  let tapes = max(max(band(sx, 0.07), band(chordHere - sx, 0.045)), band(h, 0.05));
  let tack = 1.0 - smoothstep(0.55, 0.75, sqrt(sx * sx + h * h));
  let clew = 1.0 - smoothstep(0.65, 0.85, sqrt((chordFoot - sx) * (chordFoot - sx) + h * h));
  let head = 1.0 - smoothstep(0.4, 0.55, abs(hoist - h));
  var pockets = 0.0; var reefBand = 0.0; var reefPts = 0.0; var uvStrip = 0.0;
  if (isMain) {
    ${RIG.battens.map((b) => `pockets = max(pockets, band(abs(h - hoist * ${b}), 0.035) * smoothstep(0.0, 0.03, v.uv.x));`).join(' ')}
    ${RIG.reefs.slice(1).map((r) => `{ let dy = abs(h - ${(RIG.mainLuff * r).toFixed(4)}); reefBand = max(reefBand, band(dy, 0.03) * 0.6);
      let dx = abs(fract(sx / 0.30) - 0.5) * 0.30; let tie = 1.0 - smoothstep(0.012, 0.016, sqrt(dx * dx + dy * dy));
      let endD = min(sx, chordHere - sx); let cr = 1.0 - smoothstep(0.022, 0.028, abs(sqrt(endD * endD + dy * dy) - 0.07) + 0.02);
      reefPts = max(reefPts, max(tie, cr)); }`).join(' ')}
  } else if (!isGk) {
    uvStrip = max(band(chordHere - sx, ${CLOTH_UV.leech}), band(h, ${CLOTH_UV.foot}));   // the furling jib's UV strip on the leech and foot
  }
  let layers = seam * 0.35 + tapes + max(max(tack, clew), head) * 2.0 + pockets + reefBand;
  let across = 0.92 + smoothstep(0.0, 0.45, v.uv.x) * 0.08 - smoothstep(0.8, 1.0, v.uv.x) * 0.04;
  // the cloth's colour: cream Dacron; the gennaker's nylon navy with a cream head and one brass stripe between
  var base = CREAM;
  if (isGk) { let vv = v.uv.y; let fwv = max(fwidth(vv), 1e-4); base = mix(mix(GK_NAVY, GK_BRASS, smoothstep(${0.735} - fwv, ${0.735} + fwv, vv)), CREAM, smoothstep(${0.765} - fwv, ${0.765} + fwv, vv)); }
  let alb = mix(base * CALB * across * (1.0 - min(layers, 2.0) * 0.06) * (1.0 - pockets * 0.10), UVSTRIP, uvStrip) * (1.0 - reefPts * 0.45);
  // the shading normal (v1's normalNode): the camber amplified, a plain weave (1.6 mm, faded once a thread is under a
  // pixel) and soft crinkles (0.2–0.5 m), the flutter's slope along the chord; on the face's side (faceDirection)
  let fd = select(-1.0, 1.0, ff);
  let n0 = normalize(v.n);
  let nc = n0 + (n0 - normalize(v.fn_)) * CAMBER;
  let tU = normalize(v.tu); let tV = normalize(cross(nc, tU));
  let fine = 1.0 - smoothstep(0.0006, 0.0016, fw);
  let wx = sin(sx * ${(2 * Math.PI / 0.0016).toFixed(3)}); let wy = sin(h * ${(2 * Math.PI / 0.0016).toFixed(3)});
  let crx = sin(sx * 13.1 + sin(h * 4.3) * 2.0) * sin(h * 9.7 + sx * 2.1);
  let cry = sin(h * 15.7 + sin(sx * 5.9) * 1.7) * sin(sx * 7.3 - h * 1.3);
  let tl = tU * (wx * fine * 0.06 + crx * 0.035) + tV * (wy * fine * 0.06 + cry * 0.035);
  let n = normalize(nc + tl - tU * v.slope) * fd;
  let s = normalize(F.sun.xyz);
  let nl = max(dot(n, s), 0.0);
  let sh = shadowAt(v.world, nl);
  let eSun = sunPerp();
  // v1's diffuse light: MeshStandard, metalness 0, roughness 0.72: the sun (the atmosphere's light) + its indirect sky
  // irradiance on the normal (Bruneton's (1 + n·up) / 2 of the level ground's) + the sky's environment map (three adds
  // that as well: the image-based light, ≈ the hemisphere the normal sees, the hazy air below the horizon too)
  // the sun through the cloth from behind (v1's emissive): on the geometry's normal (normalWorld), turned to the camera
  let ng = n0 * fd; let ncam = select(ng, -ng, dot(ng, V) < 0.0);
  let back = max(dot(-ncam, s), 0.0);
  // #37: the shade side's lift fades where the sun shines through (CLOTH_AMB.back): v1's dusk cloth reads warm
  // fix(v2) boat night light: the v1 lift (its three sky terms × k, toward grey) is a daylight match through AgX; over the
  // land's fade (boatDay) the cloth goes to the world's night light alone (ambientAt: the level sky and NIGHT_LAND, the moon's
  // share from its side), as the hull: a pale shape at night, not a lit one (it read 2.3 × the hull's light, 4.7 × the water)
  let day = boatDay(); let amb = ambientAt(n);
  let eSky = clothAmb(mix(amb, LIGHT.sky.rgb * (0.5 + 0.5 * n.y) + amb + LIGHT.sky.rgb * 0.25 * (0.5 - 0.5 * n.y), day), mix(1.0, CLOTH_AMB_K * (1.0 - CLOTH_AMB_BW * pow(max(back, 1e-6), CLOTH_AMB_BP) * smoothstep(0.0, CLOTH_AMB_BS, s.y)), day), CLOTH_AMB_D * day);
  // the night light through the cloth from its far side (the moon behind the sail: CTAU per layer, as the sun's below)
  let thru = (1.0 - day) * CTAU * pow(0.45, layers) * (1.0 - uvStrip) * nightLightAt(-ncam);
  let F0 = vec3f(0.04);
  let fres = F0 + (1.0 - F0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  var col = alb / PI * (eSun * sh * nl + eSky + navLightAt(v.world, n));   // three: Lambert, no (1 − F) on the diffuse
  col += ggxSpec(n, V, s, ROUGH, F0) * eSun * sh;
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  col += skyMirror(R) * fres * (1.0 - 0.7 * ROUGH);   // the environment's specular, blurred at 0.72
  // the sun through the cloth (back, above), each layer passing ≈ 0.45; the UV strip blocks it
  col += eSun / PI * CTAU * pow(0.45, layers) * (1.0 - uvStrip) * back * base;
  col += thru / PI * base;
  // the mainsail's graphics (the main only; r: cloth code, ink A, ink B, the number's glyphs; render/sailArt.js packArt): the boat's
  // cloth and its print. The print is on the cloth: the near face's ink takes the cloth's own shading; the far face's shows through
  // the weave (mirrored, as a real sail's), faint when front-lit, a dark silhouette when the sun is behind; every print blocks the
  // light through the cloth
  // the race look (2026-11-25): the jib takes the boat's cloth as well (its record carries the same code; no print on it)
  if (!isGk && M.r.x > 0.5) {
    let code = u32(M.r.x + 0.5) - 1u; let ci = i32(code % 16u); let roseA = f32(code / 16u) * 0.01;
    var cc = CREAM; var ct = CTAU; var cr = ROUGH; var scr = 0.0;
    if (ci == 1) { cc = vec3f(0.905, 0.896, 0.855); ct = 0.24; cr = 0.70; }                   // white Dacron #F4F3EE
    else if (ci == 2) { cc = vec3f(0.815, 0.716, 0.521); ct = 0.21; cr = 0.72; }               // cream / tan Dacron #E9DCBF
    else if (ci == 3) { cc = vec3f(0.156, 0.165, 0.184); ct = 0.07; cr = 0.42; scr = 1.0; }    // grey laminate #6E7177
    else if (ci == 4) { cc = vec3f(0.024, 0.026, 0.031); ct = 0.02; cr = 0.38; scr = -1.0; }   // black laminate #2B2D31
    else if (ci == 5) { cc = vec3f(0.40, 0.425, 0.46); ct = 0.10; cr = 0.40; scr = 1.0; }      // silver laminate #A9ADB3 (the player's: a pale grey film over a dark scrim)
    let gr = vec4f(dpdx(sx), dpdy(sx), dpdx(h), dpdy(h));
    let nearS = !ff;   // the front face is the port face (the grid's winding: the normal to port with the boom amidships)
    var iN = vec2f(0.0); var iF = vec2f(0.0);
    if (isMain) {
      iN = artInk(sx, h, nearS, M.r.w, gr); iN.y *= roseA;
      iF = artInk(sx, h, !nearS, M.r.w, gr); iF.y *= roseA;   // phones too: the A/B showed no cost above noise
    }
    let inkA = artInkC(vec3f(M.r.y, 0.0, 0.0)); let inkB = artInkC(vec3f(M.r.z, 0.0, 0.0));
    // a laminate's scrim: diagonal threads every 9 cm (darker on grey, a lighter glint on black), gone once under a pixel
    let thr = max(line(sx + h * 0.6, 0.09, 0.006), line(sx - h * 0.6, 0.09, 0.006)) * (1.0 - smoothstep(0.004, 0.012, fw));
    // a laminate's tri-radial panels: seams fanning from the clew over the lower sail and from the head over the upper (a
    // 12 mm tape 3 m out), kept to a soft pixel line at the follow camera, gone past 5 cm a pixel
    var rad = 0.0;
    if (scr != 0.0) {
      let aC = atan2(h, max(chordFoot - sx, 0.01)); let aH = atan2(hoist - h, max(sx, 0.01));
      let wC = smoothstep(0.66, 0.54, h / max(hoist, 1e-3));
      rad = max(line(aC, 0.105, 0.004) * wC, line(aH, 0.115, 0.004) * (1.0 - wC)) * (1.0 - smoothstep(0.02, 0.05, fw));
    }
    var a2 = cc * CALB * across * (1.0 - min(layers, 2.0) * 0.06) * (1.0 - pockets * 0.10) * (1.0 - reefPts * 0.45);
    a2 = a2 * (1.0 - thr * max(scr, 0.0) * 0.18) + vec3f(0.05) * thr * max(-scr, 0.0);
    a2 = a2 * (1.0 - rad * 0.14);
    a2 = mix(a2, select(UVSTRIP, vec3f(0.035), scr != 0.0), uvStrip);   // the jib's UV strip: the canvas on Dacron, graphite on a laminate
    let lumA = dot(inkA, vec3f(0.2126, 0.7152, 0.0722)); let lumB = dot(inkB, vec3f(0.2126, 0.7152, 0.0722));
    let lumC = dot(cc, vec3f(0.2126, 0.7152, 0.0722));
    a2 = a2 * (1.0 - clamp(ct * 1.6 * (iF.x * max(lumC - lumA, 0.0) + iF.y * max(lumC - lumB, 0.0)) / max(lumC, 0.05), 0.0, 0.6));
    a2 = mix(a2, inkB * CALB * across, iN.y);
    a2 = mix(a2, inkA * CALB * across, iN.x);
    let fl = mix(vec3f(1.0), inkA * 0.25, iN.x) * mix(vec3f(1.0), inkA * 0.25, iF.x) * mix(vec3f(1.0), inkB * 0.3, iN.y) * mix(vec3f(1.0), inkB * 0.3, iF.y);
    col = a2 / PI * (eSun * sh * nl + eSky + navLightAt(v.world, n));   // fix(v2) boat night light: her own lights on the print too
    col += ggxSpec(n, V, s, cr, F0) * eSun * sh;
    col += skyMirror(R) * fres * (1.0 - 0.7 * cr);
    col += eSun / PI * ct * pow(0.45, layers) * (1.0 - uvStrip) * back * cc * fl;
    col += (1.0 - day) * ct * pow(0.45, layers) * (1.0 - uvStrip) * nightLightAt(-ncam) / PI * cc * fl;   // the night light through the printed cloth (thru's, by its cloth)
  }
  if (M.q.w > 0.5) { let m = M.q.w; if (m < 1.5) { return vec4f(vec3f(nl), 1.0); } if (m < 2.5) { return vec4f(vec3f(back), 1.0); } if (m < 3.5) { return vec4f(eSun * 0.1, 1.0); } if (m < 4.5) { return vec4f(vec3f(layers / 3.0), 1.0); } return vec4f(vec3f(sh), 1.0); }   // ?boatdebug=1..5: nl, back, the sun, the layers, the shadow
  return vec4f(col, -1.0);
}`;

export const RIBBON_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${WATER_WGSL}
${MODEL}
${LIGHT_FN}
struct V { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) cover: f32, @location(2) side: f32, @location(3) world: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) o: vec3f, @location(2) side: f32, @location(3) diam: f32, @location(4) c: vec3f) -> V {
  let wp = M.m * vec4f(p, 1.0); let wo = M.m * vec4f(o, 1.0);
  var clip = F.viewProj * wp; let clipO = F.viewProj * wo;
  let aspect = F.res.x / F.res.y;
  let a = clip.xy / clip.w; let b = clipO.xy / clipO.w;
  let dir = normalize((b - a) * vec2f(aspect, 1.0) + vec2f(1e-6, 0.0));
  let nrm = vec2f(-dir.y, dir.x) / vec2f(aspect, 1.0);
  // #20: a negative diameter is a detail line (the telltales, the vane, the flag): at least 2.2 px wide and opaque, so a
  // 25 mm yarn still reads at the follow camera on a phone; a rope keeps its true width and fades under a pixel
  let det = diam < 0.0;
  let px = abs(diam) * M.p.x / max(clip.w, 1e-3);   // the rope's projected diameter in pixels (M.p.x: the focal length in px)
  let drawn = max(px, select(1.0, 2.2, det));
  let off = nrm * (drawn / F.res.y) * side * clip.w;
  var v: V; v.pos = vec4f(clip.xy + off, clip.zw); v.col = c; v.cover = select(min(px / drawn, 1.0), max(min(px / drawn, 1.0), 0.9), det); v.side = side; v.world = wp.xyz; return v;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  let s = normalize(F.sun.xyz);
  let round = sqrt(max(1.0 - v.side * v.side, 0.0)) * 0.45 + 0.55;
  let e = (sunPerp() * 0.5 * shadowAt(v.world, 0.5) + LIGHT.sky.rgb) / PI;
  var Tair = vec3f(1.0);
  let inS = aerialParts(v.pos.xy, v.world, &Tair);
  let col = v.col * round * e * Tair + inS;
  return vec4f(col * v.cover, v.cover);   // premultiplied
}
// #20: a jib telltale behind the cloth (drawn where the depth says something is in front): its shadow through the sail, 42 %
@fragment fn fsGhost(v: V) -> @location(0) vec4f {
  let e = (sunPerp() * 0.5 + LIGHT.sky.rgb) / PI;
  let a = 0.42 * v.cover;
  return vec4f(v.col * 0.5 * e * a, a);
}`;

// the shadow map: depth only, from the sun's orthographic box; the cloth keeps its flutter
export const SHADOW_SOLID_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${MODEL}
@vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f { return SH.vp * (M.m * vec4f(p, 1.0)); }`;
export const SHADOW_CLOTH_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${MODEL}
const FLUTTER = ${CLOTH.flutter};
fn wave(u: f32, v: f32, t: f32) -> f32 { let T = 6.28318530718; return sin((u * 2.2 - t * 3.1) * T + v * 5.0) * 0.6 + sin((u * 3.7 - t * 4.3) * T + v * 2.0 + 1.3) * 0.4; }
fn ampAt(u: f32, luff: f32) -> f32 { return luff * (1.0 - smoothstep(0.0, 0.35, u)) * 0.6 + smoothstep(0.4, 1.0, luff) * (u * 0.7 + 0.3); }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) met: vec2f) -> @builtin(position) vec4f {
  let luff = mix(M.p.z, M.p.w, smoothstep(0.3, 0.75, uv.y));
  let chord = max(met.x / max(uv.x, 1e-3), 0.05);
  let pl = p + n * (ampAt(uv.x, luff) * FLUTTER * chord * wave(uv.x, uv.y, M.p.y));
  return SH.vp * (M.m * vec4f(pl, 1.0));
}`;

// --- small matrix helpers (column-major, as engine/math.js) ---
const identity = (m) => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; };
const translate = (m, x, y, z) => { identity(m); m[12] = x; m[13] = y; m[14] = z; return m; };
const rotY = (m, a) => { identity(m); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; };
const rotX = (m, a) => { identity(m); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
const rotZ = (m, a) => { identity(m); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
// an orthographic projection into [0, 1] depth (WebGPU), looking down -z of the light's view
const ortho = (m, half, near, far) => { identity(m); m[0] = 1 / half; m[5] = 1 / half; m[10] = -1 / (far - near); m[14] = -near / (far - near); return m; };
// the light's view: eye at e looking along d (unit), up chosen away from d
function lightView(out, e, d) {
  const up = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const fwd = [d[0], d[1], d[2]];
  let rx = fwd[1] * up[2] - fwd[2] * up[1], ry = fwd[2] * up[0] - fwd[0] * up[2], rz = fwd[0] * up[1] - fwd[1] * up[0];
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fwd[2] - rz * fwd[1], uy = rz * fwd[0] - rx * fwd[2], uz = rx * fwd[1] - ry * fwd[0];
  out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * e[0] + ry * e[1] + rz * e[2]);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * e[0] + uy * e[1] + uz * e[2]);
  out[2] = -fwd[0]; out[6] = -fwd[1]; out[10] = -fwd[2]; out[14] = fwd[0] * e[0] + fwd[1] * e[1] + fwd[2] * e[2];
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

// --- the GPU side ---
export function createBoat({ device, reg, frameBGL, frameBG, U, frameStruct = wgslStruct(), sky, hdrTarget, msaa = 1, depthFormat = 'depth32float', dims = DEFAULT_DIMS, vessel = CURRENT_VESSEL, timestamps = null, errors = [], shadowSize = SHADOW.size, telltales = true, sailArt = null, waterAt = null, mirrors = false, under = false, gkGrid = 'full' }) {   // under: phase 2a (src/core/features.js tessieUnder): the solid's and the model's under-water twins   // perf(v2) phone: shadowSize, the level's map (built at load)
  const artOn = sailArtOn(sailArt);   // the mainsail's graphics: on unless ?sailart=off (render/sailArt.js)
  const CD = GPUBufferUsage.COPY_DST, VB = GPUBufferUsage.VERTEX | CD, IB = GPUBufferUsage.INDEX | CD;
  // a buffer with the array's bytes (a Uint16 index of odd length is padded to a multiple of 4 bytes)
  const upload = (label, arr, usage) => {
    const bytes = Math.max(16, Math.ceil(arr.byteLength / 4) * 4);
    const b = device.createBuffer({ label, size: bytes, usage });
    if (arr.byteLength % 4) { const pad = new arr.constructor(bytes / arr.BYTES_PER_ELEMENT); pad.set(arr); device.queue.writeBuffer(b, 0, pad); } else device.queue.writeBuffer(b, 0, arr);
    return b;
  };
  // the meshes (CPU, once)
  const t0 = performance.now();
  const hull = buildHull(dims, { foils: false }), parts = carbonSpars(buildRigParts(dims)), foils = buildFoils(dims);   // the race look: carbon mast, boom and spreaders (v1's shapes, recoloured)
  const solids = [
    { name: 'hull', slot: SLOT.hull, mesh: hull },
    { name: 'keel', slot: SLOT.keel, mesh: foils.keel },
    { name: 'rudder', slot: SLOT.rudder, mesh: foils.rudder },
    { name: 'mast', slot: SLOT.rig, mesh: parts.mast },
    { name: 'boom', slot: SLOT.boom, mesh: parts.boom },
  ].map((s) => ({ ...s, pos: upload(`boat-${s.name}-pos`, s.mesh.position, VB), nrm: upload(`boat-${s.name}-nrm`, s.mesh.normal, VB), col: upload(`boat-${s.name}-col`, s.mesh.color, VB), mr: upload(`boat-${s.name}-mr`, s.mesh.mr, VB),
    idx: upload(`boat-${s.name}-idx`, s.mesh.index, IB), fmt: s.mesh.index instanceof Uint32Array ? 'uint32' : 'uint16', count: s.mesh.index.length }));
  const sails = [['main', SAIL_GRIDS.main, mainPoint, SLOT.main], ['jib', SAIL_GRIDS.jib, jibPoint, SLOT.jib]].map(([name, [nu, nv], fn, slot]) => {
    const g = sailGrid(nu, nv);
    return { name, g, fn, slot, key: '', hoist: 0, pos: upload(`boat-${name}-pos`, g.position, VB), nrm: upload(`boat-${name}-nrm`, g.normal, VB), uv: upload(`boat-${name}-uv`, g.uv, VB), met: upload(`boat-${name}-met`, g.metric, VB), fln: upload(`boat-${name}-fln`, g.flatN, VB), tan: upload(`boat-${name}-tan`, g.tanU, VB), idx: upload(`boat-${name}-idx`, g.index, IB) };
  });
  //: the gennaker, its grid by the gennakerCloth policy (createBoat's gkGrid: 'full' | 'lite'); drawn only while it is up
  const gkG = sailGrid(...(GK_GRID[gkGrid] ?? GK_GRID.full));
  const gk = { name: 'gennaker', g: gkG, fn: gennakerPoint, slot: SLOT.gk, key: '', hoist: 0, shown: false, pos: upload('boat-gk-pos', gkG.position, VB), nrm: upload('boat-gk-nrm', gkG.normal, VB), uv: upload('boat-gk-uv', gkG.uv, VB), met: upload('boat-gk-met', gkG.metric, VB), fln: upload('boat-gk-fln', gkG.flatN, VB), tan: upload('boat-gk-tan', gkG.tanU, VB), idx: upload('boat-gk-idx', gkG.index, IB) };
  const R = ribbonArrays(1536);
  const ribbon = { pos: upload('boat-rib-pos', R.position, VB), oth: upload('boat-rib-oth', R.other, VB), side: upload('boat-rib-side', R.side, VB), diam: upload('boat-rib-diam', R.diam, VB), col: upload('boat-rib-col', R.color, VB), idx: upload('boat-rib-idx', R.index, IB) };
  const wires = wireLines(parts.wires);
  // #20: the telltales, the masthead vane and the flag (boat/telltales.js): their own small ribbon buffer, the jib's yarns first
  const details = createBoatDetails(parts.rig), RD = ribbonArrays(192);
  const detailRib = { pos: upload('boat-tell-pos', RD.position, VB), oth: upload('boat-tell-oth', RD.other, VB), side: upload('boat-tell-side', RD.side, VB), diam: upload('boat-tell-diam', RD.diam, VB), col: upload('boat-tell-col', RD.color, VB), idx: upload('boat-tell-idx', RD.index, IB) };
  let detailsShown = telltales !== false, jibIdx = 0;
  const DSAILS = { jib: { g: null, luff: 0, luffTop: 0, shown: false }, main: { g: null, luff: 0, luffTop: 0, shown: false } };
  const buildMs = performance.now() - t0;
  // R4: the near rivals' own sails (their grids filled on the CPU at their own trim; the uv and the index shared with the player's)
  const rivals = [];
  for (let i = 0; i < MAX_NEAR_RIVALS; i++) {
    const rs = sails.map((S0) => { const g = sailGrid(S0.g.nu, S0.g.nv), nm = `boat-r${i}-${S0.name}`;
      return { name: S0.name, g, fn: S0.fn, uv: S0.uv, idx: S0.idx, hoist: 0, pos: upload(`${nm}-pos`, g.position, VB), nrm: upload(`${nm}-nrm`, g.normal, VB), met: upload(`${nm}-met`, g.metric, VB), fln: upload(`${nm}-fln`, g.flatN, VB), tan: upload(`${nm}-tan`, g.tanU, VB) }; });
    rivals.push({ base: SLOT.rivals + i * RIVAL_SLOT.n, sails: rs, key: -1, boat: null, fresh: false, Mroot: mat4(), Mrig: mat4(), Mboom: mat4(), Mrud: mat4(), W: new Float32Array(PATCH_FLOATS),
      pose: { x: 0, heave: 0, z: 0, heading: 0, heel: 0, pitch: 0, boomAngle: 0, jibAngle: 0, mainFill: 1, jibFill: 1, mainDraft: 1, jibDraft: 1, jibBacked: 0, rudderAngle: 0, tint: 0, bare: 0, art: 0 },
      desc: { main: { boomRad: 0, fill: 1, draft: 1, reef: 0 }, jib: { sheetRad: 0, fill: 1, draft: 1, furl: 0, backed: 0 } } });
  }
  let nRivals = 0, rivalFills = 0, rivalFrame = 0, rivalShadowN = 0;
  const mirrorStats = { calls: 0, triangles: 0, rivals: 0 };
  const live = [], used = new Uint8Array(MAX_NEAR_RIVALS);   // this frame's slots in use (indices into rivals), reused
  const playerAt = [0, 0];
  const RIVAL_RANGES = ['always', 'far'];   // v1's models for a rival: the hull's far detail, no cabin, no cockpit close-up
  const RP = [0, 0, 0, 0], RQ = [0, 0, 0, 0];

  // the records: Model a slot (dynamic offset), the Shadow uniform
  const models = new Float32Array((STRIDE / 4) * SLOT.N);
  const mbuf = device.createBuffer({ label: 'boat-models', size: models.byteLength, usage: GPUBufferUsage.UNIFORM | CD });
  const shadowU = new Float32Array(SHADOW_U_FLOATS);
  // perf(v2) phone round 2: the shadow map redrawn every `shadowEvery`th frame (the phone path: 2, on the frames the aerial
  // pass skips); between, the map stands and the light's matrix follows the boat's move since the draw (the map's boat sits
  // where the boat was, so a receiver at p reads the map at p − d): the shadow moves with the hull, only a turn or a heel
  // of one frame lags. Off and on of the sun always redraws
  let shadowEvery = 1, shadowN = 0, shadowDue = true, shadowDrawn = false, lastOn = -1, shadowWhen = null;
  const Mlast = new Float32Array(16), shC = [0, 0, 0], Mnow = new Float32Array(16);
  const sbuf = device.createBuffer({ label: 'boat-shadow', size: SHADOW_U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | CD });
  const shadowTex = device.createTexture({ label: 'boat-shadow-map', size: [shadowSize, shadowSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const shadowView = shadowTex.createView();
  const sCmp = device.createSampler({ label: 'boat-shadow-cmp', compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const bgl = device.createBindGroupLayout({ label: 'boat', entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: MODEL_BYTES } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    { binding: 3, visibility: VF, buffer: { type: 'uniform' } },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
  // the mainsails' graphics: the shared glyph atlas (render/sailArt.js; a 1 x 1 stand-in under ?sailart=off, never sampled)
  const atlas = sailArtAtlas(device, artOn);
  const artView = atlas.view, artSmp = atlas.sampler;
  // each boat's record (0 the player; 1-5 the near rivals' FLEET order, their numbers from setRivalArt): FLEET's numbers by default
  const artR = artOn ? [0, 1, 2, 3, 4, 5].map((i) => packArt(boatArt(i, i ? undefined : 'USA 28'))) : null;
  const R0 = [0, 0, 0, 0];
  const playerTint = packTint(PLAYER_HULL);   // the race livery: the player's navy topsides
  const bg = device.createBindGroup({ label: 'boat', layout: bgl, entries: [{ binding: 0, resource: { buffer: mbuf, size: STRIDE } }, { binding: 1, resource: shadowView }, { binding: 2, resource: sCmp }, { binding: 3, resource: { buffer: sbuf } }, { binding: 4, resource: artView }, { binding: 5, resource: artSmp }] });
  // the shadow pass binds the same group with a 1 × 1 stand-in depth (a pass may not read its own attachment)
  const dummyDepth = device.createTexture({ label: 'boat-shadow-none', size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
  const bgShadow = device.createBindGroup({ label: 'boat-shadow-pass', layout: bgl, entries: [{ binding: 0, resource: { buffer: mbuf, size: STRIDE } }, { binding: 1, resource: dummyDepth.createView() }, { binding: 2, resource: sCmp }, { binding: 3, resource: { buffer: sbuf } }, { binding: 4, resource: artView }, { binding: 5, resource: artSmp }] });

  // the pipelines
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] });
  // M3b: v1's models (group 3: the material table, the two texture arrays, a repeating sampler); built now, filled later
  const glbBGL = device.createBindGroupLayout({ label: 'boat-glb', entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
  const glbLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl, glbBGL] });
  // perf(v2) iOS pipelines: the models' and the instruments' pipelines are one group ('boatModels'), built after the first
  // frame; the models stream only once it is in (main.js), and every draw of them waits for gm.ready
  const prevGroup = reg.group?.('boatModels');
  const gm = createBoatModels({ device, reg, layout: glbLayout, frameStruct, head: BOAT_HEAD(frameStruct), hdrTarget, msaa, depthFormat, glbBGL, errors, under: under ? (t) => underTwin(t, GLB_UNDER_SWAPS) : null });
  // M4: the skipper's instruments (v1's compass card and pedestal pod), drawn with v1's models (group 3: their texture)
  const inst = createBoatInstruments({ device, reg, frameBGL, skyBGL: sky.skyBGL, boatBGL: bgl, head: BOAT_HEAD(frameStruct), hdrTarget, msaa, depthFormat });
  if (prevGroup != null) reg.group(prevGroup);
  const f3 = (loc, stride = 12) => ({ arrayStride: stride, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x3' }] });
  const f2 = (loc) => ({ arrayStride: 8, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x2' }] });
  const f1 = (loc) => ({ arrayStride: 4, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32' }] });
  const depth = { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' };
  const mSolid = reg.shader('boat-solid', SOLID_WGSL(frameStruct)), mCloth = reg.shader('boat-cloth', CLOTH_WGSL(frameStruct)), mRib = reg.shader('boat-ribbon', RIBBON_WGSL(frameStruct));
  reg.add('boat-solid', { layout, vertex: { module: mSolid, entryPoint: 'vs', buffers: [f3(0), f3(1), f3(2), f2(3)] }, fragment: { module: mSolid, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: depth, multisample: { count: msaa } });
  if (under) {   // phase 2a: the solid's under-water twin (its own module; the deferred 'under' group)
    const prevU = reg.group?.('under');
    const mSU = reg.shader('boat-solid-under', underTwin(SOLID_WGSL(frameStruct), SOLID_UNDER_SWAPS));
    reg.add('boat-solid-under', { layout, vertex: { module: mSU, entryPoint: 'vs', buffers: [f3(0), f3(1), f3(2), f2(3)] }, fragment: { module: mSU, entryPoint: 'fs', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: depth, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  }
  reg.add('boat-cloth', { layout, vertex: { module: mCloth, entryPoint: 'vs', buffers: [f3(0), f3(1), f2(2), f2(3), f3(4), f3(5)] }, fragment: { module: mCloth, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth, multisample: { count: msaa } });
  // the mirrors in the water (owner, 2026-11-19; src/core/features.js boatMirrors: never built where off): premultiplied after the water,
  // no depth written, tested against the surface point along the view (fsMirror's frag_depth)
  if (mirrors) {
    const mb = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const mDepth = { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' };
    reg.add('boat-solid-mirror', { layout, vertex: { module: mSolid, entryPoint: 'vsMirror', buffers: [f3(0), f3(1), f3(2), f2(3)] }, fragment: { module: mSolid, entryPoint: 'fsMirror', targets: [{ ...hdrTarget, blend: mb }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: mDepth, multisample: { count: msaa } });
    reg.add('boat-cloth-mirror', { layout, vertex: { module: mCloth, entryPoint: 'vsMirror', buffers: [f3(0), f3(1), f2(2), f2(3), f3(4), f3(5)] }, fragment: { module: mCloth, entryPoint: 'fsMirror', targets: [{ ...hdrTarget, blend: mb }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: mDepth, multisample: { count: msaa } });
  }
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('boat-ribbon', { layout, vertex: { module: mRib, entryPoint: 'vs', buffers: [f3(0), f3(1), f1(2), f1(3), f3(4)] }, fragment: { module: mRib, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  // #20: the details (telltales, vane, flag) write their depth: drawn before the water and the sky, which would cover any
  // line over the lake or the sky (the ropes are mostly over the cloth and the hull, the vane and the leech yarns are not)
  // perf(v2) iOS pipelines: the details and the jib's yarns through the cloth are a group ('boatDetail', after the first
  // frame); the rigging's lines ('boat-ribbon') draw from the first
  const prevDetail = reg.group?.('boatDetail');
  reg.add('boat-detail', { layout, vertex: { module: mRib, entryPoint: 'vs', buffers: [f3(0), f3(1), f1(2), f1(3), f3(4)] }, fragment: { module: mRib, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  // #20: the jib's telltales seen through the cloth: the same lines where they are behind (reversed depth: 'less')
  reg.add('boat-ribbon-ghost', { layout, vertex: { module: mRib, entryPoint: 'vs', buffers: [f3(0), f3(1), f1(2), f1(3), f3(4)] }, fragment: { module: mRib, entryPoint: 'fsGhost', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'less' }, multisample: { count: msaa } });
  if (prevDetail != null) reg.group(prevDetail);
  const detailIn = () => (reg.groupOf ? reg.ready(reg.groupOf('boat-detail')) : true);
  const mSS = reg.shader('boat-shadow-solid', SHADOW_SOLID_WGSL(frameStruct)), mSC = reg.shader('boat-shadow-cloth', SHADOW_CLOTH_WGSL(frameStruct));
  const shadowDepth = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
  reg.add('boat-shadow-solid', { layout, vertex: { module: mSS, entryPoint: 'vs', buffers: [f3(0)] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: shadowDepth });
  reg.add('boat-shadow-cloth', { layout, vertex: { module: mSC, entryPoint: 'vs', buffers: [f3(0), f3(1), f2(2), f2(3)] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: shadowDepth });

  // per-frame state
  const T = { a: mat4(), b: mat4(), c: mat4(), d: mat4() };
  const Mroot = mat4(), Mrig = mat4(), Mboom = mat4(), Nmat = mat4(), Mwheel = mat4(), Mtrav = mat4(), Mrud = mat4(), Mcard = mat4(), Mpod = mat4(), Mvhf = mat4(), Manchor = mat4(), Minv = mat4();
  const WHEEL_AT = vessel.sockets?.wheel ?? [0, 1.2, 2.59];   // the wheel's axle (the profile's sockets.wheel, as body.js)
  let fade = 0, fadeT0 = null, drawHull = true;   // the swap: 0 the M3 hull only ... 1 v1's models only
  const ranges = [];
  const { HULL } = dims;
  const MAST_TRUCK = [0, HULL.mastStepY + dims.RIG.mastTop + 0.05, HULL.mastStepZ];   // the anchor light (main.js MAST_HEAD)
  const pin = [0, parts.rig.S.gooseneck, parts.rig.S.goosenZ];
  let lineCount = 0, sailFills = 0, cpuMs = 0, drawnTriangles = 0;
  const lineBuf = [];
  // the normal matrix: for a rotation + translation the upper 3 × 3 of the model itself
  const writeSlot = (slot, m, p, q, r = R0, w = null) => {
    const o = (STRIDE / 4) * slot;
    models.set(m, o); Nmat.set(m); Nmat[12] = Nmat[13] = Nmat[14] = 0; models.set(Nmat, o + 16);
    models[o + 32] = p[0]; models[o + 33] = p[1]; models[o + 34] = p[2]; models[o + 35] = p[3];
    models[o + 36] = q[0]; models[o + 37] = q[1]; models[o + 38] = q[2]; models[o + 39] = q[3];
    models[o + 40] = r[0]; models[o + 41] = r[1]; models[o + 42] = r[2]; models[o + 43] = r[3];
    if (w) models.set(w, o + 44); else models.fill(0, o + 44, o + 44 + PATCH_FLOATS);   // the water under the boat (none: never under water)
  };
  // the water under a boat (render/boat/waterline.js): the drawn surface's heights round her, in her own axes (the root's z
  // column), once a frame; without a water (a test page) a flat water at her heave. opts: water.heightAt's (coarse: a rival)
  const WP = new Float32Array(PATCH_FLOATS), playerOpt = { t: 0 }, rivalOpt = { t: 0, coarse: true };
  let patchMs = 0;
  const patchFor = (out, M, heave, opt) => {
    const p0 = performance.now();
    fillPatch(out, M[12], M[14], M[8], M[10], waterAt ? (x, z) => waterAt(x, z, opt) : heave);
    patchMs += performance.now() - p0;
    return out;
  };
  const P0 = [0, 0, 0, 0], Q0 = [0, 0, 0, 0];
  const SHADOW_PARTS = [['wheel', SLOT.wheel], ['traveller', SLOT.trav], ['anchor', SLOT.anchor]];
  let anchorShown = true;   // #8
  const RODE_DARK = [0.024, 0.023, 0.02], rodeLine = { name: 'rode', points: [], diameterM: -0.022, color: RODE_DARK }, rodeBuf = [];   // #8: v1's 0x2b2a27 chain (linear); its points reused. The anchor seen (2026-11-17): drawn as its links' width (22 mm for the 8 mm chain) and a detail line (negative: at least 2.2 px wide and opaque, as the telltales), so it reads from the Boat view at any distance
  const pennantLine = { name: 'pennant', points: [], diameterM: 0.016, color: [0.686, 0.631, 0.509] }, pennantBuf = [];   // A2: v1's 0xd8d0bc rope (linear); its points reused
  // R4: the near rivals' records this frame (their poses from setRivals): the matrices as the player's, the sails refilled on the CPU
  // only when their quantised trim moved and at most one rival a frame (a refill is about 1 ms for both sails), the topsides' tint in p.w
  function updateRivals(t, focalPx) {
    rivalFrame++;
    let refilled = false;
    for (let k = 0; k < nRivals; k++) {
      const r = rivals[live[(rivalFrame + k) % nRivals]], p = r.pose, b = r.base;
      translate(T.a, p.x, p.heave, p.z); rotY(T.b, -p.heading); multiply(T.c, T.a, T.b);
      rotX(T.a, p.pitch); multiply(T.d, T.c, T.a); rotZ(T.b, -p.heel); multiply(r.Mroot, T.d, T.b);
      translate(T.a, 0, HULL.mastStepY, HULL.mastStepZ); multiply(r.Mrig, r.Mroot, T.a);
      translate(T.a, pin[0], pin[1], pin[2]); multiply(T.c, r.Mrig, T.a); rotY(T.b, p.boomAngle); multiply(r.Mboom, T.c, T.b);
      translate(T.a, 0, 0, HULL.rudderZ); multiply(T.c, r.Mroot, T.a); rotY(T.b, -p.rudderAngle); multiply(T.d, T.c, T.b); translate(T.a, 0, 0, -HULL.rudderZ); multiply(r.Mrud, T.d, T.a);
      RP[0] = focalPx; RP[1] = t; RP[2] = 0; RP[3] = p.tint; RQ[0] = 0; RQ[1] = 0; RQ[2] = 1; RQ[3] = 0;
      rivalOpt.t = t; patchFor(r.W, r.Mroot, p.heave, rivalOpt);   // her keel and rudder under the water she sails in (or over it, heeled)
      writeSlot(b + RIVAL_SLOT.hull, r.Mroot, RP, RQ, R0, r.W);
      RP[2] = 1; writeSlot(b + RIVAL_SLOT.glb, r.Mroot, RP, RQ, R0, r.W);
      RP[2] = 0; RP[3] = 0;
      writeSlot(b + RIVAL_SLOT.keel, r.Mroot, RP, RQ, R0, r.W); writeSlot(b + RIVAL_SLOT.rudder, r.Mrud, RP, RQ, R0, r.W);
      RQ[3] = HULL.mastStepY; writeSlot(b + RIVAL_SLOT.rig, r.Mrig, RP, RQ);
      RQ[2] = 0; RQ[3] = 0; writeSlot(b + RIVAL_SLOT.boom, r.Mboom, RP, RQ);
      const key = rivalSailKey(p);
      if (p.bare) continue;   // a boat at anchor (v2/sim/anchoredBoats.js): her sails stowed, none filled or written
      if (key !== r.key && (!refilled || r.fresh)) {   // a slot newly bound to a boat fills at once (never a frame of another boat's sails)
        if (!r.fresh) refilled = true;
        r.fresh = false; r.key = key; rivalFills++;
        const dm = r.desc.main, dj = r.desc.jib;
        dm.boomRad = Math.round(p.boomAngle / 0.02) * 0.02; dm.fill = Math.round(p.mainFill * 10) / 10; dm.draft = Math.round(p.mainDraft * 10) / 10;
        dj.sheetRad = Math.round(p.jibAngle / 0.02) * 0.02; dj.fill = Math.round(p.jibFill * 10) / 10; dj.draft = Math.round(p.jibDraft * 10) / 10; dj.backed = p.jibBacked ? 1 : 0;
        for (const rs of r.sails) {
          rs.hoist = fillSail(rs.g, rs.fn, rs.name === 'main' ? dm : dj);
          device.queue.writeBuffer(rs.pos, 0, rs.g.position); device.queue.writeBuffer(rs.nrm, 0, rs.g.normal); device.queue.writeBuffer(rs.met, 0, rs.g.metric); device.queue.writeBuffer(rs.fln, 0, rs.g.flatN); device.queue.writeBuffer(rs.tan, 0, rs.g.tanU);
        }
      }
      for (const rs of r.sails) {
        const main = rs.name === 'main', d = main ? r.desc.main : r.desc.jib;
        RP[0] = focalPx; RP[1] = t; RP[2] = 1 - Math.min(1, Math.max(0, d.fill)); RP[3] = RP[2];
        RQ[0] = rs.hoist; RQ[1] = main ? RIG.boom : RIG.jibLP; RQ[2] = main ? 1 : 0; RQ[3] = 0;
        writeSlot(b + (main ? RIVAL_SLOT.main : RIVAL_SLOT.jib), r.Mrig, RP, RQ, artR && p.art > 0 ? artR[Math.min(artR.length - 1, p.art)] : R0);   // the jib takes her cloth too (the print is the main's only)
      }
    }
  }
  // the near rivals' draws (the scene's pipelines, no new one): the M3 hull until v1's models are resident, then the models' static
  // ranges without the cabin; the keel, the rudder, the spars; the cloth. shadow: the depth into the player's map, only for a rival
  // within 20 m of her (the map's box is 10.5 m each way round her)
  function drawRivals(pass, c, shadow = false) {
    const glb = gm.ready, g2 = shadow ? bgShadow : bg;
    let any = false;
    for (let k = 0; k < nRivals; k++) {
      const r = rivals[live[k]];
      if (shadow && Math.hypot(r.pose.x - playerAt[0], r.pose.z - playerAt[1]) > 20) continue;
      any = true;
      pass.setPipeline(reg.get(shadow ? 'boat-shadow-solid' : underPipe(reg, 'boat-solid')));
      for (const sd of solids) {
        if (sd.slot === SLOT.hull && glb) continue;
        const slot = r.base + (sd.slot === SLOT.hull ? RIVAL_SLOT.hull : sd.slot === SLOT.keel ? RIVAL_SLOT.keel : sd.slot === SLOT.rudder ? RIVAL_SLOT.rudder : sd.slot === SLOT.rig ? RIVAL_SLOT.rig : RIVAL_SLOT.boom);
        pass.setBindGroup(2, g2, [slot * STRIDE]);
        pass.setVertexBuffer(0, sd.pos);
        if (!shadow) { pass.setVertexBuffer(1, sd.nrm); pass.setVertexBuffer(2, sd.col); pass.setVertexBuffer(3, sd.mr); }
        pass.setIndexBuffer(sd.idx, sd.fmt); pass.drawIndexed(sd.count); c.calls++; c.triangles += sd.count / 3; if (!shadow) drawnTriangles += sd.count / 3;
      }
      if (glb) {
        if (shadow) gm.bindVB(pass, false); else { pass.setBindGroup(3, gm.bg); gm.bindVB(pass); pass.setPipeline(reg.get(underPipe(reg, 'boat-glb'))); }
        pass.setBindGroup(2, g2, [(r.base + RIVAL_SLOT.glb) * STRIDE]);
        for (const name of RIVAL_RANGES) { const g = gm.range(name); if (!g.count) continue; pass.drawIndexed(g.count, 1, g.first); c.calls++; c.triangles += g.count / 3; if (!shadow) drawnTriangles += g.count / 3; }
      }
      if (r.pose.bare) continue;   // at anchor: bare poles, no cloth drawn
      pass.setPipeline(reg.get(shadow ? 'boat-shadow-cloth' : 'boat-cloth'));
      for (const rs of r.sails) {
        pass.setBindGroup(2, g2, [(r.base + (rs.name === 'main' ? RIVAL_SLOT.main : RIVAL_SLOT.jib)) * STRIDE]);
        pass.setVertexBuffer(0, rs.pos); pass.setVertexBuffer(1, rs.nrm); pass.setVertexBuffer(2, rs.uv); pass.setVertexBuffer(3, rs.met);
        if (!shadow) { pass.setVertexBuffer(4, rs.fln); pass.setVertexBuffer(5, rs.tan); }
        pass.setIndexBuffer(rs.idx, 'uint16'); pass.drawIndexed(rs.g.index.length); c.calls++; c.triangles += rs.g.triangles; if (!shadow) drawnTriangles += rs.g.triangles;
      }
    }
    if (shadow && any) rivalShadowN++;
  }
  return {
    hull, parts, sails, wires, buildMs, bgl, bg, shadowView, SLOT,
    shadowRead: { view: shadowView, sampler: sCmp, buffer: sbuf },   // phase 2b: the hull's shadow column in the light shafts (render/underLight.js)
    sailArt: artOn ? { bytes: atlas.bytes, bakeMs: atlas.bakeMs } : null,   // the mainsail's graphics (null: ?sailart=off)
    // the rivals' sails (1-5: FLEET's order): each one's number, cloth and inks (render/sailArt.js boatArt), kept across races
    setRivalArt(list) { if (!artR) return; list.forEach((b, i) => { if (b) artR[i + 1] = packArt(b); }); },
    // R4: the near rivals at full detail this frame (n up to MAX_NEAR_RIVALS; poses: { x, heave, z, heading, heel, pitch, boomAngle,
    // jibAngle, mainFill, jibFill, mainDraft, jibDraft, jibBacked, rudderAngle, tint (packTint), bare (sails stowed: a boat at anchor) },
    // copied); n = 0: nothing written or drawn
    // key (the boat's id): a slot stays bound to her while she is near; a boat new to the near set takes a free slot, its sails filled
    // at once; without keys, slot i is pose i
    setRivals(n, poses = null) {
      nRivals = Math.max(0, Math.min(MAX_NEAR_RIVALS, n | 0));
      used.fill(0); live.length = nRivals;
      for (let i = 0; i < nRivals; i++) { const key = poses[i].key; let j = key == null ? i : rivals.findIndex((r) => r.boat === key); if (j >= 0 && used[j]) j = -1; live[i] = j; if (j >= 0) used[j] = 1; }
      for (let i = 0; i < nRivals; i++) if (live[i] < 0) { const j = used.indexOf(0); live[i] = j; used[j] = 1; rivals[j].boat = poses[i].key ?? null; rivals[j].key = -1; rivals[j].fresh = true; }
      for (let j = 0; j < MAX_NEAR_RIVALS; j++) if (!used[j]) rivals[j].boat = null;   // a boat gone from the near set frees her slot
      for (let i = 0; i < nRivals; i++) {
        const q = poses[i], o = rivals[live[i]].pose;
        o.x = q.x; o.heave = q.heave ?? 0; o.z = q.z; o.heading = q.heading ?? 0; o.heel = q.heel ?? 0; o.pitch = q.pitch ?? 0;
        o.boomAngle = q.boomAngle ?? 0; o.jibAngle = q.jibAngle ?? 0; o.mainFill = q.mainFill ?? 1; o.jibFill = q.jibFill ?? 1; o.mainDraft = q.mainDraft ?? 1; o.jibDraft = q.jibDraft ?? 1;
        o.jibBacked = q.jibBacked ? 1 : 0; o.rudderAngle = q.rudderAngle ?? 0; o.tint = q.tint ?? 0; o.bare = q.bare ? 1 : 0; o.art = q.art ?? 0;
      }
    },
    get rivals() { return { n: nRivals, fills: rivalFills, shadows: rivalShadowN, max: MAX_NEAR_RIVALS, slots: rivals.map((r) => r.boat) }; },
    get triangles() { return drawnTriangles; },
    // the crew's frame (render/boatCrew.js): the hull's matrix this frame and the drawn boom, rudder, heel and
    // pitch, the heave, the speed and the yaw rate the people on board move to and balance against (null before the first update)
    get crewFrame() { if (DPOSE.x == null) return null; CREWF.M = Mroot; CREWF.heel = DPOSE.heel ?? 0; CREWF.pitch = DPOSE.pitch ?? 0; CREWF.boom = DPOSE.boomAngle ?? 0; CREWF.rudder = DPOSE.rudderAngle ?? 0; CREWF.heave = DPOSE.heave ?? 0; CREWF.u = DPOSE.u ?? 0; CREWF.yawRate = DPOSE.yawRate ?? 0; return CREWF; },
    get stats() { const m = gm.stats; return { instruments: inst.stats, lines: lineCount, sailFills, cpuMs: +cpuMs.toFixed(3), waterPatchMs: +patchMs.toFixed(3), buildMs: +buildMs.toFixed(1), hullTriangles: hull.triangles, mastTriangles: parts.mast.triangles, boomTriangles: parts.boom.triangles, ribbonPoints: R.points,
      models: { phase: m.phase, wireBytes: m.wireBytes, files: m.files, bytes: m.bytes, triangles: m.triangles, materials: m.materials, images: m.images, queued: m.queued, uploadFrames: m.uploadFrames, uploadMsMax: +m.uploadMsMax.toFixed(2), buildMs: +(m.buildMs ?? 0).toFixed(1), decodeMs: +(m.decodeMs ?? 0).toFixed(1), error: m.error, lodNear: gm.lod.near, lodDetail: gm.lod.detail }, fade: +fade.toFixed(3) }; },
    // pose: the drawn state (x, heave, z, heading, heel, pitch, boomAngle, the sails' fill…); t the sim time (the flutter);
    // focalPx the projection's focal length in pixels (the ribbons' width); sun the direction toward the sun
    // kd: the knockdown's look (v2/sim/knockdownFx.js: { mix, flog, wild }, null or all 0 upright: nothing drawn differently)
    update(pose0, { t = 0, focalPx = 1000, sun = [0, 1, 0], debug = 0, eye = null, instant = false, vhf = null, pxScale = 1, viewH = 720, kd = null } = {}) {   // pxScale: backing px a CSS px; viewH: the view's CSS height (the telltales' floor on screen)
      const c0 = performance.now();
      const pose = drawnPose(pose0, DPOSE);   // the drawn trim (boat/drawnTrim.js): the boom and the clew follow the sheet's slack; the physics' pose untouched
      // K2: past 34° of heel (q.x the switch, q.y the boat's heave) the hull's lived-in look (render/boatModels.js); the sails flog
      // and the vane and yarns go wild. What is drawn over or under the water is the water patch's (every heel)
      const kdM = kd?.mix > 0 ? kd.mix : 0, kdY = pose.heave ?? 0;
      pose.kdWild = kd?.wild > 0 ? kd.wild : 0;
      // the swap (M3b): once v1's models are resident, they dissolve in over SWAP_S while the M3 hull dissolves out (the
      // two share the Blender build's lines, so only the detail appears); a capture (instant) takes them at once
      if (gm.ready && fade < 1) { if (instant) fade = 1; else { fadeT0 ??= c0; fade = Math.min(1, (c0 - fadeT0) / 1000 / SWAP_S); } }
      drawHull = fade < 1;
      if (eye && gm.ready) gm.updateLod(Math.hypot(eye[0] - pose.x, eye[1] - (pose.heave ?? 0), eye[2] - pose.z));
      // Boat.update: position (x, heave, z) · Ry(−heading) · Rx(pitch) · Rz(−heel)
      translate(T.a, pose.x, pose.heave ?? 0, pose.z); rotY(T.b, -pose.heading); multiply(T.c, T.a, T.b);
      rotX(T.a, pose.pitch ?? 0); multiply(T.d, T.c, T.a); rotZ(T.b, -(pose.heel ?? 0)); multiply(Mroot, T.d, T.b);
      translate(T.a, 0, HULL.mastStepY, HULL.mastStepZ); multiply(Mrig, Mroot, T.a);
      translate(T.a, pin[0], pin[1], pin[2]); multiply(T.c, Mrig, T.a); rotY(T.b, pose.boomAngle ?? 0); multiply(Mboom, T.c, T.b);
      P0[0] = focalPx; P0[1] = t; P0[2] = 0; P0[3] = 0;
      // q for the solids: (0, 0, underwaterOn, yOffset): the hull frame's y is the local y; the rig's is offset by the step
      // the water under her (render/boat/waterline.js): what is under the drawn surface is seen through the water, what is over it
      // in the air (heeled hard, knocked down, rolled: the keel and the rudder lit and wet)
      patchMs = 0; playerOpt.t = t; patchFor(WP, Mroot, kdY, playerOpt);
      const hullTint = pose0.hullTint ?? playerTint;   // the race livery: her topsides' colour on the hull and the model slots only
      P0[2] = fade; P0[3] = hullTint; writeSlot(SLOT.hull, Mroot, P0, [kdM, kdY, 1, 0], R0, WP); P0[2] = 0; P0[3] = 0;
      writeSlot(SLOT.keel, Mroot, P0, [kdM, kdY, 1, 0], R0, WP);
      // the rudder about its stock (Boat.js: rotation.y = -rudderAngle), the wheel 4 x the rudder (clockwise to starboard as the helmsman sees it)
      const ra = pose.rudderAngle ?? 0;
      translate(T.a, 0, 0, HULL.rudderZ); multiply(T.c, Mroot, T.a); rotY(T.b, -ra); multiply(T.d, T.c, T.b); translate(T.a, 0, 0, -HULL.rudderZ); multiply(Mrud, T.d, T.a);
      writeSlot(SLOT.rudder, Mrud, P0, [kdM, kdY, 1, 0], R0, WP);
      if (gm.ready) {
        P0[2] = fade; P0[3] = hullTint; writeSlot(SLOT.glb, Mroot, P0, [kdM, kdY, 1, 0], R0, WP); P0[3] = 0;
        translate(T.a, WHEEL_AT[0], WHEEL_AT[1], WHEEL_AT[2]); multiply(T.c, Mroot, T.a); rotZ(T.b, -ra * 4); multiply(Mwheel, T.c, T.b);
        writeSlot(SLOT.wheel, Mwheel, P0, [0, 0, 0, 0]);
        // the traveller car slides with the boom (craft/sloop/rig.js: x0 + travellerCarX, y on the crowned track)
        const tr = gm.set.traveller, tx = tr.x0 + travellerCarX(pose.boomAngle ?? 0, pose.traveller ?? 0);   // pro: the traveller's own slide (v1)
        translate(T.a, tx, trackY(tx) ?? tr.y0, tr.z0); multiply(Mtrav, Mroot, T.a);
        writeSlot(SLOT.trav, Mtrav, P0, [0, 0, 0, 0]);
        // #8: the anchor on its socket, lowered along the hull's −y as the chain runs out (v2/sim/seamanship.js; v1's seamanship
        // post: the 'anchor' socket's y0 − drop); its waterline cut moves with it (q.w), so its shank goes under the surface
        const drop = pose.anchorDrop ?? 0; anchorShown = pose.anchorShown !== false;
        translate(T.a, 0, -drop, 0); multiply(Manchor, Mroot, T.a); writeSlot(SLOT.anchor, Manchor, P0, [kdM, kdY, 1, -drop], R0, WP);
        P0[2] = 0;
        // M4: the instruments (v1's createInstruments on the hull socket): the card holds north (three's rotation.x = −90°,
        // then rotation.z = the heading), the pod leans 25° (rotation.x); the faces redrawn when a reading moves
        const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
        const ir = inst.update(pose, { t, sunElevDeg: Math.asin(Math.max(-1, Math.min(1, sun[1] / sl))) * 180 / Math.PI, vhf });
        multiply(Mcard, Mroot, cardLocal(T.a, ir.cardAngle)); multiply(Mpod, Mroot, podLocal(T.a));
        writeSlot(SLOT.inst, Mroot, inst.P.hull, inst.Q.hull); writeSlot(SLOT.card, Mcard, inst.P.card, inst.Q.card); writeSlot(SLOT.pod, Mpod, inst.P.pod, inst.Q.pod);
        multiply(Mvhf, Mroot, vhfLocal(T.a)); writeSlot(SLOT.vhf, Mvhf, inst.P.vhf, inst.Q.vhf);   // #35: v1's VHF set on the guard
      }
      writeSlot(SLOT.rig, Mrig, P0, [kdM, kdY, 1, HULL.mastStepY]);
      writeSlot(SLOT.boom, Mboom, P0, [0, 0, 0, 0]);
      // the sails: the steady shape on the CPU only when trim, fill, draft or reef move (v1); the flutter rides on the GPU
      const sp = drawnSail(sailParams(pose), pose.proBackstay ?? null);   // the Pro shape changes drawn larger (boat/drawnTrim.js)
      for (const s of sails) {
        const d = s.name === 'main' ? sp.main : sp.jib;
        // the Pro shape (twist, lead, the bands' fills) is in the key: a vang or a lead alone refills the cloth (it waited on another change)
        const key = `${d.boomRad?.toFixed(3) ?? ''}|${d.sheetRad?.toFixed(3) ?? ''}|${d.fill.toFixed(2)}|${d.draft.toFixed(2)}|${d.reef ?? 0}|${d.furl ?? 0}|${d.backed ?? 0}|${d.drop ?? 0}|${(d.twistX ?? 0).toFixed(2)}|${(d.lead ?? 0).toFixed(2)}|${(d.fillLow ?? -1).toFixed(2)}|${(d.fillTop ?? -1).toFixed(2)}|${(d.trav ?? 0).toFixed(2)}`;
        if (key !== s.key) {
          s.key = key; s.hoist = fillSail(s.g, s.fn, d); sailFills++;
          device.queue.writeBuffer(s.pos, 0, s.g.position); device.queue.writeBuffer(s.nrm, 0, s.g.normal); device.queue.writeBuffer(s.met, 0, s.g.metric); device.queue.writeBuffer(s.fln, 0, s.g.flatN); device.queue.writeBuffer(s.tan, 0, s.g.tanU);
        }
        let luff = 1 - Math.min(1, Math.max(0, d.fillLow ?? d.fill)), luffTop = 1 - Math.min(1, Math.max(0, d.fillTop ?? d.fill));
        if (kd?.flog > 0) { luff = Math.max(luff, kd.flog); luffTop = Math.max(luffTop, kd.flog); }   // K2: the sails flogging as the rig meets the water
        const ds = DSAILS[s.name]; ds.g = s.g; ds.luff = luff; ds.luffTop = luffTop;
        ds.shown = s.name === 'main' ? (d.drop ?? 0) < 0.3 : (d.furl ?? 0) < 0.6 && s.hoist > 1;
        writeSlot(s.slot, Mrig, [focalPx, t, luff, luffTop], [s.hoist, s.name === 'main' ? RIG.boom : RIG.jibLP * (1 - (d.furl ?? 0)), s.name === 'main' ? 1 : 0, debug || 0], artR ? artR[0] : R0);   // both sails in her cloth; the print on the main
      }
      //: the gennaker while it is up (its shape refilled when the physics' hoist, fill, side or chord move)
      const gd = gkDesc(pose);
      gk.shown = !!gd;
      if (gd) {
        const key = `${gd.deploy.toFixed(3)}|${gd.fill.toFixed(2)}|${gd.angle.toFixed(3)}|${gd.side.toFixed(2)}|${gd.bang.toFixed(1)}`;
        if (key !== gk.key) {
          gk.key = key; gk.hoist = fillSail(gk.g, gk.fn, gd); sailFills++;
          device.queue.writeBuffer(gk.pos, 0, gk.g.position); device.queue.writeBuffer(gk.nrm, 0, gk.g.normal); device.queue.writeBuffer(gk.met, 0, gk.g.metric); device.queue.writeBuffer(gk.fln, 0, gk.g.flatN); device.queue.writeBuffer(gk.tan, 0, gk.g.tanU);
        }
        const open = gd.lift;   // round 2: the sock's lift (gkDesc)
        const luffG = open > 0 ? 1 - gd.fill : 0, luffT = Math.max(luffG, kd?.flog ?? 0);
        writeSlot(SLOT.gk, Mrig, [focalPx, t, Math.max(luffG, kd?.flog ?? 0), luffT], [gk.hoist, GK_DRAW.foot, 2, debug || 0]);
      }
      // the lines (every frame: the sheets move with the trim) and the wires, one ribbon buffer
      lineBuf.length = 0;
      for (const l of lineSet(pose, t)) lineBuf.push(l);
      for (const w of wires) lineBuf.push(w);
      // #8: the anchor's rode from the roller toward the anchor (world points → the rig slot's frame), v1's dark chain
      if (pose.rode?.length >= 2) {
        invert(Minv, Mrig);
        const P = rodeLine.points; P.length = 0; rodeLine.color = pose.rodeColor ?? RODE_DARK;   // the gear drawn close: its own grey (render/anchorGear.js)
        pose.rode.forEach((q, i) => { const o = rodeBuf[i] ?? (rodeBuf[i] = [0, 0, 0]); o[0] = Minv[0] * q[0] + Minv[4] * q[1] + Minv[8] * q[2] + Minv[12]; o[1] = Minv[1] * q[0] + Minv[5] * q[1] + Minv[9] * q[2] + Minv[13]; o[2] = Minv[2] * q[0] + Minv[6] * q[1] + Minv[10] * q[2] + Minv[14]; P.push(o); });
        lineBuf.push(rodeLine);
      }
      // A2: moored, the pennant from the roller to the ball (world points → the rig slot's frame), drawn as the rode
      if (pose.pennant?.length >= 2) {
        invert(Minv, Mrig);
        const P = pennantLine.points; P.length = 0;
        pose.pennant.forEach((q, i) => { const o = pennantBuf[i] ?? (pennantBuf[i] = [0, 0, 0]); o[0] = Minv[0] * q[0] + Minv[4] * q[1] + Minv[8] * q[2] + Minv[12]; o[1] = Minv[1] * q[0] + Minv[5] * q[1] + Minv[9] * q[2] + Minv[13]; o[2] = Minv[2] * q[0] + Minv[6] * q[1] + Minv[10] * q[2] + Minv[14]; P.push(o); });
        lineBuf.push(pennantLine);
      }
      fillRibbons(R, lineBuf); lineCount = lineBuf.length;
      const nv = R.points * 2;
      device.queue.writeBuffer(ribbon.pos, 0, R.position, 0, nv * 3); device.queue.writeBuffer(ribbon.oth, 0, R.other, 0, nv * 3);
      device.queue.writeBuffer(ribbon.side, 0, R.side, 0, nv); device.queue.writeBuffer(ribbon.diam, 0, R.diam, 0, nv); device.queue.writeBuffer(ribbon.col, 0, R.color, 0, nv * 3);
      device.queue.writeBuffer(ribbon.idx, 0, R.index, 0, R.indices);
      // #20: the telltales, the vane and the flag, from the physics' trim and winds (the drawn sails' grids for the yarns' roots)
      if (detailsShown) {
        const dist = eye ? Math.hypot(eye[0] - pose.x, eye[1] - (pose.heave ?? 0) - 5, eye[2] - pose.z) : 0;   // to the rig's middle
        const dl = details.update(pose, t, DSAILS, { instant, ppm: dist > 0.5 ? focalPx / dist / Math.max(pxScale, 1e-3) : 0, viewH });
        fillRibbons(RD, dl);
        jibIdx = details.jibLines * TELL_SEGS * 6;
        const nd = RD.points * 2;
        device.queue.writeBuffer(detailRib.pos, 0, RD.position, 0, nd * 3); device.queue.writeBuffer(detailRib.oth, 0, RD.other, 0, nd * 3);
        device.queue.writeBuffer(detailRib.side, 0, RD.side, 0, nd); device.queue.writeBuffer(detailRib.diam, 0, RD.diam, 0, nd); device.queue.writeBuffer(detailRib.col, 0, RD.color, 0, nd * 3);
        device.queue.writeBuffer(detailRib.idx, 0, RD.index, 0, RD.indices);
      }
      if (nRivals) updateRivals(t, focalPx);
      playerAt[0] = pose.x; playerAt[1] = pose.z;
      device.queue.writeBuffer(mbuf, 0, models);
      // the shadow's light box: centred on the boat (its mast's middle), from SHADOW.depth / 2 up-sun
      const cx = pose.x, cy = (pose.heave ?? 0) + 5, cz = pose.z;
      const sd = [sun[0], sun[1], sun[2]], sl = Math.hypot(sd[0], sd[1], sd[2]) || 1; sd[0] /= sl; sd[1] /= sl; sd[2] /= sl;
      const on = sd[1] > SHADOW_OFF_Y ? 1 : 0;   // on until the sun is 2° down (it lights the boat to the dip, −1.4°): off at +0.57° the cockpit lost its own shade at once on a setting sun
      shadowDue = shadowEvery <= 1 || !shadowDrawn || on !== lastOn || (shadowWhen ? shadowWhen() : shadowN % shadowEvery === 1 % shadowEvery);
      shadowN++;
      if (shadowDue) {
        const e = [cx + sd[0] * SHADOW.depth / 2, cy + sd[1] * SHADOW.depth / 2, cz + sd[2] * SHADOW.depth / 2];
        lightView(T.a, e, [-sd[0], -sd[1], -sd[2]]); ortho(T.b, SHADOW.half, 0, SHADOW.depth); multiply(T.c, T.b, T.a);
        shadowU.set(T.c, 0); shadowU[16] = sd[0]; shadowU[17] = sd[1]; shadowU[18] = sd[2]; shadowU[19] = on;
        Mlast.set(T.c); shC[0] = cx; shC[1] = cy; shC[2] = cz; lastOn = on; shadowDrawn = true;
      } else {   // the standing map: its matrix × a translation by the boat's move since the draw (the sun's row kept)
        const dx = cx - shC[0], dy = cy - shC[1], dz = cz - shC[2];
        Mnow.set(Mlast);
        for (let r = 0; r < 4; r++) Mnow[12 + r] = Mlast[12 + r] - (Mlast[r] * dx + Mlast[4 + r] * dy + Mlast[8 + r] * dz);
        shadowU.set(Mnow, 0);
      }
      navLightsInto(shadowU, Mroot, Math.asin(Math.max(-1, Math.min(1, sd[1]))) * 180 / Math.PI, !!pose0.anchorLight, HULL, MAST_TRUCK);
      device.queue.writeBuffer(sbuf, 0, shadowU);
      cpuMs = performance.now() - c0;
    },
    // the frame's first pass: the boat's depth from the sun into the shadow map (one encoder-level render pass)
    shadow(enc, c, timestampWrites = undefined) {
      if (!shadowDue) return false;   // perf(v2) phone round 2: the map stands this frame (no pass: a tile GPU would load and store it)
      const pass = enc.beginRenderPass({ label: 'boat-shadow', colorAttachments: [], depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, timestampWrites });
      if (shadowU[19] > 0) {   // the sun up: else the map stays clear (everything lit by the sky alone)
        pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, sky.skyBG);
        pass.setPipeline(reg.get('boat-shadow-solid'));
        for (const s of solids) { if (s.slot === SLOT.hull && !drawHull) continue; pass.setBindGroup(2, bgShadow, [s.slot * STRIDE]); pass.setVertexBuffer(0, s.pos); pass.setIndexBuffer(s.idx, s.fmt); pass.drawIndexed(s.count); c.calls++; c.triangles += s.count / 3; }
        if (gm.ready) {   // M3b: v1's models cast the boat's shadow too (the LOD's choice, the wheel, the car)
          gm.bindVB(pass, false);
          pass.setBindGroup(2, bgShadow, [SLOT.glb * STRIDE]);
          for (const r of gm.staticRanges(ranges)) { const g = gm.range(r); if (g.count) { pass.drawIndexed(g.count, 1, g.first); c.calls++; c.triangles += g.count / 3; } }
          for (const [r, slot] of SHADOW_PARTS) { const g = gm.range(r); if (!g.count || (slot === SLOT.anchor && !anchorShown)) continue; pass.setBindGroup(2, bgShadow, [slot * STRIDE]); pass.drawIndexed(g.count, 1, g.first); c.calls++; c.triangles += g.count / 3; }
        }
        if (nRivals) drawRivals(pass, c, true);   // R4: a near rival within 20 m casts into the player's map (beyond it, outside the light box)
        pass.setPipeline(reg.get('boat-shadow-cloth'));
        for (const s of gk.shown ? [...sails, gk] : sails) { pass.setBindGroup(2, bgShadow, [s.slot * STRIDE]); pass.setVertexBuffer(0, s.pos); pass.setVertexBuffer(1, s.nrm); pass.setVertexBuffer(2, s.uv); pass.setVertexBuffer(3, s.met); pass.setIndexBuffer(s.idx, 'uint16'); pass.drawIndexed(s.g.index.length); c.calls++; c.triangles += s.g.triangles; }
      }
      pass.end();
      return true;
    },
    // in the scene pass, after the terrain and before the water (group 0 bound by the caller)
    draw(pass, c) {
      drawnTriangles = 0;
      pass.setBindGroup(1, sky.skyBG);
      const glb = gm.ready;
      const glbDraw = (name, slot) => { const g = gm.range(name); if (!g.count) return; pass.setBindGroup(2, bg, [slot * STRIDE]); pass.drawIndexed(g.count, 1, g.first); c.calls++; c.triangles += g.count / 3; drawnTriangles += g.count / 3; };
      if (glb && gm.lod.near) {
        // M3b: the cabin first, then the portal's depth (cockpitLook.js: where the opening is seen, the hull's face behind it fails)
        pass.setBindGroup(3, gm.bg); gm.bindVB(pass);
        pass.setPipeline(reg.get('boat-glb-cabin')); glbDraw('cabin', SLOT.glb);
        pass.setPipeline(reg.get('boat-glb-portal')); glbDraw('portal', SLOT.glb);
      }
      pass.setPipeline(reg.get(underPipe(reg, 'boat-solid')));
      for (const s of solids) {
        if (s.slot === SLOT.hull && !drawHull) continue;
        pass.setBindGroup(2, bg, [s.slot * STRIDE]);
        pass.setVertexBuffer(0, s.pos); pass.setVertexBuffer(1, s.nrm); pass.setVertexBuffer(2, s.col); pass.setVertexBuffer(3, s.mr);
        pass.setIndexBuffer(s.idx, s.fmt); pass.drawIndexed(s.count); c.calls++; c.triangles += s.count / 3; drawnTriangles += s.count / 3;
      }
      if (glb) {   // M3b: v1's models (the LOD's static ranges, the wheel, the traveller car)
        pass.setBindGroup(3, gm.bg); gm.bindVB(pass);
        pass.setPipeline(reg.get(underPipe(reg, 'boat-glb')));
        for (const r of gm.staticRanges(ranges)) glbDraw(r, SLOT.glb);
        glbDraw('wheel', SLOT.wheel); glbDraw('traveller', SLOT.trav);
        if (anchorShown) glbDraw('anchor', SLOT.anchor);   // #8: the anchor on the bow (hidden once 1 m under)
        // M4: the compass card (inside the binnacle's dome: v1's dome is opaque acrylic, so the depth test hides it there
        // too) and the pedestal pod with its bezel and the lubber line; with v1's models only (they carry the pedestal),
        // once the swap's dissolve is done
        if (fade >= 1) drawnTriangles += inst.draw(pass, c, { bg, stride: STRIDE, slots: { hull: SLOT.inst, card: SLOT.card, pod: SLOT.pod, vhf: SLOT.vhf } });
      }
      pass.setPipeline(reg.get('boat-cloth'));
      for (const s of gk.shown ? [...sails, gk] : sails) {
        pass.setBindGroup(2, bg, [s.slot * STRIDE]);
        pass.setVertexBuffer(0, s.pos); pass.setVertexBuffer(1, s.nrm); pass.setVertexBuffer(2, s.uv); pass.setVertexBuffer(3, s.met); pass.setVertexBuffer(4, s.fln); pass.setVertexBuffer(5, s.tan);
        pass.setIndexBuffer(s.idx, 'uint16'); pass.drawIndexed(s.g.index.length); c.calls++; c.triangles += s.g.triangles; drawnTriangles += s.g.triangles;
      }
      if (R.indices) {
        pass.setPipeline(reg.get('boat-ribbon'));
        pass.setBindGroup(2, bg, [SLOT.rig * STRIDE]);
        pass.setVertexBuffer(0, ribbon.pos); pass.setVertexBuffer(1, ribbon.oth); pass.setVertexBuffer(2, ribbon.side); pass.setVertexBuffer(3, ribbon.diam); pass.setVertexBuffer(4, ribbon.col);
        pass.setIndexBuffer(ribbon.idx, 'uint32'); pass.drawIndexed(R.indices); c.calls++; c.triangles += R.indices / 3; drawnTriangles += R.indices / 3;
      }
      if (detailsShown && RD.indices && detailIn()) {   // #20: the telltales, the vane, the flag; then the jib's yarns faint through the cloth
        pass.setPipeline(reg.get('boat-detail'));
        pass.setBindGroup(2, bg, [SLOT.rig * STRIDE]);
        pass.setVertexBuffer(0, detailRib.pos); pass.setVertexBuffer(1, detailRib.oth); pass.setVertexBuffer(2, detailRib.side); pass.setVertexBuffer(3, detailRib.diam); pass.setVertexBuffer(4, detailRib.col);
        pass.setIndexBuffer(detailRib.idx, 'uint32'); pass.drawIndexed(RD.indices); c.calls++; c.triangles += RD.indices / 3; drawnTriangles += RD.indices / 3;
        if (jibIdx) { pass.setPipeline(reg.get('boat-ribbon-ghost')); pass.drawIndexed(jibIdx); c.calls++; c.triangles += jibIdx / 3; drawnTriangles += jibIdx / 3; }
      }
      if (nRivals) drawRivals(pass, c);   // R4: the near rivals (full detail)
    },
    // the mirrors in the water, after the water (owner, 2026-11-19): the player's M3 solids (her procedural hull, keel, rudder, spars: a
    // light mesh in place of v1's models) and her sails, unless helm (the helm view: her sails only, no hull seen from inside it); the near
    // rivals' (the race's fleet, the lake's boats) within MIRROR_M of the eye, their sails unless bare
    drawMirror(pass, c, { helm = false, eye = null } = {}) {
      if (!mirrors) return;
      let calls = 0, tris = 0;
      pass.setBindGroup(1, sky.skyBG);
      pass.setPipeline(reg.get('boat-solid-mirror'));
      const solid = (sd, slot) => { pass.setBindGroup(2, bg, [slot * STRIDE]); pass.setVertexBuffer(0, sd.pos); pass.setVertexBuffer(1, sd.nrm); pass.setVertexBuffer(2, sd.col); pass.setVertexBuffer(3, sd.mr); pass.setIndexBuffer(sd.idx, sd.fmt); pass.drawIndexed(sd.count); calls++; tris += sd.count / 3; };
      if (!helm) for (const sd of solids) solid(sd, sd.slot);
      const near = [];
      for (let k = 0; k < nRivals; k++) { const r = rivals[live[k]]; if (!eye || Math.hypot(r.pose.x - eye[0], r.pose.z - eye[2]) < MIRROR_M) near.push(r); }
      for (const r of near) for (const sd of solids) solid(sd, r.base + (sd.slot === SLOT.hull ? RIVAL_SLOT.hull : sd.slot === SLOT.keel ? RIVAL_SLOT.keel : sd.slot === SLOT.rudder ? RIVAL_SLOT.rudder : sd.slot === SLOT.rig ? RIVAL_SLOT.rig : RIVAL_SLOT.boom));
      pass.setPipeline(reg.get('boat-cloth-mirror'));
      const cloth = (rs, slot) => { pass.setBindGroup(2, bg, [slot * STRIDE]); pass.setVertexBuffer(0, rs.pos); pass.setVertexBuffer(1, rs.nrm); pass.setVertexBuffer(2, rs.uv); pass.setVertexBuffer(3, rs.met); pass.setVertexBuffer(4, rs.fln); pass.setVertexBuffer(5, rs.tan); pass.setIndexBuffer(rs.idx, 'uint16'); pass.drawIndexed(rs.g.index.length); calls++; tris += rs.g.triangles; };
      for (const sd of sails) cloth(sd, sd.slot);
      if (gk.shown) cloth(gk, gk.slot);   //
      for (const r of near) if (!r.pose.bare) for (const rs of r.sails) cloth(rs, r.base + (rs.name === 'main' ? RIVAL_SLOT.main : RIVAL_SLOT.jib));
      c.calls += calls; c.triangles += tris; mirrorStats.calls = calls; mirrorStats.triangles = Math.round(tris); mirrorStats.rivals = near.length;
    },
    get mirrorStats() { return mirrorStats; },
    // M3b: the clear dodger vinyl and the smoked side panels, blended, last in the scene (after the water and the sky:
    // they write no depth, so anything drawn after them would cover them)
    setShadowEvery(n, when = null) { const k = Math.max(1, n | 0); shadowWhen = when; if (k !== shadowEvery) { shadowEvery = k; shadowDrawn = false; } },   // perf(v2) phone round 2: when() says a redraw frame (the page keeps it off the aerial pass's frames)
    get shadowEvery() { return shadowEvery; },
    drawGlass(pass, c) {
      if (!gm.ready) return;
      const g = gm.range('glass'); if (!g.count) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg, [SLOT.glb * STRIDE]); pass.setBindGroup(3, gm.bg);
      gm.bindVB(pass); pass.setPipeline(reg.get('boat-glb-glass'));
      pass.drawIndexed(g.count, 1, g.first); c.calls++; c.triangles += g.count / 3; drawnTriangles += g.count / 3;
    },
    models: gm,
    instruments: inst,
    details,   // #20: the telltales' states, the vane's angle (tests, probes)
    get detailsShown() { return detailsShown; }, set detailsShown(on) { detailsShown = !!on; },   // #20: the in-page A/B (tools/v2-ab-telltales.mjs)
    get fade() { return fade; },
  };
}
