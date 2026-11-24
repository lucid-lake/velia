// Lakeshore camera: an autopilot drift over the lake, a manual glide, and the hand-over between them.
// Plain JS, no three.js, so node tests can drive it; the page maps a pose onto its THREE camera (see demos/camera.js).
//
// World frame (as src/terrain.js): x east, y up, z south, metres; the water level is y = 0.
// A pose is { pos: [x, y, z], vel: [vx, vy, vz], yaw, pitch, fov, mode }: yaw in radians clockwise from north
// (forward = (sin yaw, ·, −cos yaw)), pitch in radians up from level, fov in degrees (vertical). Never any roll.
//
//   import { cameraAt, CameraRig, attachInput } from './camera.js';
//   cameraAt(t, heightAt)                   // the autopilot's pose at t seconds: deterministic, for captures
//   const rig = new CameraRig({ heightAt }); // live: rig.update(dt, input) → pose; any input takes control,
//   const input = attachInput(canvas);       //   20 s with none returns to the drift through a 3 s blend
//   rig.update(dt, input.poll());
//
// Height floor, every mode: 3 m over water, 8 m over land: floor = max(3, heightAt + 8). The drift keeps 3 m above it;
// a smooth guard keeps any pose at or above it.
// Eye-level mode (rig.eyeLevel = 0.8–1.6 m, for later) replaces the floor with water or ground + that height.

export const FOV = 50;
const FLOOR_WATER = 3, FLOOR_LAND = 8;
const MARGIN = 3.0;                 // m the autopilot path keeps above the floor (clear of the guard below)
const GUARD = 1.0;                  // m: the final guard bends a pose up only within this of the floor, any mode
const SPEED_MIN = 2, SPEED_MAX = 6; // m/s along the drift
const A_LAT = 0.05;                 // m/s², the drift's lateral acceleration in a turn (sets the turn speed)
const COMFORT_LAND = 25;           // m the drift aims to keep over land (not a floor: slopes stay out of the frame)
const RISE_R = 250;                 // m: the path rises this far ahead of a floor and comes down this far after
const DS = 1;                       // m, the path table's spacing
export const IDLE_S = 20, BLEND_S = 3;
const OFFSET_RATE = 1.0;            // m/s: after a rejoin, the gap to the path closes at about this mean speed
// Owner 2026-10-29: 8 m/s read as "not working" on a 3 km lake. Speed scales with height over the ground
// (Google-Earth style): `speed` at or below `refH`, ×h/refH above it; Shift ×4; rise and sink follow the same scale.
const GLIDE = { speed: 30, refH: 40, fast: 4, vspeed: 10, tau: 0.6, accMax: 15, lookTau: 0.12, sens: 0.0022, stick: 1.6 };   // accMax m/s²: no kick on a key press

// The drift (the real Emerald Bay, 2026-10-29): start at cam A by the mouth, down the bay past the island's south-east
// side, round it, across the head (the beach, the stone house, the falls' gully), back up the north shore along the
// waterline, out through the mouth into the open lake, round over the lake off Eagle Point and back in to cam A.
const WAYPOINTS = [
  [1050, 40, -820],     // cam A
  [700, 32, -500],
  [350, 30, -250],
  [160, 25, 60],        // the island, 160 m to the south-east of it
  [-60, 25, 180],
  [-250, 30, 80],
  [-420, 35, 250],
  [-560, 45, 330],      // the head: the beach and the stone house,
  [-760, 55, 200],      // the falls' gully
  [-420, 40, -20],
  [-150, 30, -150],     // up the north shore, along the waterline
  [150, 32, -400],
  [500, 35, -650],
  [900, 35, -950],
  [1400, 40, -1050],
  [1690, 40, -1320],    // through the mouth
  [1750, 40, -1800],    // out into the open lake
  [2300, 45, -2200],
  [2500, 60, -1300],
  [2200, 60, -700],     // back along Eagle Point's shore
  [1300, 40, -600],
];

export function floorAt(heightAt, x, z) {
  return Math.max(FLOOR_WATER, heightAt(x, z) + FLOOR_LAND);
}

