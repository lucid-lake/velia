// Chill's camera: slow, drifting angles that show the boat in its landscape. Plain JS, no three.js: node tests drive
// it (tests/director.test.mjs); the page maps the pose onto its camera (pos, target, fov; never any roll).
//
//   const dir = new Director({ heightAt, seed });
//   const pose = dir.update(dt, { t, boat: { x, z, heading, sog }, sun: { x, y, z }, look: [x, y, z], follow: pose, windSpeed });
//
// The shots (each 20–40 s, picked by the seed; never the same kind twice in a row). Owner, 2026-10-30: first "too far"
// (median 250+ m), then "too close" (median 35 m): the middle, a median of 70–90 m, close passes, medium, the odd wide:
//   low     a close pass at water level: 2.4 m up (more in a breeze), 40–60 m off the boat's track ahead; the boat sails by
//   pace    a close tracking shot carried with the boat, 40–58 m off, 4–9 m up: off the bow (3/4 front) or the quarter
//           (3/4 aft: the transom and the name), the landscape sliding behind
//   orbit   a slow orbit at 70–100 m, 8–16 m up, ≈ 1.1°/s (medium)
//   follow  the Day Sail follow camera (src/boat/followCamera.js), so the hand-over to the player is seamless (≈ 32 m)
//   drone   high and behind (35–55 m up, 85–120 m back), moving with the boat, turning 0.4°/s (medium)
//   wide    an establishing shot from 160–300 m away over the water, 6–24 m up, a long lens (20–28°): the boat in the
//           landscape, sky over the far shore (the skyline under the frame's top), the stop's landmark behind it
//           where the line allows, panning slowly to keep it framed; the first shot, then rarely
// Framing: the rule of thirds. The boat sits on the lower third line and on the left or the right third, with the room
// ahead of it: the side it moves toward across the frame (decided when the shot is planned, so it never swaps mid-shot).
// The helmsman (the one figure aboard) is never nearer the lens than DIRECTOR.helmM (25 m;: no humans up close),
// which also keeps the lens clear of the hull, the boom and the sails: a shot that would come nearer ends at once.
// Golden hour (the sun under 15°): wide shots and orbits favour the sun 20–50° off the lens axis (backlit sails, the
// glint) or behind the camera's shoulder (warm front light), alternating.
// Never clips: every pose stays above floorAt (3 m over water, 8 m over land; low passes their own 2.4 m over water,
// off any land) and every shot is chosen with a clear line of sight to the boat over its whole length (the boat's
// track predicted at its speed; the line clears the terrain and the forest's crowns, src/forest/crowns.js, when the page
// has them); a shot whose line is cut ends within 1 s, one whose helmsman comes within DIRECTOR.helmM at once. Orbits stay over the water and drones off the ground over their whole
// planned length, and one the ground starts to lift (the boat turned toward a steep shore) cuts at once.
// Never shakes: the aim follows the boat's position through a critically damped spring (1.5 s), never its heave,
// roll or pitch; orbits and drones circle that smoothed aim; a cut is a cut, and only a change of under 20° of view
// between poses under 30 m apart is an 8 s ease (a wider ease swings the view faster than a pan, a longer one
// throws the lens).
import { floorAt } from '../../camera.js';
import { hash01 } from '../../sim/modes/chill/navigator.js';
import { camerasFor } from '../../sim/craft/index.js';
import { clamp } from '../../sim/core/math.js';

const DEG = Math.PI / 180;
import { wrap } from '../../sim/core/math.js';
import { lerp } from '../../sim/core/math.js';
const ease = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const damp = (x, v, target, tau, dt) => {
  const w = 2 / tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt;
  return [target + (d + tmp) * e, (v - w * tmp) * e];
};

