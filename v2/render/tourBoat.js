// The glass boat's drawing (v2/sim/tourBoat.js, v2/render/tourBoatMesh.js): "Velia Travel" and her clear kayaks.
// Two pipelines from one shader, declared at load in the boat effects' group (render/kayaks.js's lighting: its COMMON):
//   'tour-solid'  lit, opaque, instanced (before the water: the pontoon, the kayaks' rims and seats). The roof shades the deck under it
//                 (an analytic shadow: the sun's ray from the point against the roof's rectangle, and less sky under it); nothing
//                 under her own waterline is drawn (the water's blend covers it, as the boat's and the kayaks'); her roof's LED strip
//                 and her lenses glow at night
//   'tour-clear'  premultiplied blend, depth-tested, no depth written (after the sky: the water, the bed and the paddlers seen through
//                 it): the kayaks' polycarbonate (a thin clear shell: Fresnel reflection of the sky, a sun glint, edges denser; no
//                 screen-space refraction), the side windows, the deck's glass panel; and spots on the water (one quad mesh): the
//                 night LEDs' pools under each clear hull and her underwater lights (additive: alpha 0; dimmer and wider over deeper
//                 water, the light going down to the bed and back), her wake's foam (the stern wash and the two arms of a slow
//                 displacement wake), and the soft shade under her and the kayaks by day
// The paddlers ride the kayaks' own skin pipeline ('kayak-skin', render/kayaks.js: v1's paddler and its baked strokes) with this
// module's own palette and records (up to MAX_FIGURES, the fleet's MAX_FULL), drawn only once the kayak asset is in.
//   const TB = createTourBoatRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, kayakRender })
//   TB.update(T, { eye, heightAt, sunElevDeg, depthAt, focalPx, clips, lite })   once a frame (T: the sim)
//   TB.drawSolid(pass, c)   before the water;   TB.drawClear(pass, c)   after the sky
import { COMMON, IREC, SLOTS } from './kayaks.js';
import { buildTourMeshes, VF, SLOT, PONTOON, CLEAR_KAYAK, LOD_M, GLYPH_SEGS, STROKE, VALANCE } from './tourBoatMesh.js';
import { poseRows } from '../sim/kayak-clip.js';
import { TOUR } from '../sim/tourBoat.js';
import { navLevel } from '../sim/night.js';

const MAX_FIGURES = 4;                 // the paddlers drawn at full detail (the fleet's MAX_FULL)
const MAX_INST = 1 + 5 + 160;          // the pontoon, the kayaks, the spots
const FIGURE_PX = 14;                  // a kayak this long on screen or more carries its paddlers (px)
const KAYAK_DRAW_M = 900, SPOT_DRAW_M = 1200, MIRROR_M = 450;   // m: her mirror in the water drawn within MIRROR_M of the eye
export const LED = Object.freeze({ pool: 0.03, hull: 0.3, deck: 0.35, under: 0.01, poolR: 2.2, cabin: 0.012, courtesy: 0.6, spill: 0.004 });   // the night LEDs' radiances and the pool's radius (m, over 1 m of water); cabin: the roof strip's warm fill under the roof; spill: the cabin's light on the water beside her
const REC = 5;                                // vec4 per instance record
const DEG = Math.PI / 180;
const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const NAVY = lin(0x1c2340), CREAM = lin(0xefe6d2);
const v3 = (a, k = 1) => `vec3f(${a.map((x) => (x * k).toFixed(4)).join(', ')})`;
// the name's strokes (render/tourBoatMesh.js GLYPH_SEGS), "VELIA TRAVEL", for a distance field: every segment in order, each letter's
// first segment and count
const WORD = 'VELIA TRAVEL';
const SEGS = [], CH = [];
for (const c of WORD) { CH.push([SEGS.length, GLYPH_SEGS[c].length]); SEGS.push(...GLYPH_SEGS[c]); }

