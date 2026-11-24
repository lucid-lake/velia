// A look per weather (owner, 2026-11-24: "Each weather type gets its own exposure, colour grade, spray mist and rain on the
// lens. Our storm reads flat and nearly grey."). Plain JS, no DOM, no GPU: the table, the weights the weather gives each row,
// the ease between them, the uniform record the composite reads (render/weatherLook.js), and the lens's water (wet, dry, the
// way the drops run). Deterministic: the eases step on the scene clock and snap on the first frame and on a time cut.
//
// The rows (the grade runs in the exposed linear colour, before the tone curve; mid grey is 0.18):
//   exposure   stops, in the grade after the frame's exposure (not on it: the storm's mist, the rain and the deck's hand-set
//              light are divided by the exposure, as v1's, so a change of exposure would not darken them)
//   contrast   about mid grey (the ASC CDL's power with its slope set so 0.18 stays 0.18)
//   saturation about the luma (Rec. 709)
//   tint       a white balance on the whole frame (the CDL's slope per channel)
//   shadows    the split-tone's shadow colour (× under mid grey), highlights its highlight colour (× from mid grey up)
//   rim        the brightest parts lifted warm toward the sun where it breaks through (the lit cloud edges, the gaps)
//   grad       a graduated filter: the sky overhead heavier and the water darker, under a brighter band at the horizon (the
//              light coming in under the deck), 0–1
//   vignette   the share of a lens's natural cos^4 fall-off in the corners
//   haze       × the storm's mist (render/sky.js stormFog: F.rain.z); 1 keeps it as it is
// Fair is the identity (the approved default; no pixel moves). The rows come from the weather the sim already has: the deck's
// coverage (Clear 0.12, Fair 0.28, Cloudy 0.85: v2/sim/clouds.js, weatherMenu.js) and the storm's envelopes (stormArc.js arcAt:
// dark, rain, gold). Hazy has no row: nothing in the sim makes a hazy day yet, and a row nothing reaches is dead.
export const IDENTITY = Object.freeze({ exposure: 0, contrast: 1, saturation: 1, tint: [1, 1, 1], shadows: [1, 1, 1], highlights: [1, 1, 1], rim: 0, grad: 0, vignette: 0, haze: 1 });
export const WEATHER_LOOKS = Object.freeze({
  clear:    Object.freeze({ exposure: 0,     contrast: 1.04, saturation: 1.05, tint: [1, 1, 1],          shadows: [0.98, 0.99, 1.02], highlights: [1.01, 1.0, 0.99],  rim: 0,    grad: 0,    vignette: 0.12, haze: 1 }),
  fair:     IDENTITY,
  overcast: Object.freeze({ exposure: 0,     contrast: 1.08, saturation: 0.92, tint: [0.97, 0.99, 1.03], shadows: [0.93, 0.98, 1.07], highlights: [1.02, 1.01, 0.98], rim: 0.15, grad: 0.15, vignette: 0.18, haze: 1 }),
  storm:    Object.freeze({ exposure: -1.1,  contrast: 1.3,  saturation: 0.88, tint: [0.94, 0.98, 1.06], shadows: [0.84, 0.94, 1.14], highlights: [1.12, 1.03, 0.88],  rim: 0.8,  grad: 0.6,  vignette: 0.4,  haze: 0.8 }),
  rain:     Object.freeze({ exposure: -1.05, contrast: 1.15, saturation: 0.84, tint: [0.95, 0.99, 1.05], shadows: [0.84, 0.95, 1.13], highlights: [1.06, 1.02, 0.95], rim: 0.5,  grad: 0.55, vignette: 0.36, haze: 0.85 }),
  clearing: Object.freeze({ exposure: 0.1,   contrast: 1.14, saturation: 1.0,  tint: [1.18, 1.02, 0.8],  shadows: [0.97, 0.98, 1.03], highlights: [1.16, 1.03, 0.82], rim: 0.8,  grad: 0.1,  vignette: 0.2,  haze: 1 }),
});
export const LOOK_ROWS = Object.freeze(Object.keys(WEATHER_LOOKS));
export const LOOK = Object.freeze({
  pivot: 0.18,           // mid grey in the exposed linear colour
  easeS: 2.5,            // the look follows the weather over about this long (an exponential's time constant, s)
  cover: [0.12, 0.28, 0.6, 0.85],   // the base row's knots: Clear 0.12, Fair from the page's 0.28 to v1's deck 0.6 (the frames matched to v1 stay Fair), Cloudy 0.85
  rainFull: 0.6,         // the storm's rain share at which its look is all Rain
  maxDt: 0.25,
});
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the weights of the rows for a weather: cover the deck's chosen coverage; on, dark, rain, gold the storm's (weather state)
export function lookWeights({ cover = 0.28, on = 0, dark = 0, rain = 0, gold = 0 } = {}, out = {}) {
  for (const k of LOOK_ROWS) out[k] = 0;
  const [c0, c1, c2, c3] = LOOK.cover;
  if (cover <= c0) out.clear = 1;
  else if (cover <= c1) { const t = (cover - c0) / (c1 - c0); out.clear = 1 - t; out.fair = t; }
  else if (cover <= c2) out.fair = 1;
  else { const t = Math.min(1, (cover - c2) / (c3 - c2)); out.fair = 1 - t; out.overcast = t; }
  const s = on > 0.5 ? Math.min(1, Math.max(0, dark)) : 0, g = on > 0.5 ? Math.min(1, Math.max(0, gold)) : 0;
  const r = s * smooth(0, LOOK.rainFull, rain);
  for (const k of ['clear', 'fair', 'overcast']) out[k] *= (1 - s) * (1 - g);
  out.storm = (s - r) * (1 - g); out.rain = r * (1 - g); out.clearing = g;
  return out;
}

