// A seed per visit for the music's order (fix/regressions, 2026-10-30; owner: "I always hear the same music and get bored").
// Captures, goldens and tests stay deterministic: ?seed=, ?headless and ?golden= use the URL's seed (1 by default).
// Any other visit draws a fresh 32-bit seed (crypto, not Math.random: the scene itself stays seeded).
//   const seed = visitSeed(flags);            // { rand } may be passed by a test
export function visitSeed(flags, { rand = null } = {}) {
  const urlSeed = parseInt(flags.seed ?? '1', 10) || 1;
  if (flags.seed != null || flags.headless != null || flags.golden) return urlSeed;
  if (rand) return rand() >>> 0;
  try { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return urlSeed; }
}
