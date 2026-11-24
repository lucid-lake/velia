// The fireworks' physics (stage S1): plain JS, no three.js, so the tests and the show
// script run in node. The GPU kernel (src/fireworks/engine.js) runs the same step, line for line (starStep).
//
// A star is a small burning pellet thrown out of the shell. Two forces: gravity, and quadratic air drag on its speed
// through the air (the air moves with the wind, so a slow star drifts downwind):
//   a = g + (−k |v − w| (v − w)),   k = 3 ρ_air C_d / (8 ρ_star r)   (a sphere of radius r)
// It leaves at about 100 m/s and slows to its terminal speed √(g / k) (≈ 25–30 m/s) within a second, so a burst opens
// fast, then hangs and droops. It burns for r / (its burn rate): a 1 cm star burns about 2.5 s. Sources: [18]
// [19] [20] (drag shapes the burst; a shell's drag coefficient; star burn times).
//
// The step (semi-implicit; stable at 1/30 s for k |v| up to ≈ 30 / s):
//   rel = v − w;  rel /= 1 + k |rel| dt;  v = rel + w;  v.y −= g dt;  p += v dt
// Scale (S2's labelled exaggeration, 3×): lengths × s, g × s, k / s, wind × s; every time stays real.

export const G = 9.81;                   // m/s²
const AIR_DENSITY = 1.0;          // kg/m³ at the lake (1,897 m)
const DRAG_CD = 1.0;              // a rough cut star, tumbling (a smooth sphere is 0.47)
export const STEP = 1 / 60;              // the fixed step of captures and seeks (s)

// a star's drag constant k (1/m) from its radius (m) and density (kg/m³)
export const dragK = (r, rho = 1700) => (3 * AIR_DENSITY * DRAG_CD) / (8 * rho * r);
// its burn time (s) from its radius (m) and burn rate (m/s of radius)
export const burnTime = (r, rate = 0.004) => r / rate;
// the terminal speed (m/s)
export const terminal = (k, g = G) => Math.sqrt(g / k);
// the launch speed (m/s) that carries a star to `reach` m in `T` s against drag alone: x(t) = ln(1 + k v0 t) / k
export const speedForReach = (reach, k, T) => (Math.exp(k * reach) - 1) / (k * T);

// One step of one star, in place: p, v are [x, y, z] arrays; w the wind [x, y, z]; g the scaled gravity.
export function starStep(p, v, k, dt, w = [0, 0, 0], g = G) {
  let rx = v[0] - w[0], ry = v[1] - w[1], rz = v[2] - w[2];
  const s = Math.hypot(rx, ry, rz), d = 1 / (1 + k * s * dt);
  rx *= d; ry *= d; rz *= d;
  v[0] = rx + w[0]; v[1] = ry + w[1] - g * dt; v[2] = rz + w[2];
  p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
}

// Fly one star from p0 at v0 for T s (fixed steps); returns { p, v, apex: { y, t, p } }.
export function fly(p0, v0, k, T, { dt = STEP, wind = [0, 0, 0], g = G, scale = 1 } = {}) {
  const p = [...p0], v = [...v0], ws = wind.map((x) => x * scale), ks = k / scale, gs = g * scale;
  let apex = { y: p[1], t: 0, p: [...p] };
  const n = Math.round(T / dt);
  for (let i = 1; i <= n; i++) {
    starStep(p, v, ks, dt, ws, gs);
    if (p[1] > apex.y) apex = { y: p[1], t: i * dt, p: [...p] };
  }
  return { p, v, apex };
}

// The comet riser: the shell's launch (a heavy, low-drag body with a burning comet on it). The muzzle speed that tops
// out at `height` m above the mortar, by bisection on the same step; returns { v0, t (s to the apex), apex [x, y, z] }.
export const RISER_K = 0.0026;           // a 6-inch shell (15 cm, 1.6 kg): k = ρ C_d A / 2m ≈ 0.0026 / m; muzzle ≈ 90–170 m/s
// The show scripts ask for the plain riser (no options) a few thousand times over a few hundred whole-metre heights
// (show.js, stage.js fitShow and spreadShow): each answer is kept, so a show costs one bisection per height (v2's phone
// load, 2026-11-15: ≈ 2 s of the boot at 4× CPU went here). The same numbers, frozen (callers only read them).
const plainRisers = new Map();
export function riserFor(height, opts) {
  if (opts !== undefined) return riserOf(height, opts);
  let r = plainRisers.get(height);
  if (!r) { r = riserOf(height); Object.freeze(r.apex); plainRisers.set(height, Object.freeze(r)); }
  return r;
}
function riserOf(height, { k = RISER_K, wind = [0, 0, 0], tiltX = 0, tiltZ = 0, dt = STEP, g = G, scale = 1 } = {}) {
  const shoot = (v0) => {
    const v = [v0 * tiltX, v0, v0 * tiltZ], p = [0, 0, 0], ws = wind.map((x) => x * scale), ks = k / scale, gs = g * scale;
    let t = 0;
    for (let i = 0; i < 4000; i++) {
      starStep(p, v, ks, dt, ws, gs); t += dt;
      if (v[1] <= 0) break;
    }
    return { p, t };
  };
  let lo = 1, hi = 2000 * scale;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (shoot(mid).p[1] < height * scale) lo = mid; else hi = mid; }
  const v0 = (lo + hi) / 2, r = shoot(v0);
  return { v0, t: r.t, apex: r.p };
}

// A seeded random stream (mulberry32): r() in [0, 1). Same seed, same numbers, on any machine.
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// a deterministic 32-bit hash of integers (seeds per event)
export function hash(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) { h = Math.imul(h ^ (x | 0), 0x01000193); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return h >>> 0;
}
