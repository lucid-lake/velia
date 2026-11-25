// The night's GPU side (M5e): the Milky Way's maps and the night record the sky draw and the water read
// (night-read.js), the stars as one instanced draw of soft points (v1's catalogue, the library's twinkle), and the
// glows: the towns' lights on the shore (v1's layout, packed: tools/v2-lights-pack.mjs) and the boat's nav lights, as
// camera-facing additive quads with a minimum size on screen and the energy of a far light spread over it. Everything
// is made at load (the textures at their full size, the buffers at their caps) and the data streams in after the first
// frame on a live page (a capture: before it), so there is nothing to create later and 0 pipelines after the first frame.
//   const night = createNight({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa, depthFormat });
//   createSky({ …, night })  night.attach(sky)      the sky draw binds night.bgl; the stars' pipeline binds the sky's group
//   night.waterBind(b0) → { layout, entries }      the record and the maps as the water draw group's bindings b0…b0+3
//   night.update({ hour, sunElevDeg, moon, levels, t, pose, eye, dims, focalPx })   each frame, before the uniform upload
//   night.load() → Promise (idempotent)             the maps, the stars and the lights (≈ 2.9 MB; 0.38 MB with milkyWay: false)
//   night.attachTerrain(terrain.hbgl)               the glitter streaks' pipeline (its shore test reads the terrain's heights)
//   night.draw(pass, c, sky, heightsBG)             after the sky: the stars, the town lights, the boat's lights, their streaks on the water
//   night.setRace(f32, n)                           step D: a night race's lit marks (regatta/nightMarks.js raceLights), n 0 for none
import { NIGHT, decodeStars, decodeLights, navLights, NAV_GLOW, FAR_POINT, GLOW_FLOATS, STAR_FLOATS, LIGHT_FLOATS } from '../sim/night.js';
import { NIGHT_READ } from './night-read.js';
import { ATMO_WGSL, SKY_READ } from './sky.js';
import { createMoon } from '../sim/moon.js';
import { AA } from './water-aa.js';   // the glint's Cox-Munk share: the streaks read the same slopes
import { TERRAIN_BIND, TERRAIN_HEIGHT } from './terrain.js';   // the streaks' shore test: the ground between the water and the light

