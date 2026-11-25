// The paddle-wheeler's plug-in for v2/main.js (src/core/features.js paddleWheeler: off in play until her routes come; ?paddle=x,z,
// heading[,kn] places her for review, under way at a set speed along the heading): the sim (v2/sim/paddleWheeler.js), her drawing
// (v2/render/paddleWheeler.js: one pipeline, one draw), her wake in the vessels' map (render/vesselWake.js, the full tier only) and her
// nav lights in the night's glow records.
//   const PW = createPaddlePlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, flags, tier, wake })
//   PW.attach({ depthAt })   once the boat exists;   PW.post(dt)   the boat's tick
//   PW.fill(eye, sunElevDeg, { heightAt, race, wakeBusy })   once a frame;   PW.runWater(pass, c)   the water-sim pass
//   PW.draw(pass, c)   PW.lights(out, o, opts)   PW.stats()
import { createPaddleWheeler, parsePaddle } from '../sim/paddleWheeler.js';
import { createPaddleRender } from '../render/paddleWheeler.js';
import { createVesselWake } from '../render/vesselWake.js';

const WAKE_M = 1500;   // m: her wake's map is written while she is this near the eye

export function createPaddlePlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, flags = {}, tier = 'full', wake = null }) {
  const pose = parsePaddle(flags.paddle);
  if (!pose) return null;   // no placement, no boat (her routes come later)
  const R = createPaddleRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier });
  const VW = tier === 'full' ? createVesselWake({ device, reg, wake, name: 'paddle-wake' }) : null;
  let S = null, lastEye = [0, 0, 0], simT = 0, active = true;
  const self = {
    on: true,   // the harness's A/B (hook.paddle.on)
    get sim() { return S; }, render: R, pose,
    attach({ depthAt = null } = {}) { S = createPaddleWheeler({ ...pose, depthAt }); return self; },
    post(dt) { if (S) { simT += dt; S.post(dt); } },
    // wakeBusy: another boat holds the vessels' map this frame (the glass boat near the eye): hers stands down (one map on the page)
    fill(eye, sunElevDeg, { heightAt, race = false, wakeBusy = false } = {}) {
      lastEye = eye; active = !race && self.on;
      if (!S || !active) { R.update(null); if (wakeBusy) VW?.pause(); else VW?.update(null, null); return; }
      const b = S.boat, near = Math.hypot(b.x - eye[0], b.z - eye[2]) < WAKE_M;
      if (VW) { if (wakeBusy) VW.pause(); else VW.update(near ? S.emitters() : null, { x: b.x, z: b.z, fx: Math.sin(b.heading), fz: -Math.cos(b.heading) }, simT); }
      R.update(S, { eye, heightAt, sunElevDeg });
    },
    runWater(pass, c) { if (active) VW?.run(pass, c); },
    draw(pass, c) { if (S && active) R.draw(pass, c); },
    lights(out, o, opts) { return S && active ? S.lights(out, o, { ...opts, eye: lastEye }) : 0; },
    get wakeStats() { return VW?.stats ?? null; },
    stats() { return S ? { tier, x: Math.round(S.boat.x), z: Math.round(S.boat.z), headingDeg: +(S.boat.heading * 180 / Math.PI).toFixed(1), v: +S.boat.v.toFixed(2), wheelRpm: +(S.boat.wheelRate * 60 / (2 * Math.PI)).toFixed(1), shoal: S.stats.shoal, render: { ...R.stats }, wake: VW?.stats ? { ...VW.stats } : null } : null; },
  };
  return self;
}
