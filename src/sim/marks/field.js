// The racing marks on the water (feat/marks): the floating bodies (body.js), their rodes, the wind, and the boat's hull,
// keel and rudder against each mark. Plain JS, no three.js: tests/marks.test.mjs drives it in node, src/marks/scene.js
// draws it.
//
//   const field = new MarkField({ surface, windAt, depthAt, current?, onTouch? });
//   const m = field.add({ id, type: 'sphere'|'cylinder'|'tetra'|'pin'|'committee', x, z, anchor?: { x, z }, scope? });
//   per boat tick (the physics' env.post, 60 Hz): field.step(dt, boatState, t, boatPose?)  // moves the marks, bumps the boat's velocities
//
// Time: the marks step at 120 Hz inside the boat's 60 Hz tick (two substeps), the same fixed clock; marks far from the
// boat (over FAR_M) step at 15 Hz. The surface is sampled once per tick per mark (9 points, body.js WaterFit).
//
// Collision (per substep, marks within NEAR_M of the boat): each mark is a few collision spheres (capsule-like for the
// tall ones); each is tested against the boat's signed-distance solid (hull.js: 21 hull stations, the overhangs, the fin
// keel, the rudder turned with the helm). A sphere inside the solid gets an impulse along the surface normal with the
// restitution of an inflatable (0.15 above 0.5 m/s of closing speed, none below), the mass ratio of the two bodies (the
// boat's surge and sway added masses, src/boat.js BOAT.m11 and m22, and its yaw inertia), and Coulomb friction (0.35: wet
// PVC on gelcoat), so the mark rolls along the topsides; then the mark is moved out along the normal until the gap is
// zero. The boat is never moved, only its velocities change (a small drag and a turn); each change is capped.
// Penetration is impossible: the mark is projected out every substep, and at 8 kn the boat moves 3.4 cm per substep.
//
// Frames: world x east, y up, z south; heading clockwise from north (−z).
import { FloatBody, MARK_TYPES, WaterFit, makeRode, designDraft, extent } from './body.js';
import { makeHull, toBody, fromBodyVec } from './hull.js';
import { BOAT } from '../boat.js';

export const NEAR_M = 14, FAR_M = 450, SLEEP_M = 3500, H_NEAR = 1 / 120, H_FAR = 1 / 15;
export const CONTACT = { e: 0.15, eAbove: 0.5, mu: 0.35, maxDu: 0.35, maxDv: 0.35, maxDr: 0.06, cool: 1.0 };
const WIND_AT_1M = Math.pow(1 / 10, 0.14);   // the 10 m wind scaled to the marks' height (the log-law's power form, src/boat.js)

export class MarkField {
  constructor({ surface, windAt = () => ({ vx: 0, vz: 0 }), depthAt = () => 10, current = null, onTouch = null, hull = null } = {}) {
    this.surface = surface; this.windAt = windAt; this.depthAt = depthAt; this.current = current; this.onTouch = onTouch;
    this.hull = hull ?? makeHull();
    this.marks = []; this.events = []; this.time = 0;
    this.stats = { steps: 0, contacts: 0, maxPen: 0, minGap: Infinity };
    this._bp = [0, 0, 0]; this._n = [0, 0, 0]; this._nw = [0, 0, 0]; this._tmp = [0, 0, 0];
  }

