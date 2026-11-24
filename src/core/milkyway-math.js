// The Milky Way's numbers (stage S0): plain JS, no three.js, shared by the sky node
// (src/core/milkyway.js), the texture build (tools/milkyway/build.mjs) and the tests.
const DEG = Math.PI / 180;
import { smooth } from '../sim/core/math.js';

// --- The texture's encoding (tools/milkyway/build.mjs) -------------------------------------------------------------
// e = log2(1 + K x) / log2(1 + K): 8 bits hold the band's 1,000 : 1 range (steps of 3 % at the median, 6 % in the
// darkest dust lanes), x = 1 at the brightest 4K texel near the core.
export const MW_LOG_K = 1024;
const LOG1K = Math.log2(1 + MW_LOG_K);
export const encodeLum = (x) => Math.log2(1 + MW_LOG_K * Math.max(0, x)) / LOG1K;
export const decodeLum = (e) => (2 ** (e * LOG1K) - 1) / MW_LOG_K;

// The equirectangular layout (the SVS map's): u = 0.5 − RA / 360° (RA grows to the left, as the sky is seen from
// inside), v = (90° − Dec) / 180° from the top row. dir: a unit vector in the J2000 equatorial frame (x to RA 0, z to
// the north pole), the frame of the sky library's star catalogue.
export function uvOfJ2000(x, y, z) {
  const ra = Math.atan2(y, x), dec = Math.asin(Math.max(-1, Math.min(1, z)));
  let u = 0.5 - ra / (2 * Math.PI); u -= Math.floor(u);
  return { u, v: 0.5 - dec / Math.PI };
}

// Galactic (l, b) → J2000 (RA, Dec), radians (the IAU 1958 pole and node; tools/fireworks/milkyway.mjs)
const RA_GP = 192.85948 * DEG, DEC_GP = 27.12825 * DEG, L_NCP = 122.93192 * DEG;
export function galacticToJ2000(lDeg, bDeg) {
  const l = lDeg * DEG, b = bDeg * DEG;
  const dec = Math.asin(Math.sin(DEC_GP) * Math.sin(b) + Math.cos(DEC_GP) * Math.cos(b) * Math.cos(L_NCP - l));
  const y = Math.cos(b) * Math.sin(L_NCP - l);
  const x = Math.cos(DEC_GP) * Math.sin(b) - Math.sin(DEC_GP) * Math.cos(b) * Math.cos(L_NCP - l);
  const ra = (RA_GP + Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  return { ra, dec, dir: [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] };
}

// --- Brightness ---------------------------------------------------------------------------------------------------
// x = 1 ↔ 19.8 mag / arcsec² (V): the Sagittarius star cloud at the map's 5′ texel, about 2 magnitudes over a dark
// site's background (21.8); the map's median (x = 0.014) comes out at 24.4, the faint high-latitude starlight (our
// estimate). Luminance in cd/m² as the sky library's stars: 10.8e4 · 10^(−0.4 μ).
export const MW_REF_MAG = 19.8;
export const surfaceLuminance = (mag) => 10.8e4 * 10 ** (-0.4 * mag);

// Night: nothing with the sun above −10°, full from −18° (astronomical dark). The eye loses the band in twilight.
export const nightFade = (sunDeg) => smooth(-10, -18, sunDeg);
// The moon washes it out by its lit share and its height: a full moon 10° up leaves 10 %; a thin crescent or a moon
// below the ridge, nearly all of it (a moonlit sky is ≈ 19–20 mag / arcsec², the band's own level).
export const moonDim = (moonAltDeg, litFraction) => 1 - 0.9 * Math.min(1, Math.max(0, litFraction)) ** 1.2 * smooth(-2, 10, moonAltDeg);
// the band's level, 0–1, for a sun and a moon
export const milkyWayLevel = ({ sunDeg, moonAltDeg = -90, moonLit = 0 }) => nightFade(sunDeg) * moonDim(moonAltDeg, moonLit);

// Light pollution from the lake's origin (Fannette Island): soft domes low on the horizon. az: true bearing, deg; w:
// half width, deg; h: the e-folding height, deg; a: the glow at the horizon over the band's x = 1. South Lake Tahoe and
// Stateline (≈ 15–20 km, az 75–100), Reno behind the Carson Range (≈ 60 km, az ≈ 50), Tahoe City faint (≈ 25 km, az ≈ 10).
// Emerald Bay is a Bortle 3–4 site (our estimate): the domes stay under the band's core.
export const LIGHT_DOMES = Object.freeze([
  { name: 'South Lake Tahoe', az: 88, w: 18, h: 7, a: 0.18 },
  { name: 'Reno', az: 50, w: 14, h: 5, a: 0.07 },
  { name: 'Tahoe City', az: 10, w: 10, h: 4, a: 0.03 },
]);
export function lightDomeAt(azDeg, altDeg) {
  let s = 0;
  for (const d of LIGHT_DOMES) {
    let da = Math.abs(azDeg - d.az) % 360; if (da > 180) da = 360 - da;
    s += d.a * Math.exp(-((da / d.w) ** 2)) * Math.exp(-Math.max(0, altDeg) / d.h);
  }
  return s;
}

// --- The starlit night (owner, 2026-11-07: "a photographer's lens, not the naked eye") ----------------
// The hand-set colours' light level never goes under this (src/daylight.js): under the night exposure (6 × 362) it
// reads as 362 × 5e-4 ≈ 0.18 of their daylight level on screen, a long exposure's night. The sky model alone gives
// ≈ 5e-6 at sun −18° (0.002 of daylight on screen: black). It takes over near sun −7.3° (light 5e-4), where the dusk curve
// already shows 0.10 of daylight, so the night brightens a little after twilight, never a pop.
export const NIGHT_LIGHT_FLOOR = 5e-4;
// the moon's share of its full light: its lit fraction ^1.2 × its height (−2° → 10°)
export const moonLightShare = (moonAltDeg, litFraction) => Math.min(1, Math.max(0, litFraction)) ** 1.2 * smooth(-2, 10, moonAltDeg);

// --- Where to look (round 4: the night moment, Cruise's stars camera, the logbook's find) -----------------------------
// The band's best point in the sky now: the galactic core when it stands minAlt or more up, else the part of the inner
// band (l −40° to 90°: Scorpius, Sagittarius, Aquila, Cygnus) nearest the core that does, up to maxAlt.
// toWorld(dirJ2000) → [x, y, z] unit world vector (x east, y up, z south). Returns { dir, altDeg, azDeg, l } or null.
export function bandAim(toWorld, { minAlt = 10, maxAlt = 60 } = {}) {
  for (let l = 0; l <= 90; l += 5) {
    for (const ll of l === 0 ? [0] : [l, -l]) {
      if (ll < -40) continue;
      const v = toWorld(galacticToJ2000(ll, 0).dir);
      const altDeg = Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG;
      if (altDeg >= minAlt && altDeg <= maxAlt) return { dir: v, altDeg, azDeg: (Math.atan2(v[0], -v[2]) / DEG + 360) % 360, l: ll };
    }
  }
  return null;
}
