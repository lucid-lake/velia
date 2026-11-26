// Play as Tessie, the Lure (the Tessie RPG, phase 3; behind ?tessierpg=1). Pure: no DOM, no clock, no Math.random.
// Her tail flicks the surface and her sound pretends to be a school of fish: the boats within the rank's range that have NOT seen her
// get curious (the busy lake's `curious` threat kind, the opposite sign of its evade): they turn toward the ring and slow for the
// rank's curious time. The kayakers and the glass boat turn too (the tourists); a boat that saw her within LURE.seenS ignores it, and
// one that sees her while curious forgets the lure (her threat's evade wins). Rank 4 also lures the Halcyon's skipper.
//   lureTargets(her { x, z }, list [{ id, kind, x, z }], { rangeM, seen(id) → bool, halcyon }) → the ids lured, nearest first
//   curiousHeading(s { x, z, heading }, at { x, z }, windFrom, noGoDeg) → the heading toward the point, never inside the no-go cone
//   lureSplashes(x, z, n) → n points (seeded by index: the golden angle) for the small splashes round her, within LURE.splashM
import { CURIOUS, curiousHeading } from './curious.js';
export { curiousHeading };
export const LURE = Object.freeze({
  seenS: 45,          // s: a boat that saw her this recently ignores the lure (the RPG's seen window)
  ringM: 30,          // m: the ring of small splashes on the water (the in-world ring's radius)
  ringGrowS: 1.5, ringS: 4,   // s: the ring runs out to ringM over ringGrowS and fades by ringS
  splashM: 9,         // m: the small splashes lie within this of her (a school's shimmer)
  splashes: 6,        // the creature-map rings over the cast (LURE_CAST_S)
  ...CURIOUS,         // arriveM, kayakArriveM, slowM, easeDeg, noGoDeg (sim/curious.js)
  kinds: Object.freeze(['sail', 'glass', 'kayak', 'halcyon']),   // what turns (the paddleboards and South Lake's traffic: not yet)
});

export function lureTargets(her, list = [], { rangeM = 120, seen = () => false, halcyon = false } = {}) {
  if (!her) return [];
  const out = [];
  for (const b of list) {
    if (!LURE.kinds.includes(b.kind) || (b.kind === 'halcyon' && !halcyon)) continue;
    const d = Math.hypot(b.x - her.x, b.z - her.z);
    if (!(d <= rangeM) || seen(b.id)) continue;
    out.push({ id: b.id, kind: b.kind, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}


export function lureSplashes(x, z, n = LURE.splashes, out = []) {
  out.length = 0;
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const r = LURE.splashM * Math.sqrt((i + 0.5) / n), a = i * GA; out.push([x + Math.sin(a) * r, z - Math.cos(a) * r]); }
  return out;
}