export const SHOTS = {
  wide: { weight: 0.12, len: [20, 28] },
  follow: { weight: 0.1, len: [22, 34] },
  low: { weight: 0.18, len: [20, 28] },
  pace: { weight: 0.2, len: [22, 34] },
  orbit: { weight: 0.24, len: [24, 38] },
  drone: { weight: 0.16, len: [20, 30] },
};
export const DIRECTOR = { aimTau: 1.5, blendS: 8, blendMaxDeg: 20, blendMaxM: 30, nearM: 18, helmM: 25, planHelmM: 28, losEveryS: 0.5, losGraceS: 1.0, aimUp: 2.5, aspect: 16 / 9 };
// the helmsman's head (world), behind the wheel: this page's boat's helm eye (camerasFor(vessel).helm.eye, step 7; Halcyon's
// HULL z 3.3 aft of the centre, 2 m up)
const EYE = camerasFor(null).helm.eye;
export const HELM_AFT = EYE[2], HELM_UP = EYE[1];
export const helmAt = (b, aft = HELM_AFT) => [b.x - Math.sin(b.heading) * aft, HELM_UP, b.z + Math.cos(b.heading) * aft];

export class Director {
  // solid(x, z): the terrain or the crowns' top (src/forest/crowns.js) for the sight lines; the terrain alone when absent
  constructor({ heightAt, seed = 1, only = null, solid = null } = {}) {
    this.heightAt = heightAt; this.seed = seed; this.only = only; this.solid = solid;
    this.n = 0; this.shot = null; this.prev = null; this.t = 0;
    this.aim = null; this.aimV = [0, 0, 0];
    this.losT = 0; this.blocked = 0; this.cuts = [];
  }

  // the boat's position s seconds ahead, on its present course and speed
  ahead(b, s) { return [b.x + Math.sin(b.heading) * b.sog * s, b.z - Math.cos(b.heading) * b.sog * s]; }

  // terrain (or a crown) between two points? (the ray sampled every 15 m with 2 m of slack over the terrain; every 4 m
  // with 1 m over the crowns, which are narrow)
  clear(a, b) {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(2, Math.ceil(L / 15));
    for (let k = 1; k < n; k++) {
      const f = k / n, x = lerp(a[0], b[0], f), z = lerp(a[2], b[2], f), y = lerp(a[1], b[1], f);
      if (this.heightAt(x, z) > y - 2) return false;
    }
    if (this.solid) {
      const m = Math.max(2, Math.ceil(L / 4));
      for (let k = 1; k < m; k++) { const f = k / m; if (this.solid(lerp(a[0], b[0], f), lerp(a[2], b[2], f)) > lerp(a[1], b[1], f) - 1) return false; }
    }
    return true;
  }
  floor(x, z) { return floorAt(this.heightAt, x, z); }

  // the skyline's elevation (degrees) seen from pos looking through the point p, out to 12 km
  skyline(pos, p) {
    const dx = p[0] - pos[0], dz = p[1] - pos[2], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    let best = -90;
    for (let d = L + 50; d < 12000; d *= 1.08) best = Math.max(best, Math.atan2(this.heightAt(pos[0] + ux * d, pos[2] + uz * d) - pos[1], d) / DEG);
    return best;
  }

  // the pose of shot S at time t (no smoothing; the aim is smoothed in update)
  raw(S, t, ctx) {
    const b = ctx.centre ?? ctx.boat, u = t - S.t0;
    if (S.kind === 'follow') return { pos: ctx.follow.pos, target: ctx.follow.target, fov: ctx.follow.fov, own: true };
    if (S.kind === 'wide') return { pos: S.pos, fov: S.fov };
    if (S.kind === 'low') return { pos: S.pos, fov: S.fov };
    if (S.kind === 'pace') { const x = b.x + S.off[0], z = b.z + S.off[1]; return { pos: [x, Math.max(S.h, this.floor(x, z)), z], fov: S.fov }; }
    if (S.kind === 'orbit') {
      const a = S.a0 + S.rate * u;
      const x = b.x + Math.sin(a) * S.r, z = b.z - Math.cos(a) * S.r;   // round the smoothed aim, not the hull
      return { pos: [x, Math.max(S.h, this.floor(x, z) + 1), z], fov: S.fov };
    }
    // drone: behind and above, carried with the boat, its azimuth turning slowly
    const a = S.a0 + S.rate * u, x = b.x - Math.sin(a) * S.back, z = b.z + Math.cos(a) * S.back;
    return { pos: [x, Math.max(S.h, this.floor(x, z) + 20), z], fov: S.fov };
  }

