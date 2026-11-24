// A full kayak's stroke in v2 (K2 and K3): v1's baked clip (v2/sim/kayak-clip.js) played at the
// kayak's real speed, so the blade holds in the water and the kayak moves up to it; the stroke's force drives the hull;
// the paddler's head and own manner on top. Pure: no DOM, no GPU, no Math.random (a seeded generator per paddler).
//   const st = createStroke({ clips, sex, seed, phase })
//   const o = strokeStep(st, a, dt)   a: the agent ({ v, w, look }: its speed ahead m/s, its gait weights, the mind's look
//                                     deg or null); → { F (N ahead), M (N·m, + bow to starboard), events }; st.ph is the
//                                     stroke's phase, st.body the pose's look for clip.pose (its roll set by the caller),
//                                     st.roll / st.dip the hull's answer to the stroke, st.blades the blades (kayak frame)
//
// The blade lock (v1's planted blade, src/props/paddler/index.js strokeStep and updatePace): while a blade is in the water
// the phase runs at the rate that carries the clip's own blade aft through the kayak frame at the kayak's speed plus a
// little slip (dz/dt = v (1 + slip): the blade stays put in the world, the hull slides past it). At the kayak's own speed
// in the bake this is the clip's own rate; slower, the pull slows with it; from rest the blade runs past the hull at
// relMin at least (it slips, as v1's). In the air the phase runs at v1's own pace (the clip's rate). The two rates are
// blended by how deep the blade is (a smoothstep of its depth), so the phase's rate, and every joint's speed, change
// without a step at the catch and the exit.
// The force (v1's: F = F_peak · hold · the low-speed gain 1 + 2 (1 − v/1.15)^1.2) goes into the hull model in place of
// the gait's mean force; F_peak per gait is fitted so the full kayak keeps the hull model's speeds (src/sim/kayaks/agent.js
// GAIT: cruise 1.31 m/s, sprint 2.01, back −1.11; tests/v2 kayaks). Its moment −F · x_blade · arm yaws the bow away from
// the blade (v1: I dr/dt = −F x arm − D r; forward and back strokes; a sweep keeps the hull model's mean turn); the hull
// rolls toward the blade on a spring (ω 6 rad/s, ζ 0.5, 0.03 rad at the full force) and dips with the pull (v1's floatFull).
import { mulberry32 } from '../../src/sim/core/rng.js';
import { GAIT } from '../../src/sim/kayaks/agent.js';

const DEG = Math.PI / 180;
export const STROKE = Object.freeze({
  slip: 0.10,       // the blade gives this share of the kayak's travel through the water while held (v1's ≈ 12 %)
  relMin: 0.30,     // m/s: the slowest the held blade runs past the hull (below it the blade slips: a start from rest)
  depth: [-0.01, 0.02],  // m: the blade's hold rises over this depth of its centre (a smoothstep: the lower half in, then 2 cm)
  // N: the blade force's peak per gait, fitted (tools/v2-kayak-motion.mjs --fit) so a full kayak holds the hull model's speeds
  force: { cruise: 37.9, sprint: 70.1, back: -23.5, sweepR: 11.5, sweepL: 11.5 },
  arm: 1.0,         // v1's yaw lever on the blade's distance out (forward and back strokes)
  roll: 0.03, rollW: 6, rollZeta: 0.5,   // rad at the full force; the spring
  rateVar: 0.08, leanVar: 2.5 * DEG, twistVar: 0.10,   // each paddler's own: stroke rate ±8 %, reach (a lean ±2.5°), rotation ±10 %
  dzWin: 0.02,      // the phase step over which the clip's blade direction is read (its mean over ±0.02)
  local: { cruise: 1, sprint: 0.25, back: 1, sweepR: 1, sweepL: 1 },   // #45: each gait's share of the clip's local blade speed in the lock
  localFloor: 0.8,  // the local blade speed's floor, a share of the stroke's mean
  look: 75 * DEG, lookTau: 0.25,   // the head's look at the sloop: its range each side, its easing (two stages, v1's setLook)
  lookNear: 25, lookBack: 110 * DEG,   // m, rad: the sloop this near and no further round than this is watched (beside the mind's glances)
  headRoll: 0.9,    // the share of the hull's roll the head takes back (it keeps 10 %: Cold Smoke's skier)
});
const GAITS = ['cruise', 'sprint', 'back', 'sweepR', 'sweepL'];
// the blend's stroke direction: the sign of its paddling gaits' force (back paddling pushes the blade forward)
const Fsign = (w) => { let f = 0; for (const g of GAITS) f += (w[g] ?? 0) * STROKE.force[g]; return Math.sign(f) || 1; };
import { smooth } from '../../src/sim/core/math.js';

