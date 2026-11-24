// Lakeshore boat M9: the burgee, telltales and nav lights, as plain-JS formulas (src/boat/details-mesh.js draws them).
// Deterministic in t (no state, no Math.random): a capture at time t shows the same flutter every run.
//
// Frames: the RIG frame (src/boat/dims.js) for the burgee, the shroud and sail telltales; the HULL frame for the
// deck-level nav lights. Wind in the boat frame: a vector the air moves along, m/s (apparent wind: the boat's own
// motion included). From the contract's apparentWind { speed, angle (+ from starboard) }: windVector(aw) below.
//
//   streamer(L, n, wind, t, { phase, stall }) → n + 1 points from the root: a flag or a yarn in the wind
//   navSector(kind, bearingDeg)  → 0..1 visibility of a nav light at a bearing from the bow (+ = to starboard)
//   navLevel(sunElevDeg)         → 0..1: the lights are on from sunset to sunrise (COLREGs rule 20)
import { clamp } from '../sim/core/math.js';

const DEG = Math.PI / 180;
import { smooth } from '../sim/core/math.js';

// The contract's apparent wind (speed m/s, angle rad from the bow, + = from starboard) as the air's velocity in the
// boat frame (bow −z, +x starboard). Wind from starboard (angle +90°) blows toward port: −x.
export function windVector({ speed = 0, angle = 0 } = {}) {
  return [-Math.sin(angle) * speed, 0, Math.cos(angle) * speed];
}

// A streamer (burgee, yarn): a chain of n segments, total length L, rooted at the origin.
// Pose: it flies downwind and droops by drag against weight, tan(droop) = C / v² (C = 2.3 m²/s²: 30° at 2 m/s,
// 8° at 4 m/s, hanging at 0); a travelling wave runs root → tip, its frequency rising with the wind (≈ 0.9 + 0.55·v Hz)
// and its amplitude growing toward the tip. `stall` 0..1: separated flow, the yarn lifts, wanders and curls. `calm`
// 0..1: the flow at its cleanest (the groove, src/boat/groove.js): the travelling wave settles to 40 % (a yarn in a
// clean attached flow streams straight back with a fine flicker).
export function streamer(L, n, wind, t, { phase = 0, stall = 0, calm = 0, C = 2.3 } = {}) {
  const v = Math.hypot(wind[0], wind[1], wind[2]);
  const hx = v > 1e-6 ? wind[0] / v : 0, hz = v > 1e-6 ? wind[2] / v : 1;
  const droop = Math.atan2(C, v * v);                          // rad below horizontal (π/2 at no wind)
  const fly = clamp(v / 2.5, 0, 1);
  const f = 0.9 + 0.55 * v, k = 2 * Math.PI / Math.max(0.6 * L, 0.05);
  const amp = (0.10 + 0.05 * fly) * L * (0.25 + 0.75 * fly) * (1 - 0.6 * clamp(calm, 0, 1) * (1 - stall));
  const pts = [[0, 0, 0]];
  let p = [0, 0, 0];
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    // the stalled yarn: lifts toward the vertical and wanders in heading (a sum of two slow sines, deterministic)
    const wander = stall * (1.2 * Math.sin(2 * Math.PI * 0.7 * t + phase * 3.1 + s * 2.0) + 0.6 * Math.sin(2 * Math.PI * 1.9 * t + phase));
    const lift = stall * 1.1 * s;
    const yaw = Math.atan2(hx, hz) + wander * s;
    const pitch = -droop * (0.55 + 0.45 * s) * (1 - stall) + lift;
    const wave = Math.sin(k * s * L - 2 * Math.PI * f * t + phase) * amp * s * (1 + stall);
    const ds = L / n;
    const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    // the wave displaces sideways (horizontal, across the flow)
    const sideDir = [Math.cos(yaw), 0, -Math.sin(yaw)];
    p = [p[0] + dir[0] * ds, p[1] + dir[1] * ds, p[2] + dir[2] * ds];
    pts.push([p[0] + sideDir[0] * wave, p[1], p[2] + sideDir[2] * wave]);
  }
  return pts;
}

