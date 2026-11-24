// A kayak's roll and capsize (feat/v2-kayak-capsize): the hull's roll about its long axis as one rigid body in the water,
// whoever paddles it (the fleet's kayakers today; a player's kayak later). Plain JS, no GPU, no DOM; deterministic (the
// kayak's seed, the scene's clock). No allocation in step().
//
//   const R = createRoll({ seed, skill })   skill 0–1: the chance this paddler rolls back up (an Eskimo roll) rather than
//                                           swimming out (a wet exit), drawn once from the seed
//   rollImpulse(R, L)                       an angular impulse about the long axis (N·m·s, + lifts the starboard side):
//                                           a bump's sideways impulse times its height over the roll centre (ROLL.hitH)
//   stepRoll(R, dt, env)                    env: { slope (rad, the water's slope across the beam, + starboard up),
//                                           windMs, boat (the boat's bearing from the kayak, rad in the kayak's heading
//                                           frame, or null) }; then R.phi (rad), R.mode, R.busy, R.events (this step's)
//   R.sw   the swimmer's pose when out of the cockpit (kayak heading frame: off + to starboard, fz + aft; h the neck over
//          the water; tilt + leaning back; yaw the facing; arms, wave, shake 0–1; hold 0–1 the paddle in hand), or vis 0
//   R.hold s the swimmer waits holding the paddle beside the upturned hull before righting it (0: at once; the fleet sets and counts it)
//   R.pd   the paddle when let go (heading frame: x, z; yaw; free 0–1 off the hands and flat on the water)
//
// The roll: I·φ'' = M(φ) − c·φ' − q·φ'|φ'| + M_ext. M(φ) is the hull's righting moment (a smooth GZ curve: −K·sin φ·(cos φ
// − cos φv)/(1 − cos φv), zero at upright, at the vanishing angle φv and upside down). With the paddler aboard (a high
// centre of mass) φv ≈ 55° and past it the moment drives the kayak over, weakly (the paddler's body in the water carries
// most of its weight); the empty hull (the paddler out) is stable both ways up, φv ≈ 100°: it floats upside down until
// someone rights it. The two curves (and the inertias, the damping) blend by how much of the paddler is aboard.
// Recovery is never grim: a skilled paddler hangs a moment, then sweeps and hip-snaps back up (the sweep's moment through
// the same equation); the rest swim out, surface beside the hull, shake the water off, wave, take the paddle back, right
// the hull (a push through the empty hull's barrier) and climb back in over the side (their weight heels the hull).
import { mulberry32 } from '../../src/sim/core/rng.js';
import { hash01 } from '../../src/sim/kayaks/plan.js';

const DEG = Math.PI / 180;
export const ROLL = Object.freeze({
  // aboard: kayak + paddler (108 kg) about the roll centre, with the water's added inertia: I kg·m², K N·m/rad (a 1.1 s
  // roll period, the wash's: contact.js WAKE), the vanishing angle, the moment past it (× over), linear and quadratic damping
  occ: Object.freeze({ I: 14, K: 600, v: 55 * DEG, over: 0.15, c: 22, q: 2 }),
  // the empty hull (≈ 22 kg): a ≈ 0.95 s period, stable upside down
  empty: Object.freeze({ I: 2.5, K: 110, v: 100 * DEG, over: 1, c: 8, q: 3 }),
  hitH: 0.32,        // m: a bump's height over the roll centre (the sailboat's bow flare on the deck and the paddler)
  yc: 0.13,          // m: the roll centre's height in the kayak's frame (≈ its waterline)
  lift: 0.06,        // m: the empty hull floats this much higher than with its paddler
  overDeg: 95,       // past this the kayak has gone over (the capsize event)
  // a breaking crest's slap (rare): only in wind over windMin, full at windFull, with the kayak beam-on to steep water
  // (its slope across the beam over slopeMin, full at slopeFull); a rate per second at full; the slap's angular impulse
  wave: Object.freeze({ windMin: 7, windFull: 11, slopeMin: 0.05, slopeFull: 0.14, rate: 1 / 200, L: 95 }),
  // the recovery's beats (s) and its moments (N·m)
  hang: 1.3,         // an Eskimo roll: upside down before the sweep
  sweepT: 1.0, sweepM: 430,   // the sweep and hip snap: its length, its peak moment
  exitT: 0.9,        // a wet exit: upside down before the paddler is out
  surfaceT: 1.4, shakeT: 1.6, waveT: 1.8, grabT: 1.2,
  rightM: 75, rightT: 2.2,     // righting the empty hull from the water: the push's moment, at most this long
  climbT: 3.0, climbW: 840,    // climbing back in: its length; the climber's weight (N), on the gunwale as it leaves the water
  settleT: 1.6,
});

