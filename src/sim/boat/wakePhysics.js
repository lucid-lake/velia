// The wake's physics (split from src/boat/wake.js for the shared sim; Sprint 0): the deep-water Kelvin laws
// and the point-impulse sum the wake shader mirrors, as plain functions (the tests check them; a CPU reads them). The
// maps the water samples (the Kelvin map, the foam map) stay in src/boat/wake.js. Sources: its header.
import { DEFAULT_DIMS } from './dims.js';

export const G = 9.81;
export const KELVIN_DEG = 19.47;                       // the Kelvin wedge half-angle: deep water, any speed
export const TRAIL_DT = 0.25, TRAIL_N = 96;            // an impulse every 0.25 s, 24 s kept (36 m at 3 m/s: the
                                                       // transverse energy travels at U/2, so that is the wake to ≈ 5 L)

// --- the physics the shader mirrors (plain functions, for tests and the CPU) ---------------------------------
// the transverse wave's length behind a hull at speed U (m/s): λ = 2πU²/g
export const transverseWavelength = (U) => 2 * Math.PI * U * U / G;
// the two wave directions θ (rad, from the track) that reach a point at angle ψ from the track: tan ψ = tan θ / (1 + 2 tan² θ)
// (the stationary-phase condition); null outside the wedge. transverse: the small θ; divergent: the large one
export function kelvinDirections(psiRad) {
  const m = Math.abs(Math.tan(psiRad)), disc = 1 - 8 * m * m;
  if (disc < 0) return null;
  if (m < 1e-9) return { transverse: 0, divergent: Math.PI / 2 };
  return { transverse: Math.atan((1 - Math.sqrt(disc)) / (4 * m)), divergent: Math.atan((1 + Math.sqrt(disc)) / (4 * m)) };
}
// the point impulse's local wavenumber and phase at distance r after τ (deep water): k = gτ²/4r², φ = gτ²/4r
export const impulseK = (r, tau) => G * tau * tau / (4 * r * r);
export const impulsePhase = (r, tau) => G * tau * tau / (4 * r);
// what the shader sums: a straight track at speed U, evaluated on the CPU (the tests check it against the Kelvin laws)
export function wakeHeightCPU(ax, az, { U = 3, L = DEFAULT_DIMS.HULL.lwl, rc = 0.8, r0 = 0.6, amp = 1, n = TRAIL_N, dt = TRAIL_DT, bow = true } = {}) {
  // the boat at the origin heading −z, its track behind it (+z); impulses at τ = i·dt sit at z = U·τ
  let h = 0;
  for (let i = 1; i <= n; i++) {
    const tau = i * dt;
    for (const [sgn, off] of bow ? [[1, -L], [-1, 0]] : [[-1, 0]]) {
      const dx = ax, dz = az - (U * tau + off);
      const r2 = dx * dx + dz * dz + r0 * r0, r = Math.sqrt(r2), k = G * tau * tau / (4 * r2);
      h += sgn * amp * (tau / r2) * Math.exp(-k * rc) * dt * Math.cos(k * r);
    }
  }
  return h;
}
