// The Boat view's pose (owner, 2026-11-17, the last of the day's rounds: "To me this angle and distance is already good enough", with
// their frame: 1564 x 888, cockpit up, 5.3 kn on a broad reach: horizon about 53 % from the top, the vane about 27 %, the hull's
// bottom about 77 %, a strip of water over the cockpit's top, about 84 %). That frame is main's own Boat view with the orbit dragged
// to its floor: v1's distance (3.5 hull lengths, +0.08 per m/s of speed, and the follow's lag: about 36 m from her deck at 5.3 kn),
// pitch 8° (v1's lowest orbit), the 5.5° tilt. v1's follow camera (src/sim/boat/followCamera.js) with v2's own default:
//   BOAT_VIEW: pitch 8°, 3.95 hull lengths (35.9 m from her deck at rest), the tilt 5.5°, the eye about 6.4 m over the water.
//     Underway the follow camera lags behind her (about 0.86 m per m/s on the page): the negative speed pull (−0.09 hull lengths per
//     m/s) takes it back, so she keeps the owner's size from rest to hull speed (no pull-back with speed). At rest (no speed camera:
//     the narrowest lens, the boat largest) her stern still clears the guard bar; at speed the speed camera (sim/speedFeel.js) lowers
//     the eye 0.6 m and widens the lens 4°, eased per real dt (v1's 2° pitch breath is off in v2).
//   The drag's range: 3° to 75° (v1's floor was 8°, the default: now room both ways; the floor's eye 3.4 m over the water).
//   BOAT_VIEW_FLAT (a phone's flat controls: no cockpit, the rings in the corners, a top bar 12.8 % of the height): the same pose
//     (the vane about 26 %, well under the bar; the hull clear of the rings and the ⋯ button); its own row for a later change.
//   The tilt is a fixed angle (no time in it: every frame rate frames the same), applied last, after the speed camera, the trim
//     nudge and the knockdown's ease-out, so they compose.
// Sail's Boat view and Regatta (which takes the same follow pose); never Cruise (its astern view and director keep v1's pose:
// v2/sim/boat.js followPose('cruise')). ?camtilt=<deg> over the pose's tilt (0 none: the A/B); ?campitch, ?camdist: the orbit.
// Pure: v2/tests/cam-tilt.test.mjs.
const DEG = Math.PI / 180;
export const BOAT_VIEW = Object.freeze({ pitch: 8 * DEG, dist: 3.95, tiltDeg: 5.5, pitchMin: 3 * DEG, pitchMax: 75 * DEG, pitchBreath: 0, speedPull: -0.09, lookLowDeg: 3 });
// the flat controls' pose (a phone: no cockpit, the rings in the corners, a top bar 12.8 % of the height): the desk's (the vane well
// under the bar, the hull clear of the rings)
export const BOAT_VIEW_FLAT = Object.freeze({ ...BOAT_VIEW });
export const TILT = Object.freeze({ deg: BOAT_VIEW.tiltDeg });

// p { pos, target, fov } with the aim turned up by deg (about the eye, keeping the aim's distance and its yaw). A fresh pose.
export function tiltPose(p, deg = TILT.deg) {
  if (!p || !(deg !== 0)) return p;
  const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], hd = Math.hypot(d[0], d[2]), R = Math.hypot(hd, d[1]);
  if (!(hd > 1e-6)) return p;
  const el = Math.atan2(d[1], hd) + deg * DEG, c = Math.cos(el);
  return { ...p, target: [p.pos[0] + d[0] / hd * c * R, p.pos[1] + Math.sin(el) * R, p.pos[2] + d[2] / hd * c * R] };
}

