// How Emerald Bay's birds fly: plain JS, no three.js, no Math.random(), no wall clock, so node
// tests drive it (tests/birds.test.mjs) and a capture is the same every time. src/birds/index.js steps it on the scene
// clock and draws the poses with src/birds/mesh.js.
//
// One kinematic flight model for every bird: it steers toward a wanted velocity with the turn rate a real bank allows
// (ω = g·tan(bank)/v), banks into its turns, pitches with its climb, and flaps or glides by its species' pattern (the
// wingbeat frequency, bursts of beats between glides; Pennycuick 1990). On top of it, behaviours:
//   soar    circling in a thermal over the slopes (the bald eagle, an osprey), drifting with the wind, gliding on
//   hunt    the osprey: patrol over the water, hover into the wind, stoop, strike feet first, splash, sit wings spread,
//           labour off the water, shake, and carry the trout head-forward to the shore
//   flock   the gulls: boids (Reynolds 1987) round a roaming goal over the bay
//   raft    geese resting on the water; they run, flap and splash off when the boat comes close, fly in a loose line
//           and splash down again somewhere else
//   perch   a bald eagle on a snag, its head turning
//   lowpass a raptor's glide past the boat, low
// Events (calls, splashes, the patter of feet) go to a queue that the sound and the spray read.
import { SPECIES, strokeAt } from './species.js';
import { clamp, clamp01 } from '../sim/core/math.js';

export const G = 9.81;
const TAU = Math.PI * 2;
import { lerp } from '../sim/core/math.js';
import { smooth } from '../sim/core/math.js';
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// mulberry32: a small seeded stream per bird
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hashSeed = (...k) => { let h = 2166136261; for (const v of k) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; } return h >>> 0; };

// --- poses -------------------------------------------------------------------------------------------------------
export const restPose = () => ({ flap: 0.08, hand: 0, armSweep: 0, handSweep: 0, fold: 0, splay: 0.6, tail: 0.2, curl: 0.15, legs: 0, fish: 0, headYaw: 0, headPitch: 0, tailPitch: 0 });
// the gliding wing of each species: the osprey's crooked "M" (arm up, hand down, the wrist forward), the eagle's
// plank with its fingers spread and upturned, the gull's bent wing, the goose's flat glide
export function glidePose(name, soar = 0) {
  const p = restPose();
  switch (name) {
    case 'osprey': Object.assign(p, { flap: 0.2, hand: -0.34, armSweep: -0.12, handSweep: 0.32, splay: lerp(0.45, 0.9, soar), curl: lerp(0.12, 0.3, soar), tail: lerp(0.15, 0.6, soar) }); break;
    case 'eagle': Object.assign(p, { flap: 0.07, hand: 0.03, armSweep: -0.04, handSweep: 0.08, splay: lerp(0.65, 1.1, soar), curl: lerp(0.25, 0.55, soar), tail: lerp(0.25, 0.9, soar) }); break;
    case 'gull': Object.assign(p, { flap: 0.1, hand: -0.16, armSweep: -0.06, handSweep: 0.36, splay: 0.45, curl: 0.1, tail: lerp(0.1, 0.5, soar) }); break;
    case 'goose': Object.assign(p, { flap: 0.02, hand: -0.04, armSweep: 0, handSweep: 0.1, splay: 0.4, curl: 0.05, tail: 0.3 }); break;
  }
  return p;
}
// a flapping wing at a wingbeat phase, blended over the glide pose by amp (0 glide … 1 full stroke)
export function flapPose(name, phase, amp = 1, base = glidePose(name)) {
  const sp = SPECIES[name];
  const s = strokeAt(phase, sp.flight.stroke);
  const p = { ...base };
  p.flap = lerp(base.flap, s.flap, amp);
  p.hand = lerp(base.hand, s.hand + (name === 'osprey' ? -0.12 : 0), amp);
  p.handSweep = lerp(base.handSweep, base.handSweep * 0.5 + 0.6 * s.up + 0.05, amp);
  p.armSweep = lerp(base.armSweep, base.armSweep + 0.12 * s.up - 0.06 * s.down, amp);
  p.splay = lerp(base.splay, 0.35 + 0.45 * s.down, amp);   // the slots close on the upstroke
  p.curl = lerp(base.curl, 0.12 + 0.35 * s.down, amp);     // and the tips bend up under the downstroke's load
  return p;
}
// named poses for the studio (demos/birds.html) and the tests
export function poseFor(name, preset, phase = 0) {
  switch (preset) {
    case 'glide': return glidePose(name);
    case 'soar': return glidePose(name, 1);
    case 'flap': return flapPose(name, phase);
    case 'hover': return { ...flapPose(name, phase, 1.15, { ...glidePose(name), armSweep: -0.25, handSweep: 0.15 }), tail: 1, tailPitch: 0.45, legs: 0.25, headPitch: 0.7 };
    case 'dive': return { ...glidePose(name), fold: 0.5, flap: 0.35, armSweep: 0.55, handSweep: 0.65, splay: 0.1, curl: 0, tail: 0, legs: 0, headPitch: 0.3 };
    case 'strike': return { ...glidePose(name), flap: 1.25, hand: 0.3, armSweep: -0.1, handSweep: 0.1, splay: 1, curl: 0.2, tail: 1, tailPitch: -0.2, legs: 1.5, headPitch: 0.5 };
    case 'water': return { ...glidePose(name), flap: -0.02, hand: -0.08, splay: 0.9, tail: 0.6, legs: 1.2, headPitch: 0.2 };
    case 'carry': return { ...flapPose(name, phase), legs: 1, fish: 1 };
    case 'fold': return { ...restPose(), fold: 1, splay: 0, curl: 0, tail: 0, legs: 0 };
    case 'perch': return { ...restPose(), fold: 1, splay: 0, curl: 0, tail: 0, tailPitch: 0.25, legs: 1, headPitch: -0.25 };
    case 'land': return { ...glidePose(name), flap: 0.3, armSweep: -0.3, handSweep: 0.2, splay: 1, tail: 1, tailPitch: 0.35, legs: 1.3, headPitch: -0.1 };
  }
  return restPose();
}
const mixPose = (a, b, t) => { const o = {}; for (const k in a) o[k] = lerp(a[k], b[k] ?? a[k], t); return o; };

