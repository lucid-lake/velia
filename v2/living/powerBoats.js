// South Lake's power traffic's plug-in for v2/main.js (living/lakePlugins.js POWER; src/core/features.js powerBoats): the sim
// (v2/living/powerTraffic.js: the runabouts out of the Tahoe Keys, the jet ski off Ski Run), their drawing (v2/render/smallCraft.js:
// one pipeline, an instanced draw per kind and LOD), their engines' sound (living/powerBoats-sound.js: the nearest one), their wakes in
// the vessels' map (handed to the paddle-wheeler's map, which follows the nearest vessel; their own map only when she has none).
// Made only for a start in South Lake (the region's level loaded: ctx.levelKey 'south-lake'); a bay start makes nothing.
//   const PB = createPowerPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier, rows, wake, ownWake })
//   PB.attach({ seed, hour, birth, depthAt, onBump })   PB.post(S, dt, t, { hour, race, others })   PB.fill(eye, { heightAt, race })
//   PB.wakeEmitters(eye) → { emitters, focus, d } | null   PB.draw(pass, c)   PB.runWater(pass, c)   PB.setAudio(audio)   PB.stats()
import { createPowerTraffic, POWER } from './powerTraffic.js';
import { createSmallCraftRender } from '../render/smallCraft.js';
import { createVesselWake, VESSEL } from '../render/vesselWake.js';
import { createPowerSound } from './powerBoats-sound.js';

export const WAKE_M = 900;   // m: their wakes are written while one is this near the eye

export function createPowerPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier = 'full', rows = [], wake = null, ownWake = false, headless = false }) {
  if (!rows.some((r) => r.kind === 'power' || r.kind === 'jetski')) return null;
  const R = createSmallCraftRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier: tier === 'full' ? 'full' : 'lite' });
  const VW = ownWake && tier === 'full' ? createVesselWake({ device, reg, wake, name: 'power-wake' }) : null;
  let T = null, sound = null, simT = 0, active = true, lastEye = [0, 0, 0];
  const self = {
    on: true, render: R, get sim() { return T; },
    attach({ seed = 1, hour = 13, birth = null, depthAt = () => 20, onBump = null } = {}) {
      T = createPowerTraffic({ rows, seed, hour, birth, depthAt, tier, onBump });
      import('../assets/towns/piers.json').then((m) => T.setPiers?.((m.default ?? m).piers ?? [])).catch(() => {});   // the piers kept clear of (the page's own file)
      return self;
    },
    post(S, dt, t, o) { if (T) { simT += dt; T.post(S, dt, t, o); } },
    // the wakes of the boats near the eye: the nearest is the map's focus (render/vesselWake.js), the others inside its box ride along
    wakeEmitters(eye) {
      if (!T || !active || tier !== 'full') return null;
      let f = null, fd = Infinity; for (const b of T.live) { const d = Math.hypot(b.x - eye[0], b.z - eye[2]); if (d < fd) { fd = d; f = b; } }
      if (!f || fd > WAKE_M) return null;
      const box = VESSEL.extent + 40, em = T.emitters((b) => Math.abs(b.x - f.x) < box && Math.abs(b.z - f.z) < box);
      return { emitters: em, focus: { x: f.x, z: f.z, fx: Math.sin(f.heading), fz: -Math.cos(f.heading) }, d: fd };
    },
    fill(eye, { heightAt, race = false, wakeBusy = false } = {}) {
      lastEye = eye; active = !race && self.on;
      if (!T || !active) { R.update([]); if (VW) { if (wakeBusy) VW.pause(); else VW.update(null, null); } return; }
      const live = T.live;
      R.update(live, { eye, heightAt });
      if (VW) { const w = wakeBusy ? null : self.wakeEmitters(eye); if (wakeBusy) VW.pause(); else VW.update(w ? w.emitters : null, w ? w.focus : null, simT); }
      sound?.update(live, eye);
    },
    runWater(pass, c) { if (active) VW?.run(pass, c); },
    draw(pass, c) { if (T && active) R.draw(pass, c); },
    setAudio(audio) { if (!headless && audio) sound = createPowerSound({ audio }); },
    get wakeStats() { return VW?.stats ?? null; },
    stats() { return T ? { tier, live: T.live.length, boats: T.boats.map((b) => ({ id: b.id, x: Math.round(b.x), z: Math.round(b.z), kn: +(b.v / 0.514444).toFixed(1), plane: +b.plane.toFixed(2), live: b.live })), stepUs: +T.stats.stepUs.toFixed(1), evades: T.stats.evades, slows: T.stats.slows, render: { ...R.stats } } : null; },
    get lastEye() { return lastEye; }, K: POWER,
  };
  return self;
}
