// The night's pure side (M5e): the levels every night reader takes from the sun and the moon, the night exposure, the
// packed lights' and stars' decoders, the boat's nav lights in the world, and the WGSL text's numbers. The look is v1's
// starlit night (owner 2026-11-07: "a photographer's lens, not the naked eye"; src/core/milkyway.js):
// a deep blue airglow sky lighter and greener toward the horizon, soft light domes over the towns, many stars, the
// Milky Way rich with a warm core and a blue-violet outer band, the world lit coolly as by a long exposure, warm points
// for the town lights and the boat's own. The numbers that are v1's are imported from its pure modules
// (src/core/milkyway-math.js, src/boat/nightLight.js, src/boat/details.js, src/ui/theme.js); what differs is the
// scale: v2's HDR scale (a noon zenith ≈ 1) and its exposure (v2/sim/exposure.js), so the levels here are set
// against v1's night golden by eye, not by v1's cd/m² numbers.
import { nightFade, moonDim, moonLightShare, lightDomeAt, LIGHT_DOMES, MW_LOG_K } from '../../src/core/milkyway-math.js';
import { nightK } from '../../src/boat/nightLight.js';
import { navLevel, navSector, navVertical, NAV_MODES } from '../../src/boat/details.js';
import { isNight, NIGHT as THEME_NIGHT } from '../../src/ui/theme.js';

export { nightFade, moonDim, moonLightShare, lightDomeAt, LIGHT_DOMES, MW_LOG_K, nightK, isNight, THEME_NIGHT, navLevel, navSector, navVertical, NAV_MODES };

