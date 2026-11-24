// The water the osprey throws in v2 (BACKLOG #24; owner, 2026-11-17: the dive as a hero beat). v1's bird spray
// (src/birds/spray.js: three.js, never ported) on v2's own pieces: the droplets are the kayaks' splash (living/kayaks-splash.js:
// ballistic camera-facing discs, its pipeline and shading under the label 'bird-splash'), the marks on the water are the
// creature map's rings and foam (render/creature-map.js: the compute Tessie writes, into the wake's buffer; one writer at a
// time, wake.creature.writer). From the flight model's events (src/birds/flight.js stepHunt):
//   plunge    the strike: a crown of droplets flung up and out (to ≈ 0.8 m), sheet fragments that live ≈ 0.3 s (the white
//             burst), the spout a beat later (the cavity closing: up to ≈ 1.3 m); on the water an expanding ring, a second
//             one 0.35 s on, and a short-lived foam patch while the bird sits wings-spread
//   lift      the heave off: water pouring off the body and wings, a smaller ring, the patch's last foam
//   wingslap  the wingtips slapping the water on the first strokes: a few drops and a small ring each
//   shake     the shake in the air: droplets flung off, falling back into the lake
// Nothing is stepped, written, dispatched or drawn while nothing flies or spreads (0 ms otherwise). Deterministic: one seeded
// stream, the events in their order. Desktop only (owner, 2026-11-17; src/core/features.js ospreyDive): a phone or a tablet
// never makes it (no pipelines, no buffers, no step).
//   const fx = createBirdWaterFx({ seed });  fx.emit(e); fx.step(dt); fx.sources() → { rings, contacts }; fx.live
//   const S = createBirdSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, wake, seed })
//   S.step(dt, events); S.fill(focalPx); S.runWater(pass, c) (the water-sim pass); S.draw(pass, c) (before the water); S.stats
import { createSplashSim, createKayakSplash } from './kayaks-splash.js';
import { CREATURE, WATER_COMPUTE_WGSL } from '../render/creature-map.js';
import { mulberry32 } from '../../src/sim/core/rng.js';

export const BIRD_SPLASH = Object.freeze({
  density: 1, max: 480,             // droplets: the share of v1's counts, the pool
  minPx: 1.5,                       // px: a droplet's least radius on screen (the burst reads at 90–130 m)
  colour: [0.93, 0.95, 0.96],       // the droplets' white (the kayaks' is a greyer blue: theirs is close)
  rough: 0.85, white: 0.8,          // a broken, scattering spray: its own white, not the sky's blue mirrored
  extent: 32,                       // m: the map's side round the strike (128² with Tessie: 0.25 m; 64² without her: 0.5 m)
  ringLife: 7, slapLife: 3,         // s a ring's waves spread (the foam on it is gone by 2.8 s: the creature map's rule)
  patchR: 0.45, patchS: 2.6,        // m, s: the foam patch where it sits (shrinking away)
});