// polynomial smooth max: ≥ max(a, b), C1
function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
const smoothstep = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// centripetal Catmull-Rom through a closed loop of points, sampled densely
function catmullRomLoop(P, perSeg = 4000) {
  const n = P.length, out = [];
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + (t2 - t1) * k / perSeg, q = [0, 0, 0];
      for (let d = 0; d < 3; d++) {
        const a1 = (t1 - t) / (t1 - t0) * p0[d] + (t - t0) / (t1 - t0) * p1[d];
        const a2 = (t2 - t) / (t2 - t1) * p1[d] + (t - t1) / (t2 - t1) * p2[d];
        const a3 = (t3 - t) / (t3 - t2) * p2[d] + (t - t2) / (t3 - t2) * p3[d];
        const b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2;
        const b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3;
        q[d] = (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2;
      }
      out.push(q);
    }
  }
  return out;
}

// circular sliding max (radius r samples), O(n) with a deque
function slidingMax(a, r) {
  const n = a.length, out = new Float64Array(n), dq = [];
  for (let j = -r; j < n + r; j++) {
    const jj = ((j % n) + n) % n;
    while (dq.length && a[((dq[dq.length - 1] % n) + n) % n] <= a[jj]) dq.pop();
    dq.push(j);
    const i = j - r;
    while (dq[0] < i - r) dq.shift();
    if (i >= 0 && i < n) out[i] = a[((dq[0] % n) + n) % n];
  }
  return out;
}
function slidingMin(a, r) { return slidingMax(a.map((v) => -v), r).map((v) => -v); }

// circular Gaussian blur, sigma in samples, truncated at radius r
function blur(a, sigma, r) {
  const n = a.length, w = [], out = new Float64Array(n);
  let sum = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-0.5 * (k / sigma) ** 2); w.push(v); sum += v; }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += a[(((i + k) % n) + n) % n] * w[k + r];
    out[i] = acc / sum;
  }
  return out;
}

