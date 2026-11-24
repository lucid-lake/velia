// Storm Run (owner go 2026-11-19 with every default): from the open lake back to the mouth while a squall
// builds from the gun. The page's own storm (v2/sim/storm.js: v1's arc, its outflow on the one wind field, the rain, the lightning on a
// desktop) starts at the gun on an arc timed to the race (STORM_RUN.rate: the front reaches the course about two minutes of real time in
// at the 2 × pace, the squall itself on the last leg), its cell passing over the course (ref: between the mark and the finish). The
// race's gusts are let through the storm's band (the outflow's × 1.45 and its ± 30 % cells), so a reef or an eased main matters: a
// knockdown is the race's 12 s hold, a second one the DNF (knocks.js). A rival in a strong gust may be knocked down too (seeded, at most
// once each). Phones have no storm (features.js storm): the hub hides the race there. Pure (v2/tests/regatta-places-2.test.mjs).
//   stormPlan(course) → { s0, rate, ref } for storm.start (the arc from its first second at the gun)
//   STORM_RUN.band    the race's gust band in this race (geometry.js fairGust's { lo, hi })
//   rivalKnockDue({ id, windMs, seed, done }) → true when this rival's gust knocks her down (once each, by a seeded share)
export const STORM_RUN = Object.freeze({ rate: 0.4, band: Object.freeze({ lo: 0.82, hi: 2.4 }), knockMs: 9.5, knockShare: 0.45 });

const h01 = (a, b) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const idNum = (id) => { let n = 0; for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) | 0; return n; };

export function stormPlan(course, { rate = STORM_RUN.rate } = {}) {
  const m = course?.byId?.[course.markIds?.[0]]?.at ?? course?.line?.centre ?? [0, 0], f = course?.finish?.centre ?? course?.line?.centre ?? m;
  return { s0: 0, rate, ref: [Math.round((m[0] + f[0]) / 2), Math.round((m[1] + f[1]) / 2)] };
}

export function rivalKnockDue({ id, windMs, seed = 1, done = false, K = STORM_RUN } = {}) {
  if (done || !(windMs >= K.knockMs)) return false;
  return h01(seed * 17 + 3, idNum(id)) < K.knockShare;
}
