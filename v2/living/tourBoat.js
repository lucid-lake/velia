// The glass boat's plug-in for v2/main.js (src/core/features.js glassBoat: a desktop or a tablet, the GPU level picks
// full or lite; a phone never makes it): "Velia Travel" and her clear kayaks (v2/sim/tourBoat.js) drawn by v2/render/tourBoat.js, her
// outboards' sound (living/tourBoat-sound.js). The paddlers' clips come from the kayaks' own asset (living/kayaks.js loadAsset), after
// the first frame (a capture: before it); until then they paddle on v1's hull model alone and are not drawn.
//   const TB = createTourBoatPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, kayaks, P, tier })
//                                      before reg.buildAll() (its two pipelines in the caller's group)
//   TB.attach({ B, water, terrain, windField, clock, onBump })   once the boat exists: the sim on the clock's hour (her timetable)
//   TB.post(S, dt, t)                  the boat's tick (sea.addPost)
//   await TB.prime()                   a capture: the paddlers' asset in
//   TB.fill(eye, focalPx, sunElevDeg, race, sun)   once a frame: the records (nothing in a race; sun: the sun's unit direction)
//   TB.drawSolid(pass, c)  TB.drawClear(pass, c)  TB.lights(out, o, opts)  TB.setAudio(audio)  TB.stats()
import { createTourBoat, birthPhase } from '../sim/tourBoat.js';
import { createTourBoatRender } from '../render/tourBoat.js';
import { createTourSound } from './tourBoat-sound.js';
import { createVesselWake } from '../render/vesselWake.js';

const WAKE_M = 1500;   // m: her wake's map is written while she is this near the eye

export function createTourBoatPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, kayaks = null, P, flags = {}, tier = 'full', errors = [], wake = null, mirrors = false, mirrorKayaks = false }) {
  // her wake on the water (the full tier: the vessels' map in the player's wake buffer, render/vesselWake.js); lite keeps the foam discs
  const VW = tier === 'full' ? createVesselWake({ device, reg, wake }) : null;
  const R = createTourBoatRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, kayakRender: kayaks?.render ?? null, mirrors, mirrorKayaks });
  let T = null, water = null, terrain = null, windField = null, clips = null, asking = null, sound = null, lastEye = [0, 0, 0], simT = 0;
  const lite = tier === 'lite';
  const ask = () => {
    if (asking || !kayaks?.loadAsset) return asking;
    asking = kayaks.loadAsset().then((c) => { clips = c; T?.setClips(c); return c; }).catch((e) => { errors.push(`glassBoat: ${e?.message ?? e}`); return null; });
    return asking;
  };
  const self = {
    on: true,   // the harness's A/B (hook.tour.on)
    get sim() { return T; }, render: R,
    // birth: the first birth of this page load ({ x, z }: a birthplace) places her on her loop to be seen within a minute (sim/tourBoat.js
    // birthPhase); null (a URL pose, a race, Cruise): the clock's phase. A later move never re-places her
    attach({ B, water: w, terrain: tr, windField: wf, clock, onBump = null, birth = null }) {
      water = w; terrain = tr; windField = wf;
      const depthAt = (x, z) => -terrain.field.height(x, z);
      // lite (a weak GPU): the empty kayaks only; full: two empty, three with paddlers
      const los = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); for (let d = 20; d < L - 20; d += 20) if (!(depthAt(x0 + (x1 - x0) * d / L, z0 + (z1 - z0) * d / L) > 0.3)) return false; return true; };
      const tauS = flags.tourt != null && Number.isFinite(parseFloat(flags.tourt)) ? parseFloat(flags.tourt) : birth ? birthPhase(birth, { seed: P.seed, los }) : null;   // ?tourt=: a pinned second of her timetable
      T = createTourBoat({ depthAt, onBump, hour: clock.hour, seed: P.seed, tauS, clips, kayaks: lite ? 2 : 5 });
      return self;
    },
    post(S, dt, t) { simT = t; if (T) T.post(S, dt, t, (x, z) => windField.dirAt(x, z, t)); },
    async prime() { await ask(); },
    fill(eye, focalPx, sunElevDeg, race = false, sun = [0, 1, 0]) {
      if (!T) return;
      T.active = !race;
      lastEye = eye;
      if (!clips && !P.headless) ask();   // a live page: the paddlers' asset after the first frame
      // the wake map follows her while she is within WAKE_M of the eye (the water reads it only there)
      const near = T.active && self.on && self.wakeOn && Math.hypot(T.boat.x - eye[0], T.boat.z - eye[2]) < WAKE_M;
      if (VW) VW.update(near ? T.emitters() : null, { x: T.boat.x, z: T.boat.z, fx: Math.sin(T.boat.heading), fz: -Math.cos(T.boat.heading) }, simT);
      R.update(T, { mapWake: !!VW, eye, heightAt: (x, z) => water.heightAt(x, z), sunElevDeg, sun, depthAt: (x, z) => -terrain.field.height(x, z), focalPx, clips, lite, on: self.on });
      sound?.update(T, eye);
    },
    wakeOn: true,   // the cost's A/B (tools/v2-glass-boat-shots.mjs cost): her wake map alone off
    runWater(pass, c) { VW?.run(pass, c); },   // the water-sim pass, after the wake's maps
    get wakeStats() { return VW?.stats ?? null; },
    set wakeRepeat(n) { if (VW) VW.repeat = Math.max(1, n | 0); },
    drawSolid(pass, c, figures = true) { if (T && self.on) R.drawSolid(pass, c, { figures }); },
    drawClear(pass, c) { if (T && self.on) R.drawClear(pass, c); },
    drawMirror(pass, c) { if (T && self.on) R.drawMirror(pass, c); },   // her mirror in the water (after the water)
    lights(out, o, opts) { return T && self.on ? T.lights(out, o, { ...opts, eye: lastEye }) : 0; },
    setAudio(audio) { if (!P.headless && audio) sound = createTourSound({ audio }); },
    stats() { return T ? { wake: VW?.stats ?? null, mode: T.boat.mode, stop: T.boat.stop, x: Math.round(T.boat.x), z: Math.round(T.boat.z), v: +T.boat.v.toFixed(2), yielding: T.boat.yielding, bumps: T.bumps, kayaks: T.kayaks.length, free: T.kayaks.filter((k) => k.free).length, clips: !!clips, render: R.stats, sim: T.stats } : null; },
  };
  return self;
}
