// The cockpit's fitting points from the Blender build (models/boat/cockpit.json, blender/m3_cockpit.py), for the lines
// (lines.js) and the page (cockpitLook.js). Plain JS, no three.js: the node tests import it.
//   COCKPIT.winch(side)          a primary winch's drum (HULL frame), side +1 starboard
//   COCKPIT.halyardWinch(side), .clutches(side), .organiser(side), .mastBlocks(side)
//   trackY(x)                    the traveller track's top under the car at x (HULL frame y; the crown)
//   toRig(p, HULL)               HULL frame → RIG frame (dims.js; this page's boat's HULL by default)
import INFO from '../../models/boat/cockpit.json' with { type: 'json' };
import { DEFAULT_DIMS } from '../sim/boat/dims.js';

const P = INFO.points_hull_frame ?? {};
const S = (side) => (side > 0 ? 'S' : 'P');
export const toRig = (p, HULL = DEFAULT_DIMS.HULL) => [p[0], p[1] - HULL.mastStepY, p[2] - HULL.mastStepZ];

const TRACK = INFO.traveller_track_hull ?? null;
export function trackY(x) {
  if (!TRACK) return null;
  if (x <= TRACK[0][0]) return TRACK[0][1];
  for (let i = 0; i + 1 < TRACK.length; i++) {
    const [x0, y0] = TRACK[i], [x1, y1] = TRACK[i + 1];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return TRACK[TRACK.length - 1][1];
}

export const COCKPIT = {
  traveller: INFO.traveller_hull_frame ?? [0, 1.593, 0.70],
  winch: (side) => P[`winch_primary_${S(side)}`] ?? [side * 1.33, 1.30, 2.65],
  halyardWinch: (side) => P[`winch_halyard_${S(side)}`] ?? [side * 0.55, 1.44, 1.22],
  clutches: (side) => P[`clutches_${S(side)}`] ?? [0, 1, 2].map((k) => [side * (0.43 + 0.06 * k), 1.42, 0.92]),
  organiser: (side) => P[`organiser_${S(side)}`] ?? [0, 1, 2].map((k) => [side * (0.43 + 0.06 * k), 1.40, -0.10]),
  mastBlocks: (side) => P[`mastblocks_${S(side)}`] ?? [0, 1, 2].map((k) => [side * (0.08 + 0.045 * k), 1.48, -0.6]),
  points: P,
};
