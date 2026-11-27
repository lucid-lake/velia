// South Lake's power traffic's plug-in for v2/main.js (living/lakePlugins.js POWER; src/core/features.js powerBoats): the sim
// (v2/living/powerTraffic.js: the runabouts out of the Tahoe Keys, the jet ski off Ski Run), their drawing (v2/render/smallCraft.js:
// one pipeline, an instanced draw per kind and LOD), their engines' sound (living/powerBoats-sound.js: the nearest one), their wakes in
// the vessels' map (handed to the paddle-wheeler's map, which follows the nearest vessel; their own map only when she has none).
// The jet ski's rooster tail is the splash system's droplets (living/kayaks-splash.js, its own pipeline 'craft-spray'; not on a phone).
// Made only for a start in South Lake (the region's level loaded: ctx.levelKey 'south-lake'); a bay start makes nothing.
//   const PB = createPowerPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier, rows, wake, ownWake })
//   PB.attach({ seed, hour, birth, depthAt, onBump })   PB.post(S, dt, t, { hour, race, others })   PB.fill(eye, { heightAt, race })
//   PB.wakeEmitters(eye) → { emitters, focus, d } | null   PB.draw(pass, c)   PB.runWater(pass, c)   PB.setAudio(audio)   PB.stats()
import { createPowerTraffic, roosterTail, POWER } from './powerTraffic.js';
import { createKayakSplash } from './kayaks-splash.js';
import { mulberry32 } from '../../src/sim/core/rng.js';
import { createSmallCraftRender } from '../render/smallCraft.js';
import { createVesselWake, VESSEL } from '../render/vesselWake.js';
import { createPowerSound } from './powerBoats-sound.js';

export const WAKE_M = 900;   // m: their wakes are written while one is this near the eye

export function createPowerPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier = 'full', rows = [], wake = null, ownWake = false, headless = false, kayaks = null }) {
  if (!rows.some((r) => r.kind === 'power' || r.kind === 'jetski')) return null;
  const R = createSmallCraftRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier: tier === 'full' ? 'full' : 'lite', kayakRender: kayaks?.render ?? null });   // kayaks: the kayaks' plug-in (its figure for the skippers near)
  const VW = ownWake && tier === 'full' ? createVesselWake({ device, reg, wake, name: 'power-wake' }) : null;
  const SP = tier !== 'phone' ? createKayakSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, label: 'craft-spray', max: 400, colour: [0.9, 0.93, 0.95], rough: 0.3 }) : null;
  const EMPTY = { splash: [], tips: null };
  let rnd = mulberry32(1), lastFocal = 1000;
  let T = null, sound = null, simT = 0, active = true, lastEye = [0, 0, 0];
  const self = {
    on: true, render: R, get sim() { return T; },
    attach({ seed = 1, hour = 13, birth = null, depthAt = () => 20, onBump = null } = {}) {
      T = createPowerTraffic({ rows, seed, hour, birth, depthAt, tier, onBump });
      rnd = mulberry32((Math.imul(seed | 0, 2654435761) + 77) >>> 0);
      import('../assets/towns/piers.json').then((m) => T.setPiers?.((m.default ?? m).piers ?? [])).catch(() => {});   // the piers kept clear of (the page's own file)
      return self;
    },
    post(S, dt, t, o) {
      if (!T) return;
      simT += dt; T.post(S, dt, t, o);
      if (SP && dt > 0) { for (const b of T.boats) if (b.live && b.kind === 'jetski') roosterTail(b, dt, rnd, SP.sim.spawn); SP.step(dt, EMPTY); }   // the rooster tail, then the droplets fly
    },
    // the wakes of the boats near the eye: the nearest is the map's focus (render/vesselWake.js), the others inside its box ride along
    wakeEmitters(eye) {
      if (!T || !active || tier !== 'full') return null;
      let f = null, fd = Infinity; for (const b of T.live) { const d = Math.hypot(b.x - eye[0], b.z - eye[2]); if (d < fd) { fd = d; f = b; } }
      if (!f || fd > WAKE_M) return null;
      const box = VESSEL.extent + 40, em = T.emitters((b) => Math.abs(b.x - f.x) < box && Math.abs(b.z - f.z) < box);
      return { emitters: em, focus: { x: f.x, z: f.z, fx: Math.sin(f.heading), fz: -Math.cos(f.heading) }, d: fd };
    },
    fill(eye, { heightAt, race = false, wakeBusy = false, focal = lastFocal } = {}) {
      lastEye = eye; active = !race && self.on; lastFocal = focal;
      SP?.fill(active ? focal : 0);
      if (!T || !active) { R.update([]); if (VW) { if (wakeBusy) VW.pause(); else VW.update(null, null); } return; }
      const live = T.live;
      R.update(live, { eye, heightAt, focal });
      if (VW) { const w = wakeBusy ? null : self.wakeEmitters(eye); if (wakeBusy) VW.pause(); else VW.update(w ? w.emitters : null, w ? w.focus : null, simT); }
      sound?.update(live, eye);
    },
    runWater(pass, c) { if (active) VW?.run(pass, c); },
    draw(pass, c) { if (T && active) { R.draw(pass, c); SP?.draw(pass, c); } },
    setAudio(audio) { if (!headless && audio) sound = createPowerSound({ audio }); },
    get wakeStats() { return VW?.stats ?? null; },
    stats() { return T ? { tier, live: T.live.length, boats: T.boats.map((b) => ({ id: b.id, x: Math.round(b.x), z: Math.round(b.z), headingDeg: Math.round(b.heading * 180 / Math.PI), kn: +(b.v / 0.514444).toFixed(1), plane: +b.plane.toFixed(2), live: b.live })), stepUs: +T.stats.stepUs.toFixed(1), evades: T.stats.evades, slows: T.stats.slows, render: { ...R.stats }, spray: SP ? { ...SP.stats } : null } : null; },
    get lastEye() { return lastEye; }, K: POWER,
  };
  return self;
}