  add({ id = `m${this.marks.length}`, type = 'sphere', x = 0, z = 0, anchor = null, scope = 3, yaw = 0, colour = 'orange', role = 'mark' } = {}) {
    const body = new FloatBody(type);
    const eta = this.surface.heightAt(x, z, this.time);
    body.reset(x, z, this.time, { eta, yaw });
    const a = anchor ?? { x, z };
    const depth = Math.max(1.5, Math.min(60, this.depthAt(a.x, a.z)));
    body.anchor = { x: a.x, z: a.z, depth };
    body.rode = makeRode({ depth, scope, w: type === 'committee' ? 25 : 6, ea: type === 'committee' ? 90000 : 25000, ringUp: -body.design.draft });
    const ext = extent(MARK_TYPES[type]), fit = new WaterFit(Math.max(0.5, Math.min(3, 0.9 * Math.max(ext[0], ext[2]))));
    let hsh = 7; for (const ch of String(id)) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    const m = { id, type, body, fit, side: hsh & 1 ? 1 : -1, role, colour, anchor: body.anchor, acc: 0, rate: { a: 0, b: 0, c: 0, k: 0 }, sleeping: false, touchCool: 0, touching: false, touches: 0, lastImpulse: 0, sampleT: null };
    this.marks.push(m);
    return m;
  }
  remove(id) { const i = this.marks.findIndex((m) => m.id === id); if (i >= 0) this.marks.splice(i, 1); }
  clear() { this.marks.length = 0; this.events.length = 0; }
  get(id) { return this.marks.find((m) => m.id === id); }

  // sample the water under a mark at time t: refresh its fit, the rate of its centre height
  sampleWater(m, t, dt) {
    const b = m.body, f = m.fit, prev = b.fit;
    const nf = f.sample(this.surface, b.p[0], b.p[2], t, {});
    if (prev && dt > 0) {   // the old plane read at the new centre: the surface's vertical speed there
      const ex = nf.ox - prev.ox, ez = nf.oz - prev.oz, old = prev.a + prev.b * ex + prev.c * ez + prev.k * (ex * ex + ez * ez);
      m.rate.a = (nf.a - old) / dt;
    }
    b.fitPrev = prev; b.fit = nf;
  }

  // one physics tick. s: the boat's state (x, z, heading, u, v, yawRate, rudderAngle, heel, pitch, heave); pose: the boat's
  // drawn pose (heave, pitch, heel with the waves) if different. The boat's velocities change on contact.
  step(dt, s, t = this.time, pose = null) {
    this.time = t + dt;
    const B = pose ?? s;
    const boat = { x: s.x, z: s.z, heading: s.heading, heel: B.heel ?? 0, pitch: B.pitch ?? 0, heave: B.heave ?? 0 };
    for (const m of this.marks) {
      const b = m.body, d = Math.hypot(b.p[0] - s.x, b.p[2] - s.z);
      if (d > SLEEP_M) { m.sleeping = true; continue; }
      m.sleeping = false;
      const near = d < FAR_M, h = near ? H_NEAR : H_FAR;
      m.acc += dt;
      if (m.sampleT == null || m.acc >= h - 1e-9) this.sampleWater(m, this.time, near ? Math.min(dt, m.acc) : m.acc);
      m.sampleT = this.time;
      const w = this.windAt(b.p[0], b.p[2], this.time), wind = [w.vx * WIND_AT_1M, w.vz * WIND_AT_1M];
      const cur = this.current ? this.current(b.p[0], b.p[2], this.time) : null;
      const ctx = { fit: b.fit, fitRate: m.rate, wind, current: cur ? [cur.vx, cur.vz] : null };
      while (m.acc >= h - 1e-9) {
        m.acc -= h;
        b.step(h, ctx);
        if (d < NEAR_M + 8) this.collide(m, s, boat, h);
        this.stats.steps++;
      }
      if (m.touching) { m.touchCool -= dt; if (m.touchCool <= 0) m.touching = false; }
    }
  }

  // run n seconds with the boat far away (laying a course: the marks drift to where the wind and the rodes put them)
  settle(secs, t0 = this.time, boat = { x: 1e6, z: 1e6, heading: 0, u: 0, v: 0, yawRate: 0, rudderAngle: 0, heel: 0, pitch: 0, heave: 0 }) {
    let t = t0;
    const dt = 1 / 30;
    for (let i = 0; i < secs / dt; i++, t += dt) {
      // the far boat keeps every mark on the far (15 Hz) clock; settle at 30 Hz explicitly instead
      for (const m of this.marks) {
        const b = m.body; m.acc = 0;
        this.sampleWater(m, t + dt, dt);
        const w = this.windAt(b.p[0], b.p[2], t), ctx = { fit: b.fit, fitRate: m.rate, wind: [w.vx * WIND_AT_1M, w.vz * WIND_AT_1M], current: null };
        for (let k = 0; k < 4; k++) b.step(dt / 4, ctx);
      }
    }
    this.time = t;
  }

