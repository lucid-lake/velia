// The camera's exposure. Pure; main.js writes it to F.params.x.
//   exposureFactor(exposure, sunElevDeg, E, moonShare, look)   exposure as the URL's (6 = the base)
// M2 (look 'v2', the A/B since the frame look): M1 set exposure 6 = factor 1 on a frame of sky and water only; with sunlit
// ground in the frame that was about 5× too bright. M2 exposed for the sunlit ground ("sunny 16": the base puts an 18 % grey
// card at 0.24 into ACES, sRGB ≈ 0.53) and adapted toward dusk as the inverse square root of the light on the ground (a
// partial adaptation: 3× at the sun's +3°, at most 5×).
// fix(v2) frame look (look 'v1', the default, 2026-11-14): v1's camera. v1 holds one exposure wherever the sun is above
// +8.5° (src/sim/timeOfDay.js exposureAt: 6 by day) and only below that gives back 70 % of the lost stops; M2's √ adaptation
// had exposed an 18:45 frame (the sun 12° up) 2 × brighter than v1 (the boathouse walls 62,62,57 against v1's 27,27,32).
// The day now follows v1's schedule at E.v1Base (M2's noon factor: with AgX, v1's LUT and the sky match it puts v1's noon on
// screen; render/grade.js) and the night keeps v2's own long exposure (below) at E.nightBase, whichever is the lower (the
// night's never under the day's base): they cross at the sun's +0.6°, so the day is v1's and the night v2's. nightBase 0.18
// (M2: 0.26) keeps the night near its approved look under AgX's lifted toe (the follow camera's near water 0,24,81 against
// 6,18,90) and puts the crossing above v1's steepest stretch (under +0.66° v1 gives back 1.055 × a 0.1° step).
// M5e: past the horizon the night adapts further (v2/sim/night.js nightGain: × up to 12 between the sun's −2° and −14°,
// a smoothstep in elevation), v1's long-exposure night (src/sim/timeOfDay.js exposureAt rises to 362 × its base by
// −12°): the airglow sky reads deep blue, the Milky Way rich, the boat and the shore softly lit, as a night photo
// moonShare: the moon's share of its full light (v2/sim/night.js moonLightShare): a moonlit night is exposed down by
// 1 + the share, as a photographer would (the sky still comes out brighter: NIGHT.moonSky lifts it by 1 + 2.5 × the share)
import { exposureAt } from '../../src/sim/timeOfDay.js';

// the page's look (main.js sets it once from ?look=, before the first frame): every caller's default
let LOOK = 'v1';
export const setLook = (look) => { LOOK = look === 'v2' ? 'v2' : 'v1'; return LOOK; };
export const currentLook = () => LOOK;
export const EXPOSURE = Object.freeze({ base: 0.26, v1Base: 0.34, nightBase: 0.2, refElevDeg: 70, floor: 0.05, maxGain: 5 });

// the relative light on level ground for a sun at elevation e (deg): sin e plus a floor for the sky's own light
export const groundLight = (e) => Math.max(0, Math.sin((e * Math.PI) / 180)) + EXPOSURE.floor;