import { wrap } from '../../src/sim/core/math.js';
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
import { smooth } from '../../src/sim/core/math.js';

// the hull's righting moment at roll φ (N·m) for one curve
export function righting(phi, P) {
  const p = wrap(phi), c = Math.cos(P.v), m = -P.K * Math.sin(p) * (Math.cos(p) - c) / (1 - c);
  return Math.abs(p) > P.v ? m * P.over : m;
}
// the energy to roll from upright to the vanishing angle (J): a bump's threshold (the tests')
export function barrier(P = ROLL.occ) {
  const c = Math.cos(P.v);
  return P.K / (1 - c) * (Math.sin(P.v) ** 2 / 2 - c * (1 - Math.cos(P.v)));
}

// a critically damped follow (a spring that does not overshoot) or a light one (ζ < 1: the swimmer's bob as it surfaces)
function spring(s, k, target, dt, w = 6, z = 1) {
  const x = s[k], v = s[k + 'V'] ?? 0, a = w * w * (target - x) - 2 * z * w * v;
  s[k + 'V'] = v + a * dt; s[k] = x + s[k + 'V'] * dt;
}

export function createRoll({ seed = 1, skill = 0.3 } = {}) {
  return {
    phi: 0, w: 0, mode: 'up', t: 0, side: 1, aboard: 1, kind: hash01(seed, 4711) < skill ? 'roll' : 'swim', tries: 0,
    rng: mulberry32((Math.imul(seed | 0, 2654435761) ^ 0x6b61) >>> 0), events: [], ext: 0, hold: 0, capsizes: 0, slaps: 0, since: 1e9,
    sw: { vis: 0, side: 1, off: 0, offV: 0, fz: 0.25, fzV: 0, h: -0.7, hV: 0, tilt: 0.45, tiltV: 0, yaw: 0, yawV: 0, arms: 1, armsV: 0, wave: 0, waveV: 0, shake: 0, shakeV: 0, hold: 0, holdV: 0, ph: 0, climb: 0, mix: 0 },
    pd: { x: 0, z: -0.1, vx: 0, vz: 0, yaw: 0, r: 0, free: 0, freeV: 0 },
    get busy() { return this.mode !== 'up'; },
    get out() { return this.sw.vis > 0; },
  };
}

function inertia(R) { const a = R.aboard; return ROLL.occ.I * a + ROLL.empty.I * (1 - a); }
export function rollImpulse(R, L) { R.w += L / inertia(R); }
function to(R, mode) { R.mode = mode; R.t = 0; R.events.push(mode); }

