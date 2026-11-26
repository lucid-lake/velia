// The paddle-wheeler's plug-in for v2/main.js (src/core/features.js paddleWheeler): the sim (v2/sim/paddleWheeler.js), her drawing
// (v2/render/paddleWheeler.js: one pipeline, one draw), the vessels' wake map (render/vesselWake.js, the full tier only: hers, or the
// South Lake runabouts' when one of them is nearer the eye: living/powerBoats.js wakeEmitters) and her nav lights in the night's glow
// records. In play she runs her route (the south-lake region's traffic row of kind 'paddle': Ski Run ↔ off Emerald Bay) on every start,
// wherever her route lies within the draw distance (the far LOD is a few hundred triangles; the model is built by code, no fetch);
// a first birth in South Lake shifts her timetable once so the player meets her within 2 minutes. ?paddle=x,z,heading[,kn] places her
// straight along a heading instead (the model's review row).
//   const PW = createPaddlePlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, flags, tier, wake, row })
//   PW.attach({ depthAt, hour, seed, birth, onBump })   once the boat exists;   PW.post(dt, player)   the boat's tick
//   PW.fill(eye, sunElevDeg, { heightAt, race, wakeBusy, extra })   once a frame (extra(eye): the runabouts' wakes);   PW.runWater(pass, c)
//   PW.draw(pass, c)   PW.lights(out, o, opts)   PW.stats()
import { createPaddleWheeler, parsePaddle, paddleRoute } from '../sim/paddleWheeler.js';
import { createPaddleRender } from '../render/paddleWheeler.js';
import { createVesselWake } from '../render/vesselWake.js';

const WAKE_M = 1500;   // m: her wake's map is written while she is this near the eye

export function createPaddlePlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, flags = {}, tier = 'full', wake = null, row = null }) {
  const pose = parsePaddle(flags.paddle), route = pose ? null : paddleRoute(row);
  if (!pose && !(route?.length > 1)) return null;   // no placement and no route: no boat
  const R = createPaddleRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier });
  const VW = tier === 'full' ? createVesselWake({ device, reg, wake, name: 'paddle-wake' }) : null;
  let S = null, lastEye = [0, 0, 0], simT = 0, active = true, wakeOf = null;
  const self = {
    on: true,   // the harness's A/B (hook.paddle.on)
    get sim() { return S; }, render: R, pose, route, hasWake: !!VW,
    attach({ depthAt = null, hour = 13, seed = 1, birth = null, onBump = null } = {}) {
      S = pose ? createPaddleWheeler({ ...pose, depthAt }) : createPaddleWheeler({ route, hour, seed, birth, depthAt, onBump });
      if (!pose) import('../assets/towns/piers.json').then((m) => S.setPiers?.((m.default ?? m).piers ?? [])).catch(() => {});   // the piers she keeps off
      return self;
    },
    post(dt, player = null) { if (S) { simT += dt; S.post(dt, player); } },
    // wakeBusy: another boat holds the vessels' map this frame (the glass boat near the eye): hers stands down (one map on the page)
    fill(eye, sunElevDeg, { heightAt, race = false, wakeBusy = false, extra = null } = {}) {
      lastEye = eye; active = !race && self.on;
      if (!S || !active) { R.update(null); if (wakeBusy) VW?.pause(); else VW?.update(null, null); wakeOf = null; return; }
      const b = S.boat, d = Math.hypot(b.x - eye[0], b.z - eye[2]);
      if (VW) {
        if (wakeBusy) { VW.pause(); wakeOf = null; } else {
          // the map follows the nearest vessel: her, or a runabout nearer the eye (its emitters, and hers when she is inside the box)
          const w = extra?.(eye);
          const mine = { x: b.x, z: b.z, fx: Math.sin(b.heading), fz: -Math.cos(b.heading) };
          if (w && w.d < d) { const em = Math.abs(b.x - w.focus.x) < 200 && Math.abs(b.z - w.focus.z) < 200 ? [...w.emitters, ...S.emitters()] : w.emitters; VW.update(em, w.focus, simT); wakeOf = 'power'; }
          else if (d < WAKE_M) { VW.update(S.emitters(), mine, simT); wakeOf = 'paddle'; }
          else { VW.update(null, mine, simT); wakeOf = null; }
        }
      }
      R.update(S, { eye, heightAt, sunElevDeg });
    },
    runWater(pass, c) { if (active) VW?.run(pass, c); },
    draw(pass, c) { if (S && active) R.draw(pass, c); },
    lights(out, o, opts) { return S && active ? S.lights(out, o, { ...opts, eye: lastEye }) : 0; },
    get wakeStats() { return VW?.stats ?? null; },
    stats() { return S ? { tier, routed: !!S.routed, mode: S.boat.mode, x: Math.round(S.boat.x), z: Math.round(S.boat.z), headingDeg: +(S.boat.heading * 180 / Math.PI).toFixed(1), v: +S.boat.v.toFixed(2), wheelRpm: +(S.boat.wheelRate * 60 / (2 * Math.PI)).toFixed(1), yielding: !!S.boat.yielding, tau: S.stats.tau, shoal: S.stats.shoal, wakeOf, render: { ...R.stats }, wake: VW?.stats ? { ...VW.stats } : null } : null; },
  };
  return self;
}
