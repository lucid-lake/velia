// Mooring fields (owner, 2026-11-18: "real sailors see props, signs, infrastructure"): the Boat Camp's
// 22 white balls with a blue band on Emerald Bay's north shore, from one data file (v2/sim/moorings.json). Each ball is a light body on
// its own short rode (v2/sim/channelMarks.js createMarkBodies: it bobs, a bump shoves it and it swings back), drawn on the channel
// buoys' pipeline (render/navAids.js 'mooringBall'), and read by the tackle (src/sim/boat/tackle.js: a free ball near the bow is
// picked up; v2's crew reaches further than v1's boathook, MOOR_V2). Pure: no DOM, no GPU.
//   resolveMoorings(data, { waters }) → [{ id, field, number, x, z, shape: 'mooring', face }]
//   MOOR_V2: the tackle's mooring numbers on v2 (pickM, pickMs: the crew's reach and the speed they can pick up at)
//   BALL_USE_M: the anchor key picks up a ball (or says how) when a free one is this near the bow, instead of dropping the anchor
import { MOORING } from '../../src/sim/boat/tackle.js';
import { phaseOf } from './channelMarks.js';

// v1's boathook takes the ball within 3 m of the bow under 0.6 m/s. On v2 the bow is 8 m ahead of the eye and below the cockpit's
// coaming: the crew lean out with a long hook and a pennant, so the ball counts within 6 m of the bow under 0.8 m/s (1.6 kn); the
// pennant is then shortened to its 4 m (the tackle's own ease). Cheat on where, not on motion: she still has to come up slowly.
export const MOOR_V2 = Object.freeze({ ...MOORING, pickM: 6, pickMs: 0.8 });
export const BALL_USE_M = 25;

export function resolveMoorings(data, { waters = 'tahoe-emerald' } = {}) {
  const W = data?.waters?.[waters], out = [];
  for (const f of W?.fields ?? []) {
    (f.balls ?? []).forEach(([x, z], i) => {
      const id = `${f.id}-${i + 1}`;
      out.push({ id, field: f.id, number: i + 1, name: `${f.name} ${i + 1}`, x, z, shape: 'mooring', face: phaseOf(id) * 2 * Math.PI, phase: phaseOf(id) });
    });
  }
  return out;
}