  // a new shot of the given kind from time t, or null if none clears (line of sight over its length)
  plan(kind, t, ctx, k) {
    const b = ctx.boat, r = (i) => hash01(this.seed * 977 + k, i);
    const len = lerp(SHOTS[kind].len[0], SHOTS[kind].len[1], r(1));
    const boatAt = (s) => { const p = this.ahead(b, s); return [p[0], DIRECTOR.aimUp, p[1]]; };
    // the line over the shot's length (every 5 s), and the helmsman never within planHelmM (every 1 s)
    const helmS = (s) => { const p = this.ahead(b, s); return helmAt({ x: p[0], z: p[1], heading: b.heading }); };
    const seesBoat = (pos, poseAt) => {
      for (let s = 0; s <= len; s += 1) {
        const p = poseAt ? poseAt(s) : pos, h = helmS(s);
        if (Math.hypot(p[0] - h[0], p[1] - h[1], p[2] - h[2]) < DIRECTOR.planHelmM) return false;
        if (s % 5 === 0 && !this.clear(p, boatAt(s))) return false;
      }
      return true;
    };
    // the third the boat sits on: +1 (left third, the look turned right) when it moves to the right across the frame
    const sideOf = (poseAt) => {
      const m = len / 2, p0 = poseAt(m), p1 = poseAt(m + 1), b0 = boatAt(m), b1 = boatAt(m + 1);
      const f = [b0[0] - p0[0], b0[2] - p0[2]], rv = [b1[0] - b0[0] - (p1[0] - p0[0]), b1[2] - b0[2] - (p1[2] - p0[2])];
      return rv[0] * -f[1] + rv[1] * f[0] >= 0 ? 1 : -1;
    };
    const sun = ctx.sun, sunAz = Math.atan2(sun.x, -sun.z), golden = sun.y < Math.sin(15 * DEG);
    const backlit = k % 2 === 0;
    const S = { kind, t0: t, len, k };
    if (kind === 'follow') return S;
    if (kind === 'wide' || kind === 'low') {
      // candidate azimuths (from the boat to the camera), scored: the landmark behind the boat, the sun
      const mid = this.ahead(b, len / 2);
      const look = ctx.look ?? [mid[0], 0, mid[1] - 500];
      const lookAz = Math.atan2(look[0] - mid[0], -(look[2] - mid[1]));   // from the boat toward the landmark
      let best = null;
      for (let i = 0; i < 24; i++) {
        if (kind === 'low' && i > 1) break;   // low: the two sides of the track
        const az = i * 15 * DEG + r(2) * 15 * DEG;
        let pos, fov, score = r(10 + i) * 0.3;
        if (kind === 'wide') {
          const dist = lerp(160, 300, r(3)), up = lerp(6, 24, r(4));
          const x = mid[0] + Math.sin(az) * dist, z = mid[1] - Math.cos(az) * dist;
          // over the water: the real bay's walls are forest to the shore, and a lens on them stood among the trunks
          // (a wide at 19:49 from the head's slope, 2026-10-29)
          if (this.heightAt(x, z) > -1) continue;
          pos = [x, Math.max(this.floor(x, z) + up, up), z]; fov = lerp(20, 28, r(5));
          // the camera looks from az + 180° toward the boat; the landmark behind the boat when lookAz ≈ az + 180°
          score += Math.cos(wrap(lookAz - (az + Math.PI))) * 0.8;
          // a postcard has sky: the skyline beyond the boat under the frame's top (the view runs down the lake to
          // the far ranges, not into a wall of forest)
          const sky = this.skyline(pos, [mid[0], mid[1]]), top = fov / 2 + Math.atan2(Math.tan(fov * DEG / 6) * 0.9, 1) / DEG;
          score += clamp((top - sky) / 6, -1.5, 1.2);
        } else {
          // low: beside the track ahead, the boat passes 28–40 m off; on the side the sun lights
          const side = (r(6) < 0.5 ? -1 : 1) * (i === 0 ? 1 : -1), off = lerp(40, 60, r(7)), s = len * 0.55;
          const p = this.ahead(b, s), nx = Math.cos(b.heading) * side, nz = Math.sin(b.heading) * side;
          const x = p[0] + nx * off, z = p[1] + nz * off;
          if (this.heightAt(x, z) > -6) continue;   // open water: the 3 m floor never lifts it
          pos = [x, 2.4 + 0.12 * (ctx.windSpeed ?? 4), z]; fov = 34;
          score += i === 0 ? 0.5 : 0;
        }
        // the view's azimuth (camera → boat) against the sun's
        const viewAz = Math.atan2(mid[0] - pos[0], -(mid[1] - pos[2]));
        const off = Math.abs(wrap(sunAz - viewAz)) / DEG;
        if (golden) score += backlit ? (off > 20 && off < 55 ? 1.0 : off < 12 ? -2 : 0) : (off > 120 ? 0.8 : 0);
        else score += off < 25 ? -1 : 0;   // never into a high sun
        if (!seesBoat(pos)) continue;
        if (!best || score > best.score) best = { pos, fov, score };
      }
      if (!best) return null;
      return { ...S, pos: best.pos, fov: best.fov, side: sideOf(() => best.pos) };
    }
    if (kind === 'pace') {
      // carried with the boat at a fixed world offset from the smoothed aim: off the bow (35–60° from it) or the quarter
      // (115–145°: the transom and its name), on the side the sun lights at golden hour (else the seed's)
      const front = r(3) < 0.55, rel = (front ? lerp(35, 60, r(4)) : lerp(115, 145, r(4))) * DEG;
      const dist = front ? lerp(42, 58, r(5)) : lerp(40, 56, r(5)), h = lerp(4, 9, r(7)), fov = lerp(28, 34, r(8));
      let best = null;
      for (const sd of [1, -1]) {
        const az = b.heading + rel * sd, off = [Math.sin(az) * dist, -Math.cos(az) * dist];
        const T = { ...S, off, h, fov };
        const poseAt = (s) => { const p = this.ahead(b, s); return [p[0] + off[0], h, p[1] + off[1]]; };
        let wet = true; for (let s = 0; s <= len && wet; s += 1) { const p = poseAt(s); if (this.heightAt(p[0], p[2]) > -3) wet = false; }
        if (!wet || !seesBoat(null, poseAt)) continue;
        const viewAz = Math.atan2(-off[0], off[1]), sunOff = Math.abs(wrap(sunAz - viewAz)) / DEG;
        const score = (golden ? (sunOff > 120 ? 1 : sunOff > 20 && sunOff < 55 ? 0.8 : sunOff < 12 ? -2 : 0) : (sunOff < 25 ? -1 : 0)) + r(9 + sd) * 0.3;
        if (!best || score > best.score) best = { score, T: { ...T, side: sideOf(poseAt) } };
      }
      return best ? best.T : null;
    }
    if (kind === 'orbit') {
      const rr = lerp(70, 100, r(3)), h = lerp(8, 16, r(4)), rate = (r(5) < 0.5 ? -1 : 1) * 1.1 * DEG;
      let a0 = r(6) * Math.PI * 2;
      if (golden) a0 = sunAz + Math.PI + (backlit ? 1 : -1) * 35 * DEG + (backlit ? Math.PI : 0);   // start backlit or front-lit
      const T = { ...S, r: rr, h, rate, a0, fov: lerp(30, 36, r(7)) };
      const poseAt = (s) => { const q = this.raw(T, t + s, { ...ctx, boat: { ...b, ...(() => { const p = this.ahead(b, s); return { x: p[0], z: p[1] }; })() } }); return q.pos; };
      // the orbit stays over the water: on the real bay's steep walls a circle that crossed the shore rode the
      // lidar's ground up and down (10°/s of view, 11 m/s² of lens at the east shore, 2026-10-29)
      for (let s = 0; s <= len; s += 1) { const p = poseAt(s); if (p[1] > h + 1e-6) return null; }
      return seesBoat(null, poseAt) ? { ...T, side: sideOf(poseAt) } : null;
    }
    // drone
    const T = { ...S, back: lerp(85, 120, r(3)), h: lerp(35, 55, r(4)), rate: (r(5) < 0.5 ? -1 : 1) * 0.4 * DEG, a0: b.heading + (r(6) - 0.5) * 70 * DEG, fov: 38 };
    const poseAt = (s) => { const p = this.ahead(b, s); return this.raw(T, t + s, { ...ctx, boat: { ...b, x: p[0], z: p[1] } }).pos; };
    for (let s = 0; s <= len; s += 1) { const p = poseAt(s); if (p[1] > T.h + 1e-6) return null; }   // never rides the ground
    return seesBoat(null, poseAt) ? { ...T, side: sideOf(poseAt) } : null;
  }

