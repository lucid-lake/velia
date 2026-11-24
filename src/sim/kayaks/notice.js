// The camera notices a kayak (feat/kayaks-lake step 2c; owner 2026-11-08: "see them closely, clearly from
// the boat", then "go for the bolder camera"). When a kayak passes within ≈ 25 m, ahead or beside, the follow camera swings
// round and down to a shot low over the water on the kayak's far side: the kayak in the near foreground (≈ 6.5 m off, about
// a quarter of the frame wide at 1280 px), the sailboat behind it in the same frame, the horizon level. It eases in over
// 2.6 s, holds 4 s (tracking the pair), eases back over 2.6 s: smootherstep weights, never a cut or a shake (the blend is
// the follow camera's, round the boat: src/boat/followCamera.js blendShot). Never while the player drags the view (a drag
// starts the ease back at once and holds off 4 s); each kayak once; off in Settings (kayakCam). Plain JS, deterministic.
//
//   const n = createNotice()
//   const s = n.update(dt, { boat: { x, z, heading }, kayaks: [{ id, x, z, heading, group, hold }], dragging, enabled, ground, view })
//     → { shot: { pos, target, w, fov } | null, target: id | null, phase }      ground(x, z): the land's height (optional)
//   view: { aspect, fov (vertical °), phone }: the camera the shot is framed for (frameShot); without it, the 11-08 pose
//   (shotPose). A kayak's `hold` (s) overrides the hold (the first pair: NOTICE.pairHoldS); one of a `group` frames its mate too.
//
// frameShot (fix/kayaks-old-motion-close; the 11-08 pose put the kayak in the frame's corner, under the 3D cockpit and the
// key hints, and on an upright phone mostly out of the frame): the camera is searched round the kayak (azimuth, distance)
// for its actual aspect so that the whole kayak and paddler stand in a box of the frame (desktop: right of centre, left of
// the key hints; a phone: the middle band, under the top bar and the dials), the paddler about a quarter of the frame tall,
// the boat behind in the frame, the horizon level, the camera over water and clear of the boat; re-solved 4 times a second,
// near the last answer, and eased.
const DEG = Math.PI / 180;
import { wrap } from '../core/math.js';