// The autopilot: a closed path, its heights and speeds, and a clock. All tables at DS = 1 m.
export class Autopilot {
  constructor({ heightAt, waypoints = WAYPOINTS } = {}) {
    this.heightAt = heightAt;
    // 1. the curve, resampled to equal arc length
    const dense = catmullRomLoop(waypoints);
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
    }
    const L = cum[dense.length], n = Math.round(L / DS);
    this.length = L; this.n = n; this.ds = L / n;                    // ≈ DS, so the loop closes exactly
    const X = new Float64Array(n), Yw = new Float64Array(n), Z = new Float64Array(n);
    for (let i = 0, k = 0; i < n; i++) {
      const s = i * this.length / n;
      while (cum[k + 1] < s) k++;
      const u = (s - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-9), a = dense[k], b = dense[(k + 1) % dense.length];
      X[i] = a[0] + (b[0] - a[0]) * u; Yw[i] = a[1] + (b[1] - a[1]) * u; Z[i] = a[2] + (b[2] - a[2]) * u;
    }
    this.X = X; this.Z = Z;
    // 2. heights: the wish or the floor (+ margin), whichever is higher; a sliding max over RISE_R, then a Gaussian
    // truncated inside the same window, so every sample stays at or above its own floor
    const r = Math.round(RISE_R / DS);
    const env = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const g = heightAt(X[i], Z[i]);
      env[i] = Math.max(Yw[i], floorAt(heightAt, X[i], Z[i]) + MARGIN, g > 0 ? g + COMFORT_LAND : 0);
    }
    this.Y = blur(slidingMax(env, r), r / 3, r);
    // 3. speed: limited by the turn (a = v² κ ≤ A_LAT), slowing before a turn (sliding min), smoothed
    const V = new Float64Array(n), q = Math.round(20 / DS);
    for (let i = 0; i < n; i++) {
      const a = (i - q + n) % n, b = (i + q) % n;
      const h1 = Math.atan2(X[i] - X[a], -(Z[i] - Z[a])), h2 = Math.atan2(X[b] - X[i], -(Z[b] - Z[i]));
      const kappa = Math.abs(wrapAngle(h2 - h1)) / (2 * q * DS);
      V[i] = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.sqrt(A_LAT / Math.max(kappa, 1e-9))));
    }
    const rv = Math.round(150 / DS);
    this.V = blur(slidingMin(V, rv), rv / 3, rv);
    // 4. the clock: R = samples per second = v / (3-D length of the sample), so v is the true speed on a climb.
    // R runs linearly across each sample (no velocity steps), so a sample takes ∫ du / R = ln(R1 / R0) / (R1 − R0)
    const R = new Float64Array(n), T = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      R[i] = this.V[i] / Math.hypot(X[j] - X[i], this.Y[j] - this.Y[i], Z[j] - Z[i]);
    }
    for (let i = 0; i < n; i++) T[i + 1] = T[i] + cross(R[i], R[(i + 1) % n], 1);
    this.R = R; this.T = T; this.period = T[n];
    // 5. heading: tangents averaged over the next 40–160 m, so turns ease in before the path bends
    const hx = new Float64Array(n), hz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = (i + 1) % n;
      hx[i] = X[b] - X[i]; hz[i] = Z[b] - Z[i];
    }
    const ahead = Math.round(100 / DS), rr = Math.round(60 / DS);
    const bx = blur(hx, rr / 2, rr), bz = blur(hz, rr / 2, rr);
    this.H = new Float64Array(n);
    for (let i = 0; i < n; i++) { const j = (i + ahead) % n; this.H[i] = Math.atan2(bx[j], -bz[j]); }
  }

  // arc length at time t (looped)
  sAt(t) {
    const P = this.period, tt = ((t % P) + P) % P;
    let lo = 0, hi = this.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.T[mid] <= tt) lo = mid; else hi = mid; }
    const r0 = this.R[lo], d = this.R[(lo + 1) % this.n] - r0, tau = tt - this.T[lo];
    const u = Math.abs(d) < 1e-12 ? r0 * tau : r0 * Math.expm1(d * tau) / d;
    return (lo + Math.min(u, 1)) * this.ds;
  }

  timeAtS(s) {
    const f = (((s / this.ds) % this.n) + this.n) % this.n, i = Math.floor(f);
    return this.T[i] + cross(this.R[i], this.R[(i + 1) % this.n], f - i);
  }

  // position, velocity and heading at arc length s: a uniform Catmull-Rom through the 1 m samples, so the
  // position is C1 and the velocity has no steps; the heading's angle is interpolated
  poseAtS(s) {
    const n = this.n, f = (((s / this.ds) % n) + n) % n, i = Math.floor(f), u = f - i;
    const h = (i - 1 + n) % n, j = (i + 1) % n, k = (i + 2) % n;
    const cr = (A) => {
      const p0 = A[h], p1 = A[i], p2 = A[j], p3 = A[k];
      const c1 = -p0 + p2, c2 = 2 * p0 - 5 * p1 + 4 * p2 - p3, c3 = -p0 + 3 * p1 - 3 * p2 + p3;
      return [p1 + 0.5 * u * (c1 + u * (c2 + u * c3)), 0.5 * (c1 + u * (2 * c2 + 3 * u * c3))];   // value, d/du
    };
    const [x, dx] = cr(this.X), [y, dy] = cr(this.Y), [z, dz] = cr(this.Z);
    const rate = this.R[i] + (this.R[j] - this.R[i]) * u;             // samples per second, as the clock
    const yaw = this.H[i] + wrapAngle(this.H[j] - this.H[i]) * u;
    return { pos: [x, y, z], vel: [dx * rate, dy * rate, dz * rate], yaw, pitch: pitchFor(y), fov: FOV };
  }

  poseAt(t) { return this.poseAtS(this.sAt(t)); }

  // the arc length of the path sample nearest (x, z)
  nearestS(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i += 5) { const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    for (let i = best - 5; i <= best + 5; i++) {
      const k = (i + this.n) % this.n, d = (this.X[k] - x) ** 2 + (this.Z[k] - z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best * this.ds;
  }
}

// the time to cross u of a sample whose rate runs linearly from r0 to r1: ∫0^u du / (r0 + (r1 − r0) u)
function cross(r0, r1, u) {
  const d = r1 - r0;
  return Math.abs(d) < 1e-12 ? u / r0 : Math.log1p(d * u / r0) / d;
}

// a little above level, a little less when high: the ridges sit in the upper frame (the target look, cam A ≈ +5°)
function pitchFor(y) { return (Math.min(4, Math.max(-4, 4 - y / 40)) * Math.PI) / 180; }

// the floor guard: a pose at or above the floor whatever the mode (the smooth max is ≥ both and C1); it bends a pose
// only within GUARD of the floor, which the drift never comes to
function keepFloor(heightAt, pose) {
  pose.pos[1] = smax(pose.pos[1], floorAt(heightAt, pose.pos[0], pose.pos[2]), GUARD);
  return pose;
}

const pilots = new WeakMap();
// The autopilot's pose at t seconds from the start (cam A): a pure function of t for a given heightAt.
export function cameraAt(t, heightAt) {
  let p = pilots.get(heightAt);
  if (!p) { p = new Autopilot({ heightAt }); pilots.set(heightAt, p); }
  return { ...keepFloor(heightAt, p.poseAt(t)), mode: 'auto' };
}

// critically damped smoothing of x toward a target with time constant tau (Unity's SmoothDamp form)
function damp(x, v, target, tau, dt) {
  const w = 2 / tau, e = w * dt, k = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e);
  const c = x - target, tmp = (v + w * c) * dt;
  return [target + (c + tmp) * k, (v - w * tmp) * k];
}