// a look from weights (each field the weighted sum of the rows' fields)
export function blendLook(w, out = { tint: [0, 0, 0], shadows: [0, 0, 0], highlights: [0, 0, 0] }) {
  out.exposure = 0; out.contrast = 0; out.saturation = 0; out.rim = 0; out.grad = 0; out.vignette = 0; out.haze = 0;
  for (let i = 0; i < 3; i++) { out.tint[i] = 0; out.shadows[i] = 0; out.highlights[i] = 0; }
  let sum = 0;
  for (const k of LOOK_ROWS) {
    const a = w[k] || 0; if (!a) continue; sum += a;
    const L = WEATHER_LOOKS[k];
    out.exposure += a * L.exposure; out.contrast += a * L.contrast; out.saturation += a * L.saturation; out.rim += a * L.rim;
    out.grad += a * L.grad; out.vignette += a * L.vignette; out.haze += a * L.haze;
    for (let i = 0; i < 3; i++) { out.tint[i] += a * L.tint[i]; out.shadows[i] += a * L.shadows[i]; out.highlights[i] += a * L.highlights[i]; }
  }
  if (sum <= 0) return copyLook(IDENTITY, out);
  if (Math.abs(sum - 1) > 1e-9) { const k = 1 / sum; out.exposure *= k; out.contrast *= k; out.saturation *= k; out.rim *= k; out.grad *= k; out.vignette *= k; out.haze *= k; for (let i = 0; i < 3; i++) { out.tint[i] *= k; out.shadows[i] *= k; out.highlights[i] *= k; } }
  return out;
}
export function copyLook(a, out = { tint: [0, 0, 0], shadows: [0, 0, 0], highlights: [0, 0, 0] }) {
  out.exposure = a.exposure; out.contrast = a.contrast; out.saturation = a.saturation; out.rim = a.rim; out.grad = a.grad; out.vignette = a.vignette; out.haze = a.haze;
  for (let i = 0; i < 3; i++) { out.tint[i] = a.tint[i]; out.shadows[i] = a.shadows[i]; out.highlights[i] = a.highlights[i]; }
  return out;
}
const SCALARS = ['exposure', 'contrast', 'saturation', 'rim', 'grad', 'vignette', 'haze'], VECS = ['tint', 'shadows', 'highlights'];
export function isIdentity(L, eps = 1e-4) {
  for (const k of SCALARS) if (Math.abs(L[k] - IDENTITY[k]) > eps) return false;
  for (const k of VECS) for (let i = 0; i < 3; i++) if (Math.abs(L[k][i] - 1) > eps) return false;
  return true;
}

