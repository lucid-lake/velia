// The pure simulation (refactor Phase 2 step 5; the base for multiplayer): step(dt, inputs) → state. The boats' physics
// (each boat's craft builds it: src/craft/index.js craftOf(vessel); a sloop's is src/boat.js BoatPhysics), the fixed
// 1/60 s tick (stepper.js), the sim clock and the inputs as plain data; the world
// (the wind sampled at a point, the waves, the bottom, the ground tackle) comes in through each boat's env(t). No DOM, no
// camera, no window: Sail's controls, Cruise's pilot, Regatta's session, the headless voyages and races and the tests all
// step their boats here, and the live modes draw from its state.
//
//   const sim = createSimulation({ boat: { start: { x, z, heading, speed }, env: (t) => ({ t, windAt }) }, t0 });
//   sim.step(simDt, inputs)           // whole ticks of simDt (the remainder carries); → the boat's state
//   sim.alpha                         // the remainder in ticks: the drawn pose between the last two (src/boat/interp.js)
//   const data = sim.snapshot();      // plain data: the clock, the accumulator, each boat's physics and tackle
//   const again = restoreSimulation(encodeState(data) → decodeState(…), { boat: { env } })   // steps on bit for bit
//
// Inputs (plain data, src/boat.js CONTROLS): the helm (rudder −1..1), the sheets (sheet, sheetBias, main, jib, jibTrim,
// jibSide), the sails (furl 0 up … 1 down), the reef, pro trim (traveller, twist, backstay, jibLead), the engine (engine:
// true on / false off / absent as it is; throttle: the lever −1..1), the anchor (anchor: true down / false up / absent as
// it is; needs the boat's tackle) and the assists (autoTrim, autoReef, autoWing). A fleet takes { [id]: inputs }; a boat
// with no inputs this tick is not stepped (Regatta's own boat while Sail's controls sail it).
// clock: 'start' a tick runs at the time it starts, then t += dt (Sail, Cruise); 'end' t += dt, then the tick (the
// Regatta session); 'index' t = t0 + n dt, no running sum (the headless voyages and races).
import { DT } from '../boat.js';
import { createStepper } from './stepper.js';
import { CURRENT_VESSEL } from '../vessels/current.js';
import { craftOf, vesselFor } from '../craft/index.js';
import { plain, assign } from '../craft/plain.js';

// tackleEnv: the ground tackle's forces on a world env (moved to ./tackleEnv.js, a pure seam both engines share; re-exported here)
import { tackleEnv } from './tackleEnv.js';
export { tackleEnv };

// the engine and the anchor from the inputs, before a tick: levels, acted on when they differ from the boat's (a craft
// with no engine, a kayak, skips the engine)
function applyCommands(b, c) {
  const eng = b.phys.engine;
  if (eng) {
    if (c.engine === true && !eng.on) eng.start();
    else if (c.engine === false && eng.on) eng.stop();
  }
  if (b.tackle && c.anchor != null && c.anchor !== b.anchor) {
    b.anchor = c.anchor;
    if (c.anchor && b.tackle.mode === 'free') b.tackle.drop(b.phys.state);
    else if (!c.anchor && b.tackle.mode === 'anchor') b.tackle.weigh();
  }
}

