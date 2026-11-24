// The Regatta session: everything about a race that is not drawing. The course, the rules (src/race/rules.js), the
// rival's mind (src/race/rival.js) and the restart, over two boats the caller hands in as small adapters, so a node test runs it
// on the real BoatPhysics with no GPU. src/modes/regatta/index.js draws it.
//   const s = createSession({ course, me: { phys, step? }, wren: { phys, step }, baseWind, tier, seed, liveMarks, autoplay });
//   s.step(simDt)            // advance the world by simDt seconds of sim time (the shared Simulation's fixed 60 Hz: src/sail/simulation.js)
//   s.restart()              // R: back to -60 s in one call
//   s.race, s.brain, s.log   // the live Race (replaced on restart), the rival's Rival, the events with clocks
import { CONTROLS, DT } from '../../../../src/sim/boat.js';
import { createRace } from '../../../../src/sim/race/rules.js';
import { Rival, makeClear, TIERS } from '../../../../src/sim/race/rival.js';
import { shadowed } from '../../../../src/sim/race/dirtyAir.js';
import { startPoses } from '../../../../src/sim/race/sim.js';
import { hullContact } from '../../../../src/sim/race/contact.js';
import { createSimulation } from '../../../../src/sim/sail/simulation.js';
import { CURRENT_VESSEL } from '../../../../src/sim/vessels/current.js';

const DEG = Math.PI / 180;
export const BOATS = [   // the player's boat carries its profile's name
  { id: 'me', kind: 'player', name: CURRENT_VESSEL.name },
  { id: 'wren', kind: 'ai', name: 'Osprey', sail: 17 },
];
const poseOf = (phys) => { const s = phys.state; return { x: s.x, z: s.z, heading: s.heading, u: s.u }; };

