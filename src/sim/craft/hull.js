// The hull frame any craft shares (refactor round 2, Phase C step 6): the
// physics (the craft's own: src/craft/index.js), the float, wake and spray, the follow camera, the air, the bottom, the
// posts after each tick and the physics' env. No GLB, no sails, no three.js loaders: it runs in node
// (tests/craftHull.test.mjs) and a kayak composes it with its own body. Moved from src/sail/assemble.js in the same order.
// boatAudio is the craft's own sound (Phase C step 10: craft.createAudio(core) on a live page; the sloop's is src/boatAudio.js,
// src/craft/sloop/audio.js; a craft without one is silent); the name stays for the readers (the controllers, Cruise).
//   const hull = createHull(core, { craft, vessel, start, dims })
//   → { phys, ride, follow, ground, groundTerrain, air, boatAudio, sfx, env(t), addPost(fn), posts, pose0(), dispose() }
// pose0(): the follow camera's first pose onto the camera (the composer calls it after the Boat's first update).
// view: the engine's drawn parts (Sprint 0), each optional: view.spray({ dims, length, beam, seed }) → the bow
// spray ({ mesh, update }), view.airMesh({ lum }) → the air's draw ({ group, draw(sim, camera), prepare? }). v1's
// (src/craft/hull.js) are TSL; v2 passes its own. Without them the frame is the sim alone: no spray, the air undrawn.
import { createSfx } from '../../sfx.js';
import { createGround } from '../boat/ground.js';
import { groundTerrain } from '../boat/groundTerrain.js';
import { FollowCamera } from '../boat/followCamera.js';
import { BoatOnWater } from '../boat/ride.js';
import { AirSim, airConfig } from '../air.js';

export function createHull(core, { craft, vessel, start: START, dims, view = {} }) {
  const { flags, headless, scene, camera, lum, water, wake, wind, audio, SEED } = core;
  // Start in the bay below the island, on a broad reach (≈145° off the 200° breeze) toward the mouth and the open lake:
  // the camera looks down the bay to the narrows and the far shore.
  const startHeading = START.headingDeg * Math.PI / 180;
  const phys = craft.createPhysics({ x: START.x, z: START.z, heading: startHeading, speed: START.speed ?? 0, vessel });   // S1 (CTO): the sloop is the Catalina 28, calibrated to a scaled VPP polar
  // D1: the craft's own sound (the sloop's: hull water, load creaks, sails, wind in the rig); silent until audio.start().
  // From the craft (step 10's seam): none in captures, none for a craft without one
  const boatAudio = headless ? null : craft.createAudio?.(core) ?? null;
  // the controls' sounds (src/sfx.js: the winch, the sheet running, the wheel, the wind changing, the logbook's page);
  // its one-shots decode now, before any gesture, so the first press is heard
  const sfx = headless ? null : createSfx({ audio, seed: SEED });
  water.clarity?.track(() => phys.state);   // wow/clarity: the hull's and the sails' shadow on the lake bed
  // the follow camera's length unit from the craft (step 7: craft.cameras(vessel).follow.hull; 9.1 m for Halcyon), never a sloop constant
  const follow = new FollowCamera({ hull: craft.cameras?.(vessel)?.follow?.hull, x: START.x, z: START.z, heading: startHeading, pitchDeg: flags.campitch != null ? parseFloat(flags.campitch) : null, dist: flags.camdist != null ? parseFloat(flags.camdist) : null });
  const ride = new BoatOnWater({ water, wake, dims, seed: SEED, makeSpray: view.spray });   // M10: float, wake, spray (the engine's)
  if (wake && ride.spray) scene.add(ride.spray.mesh);
  // env.sea: the float's last reading of the waves along the hull (their surge: surfing; the bow's slam), src/boat.js § 6b
  // Seeing the wind (src/air.js): pollen, fluff, crest wisps and the beginners' wind lines, all from the one wind module.
  // ?air=0 leaves them out (the cost check); the strength of the lines is set per frame by the mode (controls.js)
  const air = !flags.air ? null : { sim: new AirSim({ cfg: airConfig(parseFloat(flags.airboost ?? '1'), core.tier?.air), wind, seed: SEED, waveAt: (x, z, t) => water.waveAt(x, z, t) }), mesh: view.airMesh?.({ lum }) ?? null, lines: flags.windlines != null ? parseFloat(flags.windlines) : (headless ? 1 : 0), rain: 0 };   // lines: 0 until the controls set them (Sail only)
  if (air?.mesh) { air.mesh.prepare?.(air.sim); scene.add(air.mesh.group); }   // made now: the load's warm-up builds them (fix/first-visit-hitches)
  // the air's step: its sim on the scene clock, then its draw from this camera
  if (air) air.step = function airStep(dt, t, cam, st) {
    const sun = core.sun?.direction;
    air.sim.update(dt, { t, cam: [cam.position.x, cam.position.y, cam.position.z], boat: { x: st.x, z: st.z }, light: core.sun?.light ?? 1, rain: air.rain,
      sun: sun ? [sun.x, sun.y, sun.z] : null, lines: air.lines });
    air.mesh?.draw(air.sim, cam);
  };
  // live: the air steps with the boat (the camera of the frame before: a 16 ms lag in the billboards is invisible)
  if (air && !headless) ride.afterStep.push((dt, t, state) => air.step(dt, t, camera, state));
  // the bottom (src/boat/ground.js): the keel, the rudder and the hull meet the real bed and shore in every mode (Sail, Cruise, the
  // captures); the same depth the chart, the navigator and the anchor read. The page's mode adds the shallow-water assist and the warnings.
  const GT = groundTerrain(core.terrain), ground = createGround({ ...GT, dims });
  // more hooks after each tick in every mode (the fireworks' solid props: src/fireworks/solids.js), after the bottom's
  const posts = [], addPost = (f) => { posts.push(f); return () => { const i = posts.indexOf(f); if (i >= 0) posts.splice(i, 1); }; };
  const post = (s, dt, t, b) => { ground.post(s, dt, t, b); for (const f of posts) f(s, dt, t, b); };
  const env = (t) => ({ t, ext: ground.ext, post, waveAt: ride.waveAt, currentAt: ride.currentAt, sea: () => ride.wave, windAt: (x, z, tt) => { const w = wind.sample(x, z, tt); const to = Math.atan2(w.vx ?? 0, -(w.vz ?? 0)); return { vx: w.vx ?? Math.sin(to) * w.speed, vz: w.vz ?? -Math.cos(to) * w.speed }; } });
  // ?camyaw=<deg>: the camera's azimuth relative to the boat's heading (0 = astern, 90 = from the starboard beam),
  // the chase off, so captures can see the side and the bow wave.
  if (flags.camyaw != null) { follow.yaw = startHeading + parseFloat(flags.camyaw) * Math.PI / 180; follow.chase = false; }
  return {
    phys, ride, follow, ground, groundTerrain: GT, air, boatAudio, sfx, env, addPost, posts,
    pose0() { const pose0 = follow.update(1, phys.state); camera.position.set(...pose0.pos); camera.lookAt(...pose0.target); return pose0; },
    dispose() {
      if (air?.mesh) scene.remove(air.mesh.group);
      if (wake && ride.spray) scene.remove(ride.spray.mesh);
      boatAudio?.dispose?.();
    },
  };
}