// the grade as the composite runs it (render/weatherLook.js GRADE_WGSL), on one exposed linear colour: the JS twin the tests read.
// ndc: the pixel's place (−1…1), dirY: its view ray's height, sun: the cos to the sun, shade: the sun's share at the eye (1 = none)
export function gradeColour(rgb, L, { ndcX = 0, ndcY = 0, aspect = 16 / 9, tanHalf = 0.5, dirY = 0, sunCos = 0, shade = 1 } = {}) {
  const pv = LOOK.pivot;
  const gain = 2 ** L.exposure;
  let e = rgb.map((x, i) => pv * Math.pow(Math.max(0, x * gain * L.tint[i] / pv), L.contrast));
  const l = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
  e = e.map((x) => Math.max(0, l + (x - l) * L.saturation));
  const l2 = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
  const ws = 1 - smooth(0, pv * 2, l2), wh = smooth(pv, pv * 8, l2), wr = smooth(pv * 3, pv * 14, l2);
  const toward = 0.45 + 0.55 * smooth(0.3, 1, sunCos), rimK = L.rim * wr * toward * (0.35 + 0.65 * shade);
  const RIM = [1, 0.9, 0.74];
  e = e.map((x, i) => x * (1 + (L.shadows[i] - 1) * ws) * (1 + (L.highlights[i] - 1) * wh) * (1 + rimK * RIM[i]));
  const up = smooth(-0.004, 0.012, dirY), high = smooth(0.05, 0.45, dirY), band = smooth(-0.01, 0.02, dirY) * (1 - smooth(0.03, 0.12, dirY));
  const g = ((1 - 0.25 * L.grad) * (1 - up) + (1 - 0.6 * L.grad * high) * up) * (1 + 0.3 * L.grad * band);
  const t2 = ((ndcX * aspect) ** 2 + ndcY ** 2) * tanHalf * tanHalf, c4 = 1 / ((1 + t2) * (1 + t2));
  const vig = 1 + (c4 - 1) * L.vignette;
  return e.map((x) => x * g * vig);
}

// --- the lens's water (ported from web-ocean-3d's LensRain, MIT, Copyright (c) 2026 Pranshul Chandhok and the Web Ocean 3D
// contributors; v2/render/LICENSE-web-ocean-3d.txt): the glass wets in wetS and dries over dryS; the way down on the glass eases
// over gravityS toward gravity plus the air's push across the screen; the drops' share at full rain (dropShare) keeps the lens
// from taking the frame. Ours: the amount also by how much the lens faces into the air (a lens looking downwind stays drier) ---
export const LENS = Object.freeze({
  wetS: 1.1, dryS: 7.5, gravityS: 0.9,   // theirs
  dropShare: 0.42,       // drops at full rain (theirs 0.2; ours more: the owner asked for it seen)
  push: 1 / 14,          // the screen's sideways run per m/s of air across the lens
  pushMax: 0.85,
  lee: 0.3,              // the share a lens facing straight downwind still takes
  clockWrap: 3600,
});
export function createLensWater(o = LENS) {
  const s = { wet: 0, gx: 0, gy: 1, amount: 0, target: 0, t: null, cut: null };
  return {
    state: s,
    // rain 0–1 at the eye; on: the lens is in this view (policy, view, Reduced Motion, not under the water); air: the air's
    // velocity past the camera { x, z } (wind − the camera's own); right, fwd: the camera's axes (world); t the scene clock
    update({ rain = 0, on = true, air = { x: 0, z: 0 }, right = [1, 0, 0], fwd = [0, 0, -1], t = 0, cut = 0 }) {
      const jump = s.t == null || cut !== s.cut || !(t - s.t >= 0) || t - s.t > LOOK.maxDt;
      const dt = jump ? 0 : t - s.t; s.t = t; s.cut = cut;
      const sp = Math.hypot(air.x, air.z);
      const fl = Math.hypot(fwd[0], fwd[2]) || 1;
      const facing = sp > 0.3 ? -(air.x * fwd[0] + air.z * fwd[2]) / (sp * fl) : 0;   // 1: the lens looks into the air
      const target = on ? Math.min(1, Math.max(0, rain)) * (o.lee + (1 - o.lee) * smooth(-0.4, 0.8, facing)) : 0;
      s.target = target;
      if (jump) s.wet = target;
      else s.wet += (target - s.wet) * (1 - Math.exp(-dt / (target > s.wet ? o.wetS : o.dryS)));
      const across = (air.x * right[0] + air.z * right[2]);   // + : the air runs to the screen's right
      const gx = Math.max(-o.pushMax, Math.min(o.pushMax, across * o.push)), n = Math.hypot(gx, 1);
      if (jump) { s.gx = gx / n; s.gy = 1 / n; }
      else { const k = 1 - Math.exp(-dt / o.gravityS); s.gx += (gx / n - s.gx) * k; s.gy += (1 / n - s.gy) * k; const m = Math.hypot(s.gx, s.gy) || 1; s.gx /= m; s.gy /= m; }
      s.amount = on ? s.wet * o.dropShare : 0;   // a lens turned away (the helm view, the policy) shows none at once and dries meanwhile
      return s;
    },
  };
}