// --- the body's frame --------------------------------------------------------------------------------------------
// yaw ψ: the heading in the world (x east, z south): forward = (sin ψ, 0, cos ψ). pitch θ: + nose up. roll φ: + right
// wing down (a right turn). Returns the quaternion of the basis (right, up, forward) as the bird's x, y, z.
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export function quatOf(yaw, pitch, roll, out = [0, 0, 0, 1]) {
  // q = Ry(yaw) · Rx(−pitch) · Rz(−roll): roll about the body's axis, then the nose up, then the heading
  const q = qmul(qmul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [Math.sin(-pitch / 2), 0, 0, Math.cos(-pitch / 2)]), [0, 0, Math.sin(-roll / 2), Math.cos(-roll / 2)]);
  out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; out[3] = q[3];
  return out;
}
// a vector in the bird's frame to the world (for the tests and the spray: where a wingtip is)
export function rotate(q, v) {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
// the bank a coordinated turn needs: tan φ = v·ω / g
export const bankFor = (speed, turnRate) => Math.atan(speed * turnRate / G);

// --- one bird ----------------------------------------------------------------------------------------------------
export class Bird {
  constructor(name, id, seed, { pos = [0, 30, 0], yaw = 0, speed } = {}) {
    this.name = name; this.sp = SPECIES[name]; this.id = id;
    this.r = rng(hashSeed(seed, id, name.length * 977));
    this.pos = [...pos]; this.yaw = yaw; this.pitch = 0; this.roll = 0; this.speed = speed ?? this.sp.flight.cruise; this.vy = 0;
    this.turn = 0;                       // the turn rate now (rad/s)
    this.phase = this.r();               // the wingbeat's phase (0–1)
    this.amp = 0;                        // the flapping's amplitude (0 glide … 1)
    this.beatsLeft = 0; this.glideLeft = lerp(...this.sp.flight.glide, this.r());
    this.forceFlap = 0;                  // a behaviour's demand: 0 the species' pattern, 1 flap now
    this.hz = this.sp.flight.hz;
    this.pose = glidePose(name); this.target = null;
    this.mode = 'fly'; this.t = 0; this.state = {};
    this.fade = 1; this.visible = true; this.lod = 0; this.lodT = 0;
    this.extraRoll = 0; this.extraPitch = 0; this.soar = 0;
    this.quat = [0, 0, 0, 1];
  }
  rand(a = 0, b = 1) { return lerp(a, b, this.r()); }
  // steer toward a wanted heading, speed and climb rate; the turn rate is limited by the species' bank
  steer(dt, wantYaw, wantSpeed, wantVy, { maxBankDeg, accel = 2.5, ff = 0 } = {}) {
    const f = this.sp.flight, v = Math.max(3, this.speed);
    const maxBank = (maxBankDeg ?? f.bankDeg * 1.6) * Math.PI / 180;
    const maxTurn = G * Math.tan(maxBank) / v;
    const err = wrapPi(wantYaw - this.yaw);
    const wantTurn = clamp(ff + err * 0.9, -maxTurn, maxTurn);   // ff: a circle's own turn rate (v / r), fed forward
    this.turn += (wantTurn - this.turn) * clamp01(dt * 2.2);
    this.yaw = wrapPi(this.yaw + this.turn * dt);
    this.speed += clamp(wantSpeed - this.speed, -accel * dt, accel * dt);
    this.vy += clamp(wantVy - this.vy, -2.5 * dt, 2.5 * dt);
    const fwd = [Math.sin(this.yaw), Math.cos(this.yaw)];
    this.pos[0] += fwd[0] * this.speed * dt; this.pos[2] += fwd[1] * this.speed * dt; this.pos[1] += this.vy * dt;
    const bank = -bankFor(this.speed, this.turn);   // yaw grows to the left (x east, z south): a left turn drops the left wing
    this.roll += (bank - this.roll) * clamp01(dt * 3);
    const pitch = Math.atan2(this.vy, Math.max(1, this.speed)) * 0.8;
    this.pitch += (pitch - this.pitch) * clamp01(dt * 3);
  }
  // the flap/glide pattern: bursts of beats between glides; forceFlap (a climb, a take-off) keeps it flapping
  wings(dt, { hz = this.hz, base = null, soar = this.soar } = {}) {
    const f = this.sp.flight;
    const flapping = this.forceFlap > 0.5 || this.beatsLeft > 0;
    if (!flapping) {
      this.glideLeft -= dt;
      if (this.glideLeft <= 0) { this.beatsLeft = Math.round(this.rand(...f.burst)); this.glideLeft = this.rand(...f.glide); }
    }
    const wantAmp = flapping ? 1 : 0;
    this.amp += clamp(wantAmp - this.amp, -dt * 3.5, dt * 5);
    if (this.amp > 0.001 || flapping) {
      const before = this.phase;
      this.phase += hz * dt;
      if (Math.floor(this.phase) !== Math.floor(before) && this.beatsLeft > 0 && this.forceFlap <= 0.5) this.beatsLeft--;
      this.phase -= Math.floor(this.phase) > 1e6 ? 1e6 : 0;
    } else {
      // gliding: the phase rests at the stroke's middle (wings level) so the next burst starts smoothly
      this.phase = Math.floor(this.phase) + 0.28;
    }
    const b = base ?? glidePose(this.name, soar);
    this.pose = flapPose(this.name, this.phase, this.amp, b);
  }
  update(dt) {
    this.quat = quatOf(this.yaw, this.pitch + this.extraPitch, this.roll + this.extraRoll, this.quat);
  }
}

// --- the bay's helpers -------------------------------------------------------------------------------------------
// env: { heightAt(x, z) (terrain, m above the lake), waterAt(x, z, t) (the surface, m), wind: [vx, vz] m/s,
//        boat() → { x, z, sog, heading } | null, camera: [x, y, z], sunElev (deg), shelter 0–1, emit(event) }
const isWater = (env, x, z, depth = 2) => env.heightAt(x, z) < -depth;
// a point over water near (x, z): a ring search (deterministic by the bird's stream)
function waterNear(env, b, x, z, rMin, rMax, depth = 3) {
  for (let k = 0; k < 24; k++) {
    const a = b.rand(0, TAU), r = b.rand(rMin, rMax), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (isWater(env, px, pz, depth)) return [px, pz];
  }
  return [x, z];
}
// the ground under a bird and ahead of it: keep clear of the slopes
function terrainFloor(env, b, ahead = 60) {
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  let h = -1e9;
  for (const d of [0, ahead * 0.5, ahead]) h = Math.max(h, env.heightAt(b.pos[0] + fx * d, b.pos[2] + fz * d));
  return Math.max(h, 0);
}
const yawTo = (from, x, z) => Math.atan2(x - from[0], z - from[2]);
const dist2 = (a, x, z) => Math.hypot(a[0] - x, a[2] - z);

// --- behaviours --------------------------------------------------------------------------------------------------
// The thermal soarer: circles a centre drifting with the wind, climbs to the top, glides on to the next thermal.
export function stepSoar(b, dt, env, S) {
  S.centre ??= [b.pos[0] + 40, b.pos[2]]; S.dir ??= b.r() < 0.5 ? 1 : -1; S.top ??= b.rand(220, 380); S.radius ??= b.sp.flight.circleR * b.rand(0.85, 1.25);
  S.phase ??= 'circle';
  const lift = clamp01((env.sunElev - 8) / 25);          // thermals grow with the sun
  S.centre[0] += env.wind[0] * 0.8 * dt; S.centre[1] += env.wind[1] * 0.8 * dt;
  b.soar = 1;
  if (S.phase === 'circle') {
    const a = Math.atan2(b.pos[2] - S.centre[1], b.pos[0] - S.centre[0]);
    const d = Math.hypot(b.pos[0] - S.centre[0], b.pos[2] - S.centre[1]);
    // the tangent, steered in or out to hold the radius
    const tx = -Math.sin(a) * S.dir, tz = Math.cos(a) * S.dir;
    const corr = clamp((d - S.radius) / S.radius, -1, 1) * 1.2;
    const wx = tx - Math.cos(a) * corr, wz = tz - Math.sin(a) * corr;
    const climb = lerp(0.3, 1.8, lift) - 0.6;
    b.steer(dt, Math.atan2(wx, wz), b.sp.flight.cruise, b.pos[1] < S.top ? climb : -0.4, { maxBankDeg: b.sp.flight.bankDeg * 1.4, ff: -S.dir * b.speed / S.radius });
    b.forceFlap = 0;
    if (b.pos[1] >= S.top || (S.left = (S.left ?? b.rand(60, 140)) - dt) <= 0) {
      S.phase = 'glide'; S.left = null;
      const next = env.thermals[Math.floor(b.r() * env.thermals.length)] ?? [b.pos[0] + 400, b.pos[2]];
      S.next = [...next];
    }
  } else {
    const d = Math.hypot(b.pos[0] - S.next[0], b.pos[2] - S.next[1]);
    b.steer(dt, yawTo(b.pos, S.next[0], S.next[1]), b.sp.flight.cruise * 1.2, -1.1);
    if (d < 40) { S.phase = 'circle'; S.centre = [...S.next]; S.top = b.rand(220, 380); S.dir = b.r() < 0.5 ? 1 : -1; }
  }
  // the ground: climb over it
  const floor = terrainFloor(env, b, 120) + 60;
  if (b.pos[1] < floor) { b.vy = Math.max(b.vy, 1.5); b.forceFlap = 1; }
  b.wings(dt, { soar: S.phase === 'circle' ? 1 : 0.3 });
}

// The low pass: from ahead of the boat, down to a few metres, past it at a set distance, then up and away.
export function stepLowPass(b, dt, env, S) {
  const boat = env.boat() ?? { x: env.camera[0], z: env.camera[2], heading: 0, sog: 0 };
  if (!S.path) {
    // a line past the boat: abeam offset `off`, along the boat's heading (or the camera's view), at height h
    const hd = boat.heading ?? 0, fx = Math.sin(hd), fz = -Math.cos(hd);   // the boat's forward (x east, z south; heading from north)
    const side = S.side ?? (b.r() < 0.5 ? 1 : -1), off = S.offset ?? b.rand(50, 70);   // never closer than 40 m to the camera (owner, 2026-11-05)
    const px = boat.x - fz * off * side, pz = boat.z + fx * off * side;
    S.path = { a: [px + fx * 220, pz + fz * 220], b: [px - fx * 260, pz - fz * 260], h: S.height ?? b.rand(9, 14) };
    S.leg = S.direct ? 1 : 0;   // direct: already ahead of the boat (a cue), straight down the line
  }
  const P = S.path, tgt = S.leg === 0 ? P.a : P.b;
  if (S.leg === 0 && dist2(b.pos, tgt[0], tgt[1]) < 50) S.leg = 1;
  const goal = S.leg === 0 ? P.h + 25 : P.h;
  const wantY = S.leg === 1 ? clamp((goal - b.pos[1]) * 0.6, -4, 2) : clamp((goal - b.pos[1]) * 0.4, -4, 3);
  b.steer(dt, yawTo(b.pos, tgt[0], tgt[1]), b.sp.flight.cruise * 1.05, wantY, { maxBankDeg: 40 });
  b.soar = 0.4;
  // a few deep beats as it levels out low, then a long glide past
  b.forceFlap = S.leg === 1 && b.pos[1] < P.h + 3 && (S.beats = (S.beats ?? 0) + dt) < 1.4 ? 1 : 0;
  b.wings(dt, { soar: 0.4 });
  if (S.leg === 1 && dist2(b.pos, P.b[0], P.b[1]) < 40) return 'done';
  return null;
}

// The osprey's hunt.
export function stepHunt(b, dt, env, S) {
  const f = b.sp.flight;
  S.phase ??= 'patrol';
  S.t = (S.t ?? 0) + dt;
  const boat = env.boat();
  const home = boat ? [boat.x, boat.z] : [env.camera[0], env.camera[2]];
  const upwindYaw = Math.atan2(-env.wind[0], -env.wind[1]);   // facing into the wind
  const say = (kind, gain = 1) => env.emit({ kind, species: 'osprey', pos: [...b.pos], gain, id: b.id });
  b.extraPitch = 0; b.extraRoll = 0;
  switch (S.phase) {
    case 'patrol': {
      if (!S.wp || (!S.force && dist2(b.pos, S.wp[0], S.wp[1]) < 30)) S.wp = waterNear(env, b, home[0], home[1], 65, 110, 4);   // the plunge 50–120 m off the boat (owner, 2026-11-05)
      S.alt ??= b.rand(28, 45);
      b.steer(dt, yawTo(b.pos, S.wp[0], S.wp[1]), f.cruise * 0.9, clamp((S.alt - b.pos[1]) * 0.3, -2, 2));
      b.forceFlap = b.pos[1] < S.alt - 6 ? 1 : 0;
      b.wings(dt, { soar: 0.2 });
      S.next ??= b.rand(18, 40);
      const dBoat = dist2(b.pos, home[0], home[1]), dCam = Math.hypot(b.pos[0] - env.camera[0], b.pos[1] - env.camera[1], b.pos[2] - env.camera[2]);
      // the hover and plunge: with the dive on (env.dive: BIRDS.diveDefault in index.js, ?birddive=0|1) or a director's cue
      if ((env.dive || S.force) && S.t > S.next && (!S.force || dist2(b.pos, S.wp[0], S.wp[1]) < 14) && dBoat > 50 && dBoat < 120 && dCam > 50 && env.shelter < 0.3 && env.sunElev > 2 && isWater(env, b.pos[0], b.pos[2], 3)) { S.phase = 'hover'; S.t = 0; S.next = null; S.hoverFor = b.rand(2.2, 4.5); S.alt = null; }
      if (b.r() < dt * 0.04) say('call', 0.6);
      break;
    }
    case 'hover': {
      // into the wind, the ground speed falls away; a fast stroke, the body tilted up, the tail fanned, the head down
      b.steer(dt, upwindYaw, Math.max(0, Math.hypot(...env.wind) * 0.15), clamp((S.hoverY ??= clamp(b.pos[1], 14, 26)) - b.pos[1], -1, 1), { accel: 4 });
      b.extraPitch = 0.62 * smooth(0, 0.8, S.t);
      b.forceFlap = 1;
      b.wings(dt, { hz: f.hoverHz, base: { ...glidePose('osprey'), armSweep: -0.25, handSweep: 0.15, tail: 1, tailPitch: 0.45, legs: 0.2 } });
      b.pose.tail = 1; b.pose.tailPitch = 0.45; b.pose.headPitch = 0.75; b.pose.legs = 0.25;
      if (S.t > S.hoverFor) {
        if (S.force || b.r() < 0.7) { S.phase = 'stoop'; S.t = 0; S.aim = [b.pos[0] + Math.sin(b.yaw) * b.pos[1] * 0.45, b.pos[2] + Math.cos(b.yaw) * b.pos[1] * 0.45]; say('call', 0.4); }
        else { S.phase = 'patrol'; S.t = 0; }
      }
      break;
    }
    case 'stoop': {
      // a steepening dive at the fish, wings half closed; feet thrown forward and wings raised over the back at the end
      const d = dist2(b.pos, S.aim[0], S.aim[1]);
      const wantVy = -clamp(4 + S.t * 9, 4, 16);
      b.steer(dt, yawTo(b.pos, S.aim[0], S.aim[1]), clamp(d * 1.2, 2, 9), wantVy, { accel: 10 });
      b.vy = Math.min(b.vy, wantVy * 0.8 + 0.5);
      const h = b.pos[1];
      const strike = smooth(5, 1.5, h);
      b.pitch = Math.atan2(b.vy, Math.max(1, b.speed));
      b.extraPitch = lerp(0, 1.2, strike);   // the body swings up: feet first
      b.amp = 0; b.forceFlap = 0;
      b.pose = mixPose(poseFor('osprey', 'dive'), poseFor('osprey', 'strike'), strike);
      if (h <= 0.25) {
        S.phase = 'water'; S.t = 0; b.pos[1] = 0; b.vy = 0; b.speed = 0;
        env.emit({ kind: 'plunge', species: 'osprey', pos: [b.pos[0], 0, b.pos[2]], gain: 1, id: b.id });
        S.caught = S.force ? true : b.r() < 0.7;
      }
      break;
    }
    case 'water': {
      // in the water to the shoulders, wings spread on the surface; then a heave
      const sink = Math.sin(clamp01(S.t / 0.4) * Math.PI / 2);
      b.pos[1] = (env.waterAt(b.pos[0], b.pos[2]) ?? 0) - 0.22 * sink + 0.08;
      b.extraPitch = lerp(1.2, 0.1, smooth(0, 0.35, S.t));
      b.pose = mixPose(poseFor('osprey', 'strike'), poseFor('osprey', 'water'), smooth(0, 0.35, S.t));
      b.pose.fish = 0;
      if (S.t > (S.sitFor ??= b.rand(1.0, 1.6))) { S.phase = 'lift'; S.t = 0; b.phase = 0; env.emit({ kind: 'lift', species: 'osprey', pos: [...b.pos], gain: 1, id: b.id }); }
      break;
    }
    case 'lift': {
      // heavy, deep beats; slow at first, the wingtips slapping the water on the first strokes
      b.forceFlap = 1;
      const climb = lerp(0.6, 2.4, smooth(0, 2.5, S.t));
      b.steer(dt, upwindYaw + 0.3, lerp(1.5, f.cruise * 0.8, smooth(0, 3, S.t)), climb, { accel: 3 });
      b.wings(dt, { hz: f.hz * 1.05, base: { ...glidePose('osprey'), legs: 1, fish: S.caught ? 1 : 0 } });
      b.pose.flap += 0.12; b.pose.legs = 1; b.pose.fish = S.caught ? 1 : 0;
      b.extraPitch = 0.35 * (1 - smooth(0, 2.5, S.t));
      const beat = Math.floor(b.phase);
      if (S.t < 1.3 && beat !== S.lastBeat) { S.lastBeat = beat; env.emit({ kind: 'wingslap', species: 'osprey', pos: [...b.pos], gain: 1 - S.t / 1.3, id: b.id }); }
      if (S.t > 2.2 && !S.shook && b.pos[1] > 4) { S.phase = 'shake'; S.t = 0; S.shook = true; }
      break;
    }
    case 'shake': {
      // the shake: a fast shiver of the body, droplets flung, the wings held
      b.steer(dt, b.yaw, f.cruise * 0.7, 0.6);
      b.forceFlap = 0; b.amp = Math.max(0, b.amp - dt * 6);
      b.pose = { ...glidePose('osprey'), flap: 0.35, legs: 1, fish: S.caught ? 1 : 0 };
      b.extraRoll = Math.sin(S.t * TAU * 11) * 0.3 * Math.sin(Math.PI * clamp01(S.t / 0.55));
      if (S.t < 0.5 && Math.floor(S.t * 20) !== S.lastDrop) { S.lastDrop = Math.floor(S.t * 20); env.emit({ kind: 'shake', species: 'osprey', pos: [...b.pos], gain: 1, id: b.id }); }
      if (S.t > 0.6) { S.phase = 'carry'; S.t = 0; say('call', 0.8); }
      break;
    }
    case 'carry': {
      // to the shore, climbing; the fish head-forward in both feet
      S.dest ??= env.nest ?? [b.pos[0] + 600, b.pos[2]];
      b.steer(dt, yawTo(b.pos, S.dest[0], S.dest[1]), f.cruise, clamp((50 - b.pos[1]) * 0.25, -1, 2));
      b.forceFlap = b.pos[1] < 40 ? 1 : 0;
      b.wings(dt, { base: { ...glidePose('osprey'), legs: 1, fish: S.caught ? 1 : 0 } });
      b.pose.legs = 1; b.pose.fish = S.caught ? 1 : 0;
      if (b.r() < dt * 0.15) say('call', 0.7);
      if (dist2(b.pos, S.dest[0], S.dest[1]) < 60 || S.t > 70) { S.phase = 'patrol'; S.t = 0; S.dest = null; S.shook = false; S.caught = false; S.force = false; }
      break;
    }
  }
}

// The gulls: boids round a roaming goal. birds: the flock's members; goal(t) → [x, y, z].
export function stepFlock(birds, dt, env, goal) {
  const n = birds.length;
  for (let i = 0; i < n; i++) {
    const b = birds[i];
    if (b.mode !== 'flock') continue;
    let sx = 0, sy = 0, sz = 0, ax = 0, az = 0, cx = 0, cy = 0, cz = 0, na = 0, nc = 0;
    for (let j = 0; j < n; j++) {
      if (i === j || birds[j].mode !== 'flock') continue;
      const o = birds[j], dx = o.pos[0] - b.pos[0], dy = o.pos[1] - b.pos[1], dz = o.pos[2] - b.pos[2], d = Math.hypot(dx, dy, dz);
      if (d < 6 && d > 1e-3) { const k = (6 - d) / d; sx -= dx * k; sy -= dy * k; sz -= dz * k; }
      if (d < 25) { ax += Math.sin(o.yaw); az += Math.cos(o.yaw); na++; }
      if (d < 40) { cx += o.pos[0]; cy += o.pos[1]; cz += o.pos[2]; nc++; }
    }
    const g = goal(b);
    let wx = (g[0] - b.pos[0]) * 0.012, wz = (g[2] - b.pos[2]) * 0.012;
    const gl = Math.hypot(wx, wz); if (gl > 1) { wx /= gl; wz /= gl; }
    wx += sx * 0.35 + (na ? ax / na : 0) * 0.5 + (nc ? (cx / nc - b.pos[0]) * 0.02 : 0);
    wz += sz * 0.35 + (na ? az / na : 0) * 0.5 + (nc ? (cz / nc - b.pos[2]) * 0.02 : 0);
    // each gull's own wander (it is not a school of fish)
    b.state.wander = (b.state.wander ?? b.rand(-1, 1)) + (b.r() - 0.5) * dt * 2;
    b.state.wander = clamp(b.state.wander, -1, 1);
    const yaw = Math.atan2(wx, wz) + b.state.wander * 0.5;
    const floor = terrainFloor(env, b, 50) + 12;
    const wantY = clamp((Math.max(g[1] + (b.id % 5) * 3, floor) - b.pos[1]) * 0.25 + sy * 0.2, -2, 2.2);
    b.steer(dt, yaw, b.sp.flight.cruise * (0.9 + 0.2 * Math.sin(b.id * 1.7 + b.t * 0.3)), wantY, { maxBankDeg: 40 });
    b.forceFlap = wantY > 1.2 ? 1 : 0;
    b.wings(dt, { soar: 0.4 });
  }
}

// Geese on the water: rest, alarm, run and take off, fly in a loose line, glide down and splash in.
export function stepRaft(b, dt, env, S, group) {
  S.phase ??= 'rest';
  S.t = (S.t ?? 0) + dt;
  const boat = env.boat();
  const say = (gain = 1) => env.emit({ kind: 'honk', species: 'goose', pos: [...b.pos], gain, id: b.id });
  const wy = (x, z) => env.waterAt(x, z) ?? 0;
  b.extraPitch = 0; b.extraRoll = 0;
  switch (S.phase) {
    case 'rest': {
      // paddling slowly, each its own way, keeping near the group's spot; bobbing on the swell
      b.speed = 0.25 + 0.15 * Math.sin(b.t * 0.21 + b.id);
      S.home ??= [b.pos[0], b.pos[2]];
      const back = yawTo(b.pos, S.home[0] + Math.sin(b.id * 2.3) * 6, S.home[1] + Math.cos(b.id * 1.9) * 6);
      b.yaw = wrapPi(b.yaw + clamp(wrapPi(back - b.yaw), -0.2, 0.2) * dt + Math.sin(b.t * 0.13 + b.id * 3) * 0.08 * dt);
      b.pos[0] += Math.sin(b.yaw) * b.speed * dt; b.pos[2] += Math.cos(b.yaw) * b.speed * dt;
      b.pos[1] = wy(b.pos[0], b.pos[2]) - 0.03;
      b.roll = 0; b.pitch = 0; b.vy = 0;
      b.pose = { ...poseFor('goose', 'fold'), legs: 0, headPitch: -0.15 + 0.2 * Math.sin(b.t * 0.4 + b.id), headYaw: 0.5 * Math.sin(b.t * 0.23 + b.id * 1.3) };
      const d = boat ? Math.hypot(boat.x - b.pos[0], boat.z - b.pos[2]) : 1e9;
      const close = boat && (d < 70 || (d < 120 && boat.sog > 0.6));   // they leave long before 40 m (owner, 2026-11-05)
      if (!group.hold && (close || group.alarm)) { group.alarm ??= S.t; S.phase = 'alarm'; S.t = 0; S.delay = b.rand(0.2, 1.3); if (b.r() < 0.6) say(0.8); }
      break;
    }
    case 'alarm': {
      b.pos[1] = wy(b.pos[0], b.pos[2]) - 0.03;
      b.pose = { ...poseFor('goose', 'fold'), headPitch: -0.45, headYaw: 0 };
      // turn away from the boat and a little into the wind
      if (boat) { const away = Math.atan2(b.pos[0] - boat.x, b.pos[2] - boat.z), up = Math.atan2(-env.wind[0], -env.wind[1]); S.runYaw ??= away + clamp(wrapPi(up - away), -0.7, 0.7) * 0.6; }
      else S.runYaw ??= b.yaw;
      b.yaw = wrapPi(b.yaw + clamp(wrapPi(S.runYaw - b.yaw), -2 * dt, 2 * dt));
      if (S.t > S.delay) { S.phase = 'run'; S.t = 0; b.speed = 0.5; b.phase = 0; say(1); }
      break;
    }
    case 'run': {
      // running on the water: deep fast beats, feet slapping; airborne at ≈ 8 m/s
      b.forceFlap = 1;
      b.speed = Math.min(9, b.speed + 3.8 * dt);
      b.yaw = wrapPi(b.yaw + clamp(wrapPi(S.runYaw - b.yaw), -dt, dt));
      b.pos[0] += Math.sin(b.yaw) * b.speed * dt; b.pos[2] += Math.cos(b.yaw) * b.speed * dt;
      const air = smooth(5.5, 9, b.speed);
      b.pos[1] = wy(b.pos[0], b.pos[2]) + air * 0.4 + 0.05;
      b.pitch = 0.25 * (1 - air);
      b.wings(dt, { hz: b.sp.flight.hz * 1.08 });
      b.pose.flap += 0.15; b.pose.legs = 1 - air * 0.5; b.pose.headPitch = -0.2;
      S.step = (S.step ?? 0) + dt;
      if (S.step > 0.16 && air < 0.95) { S.step = 0; env.emit({ kind: 'patter', species: 'goose', pos: [b.pos[0], wy(b.pos[0], b.pos[2]), b.pos[2]], gain: 1 - air, id: b.id, yaw: b.yaw }); }
      const beat = Math.floor(b.phase);
      if (beat !== S.lastBeat && air < 0.6) { S.lastBeat = beat; env.emit({ kind: 'wingslap', species: 'goose', pos: [...b.pos], gain: 0.7 * (1 - air), id: b.id }); }
      if (b.speed >= 9) { S.phase = 'fly'; S.t = 0; b.vy = 1.5; }
      break;
    }
    case 'fly': {
      // a loose echelon behind the group's leader, to a far spot on the water, then down
      group.dest ??= env.gooseDest(b);
      const lead = group.members[0], i = group.members.indexOf(b);
      let tx = group.dest[0], tz = group.dest[1];
      if (b !== lead && lead.state.phase === 'fly') {
        const back = 3.2 * i, side = (i % 2 ? 1 : -1) * 2.0 * Math.ceil(i / 2);
        const fx = Math.sin(lead.yaw), fz = Math.cos(lead.yaw);
        tx = lead.pos[0] - fx * back + fz * side; tz = lead.pos[2] - fz * back - fx * side;
      }
      const floor = terrainFloor(env, b, 80) + 15;
      const dd = dist2(b.pos, group.dest[0], group.dest[1]);
      const alt = dd < 160 ? lerp(3, 25, dd / 160) : Math.max(25, floor);
      const ahead = b === lead ? 0 : clamp((Math.hypot(tx - b.pos[0], tz - b.pos[2]) - 2) * 0.3, -2, 3);
      b.steer(dt, yawTo(b.pos, tx, tz), b.sp.flight.cruise * (dd < 160 ? lerp(0.55, 1, dd / 160) : 1) + ahead, clamp((alt - b.pos[1]) * 0.4, -2.5, 2.5), { maxBankDeg: 30 });
      b.forceFlap = dd < 90 ? 0 : 1;
      b.wings(dt);
      if (b.r() < dt * 0.25) say(0.7);
      if (dd < 90 && b.pos[1] < 6) { S.phase = 'land'; S.t = 0; S.home = [group.dest[0] + b.rand(-8, 8), group.dest[1] + b.rand(-8, 8)]; }
      break;
    }
    case 'land': {
      // wings cupped, feet forward, a skid that throws a sheet of spray
      const w = wy(b.pos[0], b.pos[2]);
      b.forceFlap = 0; b.amp = Math.max(0, b.amp - dt * 3);
      b.pose = poseFor('goose', 'land');
      b.speed = Math.max(0.3, b.speed - (b.pos[1] - w < 0.3 ? 6 : 1.5) * dt);
      b.vy = b.pos[1] - w > 0.2 ? -1.2 : 0;
      b.pos[0] += Math.sin(b.yaw) * b.speed * dt; b.pos[2] += Math.cos(b.yaw) * b.speed * dt; b.pos[1] = Math.max(w - 0.03, b.pos[1] + b.vy * dt);
      b.pitch = 0.3; b.roll *= 0.9;
      if (b.pos[1] - w < 0.3 && !S.touched) { S.touched = true; env.emit({ kind: 'land', species: 'goose', pos: [b.pos[0], w, b.pos[2]], gain: 1, id: b.id, yaw: b.yaw }); }
      if (S.touched && b.speed < 0.6) { S.phase = 'rest'; S.t = 0; S.touched = false; S.runYaw = null; group.alarm = null; if (b === group.members.at(-1)) group.dest = null; }
      break;
    }
  }
}

// The perched eagle: the head scanning (slow turns, pauses), a tail flick now and then.
export function stepPerch(b, dt, env, S) {
  S.look ??= 0; S.hold ??= 0;
  S.hold -= dt;
  if (S.hold <= 0) { S.look = b.rand(-1.4, 1.4); S.hold = b.rand(1.5, 5); }
  b.pose = poseFor('eagle', 'perch');
  b.state.head = lerp(b.state.head ?? 0, S.look, clamp01(dt * 3));
  b.pose.headYaw = b.state.head;
  b.pose.headPitch = -0.2 + 0.15 * Math.sin(b.t * 0.3);
  b.pose.tail = 0.1 + 0.1 * Math.max(0, Math.sin(b.t * 0.7) ** 31);
  b.pitch = 0.55; b.roll = 0; b.speed = 0; b.vy = 0;
}
