// The smoke (stage S1): soft puffs born at each burst, carried by the one wind (the core's WindField,
// sampled by the engine at the show's place), growing and thinning over 45 s. Lit only by the flash bank, so a later
// burst glows inside an earlier one's smoke, the real show's look. Plain JS here; the engine draws them (one draw).
//   puffsFor(burst, { seed, scale, tier }) → [{ born, p0 [x, y, z], r0, grow, seed }]
//   puffAt(puff, t, wind [x, y, z]) → { pos, radius, alpha } or null (not born yet, or gone)
import { rng } from './physics.js';

export const SMOKE = { perBurst: 2, life: 45, rampS: 5, fadeS: 18, alpha: 0.07, rise: 0.25, max: 160, minInches: 4 };   // wow round: lit smoke through the bursts (2 a burst of 4"+, 160 at most; was 1 of 8"+, 48)   // S2: fewer, larger, soft (1 a burst of 8"+, 48 at most)

export function puffsFor(b, { seed = 1, scale = 1, tier = 'desktop', radius = 60 } = {}) {
  const r = rng(seed), n = SMOKE.perBurst, out = [];
  for (let i = 0; i < n; i++) {
    const off = [(r() - 0.5) * 0.7 * radius, (r() - 0.5) * 0.5 * radius, (r() - 0.5) * 0.7 * radius].map((x) => x * scale);
    out.push({ born: b.burst + 0.15 * i, p0: b.pos.map((x, k) => x + off[k]), r0: (0.55 + 0.25 * r()) * radius * scale, grow: (0.7 + 0.4 * r()) * radius * scale, seed: r() });
  }
  return out;
}

export function puffAt(p, t, wind = [0, 0, 0]) {
  const a = t - p.born;
  if (a < 0 || a > SMOKE.life) return null;
  const k = Math.min(1, a / SMOKE.rampS) * Math.min(1, (SMOKE.life - a) / SMOKE.fadeS);
  const radius = p.r0 + p.grow * Math.sqrt(a / SMOKE.life);
  // it thins as it spreads: alpha × (r0 / r)
  const alpha = SMOKE.alpha * k * (p.r0 / radius);
  return { pos: [p.p0[0] + wind[0] * a, p.p0[1] + (wind[1] + SMOKE.rise) * a, p.p0[2] + wind[2] * a], radius, alpha };
}
