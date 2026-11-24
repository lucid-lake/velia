// The sloop's capture path (refactor round 2, Phase C step 6): ?headless only.
// Settles the boat for a deterministic number of seconds on the scene clock (?settle, ?rudder, ?twa, ?start, the thrill
// ?until), places the capture's camera (?campos, ?view=helm, ?shot), warms the air and provides 'thrillSettle' and, with
// ?film=1, Sail's film contract ('film': tools/film/run.mjs). Moved as one block from
// src/sail/assemble.js, with its clock (T0 + i / 60), so the goldens' frames are the same frames.
//   await settleCapture(core, { boat, START, phys, ride, follow, env, air, detailLod, crewVis })
// boat: the Boat; phys, ride, follow, env, air: the hull frame's (src/craft/hull.js); detailLod, crewVis: the body's
// (src/craft/sloop/body.js).
import { CONTROLS, Helm } from '../../../../src/sim/boat.js';
import { HelmCamera, applyPose } from '../../../../src/sim/boat/helmCamera.js';
import { camerasFor } from '../../../../src/sim/craft/index.js';
import { blendPose } from '../../../../src/boat/viewBlend.js';
import { shotPose } from '../../boat/shots.js';
import { withStepHooks } from '../../core/filmHooks.js';

export async function settleCapture(core, { boat, START, phys, ride, follow, env, air, detailLod, crewVis }) {
  const { flags, renderer, camera, water, wind, lod, T0, services } = core;
  const startHeading = START.headingDeg * Math.PI / 180;
  // captures: settle the boat for a deterministic number of seconds at the scene time
  const settle = parseFloat(flags.settle ?? '20');
  // ?rudder= holds a fixed helm; otherwise an autopilot holds the start heading (the boat has real weather helm)
  const fixed = flags.rudder != null ? parseFloat(flags.rudder) : null, helm = new Helm({ rudderMaxDeg: phys.P.rudder.maxDeg });
  // the thrill captures: ?until=surf|rail|slam|roundUp|groove sails on past `settle` (up to 180 s) until that
  // cue (state.<cue>) passes 0.6, then ?after= s more (0.25: a slam's sheet in the air); all on the
  // scene clock, so the frame is the same every run
  const twaHold = flags.twa != null ? -parseFloat(flags.twa) * Math.PI / 180 : null, windFromRad = (wind.base?.dirDeg ?? 200) * Math.PI / 180;
  if (twaHold != null) { phys.state.heading = windFromRad - twaHold; phys.state.u = 3; }
  { const st = flags.start?.split(',').map(parseFloat); if (st && Number.isFinite(st[0]) && Number.isFinite(st[1])) { phys.state.x = st[0]; phys.state.z = st[1]; } }   // ?start=x,z: the thrill captures sail where the sea is (the open lake)
  const until = flags.until, untilAt = 0.6, after = parseFloat(flags.after ?? '0.25');
  const untilMax = settle + 180;
  let pose = phys.state, n = Math.round(settle * 60), stop = null, i = 0;
  let maxPush = 0, maxU = 0;
  for (; i < n || (until && stop == null && i < untilMax * 60) || (stop != null && i < stop); i++) {
    // ?twa=<deg>: hold that true wind angle (a run for the surf capture: ?start=4700,-15200&twa=135&until=surf), else the start heading
    const rudder = fixed ?? (twaHold != null ? helm.toTWA(phys.state, twaHold, windFromRad) : helm.toHeading(phys.state, startHeading));
    // a thrill capture runs the sea (the FFT, 30 Hz) so the waves overtake the boat as they do in play; the other captures keep the frozen surface (the goldens hold)
    if (until && water.ultra && i % 2 === 0) { camera.position.set(phys.state.x, 4, phys.state.z); water.update(T0 + i / 60, camera, renderer); await water.ultra.settle(); }   // the CPU windows follow the camera: put it on the boat
    phys.step(1 / 60, { ...CONTROLS, rudder }, env(T0 + i / 60)); pose = ride.step(renderer, phys.state, T0 + i / 60, 1 / 60);
    maxPush = Math.max(maxPush, phys.state.waveSurge ?? 0); maxU = Math.max(maxU, phys.state.u);
    if (until && stop == null && i >= n && (phys.state[until] ?? 0) >= untilAt) stop = i + 1 + Math.round(after * 60);
  }
  if (until) console.log(`[thrill] until ${until}: ${stop != null ? `met at ${((stop - Math.round(after * 60)) / 60).toFixed(2)} s` : 'NOT met'}, captured at ${(i / 60).toFixed(2)} s; u ${phys.state.u.toFixed(2)} m/s heel ${(phys.state.heel * 57.3).toFixed(1)}° surf ${phys.state.surf.toFixed(2)} rail ${phys.state.rail.toFixed(2)} slam ${phys.state.slam.toFixed(2)} spray ${JSON.stringify(ride.spray.stats())}${water.ultra ? ` sea reads ${water.ultra.reads}` : ""} maxPush ${maxPush.toFixed(0)} N maxU ${maxU.toFixed(2)} U ${water.uniforms.uU.value.toFixed(1)} eta ${(() => { let a = 0; for (let k = 0; k < 100; k++) { const h = water.surface.heightAt(phys.state.x + k * 2, phys.state.z, T0 + i / 60, {}); a += h * h; } return Math.sqrt(a / 100).toFixed(3); })()} at ${phys.state.x.toFixed(0)},${phys.state.z.toFixed(0)}`);
  services.provide('thrillSettle', { until, met: stop != null, t: i / 60, state: { ...phys.state } });
  boat.update(pose, 0, { t: T0 + i / 60 });
  // a thrill capture draws the water at the boat's own moment (the default captures keep T0: the goldens hold)
  if (until) core.setTime?.(T0 + i / 60);
  for (let i = 0; i < 120; i++) { const p = follow.update(1 / 60, phys.state); camera.position.set(...p.pos); camera.lookAt(...p.target); }
  // ?campos=x,y,z&camlook=x,y,z[&camfov=deg] keeps its proof viewpoint with the boat in the scene (the signature view: the overlook with Halcyon on the water)
  if (flags.campos != null) {
    camera.position.set(...flags.campos.split(',').map(Number)); camera.lookAt(...(flags.camlook ?? '0,0,0').split(',').map(Number));
    if (flags.camfov != null) { camera.fov = parseFloat(flags.camfov); camera.updateProjectionMatrix(); }
  }
  // ?view=helm: the helm view from the settled pose; ?helmlook=<yaw°>,<pitch°> looks around (+ to
  // starboard, + up), for the proof captures
  if (flags.view === 'helm') {
    const hc = new HelmCamera(camerasFor(phys.vessel).helm), [ly, lp] = (flags.helmlook ?? '0,0').split(',').map((v) => (parseFloat(v) || 0) * Math.PI / 180);
    hc.yawT = ly; hc.pitchT = lp; hc.idle = 0;
    let p; for (let i = 0; i < 120; i++) { hc.idle = 0; p = hc.update(1 / 60, pose, {}); }
    applyPose(camera, p);
  }
  // ?shot=<name>: a close capture of one part of the boat (src/boat/shots.js: masthead, boomend, bow, cockpit-above …)
  const shot = flags.shot ? shotPose(flags.shot, boat) : null;
  if (shot) applyPose(camera, shot);
  lod.update(camera.position);
  detailLod.update(camera.position);
  crewVis.update(camera.position);
  boat.modules.lines?.refresh?.();   // the rope's switch from the capture's own camera (src/boat/lines.js: tubes near)
  // the air for a capture: ?airs= seconds of it (6 by default), stepped at 30 Hz on the scene clock, from the settled camera
  if (air) { const n = Math.round(parseFloat(flags.airs ?? '6') * 30), t0 = T0 + i / 60; for (let k = 0; k < n; k++) air.step(1 / 30, t0 + k / 30, camera, phys.state); }
  // ?film=1 (tools/film/run.mjs): Sail's film contract (Cruise and Regatta replace it with their
  // own). step(dt) sails one film frame at 60 Hz with the capture's helm (?rudder, ?twa, else the start heading), the sea and the scene clock on the boat's own time; pose(p) holds the scripted camera, or
  // ?view=helm rides the helm camera (pose({ rig: true, fov }) sets only its lens).
  if (flags.film) {
    let k = i, held = null, last = pose;
    const hc = new HelmCamera(camerasFor(phys.vessel).helm), helmView = flags.view === 'helm';   // the helm camera runs always: a scripted pose may blend into it (pose.helm)
    if (helmView && flags.helmlook) { const [ly, lp] = flags.helmlook.split(',').map((v) => (parseFloat(v) || 0) * Math.PI / 180); hc.yawT = ly; hc.pitchT = lp; }   // ?helmlook= holds its look through a film too (the kayaks' helm shots)
    let acc = 0, frac = 0;   // a film frame shorter than the 1/60 s physics step (slow motion at 60 fps) carries its part over
    const tNow = () => T0 + (k + frac) / 60;
    const state = () => { const s = phys.state; return { t: tNow(), x: s.x, z: s.z, heading: s.heading, sog: s.sog, heelDeg: s.heel * 180 / Math.PI, tws: s.trueWind.speed, surf: s.surf, slam: s.slam }; };
    const view = (dt) => {
      hc.idle = 0; const hp = hc.update(dt, last, {});
      if (helmView) applyPose(camera, held?.rig && held.fov ? { ...hp, fov: held.fov } : hp);
      // pose.helm (0–1, eased by the runner): the scripted pose flies into the live helm camera on the game's own
      // Boat → Helm path (viewBlend.js blendPose: round to astern, low over the stern rail into the seat)
      else if (held && !held.rig) applyPose(camera, held.helm > 0 ? blendPose(held, hp, held.helm, { eye: hp.pos, heading: phys.state.heading }) : held);
      lod.update(camera.position); detailLod.update(camera.position); crewVis.update(camera.position);
    };
    core.setTime?.(tNow());
    services.provide('film', withStepHooks({
      state,
      pose(p) { held = p; view(0); },
      helmLook(yaw, pitch = 0) { hc.yawT = yaw; hc.pitchT = pitch; },   // ?view=helm: the look round (rad, + to starboard, + up), as a player drags it (tools/kayaks-shots.mjs --orbit)
      step(dt) {
        // whole 1/60 s physics steps, the remainder carried to the next frame; the scene clock keeps the remainder too, so
        // at 60 fps half speed it moves 1/120 s a frame like everything else (Math.round(0.5) gave a full step every frame:
        // the water and the hull's heave ran at twice the speed of a slow-motion film)
        acc += dt * 60; frac = 0;
        for (let m = Math.floor(acc + 1e-9); m > 0; m--, k++, acc--) {
          const rudder = fixed ?? (twaHold != null ? helm.toTWA(phys.state, twaHold, windFromRad) : helm.toHeading(phys.state, startHeading));
          phys.step(1 / 60, { ...CONTROLS, rudder }, env(tNow())); last = ride.step(renderer, phys.state, tNow(), 1 / 60);
        }
        frac = Math.max(0, acc);
        boat.update(last, dt, { t: tNow() }); core.setTime?.(tNow()); view(dt);
        air?.step(dt, tNow(), camera, phys.state);
        return state();
      },
    }));
  }
}
