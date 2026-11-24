// The move between the two views (owner, 2026-10-29: the Boat ↔ Helm switch is our main feature): switching never
// cuts. The camera flies from the follow pose to the helm pose (or back) over VIEW_BLEND.durS, eased in and out, so it
// starts and lands at rest; no shake, no overshoot. Both end poses are live (the follow camera and the helm camera
// keep running every frame), so a moving boat is tracked through the move.
//
// The path: not a straight line (it could pass through the sails when the follow camera looks at the bow). The camera
// spirals in about the helmsman's eye: the follow camera's offset from the eye, as an azimuth, an elevation and a
// distance, swings to astern (VIEW_BLEND.approach: a few degrees off the centreline, between the split backstay's
// legs) while the distance runs down to zero, so the last metres come in low over the stern into the helm's seat.
// The look turns as yaw and pitch (shortest way), the up vector leans into the boat's heel, the field of view and
// the near plane follow. Back to the follow view is the same path, reversed.
// Plain JS (no three.js): tests/viewSwitch.test.mjs.
//
//   const vb = new ViewBlend();            // k 0 = follow, 1 = helm
//   vb.to('helm', { distM, swingRad });    // start a move (from wherever k is now: a second C mid-way turns back)
//   vb.step(dt);                           // every frame; returns k
//   blendPose(followPose, helmPose, vb.e, { eye, heading })   // the camera's pose for this frame
const DEG = Math.PI / 180;
import { wrap } from '../sim/core/math.js';
import { lerp } from '../sim/core/math.js';
import { clampT as clamp } from '../sim/core/math.js';

export const VIEW_BLEND = {
  durS: 1.0,                 // s, the move at the default follow distance (≈ 32 m)
  durMinS: 0.8, durMaxS: 1.2,
  perM: 1 / 160,             // s per metre of distance over 32 m: a zoomed-out follow camera takes a little longer
  refM: 32,
  approach: 12 * DEG,        // the final approach's azimuth off dead astern (to starboard of the backstay's line)
  approachElev: 9 * DEG,     // and its elevation over the eye: low over the stern rail
  turnLead: 0.85,            // the azimuth and elevation settle by this share of the move, before the distance does
  perSwing: 0.25 / Math.PI,  // s per radian the camera swings round to astern (an orbited follow camera: up to +0.25 s)
  nearFollow: 0.5, nearHelm: 0.08,
};

// ease in and out (a quintic smootherstep: zero speed and zero acceleration at both ends)
export const ease = (k) => { const x = clamp(k, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };

export class ViewBlend {
  constructor(view = 'follow') { this.k = view === 'helm' ? 1 : 0; this.dir = 0; this.dur = VIEW_BLEND.durS; }
  get view() { return this.dir > 0 || (this.dir === 0 && this.k >= 0.5) ? 'helm' : 'follow'; }
  get moving() { return this.dir !== 0; }
  get e() { return ease(this.k); }
  // the move's length for a follow camera distM from the eye, swingRad round from astern
  static durFor(distM = VIEW_BLEND.refM, swingRad = 0) {
    const C = VIEW_BLEND;
    return clamp(C.durS + Math.max(0, distM - C.refM) * C.perM + Math.abs(wrap(swingRad)) * C.perSwing, C.durMinS, C.durMaxS);
  }
  to(view, { distM, swingRad } = {}) {
    const goal = view === 'helm' ? 1 : 0;
    if (this.dir === 0) this.dur = ViewBlend.durFor(distM, swingRad);   // a turn back mid-way keeps the move's pace
    this.dir = this.k === goal ? 0 : goal > this.k ? 1 : -1;
    return this.dir;
  }
  jump(view) { this.k = view === 'helm' ? 1 : 0; this.dir = 0; }   // a cut: ?view=helm at the start only
  step(dt) {
    if (!this.dir) return this.k;
    this.k = clamp(this.k + this.dir * dt / this.dur, 0, 1);
    if (this.k === 0 || this.k === 1) this.dir = 0;
    return this.k;
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
// a direction's yaw (clockwise from north, as the follow camera's: forward = (sin y, 0, −cos y)) and pitch
const yawPitch = (d) => [Math.atan2(d[0], -d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
const fromYawPitch = (y, p) => [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];

// follow, helm: poses { pos, target, up?, fov, near? }; e: the eased progress (0 follow … 1 helm); at: { eye: the helm
// camera's position (= helm.pos), heading: the boat's (rad) }. Returns a pose of the same shape.
export function blendPose(follow, helm, e, at = {}) {
  const C = VIEW_BLEND;
  if (e <= 0) return { ...follow, near: follow.near ?? C.nearFollow };
  if (e >= 1) return { ...helm, near: helm.near ?? C.nearHelm };
  const eye = at.eye ?? helm.pos, heading = at.heading ?? yawPitch(sub(helm.target, helm.pos))[0];
  // the follow camera's offset from the eye, as azimuth (the yaw of the line from the eye to the camera), elevation, distance
  const o = sub(follow.pos, eye), r0 = Math.hypot(o[0], o[1], o[2]);
  const [az0, el0] = yawPitch(o);
  const azEnd = wrap(heading + Math.PI + C.approach);           // astern of the eye, a few degrees to starboard
  const t = clamp(e / C.turnLead, 0, 1), turn = t * t * (3 - 2 * t);
  const az = az0 + wrap(azEnd - az0) * turn, el = lerp(el0, C.approachElev, turn);
  const r = r0 * (1 - e);
  const d = fromYawPitch(az, el);
  const pos = [eye[0] + d[0] * r, eye[1] + d[1] * r, eye[2] + d[2] * r];
  // the look: yaw and pitch, the shortest way round
  const [fy, fp] = yawPitch(sub(follow.target, follow.pos)), [hy, hp] = yawPitch(sub(helm.target, helm.pos));
  const look = fromYawPitch(fy + wrap(hy - fy) * e, lerp(fp, hp, e));
  const fu = follow.up ?? [0, 1, 0], hu = helm.up ?? [0, 1, 0];
  const up = norm([lerp(fu[0], hu[0], e), lerp(fu[1], hu[1], e), lerp(fu[2], hu[2], e)]);
  const n0 = follow.near ?? C.nearFollow, n1 = helm.near ?? C.nearHelm;
  return {
    pos, target: [pos[0] + look[0] * 10, pos[1] + look[1] * 10, pos[2] + look[2] * 10], up,
    fov: lerp(follow.fov, helm.fov, e), near: Math.exp(lerp(Math.log(n0), Math.log(n1), e)),
  };
}