  next(t, ctx) {
    const kinds = Object.keys(SHOTS);
    for (let tries = 0; tries < 12; tries++) {
      const k = this.n++;
      let kind = this.only;
      if (!kind) {
        let x = hash01(this.seed * 31 + 7, k) * kinds.filter((q) => q !== this.shot?.kind).reduce((a, q) => a + SHOTS[q].weight, 0);
        for (const q of kinds) { if (q === this.shot?.kind) continue; x -= SHOTS[q].weight; if (x <= 0) { kind = q; break; } }
        kind ??= 'follow';
        if (k === 0) kind = 'wide';   // open on the landscape
      }
      const S = this.plan(kind, t, ctx, k);
      if (S) return S;
    }
    return { kind: 'follow', t0: t, len: 30, k: this.n++ };
  }

  update(dt, ctx) {
    const t = ctx.t, b = ctx.boat;
    this.t = t;
    // the aim: the boat's position (never its heave), critically damped
    const goal = [b.x, DIRECTOR.aimUp, b.z];
    if (!this.aim) this.aim = goal.slice();
    else for (let i = 0; i < 3; i++) [this.aim[i], this.aimV[i]] = damp(this.aim[i], this.aimV[i], goal[i], DIRECTOR.aimTau, dt);

    ctx = { ...ctx, centre: { x: this.aim[0], z: this.aim[2] } };
    if (!this.shot || t - this.shot.t0 >= this.shot.len) this.change(t, ctx, 'time');
    let pose = this.pose(this.shot, t, ctx);
    // an orbit or a drone the ground has begun to lift (the boat turned toward a steep shore after the shot was
    // planned over water): a cut, never a lens riding the slope
    if ((this.shot.kind === 'orbit' || this.shot.kind === 'drone') && pose.pos[1] > this.shot.h + 0.05) { this.change(t, ctx, 'ground'); pose = this.pose(this.shot, t, ctx); }
    // the guard: line of sight checked twice a second (a blocked shot ends after 1 s); the helmsman every frame
    if (t - this.losT >= DIRECTOR.losEveryS) {
      this.losT = t;
      const ok = this.clear(pose.pos, [b.x, DIRECTOR.aimUp, b.z]);
      this.blocked = ok || this.shot.kind === 'follow' ? 0 : this.blocked + DIRECTOR.losEveryS;
      if (this.blocked >= DIRECTOR.losGraceS) { this.change(t, ctx, 'blocked'); pose = this.pose(this.shot, t, ctx); this.blocked = 0; }
    }
    // a near change eases over 5 s from the old shot's pose
    if (this.prev && t - this.prev.at >= DIRECTOR.blendS) this.prev = null;
    const blended = () => {
      if (!this.prev) return pose;
      const f = ease((t - this.prev.at) / DIRECTOR.blendS), o = this.pose(this.prev.shot, t, ctx);
      return { pos: pose.pos.map((v, i) => lerp(o.pos[i], v, f)), target: pose.target.map((v, i) => lerp(o.target[i], v, f)), fov: lerp(o.fov, pose.fov, f) };
    };
    pose = blended();
    // the helmsman within helmM + 0.5 m (a tack toward the lens, a blend's chord): a cut to a new shot, at once
    for (let k = 0; k < 3 && this.shot.kind !== 'follow' && this.helmDist(pose.pos, b) < DIRECTOR.helmM + 0.5; k++) {
      this.change(t, ctx, 'near'); this.prev = null; pose = this.pose(this.shot, t, ctx);
    }
    // the floor, last: nothing below 3 m over water or 8 m over land, except a low pass over open water
    const fl = this.shot.kind === 'low' ? Math.max(0, this.heightAt(pose.pos[0], pose.pos[2])) + 2.2 : this.floor(pose.pos[0], pose.pos[2]);
    if (pose.pos[1] < fl) pose = { ...pose, pos: [pose.pos[0], fl, pose.pos[2]] };
    return { ...pose, shot: this.shot.kind, k: this.shot.k };
  }

