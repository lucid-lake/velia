// The bird's-eye follow camera (design starting points; none sourced, tune with the owner):
// pitch 50–60° down (player range 35–75°), distance 4–6 hull lengths (zoom 2–10), a critically damped follow of
// the boat's position only (never its roll or pitch), yaw free with an optional slow chase toward the heading,
// pulls back a little with speed. Plain JS; returns a pose { pos, target } the page applies with lookAt.

const damp = (x, v, target, tau, dt) => {
  // critically damped spring toward target with time constant tau (s); returns [x, v]
  const w = 2 / tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt;
  return [target + (d + tmp) * e, (v - w * tmp) * e];
};
import { wrap } from '../core/math.js';

export const FOLLOW = {
  hull: 9.1,                // m, the boat's length; distances are in hull lengths. The default only: a craft passes its own (craft.cameras, src/craft/sloop/cameras.js)
  dist: 3.5, distMin: 1.5, distMax: 10,   // 3.5 hull lengths ≈ 32 m: the boat ≈12 % of the frame (Design lead, boat-low/03)
  // 55° down showed only dark water (2026-10-29 capture): no horizon, no shores. Lower, with the boat in the lower
  // third, so the world is in frame. ?campitch= overrides for tuning.
  pitch: 20 * Math.PI / 180, pitchMin: 8 * Math.PI / 180, pitchMax: 75 * Math.PI / 180,
  // look up (round 4, owner 2026-11-07: the Milky Way): a drag past the lowest orbit tilts the view up instead, by up to
  // lookUp; the camera sinks toward lookLowDeg over the water as it does; it stays where it is left (no return)
  lookUp: 55 * Math.PI / 180, lookLowDeg: 3, lookSink: 0.1,
  lead: 0.6,                // the aim point sits this fraction of the distance ahead of the boat (boat in the lower third)
  leadPortrait: 0.3,        // an upright phone (feat/portrait): the boat higher, clear of the bottom band of controls
  leadPhoneCockpit: 0.22,   // a phone held sideways with the 3D cockpit (feat/cockpit-phone): the hull clear of the coaming and the wheel's guard
  posTau: 0.45,             // s, the position follow
  chaseRate: 0.15,          // rad/s at most, the chase toward the heading (0 = off)
  speedPull: 0.08,          // extra hull lengths per m/s of boat speed
  // the camera breathes with the boat (D1): at speed it pulls back, lowers a little and widens a touch;
  // driven by the speed smoothed over speedTau so a gust's surge reads as a slow breath, never a shake
  speedTau: 1.6,            // s
  speedFull: 3.6,           // m/s (7 kn): the full breath
  fovBreath: 1.6,           // degrees wider at full speed
  pitchBreath: 2 * Math.PI / 180,   // rad lower at full speed
  aimUp: 1.5,               // m above the waterline the camera aims at (the deck, not the keel)
  // a surf burst (state.surf, src/boat/thrill.js) breathes deeper on top: the view opens and draws back as the boat
  // takes off down a face, and settles as it drops off the back. Smoothed over surgeTau, so it is a breath, not a shake
  surgeTau: 0.6, surgeFov: 2.5, surgePull: 0.3,   // s; degrees; hull lengths
};

export class FollowCamera {
  // hull: the craft's length unit for every distance (m; craft.cameras(vessel).follow.hull), FOLLOW.hull when absent
  // pose: a page's own default pose and drag range over FOLLOW's (v2's Boat view, v2/sim/camTilt.js BOAT_VIEW: { pitch, dist,
  // pitchMin, pitchMax, pitchBreath, lookLowDeg }); absent: FOLLOW's, as before
  constructor({ x = 0, z = 0, heading = 0, pitchDeg = null, dist = null, hull = null, pose = null } = {}) {
    this.F = pose ? { ...FOLLOW, ...pose } : FOLLOW;
    this.c = [x, 0, z]; this.cv = [0, 0, 0];
    this.hull = hull ?? FOLLOW.hull;
    this.yaw = heading;          // the camera's azimuth (looks along +yaw), clockwise from north
    this.pitch = pitchDeg != null ? pitchDeg * Math.PI / 180 : this.F.pitch;
    this.dist = dist ?? this.F.dist;
    this.chase = true;
    this.speed = null;           // the smoothed speed over the ground, m/s
    this.surge = 0;              // the smoothed surf cue, 0..1
    this.lead = FOLLOW.lead;     // the page sets FOLLOW.leadPortrait on an upright phone
    this.look = 0;               // the look up past the lowest orbit (rad; round 4)
  }

  // an input observer (src/kayaks/fleet.js: a drag ends the notice shot): fn(input) sees each update's input first;
  // returns its off
  onInput(fn) {
    const obs = (this.inputObservers ??= []); obs.push(fn);
    return () => { const i = obs.indexOf(fn); if (i >= 0) obs.splice(i, 1); };
  }

