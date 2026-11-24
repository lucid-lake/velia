// The auxiliary (feat/engine-anchor, 2026-10-29): the Catalina 28 Mk II's small inboard diesel, its gearbox and its
// fixed two-blade right-hand propeller. Plain JS, no three.js: src/boat.js steps it every physics tick and reads its
// thrust, the propeller's sideways kick (prop walk) and its slipstream over the rudder; tests/engine.test.mjs.
//
// The engine: a Universal M25XP class three-cylinder diesel, ≈ 23 hp at 3,000 rpm (row "Engine":
// 23–26 hp; the owner's 21–25 hp), idling at 850 rpm, a 2.1 : 1 reduction gear, a fixed 13 × 9 in two-blade prop.
//   start(): the starter cranks for crankS, then it catches and settles to idle; stop(): the fuel cut, it runs down.
//   lever −1 … +1, one lever as on the boat (a single-lever control): inside ±detent it is neutral; past it the gear
//   engages (ahead or astern) at idle and the rest of the travel opens the throttle to full.
// The prop, an actuator disc with a linear thrust-vs-advance law (a fixed-pitch prop's KT(J) is close to a straight
// line over its working range: Carlton, "Marine Propellers and Propulsion", 4th ed., 2018, ch. 6):
//   T = Tb · n² · (1 − Va / (n · Vz))   ahead,  n = prop rpm / its full rpm, Va = u · (1 − wake)
//   Tb: the bollard pull at full throttle; Vz: the speed of advance at which the full-rpm prop gives no thrust.
//   Astern a fixed prop works on its back face: × asternK of the ahead thrust (≈ 0.6 for a two-blade fixed prop).
// Prop walk (the "paddle wheel" effect of a right-hand prop: the lower blade bites harder): a sideways force at the
// prop, astern 18 % of the thrust with the stern to PORT (bow to starboard), fading to 5 % once the boat makes 1.5 m/s
// of sternway (the rudder then has flow); ahead 2 % to starboard. Typical for a 28–32 ft sloop (RYA "Motor Cruising";
// Sweet, "The Complete Guide to Boat Handling", the C27–C30 owners' notes: "she backs to port").
// The slipstream: momentum theory gives the far wake speed Vs = √(Va² + 2T / (ρ·A)); the rudder sits about a diameter
// aft, where the stream has reached ≈ 80 % of its contraction, and about washFrac of the rudder's area is in it.
import { CURRENT_VESSEL } from '../vessels/current.js';

const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';
import { smooth } from '../core/math.js';

// The numbers are the boat profile's (src/vessels/<id>.json engine); ENGINE is this page's boat's:
//   hp 23, rpmIdle 850, rpmMax 3000, reduction 2.1; propD 0.33, propPitch 0.229 (m: 13 in × 9 in); bollardN 1450 (the
//   full-throttle bollard pull, N); vZero 6.6 (m/s: the full-rpm prop's zero-thrust advance, ≈ 1.2 × its pitch speed,
//   5.4 m/s); wake 0.12 (the Taylor wake fraction: a fin-keel hull, the prop in the keel's lee); asternK 0.6; walkAstern
//   [0.18, 0.05], walkFadeMs [0.3, 1.5], walkAhead 0.02; propX −2.6, propZ −0.9 (body frame: m forward of the waterline
//   centre, aft is −; m above the water); washFrac 0.4, washReach 0.8; detent 0.08 (the lever's neutral band); crankS
//   1.1, spoolUpS 0.7, spoolDownS 1.1, rundownS 1.6; idleCreepKn null (filled by the tests' steady runs: ≈ 2.3 kn in
//   gear at idle); fuelLph [0.6, 4.0] (l/h at idle and at full: a 23 hp diesel, ≈ 0.2 l/kWh).
export const ENGINE = CURRENT_VESSEL.engine;

// the lever's gear and throttle: { gear: −1 | 0 | 1, throttle: 0..1 }
export function leverToGear(lever, P = ENGINE) {
  const a = Math.abs(lever ?? 0);
  if (a < P.detent) return { gear: 0, throttle: 0 };
  return { gear: Math.sign(lever), throttle: clamp((a - P.detent) / (1 - P.detent), 0, 1) };
}

