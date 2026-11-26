// The stand-up paddleboarder's body (v2/sim/sup.js, v2/render/sup.js): the skeleton of one paddler on one board, as plain numbers.
// Pure: no DOM, no GPU, no clock. Board frame (every boat's): x starboard, y up from the waterline, z aft (the bow at -z), metres.
//   supPose(st, out) → out: the joints the drawing hangs its parts on
//     st: { kneel (0 standing, 1 kneeling on the deck), u (the stroke's phase 0..1), side (+1 starboard blade, -1 port),
//           roll (the body's balance sway and wobble, rad, + leans to port), shift (the hips' sideways step, m), reach (0..1: how far the stroke goes) }
//   The stroke: catch (the blade goes in ahead, 0 to 0.08), pull (0.08 to 0.5, the blade drawn aft by the hip), exit (to 0.6), recovery
//   (the blade carried forward over the water and across to the other side, 0.6 to 1: the next stroke is on the other side).
//   Kneeling (a splash, living/sup.js): the hips drop onto the heels, the shins lie aft on the deck, the paddle is held across the lap.
//   Nothing here moves the figure off the board: the feet, the knees and the hips are tied to the deck, the roll is capped.
export const BOARD = Object.freeze({ L: 3.35, B: 0.76, top: 0.075, bottom: -0.06, rocker: 0.09 });
export const BODY = Object.freeze({ thigh: 0.46, shin: 0.44, torso: 0.52, shoulderHalf: 0.2, upperArm: 0.34, foreArm: 0.32, neck: 0.2, headR: 0.11, paddle: 2.05, footZ: 0.1, footX: 0.19, hipZ: 0.1, rollMax: 0.42 });

