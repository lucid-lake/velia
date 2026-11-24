// The showcase list (owner, 2026-11-17: "We present the kayaks, Tessie and the birds like a
// stage at the opening … We will keep adding showcases to the opening list"). One row per act; adding a showcase is one row
// (and its act module). The director (v2/stage/director.js) reads only these fields:
//   id         the act's name (?stage=<id> pins it)
//   feature    a row of src/core/features.js: the act is skipped where it is off (null: everywhere)
//   opening    { order, atS, leadS?, jitterS?, gapAfterS? } or null: its place in the opening round. atS: the s of play the
//              player sees it (the humps break, the strike); leadS: s before that it must start; jitterS: ± s, seeded;
//              gapAfterS: plain sailing after it before the next act (the director's 30 s when absent)
//   random     { weight, cooldownS } or null: its share of the random pool and the s after it ends before it may come again
//   nearby     { area, withinM, weight?, cooldownS?, gapS?, repeat? } or absent: while the boat is in that area (or within withinM
//              of its edge) these replace the random row's; gapS replaces the pool's gap; repeat lifts "never twice in a row"
//   where      where it plays: 'inView' (25–40° off the bow in the camera's view) or an area row's id (v2/stage/areas.js)
//   durationS  [min, max] s on stage (the director stops an act still on stage at max + 60)
//   budget     { deskMs, phoneMs }: its GPU + CPU while on stage, 0 otherwise (one act at a time: never stacked)
//   load       () → a Promise: its code and assets, preloaded by the director in the gap before it (null: nothing to load)
//   start      (ctx) → { done: Promise, stop(), step?(dt) } | null (null: it cannot play now; the director moves on)
// Each act's motion stays in its own module (living/, sim/); the act modules are thin adapters ("cheat on where and when,
// never on motion").
import * as kayaks from './act-kayaks.js';
import * as tessie from './act-tessie.js';
import * as ospreyDive from './act-osprey.js';

export const ACTS = [
  // the kayaks: no pair staged at the opening (owner, 2026-11-18: "If the lake is truly busy, we don't need to stage the kayaks at the
  // opening (0 s)"; it replaces 2026-11-17's "no change to the kayaks at the opening"): a live page lays no first pair; a random act
  // lays a pair in view later, after the pool's gap and the act's cooldown (the glass boat's clear kayaks and the busy lake are
  // on the water from the start: v2/sim/tourBoat.js)
  { id: 'kayaks', feature: 'stagedKayaks', opening: null, random: { weight: 2, cooldownS: 240 },   // owner 2026-11-19: retired where the regions' kayakers live (src/core/features.js stagedKayaks: a phone keeps it)
    where: 'inView', durationS: [40, 60], budget: { deskMs: 0.2, phoneMs: 0.15 }, load: () => import('../living/kayaks.js'), start: kayaks.start },
  // Tessie: the humps break about 25 s into play (owner); her sighting starts 4 s before (the rise, TESSIE.lead). Where: her
  // water when the boat is near it (the sim's placement), else in view. How often (owner: "she most likely
  // stays in an area so the player can go and explore it"): near her water every 60–120 s, she may come back to back; elsewhere
  // rarer (a 4 min cooldown on top of the pool's gap)
  { id: 'tessie', feature: 'tessie', opening: { order: 1, atS: 25, leadS: 4, jitterS: 1.5 }, random: { weight: 3, cooldownS: 240 },
    nearby: { area: 'tessieWaters', withinM: 300, weight: 9, cooldownS: 60, gapS: [60, 120], repeat: true },
    where: 'tessieWaters', durationS: [30, 40], budget: { deskMs: 0.3, phoneMs: 0 }, load: () => import('../living/tessie.js'), start: tessie.start },
  // the osprey's dive: the strike about 95 s into play; the cue 12 s before it (the approach, the hover, the stoop)
  { id: 'ospreyDive', feature: 'ospreyDive', opening: { order: 2, atS: 95, leadS: 12, jitterS: 3 }, random: { weight: 3, cooldownS: 120 },
    where: 'inView', durationS: [15, 20], budget: { deskMs: 0.05, phoneMs: 0.05 }, load: null, start: ospreyDive.start },
  // later: the Dixie, a jet ski, the channel markers' bell, a wreck seen through the water …
];

export const actById = (id, acts = ACTS) => acts.find((a) => a.id === id) ?? null;
