// Cruise's camera during the show (S5, owner 2026-11-08: "calm, varied: wide from the mouth, the reflection, the
// boats and kayaks under the show; no shake"). Plain JS: tests/fireworksCruise.test.mjs frames the finale with it.
//   const p = showShot(showT, { boat: { x, z }, heightAt })   → { kind, pos, target, fov, near } or null (outside the show)
// One shot per span of the show's script (src/fireworks/show.js SEGMENTS), cut hard on the span's edge (a cut, never a
// whip pan); inside a shot the camera only drifts, a slow dolly of a few metres, so nothing shakes. Each shot looks at the
// show's middle (the barges' midpoint, cruise.js SHOW_CENTRE) from its own place, whatever way the boat swings on its
// anchor, so a frame never turns with the boat. Two places: the boat (the anchorage, CRUISE_SPOT) and the crowd (CROWD: the
// anchored sailboats and the kayaks 60–150 m on toward the show, src/fireworks/spectators.js; realism round, 2026-11-08: it
// was the sill, which the barges' move left 260–340 m from them, under the show).
// The pitch and the field are set so the show's bursts fit with headroom and the water (its reflections) stays in frame;
// the finale's shot fits 99.5 % of its stars (the test).
import { VIEW, AIM, at as atBearing } from '../../../src/fireworks/stage.js';
import { SHOW_CENTRE } from './cruise.js';
import { SHOW_LENGTH } from '../../../src/fireworks/show.js';

const CROWD = atBearing(AIM, 100, VIEW);
// at: 'boat' | 'crowd'; back: m back from the place, away from the show; side: m to the right (facing the show); up: m
// over the water; pitch: deg up; fov: vertical deg; yaw: deg off the show's middle (+ right); dolly: m per s [back, side, up]
// The wow round (owner 2026-11-08: the close film's look in the game): the show is 250 m off, so every shot is low and
// close behind or beside the boat (or among the crowd), a very wide lens (80–84° vertical) pitched up 26–34°: the boat big
// in the foreground, the bursts filling the sky over its mast (the biggest overhead), the coloured water round the hull.
export const SHOTS = [
  { kind: 'wide', from: -60, to: 30, at: 'boat', back: 16, side: -5, up: 1.6, pitch: 28, fov: 84, dolly: [-0.05, 0.02, 0] },        // close astern, the boat under the opening
  { kind: 'crowd', from: 30, to: 75, at: 'crowd', back: 10, side: 8, up: 1.3, pitch: 32, fov: 84, dolly: [-0.06, -0.03, 0] },        // among the sailboats and kayaks
  { kind: 'reflection', from: 75, to: 120, at: 'boat', back: 8, side: 12, up: 0.9, pitch: 26, fov: 84, yaw: -8, dolly: [0, -0.04, 0] },   // low over the water beside her: the colours on the water
  { kind: 'boat', from: 120, to: 158, at: 'boat', back: 12, side: 7, up: 2.4, pitch: 28, fov: 80, yaw: -6, dolly: [0.04, -0.03, 0] },   // the hull and the rig; the quiet gap
  { kind: 'kayaks', from: 158, to: 205, at: 'crowd', back: 14, side: -10, up: 1.2, pitch: 36, fov: 84, yaw: 4, dolly: [-0.05, 0.03, 0] }, // low among the kayaks
  { kind: 'astern', from: 205, to: 245, at: 'boat', back: 20, side: -10, up: 3, pitch: 28, fov: 84, dolly: [-0.08, 0.04, 0] },       // the body, a little wider astern
  { kind: 'finale', from: 245, to: SHOW_LENGTH + 12, at: 'boat', back: 15, side: -4.5, up: 1.4, pitch: 31, fov: 84, dolly: [-0.08, 0.02, -0.004] },   // the close film's shot: a slow push-in under the finale
];
const DEG = Math.PI / 180;

export function shotAt(t) { return t == null ? null : SHOTS.find((s) => t >= s.from && t < s.to) ?? null; }

// boatOnly (Sail's one-tap fireworks, src/sail/showNow.js): the player's boat stays in frame, so a span shot among the crowd is
// the boat shot before it (its own dolly goes on)
function boatShotAt(t) {
  let i = SHOTS.findIndex((s) => t >= s.from && t < s.to);
  if (i < 0) return null;
  while (i > 0 && SHOTS[i].at === 'crowd') i--;
  return SHOTS[i];
}

export function showShot(t, { boat = null, heightAt = null, boatOnly = false, pitchAdd = 0 } = {}) {
  const S = boatOnly ? boatShotAt(t) : shotAt(t);
  if (!S) return null;
  const B = S.at === 'crowd' || !boat ? CROWD : [boat.x, boat.z];
  const toShow = Math.atan2(SHOW_CENTRE[0] - B[0], -(SHOW_CENTRE[1] - B[1]));   // bearing, rad clockwise from north
  const fx = Math.sin(toShow), fz = -Math.cos(toShow), rx = -fz, rz = fx;      // forward and right on the water (x east, z south)
  const k = t - S.from, back = S.back + S.dolly[0] * k, side = S.side + S.dolly[1] * k, up = S.up + S.dolly[2] * k;
  const x = B[0] - fx * back + rx * side, z = B[1] - fz * back + rz * side;
  const y = Math.max(up, (heightAt ? Math.max(0, heightAt(x, z)) : 0) + 1.5);
  const yaw = Math.atan2(SHOW_CENTRE[0] - x, -(SHOW_CENTRE[1] - z)) + (S.yaw ?? 0) * DEG, p = (S.pitch + pitchAdd) * DEG;
  const target = [x + Math.sin(yaw) * Math.cos(p) * 100, y + Math.sin(p) * 100, z - Math.cos(yaw) * Math.cos(p) * 100];
  return { kind: S.kind, pos: [x, y, z], target, fov: S.fov, near: 0.3, cut: S.from };
}