export const NOTICE = Object.freeze({
  range: 25,          // m: a kayak this near the boat is noticed
  release: 45,        // m: past this the hold ends early
  front: 115 * DEG,   // noticed only ahead or beside (off the bow up to this)
  inS: 2.6, holdS: 4.0, outS: 2.6,   // s: the eases and the hold
  camOff: 5.2,        // m: the camera from the kayak (a 3.4 m kayak seen two-thirds side-on ≈ 300 px wide at 1280, 40° lens)
  camSwing: 50 * DEG, // the camera off the boat–kayak line, so the boat stands beside the kayak and the kayak shows its side
  camY: 1.7,          // m over the water
  aim: 0.34,          // the aim point this share of the way from the kayak to the boat (both in frame)
  aimY: 1.5,          // m: the aim's height (≈ the camera's: a level horizon)
  smooth: 0.45,       // s: the shot pose's own ease (the kayak bobs; the pose does not)
  dragHold: 4,        // s: after a drag, no noticing
  pairHoldS: 5,       // s: the first pair's hold (the owner's moment to notice them at load)
  // frameShot: the camera's height, where the kayak stands in the frame (NDC boxes) and how tall the paddler is
  frameY: 1.6,        // m over the water
  horizon: 0.14,      // the horizon this far above the frame's middle (NDC): the aim tipped ≈ 3° down, the horizon level
  box: { desk: [-0.05, 0.6, -0.9, 0.05], phone: [-0.85, 0.85, -0.55, 0.45] },   // [x0, x1, y0, y1]: desktop right of centre, clear of the key hints (x over 0.62); a phone's middle band
  aimX: { desk: 0.3, phone: 0.05 },   // the kayak's centre across the frame (NDC)
  figure: 0.45,       // the paddler (waterline to head) this much of the frame's height in NDC (2 = the whole height): about a quarter with the kayak
  resolve: 0.25,      // s between searches
  minBoat: 7,         // m: the camera never nearer the boat than this
  // a phone (fix/kayaks-phone-framing; the shot above left the near paddler 92–126 px of an upright phone's 844 and its
  // mate out of the frame on the way in): the camera lower, at a paddler's eye (1.25 m), the horizon higher in the frame,
  // so the whole kayak fits from 4–7 m, three-quarters off its bow on an upright phone; a sideways phone's box the whole
  // frame under the top bar (the cockpit is folded for the shot); the mate held inside the frame, not only weighed; and
  // `keep`: the blend (src/boat/followCamera.js blendShot) turns the aim so both paddlers stay inside this box on the way
  // in, through the hold and on the way back while the shot still holds most of the view (w over keepW); on the way back
  // the camera dollies out before it swings
  phone: {
    frameY: 1.25, horizon: 0.34,
    figure: 0.45, figureWide: 0.65,   // upright (≈ 190 px of 844), sideways (≈ 127 px of 390)
    boxWide: [-0.85, 0.85, -0.85, 0.5],
    mateIn: [-0.92, 0.92, -0.62, 0.55], mateW: 20,
    keep: [-0.9, 0.9, -0.62, 0.55], keepWide: [-0.9, 0.9, -0.88, 0.6], keepW: 0.3,
    dists: [4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 10],
    endsX: [-1.15, 1.15],
    window: 75 * DEG,   // a re-solve searches this far round from the last answer
    stick: 0.6,         // the cost of a radian's swing from the last answer (2.5 elsewhere): the pair turns, the camera follows round
    gap: 0.3,           // NDC across: an upright phone's pair one behind the other, the far one this far clear of the near one
    lenses: [40, 50, 60], lensCost: 0.08,   // vertical degrees; the cost of each degree over 40
    keepNear: 3.5,      // m: the blend never brings the camera nearer a paddler than this
    keepDown: 20 * DEG, // the blend never tips the aim further down than this to keep them
    keepFov: 55,        // the blend widens the lens up to this when the two paddlers span more than the box
  },
});

const smoother = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (t * 6 - 15) + 10); };

// the shot for a kayak K and the boat B (x, z), on the kayak's far side; swung to whichever side keeps it over water
export function shotPose(K, B, N = NOTICE, ground = null) {
  const dx = K.x - B.x, dz = K.z - B.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
  let best = null;
  for (const s of [1, -1]) {
    const c = Math.cos(s * N.camSwing), sn = Math.sin(s * N.camSwing), rx = ux * c - uz * sn, rz = ux * sn + uz * c;
    const pos = [K.x + rx * N.camOff, N.camY, K.z + rz * N.camOff];
    const wet = !ground || ground(pos[0], pos[2]) < -0.5;
    if (!best || (wet && !best.wet)) best = { pos, wet };
    if (wet && s === 1) break;
  }
  const target = [K.x + (B.x - K.x) * N.aim, N.aimY, K.z + (B.z - K.z) * N.aim];
  return { pos: best.pos, target };
}

