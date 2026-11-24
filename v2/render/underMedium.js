// The eye under the water (play as Tessie, phase 2a). Its own module (render/water.js imports it: render/underwater.js
// reads water.js's FOAM, so the medium's wind numbers are kept here as UM_WIND, held equal to underwater.js SEEN by v2/tests/tessie-under.test.mjs).
import { IMAGE_SCATTER, DIRECT_SHARE, N_WATER } from './bed.js';   // (not terrain.js: it imports this module)
import { WATER_K } from '../../src/sim/water-spectrum.js';   // Tahoe's K (terrain.js WATER.K is the same array)
import { NIGHT } from '../sim/night.js';   // the bed's night light (NIGHT.bedLight), as from above
const WATER = Object.freeze({ K: WATER_K });

// the weather's added scatter, as render/underwater.js SEEN: wind [onset m/s, full m/s, 1/m], rain × its 0–1, a storm × its 0–1
export const UM_WIND = Object.freeze({ wind: Object.freeze([3, 12, 1.6]), rain: 1.5, storm: 1.2 });
const SEEN = UM_WIND;
// One model, Tahoe's numbers (the same K, R∞ and image scatter the bed and the keels use seen from above), so a stone seen from the boat
// and from beside it match:
//   - an image fades along a straight path t by T = exp(−σ t), σ = K + s + w per channel: K Tahoe's (terrain.js WATER.K), s the bed's
//     image scatter (0.1 /m), w the weather's as a layer (2a finding, 2026-11-20: the wind's bubbles start with the whitecaps, UNDER.bubbles
//     5 m/s, and reach SEEN's 1.6 /m at 14 m/s; SEEN's 3 m/s onset, tuned for a view from above through the top, left a 15 kn breeze's first
//     metres as murky as a storm's): the wind's and the rain's bubbles fill the top 1–3 m (all of it to 1 m, none by
//     3 m), the storm's stirred silt the same layer and a quarter of it deeper (UNDER.layer, UNDER.silt);
//   - what it fades into is the water's own light L∞ = E(d) R∞ / π (E the light left at the depth: the sun down the refracted ray and the
//     sky, by K), brighter looking up (UNDER.up: toward the window) and toward the refracted sun (UNDER.lobe); along a climbing ray the
//     light grows by K (the closed form: I = L∞ σ (1 − e^(−(σ − K u) t)) / (σ − K u), u the ray's rise; Abyssal Garden's fogIn shape);
//   - a 2 % step stays visible to ln 50 / σ (sightM): the image's scatter eases from UNDER.imgTop in the sunlit top 2 m to the bed's 0.1 /m by
//     15 m (owner, 2026-11-20: clear and bright near the surface, realistic for Tahoe: Secchi about 20 m in recent summers, near 30 m
//     historically, Emerald Bay's shallows among the clearest), so about 26 m in green (the eye's channel) in the bright shallows, 20.6 m and
//     29.6 m at depth, less at dusk and night (the light) and in wind and storm (the bubble layer);
//   - the surface from below (render/water.js fsUnder): Snell's window, k = 1 − n² (1 − cos² θ): k > 0 the sky through the window, else
//     total internal reflection; its edge soft over k ∈ [0, UNDER.edge] (Abyssal Garden's ss(0, .22, k), MIT).
// The water's own light (owner, 2026-11-20: "the water is clear; it should turn to dark navy gradually, not immediately when you go under"):
// just under the surface it is bright and clear (UNDER.gainTop of E R∞ / π, the sunlit water), easing over UNDER.gainM m of the eye's depth to
// UNDER.gain = WUP (0.54: the deep body's navy seen from above,'s calibration point), on top of the light's own fall with
// depth (E by K), its colour in the sunlit top UNDER.clearM m eased from R∞'s deep blue toward Abyssal Garden's sunlit water colour (UNDER.clear
// = its WCOL (0.16, 0.58, 0.90); MIT © 2026 Maksymilian Dendura), its forward lobe (1.22 + 0.3 μ⁴); over a shallow bed the sand's light comes back up through the water (UNDER.bedAlb, UNDER.bedGlow: the shelf's turquoise near
// the bed), so far things and deep water are navy, near and shallow water clear blue to turquoise.
export const UNDER = Object.freeze({ bubbles: Object.freeze([5, 14]), gain: 0.54, gainTop: 5.0, gainM: 16, clear: Object.freeze([0.16, 0.58, 0.90]), clearM: 12, imgTop: 0.06, imgM: Object.freeze([2, 15]), lobe0: 1.22, lobe4: 0.3, bedAlb: Object.freeze([0.42, 0.40, 0.33]), bedGlow: 0.6, up: 0.8, lobe: 0.3, layer: Object.freeze([1, 3]), silt: 0.25, edge: 0.22, f0: 0.02, sunTight: 900, sunWide: 60 });
const SIGHT_STEP = 0.02;
// the extinction per channel (1/m) at depth d (m) for the weather ({ wind m/s, rain 0–1, storm 0–1 })
const imageScatter = (d) => { const u = Math.min(1, Math.max(0, (d - UNDER.imgM[0]) / (UNDER.imgM[1] - UNDER.imgM[0]))); return UNDER.imgTop + (IMAGE_SCATTER - UNDER.imgTop) * u * u * (3 - 2 * u); };
export function sigmaAt(d = 0, { wind = 0, rain = 0, storm = 0 } = {}) {
  const [w0, w1] = UNDER.bubbles, wk = SEEN.wind[2], t = Math.min(1, Math.max(0, (wind - w0) / (w1 - w0)));
  const wr = wk * t * t * (3 - 2 * t) + SEEN.rain * Math.max(0, rain), st = SEEN.storm * Math.max(0, storm);
  const u = Math.min(1, Math.max(0, (d - UNDER.layer[0]) / (UNDER.layer[1] - UNDER.layer[0]))), k = 1 - u * u * (3 - 2 * u);
  return WATER.K.map((K) => K + imageScatter(d) + (wr + st) * k + st * UNDER.silt * (1 - k));
}
// how far a 2 % step stays visible (m) per channel
export const sightM = (d = 0, w = {}) => sigmaAt(d, w).map((s) => Math.log(1 / SIGHT_STEP) / s);
// Snell's window: k for a ray meeting the surface from below at cos θ (from the vertical); > 0 inside the window
export const snellK = (cosT, n = N_WATER) => 1 - n * n * (1 - cosT * cosT);
export const CRITICAL_DEG = Math.asin(1 / N_WATER) * 180 / Math.PI;   // 48.6°: the window is a 97° cone
// the window's radius on the surface (m) seen from d m down
export const windowRadius = (d) => d * Math.tan(Math.asin(1 / N_WATER));

