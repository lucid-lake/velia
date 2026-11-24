// What is under the surface, seen through the water (fix/v2-tessie-underwater; owner, 2026-11-17: "I can see Tessie's
// underwater part clearly even when the water isn't clear … not respecting the physics"). The lake bed's own optics
// (render/bed.js, v1's src/waters/clarity-optics.js) for a body in the water column, plus the weather's turbidity:
//   - where it is seen: the eye ray refracts at the surface (Snell, n = 1.333), so a point d m down shows where the
//     straight ray through the refracted crossing would put it (the bed's rule: render/bed.js reads the bed where the
//     refracted ray lands; a body drawn as geometry moves to that pixel instead). The crossing is nearer than the point,
//     so the drawn point lies farther along the same ray: the surface is always in front of it and the water's blend
//     (its Fresnel share, more at grazing) covers it as it covers the bed;
//   - the light that reaches it: the water's diffuse attenuation K (terrain.js WATER.K) down the refracted sun and back up
//     the refracted view (the bed's pathE), the downwelling light coming from above (Snell's window: a flank or a belly gets
//     little of it);
//   - its image: the radiance fades into the water's own body (the backscatter R∞ under the same light) along the path up,
//     at K (the bed's TE) and the image's scattering on top (the bed's IMAGE_SCATTER, a boulder's half rate: she is a big
//     shape), plus the weather's scatter (below), so it softens (the fine detail goes first) and is gone in a few metres;
//   - the weather's turbidity: the water's body scatters more under wind (the breaking waves' bubble clouds, from the
//     water's own whitecap onset, render/water.js FOAM), in rain (the drops' bubbles and the roughened surface) and in a
//     storm (stirred silt), added to the image's scatter; the refraction's sway grows with the wind's slopes (Cox–Munk).
// The bed itself has no weather term yet (its look is golden-pinned); this module is the one place both would read.
import { WATER, N_WATER } from './terrain.js';
import { IMAGE_SCATTER, DIRECT_SHARE } from './bed.js';
import { FOAM } from './water.js';

// scat: 1/m added to the image's scatter: wind [onset m/s, full m/s, 1/m] (the onset two below the foam's, full one above
// it: a breeze stays clear, the whitecaps' wind is milky), rain × its 0–1, a storm × its 0–1; big: the image's scatter for a
// body the size of her (a boulder's half rate, bed.js fadeBig); sway: the refraction's sway (m per m of depth) calm and at
// the full wind; up: the flank's share of the downwelling light (0 a belly, 1 her back), ambientUp the upwelling's share
export const SEEN = Object.freeze({
  wind: [FOAM.windLo - 2, FOAM.windHi + 1, 1.6], rain: 1.5, storm: 1.2,
  big: 0.5, sway: [0.035, 0.11], upwell: 0.25,
});

// the weather's added scatter (1/m): wind (m/s), rain (0–1), storm (0–1)
export function weatherScatter({ wind = 0, rain = 0, storm = 0 } = {}) {
  const [w0, w1, wk] = SEEN.wind;
  const t = Math.min(1, Math.max(0, (wind - w0) / (w1 - w0)));
  return wk * t * t * (3 - 2 * t) + SEEN.rain * Math.max(0, rain) + SEEN.storm * Math.max(0, storm);
}

// the refracted crossing: the eye at height H (m) above the surface, the point d m down and h m away horizontally;
// returns s, the crossing's horizontal distance from the eye (Snell: sin θi = n sin θt), by bisection (monotonic)
export function crossing(H, h, d, n = N_WATER) {
  if (!(d > 0) || !(H > 0) || !(h > 0)) return h;
  let lo = 0, hi = h;
  for (let i = 0; i < 18; i++) {
    const s = 0.5 * (lo + hi);
    const f = s / Math.hypot(s, H) - n * (h - s) / Math.hypot(h - s, d);
    if (f > 0) hi = s; else lo = s;
  }
  return 0.5 * (lo + hi);
}
// where a point under the surface is drawn: eye [x, y, z], p [x, y, z] (y < 0); the straight ray through the crossing,
// at the point's own depth. Above the surface (or an eye under it) the point itself
export function apparent(eye, p, n = N_WATER) {
  const H = eye[1], d = -p[1];
  if (!(d > 0) || !(H > 0.05)) return { p: [...p], air: [...p] };
  const dx = p[0] - eye[0], dz = p[2] - eye[2], h = Math.hypot(dx, dz);
  if (h < 1e-6) return { p: [...p], air: [eye[0], 0, eye[2]] };
  const s = crossing(H, h, d, n), k = (H + d) / H, ux = dx / h, uz = dz / h;
  return { p: [eye[0] + ux * s * k, p[1], eye[2] + uz * s * k], air: [eye[0] + ux * s, 0, eye[2] + uz * s] };
}

