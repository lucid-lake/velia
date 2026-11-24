// v1's camera on v2's frame (fix(v2) frame look, 2026-11-14): the tone curve, the noon grade and the polariser sky.
// v1 (src/core/post.js, src/core/grade.js) draws: the scene → a sky-only polariser curve on the true sky (before the
// clouds) → the clouds → the storm's grade → AgX at v1's exposure → a 3D LUT (one noon grade, its strength by the sun).
// v2 had one tone curve (ACES, Narkowicz's fit) and no grade, so its clear sky read deeper and duller blue than v1's
// and its clouds grey (§ The clouds' colour). This module is that chain's v2 side, with no three.js:
//   AGX_WGSL     three.js r184's AgX (src/nodes/display/ToneMappingFunctions.js agxToneMapping), the same matrices and
//                the same sigmoid polynomial; agx() is its JS twin (the tests compare them)
//   gradeSrgb    v1's GRADE (src/core/grade.js gradeSrgb), the same maths: an S curve on L*, chroma by hue band, the
//                blue turned toward cyan, subtractive chroma, a soft shoulder, a split tone; gradeLutData bakes it once
//                at load into a 17³ RGBA8 3D texture (4,913 entries, ≈ 1 ms); gradeStrength its strength by the sun
//   POLAR_WGSL   v1's sky curve (SKY: luminance × 0.53, chroma × 1.6 round it, by day only: the sun 2–12° up), applied
//                in v2's sky draw to the sky's own light before the deck is laid over it, never to the water's mirror
//                of the sky (v1's curve reads the depth buffer's far plane: the reflected sky is not "sky" there)
// The numbers are v1's; tests/frame-look.test.mjs holds the port to v1's own functions.


import { TWILIGHT, twilightShare, nightSkyShare } from '../sim/exposure.js';   // the twilight lift's maths (the sims read it too)
export const SKY = Object.freeze({ lum: 0.53, sat: 1.6, dayDeg: [2, 12] });
export const GRADE = Object.freeze({
  size: 17, pivot: 50, slope: 1.06, liftMid: -2,
  chroma: { blue: 1.25, cyan: 1.3, green: 1.15, warm: 1.06 },
  blueTurn: -10, subtractive: 0.18, shoulder: [86, 96],
  split: { shadowB: -2.5, highB: 1.5 }, night: 0.35, dayDeg: [-4, 6],
});

const M1 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]];
const M2 = [[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]];
const WHITE = [0.95047, 1, 1.08883];
export const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export function srgbToLab([r, g, b]) {
  const c = [toLin(r), toLin(g), toLin(b)];
  const f = (t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const xyz = M1.map((row, i) => f((row[0] * c[0] + row[1] * c[1] + row[2] * c[2]) / WHITE[i]));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}
export function labToSrgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, d = 6 / 29;
  const inv = (t) => (t > d ? t ** 3 : 3 * d * d * (t - 4 / 29));
  const xyz = [inv(fx) * WHITE[0], inv(fy), inv(fz) * WHITE[2]];
  return M2.map((row) => toSrgb(Math.min(1, Math.max(0, row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]))));
}
const win = (h, c, w) => { const d = Math.abs(((h - c + 540) % 360) - 180); return Math.cos(Math.min(d / w, 1) * Math.PI / 2) ** 2; };
// one sRGB colour through v1's grade (0..1 in, 0..1 out)
export function gradeSrgb(rgb, G = GRADE) {
  const [L, a, b] = srgbToLab(rgb);
  const x = (L - G.pivot) / 50;
  let Ls = G.pivot + 50 * Math.tanh(x * G.slope) / Math.tanh(G.slope);
  Ls += G.liftMid * Math.exp(-(((L - 50) / 28) ** 2));
  const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  const wb = win(h, 265, 55), wc = win(h, 205, 40), wg = win(h, 140, 50), ww = Math.max(0, 1 - wb - wc - wg);
  const k = (wb * G.chroma.blue + wc * G.chroma.cyan + wg * G.chroma.green + ww * G.chroma.warm) / Math.max(wb + wc + wg + ww, 1e-6);
  const gain = 1 + (k - 1) * Math.min(1, C / 6);
  const C2 = Math.min(C * gain, 80);
  const h2 = h + G.blueTurn * wb * Math.min(1, C / 6);
  Ls -= G.subtractive * (C2 - C);
  const [s0, s1] = G.shoulder;
  if (Ls > s0) Ls = s0 + (s1 - s0) * Math.tanh((Ls - s0) / (s1 - s0));
  const t = Math.min(1, Math.max(0, Ls / 100));
  const a2 = C2 * Math.cos(h2 * Math.PI / 180), b2 = C2 * Math.sin(h2 * Math.PI / 180) + G.split.shadowB * (1 - t) ** 2 + G.split.highB * t * t;
  return labToSrgb([Math.min(100, Math.max(0, Ls)), a2, b2]);
}
// the LUT as RGBA8 (red fastest), size³: written once at load into a 3D texture
export function gradeLutData(G = GRADE) {
  const n = G.size, out = new Uint8Array(n * n * n * 4);
  for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
    const o = gradeSrgb([ri / (n - 1), gi / (n - 1), bi / (n - 1)], G), k = 4 * (ri + n * (gi + n * bi));
    out[k] = Math.round(o[0] * 255); out[k + 1] = Math.round(o[1] * 255); out[k + 2] = Math.round(o[2] * 255); out[k + 3] = 255;
  }
  return out;
}
const smooth01 = (lo, hi, x) => { const k = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return k * k * (3 - 2 * k); };
export const gradeStrength = (elevDeg, G = GRADE) => G.night + (1 - G.night) * smooth01(G.dayDeg[0], G.dayDeg[1], elevDeg);
export const skyStrength = (elevDeg, S = SKY) => smooth01(S.dayDeg[0], S.dayDeg[1], elevDeg);