// M2's adaptive gain (≥ 1) at a sun elevation, before the night's
const m2Gain = (e, E) => Math.max(1, Math.min(E.maxGain, Math.sqrt(groundLight(E.refElevDeg) / groundLight(e))));
const moonDiv = (e, moonShare) => 1 + Math.max(0, moonShare) * Math.min(1, (nightGain(e) - 1) / (NIGHT_GAIN - 1));
// the factor before the URL's exposure / 6 and the moon (the scene's HDR × this goes into the tone curve)
export function baseFactor(sunElevDeg = 60, E = EXPOSURE, look = LOOK) {
  if (look === 'v2') return E.base * m2Gain(sunElevDeg, E) * nightGain(sunElevDeg);
  // look/v2-night-look: the night gain over the whole (it was inside the cap of v1's schedule, which held 20:15 at 0.56 × v1's frame)
  return Math.min(E.v1Base * exposureAt(sunElevDeg) / 6, Math.max(E.v1Base, E.nightBase * m2Gain(sunElevDeg, E))) * nightGain(sunElevDeg);
}
export function exposureFactor(exposure = 6, sunElevDeg = 60, E = EXPOSURE, moonShare = 0, look = LOOK) {
  return (exposure / 6) * baseFactor(sunElevDeg, E, look) / moonDiv(sunElevDeg, moonShare);
}
// fix(v2) frame look: the navy kept. The water past the shelf (its surface: render/water.js; the column past 16 m: render/bed.js)
// is never exposed brighter than M2 exposed it: × min(1, M2's factor / v1's) (0.765 at noon, 0.91 at 09:00, 1 from the
// afternoon on and at night), so the deep water reads its value before the change; the shelf and the land take v1's
export function waterKeep(exposure = 6, sunElevDeg = 60, moonShare = 0, actual = exposureFactor(exposure, sunElevDeg, EXPOSURE, moonShare, 'v1')) {   // actual: the frame's factor (a storm's: stormExposure)
  return Math.min(1, exposureFactor(exposure, sunElevDeg, EXPOSURE, moonShare, 'v2') / actual);
}
// fix(v2) frame look, the storm (#18 r2 merged): the storm's content (its deck light, the rain, the haze, the water) was tuned
// under M2's camera, which adapts toward dusk; v1's schedule holds the day's exposure to the sun's +8.5°, so a storm at 20:00
// read 0.64 × main (the deck's undersides 61 against v1's 83). Under a storm (its dark, 0–1) the exposure is never under M2's
// adaptation (at noon v1's is the higher and holds; at 18:15 × 1.3, at 20:00 × 1.56)
export function stormExposure(f, exposure = 6, sunElevDeg = 60, moonShare = 0, dark = 0) {
  if (!(dark > 0) || LOOK === 'v2') return f;
  return f + Math.min(1, dark) * Math.max(0, exposureFactor(exposure, sunElevDeg, EXPOSURE, moonShare, 'v2') - f);
}
// the day's base of a look (the factor at noon): the clouds' match divides by it (sim/clouds.js cloudLightMatch)
export const lookBase = (E = EXPOSURE, look = LOOK) => (look === 'v2' ? E.base : E.v1Base);
// look/v2-night-look (owner 2026-11-15: "the night is very very very dark … like sailing blind"): the blue hour into the
// night. The gain came in from −2° to −14° while v2's sky LUT is black past −8°, so 20:30–21:15 fell to 0.4 / 255. It now
// follows the light that is left, knot by knot in elevation (deg → gain; log-linear between, 1 above the first, the last
// held below): measured on the follow camera at v1's Sail start (renders/night-look/), so the frame holds 28–36 / 255 from
// the sunset to the deep night. The twilight knots are over the night's own: the sky's last light is going and the night
// light (sim/night.js airFade) is only coming in. The day is untouched (1 above the sun's +3.5°: the 20:00 frames hold)
export const NIGHT_GAIN = 24;
export const NIGHT_KNOTS = Object.freeze([[3.5, 1], [1.6, 1.8], [0, 3.2], [-1, 5], [-3.4, 15.6], [-5.8, NIGHT_GAIN]]);
export function nightGain(elevDeg) {
  const K = NIGHT_KNOTS;
  if (!(elevDeg < K[0][0])) return 1;
  for (let i = 1; i < K.length; i++) {
    if (elevDeg >= K[i][0]) { const t = (K[i - 1][0] - elevDeg) / (K[i - 1][0] - K[i][0]); return Math.exp(Math.log(K[i - 1][1]) * (1 - t) + Math.log(K[i][1]) * t); }
  }
  return NIGHT_GAIN;
}
// The twilight lift's shares (render/grade.js tells the story; moved here in refactor round 3 C6 so sim/clouds.js reads them
// without reaching render/): TWILIGHT's numbers, the twilight's share at a sun elevation and the night sky's
const smooth01 = (lo, hi, x) => { const k = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return k * k * (3 - 2 * k); };
export const TWILIGHT = Object.freeze({ sky: 0.55, cloudSky: 3.0, deg: [-6.5, -4.5, 0, 3], night: 0.5, nightDeg: [-4.5, -9.5], horizon: 0.15, horizonSin: 0.6 });
export const twilightShare = (elevDeg, T = TWILIGHT) => smooth01(T.deg[0], T.deg[1], elevDeg) * (1 - smooth01(T.deg[2], T.deg[3], elevDeg));
export const nightSkyShare = (elevDeg, T = TWILIGHT) => smooth01(-T.nightDeg[0], -T.nightDeg[1], -elevDeg);