// thrust (N, + ahead) of the prop at rpm (engine rpm), gear, and the boat's surge u (m/s)
export function propThrust(rpm, gear, u, P = ENGINE) {
  if (!gear || rpm <= 0) return 0;
  const n = rpm / P.rpmMax;
  if (gear > 0) {
    const va = u * (1 - P.wake);
    return Math.max(-0.3 * P.bollardN * n * n, P.bollardN * n * n * (1 - va / (n * P.vZero)));
  }
  const va = -u * (1 - P.wake);   // sternway is the astern prop's advance
  return -P.asternK * Math.max(-0.3 * P.bollardN * n * n, P.bollardN * n * n * (1 - va / (n * P.vZero * 0.9)));
}

// the sideways force at the prop (N, + to starboard) for a thrust T and surge u
export function propWalk(T, u, P = ENGINE) {
  if (T < 0) return -Math.abs(T) * (P.walkAstern[0] + (P.walkAstern[1] - P.walkAstern[0]) * smooth(P.walkFadeMs[0], P.walkFadeMs[1], -u));
  return T * P.walkAhead;
}

// the slipstream's speed at the rudder (m/s), ahead only (astern the stream goes forward, away from the rudder)
export function washAtRudder(T, u, P = ENGINE) {
  if (T <= 0) return Math.max(0, u);
  const A = Math.PI * P.propD * P.propD / 4, va = Math.max(0, u * (1 - P.wake));
  const vs = Math.sqrt(va * va + 2 * T / (1025 * A));
  return va + P.washReach * (vs - va);
}

export class Engine {
  constructor(P = ENGINE) {
    this.P = P;
    this.on = false;          // the fuel on (running or cranking)
    this.cranking = 0;        // s of cranking left
    this.rpm = 0;
    this.lever = 0;           // −1 … +1, the helm's single lever
    this.hours = 0;           // engine-on time, s
    this.starts = 0;
  }
  get running() { return this.on && this.cranking <= 0 && this.rpm > 0.5 * this.P.rpmIdle; }
  get state() { return this.on ? (this.cranking > 0 ? 'cranking' : 'running') : this.rpm > 1 ? 'stopping' : 'off'; }
  start() { if (this.on) return false; this.on = true; this.cranking = this.P.crankS; this.starts++; return true; }
  stop() { if (!this.on) return false; this.on = false; this.cranking = 0; return true; }
  toggle() { return this.on ? (this.stop(), false) : (this.start(), true); }
  setLever(v) { this.lever = clamp(v, -1, 1); }

  // one physics tick: the rpm toward its target; returns { rpm, gear, throttle, load 0..1 }
  step(dt, lever = this.lever) {
    const P = this.P;
    this.lever = clamp(lever ?? 0, -1, 1);
    const { gear, throttle } = leverToGear(this.lever, P);
    let target;
    if (!this.on) target = 0;
    else if (this.cranking > 0) { this.cranking -= dt; target = 220; }          // the starter's 200-odd rpm
    else target = P.rpmIdle + (P.rpmMax - P.rpmIdle) * throttle;
    const tau = !this.on ? P.rundownS / 3 : target > this.rpm ? P.spoolUpS : P.spoolDownS;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / tau));
    if (!this.on && this.rpm < 1) this.rpm = 0;
    if (this.on) this.hours += dt;
    // a running engine in gear at idle loads a little; the throttle's share is the rest
    this.gear = this.on && this.cranking <= 0 ? gear : 0;
    this.throttle = throttle;
    return { rpm: this.rpm, gear: this.gear, throttle };
  }
}

// What the physics needs this tick: { thrust N, walk N (at the prop, + starboard), wash m/s at the rudder }
export function propForces(engine, u) {
  const T = propThrust(engine.rpm, engine.gear ?? 0, u, engine.P);
  return { thrust: T, walk: propWalk(T, u, engine.P), wash: washAtRudder(T, u, engine.P) };
}
export { DEG };
