// The trees' sway in the wind (owner 2026-11-15: "v1 tree move with wind, V2 does not have this at all"): v1's main bending
// (src/trees.js sway(), Crysis's), ported onto v2's cards. Each tree reads the ONE wind (sim/windTex.js, the water's wind
// texture: the WindField's local wind round the camera, the frame's mean past its edge) at its own root, so a gust patch
// rolling downwind leans the trees it crosses, one stand after the next. v1's numbers:
//   lean   downwind ∝ speed² (1.5 % of the height at 10 m/s at the tip), plus
//   osc    an oscillation ∝ speed (± 1.2 % at 10 m/s) at 1.6 + 0.15 φ rad/s (0.25–0.40 Hz: a conifer's own sway), φ the
//          tree's phase (0 .. 2π, from its seed), so no two neighbours swing together;
//   bend   × h01² × the height: the foot stays put, the trunk curves, the crown's tip moves most.
// Calm air leaves the trees still (0 m/s: no sway at all; 2 m/s: ≈ 7 cm at the top of a 30 m pine). rows: the card's rows
// (render/forest.js draws a strip of them). 2 (the plain quad: the foot still, the tip bent, a straight lean between) costs
// nothing measurable; 4 rows bent the trunk as a curve but cost +0.45 ms at L0 and +0.5 ms at L2 on the M5 (the card's
// vertex stage is heavy), and at a boat's 100+ m the curve does not read. gain: the level's knob (0: off).
// The JS below is the WGSL's reference for the tests.
export const SWAY = Object.freeze({ lean: 0.00015, osc: 0.0012, w0: 1.6, wPhase: 0.15, rows: 2 });

// the offset (m, world x and z) at a point h01 up a tree of `height` m, in the wind (wx, wz) m/s at its root, at time t s
export function swayAt(wx, wz, t, phase, h01, height, gain = 1) {
  const speed = Math.hypot(wx, wz);
  if (speed < 1e-6 || gain <= 0) return [0, 0];
  const lean = speed * speed * SWAY.lean + Math.sin(t * (SWAY.w0 + phase * SWAY.wPhase) + phase) * speed * SWAY.osc;
  const h = Math.max(h01, 0);
  const bend = h * h * height * lean * gain;
  return [wx / speed * bend, wz / speed * bend];
}

// the tree's seed and phase, as the draw's (render/forest.js HASH_WGSL treeSeed, hash01): world-anchored, the same each run
const hashU = (x) => { let h = x >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16; return h >>> 0; };
const hash01 = (x) => (hashU(x) >>> 8) / 16777216;
export const treeSeed = (x, z) => hashU((Math.imul(Math.round(x * 4) | 0, 73856093) ^ Math.imul(Math.round(z * 4) | 0, 19349663)) >>> 0);
export const SWAY_SALT = 0x27d4eb2d;
export const treePhase = (x, z) => hash01((treeSeed(x, z) ^ SWAY_SALT) >>> 0) * 2 * Math.PI;

// needs hash01 (HASH_WGSL). wv: the wind at the root (m/s, x and z)
export const SWAY_WGSL = `
const SWAY_SALT = ${SWAY_SALT >>> 0}u;
fn treeSway(wv: vec2f, t: f32, phase: f32, h01: f32, height: f32, gain: f32) -> vec2f {
  let speed = length(wv);
  if (speed < 1e-6 || gain <= 0.0) { return vec2f(0.0); }
  let lean = speed * speed * ${SWAY.lean} + sin(t * (${SWAY.w0} + phase * ${SWAY.wPhase}) + phase) * speed * ${SWAY.osc};
  let h = max(h01, 0.0);
  return wv / speed * (h * h * height * lean * gain);
}`;
