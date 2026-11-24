// Cruise's cameras (owner, 2026-10-30: Cruise is a passenger mode). Five views of the same boat, switched with the
// view switch (src/ui/viewSwitch.js, five segments) or C (Shift+C back):
//   cinematic  the director's drifting shots (director.js), the default
//   astern     the follow camera, as Sail's Boat view
//   above      the boat from high above, a map's view (fix/cruise-cameras: replaced the Deck camera, all sail): 50–140 m up,
//              pitched 72° down, north-up (V: course-up), following smoothly
//   helm       the helm camera, as Sail's Helm view
//   island     a fixed camera ashore (open ground at the water's edge, never in or behind a tree, a clear line to the hull) that tracks it
// Every switch is a 1 s eased move (viewBlend.js's smootherstep) from the pose on screen to the live pose of the new
// view, so nothing cuts. A passenger drag looks round the view and a wheel or pinch zooms it: the astern and helm views
// use their own (follow.update, helmCam.update); the others take a LookOffset (a yaw and pitch about the lens, and a
// field-of-view factor) that drifts back to the shot after a pause. Plain JS, no three.js: tests/passenger.test.mjs.
//
// Poses are { pos, target, up?, fov, near? } (helmCamera.js's applyPose maps them onto the camera).
import { ease } from '../../boat/viewBlend.js';

const DEG = Math.PI / 180;
import { clampT as clamp } from '../../sim/core/math.js';
import { lerp } from '../../sim/core/math.js';
import { wrap } from '../../sim/core/math.js';

export const CAMERAS = ['cinematic', 'astern', 'above', 'helm', 'island'];
export const CAMERA_WORDS = { cinematic: 'Cinematic', astern: 'Boat', above: 'Above', helm: 'Helm', island: 'Island', stars: 'Stars' };
// The night's own camera (round 4, owner 2026-11-07: the Milky Way over the ridge): on C's cycle only on a dark night
// with the band up (src/core/milkyway.js dark(), aim()); not a segment of the view switch.
export const NIGHT_CAMERAS = [...CAMERAS, 'stars'];
export const MOVE_S = 1.0;   // the same move as Sail's Boat | Helm switch (viewBlend.js VIEW_BLEND.durS)

// C steps forward round the list, Shift+C back; night: the stars camera joins the cycle (after Island)
export function nextCamera(cur, dir = 1, { night = false } = {}) {
  const L = night ? NIGHT_CAMERAS : CAMERAS, i = L.indexOf(cur), n = L.length;
  return i < 0 ? (cur === 'stars' ? CAMERAS[dir < 0 ? CAMERAS.length - 1 : 0] : L[0]) : L[(i + (dir < 0 ? -1 : 1) + n) % n];
}

