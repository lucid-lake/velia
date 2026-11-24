// One seeded generator (refactor round 2, Phase D): mulberry32, 0 ≤ x < 1, the same sequence for the same seed. The copies
// it replaced were this exact code; the other variants (a seed of 0 read as 1, src/props/paddler/look.js and motion.js,
// src/harbour-layout.js; src/boatAudio.js's exported rng) keep their own.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
