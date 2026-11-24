// Cruise's voyage (refactor round 2, Phase C step 11: the first of start's three parts; src/modes/chill/index.js composes
// them): the chart, the start, the boat (Day Sail's assembly), the navigator, the AI skipper, the director and the camera
// rig, the fireworks trip and its tackle, the shared fixed step (helm.js), one frame of sailing and directing (sailFor), the
// 'chill' service the tools and probes read, and the captures' settle and film path (settleCapture). Moved from start in
// the same order; the state the three parts share (the sim clock, the glasses, the tools, the music, the line) lives on cx.
//   const v = await createVoyage(core, cx);   // → { chart, sail, boat, phys, follow, ride, boatAudio, nav, director, ctl, env,
//                                             //    pilot, speed, crowns, rig, starry, input, interp, attachKayaks, fwNow,
//                                             //    tackle, trip, share, startTrip, helm, sim, sailFor, chillApi }
//   if (core.headless) settleCapture(core, v, cx);
import { CONTROLS } from '../../../../src/sim/boat.js';
import { assembleBoat } from '../../sail/assemble.js';
import { buildChart, scenicRoute, Navigator, chooseStart } from '../../../../src/sim/modes/chill/navigator.js';
import { Director } from '../../../../src/modes/chill/director.js';
import { CruisePilot } from '../../../../src/sim/modes/chill/pilot.js';
import { createCruiseHelm } from './helm.js';
import { CHILL } from '../../../../src/sim/modes/chill/params.js';
import { applyPose } from '../../../../src/sim/boat/helmCamera.js';
import { hourJump } from '../../../../src/ui/timeMenu.js';
import { createCameraRig } from '../../../../src/modes/chill/rig.js';
import { StateInterp } from '../../../../src/sim/boat/interp.js';
import { loadTops } from '../../forest/treetops.js';
import { crownSolid, sightClear } from '../../../../src/forest/crowns.js';
import { createTackle } from '../../../../src/sim/boat/tackle.js';
import { createCruiseTrip, crewStep, jumpHour, isShare, shareSearch, showOn } from '../../fireworks/cruise.js';
import { chartObjects, showBodies } from '../../fireworks/solids.js';
import { isHighlightDay } from '../../../../src/sim/day.js';
import { showShot } from '../../fireworks/shots.js';
import { kayaksOn } from '../../../../src/sim/kayaks/on.js';
import { attachFeatures } from '../../features/index.js';
import { camerasFor } from '../../../../src/sim/craft/index.js';
import { withStepHooks } from '../../core/filmHooks.js';

const DEG = Math.PI / 180;

