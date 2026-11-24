// Regatta (?mode=regatta; public name): one race, the Island Sprint, you against Wren on Osprey (sail 17).
// Sail's boat, controls, chart and logbook; the course's marks laid by src/marks; the rules in src/race/rules.js; the rival is an
// AISkipper (src/race/rival.js) on a second Boat with Halcyon's modules. The mode owns the Race and draws from its state.
// The mode interface: src/modes/README.md.   ?autoplay=1: the player's boat sails itself (the AI skipper at skill 1), to finish
// (the probe, tools/regatta-probe.mjs); ?speed= accelerates the sim; ?tier=easy|medium|hard|pro (the rival; medium by default);
// ?seed= makes the race replayable; R restarts it in place.
import { DT } from '../../../../src/sim/boat.js';
import { assembleBoat } from '../../sail/assemble.js';
import { attachControls } from '../../sail/controls.js';
import { attachLogbook } from '../../../../src/sail/logbook.js';
import { attachChart } from '../../../../src/sail/chart.js';
import { sailCoreOptions } from '../../sail/options.js';
import { attachFeatures } from '../../features/index.js';
import { courseFor, snapCourse } from '../../../../src/sim/race/course.js';
import { Rival, makeClear } from '../../../../src/sim/race/rival.js';
import { createSession, installRestartKey } from './session.js';
import { shadowed } from '../../../../src/sim/race/dirtyAir.js';
import { startPoses } from '../../../../src/sim/race/sim.js';
import { createRivalBoat } from './rivalBoat.js';
import { regattaExtras } from './extras.js';
import { createFlow, diffById } from '../../../../src/sim/race/newbie.js';
import { withFlags } from '../../../../src/sim/core/flags.js';
import { CURRENT_WATERS } from '../../../../src/sim/waters/current.js';
import { withStepHooks } from '../../core/filmHooks.js';

const DEG = Math.PI / 180;
const RACE_HOUR = '15';
export const WATERS = CURRENT_WATERS.id;   // this page's lake: its courses (src/race/courses/<lake>/)

// What the core builds differently: Sail's wind (the level-3 day, the readable shifts) at 15:00, the light held (the day clock
// at the real rate), no first-gust line (the start is not a lesson). The HUD stays full (a race reads its plates), and
// neither the staged first visit nor the first sail's goal play here.
export function coreOptions(flags) {
  const o = sailCoreOptions(flags);
  return { ...o, defaultHour: RACE_HOUR, timeSchedule: null, timeRate: 1, hud: 'full', stage: false, firstSail: null };
}

// the CourseTracker / MarkField's course (src/marks/course.js shape) from a race course
function markCourse(course) {
  const m = (id, type, role, colour, at) => ({ id, type, role, colour, x: at[0], z: at[1] });
  const L = course.line;
  return { kind: 'regatta', rounding: 'port', laps: 1, lengthM: course.totalM, windFrom: course.designWindFrom * DEG, origin: { x: L.centre[0], z: L.centre[1] },
    marks: [m('committee', 'committee', 'start', 'white', L.committee), m('pin', 'pin', 'start', 'orange', L.pin),
      ...course.marks.map((k) => m(k.id, k.kind, 'mark', k.colour, k.at))],
    line: { a: 'committee', b: 'pin' }, sequence: [...course.markIds], label: course.name };
}