// The stars camera: low over the water behind the boat, on the side away from the band, wide, tilted up so the band
// stands over the ridge with the boat small and low in the frame (the night moment's composition, src/ui/nightMoment.js).
// s: the boat's state; aim: { dir: [x, y, z] unit world, altDeg } (src/core/milkyway-math.js bandAim)
const STARS = { backM: 34, sideM: 8, eyeM: 2.4, fov: 62, liftDeg: 14, minPitchDeg: 8, maxPitchDeg: 32 };
export function starsPose(s, aim, C = STARS) {
  const h = Math.hypot(aim.dir[0], aim.dir[2]) || 1, hx = aim.dir[0] / h, hz = aim.dir[2] / h, rx = -hz, rz = hx;
  const pitch = clamp(aim.altDeg - C.liftDeg, C.minPitchDeg, C.maxPitchDeg) * DEG, c = Math.cos(pitch);
  const pos = [s.x - hx * C.backM + rx * C.sideM, C.eyeM, s.z - hz * C.backM + rz * C.sideM];
  return { pos, target: [pos[0] + hx * c * 60, pos[1] + Math.sin(pitch) * 60, pos[2] + hz * c * 60], fov: C.fov, near: 0.5 };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const yawPitch = (d) => [Math.atan2(d[0], -d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
const fromYawPitch = (y, p) => [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// The pose between a (e = 0) and b (e = 1): the position in a line, the look as yaw and pitch (the short way round), the
// up vector, the lens and the near plane. Both ends are live poses, so a moving boat is tracked through the move.
export function easePose(a, b, e) {
  if (e <= 0) return { ...a, near: a.near ?? 0.5 };
  if (e >= 1) return { ...b, near: b.near ?? 0.5 };
  const pos = [lerp(a.pos[0], b.pos[0], e), lerp(a.pos[1], b.pos[1], e), lerp(a.pos[2], b.pos[2], e)];
  const [ay, ap] = yawPitch(sub(a.target, a.pos)), [by, bp] = yawPitch(sub(b.target, b.pos));
  const look = fromYawPitch(ay + wrap(by - ay) * e, lerp(ap, bp, e));
  const au = a.up ?? [0, 1, 0], bu = b.up ?? [0, 1, 0];
  const up = norm([lerp(au[0], bu[0], e), lerp(au[1], bu[1], e), lerp(au[2], bu[2], e)]);
  return { pos, target: [pos[0] + look[0] * 10, pos[1] + look[1] * 10, pos[2] + look[2] * 10], up, fov: lerp(a.fov, b.fov, e), near: Math.exp(lerp(Math.log(a.near ?? 0.5), Math.log(b.near ?? 0.5), e)) };
}

// the 1 s move: begin(from) with the pose on screen, then pose(live) each frame
export class CameraMove {
  constructor(durS = MOVE_S) { this.dur = durS; this.k = 1; this.from = null; }
  get moving() { return this.k < 1; }
  begin(from, durS = this.dur) { this.from = from; this.dur = durS; this.k = from ? 0 : 1; }
  step(dt) { if (this.k < 1) this.k = Math.min(1, this.k + dt / this.dur); return this.k; }
  pose(live) { return this.k >= 1 || !this.from ? live : easePose(this.from, live, ease(this.k)); }
}

// A passenger's look about a fixed lens: yaw and pitch offsets from the shot (±yawMax, −35° to +50°), a lens factor
// (fov × zoom, 0.45 to 1.35), all easing back to the shot `returnAfter` s after the last touch.
export class LookOffset {
  constructor({ yawMax = 100 * DEG, returnAfter = 4, tau = 1.6 } = {}) { this.yawMax = yawMax; this.returnAfter = returnAfter; this.tau = tau; this.yaw = 0; this.pitch = 0; this.zoom = 1; this.idle = 1e9; }
  reset() { this.yaw = this.pitch = 0; this.zoom = 1; this.idle = 1e9; }
  update(dt, { look = null, zoom = 1 } = {}) {
    if (look) { this.yaw = clamp(this.yaw + look[0], -this.yawMax, this.yawMax); this.pitch = clamp(this.pitch - look[1], -35 * DEG, 50 * DEG); this.idle = 0; }
    else this.idle += dt;
    if (zoom !== 1) { this.zoom = clamp(this.zoom * zoom, 0.45, 1.35); this.idle = Math.min(this.idle, this.returnAfter * 0.5); }
    if (this.idle > this.returnAfter) { const k = 1 - Math.exp(-dt / this.tau); this.yaw -= this.yaw * k; this.pitch -= this.pitch * k; this.zoom += (1 - this.zoom) * k; }
  }
  // the pose turned about its own lens by the offset
  apply(p) {
    if (!this.yaw && !this.pitch && this.zoom === 1) return p;
    const [y, pt] = yawPitch(sub(p.target, p.pos)), d = fromYawPitch(y + this.yaw, clamp(pt + this.pitch, -80 * DEG, 80 * DEG));
    return { ...p, target: [p.pos[0] + d[0] * 10, p.pos[1] + d[1] * 10, p.pos[2] + d[2] * 10], fov: clamp(p.fov * this.zoom, 12, 90) };
  }
}

// ---- the Above camera ----------------------------------------------------------------------------------------------
// The boat from high above, as a map or a satellite sees it (owner, 2026-10-30: it replaces the Deck camera, which looked
// at the mainsail's cloth). ABOVE.h m up (the wheel or a pinch: hMin to hMax), pitched ABOVE.pitchDeg down (a drag: pitchMin
// to pitchMax, and turns the map), the boat a little behind the frame's centre so the water ahead and the wake behind
// both show. NORTH-UP by default: it is a map (the chart, N, is north-up too), the lake holds still and only the boat
// turns under it, which is the calm a background ride needs; a tack in course-up swings the whole world by 90°. V gives
// COURSE-UP (the bow up the screen, the heading followed through a 6 s spring, so a tack turns the view slowly).
// The aim follows the boat through a critically damped spring (ABOVE.aimTau), never its heave or roll. The eye stays
// ABOVE.clearM over the ground and the crowns under it, and climbs (15 m a step) if the line to the hull is cut.
export const ABOVE = { h: 70, hMin: 50, hMax: 140, pitchDeg: 72, pitchMin: 62, pitchMax: 86, fov: 40, aimTau: 1.4, headTau: 6, leadS: 4, leadMax: 12, clearM: 20, near: 1 };
const damp = (x, v, target, tau, dt) => { const w = 2 / tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt; return [target + (d + tmp) * e, (v - w * tmp) * e]; };

export class AboveCam {
  // solid(x, z): the ground or the crowns' top (src/forest/crowns.js), for the eye's floor and its line to the boat
  constructor({ solid = null } = {}) { this.solid = solid; this.northUp = true; this.h = ABOVE.h; this.reset(); }
  reset() { this.aim = null; this.aimV = [0, 0]; this.az = null; this.azV = 0; this.y = null; this.yV = 0; this.yaw = 0; this.pitch = ABOVE.pitchDeg * DEG; }
  // V: north-up ↔ course-up (the view turns there through the same spring); returns true when north-up
  toggle() { this.northUp = !this.northUp; return this.northUp; }
  update(dt, s, { look = null, zoom = 1 } = {}) {
    const C = ABOVE, lead = Math.min(C.leadMax, (s.sog ?? 0) * C.leadS);
    const gx = s.x + Math.sin(s.heading) * lead, gz = s.z - Math.cos(s.heading) * lead;
    if (!this.aim) { this.aim = [gx, gz]; this.aimV = [0, 0]; }
    else { [this.aim[0], this.aimV[0]] = damp(this.aim[0], this.aimV[0], gx, C.aimTau, dt); [this.aim[1], this.aimV[1]] = damp(this.aim[1], this.aimV[1], gz, C.aimTau, dt); }
    const azGoal = this.northUp ? 0 : s.heading;
    if (this.az == null) this.az = azGoal;
    else [this.az, this.azV] = damp(this.az, this.azV, this.az + wrap(azGoal - this.az), C.headTau, dt);
    if (look) { this.yaw = wrap(this.yaw + look[0]); this.pitch = clamp(this.pitch + look[1], C.pitchMin * DEG, C.pitchMax * DEG); }
    if (zoom !== 1) this.h = clamp(this.h * zoom, C.hMin, C.hMax);
    const A = this.az + this.yaw, fx = Math.sin(A), fz = -Math.cos(A), back = this.h / Math.tan(this.pitch);
    const x = this.aim[0] - fx * back, z = this.aim[1] - fz * back, target = [this.aim[0], 0.5, this.aim[1]];
    // the floor and the line: over the ground and the crowns by clearM; climb if the line to the hull is cut
    let yGoal = this.h;
    if (this.solid) {
      yGoal = Math.max(yGoal, this.solid(x, z) + C.clearM);
      for (let k = 0; k < 8 && !sightLine(this.solid, [x, yGoal, z], [s.x, 1.5, s.z]); k++) yGoal += 15;
    }
    if (this.y == null) this.y = yGoal;
    else if (yGoal > this.y + 8) this.y = Math.max(this.y, yGoal - 8);   // a sudden ridge: no lag under it
    else [this.y, this.yV] = damp(this.y, this.yV, yGoal, 1.0, dt);
    return { pos: [x, this.y, z], target, up: [0, 1, 0], fov: C.fov, near: C.near };
  }
}

// A sight line from a to b over a height function (terrain, or terrain and crowns), every `step` m with `slack` m of air.
function sightLine(height, a, b, step = 3, slack = 0.5) {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / step));
  for (let i = 1; i < n; i++) { const f = i / n; if (height(a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f) + slack > lerp(a[1], b[1], f)) return false; }
  return true;
}

// ---- the island camera -------------------------------------------------------------------------------------------
// A fixed point ashore, 110–600 m from the boat (kept to 650 m: farther, the boat is a speck), on land ≤ ISLAND.inlandM from the water's edge, ISLAND.riseMin–riseMax m
// above the lake. Owner, 2026-10-30: "blocked by trees". So the eye stands FORWARD of the tree line: on open ground (no
// crown within ISLAND.openM: rock, a beach, the water's edge), ISLAND.eyeUp m up. Where no open ground serves, it may
// step up over the crowns (ISLAND.raiseOver m above the tallest within 8 m) at a cost in the score. The line to the
// boat's HULL (1.5 m) must clear the terrain and every crown (src/forest/crowns.js) now; a line also clear for the boat
// ahead (8 and 16 s on its course) scores better. The nearest wins, near the last pick more. `ground(x, z)` is the
// terrain, `shore(x, z)` the signed distance to the shore (+ on land), `solid(x, z)` the terrain or the crowns' top,
// `open(x, z, r)` no crown within r. Deterministic.
export const ISLAND = { rings: [110, 150, 200, 260, 330, 410, 500, 600], bearings: 48, eyeUp: 2.5, riseMin: 0.5, riseMax: 40, inlandM: 45, openM: 7,
  raiseOver: 4, raiseMaxM: 50, raisePenalty: 300, aheadS: [8, 16], aheadPenalty: 120, keepM: 650, keepMinM: 70, lookUp: 4, hullY: 1.5, badS: 0.2, pickEveryS: 0.25 };

const aheadOf = (boat, s) => [boat.x + Math.sin(boat.heading ?? 0) * (boat.sog ?? 0) * s, ISLAND.hullY, boat.z - Math.cos(boat.heading ?? 0) * (boat.sog ?? 0) * s];

export function pickIsland({ ground, shore, solid = ground, open = null }, boat, { prefer = null } = {}) {
  const C = ISLAND, hull = [boat.x, C.hullY, boat.z];
  let best = null;
  for (let ri = 0; ri < C.rings.length; ri++) {
    const r = C.rings[ri];
    for (let k = 0; k < C.bearings; k++) {
      const a = (k / C.bearings) * Math.PI * 2, x = boat.x + Math.sin(a) * r, z = boat.z - Math.cos(a) * r;
      const s = shore(x, z), h = ground(x, z);
      if (s < 0 || s > C.inlandM || h < C.riseMin || h > C.riseMax) continue;
      let eye, score = r;
      if (!open || open(x, z, C.openM)) eye = [x, Math.max(h, solid(x, z)) + C.eyeUp, z];
      else {
        let top = h; for (let dz = -8; dz <= 8; dz += 4) for (let dx = -8; dx <= 8; dx += 4) top = Math.max(top, solid(x + dx, z + dz));
        if (top + C.raiseOver - h > C.raiseMaxM) continue;
        eye = [x, top + C.raiseOver, z]; score += C.raisePenalty;
      }
      if (prefer) score += Math.hypot(x - prefer[0], z - prefer[2]) * 0.5;
      if (best && score >= best.score - 1e-9) continue;
      if (!sightLine(solid, eye, hull)) continue;
      for (const t of C.aheadS) if (!sightLine(solid, eye, aheadOf(boat, t))) score += C.aheadPenalty;
      if (!best || score < best.score - 1e-9) best = { score, pos: eye };
    }
    if (best && (ri + 1 >= C.rings.length || best.score <= C.rings[ri + 1])) break;   // no farther ring can win
  }
  return best ? best.pos : null;
}

// A straight camera flight from a to b (eyes, [x, y, z]) stays above the terrain: sampled every ~GLIDE_STEP m, clear by
// `clear` m. (10 m let a flight clip a lone crown's peak between two samples: Cruise seed 3's island camera, 3.5 m inside a
// 33 m pine on the bay's south shore, once the bed regrid moved the voyage; fix(terrain) bed edges, 2026-11-13.)
const GLIDE_STEP = 4;
export function pathClear(ground, a, b, clear = 1.5) {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / GLIDE_STEP));
  for (let i = 1; i < n; i++) { const f = i / n; if (ground(lerp(a[0], b[0], f), lerp(a[2], b[2], f)) + clear > lerp(a[1], b[1], f)) return false; }
  return true;
}