const NO_INPUT = { move: [0, 0], rise: 0, look: [0, 0], stick: [0, 0], fast: false, active: false };

// The live camera: the drift until any input; then a damped glide; IDLE_S without input, a BLEND_S blend back
// (the drift's clock eases up from rest; the heading turns to the path's along the same smoothstep).
export class CameraRig {
  constructor({ heightAt, autopilot, t0 = 0 } = {}) {
    this.heightAt = heightAt;
    this.pilot = autopilot ?? new Autopilot({ heightAt });
    this.time = 0;
    this.autoT = t0;                      // the autopilot's own clock
    this.offset = null;                   // after a rejoin: { o0, T, start } — the gap to the path, fading
    this.mode = 'auto';
    this.eyeLevel = 0;                    // 0: off; 0.8–1.6 m: ride at that height over water or ground (manual)
    this.idle = 0;
    const p = this.autoPose();
    this.pos = p.pos.slice(); this.vel = p.vel.slice(); this.acc = [0, 0, 0];
    this.yaw = p.yaw; this.pitch = p.pitch; this.yawV = 0; this.pitchV = 0;
    this.yawT = p.yaw; this.pitchT = p.pitch;
  }

  // the autopilot at its clock, plus any fading rejoin gap
  autoPose() {
    const p = this.pilot.poseAt(this.autoT);
    if (this.offset) {
      const { o0, T, start } = this.offset, tau = this.autoT - start;
      const w = 1 - smoothstep(tau / T), dw = tau < T ? -6 * (tau / T) * (1 - tau / T) / T : 0;
      for (let d = 0; d < 3; d++) { p.pos[d] += o0[d] * w; p.vel[d] += o0[d] * dw; }
      if (tau >= T) this.offset = null;
    }
    return p;
  }

  update(dt, input = NO_INPUT) {
    // fixed sub-steps keep the damping and the blend independent of the frame rate
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    let pose;
    for (let i = 0; i < steps; i++) pose = this.step(dt / steps, input, i === 0);
    return pose;
  }