// project world point P for a camera at C, yaw psi (clockwise from north, the view's heading), pitch p (+ down), tangents
// tx, ty of the half-angles → [ndcX, ndcY, depth]
function project(P, C, psi, p, tx, ty) {
  const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2];
  const sp = Math.sin(psi), cp = Math.cos(psi), s = Math.sin(p), c = Math.cos(p);
  const zc = dx * sp * c - dy * s - dz * cp * c, xc = dx * cp + dz * sp, yc = dx * sp * s + dy * c - dz * cp * s;
  return [xc / (zc * tx), yc / (zc * ty), zc];
}
const KL = 2.2, HEAD = 0.95;   // m: half the kayak's length, the paddler's head over the water
export function frameShot(K, B, view, { mate = null, ground = null, prev = null, N = NOTICE, dists = null } = {}) {
  const phone = !!view.phone || (view.aspect ?? 1.78) < 1, PH = phone ? N.phone : null, wide = (view.aspect ?? 1.78) >= 1;
  const box = PH ? (wide ? PH.boxWide : N.box.phone) : N.box.desk, ax = phone ? N.aimX.phone : N.aimX.desk;
  const frameY = PH ? PH.frameY : N.frameY, figure = PH ? (wide ? PH.figureWide : PH.figure) : N.figure;
  dists ??= PH ? PH.dists : [4.5, 5.5, 6.5, 8, 9, 10, 12, 15];
  const hz = PH ? PH.horizon : N.horizon, lenses = PH ? PH.lenses : [view.fov ?? 40];   // a phone: a wider lens when it frames better
  const kh = K.heading ?? 0, bx = Math.sin(kh) * KL, bz = -Math.cos(kh) * KL;
  const kpts = [[K.x + bx, 0, K.z + bz], [K.x - bx, 0, K.z - bz], [K.x, HEAD, K.z], [K.x, 0, K.z]];
  let best = null;
  for (const fov of lenses) for (let az = 0; az < 360; az += 7.5) for (const D of dists) {
    const ty = Math.tan(fov * DEG / 2), tx = ty * (view.aspect ?? 16 / 9);
    const p = Math.atan(hz * ty);   // the aim tipped down so the horizon stands hz above the middle
    const a = az * DEG;
    if (PH && prev && Math.abs(wrap(a - prev.az)) > PH.window) continue;   // a phone's re-solve: near the last answer only (3 lenses)
    const C = [K.x + Math.sin(a) * D, frameY, K.z - Math.cos(a) * D];
    const dB = Math.hypot(C[0] - B.x, C[2] - B.z);
    if (dB < N.minBoat) continue;
    if (ground && ground(C[0], C[2]) > -0.5) continue;
    // the aim: the kayak at aimX across the frame; a phone with a pair: the middle of the two (the narrow view holds both)
    const beta = Math.atan2(K.x - C[0], -(K.z - C[2]));
    const psi = PH && mate ? beta + wrap(Math.atan2(mate.x - C[0], -(mate.z - C[2])) - beta) / 2 : beta - Math.atan(ax * tx);
    const q = kpts.map((P) => project(P, C, psi, p, tx, ty));
    if (q.some((v) => v[2] <= 0.5)) continue;
    let cost = 0;
    const xs = q.map((v) => v[0]), ys = q.map((v) => v[1]);
    let over = Math.max(0, box[0] - Math.min(...xs)) + Math.max(0, Math.max(...xs) - box[1]) + Math.max(0, box[2] - Math.min(...ys)) + Math.max(0, Math.max(...ys) - box[3]);
    // an upright phone: the paddler (head, waterline) in the box; the kayak's bow and stern only inside endsX across (a
    // close-up may crop the hull's tips at the frame's sides, never the paddler)
    if (PH && !wide) { const ex = PH.endsX, px = [q[2][0], q[3][0]], ex2 = [q[0][0], q[1][0]];
      over = Math.max(0, box[0] - Math.min(...px)) + Math.max(0, Math.max(...px) - box[1]) + Math.max(0, ex[0] - Math.min(...ex2)) + Math.max(0, Math.max(...ex2) - ex[1]) + Math.max(0, box[2] - Math.min(...ys)) + Math.max(0, Math.max(...ys) - box[3]); }
    cost += over * 40;
    const fig = q[2][1] - q[3][1];
    cost += Math.abs(fig - figure) * 12;   // the paddler's height
    // the boat behind, in the frame: its hull and its masthead
    const bh = project([B.x, 1, B.z], C, psi, p, tx, ty), bm = project([B.x, 12, B.z], C, psi, p, tx, ty);
    if (bh[2] < D) cost += 3; else { cost += Math.min(2, Math.max(0, Math.abs(bh[0]) - 0.9) * 4); cost += Math.max(0, bm[1] - 1) * 0.5; if (bh[0] > ax - 0.15) cost += 0.5; }
    // the mate (the pair's other paddler): in the frame too
    // the mate never near the camera, now or as it paddles on (3 s at a cruise), nor nearer the camera than the kayak framed
    if (mate) {
      const mh = mate.heading ?? kh, mx3 = mate.x + Math.sin(mh) * 4, mz3 = mate.z - Math.cos(mh) * 4;
      const dm = Math.min(Math.hypot(C[0] - mate.x, C[2] - mate.z), Math.hypot(C[0] - mx3, C[2] - mz3));
      if (dm < 6) cost += 4 + (6 - dm);
      const m0 = project([mate.x, 0.5, mate.z], C, psi, p, tx, ty);
      if (dm < D - 1 && m0[2] > 0 && Math.abs(m0[0]) < 1.2 && Math.abs(m0[1]) < 1.2) cost += 2;   // in front of the one framed
    }
    if (mate) {
      const m = project([mate.x, 0.5, mate.z], C, psi, p, tx, ty);
      cost += m[2] <= 0.5 ? 0.5 : Math.min(0.5, (Math.max(0, Math.abs(m[0]) - 0.95) + Math.max(0, Math.abs(m[1]) - 0.95)) * 2);
      // side by side, not one behind the other (the kayak framed would hide its mate)
      // (an upright phone: one behind the other is its natural picture, the far one higher; only clear of the near one)
      const gap = Math.abs(m[0] - (q[3][0] + q[2][0]) / 2) * (PH && !wide ? 1 : view.aspect ?? 1.78), need = PH && !wide ? PH.gap : 0.6;
      if (m[2] > 0.5 && gap < need) cost += 1.5 * (need - gap) / need;
      // a phone: the mate's head and waterline inside the frame, as the kayak framed is (a narrow view loses it otherwise)
      if (PH) for (const yv of [0, HEAD]) {
        const v = project([mate.x, yv, mate.z], C, psi, p, tx, ty), bx = PH.mateIn;
        cost += v[2] <= 0.5 ? PH.mateW : PH.mateW * (Math.max(0, bx[0] - v[0]) + Math.max(0, v[0] - bx[1]) + Math.max(0, bx[2] - v[1]) + Math.max(0, v[1] - bx[3]));
      }
    }
    // stay near the last answer (no swing between two framings)
    if (prev) cost += Math.abs(wrap(a - prev.az)) * (PH ? PH.stick : 2.5) + Math.abs(D - prev.D) * 0.15;
    if (PH) cost += (fov - lenses[0]) * PH.lensCost + (prev ? Math.abs(fov - (prev.fov ?? fov)) * PH.lensCost : 0);
    if (!best || cost < best.cost) best = { cost, az: a, D, C, psi, p, fov, over, fig, boat: bh[0] };
  }
  if (!best) return null;
  const { C, psi, p } = best, c = Math.cos(p);
  return { pos: C, target: [C[0] + Math.sin(psi) * c * 20, C[1] - Math.sin(p) * 20, C[2] - Math.cos(psi) * c * 20], fov: best.fov, az: best.az, D: best.D, cost: best.cost, over: best.over, fig: best.fig, boatX: best.boat };
}