// a body d m down seen along a refracted path of `path` m (the crossing to the point), the sun's elevation sine sunY:
// light (per channel), the share of the surface's light that reaches it; image (per channel), the share of its own
// radiance that reaches the surface before it is lost into the water's body; the weather as weatherScatter
export function seenThrough({ depth, path, sunY = 1, wind = 0, rain = 0, storm = 0 }) {
  const d = Math.max(0, depth), p = Math.max(d, path ?? d);
  const sunDownY = Math.sqrt(Math.max(1 - (1 - sunY * sunY) / (N_WATER * N_WATER), 0.01));
  const sc = IMAGE_SCATTER * SEEN.big + weatherScatter({ wind, rain, storm });
  return {
    light: WATER.K.map((k) => Math.exp(-k * d / sunDownY)),
    image: WATER.K.map((k) => Math.exp(-(k + sc) * p)),
    scatter: sc,
  };
}

// the WGSL twin: needs F (Frame: cam, sun, wind, rain, storm), WATER_WGSL (WK, NW) in scope
export const UNDERWATER_WGSL = `
const UW_W0 = ${SEEN.wind[0].toFixed(3)}; const UW_W1 = ${SEEN.wind[1].toFixed(3)}; const UW_WK = ${SEEN.wind[2].toFixed(3)};
const UW_RAIN = ${SEEN.rain.toFixed(3)}; const UW_STORM = ${SEEN.storm.toFixed(3)}; const UW_BIG = ${(IMAGE_SCATTER * SEEN.big).toFixed(4)};
const UW_SWAY0 = ${SEEN.sway[0].toFixed(3)}; const UW_SWAY1 = ${SEEN.sway[1].toFixed(3)}; const UW_UPWELL = ${SEEN.upwell.toFixed(3)};
const UW_DSHARE = ${DIRECT_SHARE.toFixed(3)};
fn uwWindK() -> f32 { return smoothstep(UW_W0, UW_W1, F.wind.x); }
fn uwScatter() -> f32 { return UW_BIG + UW_WK * uwWindK() + UW_RAIN * max(F.rain.x, 0.0) + UW_STORM * max(F.storm.x, 0.0); }
// the refracted crossing's horizontal distance from the eye (crossing() in JS)
fn uwCrossing(H: f32, h: f32, d: f32) -> f32 {
  var lo = 0.0; var hi = h;
  for (var i = 0; i < 18; i++) {
    let s = 0.5 * (lo + hi);
    let f = s / sqrt(s * s + H * H) - NW * (h - s) / sqrt((h - s) * (h - s) + d * d);
    if (f > 0.0) { hi = s; } else { lo = s; }
  }
  return 0.5 * (lo + hi);
}
struct UwP { p: vec3f, air: vec3f }
// where a point under the surface is drawn, and its surface crossing (apparent() in JS)
fn uwApparent(wp: vec3f) -> UwP {
  var o: UwP; o.p = wp; o.air = wp;
  let H = F.cam.y; let d = -wp.y;
  if (d <= 0.0 || H <= 0.05) { return o; }
  let dv = wp.xz - F.cam.xz; let h = length(dv);
  if (h < 1e-6) { o.air = vec3f(F.cam.x, 0.0, F.cam.z); return o; }
  let s = uwCrossing(H, h, d); let u = dv / h;
  let q = F.cam.xz + u * s * (H + d) / H;
  o.p = vec3f(q.x, wp.y, q.y); o.air = vec3f(F.cam.x + u.x * s, 0.0, F.cam.z + u.y * s);
  return o;
}
fn uwSunDownY() -> f32 { let s = normalize(F.sun.xyz); return sqrt(max(1.0 - (1.0 - s.y * s.y) / (NW * NW), 0.01)); }
`;
