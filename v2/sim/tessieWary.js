// Play as Tessie, the lake grows wary (the Tessie RPG, phase 6; behind ?tessierpg=1). Pure: no DOM, no clock, no Math.random.
// Her level sets how the lake reacts to her; being seen never costs anything (no health, no hunters), it only gives up the
// unseen multiplier and earns the fleeing one (v2/sim/tessieBounty.js).
//   levels 1–5    today's rules: a boat sees her at seeM (60 m) while she is shallower than 2.5 m (15 m to 8 m deep, never deeper);
//                 a boat that sees her bears away (the busy lake's evade, v2/living/busyLake.js, reads the threat's seeM)
//   levels 6–12   the lookout: seeM 90 m at the surface; the kayak pairs keep kayakBerthM (100 m) off her water (v2/sim/kayaks.js
//                 berth); the radio's chatter gains two lines (CHATTER, once ever each, only where ?chatter is not 0)
//   levels 13–20  as above; the Halcyon's skipper flees at the first ring (her Lure never turns him curious). The design's "Regatta
//                 rivals round her water wide" is dropped (phase 6b): rivals sail only in races, where she is never played
//   waryOf(level) → the band's row;  chatterLine(her { x, z }, seen(kind) → bool) → { kind, text } | null
export const WARY = Object.freeze([
  Object.freeze({ from: 1, seeM: 60, kayakBerthM: 0, chatter: false, halcyonFlees: false }),
  Object.freeze({ from: 6, seeM: 90, kayakBerthM: 100, chatter: true, halcyonFlees: false }),
  Object.freeze({ from: 13, seeM: 90, kayakBerthM: 100, chatter: true, halcyonFlees: true }),
]);
export function waryOf(level = 1) {
  const L = Number.isFinite(+level) ? +level : 1;
  let row = WARY[0];
  for (const r of WARY) if (L >= r.from) row = r;
  return row;
}
// the two chatter lines (on the skipper's line, once ever each): the one off Fannette (the world's origin) while she is within nearM
// of it, the other anywhere else
export const CHATTER = Object.freeze([
  Object.freeze({ kind: 'tip.tessie.chatter.fannette', text: 'Something big off Fannette, keep east.', at: Object.freeze([0, 0]), nearM: 1500 }),
  Object.freeze({ kind: 'tip.tessie.chatter.lake', text: 'Big swirl out there and no boat in it. Keep clear.' }),
]);
export function chatterLine(her, seen = () => false) {
  if (!her) return null;
  const off = CHATTER[0], near = Math.hypot(her.x - off.at[0], her.z - off.at[1]) <= off.nearM;
  const c = near ? off : CHATTER[1];
  return seen(c.kind) ? null : { kind: c.kind, text: c.text };
}
