// The player's sloop crewed: a helmsman at the wheel and one crew on the windward side, drawn as the kayakers' figure
// (render/figureRig.js: the limbs two-bone chains to their targets, the spine in three segments, the head on its own up). This
// module is the choreography and the balance: the boat's drawn state in, each figure's targets out, in the HULL frame (x
// starboard, y up from the waterline, z aft). Pure: no DOM, no GPU, no randomness, no allocation per step after creation; the
// same inputs give the same pose (tests/boat-crew.test.mjs).
//
// Balance is dynamic, not a pose held upright: each body's chest is an actively balanced pendulum on its hips. Its lean in the
// world (across the boat and fore and aft) is a spring-damper toward where a sailor would hold it (BAL: a share of the heel
// and the pitch taken out, the rest ridden with the boat) and is pushed by what the hips feel: the roll's acceleration at the
// hips' height, the turn's lateral pull, the surge. So the chest lags a roll, catches up, overshoots a little and settles. The
// pelvis takes most of the boat's motion (sitting: nearly all of it), the spine bends between; the head holds the horizon on a
// faster, better damped loop (a vestibular head); a standing helmsman's knees take the heave.
// The helmsman stands behind the wheel, stance wide, knees flexed, his weight on the low foot (the hips drop to leeward as she
// heels), his hands on the rim where the wheel's own turn carries them (render/boat.js: 4 x the rudder; a hand that has followed
// it far lets go and grips again, one at a time); when she rolls hard he firms on the wheel (pulled in, elbows bent).
// The crew sits on the windward seat facing inboard, compensating about half the heel, hips riding the seat; past ~12-22° of
// windward heel she leans out over the coaming (the aft hand on its top). When the boom crosses (a tack or a gybe) she scrambles
// across low and fast: the trailing hand pushes off the old seat, the body pitched forward under the swinging boom with the
// weight leading, the lead hand reaching for the new seat's edge, two long steps, down onto the new seat with a little bounce
// (the landing excites the same spring). In a knockdown or a sudden roll both hold on with effort: elbows bent, the body pulled
// in toward the grip, the pull harder as she rolls. Idle life: breathing, a weight shift every few seconds, a glance up at the
// sails or under the boom.
//   const C = createBoatCrew()
//   C.step(dt, { heel, pitch, boom, rudder, heave, u, yawRate })   once a frame (dt: the living clock; boom: drawn, + to starboard)
//   C.targets('helm' | 'crew', sc) → the figure rig's targets T (render/figureRig.js), reused
//   C.state → { side, cross, hold, hike, duck, grips, body: { helm, crew } (each: psi, th the chest's world lean across and fore-aft) }
//   HALCYON: the deck's numbers the poses are built on (HULL frame, measured from models/boat/*.glb)
const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;

// the deck (HULL frame, m): the cockpit sole, the seats' cushion tops (|x| 0.78-1.26), the coaming's top and inner face, the
// side deck, the wheel (axle, the rim's centre line), the boom's gooseneck and length (src/boat/rig.js GOOSENECK_PIN in the
// RIG frame + the mast step), the dodger's aft edge
export const HALCYON = Object.freeze({
  sole: 0.49, seat: 1.05, seatX: [0.78, 1.26], coamingTop: 1.2, coamingX: [1.27, 1.40], sideDeck: 0.97, beam: 1.58,
  wheel: Object.freeze({ at: [0, 1.2, 2.59], r: 0.39 }),
  boom: Object.freeze({ pin: [0, 2.513, -0.619], len: 3.277, bottom: 0.07 }), dodgerZ: 1.38,
});
// the choreography's numbers: the helmsman's stand, the crew's seat, the cross's time (s), the hold's triggers (heel deg, heel
// rate deg/s), the hike's band (windward heel deg), the boom angle that says which side is windward
export const CREW = Object.freeze({
  helm: Object.freeze({ z: 2.91, feetX: 0.22, hipY: 0.86, leanDeg: 14, lowHipM: 0.07, glanceS: 9, glance: Object.freeze([6.4, 8.2]), glanceDeg: 24,
    grip: Object.freeze([118, 62]), regripDeg: 40, regripTo: 18, slipDeg: 52, regripS: 0.32 }),
  crew: Object.freeze({ z: 2.0, hipX: 1.02, hipY: 0.1, footX: 0.52, footDz: 0.13, backDeg: 8, hikeDeg: Object.freeze([12, 22]), hikeLeanDeg: 34 }),
  crossS: 2.4, slideS: 0.9, tailS: 1.8, releaseS: 0.5, lingerS: 2.5, trimDegS: 3, restS: 5, settleS: 1.5, sideDeg: 4, holdHeelDeg: 30, holdRateDeg: 30, holdRateMinDeg: 12, holdIn: 0.25, holdOut: 1.4, duckDeg: Object.freeze([12, 28]),
});
// the balance (per body): k the share of the heel (and kp of the pitch) the chest takes out (1: held world-upright, 0: rides the
// boat); w (rad/s) and z the chest's loop; roll: the gain on the roll's acceleration at the hips (m of lever over the chest's), turn
// the lateral pull of a turn (u × yaw rate), surge the fore-and-aft (u'); pelvis: the pelvis's share of the chest's lean against
// the boat; head: the head's loop (w, z) and the share of the heel it still shows; knee: the standing knees' heave loop (w, z, gain)
export const BAL = Object.freeze({
  helm: Object.freeze({ k: 0.78, kp: 0.6, w: 4.6, z: 0.42, roll: 0.35, turn: 0.18, surge: 0.12, pelvis: 0.45, head: Object.freeze({ w: 8, z: 0.75, keep: 0.08 }), knee: Object.freeze({ w: 7, z: 0.45, gain: 0.5, max: 0.09 }) }),
  crew: Object.freeze({ k: 0.5, kp: 0.4, w: 3.8, z: 0.5, roll: 0.25, turn: 0.15, surge: 0.1, pelvis: 0.15, head: Object.freeze({ w: 7.5, z: 0.7, keep: 0.12 }), knee: Object.freeze({ w: 9, z: 0.5, gain: 0.15, max: 0.04 }) }),
});