  // input: { orbit: [dx, dy] radians, zoom: factor (1 = none) }; state: the boat's physics state
  update(dt, state, input = {}) {
    if (this.inputObservers) for (const f of this.inputObservers) f(input);
    for (const [d, v] of [[0, state.x], [1, state.heave], [2, state.z]]) [this.c[d], this.cv[d]] = damp(this.c[d], this.cv[d], v, FOLLOW.posTau, dt);
    if (input.orbit) {
      this.yaw = wrap(this.yaw + input.orbit[0]);
      // one angle for the drag: the orbit's pitch, and past its lowest the look up (only a drag looks up: ?campitch= under
      // the lowest orbit stays clamped there, as before)
      const F = this.F, p = (this.look > 0 ? F.pitchMin - this.look : Math.max(this.pitch, F.pitchMin)) + input.orbit[1];
      this.look = Math.min(F.lookUp, Math.max(0, F.pitchMin - p));
      this.pitch = Math.min(F.pitchMax, Math.max(F.pitchMin, p));
    }
    if (input.zoom) this.dist = Math.min(FOLLOW.distMax, Math.max(FOLLOW.distMin, this.dist * input.zoom));
    if (this.chase && !input.orbit) {
      const d = wrap(state.heading - this.yaw), step = FOLLOW.chaseRate * dt;
      this.yaw = wrap(this.yaw + Math.max(-step, Math.min(step, d)));
    }
    const sog = state.sog ?? 0;
    this.speed = this.speed == null ? sog : this.speed + (sog - this.speed) * (1 - Math.exp(-dt / FOLLOW.speedTau));
    const b = Math.min(1, Math.max(0, this.speed / FOLLOW.speedFull)), breath = b * b * (3 - 2 * b);
    // dragged past the lowest orbit: the view tilts up by this; lookBias: a scene's own tilt on top (the fireworks show,
    // src/fireworks/world.js: eased in and out; the player's drag still adds to it); 0 by default
    const look = this.look + (this.lookBias ?? 0);
    const F = this.F, low = Math.max(F.lookLowDeg * Math.PI / 180, F.pitchMin - look * F.lookSink);
    const pitch = look > 0 ? low : Math.max(F.pitchMin, this.pitch - F.pitchBreath * breath);
    this.surge += ((state.surf ?? 0) - this.surge) * (1 - Math.exp(-dt / FOLLOW.surgeTau));
    const sg = this.surge * this.surge * (3 - 2 * this.surge);
    const r = (this.dist + this.F.speedPull * this.speed + FOLLOW.surgePull * sg) * this.hull;
    const ahead = r * this.lead;
    const target = [this.c[0] + Math.sin(this.yaw) * ahead, this.c[1] + FOLLOW.aimUp, this.c[2] - Math.cos(this.yaw) * ahead];
    const horiz = r * Math.cos(pitch);
    const pos = [this.c[0] - Math.sin(this.yaw) * horiz, this.c[1] + FOLLOW.aimUp + r * Math.sin(pitch), this.c[2] + Math.cos(this.yaw) * horiz];
    const fov = 40 + FOLLOW.fovBreath * breath + FOLLOW.surgeFov * sg + (this.fovBias ?? 0);   // fovBias: the show's wider view
    if (look > 0) {   // the view's own elevation (down to the aim point) raised by `look`
      const d = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]], hd = Math.hypot(d[0], d[2]);
      const el = Math.atan2(d[1], hd) + look, c = Math.cos(el);
      return { pos, target: [pos[0] + d[0] / hd * c * 60, pos[1] + Math.sin(el) * 60, pos[2] + d[2] / hd * c * 60], fov };
    }
    // shot: a scene's own camera blended in, { pos, target, w 0–1 } (the kayaks noticed, src/kayaks/notice.js: low over the
    // water on the kayak's side). Blended round the boat (azimuth, distance, height), never on the straight line between
    // the two poses, so the camera swings round and down outside the rig rather than through it; the target blends straight
    if (this.shot && this.shot.w > 0) return blendShot({ pos, target, fov }, this.shot, this.c);
    return { pos, target, fov };
  }
}

