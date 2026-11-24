// v1's capture-only close shots of the boat (?shot=<name>, src/boat/shots.js; that module is three.js, so its numbers are
// copied here): a target on the boat and a camera offset, both in the HULL frame (x starboard, y up, z aft), so the frame
// is the same whatever the heading and heel. M3b: the v1-over-v2 close comparisons. Pure.
//   shotPose(name, pose) → { pos, target, fov, near } (world) | null
export const SHOTS = Object.freeze({
  'cockpit-astern': { target: [0, 1.0, 1.8], cam: [0.55, 1.15, 4.4], fov: 46 },
  transom: { target: [0, 0.78, 4.18], cam: [0.7, 0.2, 2.3], fov: 38 },
  winch: { target: [1.33, 1.34, 2.65], cam: [0.45, 0.32, 0.55], fov: 36 },
  'above-behind': { target: [0, 1.0, 0.9], cam: [2.6, 7.4, 7.6], fov: 44 },
  pedestal: { target: [0, 1.15, 2.45], cam: [0.75, 0.55, 1.1], fov: 42 },
  'cockpit-above': { target: [0, 0.75, 2.2], cam: [0.9, 3.6, 3.4], fov: 48 },
  companionway: { target: [0, 0.9, 1.35], cam: [0.35, 1.0, 1.7], fov: 50 },
  // #35 (v2 only): the VHF set's close-up (tools/probe_bino.mjs vhf-set's camera on v1: 0.40 m off the face along its normal,
  // 0.05 m up its face, here 0.12 m to starboard, clear of the wheel; src/boat/vhfFace.js VHF.at, tilted 22°), for the v1 / v2 stills (tools/v2-vhf-shots.mjs)
  vhf: { target: [0.172, 1.268, 2.322], cam: [0.12, 0.40 * Math.sin(22 * Math.PI / 180) + 0.05 * Math.cos(22 * Math.PI / 180), 0.40 * Math.cos(22 * Math.PI / 180) - 0.05 * Math.sin(22 * Math.PI / 180)], fov: 30 },
  // #20 (v2 only): the boat's wind instruments' close-ups (render/boat/telltales.js; the rig's points + the mast step 1.463 m up,
  // 0.739 m forward): the masthead vane, the jib's luff telltales from either side, the main's leech
  vane: { target: [0, 12.62, -1.0], cam: [2.0, -0.9, 2.4], fov: 26 },
  'jib-tt-s': { target: [0.25, 4.6, -2.55], cam: [5.2, 0.4, 1.6], fov: 44 },
  'jib-tt-p': { target: [0.25, 4.6, -2.55], cam: [-5.2, 0.4, 1.6], fov: 44 },
  leech: { target: [0.6, 7.4, 1.0], cam: [2.2, -1.6, 6.4], fov: 40 },
  // look change (the life ring): the ring on the starboard stern pulpit (hardware.glb: centre x 1.34, 0.29 m above the freeboard, z 3.98)
  'life-ring': { target: [1.34, 1.24, 3.98], cam: [0.9, 0.25, 1.7], fov: 36 },
  stern: { target: [0.7, 1.15, 4.0], cam: [2.0, 0.55, 3.6], fov: 40 },
  quarter: { target: [0, 4.4, 1.6], cam: [6.0, 2.6, 10.5], fov: 50 },   // the starboard quarter, high: the main, the leech ribbons and the jib's yarns beside it
  trim: { target: [0.4, 5.0, -0.2], cam: [6.5, -0.6, -2.6], fov: 56 },   // the leeward side on port tack: the jib's leeward yarns and the main's leech in one frame
});

// a HULL-frame point to the world through the drawn pose (Boat.update: position · Ry(−heading) · Rx(pitch) · Rz(−heel))
export function hullToWorld(pose, p, out = [0, 0, 0]) {
  let [x, y, z] = p;
  const h = -(pose.heel ?? 0), ch = Math.cos(h), sh = Math.sin(h);
  [x, y] = [x * ch - y * sh, x * sh + y * ch];
  const t = pose.pitch ?? 0, ct = Math.cos(t), st = Math.sin(t);
  [y, z] = [y * ct - z * st, y * st + z * ct];
  const a = -pose.heading, ca = Math.cos(a), sa = Math.sin(a);
  [x, z] = [x * ca + z * sa, -x * sa + z * ca];
  out[0] = x + pose.x; out[1] = y + (pose.heave ?? 0); out[2] = z + pose.z;
  return out;
}

export function shotPose(name, pose) {
  const s = SHOTS[name];
  if (!s) return null;
  const target = hullToWorld(pose, s.target), pos = hullToWorld(pose, s.target.map((v, i) => v + s.cam[i]));
  return { pos, target, fov: s.fov, near: 0.05 };
}