// The island camera's keeper: holds a shore vantage while it stays good (in range, the hull in sight). A line cut for
// ISLAND.badS s (a crown, a point of land) or the boat out of range: it picks the next best vantage (the nearest with a
// clear line, the ones near this one favoured) and FLIES there: an eased glide of GLIDE.minS to GLIDE.maxS s (about
// GLIDE.mps m/s) looking at the boat all the way, so the picture never hops. The flight is straight if that path clears
// the terrain and the crowns and keeps the boat in sight; else it rises in an arc (the apex GLIDE.over m above the
// highest ground or crown on the way, more if the boat would be hidden), and is a cut only if even that fails.
export const GLIDE = { mps: 120, minS: 2, maxS: 7, over: 25, apexMax: 220, lifts: [0, 20, 45, 90] };
// the apex height (m) of a flight lifted over the terrain between a and b, or null if it would need more than GLIDE.apexMax
function arcApex(ground, a, b, extra = 0) {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / GLIDE_STEP));
  let top = Math.max(a[1], b[1]);
  for (let i = 1; i < n; i++) { const f = i / n; top = Math.max(top, ground(lerp(a[0], b[0], f), lerp(a[2], b[2], f)) + GLIDE.over); }
  top += extra;
  if (top > GLIDE.apexMax) return null;
  const arc = (f) => arcY(a[1], b[1], top, f);
  for (let i = 1; i < n; i++) { const f = i / n; if (ground(lerp(a[0], b[0], f), lerp(a[2], b[2], f)) + 1.5 > arc(f)) return null; }
  return top;
}
const arcY = (y0, y1, top, e) => (1 - e) * (1 - e) * y0 + 2 * e * (1 - e) * (2 * top - (y0 + y1) / 2) + e * e * y1;
const glideAt = (gl, e) => [lerp(gl.from[0], gl.to[0], e), gl.lift == null ? lerp(gl.from[1], gl.to[1], e) : arcY(gl.from[1], gl.to[1], gl.lift, e), lerp(gl.from[2], gl.to[2], e)];