export const NIGHT = Object.freeze({
  airglow: 1.4e-2,                      // the zenith airglow's radiance, HDR scale (v1: AIRGLOW 0.065 of the band's unit); × up to 2.45 to the horizon (owner 2026-11-13: brighter)
  landLift: 0.075,                       // v1's NIGHT_LAND (src/core/night.js): the starlit night's cool light on the land and the lake's body, HDR irradiance at the night's full level
  landColour: [0.62, 0.72, 0.9],        // v1's NIGHT_LAND_COLOUR
  airFade: [0, -8],                   // the airglow comes in over these sun elevations: v2's LUT is black past −8° (the whole air in the shadow), where v1's night exposure still showed its twilight
  airLight: 0.7,                        // look/v2-night-look: the airglow's share in the light the sky casts on the world (the exposure doubled: the land and the ridges stay darker than a lit frame)
  bedLight: 0.5,                        // look/v2-night-look: the bed's light through the water by night (× the night's level): the shallows no brighter than the beach
  cloudNight: 0.2,                      // the clouds' sky light by night (× the night's level): the deck reads dark grey-blue against the band (feat/v2-night-clouds: 0.3 → 0.2)
  cloudAir: 0.12,                       // and in the clouds' own top light (on top of the world's sky light: their night deck grey-blue, not lit white) (feat/v2-night-clouds: 0.2 → 0.12)
  cloudHaze: 0.08,                      // feat/v2-night-clouds (owner 2026-11-18: "Darken the night clouds toward v1"): the airglow's share in the air between the eye
                                        // and the deck (render/clouds.js cloudHazeSky): the drawn sky's (airSky), not the whole glow the world is lit by (about 12 × the
                                        // drawn sky at the horizon: the far deck glowed saturated blue over the clear sky); the town domes and the moon's glow stay whole
  cloudDomes: 0.3,                      // fix/v2-fireworks-view-clouds: the towns' light domes' share in the clouds' haze, at the cloud's own height (render/clouds.js
                                        // cloudHazeSky; was the whole dome at the horizon's height for every far cloud: the deck over South Lake Tahoe and Reno read
                                        // orange at 22:30 and through the show): a dim warm glow on the low deck over the towns, never an orange deck
  cloudMoon: 0.06,                      // feat/v2-night-clouds: the moon lights the deck once the sun is down (the moon's share of the night land light × moonSky × this):
                                        // a moonlit deck has lit tops and darker bases, as v1's
  treeNight: 0.52,                     // fix/v2-night-treeline (2026-11-20): 0.75 → 0.52 with the darker night sky (render/grade.js TWILIGHT.night)
                                        // feat/v2-night-clouds (0.75): the crowns' light by night (× the night's level; render/forest.js, the far canopy in terrain.js): the tree
                                        // line stays a silhouette against v1's darker night sky (terrainShadow: luma ≤ 0.7 × the sky's; the ground keeps its light)
  deckMirror: 4.0,                      // feat/v2-night-clouds: the night deck's light in the water's mirror over its own (render/water.js), as airMirror over airSky for
                                        // the clear sky: the darker deck must not darken the water that mirrors it ("never sailing blind")
  airMirror: 0.3,                       // and in the water's mirror of the sky (the waves' sheen by night)
  airSky: 0.08,                          // look/v2-night-look: the airglow's share in the sky as drawn (v1's dark zenith: the band and the stars read; owner 2026-11-15); the light it casts stays whole.
                                        // feat/v2-sky-v1-grade: 0.06 → 0.08 with the air's transmittance on it (sky.js skyRadianceShown): the zenith keeps v1's level, the low sky v1's dim green-amber
  domeSky: 0.08,                        // fix/v2-night-town-glow (2026-11-18: the clear night's sky orange-brown over the towns, up to the top of the frame): the
                                        // towns' light domes' share in the sky as drawn, as airSky's for the airglow (v1's dome-to-sky ratio: a faint warm glow a few
                                        // degrees over South Lake Tahoe, Reno and Tahoe City; the whole dome over v2's dark drawn sky stood 12 × v1's). The light the
                                        // sky casts, the water's mirror and the clouds' haze keep theirs
  airColour: [0.36, 0.52, 1.0],         // v1's AIRGLOW_COLOUR: deep blue at the zenith
  airHorizon: [0.26, 0.62, 1.0],        // v1's AIRGLOW_HORIZON: blue-green low down (the haze reddens it)
  moonSky: 2.5,                         // a full moon high: the glow and the night light × (1 + 2.5) (v1's MOON_SKY is 4; v2's exposure also comes down by 1 + the moon's share: exposure.js)
  band: 11,                             // the Milky Way's x = 1 over the zenith airglow (v1: 1 / AIRGLOW = 15.4; a little under it: the core read white); the light domes' unit
  bandShow: 0.11,                       // feat/v2-sky-v1-grade (owner 2026-11-18: "use v1's Milky Way as reference"): the band as drawn and mirrored, × band: the
                                        // shown airglow is NIGHT.airSky of the full one, so at 11 alone the band stood 183 × over the sky (v1: 15.4 ×), its core
                                        // blown to cream and the map's faint floor laid a grey-brown grain over the whole sky; 0.11 (about 15 × the shown sky)
                                        // puts the core, the lanes and the clear sky at v1's levels on screen (measured: renders/sky-v1-grade)
  bandSaturation: 0.7, bandContrast: 1.25, bandOuter: [0.8, 0.86, 1.18],   // v1's MW_SATURATION, MW_CONTRAST, MW_OUTER
  domes: 1 / 3,                         // the light domes' scale over the band's unit (v1's LP_SCALE at MW_GAIN 9)
  domeColour: [0.9, 0.86, 0.8],         // v1's LP_COLOUR
  moonDisc: 0.4,                        // the full moon's radiance, HDR (≈ 1.6e-6 of the sun's disc, as the real ratio)
  moonHalo: 0.6,                        // the moonlit sky's glow round the disc, × the airglow level × the moon's share
  // the stars as v1's (feat/v2-sky-v1-grade): pin-points, not 3 px soft dots on a grain. A star's light (10^(−0.4 m) × starScale, HDR × px²) is
  // spread over a small gaussian, sigma starPx px for the faint stars up to starPxMax for the brightest (a photo's bright stars are bigger,
  // never blurred); mag 5.5 reads faintly, as v1's
  starScale: 1.6,
  starPx: 0.55,
  starPxMax: 1.0,
  twinkle: { amp: 0.22, horizon: 0.6, hz: [2.1, 3.7], colour: 0.2 },   // v1's TWINKLE
  loadBelowDeg: 8,                      // a live page fetches the night's data once the sun is this low (it is ready by dusk)
});
// The Purkinje shift's night (owner, 2026-11-20:; render/purkinje.js, the composite): strength, the shift's amount
// at full night (Ponlai's look runs 0-0.4; ours is a slight lift: the darker night's levels of); retina, the
// retinal illuminance (trolands) the exposed white card is taken to (Ponlai's 250); white, that card's exposed level under our night
// exposure; moon, how much a full moon high takes back (a moonlit night is brighter: the rods give way). The amount follows the
// lamps' switch (nightK: 0 by day, 1 by night, the sun from −1° to −9°)
export const PURKINJE = Object.freeze({ strength: 0.02, retina: 250, white: 0.5, moon: 0.5 });
export const purkinjeScale = (P = PURKINJE) => P.retina / P.white;
export function purkinjeAmount({ k = 0, moonShare = 0 } = {}, P = PURKINJE) {
  const kk = Math.min(1, Math.max(0, k)), m = Math.min(1, Math.max(0, moonShare));
  return P.strength * kk * (1 - P.moon * m);
}

