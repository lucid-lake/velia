// The player's sloop crewed: a helmsman at the wheel and one crew on the windward side, drawn as the
// kayakers' figure (render/figureRig.js: the torso a frame, the limbs two-bone chains to their targets). This module is the
// choreography only: the boat's drawn state in, each figure's targets out, in the HULL frame (x starboard, y up from the
// waterline, z aft; the frame the wheel, the cockpit and v1's models are built in). Pure: no DOM, no GPU, no randomness, no
// allocation per step after creation; the same inputs give the same pose (tests/boat-crew.test.mjs).
//
// The helmsman stands behind the wheel, feet apart on the sole, his hands on the rim where the wheel's own turn carries them
// (render/boat.js turns the wheel 4 x the rudder): a hand that has followed the rim too far lets go and takes a new grip,
// one hand at a time (hand over hand). He leans into the heel (the torso held nearer the world's up than the boat's, the hips
// to windward, the feet wider) and looks ahead, glancing up at the sails now and then.
// The crew sits on the windward cockpit seat facing inboard, feet on the sole. Past ~12-22° of heel the crew leans out over the
// coaming (an outboard hand on its top). When the boom crosses (a tack or a gybe) the crew rises, ducks under the boom while
// it swings (the duck follows the drawn boom's own angle), crosses the sole with stepped feet and sits on the new windward
// side. In a knockdown or a sudden heel (Tessie's strike) both hold on (the crew to the coaming, the helmsman to the wheel),
// ride with the boat (held to its frame, not the world's up) and come up with her.
//   const C = createBoatCrew()
//   C.step(dt, { heel, pitch, boom, rudder })     once a frame on the boat's clock (boom: the drawn boom, rad; + to starboard)
//   C.targets('helm' | 'crew', sc) → the figure rig's targets T (render/figureRig.js), reused
//   C.state → { side, cross, hold, hike, duck, grips }
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
// the choreography's numbers: the helmsman's stand, the crew's seat, the cross's time (s on the boat's clock), the hold's
// triggers (heel deg, heel rate deg/s), the hike's band (windward heel deg), the boom angle that says which side is windward
export const CREW = Object.freeze({
  helm: Object.freeze({ z: 2.94, feetX: 0.2, hipY: 0.88, leanDeg: 16, worldUp: 0.75, glanceS: 9, glance: Object.freeze([6.4, 8.2]), glanceDeg: 24,
    grip: Object.freeze([118, 62]), regripDeg: 40, regripTo: 18, slipDeg: 52, regripS: 0.32 }),
  crew: Object.freeze({ z: 2.0, hipX: 1.02, hipY: 0.1, footX: 0.52, footDz: 0.13, worldUp: 0.5, backDeg: 8, hikeDeg: Object.freeze([12, 22]), hikeLeanDeg: 38 }),
  crossS: 3.0, settleS: 1.5, sideDeg: 4, holdHeelDeg: 30, holdRateDeg: 30, holdRateMinDeg: 12, holdIn: 0.25, holdOut: 1.4, duckDeg: Object.freeze([12, 28]),
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// the world's up seen in the HULL frame (Boat.update: Ry(-heading) · Rx(pitch) · Rz(-heel)): (Rx Rz)ᵀ ŷ
export function worldUpInHull(heel, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [-cp * Math.sin(heel), cp * Math.cos(heel), -sp];
}
// a point on the wheel's rim at angle a (rad, from +x toward +y; the wheel's own turn is in a)
export const rimPoint = (a, r = HALCYON.wheel.r, W = HALCYON.wheel.at) => [W[0] + Math.cos(a) * r, W[1] + Math.sin(a) * r, W[2]];
// the boom's axis at `along` m from the gooseneck (HULL frame; boomPoint's, + the mast step)
export const boomAxis = (boom, along, B = HALCYON.boom) => [B.pin[0] + Math.sin(boom) * along, B.pin[1], B.pin[2] + Math.cos(boom) * along];

export function createBoatCrew({ C = CREW, D = HALCYON } = {}) {
  const st = { side: 0, cross: -1, from: 0, hold: 0, hike: 0, duck: 0, grips: [{ off: 0, q: -1, from: 0, to: 0 }, { off: 0, q: -1, from: 0, to: 0 }], t: 0, heel: 0, rate: 0, wheel: 0, first: true };
  let P = { heel: 0, pitch: 0, boom: 0, rudder: 0 };
  const TH = { hip: [0, 0, 0], up: [0, 1, 0], across: [1, 0, 0], hands: [[0, 0, 0], [0, 0, 0]], elbowPole: [[-0.7, -0.7, 0.3], [0.7, -0.7, 0.3]], feet: [[0, 0, 0], [0, 0, 0]], kneePole: [[0, 0.5, -1], [0, 0.5, -1]], headLevel: 0.85, armReach: 1, armMax: 1.25, footTurn: 0.14, footFwd: null, headPitch: 0, headYaw: 0 };
  const TC = { hip: [0, 0, 0], up: [0, 1, 0], across: [0, 0, 1], hands: [[0, 0, 0], [0, 0, 0]], elbowPole: [[0, -1, 0], [0, -1, 0]], feet: [[0, 0, 0], [0, 0, 0]], kneePole: [[0, 1, 0], [0, 1, 0]], headLevel: 0.7, armReach: 1, armMax: 1.25, footTurn: 0.1, footFwd: [1, 0, 0], headPitch: 0, headYaw: 0 };

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
    if (dt > 0) { const r = (heel - st.heel) / dt; st.rate += (r - st.rate) * Math.min(1, dt / 0.1); } st.heel = heel;   // the roll rate, a frame's noise smoothed
    // the hold: a knockdown's heel or a sudden roll (a strike) past holdRateMinDeg grips both at once; it lets go slowly once she is up
    const want = Math.abs(heel) > C.holdHeelDeg * DEG || (Math.abs(st.rate) > C.holdRateDeg * DEG && Math.abs(heel) > C.holdRateMinDeg * DEG) ? 1 : 0;
    st.hold = want > st.hold ? Math.min(1, st.hold + dt / C.holdIn) : Math.max(0, st.hold - dt / C.holdOut);
    // windward: the side away from the boom (a boom near the centreline keeps the last side)
    const windward = boom > C.sideDeg * DEG ? -1 : boom < -C.sideDeg * DEG ? 1 : st.side;
    if (st.t < C.settleS) st.side = windward;   // the first seconds (a start, a capture's settle): already on the right side, no cross
    else if (st.cross < 0 && windward !== st.side && st.hold < 0.5) { st.cross = 0; st.from = st.side; }
    if (st.cross >= 0) {
      st.cross += dt / C.crossS;
      if (st.cross >= 1) { st.cross = -1; st.side = -st.from; }
    }
    // the hike: the crew's own side up past the band (its windward heel), eased like a body moving (0.8 s)
    const up = -st.side * heel / DEG, hk = st.cross < 0 ? smooth(C.crew.hikeDeg[0], C.crew.hikeDeg[1], up) : 0;
    st.hike = st.t < C.settleS ? hk : st.hike + (hk - st.hike) * Math.min(1, dt / 0.8);
    // the duck: while crossing, as low as the boom is near the centreline (its real swing overhead)
    // (and rising off the seat: the boom has just swung over the seat as the cross begins)
    const dk = st.cross >= 0 ? Math.max(1 - smooth(C.duckDeg[0] * DEG, C.duckDeg[1] * DEG, Math.abs(boom)), 1 - smooth(0.15, 0.45, st.cross)) : 0;
    st.duck += (dk - st.duck) * Math.min(1, dt / 0.12);
    // the helmsman's hands: each follows the rim; one past regripDeg from its home lets go and grips again regripTo short of home
    // (the other hand holding meanwhile); the move takes regripS
    const H = C.helm;
    for (let h = 0; h < 2; h++) {
      const g = st.grips[h], o = st.grips[1 - h];
      if (g.q >= 0) { g.q += dt / H.regripS; if (g.q >= 1) { g.q = -1; g.off = g.to; } continue; }
      const a = st.wheel + g.off, home = H.grip[h] * DEG, dev = a - home;
      if (Math.abs(dev) > H.regripDeg * DEG && o.q < 0) { g.q = 0; g.from = a; g.to = home - Math.sign(dev) * H.regripTo * DEG - st.wheel; }
      else if (Math.abs(dev) > H.slipDeg * DEG) g.off = home + Math.sign(dev) * H.slipDeg * DEG - st.wheel;   // the rim slips through the hand (the other is regripping)
    }
  }

  // the helmsman: standing behind the wheel
  function helm(sc) {
    const H = C.helm, T = TH, heel = P.heel ?? 0, wu = worldUpInHull(heel, P.pitch ?? 0), hold = st.hold;
    const hk = smooth(3 * DEG, 20 * DEG, Math.abs(heel)), ws = heel > 0 ? -1 : 1;   // the brace: his hips to windward, the feet wider
    const crouch = 0.08 * hold;
    T.hip[0] = ws * 0.12 * hk; T.hip[1] = D.sole + H.hipY - crouch - 0.03 * hk; T.hip[2] = H.z;
    // the torso: nearer the world's up (less so holding on: he rides with her), leaning toward the wheel
    const k = lerp(H.worldUp, 0.2, hold), lean = Math.tan((H.leanDeg + 10 * hold) * DEG);
    T.up = unit([lerp(0, wu[0], k), lerp(1, wu[1], k), lerp(0, wu[2], k) - lean]);
    T.across = [1, 0, 0];
    for (let f = 0; f < 2; f++) {
      const sg = f === 0 ? -1 : 1;
      T.feet[f][0] = sg * (H.feetX + 0.07 * hk) + ws * 0.04 * hk; T.feet[f][1] = D.sole + 0.085 * sc; T.feet[f][2] = H.z + 0.02;
      T.kneePole[f][0] = sg * 0.25; T.kneePole[f][1] = 0.3; T.kneePole[f][2] = -1;
    }
    // the hands on the rim (the wrist a little aft of it and outside, as a hand wraps the rim), a regrip lifted off it
    for (let h = 0; h < 2; h++) {
      const g = st.grips[h];
      let a, lift = 0;
      if (g.q >= 0) { const e = smooth(0, 1, g.q); a = lerp(g.from, st.wheel + g.to, e); lift = Math.sin(Math.PI * g.q); }
      else a = st.wheel + g.off;
      const p = rimPoint(a, D.wheel.r + 0.03);
      T.hands[h][0] = p[0]; T.hands[h][1] = p[1] + 0.02 * lift; T.hands[h][2] = p[2] + 0.07 + 0.07 * lift;
      const sg = h === 0 ? -1 : 1; T.elbowPole[h][0] = sg * 0.7; T.elbowPole[h][1] = -0.7; T.elbowPole[h][2] = 0.3;
    }
    // the head: level, ahead; a glance up at the sails every glanceS (not while holding on)
    const ph = st.t % H.glanceS, gl = smooth(H.glance[0], H.glance[0] + 0.5, ph) * (1 - smooth(H.glance[1] - 0.5, H.glance[1], ph));
    T.headLevel = 0.9; T.headPitch = H.glanceDeg * DEG * gl * (1 - hold); T.headYaw = 0;
    T.armReach = 1; return T;
  }

  // the crew: seated on side s facing inboard; crossing to the other side; leaning out; holding on
  const seatHip = (s, out) => { out[0] = s * C.crew.hipX; out[1] = D.seat + C.crew.hipY; out[2] = C.crew.z; return out; };
  const seatFoot = (s, f, sc, out) => {   // f 0 left, 1 right; facing inboard (−s x), the figure's right is (0, 0, −s)
    const right = -s, dz = (f === 1 ? 1 : -1) * right * C.crew.footDz;
    out[0] = s * C.crew.footX; out[1] = D.sole + 0.085 * sc; out[2] = C.crew.z + dz; return out;
  };
  const HIP0 = [0, 0, 0], HIP1 = [0, 0, 0], F0 = [0, 0, 0], F1 = [0, 0, 0];
  // the feet's side-steps across the sole: [lead (1) or trail (0), u0, u1, x from, x to] as a share of the seat's foot x (+1 the side
  // left, −1 arriving): the lead foot (the one on the way: the right going to starboard) steps out, the trail closes; never both up
  const STEPS = [[1, 0.10, 0.28, 1, 0.0], [0, 0.28, 0.44, 1, 0.3], [1, 0.44, 0.60, 0.0, -1], [0, 0.60, 0.78, 0.3, -1]];
  function crew(sc) {
    const K = C.crew, T = TC, heel = P.heel ?? 0, wu = worldUpInHull(heel, P.pitch ?? 0), hold = st.hold;
    if (st.cross < 0) {
      const s = st.side, hk = st.hike;
      seatHip(s, T.hip); T.hip[0] += s * 0.12 * hk; T.hip[1] += 0.04 * hk - 0.04 * hold;
      const fwd = [-s, 0, 0];   // facing inboard
      T.across = [0, 0, -s]; T.footFwd = fwd;
      // the torso: nearer the world's up, leaning back on the coaming; leaning out over it with the hike; hunched holding on
      const k = lerp(K.worldUp, 0.1, hold), back = Math.tan((K.backDeg + K.hikeLeanDeg * hk) * DEG) * (1 - hold) - 0.25 * hold;
      T.up = unit([lerp(0, wu[0], k) + s * back, lerp(1, wu[1], k), lerp(0, wu[2], k)]);
      for (let f = 0; f < 2; f++) { seatFoot(s, f, sc, T.feet[f]); T.feet[f][0] += s * 0.1 * hk; T.kneePole[f][0] = -s * 0.7; T.kneePole[f][1] = 0.7; T.kneePole[f][2] = 0; }
      // the hands: on the thighs; the outboard (aft) hand on the coaming's top in the hike; both on it holding on
      for (let h = 0; h < 2; h++) {
        const right = (h === 1 ? 1 : -1) * -s;   // this hand's side along z (the figure's right is −s z)
        const thigh = [T.hip[0] - s * 0.3, T.hip[1] + 0.07, T.hip[2] + right * 0.16];
        const aft = right > 0, grip = [s * (D.coamingX[0] + 0.05), D.coamingTop + 0.05, K.z + (aft ? 0.3 : -0.3)];
        const g = hold > 0 ? hold : (aft ? hk : 0);
        for (let i = 0; i < 3; i++) T.hands[h][i] = lerp(thigh[i], grip[i], g);
        T.elbowPole[h][0] = s * 0.3; T.elbowPole[h][1] = -0.8; T.elbowPole[h][2] = right * 0.6;
      }
      T.headLevel = 0.75; T.headPitch = 0.08; T.headYaw = s * 0.9 * (1 - hold);   // looking forward (toward the bow), at the sails
      return T;
    }
    // crossing: from s0 to s1 = −s0 under the boom; u the share done
    const u = st.cross, s0 = st.from, s1 = -s0, dk = st.duck;
    // the hips: off the seat inboard (u 0.18), low over the centreline (0.5), down to the other seat (1)
    seatHip(s0, HIP0); seatHip(s1, HIP1);
    const keys = [[0, HIP0[0], HIP0[1]], [0.2, s0 * 0.72, D.seat + 0.12], [0.5, 0, D.sole + 0.66], [0.8, s1 * 0.72, D.seat + 0.12], [1, HIP1[0], HIP1[1]]];
    let i = 0; while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], e = smooth(a[0], b[0], u);
    T.hip[0] = lerp(a[1], b[1], e); T.hip[1] = lerp(a[2], b[2], e) - 0.1 * Math.max(dk, hold); T.hip[2] = K.z;
    // facing: inboard on s0 → forward → inboard on s1 (about the up, the short way round through the bow)
    const al = (s0 > 0 ? Math.PI : 0) + s0 * Math.PI * smooth(0.1, 0.9, u), fwd = [Math.cos(al), 0, Math.sin(al)];
    T.across = [-Math.sin(al), 0, Math.cos(al)]; T.footFwd = fwd;
    // the torso: leaning into the move and lower in the duck
    const lean = Math.tan((8 + 22 * Math.sin(Math.PI * u) + 16 * dk) * DEG), k = K.worldUp;
    T.up = unit([lerp(0, wu[0], k) + fwd[0] * lean, lerp(1, wu[1], k), lerp(0, wu[2], k) + fwd[2] * lean]);
    // the feet: planted, then lifted in an arc in their own windows (never dragged along the sole)
    for (let f = 0; f < 2; f++) {
      seatFoot(s0, f, sc, F0); seatFoot(s1, f, sc, F1);
      let x = F0[0], z = F0[2], y = F0[1];
      const lead = s1 > 0 ? 1 : 0;   // the figure faces forward mid-way: its right is to starboard
      for (const [ld, u0, u1, xa, xb] of STEPS) {
        if ((ld ? lead : 1 - lead) !== f || u < u0) continue;
        const w = clamp((u - u0) / (u1 - u0), 0, 1), ew = smooth(0, 1, w);
        const zm = (F0[2] + F1[2]) / 2;   // the first step to the middle of the two seats' footholds, the second to the new one
        x = s0 * K.footX * lerp(xa, xb, ew); z = u0 < 0.5 ? lerp(F0[2], zm, ew) : lerp(zm, F1[2], ew);
        y = F0[1] + 0.1 * Math.sin(Math.PI * w) ** 0.6;   // the heel up first, then the foot along
      }
      T.feet[f][0] = x; T.feet[f][1] = y; T.feet[f][2] = z;
      T.kneePole[f][0] = fwd[0] * 0.8; T.kneePole[f][1] = 0.6; T.kneePole[f][2] = fwd[2] * 0.8;
    }
    // the hands: a push off the seat behind, out in front through the crossing (ready), down to the new seat to sit
    for (let h = 0; h < 2; h++) {
      const side = h === 1 ? 1 : -1, r = T.across;
      const ready = [T.hip[0] + fwd[0] * 0.32 + r[0] * side * 0.2, T.hip[1] + 0.12, T.hip[2] + fwd[2] * 0.32 + r[2] * side * 0.2];
      const seatA = [s0 * 1.0, D.seat + 0.08, K.z + side * -s0 * 0.24], seatB = [s1 * 1.0, D.seat + 0.08, K.z + side * -s1 * 0.24];
      const g0 = 1 - smooth(0.05, 0.3, u), g1 = smooth(0.7, 0.95, u);
      for (let q = 0; q < 3; q++) T.hands[h][q] = ready[q] * (1 - g0 - g1) + seatA[q] * g0 + seatB[q] * g1;
      if (hold > 0) {   // caught mid-cockpit by a knockdown: both hands to the nearer seat's edge
        const sx = T.hip[0] !== 0 ? Math.sign(T.hip[0]) : s1, grip = [sx * 0.86, D.seat + 0.04, K.z + side * 0.22];
        for (let q = 0; q < 3; q++) T.hands[h][q] = lerp(T.hands[h][q], grip[q], hold);
      }
      T.elbowPole[h][0] = r[0] * side * 0.6; T.elbowPole[h][1] = -0.8; T.elbowPole[h][2] = r[2] * side * 0.6;
    }
    T.headLevel = 0.85 - 0.25 * dk; T.headPitch = 0; T.headYaw = 0;
    return T;
  }

  return {
    step,
    targets: (who, sc = 1) => (who === 'helm' ? helm(sc) : crew(sc)),
    get state() { return st; },
    reset() { st.first = true; st.cross = -1; st.hold = 0; st.hike = 0; st.duck = 0; st.t = 0; for (const g of st.grips) g.q = -1; },
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
