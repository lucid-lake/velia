// The Tessie RPG's part of Tessie's Deep (phase 6b, ?tessierpg=1): the acts the player's Tessie ranks give the staged Tessie.
// Its own module, loaded with a dynamic import only when the flag is on and the race has her hooked (raceLoop.js fresh), so the
// Regatta's chunk, which a phone loads, carries none of the RPG's code (v2/tests/regatta-no-rpg.test.mjs walks its static imports).
//   actsOf(ranks) → null | [{ kind: 'dash' } | { kind: 'surge', row, waveS, heel, side } | { kind: 'breach', waveS, heel, side }]
//     (heel(d, row) → the wave's heel at d m, deg; side(b, at) → the side it heels the boat to: v2/sim/tessieSurge.js)
//   actsFrom(storage) → actsOf(the bounty save's ranks), read-only (v2/sim/tessieBounty.js readRanks)
import { SURGE, SURGE_RANKS, surgeHeel, awaySide } from '../sim/tessieSurge.js';
import { readRanks } from '../sim/tessieBounty.js';
import { DEACT } from './tessieDeep.js';

export function actsOf(ranks) {
  if (!ranks) return null;
  const out = [];
  if ((ranks.dash ?? 0) >= DEACT.dashRank) out.push({ kind: 'dash' });
  if ((ranks.surge ?? 0) >= 1) out.push({ kind: 'surge', row: SURGE_RANKS[Math.min(4, ranks.surge)], waveS: SURGE.waveS, heel: surgeHeel, side: awaySide });
  if ((ranks.breach ?? 0) >= 1) out.push({ kind: 'breach', waveS: DEACT.waveRiseS, heel: surgeHeel, side: awaySide });
  return out.length ? out : null;
}

export const actsFrom = (storage) => actsOf(readRanks(storage));
