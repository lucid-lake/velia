// The paddler's baked clips at run time (v2/render/kayak/asset.js; baked from v1's paddler by tools/v2-kayak-bake.mjs).
// Pure: no DOM, no GPU. A pose is the gaits' cycles sampled at one phase and blended by the agent's gait weights (v1's own
// blend: src/props/paddler/index.js bakedAt cross-fades its gaits the same way, a weighted lerp of the places and a
// sign-aligned weighted blend of the turns), one rigid S (and a uniform scale) per slot.
// Each gait's cycle is played on a periodic C2 cubic spline through its baked frames (v1's own clip playback: index.js
// clipSpline, uniform knots; the quaternion parts sign-aligned round the loop, then renormalised), so a slot's place, its
// velocity and its acceleration are continuous at every frame (a linear blend between frames broke the velocity at each
// one: 19.5 hand judders a second in cruise at 32 frames).
//   const C = createClips(asset)
//   C.pose(sex, w, phase, out, look)  → out: Float32Array(slots × 12): each slot's three rows (r · p + t), for the GPU;
//                                     look (optional): { yaw, roll, twistK, lean }, the paddler's own head and body on
//                                     top of the clip (living/kayaks-stroke.js: the look at the sloop, the head held level,
//                                     each paddler's own reach and rotation)
//   C.blade(sex, w, phase, look, out) → the blades in the kayak frame: [x, y, z] of the starboard centre, the port centre,
//                                     the starboard tip, the port tip (12 floats), on the same pose as pose()
//   C.rate(sex, w, phase)             → v1's own pace (each gait's phase rate through its cycle, 1/s)
//   C.advance(sex, w, phase, dt)      → the next phase at that pace
//   C.surge(sex, w, phase)            → the hull's speed over its mean in the bake (v1's planted-blade surge)
export function createClips(asset) {
  const { json, clipFrames: F, clipRates: R } = asset;
  const NF = json.frames, NB = json.slots, NG = json.gaits.length, TS = 1 / json.tScale, SS = 1 / json.sScale, QS = 1 / 32767;
  const gi = Object.fromEntries(json.gaits.map((g, i) => [g, i]));
  const si = Object.fromEntries(json.sexes.map((s, i) => [s, i]));
  const NC = json.sexes.length * NG, CH = NB * 8;
  // the decoded frames (q sign-aligned round the loop per slot, t in m, s) and their splines' second derivatives
  const Y = new Float32Array(NC * NF * CH), M = new Float32Array(NC * NF * CH);
  const RY = new Float32Array(NC * NF * 2), RM = new Float32Array(NC * NF * 2);
  // the periodic C2 spline's moments: M[i−1] + 4 M[i] + M[i+1] = 6 (y[i+1] − 2 y[i] + y[i−1]); the system is circulant, so
  // its inverse is too: M = c ⊛ r with c_k = ρ^|k| / (2√3), ρ = √3 − 2 (|ρ|^10 < 2e-6, under the int16 step: 9 terms each side)
  const RHO = Math.sqrt(3) - 2, KN = 9, KC = Float64Array.from({ length: 2 * KN + 1 }, (_, k) => RHO ** Math.abs(k - KN) / (2 * Math.sqrt(3)));
  const r6 = new Float64Array(NF + 2 * KN);   // the right-hand side, padded round the loop (no modulo in the sum)
  function moments(src, dst, base, stride, n) {   // one channel: src[base + i·stride], i < n (periodic)
    for (let i = 0; i < n; i++) r6[i + KN] = 6 * (src[base + (i + 1 < n ? i + 1 : 0) * stride] - 2 * src[base + i * stride] + src[base + (i ? i - 1 : n - 1) * stride]);
    for (let k = 0; k < KN; k++) { r6[k] = r6[n + k]; r6[n + KN + k] = r6[KN + k]; }
    for (let i = 0; i < n; i++) { let m = 0; for (let k = 0; k <= 2 * KN; k++) m += KC[k] * r6[i + k]; dst[base + i * stride] = m; }
  }
  for (let c = 0; c < NC; c++) {
    const b0 = c * NF * CH;
    for (let f = 0; f < NF; f++) for (let s = 0; s < NB; s++) {
      const o = b0 + (f * NB + s) * 8;
      Y[o] = F[o] * QS; Y[o + 1] = F[o + 1] * QS; Y[o + 2] = F[o + 2] * QS; Y[o + 3] = F[o + 3] * QS;
      Y[o + 4] = F[o + 4] * TS; Y[o + 5] = F[o + 5] * TS; Y[o + 6] = F[o + 6] * TS; Y[o + 7] = F[o + 7] * SS;
      if (f) { const p = o - CH; if (Y[o] * Y[p] + Y[o + 1] * Y[p + 1] + Y[o + 2] * Y[p + 2] + Y[o + 3] * Y[p + 3] < 0) for (let k = 0; k < 4; k++) Y[o + k] = -Y[o + k]; }
    }
    for (let ch = 0; ch < CH; ch++) moments(Y, M, b0 + ch, CH, NF);
    for (let f = 0; f < NF; f++) { RY[(c * NF + f) * 2] = R[(c * NF + f) * 2]; RY[(c * NF + f) * 2 + 1] = R[(c * NF + f) * 2 + 1]; }
    moments(RY, RM, c * NF * 2, 2, NF); moments(RY, RM, c * NF * 2 + 1, 2, NF);
  }
  // the loop must close: each slot's last frame turns the same way as its first (no double cover round the cycle)
  let wrapFlip = 0;
  for (let c = 0; c < NC; c++) for (let s = 0; s < NB; s++) {
    const a = (c * NF * NB + s) * 8, b = (c * NF * NB + (NF - 1) * NB + s) * 8;
    if (Y[a] * Y[b] + Y[a + 1] * Y[b + 1] + Y[a + 2] * Y[b + 2] + Y[a + 3] * Y[b + 3] < 0) wrapFlip++;
  }
  if (wrapFlip) throw new Error(`kayak clips: ${wrapFlip} slots turn through a full circle round their cycle`);

  // the skeleton per figure (bind joints in the kayak frame, parents) for the look on top of the clip
  const fig = {};
  for (const sex of json.sexes) {
    const f = json.figures?.[sex]; if (!f) continue;
    const kids = (root) => { const out = []; const walk = (b) => { out.push(b); f.parents.forEach((p, i) => { if (p === b) walk(i); }); }; walk(root); return Int32Array.from(out); };
    const bi = (n) => json.bones.indexOf(n);
    const arm = (s) => ({ up: bi(`upperarm_${s}`), low: bi(`lowerarm_${s}`), hand: kids(bi(`hand_${s}`)), chain: kids(bi(`upperarm_${s}`)), fore: kids(bi(`lowerarm_${s}`)) });
    fig[sex] = { joints: f.joints, upper: Int32Array.from([...kids(bi('spine_02')), json.paddleSlot]), neck: kids(bi('neck_01')), head: kids(bi('Head')), iSpine: bi('spine_02'), iNeck: bi('neck_01'), iHead: bi('Head'), iPelvis: bi('pelvis'), arms: [arm('l'), arm('r')] };
  }

  const cbase = (sex, g) => ((si[sex] ?? 0) * NG + g) * NF;
  let fi0 = 0, fi1 = 0, fu = 0, ft = 0;   // the frame pair and the spline's weights for the phase (set by at())
  function at(ph) { const f = (((ph % 1) + 1) % 1) * NF, i = Math.floor(f); fi0 = i % NF; fi1 = (fi0 + 1) % NF; ft = f - i; fu = 1 - ft; }
  const ev = (A, Mm, o0, o1) => fu * A[o0] + ft * A[o1] + ((fu * fu * fu - fu) * Mm[o0] + (ft * ft * ft - ft) * Mm[o1]) / 6;
  const gs = []; let gn = 0;   // the gaits that count and their normalised weights (reused)
  function rows(w) {
    gn = 0; let sum = 0;
    for (const g in w) { const v = w[g]; if (v > 1e-4 && gi[g] != null) { gs[gn * 2] = gi[g]; gs[gn * 2 + 1] = v; gn++; sum += v; } }
    if (!gn) { gs[0] = gi.rest ?? 0; gs[1] = 1; gn = 1; return; }
    for (let k = 0; k < gn; k++) gs[k * 2 + 1] /= sum;
  }
  const acc = new Float64Array(NB * 8), ref = new Float64Array(4);
  // R(q) · (x, y, z) → V3 (q normalised)
  const rotV = (qx, qy, qz, qw, x, y, z) => {
    const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x;
    V3[0] = x + 2 * (qw * cx + qy * cz - qz * cy); V3[1] = y + 2 * (qw * cy + qz * cx - qx * cz); V3[2] = z + 2 * (qw * cz + qx * cy - qy * cx);
  };
  const V3 = new Float64Array(3), ZERO = [0, 0, 0];
  // one slot blended over the gaits at the current at()/rows(): acc[s·8 …] = q (normalised), t, s. The gaits are blended
  // about the bone's own joint (its place is the weighted mean of the gaits' places; a lerp of the translations would
  // blend about the kayak frame's origin and swing every point far from it when the gaits' turns differ)
  function slot(sex, s) {
    const a = s * 8, j = fig[sex]?.joints[s] ?? ZERO; let q0 = 0, q1 = 0, q2 = 0, q3 = 0, t0 = 0, t1 = 0, t2 = 0, sc = 0;
    for (let k = 0; k < gn; k++) {
      const g = gs[k * 2], wg = gs[k * 2 + 1], cb = cbase(sex, g) * CH, o0 = cb + fi0 * CH + a, o1 = cb + fi1 * CH + a;
      let x = ev(Y, M, o0, o1), y = ev(Y, M, o0 + 1, o1 + 1), z = ev(Y, M, o0 + 2, o1 + 2), ww = ev(Y, M, o0 + 3, o1 + 3);
      const ql = Math.hypot(x, y, z, ww) || 1; x /= ql; y /= ql; z /= ql; ww /= ql;
      if (!k) { ref[0] = x; ref[1] = y; ref[2] = z; ref[3] = ww; }
      const sg = x * ref[0] + y * ref[1] + z * ref[2] + ww * ref[3] < 0 ? -wg : wg;
      q0 += sg * x; q1 += sg * y; q2 += sg * z; q3 += sg * ww;
      const sk = ev(Y, M, o0 + 7, o1 + 7);
      if (gn > 1) { rotV(x, y, z, ww, j[0], j[1], j[2]); t0 += wg * (sk * V3[0] + ev(Y, M, o0 + 4, o1 + 4)); t1 += wg * (sk * V3[1] + ev(Y, M, o0 + 5, o1 + 5)); t2 += wg * (sk * V3[2] + ev(Y, M, o0 + 6, o1 + 6)); }
      else { t0 += ev(Y, M, o0 + 4, o1 + 4); t1 += ev(Y, M, o0 + 5, o1 + 5); t2 += ev(Y, M, o0 + 6, o1 + 6); }
      sc += wg * sk;
    }
    const ql = Math.hypot(q0, q1, q2, q3) || 1;
    acc[a] = q0 / ql; acc[a + 1] = q1 / ql; acc[a + 2] = q2 / ql; acc[a + 3] = q3 / ql; acc[a + 7] = sc;
    if (gn > 1) { rotV(acc[a], acc[a + 1], acc[a + 2], acc[a + 3], j[0], j[1], j[2]); t0 -= sc * V3[0]; t1 -= sc * V3[1]; t2 -= sc * V3[2]; }
    acc[a + 4] = t0; acc[a + 5] = t1; acc[a + 6] = t2;
  }
  // rows of slot s from acc (three's quaternion → matrix, × the scale; the translation in each row's w)
  function toRows(s, out, o) {
    const a = s * 8, x = acc[a], y = acc[a + 1], z = acc[a + 2], ww = acc[a + 3], sc = acc[a + 7];
    out[o] = (1 - 2 * (y * y + z * z)) * sc; out[o + 1] = 2 * (x * y - z * ww) * sc; out[o + 2] = 2 * (x * z + y * ww) * sc; out[o + 3] = acc[a + 4];
    out[o + 4] = 2 * (x * y + z * ww) * sc; out[o + 5] = (1 - 2 * (x * x + z * z)) * sc; out[o + 6] = 2 * (y * z - x * ww) * sc; out[o + 7] = acc[a + 5];
    out[o + 8] = 2 * (x * z - y * ww) * sc; out[o + 9] = 2 * (y * z + x * ww) * sc; out[o + 10] = (1 - 2 * (x * x + y * y)) * sc; out[o + 11] = acc[a + 6];
  }
  // a rigid turn L (rows, 12) applied on the left of a slot's rows: S ← L · S
  function lmul(L, out, o) {
    for (let r = 0; r < 3; r++) {
      const l0 = L[r * 4], l1 = L[r * 4 + 1], l2 = L[r * 4 + 2], l3 = L[r * 4 + 3];
      const c0 = l0 * out[o] + l1 * out[o + 4] + l2 * out[o + 8], c1 = l0 * out[o + 1] + l1 * out[o + 5] + l2 * out[o + 9];
      const c2 = l0 * out[o + 2] + l1 * out[o + 6] + l2 * out[o + 10], c3 = l0 * out[o + 3] + l1 * out[o + 7] + l2 * out[o + 11] + l3;
      T12[r * 4] = c0; T12[r * 4 + 1] = c1; T12[r * 4 + 2] = c2; T12[r * 4 + 3] = c3;
    }
    for (let k = 0; k < 12; k++) out[o + k] = T12[k];
  }
  const T12 = new Float64Array(12), Lm = new Float64Array(12), P3 = new Float64Array(3);
  // the shaft's turn about the kayak's up from across the kayak (its x axis: rad, + turns the starboard blade forward)
  const shaftYaw = (out, o) => Math.atan2(-out[o + 8], out[o]);
  // the place of joint j now: S_j · joint_bind
  function jointNow(f, j, out, o) {
    const p = f.joints[j], b = o + j * 12;
    P3[0] = out[b] * p[0] + out[b + 1] * p[1] + out[b + 2] * p[2] + out[b + 3];
    P3[1] = out[b + 4] * p[0] + out[b + 5] * p[1] + out[b + 6] * p[2] + out[b + 7];
    P3[2] = out[b + 8] * p[0] + out[b + 9] * p[1] + out[b + 10] * p[2] + out[b + 11];
  }
  // L = a turn about the pivot P3: yaw about the kayak's up (y), then pitch about its x, then roll about its z (aft)
  function turnAbout(yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
    // R = Rz(roll) · Rx(pitch) · Ry(yaw)
    const a00 = cy, a02 = sy, a20 = -sy, a22 = cy;                                   // Ry
    const b00 = a00, b01 = 0, b02 = a02, b10 = -sx * a20, b11 = cx, b12 = -sx * a22, b20 = cx * a20, b21 = sx, b22 = cx * a22;   // Rx · Ry
    const r00 = cz * b00 - sz * b10, r01 = cz * b01 - sz * b11, r02 = cz * b02 - sz * b12;
    const r10 = sz * b00 + cz * b10, r11 = sz * b01 + cz * b11, r12 = sz * b02 + cz * b12;
    const px = P3[0], py = P3[1], pz = P3[2];
    Lm[0] = r00; Lm[1] = r01; Lm[2] = r02; Lm[3] = px - (r00 * px + r01 * py + r02 * pz);
    Lm[4] = r10; Lm[5] = r11; Lm[6] = r12; Lm[7] = py - (r10 * px + r11 * py + r12 * pz);
    Lm[8] = b20; Lm[9] = b21; Lm[10] = b22; Lm[11] = pz - (b20 * px + b21 * py + b22 * pz);
  }
  // the paddler's own body and head on top of the clip, on the slots' rows in out (from o):
  //   twistK the upper body's rotation over the clip's own, as a share of the shaft's turn (+0.1: 10 % more), about the
  //          waist (spine_02's joint), with the paddle (the hands stay on the shaft)
  //   lean   its pitch forward (+, rad) about the same joint: a longer or shorter reach
  //   yaw    the head's turn (+ to starboard: the kayak's −y turn), 40 % in the neck, 60 % at the head
  //   roll   the head's roll about the kayak's long axis (+ starboard up), at the neck
  function applyLook(sex, look, out, o) {
    const f = fig[sex]; if (!f || !look) return;
    if (look.twistK || look.lean) {
      jointNow(f, f.iSpine, out, o); turnAbout((look.twistK ?? 0) * shaftYaw(out, o + json.paddleSlot * 12), -(look.lean ?? 0), 0);
      for (const s of f.upper) lmul(Lm, out, o + s * 12);
    }
    if (look.yaw || look.roll) {
      jointNow(f, f.iNeck, out, o); turnAbout(-(look.yaw ?? 0) * 0.4, 0, look.roll ?? 0);
      for (const s of f.neck) lmul(Lm, out, o + s * 12);
      if (look.yaw) { jointNow(f, f.iHead, out, o); turnAbout(-look.yaw * 0.6, 0, 0); for (const s of f.head) lmul(Lm, out, o + s * 12); }
    }
    // a swimmer's arms (a capsized paddler in the water, v2/sim/kayak-roll.js): arms 0–1 out from the paddle grip to the
    // sides, low, sculling (scullPh, rad); wave 0–1 the right arm up over the head, its forearm waving (wavePh, rad)
    if (look.arms || look.wave) {
      const A = look.arms ?? 0, Wv = look.wave ?? 0, sc = Math.sin(look.scullPh ?? 0);
      for (let k = 0; k < 2; k++) {
        const arm = f.arms[k], side = k ? 1 : -1, wv = k ? Wv : 0, chain = arm.chain;
        jointNow(f, arm.up, out, o);
        // out to the side (a yaw about the body's up), lowered toward the water, the scull a small yaw to and fro
        // (the arm hangs from the shoulder: a roll about the kayak's long axis lifts it out to the side, the wave on up over
        // the head; a yaw swings it out of the grip in front)
        const yaw = -side * (A * (0.5 + 0.2 * sc) * (1 - wv) + wv * 1.25);
        turnAbout(yaw, 0, side * (1.75 * wv + 0.75 * A * (1 - wv)));
        for (const s of chain) lmul(Lm, out, o + s * 12);
        if (wv > 0) { jointNow(f, arm.low, out, o); turnAbout(0, 0, wv * 0.45 * Math.sin(look.wavePh ?? 0)); for (const s of arm.fore) lmul(Lm, out, o + s * 12); }
      }
    }
  }
  // ---- the grips through a blend (v1 blends the paddle and solves the arms onto it: src/props/paddler/index.js bakedAt,
  // rig.js): blending each bone on its own lets the hands leave the shaft where the gaits hold the paddle differently (a
  // cruise with a sweep: up to 49 cm). So each hand and its fingers are blended in the paddle's frame and put on the
  // blended paddle, and the arm reaches the hand by a two-bone turn (the elbow kept in its plane) ----
  const g8 = new Float64Array(8), p8 = new Float64Array(8), h8 = new Float64Array(8), hb = new Float64Array(NB * 8), href = new Float64Array(4);
  function slotG(sex, g, s, o8) {   // one gait's slot at the current at(): q (normalised), t, s
    const cb = cbase(sex, g) * CH, a = s * 8, o0 = cb + fi0 * CH + a, o1 = cb + fi1 * CH + a;
    for (let c = 0; c < 8; c++) o8[c] = ev(Y, M, o0 + c, o1 + c);
    const ql = Math.hypot(o8[0], o8[1], o8[2], o8[3]) || 1; for (let c = 0; c < 4; c++) o8[c] /= ql;
  }
  const qm = (a, ao, b, bo, o, oo) => {   // o = a · b (quaternions at offsets)
    const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3], bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
    o[oo] = aw * bx + ax * bw + ay * bz - az * by; o[oo + 1] = aw * by - ax * bz + ay * bw + az * bx; o[oo + 2] = aw * bz + ax * by - ay * bx + az * bw; o[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
  };
  const qv = (q, qo, x, y, z, o) => {   // o = R(q) · v
    const ux = q[qo], uy = q[qo + 1], uz = q[qo + 2], w = q[qo + 3];
    const cx = uy * z - uz * y, cy = uz * x - ux * z, cz = ux * y - uy * x;
    o[0] = x + 2 * (w * cx + uy * cz - uz * cy); o[1] = y + 2 * (w * cy + uz * cx - ux * cz); o[2] = z + 2 * (w * cz + ux * cy - uy * cx);
  };
  const qi = new Float64Array(4), rq = new Float64Array(4);
  function keepGrips(sex, out) {
    const f = fig[sex]; if (!f) return;
    const PS = json.paddleSlot, P = acc.subarray(PS * 8, PS * 8 + 8);
    for (const arm of f.arms) {
      // the hand and its fingers relative to each gait's paddle, blended (sign-aligned turns), on the blended paddle
      for (const s of arm.hand) {
        const jj = f.joints[s];
        let rad = 0, q0 = 0, q1 = 0, q2 = 0, q3 = 0, t0 = 0, t1 = 0, t2 = 0, sc = 0;
        for (let k = 0; k < gn; k++) {
          const g = gs[k * 2], wg = gs[k * 2 + 1];
          slotG(sex, g, PS, p8); slotG(sex, g, s, g8);
          qi[0] = -p8[0]; qi[1] = -p8[1]; qi[2] = -p8[2]; qi[3] = p8[3];
          qm(qi, 0, g8, 0, h8, 0);
          rotV(g8[0], g8[1], g8[2], g8[3], jj[0], jj[1], jj[2]);   // the joint's place in this gait, then in its paddle's frame
          qv(qi, 0, (g8[7] * V3[0] + g8[4] - p8[4]) / p8[7], (g8[7] * V3[1] + g8[5] - p8[5]) / p8[7], (g8[7] * V3[2] + g8[6] - p8[6]) / p8[7], V3);
          if (!k) { href[0] = h8[0]; href[1] = h8[1]; href[2] = h8[2]; href[3] = h8[3]; }
          const sg = h8[0] * href[0] + h8[1] * href[1] + h8[2] * href[2] + h8[3] * href[3] < 0 ? -wg : wg;
          q0 += sg * h8[0]; q1 += sg * h8[1]; q2 += sg * h8[2]; q3 += sg * h8[3]; t0 += wg * V3[0]; t1 += wg * V3[1]; t2 += wg * V3[2]; sc += wg * g8[7] / p8[7];
          rad += wg * Math.hypot(V3[1], V3[2]);
        }
        // the joint as far from the shaft's axis (the paddle's x) as the gaits hold it (a lerp cuts the chord inward)
        { const r0 = Math.hypot(t1, t2); if (r0 > 1e-6) { t1 *= rad / r0; t2 *= rad / r0; } }
        const ql = Math.hypot(q0, q1, q2, q3) || 1; rq[0] = q0 / ql; rq[1] = q1 / ql; rq[2] = q2 / ql; rq[3] = q3 / ql;
        const a = s * 8;
        qm(P, 0, rq, 0, acc, a);
        qv(P, 0, t0, t1, t2, V3);
        const px = P[7] * V3[0] + P[4], py = P[7] * V3[1] + P[5], pz = P[7] * V3[2] + P[6]; acc[a + 7] = P[7] * sc;
        rotV(acc[a], acc[a + 1], acc[a + 2], acc[a + 3], jj[0], jj[1], jj[2]);
        acc[a + 4] = px - acc[a + 7] * V3[0]; acc[a + 5] = py - acc[a + 7] * V3[1]; acc[a + 6] = pz - acc[a + 7] * V3[2];
      }
      // the arm to the hand: shoulder S, elbow E, wrist W (blended) → W' (the hand put on the paddle)
      const J0 = f.joints, ju = J0[arm.up], jl = J0[arm.low], jh = J0[arm.hand[0]];
      const pt = (rowsOut, s, j, o3) => { const b = s * 12; for (let r = 0; r < 3; r++) o3[r] = rowsOut[b + r * 4] * j[0] + rowsOut[b + r * 4 + 1] * j[1] + rowsOut[b + r * 4 + 2] * j[2] + rowsOut[b + r * 4 + 3]; };
      pt(out, arm.up, ju, Sv); pt(out, arm.low, jl, Ev); pt(out, arm.hand[0], jh, Wv);
      toRows(arm.hand[0], HR, 0); pt(HR, 0, jh, Wt);
      const l1 = Math.hypot(Ev[0] - Sv[0], Ev[1] - Sv[1], Ev[2] - Sv[2]), l2 = Math.hypot(Wv[0] - Ev[0], Wv[1] - Ev[1], Wv[2] - Ev[2]);
      const dx = Wt[0] - Sv[0], dy = Wt[1] - Sv[1], dz = Wt[2] - Sv[2], d0 = Math.hypot(dx, dy, dz) || 1e-6;
      const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, d0)), ux = dx / d0, uy = dy / d0, uz = dz / d0;
      // the elbow's side: the blended elbow's offset across the shoulder–wrist line
      let nx = Ev[0] - Sv[0], ny = Ev[1] - Sv[1], nz = Ev[2] - Sv[2]; const pr = nx * ux + ny * uy + nz * uz; nx -= pr * ux; ny -= pr * uy; nz -= pr * uz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, l1 * l1 - along * along));
      E2[0] = Sv[0] + ux * along + nx * hh; E2[1] = Sv[1] + uy * along + ny * hh; E2[2] = Sv[2] + uz * along + nz * hh;
      // the upper arm: the shortest turn from SE to SE' about S; the forearm: that turn, then EW (turned) to E'W' about E'
      arc(Ev[0] - Sv[0], Ev[1] - Sv[1], Ev[2] - Sv[2], E2[0] - Sv[0], E2[1] - Sv[1], E2[2] - Sv[2], Sv);
      lmul(Lm, out, arm.up * 12); lmul(Lm, out, arm.low * 12);
      pt(out, arm.low, jl, Ev); pt(out, arm.hand[0], jh, Wv);   // (the hand's blended rows are stale; its wrist through the forearm:)
      const fb = arm.low * 12, cj = J0[arm.hand[0]];
      for (let r = 0; r < 3; r++) Wv[r] = out[fb + r * 4] * cj[0] + out[fb + r * 4 + 1] * cj[1] + out[fb + r * 4 + 2] * cj[2] + out[fb + r * 4 + 3];
      arc(Wv[0] - Ev[0], Wv[1] - Ev[1], Wv[2] - Ev[2], Wt[0] - E2[0], Wt[1] - E2[1], Wt[2] - E2[2], E2);
      lmul(Lm, out, fb);
      for (const s of arm.hand) toRows(s, out, s * 12);
    }
  }
  const Sv = new Float64Array(3), Ev = new Float64Array(3), Wv = new Float64Array(3), Wt = new Float64Array(3), E2 = new Float64Array(3), HR = new Float64Array(12);
  // Lm = the shortest turn taking direction a to direction b, about the point c
  function arc(ax, ay, az, bx, by, bz, c) {
    const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1; ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, w = 1 + ax * bx + ay * by + az * bz;
    const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w), r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w), r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    Lm[0] = r00; Lm[1] = r01; Lm[2] = r02; Lm[3] = c[0] - (r00 * c[0] + r01 * c[1] + r02 * c[2]);
    Lm[4] = r10; Lm[5] = r11; Lm[6] = r12; Lm[7] = c[1] - (r10 * c[0] + r11 * c[1] + r12 * c[2]);
    Lm[8] = r20; Lm[9] = r21; Lm[10] = r22; Lm[11] = c[2] - (r20 * c[0] + r21 * c[1] + r22 * c[2]);
  }
  const blades = json.paddle?.blades ?? { stbd: { centre: 0.94, tip: 1.15 }, port: { centre: -0.94, tip: -1.15 } };
  const BX = [blades.stbd.centre, blades.port.centre, blades.stbd.tip, blades.port.tip];
  const PR = new Float32Array(NB * 12);   // scratch rows for blade(): only the slots the look moves are filled
  return {
    NF, NB, json, hasFigures: !!Object.keys(fig).length,
    pose(sex, w, phase, out = new Float32Array(NB * 12), look = null) {
      rows(w); at(phase);
      for (let s = 0; s < NB; s++) { slot(sex, s); toRows(s, out, s * 12); }
      if (gn > 1) keepGrips(sex, out);
      applyLook(sex, look, out, 0);
      return out;
    },
    blade(sex, w, phase, look = null, out = new Float64Array(12)) {
      rows(w); at(phase);
      const PS = json.paddleSlot, f = fig[sex];
      slot(sex, PS); toRows(PS, PR, PS * 12);
      if (f && look && (look.twistK || look.lean)) {
        slot(sex, f.iSpine); toRows(f.iSpine, PR, f.iSpine * 12);
        jointNow(f, f.iSpine, PR, 0); turnAbout((look.twistK ?? 0) * shaftYaw(PR, PS * 12), -(look.lean ?? 0), 0); lmul(Lm, PR, PS * 12);
      }
      const o = PS * 12;   // the blade's points ride the paddle's x axis
      for (let k = 0; k < 4; k++) { const x = BX[k]; out[k * 3] = PR[o] * x + PR[o + 3]; out[k * 3 + 1] = PR[o + 4] * x + PR[o + 7]; out[k * 3 + 2] = PR[o + 8] * x + PR[o + 11]; }
      return out;
    },
    rate(sex, w, phase) {
      rows(w); at(phase); let r = 0;
      for (let k = 0; k < gn; k++) { const o = cbase(sex, gs[k * 2]) * 2; r += gs[k * 2 + 1] * ev(RY, RM, o + fi0 * 2, o + fi1 * 2); }
      return r;
    },
    advance(sex, w, phase, dt) { return (((phase + dt * this.rate(sex, w, phase)) % 1) + 1) % 1; },
    surge(sex, w, phase) {
      rows(w); at(phase); let s = 0;
      for (let k = 0; k < gn; k++) { const o = cbase(sex, gs[k * 2]) * 2 + 1; s += gs[k * 2 + 1] * ev(RY, RM, o + fi0 * 2, o + fi1 * 2); }
      return s;
    },
  };
}

// rows for a rigid transform from a yaw/pitch/roll pose (three's Euler 'YXZ' order: v1's kayak group rotation.set(pitch,
// yaw, roll, 'YXZ')) and a translation; the uniform scale s. → 12 floats (3 rows of [r | t])
export function poseRows(p, out = new Float32Array(12), o = 0, s = 1) {
  const cx = Math.cos(p.pitch ?? 0), sx = Math.sin(p.pitch ?? 0), cy = Math.cos(p.yaw ?? 0), sy = Math.sin(p.yaw ?? 0), cz = Math.cos(p.roll ?? 0), sz = Math.sin(p.roll ?? 0);
  // R = Ry · Rx · Rz (three's makeRotationFromEuler, order YXZ)
  const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
  const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
  out[o] = m00 * s; out[o + 1] = m01 * s; out[o + 2] = m02 * s; out[o + 3] = p.x;
  out[o + 4] = m10 * s; out[o + 5] = m11 * s; out[o + 6] = m12 * s; out[o + 7] = p.y;
  out[o + 8] = m20 * s; out[o + 9] = m21 * s; out[o + 10] = m22 * s; out[o + 11] = p.z;
  return out;
}