// detail round 2 (owner, 2026-11-18: "they look like toys"; the bar: "aged and real, never shiny, plastic or new", "never a toy"):
// every material matte with broken specular and colour that varies (orange peel and chalk on the gelcoat, brushed grain on the aluminium,
// the deck's diamond non-skid and its worn path, the vinyl's seams and piping, teak grain silvering, the cowlings' clear coat), a
// waterline stain and a wet film just over the water, faint dirt streaks under the windows; thin members' normals turned toward the eye
// (no black silhouettes); the name as a distance field (cream strokes, antialiased); at night nothing on her glows but the real lamps:
// her lenses, the thin LED strip under the roof's edge, the kayaks' LED strips (her gelcoat takes only the world's night light)
const TOUR_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> TI: array<vec4f>;
var<private> SEG: array<vec4f, ${SEGS.length}> = array<vec4f, ${SEGS.length}>(${SEGS.map((s) => `vec4f(${s.map((x) => x.toFixed(2)).join(', ')})`).join(', ')});
var<private> CHS: array<vec2u, ${CH.length}> = array<vec2u, ${CH.length}>(${CH.map(([a, b]) => `vec2u(${a}u, ${b}u)`).join(', ')});
struct TV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) @interpolate(flat) slot: u32, @location(4) @interpolate(flat) inst: u32 }
fn place(p: vec3f, n: vec3f, slot: f32, ii: u32, flip: bool) -> TV {
  let r0 = TI[ii * ${REC}u]; let r1 = TI[ii * ${REC}u + 1u]; let r2 = TI[ii * ${REC}u + 2u];
  let p4 = vec4f(p, 1.0); let n4 = vec4f(n, 0.0);
  var wp = vec3f(dot(r0, p4), dot(r1, p4), dot(r2, p4)); var wn = vec3f(dot(r0, n4), dot(r1, n4), dot(r2, n4));
  if (flip) { wp.y = -wp.y; wn.y = -wn.y; }
  var o: TV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.lp = p; o.slot = u32(slot + 0.5); o.inst = ii; return o;
}
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) slot: f32, @builtin(instance_index) ii: u32) -> TV { return place(p, n, slot, ii, false); }
@vertex fn vsMirror(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) slot: f32, @builtin(instance_index) ii: u32) -> TV { return place(p, n, slot, ii, true); }
fn toLocal(I: u32, d: vec3f) -> vec3f { let r0 = TI[I]; let r1 = TI[I + 1u]; let r2 = TI[I + 2u]; return normalize(vec3f(r0.x * d.x + r1.x * d.y + r2.x * d.z, r0.y * d.x + r1.y * d.y + r2.y * d.z, r0.z * d.x + r1.z * d.y + r2.z * d.z)); }
fn th3(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn vn3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(th3(i), th3(i + vec3f(1, 0, 0)), u.x), mix(th3(i + vec3f(0, 1, 0)), th3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(th3(i + vec3f(0, 0, 1)), th3(i + vec3f(1, 0, 1)), u.x), mix(th3(i + vec3f(0, 1, 1)), th3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
// render/kayaks.js's shade with the sun and the sky scaled (the roof's shadow and its cover) and a broken specular (spK)
fn shadeK(world: vec3f, nIn: vec3f, alb: vec3f, rough: f32, metal: f32, sunK: f32, skyK: f32, spK: f32) -> vec3f {
  let V = normalize(F.cam.xyz - world); let n = normalize(nIn); let s = normalize(F.sun.xyz); let nl = max(dot(n, s), 0.0);
  // (2026-11-19, too dim in full sun) no terrain shadow read (the boat beside her and her kayaks take none: the light box's
  // patches left her sunlit faces in its shade), the sky light drawn toward its grey as the kayaks' (KAYAK_SKY_DESAT: the blue cast)
  let eSun = sunPerp() * sunK; let eSky0 = ambientAt(n); let eSky = mix(eSky0, vec3f(dot(eSky0, vec3f(0.2126, 0.7152, 0.0722))), KAYAK_SKY_DESAT * boatDay()) * skyK;
  let f0 = mix(vec3f(0.04), alb, metal);
  let diff = alb * (1.0 - metal) / PI * (eSun * nl + eSky);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  return diff + (skyMirror(R) * fres * (1.0 - 0.8 * rough) * mix(0.35, 1.0, skyK) + ggxSpec(n, V, s, rough, f0) * eSun) * spK;
}
fn segD(p: vec2f, s: vec4f) -> f32 { let a = s.xy; let b = s.zw; let ab = b - a; let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0); return length(p - a - ab * t); }
// the name's ink (0..1) at (u, v) in letter units from the name's centre (a cap 7 tall; the advance ${PONTOON.text.adv}); aa: a pixel in units
fn nameInk(u: f32, v: f32, aa: f32) -> f32 {
  let adv = ${PONTOON.text.adv.toFixed(2)}; let W = f32(${WORD.length - 1}) * adv + 4.0; let x = u + W * 0.5; let y = v + 3.5;
  if (x < -1.0 || x > W + 1.0 || y < -1.0 || y > 8.0) { return 0.0; }
  let k = clamp(i32(floor(x / adv)), 0, ${WORD.length - 1});
  let p = vec2f(x - f32(k) * adv, y); let c = CHS[k]; var d = 9.0;
  for (var i = 0u; i < c.y; i++) { d = min(d, segD(p, SEG[c.x + i])); }
  return 1.0 - smoothstep(${(STROKE / 2).toFixed(3)} - aa, ${(STROKE / 2).toFixed(3)} + aa, d);
}
fn solidLit(v: TV, ff: bool) -> vec3f {
  let I = v.inst * ${REC}u; let p0 = TI[I + 3u]; let p1 = TI[I + 4u];
  let kind = u32(p0.x + 0.5); let lp = v.lp;
  let unit = ${(PONTOON.text.h / 7).toFixed(4)};
  let aaN = max(fwidth(lp.z), fwidth(lp.y)) / unit;   // a pixel in the name's units (taken in uniform flow)
  let aaS = max(fwidth(lp.z), 1e-4);
  // nothing under the waterline (the pontoon's y 0; a kayak's draft over its keel)
  let wl = select(0.0, p0.z, kind == 1u);
  if (lp.y < wl - 0.03) { discard; }
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(select(-v.n, v.n, ff));
  if (dot(n, V) < 0.0) { n = normalize(n - V * (1.2 * dot(n, V))); }   // a smooth normal past the silhouette, turned back to the eye
  var alb = vec3f(0.7); var rough = 0.5; var metal = 0.0; var emit = vec3f(0.0); var spK = 1.0;
  let night = p0.y;
  let lo = vn3(lp * 1.7); let hi = vn3(lp * 23.0);
  switch (v.slot) {
    case ${SLOT.white}u: {   // gelcoat: orange peel, chalky patches, faint dirt streaks running down from the window line
      let streak = smoothstep(0.62, 0.9, vn3(vec3f(lp.z * 7.0, lp.y * 0.7, lp.x * 7.0))) * (1.0 - smoothstep(${(PONTOON.winTop - 0.9).toFixed(2)}, ${PONTOON.winTop.toFixed(2)}, lp.y)) * 0.5;
      alb = vec3f(0.78, 0.775, 0.75) * (0.95 + 0.05 * hi) * (1.0 - 0.07 * streak) + vec3f(0.03, 0.025, 0.02) * smoothstep(0.55, 0.8, lo);
      rough = 0.3 + 0.12 * lo; spK = 0.75 + 0.25 * hi;
      // the roof's top: a soft sheen (a waxed gelcoat face up to the sky: the sky's mirror and a broad sun sheen)
      if (kind == 0u && lp.y > ${(PONTOON.roofY - 0.02).toFixed(2)} && n.y > 0.8) { rough = 0.2 + 0.06 * lo; spK = 1.0; }
    }
    case ${SLOT.band}u: {   // the navy panels: a clear-coated paint, faded on top, scuffed where fenders and kayaks rub; the name in cream
      alb = ${v3(NAVY)} * (0.92 + 0.12 * lo) * mix(1.0, 1.25, smoothstep(0.3, 0.9, n.y));
      let scuff = smoothstep(0.78, 0.95, vn3(vec3f(lp.z * 2.0, lp.y * 30.0, lp.x * 2.0))) * (1.0 - smoothstep(0.3, 0.75, lp.y));
      alb = mix(alb, vec3f(0.11, 0.115, 0.13), scuff * 0.5);
      rough = 0.2 + 0.15 * lo + 0.3 * scuff; spK = 0.85;
      if (abs(lp.x) > ${(PONTOON.beam / 2 - 0.02).toFixed(3)}) {
        let sgn = select(-1.0, 1.0, lp.x < 0.0);   // read bow to stern on each side
        let ink = nameInk(sgn * (lp.z - ${PONTOON.text.zc.toFixed(3)}) / unit, (lp.y - ${PONTOON.text.yc.toFixed(3)}) / unit, aaN * 0.8 + 0.06);
        alb = mix(alb, ${v3(CREAM, 0.86)} * (0.94 + 0.06 * hi), ink); rough = mix(rough, 0.32, ink);
      }
      // the waterline's scum line along the band's foot (where the wakes slap)
      alb = mix(alb, vec3f(0.16, 0.16, 0.13), (1.0 - smoothstep(${PONTOON.band[0].toFixed(3)}, ${(PONTOON.band[0] + 0.06).toFixed(3)}, lp.y)) * 0.5);
    }
    case ${SLOT.cream}u: { alb = ${v3(CREAM, 0.82)}; rough = 0.35; }
    case ${SLOT.deck}u: {   // the grey non-skid: a fine raised diamond pattern, darker worn paths between the benches
      let q = lp.xz * 34.0; let dmd = abs(fract(q.x + q.y) - 0.5) + abs(fract(q.x - q.y) - 0.5);
      let path = (1.0 - smoothstep(0.2, 0.9, abs(lp.x))) * 0.5;
      alb = vec3f(0.2, 0.2, 0.195) * (0.9 + 0.12 * smoothstep(0.55, 0.75, dmd)) * (1.0 - 0.18 * path) * (0.93 + 0.07 * lo);
      rough = 0.85; spK = 0.4;
    }
    case ${SLOT.tube}u: {   // brushed aluminium: fine grain along the run, a dull oxidised film, the waterline's olive stain and wet film
      let grain = vn3(vec3f(lp.x * 90.0, lp.y * 90.0, lp.z * 1.2));
      alb = vec3f(0.66, 0.665, 0.67) * (0.9 + 0.1 * grain) * (0.94 + 0.06 * lo); metal = 0.9; rough = 0.36 + 0.14 * grain;
      if (kind == 0u && lp.y > ${PONTOON.band[1].toFixed(2)}) { rough = 0.2 + 0.08 * grain; }   // the posts and rails above the band: a crisp highlight along each (wiped, not oxidised)
      if (kind == 0u) {
        let wet = 1.0 - smoothstep(0.0, 0.12, lp.y); let stain = 1.0 - smoothstep(0.03, 0.22, lp.y);
        alb = mix(alb, vec3f(0.23, 0.22, 0.15), stain * 0.55); metal = mix(metal, 0.4, stain); rough = mix(rough, 0.12, wet);
      }
    }
    case ${SLOT.dark}u: { alb = vec3f(0.035, 0.036, 0.04) * (0.9 + 0.2 * lo); rough = 0.55; }
    case ${SLOT.vinyl}u: {   // marine vinyl: the cushions' seams every 0.6 m, the piping at the edges, a soft sheen
      let sm = abs(fract(lp.z / 0.6) - 0.5) * 0.6; let seam = 1.0 - smoothstep(0.0, aaS * 1.5 + 0.004, abs(sm - 0.3));
      alb = ${v3(NAVY, 1.7)} * (0.9 + 0.1 * lo) * (1.0 - 0.45 * seam); rough = 0.5 - 0.1 * hi; spK = 0.7;
    }
    case ${SLOT.steel}u: { alb = vec3f(0.76, 0.765, 0.77) * (0.95 + 0.05 * hi); rough = 0.16 + 0.1 * lo; metal = 1.0; }
    case ${SLOT.roofUnder}u: {   // the roof's lining; the LED strip a narrow line just inside her roof's edge (the only light under the roof)
      alb = vec3f(0.7, 0.69, 0.66) * (0.95 + 0.05 * lo); rough = 0.7;
      let strip = 1.0 - smoothstep(0.012, 0.025, abs(abs(lp.x) - ${(PONTOON.roofHalfW - 0.08).toFixed(3)}));
      emit = vec3f(1.0, 0.82, 0.6) * ${LED.deck.toFixed(2)} * night * strip;
    }
    case ${SLOT.rim}u: { alb = vec3f(0.8, 0.8, 0.78) * (0.93 + 0.07 * hi); rough = 0.38; spK = 0.8; }   // the kayak's white rim
    case ${SLOT.seat}u: { alb = vec3f(0.045, 0.047, 0.05) * (0.9 + 0.2 * lo); rough = 0.65; }
    case ${SLOT.cowl}u: { alb = vec3f(0.05, 0.052, 0.056) * (0.95 + 0.1 * lo); rough = 0.2 + 0.1 * hi; spK = 1.1; }   // charcoal clear coat
    case ${SLOT.lensW}u: { alb = vec3f(0.55); rough = 0.1; emit = vec3f(1.0, 0.95, 0.85) * 6.0 * night; }
    case ${SLOT.lensR}u: { alb = vec3f(0.3, 0.035, 0.03); rough = 0.1; emit = vec3f(1.0, 0.22, 0.16) * 6.0 * night; }
    case ${SLOT.lensG}u: { alb = vec3f(0.035, 0.26, 0.09); rough = 0.1; emit = vec3f(0.2, 1.0, 0.45) * 6.0 * night; }
    case ${SLOT.teak}u: {   // teak slats: grain along the slat, weathered silver on top, darker toward the seams
      let g = vn3(vec3f(lp.x * 140.0, lp.y * 40.0, lp.z * 3.0));
      alb = mix(vec3f(0.30, 0.19, 0.10), vec3f(0.42, 0.40, 0.36), 0.35 + 0.25 * lo) * (0.82 + 0.25 * g); rough = 0.75; spK = 0.5;
    }
    case ${SLOT.fender}u: { alb = vec3f(0.8, 0.8, 0.78) * (1.0 - 0.25 * (1.0 - smoothstep(0.3, 0.45, lp.y))); rough = 0.42; }
    case ${SLOT.led}u: { alb = vec3f(0.08, 0.09, 0.1); rough = 0.3; emit = p1.rgb * night * ${(LED.hull * 3).toFixed(2)}; }   // the kayak's LED strip
    case ${SLOT.cord}u: { alb = vec3f(0.03, 0.03, 0.032); rough = 0.8; spK = 0.4; }
    case ${SLOT.blade}u: { alb = vec3f(0.03, 0.04, 0.07); rough = 0.35; }
    case ${SLOT.canvas}u: {   // navy acrylic canvas: a soft weave, faded on the sun side, the cream piping along the valance's foot
      let weave = vn3(vec3f(lp.x * 160.0, lp.y * 160.0, lp.z * 160.0));
      alb = ${v3(NAVY, 1.15)} * (0.9 + 0.14 * lo) * (0.96 + 0.08 * weave); rough = 0.9; spK = 0.25;
      let foot = ${(PONTOON.roofY + 0.005 - VALANCE.drop).toFixed(3)};
      let pipe = 1.0 - smoothstep(${VALANCE.pipe.toFixed(3)}, ${(VALANCE.pipe + 0.008).toFixed(3)}, lp.y - foot);
      alb = mix(alb, ${v3(CREAM, 0.8)}, pipe * step(foot - 0.001, lp.y)); rough = mix(rough, 0.5, pipe);
    }
    case ${SLOT.courtesy}u: { alb = vec3f(0.5, 0.52, 0.55); rough = 0.3; emit = vec3f(0.75, 0.88, 1.0) * ${LED.courtesy.toFixed(2)} * night; }   // the cool courtesy strips under the cap rail
    default: {}
  }
  // the roof's shadow on her (the pontoon only): the sun's ray from the point meets the roof's plane inside its rectangle
  var sunK = 1.0; var skyK = 1.0;
  if (kind == 0u && lp.y < ${PONTOON.roofY.toFixed(2)} - 0.01) {
    let sl = toLocal(I, normalize(F.sun.xyz));
    let inside = abs(lp.x) < ${PONTOON.roofHalfW.toFixed(2)} && lp.z > ${PONTOON.roofZ[0].toFixed(2)} && lp.z < ${PONTOON.roofZ[1].toFixed(2)};
    if (sl.y > 0.02) {
      let t = (${PONTOON.roofY.toFixed(2)} - lp.y) / sl.y; let h = lp + sl * t;
      if (abs(h.x) < ${PONTOON.roofHalfW.toFixed(2)} && h.z > ${PONTOON.roofZ[0].toFixed(2)} && h.z < ${PONTOON.roofZ[1].toFixed(2)}) { sunK = 0.0; }
    }
    // the sky under the roof: the deck, the benches and the inner faces only. Her outer faces (the band, the posts, the header, the
    // stern and the bow) look out at the open sky beside her: no cover (2026-11-19: every face within
    // the roof's outline, the outer sides too, took 0.4-0.75 of the sky)
    let nLoc = toLocal(I, n);
    let outward = nLoc.x * sign(lp.x) > 0.35 || abs(nLoc.z) > 0.6;
    if (inside && !outward) {
      skyK = mix(0.4, 0.75, smoothstep(1.2, 1.9, abs(lp.x)));
      // at night the roof's warm strip and the courtesy strips light the cabin: the deck, the benches and the inner faces take a warm
      // fill that falls off toward the deck's middle (a lit tour boat on dark water), the deck's edge a touch cooler from the courtesy strips
      let edge = smoothstep(0.6, 1.5, abs(lp.x));
      let fill = mix(0.45, 1.0, edge) * (0.6 + 0.4 * smoothstep(0.0, 1.6, lp.y - ${PONTOON.deckY.toFixed(2)}));
      emit += alb * mix(vec3f(1.0, 0.8, 0.58), vec3f(0.8, 0.9, 1.0), 0.35 * edge * (1.0 - smoothstep(0.2, 0.6, lp.y - ${PONTOON.deckY.toFixed(2)}))) * ${LED.cabin.toFixed(3)} * night * fill;
    }
  }
  return shadeK(v.world, n, alb, rough, metal, sunK, skyK, spK) + emit;
}
@fragment fn fsSolid(v: TV, @builtin(front_facing) ff: bool) -> @location(0) vec4f { return finish(solidLit(v, ff), v.pos.xy, v.world); }
// her mirror in the water (Tessie's way, render/tessie.js fsMirror; 2026-11-19): what stands above the water drawn flipped through it after the water, shaded where it really is (y flipped back), its
// Fresnel share, dimmed and fading with height (the ripples break it); its depth the surface point along the view, so the hulls and
// the waves' crests in front still hide it
struct TMOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fsMirror(v: TV, @builtin(front_facing) ff: bool) -> TMOut {
  if (v.lp.y < 0.02) { discard; }
  if (dot(v.n, F.cam.xyz - v.world) < 0.0) { discard; }   // only the faces the mirrored view sees (no depth among the mirror's own faces: the roof's top hid behind its lining)
  var src = v; src.world = vec3f(v.world.x, -v.world.y, v.world.z); src.n = vec3f(v.n.x, -v.n.y, v.n.z);
  let col = finish(solidLit(src, !ff), v.pos.xy, v.world).rgb;
  let eye = F.cam.xyz; let dir = v.world - eye;
  let k = (eye.y - 0.12) / max(eye.y - v.world.y, 1e-3);
  let cp = F.viewProj * vec4f(eye + dir * k, 1.0);
  let cosV = abs(normalize(dir).y);
  let fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  // the ripples break it: a moving shimmer across it (bands along the view, two scales), deeper parts fainter
  let rip = 0.55 + 0.45 * vn3(vec3f(v.world.x * 0.9, F.cam.w * 0.8, v.world.z * 0.9 + v.world.y * 3.0)) * vn3(vec3f(v.world.x * 3.1 + F.cam.w * 1.3, 0.0, v.world.z * 3.1));
  let a = fres * 0.6 * exp(-src.world.y / 3.0) * rip;
  var o: TMOut; o.c = vec4f(col * a, a); o.depth = cp.z / cp.w; return o;
}
fn hashS(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn noiseS(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashS(i), hashS(i + vec2f(1.0, 0.0)), u.x), mix(hashS(i + vec2f(0.0, 1.0)), hashS(i + vec2f(1.0, 1.0)), u.x), u.y); }
// premultiplied: the colour after the air, the coverage
fn finishClear(rgb: vec3f, a: f32, px: vec2f, world: vec3f) -> vec4f {
  var Tair = vec3f(1.0); let inS = aerialParts(px, world, &Tair);
  return vec4f(rgb * Tair + inS * a, a);
}
@fragment fn fsClear(v: TV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let I = v.inst * ${REC}u; let p0 = TI[I + 3u]; let p1 = TI[I + 4u];
  let kind = u32(p0.x + 0.5); let lp = v.lp;
  if (v.slot == ${SLOT.spot}u) {
    let r2 = dot(lp.xz, lp.xz);
    if (kind == 5u) {   // a hull's shadow on the bed, seen through the clear water: its outline (a superellipse: p1.z its power), soft by depth
      let e = p1.z; let r = pow(pow(abs(lp.x), e) + pow(abs(lp.z), e), 1.0 / e);
      if (r > 1.0) { discard; }
      return finishClear(vec3f(0.0), p1.x * (1.0 - smoothstep(1.0 - p1.y, 1.0, r)), v.pos.xy, v.world);
    }
    if (r2 > 1.0) { discard; }
    if (kind == 2u) {   // a light's pool on the water and the bed under it (additive): a bright core right under the hull, a wide soft halo
      let core = exp(-r2 * 22.0);
      let f = exp(-r2 * 4.0) * (1.0 - r2) * (1.0 - r2) + 0.9 * core * (1.0 - r2);
      return finishClear(mix(p1.rgb, vec3f(dot(p1.rgb, vec3f(0.3333))) * 1.15, 0.35 * core) * p1.w * f, 0.0, v.pos.xy, v.world);
    }
    if (kind == 3u) {   // the wake's foam: a soft patch, broken by noise, lit as the water's white is
      let s = normalize(F.sun.xyz);
      let lit = (LIGHT.sun.rgb * max(s.y, 0.0) + LIGHT.sky.rgb) * 0.85 / PI;
      let nz = noiseS(v.world.xz * 1.9 + vec2f(p1.y * 0.3, 0.0)) * 0.7 + noiseS(v.world.xz * 5.3) * 0.3;
      let a = clamp(p1.x * (1.0 - r2) * smoothstep(0.35, 0.75, nz), 0.0, 0.85);
      return finishClear(lit * a, a, v.pos.xy, v.world);
    }
    let a = p1.x * exp(-r2 * 2.6) * (1.0 - r2);   // the contact shade on the surface under a hull by day
    return finishClear(vec3f(0.0), a, v.pos.xy, v.world);
  }
  // a kayak's shell under its waterline is the water's (the bed and the paddler's legs seen through the water)
  if (kind == 1u && lp.y < p0.z - 0.02) { discard; }
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(select(-v.n, v.n, ff)); if (dot(n, V) < 0.0) { n = -n; }
  let nv = max(dot(n, V), 0.0); let s = normalize(F.sun.xyz); let nl = max(dot(n, s), 0.0);
  let fres = 0.05 + 0.95 * pow(1.0 - nv, 5.0);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let eSun = sunPerp();   // (no terrain shadow read: as the solids)
  var a = 0.0; var rgb = vec3f(0.0);
  if (v.slot == ${SLOT.clear}u) {
    // polycarbonate (n 1.585, F0 0.051): the sky's reflection by Fresnel, a sharp sun glint, the thin shell denser edge-on, a faint
    // cool body; fine scratches along the hull and a few across it (where the paddles and the beach rub) catching the light
    let scr = smoothstep(0.86, 0.97, vn3(vec3f(lp.x * 220.0, lp.y * 220.0, lp.z * 6.0))) * 0.6 + smoothstep(0.9, 0.98, vn3(vec3f(lp.z * 160.0, lp.y * 30.0, lp.x * 9.0))) * 0.4;
    // two skins (render/tourBoatMesh.js SKIN_T): each a Fresnel surface, so the shell darkens and brightens as a sheet where it turns
    // edge-on; the rim's roll a lit line; the edge carries the sheet's own cool green (polycarbonate's absorption seen along the sheet)
    let edge = pow(1.0 - nv, 1.6);
    a = clamp(0.10 + 0.78 * fres + 0.22 * edge + 0.08 * scr, 0.0, 0.9);
    rgb = skyRadiance(R) * (fres + 0.04 * scr) + ggxSpec(n, V, s, 0.05 + 0.2 * scr, vec3f(0.051)) * eSun + ggxSpec(n, V, s, 0.3, vec3f(0.051)) * eSun * 0.35;
    rgb += a * (ambientAt(n) + eSun * nl * 0.3) / PI * mix(vec3f(0.14, 0.18, 0.19), vec3f(0.22, 0.34, 0.3), edge) + (eSun * nl / PI) * vec3f(0.05, 0.06, 0.06) * scr;   // the shell's milky body, lit (the photos: a pale ghost of the hull over the bed), greener along the edge
    // its LED strip's light in the shell: brightest low and edge-on (the polycarbonate carries it like a light pipe)
    rgb += p1.rgb * p0.y * ${LED.hull.toFixed(2)} * (0.25 + 1.3 * edge) * (1.0 - smoothstep(p0.z, p0.z + 0.3, lp.y));
  } else if (v.slot == ${SLOT.window}u) {   // smoked glass: a dark bronze tint (the benches read through it), the sky's reflection at a slant, the warm cabin glowing through it at night
    a = clamp(0.34 + 0.56 * fres, 0.0, 0.92);
    rgb = skyMirror(R) * (0.025 + 0.9 * fres) + ggxSpec(n, V, s, 0.06, vec3f(0.04)) * eSun * 1.3 + a * ambientAt(n) * vec3f(0.012, 0.011, 0.009);
    let paneTop = smoothstep(${(PONTOON.band[1] + 0.1).toFixed(2)}, ${PONTOON.winTop.toFixed(2)}, lp.y);   // lit from the roof's strip: brighter up the pane
    rgb += vec3f(1.0, 0.78, 0.5) * p0.y * ${(LED.cabin * 1.1).toFixed(3)} * (0.55 + 0.45 * paneTop) * (0.6 + 0.4 * (1.0 - fres));
  } else {   // the deck's glass panel (her underwater lights under it at night)
    a = clamp(0.12 + 0.6 * fres, 0.0, 0.8);
    rgb = skyRadiance(R) * fres + ggxSpec(n, V, s, 0.07, vec3f(0.05)) * eSun + vec3f(0.35, 0.75, 1.0) * p0.y * ${(LED.under * 0.3).toFixed(2)};
  }
  return finishClear(rgb, a, v.pos.xy, v.world);
}`;


export function createTourBoatRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', kayakRender = null, mirrors = false, mirrorKayaks = false }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const mesh = buildTourMeshes();
  const vb = device.createBuffer({ label: 'tour-mesh', size: mesh.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, mesh.data);
  const ibuf = device.createBuffer({ label: 'tour-instances', size: MAX_INST * REC * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const inst = new Float32Array(MAX_INST * REC * 4);
  const shEntries = [{ binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }];
  const shRes = [{ binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }];
  const bgl = device.createBindGroupLayout({ label: 'tour', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'read-only-storage' } }, ...shEntries] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ibuf } }, ...shRes] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] });
  const mod = reg.shader('tour', TOUR_WGSL(frameStruct));
  const vbuf = { arrayStride: VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] };
  reg.add('tour-solid', { layout, vertex: { module: mod, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mod, entryPoint: 'fsSolid', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  if (mirrors) reg.add('tour-mirror', { layout, vertex: { module: mod, entryPoint: 'vsMirror', buffers: [vbuf] }, fragment: { module: mod, entryPoint: 'fsMirror', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });
  reg.add('tour-clear', { layout, vertex: { module: mod, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mod, entryPoint: 'fsClear', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });

  // the paddlers' own palette and records on the kayaks' skin pipeline (render/kayaks.js share)
  let figPal = null, figIns = null, figInsU = null, figPalBuf = null, figInsBuf = null, figBG = null, figBGL = null;
  const figs = [];   // this frame's: { part, inst, detail }
  const tmpRows = new Float32Array(12);
  const ensureFigs = (share) => {
    if (figBG && figBGL === share.skinBGL) return true;
    figPal = new Float32Array(MAX_FIGURES * SLOTS * 12); figIns = new Float32Array(MAX_FIGURES * IREC * 4); figInsU = new Uint32Array(figIns.buffer);
    figPalBuf = device.createBuffer({ label: 'tour-figure-palette', size: figPal.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    figInsBuf = device.createBuffer({ label: 'tour-figure-instances', size: figIns.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    figBGL = share.skinBGL;
    figBG = device.createBindGroup({ layout: share.skinBGL, entries: [{ binding: 0, resource: { buffer: figPalBuf } }, { binding: 1, resource: { buffer: figInsBuf } }, ...shRes] });
    return true;
  };
  const stats = { pontoon: null, kayaks: 0, figures: 0, spots: 0, calls: 0, triangles: 0, solidTris: 0, clearTris: 0 };
  let nSolid = 0, nKayak = 0, nEmpty = 0, nSpot = 0, hiLod = true, shown = false;
  const put = (i, rows, p0, p1) => { const o = i * REC * 4; inst.set(rows, o); inst[o + 12] = p0[0]; inst[o + 13] = p0[1]; inst[o + 14] = p0[2]; inst[o + 15] = p0[3]; inst[o + 16] = p1[0]; inst[o + 17] = p1[1]; inst[o + 18] = p1[2]; inst[o + 19] = p1[3]; };
  // a flat spot on the water at (x, z): rx across, rz along its heading h (rad), lifted lift m over the drawn water
  const spotRows = (x, y, z, h, rx, rz) => { const fx = Math.sin(h), fz = -Math.cos(h); return [-fz * rx, 0, fx * rz, x, 0, 1, 0, y, fx * rx, 0, fz * rz, z]; };
  const P0 = [0, 0, 0, 0], P1 = [0, 0, 0, 0];
  // the LED's underglow on a paddler at night: the kayaks' skin shader is shared (its lighting is render/kayaks.js's alone), so the
  // glow from below is carried in the paddler's colours: each garment and the skin lean toward the LED's hue by the night's level
  const lit = (c, led, k) => { if (!(k > 0)) return c; const o = {}; for (const key of Object.keys(c)) { const v = c[key], l = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; o[key] = [v[0] + (led[0] * (l + 0.05) * 1.6 - v[0]) * k, v[1] + (led[1] * (l + 0.05) * 1.6 - v[1]) * k, v[2] + (led[2] * (l + 0.05) * 1.6 - v[2]) * k]; } return o; };

  function update(T, { eye, heightAt, sunElevDeg = 90, sun = [0, 1, 0], depthAt = () => 10, focalPx = 1000, clips = null, lite = false, on = true, mapWake = false }) {
    nSolid = nKayak = nEmpty = nSpot = 0; figs.length = 0; shown = false;
    if (!T || !on || !T.active) { stats.pontoon = null; stats.kayaks = stats.figures = stats.spots = 0; return; }
    const b = T.boat, bx = b.x + b.ox, bz = b.z + b.oz, d = Math.hypot(bx - eye[0], bz - eye[2]);
    if (d > TOUR.drawM) { stats.pontoon = null; stats.kayaks = stats.figures = stats.spots = 0; return; }
    shown = true;
    const night = navLevel(sunElevDeg), sunUp = Math.max(0, Math.min(1, (sunElevDeg + 2) / 8));
    // the pontoon: heave, pitch and roll from the drawn water under her ends and sides (a 12 t pontoon rides them softly)
    const fx = Math.sin(b.heading), fz = -Math.cos(b.heading), L2 = 4.5, B2 = 1.6;
    const yb = heightAt(bx + fx * L2, bz + fz * L2), ys = heightAt(bx - fx * L2, bz - fz * L2), yS = heightAt(bx - fz * B2, bz + fx * B2), yP = heightAt(bx + fz * B2, bz - fx * B2);
    hiLod = !lite && d < LOD_M;
    poseRows({ x: bx, y: (yb + ys + yS + yP) / 4, z: bz, yaw: -b.heading, pitch: Math.atan2(yb - ys, 2 * L2) * 0.5, roll: Math.atan2(yS - yP, 2 * B2) * 0.5 - (b.heel ?? 0) }, tmpRows);   // heel: Tessie's knock (+ starboard down)
    P0[0] = 0; P0[1] = night; P0[2] = 0; P0[3] = 0; P1[0] = P1[1] = P1[2] = P1[3] = 0;
    put(0, tmpRows, P0, P1); nSolid = 1;
    // the kayaks
    const K = CLEAR_KAYAK, KL = K.length / 2 - 0.1;
    let slot = 1;
    for (const k of T.kayaks) {
      const dk = Math.hypot(k.x - eye[0], k.z - eye[2]);
      if (dk > KAYAK_DRAW_M || (lite && dk > KAYAK_DRAW_M / 2)) continue;
      const kx = Math.sin(k.heading), kz = -Math.cos(k.heading), draft = k.crew === 2 ? 0.13 : k.crew ? 0.11 : 0.05;
      const wb = heightAt(k.x + kx * KL, k.z + kz * KL), ws = heightAt(k.x - kx * KL, k.z - kz * KL), wS = heightAt(k.x - kz * 0.4, k.z + kx * 0.4), wP = heightAt(k.x + kz * 0.4, k.z - kx * 0.4), wm = (wb + ws + wS + wP) / 4;
      const roll = Math.atan2(wS - wP, 0.8) * 0.6 + (k.st?.roll ?? 0), pitch = Math.atan2(wb - ws, 2 * KL) * 0.85 - (k.st?.dip ?? 0) * 0.01;
      poseRows({ x: k.x, y: wm - draft - (k.st?.dip ?? 0) * 0.03, z: k.z, yaw: -k.heading, pitch, roll }, tmpRows);
      P0[0] = 1; P0[1] = night; P0[2] = draft; P1[0] = k.led[0]; P1[1] = k.led[1]; P1[2] = k.led[2];
      put(slot, tmpRows, P0, P1); slot++; nKayak++; if (!k.crew) nEmpty++;
      // its paddlers: the kayaks' skin pipeline, posed from its stroke (the rest gait while towed or tied)
      const share = kayakRender?.share;
      if (k.crew && clips && share && figs.length < MAX_FIGURES && K.length * focalPx / Math.max(1, dk) >= FIGURE_PX && ensureFigs(share)) {
        const base = figs.length * SLOTS, look = k.look;
        if (k.st) k.st.body.roll = -0.9 * roll;
        clips.pose(look.sex, k.a.w, k.a.phase, figPal.subarray(base * 12, (base + SLOTS) * 12), k.st?.body ?? null);
        const px = K.length * focalPx / Math.max(1, dk), detail = px > 120;
        share.writeInst(figs.length, tmpRows, base, 0.11, lit(share.colours({ colour: 'yellow', look }), k.led, 0.45 * night), null, figIns, figInsU);
        figs.push({ part: look.sex, detail });
        if (k.crew === 2 && figs.length < MAX_FIGURES) {   // the tandem's bow paddler: the same stroke, in the forward seat
          const r = tmpRows.slice(), dzs = K.seats[1] - K.seats[0];
          r[3] += r[2] * dzs; r[7] += r[6] * dzs; r[11] += r[10] * dzs;
          share.writeInst(figs.length, r, base, 0.11, lit(share.colours({ colour: 'yellow', look: k.look2 }), k.led, 0.45 * night), null, figIns, figInsU);
          figs.push({ part: look.sex, detail });
        }
      }
    }
    // the spots: by day the shade under her and each kayak; at night the LEDs' pools; her wake's foam while she makes way
    const wy = (x, z) => heightAt(x, z) + 0.06;
    let si = slot;
    const spot = (x, z, h, rx, rz, kind, a, b2, c, i) => { if (si >= MAX_INST) return; P0[0] = kind; P0[1] = 0; P0[2] = 0; P0[3] = 0; P1[0] = a; P1[1] = b2; P1[2] = c; P1[3] = i; put(si, spotRows(x, wy(x, z), z, h, rx, rz), P0, P1); si++; };
    if (d < SPOT_DRAW_M) {
      if (sunUp > 0) {
        // the shadows on the bed (the owner's photos: each clear kayak's dark outline on the boulders, her roof's on the sand): the sun's
        // ray refracted into the water (Snell, n 1.333) carries the shadow d · tan θw off the hull, away from the sun; softer and fainter
        // with depth; her roof's shadow starts 2.2 m up, in the air
        const sl = Math.hypot(sun[0], sun[2]) || 1e-6, sy = Math.max(0.08, sun[1]), sinA = Math.min(0.999, sl / Math.hypot(sl, sy)), tanA = sinA / Math.sqrt(1 - sinA * sinA);
        const sinW = sinA / 1.333, tanW = sinW / Math.sqrt(1 - sinW * sinW), ax = -sun[0] / sl, az = -sun[2] / sl;
        const bed = (x, z, h, rx, rz, e, aMax, up = 0) => {
          const d = Math.max(0.3, depthAt(x, z)), off = d * tanW + up * tanA, soft = Math.min(0.45, 0.08 + 0.02 * d), a = aMax * sunUp * Math.exp(-0.02 * d);
          if (a > 0.02) spot(x + ax * off, z + az * off, h, rx + 0.012 * d, rz + 0.012 * d, 5, a, soft, e, 0);
        };
        bed(bx, bz, b.heading, PONTOON.roofHalfW, (PONTOON.roofZ[1] - PONTOON.roofZ[0]) / 2, 6, 0.5, PONTOON.roofY);
        spot(bx, bz, b.heading, 2.2, 5.6, 4, 0.18 * sunUp, 0, 0, 0);   // the contact shade under her logs
        for (const k of T.kayaks) if (Math.hypot(k.x - eye[0], k.z - eye[2]) < KAYAK_DRAW_M * 0.6) bed(k.x, k.z, k.heading, CLEAR_KAYAK.beam / 2, CLEAR_KAYAK.length / 2, 2, k.crew ? 0.8 : 0.6);
      }
      if (night > 0) {
        for (const k of T.kayaks) {
          const dep = Math.max(0.5, depthAt(k.x, k.z)), R = LED.poolR * (0.7 + 0.35 * Math.min(8, dep)), I = LED.pool * night * Math.exp(-0.09 * Math.min(20, dep)) * (1.4 / (0.7 + 0.35 * Math.min(8, dep))) ** 2;
          spot(k.x, k.z, k.heading, R * 0.75, R * 1.15, 2, k.led[0] * I, k.led[1] * I, k.led[2] * I, 1);
        }
        const dep = Math.max(0.5, depthAt(bx, bz)), R = 5.5 * (0.8 + 0.2 * Math.min(8, dep)), I = LED.under * night * Math.exp(-0.09 * Math.min(20, dep));
        spot(bx, bz, b.heading, R * 0.7, R * 1.3, 2, 0.30 * I, 0.72 * I, 1.0 * I, 1);
        // the lit cabin's warm spill on the water along each side (the roof strip and the courtesy strips through her open sides)
        const sI = LED.spill * night;
        for (const s of [-1, 1]) spot(bx - fz * s * 3.4, bz + fx * s * 3.4, b.heading, 3.2, PONTOON.length * 0.48, 2, 1.0 * sI, 0.78 * sI, 0.5 * sI, 1);
      }
      if (!lite && !mapWake) {   // the foam discs (the lite tier; the full tier's wake is the vessels' map: render/vesselWake.js)
        for (const w of T.wake) {
          const age = w.age, k = Math.min(1, w.v / (TOUR.speedKn * 0.514444)), fade = Math.exp(-age / 9) * k;
          if (fade < 0.03) continue;
          const h = Math.atan2(w.dx, -w.dz), sx = -w.dz, sz = w.dx, spread = 0.9 + age * w.v * 0.354;   // the arms spread at the Kelvin angle's tan (19.5°)
          spot(w.x, w.z, h, 1.1 + 0.12 * age, 2.0 + 0.2 * age, 3, 0.55 * fade, age, 0, 0);   // the wash between her outboards
          spot(w.x + sx * spread, w.z + sz * spread, h, 0.55 + 0.05 * age, 1.6, 3, 0.32 * fade, age + 3, 0, 0);
          spot(w.x - sx * spread, w.z - sz * spread, h, 0.55 + 0.05 * age, 1.6, 3, 0.32 * fade, age + 7, 0, 0);
        }
      }
    }
    nSpot = si - slot;
    device.queue.writeBuffer(ibuf, 0, inst, 0, si * REC * 4);
    if (figs.length) { device.queue.writeBuffer(figPalBuf, 0, figPal, 0, figs.length * SLOTS * 12); device.queue.writeBuffer(figInsBuf, 0, figIns, 0, figs.length * IREC * 4); }
    stats.pontoon = hiLod ? 'high' : 'low'; stats.kayaks = nKayak; stats.figures = figs.length; stats.spots = nSpot; stats.distM = Math.round(d);
  }
  const R = mesh.runs;
  function drawSolid(pass, c, { figures = true } = {}) {
    if (!shown) return;
    let calls = 0, tris = 0;
    pass.setPipeline(reg.get('tour-solid')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    const run = hiLod ? R.hi : R.lo; pass.draw(run.count, 1, run.first, 0); calls++; tris += run.count / 3;
    if (nEmpty) { pass.draw(R.framePaddle.count, nEmpty, R.framePaddle.first, 1); calls++; tris += R.framePaddle.count / 3 * nEmpty; }
    if (nKayak - nEmpty) { pass.draw(R.frame.count, nKayak - nEmpty, R.frame.first, 1 + nEmpty); calls++; tris += R.frame.count / 3 * (nKayak - nEmpty); }
    const share = kayakRender?.share;
    if (figures && figs.length && share) {
      pass.setPipeline(reg.get('kayak-skin')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, figBG); pass.setVertexBuffer(0, share.vb); pass.setIndexBuffer(share.ib, 'uint16');
      for (let i = 0; i < figs.length; i++) { const p = share.parts[figs[i].part], cnt = figs[i].detail ? p.indexCount : p.coreIndexCount ?? p.indexCount; pass.drawIndexed(cnt, 1, p.firstIndex, p.firstVertex, i); calls++; tris += cnt / 3; }
    }
    c.calls += calls; c.triangles += tris; stats.solidTris = tris; stats.calls = calls;
  }
  // her mirror in the water, after the water: the low pontoon and the kayaks' frames, while she is within MIRROR_M of the eye
  function drawMirror(pass, c) {
    if (!mirrors || !shown || !(stats.distM < MIRROR_M)) return;   // (src/core/features.js boatMirrors: no pipeline where off)
    pass.setPipeline(reg.get('tour-mirror')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    pass.draw(R.lo.count, 1, R.lo.first, 0); c.calls++; c.triangles += R.lo.count / 3;
    // her clear kayaks and their paddlers: parked with the other boats' mirrors (?mirrors=all; owner, 2026-11-19)
    if (mirrorKayaks && nKayak) { pass.draw(R.frame.count, nKayak, R.frame.first, 1); c.calls++; c.triangles += R.frame.count / 3 * nKayak; }
    // her paddlers in the mirror (the kayaks' skin mirror where it is built: the core LOD)
    const share = kayakRender?.share;
    if (mirrorKayaks && figs.length && share && reg.has?.('kayak-skin-mirror')) {
      pass.setPipeline(reg.get('kayak-skin-mirror')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, figBG); pass.setVertexBuffer(0, share.vb); pass.setIndexBuffer(share.ib, 'uint16');
      for (let i = 0; i < figs.length; i++) { const p = share.parts[figs[i].part], cnt = p.coreIndexCount ?? p.indexCount; pass.drawIndexed(cnt, 1, p.firstIndex, p.firstVertex, i); c.calls++; c.triangles += cnt / 3; }
    }
    stats.mirror = (stats.mirror ?? 0) + 1;
  }
  function drawClear(pass, c) {
    if (!shown) return;
    let calls = 0, tris = 0;
    pass.setPipeline(reg.get('tour-clear')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    if (nSpot) { pass.draw(R.spot.count, nSpot, R.spot.first, 1 + nKayak); calls++; tris += 2 * nSpot; }
    if (hiLod) { pass.draw(R.glass.count, 1, R.glass.first, 0); calls++; tris += R.glass.count / 3; }
    if (nKayak) { pass.draw(R.shell.count, nKayak, R.shell.first, 1); calls++; tris += R.shell.count / 3 * nKayak; }
    c.calls += calls; c.triangles += tris; stats.clearTris = tris; stats.calls += calls; stats.triangles = stats.solidTris + tris;
  }
  return { update, drawSolid, drawClear, drawMirror, stats, mesh };
}