// the composite's record (render/weatherLook.js WLook, 8 × vec4): the look, the sun's shade, the lens (amount, the way down, its clock)
export const WLOOK_FLOATS = 32;
// lensLayers: 2 (the runners and the beads) or 3 (the middle grade too; about a third more of the lens's cost)
export function fillLookRecord(out, L, { aspect = 16 / 9, tanHalf = 0.5, shade = 1, lens = null, t = 0, forceOn = false, lensLayers = 2 } = {}) {
  const pv = LOOK.pivot, on = forceOn || !isIdentity(L);
  const gain = 2 ** L.exposure;
  for (let i = 0; i < 3; i++) out[i] = gain * L.tint[i] / pv;   // g0: slope (the stops and the tint over mid grey; × the pivot back after the power), the saturation
  out[3] = L.saturation;
  out[4] = 0; out[5] = 0; out[6] = 0; out[7] = L.vignette;   // g1: offset (none), the vignette
  out[8] = L.contrast; out[9] = L.contrast; out[10] = L.contrast; out[11] = on ? 1 : 0;   // g2: power, on
  for (let i = 0; i < 3; i++) out[12 + i] = L.shadows[i];   // g3: the shadows' colour, the pivot
  out[15] = pv;
  for (let i = 0; i < 3; i++) out[16 + i] = L.highlights[i];   // g4: the highlights' colour, the rim
  out[19] = L.rim;
  out[20] = L.grad; out[21] = shade; out[22] = aspect; out[23] = tanHalf;   // g5
  out[24] = lens ? lens.amount : 0; out[25] = lens ? lens.gx : 0; out[26] = lens ? lens.gy : 1; out[27] = lens ? Math.min(1, lens.wet) : 0;   // l0
  out[28] = ((t % LENS.clockWrap) + LENS.clockWrap) % LENS.clockWrap; out[29] = lensLayers; out[30] = 0; out[31] = 0;   // l1: the lens's clock, its lattices
  return out;
}

// the look as it follows the weather: weights → the target → an ease toward it on the scene clock (snap on a jump)
export function createWeatherLook({ force = null } = {}) {
  const w = {}, target = copyLook(IDENTITY), cur = copyLook(IDENTITY);
  let lastT = null, lastCut = null;
  return {
    weights: w, target, look: cur,
    update({ cover, on, dark, rain, gold, t = 0, cut = 0 }) {
      if (force && WEATHER_LOOKS[force]) { for (const k of LOOK_ROWS) w[k] = k === force ? 1 : 0; }
      else if (force === 'off') { for (const k of LOOK_ROWS) w[k] = k === 'fair' ? 1 : 0; }
      else lookWeights({ cover, on, dark, rain, gold }, w);
      blendLook(w, target);
      const jump = lastT == null || cut !== lastCut || !(t - lastT >= 0) || t - lastT > LOOK.maxDt;
      const dt = jump ? 0 : t - lastT; lastT = t; lastCut = cut;
      if (jump) return copyLook(target, cur);
      const k = 1 - Math.exp(-dt / LOOK.easeS);
      for (const f of SCALARS) cur[f] += (target[f] - cur[f]) * k;
      for (const f of VECS) for (let i = 0; i < 3; i++) cur[f][i] += (target[f][i] - cur[f][i]) * k;
      return cur;
    },
  };
}