export function stepRoll(R, dt, env = {}) {
  R.events.length = 0;
  if (!(dt > 0)) return R;
  const C = ROLL, sw = R.sw, pd = R.pd;
  R.t += dt; R.since += dt;
  // ---- a breaking crest (rare): beam-on in steep water and a strong wind, only while upright and paddling ----
  if (R.mode === 'up' && env.windMs > C.wave.windMin) {
    const kw = clamp01((env.windMs - C.wave.windMin) / (C.wave.windFull - C.wave.windMin)), ks = clamp01((Math.abs(env.slope ?? 0) - C.wave.slopeMin) / (C.wave.slopeFull - C.wave.slopeMin));
    if (kw * ks > 0 && R.rng() < C.wave.rate * kw * ks * dt) { R.w += Math.sign(env.slope || 1) * -C.wave.L / inertia(R); R.slaps++; R.events.push('slap'); }
  }
  // ---- the beat's moment from the paddler (the sweep, the righting push, the climber's weight) ----
  let ext = 0;
  const back = -R.side, apNow = Math.abs(wrap(R.phi));   // toward upright, back the way it went over
  // (the sweep ends once the hull is past its vanishing angle on the way up: the hull's own moment brings it the rest)
  if (R.mode === 'roll' && R.t > C.hang && R.t < C.hang + C.sweepT && apNow > 50 * DEG) ext = back * C.sweepM * Math.sin(Math.PI * (R.t - C.hang) / C.sweepT);
  if (R.mode === 'right' && apNow > 55 * DEG && R.t < C.rightT) ext = back * C.rightM * smooth(0, 0.4, R.t);
  if (R.mode === 'climb') ext = -sw.side * C.climbW * R.aboard * Math.abs(sw.off);   // the weight out of the water, at its lever off the centreline
  R.ext = ext;
  // ---- the roll: semi-implicit steps of at most 1/120 s ----
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n, a = R.aboard, O = C.occ, E = C.empty;
  const I = inertia(R), c = O.c * a + E.c * (1 - a), q = O.q * a + E.q * (1 - a);
  for (let i = 0; i < n; i++) {
    const M = righting(R.phi, O) * a + righting(R.phi, E) * (1 - a);
    R.w += (M + ext - c * R.w - q * R.w * Math.abs(R.w)) / I * h;
    R.phi += R.w * h;
  }
  R.phi = wrap(R.phi);
  const ap = Math.abs(R.phi);
  // ---- the beats ----
  switch (R.mode) {
    case 'up':
      if (ap > C.overDeg * DEG) { R.side = Math.sign(R.phi); R.capsizes++; R.since = 0; to(R, 'over'); R.events.push('capsize'); }
      break;
    case 'over':
      if (R.kind === 'roll' && R.tries < 1) { to(R, 'roll'); R.tries++; break; }
      if (R.t > C.exitT) {
        // out of the cockpit, under the water on the low side (the side the deck went down: away from the lifted one)
        to(R, 'exit');
        sw.side = -R.side; Object.assign(sw, { vis: 1, off: sw.side * 0.55, offV: 0, fz: 0.25, fzV: 0, h: -0.75, hV: 0, tilt: 0.3, tiltV: 0, yaw: sw.side * Math.PI / 2, yawV: 0, arms: 1, wave: 0, shake: 0, hold: 0, climb: 0, mix: 0 });
      }
      break;
    case 'roll':
      if (R.t > C.hang + C.sweepT && ap < 35 * DEG) to(R, 'settle');
      else if (R.t > C.hang + C.sweepT + 1.6) { R.kind = 'swim'; to(R, 'over'); R.t = C.exitT; }   // the roll failed: a wet exit
      break;
    case 'exit': if (R.t > 0.5) R.aboard = 0; if (R.t > C.surfaceT) to(R, 'shake'); break;
    case 'shake': if (R.t > C.shakeT) to(R, 'wave'); break;
    case 'wave': if (R.t > C.waveT) to(R, 'grab'); break;
    case 'grab': if (R.t > C.grabT && !(R.hold > 0)) to(R, 'right'); break;   // hold: the swimmer waits beside the hull (Tessie's bite: the fleet counts it down out of her reach)
    case 'right':
      if (ap < 20 * DEG && Math.abs(R.w) < 1.5) to(R, 'climb');
      else if (R.t > C.rightT + 3) to(R, 'right');   // (a slip: push again)
      break;
    case 'climb':
      R.aboard = smooth(0.25, 0.85, R.t / C.climbT);
      if (ap > 100 * DEG) { R.aboard = 0; to(R, 'right'); break; }   // a slip: the hull went over again, right it again
      if (R.t > C.climbT) { R.aboard = 1; sw.vis = 0; to(R, 'settle'); }
      break;
    case 'settle': if (R.t > C.settleT) { to(R, 'up'); R.events.push('done'); R.tries = 0; } break;
  }
  if (R.mode === 'exit' && R.t < 0.5) R.aboard = 1 - R.t / 0.5;
  // ---- the swimmer's pose (springs: no step in any part) ----
  sw.ph += dt;
  if (sw.vis) {
    const m = R.mode, boat = env.boat;
    const faceHull = sw.side * Math.PI / 2, faceBoat = boat == null ? faceHull : boat;
    let offT = sw.side * 0.75, fzT = 0.25, hT = 0.06, tiltT = 0.45, yawT = faceHull, armsT = 1, waveT = 0, shakeT = 0, holdT = 0;
    if (m === 'shake') { shakeT = R.t < C.shakeT - 0.4 ? 1 : 0; }
    if (m === 'wave') { yawT = faceBoat; waveT = R.t < C.waveT - 0.45 ? 1 : 0; }
    if (m === 'grab' || m === 'right') { armsT = 0; holdT = 1; offT = sw.side * 0.6; }
    if (m === 'right') { tiltT = 0.15; hT = 0.12; }
    if (m === 'climb') {
      // over the side: up onto the deck on the belly (leaning forward), across, then sitting up, facing ahead
      const u = clamp01(R.t / C.climbT);
      armsT = 0; holdT = 1;
      offT = sw.side * 0.6 * (1 - smooth(0.12, 0.5, u));
      hT = 0.06 + 0.62 * smooth(0.1, 0.7, u);
      tiltT = 0.15 - 1.0 * smooth(0.1, 0.45, u) + 1.0 * smooth(0.55, 0.95, u);
      yawT = faceHull * (1 - smooth(0.45, 0.9, u));
      sw.mix = smooth(0.82, 1, u);   // the last of the climb lands on the seat (the hull's own pose)
    }
    spring(sw, 'off', offT, dt, m === 'climb' ? 9 : 3);
    spring(sw, 'fz', fzT, dt, 3);
    spring(sw, 'h', hT, dt, m === 'exit' ? 5 : m === 'climb' ? 9 : 4, m === 'exit' ? 0.55 : 1);   // surfacing: a buoyant bob
    spring(sw, 'tilt', tiltT, dt, m === 'climb' ? 9 : 3);
    spring(sw, 'yaw', sw.yaw + wrap(yawT - sw.yaw), dt, m === 'climb' ? 7 : 2.2);
    spring(sw, 'arms', armsT, dt, 5); spring(sw, 'wave', waveT, dt, 6); spring(sw, 'shake', shakeT, dt, 7); spring(sw, 'hold', holdT, dt, 4);
  }
  // ---- the paddle: let go as the kayak goes over (a swimmer's), thrown out on the low side, kept near by its leash ----
  if (R.kind === 'swim' && (R.mode === 'over' || R.mode === 'exit' || R.mode === 'shake' || R.mode === 'wave')) {
    if (pd.free === 0 && pd.freeV === 0) { pd.x = 0; pd.z = -0.1; pd.vx = -R.side * 1.3; pd.vz = -0.2; pd.yaw = 0; pd.r = R.side * 0.6; pd.freeV = 0.001; }
    spring(pd, 'free', 1, dt, 5);
  }
  if (pd.free > 0) {
    pd.x += pd.vx * dt; pd.z += pd.vz * dt; pd.yaw += pd.r * dt;
    const k = Math.exp(-dt / 0.8); pd.vx *= k; pd.vz *= k; pd.r *= Math.exp(-dt / 1.5);
    const d = Math.hypot(pd.x, pd.z); if (d > 1.6) { pd.x *= 1.6 / d; pd.z *= 1.6 / d; pd.vx *= 0.5; pd.vz *= 0.5; }   // the leash
    if (sw.hold > 0.98 || R.mode === 'up') { pd.free = 0; pd.freeV = 0; }
  }
  return R;
}
