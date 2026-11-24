// The wet exhaust's flight (moved from src/boat/exhaust.js, a pure seam: no three, no DOM). The pool of clots on the CPU,
// seeded (no Math.random()), stepped line for line as v1's exhaust always was; src/boat/exhaust.js draws these arrays as
// three sprites, v2/render/exhaust.js as its own instanced quads.
//
//   const sim = createExhaustSim({ count, seed });
//   each frame: sim.update(state, { at: [x, y, z] (the outlet, world), aft, stbd: [x, z] (unit, world) }, dt)
//   sim.pos (xyz per clot), sim.size (m), sim.alpha (0: not in the air)
import { mulberry32 } from '../sim/core/rng.js';

export const EXHAUST = { rate: [80, 240], speed: [1.0, 2.4], life: [0.5, 0.3], size: [0.08, 0.1], cyl: 3 };   // per s; m/s; s; m (a spurt of 6–14 cm clots, seen from 10–20 m)

export function createExhaustSim({ count = 220, seed = 3 } = {}) {
  const rand = mulberry32(seed * 104729 + 7);
  const pos = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count);
  const vel = new Float32Array(count * 3), age = new Float32Array(count).fill(1e9), life = new Float32Array(count).fill(1);
  let next = 0, carry = 0, phase = 0, emitted = 0;

  function update(state, { at, aft, stbd }, dt = 1 / 60) {
    const rpm = state.engineRpm ?? 0, running = state.engineState === 'running' || (state.engineState === 'stopping' && rpm > 300);
    const n = Math.min(1, Math.max(0, (rpm - 700) / 2300));
    // chuffs: the firing rate (rpm / 60 × 3 / 2) gates the flow, a square at half duty
    phase += dt * rpm / 60 * EXHAUST.cyl / 2;
    const gate = (phase % 1) < 0.5 ? 1.6 : 0.4;
    if (running && at) carry += (EXHAUST.rate[0] + (EXHAUST.rate[1] - EXHAUST.rate[0]) * n) * gate * dt;
    while (carry >= 1) {
      carry -= 1;
      const i = next; next = (next + 1) % count; emitted++;
      pos[3 * i] = at[0]; pos[3 * i + 1] = at[1]; pos[3 * i + 2] = at[2];
      const sp = (EXHAUST.speed[0] + (EXHAUST.speed[1] - EXHAUST.speed[0]) * n) * (0.7 + 0.6 * rand()), out = 0.35 + 0.5 * rand();
      // the boat's own motion over the ground carries the spurt with it (sog along cog)
      const bvx = Math.sin(state.cog ?? state.heading) * (state.sog ?? 0), bvz = -Math.cos(state.cog ?? state.heading) * (state.sog ?? 0);
      vel[3 * i] = bvx + aft[0] * sp + stbd[0] * out + (rand() - 0.5) * 0.3;
      vel[3 * i + 1] = 0.3 + 0.6 * rand();
      vel[3 * i + 2] = bvz + aft[1] * sp + stbd[1] * out + (rand() - 0.5) * 0.3;
      age[i] = 0; life[i] = EXHAUST.life[0] + EXHAUST.life[1] * rand();
    }
    for (let i = 0; i < count; i++) {
      age[i] += dt;
      const t = age[i] / life[i];
      if (t >= 1) { alpha[i] = 0; size[i] = 0; continue; }
      vel[3 * i + 1] -= 9.81 * dt;
      for (let k = 0; k < 3; k++) pos[3 * i + k] += vel[3 * i + k] * dt;
      if (pos[3 * i + 1] < -0.03) { age[i] = life[i]; alpha[i] = 0; size[i] = 0; continue; }
      size[i] = EXHAUST.size[0] + EXHAUST.size[1] * t;
      alpha[i] = 0.85 * (1 - t) * Math.min(1, t * 12);
    }
  }
  const stats = () => { let k = 0; for (let i = 0; i < count; i++) if (alpha[i] > 0) k++; return { alive: k, emitted }; };
  return { count, pos, size, alpha, update, stats, get emitted() { return emitted; } };
}