// --- AgX (three.js r184), JS twin: linear sRGB × exposure → display-linear sRGB 0..1 ---
const mulM = (m, v) => [m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2], m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2], m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]];   // columns, as WGSL's mat3x3f
const TO2020 = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]];
const FROM2020 = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const INSET = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const OUTSET = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const MIN_EV = -12.47393, MAX_EV = 4.026069;
const contrast = (x) => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; };
export function agx(rgb) {
  let c = mulM(INSET, mulM(TO2020, rgb));
  c = c.map((v) => contrast(Math.min(1, Math.max(0, (Math.log2(Math.max(v, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV)))));
  c = mulM(OUTSET, c).map((v) => Math.max(0, v) ** 2.2);
  return mulM(FROM2020, c).map((v) => Math.min(1, Math.max(0, v)));
}
const m3 = (m) => `mat3x3f(${m.map((col) => col.map((x) => x.toFixed(9)).join(', ')).join(', ')})`;
export const AGX_WGSL = `
fn agxContrast(x: vec3f) -> vec3f { let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
fn agx(x0: vec3f) -> vec3f {
  var c = ${m3(INSET)} * (${m3(TO2020)} * x0);
  c = clamp((log2(max(c, vec3f(1e-10))) - ${MIN_EV}) / ${(MAX_EV - MIN_EV).toFixed(6)}, vec3f(0.0), vec3f(1.0));
  c = pow(max(${m3(OUTSET)} * agxContrast(c), vec3f(0.0)), vec3f(2.2));
  return clamp(${m3(FROM2020)} * c, vec3f(0.0), vec3f(1.0));
}`;

// The sky match (fitted, 2026-11-14): v2's atmosphere (render/sky.js, Hillaire) is dimmer against its sunlit ground than
// v1's takram sky is against v1's hand-lit ground, and more saturated (the cloudless noon cam E, both apps' tone curves
// inverted: v1's sky came into its tone curve at 4.0–4.4 × v2's luminance, its red at 5.2 ×, its blue at 3.5 ×). SKY_MATCH
// turns v2's sky radiance into v1's (luminance × lum, chroma round it × sat) wherever v1 shows that sky unfiltered: the sky
// draw (then v1's polariser) and, at grazing rays, the water's mirror (MIRROR_SKY below). Fitted through AgX and v1's LUT at
// the day exposure on noon cam E's samples (beside the clouds, the horizon, 30° up; tools/v2-cloud-colour.mjs): the whole
// curve lum 2.1, sat 1.2 (v1's polariser 0.53 and 1.6 over the match). At F.look.w (main.js skyMatchStrength: full with the
// sun over 8°, none under −2°: the night's airglow sky is v2's own; the sunset gets most of it, as v1's 20:00 sky).
export const SKY_MATCH = Object.freeze({ lum: 1.62 / SKY.lum, sat: 1.2 / SKY.sat, dayDeg: [-2, 8] });
// The twilight lift (owner, 2026-11-19,: the dusk and dawn sky and water read 3-4 x too dark, their hue right):
// the match's fade under -2 deg took v1's 3 x sky gain away just as the sky's own light went, so the blue hour fell to a night-ish
// navy (zenith L 11-15 against the wallpaper's 48). Through the twilight the sky keeps `sky` of the match (value only: the hue is
// the atmosphere's own) and the deck `cloudSky` x its sky light; both fade in over `deg` [0, 1] (the deep twilight into the night:
// the night's long exposure is untouched) and out over [2, 3] (the sunset, where the day's match takes over)
// Round 2 (owner, 2026-11-19: "We still need to darken the sky at night"): the lift holds through the blue hour (to the sun's −4.5°,
// about 20:52) and is gone by −6.5° (about 21:05); past it the drawn sky darkens to `night` × its own (the deep blue-black of the
// night look), eased over nightDeg [−4.5 → −9.5]. Only the drawn sky: the stars and the Milky Way are added after
// it, the water's mirror and the light the sky casts keep theirs (the water and the shore stay readable: never sailing blind).
// TWILIGHT, twilightShare, nightSkyShare live in sim/exposure.js (the sims read them; refactor round 3 C6), re-exported here
export { TWILIGHT, twilightShare, nightSkyShare };
// The sign carries it: skyMatchStrength < 0 is the night's dim (1 + w the sky's factor), > 0 the match's share
export function skyMatchStrength(elevDeg, M = SKY_MATCH, T = TWILIGHT) {
  const w = Math.max(smooth01(M.dayDeg[0], M.dayDeg[1], elevDeg), T.sky * twilightShare(elevDeg, T));
  return w > 0 ? w : -(1 - T.night) * nightSkyShare(elevDeg, T);
}
// The mirror's share of the match by the reflected ray's elevation sine (≈ the view's depression for a flat sea): full under
// 'full', none over 'none'. Measured on the same pose in both apps (noon cam E, a column down the open water): 15–25° below
// the horizon v1's water reads 61, 105, 144, v2's with its own sky in the mirror 4, 61, 113; near the vertical v1's reads
// 1, 30, 79 and v2's own-sky mirror 0, 26, 77. So v1's water mirrors more only at grazing angles; a full match everywhere
// lifted the follow camera's whole near sea toward the rejected bright mid-water blue
export const MIRROR_SKY = Object.freeze({ full: 0.15, none: 0.5 });
export const SKY_CURVE_WGSL = `
fn skyCurve(c: vec3f, lum: f32, sat: f32, k: f32) -> vec3f {
  let Y = max(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 1e-6);
  return mix(c, max(vec3f(Y) + (c - vec3f(Y)) * sat, vec3f(0.0)) * lum, k);
}
// v2's sky radiance as v1's sky (SKY_MATCH), the polariser's day fade
// < 0: the night's dim (TWILIGHT.night), full overhead and lighter toward the horizon (TWILIGHT.horizon of it at the horizon,
// § 8.1's "a deep blue at the zenith, lighter toward the horizon"; the tree line stays a silhouette against the low sky); dy: the view's sine
fn skyMatch(c: vec3f, dy: f32) -> vec3f {
  if (F.look.w < 0.0) { return c * (1.0 + F.look.w * mix(${TWILIGHT.horizon.toFixed(2)}, 1.0, smoothstep(0.0, ${TWILIGHT.horizonSin.toFixed(2)}, dy))); }
  return skyCurve(c, ${SKY_MATCH.lum.toFixed(4)}, ${SKY_MATCH.sat.toFixed(4)}, F.look.w);
}
// the water's mirror: the match at grazing rays, none toward the vertical (MIRROR_SKY: the reflected ray's elevation sine); ÷ the
// water's keep (F.look.x, sim/exposure.js waterKeep): the mirror shows the drawn sky at the frame's exposure
fn mirrorSky(c: vec3f, ry: f32) -> vec3f { return skyCurve(c, ${SKY_MATCH.lum.toFixed(4)} / select(1.0, F.look.x, F.look.x > 0.0), ${SKY_MATCH.sat.toFixed(4)}, max(F.look.w, 0.0) * (1.0 - smoothstep(${MIRROR_SKY.full.toFixed(3)}, ${MIRROR_SKY.none.toFixed(3)}, ry))); }
// v1's polariser on the true sky: Y × lum, chroma round Y × sat, at F.look.z (main.js: skyStrength by the sun's height;
// 0 under ?look=v2 or ?grade=0 | lut)
fn polarSky(c: vec3f) -> vec3f { return skyCurve(c, ${SKY.lum.toFixed(2)}, ${SKY.sat.toFixed(2)}, F.look.z); }`;
export const POLAR_WGSL = SKY_CURVE_WGSL;