// a live page fetches the night's data (the stars and the lights, 0.38 MB) once the sun is below loadBelowDeg, and only then (
// § Round 2, owner 2026-11-17; every device): a day page no longer fetches it once the terrain's stream is done. The airglow comes in
// at the sunset and the stars by −10°, so at the day clock's pace (1 game hour in 3 min) the data has minutes in hand
export const nightLoadDue = (sunElevDeg) => Number.isFinite(sunElevDeg) && sunElevDeg < NIGHT.loadBelowDeg;

// --- the exposure's night adaptation (v2/sim/exposure.js takes it): v1's rises to 362 × its base by sun −12°
// (src/sim/timeOfDay.js); v2's dusk gain reaches 5 × at the horizon, and the night multiplies it by up to NIGHT_GAIN
// between −2° and −14°, a smoothstep in elevation: no step on the day clock ---
export { NIGHT_GAIN, nightGain } from './exposure.js';
import { smooth } from '../../src/sim/core/math.js';

// the night's levels for a frame: air the airglow's scale (0 by day; the moon lifts it), domes the light domes' scale,
// band the Milky Way's and the stars' (the sun's fade × the moon's dimming), k the lamps' and the theme's switch (0 day
// … 1 night), moonShare the moon's share of its full light
export function nightLevels({ sunElevDeg, moonAltDeg = -90, moonLit = 0 }) {
  const fade = nightFade(sunElevDeg);
  const share = moonLightShare(moonAltDeg, moonLit);
  const moon = 1 + NIGHT.moonSky * share;
  const dim = moonDim(moonAltDeg, moonLit);
  return {
    air: smooth(NIGHT.airFade[0], NIGHT.airFade[1], sunElevDeg) * moon,
    domes: fade > 0 ? fade * (0.5 + 0.5 * dim) : 0,   // v1: the domes fade by half of the band's dimming
    band: fade * dim,
    k: nightK(sunElevDeg),
    moonShare: share,
  };
}

// --- the clear night (owner, 2026-11-18: "Maybe at night we don't need clouds? That way they won't block the Milky Way and the
// fireworks"): under Clear and Fair the deck thins away after sunset, a smoothstep in the sun's elevation from the sunset (0°) to
// NIGHT_CLEAR.toDeg (about 25–30 game minutes at Tahoe in July: the sun sinks about 11° an hour there), and comes back the same way
// before the sunrise; during the fireworks show the sky is clear whatever the menu says. A storm (running, or picked) keeps its
// deck, as do Cruise's Cloudy and a URL's own ?cloudcov (an explicit deck: comparisons and the storm goldens). The deck's
// coverage goes to NIGHT_CLEAR.cover, under the weather map's ±0.35 swing (sim/clouds.js cloudDensity): no cloud anywhere.
// Pure, deterministic: the sun's elevation from the day clock's hour, the menu's state, the show's clock ---
export const NIGHT_CLEAR = Object.freeze({ fromDeg: 0, toDeg: -5, cover: -0.4 });
export const nightClearK = (sunElevDeg) => (Number.isFinite(sunElevDeg) ? smooth(NIGHT_CLEAR.fromDeg, NIGHT_CLEAR.toDeg, sunElevDeg) : 0);
// cover: the deck's coverage the weather gives (the menu's eased value); sky: the menu's current() ('clear' | 'fair' | 'storm' |
// 'cloudy'); storm: a storm running; show: the fireworks show playing; explicit: the URL set the coverage → the coverage to draw
export function nightCover({ cover, sunElevDeg, sky = 'fair', storm = false, show = false, explicit = false }) {
  if (storm || sky === 'storm' || explicit) return cover;
  const k = show ? 1 : sky === 'cloudy' ? 0 : nightClearK(sunElevDeg);
  return k <= 0 ? cover : cover + (NIGHT_CLEAR.cover - cover) * k;
}

