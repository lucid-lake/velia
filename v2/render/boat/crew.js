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
  crossS: 2.4, settleS: 1.5, sideDeg: 4, holdHeelDeg: 30, holdRateDeg: 30, holdRateMinDeg: 12, holdIn: 0.25, holdOut: 1.4, duckDeg: Object.freeze([12, 28]),
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
  const st = { side: 0, cross: -1, from: 0, hold: 0, hike: 0, duck: 0, firm: 0, grips: [{ off: 0, q: -1, from: 0, to: 0 }, { off: 0, q: -1, from: 0, to: 0 }], t: 0, heel: 0, rate: 0, wheel: 0, first: true,
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
    if (st.t < C.settleS) st.side = windward;   // the first seconds (a start, a capture's settle): already on the right side, no cross
    else if (st.cross < 0 && windward !== st.side && st.hold < 0.5) { st.cross = 0; st.from = st.side; }
    if (st.cross >= 0) {
      st.cross += dt / C.crossS;
      if (st.cross >= 1) { st.cross = -1; st.side = -st.from; st.body.crew.yV -= 0.45; }   // down onto the seat: the landing's bounce
    }
    // the hike: the crew's own side up past the band (its windward heel), eased like a body moving (0.8 s)
    const up = -st.side * heel / DEG, hk = st.cross < 0 ? smooth(C.crew.hikeDeg[0], C.crew.hikeDeg[1], up) : 0;
    st.hike = st.t < C.settleS ? hk : st.hike + (hk - st.hike) * Math.min(1, dt / 0.8);
    // the duck: while crossing, as low as the boom is near the centreline (its real swing overhead), and low off the seat
    const dk = st.cross >= 0 ? Math.max(1 - smooth(C.duckDeg[0] * DEG, C.duckDeg[1] * DEG, Math.abs(boom)), 1 - smooth(0.2, 0.6, st.cross)) : 0;
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

  // the crew: seated on side s facing inboard; crossing to the other side; leaning out; holding on
  const seatHip = (s, out) => { out[0] = s * C.crew.hipX; out[1] = D.seat + C.crew.hipY; out[2] = C.crew.z; return out; };
  const seatFoot = (s, f, sc, out) => {   // f 0 left, 1 right; facing inboard (−s x), the figure's right is (0, 0, −s)
    const right = -s, dz = (f === 1 ? 1 : -1) * right * C.crew.footDz;
    out[0] = s * C.crew.footX; out[1] = D.sole + 0.085 * sc; out[2] = C.crew.z + dz; return out;
  };
  const HIP0 = [0, 0, 0], HIP1 = [0, 0, 0], F0 = [0, 0, 0], F1 = [0, 0, 0];
  // the scramble's two long steps and a settle: [lead (1) or trail (0), u0, u1, x from, x to] as a share of the seat's foot x
  // (+1 the side left, −1 arriving): the lead foot reaches over the centreline, the trail drives through behind it to the new
  // seat's foothold, the lead settles beside it; never both feet up
  const STEPS = [[1, 0.14, 0.40, 1, -0.2], [0, 0.40, 0.66, 1, -1], [1, 0.68, 0.86, -0.2, -1]];
  function crew(sc) {
    const K = C.crew, T = TC, heel = P.heel ?? 0, hold = st.hold, b = st.body.crew, w = want.crew;
    if (st.cross < 0) {
      const s = st.side, hk = st.hike;
      // hips on the seat (they ride it), sliding out with the hike, pulled in to the coaming holding on (harder as she rolls)
      const pull = hold * (0.6 + 0.4 * smooth(0, 25 * DEG, Math.abs(st.rate)));
      seatHip(s, T.hip); T.hip[0] += s * (0.12 * hk + 0.07 * pull); T.hip[1] += 0.04 * hk - 0.03 * pull + b.y;
      const fwd = [-s, 0, 0];   // facing inboard
      T.across = [0, 0, -s]; T.footFwd = fwd;
      // what she wants: leaning back on the coaming, out over it with the hike, hunched forward toward the grip holding on; a weight
      // shift now and then; the head toward the bow, glancing up at the sails (or under the boom)
      const ws = shift(st.t, 5.9, 0.7);
      w.a = s * ((K.backDeg + K.hikeLeanDeg * hk) * DEG * (1 - pull) + 0.03 * ws) + s * 0.12 * pull;
      w.f = 0.05 * ws + 0.32 * pull;
      const gp = (st.t + 3.1) % 11, gl = IDLE * smooth(8.4, 9.0, gp) * (1 - smooth(10.0, 10.6, gp));
      w.ha = 0; w.hf = 0;
      const [ra, rf] = relOf(b);
      upOf(ra, rf - breath(st.t, 0.4), T.up); upOf(ra * BAL.crew.pelvis, rf * 0.3, T.pelvisUp);
      upOf(b.hp - heel, b.ht + M.pitch, T.headUp);
      for (let f = 0; f < 2; f++) { seatFoot(s, f, sc, T.feet[f]); T.feet[f][0] += s * 0.1 * hk; T.kneePole[f][0] = -s * 0.7; T.kneePole[f][1] = 0.7; T.kneePole[f][2] = 0; }
      // the hands: on the thighs; the outboard (aft) hand on the coaming's top in the hike; both on it holding on, the elbows bent
      // (the grip drawn in toward the chest, the elbows out)
      for (let h = 0; h < 2; h++) {
        const right = (h === 1 ? 1 : -1) * -s;   // this hand's side along z (the figure's right is −s z)
        const thigh = [T.hip[0] - s * 0.3, T.hip[1] + 0.07, T.hip[2] + right * 0.16];
        const aft = right > 0, grip = [s * (D.coamingX[0] + 0.06), D.coamingTop + 0.09, K.z + (aft ? 0.24 : -0.24) * (1 - 0.3 * pull)];
        const g = hold > 0 ? hold : (aft ? hk : 0);
        for (let i = 0; i < 3; i++) T.hands[h][i] = lerp(thigh[i], grip[i], g);
        T.elbowPole[h][0] = s * (0.3 - 0.5 * pull); T.elbowPole[h][1] = -0.8 + 0.5 * pull; T.elbowPole[h][2] = right * (0.6 + 0.6 * pull);
      }
      T.headLevel = 1; T.headPitch = 0.08 + 0.35 * gl * (1 - hold); T.headYaw = s * (0.9 - 0.4 * gl) * (1 - hold);
      return T;
    }
    // crossing: from s0 to s1 = −s0 under the boom; u the share done
    const u = st.cross, s0 = st.from, s1 = -s0, dk = st.duck;
    // the hips: up off the seat and inboard, low over the centreline under the boom, down to the other seat (the landing's bounce
    // is the body's own spring, set off as she lands)
    seatHip(s0, HIP0); seatHip(s1, HIP1);
    const keys = [[0, HIP0[0], HIP0[1]], [0.18, s0 * 0.78, D.seat + 0.06], [0.5, s1 * 0.05, D.sole + 0.6], [0.8, s1 * 0.74, D.seat + 0.08], [1, HIP1[0], HIP1[1]]];
    let i = 0; while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const a = keys[i], bk = keys[i + 1], e = smooth(a[0], bk[0], u);
    T.hip[0] = lerp(a[1], bk[1], e); T.hip[1] = lerp(a[2], bk[2], e) - 0.06 * Math.max(dk, hold) + b.y; T.hip[2] = K.z;
    // facing: inboard on s0 → forward → inboard on s1 (about the up, the short way round through the bow), turned mostly mid-way
    const al = (s0 > 0 ? Math.PI : 0) + s0 * Math.PI * smooth(0.15, 0.85, u), fwd = [Math.cos(al), 0, Math.sin(al)];
    T.across = [-Math.sin(al), 0, Math.cos(al)]; T.footFwd = fwd;
    // what she wants: pitched forward low under the boom, the weight leading toward the new side
    const lead = Math.sin(Math.PI * clamp(u * 1.15, 0, 1));
    w.a = s1 * 0.38 * lead; w.f = (20 + 18 * lead + 10 * dk) * DEG; w.ha = 0; w.hf = 0;
    const [ra, rf] = relOf(b);
    upOf(ra, rf, T.up); upOf(ra * 0.5, rf * 0.45, T.pelvisUp); upOf(b.hp - heel, b.ht + M.pitch, T.headUp);
    // the feet: planted, then lifted in an arc in their own windows (never dragged along the sole)
    for (let f = 0; f < 2; f++) {
      seatFoot(s0, f, sc, F0); seatFoot(s1, f, sc, F1);
      let x = F0[0], z = F0[2], y = F0[1];
      const leadF = s1 > 0 ? 1 : 0;   // the figure faces forward mid-way: its right is to starboard
      const isLead = f === leadF;
      for (const [ld, u0, u1, xa, xb] of STEPS) {
        if ((ld ? leadF : 1 - leadF) !== f || u < u0) continue;
        const ww = clamp((u - u0) / (u1 - u0), 0, 1), ew = smooth(0, 1, ww);
        // the lead foot's first step to the middle of the footholds (forward of the trail's line), the trail behind it, then home
        const zm = (F0[2] + F1[2]) / 2 + (isLead ? -0.1 : 0.12);
        const zFrom = u0 < 0.2 ? F0[2] : (isLead ? zm : F0[2]), zTo = u1 > 0.8 || !isLead ? F1[2] : zm;
        x = s0 * K.footX * lerp(xa, xb, ew); z = lerp(zFrom, zTo, ew);
        y = F0[1] + 0.12 * Math.sin(Math.PI * ww) ** 0.6;   // the heel up first, then the foot along
      }
      T.feet[f][0] = x; T.feet[f][1] = y; T.feet[f][2] = z;
      T.kneePole[f][0] = fwd[0] * 0.8; T.kneePole[f][1] = 0.6; T.kneePole[f][2] = fwd[2] * 0.8;
    }
    // the hands: the trailing hand pushes off the old seat's edge, the lead hand reaches for the new seat's edge and takes the
    // weight there until she sits (by the coaming); between, they stay low by the knees, ready
    for (let h = 0; h < 2; h++) {
      const side = h === 1 ? 1 : -1, r = T.across;
      const ready = [T.hip[0] + fwd[0] * 0.34 + r[0] * side * 0.18, T.hip[1] + 0.08, T.hip[2] + fwd[2] * 0.34 + r[2] * side * 0.18];
      const handLead = (side > 0) === (s1 > 0);   // the right hand leads going to starboard
      const pushA = [s0 * 0.9, D.seat + 0.06, K.z + side * -s0 * 0.22], reachB = [s1 * 0.9, D.seat + 0.06, K.z + side * -s1 * 0.22];
      const g0 = handLead ? 1 - smooth(0.05, 0.22, u) : 1 - smooth(0.32, 0.5, u);
      const g1 = handLead ? smooth(0.42, 0.6, u) : smooth(0.72, 0.92, u);
      for (let q = 0; q < 3; q++) T.hands[h][q] = ready[q] * Math.max(0, 1 - g0 - g1) + pushA[q] * g0 + reachB[q] * g1;
      if (hold > 0) {   // caught mid-cockpit by a knockdown: both hands to the nearer seat's edge
        const sx = T.hip[0] !== 0 ? Math.sign(T.hip[0]) : s1, grip = [sx * 0.86, D.seat + 0.04, K.z + side * 0.22];
        for (let q = 0; q < 3; q++) T.hands[h][q] = lerp(T.hands[h][q], grip[q], hold);
      }
      T.elbowPole[h][0] = r[0] * side * 0.6; T.elbowPole[h][1] = -0.8; T.elbowPole[h][2] = r[2] * side * 0.6;
    }
    T.headLevel = 1; T.headPitch = 0.25 * dk; T.headYaw = 0;   // the chin up a little under the boom: watching it go over
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