export async function createVoyage(core, cx) {
  const { flags, headless, renderer, camera, terrain, shoreline, harbour, traffic, wind, SEED, T0, services } = core;
  core.stage('chart', 0.9);
  // the show's props are fixed objects on the show's day (the wow round put them in the bay): each barge and its tug (81 m end
  // to end) as three circles, the patrol boats, the spectators' sailboats (src/fireworks/solids.js; fix/barge-collision: the
  // old one 45 m circle round each barge's middle left its tug's stern 6 m out, and no patrol boat or sailboat on it)
  const fwBarges = showOn(flags, isHighlightDay(core.waters)) ? chartObjects(showBodies(terrain.heightAt)) : [];
  const chart = buildChart(terrain, { shoreline: shoreline.layout, harbour: harbour.layout, lanes: traffic.paddlewheeler ? [traffic.paddlewheeler.path.pts] : [], extra: fwBarges });
  const w0 = wind.sample(CHILL.start.x, CHILL.start.z, T0);
  const at = flags.start?.split(',').map(parseFloat);
  const pose = at?.length === 2
    ? { x: at[0], z: at[1], headingDeg: parseFloat(flags.heading ?? '0'), speed: isShare(flags) ? 0 : 2.5 }   // the share link: stopped on the spot
    : chooseStart(chart, { seed: SEED, traffic, t0: T0, windFrom: Math.atan2(-w0.vx, w0.vz) });
  const sail = await assembleBoat(core, pose);
  const { boat, phys, follow, ride, boatAudio } = sail;
  const nav = new Navigator({ chart, route: scenicRoute(chart, { seed: SEED }), seed: SEED });
  nav.pickNearest(phys.state.x, phys.state.z);
  const director = new Director({ heightAt: terrain.heightAt, seed: SEED, only: flags.shot });
  const ctl = { ...CONTROLS };
  const boatSvc = services.get('boat');   // assembleBoat's 'boat' service: read once (its env is read each tick)
  const env = (t) => boatSvc.env(t);
  // the AI skipper (src/ai/skipper.js) sails at skill 1 with the pro controls; the navigator plans and keeps it safe (?skipper=0: the old helm and crew trim)
  const pilot = new CruisePilot({ nav, skill: 1, seed: SEED, windAt: (x, z, t) => env(t).windAt(x, z, t), vessel: phys.vessel });
  const speed = parseFloat(flags.speed ?? CHILL.simSpeed);
  // the forest as a solid for the cameras' sight lines (src/forest/crowns.js): the lidar crowns, rasterised once (≈ 1 s)
  const tops = await loadTops();
  const crowns = crownSolid(terrain, tops);
  const startCam = flags.cruisecam === 'deck' ? 'above' : flags.cruisecam ?? 'cinematic';   // the old Deck camera's links land on Above
  const rig = createCameraRig({ terrain, follow, view: startCam, solid: crowns, sky: () => core.milkyway?.aim?.() ?? null, helm: camerasFor(phys.vessel).helm });
  const starry = () => !!core.milkyway?.dark?.(0.6) && !!core.milkyway?.aim?.();   // a dark night with the band up: the stars camera on C
  if (flags.coursecam) rig.above.toggle();
  director.solid = crowns.at;
  const input = { look: null, zoom: 1 };   // this frame's passenger drag and wheel (live pages; cleared each frame)
  const interp = new StateInterp();
  cx.simT = T0 + (headless ? parseFloat(flags.settle ?? '20') : 0);
  // the navigator and the skipper on the shared fixed step (helm.js, src/sail/simulation.js)
  // the kayaks on (the default; not ?kayaks=0): the lake's kayakers as traffic too (src/kayaks/fleet.js agents: each kayak and a point ahead of its bow, with
  // their own 15 m margins), so the navigator steers round them and passes astern
  const trafficK = kayaksOn(flags.kayaks) ? Object.assign(Object.create(traffic), { agents: (t) => { const k = services.get('kayaks'); return k?.agents ? [...traffic.agents(t), ...k.agents(t)] : traffic.agents(t); } }) : traffic;
  // Cruise's features (src/features/index.js), one loop: the kayak fleet (no camera notice here); update(dt × speed, dt) and dispose()
  const attachKayaks = () => attachFeatures(core, services.get('player'), { scope: 'mode', mode: 'cruise', ctx: { kayakFleet: { notice: false } } });
  // the fireworks trip (src/fireworks/cruise.js): this boat's ground tackle and the crew's hook on each sim tick; the show's
  // evening is the 'fireworks' service (attached after the mode starts; absent on another day or with ?fireworks=0)
  const fwNow = () => services.get('fireworks') ?? null;
  const tackle = createTackle({ dims: boat.dims, depthAt: (x, z) => -terrain.heightAt(x, z) });
  const trip = createCruiseTrip();
  const share = isShare(flags);
  if (share) { trip.start({ anchored: true }); phys.furlPos = 1; ctl.furl = 1; }   // the share link: on the spot, the sails down, the anchor going down
  // the Fireworks button: with the show built, the clock to the evening if it is not there yet (src/fireworks/cruise.js
  // jumpHour), the evening invited (its lapse waits only for the boat at the spot), the trip under way, the Cinematic camera
  // (the show's shots); with no show on this page, the share link (a new page: the show's day). → 'trip' | 'share' | 'busy'
  function startTrip({ auto = false } = {}) {
    const fw = fwNow();
    if (!fw) { if (!auto && typeof location !== 'undefined') location.search = shareSearch(location.search); return 'share'; }
    if (trip.active) return 'busy';
    const j = jumpHour(core.clock.hourOfDay(cx.simT));
    if (j != null) core.clock.setHour(hourJump(core.clock.hourAt(cx.simT), j), cx.simT);
    fw.invite();
    if (tackle.mode !== 'free') { Object.assign(tackle.state.anchor, { phase: 'stowed', out: 0 }); tackle.state.mode = 'free'; }
    trip.start();
    rig.set('cinematic');
    return 'trip';
  }
  const crew = (dt) => crewStep({ trip, phase: fwNow()?.phase ?? 'before', phys, ctl, nav, tackle, dt }).hold;
  const helm = createCruiseHelm({ phys, pilot, nav, ctl, env, traffic: trafficK, sunElevDeg: () => core.sun?.elevationDeg ?? 20, t0: cx.simT, interp, tackle, crew });
  const sim = helm.sim;

  // one frame of Cruise: the navigator and the skipper steer, the physics steps, the camera rig frames it
  function sailFor(dt, simDt) {
    helm.advance(simDt); cx.simT = sim.t;
    // live pages draw the state between the last two ticks (src/boat/interp.js); captures keep the exact state
    const s = headless ? phys.state : interp.at(phys.state, sim.alpha);
    const rp = ride.step(renderer, s, cx.simT, simDt);
    boat.update(rp, dt, { t: headless ? cx.simT : cx.simT - 1 / 60 + sim.acc });
    // the passenger's look and zoom go to the camera they are looking through (the binoculars take them while up)
    const glasses = !!cx.tools?.latched, look = glasses ? null : input.look, zoom = input.zoom;
    const fp = rig.followStep(dt, s, { look, zoom });
    const dp0 = director.update(dt, { t: cx.simT, boat: { x: s.x, z: s.z, heading: s.heading, sog: s.sog }, sun: core.sun?.direction ?? core.sunWorld, look: nav.target.look, follow: fp, windSpeed: s.trueWind.speed, aspect: camera.aspect });
    // the show's shots on the Cinematic camera while the boat is on the trip (making for the spot, at anchor; the share link's too)
    const showT = trip.active ? fwNow()?.showTime : null;
    const dp = (showT != null && showShot(showT, { boat: s, heightAt: terrain.heightAt })) || dp0;
    const normal = rig.pose(dt, { ride: rp, state: s, fp, dp, look, zoom });
    applyPose(camera, cx.tools ? cx.tools.camera(dt, rp, normal, { held: glasses, look: glasses ? input.look : null }) : normal);
    return normal;
  }

  const chillApi = services.provide('chill', {
    nav, director, chart, rig, crowns,
    // does the camera on screen see the hull (terrain and crowns)? (tools/cruisecam_shots.mjs, the probes)
    sight() { const p = rig.last, s = phys.state; return p ? sightClear(crowns.at, p.pos, [s.x, 1.5, s.z]) : null; },
    get simT() { return cx.simT; },
    get time() { return cx.timeApi; }, get weather() { return cx.weatherApi; }, get wind() { return cx.windApi; }, photo: () => cx.photo(),   // the time, weather and wind calls and the photo (tools, probes)
    skipper: pilot?.skipper,
    trip, tackle,   // the fireworks trip (tests, tools/fireworks/s5_captures.mjs)
    fireworks: (o) => startTrip(o),
    stats: () => ({ trip: trip.state, view: rig.view, dest: nav.dest?.name ?? null, simT: +cx.simT.toFixed(1), hour: +(core.sun?.hour ?? 0).toFixed(3), elev: +(core.sun?.elevationDeg ?? 0).toFixed(2), rate: +core.clock.rateAt(cx.simT).toFixed(1), shot: director.shot?.kind, helm: cx.handed ? 'player' : 'chill', ...nav.stats(), music: cx.music?.stats(), line: cx.line?.text ?? '' }),
    // the safety record at this instant, from the exact terrain and layouts (tools/probe_chill.mjs)
    safety() {
      const s = phys.state, out = { depth: Infinity, shore: Infinity };
      for (const f of [-4.5, 0, 4.5]) {
        const x = s.x + Math.sin(s.heading) * f, z = s.z - Math.cos(s.heading) * f;
        out.depth = Math.min(out.depth, -terrain.heightAt(x, z)); out.shore = Math.min(out.shore, -terrain.shoreDistance(x, z));
      }
      out.obj = Math.min(...chart.objects.map(([ox, oz, r]) => Math.hypot(ox - s.x, oz - s.z) - r));
      out.buoy = chart.buoys.length ? Math.min(...chart.buoys.map(([ox, oz]) => Math.hypot(ox - s.x, oz - s.z))) : Infinity;
      out.traffic = Math.min(...traffic.agents(core.time).map((a) => Math.hypot(a.x - s.x, a.z - s.z)));
      Object.assign(out, { x: s.x, z: s.z, u: s.u, sog: s.sog, twaDeg: s.trueWind.angle / DEG, tws: s.trueWind.speed, heelDeg: s.heel / DEG, reef: s.reef });
      return out;
    },
  });

  return { chart, sail, boat, phys, follow, ride, boatAudio, nav, director, ctl, env, pilot, speed, crowns, rig, starry, input, interp,
    attachKayaks, fwNow, tackle, trip, share, startTrip, helm, sim, sailFor, chillApi };
}