// --- the packed town lights (tools/v2-lights-pack.mjs): → Float32Array × 8 a light: x, y, z, r, g, b, size (m), on (sun elevation, deg) ---
export const LIGHT_FLOATS = 8;
export function decodeLights(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'VLT1') throw new Error('lights.bin: not a VLT1 file');
  const n = dv.getUint32(4, true), out = new Float32Array(n * LIGHT_FLOATS);
  for (let i = 0; i < n; i++) {
    const o = 16 + i * 12, k = i * LIGHT_FLOATS;
    out[k] = dv.getInt16(o, true); out[k + 2] = dv.getInt16(o + 2, true); out[k + 1] = dv.getInt16(o + 4, true) * 0.25;
    out[k + 3] = bytes[o + 6] / 255; out[k + 4] = bytes[o + 7] / 255; out[k + 5] = bytes[o + 8] / 255;
    out[k + 6] = bytes[o + 9] * 0.1; out[k + 7] = dv.getInt8(o + 10) * 0.5;
  }
  return { count: n, data: out };
}

// --- the star catalogue (@takram's stars.bin: 10 bytes a star): → Float32Array × 8 a star: the J2000 direction (unit),
// the visual magnitude, r, g, b (the black-body colour, 0–1), 0 ---
export const STAR_FLOATS = 8;
export function decodeStars(bytes) {
  const n = Math.floor(bytes.byteLength / 10), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(n * STAR_FLOATS);
  for (let i = 0; i < n; i++) {
    const o = i * 10, k = i * STAR_FLOATS;
    let x = dv.getInt16(o, true) / 32767, y = dv.getInt16(o + 2, true) / 32767, z = dv.getInt16(o + 4, true) / 32767;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    out[k] = x; out[k + 1] = y; out[k + 2] = z;
    out[k + 3] = bytes[o + 6] / 255 * 10 - 2;   // the library's normalised magnitude: its magnitudeRange −2 … +8 over the byte (BSC5 runs −1.46 … 6.5)
    out[k + 4] = bytes[o + 7] / 255; out[k + 5] = bytes[o + 8] / 255; out[k + 6] = bytes[o + 9] / 255; out[k + 7] = 0;
  }
  return { count: n, data: out };
}