const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// the world's up seen in the HULL frame (Boat.update: Ry(-heading) · Rx(pitch) · Rz(-heel)): (Rx Rz)ᵀ ŷ
export function worldUpInHull(heel, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [-cp * Math.sin(heel), cp * Math.cos(heel), -sp];
}
// an up in the HULL frame from a lean across (+ to starboard, rad) and fore and aft (+ toward the bow) relative to the boat's own up
const upOf = (across, fore, out) => { const c = Math.cos(fore); out[0] = Math.sin(across) * c; out[1] = Math.cos(across) * c; out[2] = -Math.sin(fore); return out; };
// a point on the wheel's rim at angle a (rad, from +x toward +y; the wheel's own turn is in a)
export const rimPoint = (a, r = HALCYON.wheel.r, W = HALCYON.wheel.at) => [W[0] + Math.cos(a) * r, W[1] + Math.sin(a) * r, W[2]];
// the boom's axis at `along` m from the gooseneck (HULL frame; boomPoint's, + the mast step)
export const boomAxis = (boom, along, B = HALCYON.boom) => [B.pin[0] + Math.sin(boom) * along, B.pin[1], B.pin[2] + Math.cos(boom) * along];
// a deterministic unit number from an integer (the idle life's schedule)
const hashU = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// one body's balance: the chest's world lean (psi across, th fore-aft) on a spring-damper, the head's on a faster one, the knees'
// heave on a third
function createBody(B) {
  return { B, psi: 0, psiV: 0, th: 0, thV: 0, hp: 0, hpV: 0, ht: 0, htV: 0, y: 0, yV: 0, init: false };
}
// tgtAcross/tgtFore: the lean the body wants against the boat (rad); the chest settles to that less what it takes out of the
// heel and pitch: world target = boat-relative target + (1 − k) · heel
function stepBody(b, dt, m, tgtAcross, tgtFore, headAcross, headFore) {
  const B = b.B, psiT = tgtAcross + m.heel, thT = tgtFore - m.pitch;
  const hpT = headAcross + B.head.keep * m.heel, htT = headFore - 0.85 * m.pitch;
  if (!b.init) { b.init = true; b.psi = psiT; b.th = thT; b.hp = hpT; b.ht = htT; }
  // the hips' push: the roll's acceleration at the hips (they swing with the boat, the chest's inertia leans it the other way), the
  // turn's pull outward, a surge's pitch
  const fa = -B.roll * m.rollAcc - B.turn * m.u * m.yawRate, ft = -B.surge * m.surgeAcc;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) {
    b.psiV += (B.w * B.w * (psiT - b.psi) - 2 * B.z * B.w * b.psiV + fa) * h; b.psi += b.psiV * h;
    b.thV += (B.w * B.w * (thT - b.th) - 2 * B.z * B.w * b.thV + ft) * h; b.th += b.thV * h;
    const H = B.head; b.hpV += (H.w * H.w * (hpT - b.hp) - 2 * H.z * H.w * b.hpV) * h; b.hp += b.hpV * h;
    b.htV += (H.w * H.w * (htT - b.ht) - 2 * H.z * H.w * b.htV) * h; b.ht += b.htV * h;
    const K = B.knee; b.yV += (-K.w * K.w * b.y - 2 * K.z * K.w * b.yV - K.gain * m.heaveAcc) * h; b.y += b.yV * h;
  }
  b.psi = clamp(b.psi, m.heel - 1.2, m.heel + 1.2); b.th = clamp(b.th, -1, 1.2);
  b.y = clamp(b.y, -B.knee.max, B.knee.max);
}