// captures: sail and direct for ?chillsettle s from the settled boat, then hold the pose (?film=1: the film contract)
export function settleCapture(core, { sail, phys, sailFor, chillApi }, cx) {
  const { flags, camera, lod, services } = core;
  const n = Math.round(parseFloat(flags.chillsettle ?? '0') * 30);
  for (let i = 0; i < n; i++) { sailFor(1 / 30, 1 / 30); }
  if (!n) sailFor(1 / 30, 0);
  // tools (tools/skipper_shots.mjs): sail and direct on, from the page, for this many seconds
  chillApi.advance = (sec) => { for (let i = 0, m = Math.round(sec * 30); i < m; i++) sailFor(1 / 30, 1 / 30); lod.update(camera.position); core.setTime(cx.simT); };
  lod.update(camera.position); core.setTime(cx.simT);
  // ?film=1 (tools/film/run.mjs): step(dt) sails and directs one film frame at a fixed dt (the
  // sim ticks at 1/60 s), then holds the runner's scripted pose (pose(p): { pos, target, up?, fov, near? }; null: the
  // director's). Deterministic: the same URL and the same steps give the same frames.
  if (flags.film) {
    let held = null;
    const lens = () => { if (held?.rig && held.fov) { camera.fov = held.fov; camera.updateProjectionMatrix(); } };
    const state = () => { const s = phys.state; return { t: cx.simT, x: s.x, z: s.z, heading: s.heading, sog: s.sog, heelDeg: s.heel / DEG, tws: s.trueWind.speed }; };
    services.provide('film', withStepHooks({
      state,
      // pose({ rig: true, fov }) keeps the Cruise rig's view (?cruisecam=helm …) and sets only its lens
      pose(p) { held = p; if (p && !p.rig) applyPose(camera, p); lens(); lod.update(camera.position); },
      step(dt) {
        sailFor(dt, dt); if (held && !held.rig) applyPose(camera, held); lens(); lod.update(camera.position); core.setTime(cx.simT);
        sail.air?.step(dt, cx.simT, camera, phys.state);   // the pollen drifts as on a live page (captures leave it still)
        return state();
      },
    }));
  }
}