// Nav lights (COLREGs Annex I §9: sector cut-offs fall to nothing within 1–3°; we fade over 2°).
// Sidelights 112.5° from dead ahead to 22.5° abaft the beam; the sternlight the 135° arc aft; the masthead (steaming)
// light the 225° arc forward; the anchor light all round. bearingDeg: the viewer's bearing from the bow, + = starboard.
export function navSector(kind, bearingDeg) {
  const b = ((bearingDeg + 540) % 360) - 180;
  const edge = (x) => smooth(-1, 1, x);                         // 2° fade, centred on the cut-off
  switch (kind) {
    case 'green': return edge(b) * edge(112.5 - b);            // 0 → +112.5 (starboard)
    case 'red': return edge(-b) * edge(112.5 + b);             // −112.5 → 0 (port)
    case 'stern': return edge(Math.abs(b) - 112.5);
    case 'steaming': return edge(112.5 - Math.abs(b));
    default: return 1;
  }
}
// Vertical: full ±5° of level (Annex I §10), then a soft fall to a floor (the lens still glows when seen from above).
export function navVertical(elevDeg) { return 1 - 0.75 * smooth(5, 40, Math.abs(elevDeg)); }

// Rule 20: lights from sunset to sunrise. Sunset is the sun's upper limb at the horizon: centre −0.83°.
export function navLevel(sunElevDeg) { return 1 - smooth(-0.83 - 1.0, -0.83 + 1.5, sunElevDeg); }

// Which lights are lit in each mode (rule 25: a sailing vessel under 20 m shows sidelights + sternlight, or the same as
// a masthead tricolour; under power it adds the steaming light; at anchor, the all-round white only).
export const NAV_MODES = {
  sailing: ['bow', 'stern'],
  tricolour: ['tricolour'],
  motoring: ['bow', 'stern', 'steaming'],
  anchor: ['anchor'],
};

// Shroud telltale spots (yarn tied on the cap shrouds, ≈ 1.8 m over the side deck) and sail telltale spots (u, v on the
// sail): luff telltales on the jib 15 % aft of the luff at three heights, both faces; leech ribbons on the main at the
// battens. a0's sails give the surface: mainPoint(u, v, main, t) / jibPoint(u, v, jib, t) (src/boat/rig.js).
export const SAIL_TELLTALES = [
  ...[0.25, 0.5, 0.75].flatMap((v) => [{ sail: 'jib', u: 0.15, v, face: 1 }, { sail: 'jib', u: 0.15, v, face: -1 }]),
  ...[0.22, 0.44, 0.66, 0.86].map((v) => ({ sail: 'main', u: 0.995, v, face: 0 })),
];

// The flow at a sail telltale: attached flow streams it aft along the chord; a luffing sail (fill → 0) lifts the
// windward yarn; a sail sheeted past its stall separates on the leeward side: the leeward yarn (and the main's leech
// ribbons) stall. `stall` 0..1 is the physics' own (state.mainStall / jibStall, src/boat.js); without it, an angle of
// attack over ≈ 20° (`alphaDeg`). Returns { stall 0..1 (the streamer's wander), reverse 0..1 (the separated flow:
// at ≈ 0.65 the yarn hangs, at 1 it curls back toward the luff) }.
export function sailFlow(face, leeSide, fill, alphaDeg, stall) {
  const windward = face !== 0 && face !== leeSide;
  const luffing = 1 - clamp(fill ?? 1, 0, 1);
  const over = stall != null ? clamp(stall, 0, 1) : alphaDeg == null ? 0 : smooth(18, 28, alphaDeg);
  if (windward) return { stall: smooth(0.05, 0.6, luffing), reverse: 0 };
  const sep = over * (1 - smooth(0.3, 0.9, luffing));   // a luffing sail has no flow to separate
  return { stall: face === 0 ? Math.max(smooth(0.3, 0.9, luffing) * 0.6, 0.35 * sep) : 0.35 * sep, reverse: sep };
}