// the WGSL: needs F (Frame with the under rows), WK, RINF, NW, PI, LIGHT and nightLand (render/sky.js SKY_READ) in scope
export const UNDER_WGSL = `
const UM_W0 = ${UNDER.bubbles[0].toFixed(3)}; const UM_W1 = ${UNDER.bubbles[1].toFixed(3)}; const UM_WK = ${SEEN.wind[2].toFixed(3)};
const UM_RAIN = ${SEEN.rain.toFixed(3)}; const UM_STORM = ${SEEN.storm.toFixed(3)}; const UM_IMG = ${IMAGE_SCATTER.toFixed(4)};
const UM_L0 = ${UNDER.layer[0].toFixed(2)}; const UM_L1 = ${UNDER.layer[1].toFixed(2)}; const UM_SILT = ${UNDER.silt.toFixed(3)};
const UM_NIGHT_BED = ${NIGHT.bedLight.toFixed(3)};
const UM_IMG0 = ${UNDER.imgTop.toFixed(4)}; const UM_IMG_D0 = ${UNDER.imgM[0].toFixed(1)}; const UM_IMG_D1 = ${UNDER.imgM[1].toFixed(1)}; const UM_LOBE0 = ${UNDER.lobe0.toFixed(3)}; const UM_LOBE4 = ${UNDER.lobe4.toFixed(3)};
const UM_GAIN = ${UNDER.gain.toFixed(3)}; const UM_GAIN0 = ${UNDER.gainTop.toFixed(3)}; const UM_GAIN_M = ${UNDER.gainM.toFixed(1)}; const UM_BED_ALB = vec3f(${UNDER.bedAlb.map((x) => x.toFixed(3)).join(', ')}); const UM_BED_GLOW = ${UNDER.bedGlow.toFixed(3)}; const UM_CLEAR = vec3f(${UNDER.clear.map((x) => x.toFixed(3)).join(', ')}); const UM_CLEAR_M = ${UNDER.clearM.toFixed(1)}; const UM_UP = ${UNDER.up.toFixed(3)}; const UM_LOBE = ${UNDER.lobe.toFixed(3)}; const UM_DSHARE = ${DIRECT_SHARE.toFixed(3)};
// the eye's depth under the local surface (m; F.under.x), the scene drawn as from under the water (F.underK.x)
fn umEyeD() -> f32 { return max(F.under.x, 0.0); }
fn umSunDY() -> f32 { let s = normalize(F.sun.xyz); return sqrt(max(1.0 - (1.0 - s.y * s.y) / (NW * NW), 0.01)); }
fn umSunU() -> vec3f { let s = normalize(F.sun.xyz); return normalize(vec3f(s.x / NW, umSunDY(), s.z / NW)); }
// the sky's light entering the water, the night's own lift with it, by night at the bed's share (render/terrain.js: the shallows no brighter than the beach)
fn umSkyE() -> vec3f { return (LIGHT.sky.rgb + nightLand()) * mix(1.0, UM_NIGHT_BED, min(F.night.x, 1.0)); }
fn umKeep() -> f32 { return select(1.0, F.look.x, F.look.x > 0.0); }   // the water's exposure keep (sim/exposure.js waterKeep), as from above
// the extinction per channel at depth d: K, the image's scatter, the weather's layer (bubbles to 1–3 m, the storm's silt deeper)
fn umSigma(d: f32) -> vec3f {
  let wr = UM_WK * smoothstep(UM_W0, UM_W1, F.wind.x) + UM_RAIN * max(F.rain.x, 0.0);
  let st = UM_STORM * max(F.storm.x, 0.0);
  let k = 1.0 - smoothstep(UM_L0, UM_L1, d);
  return WK + vec3f(mix(UM_IMG0, UM_IMG, smoothstep(UM_IMG_D0, UM_IMG_D1, d)) + (wr + st) * k + st * UM_SILT * (1.0 - k));
}
// the light left at depth d: the sun down the refracted ray, the sky's diffuse light, the night's own (the photographer's lens: never black)
fn umEd(d: f32) -> vec3f {
  return 0.98 * (LIGHT.sun.rgb * exp(-WK * d / umSunDY()) + umSkyE() * exp(-WK * d * 1.2));
}
// the water's own light along dir at depth d (what an image fades into): E R∞ / π, brighter looking up and toward the refracted sun
fn umLinf(dir: vec3f, d: f32) -> vec3f {
  let up = smoothstep(-0.35, 1.0, dir.y);
  let mu = max(dot(dir, umSunU()), 0.0);
  let lobe = 1.0 + UM_UP * up * up + (UM_LOBE4 / UM_LOBE0) * mu * mu * mu * mu * smoothstep(0.0, 0.35, normalize(F.sun.xyz).y);   // Abyssal Garden's forward lobe (1.22 + 0.3 μ⁴)
  let gain = mix(UM_GAIN0, UM_GAIN, smoothstep(0.0, UM_GAIN_M, d));
  var L = umEd(d) * RINF / PI * lobe * gain;
  // the sunlit top metres read clear light blue (the asymptote R∞'s deep blue only with depth): the colour eased toward UM_CLEAR, the light kept
  let sK = 1.0 - smoothstep(0.0, UM_CLEAR_M, d);
  let lum = dot(L, vec3f(0.2126, 0.7152, 0.0722));
  L = mix(L, UM_CLEAR * (lum / dot(UM_CLEAR, vec3f(0.2126, 0.7152, 0.0722))), sK * 0.8);
  // the bed's light back up through the water (F.underK.w: the water's depth at the eye; looking down and level more of it)
  let bedD = F.underK.w;
  if (bedD > d + 0.5) {
    let below = bedD - d;
    let glow = umEd(bedD) * UM_BED_ALB / PI * exp(-umSigma(0.5 * (d + bedD)) * below) * (0.35 + 0.65 * (1.0 - smoothstep(-0.8, 0.4, dir.y)));
    L += glow * UM_BED_GLOW;
  }
  return L * umKeep();
}
// what the eye under the water sees of radiance col at wp along the straight path: its image fading by σ into the water's own light,
// that light growing as the ray climbs toward the surface (the closed form)
fn umFog(col: vec3f, wp: vec3f) -> vec3f {
  let v = wp - F.cam.xyz; let t = length(v); let dir = v / max(t, 1e-4);
  let d0 = umEyeD(); let d1 = max(-wp.y, 0.0);
  let sig = umSigma(0.5 * (d0 + d1));
  let a = max(sig - WK * dir.y, vec3f(0.01));
  return col * exp(-sig * t) + umLinf(dir, d0) * sig / a * (1.0 - exp(-a * t));
}
// the background where nothing is drawn: an endless path along dir (to the surface when it climbs: the window draws the rest)
fn umBack(dir: vec3f) -> vec3f {
  let d0 = umEyeD();
  let sig = umSigma(d0);
  let a = max(sig - WK * dir.y, vec3f(0.01));
  let t = select(1e4, d0 / max(dir.y, 1e-3), dir.y > 0.0);
  return umLinf(dir, d0) * sig / a * (1.0 - exp(-a * t));
}
// the light on a surface of albedo alb and normal n at depth d (sunVis: its share of the sun, the shadow): the sun down the refracted
// ray on its own normal, the sky's light from above (Snell's window: a flank or a belly gets little), the upwelling from below
fn umLit(alb: vec3f, n: vec3f, d: f32, sunVis: f32) -> vec3f {
  let s = normalize(F.sun.xyz);
  let fD = smoothstep(0.0, 0.35, s.y) * UM_DSHARE;
  let eSun = 0.98 * LIGHT.sun.rgb / max(s.y, 0.05) * exp(-WK * d / umSunDY()) * sunVis;
  let up01 = 0.5 + 0.5 * n.y;
  let eTop = umEd(0.0);
  let eSky = umSkyE() * 0.98 * exp(-WK * d * 1.2) * up01 * up01 + eTop * exp(-WK * d) * RINF * (1.0 - up01);
  return alb / PI * (eSun * max(dot(n, umSunU()), 0.0) * mix(0.6, 1.0, fD) + eSky) * umKeep();
}
`;