// boat: one boat (the inputs are its controls); boats: a fleet [{ id, … }] (the inputs are { [id]: controls }).
// Each boat: phys (its craft's stepper: a BoatPhysics for a sloop) or start { x, z, heading, speed } (+ params, + vessel: the
// profile, this page's boat by default; its craft builds the physics); env(t, id) → the physics' env; tackle (a
// createTackle(): the anchor as an input, its forces in the env); step(dt, inputs, t) in place of the physics' own (an
// adapter that also floats a drawn hull: Regatta's).
export function createSimulation({ boat = null, boats = null, t0 = 0, dt = DT, clock = 'start', maxSteps = Infinity } = {}) {
  const single = !!boat;
  const list = (single ? [{ id: 'boat', ...boat }] : boats).map((b) => ({
    id: b.id, env: b.env ?? null, step: b.step ?? null, tackle: b.tackle ?? null, anchor: null, params: b.params ?? null,
    phys: b.phys ?? physicsFor(b),
  }));
  const byId = Object.fromEntries(list.map((b) => [b.id, b]));
  const stepper = createStepper({ dt, maxSteps });
  let t = t0, n = 0;
  const envOf = (b, tt) => { const e = b.env(tt, b.id); return b.tackle ? tackleEnv(e, b.tackle) : e; };

  // one tick: begin(t) once; then for each boat in order before(id, t, inputs, phys) (a helm writes its inputs: the AI
  // skipper, Cruise's pilot; the drawn pose's interpolation marks the state) and its physics; after(t) once all have
  // stepped (the race's rules)
  function tick(inputs, hooks = {}) {
    const tt = clock === 'end' ? (t += dt) : clock === 'index' ? t0 + n * dt : t;
    hooks.begin?.(tt);
    for (const b of list) {
      const c = single ? inputs : inputs?.[b.id];
      hooks.before?.(b.id, tt, c, b.phys);
      if (!c) continue;
      applyCommands(b, c);
      if (b.step) b.step(dt, c, tt); else b.phys.step(dt, c, envOf(b, tt));
    }
    hooks.after?.(tt);
    n++;
    if (clock === 'start') t += dt; else if (clock === 'index') t = t0 + n * dt;
    return tt;
  }

  const sim = {
    dt, clock, boats: list, stepper,
    get t() { return t; }, set t(v) { t = v; },   // Cruise's hand-back: the clock as Sail's controls left it
    get ticks() { return n; },
    get acc() { return stepper.acc; }, set acc(v) { stepper.acc = v; },
    get alpha() { return stepper.alpha; },
    get phys() { return list[0].phys; },
    get state() { return single ? list[0].phys.state : Object.fromEntries(list.map((b) => [b.id, b.phys.state])); },
    boat: (id) => byId[id],
    tick,
    // simDt (s) of sim time in whole ticks (the remainder carries); hooks as tick(); → the state
    step(simDt, inputs, hooks = {}) { stepper.advance(simDt, () => tick(inputs, hooks)); return sim.state; },
    snapshot() {
      return { v: 1, t, n, acc: stepper.acc, dt, clock, t0,
        boats: list.map((b) => ({ id: b.id, params: b.params, physics: snapshotPhysics(b.phys), ...(b.tackle ? { tackle: snapshotTackle(b.tackle), anchor: b.anchor } : {}) })) };
    },
    restore(data) {
      if (data?.v !== 1) throw new Error('simulation: unknown snapshot');
      t = data.t; n = data.n; stepper.acc = data.acc;
      for (const s of data.boats) {
        const b = byId[s.id] ?? (single ? list[0] : null);
        if (!b) throw new Error(`simulation: no boat ${s.id}`);
        b.phys = restorePhysics(s.physics, s.params ?? b.params ?? {});
        if (s.tackle && b.tackle) { restoreTackle(b.tackle, s.tackle); b.anchor = s.anchor ?? null; }
      }
      return sim;
    },
  };
  return sim;
}

// a boat's physics from its start: its profile's craft builds it (src/craft/index.js)
function physicsFor(b) {
  const vessel = b.vessel ?? CURRENT_VESSEL;
  return craftOf(vessel).createPhysics({ ...b.start, params: b.params ?? {}, vessel });
}

// a new Simulation from a snapshot: the same boats (by id) with the world's env (and tackle) passed in again
export function restoreSimulation(data, { boat = null, boats = null, maxSteps = Infinity } = {}) {
  const ids = data.boats.map((b) => b.id);
  const sim = createSimulation({ ...(boat ? { boat: { ...boat, start: {} } } : { boats: ids.map((id) => ({ id, start: {}, ...(boats?.find((b) => b.id === id) ?? {}) })) }), t0: data.t0, dt: data.dt, clock: data.clock, maxSteps });
  return sim.restore(data);
}

// ---- the state as plain data -------------------------------------------------------------------------------------
// The physics' whole state (a sloop's src/boat.js BoatPhysics: its public state, the sails' and the reef's memory, the
// thrill cues, the engine). Not P (the boat's constants: params rebuild them) nor the per-tick scratch; the profile is
// kept by its id (vesselId), which also names the craft (src/craft/plain.js plain, assign).
export function snapshotPhysics(phys) { return { ...plain(phys), vesselId: phys.vessel?.id ?? null }; }
// the boat by its id (a craft's own profile, this page's boat, else the registry's: src/craft/index.js vesselFor), into a
// fresh stepper of its craft with the snapshot's plain fields set
export function restorePhysics({ vesselId = null, ...data }, params = {}) { const v = vesselFor(vesselId); return craftOf(v).restorePhysics(data, params, v); }

// the tackle's state (src/boat/tackle.js): a mooring ball as its index in the tackle's list
function snapshotTackle(tk) {
  const st = tk.state;
  return { ...plain({ ...st, ball: null }), ball: st.ball ? tk.balls.indexOf(st.ball) : null };
}
function restoreTackle(tk, data) {
  const st = tk.state;
  assign(st, { ...data, ball: null });
  st.ball = data.ball != null && data.ball >= 0 ? tk.balls[data.ball] : null;
}

// JSON that keeps every number's bits: −0, ±Infinity and NaN, which JSON.stringify turns into 0 and null
export function encodeState(data) {
  return JSON.stringify(data, (k, v) => (typeof v === 'number' && (Object.is(v, -0) || !Number.isFinite(v)) ? { $n: Object.is(v, -0) ? '-0' : String(v) } : v));
}
export function decodeState(text) {
  return JSON.parse(text, (k, v) => (v && typeof v === 'object' && typeof v.$n === 'string' && Object.keys(v).length === 1 ? (v.$n === '-0' ? -0 : Number(v.$n)) : v));
}