export function createStroke({ clips, sex = 'male', seed = 1, phase = 0, opts = STROKE } = {}) {
  const r = mulberry32((Math.imul(seed | 0, 2654435761) ^ 0x51ed) >>> 0);
  const u = () => 2 * r() - 1;
  return {
    clips, sex, opts, ph: ((phase % 1) + 1) % 1, t: 0,
    rateK: 1 + opts.rateVar * u(), wa: r() * 2 * Math.PI, wb: r() * 2 * Math.PI,
    body: { yaw: 0, roll: 0, twistK: opts.twistVar * u(), lean: opts.leanVar * u() },
    pace: 1, gazeM: 0, gaze: 0, roll: 0, rollV: 0, dip: 0, F: 0, M: 0, rate: 0, hold: 0,
    wet: [false, false], blades: new Float64Array(12), tmp: new Float64Array(12),
    waterY: clips.json.kayak.draft,
  };
}

// one step; the caller moves the hull (F, M) and sets st.body.roll from the hull's roll before the pose
export function strokeStep(st, a, dt) {
  const { clips, sex, opts: O } = st, w = a.w, v = a.v ?? 0;
  st.t += dt;
  const events = [];
  const b = clips.blade(sex, w, st.ph, st.body, st.blades);
  const dR = st.waterY - b[1], dL = st.waterY - b[4], side = dR >= dL ? 0 : 1, depth = Math.max(dR, dL);
  const hold = smooth(O.depth[0], O.depth[1], depth);
  // v1's pace in the air: the clip's rate, each paddler's own (±8 %) and v1's slow wander (±4 %, seeded)
  const wander = 1 + 0.025 * Math.sin(2 * Math.PI * 0.093 * st.t + st.wa) + 0.015 * Math.sin(2 * Math.PI * 0.051 * st.t + st.wb);
  const rateAir = clips.rate(sex, w, st.ph) * st.rateK * wander;
  // the pace: 1 in the air; in the water the factor on v1's pace that carries the clip's blade aft, on the stroke's mean,
  // at the kayak's speed plus the slip (mostly its own local speed; the sprint keeps most of the clip's rhythm through the
  // pull: its local blade speed would make the catch kick a judder), faded in by the blade's hold and by how fast the clip moves it the stroke's way (at
  // the catch it moves down and forward first). It is a smooth function of the phase and the speed, so the phase's rate
  // has no step and no lag (a lag is slip: v1's two easing stages at 16/s let the blade run back 40 % at 0.6 m/s)
  let target = 1;
  if (hold > 0) {
    const E = O.dzWin, zp = clips.blade(sex, w, st.ph + E, st.body, st.tmp)[2 + 3 * side], zm = clips.blade(sex, w, st.ph - E, st.body, st.tmp)[2 + 3 * side];
    const dz = (zp - zm) / (2 * E);   // m per unit phase (+ aft): its mean over ±dzWin (a smooth rate, the clip's catch kick averaged)
    const back = Fsign(w) < 0, along = back ? -dz : dz;   // the blade's speed the stroke's way (back paddling: forward)
    const ub = Math.max(Math.abs(v) * (1 + O.slip) * (back === v < 0 ? 1 : 0), O.relMin);
    const lock = hold * smooth(0.3, 0.9, along);
    // the blade speed the pace locks to (BACKLOG-v2 #45): the stroke's mean (the wet window's travel over its time) blended
    // toward the clip's own speed here (its mean over ±dzWin, at this phase's pace) by the gait's share O.local. The mean
    // alone left the blade wobbling 2-5 cm in the world inside a stroke (the clip's blade runs faster and slower than its
    // mean); the local speed alone brought back the sprint's catch jerks (its blade comes in slow, then fast), so the sprint
    // takes a quarter of it. The local speed has a floor (localFloor of the mean): where the clip's blade barely moves aft
    // the pace would race
    const um = bladeSpeed(st, w) * st.rateK * wander;
    const ul = Math.max(O.localFloor * um, along * rateAir);
    let K = 0, ws = 0;
    for (const g of GAITS) { const wg = w[g] ?? 0; K += wg * (O.local[g] ?? 0); ws += wg; }
    const uc = um + (ws > 0 ? K / ws : 0) * (ul - um);
    target = 1 + lock * (Math.min(3, Math.max(0.12, ub / uc)) - 1);
  }
  st.pace = target;
  const rate = rateAir * st.pace;
  st.rate = rate; st.hold = hold;
  st.ph = (((st.ph + rate * dt) % 1) + 1) % 1;
  // the force and its turn (the share of the blend that paddles each gait)
  let Fp = 0, Fs = 0;
  for (const g of GAITS) { const wg = w[g] ?? 0; if (!wg) continue; Fp += wg * O.force[g]; if (g === 'cruise' || g === 'sprint' || g === 'back') Fs += wg * O.force[g]; }
  const gain = 1 + 2 * Math.max(0, 1 - Math.abs(v) / 1.15) ** 1.2;
  const xb = b[3 * side];
  st.F = Fp * hold * gain;
  st.M = -Fs * hold * gain * xb * O.arm;
  // the hull's roll toward the working blade (a spring) and the dip with the pull (v1's floatFull)
  const Fref = Math.max(1, Math.abs(Fp));
  const rollTo = -O.roll * Math.min(1.5, Math.abs(st.F) / Fref) * Math.sign(xb || 1);
  const W = O.rollW;
  st.rollV += (W * W * (rollTo - st.roll) - 2 * O.rollZeta * W * st.rollV) * dt; st.roll += st.rollV * dt;
  st.dip += (Math.min(0.25, Math.abs(st.F) * 0.0025) - st.dip) * (1 - Math.exp(-6 * dt));
  // the catch and the exit (v1's readBlades: in past 3 cm, out at the surface)
  for (let s = 0; s < 2; s++) {
    const d = s ? dL : dR, wet = st.wet[s] ? d > 0 : d > 0.03;
    if (wet !== st.wet[s]) events.push({ type: wet ? 'catch' : 'exit', side: s, at: [b[3 * s], b[3 * s + 1], b[3 * s + 2]], tip: [b[6 + 3 * s], b[7 + 3 * s], b[8 + 3 * s]] });
    st.wet[s] = wet;
  }
  // the head's look at the sloop (a.lookDeg, else the mind's a.look: deg + to starboard): within its range, eased in two stages
  const lk = a.lookDeg !== undefined ? a.lookDeg : a.look;
  const want = lk == null || !Number.isFinite(lk) ? 0 : Math.max(-O.look, Math.min(O.look, lk * DEG));
  const k = 1 - Math.exp(-dt / O.lookTau);
  st.gazeM += (want - st.gazeM) * k; st.gaze += (st.gazeM - st.gaze) * k;
  st.body.yaw = st.gaze;
  return { F: st.F, M: st.M, events };
}

