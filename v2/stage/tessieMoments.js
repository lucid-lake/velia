// Tessie M3, which kind of appearance the stage gives her (owner, 2026-11-18: rare moments staged so
// players can reach them; "the stage director cheats on when and where, never on motion"). Pure: no DOM, no GPU, no
// Math.random, no wall clock (the seed and the sighting's count).
//   the sunset breach   near sunset (19:00–20:45 on the highlight day; the sun sets about 20:30), her first appearance near her
//                       water is a breach (once a session)
//   the lightning neck  in a storm near her water, her first appearance is staged across a flash: the act waits until a strike
//                       is due NECK.leadS s ahead (cheat on when), she rises in view and her neck is up when it comes (once a session)
//   later sightings     the scripted sighting, swimming alongside or the dive under the hull, by the seed (the opening is always the
//                       scripted sighting: the first look at her)
//   pickMoment({ force, hour, storm, near, n, done, seed }) → 'sighting' | 'breach' | 'neck' | 'alongside' | 'under'
//     force: the ?tessiem= flag's kind (or null); storm: a storm runs; near: the boat by her water; n: her sightings so far;
//     done: { breach, neck } (this session's)
//   neckReady(nextIn) → the strike due nextIn s from now fits the neck's timing (her rise, the neck up across it)
export const MOMENTS = Object.freeze({
  sunset: [19.0, 20.75],   // h, local (src/day.js: the highlight day 2026-07-04, sunset about 20:30)
  later: [['sighting', 2], ['alongside', 2], ['under', 2]],
  kinds: ['sighting', 'breach', 'neck', 'alongside', 'under'],
});
export const NECK = Object.freeze({ leadS: [10, 16], waitS: 60 });   // s from the cue to the flash; the act's longest wait for one

function hash01(seed, k) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 0x3c6ef372, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// the flag's kind ('lightning' is the neck's name in a link)
export function momentFlag(v) {
  if (v == null || v === '' || v === true) return null;
  const k = String(v).toLowerCase();
  if (k === 'lightning') return 'neck';
  return MOMENTS.kinds.includes(k) ? k : null;
}
export function pickMoment({ force = null, hour = 12, storm = false, near = false, n = 0, done = {}, seed = 1 } = {}) {
  if (force && MOMENTS.kinds.includes(force)) return force;
  if (near && storm && !done.neck) return 'neck';
  if (near && hour >= MOMENTS.sunset[0] && hour <= MOMENTS.sunset[1] && !done.breach) return 'breach';
  if (n === 0) return 'sighting';
  const rows = MOMENTS.later, sum = rows.reduce((s, r) => s + r[1], 0);
  let r = hash01(seed, 700 + n) * sum;
  for (const [k, w] of rows) { r -= w; if (r <= 0) return k; }
  return rows[rows.length - 1][0];
}
export const neckReady = (nextIn) => Number.isFinite(nextIn) && nextIn >= NECK.leadS[0] && nextIn <= NECK.leadS[1];
// the night wake glow's share (0–1): from the sun 2° under the horizon to 7° under it, eased; `force` (?tessiem=glow) at any hour
export function glowShare(sunY, force = false) {
  if (force) return 1;
  const k = Math.min(1, Math.max(0, (-0.035 - (sunY ?? 1)) / 0.087));
  return k * k * (3 - 2 * k);
}