export async function start(modeCore) {
  // Regatta's own copy of the flags (never the shared ones): a race runs in real time (Sail's default is 2x), and a
  // capture shows the start, not a settled sail. Every part this mode starts reads them from its core.
  const flags = withFlags(modeCore.flags, { ...(modeCore.flags.speed == null ? { speed: '1' } : {}), ...(modeCore.headless ? { settle: '0' } : {}) });
  const core = Object.create(modeCore, { flags: { value: flags } });
  const { headless, terrain, services } = core;
  const autoplay = flags.autoplay;
  const depthAt = (x, z) => -terrain.heightAt(x, z), shoreDist = (x, z) => -terrain.shoreDistance(x, z);
  // the July 4th show's props in the evening (src/fireworks/solids.js): the computer boats steer clear of them as of shoal water
  const blockedAt = (x, z) => !!core.services?.get?.('fireworks')?.blocked?.(x, z);
  const course = snapCourse(courseFor(core.waters?.id ?? WATERS, flags.course), { depthAt, shoreDist });
  const windFrom0 = course.designWindFrom * DEG;
  const layout = { a: [0.85, 0.15] };   // Osprey 60 m off, ahead on the pin side of the bow: in view from the follow camera
  const [me0, wren0] = startPoses(course, windFrom0, ['me', 'wren'], layout);
  const pose = (p) => ({ x: p.x, z: p.z, headingDeg: p.heading / DEG, speed: p.speed });

  const sail = await assembleBoat(core, pose(me0));
  const boatSvc = services.get('boat');   // assembleBoat's 'boat' service: its env is read each tick (and swapped below)
  const controls = core.headless || autoplay ? null : attachControls(core, sail);
  const logbook = core.headless || autoplay ? null : attachLogbook(core, sail, controls);
  // Regatta's features (src/features/index.js): the marks; the race drives them itself (marks.update in its own steps)
  const marks = (await attachFeatures(core, services.get('player'), { scope: 'mode', mode: 'regatta', ctx: { sail, controls } })).get('marks');
  marks.lay('regatta', { quiet: true, course: markCourse(course), settleS: flags.settle === '0' ? 20 : 90 });
  const chart = core.headless || autoplay ? null : attachChart(core, sail, controls, logbook, { marks });

  // the other boat
  const rival = await createRivalBoat(core, { pose: pose(wren0), number: 17 });
  let store = null; try { store = globalThis.localStorage ?? null; } catch { store = null; }
  const firstRace = !(store?.getItem?.('lakeshore.regatta.first'));
  const flow = createFlow({ show: !autoplay && (!headless || flags.brief) });
  const tier = flags.tier ?? diffById(flags.diff ?? (firstRace ? 'easy' : 'medium')).tier;
  if (flags.diff) flow.choose(flags.diff); else if (!firstRace) flow.choose('medium'); else flow.choose('easy');
  const seed = parseInt(flags.seed ?? '1', 10);
  const baseWind = (x, z, t) => boatSvc.env(t).windAt(x, z, t);
  const liveMarks = () => Object.fromEntries(marks.field.marks.map((m) => [m.id, { x: m.body.p[0], z: m.body.p[2] }]));
  let seen = 0;
  const touches = () => { const out = []; for (; seen < marks.events.length; seen++) if (marks.events[seen].type === 'markTouched') out.push('mark'); return out; };
  let extras = null;
  const session = createSession({ course, tier, seed, layout, forgiving: diffById(flow.difficulty).forgiving, autoplay, baseWind, depthAt, blockedAt, liveMarks, touches, t0: core.time, onEvents: (ev) => extras?.onEvents?.(ev),
    me: { phys: sail.phys, step: (dt, ctl, t, windAt) => { sail.phys.step(dt, ctl, { ...boatSvc.env(t), windAt }); sail.ride.step(core.renderer, sail.phys.state, t, dt); } },
    wren: { phys: rival.phys, step: (dt, ctl, t, windAt) => rival.step(dt, ctl, t, windAt) } });
  // the player's wind has the rival's shadow in it too (Sail's controls read the boat service's env each tick)
  const env0 = boatSvc.env;
  boatSvc.env = (t) => { const e = env0(t); return { ...e, windAt: shadowed(e.windAt, () => [rival.phys.state]) }; };
  const doRestart = () => { session.restart(); seen = marks.events.length; marks.tracker?.reset?.(); extras?.onRestart?.(); publish(); };
  const offKey = installRestartKey({ restart: doRestart });
  const api = { course, session, get race() { return session.race; }, brain: session.brain, rival, marks, tier, seed, restart: doRestart, get log() { return session.log; }, autoplay, state: () => session.state(), get extras() { return extras; } };
  const publish = () => { services.provide('regatta', api); };
  publish();
  extras = regattaExtras?.({ core, course, sail, rival, marks, controls, api, session, flow }) ?? null;
  const fwd = { x: 0, y: 0, z: 0 }, camFwd = () => { const e = core.camera.matrixWorld.elements; fwd.x = -e[8]; fwd.y = -e[9]; fwd.z = -e[10]; return fwd; };
  let lastSim = controls ? controls.simT : session.sim;

  // headless captures: the boats at the line (no loop runs); ?racet= sails the race on to that race clock first
  const film = headless && flags.film;
  if (headless) {
    if (film && flags.racet != null) {   // ?film=1 (needs ?autoplay=1: the pro skipper sails our boat): the race clock on to racet
      const to = parseFloat(flags.racet);
      for (let guard = 0; session.race.clock < to && guard < 1500 * 60; guard++) session.step(DT);
      core.setTime?.(session.sim);
      sail.boat.update(sail.ride.step(core.renderer, sail.phys.state, session.sim, DT), 0, { t: session.sim });
    } else if (flags.racet != null) {
      const to = parseFloat(flags.racet);
      const R = new Rival({ course, tier: 'pro', seed: seed + 1, windAt: session.meWind, clear: makeClear(depthAt, 4, blockedAt), marks: liveMarks, vessel: sail.phys.vessel });
      const orig = session.step;
      let guard = 0;
      while (session.race.clock < to && guard++ < 1500 * 60) {
        const r = session.race, vm = r.view('me'), vw = r.view('wren'), sm = sail.phys.state, sw = rival.phys.state;
        R.update(DT, sm, session.ctlMe, { t: session.sim, clock: r.clock, view: vm, line: course.line, other: { x: sw.x, z: sw.z, progressM: vw.progressM, side: 1 } });
        sail.phys.step(DT, session.ctlMe, { ...boatSvc.env(session.sim), windAt: session.meWind });
        orig(DT);
      }
      core.setTime?.(session.sim);
      sail.boat.update(sail.ride.step(core.renderer, sail.phys.state, session.sim, DT), 0, { t: session.sim });
    }
    rival.step(0, session.ctlWren, session.sim, session.wrenWind); rival.draw(0, session.sim);
    if (flags.racecam === 'follow') { sail.follow.yaw = sail.phys.state.heading; sail.follow.c = [sail.phys.state.x, 0, sail.phys.state.z]; for (let i = 0; i < 180; i++) { const p = sail.follow.update(1 / 60, sail.phys.state); core.camera.position.set(...p.pos); core.camera.lookAt(...p.target); } core.camera.updateMatrixWorld(); }
    const cam = flags.racecam !== 'follow' ? flags.racecam : null;   // x,y,z,lx,ly,lz: a proof viewpoint
    if (cam) { const [x, y, z, lx, ly, lz] = cam.split(',').map(Number); core.camera.position.set(x, y, z); core.camera.lookAt(lx, ly, lz); core.camera.updateMatrixWorld(); }
    marks.update(0);
    // proofs of the first-race pieces: ?brief=1 the card; ?flowto=intro&introt=1.5 the rival intro's pan
    extras?.update?.(0); extras?.paint?.(0);
    { const pc = flow.state === 'intro' ? extras?.camera?.({}) : null; if (pc) { core.camera.position.set(...pc.pos); core.camera.lookAt(...pc.target); core.camera.updateMatrixWorld(); } }
    // ?film=1 (tools/film/run.mjs): Cruise's film contract. step(dt) sails both boats one film frame
    // (the session's fixed 60 Hz inside; the pro skipper helms ours under ?autoplay=1), pose(p) holds the scripted camera.
    if (film) {
      // the picture only: the in-world guides (Osprey's name tag, the mark label, the beacon, the start line) are UI
      { const guides = core.scene.getObjectByName('regatta-guides'); if (guides) guides.visible = false; }
      let held = null;
      const state = () => { const s = sail.phys.state, w = rival.phys.state; return { t: session.sim, clock: session.race.clock, x: s.x, z: s.z, heading: s.heading, sog: s.sog, heelDeg: s.heel / DEG, tws: s.trueWind.speed, wren: { x: w.x, z: w.z, heading: w.heading, sog: w.sog } }; };
      const hold = () => { if (!held) return; const p = held; core.camera.up.set(...(p.up ?? [0, 1, 0])); core.camera.position.set(...p.pos); core.camera.lookAt(...p.target); core.camera.fov = p.fov; if (p.near != null) core.camera.near = p.near; core.camera.updateProjectionMatrix(); core.camera.updateMatrixWorld(); };
      services.provide('film', withStepHooks({
        state,
        pose(p) { held = p; hold(); core.lod?.update?.(core.camera.position); },
        step(dt) {
          session.step(dt);
          sail.boat.update(sail.ride.step(core.renderer, sail.phys.state, session.sim, DT), dt, { t: session.sim });
          rival.draw(dt, session.sim); marks.update(dt); core.setTime(session.sim); hold(); core.lod?.update?.(core.camera.position);
          sail.air?.step(dt, session.sim, core.camera, sail.phys.state);
          return state();
        },
      }));
    }
  }

  return {
    update(dt) {
      if (autoplay) {
        const sp = parseFloat(flags.speed ?? '1'), simDt = Math.min(dt, 0.1) * sp * (extras?.rate?.() ?? 1);
        // accelerated: the physics substeps run in the same frame (the probe); the camera follows the player
        session.step(simDt);
        sail.boat.update(sail.ride.step(core.renderer, sail.phys.state, session.sim, DT), dt, { t: session.sim });
        const p = sail.follow.update(dt, sail.phys.state); core.camera.position.set(...p.pos); core.camera.lookAt(...p.target);
        const pc = extras?.camera?.({ base: { pos: core.camera.position.toArray(), target: [core.camera.position.x + camFwd().x * 60, core.camera.position.y + camFwd().y * 60, core.camera.position.z + camFwd().z * 60] } }); if (pc) { core.camera.position.set(...pc.pos); core.camera.lookAt(...pc.target); }
        core.setTime(session.sim);
      } else {
        controls?.update(dt);
        const now = controls ? controls.simT : lastSim + dt;
        session.step(Math.max(0, Math.min(now - lastSim, 0.25))); lastSim = now;
        const pc = extras?.camera?.({ base: { pos: core.camera.position.toArray(), target: [core.camera.position.x + camFwd().x * 60, core.camera.position.y + camFwd().y * 60, core.camera.position.z + camFwd().z * 60] } }); if (pc) { core.camera.position.set(...pc.pos); core.camera.lookAt(...pc.target); }
      }
      marks.update(dt); logbook?.update(); chart?.update(dt);
      rival.draw(dt, session.sim);
      extras?.update?.(dt);
    },
    dispose() {
      offKey();
      extras?.dispose?.();
      boatSvc.env = env0;
      chart?.dispose(); marks.dispose(); logbook?.dispose(); controls?.dispose(); rival.dispose(); sail.dispose();
      services.remove('regatta', api);
      services.remove('film');
    },
  };
}
