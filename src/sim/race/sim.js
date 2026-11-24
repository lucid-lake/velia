// A headless race: the real BoatPhysics, the real wind field (or any windAt), the rules, and two AI skippers (the player's
// boat can be sailed by the AI too, to finish). Plain JS, no GPU. For the tests and the live probe (tools/regatta-probe.mjs).
//   const r = runRace({ course, windAt, depthAt, tiers: { me: 'pro', wren: 'medium' }, seed: 3, maxS: 900 });
//   → { order, finish: { id: t }, events, clock, race, track }
import { BoatPhysics, CONTROLS, DT } from '../boat.js';
import { createRace } from './rules.js';
import { Rival, makeClear } from './rival.js';
import { shadowed } from './dirtyAir.js';
import { createSimulation } from '../sail/simulation.js';

const DEG = Math.PI / 180;

// the two boats' start: 50 m below the line, on starboard tack at 3 kn, spread along the line
export function startPoses(course, windFromRad, ids, { a: along = null } = {}) {   // a: each boat's place along the line (0 the pin, 1 the committee boat)
  const L = course.line, down = [-L.up[0], -L.up[1]], h = windFromRad - 45 * DEG;
  return ids.map((id, i) => {
    const a = along?.[i] ?? (i + 1) / (ids.length + 1), x = L.pin[0] + (L.committee[0] - L.pin[0]) * a + down[0] * 50, z = L.pin[1] + (L.committee[1] - L.pin[1]) * a + down[1] * 50;
    return { id, x, z, heading: h, speed: 1.54 };
  });
}

export function runRace({ course, windAt, depthAt = null, tiers = { me: 'pro', wren: 'medium' }, seed = 1, maxS = 1000, prestartS = 60, onTick = null, stopWhenDone = true, players = null } = {}) {
  const ids = Object.keys(tiers), windFrom = course.designWindFrom * DEG;
  const race = createRace({ course, boats: ids.map((id) => ({ id, kind: 'ai', name: id })), prestartS });
  const poses = startPoses(course, windFrom, ids);
  const phys = Object.fromEntries(poses.map((p) => [p.id, new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed })]));
  const ctl = Object.fromEntries(ids.map((id) => [id, { ...CONTROLS }]));
  const wat = Object.fromEntries(ids.map((id) => [id, shadowed(windAt, () => ids.filter((o) => o !== id).map((o) => phys[o].state))]));
  const clear = depthAt ? makeClear(depthAt) : null;
  const brain = Object.fromEntries(ids.map((id, i) => [id, new Rival({ course, tier: tiers[id], seed: seed * 7 + i, windAt: wat[id], clear })]));
  const out = { events: [], finish: {}, track: Object.fromEntries(ids.map((id) => [id, []])), skills: Object.fromEntries(ids.map((id) => [id, []])) };
  const n = Math.round((maxS + prestartS) / DT);
  // the fleet on the shared Simulation (src/sail/simulation.js), its clock t = i × DT; each brain helms before its boat steps
  const sim = createSimulation({ clock: 'index', boats: ids.map((id) => ({ id, phys: phys[id], env: (t) => ({ t, windAt: wat[id] }) })) });
  let clock = 0;
  const hooks = {
    begin() { clock = race.clock; },
    before(id, t) {
      const other = ids.find((o) => o !== id), v = race.view(id), ov = race.view(other), so = phys[other]?.state;
      brain[id].update(DT, phys[id].state, ctl[id], { t, clock, view: v, line: course.line, other: ov ? { x: so.x, z: so.z, progressM: ov.progressM, side: Math.sign(so.trueWind?.angle || 1) } : null });
    },
  };
  for (let i = 0; i < n && !race.done; i++) {
    sim.tick(ctl, hooks);
    const P = {}; for (const id of ids) { const s = phys[id].state; P[id] = { x: s.x, z: s.z, heading: s.heading, u: s.u }; }
    const ev = race.step(DT, P);
    for (const e of ev) { out.events.push({ ...e, clock: race.clock }); if (e.type === 'finished') out.finish[e.id] = e.t; }
    if (i % 60 === 0) for (const id of ids) { out.track[id].push([P[id].x, P[id].z]); out.skills[id].push(brain[id].skill); }
    onTick?.(race, P, brain);
  }
  return { ...out, race, order: race.order(), clock: race.clock, phys, brain };
}
