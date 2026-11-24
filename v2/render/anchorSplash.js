// The water the anchor throws (the anchor seen, owner 2026-11-17): the kayaks' droplets (living/kayaks-splash.js: ballistic
// camera-facing discs, its pipeline and shading) under the label 'anchor-splash', from the seamanship's events (v2/sim/seamanship.js
// sea.drain()):
//   splash   the anchor meeting the water at the bow: a crown of droplets flung up and out (to about 0.5 m), a few white sheet
//            fragments that live 0.3 s, and a small spout a beat later as the hole closes
//   break    the anchor breaking the surface on the way up: a few drops, then drips off it (it hangs at the bow, rising to the
//            roller) for dripS
// All devices (the anchor is seamanship). Nothing is stepped, written or drawn while nothing flies (0 ms otherwise); a burst is
// at most ANCHOR_SPLASH.max droplets (≈ 0.05 ms of CPU on a phone, measured as stats.ms). Deterministic: one seeded stream.
//   const fx = createAnchorWaterFx({ seed });   fx.emit(e); fx.step(dt, anchorAt); fx.live; fx.count
//   const S = createAnchorSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, seed })
//   S.step(dt, events, anchorAt); S.fill(focalPx); S.draw(pass, c) (opaque, before the water); S.stats
import { createSplashSim, createKayakSplash } from '../living/kayaks-splash.js';
import { mulberry32 } from '../../src/sim/core/rng.js';

export const ANCHOR_SPLASH = Object.freeze({
  max: 140,                         // droplets in the air at once
  minPx: 1.3,                       // px: a droplet's least radius on screen (the burst reads from the Boat view's 15–20 m)
  colour: [0.9, 0.93, 0.95],        // a churned white, between the kayaks' grey-blue and the osprey's white
  rough: 0.5, white: 0.55,
  dripS: 3.0, dripEvery: 0.04,      // s of drips off the anchor after it breaks out, one every this
});

export function createAnchorWaterFx({ seed = 1 } = {}) {
  const T = ANCHOR_SPLASH;
  const sim = createSplashSim({ seed: (seed | 0) + 9113, max: T.max });
  const r = mulberry32((Math.imul(seed | 0, 151) + 17) >>> 0);
  const R = (a, b) => a + (b - a) * r();
  const later = [];
  let now = 0, drip = null;
  const stats = { splashes: 0, breaks: 0 };
  const drop = (delay, x, y, z, vx, vy, vz, size, life) => { if (delay > 0) later.push({ at: now + delay, a: [x, y, z, vx, vy, vz, size, life, 0] }); else sim.spawn(x, y, z, vx, vy, vz, size, life, 0); };
  function emit(e) {
    const [x, , z] = e.at;
    if (e.kind === 'splash') {
      stats.splashes++;
      for (let i = 0; i < 12; i++) { const t = R(0, 6.283), s = R(0.5, 1.2); drop(0, x + Math.cos(t) * 0.12, 0.04, z + Math.sin(t) * 0.12, Math.cos(t) * s, R(1.2, 2.2), Math.sin(t) * s, R(0.035, 0.06), R(0.22, 0.34)); }   // the white sheet
      for (let i = 0; i < 64; i++) { const t = R(0, 6.283), s = R(0.4, 1.6); drop(0, x + Math.cos(t) * R(0.1, 0.2), 0.04, z + Math.sin(t) * R(0.1, 0.2), Math.cos(t) * s, R(1.0, 3.0), Math.sin(t) * s, R(0.01, 0.024), 1.4); }   // the crown
      for (let i = 0; i < 24; i++) { const t = R(0, 6.283), rr = R(0, 0.04), s = R(0, 0.2); drop(R(0.12, 0.26), x + Math.cos(t) * rr, 0.02, z + Math.sin(t) * rr, Math.cos(t) * s, R(1.4, 3.2), Math.sin(t) * s, R(0.01, 0.022), 1.4); }   // the spout
    } else if (e.kind === 'break') {
      stats.breaks++;
      for (let i = 0; i < 30; i++) { const t = R(0, 6.283), s = R(0.1, 0.6); drop(0, x + Math.cos(t) * 0.1, 0.03, z + Math.sin(t) * 0.1, Math.cos(t) * s, R(0.3, 1.1), Math.sin(t) * s, R(0.01, 0.02), 1.2); }
      drip = { left: T.dripS, acc: 0 };
    }
  }
  // at: the anchor's crown in the world now (sea.anchorAt): the drips fall from it
  function step(dt, at = null) {
    if (!(dt > 0) || !self.live) return;
    now += dt;
    for (let i = later.length - 1; i >= 0; i--) if (later[i].at <= now) { sim.spawn(...later[i].a); later.splice(i, 1); }
    if (drip) {
      drip.left -= dt; drip.acc += dt;
      while (drip.acc >= T.dripEvery) { drip.acc -= T.dripEvery; if (at && at[1] > 0.05) sim.spawn(at[0] + R(-0.12, 0.12), at[1] - 0.05, at[2] + R(-0.12, 0.12), R(-0.05, 0.05), R(-0.3, 0), R(-0.05, 0.05), R(0.008, 0.014), 1.6, 0); else r(); }
      if (drip.left <= 0) drip = null;
    }
    sim.update(dt, () => null);
  }
  const self = {
    sim, emit, step, stats,
    get live() { return sim.count > 0 || later.length > 0 || !!drip; },
    get count() { return sim.count; }, get dripping() { return !!drip; },
  };
  return self;
}

export function createAnchorSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', seed = 1 }) {
  const fx = createAnchorWaterFx({ seed });
  const T = ANCHOR_SPLASH;
  const drops = createKayakSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, label: 'anchor-splash', max: T.max, minPx: T.minPx, colour: T.colour, rough: T.rough, white: T.white, sim: fx.sim });
  const stats = { drops: 0, ms: 0, msMax: 0, liveFrames: 0, liveMs: 0, ...fx.stats };   // liveMs / liveFrames: the mean cost a frame while it flies
  const now = () => globalThis.performance?.now?.() ?? 0;
  let drawn = 0;
  return {
    fx, stats,
    step(dt, events, at) {
      if (!events?.length && !fx.live) { stats.ms = 0; return; }
      const t0 = now();
      for (const e of events ?? []) if (e.kind === 'splash' || e.kind === 'break') fx.emit(e);
      fx.step(dt, at);
      Object.assign(stats, fx.stats); stats.drops = fx.count;
      stats.ms = now() - t0;
    },
    fill(focalPx = 1000) {
      if (!fx.count && !drawn) return;
      const t0 = now();
      drops.fill(focalPx); drawn = fx.count;
      stats.ms += now() - t0; stats.msMax = Math.max(stats.msMax, stats.ms); stats.liveFrames++; stats.liveMs += stats.ms;
    },
    draw(pass, c) { if (drawn) drops.draw(pass, c); },
  };
}