  helmDist(p, b) { const h = helmAt(b); return Math.hypot(p[0] - h[0], p[1] - h[1], p[2] - h[2]); }

  pose(S, t, ctx) {
    const q = this.raw(S, t, ctx);
    if (q.own) return { pos: q.pos.slice(), target: q.target.slice(), fov: q.fov };
    // the rule of thirds: the boat on the lower third line (aim above it by a third of the half-height at its distance)
    // and on the left or right third line (aim beside it by a third of the half-width), the room ahead of it
    const dx = this.aim[0] - q.pos[0], dz = this.aim[2] - q.pos[2], d = Math.hypot(dx, dz) || 1;
    const tv = Math.tan(q.fov * DEG / 2), th = tv * (ctx.aspect ?? DIRECTOR.aspect), side = S.side ?? 0;
    const across = side * d * th / 3, rx = -dz / d, rz = dx / d;
    return { pos: q.pos.slice(), target: [this.aim[0] + rx * across, this.aim[1] + d * tv / 3, this.aim[2] + rz * across], fov: q.fov };
  }

  change(t, ctx, why) {
    const old = this.shot;
    const S = this.next(t, ctx);
    if (old) {
      const a = this.pose(old, t, ctx), b2 = this.pose(S, t, ctx);
      // the view's whole turn (azimuth and pitch) and the lens's travel: a quintic ease over blendS peaks at
      // 5.77 × travel / blendS² of acceleration, so only a travel under blendMaxM keeps it under 3 m/s² (a drone at
      // 83 m eased down to a 12 m orbit 71 m below: 11 m/s² and 10°/s, the real bay's east shore, 2026-10-29)
      const unit = (q) => { const v = [q.target[0] - q.pos[0], q.target[1] - q.pos[1], q.target[2] - q.pos[2]], L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
      const uA = unit(a), uB = unit(b2), turn = Math.acos(clamp(uA[0] * uB[0] + uA[1] * uB[1] + uA[2] * uB[2], -1, 1));
      const near = Math.hypot(a.pos[0] - b2.pos[0], a.pos[1] - b2.pos[1], a.pos[2] - b2.pos[2]) < DIRECTOR.blendMaxM && turn < DIRECTOR.blendMaxDeg * DEG && why === 'time' && (old.kind === 'wide' || old.kind === 'low');   // only out of a fixed lens: easing a moving one (an orbit at 70–100 m) into a fixed one jerked the lens (3.8 m/s², seed 2)
      this.prev = near ? { shot: old, at: t } : null;
      this.cuts.push({ t, from: old.kind, to: S.kind, blend: near, why });
    }
    this.shot = S;
  }
}
