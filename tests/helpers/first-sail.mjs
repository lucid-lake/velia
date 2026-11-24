// The first pair in node: a sail from a start pose on the real boat physics, the real Tahoe wind at the default
// hour (18:45, level 3 unless `level`, the gust cells and the shifts, the first gust ahead of the default start), the live
// day clock, the helm holding the start heading (the pilot), the sheets as a live page leaves them with no input (the hand
// on the sheets: the default trim); the pair placed at the start in the follow camera's default view (src/kayaks/first.js
// placePair) and stepped by their own minds on the hull model. Clocks as on a live page: the boat's sim runs at 2× (Sail's
// default speed), the kayaks on the wall clock (src/modes/daysail/index.js), so a kayak's step is half the boat's.
//   runFirst({ start: 'default' | 'staged', seed, level, hour, secs, aspect })
//     → { place, boat: [{ t, x, z, sog }], ks: [{ id, startD, minD, at, vMax, vMin, closeCalls }], track: [{ t (wall s), ks: [{ d, rel }] }] }
import { makeTerrain } from '../../src/sim/terrain.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { WindField, firstGustFor } from '../../src/sim/wind.js';
import { BoatPhysics, CONTROLS, Helm } from '../../src/sim/boat.js';
import { HandSheets } from '../../src/sim/sail/sheets.js';
import { TimeOfDay, SAIL_HOUR } from '../../src/sim/timeOfDay.js';
import { daySchedule } from '../../classic/src/sail/options.js';
import { STAGE_START } from '../../src/ui/firstVisit.js';
import { placePair, defaultView } from '../../src/sim/kayaks/first.js';
import { createAgent, stepHull } from '../../src/sim/kayaks/agent.js';
import { createMind, think } from '../../src/sim/kayaks/mind.js';
import { createNotice, NOTICE } from '../../src/sim/kayaks/notice.js';
import { createSettings } from '../../src/ui/settings.js';
import { FollowCamera, FOLLOW } from '../../src/sim/boat/followCamera.js';

export const T = makeTerrain();
const D = Math.PI / 180, HOUR = Number(SAIL_HOUR);
export const STARTS = { default: CURRENT_WATERS.start, staged: STAGE_START };
export const poseOf = (k) => ({ x: STARTS[k].x, z: STARTS[k].z, heading: STARTS[k].headingDeg * D });

