// The boat's own lit faces by night (fix/helm-view-cockpit, 2026-11-06): the bulkhead's clock, barometer and heel meter, the
// pedestal's wind-and-speed pod, the VHF's LCD, the compass card and the cabin seen through the companionway.
//
// Why they blew out: those faces are unlit (MeshBasic: the texture is the colour) or carry a fixed emissive, so on screen they
// are their value × the scene's exposure. The exposure rises after sunset to hold the night readable (src/timeOfDay.js: 6 by day,
// up to 2172 under −12°), so a face that reads cream on navy at 6 was 362 × brighter at night: white discs and boxes on a black
// boat. A lamp holds its on-screen level when its value is scaled by the frame's exposureComp (base / exposure); by night the
// faces also turn to the night set (as real instruments do, and as the cockpit's own: src/stations/sloop/cockpit3d.js): a red-amber ink on
// a near-black glass, dim.
//
//   const k = nightK(frame.elevDeg)                 // 0 by day … 1 by night (the theme's switch: src/ui/theme.js, ±1°)
//   mat.color.setScalar(faceGain(frame))            // an unlit face: its on-screen level (day 1 × the day's look; night NIGHT_FACE.gain)
//   drawX(g, …, facePalette(k >= 0.5))              // the face's inks
// Pure (no three.js): tests/nightLight.test.mjs.
import { clampT as clamp } from '../sim/core/math.js';

export const NIGHT_FACE = {
  dayDeg: 2, nightDeg: -2,   // the sun's elevation (°) over which the faces go from the day set to the night set
  gain: 0.16,                // the night face's backlight, × its day level on screen (a dim glow: night vision kept)
  cabin: 0.05,               // the cabin's floor by night (a red night light), × its day level on screen
};
// the day set (cream on navy, the instruments' family) and the night set (the cockpit's night ink: src/stations/sloop/cockpit3d.js INK.night)
export const FACE_PALETTE = {
  day: { bg: '#0d131b', ink: '#EFE6D2', dim: 'rgba(239,230,210,0.55)', faint: 'rgba(239,230,210,0.35)', brass: '#b8975a' },
  night: { bg: '#0a0504', ink: '#FF9F80', dim: 'rgba(255,159,128,0.5)', faint: 'rgba(255,159,128,0.3)', brass: '#c4643f' },
};
export const facePalette = (night = false) => (night ? FACE_PALETTE.night : FACE_PALETTE.day);

// 0 by day, 1 by night, smooth over NIGHT_FACE's band
export function nightK(elevDeg = 90) {
  const N = NIGHT_FACE, u = clamp((N.dayDeg - elevDeg) / (N.dayDeg - N.nightDeg), 0, 1);
  return u * u * (3 - 2 * u);
}
// an unlit face's colour scale for a daylight frame ({ elevDeg, exposureComp }): 1 by day (the look as it was), the day level
// held on screen through dusk, the night gain by night
export function faceGain({ elevDeg = 90, exposureComp = 1 } = {}) {
  const k = nightK(elevDeg);
  return Math.min(1, exposureComp) * (1 - k + k * NIGHT_FACE.gain);
}
// the cabin's light (src/boat/cockpitLook.js): the daylight level `light` (0..1) by day, as it was; once that falls under the
// night light's level on screen, the night light holds it (its value × exposureComp keeps its on-screen level). × lum × CABIN_LIGHT.
export function cabinShare({ light = 1, exposureComp = 1 } = {}) {
  const comp = Math.min(1, exposureComp);
  return Math.max(Math.min(1, light), NIGHT_FACE.cabin * comp);
}