// each gait's own blade speed through the kayak frame while held (m/s at v1's pace: the wet window's travel over its time),
// for this paddler's body (its own rotation and reach move the blade too); worked out the first time a gait paddles
// (192 phases, ≈ 0.3 ms); the blend's is the weighted mean
function bladeSpeed(st, w) {
  const { clips, sex } = st, U = (st.U ??= {});
  let u = 0, ws = 0;
  for (const g of GAITS) {
    const wg = w[g] ?? 0; if (!wg) continue;
    if (U[g] == null) {
      const N = 192, one = { [g]: 1 }, b = new Float64Array(12), W = clips.json.kayak.draft; let dzs = 0, ts = 0;
      for (let i = 0; i < N; i++) {
        const ph = (i + 0.5) / N; clips.blade(sex, one, ph, st.body, b);
        const dR = W - b[1], dL = W - b[4], side = dR >= dL ? 0 : 1;
        if (Math.max(dR, dL) < 0.02) continue;
        const z1 = clips.blade(sex, one, ph + 0.5 / N, st.body, b)[2 + 3 * side], z0 = clips.blade(sex, one, ph - 0.5 / N, st.body, b)[2 + 3 * side];
        dzs += Math.abs(z1 - z0); ts += 1 / N / clips.rate(sex, one, ph);
      }
      U[g] = ts > 0 ? dzs / ts : 1;
    }
    u += wg * U[g]; ws += wg;
  }
  return ws > 0 ? u / ws : 1;
}

// the head's look at the sloop (deg, + to starboard) or null: the mind's glance (src/sim/kayaks/mind.js a.look), else the
// sloop watched while it is near and not behind
export function lookAt(a, boat, O = STROKE) {
  if (a.look != null) return a.look;
  if (!boat) return null;
  const dx = boat.x - a.x, dz = boat.z - a.z;
  if (Math.hypot(dx, dz) > O.lookNear) return null;
  const off = Math.atan2(Math.sin(Math.atan2(dx, -dz) - a.heading), Math.cos(Math.atan2(dx, -dz) - a.heading));
  return Math.abs(off) <= O.lookBack ? off / DEG : null;
}

// the gait's mean force in the hull model (src/sim/kayaks/agent.js GAIT): what the full kayak's stroke force replaces
export function meanForce(w) { let F = 0; for (const g in GAIT) F += (w[g] ?? 0) * GAIT[g].F; return F; }