export function createSession({ course, me, wren, baseWind, depthAt = null, blockedAt = null, tier = 'medium', seed = 1, autoplay = false, liveMarks = null, touches = () => [], onEvents = null, t0 = 0, prestartS = 60, layout = null, forgiving = false } = {}) {
  const windFrom = course.designWindFrom * DEG;
  const marks = liveMarks ?? (() => Object.fromEntries([...course.marks.map((m) => [m.id, { x: m.at[0], z: m.at[1] }]), ['committee', { x: course.line.committee[0], z: course.line.committee[1] }], ['pin', { x: course.line.pin[0], z: course.line.pin[1] }]]));
  const [me0, wren0] = startPoses(course, windFrom, ['me', 'wren'], layout ?? {});
  const clear = depthAt ? makeClear(depthAt, 4, blockedAt) : null;   // blockedAt: the show's props (src/fireworks/solids.js)
  const wrenWind = shadowed(baseWind, () => [me.phys.state]);
  const meWind = shadowed(baseWind, () => [wren.phys.state]);
  // each brain sails its own boat (its physics' vessel: the polar it reads)
  const brain = new Rival({ course, tier: TIERS[tier] != null ? tier : 'medium', seed, windAt: wrenWind, clear, marks, vessel: wren.phys.vessel });
  const playerBrain = autoplay ? new Rival({ course, tier: 'pro', seed: seed + 1, windAt: meWind, clear, marks, vessel: me.phys.vessel }) : null;
  const ctlMe = { ...CONTROLS }, ctlWren = { ...CONTROLS };
  const S = { forgiving, paused: false, race: null, log: [], seen: 0, restarts: 0 };
  // the two boats on the shared Simulation: the clock runs on before each tick ('end'); ours steps only while the AI sails it
  const sim = createSimulation({ t0, clock: 'end', boats: [
    { id: 'me', phys: me.phys, step: (dt, c, t) => me.step(dt, c, t, meWind) },
    { id: 'wren', phys: wren.phys, step: (dt, c, t) => wren.step(dt, c, t, wrenWind) }] });
  const newRace = () => createRace({ course, boats: BOATS, marks, prestartS, forgiving: S.forgiving });
  S.race = newRace();

  const place = (phys, p) => { const s = phys.state; Object.assign(s, { x: p.x, z: p.z, heading: p.heading, u: p.speed, v: 0, yawRate: 0, heel: 0, pitch: 0, rudderAngle: 0 }); };
  function restart() {
    place(me.phys, me0); place(wren.phys, wren0);
    S.race = newRace();
    for (const b of [brain, playerBrain]) if (b) { b.sk.startCommitted = false; b.sk.man = null; b.sk.side = 1; b.sk.helm.i = 0; b.mark = null; b.j = 0; b.delta = 0; b.phase = 'prestart'; b.sk.setSkill(b.base); }
    sim.acc = 0; S.restarts++; S.log.length = 0;
    return S.race;
  }

  // difficulty (the briefing card): the rival's tier and whether the race forgives (Easy); rebuilds the race at -60 s
  function setDifficulty(tierName, forgive) {
    brain.tier = tierName; brain.base = TIERS[tierName] ?? brain.base; brain.sk.setSkill(brain.base); S.forgiving = !!forgive; restart();
  }
  // one tick: the views at its start; each brain then its boat (the AI on ours first, under ?autoplay); the hulls' contact
  // and the race's rules once both have moved
  let race = null, vm = null, vw = null;
  const inputs = { me: playerBrain ? ctlMe : null, wren: ctlWren };
  const hooks = {
    begin() { race = S.race; vm = race.view('me'); vw = race.view('wren'); },
    before(id, t) {
      const sm = me.phys.state, sw = wren.phys.state;
      if (id === 'me') playerBrain?.update(DT, sm, ctlMe, { t, clock: race.clock, view: vm, line: course.line, other: { x: sw.x, z: sw.z, progressM: vw.progressM, side: Math.sign(sw.trueWind?.angle || 1) } });
      else brain.update(DT, sw, ctlWren, { t, clock: race.clock, view: vw, line: course.line, other: { x: sm.x, z: sm.z, progressM: vm.progressM, side: Math.sign(sm.trueWind?.angle || 1) } });
    },
    after() {
      const sm = me.phys.state, sw = wren.phys.state, ev = [];
      // the two hulls are solid to each other (fix/no-poor-props: the rival had been a ghost); the rules' own contact check follows
      const hit = hullContact(sm, sw);
      if (hit) { S.contacts = (S.contacts ?? 0) + 1; S.maxPen = Math.max(S.maxPen ?? 0, hit.pen); }
      for (const kind of touches()) { const p = race.touch('me', kind); if (p) ev.push(p); }
      ev.push(...race.step(DT, { me: poseOf(me.phys), wren: poseOf(wren.phys) }, { windFrom }));
      if (ev.length) { for (const e of ev) S.log.push({ ...e, clock: race.clock }); onEvents?.(ev); }
    },
  };
  function step(simDt) {
    if (S.paused) return;
    sim.step(simDt, inputs, hooks);
  }

  return { get race() { return S.race; }, get paused() { return S.paused; }, set paused(v) { S.paused = !!v; }, setDifficulty, get forgiving() { return S.forgiving; }, brain, playerBrain, log: S.log, step, restart, course, windFrom, me0, wren0, meWind, wrenWind, get sim() { return sim.t; }, simulation: sim, get restarts() { return S.restarts; }, get contacts() { return { n: S.contacts ?? 0, maxPen: S.maxPen ?? 0 }; }, ctlMe, ctlWren,
    state() { const r = S.race; return { clock: r.clock, phase: r.phase, done: r.done, order: r.order(), me: r.view('me'), wren: r.view('wren'), player: poseOf(me.phys), wrenPose: poseOf(wren.phys) }; } };
}

// R restarts the race, unless a text field has the keyboard; returns the remover (the mode's dispose calls it)
export function installRestartKey(session, { target = globalThis } = {}) {
  const f = (e) => { if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA/.test(e.target?.tagName ?? '')) session.restart(); };
  target.addEventListener('keydown', f);
  return () => target.removeEventListener('keydown', f);
}
