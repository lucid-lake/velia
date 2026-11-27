// Tessie's strike fitted to the boat (presentation only: what counts as a hit is v2/sim/tessieHits.js's, unchanged). Pure: no DOM, no
// GPU, no Math.random, no wall clock. Each kind of boat gets the height her jaw meets (its freeboard, raised or lowered by its heel on
// her side), where on the hull she strikes, how wide her jaw opens (a nudge for the little craft: nobody is hurt), how high her neck
// stands through the strike, and how far the camera eases back to frame her and the whole boat after it.
//   kayak    0.3 m deck: a nudge with the snout on its gunwale, the jaw barely open, her neck low (a splash, never a bite)
//   sup      0.15 m board: never a target (splashed and spooked only); the row is for completeness
//   sail, halcyon, anchored, rival   0.75 m rail: the rail bite; a heeled boat's lee rail is lower, its weather rail higher
//   power    0.8 m sheer (the runabout's rubrail)
//   jetski   0.5 m: a nudge at the hood, the rider ducks
//   glass    1.0 m deck rail (the pontoon's): her neck stands higher to reach it
//   paddle   the 46 m paddle-wheeler: no bite on a rail 1.6 m up; she slams its side at the waterline (a splash against its side)
//   fitOf(kind) → the row (the sailboat's for an unknown kind)
//   railAt(b, side, row) → m: the rail's height on her side (side + her on its starboard), its heel taken in (b.heel rad, + to starboard)
//   frameK(b) → the camera's pull-back share for the boat's size (1 a 8.5 m sailboat; more for a long hull, less for a kayak)
export const FIT = Object.freeze({
  kayak: Object.freeze({ railY: 0.3, sideY: 0.12, sternY: 0.25, inM: 0, sternM: 0.5, endM: 0.45, where: null, gapeK: 0.3, neckK: 0.45, frame: 0.6 }),
  sup: Object.freeze({ railY: 0.15, sideY: 0.08, sternY: 0.15, inM: 0, sternM: 0.5, endM: 0.4, where: null, gapeK: 0.3, neckK: 0.45, frame: 0.6 }),
  sail: Object.freeze({ railY: 0.75, sideY: 0.35, sternY: 0.55, inM: 0.35, sternM: 0.8, endM: 0.6, where: null, gapeK: 1, neckK: 1, frame: 1 }),
  power: Object.freeze({ railY: 0.8, sideY: 0.35, sternY: 0.6, inM: 0.3, sternM: 0.7, endM: 0.6, where: null, gapeK: 1, neckK: 1, frame: 0.9 }),
  jetski: Object.freeze({ railY: 0.5, sideY: 0.25, sternY: 0.4, inM: 0.15, sternM: 0.5, endM: 0.4, where: null, gapeK: 0.4, neckK: 0.6, frame: 0.7 }),
  glass: Object.freeze({ railY: 1.0, sideY: 0.4, sternY: 0.8, inM: 0.35, sternM: 0.9, endM: 0.8, where: null, gapeK: 1, neckK: 1, frame: 1.2 }),
  paddle: Object.freeze({ railY: 1.6, sideY: 0.45, sternY: 1.2, inM: 0.4, sternM: 1.5, endM: 4, where: 'side', gapeK: 0.6, neckK: 0.8, frame: 2.2 }),
});
const ALIAS = Object.freeze({ halcyon: FIT.sail, anchored: FIT.sail, rival: FIT.sail, still: FIT.sail });   // the keelboats share the sailboat's row
export const fitOf = (kind) => FIT[kind] ?? ALIAS[kind] ?? FIT.sail;
// the rail on her side: the freeboard, lower on the side the boat heels to (half the beam × sin heel), never under 0.1 m
export function railAt(b, side = 1, row = fitOf(b?.kind)) {
  const h = Number.isFinite(b?.heel) ? b.heel : 0, half = (b?.B ?? 3) / 2;
  return Math.max(0.1, row.railY - side * half * Math.sin(h));
}
// the camera's pull-back share: the row's, grown with a hull longer than the sailboat's (so the paddle-wheeler's whole length fits)
export function frameK(b) {
  const row = fitOf(b?.kind), L = b?.L ?? 8.5;
  return Math.max(row.frame, Math.min(2.5, row.frame * Math.sqrt(Math.max(0.2, L / 8.5))));
}