// --- the boat's nav lights (COLREGs, v1's src/boat/details.js: a sailing vessel shows sidelights and a sternlight), in
// the world: the hull frame's lenses (dims.navBow, navStern) carried by the pose (x, heave, z, heading, pitch, heel as
// render/boat.js builds the hull's matrix), their sector and vertical cut-offs toward the eye, the level from the sun.
// Writes GLOW_FLOATS × 3 into out: x, y, z, size (m), r, g, b, intensity ---
export const GLOW_FLOATS = 8;
const LENS = { green: [0.2, 1.0, 0.45], red: [1.0, 0.22, 0.16], white: [1.0, 0.95, 0.85] };
// the lens' glow (A1, v1's src/boat/details-mesh.js halos): a camera-facing quad 0.35 m across, never under 22 px on screen
// (v1's minPx, its own floor: the town windows keep theirs), with v1's hot core and modest bloom at a constant level, so a
// boat far off keeps its lights; radiance: the core's HDR peak when full on, set on v2's night exposure so the halo reads as
// v1's at the deck pose under the frame look's AgX and grade (v1's long-exposure night lifts its faint bloom to a ≈ 14 px disc;
// 60 before the AgX change, 400 after it; renders/audit-fix-world/nav-*)
export const NAV_GLOW = Object.freeze({ size: 0.35, minPx: 22, radiance: 400 });
// a far point light (owner, 2026-11-18, the anchored boats' riding lights: "dim them at distance so they don't read big on the horizon"):
// a glow record with a negative size keeps the nav halo within nearM of the eye; past it the 22 px floor shrinks toward minPx and the
// light dims toward dim by farM, so a far anchor light is a small faint point, still seen (render/night.js)
export const FAR_POINT = Object.freeze({ nearM: 80, farM: 500, minPx: 4, dim: 0.35 });
const tmpP = [0, 0, 0];
function hullToWorld(p, pose, out = tmpP) {
  // Rz(−heel) then Rx(pitch) then Ry(−heading), then the position: render/boat.js's order
  const hr = -(pose.heel ?? 0), pr = pose.pitch ?? 0, yr = -pose.heading;
  let x = p[0], y = p[1], z = p[2];
  let c = Math.cos(hr), s = Math.sin(hr); let x1 = c * x - s * y, y1 = s * x + c * y, z1 = z;
  c = Math.cos(pr); s = Math.sin(pr); const y2 = c * y1 - s * z1, z2 = s * y1 + c * z1, x2 = x1;
  c = Math.cos(yr); s = Math.sin(yr); const x3 = c * x2 + s * z2, z3 = -s * x2 + c * z2;
  out[0] = pose.x + x3; out[1] = (pose.heave ?? 0) + y2; out[2] = pose.z + z3;
  return out;
}
// anchored (the anchor seen, 2026-11-17): COLREGs rule 30, the one white all-round light at the masthead (mastHead: its hull-frame
// point) in place of the sidelights and the sternlight, in a fourth slot (zero when not anchored or with no mastHead)
export function navLights(out, { pose, sunElevDeg, eye, dims, mode = 'sailing', anchored = false, mastHead = null }) {
  const lit = NAV_MODES[anchored ? 'anchor' : mode] ?? NAV_MODES.sailing, level = navLevel(sunElevDeg);
  const rows = [
    { at: [dims.navBow[0] + 0.035, dims.navBow[1], dims.navBow[2] - 0.05], kind: 'green', grp: 'bow', c: LENS.green },
    { at: [dims.navBow[0] - 0.035, dims.navBow[1], dims.navBow[2] - 0.05], kind: 'red', grp: 'bow', c: LENS.red },
    { at: [dims.navStern[0], dims.navStern[1], dims.navStern[2] + 0.05], kind: 'stern', grp: 'stern', c: LENS.white },
  ];
  if (mastHead) rows.push({ at: mastHead, kind: 'anchor', grp: 'anchor', c: LENS.white, size: NAV_GLOW.size * 0.8, allRound: true });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], p = hullToWorld(r.at, pose), k = i * GLOW_FLOATS;
    out[k] = p[0]; out[k + 1] = p[1]; out[k + 2] = p[2]; out[k + 3] = r.size ?? NAV_GLOW.size;
    out[k + 4] = r.c[0]; out[k + 5] = r.c[1]; out[k + 6] = r.c[2];
    // the viewer's bearing from the bow (+ starboard) and elevation, in the hull frame
    const dx = eye[0] - p[0], dy = eye[1] - p[1], dz = eye[2] - p[2];
    const h = pose.heading, fx = Math.sin(h), fz = -Math.cos(h), sx = -fz, sz = fx;   // forward and starboard in the world
    const fwd = dx * fx + dz * fz, side = dx * sx + dz * sz;
    const bearing = Math.atan2(side, fwd) * 180 / Math.PI, elev = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
    out[k + 7] = lit.includes(r.grp) ? NAV_GLOW.radiance * level * (r.allRound ? 1 : navSector(r.kind, bearing) * navVertical(elev)) : 0;
  }
  return out;
}