  step(dt, input, first) {
    this.time += dt;
    const active = input.active || input.move[0] || input.move[1] || input.rise || input.look[0] || input.look[1] || input.stick[0] || input.stick[1];
    if (active) {
      if (this.mode !== 'manual') this.takeOver();
      this.idle = 0;
    } else this.idle += dt;

    if (this.mode === 'auto') {
      const prev = this.pos.slice();
      this.autoT += dt;
      const p = this.autoPose();
      this.pos = p.pos; this.vel = p.vel; this.yaw = p.yaw; this.pitch = p.pitch;
      return this.out(prev, dt);
    }

    // manual (also the manual half of a blend): a damped glide toward the input's velocity
    const yaw = this.yawT;
    const look = first ? input.look : [0, 0];                     // mouse deltas count once per frame
    this.yawT += look[0] * GLIDE.sens + input.stick[0] * GLIDE.stick * dt;
    this.pitchT = Math.max(-1.4, Math.min(1.4, this.pitchT - look[1] * GLIDE.sens - input.stick[1] * GLIDE.stick * dt));
    [this.yaw, this.yawV] = damp(this.yaw, this.yawV, this.yawT, GLIDE.lookTau, dt);
    [this.pitch, this.pitchV] = damp(this.pitch, this.pitchV, this.pitchT, GLIDE.lookTau, dt);
    const hOver = this.pos[1] - Math.max(0, this.heightAt(this.pos[0], this.pos[2]));
    const scale = Math.max(1, hOver / GLIDE.refH);
    const sp = GLIDE.speed * scale * (input.fast ? GLIDE.fast : 1);
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const target = [(fx * input.move[1] + rx * input.move[0]) * sp, input.rise * GLIDE.vspeed * scale * (input.fast ? GLIDE.fast : 1), (fz * input.move[1] + rz * input.move[0]) * sp];
    const prev = this.pos.slice();
    const v0 = this.vel.slice();
    for (let d = 0; d < 3; d++) [this.vel[d], this.acc[d]] = damp(this.vel[d], this.acc[d], target[d], GLIDE.tau, dt);
    // cap the acceleration (|Δv| ≤ accMax·dt), so a key press at 30–120 m/s ramps in instead of kicking
    const dv = [0, 1, 2].map((d) => this.vel[d] - v0[d]), dvl = Math.hypot(...dv), cap = GLIDE.accMax * dt;
    if (dvl > cap) for (let d = 0; d < 3; d++) { this.vel[d] = v0[d] + dv[d] * cap / dvl; this.acc[d] = dv[d] * cap / dvl / dt; }
    for (let d = 0; d < 3; d++) this.pos[d] += this.vel[d] * dt;
    if (this.eyeLevel > 0) {
      const g = Math.max(this.heightAt(this.pos[0], this.pos[2]), 0) + this.eyeLevel;
      [this.pos[1], this.vel[1]] = damp(this.pos[1], this.vel[1], g, 0.3, dt);
    } else {
      // the floor as a soft spring before the hard keep below: climb out at up to 2 m/s
      const f = floorAt(this.heightAt, this.pos[0], this.pos[2]) + GUARD + 1;
      if (this.pos[1] < f) { this.pos[1] += Math.min(f - this.pos[1], 2 * dt); this.vel[1] = Math.max(this.vel[1], 0); }
    }

    if (this.mode === 'manual' && this.idle >= IDLE_S) this.rejoin();
    if (this.mode === 'blend') {
      // the drift's clock starts from rest and comes up to speed along the same smoothstep, so the camera eases
      // out of its stop onto the path with no overshoot; any glide still left from the manual half fades out
      const tau = this.time - this.blendStart, w = smoothstep(tau / BLEND_S);
      this.autoT += dt * w;
      const a = this.autoPose();
      const m = { pos: this.pos.slice(), yaw: this.yaw, pitch: this.pitch };
      const outPos = a.pos.map((v, d) => v + (m.pos[d] - this.blendM0[d]) * (1 - w));
      const outYaw = m.yaw + wrapAngle(a.yaw - m.yaw) * w, outPitch = m.pitch + (a.pitch - m.pitch) * w;
      if (tau >= BLEND_S) {                                         // the drift has it again
        this.mode = 'auto';
        this.pos = a.pos; this.vel = a.vel; this.yaw = a.yaw; this.pitch = a.pitch;
        return this.out(prev, dt);
      }
      return this.out(prev, dt, { pos: outPos, yaw: outYaw, pitch: outPitch });
    }
    return this.out(prev, dt);
  }