// a follow pose and a shot pose blended by w round the centre c (the boat): the camera's azimuth on the shorter way, its
// horizontal distance and its height each lerped; never under 6 m from the centre, never under 0.8 m over it
export function blendShot(a, shot, c) {
  const w = Math.min(1, Math.max(0, shot.w)), polar = (p) => ({ az: Math.atan2(p[0] - c[0], -(p[2] - c[2])), r: Math.hypot(p[0] - c[0], p[2] - c[2]), y: p[1] - c[1] });
  const A = polar(a.pos), B = polar(shot.pos);
  // a phone's kayak shot on its way back (shot.back): the dolly out first, low over the water, then the swing and the rise,
  // so the camera never passes between the two paddlers nor tips down onto them (on the way in all move together: a
  // lagging dolly flew the camera over the pair)
  const wa = shot.back ? 1 - (1 - w) * (1 - w) : w, wr = shot.back ? w * w : w;
  const az = A.az + wrap(B.az - A.az) * wa, r = Math.max(6, A.r + (B.r - A.r) * wr), y = Math.max(0.8, A.y + (B.y - A.y) * wa);
  const pos = [c[0] + Math.sin(az) * r, c[1] + y, c[2] - Math.cos(az) * r];
  // and never nearer a paddler than shot.keepNear (m, across the water): pushed out from it
  if (shot.keep && shot.keepNear) for (const P of shot.keep) {
    const dx = pos[0] - P[0], dz = pos[2] - P[2], d = Math.hypot(dx, dz);
    if (d < shot.keepNear) { const k = shot.keepNear / (d || 1e-3); pos[0] = P[0] + (d ? dx * k : shot.keepNear); pos[2] = P[2] + dz * k; }
  }
  const target = [0, 1, 2].map((i) => a.target[i] + (shot.target[i] - a.target[i]) * w);
  const fov = a.fov + ((shot.fov ?? a.fov) - a.fov) * w;
  // shot.keep (a phone's kayak shot, src/kayaks/notice.js): world points the aim turns to hold inside shot.keepBox (NDC
  // [x0, x1, y0, y1]) at shot.aspect, the lens widened up to shot.keepFov when they span more than the box; in full once w
  // is over shot.keepW, fading to none at w 0 (the follow view's own)
  if (shot.keep?.length && shot.aspect) return { pos, ...keepInFrame(pos, target, fov, shot, Math.min(1, w / (shot.keepW || 1))) };
  return { pos, target, fov };
}

// the aim from pos turned (yaw, then pitch) by the least that brings every point inside the box, the lens first widened
// (up to keepFov, never narrowed) when the points span more than the box; k (0–1) scales the turn and the widening.
// Solved on the points' own screen positions (three passes: a pitched view's sides bend the angles). → { target, fov }
function keepInFrame(pos, target, fov, { keep, keepBox: bx = [-0.9, 0.9, -0.9, 0.9], keepFov = fov, keepDown, aspect }, k = 1) {
  if (!(k > 0)) return { target, fov };
  const d = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]], R = Math.hypot(d[0], d[1], d[2]) || 1;
  let psi = Math.atan2(d[0], -d[2]), el = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  const ndc = (ty) => {   // each point on screen for the aim (psi, el) and the lens ty: [x, y, depth]
    const sp = Math.sin(psi), cp = Math.cos(psi), s = Math.sin(-el), c = Math.cos(-el), tx = ty * aspect;
    return keep.map((P) => { const dx = P[0] - pos[0], dy = P[1] - pos[1], dz = P[2] - pos[2], zc = dx * sp * c - dy * s - dz * cp * c;
      return [(dx * cp + dz * sp) / (zc * tx), (dx * sp * s + dy * c - dz * cp * s) / (zc * ty), zc]; });
  };
  const fit = (lo, hi, vs) => { const a = Math.min(...vs), b = Math.max(...vs); return b - a > hi - lo ? (a + b - lo - hi) / 2 : a < lo ? a - lo : b > hi ? b - hi : 0; };
  let ty = Math.tan(fov * Math.PI / 360);
  // a point behind or beside the camera: turn toward it by its angle first
  const az = keep.map((P) => wrap(Math.atan2(P[0] - pos[0], -(P[2] - pos[2])) - psi));
  if (Math.max(...az.map(Math.abs)) > 1.2) psi += k * fit(-1, 1, az);
  // the lens: wide enough for the span across and up and down
  let q = ndc(ty).filter((v) => v[2] > 0.1);
  if (q.length) {
    const sx = Math.max(...q.map((v) => v[0])) - Math.min(...q.map((v) => v[0])), sy = Math.max(...q.map((v) => v[1])) - Math.min(...q.map((v) => v[1]));
    const grow = Math.max(1, sx / (bx[1] - bx[0]), sy / (bx[3] - bx[2]));
    const want = Math.min(keepFov, Math.max(fov, 2 * Math.atan(ty * grow) * 180 / Math.PI));
    fov += (want - fov) * k; ty = Math.tan(fov * Math.PI / 360);
  }
  for (let i = 0; i < 3; i++) {
    q = ndc(ty).filter((v) => v[2] > 0.1);
    if (!q.length) break;
    psi += k * Math.atan(fit(bx[0], bx[1], q.map((v) => v[0])) * ty * aspect);
    q = ndc(ty).filter((v) => v[2] > 0.1);
    el += k * Math.atan(fit(bx[2], bx[3], q.map((v) => v[1])) * ty);
  }
  el = Math.max(el, -(keepDown ?? Math.PI / 2));   // never tipped further down than keepDown (rad): the pair may go first
  const c = Math.cos(el);
  return { target: [pos[0] + Math.sin(psi) * c * R, pos[1] + Math.sin(el) * R, pos[2] - Math.cos(psi) * c * R], fov };
}