  // the boat against one mark (per substep)
  collide(m, s, boat, h) {
    const b = m.body, hull = this.hull, T = b.T, rud = s.rudderAngle ?? 0;
    const m11 = BOAT.mass * BOAT.m11, m22 = BOAT.mass * BOAT.m22, izz = BOAT.izz;
    const sh = Math.sin(s.heading), ch = Math.cos(s.heading), fx = sh, fz = -ch, sx = ch, sz = sh;
    const meff = b.mass + b.mAddH;
    for (let pass = 0; pass < 3; pass++) {
      let worst = 0, any = false;
      for (let i = 0; i < T.spheres.length; i++) {
        const sp = T.spheres[i], c = b.worldPoint(sp, this._tmp), r = sp[3];
        const bp = toBody(boat, c[0], c[1], c[2], this._bp);
        const sd = hull.sdf(bp[0], bp[1], bp[2], rud) - r;
        this.stats.minGap = Math.min(this.stats.minGap, sd);
        if (sd >= 0) continue;
        const nb = hull.normal(bp[0], bp[1], bp[2], rud, this._n);
        // dead ahead of the stem the contact is a knife edge; the bow wave pushes a mark aside, so tilt a near-centred normal by a hair (the side from the mark's name)
        if (Math.abs(nb[1]) < 0.12 && nb[0] > 0.5) { nb[1] += 0.12 * m.side; const l = Math.hypot(nb[0], nb[1], nb[2]); nb[0] /= l; nb[1] /= l; nb[2] /= l; }
        const n = fromBodyVec(boat, nb[0], nb[1], nb[2], this._nw);
        const nx = n[0], ny = n[1], nz = n[2], pen = -sd;
        any = true; worst = Math.max(worst, pen);
        // the contact point on the mark's skin, towards the hull
        const cx = c[0] - nx * r, cy = c[1] - ny * r, cz = c[2] - nz * r;
        // the mark's velocity there, and the boat's (the hull is a rigid body turning at yawRate about its origin)
        const vm = b.velocityAt(cx, cy, cz, [0, 0, 0]);
        const px = (cx - s.x) * fx + (cz - s.z) * fz, py = (cx - s.x) * sx + (cz - s.z) * sz;   // body offset (forward, starboard)
        const vbF = s.u - s.yawRate * py, vbS = s.v + s.yawRate * px;
        const vbx = vbF * fx + vbS * sx, vbz = vbF * fz + vbS * sz;
        const rvx = vm[0] - vbx, rvy = vm[1], rvz = vm[2] - vbz;
        const vn = rvx * nx + rvy * ny + rvz * nz;
        // move the mark out: the gap goes to zero (plus a hair), whatever the velocities do
        const out = pen * 1.05 + 1e-3; b.p[0] += nx * out; b.p[1] += ny * out; b.p[2] += nz * out;
        this.stats.maxPen = Math.max(this.stats.maxPen, pen);
        if (vn >= 0) continue;
        // inverse masses along the normal
        const rx = cx - b.p[0], ry = cy - b.p[1], rz = cz - b.p[2];
        const invM = (ax, ay, az) => {   // the mark's inverse effective mass along a unit direction at the contact
          const kx = ry * az - rz * ay, ky = rz * ax - rx * az, kz = rx * ay - ry * ax;   // r × a
          const R = b.R, bx = R[0] * kx + R[3] * ky + R[6] * kz, by = R[1] * kx + R[4] * ky + R[7] * kz, bz = R[2] * kx + R[5] * ky + R[8] * kz;
          return 1 / meff + bx * bx / (b.I[0] * 1.3) + by * by / (b.I[1] * 1.1) + bz * bz / (b.I[2] * 1.3);
        };
        const invB = (ax, az) => { const af = ax * fx + az * fz, as = ax * sx + az * sz, arm = px * as - py * af; return af * af / m11 + as * as / m22 + arm * arm / izz; };
        const nh = Math.hypot(nx, nz);
        const e = -vn > CONTACT.eAbove ? CONTACT.e : 0;
        const jn = -(1 + e) * vn / (invM(nx, ny, nz) + (nh > 1e-6 ? nh * nh * invB(nx / nh, nz / nh) : 0));
        this.impulse(b, s, cx, cy, cz, nx * jn, ny * jn, nz * jn, px, py, fx, fz, sx, sz, m11, m22, izz, meff);
        // friction along the sliding direction
        const tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz, tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-4) {
          const ux = tx / tl, uy = ty / tl, uz = tz / tl, uh = Math.hypot(ux, uz);
          const jt = Math.min(CONTACT.mu * jn, tl / (invM(ux, uy, uz) + (uh > 1e-6 ? uh * uh * invB(ux / uh, uz / uh) : 0)));
          this.impulse(b, s, cx, cy, cz, -ux * jt, -uy * jt, -uz * jt, px, py, fx, fz, sx, sz, m11, m22, izz, meff);
        }
        this.stats.contacts++;
        m.lastImpulse = jn;
        if (!m.touching && jn > 2) {
          m.touching = true; m.touches++;
          const ev = { type: 'markTouched', id: m.id, kind: m.type, role: m.role, part: hull.partAt(bp[0], bp[1], bp[2], rud), t: this.time, speed: -vn, impulse: jn, x: b.p[0], z: b.p[2] };
          this.events.push(ev); this.onTouch?.(ev);
        }
        if (m.touching) m.touchCool = CONTACT.cool;
      }
      if (!any || worst < 1e-3) break;
    }
  }

  // apply the impulse J (N s, world) at a point on the mark; the opposite on the boat (a capped change in u, v, yawRate)
  impulse(b, s, cx, cy, cz, jx, jy, jz, px, py, fx, fz, sx, sz, m11, m22, izz, meff) {
    const rx = cx - b.p[0], ry = cy - b.p[1], rz = cz - b.p[2];
    b.v[0] += jx / meff; b.v[1] += jy / meff; b.v[2] += jz / meff;
    const kx = ry * jz - rz * jy, ky = rz * jx - rx * jz, kz = rx * jy - ry * jx, R = b.R;
    const bx = R[0] * kx + R[3] * ky + R[6] * kz, by = R[1] * kx + R[4] * ky + R[7] * kz, bz = R[2] * kx + R[5] * ky + R[8] * kz;
    const wl0 = bx / (b.I[0] * 1.3), wl1 = by / (b.I[1] * 1.1), wl2 = bz / (b.I[2] * 1.3);
    b.w[0] += R[0] * wl0 + R[1] * wl1 + R[2] * wl2; b.w[1] += R[3] * wl0 + R[4] * wl1 + R[5] * wl2; b.w[2] += R[6] * wl0 + R[7] * wl1 + R[8] * wl2;
    const jf = jx * fx + jz * fz, js = jx * sx + jz * sz, arm = px * js - py * jf;
    const C = CONTACT, cl = (x, a) => Math.max(-a, Math.min(a, x));
    s.u -= cl(jf / m11, C.maxDu); s.v -= cl(js / m22, C.maxDv); s.yawRate -= cl(arm / izz, C.maxDr);
  }

  // the state for the renderer and the tests: per mark, the geometric centre, the rotation matrix, the anchor
  poses() {
    return this.marks.map((m) => ({ id: m.id, type: m.type, role: m.role, colour: m.colour, centre: m.body.centre([0, 0, 0]), R: m.body.R, anchor: m.anchor, tilt: m.body.tiltDeg(), sleeping: m.sleeping }));
  }
}

export { designDraft };