export function runFirst({ start = 'default', seed = 1, level = 3, hour = HOUR, secs = 30, aspect = 16 / 9 } = {}) {
  const S = STARTS[start], gust = start === 'default';
  const wind = new WindField({ seed, day: { hour, rate: 1 }, level, cells: true, shifts: true,
    firstGust: gust ? firstGustFor({ x: S.x, z: S.z, headingDeg: S.headingDeg, ...CURRENT_WATERS.firstGust }) : null });
  wind.setTerrain(T.heightAt);
  const clock = new TimeOfDay({ hour, t0: 0, schedule: daySchedule() });
  wind.setClock((t) => clock.hourAt(t));
  const env = (t) => ({ t, windAt: (x, z, tt) => { const s = wind.sample(x, z, tt); return { vx: s.vx, vz: s.vz }; } });
  const h0 = S.headingDeg * D, pose = { x: S.x, z: S.z, heading: h0 };
  const phys = new BoatPhysics({ x: S.x, z: S.z, heading: h0, speed: S.speed }), helm = new Helm(), hand = new HandSheets();
  const place = placePair({ seed, terrain: T, pose, view: defaultView(pose, aspect) });
  const slots = place?.slots ?? [];
  const ks = slots.map((s) => ({ s, a: createAgent({ slot: s, ...s.place }), m: createMind(s), r: { id: s.id, startD: null, minD: Infinity, at: null, vMax: 0, vMin: Infinity, closeCalls: 0 } }));
  const dt = 1 / 30, kdt = dt / 2, boat = [], track = [];   // dt: the boat's sim step; kdt: the kayaks' (the wall clock)
  let px = phys.state.x, pz = phys.state.z;
  for (let i = 0; i < secs / kdt; i++) {
    const t = i * dt;
    const sh = hand.update(kdt, 0, phys.state), sheet = sh == null ? null : sh;
    for (let k = 0; k < 2; k++) phys.step(1 / 60, { ...CONTROLS, sheet, rudder: helm.toHeading(phys.state, h0) }, env(t + k / 60));
    // the boat as the kayaks see it: its velocity over their own (wall-clock) step
    const s = phys.state, b = { x: s.x, z: s.z, vx: (s.x - px) / kdt, vz: (s.z - pz) / kdt }; px = s.x; pz = s.z;
    if (i % 30 === 0) boat.push({ t, x: s.x, z: s.z, sog: s.sog });
    const others = ks.map((k) => k.a), row = [];
    for (const k of ks) {
      stepHull(k.a, kdt, think(k.a, k.m, kdt, { boat: b, others, terrain: T }));
      for (const e of k.m.events.splice(0)) if (e.type === 'close') k.r.closeCalls++;
      const rx = k.a.x - s.x, rz = k.a.z - s.z, d = Math.hypot(rx, rz);
      k.r.startD ??= d;
      if (d < k.r.minD) { k.r.minD = d; k.r.at = i * kdt; }
      k.r.vMax = Math.max(k.r.vMax, k.a.v); k.r.vMin = Math.min(k.r.vMin, k.a.v);
      const rel = Math.atan2(Math.sin(Math.atan2(rx, -rz) - s.heading), Math.cos(Math.atan2(rx, -rz) - s.heading)) / D;
      row.push({ d, rel });
    }
    if (i % 15 === 0) track.push({ t: i * kdt, ks: row });
  }
  return { place, boat, ks: ks.map((k) => k.r), track };
}

