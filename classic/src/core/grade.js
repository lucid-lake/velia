// The grade (S1 + S2, the Tahoe wallpaper look), after the Fable review: AgX stays the tone mapper (the
// exposure 6, the night floor, the mist's units and lum = 0.6 / exposure are tuned against it).
//   S2, the polariser sky: a sky-only curve on the scene's linear light, keyed on true sky depth (the depth buffer's far
//       plane, before the clouds are laid over it: the 25 km crest and the clouds are never "sky" here), darker and
//       richer: luminance x SKY.lum, chroma (round the luminance) x SKY.sat, by day only (SKY by the sun's height).
//   S1, one noon grade, a 3D LUT on the sRGB-encoded picture after AgX and after the 3D cockpit's composite (so the
//       cockpit takes the world's grade); the DOM top bar and menus never pass through here (brand navy and cream).
//       The LUT is computed here at load from GRADE (a parametric grade tuned by hand to the plan's measured numbers,
//       never fitted to any reference picture): no file to fetch, so the first frame is already graded (no pop through
//       the late warm-up). Its strength follows the sun (GRADE_DAY): full by day, GRADE.night at night (the owner's
//       long-exposure night keeps its own look).
// ?grade=0: neither (the look before week 1); ?grade=lut: the LUT only, ?grade=sky: the sky curve only.
import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, float, uniform, mix, max, dot, texture3D, sRGBTransferOETF, sRGBTransferEOTF, select } from 'three/tsl';

export const SKY = Object.freeze({ lum: 0.53, sat: 1.6, dayDeg: [2, 12] });
export const GRADE = Object.freeze({
  size: 17,                                    // the LUT's edge (17^3 = 4,913 entries, about 1 ms to build)
  pivot: 50, slope: 1.06,                      // an S curve on L* round mid grey (contrast)
  liftMid: -2,                                 // L* at mid grey: AgX's open mids, down a touch
  chroma: { blue: 1.25, cyan: 1.3, green: 1.15, warm: 1.06 },   // chroma gain by hue band (near-neutrals keep theirs)
  blueTurn: -10,                               // deg of hue on the blue band, toward cyan (AgX leaves deep blues violet)
  subtractive: 0.18,                           // L* lost per unit of chroma added (a deep, film-like blue)
  shoulder: [86, 96],                          // L* over the first is eased toward the second: clouds never clip flat
  split: { shadowB: -2.5, highB: 1.5 },        // b*: cool shadows, a touch warm highlights
  night: 0.35,                                 // the LUT's strength at night (the sun under GRADE_DAY's low end)
  dayDeg: [-4, 6],                             // the strength eases from night to full over this sun height (deg)
});

// --- the colour maths (plain JS, shared with tests) ------------------------------------------------------------------
const M1 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]];
const M2 = [[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]];
const WHITE = [0.95047, 1, 1.08883];
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
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
// one sRGB colour through the grade (0..1 in, 0..1 out)
export function gradeSrgb(rgb, G = GRADE) {
  const [L, a, b] = srgbToLab(rgb);
  const x = (L - G.pivot) / 50;
  let Ls = G.pivot + 50 * Math.tanh(x * G.slope) / Math.tanh(G.slope);
  Ls += G.liftMid * Math.exp(-(((L - 50) / 28) ** 2));
  const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  const wb = win(h, 265, 55), wc = win(h, 205, 40), wg = win(h, 140, 50), ww = Math.max(0, 1 - wb - wc - wg);
  const k = (wb * G.chroma.blue + wc * G.chroma.cyan + wg * G.chroma.green + ww * G.chroma.warm) / Math.max(wb + wc + wg + ww, 1e-6);
  const gain = 1 + (k - 1) * Math.min(1, C / 6);   // near-neutral colours (snow, granite, clouds) keep their chroma
  const C2 = Math.min(C * gain, 80);
  const h2 = h + (G.blueTurn ?? 0) * wb * Math.min(1, C / 6);
  Ls -= G.subtractive * (C2 - C);
  const [s0, s1] = G.shoulder;   // the highlights pulled: L* over s0 eased toward s1 (clouds keep their modelling)
  if (Ls > s0) Ls = s0 + (s1 - s0) * Math.tanh((Ls - s0) / (s1 - s0));
  const t = Math.min(1, Math.max(0, Ls / 100));
  const a2 = C2 * Math.cos(h2 * Math.PI / 180), b2 = C2 * Math.sin(h2 * Math.PI / 180) + G.split.shadowB * (1 - t) ** 2 + G.split.highB * t * t;
  return labToSrgb([Math.min(100, Math.max(0, Ls)), a2, b2]);
}
// the LUT as RGBA8 (red fastest, as a .cube), size^3
export function gradeLutData(G = GRADE) {
  const n = G.size, out = new Uint8Array(n * n * n * 4);
  for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
    const o = gradeSrgb([ri / (n - 1), gi / (n - 1), bi / (n - 1)], G), k = 4 * (ri + n * (gi + n * bi));
    out[k] = Math.round(o[0] * 255); out[k + 1] = Math.round(o[1] * 255); out[k + 2] = Math.round(o[2] * 255); out[k + 3] = 255;
  }
  return out;
}
// the grade's strength at a sun elevation (deg): night .. 1
export function gradeStrength(elevDeg, G = GRADE) {
  const [lo, hi] = G.dayDeg, k = Math.min(1, Math.max(0, (elevDeg - lo) / (hi - lo)));
  return G.night + (1 - G.night) * k * k * (3 - 2 * k);
}
export function skyStrength(elevDeg, S = SKY) {
  const [lo, hi] = S.dayDeg, k = Math.min(1, Math.max(0, (elevDeg - lo) / (hi - lo)));
  return k * k * (3 - 2 * k);
}
export const gradeMode = (flags) => (flags?.grade === '0' ? { lut: false, sky: false } : flags?.grade === 'lut' ? { lut: true, sky: false } : flags?.grade === 'sky' ? { lut: false, sky: true } : { lut: true, sky: true });

// --- the nodes ---------------------------------------------------------------------------------------------------------
export function createGrade({ G = GRADE, S = SKY } = {}) {
  const tex = new THREE.Data3DTexture(gradeLutData(G), G.size, G.size, G.size);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace; tex.unpackAlignment = 1; tex.needsUpdate = true;
  const strength = uniform(1), sky = uniform(1);
  const n = G.size;
  // S1: c is display-linear (after AgX); encode, look up, decode (the pipeline encodes it again at its end)
  const lut = (c) => Fn(() => {
    const s = sRGBTransferOETF(c.rgb.clamp(0, 1));
    const uvw = s.mul((n - 1) / n).add(0.5 / n);
    const g = texture3D(tex, uvw).rgb;
    return vec4(sRGBTransferEOTF(mix(s, g, strength)), c.a ?? float(1));
  })();
  // S2: c is the scene's linear light; depth the scene pass's; only the far plane (true sky) changes
  const skyCurve = (c, depth, reversed = false) => Fn(() => {
    const isSky = reversed ? depth.lessThanEqual(0) : depth.greaterThanEqual(1);
    const Y = max(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
    const rich = vec3(Y).add(c.rgb.sub(vec3(Y)).mul(S.sat)).max(0).mul(S.lum);
    const out = mix(c.rgb, rich, sky);
    return vec4(select(isSky, out, c.rgb), c.a ?? float(1));
  })();
  // per frame: the sun's height (deg)
  const setSun = (elevDeg) => { strength.value = gradeStrength(elevDeg, G); sky.value = skyStrength(elevDeg, S); };
  return { tex, lut, skyCurve, setSun, strength, sky };
}
