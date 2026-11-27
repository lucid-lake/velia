// A person on any craft, posed from a few target joints (the kayakers' own figure: the UBC paddler baked in render/kayak/asset.js, drawn on
// the kayaks' skin pipeline). The kayak strokes are baked clips; a paddleboarder standing, a runabout's skipper at the wheel or a jet
// ski's rider on the bars are not, so their bones are set here from the craft's own pose (v2/sim/supPose.js, render/smallCraftMesh.js):
// the torso a rigid frame (the hips' place, the spine's up, the shoulders' across), each arm and leg a two-bone chain solved on the
// figure's own bone lengths toward the hand's and the ankle's targets (the elbow and the knee toward their poles), the feet flat on
// the deck, the head held nearer level than the spine, the fingers in the baked grip (each finger's turn about the hand from the
// clips' rest pose). Pure: no DOM, no GPU, no allocation per call after creation.
// Frames: the palette maps the figure's bind frame (a T-pose, toes to +z, its left at +x) into the craft frame (x starboard, y up,
// z aft: the figure faces -z by default); the craft's own rows take it to the world (the kayaks' writeInst).
//   const rig = createFigureRig(json, clips)       (json: the asset's json; clips: render/kayak's createClips, for the grip and scale)
//   rig.pose(sex, T, out, o)  → out[o …]: SLOTS × 12 floats (three rows a slot); T:
//     hip [x, y, z]       the pelvis joint's place           up [x, y, z], across [x, y, z]  the spine's way up, the shoulders' (to her right)
//     hands [[l], [r]]    each wrist's target                elbowPole [[l], [r]]  the way each elbow points
//     feet [[l], [r]]     each ankle's target                kneePole [[l], [r]]   the way each knee points
//     headLevel (0–1)     how far the head is held level (1: its up is the world's)      armReach (≥ 1) the arm bones' stretch along themselves
//                         (more, up to armMax, where a wrist's target is beyond it)
//     footTurn            each foot's turn out (rad, about the deck's up)
//   rig.joints(sex) → the bind joints (the tests)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// an orthonormal frame [d, h, d × h] (columns) from a direction and a hint (h made perpendicular to d)
function frame(d, hint) {
  const x = unit(d); let h = sub(hint, scl(x, dot(hint, x)));
  if (len(h) < 1e-6) h = Math.abs(x[1]) < 0.9 ? crs(x, [0, 1, 0]) : crs(x, [1, 0, 0]);
  const y = unit(h); return [x, y, crs(x, y)];
}
// R = Fp · Fbᵀ (both frames as three column vectors): the turn taking Fb onto Fp, as a row-major 3 × 3
function turn(Fp, Fb) {
  const R = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = Fp[0][r] * Fb[0][c] + Fp[1][r] * Fb[1][c] + Fp[2][r] * Fb[2][c];
  return R;
}
const mulM = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
// a slot's rows: p → s · R · K · (p − J) + P, with K a stretch along the bind direction d by k (k 1: none)
function put(out, o, R, s, J, P, d = null, k = 1) {
  let M = R;
  if (d && k !== 1) {   // R · (I + (k − 1) d dᵀ)
    M = new Array(9);
    for (let r = 0; r < 3; r++) { const rd = R[r * 3] * d[0] + R[r * 3 + 1] * d[1] + R[r * 3 + 2] * d[2]; for (let c = 0; c < 3; c++) M[r * 3 + c] = R[r * 3 + c] + (k - 1) * rd * d[c]; }
  }
  for (let r = 0; r < 3; r++) {
    const m0 = M[r * 3] * s, m1 = M[r * 3 + 1] * s, m2 = M[r * 3 + 2] * s;
    out[o + r * 4] = m0; out[o + r * 4 + 1] = m1; out[o + r * 4 + 2] = m2;
    out[o + r * 4 + 3] = P[r] - (m0 * J[0] + m1 * J[1] + m2 * J[2]);
  }
}
// the general inverse of a 3 × 4 affine (rows) and the product A · B, both rows
function inv34(A) {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = A;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g), k = 1 / (det || 1e-12);
  const m = [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k, (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k, (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k];
  return [m[0], m[1], m[2], -(m[0] * tx + m[1] * ty + m[2] * tz), m[3], m[4], m[5], -(m[3] * tx + m[4] * ty + m[5] * tz), m[6], m[7], m[8], -(m[6] * tx + m[7] * ty + m[8] * tz)];
}
function mul34(A, B, out, o) {
  for (let r = 0; r < 3; r++) {
    const a0 = A[r * 4], a1 = A[r * 4 + 1], a2 = A[r * 4 + 2], a3 = A[r * 4 + 3];
    out[o + r * 4] = a0 * B[0] + a1 * B[4] + a2 * B[8]; out[o + r * 4 + 1] = a0 * B[1] + a1 * B[5] + a2 * B[9];
    out[o + r * 4 + 2] = a0 * B[2] + a1 * B[6] + a2 * B[10]; out[o + r * 4 + 3] = a0 * B[3] + a1 * B[7] + a2 * B[11] + a3;
  }
}
// two bones from root toward target (lengths l1, l2), the middle joint toward the pole: { mid, end, n, p } (n root → target, p the pole ⟂ n)
function chain(root, target, l1, l2, pole) {
  const t = sub(target, root), D = len(t) || 1e-6, n = scl(t, 1 / D);
  const d = Math.min(Math.max(D, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub(pole, scl(n, dot(pole, n))); if (len(p) < 1e-6) p = Math.abs(n[1]) < 0.9 ? crs(n, [0, 1, 0]) : crs(n, [1, 0, 0]);
  p = unit(p);
  return { mid: add(root, add(scl(n, a), scl(p, h))), end: add(root, scl(n, d)), n, p };
}

export function createFigureRig(json, clips = null) {
  const B = json.bones, bi = (n) => B.indexOf(n), SL = json.slots, PAD = json.paddleSlot;
  const kidsOf = (parents, root) => { const out = []; const walk = (b) => { out.push(b); parents.forEach((p, i) => { if (p === b) walk(i); }); }; walk(root); return out; };
  const figs = {};
  for (const sex of json.sexes) {
    const f = json.figures[sex], J = f.joints, P = f.parents;
    // the grip: each finger's rows about its hand in the clips' rest pose (none without the clips: the bind's open hand)
    const rest = clips ? new Float32Array(SL * 12) : null;
    if (clips) clips.pose(sex, { rest: 1 }, 0, rest);
    const sc = rest ? Math.hypot(rest[bi('pelvis') * 12], rest[bi('pelvis') * 12 + 4], rest[bi('pelvis') * 12 + 8]) : 1;   // the bake's figure scale
    const hand = (s) => {
      const h = bi(`hand_${s}`), fingers = kidsOf(P, h).filter((b) => b !== h);
      const rel = rest ? fingers.map((b) => { const r = new Array(12); const Hi = inv34(Array.from(rest.subarray(h * 12, h * 12 + 12))); mul34(Hi, Array.from(rest.subarray(b * 12, b * 12 + 12)), r, 0); return r; }) : null;
      return { h, fingers, rel };
    };
    const limb = (a, b, c) => ({ a: bi(a), b: bi(b), c: bi(c) });
    figs[sex] = {
      J, sc,
      torso: ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'].map(bi),
      neck: bi('neck_01'), head: bi('Head'), pelvis: bi('pelvis'),
      arms: [{ ...limb('upperarm_l', 'lowerarm_l', 'hand_l'), ...hand('l'), side: 1 }, { ...limb('upperarm_r', 'lowerarm_r', 'hand_r'), ...hand('r'), side: -1 }],
      legs: [{ ...limb('thigh_l', 'calf_l', 'foot_l'), toes: [bi('ball_l'), bi('ball_leaf_l')] }, { ...limb('thigh_r', 'calf_r', 'foot_r'), toes: [bi('ball_r'), bi('ball_leaf_r')] }],
    };
  }
  // the bind's own frames: its right is −x, up +y, forward +z
  const BIND = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const HAND = new Array(12);

  function pose(sex, T, out, o = 0) {
    const f = figs[sex] ?? figs[json.sexes[0]], J = f.J, s = f.sc;
    // the torso's frame (its right, up, forward = up × right) and its turn from the bind
    const up = unit(T.up ?? [0, 1, 0]); const right = unit(sub(T.across ?? [1, 0, 0], scl(up, dot(T.across ?? [1, 0, 0], up)))); const fwd = crs(up, right);
    const Rt = turn([right, up, fwd], BIND);
    const hip = T.hip, Jp = J[f.pelvis];
    const torsoAt = (j) => add(hip, scl(mulM(Rt, sub(J[j], Jp)), s));
    for (const b of f.torso) put(out, o + b * 12, Rt, s, Jp, hip);
    put(out, o + f.neck * 12, Rt, s, Jp, hip);
    // the head: its up drawn toward the world's (a paddler looks at the horizon, not along the spine's lean)
    const hl = T.headLevel ?? 0.6, hu = unit(add(scl(up, 1 - hl), [0, hl, 0])), hr = unit(sub(right, scl(hu, dot(right, hu))));
    put(out, o + f.head * 12, turn([hr, hu, crs(hu, hr)], BIND), s, J[f.head], torsoAt(f.head));
    // the arms: shoulder → elbow → wrist on the figure's own lengths (a stretch along the bones by armReach)
    for (let i = 0; i < 2; i++) {
      const A = f.arms[i], sh = torsoAt(A.a), L1 = len(sub(J[A.b], J[A.a])) * s, L2 = len(sub(J[A.c], J[A.b])) * s;
      const target = T.hands?.[i] ?? add(sh, scl(up, -0.55)), pole = T.elbowPole?.[i] ?? scl(fwd, -1);
      // the stretch: armReach, more when the target is out of reach (up to armMax: a long reach for a short-armed figure), smooth in the reach
      const k = Math.min(T.armMax ?? 1.3, Math.max(T.armReach ?? 1, len(sub(target, sh)) / (0.985 * (L1 + L2)))), l1 = L1 * k, l2 = L2 * k;
      const c = chain(sh, target, l1, l2, pole), hinge = crs(c.n, c.p);
      // the bind's hinge: the arm along ±x, the elbow pointing back (−z)
      const db1 = unit(sub(J[A.b], J[A.a])), db2 = unit(sub(J[A.c], J[A.b])), hb = crs([A.side, 0, 0], [0, 0, -1]);
      const R1 = turn(frame(sub(c.mid, sh), hinge), frame(db1, hb)), R2 = turn(frame(sub(c.end, c.mid), hinge), frame(db2, hb));
      put(out, o + A.a * 12, R1, s, J[A.a], sh, db1, k);
      put(out, o + A.b * 12, R2, s, J[A.b], c.mid, db2, k);
      put(HAND, 0, R2, s, J[A.c], c.end);   // the wrist held straight: the hand turns with the forearm
      for (let q = 0; q < 12; q++) out[o + A.h * 12 + q] = HAND[q];
      if (A.rel) A.fingers.forEach((b, n) => mul34(HAND, A.rel[n], out, o + b * 12));
      else for (const b of A.fingers) for (let q = 0; q < 12; q++) out[o + b * 12 + q] = HAND[q];
    }
    // the legs: hip joint → knee → ankle, the feet flat on the deck pointing forward (turned out by footTurn)
    for (let i = 0; i < 2; i++) {
      const L = f.legs[i], hj = torsoAt(L.a), l1 = len(sub(J[L.b], J[L.a])) * s, l2 = len(sub(J[L.c], J[L.b])) * s;
      const target = T.feet?.[i] ?? add(hj, [0, -(l1 + l2) * 0.98, 0]), pole = T.kneePole?.[i] ?? fwd;
      const c = chain(hj, target, l1, l2, pole), hinge = crs(c.n, c.p);
      const db1 = unit(sub(J[L.b], J[L.a])), db2 = unit(sub(J[L.c], J[L.b])), hb = crs([0, -1, 0], [0, 0, 1]);
      put(out, o + L.a * 12, turn(frame(sub(c.mid, hj), hinge), frame(db1, hb)), s, J[L.a], hj);
      put(out, o + L.b * 12, turn(frame(sub(c.end, c.mid), hinge), frame(db2, hb)), s, J[L.b], c.mid);
      const ft = (T.footTurn ?? 0.12) * (i === 0 ? -1 : 1), cf = Math.cos(ft), sf = Math.sin(ft);
      const ff = T.footFwd ? unit(T.footFwd) : [fwd[0], 0, fwd[2]], fl = len(ff) > 1e-6 ? unit(ff) : [0, 0, -1];
      const fr = [-fl[2], 0, fl[0]];   // the deck's right of the toes' way (y up)
      const toe = unit(add(scl(fl, cf), scl(fr, sf))), toeR = [-toe[2], 0, toe[0]];
      const Rf = turn([toeR, [0, 1, 0], toe], BIND);
      for (const b of [L.c, ...L.toes]) put(out, o + b * 12, Rf, s, J[L.c], c.end);
    }
    // the kayak's paddle (its own slot) folded away: this craft draws its own
    for (let q = 0; q < 12; q++) out[o + PAD * 12 + q] = 0;
    if (SL > PAD + 1) { const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; for (let q = 0; q < 12; q++) out[o + (PAD + 1) * 12 + q] = id[q]; }
    return out;
  }
  return { pose, joints: (sex) => figs[sex]?.J ?? null, scale: (sex) => figs[sex]?.sc ?? 1 };
}