// The notice shot in node (fix/kayaks-phone-framing): runFirst's sail with Sail's follow camera (src/boat/followCamera.js,
// the lead an upright phone takes) and the notice (src/kayaks/notice.js) for a view { aspect, phone }; each frame the
// camera's pose as the page applies it, and both paddlers (head 0.95 m over the waterline, the waterline) and the boat's
// hull projected through it. The notice runs only with Settings' kayakCam on, read as src/kayaks/fleet.js reads it: the
// default settings (off since 2026-11-11: the sailing camera stays) unless `kayakCam` is given.
//   runShot({ start, seed, secs, aspect, phone, kayakCam }) → { place, frames: [{ t, phase, w, near (NDC, head − waterline), both, ks: [{ in, fig, x, y }], boat, fov, camD (m, the nearest kayak), down (° the aim below level) }] }
export function runShot({ start = 'default', seed = 1, level = 3, hour = HOUR, secs = 14, aspect = 390 / 844, phone = aspect < 1, kayakCam = createSettings({ storage: null }).get('kayakCam') } = {}) {
  const S = STARTS[start], gust = start === 'default';
  const wind = new WindField({ seed, day: { hour, rate: 1 }, level, cells: true, shifts: true,
    firstGust: gust ? firstGustFor({ x: S.x, z: S.z, headingDeg: S.headingDeg, ...CURRENT_WATERS.firstGust }) : null });
  wind.setTerrain(T.heightAt);
  const clock = new TimeOfDay({ hour, t0: 0, schedule: daySchedule() });
  wind.setClock((t) => clock.hourAt(t));
  const env = (t) => ({ t, windAt: (x, z, tt) => { const s = wind.sample(x, z, tt); return { vx: s.vx, vz: s.vz }; } });
  const h0 = S.headingDeg * D, pose = { x: S.x, z: S.z, heading: h0 };
  const phys = new BoatPhysics({ x: S.x, z: S.z, heading: h0, speed: S.speed }), helm = new Helm(), hand = new HandSheets();
  const cam = new FollowCamera({ x: S.x, z: S.z, heading: h0 });
  cam.lead = aspect < 1 ? FOLLOW.leadPortrait : FOLLOW.lead;
  const place = placePair({ seed, terrain: T, pose, view: defaultView(pose, aspect) });
  const ks = (place?.slots ?? []).map((s) => ({ s, a: createAgent({ slot: s, ...s.place }), m: createMind(s) }));
  const notice = createNotice(), ground = (x, z) => T.heightAt(x, z);
  const dt = 1 / 30, kdt = dt / 2, frames = [];   // as runFirst: the boat's sim at 2×, the kayaks and the camera on the wall clock
  let px = phys.state.x, pz = phys.state.z, fov = 40;
  for (let i = 0; i < secs / kdt; i++) {
    const t = i * dt;
    const sh = hand.update(kdt, 0, phys.state), sheet = sh == null ? null : sh;
    for (let k = 0; k < 2; k++) phys.step(1 / 60, { ...CONTROLS, sheet, rudder: helm.toHeading(phys.state, h0) }, env(t + k / 60));
    const s = phys.state, b = { x: s.x, z: s.z, vx: (s.x - px) / kdt, vz: (s.z - pz) / kdt }; px = s.x; pz = s.z;
    const others = ks.map((k) => k.a);
    for (const k of ks) stepHull(k.a, kdt, think(k.a, k.m, kdt, { boat: b, others, terrain: T }));
    // as src/kayaks/fleet.js: the view is the camera's own (its aspect, its last lens, phone or not)
    const r = notice.update(kdt, { boat: { x: s.x, z: s.z, heading: s.heading }, ground, view: { aspect, fov, phone }, enabled: kayakCam !== false,
      kayaks: ks.map((k) => ({ id: k.s.id, x: k.a.x, z: k.a.z, heading: k.a.heading, group: k.s.group, hold: NOTICE.pairHoldS })) });
    cam.shot = r.shot;
    const P = cam.update(kdt, { ...s, heave: s.heave ?? 0 });
    fov = P.fov;
    const inF = (q) => q[2] > 0 && Math.abs(q[0]) <= 1 && Math.abs(q[1]) <= 1;
    const kq = ks.map((k) => { const h = projectPose([k.a.x, 0.95, k.a.z], P, aspect), w = projectPose([k.a.x, 0, k.a.z], P, aspect);
      return { id: k.s.id, in: inF(h) && inF(w), fig: h[1] - w[1], x: w[0], y: w[1] }; });
    frames.push({ t: i * kdt, phase: r.phase, w: r.shot?.w ?? 0, near: Math.max(...kq.map((q) => q.fig)), both: kq.length === 2 && kq.every((q) => q.in), ks: kq,
      boat: inF(projectPose([s.x, 0.6, s.z], P, aspect)), fov: P.fov,
      camD: Math.min(...ks.map((k) => Math.hypot(k.a.x - P.pos[0], k.a.z - P.pos[2]))), down: Math.atan2(P.pos[1] - P.target[1], Math.hypot(P.target[0] - P.pos[0], P.target[2] - P.pos[2])) * 180 / Math.PI,
      world: { boat: { x: s.x, z: s.z, heading: s.heading }, ks: ks.map((k) => ({ id: k.s.id, x: k.a.x, z: k.a.z, heading: k.a.heading, group: k.s.group })) } });
  }
  return { place, frames };
}
// project world point Q through a camera pose { pos, target, fov (vertical °) } with up +y → [ndcX, ndcY, depth]
export function projectPose(Q, P, aspect) {
  const [cx, cy, cz] = P.pos, [tx0, ty0, tz0] = P.target, ty = Math.tan((P.fov ?? 40) * D / 2), tx = ty * aspect;
  const psi = Math.atan2(tx0 - cx, -(tz0 - cz)), p = -Math.atan2(ty0 - cy, Math.hypot(tx0 - cx, tz0 - cz));
  const dx = Q[0] - cx, dy = Q[1] - cy, dz = Q[2] - cz, sp = Math.sin(psi), cp = Math.cos(psi), sn = Math.sin(p), c = Math.cos(p);
  const zc = dx * sp * c - dy * sn - dz * cp * c;
  return [(dx * cp + dz * sp) / (zc * tx), (dx * sp * sn + dy * c - dz * cp * sn) / (zc * ty), zc];
}