export function createBoatCrew({ C = CREW, D = HALCYON, BL = BAL, idle = true } = {}) {   // idle false: no breathing, shifts or glances (the tests' clean steps)
  const IDLE = idle ? 1 : 0;
  const st = { side: 0, cross: -1, from: 0, arrived: -99, at: { k: 'rail', s: 1 }, mv: null, plan: [], sheet: null, sheetRate: 0, trimT: 0, work: 0, workE: 0, workT: 0, release: 0, hold: 0, hike: 0, duck: 0, firm: 0, grips: [{ off: 0, q: -1, from: 0, to: 0 }, { off: 0, q: -1, from: 0, to: 0 }], t: 0, heel: 0, rate: 0, wheel: 0, first: true,
    body: { helm: createBody(BL.helm), crew: createBody(BL.crew) } };
  let P = { heel: 0, pitch: 0, boom: 0, rudder: 0 };
  const M = { heel: 0, pitch: 0, rollAcc: 0, surgeAcc: 0, heaveAcc: 0, u: 0, yawRate: 0 };
  const prev = { rate: 0, heave: 0, heaveV: 0, u: 0, ok: false };
  const TH = { hip: [0, 0, 0], up: [0, 1, 0], pelvisUp: [0, 1, 0], headUp: [0, 1, 0], across: [1, 0, 0], hands: [[0, 0, 0], [0, 0, 0]], elbowPole: [[-0.7, -0.7, 0.3], [0.7, -0.7, 0.3]], feet: [[0, 0, 0], [0, 0, 0]], kneePole: [[0, 0.5, -1], [0, 0.5, -1]], headLevel: 1, armReach: 1, armMax: 1.25, footTurn: 0.16, footFwd: null, headPitch: 0, headYaw: 0 };
  const TC = { hip: [0, 0, 0], up: [0, 1, 0], pelvisUp: [0, 1, 0], headUp: [0, 1, 0], across: [0, 0, 1], hands: [[0, 0, 0], [0, 0, 0]], elbowPole: [[0, -1, 0], [0, -1, 0]], feet: [[0, 0, 0], [0, 0, 0]], kneePole: [[0, 1, 0], [0, 1, 0]], headLevel: 1, armReach: 1, armMax: 1.25, footTurn: 0.1, footFwd: [1, 0, 0], headPitch: 0, headYaw: 0 };
  // the bodies' wanted leans against the boat this frame (set by the poses, read by the next step: one frame's lag is nothing)
  const want = { helm: { a: 0, f: 14 * DEG, ha: 0, hf: 0 }, crew: { a: 0, f: 0, ha: 0, hf: 0 } };

  function step(dt, pose) {
    P = pose;
    const heel = pose.heel ?? 0, boom = pose.boom ?? 0;
    st.wheel = -4 * (pose.rudder ?? 0);
    if (st.first) {   // the first frame: the crew already on the windward side, the hands on their grips
      st.first = false; st.side = Math.abs(boom) > C.sideDeg * DEG ? -Math.sign(boom) : (heel > 0 ? -1 : 1); st.heel = heel;
      for (let h = 0; h < 2; h++) st.grips[h].off = C.helm.grip[h] * DEG - st.wheel;
    }
    dt = clamp(dt, 0, 0.1);
    st.t += dt;
    // the boat's motion felt at the hips: the roll's rate and acceleration (a frame's noise smoothed), the heave's and the surge's
    let rollAcc = 0, heaveAcc = 0, surgeAcc = 0;
    if (dt > 0) {
      const r = (heel - st.heel) / dt, r0 = st.rate; st.rate += (r - st.rate) * Math.min(1, dt / 0.06);
      const hv = ((pose.heave ?? 0) - prev.heave) / dt, hv0 = prev.heaveV; prev.heaveV += (hv - prev.heaveV) * Math.min(1, dt / 0.06);
      if (prev.ok) { rollAcc = clamp((st.rate - r0) / dt, -12, 12); heaveAcc = clamp((prev.heaveV - hv0) / dt, -15, 15); surgeAcc = clamp(((pose.u ?? 0) - prev.u) / dt, -5, 5); }
      prev.ok = true; prev.heave = pose.heave ?? 0; prev.u = pose.u ?? 0;
    }
    st.heel = heel;
    M.heel = heel; M.pitch = pose.pitch ?? 0; M.rollAcc = rollAcc; M.heaveAcc = heaveAcc; M.surgeAcc = surgeAcc; M.u = pose.u ?? 0; M.yawRate = pose.yawRate ?? 0;
    // the hold: a knockdown's heel or a sudden roll (a strike) past holdRateMinDeg grips both at once; it lets go slowly once she is up
    const wantHold = Math.abs(heel) > C.holdHeelDeg * DEG || (Math.abs(st.rate) > C.holdRateDeg * DEG && Math.abs(heel) > C.holdRateMinDeg * DEG) ? 1 : 0;
    st.hold = wantHold ? Math.min(1, st.hold + dt / C.holdIn) : Math.max(0, st.hold - dt / C.holdOut);
    // the helmsman firms on the wheel as she rolls (quick in, slow out)
    const fm = smooth(4 * DEG, 18 * DEG, Math.abs(st.rate));
    st.firm = fm > st.firm ? st.firm + (fm - st.firm) * Math.min(1, dt / 0.12) : st.firm + (fm - st.firm) * Math.min(1, dt / 0.9);
    // windward: the side away from the boom (a boom near the centreline keeps the last side)
    const windward = boom > C.sideDeg * DEG ? -1 : boom < -C.sideDeg * DEG ? 1 : st.side;
    // the player trimming: the sheets' angle moving (W/S, or the crew's own trim), smoothed; held 0.4 s it is real work
    if (dt > 0) { const sh = pose.sheet ?? 0; if (st.sheet == null) st.sheet = sh; const r = (sh - st.sheet) / dt; st.sheet = sh; st.sheetRate += (r - st.sheetRate) * Math.min(1, dt / 0.15); }
    const trimming = Math.abs(st.sheetRate) > C.trimDegS * DEG;
    st.trimT = trimming ? st.trimT + dt : 0;
    if (st.t < C.settleS) { st.side = windward; st.at = { k: 'rail', s: windward }; st.mv = null; st.plan.length = 0; }   // the first seconds: settled, no move
    else {
      // a tack or a gybe (the windward side changed): tail the new sheet on the new leeward winch (her side before the tack), then
      // to the new windward seat; at the old leeward winch she lets the old sheet go first (a moment), then crosses to tail the new
      if (windward !== st.side && st.hold < 0.5) {
        st.side = windward; st.plan.length = 0;
        const nl = -windward, here = st.mv ? st.mv.b : st.at;
        if (here.k === 'winch' && here.s !== nl) st.plan.push({ dwell: C.releaseS, work: 'release' });
        st.plan.push({ go: { k: 'winch', s: nl } }, { dwell: C.tailS, work: 'tail' }, { go: { k: 'rail', s: windward } });
      }
      // the player trims: to the working sheet's winch (the leeward one) and work it while the trim goes on, back to the rail after
      // (not while she is heeled hard or rolling: then she stays up on the rail, holding on; not in her first restS back on the rail:
      // the sheets settling after a tack are the trim's own)
      if (!st.plan.length && !st.mv && st.at.k === 'rail' && st.t - st.arrived > C.restS && st.trimT > 0.6 && st.hold < 0.1 && Math.abs(heel) < 18 * DEG && Math.abs(st.rate) < 8 * DEG) st.plan.push({ go: { k: 'winch', s: -st.side } }, { dwell: C.lingerS, work: 'trim' }, { go: { k: 'rail', s: st.side } });
    }
    // the plan: a move (a slide along her seat, or a scramble across the cockpit), a dwell (at the winch: tailing, releasing, trimming)
    if (st.mv) {
      st.mv.u += dt / st.mv.dur;
      if (st.mv.u >= 1) { st.at = st.mv.b; st.arrived = st.t; if (st.mv.cross || st.at.k === 'rail') st.body.crew.yV -= st.mv.cross ? 0.45 : 0.2; st.mv = null; }   // down onto the seat: the landing's bounce
    } else for (let n = 0; n < 3 && !st.mv && st.plan.length && st.hold < 0.5; n++) {   // a dwell done goes straight on to the next move
      const q = st.plan[0];
      if (q.go) {
        st.plan.shift();
        if (q.go.k !== st.at.k || q.go.s !== st.at.s) st.mv = { a: st.at, b: q.go, u: 0, cross: q.go.s !== st.at.s, dur: q.go.s !== st.at.s ? C.crossS : C.slideS };
      } else {
        if (!q.counted) { q.t = (q.t ?? 0) + dt; q.counted = true; }
        if (q.work === 'trim' && trimming) q.t = 0;   // still trimming: stay at it
        if (q.t >= q.dwell) st.plan.shift(); else { q.counted = false; break; }
      }
    }
    const dw = !st.mv && st.plan[0]?.dwell != null ? st.plan[0] : null;
    st.work = dw ? (dw.work === 'release' ? 0 : dw.work === 'trim' ? (trimming ? 1 : 0) : 1) : 0;
    st.release = dw?.work === 'release' ? clamp((dw.t ?? 0) / C.releaseS, 0, 1) : 0;
    st.workE += ((st.work ? 1 : 0) - st.workE) * Math.min(1, dt / 0.25);
    if (st.workE > 0.01) st.workT += dt;
    st.cross = st.mv ? st.mv.u : -1; st.from = st.mv ? st.mv.a.s : st.at.s;
    // the hike: at the rail, her own side up past the band (its windward heel), eased like a body moving (0.8 s)
    const atRail = !st.mv && st.at.k === 'rail', up = -st.at.s * heel / DEG, hk = atRail ? smooth(C.crew.hikeDeg[0], C.crew.hikeDeg[1], up) : 0;
    st.hike = st.t < C.settleS ? hk : st.hike + (hk - st.hike) * Math.min(1, dt / 0.8);
    // the duck: while scrambling across, as low as the boom is near the centreline (its real swing overhead), and low off the seat
    const dk = st.mv?.cross ? Math.max(1 - smooth(C.duckDeg[0] * DEG, C.duckDeg[1] * DEG, Math.abs(boom)), 1 - smooth(0.2, 0.6, st.mv.u)) : 0;
    st.duck += (dk - st.duck) * Math.min(1, dt / 0.12);
    // the helmsman's hands: each follows the rim; one past regripDeg from its home lets go and grips again regripTo short of home
    const H = C.helm;
    for (let h = 0; h < 2; h++) {
      const g = st.grips[h], o = st.grips[1 - h];
      if (g.q >= 0) { g.q += dt / H.regripS; if (g.q >= 1) { g.q = -1; g.off = g.to; } continue; }
      const a = st.wheel + g.off, home = H.grip[h] * DEG, dev = a - home;
      if (Math.abs(dev) > H.regripDeg * DEG && o.q < 0) { g.q = 0; g.from = a; g.to = home - Math.sign(dev) * H.regripTo * DEG - st.wheel; }
      else if (Math.abs(dev) > H.slipDeg * DEG) g.off = home + Math.sign(dev) * H.slipDeg * DEG - st.wheel;   // the rim slips through the hand
    }
    // the balance: each chest toward its wanted lean with the share of the heel it takes out
    for (const who of ['helm', 'crew']) {
      const b = st.body[who], w = want[who], k = b.B.k * (1 - (who === 'crew' ? 0.5 : 0.25) * st.hold), kp = b.B.kp;
      stepBody(b, dt, M, w.a - k * heel, w.f + kp * M.pitch, w.ha, w.hf);
    }
  }

  // idle life: breathing (a chest's slow pitch), a weight shift every few seconds (eased between deterministic picks), a glance
  const breath = (t, ph) => IDLE * 1.1 * DEG * Math.sin(2 * Math.PI * (t / 4.3 + ph));
  const shift = (t, per, ph) => { const i = Math.floor(t / per + ph), f = smooth(0, 0.35, t / per + ph - i); return IDLE * lerp(hashU(i) * 2 - 1, hashU(i + 1) * 2 - 1, f); };
  const relOf = (b) => [b.psi - M.heel, b.th + M.pitch];   // the chest's lean against the boat (across, fore)

  // the helmsman: standing behind the wheel
  function helm(sc) {
    const H = C.helm, T = TH, heel = P.heel ?? 0, hold = st.hold, firm = Math.max(st.firm, hold), b = st.body.helm, w = want.helm;
    const lowSide = heel > 0 ? 1 : -1, hk = smooth(2 * DEG, 20 * DEG, Math.abs(heel));
    // what he wants: leaning to the wheel (more as he firms), a weight shift now and then; the head level, a glance at the sails
    const ws = shift(st.t, 4.7, 0.3);
    w.a = 0.02 * ws; w.f = (H.leanDeg + 8 * firm) * DEG;
    const ph = st.t % H.glanceS, gl = IDLE * smooth(H.glance[0], H.glance[0] + 0.6, ph) * (1 - smooth(H.glance[1] - 0.6, H.glance[1], ph));
    w.ha = 0; w.hf = 0;
    // the hips: down into flexed knees (the heave on them), dropped onto the low foot as she heels, the idle shift, in to the wheel firming
    T.hip[0] = lowSide * H.lowHipM * hk + 0.025 * ws; T.hip[1] = D.sole + H.hipY + b.y - 0.05 * firm - 0.02 * hk; T.hip[2] = H.z - 0.04 * firm;
    // the chest from the balance; the pelvis takes a share of its lean (the spine bends between); breathing on the chest
    const [ra, rf] = relOf(b);
    upOf(ra, rf + breath(st.t, 0), T.up); upOf(ra * BAL.helm.pelvis, rf * 0.5, T.pelvisUp);
    upOf(b.hp - heel, b.ht + M.pitch, T.headUp);   // the head's own up (the world's, nearly: a vestibular head)
    T.across = [1, 0, 0];
    for (let f = 0; f < 2; f++) {
      const sg = f === 0 ? -1 : 1;
      T.feet[f][0] = sg * (H.feetX + 0.05 * hk); T.feet[f][1] = D.sole + 0.085 * sc; T.feet[f][2] = H.z + 0.02 + (sg * lowSide > 0 ? 0.04 : -0.04) * hk;
      T.kneePole[f][0] = sg * 0.12; T.kneePole[f][1] = 0.3; T.kneePole[f][2] = -1;
    }
    // the hands on the rim (the wrist a little aft of it and outside, as a hand wraps it), a regrip lifted off; firming: pulled in
    for (let h = 0; h < 2; h++) {
      const g = st.grips[h];
      let a, lift = 0;
      if (g.q >= 0) { const e = smooth(0, 1, g.q); a = lerp(g.from, st.wheel + g.to, e); lift = Math.sin(Math.PI * g.q); }
      else a = st.wheel + g.off;
      const p = rimPoint(a, D.wheel.r + 0.03);
      T.hands[h][0] = p[0]; T.hands[h][1] = p[1] + 0.02 * lift; T.hands[h][2] = p[2] + 0.07 + 0.07 * lift;
      const sg = h === 0 ? -1 : 1; T.elbowPole[h][0] = sg * (0.7 + 0.5 * firm); T.elbowPole[h][1] = -0.7 + 0.4 * firm; T.elbowPole[h][2] = 0.3;
    }
    T.headLevel = 1; T.headPitch = H.glanceDeg * DEG * gl * (1 - hold) + 0.05 * firm; T.headYaw = 0;
    return T;
  }

  // the crew's stations (HULL frame): rail(s), the windward seat facing inboard; winch(w), the aft end of that side's seat turned
  // to the primary winch (the working jib sheet's: COCKPIT.winch), feet on the sole inboard-aft. A pose fills: hip, a (the torso's
  // facing angle: facing = (cos a, 0, sin a)), fa (the feet's), feet, hands, poles (elbows), wa/wf (the lean wanted against the
  // boat, across and fore), hp/hy (the head's pitch and yaw)
  const WINCH = (w) => [w * 1.33, 1.40, 2.65];   // the winch's top (models/boat/cockpit.json winch_primary_*: the drum at y 1.30)
  const DODGER = (s) => [s * 1.12, 1.62, 1.40];  // the sprayhood's aft frame low on its side (cockpit.glb dodger_trim): a handhold
  const mkPose = () => ({ hip: [0, 0, 0], a: 0, fa: 0, feet: [[0, 0, 0], [0, 0, 0]], hands: [[0, 0, 0], [0, 0, 0]], poles: [[0, -1, 0], [0, -1, 0]], wa: 0, wf: 0, hp: 0, hy: 0 });
  const PA = mkPose(), PB = mkPose();
  const railA = (s) => (s > 0 ? Math.PI : 0), winchA = (w) => Math.atan2(0.35, w * 0.33), winchFA = (w) => Math.atan2(0.45, -w);
  const fwdOf = (a) => [Math.cos(a), 0, Math.sin(a)], acrossOf = (a) => [-Math.sin(a), 0, Math.cos(a)];
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  function footPair(out, cx, cz, fa, sc, half) {   // two ankles round a centre, apart along the feet's right (f 0 left, 1 right)
    const r = acrossOf(fa);
    for (let f = 0; f < 2; f++) { const k = (f === 1 ? 1 : -1) * half; out[f][0] = cx + r[0] * k; out[f][1] = D.sole + 0.085 * sc; out[f][2] = cz + r[2] * k; }
  }
  function stationPose(S, sc, P) {
    const K = C.crew, hold = st.hold, b = st.body.crew;
    if (S.k === 'rail') {
      const s = S.s, hk = st.mv ? 0 : st.hike, pull = hold * (0.6 + 0.4 * smooth(0, 25 * DEG, Math.abs(st.rate)));
      P.hip[0] = s * (K.hipX + 0.12 * hk + 0.07 * pull); P.hip[1] = D.seat + K.hipY + 0.04 * hk - 0.03 * pull; P.hip[2] = K.z;
      P.a = railA(s); P.fa = P.a;
      footPair(P.feet, s * (K.footX + 0.1 * hk), K.z, P.fa, sc, K.footDz);
      const ws = shift(st.t, 5.9, 0.7);
      P.wa = s * ((K.backDeg + K.hikeLeanDeg * hk) * DEG * (1 - pull) + 0.03 * ws) + s * 0.12 * pull; P.wf = 0.05 * ws + 0.32 * pull;
      // the hands: on the thighs; the outboard (aft) hand on the coaming's top in the hike; both on it holding on, the elbows bent out
      for (let h = 0; h < 2; h++) {
        const right = (h === 1 ? 1 : -1) * -s, aft = right > 0;
        const thigh = [P.hip[0] - s * 0.3, P.hip[1] + 0.07, P.hip[2] + right * 0.16];
        const grip = [s * (D.coamingX[0] + 0.06), D.coamingTop + 0.09, K.z + (aft ? 0.24 : -0.24) * (1 - 0.3 * pull)];
        const g = hold > 0 ? hold : (aft ? hk : 0);
        for (let i = 0; i < 3; i++) P.hands[h][i] = lerp(thigh[i], grip[i], g);
        P.poles[h][0] = s * (0.3 - 0.5 * pull); P.poles[h][1] = -0.8 + 0.5 * pull; P.poles[h][2] = right * (0.6 + 0.6 * pull);
      }
      const gp = (st.t + 3.1) % 11, gl = IDLE * smooth(8.4, 9.0, gp) * (1 - smooth(10.0, 10.6, gp));
      P.hp = 0.08 + 0.35 * gl * (1 - hold); P.hy = s * (0.9 - 0.4 * gl) * (1 - hold);
      return P;
    }
    // at the winch: seated on the seat's aft end, turned to it; working it (one hand cranking the handle round the drum's top at
    // ≈ 1 turn a second, the other tailing the sheet off the self-tailer hand over hand), letting the old sheet fly, or resting a
    // hand on it between trims
    const w = S.s, Wt = WINCH(w), we = st.workE;
    P.hip[0] = w * 1.0; P.hip[1] = D.seat + K.hipY - 0.02; P.hip[2] = 2.3;
    P.a = winchA(w); P.fa = winchFA(w);
    footPair(P.feet, w * 0.6, 2.36, P.fa, sc, 0.13);
    const th = 2 * Math.PI * 1.05 * st.workT, crank = w > 0 ? 1 : 0, tail = 1 - crank;
    const rest = [[Wt[0] - w * 0.04, Wt[1] + 0.05, Wt[2] - 0.05], [P.hip[0] - w * 0.25, P.hip[1] + 0.08, P.hip[2] + 0.18]];
    const handle = [Wt[0] + 0.19 * Math.cos(th), Wt[1] + 0.06, Wt[2] + 0.19 * Math.sin(th)];
    const pp = (st.workT * 0.85) % 1, pullK = pp < 0.75 ? smooth(0, 0.75, pp) : 1 - smooth(0.75, 1, pp);   // the tail pulled in, the hand back
    const tailA = [Wt[0] - w * 0.12, Wt[1] + 0.06, Wt[2] - 0.08], tailB = [w * 1.0, D.seat + 0.33, 2.42];
    for (let i = 0; i < 3; i++) {
      P.hands[crank][i] = lerp(crank === 0 ? rest[0][i] : rest[0][i], handle[i], we);
      P.hands[tail][i] = lerp(rest[1][i], lerp(tailA[i], tailB[i], pullK) + (i === 1 ? 0.04 * Math.sin(Math.PI * pullK) : 0), we);
    }
    if (st.release > 0) { const r = Math.sin(Math.PI * st.release); P.hands[crank][1] += 0.22 * r; P.hands[crank][0] -= w * 0.12 * r; }   // the old sheet thrown off the drum
    if (hold > 0) for (let h = 0; h < 2; h++) { const g = [Wt[0] - w * 0.06, Wt[1] + 0.06, Wt[2] - (h ? 0.02 : 0.2)]; for (let i = 0; i < 3; i++) P.hands[h][i] = lerp(P.hands[h][i], g[i], hold); }
    for (let h = 0; h < 2; h++) { P.poles[h][0] = (h === 1 ? 1 : -1) * 0.5; P.poles[h][1] = -0.8; P.poles[h][2] = -0.2; }
    P.wa = w * 0.1; P.wf = (16 + 5 * we * Math.sin(th)) * DEG + 0.15 * hold;
    P.hp = -0.25 + 0.45 * we * smooth(0.6, 0.8, (st.workT * 0.3) % 1) * (1 - smooth(0.9, 1.0, (st.workT * 0.3) % 1)); P.hy = 0;   // eyes on the winch, a look up at the jib
    return P;
  }
  // Catmull-Rom through keyed points [u, x, y, z] at u (C1: no stop at a key)
  function cr(keys, u, out) {
    const n = keys.length; let i = 0; while (i < n - 2 && u > keys[i + 1][0]) i++;
    const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)], t = clamp((u - k1[0]) / (k2[0] - k1[0]), 0, 1);
    const t2 = t * t, t3 = t2 * t;
    for (let c = 1; c <= 3; c++) {
      const m1 = (k2[c] - k0[c]) / Math.max(1e-6, k2[0] - k0[0]) * (k2[0] - k1[0]), m2 = (k3[c] - k1[c]) / Math.max(1e-6, k3[0] - k1[0]) * (k2[0] - k1[0]);
      out[c - 1] = (2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2;
    }
    return out;
  }
  // a foot's step from a to b over [u0, u1]: planted, then lifted heel first and set down (never dragged)
  function stepFoot(out, a, b, u, u0, u1) {
    const w = clamp((u - u0) / (u1 - u0), 0, 1), e = smooth(0.05, 0.85, w);   // along while it is up; down in place
    out[0] = lerp(a[0], b[0], e); out[2] = lerp(a[2], b[2], e);
    // a step across the cockpit from aft of z 2.2 (by the wheel's pedestal) swings forward of it on the way
    const zf = Math.min(a[2], b[2], 2.1); if (Math.max(a[2], b[2]) > 2.2 && Math.abs(a[0] - b[0]) > 0.4) out[2] = Math.min(out[2], lerp(lerp(a[2], b[2], e), zf, Math.sin(Math.PI * e))); out[1] = lerp(a[1], b[1], e) + 0.12 * Math.sin(Math.PI * w) ** 0.6;
  }
  const MID = [0, 0, 0], HK = [0, 0, 0];
  function crew(sc) {
    const T = TC, heel = P.heel ?? 0, hold = st.hold, b = st.body.crew, w = want.crew;
    let Q;
    if (!st.mv) Q = stationPose(st.at, sc, PA);
    else {
      const mv = st.mv, u = mv.u, A = stationPose(mv.a, sc, PA), Bp = stationPose(mv.b, sc, PB), sA = mv.a.s, sB = mv.b.s, dk = st.duck;
      Q = PA;   // blended in place over A's
      if (mv.cross) {
        // the scramble: up off the seat, low over the centreline under the boom with the weight leading, down onto the new seat
        const zA = A.hip[2], zB = Bp.hip[2];
        const zM = Math.min(zA, zB);   // over the centreline forward of the wheel (from or to the winch: forward first, then across)
        cr([[0, ...A.hip], [0.18, sA * 0.76, D.seat + 0.07, lerp(zA, zM, 0.7)], [0.5, sB * 0.05, D.sole + 0.6, zM], [0.8, sB * 0.74, D.seat + 0.08, lerp(zM, zB, 0.6)], [1, ...Bp.hip]], u, HK);
        HK[1] -= 0.06 * Math.max(dk, hold);
        // facing: the short way, or through the bow when the turn is a half turn (seat to seat)
        let d = wrap(Bp.a - A.a); if (Math.abs(d) > 0.9 * Math.PI) d = 2 * wrap(-Math.PI / 2 - A.a);
        const a = A.a + d * smooth(0.15, 0.85, u), fwd = fwdOf(a);
        let df = wrap(Bp.fa - A.fa); if (Math.abs(df) > 0.9 * Math.PI) df = 2 * wrap(-Math.PI / 2 - A.fa);
        const fa = A.fa + df * smooth(0.15, 0.85, u);
        // the feet: the lead foot over the centreline, the trail through behind it to its new place, the lead home
        const lead = sB > 0 ? 1 : 0; MID[0] = sB * 0.12; MID[1] = D.sole + 0.085 * sc; MID[2] = Math.min(A.feet[lead][2], Bp.feet[lead][2], 2.1) - 0.1;
        const fl = [0, 0, 0], ft = [0, 0, 0];
        if (u < 0.4) stepFoot(fl, A.feet[lead], MID, u, 0.14, 0.40); else stepFoot(fl, MID, Bp.feet[lead], u, 0.68, 0.86);
        stepFoot(ft, A.feet[1 - lead], Bp.feet[1 - lead], u, 0.40, 0.66);
        // the hands: the trailing hand on a handhold as she rises (the sprayhood's frame from the seat, the seat's edge from the winch), the lead
        // hand to the new seat's edge across the way, then onto the new side's handhold as she sits
        const ready = (side) => [HK[0] + sB * 0.22, HK[1] + 0.14, HK[2] - 0.22 + side * 0.12];   // low by the knees, ahead and toward the new side
        const holdA = mv.a.k === 'rail' ? DODGER(sA) : [sA * 0.92, D.seat + 0.06, 2.22], holdB = mv.b.k === 'rail' ? DODGER(sB) : [WINCH(sB)[0] - sB * 0.05, WINCH(sB)[1] + 0.08, WINCH(sB)[2] - 0.06];   // off the winch: a push on the seat
        const toWinch = mv.b.k === 'winch', seatB = (side) => [sB * (toWinch ? 1.0 : 0.9), toWinch ? 1.36 : D.seat + 0.06, lerp(zA, zB, 0.7) + side * -sB * 0.2];   // the new seat's edge (or, to the winch, over its island)
        for (let h = 0; h < 2; h++) {
          const side = h === 1 ? 1 : -1, isLead = (side > 0) === (sB > 0), r0 = ready(side);
          const keys = isLead
            ? [[0, ...A.hands[h]], [0.16, ...r0], [0.5, ...seatB(side)], [0.62, ...seatB(side)], [0.85, ...holdB], [1, ...Bp.hands[h]]]
            : [[0, ...A.hands[h]], [0.1, ...holdA], [0.3, ...holdA], [0.55, ...r0], [0.82, ...seatB(side)], [1, ...Bp.hands[h]]];
          cr(keys, u, Q.hands[h]);
          if (hold > 0) { const sx = HK[0] !== 0 ? Math.sign(HK[0]) : sB, g = [sx * 0.86, D.seat + 0.04, 2.0 + side * 0.22]; for (let i = 0; i < 3; i++) Q.hands[h][i] = lerp(Q.hands[h][i], g[i], hold); }
          const r = acrossOf(a); Q.poles[h][0] = r[0] * side * 0.6; Q.poles[h][1] = -0.8; Q.poles[h][2] = r[2] * side * 0.6;
        }
        for (let i = 0; i < 3; i++) { Q.hip[i] = HK[i]; Q.feet[lead][i] = fl[i]; Q.feet[1 - lead][i] = ft[i]; }
        Q.a = a; Q.fa = fa;
        const ld = Math.sin(Math.PI * clamp(u * 1.15, 0, 1));
        Q.wa = sB * 0.38 * ld + A.wa * (1 - smooth(0, 0.2, u)) * 0; Q.wf = (20 + 18 * ld + 10 * dk) * DEG; Q.hp = 0.25 * dk; Q.hy = 0;
      } else {
        // a slide along the seat: the hips shuffled over, the feet stepped one then the other, turned to the new place
        const e = smooth(0.08, 0.92, u);
        for (let i = 0; i < 3; i++) Q.hip[i] = lerp(A.hip[i], Bp.hip[i], e);
        Q.hip[1] -= 0.02 * Math.sin(Math.PI * u);   // a shuffle along the seat, not a stand
        const da = wrap(Bp.a - A.a), dfa = wrap(Bp.fa - A.fa); Q.a = A.a + da * e; Q.fa = A.fa + dfa * e;
        const tr = [Bp.hip[0] - A.hip[0], Bp.hip[2] - A.hip[2]], first = (Bp.feet[1][0] - A.feet[1][0]) * tr[0] + (Bp.feet[1][2] - A.feet[1][2]) * tr[1] > (Bp.feet[0][0] - A.feet[0][0]) * tr[0] + (Bp.feet[0][2] - A.feet[0][2]) * tr[1] ? 1 : 0;
        const f1 = [0, 0, 0], f2 = [0, 0, 0];
        stepFoot(f1, A.feet[first], Bp.feet[first], u, 0.04, 0.4); stepFoot(f2, A.feet[1 - first], Bp.feet[1 - first], u, 0.4, 0.76);
        for (let i = 0; i < 3; i++) { Q.feet[first][i] = f1[i]; Q.feet[1 - first][i] = f2[i]; }
        for (let h = 0; h < 2; h++) for (let i = 0; i < 3; i++) { Q.hands[h][i] = lerp(A.hands[h][i], Bp.hands[h][i], smooth(0.2, 0.8, u)) + (i === 1 ? 0.05 * Math.sin(Math.PI * u) : 0); Q.poles[h][i] = lerp(A.poles[h][i], Bp.poles[h][i], e); }
        Q.wa = lerp(A.wa, Bp.wa, e); Q.wf = lerp(A.wf, Bp.wf, e) + 0.12 * Math.sin(Math.PI * u); Q.hp = lerp(A.hp, Bp.hp, e); Q.hy = lerp(A.hy, Bp.hy, e);
      }
    }
    // the targets: the hips on the body's heave spring (the landing's bounce), the chest from the balance, the pelvis a share
    T.hip[0] = Q.hip[0]; T.hip[1] = Q.hip[1] + b.y; T.hip[2] = Q.hip[2];
    const fwd = fwdOf(Q.a); T.across = acrossOf(Q.a); T.footFwd = fwdOf(Q.fa);
    w.a = Q.wa; w.f = Q.wf; w.ha = 0; w.hf = 0;
    const [ra, rf] = relOf(b), crossing = st.mv?.cross ? 1 : 0;
    upOf(ra, rf - breath(st.t, 0.4), T.up); upOf(ra * lerp(BAL.crew.pelvis, 0.5, crossing), rf * lerp(0.3, 0.45, crossing), T.pelvisUp);
    upOf(b.hp - heel, b.ht + M.pitch, T.headUp);
    for (let f = 0; f < 2; f++) { for (let i = 0; i < 3; i++) T.feet[f][i] = Q.feet[f][i]; T.kneePole[f][0] = fwd[0] * 0.8; T.kneePole[f][1] = 0.6; T.kneePole[f][2] = fwd[2] * 0.8; }
    if (!st.mv && st.at.k === 'rail') for (let f = 0; f < 2; f++) { T.kneePole[f][0] = -st.at.s * 0.7; T.kneePole[f][1] = 0.7; T.kneePole[f][2] = 0; }
    for (let h = 0; h < 2; h++) for (let i = 0; i < 3; i++) { T.hands[h][i] = Q.hands[h][i]; T.elbowPole[h][i] = Q.poles[h][i]; }
    T.headLevel = 1; T.headPitch = Q.hp; T.headYaw = Q.hy;
    return T;
  }

  return {
    step,
    targets: (who, sc = 1) => (who === 'helm' ? helm(sc) : crew(sc)),
    get state() { return st; },
    reset() { st.first = true; st.cross = -1; st.hold = 0; st.hike = 0; st.duck = 0; st.firm = 0; st.t = 0; for (const g of st.grips) g.q = -1; for (const b of Object.values(st.body)) b.init = false; },
  };
}

// shown or why not (a string: hidden): the Helm view (its blend past half: the helmsman is the player there, and nobody stands
// in the skipper's face), an eye on board or beside her (any camera within nearM of the hull's origin, nearer than the Boat view's closest zoom of 1.5 hull lengths: no faces up close), too far to read
export function crewShown({ helmK = 0, distM = 0, maxM = 160, nearM = 10 } = {}) {
  if (helmK > 0.5) return 'helm view';
  if (distM < nearM) return 'on board';
  if (distM > maxM) return 'far';
  return '';
}