export function createNotice(N = NOTICE) {
  const seen = new Set();
  let target = null, phase = 'idle', t = 0, hold = 0, wFrom = 0, w = 0, pose = null, holdS = N.holdS, solve = null, solveT = 0;
  const ease = (cur, want, dt) => cur.map((v, i) => v + (want[i] - v) * (1 - Math.exp(-dt / N.smooth)));
  return {
    seen,
    get target() { return target; },
    get phase() { return phase; },
    update(dt, { boat, kayaks = [], dragging = false, enabled = true, ground = null, view = null }) {
      hold = dragging ? N.dragHold : Math.max(0, hold - dt);
      const at = (k) => { const dx = k.x - boat.x, dz = k.z - boat.z; return { d: Math.hypot(dx, dz), rel: Math.abs(wrap(Math.atan2(dx, -dz) - boat.heading)) }; };
      const K = target != null ? kayaks.find((q) => q.id === target) : null;
      // let go: dragged, switched off, the kayak gone or far, the hold over
      if (phase !== 'idle' && phase !== 'out' && (dragging || !enabled || !boat || !K || at(K).d > N.release || (phase === 'hold' && t >= holdS))) { phase = 'out'; t = 0; wFrom = w; }
      if (phase === 'idle' && enabled && boat && hold <= 0) {
        let best = null, bd = Infinity;
        for (const k of kayaks) { if (seen.has(k.id)) continue; const p = at(k); if (p.d <= N.range && p.rel <= N.front && p.d < bd) { bd = p.d; best = k; } }
        if (best) { target = best.id; seen.add(best.id); phase = 'in'; t = 0; pose = null; solve = null; solveT = 0; holdS = best.hold ?? N.holdS; if (best.group != null) for (const k of kayaks) if (k.group === best.group) seen.add(k.id); }
      }
      t += dt;
      if (phase === 'in') { w = smoother(t / N.inS); if (t >= N.inS) { phase = 'hold'; t = 0; } }
      else if (phase === 'hold') w = 1;
      else if (phase === 'out') { w = wFrom * (1 - smoother(t / (N.outS * Math.max(0.4, wFrom)))); if (w <= 1e-4) { phase = 'idle'; w = 0; target = null; pose = null; } }
      const Kn = target != null ? kayaks.find((q) => q.id === target) : null;
      if (Kn && boat) {
        let want = null;
        if (view) {
          solveT -= dt;
          if (!solve || solveT <= 0) {
            solveT = N.resolve;
            const mate = Kn.group != null ? kayaks.find((q) => q.group === Kn.group && q.id !== Kn.id) : null;
            const s1 = frameShot(Kn, boat, view, { mate, ground, prev: solve, N });
            // a pair, at the shot's start: frame whichever of the two frames better (the outer one, with its mate beside it)
            const s2 = !solve && mate ? frameShot(mate, boat, view, { mate: Kn, ground, N }) : null;
            if (s2 && (!s1 || s2.cost < s1.cost)) { target = mate.id; solve = s2; solve.at = [mate.x, mate.z]; }
            else solve = s1 ?? solve;
          }
          if (solve) want = { pos: solve.pos, target: solve.target, fov: solve.fov };
          // (between searches the camera rides with the kayak: the searched offset kept)
          const Kt = kayaks.find((q) => q.id === target) ?? Kn;
          if (want && solve.at) { const ox = Kt.x - solve.at[0], oz = Kt.z - solve.at[1]; want = { ...want, pos: [want.pos[0] + ox, want.pos[1], want.pos[2] + oz], target: [want.target[0] + ox, want.target[1], want.target[2] + oz] }; }
          if (solve && !solve.at) solve.at = [Kt.x, Kt.z];
        }
        want ??= shotPose(Kn, boat, N, ground);
        pose = pose ? { pos: ease(pose.pos, want.pos, dt), target: ease(pose.target, want.target, dt), fov: want.fov } : want;
      }
      // a phone: the paddlers the blend keeps in the frame (the one framed and its mate: head and waterline)
      let keep = null;
      if (pose && view && (view.phone || (view.aspect ?? 1.78) < 1)) {
        const Kt = kayaks.find((q) => q.id === target), M = Kt?.group != null ? kayaks.find((q) => q.group === Kt.group && q.id !== Kt.id) : null;
        const pts = [Kt, M].filter(Boolean).flatMap((k) => [[k.x, HEAD, k.z], [k.x, 0, k.z]]), wide = (view.aspect ?? 1.78) >= 1;
        if (pts.length) keep = { keep: pts, keepBox: wide ? N.phone.keepWide : N.phone.keep, keepW: phase === 'in' ? 1e-6 : N.phone.keepW, keepFov: N.phone.keepFov, keepNear: N.phone.keepNear, keepDown: N.phone.keepDown, back: phase === 'out', aspect: view.aspect ?? 16 / 9 };
      }
      return { shot: pose && w > 0 ? { pos: pose.pos, target: pose.target, w, ...(pose.fov ? { fov: pose.fov } : {}), ...keep } : null, target, phase };
    },
  };
}