  // input arrived: keep the current pose and velocity (C1), steer from here
  takeOver() {
    if (this.mode === 'blend' && this.lastOut) {
      this.pos = this.lastOut.pos.slice(); this.yaw = this.lastOut.yaw; this.pitch = this.lastOut.pitch;
      this.vel = this.lastOut.vel.slice();
    }
    this.mode = 'manual';
    this.acc = [0, 0, 0];
    this.yawT = this.yaw; this.pitchT = this.pitch; this.yawV = 0; this.pitchV = 0;
    this.offset = null;
  }

  // no input for IDLE_S: rejoin the path at its nearest point; the gap fades out after the blend
  rejoin() {
    const s = this.pilot.nearestS(this.pos[0], this.pos[2]);
    this.autoT = this.pilot.timeAtS(s);
    const p = this.pilot.poseAtS(s);
    const o0 = p.pos.map((v, d) => this.pos[d] - v);
    this.offset = { o0, T: Math.max(BLEND_S, 1.5 * Math.hypot(...o0) / OFFSET_RATE), start: this.autoT };
    this.mode = 'blend';
    this.blendStart = this.time;
    this.blendM0 = this.pos.slice();
  }

  out(prev, dt, over) {
    let pose = { pos: (over?.pos ?? this.pos).slice(), yaw: over?.yaw ?? this.yaw, pitch: over?.pitch ?? this.pitch, fov: FOV };
    if (this.eyeLevel > 0 && this.mode === 'manual') pose.pos[1] = Math.max(pose.pos[1], Math.max(this.heightAt(pose.pos[0], pose.pos[2]), 0) + 0.3);
    else pose = keepFloor(this.heightAt, pose);
    const last = this.lastOut;
    pose.vel = last ? pose.pos.map((v, d) => (v - last.pos[d]) / dt) : this.vel.slice();
    pose.mode = this.mode;
    this.lastOut = pose;
    return pose;
  }
}

// Browser input: WASD (+ Q/E or Space/C to rise and sink, Shift for fast), mouse look under pointer lock (click
// the canvas), and the first gamepad (left stick move, right stick look, triggers rise and sink).
export function attachInput(dom) {
  const keys = new Set();
  let mdx = 0, mdy = 0;
  const kd = (e) => keys.add(e.code), ku = (e) => keys.delete(e.code);
  let dragging = false;
  const md = () => { dragging = true; }, mu = () => { dragging = false; };
  const mm = (e) => { if (document.pointerLockElement === dom || dragging) { mdx += e.movementX; mdy += e.movementY; } };
  const click = () => {};   // drag to look; pointer lock on double-click
  const dbl = () => dom.requestPointerLock?.();
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('mousemove', mm); dom.addEventListener('click', click);
  dom.addEventListener('mousedown', md); addEventListener('mouseup', mu); dom.addEventListener('dblclick', dbl);
  addEventListener('blur', () => { keys.clear(); dragging = false; });   // focus loss must not leave a key held
  const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  return {
    poll() {
      const k = (c) => (keys.has(c) ? 1 : 0);
      const move = [k('KeyD') - k('KeyA'), k('KeyW') - k('KeyS')];
      let rise = k('KeyE') + k('Space') - k('KeyQ') - k('KeyC');
      let stick = [0, 0];
      const pad = navigator.getGamepads?.()[0];
      if (pad) {
        move[0] += dz(pad.axes[0] ?? 0); move[1] -= dz(pad.axes[1] ?? 0);
        stick = [dz(pad.axes[2] ?? 0), dz(pad.axes[3] ?? 0)];
        rise += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      }
      const look = [mdx, mdy];
      mdx = 0; mdy = 0;
      return { move, rise, look, stick, fast: keys.has('ShiftLeft') || keys.has('ShiftRight'), active: keys.size > 0 || dragging };
    },
    dispose() {
      removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('mousemove', mm); dom.removeEventListener('click', click);
      dom.removeEventListener('mousedown', md); removeEventListener('mouseup', mu); dom.removeEventListener('dblclick', dbl);
    },
  };
}
