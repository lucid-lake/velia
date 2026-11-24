// The helm view (owner, 2026-10-29): the camera at the helmsman's eye, standing behind the wheel,
// looking forward over the cabin top and through the dodger, the sails towering above. It is fixed to the boat, so
// the horizon tilts with the heel and the bow rises and falls with the waves: the one camera that rolls (the follow
// camera never does). No shake: the pose is the drawn boat's (src/boat/Boat.js: position, heading, heel, pitch,
// heave), its heel, pitch and heave smoothed over HELM_CAM.tau so a frame's jitter never reaches the eye. A drag looks
// around (yaw ±120°, −40° down to +70° up at the sails) and drifts back to the bow after HELM_CAM.returnAfter s.
// Plain JS (no three.js): tests/helmCamera.test.mjs. Returns { pos, target, up, fov, near } for the page.
//
// Frames: the hull frame (src/boat/dims.js): x starboard, y up from the waterline, z aft. The world pose follows
// Boat.update: world = T(x, heave, z) · Ry(−heading) · Rx(pitch) · Rz(−heel) · local.
const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';

export const HELM_CAM = {
  // standing behind the wheel (axle at z 2.59, rim radius 0.46 m), 0.7 m aft of its rim, on the cockpit sole (y 0.48):
  // the eye 1.52 m above it, under the dodger's top (2.31) so the bow is seen through its window
  eye: [0, 2.0, 3.3],
  pitchDeg: -8,              // the resting look: a touch down, so the wheel's top and the cabin top sit in the frame
  fov: 55, fovMin: 30, fovMax: 70,
  near: 0.08,                // m: the wheel's rim is ≈ 0.5 m from the eye; the default 0.5 m near plane would cut it
  tau: 0.1,                  // s, the heel / pitch / heave smoothing (slight)
  yawMax: 120 * DEG, pitchMin: -40 * DEG, pitchMax: 70 * DEG,
  lookTau: 0.12,             // s, the drag's own easing
  returnAfter: 3, returnTau: 1.2,   // s: hands off the mouse this long, then back to the bow
  holdUpDeg: 12,                     // a look higher than this up stays (round 4, owner 2026-11-07: look up at the sky)
};

export const rotX = ([x, y, z], a) => { const c = Math.cos(a), s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; };
export const rotY = ([x, y, z], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; };
export const rotZ = ([x, y, z], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c, z]; };
// a hull-frame direction → world (no translation), for a pose { heading, heel, pitch }
export const toWorldDir = (v, p) => rotY(rotX(rotZ(v, -(p.heel ?? 0)), p.pitch ?? 0), -(p.heading ?? 0));
export const toWorld = (v, p) => { const d = toWorldDir(v, p); return [d[0] + p.x, d[1] + (p.heave ?? 0), d[2] + p.z]; };

const damp = (x, v, target, tau, dt) => {
  const w = 2 / tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt;
  return [target + (d + tmp) * e, (v - w * tmp) * e];
};

export class HelmCamera {
  // cfg: overrides of HELM_CAM (a second eye on the same boat: Cruise's on-deck camera)
  constructor(cfg = {}) {
    this.cfg = { ...HELM_CAM, ...cfg };
    this.s = null; this.v = { heel: 0, pitch: 0, heave: 0 };
    this.yaw = 0; this.pitch = 0; this.yawT = 0; this.pitchT = 0; this.idle = 1e9; this.zoom = 1;
    this.steady = cfg.steady ?? 0;   // 0 to 1: the share of the boat's heel and pitch the camera cancels (the game sets 0.4: the horizon is steadied a little; 0 = fixed to the boat)
  }
  reset() { this.s = null; this.yaw = this.pitch = this.yawT = this.pitchT = 0; this.idle = 1e9; this.zoom = 1; }
  // pose: the drawn boat's pose (ride.step's); input: { look: [dx, dy] rad or null, zoom: factor }
  update(dt, pose, input = {}) {
    const C = this.cfg;
    if (!this.s) this.s = { heel: pose.heel ?? 0, pitch: pose.pitch ?? 0, heave: pose.heave ?? 0 };
    else for (const k of ['heel', 'pitch', 'heave']) [this.s[k], this.v[k]] = damp(this.s[k], this.v[k], pose[k] ?? 0, C.tau, dt);
    if (input.look) {
      this.yawT = clamp(this.yawT + input.look[0], -C.yawMax, C.yawMax);
      this.pitchT = clamp(this.pitchT - input.look[1], C.pitchMin - C.pitchDeg * DEG, C.pitchMax - C.pitchDeg * DEG);
      this.idle = 0;
    } else this.idle += dt;
    // a look up past C.holdUpDeg stays where it is left (round 4: the Milky Way); a drag brings it down
    if (this.idle > C.returnAfter && C.pitchDeg + this.pitchT / DEG < C.holdUpDeg) { const k = 1 - Math.exp(-dt / C.returnTau); this.yawT -= this.yawT * k; this.pitchT -= this.pitchT * k; }
    const kl = 1 - Math.exp(-dt / C.lookTau);
    this.yaw += (this.yawT - this.yaw) * kl; this.pitch += (this.pitchT - this.pitch) * kl;
    if (input.zoom) this.zoom = clamp(this.zoom * input.zoom, C.fovMin / C.fov, C.fovMax / C.fov);
    const p = { x: pose.x, z: pose.z, heading: pose.heading, heel: this.s.heel, pitch: this.s.pitch, heave: this.s.heave };
    const pos = toWorld(C.eye, p);
    const el = C.pitchDeg * DEG + this.pitch, ya = this.yaw;
    // the look in the hull frame: forward is −z; + yaw to starboard (+x), + elevation up
    // the eye rides the boat's full motion; the view's orientation takes (1 - steady) of its heel and pitch
    const keep = 1 - clamp(this.steady, 0, 1), po = keep === 1 ? p : { ...p, heel: p.heel * keep, pitch: p.pitch * keep };
    const dir = toWorldDir([Math.sin(ya) * Math.cos(el), Math.sin(el), -Math.cos(ya) * Math.cos(el)], po);
    const up = toWorldDir([0, 1, 0], po);
    return { pos, target: [pos[0] + dir[0] * 10, pos[1] + dir[1] * 10, pos[2] + dir[2] * 10], up, fov: C.fov * this.zoom, near: C.near };
  }
}

// Apply a pose ({ pos, target, up?, fov, near? }) to a three.js PerspectiveCamera: the follow view passes no up (the
// world's, no roll), the helm view the boat's.
export function applyPose(camera, p) {
  const up = p.up ?? [0, 1, 0];
  camera.up.set(up[0], up[1], up[2]);
  camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
  camera.lookAt(p.target[0], p.target[1], p.target[2]);
  camera.fov = p.fov; if (p.near != null) camera.near = p.near;
  camera.updateProjectionMatrix();
}