const lerp = (a, b, t) => a + (b - a) * t;
const sm = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// a two-bone chain from root toward target (lengths l1, l2), bending toward pole: { mid, end } (end: the target, or the reach's limit)
export function twoBone(root, target, l1, l2, pole, out = { mid: [0, 0, 0], end: [0, 0, 0] }) {
  const dx = target[0] - root[0], dy = target[1] - root[1], dz = target[2] - root[2], D = Math.hypot(dx, dy, dz) || 1e-6;
  const d = Math.min(Math.max(D, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4), n = [dx / D, dy / D, dz / D];
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const dp = pole[0] * n[0] + pole[1] * n[1] + pole[2] * n[2], p = norm([pole[0] - n[0] * dp, pole[1] - n[1] * dp, pole[2] - n[2] * dp]);
  for (let i = 0; i < 3; i++) { out.mid[i] = root[i] + n[i] * a + p[i] * h; out.end[i] = root[i] + n[i] * d; }
  return out;
}

export const newPose = () => ({
  hip: [0, 0, 0], shoulder: [[0, 0, 0], [0, 0, 0]], head: [0, 0, 0], up: [0, 1, 0], across: [1, 0, 0],
  hipJoint: [[0, 0, 0], [0, 0, 0]], knee: [[0, 0, 0], [0, 0, 0]], ankle: [[0, 0, 0], [0, 0, 0]],
  elbow: [[0, 0, 0], [0, 0, 0]], hand: [[0, 0, 0], [0, 0, 0]],   // index 0: port, 1: starboard
  top: [0, 0, 0], tip: [0, 0, 0], axis: [0, 0, 1], blade: 0, _c: { mid: [0, 0, 0], end: [0, 0, 0] },
});

export function supPose(st, out = newPose()) {
  const k = Math.min(1, Math.max(0, st.kneel ?? 0)), u = ((st.u ?? 0) % 1 + 1) % 1, side = st.side >= 0 ? 1 : -1;
  const roll = Math.max(-BODY.rollMax, Math.min(BODY.rollMax, st.roll ?? 0)), reach = st.reach ?? 1;
  const z0 = BODY.hipZ, deck = BOARD.top;
  // the hips: standing at 0.95 m, dropped to 0.5 on the heels (a few cm of sway from the wobble, tied to the deck)
  const hipY = lerp(0.95, 0.58, sm(k)), hx = Math.max(-0.12, Math.min(0.12, st.shift ?? 0)) * (1 - 0.5 * k), hz = z0 + 0.02 * k;
  out.hip[0] = hx; out.hip[1] = hipY; out.hip[2] = hz;
  // the torso: upright, leaning toward the bow with the stroke's catch (more when kneeling), rolled by the sway
  const stroking = 1 - sm(k * 2);
  const catchLean = (u < 0.5 ? Math.sin(Math.PI * Math.min(1, u / 0.5)) : 0) * 0.17 * reach * stroking;
  const pitch = 0.06 + catchLean + 0.2 * k;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  out.up[0] = -sr * cp; out.up[1] = cr * cp; out.up[2] = -sp;   // the spine's direction, leaning bow-ward and to port with a positive roll
  out.across[0] = cr; out.across[1] = sr; out.across[2] = 0;
  const sh = [out.hip[0] + out.up[0] * BODY.torso, out.hip[1] + out.up[1] * BODY.torso, out.hip[2] + out.up[2] * BODY.torso];
  for (let s = 0; s < 2; s++) { const sg = s === 0 ? -1 : 1; for (let i = 0; i < 3; i++) out.shoulder[s][i] = sh[i] + out.across[i] * sg * BODY.shoulderHalf; }
  for (let i = 0; i < 3; i++) out.head[i] = sh[i] + out.up[i] * (BODY.neck + BODY.headR * 0.55);
  out.head[2] -= 0.03;   // the head carried a little forward
  // the legs: each foot flat on the deck (standing: abreast; kneeling: the shins laid aft, the heels under the hips)
  for (let s = 0; s < 2; s++) {
    const sg = s === 0 ? -1 : 1, fx = sg * lerp(BODY.footX, 0.11, k), fz = lerp(z0 + sg * 0.05, z0 + 0.47, sm(k)), fy = deck + lerp(0.05, 0.03, k);
    out.hipJoint[s][0] = hx + sg * 0.09; out.hipJoint[s][1] = hipY - 0.04; out.hipJoint[s][2] = hz;
    out.ankle[s][0] = fx; out.ankle[s][1] = fy; out.ankle[s][2] = fz;
    twoBone(out.hipJoint[s], out.ankle[s], BODY.thigh, BODY.shin, [sg * 0.15, 0.1, -1], out._c);
    for (let i = 0; i < 3; i++) { out.knee[s][i] = out._c.mid[i]; out.ankle[s][i] = out._c.end[i]; }
  }
  // the paddle: the blade's side and the stroke's path (the board's z: the hip is at z0)
  const pull = u < 0.08 ? 0 : u < 0.5 ? sm((u - 0.08) / 0.42) : 1;
  const rec = u < 0.6 ? 0 : (u - 0.6) / 0.4;
  const xSide = u < 0.6 ? side : side * (1 - 2 * sm((rec - 0.1) / 0.8));   // across to the other side in the recovery
  const lift = u < 0.5 ? 0 : u < 0.6 ? sm((u - 0.5) / 0.1) : 1 - sm((rec - 0.65) / 0.35);   // the blade's lift: out at the exit, over the water in the recovery, down at the catch
  const depth = 1 - lift, bx = xSide * lerp(0.62, 0.44, depth);
  // the top hand over the shoulders, going with the stroke; the blade ahead of it at the catch, behind at the exit, carried well forward in the recovery
  const f = u < 0.6 ? pull : 1 - sm(rec), tz = z0 - 0.2 + 0.35 * f, tx = xSide * 0.16 + hx * 0.5;
  const lead = lerp(-0.42, 0.35, f) - 1.3 * lift, by = lerp(-0.22, 0.3, lift), dxz = Math.hypot(bx - tx, lead);
  const ty = by + Math.sqrt(Math.max(0.05, BODY.paddle * BODY.paddle - dxz * dxz)), bz = tz + lead;   // the top hand's height follows from the blade's: the shaft is 2.05 m
  // stroking: the top hand over the blade's side, the blade below; kneeling: the paddle across the lap
  const top = [lerp(tx, -0.5, sm(k)), lerp(ty, 0.56, sm(k)), lerp(tz, z0 - 0.36, sm(k))];
  const tgt = [lerp(bx, 1.5, sm(k)), lerp(by, 0.56, sm(k)), lerp(bz, z0 - 0.36, sm(k))];
  const ax = norm([tgt[0] - top[0], tgt[1] - top[1], tgt[2] - top[2]]);
  out.axis[0] = ax[0]; out.axis[1] = ax[1]; out.axis[2] = ax[2];
  for (let i = 0; i < 3; i++) { out.top[i] = top[i]; out.tip[i] = top[i] + ax[i] * BODY.paddle; }
  // the hands: the top hand on the grip (the shoulder opposite the blade's side), the lower hand 0.75 down the shaft (kneeling: both on the shaft)
  const topSide = xSide >= 0 ? 0 : 1, lowSide = 1 - topSide;   // blade to starboard: the port hand is on top
  const topOff = lerp(0, 0.45, sm(k)), lowOff = lerp(0.75, 1.1, sm(k));
  for (let s = 0; s < 2; s++) {
    const off = s === topSide ? topOff : lowOff, sg = s === 0 ? -1 : 1, hand = [out.top[0] + ax[0] * off, out.top[1] + ax[1] * off, out.top[2] + ax[2] * off];
    twoBone(out.shoulder[s], hand, BODY.upperArm, BODY.foreArm, [sg * 0.5, -0.6, 0.7], out._c);
    for (let i = 0; i < 3; i++) { out.elbow[s][i] = out._c.mid[i]; out.hand[s][i] = out._c.end[i]; }
  }
  out.blade = depth;
  return out;
}
