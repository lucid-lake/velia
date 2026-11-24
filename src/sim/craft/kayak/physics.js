// The kayak's physics (refactor round 2, Phase C step 5): the lake fleet's
// hull model (src/kayaks/agent.js stepHull: m·dv/dt = F − k·v·|v| − c·v, I·dr/dt = M − D·r, the gaits eased toward the
// intent) behind the Simulation's stepper interface, so a kayak steps where a sloop does. One tick = one stepHull on the
// plain paddler record `a`, in whole 1/60 s ticks with the remainder carried (as BoatPhysics). The fleet keeps calling
// stepHull on its own agents: one hull model, held equal by tests/craftKayak.test.mjs.
//   const k = new KayakPhysics({ x, z, heading, speed });   k.step(dt, { throttle, turn }, env)   → k.state
// inputs: the paddler's intent (agent.js): throttle −1..1 (cruise 0.5, sprint 1, back −0.6, rest 0), turn −1..1 (the
// fleet's sign). env: only env.t is read today (waves and wind on a kayak are later work).
// state: { x, z, heading, u (the hull's surge, m/s), v: 0, yawRate (rad/s), heel: 0, sog, cog, throttle, turn, phase }.
// The snapshot (src/sail/simulation.js snapshotPhysics) keeps every own field: `a` holds only numbers and plain objects.
import { stepHull, GAIT } from '../../kayaks/agent.js';
import { targetWeights } from '../../props/paddler/motion.js';
import { assign } from '../plain.js';
import KAYAK_VESSEL from '../../../craft/kayak/vessel.json' with { type: 'json' };

const DT = 1 / 60;   // the physics tick (src/boat.js DT; not imported: the kayak needs nothing of the sloop's)
import { wrap } from '../../core/math.js';
export const KAYAK_INPUTS = Object.freeze({ throttle: 0, turn: 0 });

export class KayakPhysics {
  // x, z m; heading rad (ahead is (sin h, −cos h)); speed m/s (the surge at the start); vessel: the kayak's profile.
  // The Simulation's params are accepted and unused (the hull's numbers are the profile's: agent.js HULL)
  constructor({ x = 0, z = 0, heading = 0, speed = 0, vessel = KAYAK_VESSEL } = {}) {
    this.vessel = vessel;
    this.t = 0;
    this.acc = 0;
    const intent = { throttle: 0, turn: 0 };
    const w = Object.fromEntries(Object.keys(GAIT).map((g) => [g, 0])), tw = targetWeights(intent);
    for (const g of Object.keys(w)) w[g] = tw[g] ?? 0;
    this.a = { x, z, heading, v: speed, r: 0, w, wm: { ...w }, phase: 0, intent, turning: 0 };
    this.state = { x, z, heading, u: speed, v: 0, yawRate: 0, heel: 0, sog: Math.abs(speed), cog: speed < 0 ? wrap(heading + Math.PI) : heading, throttle: 0, turn: 0, phase: 0 };
  }

  step(dt, inputs = KAYAK_INPUTS, env = null) {
    this.acc += dt;
    const it = this.a.intent;
    while (this.acc >= DT - 1e-9) {
      it.throttle = inputs?.throttle ?? 0; it.turn = inputs?.turn ?? 0;
      stepHull(this.a, DT, it);
      this.t = (env?.t ?? this.t) + DT;
      this.acc -= DT;
    }
    return this.mirror();
  }

  // the state from the paddler record (u = v_hull, yawRate = r)
  mirror() {
    const a = this.a, s = this.state;
    s.x = a.x; s.z = a.z; s.heading = a.heading; s.u = a.v; s.yawRate = a.r;
    s.sog = Math.abs(a.v); s.cog = a.v < 0 ? wrap(a.heading + Math.PI) : a.heading;
    s.throttle = a.intent.throttle; s.turn = a.intent.turn; s.phase = a.phase;
    return s;
  }
}

export const createPhysics = (o) => new KayakPhysics(o);
export const restorePhysics = (data, params, vessel) => assign(new KayakPhysics({ params, vessel }), data);