export class IslandCam {
  constructor({ ground, shore, solid = ground, open = null }) { this.g = { ground, shore, solid, open }; this.pos = null; this.goal = null; this.glide = null; this.bad = 0; this.sincePick = 1e9; this.picks = 0; this.glides = 0; this.cuts = 0; this.snap = false; this.justCut = false; }
  get gliding() { return !!this.glide; }
  // a new solid (the crowns arrive after the page starts): the next update re-checks the vantage against it
  setSolid(solid, open) { this.g.solid = solid; this.g.open = open; }
  // the next update picks at once and takes the eye there with no flight (a switch into the view: the camera move covers it)
  invalidate() { this.snap = true; }
  setGoal(p, boat = null) {
    this.goal = p; this.bad = 0; this.picks++;
    if (!this.pos || this.snap) { this.pos = p; this.glide = null; this.snap = false; return; }
    const solid = this.g.solid, from = this.pos;
    const d = Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]), dur = clamp(d / GLIDE.mps, GLIDE.minS, GLIDE.maxS);
    // the boat stays in sight along the way (checked at five points of the flight, the boat moved on by then)
    const sees = (gl) => !boat || [0.2, 0.4, 0.6, 0.8].every((f) => sightLine(solid, glideAt(gl, ease(f)), aheadOf(boat, f * gl.dur)));
    let plan = null;
    const straight = { from, to: p, lift: null, t: 0, dur };
    if (pathClear(solid, from, p) && sees(straight)) plan = straight;
    for (const extra of GLIDE.lifts) {
      if (plan) break;
      const lift = arcApex(solid, from, p, extra);
      if (lift == null) break;
      const gl = { from, to: p, lift, t: 0, dur: Math.max(dur, GLIDE.minS + 1) };
      if (sees(gl)) plan = gl;
    }
    if (!plan) { this.pos = p; this.glide = null; this.cuts++; this.justCut = true; return; }   // the rig hides the cut: it eases back to the Boat view first
    this.glide = plan; this.glides++;
  }
  // boat: { x, z, heading?, sog? }; returns the eye on screen (or null when no shore has ever been in reach)
  update(dt, boat) {
    this.sincePick += dt;
    if (this.goal && !this.snap) {
      const d = Math.hypot(this.goal[0] - boat.x, this.goal[2] - boat.z);
      const ok = d >= ISLAND.keepMinM && d <= ISLAND.keepM && sightLine(this.g.solid, this.goal, [boat.x, ISLAND.hullY, boat.z]) && this.goal[1] > this.g.solid(this.goal[0], this.goal[2]);
      this.bad = ok ? 0 : this.bad + dt;
    }
    if (!this.goal || this.snap || (this.bad >= ISLAND.badS && this.sincePick >= ISLAND.pickEveryS)) {
      this.sincePick = 0;
      const p = pickIsland(this.g, boat, { prefer: this.snap ? null : this.goal });
      if (p && !(this.goal && !this.snap && p[0] === this.goal[0] && p[2] === this.goal[2] && p[1] === this.goal[1])) this.setGoal(p, boat);
      else if (p) this.bad = 0;
    }
    if (this.glide) {
      const gl = this.glide; gl.t += dt;
      this.pos = glideAt(gl, ease(Math.min(1, gl.t / gl.dur)));
      if (gl.t >= gl.dur) { this.pos = gl.to; this.glide = null; }
    }
    return this.pos;
  }
  // the lens by the distance: a 90 m tall field at the boat (the hull and the sails ≈ a sixth of the frame), 12–32°
  pose(boat, fov = null) {
    if (!this.pos) return null;
    const d = Math.hypot(this.pos[0] - boat.x, this.pos[1] - ISLAND.lookUp, this.pos[2] - boat.z);
    return { pos: this.pos, target: [boat.x, ISLAND.lookUp, boat.z], fov: fov ?? clamp(2 * Math.atan(45 / d) / DEG, 12, 32), near: 0.5 };
  }
}