export function createBirdWaterFx({ seed = 1 } = {}) {
  const T = BIRD_SPLASH;
  const sim = createSplashSim({ seed: (seed | 0) + 7177, max: T.max });
  const r = mulberry32((Math.imul(seed | 0, 131) + 7) >>> 0);
  const R = (a, b) => a + (b - a) * r();
  const N = (k) => Math.max(1, Math.round(k * T.density));
  const later = [], rings = [], patches = [];
  let now = 0, centre = null;
  const stats = { strikes: 0, lifts: 0, slaps: 0, shakes: 0 };
  // a droplet (size: its radius, m), after `delay` s
  const drop = (delay, x, y, z, vx, vy, vz, size, life, water) => { if (delay > 0) later.push({ at: now + delay, a: [x, y, z, vx, vy, vz, size, life, water] }); else sim.spawn(x, y, z, vx, vy, vz, size, life, water); };
  const ring = (x, z, amp, life, delay = 0) => rings.push({ x, z, born: now + delay, amp, life });
  function emit(e) {
    if (e.species !== 'osprey') return;
    const [x, y, z] = e.pos, g = e.gain ?? 1, w = 0;
    switch (e.kind) {
      case 'plunge': {
        stats.strikes++; centre = [x, z];
        // the crown: sheet fragments flung out and up (the white burst), its rim breaking into droplets
        for (let i = 0; i < N(40); i++) { const t = R(0, 6.283), s = R(1.0, 2.2); drop(0, x + Math.cos(t) * 0.3, w + 0.05, z + Math.sin(t) * 0.3, Math.cos(t) * s, R(1.8, 3.2), Math.sin(t) * s, R(0.06, 0.11), R(0.22, 0.36), w); }
        for (let i = 0; i < N(200); i++) { const t = R(0, 6.283), s = R(0.8, 3.0); drop(0, x + Math.cos(t) * R(0.3, 0.45), w + 0.05, z + Math.sin(t) * R(0.3, 0.45), Math.cos(t) * s, R(1.4, 4.0), Math.sin(t) * s, R(0.016, 0.034), 1.6, w); }
        // the spout: a narrow jet a beat later, falling back
        for (let i = 0; i < N(150); i++) { const t = R(0, 6.283), rr = R(0, 0.06), s = R(0, 0.3); drop(R(0.16, 0.34), x + Math.cos(t) * rr, w, z + Math.sin(t) * rr, Math.cos(t) * s, R(2.0, 5.0), Math.sin(t) * s, R(0.014, 0.03), 1.8, w); }
        ring(x, z, 1, BIRD_SPLASH.ringLife); ring(x, z, 0.55, BIRD_SPLASH.ringLife, 0.35);
        patches.push({ x, z, born: now, life: BIRD_SPLASH.patchS + 1.4 });
        break;
      }
      case 'lift': {
        stats.lifts++; centre ??= [x, z];
        const fx = Math.sin(e.yaw ?? 0), fz = Math.cos(e.yaw ?? 0);
        for (let i = 0; i < N(80); i++) { const sd = R(-0.85, 0.85); drop(0, x + fz * sd, Math.max(y, 0) + R(-0.1, 0.25), z - fx * sd, fz * sd * R(0.2, 1.2), R(-0.2, 1.8), -fx * sd * R(0.2, 1.2), R(0.016, 0.032), 1.4, w); }
        for (let i = 0; i < N(10); i++) { const sd = R(-0.7, 0.7); drop(0, x + fz * sd, Math.max(y, 0), z - fx * sd, fz * sd, R(0.6, 1.6), -fx * sd, R(0.05, 0.09), R(0.2, 0.32), w); }
        ring(x, z, 0.6, BIRD_SPLASH.ringLife);
        break;
      }
      case 'wingslap': {
        if (y > 1.2) return;
        stats.slaps++;
        for (let i = 0; i < N(22) * g; i++) { const s = r() < 0.5 ? -1 : 1, rr = R(0.3, 1) * 0.8; drop(0, x + s * rr, Math.max(y - 0.1, 0), z + s * rr * 0.3, s * R(0.2, 1.2), R(-0.8, 1.6), s * R(0.1, 0.5), R(0.014, 0.028), 1.4, w); }
        ring(x, z, 0.35 * g, BIRD_SPLASH.slapLife);
        break;
      }
      case 'shake': {
        stats.shakes++;
        for (let i = 0; i < N(14); i++) { const t = R(0, 6.283), s = R(2, 4); drop(0, x, y, z, Math.cos(t) * s, R(-1, 1.5), Math.sin(t) * s, R(0.012, 0.024), 2.2, w); }
        break;
      }
    }
  }
  function step(dt) {
    if (!(dt > 0) || !self.live) return;
    now += dt;
    for (let i = later.length - 1; i >= 0; i--) if (later[i].at <= now) { sim.spawn(...later[i].a); later.splice(i, 1); }
    sim.update(dt, () => null);
    for (let i = rings.length - 1; i >= 0; i--) if (now - rings[i].born > rings[i].life) rings.splice(i, 1);
    for (let i = patches.length - 1; i >= 0; i--) if (now - patches[i].born > patches[i].life) patches.splice(i, 1);
    if (!rings.length && !patches.length) centre = null;
  }
  // the creature map's sources: rings [x, z, age, amp] (the youngest maxR), the foam patch as a waterline [x, z, radius, 0]
  // (the map's foam band runs 0.25 m inside to 0.9 m outside a radius: shrinking it fades the patch)
  function sources() {
    const R2 = [], C = [];
    for (const g of rings) { const age = now - g.born; if (age >= 0) R2.push([g.x, g.z, age, g.amp]); }
    for (const p of patches) { const age = now - p.born, k = 1 - age / p.life; if (k > 0) C.push([p.x, p.z, BIRD_SPLASH.patchR * k - 0.6 * (1 - k), 0]); }
    return { rings: R2.slice(-CREATURE.maxR), contacts: C.slice(0, CREATURE.maxC) };
  }
  const self = {
    sim, emit, step, sources, stats, rings, patches,
    get centre() { return centre; }, get now() { return now; },
    get marks() { return rings.length > 0 || patches.length > 0; },
    get live() { return sim.count > 0 || later.length > 0 || rings.length > 0 || patches.length > 0; },
    get count() { return sim.count; },
  };
  return self;
}

