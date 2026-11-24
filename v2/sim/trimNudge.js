// The trim camera nudge (owner, 2026-11-16): while the player trims (the sheet in their hand: W/S, the cockpit's winch, a
// phone's sheet ring; or a Pro control moving) the Boat view eases a little off the centreline toward the boom's side and a
// touch higher, so the boom and the sail's shape read side-on; NUDGE.holdS after the trimming stops it eases back. A
// critically damped spring on one amount (−1 … +1: the side), so it never jerks; it stands down (eases to none) during a
// camera drag and for NUDGE.dragHoldS after it, in the Helm view and under Cruise's autopilot; with Reduce Motion (reduced
// motion: its default follows the OS's setting) it is off at once. Applied to the follow camera's pose after it (the
// camera's own yaw, the player's, never changes): the pose turned round the boat by NUDGE.yawDeg × amount and raised by
// NUDGE.upDeg of its distance. Pure: v2/tests/trim-nudge.test.mjs.
const DEG = Math.PI / 180;

export const NUDGE = Object.freeze({ yawDeg: 15, upDeg: 4, tau: 0.6, holdS: 2, dragHoldS: 1 });

export function createTrimNudge(N = NUDGE) {
  let x = 0, v = 0, since = Infinity, sinceDrag = Infinity, side = 1;
  return {
    get amount() { return x; },
    // dt s; trimming: the player's trim this frame; dragging: a camera drag this frame; view 'follow' | 'helm'; cruise: the
    // autopilot sails; reduced: the OS's Reduce Motion; boom: the boom's angle (rad, + to starboard)
    update(dt, { trimming = false, dragging = false, view = 'follow', cruise = false, reduced = false, boom = 0 } = {}) {
      since = trimming ? 0 : since + dt;
      sinceDrag = dragging ? 0 : sinceDrag + dt;
      if (Math.abs(boom) > 3 * DEG) side = Math.sign(boom);
      if (reduced) { x = 0; v = 0; return x; }   // reduced motion: off, no movement at all
      // the Helm view, Cruise: eased back (the views' own move between the two blends the follow pose: no jump in it)
      const on = since <= N.holdS && sinceDrag > N.dragHoldS && !cruise && view === 'follow';
      const target = on ? side : 0;
      const w = 2 / N.tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt;
      x = target + (d + tmp) * e; v = (v - w * tmp) * e;
      if (target === 0 && Math.abs(x) < 1e-4 && Math.abs(v) < 1e-4) { x = 0; v = 0; }
      return x;
    },
  };
}

// the follow camera's pose { pos, target, fov } turned round c (the boat: follow.c) by the amount: the camera moves toward the
// boom's side (+ amount: the boom to starboard, the camera onto the starboard quarter) and up. A fresh pose; none when 0.
export function nudgePose(p, c, amount, N = NUDGE) {
  if (!amount) return p;
  const a = amount * N.yawDeg * DEG, ca = Math.cos(a), sa = Math.sin(a);
  // the azimuth convention of the follow camera (x = sin, z = −cos of a clockwise yaw): turning a point round c by a
  const turn = (q) => { const dx = q[0] - c[0], dz = q[2] - c[2]; return [c[0] + dx * ca + dz * sa, q[1], c[2] - dx * sa + dz * ca]; };
  const pos = turn(p.pos), target = turn(p.target);
  pos[1] += Math.hypot(p.pos[0] - c[0], p.pos[2] - c[2]) * Math.tan(Math.abs(amount) * N.upDeg * DEG);
  return { ...p, pos, target };
}