const TEX = globalThis.GPUTextureUsage ?? { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// feat/v2-sky-v1-grade: v1's desktop map (4K, 2.4 MB, its desktop size: src/core/index.js), one channel (r8unorm: the same 8 MB of GPU memory
// as the 2K map in rgba8 was); a phone never fetches it
export const NIGHT_FILES = Object.freeze({ mw: '/data/sky/milkyway-4k.webp', tint: '/data/sky/milkyway-tint.png', mwSize: [4096, 2048], tintSize: [256, 128], mwFormat: 'r8unorm' });
export const CAPS = Object.freeze({ stars: 10000, lights: 32768, nav: 4, race: 24 });   // nav: the sidelights, the sternlight, the anchor light   // race: step D's lit marks (24 since the glass boat's three nav lights, 2026-11-18) (regatta/nightMarks.js NIGHT_MARKS.max: 12), then the channel markers' lamps (v2/sim/channelMarks.js markLights)
export const GLOW = Object.freeze({ townRadiance: 0.5, minPx: 3.0, energyPow: 1.4, townsBelowDeg: 4 });   // a town window's HDR radiance when on; the point's least size on screen; the far light's energy fall-off
// the lights in the water: each town and nav light's glitter streak, the glint of a point light off the wind's waves (the
// owner's 2026-11-25 bug: the old images sat at each light's mirror point as short dashes on their own ripple clocks, a band
// of speckles under the shore). Each light is a quad laid on the water along the eye-to-light line, from where its glints
// can no longer reach the eye toward the viewer to where they fade into the far shore; each pixel evaluates the microfacet
// glint of that light exactly (the slope that would send its light to the eye, Beckmann over the waves' slopes, Fresnel,
// Smith's masking, the light's own intensity over its distance squared), so the streak is long and thin at a grazing look,
// longer with more wind, tight and short on calm water, and falls off with distance by itself. The slopes: the sun glint's
// Cox-Munk share for the wind (render/water-aa.js AA.cox, coxShare; the wind not floored, so calm water is calm), split
// into the long waves (longShare: three swells along the waves' travel at the wind's peak wavelength, moving at their own
// deep-water speed, that break the column into a few steady glints) and the rest, unresolved, which only widens the lobe.
// A swell whose phase moves more than ~1 rad a pixel (far water) fades to its mean and its variance joins the lobe, so no
// pixel ever twinkles; the pixel's own footprint widens the lobe too (the far streaks stay at least a pixel wide, with the
// same energy). Each light's visible energy (the glow as drawn, with its minimum size on screen) is what it reflects, so a
// streak matches its light. The quad's length is cut where the streak drops under cut (HDR radiance): a far, dim light is a
// short soft smear and costs a few pixels; its depth is the eye ray's crossing of a plane hOcc above the water (the waves'
// crests never cut it into dashes), so the land and the boat still hide it. The shore test: the ground (plus a canopy
// allowance on land, but near the lamp itself) on the path from the streak's middle to the light, at shoreSteps points;
// where it stands in the way the streak fades out over clear metres (a hill light behind the shore's trees casts none).
//   gain: town lights; navGain: the boat's nav lights and the race marks (their 22 px halo floor is far more than their light)
export const GLOW_STREAK = Object.freeze({ gain: 1.0, navGain: 0.003, longShare: 0.65, peakK: 0.85, peakMin: 2.0, peakMax: 14.0, nMax: 3.0, ref: 6e-5, gamma: 1.0, cap: 0.006, cutK: 0.09, windRef: 2.8, windPow: 0.75, sat: 2.2, hOcc: [0.25, 0.9, 1.5], f0: 0.02, edge: 0.15, footAlong: 0.25, footAcross: 1.5, shoreSteps: 12, canopy: 25, canopyNear: 40, clear: 5 });

// --- the glitter streaks: one quad a light on the water, the light's glint evaluated per pixel ---
export const STREAKS_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
struct GlowU { mode: f32, radiance: f32, minPx: f32, focalPx: f32 }
struct Glow { p: vec4f, c: vec4f }
@group(1) @binding(0) var<uniform> GU: GlowU;
@group(1) @binding(1) var<storage, read> G: array<Glow>;
${TERRAIN_BIND(2)}
${TERRAIN_HEIGHT}
struct SV { @builtin(position) pos: vec4f, @location(0) wp: vec2f, @location(1) uv: vec2f, @location(2) @interpolate(flat) lp: vec4f, @location(3) @interpolate(flat) col: vec4f, @location(4) @interpolate(flat) dir: vec2f }
const COX_A = ${AA.cox[0]}; const COX_B = ${AA.cox[1]}; const COX_SHARE = ${AA.coxShare};
const LONG = ${GLOW_STREAK.longShare.toFixed(3)}; const NMAX = ${GLOW_STREAK.nMax.toFixed(2)}; const CUT = ${(GLOW_STREAK.ref * Math.pow(GLOW_STREAK.cutK / (1 - GLOW_STREAK.cutK), 1 / GLOW_STREAK.gamma)).toExponential(4)};   // the radiance whose shown level is cutK of cap
const PI = 3.14159265;
// the waves' slope variance per axis for the wind (the glint's Cox-Munk share)
fn mssAxis() -> f32 { return 0.5 * COX_SHARE * (COX_A * max(F.wind.x, 0.0) + COX_B); }
fn smith1(c: f32, s: f32) -> f32 {   // Beckmann's Smith masking (Walter 2007's rational fit); c the cosine to the normal, s the slope rms
  let a = c / max(s * sqrt(max(1.0 - c * c, 1e-6)), 1e-6);
  return select((3.535 * a + 2.181 * a * a) / (1.0 + 2.276 * a + 2.577 * a * a), 1.0, a >= 1.6);
}
fn peakLambda() -> f32 { return clamp(${GLOW_STREAK.peakK} * F.wind.x * F.wind.x, ${GLOW_STREAK.peakMin.toFixed(1)}, ${GLOW_STREAK.peakMax.toFixed(1)}); }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SV {
  var corners = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let g = G[ii]; let nav = GU.mode > 2.5;
  var o: SV; o.uv = corners[vi]; o.wp = vec2f(0.0); o.lp = vec4f(0.0); o.col = vec4f(0.0); o.dir = vec2f(1.0, 0.0);
  let off = vec4f(2.0, 2.0, 2.0, 1.0);
  let sunE = asin(clamp(F.sun.y, -1.0, 1.0)) * 57.29578;
  var on = g.c.w;
  if (!nav) { on = smoothstep(g.c.w + 1.0, g.c.w - 1.0, sunE) * GU.radiance; }
  let E = F.cam.xyz; let L = g.p.xyz; let he = E.y; let hl = L.y;
  let toL = L.xz - E.xz; let D = length(toL);
  if (on <= 0.001 || he <= 0.05 || hl <= 0.02 || D < 0.5) { o.pos = off; return o; }
  let dir = toL / D; let side = vec2f(-dir.y, dir.x);
  // the light's visible energy, as the glow draws it (radiance x sr): its least size on screen, a far light's fall
  let dist = length(L - E); let fpx = GU.focalPx;
  let farPt = g.p.w < 0.0; let fk = select(0.0, smoothstep(${FAR_POINT.nearM.toFixed(1)}, ${FAR_POINT.farM.toFixed(1)}, dist), farPt);
  let pxTrue = abs(g.p.w) / dist * fpx;
  var px = max(pxTrue, mix(GU.minPx, min(GU.minPx, ${FAR_POINT.minPx.toFixed(1)}), fk));
  on = on * mix(1.0, ${FAR_POINT.dim.toFixed(2)}, fk);
  var ev: f32;
  if (nav) { let h = 0.5 * px; ev = on * 0.0183 * h * h; }   // the halo (core and bloom) over its quad
  else { ev = on * pow(min(pxTrue / px, 1.0), ${GLOW.energyPow}) * 0.77 * px * px; }   // exp(-4 r^2) over the unit disc
  // its intensity; windK: a lamp's real light is far over the night water's, so its streak stays as clear in chop as in light
  // air, where our dimmer lamps' would fade into the wider lobe (the length and the breaks are still the wind's)
  let windK = pow(mssAxis() / (0.5 * COX_SHARE * (COX_A * ${GLOW_STREAK.windRef.toFixed(2)} + COX_B)), ${GLOW_STREAK.windPow.toFixed(2)});
  let I = ev / (fpx * fpx) * dist * dist * select(windK * ${GLOW_STREAK.gain.toFixed(3)}, ${GLOW_STREAK.navGain.toFixed(4)}, nav);
  // the slopes and the streak's extent: the peak at the mirror point, the length where it falls under CUT
  let s2 = mssAxis(); let sg = sqrt(s2);
  let tanM = (he + hl) / D; let bM = atan(tanM); let sinM = sin(bM);
  let xM = D * he / (he + hl); let rl2 = (D - xM) * (D - xM) + hl * hl;
  let fr = ${GLOW_STREAK.f0} + (1.0 - ${GLOW_STREAK.f0}) * pow(1.0 - sinM, 5.0);
  let gm = smith1(sinM, sg); 
  let sx = sqrt(s2 + pow(0.4 * D / (2.0 * fpx * hl), 2.0)); let sz = sqrt(s2 + pow(0.2 / fpx, 2.0));
  let pk = I / rl2 * fr * gm * gm / (4.0 * sinM) / (2.0 * PI * sx * sz);
  if (pk < CUT * 1.04) { o.pos = off; return o; }   // too dim to show anywhere: no shore test, no quad (most far lights)
  // the shore test: the ground on the path from the mirror point up to the light (its last 8 % is the lamp's own ground)
  var clear = 1e9;
  for (var k = 1; k <= ${GLOW_STREAK.shoreSteps}; k++) {
    let t = f32(k) / ${GLOW_STREAK.shoreSteps}.0 * 0.92;
    let xz = E.xz + dir * mix(xM, D, t);
    let gh = terrainHeight(xz.x, xz.y);
    let can = select(0.0, ${GLOW_STREAK.canopy.toFixed(1)}, gh > 0.5 && (1.0 - t) * (D - xM) > ${GLOW_STREAK.canopyNear.toFixed(1)});
    clear = min(clear, hl * t - gh - can);
  }
  let vis = smoothstep(-${GLOW_STREAK.clear.toFixed(1)}, ${GLOW_STREAK.clear.toFixed(1)}, clear);
  let n = min(sqrt(max(2.0 * log(max(pk * vis / CUT, 1.0)), 0.0)), NMAX);
  if (n < 0.25) { o.pos = off; return o; }
  let bNear = min(bM + 2.0 * n * sg, 1.45); let bFar = bM - 2.0 * (n + 0.5) * sg;
  let xNear = max(he / tan(bNear), 0.3);
  let xFar = select(D, min(he / tan(bFar), D), bFar > 1e-5);
  if (xFar <= xNear) { o.pos = off; return o; }
  let x = mix(xNear, xFar, o.uv.y);
  let w = max(3.0 * n * sg * (he + 0.3 * hl) * (1.0 - x / D) + 0.3, 3.0 * x / fpx);   // the lobe's half width (2 s he (1 - x/D) a slope s at a grazing look, wider for a high light), at least 3 px
  let p2 = E.xz + dir * x + side * (o.uv.x * w);
  // the depth: the eye ray's crossing of a plane hOcc above the water (a homothety about the eye: the quad stays planar)
  let hOcc = clamp(${GLOW_STREAK.hOcc[1].toFixed(2)} * F.windfx.w, ${GLOW_STREAK.hOcc[0].toFixed(2)}, ${GLOW_STREAK.hOcc[2].toFixed(2)});
  let k = clamp(1.0 - hOcc / he, 0.5, 0.995);
  let q = E + (vec3f(p2.x, 0.0, p2.y) - E) * k;
  o.pos = F.viewProj * vec4f(q, 1.0);
  o.wp = p2; o.lp = vec4f(L, I * vis); o.col = vec4f(g.c.rgb, select(${GLOW_STREAK.sat.toFixed(2)}, 1.0, nav)); o.dir = dir;   // w: the chroma lift (a town lamp's; a nav lens is already pure)
  return o;
}
// the long waves' slope at p (world xz) and the variance their faded parts hand to the lobe
fn longSlope(p: vec2f, fp: vec2f, t: f32, mssL: f32) -> vec3f {   // fp: the pixel's world footprint (fwidth of p)
  let lp = peakLambda(); let ang = F.wind.y;
  var offs = array<f32, 3>(0.0, -0.55, 0.62); var lk = array<f32, 3>(1.0, 0.57, 0.33); var wt = array<f32, 3>(0.5, 0.3, 0.2); var ph0 = array<f32, 3>(0.0, 2.1, 4.4);
  var s = vec2f(0.0); var lost = 0.0;
  for (var i = 0; i < 3; i++) {
    let th = ang + offs[i]; let d = vec2f(cos(th), sin(th)); let kw = 6.2831853 / (lp * lk[i]);
    let ph = kw * dot(d, p) - sqrt(9.81 * kw) * t + ph0[i];
    let A2 = 2.0 * mssL * wt[i];   // the slope amplitude squared (a sine's mean square is half of it)
    let keep = 1.0 - smoothstep(0.5, 1.5, kw * dot(abs(d), fp));   // the phase's step a pixel
    s += d * (sqrt(A2) * keep * sin(ph));
    lost += (1.0 - keep * keep) * 0.25 * A2;
  }
  return vec3f(s, lost);
}
@fragment fn fs(v: SV) -> @location(0) vec4f {
  let P = vec3f(v.wp.x, 0.0, v.wp.y);
  let Vd = F.cam.xyz - P; let V = normalize(Vd);
  let Ld = v.lp.xyz - P; let rl2 = max(dot(Ld, Ld), 1e-4); let Lv = Ld * inverseSqrt(rl2);
  let H = normalize(V + Lv);
  let s = -H.xz / max(H.y, 1e-3);   // the facet slope that sends the light to the eye
  let side = vec2f(-v.dir.y, v.dir.x);
  let sa0 = dot(s, v.dir); let sc0 = dot(s, side);
  let s2 = mssAxis();
  let fa = fwidth(sa0); let fc = fwidth(sc0); let fp = fwidth(v.wp);
  // the quad's tails: past 6 sigma of the whole spread (the swells shift the lobe by at most about 2.6) nothing shows
  let q0 = sa0 * sa0 / (s2 + ${GLOW_STREAK.footAlong.toFixed(2)} * fa * fa) + sc0 * sc0 / (s2 + ${GLOW_STREAK.footAcross.toFixed(2)} * fc * fc);
  if (q0 > 36.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let lw = longSlope(v.wp, fp, F.cam.w, 2.0 * LONG * s2);
  let sa = sa0 - dot(lw.xy, v.dir); let sc = sc0 - dot(lw.xy, side);
  let su = (1.0 - LONG) * s2 + lw.z;
  let va = su + ${GLOW_STREAK.footAlong.toFixed(2)} * fa * fa; let vc = su + ${GLOW_STREAK.footAcross.toFixed(2)} * fc * fc;   // the pixel's footprint in slope (across: a column never thinner than about footAcross^0.5 px, so a sub-pixel move of the eye never steps it)
  let pdf = exp(-0.5 * (sa * sa / va + sc * sc / vc)) / (2.0 * PI * sqrt(va * vc));
  let nv = max(V.y, 1e-3); let nl = max(Lv.y, 0.0);
  let sg = sqrt(s2);
  let fr = ${GLOW_STREAK.f0} + (1.0 - ${GLOW_STREAK.f0}) * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  let hy2 = H.y * H.y;
  var lum = v.lp.w / rl2 * fr * smith1(nv, sg) * smith1(nl, sg) * pdf / (4.0 * nv * hy2 * hy2);
  // the quad's edges fade (its bound is generous; no hard line), the near end too
  let e = ${GLOW_STREAK.edge.toFixed(2)};
  lum *= (1.0 - smoothstep(1.0 - e, 1.0, abs(v.uv.x))) * smoothstep(0.0, e, v.uv.y) * (1.0 - smoothstep(1.0 - 0.5 * e, 1.0, v.uv.y));
  // the light's hue, its chroma lifted by sat (the night's Purkinje shift and the tone curve grey a dim warm light on the navy;
  // the eye sees a lamp's streak as warm as the lamp)
  let y0 = dot(v.col.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let c = max(mix(vec3f(y0), v.col.rgb, v.col.w), vec3f(0.0));
  // the shown level: the glint's radiance over a soft shoulder to cap (x^gamma first, 1: none), so a glint never burns white
  let x = pow(lum / ${GLOW_STREAK.ref.toExponential(3)}, ${GLOW_STREAK.gamma.toFixed(3)});
  let shown = ${GLOW_STREAK.cap.toFixed(4)} * x / (1.0 + x);
  return vec4f(c * (shown / max(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 1e-3)), 1.0);
}`;

// --- the stars: one soft point an instance, placed in the vertex stage from the catalogue ---
export const STARS_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${NIGHT_READ(2, 0)}
@group(2) @binding(4) var<storage, read> STARS: array<vec4f>;
struct SV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f, @location(2) sig: f32 }
const TW_AMP = ${NIGHT.twinkle.amp}; const TW_HOR = ${NIGHT.twinkle.horizon}; const TW_HZ0 = ${NIGHT.twinkle.hz[0]}; const TW_HZ1 = ${NIGHT.twinkle.hz[1]}; const TW_COL = ${NIGHT.twinkle.colour};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SV {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let a = STARS[ii * 2u]; let b = STARS[ii * 2u + 1u];
  let d = normalize(vec3f(dot(NU.m0.xyz, a.xyz), dot(NU.m1.xyz, a.xyz), dot(NU.m2.xyz, a.xyz)));
  var o: SV; o.uv = vec2f(0.0); o.sig = 1.0;
  let clip = F.viewProj * vec4f(F.cam.xyz + d * 50000.0, 1.0);
  if (d.y < -0.01 || clip.w <= 0.0 || NU.p.y <= 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.col = vec3f(0.0); return o; }
  // feat/v2-sky-v1-grade: v1's pin-points. The star's light over a small gaussian: sigma NU.p.z px for the faint ones, up to
  // NU.q.w px for the brightest (magnitude −1 and brighter); the quad 3 sigma each way (at least 1.5 px)
  let sig = mix(NU.p.z, NU.q.w, 1.0 - smoothstep(-1.0, 4.0, a.w));
  let ext = max(3.0 * sig, 1.5);
  o.uv = corners[vi] * ext; o.sig = sig;
  let ndc = clip.xy / clip.w + corners[vi] * ext * F.res.zw * 2.0;
  o.pos = vec4f(ndc, 0.0, 1.0);
  // the brightness: the magnitude (10^(−0.4 m)), the air's extinction along d, the clouds' transmittance, the twinkle
  // (a seeded sum of two sines on the scene clock, more near the horizon: v1's round 5)
  let seed = fract(sin(f32(ii) * 12.9898) * 43758.5453);
  let t = NU.p.w;
  let s1 = sin(t * TW_HZ0 * 6.2831853 * (seed * 0.6 + 0.7) + seed * 61.7);
  let s2 = sin(t * TW_HZ1 * 6.2831853 * (seed * 0.5 + 0.75) + seed * 17.3);
  let air = (1.0 - smoothstep(0.05, 0.5, d.y));
  let k = 1.0 + (s1 * 0.6 + s2 * 0.4) * mix(TW_AMP, TW_HOR, air);
  let tint = vec3f(1.0 + s2 * TW_COL * air, 1.0, 1.0 - s2 * TW_COL * air);
  let rCam = Rg + F.sky.z;
  let L = NU.p.y * pow(10.0, -0.4 * a.w) * k * cloudAt(d).a / (6.2831853 * sig * sig);   // the peak: the light ÷ the gaussian's area
  o.col = b.xyz * tint * L * transAt(rCam, max(d.y, 0.0));
  return o;
}
@fragment fn fs(v: SV) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  return vec4f(v.col * exp(-r2 / (2.0 * v.sig * v.sig)), 1.0);
}`;

// --- the glows: a camera-facing soft quad a light, from a storage list; two modes in one pipeline (the record's w) ---
export const GLOWS_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
struct GlowU { mode: f32, radiance: f32, minPx: f32, focalPx: f32 }
struct Glow { p: vec4f, c: vec4f }   // p: x, y, z, size (m); c: r, g, b, w = the switch-on sun elevation (deg; mode 0) or the radiance now (mode 1)
@group(1) @binding(0) var<uniform> GU: GlowU;
@group(1) @binding(1) var<storage, read> G: array<Glow>;
struct GV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f }
// A1: the nav lights (mode 1) as v1's halos: the quad's full width max(size, minPx px), no energy fall-off with distance
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GV {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let g = G[ii];
  var o: GV; o.uv = corners[vi];
  let sunE = asin(clamp(F.sun.y, -1.0, 1.0)) * 57.29578;
  var on = g.c.w;
  let mode = GU.mode;
  if (mode < 0.5) { on = smoothstep(g.c.w + 1.0, g.c.w - 1.0, sunE) * GU.radiance; }   // a town light: on from its own sun elevation
  let clip = F.viewProj * vec4f(g.p.xyz, 1.0);
  if (on <= 0.001 || clip.w <= 0.2) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.col = vec3f(0.0); return o; }
  // a negative size: a far point light (sim/night.js FAR_POINT): the floor and the level fall with the distance past nearM
  let farPt = g.p.w < 0.0; let fk = select(0.0, smoothstep(${FAR_POINT.nearM.toFixed(1)}, ${FAR_POINT.farM.toFixed(1)}, clip.w), farPt);
  let pxTrue = abs(g.p.w) / clip.w * GU.focalPx;
  var px = max(pxTrue, mix(GU.minPx, min(GU.minPx, ${FAR_POINT.minPx.toFixed(1)}), fk));
  on = on * mix(1.0, ${FAR_POINT.dim.toFixed(2)}, fk);
  var fall = pow(min(pxTrue / px, 1.0), ${GLOW.energyPow});   // a far light's energy spread over the least size
  if (mode > 0.5) { px = 0.5 * px; fall = 1.0; }   // A1: size and minPx are the halo's full width; v1 keeps the level
  let ext = vec2f(px, px); let z = clip.z / clip.w;
  let ndc = clip.xy / clip.w + corners[vi] * ext * F.res.zw * 2.0;
  o.pos = vec4f(ndc * clip.w, z * clip.w, clip.w);
  o.col = g.c.rgb * on * fall;
  return o;
}
@fragment fn fs(v: GV) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  // A1: v1's halo (src/boat/details-mesh.js): a hot core and a faint round bloom gone well inside the quad (0.006 : 0.6)
  if (GU.mode > 0.5) { return vec4f(v.col * (exp(-r2 * 200.0) + 0.01 * exp(-r2 * 12.0)), 1.0); }
  return vec4f(v.col * exp(-r2 * 4.0) * step(r2, 1.0), 1.0);
}`;

export function createNight({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa = 1, depthFormat = 'depth32float', errors = [], place = null, fetchImpl = (u) => fetch(u), milkyWay = true }) {
  const VF = STAGE.VERTEX | STAGE.FRAGMENT;
  const tex = (label, [w, h], format = 'rgba8unorm') => device.createTexture({ label, size: [w, h], format, usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT });
  // milkyWay false (a phone: src/core/features.js): the maps are never fetched, 1 × 1 textures stand in and the band's
  // scale stays 0 (the sky and the water read no Milky Way); the stars, the moon and the lights are unchanged
  const tMW = tex('night-milkyway', milkyWay ? NIGHT_FILES.mwSize : [1, 1], NIGHT_FILES.mwFormat), tMWt = tex('night-milkyway-tint', milkyWay ? NIGHT_FILES.tintSize : [1, 1]);
  const vMW = tMW.createView(), vMWt = tMWt.createView();
  const sMW = device.createSampler({ label: 'night-map', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' });
  const NU = new Float32Array(20);
  const nuBuf = device.createBuffer({ label: 'night-record', size: NU.byteLength, usage: BUF.UNIFORM | BUF.COPY_DST });
  const starsBuf = device.createBuffer({ label: 'night-stars', size: CAPS.stars * STAR_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const lightsBuf = device.createBuffer({ label: 'night-lights', size: CAPS.lights * GLOW_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const navBuf = device.createBuffer({ label: 'night-nav', size: CAPS.nav * GLOW_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const nav = new Float32Array(CAPS.nav * GLOW_FLOATS);
  const raceBuf = device.createBuffer({ label: 'night-race', size: CAPS.race * GLOW_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const glowU = [new Float32Array([0, GLOW.townRadiance, GLOW.minPx, 1000]), new Float32Array([1, 0, NAV_GLOW.minPx, 1000]),   // A1: the nav lights' own floor (v1's 22 px)
    new Float32Array([2, GLOW.townRadiance, GLOW.minPx, 1000]), new Float32Array([3, 0, NAV_GLOW.minPx, 1000])];   // their streaks in the water (the glows' own floors: a streak reflects its light as drawn)
  const glowBufs = glowU.map((_, i) => device.createBuffer({ label: `night-glow-${i}`, size: 16, usage: BUF.UNIFORM | BUF.COPY_DST }));
  // the night group (the sky draw's group 2, the stars' too): the record, the maps, the sampler, the stars
  const bgl = device.createBindGroupLayout({ label: 'night', entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: VF, texture: {} }, { binding: 2, visibility: VF, texture: {} }, { binding: 3, visibility: VF, sampler: {} },
    { binding: 4, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: nuBuf } }, { binding: 1, resource: vMW }, { binding: 2, resource: vMWt }, { binding: 3, resource: sMW }, { binding: 4, resource: { buffer: starsBuf } }] });
  const glowBGL = device.createBindGroupLayout({ label: 'night-glow', entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } }] });
  const bgTowns = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[0] } }, { binding: 1, resource: { buffer: lightsBuf } }] });
  const bgNav = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[1] } }, { binding: 1, resource: { buffer: navBuf } }] });
  const bgTownsR = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[2] } }, { binding: 1, resource: { buffer: lightsBuf } }] });
  const bgNavR = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[3] } }, { binding: 1, resource: { buffer: navBuf } }] });
  // step D: the race's lit marks draw as nav lights (the halo, its 22 px floor, the faint image in the water) from their own list
  const bgRace = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[1] } }, { binding: 1, resource: { buffer: raceBuf } }] });
  const bgRaceR = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[3] } }, { binding: 1, resource: { buffer: raceBuf } }] });
  const moon = createMoon(place ?? undefined);
  const M = new Float32Array(9);
  const state = { loaded: false, loading: null, error: null, stars: 0, lights: 0, base: 0, extra: 0, band: 0, k: 0, bytes: 0, loadMs: 0, race: 0, milkyWay: !!milkyWay, streaks: false };
  device.queue.writeBuffer(nuBuf, 0, NU);
  for (let i = 0; i < glowU.length; i++) device.queue.writeBuffer(glowBufs[i], 0, glowU[i]);

  // the lights as glow records: x, y, z, size | r, g, b, the switch-on elevation
  function glowsOf(L, n) {
    const G = new Float32Array(n * GLOW_FLOATS);
    for (let i = 0; i < n; i++) { const k = i * LIGHT_FLOATS, o = i * GLOW_FLOATS; G[o] = L.data[k]; G[o + 1] = L.data[k + 1]; G[o + 2] = L.data[k + 2]; G[o + 3] = L.data[k + 6]; G[o + 4] = L.data[k + 3]; G[o + 5] = L.data[k + 4]; G[o + 6] = L.data[k + 5]; G[o + 7] = L.data[k + 7]; }
    return G;
  }
  // a region's own lights (the south's facades and docks: v2/assets/night/lights-south.bin, loaded with its buildings), after the
  // lake's in the same list: one draw as before, a few hundred more glows
  let extra = null, extraP = null;
  function writeExtra() {
    if (!state.loaded || !extra || extra.done) return;
    const m = Math.min(extra.count, CAPS.lights - state.base);
    if (m > 0) device.queue.writeBuffer(lightsBuf, state.base * GLOW_FLOATS * 4, glowsOf(extra, m));
    state.lights = state.base + m; state.extra = m; extra.done = true;
  }
  return {
    // url: a VLT1 file (tools/v2-lights-pack.mjs); idempotent; the lake's lights may come before or after it
    addLights(url) {
      return (extraP ??= (async () => {
        const r = await fetchImpl(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const a = new Uint8Array(await r.arrayBuffer()); state.bytes += a.byteLength;
        extra = decodeLights(a); writeExtra(); return true;
      })().catch((e) => { errors.push(`night: ${e?.message ?? e}`); return false; }));
    },
    bgl, bg, moon, stats: state, textures: { tMW, tMWt }, buffers: { nuBuf, starsBuf, lightsBuf, navBuf, raceBuf },
    // step D: a night race's lit marks for this frame (GLOW_FLOATS each); n 0 draws none (a day race, outside a race)
    setRace(f32, n = 0) {
      const k = Math.max(0, Math.min(CAPS.race, n | 0));
      if (k > 0) device.queue.writeBuffer(raceBuf, 0, f32, 0, k * GLOW_FLOATS);
      state.race = k;
    },
    // the record and the maps as another draw group's bindings (the water: its group 2, bindings b0…b0+3)
    waterBind(b0 = 4) {
      return {
        layout: [{ binding: b0, visibility: STAGE.FRAGMENT, buffer: { type: 'uniform' } }, { binding: b0 + 1, visibility: STAGE.FRAGMENT, texture: {} }, { binding: b0 + 2, visibility: STAGE.FRAGMENT, texture: {} }, { binding: b0 + 3, visibility: STAGE.FRAGMENT, sampler: {} }],
        entries: [{ binding: b0, resource: { buffer: nuBuf } }, { binding: b0 + 1, resource: vMW }, { binding: b0 + 2, resource: vMWt }, { binding: b0 + 3, resource: sMW }],
      };
    },
    // the two draw pipelines, on the registry at load (after createSky: the stars bind the sky's read group for the air)
    attach(sky) {
      const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
      const mS = reg.shader('night-stars', STARS_WGSL(frameStruct));
      reg.add('night-stars', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mS, entryPoint: 'vs' }, fragment: { module: mS, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: add }] },
        primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });
      const mG = reg.shader('night-glows', GLOWS_WGSL(frameStruct));
      reg.add('night-glows', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, glowBGL] }), vertex: { module: mG, entryPoint: 'vs' }, fragment: { module: mG, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: add }] },
        primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
    },
    // the glitter streaks' pipeline, once the terrain's heights group exists (render/terrain.js hbgl: the shore test)
    attachTerrain(heightsBGL) {
      const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
      const mR = reg.shader('night-streaks', STREAKS_WGSL(frameStruct));
      reg.add('night-streaks', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, glowBGL, heightsBGL] }), vertex: { module: mR, entryPoint: 'vs' }, fragment: { module: mR, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: add }] },
        primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
      state.streaks = true;
    },
    // the maps, the catalogue and the lights (idempotent; a live page calls it once the sun is low, a capture before its first frame)
    load() {
      if (state.loading) return state.loading;
      const t0 = performance.now();
      state.loading = (async () => {
        const base = document.baseURI;
        const bitmap = async (url) => { const r = await fetchImpl(new URL(url, base)); if (!r.ok) throw new Error(`${url}: ${r.status}`); const b = await r.blob(); state.bytes += b.size; return createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); };
        const bytes = async (url) => { const r = await fetchImpl(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); const a = new Uint8Array(await r.arrayBuffer()); state.bytes += a.byteLength; return a; };
        const [mw, tint, st, li] = await Promise.all([milkyWay ? bitmap(NIGHT_FILES.mw) : null, milkyWay ? bitmap(NIGHT_FILES.tint) : null, bytes(new URL('../assets/night/stars.bin', import.meta.url)), bytes(new URL('../assets/night/lights.bin', import.meta.url))]);
        if (mw) device.queue.copyExternalImageToTexture({ source: mw }, { texture: tMW }, NIGHT_FILES.mwSize);
        if (tint) device.queue.copyExternalImageToTexture({ source: tint }, { texture: tMWt }, NIGHT_FILES.tintSize);
        const S = decodeStars(st), L = decodeLights(li);
        state.stars = Math.min(S.count, CAPS.stars); state.lights = Math.min(L.count, CAPS.lights);
        device.queue.writeBuffer(starsBuf, 0, S.data, 0, state.stars * STAR_FLOATS);
        device.queue.writeBuffer(lightsBuf, 0, glowsOf(L, state.lights));
        state.base = state.lights; state.loaded = true; state.loadMs = +(performance.now() - t0).toFixed(1);
        writeExtra();   // a region's own lights that came first (addLights)
        return true;
      })().catch((e) => { state.error = String(e?.message ?? e); errors.push(`night: ${state.error}`); return false; });
      return state.loading;
    },
    // each frame, before the uniform ring's upload: the record (the sky's rotation at the hour, the levels, the twinkle's
    // clock), the boat's nav lights, the glows' focal length
    update({ hour, levels, t = 0, pose = null, eye, dims = null, sunElevDeg = 90, focalPx = 1000, mastHead = null }) {   // mastHead: the anchor light's hull-frame point (lit while pose.anchorLight)
      moon.skyMatrix(hour, M);
      NU[0] = M[0]; NU[1] = M[1]; NU[2] = M[2]; NU[4] = M[3]; NU[5] = M[4]; NU[6] = M[5]; NU[8] = M[6]; NU[9] = M[7]; NU[10] = M[8];
      const band = state.loaded ? levels.band : 0;
      NU[12] = milkyWay ? band * NIGHT.band * NIGHT.bandShow * NIGHT.airglow : 0; NU[13] = band * NIGHT.starScale; NU[14] = NIGHT.starPx; NU[15] = t;
      NU[16] = state.stars; NU[17] = state.lights; NU[18] = GLOW.townRadiance; NU[19] = NIGHT.starPxMax;
      device.queue.writeBuffer(nuBuf, 0, NU);
      state.band = band; state.k = levels.k;
      for (const u of glowU) u[3] = focalPx;
      device.queue.writeBuffer(glowBufs[0], 0, glowU[0]); device.queue.writeBuffer(glowBufs[2], 0, glowU[2]);
      if (pose && dims) navLights(nav, { pose, sunElevDeg, eye, dims, anchored: !!pose.anchorLight, mastHead }), device.queue.writeBuffer(navBuf, 0, nav);
      if ((pose && dims) || state.race > 0) { device.queue.writeBuffer(glowBufs[1], 0, glowU[1]); device.queue.writeBuffer(glowBufs[3], 0, glowU[3]); }   // step D: the race's marks share the nav lights' record
      state.navOn = !!(pose && dims) && sunElevDeg < 1.5;
      state.townsOn = state.loaded && sunElevDeg < GLOW.townsBelowDeg;
    },
    // after the sky: the stars (where the sky is), then the glows (depth-tested against the world)
    draw(pass, c, sky, heightsBG = null) {   // heightsBG: the terrain's heights group (the streaks' shore test; none: no streaks)
      if (state.band > 0 && state.stars > 0) {
        pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
        pass.setPipeline(reg.get('night-stars')); pass.draw(6, state.stars); c.calls++; c.triangles += state.stars * 2;
      }
      if (!(state.townsOn || state.navOn || state.race > 0)) return;
      pass.setPipeline(reg.get('night-glows'));
      if (state.townsOn) { pass.setBindGroup(1, bgTowns); pass.draw(6, state.lights); c.calls++; c.triangles += state.lights * 2; }
      if (state.navOn) { pass.setBindGroup(1, bgNav); pass.draw(6, CAPS.nav); c.calls++; c.triangles += CAPS.nav * 2; }
      if (state.race > 0) { pass.setBindGroup(1, bgRace); pass.draw(6, state.race); c.calls++; c.triangles += state.race * 2; }
      // their glitter streaks on the water (most lights cull in the vertex stage: too dim, too far, or no water before them)
      if (!state.streaks || !heightsBG) return;
      pass.setPipeline(reg.get('night-streaks')); pass.setBindGroup(2, heightsBG);
      if (state.townsOn) { pass.setBindGroup(1, bgTownsR); pass.draw(6, state.lights); c.calls++; c.triangles += state.lights * 2; }
      if (state.navOn) { pass.setBindGroup(1, bgNavR); pass.draw(6, CAPS.nav); c.calls++; c.triangles += CAPS.nav * 2; }
      if (state.race > 0) { pass.setBindGroup(1, bgRaceR); pass.draw(6, state.race); c.calls++; c.triangles += state.race * 2; }
    },
  };
}
