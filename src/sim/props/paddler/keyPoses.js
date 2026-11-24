// The paddler's key poses as data (split from src/props/paddler/poses.js for the shared sim; Sprint 0): the
// blocking stage's numbers, no three.js. The pose format and the frame are described in src/props/paddler/poses.js.
//   KEY_POSES[name]   a frozen pose (the starboard keys and their port mirrors)
//   mirror(pose, feather) → the same pose on the other side
const SEATED = Object.freeze({ hip: [0, 0.13, 0.07], heelL: [-0.20, 0.06, -0.62], heelR: [0.20, 0.06, -0.62] });

// starboard-side keys; the port side is their mirror (a right-hand-control paddle: the port power face comes round by the
// feather, roll −60°). Numbers from the reference frames (K3 § Reference): a low-angle recreational stroke, the blade in
// by the feet and out at the hip, the chest wound up at the catch and unwinding through the pull.
const R = {
  rest: { c: [0, 0.27, -0.30], e: 2, yaw: 0, roll: -90, twist: 0, lean: -8, side: 0, head: [16, 2] },
  // (round 10, owner: "longer reach": the catch by the feet, ≈ 0.8 m ahead of the hip, from the trunk wound 50° toward it
  // and a lean from the hips; the shaft swung further round, the blade nearer the bow)
  cruise_catchR: { c: [0.13, 0.405, -0.40], e: -31, yaw: 30, roll: 0, twist: 50, lean: 18, side: 0, head: [-10, -4] },
  cruise_pullR: { c: [0.06, 0.42, -0.29], e: -30, yaw: 9, roll: 0, twist: 20, lean: 10, side: 2, head: [-4, -4] },
  cruise_exitR: { c: [-0.011, 0.417, -0.25], e: -27.5, yaw: -26, roll: 0, twist: -20, lean: 4, side: 0, head: [0, -2] },
  // sprint: its own shapes, not cruise sped up: a higher shaft (the top hand at eye height), a longer reach, more rotation
  // and lean, the blade buried deeper and nearer the hull
  sprint_catchR: { c: [0.24, 0.70, -0.38], e: -60, yaw: 38, roll: 5, twist: 55, lean: 30, side: 0, head: [-6, -8] },
  sprint_pullR: { c: [0.112, 0.583, -0.36], e: -54.3, yaw: 6, roll: 5, twist: 22, lean: 20, side: 3, head: [-2, -8] },
  // a forward sweep on the starboard side (turns the bow to port): the shaft low and far out, the blade abeam at mid-arc
  sweep_midR: { c: [0.156, 0.397, -0.249], e: -32.3, yaw: 0.5, roll: 0, twist: 6.8, lean: 6, side: 6, head: [30, -10] },
  // a back stroke (brake) on the starboard side: the blade in behind the hip, pushing forward on its back face; the chest
  // wound the other way, the head turned to watch the blade
  back_midR: { c: [0.034, 0.496, -0.149], e: -39.3, yaw: -16.3, roll: 0, twist: -26, lean: -4, side: 2, head: [48, -12] },
  // --- stage 5–6 keys (after the owner's OK on the blocking, 2026-11-07): each loop's own in-between shapes ---
  // sprint exit: the blade out early at the hip, the chest already turning for the other side, still leaning in
  sprint_exitR: { c: [0.015, 0.549, -0.18], e: -42.5, yaw: -24, roll: 5, twist: -16, lean: 16, side: 0, head: [0, -6] },
  // the sweep's ends: in by the toes close to the hull, out behind the hip; the head follows the blade
  sweep_catchR: { c: [0.031, 0.561, -0.346], e: -42.8, yaw: 25.3, roll: 0, twist: 24.8, lean: 12, side: 2, head: [10, -10] },
  sweep_endR: { c: [0.142, 0.407, -0.168], e: -30.3, yaw: -36.3, roll: 0, twist: -26, lean: 0, side: 4, head: [45, -10] },
  // the back stroke's ends: in behind the hip (wound back, looking at it), out by the knee
  back_catchR: { c: [0.11, 0.434, -0.21], e: -34, yaw: -37.3, roll: 0, twist: -34, lean: -6, side: 2, head: [60, -12] },
  back_exitR: { c: [-0.053, 0.566, -0.233], e: -39.8, yaw: 9, roll: 0, twist: 10.3, lean: 4, side: 0, head: [20, -8] },
};

export function mirror(p, feather = 60) {
  return {
    ...p,
    c: [-p.c[0], p.c[1], p.c[2]], e: -p.e, yaw: -p.yaw, roll: p.roll === -90 ? -90 : -feather - p.roll,
    twist: -p.twist, side: -(p.side ?? 0), head: [-(p.head?.[0] ?? 0), p.head?.[1] ?? 0],
    ...(p.heelR ? { heelL: [-p.heelR[0], p.heelR[1], p.heelR[2]] } : {}), ...(p.heelL ? { heelR: [-p.heelL[0], p.heelL[1], p.heelL[2]] } : {}),
  };
}

export const KEY_POSES = (() => {
  const out = {};
  for (const [k, v] of Object.entries(R)) {
    out[k] = { ...SEATED, ...v };
    if (k.endsWith('R')) out[`${k.slice(0, -1)}L`] = { ...SEATED, ...mirror(v) };
  }
  return Object.freeze(out);
})();
