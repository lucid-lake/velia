// The binoculars (owner, 2026-10-29): B raises them until B again (2026-11-12; a gamepad: the stick's click, held) and the view goes to the helm's
// eye (src/boat/helmCamera.js) through 7 × 50 marine glasses: a 6.5° field (a 7 × 50's true field is ≈ 7°), the mouse
// (or the right stick) aims. The glasses are steadied: the aim is held in the world, not on the boat, so a tack or a
// wave does not swing it; what reaches the view is the eye riding the boat (heave, and the heel and pitch moving the
// eye) plus a small share of the boat's roll and pitch (the arms soak the rest) and a slight hand sway. No shake
// beyond that, no reticle, no numbers. Plain JS (no three.js): tests/binoculars.test.mjs.
//
//   const bino = new Binoculars({ eye });   // eye: the craft's helm eye (craft.cameras(vessel).helm.eye), HELM_CAM.eye when absent
//   bino.update(dt, pose, { held, look: [dx, dy] (rad at the helm's 55°, scaled down here), from: { pos, target } })
//     → { pose: { pos, target, up, fov, near } | null, k (0 lowered … 1 raised, eased), blurPx (the focus pull), aim }
//   blendPose(normal, bino.pose, k): the page's camera while raising and lowering.
import { HELM_CAM, toWorld, toWorldDir, rotZ } from '../sim/boat/helmCamera.js';

const DEG = Math.PI / 180;
import { clampT as clamp } from '../sim/core/math.js';
const ease = (k) => k * k * (3 - 2 * k);

export const BINO = {
  fov: 6.5,                 // degrees, vertical: 7 × of the eye's ≈ 45° working field
  mag: 7,
  raiseS: 0.45, lowerS: 0.3,  // s: up to the eye, and down
  focusS: 0.7, focusPx: 5,  // the focus pull: the image sharpens from focusPx of blur over focusS once raised
  focusAt: 0.75,            // … starting when the raise is this far along
  look: 1 / 7,              // the aim's rate against the helm view's (a 7× view at the helm's rate would fly)
  pitchMin: -20 * DEG, pitchMax: 35 * DEG,
  steady: 0.12,             // the share of the boat's roll and pitch that reaches the view
  tau: 0.15,                // s, the eye's own smoothing of the boat's motion (the helm view's is 0.1)
  // the skipper stands and steps to the side they look to (up to lean m outboard, stand m up): over the dodger and
  // clear of the coaming; the rig still crosses some bearings, and there the near plane helps (below)
  lean: 0.75, stand: 0.15, leanTau: 0.6,
  // the near plane: focused at infinity, a 50 mm objective sees through a stay or a sail's edge a few metres off (it
  // only dims the image), so the glasses' camera starts at nearM: the boat's own rig does not wall the view
  nearM: 14,
  // …but never past the water (BACKLOG-v2 #33): a raise from a view that looks down (the follow camera, the helm view) aimed the
  // glasses at water closer than nearM, the near plane cut it away and the lake bed showed through for a moment. The near plane
  // comes in to nearShare of where the frame's bottom edge meets the water (nearWaveM under the eye for a crest), never under nearMinM
  nearShare: 0.7, nearWaveM: 0.4, nearMinM: 1,
  // the hand sway: a few incommensurate sines per axis (deg); at 6.5° a 0.04° drift is ≈ 0.6 % of the frame
  sway: { yaw: [[0.040, 0.23, 0.0], [0.020, 0.61, 1.7], [0.007, 1.9, 4.1]], pitch: [[0.030, 0.31, 2.2], [0.016, 0.83, 0.4], [0.006, 2.3, 5.3]] },
};

// the hand sway at time t (rad, yaw and pitch)
export function swayAt(t, S = BINO.sway) {
  const f = (terms) => terms.reduce((a, [amp, hz, ph]) => a + amp * Math.sin(2 * Math.PI * hz * t + ph), 0) * DEG;
  return [f(S.yaw), f(S.pitch)];
}