export function createBirdSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', wake = null, seed = 1 }) {
  const fx = createBirdWaterFx({ seed });
  const T = BIRD_SPLASH;
  const drops = createKayakSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, label: 'bird-splash', max: T.max, minPx: BIRD_SPLASH.minPx, colour: BIRD_SPLASH.colour, rough: BIRD_SPLASH.rough, white: BIRD_SPLASH.white, sim: fx.sim });
  // the rings and the patch: the creature map's compute into the wake's buffer (none when the page has no map)
  const CU_VEC4 = 2 + CREATURE.maxK + CREATURE.maxR + CREATURE.maxC;
  const cu = new Float32Array(CU_VEC4 * 4);
  const size = wake?.sizes?.creature ?? 0;
  let bgC = null, cbuf = null, owned = false;
  if (size) {
    const CP = GPUShaderStage.COMPUTE;
    cbuf = device.createBuffer({ label: 'bird-water', size: cu.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bglC = device.createBindGroupLayout({ label: 'bird-water', entries: [{ binding: 0, visibility: CP, buffer: { type: 'uniform' } }, { binding: 1, visibility: CP, buffer: { type: 'storage' } }] });
    bgC = device.createBindGroup({ layout: bglC, entries: [{ binding: 0, resource: { buffer: cbuf } }, { binding: 1, resource: { buffer: wake.mapsBuffer } }] });
    reg.add('bird-water', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglC] }), compute: { module: reg.shader('bird-water', WATER_COMPUTE_WGSL({ size, offset: wake.creatureOffset })), entryPoint: 'main' } });
  }
  const stats = { drops: 0, rings: 0, owned: false, ms: 0, ...fx.stats };
  const now = () => globalThis.performance?.now?.() ?? 0;
  return {
    fx, stats,
    step(dt, events) {
      if (!events.length && !fx.live) { stats.ms = 0; return; }
      const t0 = now();
      for (const e of events) fx.emit(e);
      fx.step(dt);
      Object.assign(stats, fx.stats); stats.drops = fx.count; stats.rings = fx.rings.length;
      stats.ms = now() - t0;
    },
    fill(focalPx = 1000) {
      const t0 = now();
      drops.fill(focalPx);
      // the map: claimed while the rings spread and Tessie is not in the water; let go after
      const free = wake && (wake.creature.writer == null || wake.creature.writer === 'birds');
      owned = !!(bgC && free && fx.marks && fx.centre);
      if (wake && !owned && wake.creature.writer === 'birds') { wake.creature.on = 0; wake.creature.writer = null; }
      stats.owned = owned;
      if (!owned) { stats.ms += now() - t0; return; }
      const E = BIRD_SPLASH.extent, cell = E / size, c = fx.centre;
      const x0 = Math.round((c[0] - E / 2) / cell) * cell, z0 = Math.round((c[1] - E / 2) / cell) * cell;
      wake.creature.on = 1; wake.creature.writer = 'birds'; wake.creature.x0 = x0; wake.creature.z0 = z0; wake.creature.extent = E;
      const { rings, contacts } = fx.sources();
      cu.fill(0);
      cu.set([x0, z0, E, 0, 0, rings.length, contacts.length, fx.now], 0);
      rings.forEach((e, i) => cu.set(e, 8 + (CREATURE.maxK + i) * 4));
      contacts.forEach((e, i) => cu.set(e, 8 + (CREATURE.maxK + CREATURE.maxR + i) * 4));
      device.queue.writeBuffer(cbuf, 0, cu);
      stats.ms += now() - t0;
    },
    runWater(pass, c) {
      if (!owned) return;
      pass.setBindGroup(0, bgC); pass.setPipeline(reg.get('bird-water'));
      const n = Math.ceil(size / 8); pass.dispatchWorkgroups(n, n); c.dispatches++;
    },
    draw(pass, c) { drops.draw(pass, c); },
  };
}