// a world direction → (yaw clockwise from north, pitch up)
export const yawPitchOf = ([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [Math.atan2(x / l, -z / l), Math.asin(clamp(y / l, -1, 1))]; };
export const dirOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

// the near plane for a camera at pos looking along dir with a vertical field of fovDeg: cap (nearM), or less where the frame's
// bottom edge meets the water (y 0) closer than that; the water point's depth along the view axis, times nearShare
export function nearOverWater(pos, dir, fovDeg, cap = BINO.nearM, O = BINO) {
  const half = fovDeg * DEG / 2, l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const below = half - Math.asin(clamp(dir[1] / l, -1, 1));   // the bottom edge's angle under the horizon
  if (below <= 0) return cap;
  const h = pos[1] - O.nearWaveM;
  if (h <= 0) return Math.min(cap, O.nearMinM);
  const depth = h * Math.cos(half) / Math.sin(Math.min(below, Math.PI / 2));
  return clamp(O.nearShare * depth, Math.min(cap, O.nearMinM), cap);
}

const damp = (x, v, target, tau, dt) => {
  const w = 2 / tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt;
  return [target + (d + tmp) * e, (v - w * tmp) * e];
};

export class Binoculars {
  constructor(opts = {}) { this.o = { ...BINO, ...opts }; this.k = 0; this.t = 0; this.held = false; this.raisedFor = 0; this.focusT = null; this.s = null; this.v = { heel: 0, pitch: 0, heave: 0 }; this.yaw = 0; this.pitch = 0; this.pose = null; }
  get raised() { return this.k >= 0.999; }
  update(dt, pose, { held = false, look = null, from = null } = {}) {
    const O = this.o;
    this.t += dt;
    if (held && !this.held && this.k < 0.01 && from) {   // a fresh raise: aim where the eye was looking
      const d = [from.target[0] - from.pos[0], from.target[1] - from.pos[1], from.target[2] - from.pos[2]];
      [this.yaw, this.pitch] = yawPitchOf(d); this.pitch = clamp(this.pitch, O.pitchMin, O.pitchMax);
      this.s = null; this.side = null;
    }
    this.held = held;
    this.k = clamp(this.k + (held ? dt / O.raiseS : -dt / O.lowerS), 0, 1);
    this.raisedFor = this.k >= 1 ? this.raisedFor + dt : 0;
    if (this.k <= 0) { this.pose = null; return { pose: null, k: 0, blurPx: 0, aim: null }; }
    if (look) { this.yaw += look[0] * O.look; this.pitch = clamp(this.pitch - look[1] * O.look, O.pitchMin, O.pitchMax); }
    // the eye on the boat, its motion smoothed
    if (!this.s) this.s = { heel: pose.heel ?? 0, pitch: pose.pitch ?? 0, heave: pose.heave ?? 0 };
    else for (const q of ['heel', 'pitch', 'heave']) [this.s[q], this.v[q]] = damp(this.s[q], this.v[q], pose[q] ?? 0, O.tau, dt);
    const p = { x: pose.x, z: pose.z, heading: pose.heading, heel: this.s.heel, pitch: this.s.pitch, heave: this.s.heave };
    const rel = Math.sin(this.yaw - (pose.heading ?? 0));   // + the aim to starboard
    this.side = this.side == null ? rel : this.side + (rel - this.side) * (1 - Math.exp(-dt / O.leanTau));
    const E = O.eye ?? HELM_CAM.eye, pos = toWorld([E[0] + O.lean * this.side, E[1] + O.stand, E[2]], p);
    // the aim: world-held, plus the sway and a share of the boat's pitch (the bow rising lifts the glasses a little)
    const [sy, sp] = swayAt(this.t, O.sway);
    const yaw = this.yaw + sy, pitch = this.pitch + sp + O.steady * this.s.pitch;
    const dir = dirOf(yaw, pitch);
    // the roll: a share of the heel about the view axis
    const up0 = rotZ([0, 1, 0], -O.steady * this.s.heel);
    const up = toWorldDir(up0, { heading: pose.heading, heel: 0, pitch: 0 });
    this.pose = { pos, target: [pos[0] + dir[0] * 100, pos[1] + dir[1] * 100, pos[2] + dir[2] * 100], up, fov: O.fov, near: nearOverWater(pos, dir, O.fov, O.nearM, O) };
    // the focus pull: from focusPx of blur to sharp over focusS, from when the raise passes focusAt; none on the way down
    this.focusT = held && this.k >= O.focusAt ? (this.focusT ?? 0) + dt : null;
    const blurPx = this.focusT == null ? 0 : O.focusPx * (1 - ease(clamp(this.focusT / O.focusS, 0, 1)));
    return { pose: this.pose, k: ease(this.k), blurPx, aim: { x: pos[0], y: pos[1], z: pos[2], fx: dir[0], fy: dir[1], fz: dir[2] } };
  }
}

// The camera between the normal view and the glasses: positions and directions lerped, the field of view on a log
// scale (so the zoom feels even), the up vector lerped.
export function blendPose(a, b, k) {
  if (!b || k <= 0) return a;
  if (k >= 1) return b;
  const L = (u, v) => u.map((x, i) => x + (v[i] - x) * k);
  const pos = L(a.pos, b.pos);
  const da = a.target.map((x, i) => x - a.pos[i]), db = b.target.map((x, i) => x - b.pos[i]);
  const na = Math.hypot(...da), nb = Math.hypot(...db);
  const d = L(da.map((x) => x / na), db.map((x) => x / nb)), nd = Math.hypot(...d) || 1;
  return { pos, target: pos.map((x, i) => x + d[i] / nd * 100), up: L(a.up ?? [0, 1, 0], b.up ?? [0, 1, 0]),
    fov: Math.exp(Math.log(a.fov) + (Math.log(b.fov) - Math.log(a.fov)) * k),
    // the near plane moves out under the focus pull's blur, never past the water under the blended frame's wider field (#33)
    near: k >= BINO.focusAt ? nearOverWater(pos, d, Math.exp(Math.log(a.fov) + (Math.log(b.fov) - Math.log(a.fov)) * k), b.near ?? 0.5) : (a.near ?? 0.5) };
}
