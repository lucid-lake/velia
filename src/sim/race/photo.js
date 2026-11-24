// The photo finish: when the second boat is within 2 s of the first at the line, the camera cuts to the committee
// boat's side view for 3 s and the sim runs at 0.25x (the only slow motion in the game), then the rate is restored and the card
// shows. Pure: the mode reads rate() and active, and draws the cut.
//   const p = createPhoto(); p.arm({ gapS });  p.step(realDt);  p.rate() → 1 | 0.25;  p.active;  p.done
import { PHOTO_S } from './results.js';

export const PHOTO = { holdS: 3, rate: 0.25 };
// seconds until a boat at pose reaches the line going toward the pre-start side (the finish crossing), Infinity if it is not closing
export function etaToLine(line, pose) {
  const side = (pose.x - line.centre[0]) * line.up[0] + (pose.z - line.centre[1]) * line.up[1];
  const closing = -(Math.sin(pose.heading) * line.up[0] - Math.cos(pose.heading) * line.up[1]) * Math.max(pose.u, 0);
  return side <= 0 ? 0 : closing > 0.2 ? side / closing : Infinity;
}
export function createPhoto({ P = PHOTO } = {}) {
  let t = 0, on = false, done = false;
  return {
    // armed when the first boat crosses and the other is closer than PHOTO_S seconds from the line; a gap of 2 s or more never triggers
    arm({ gapS }) { if (!on && !done && gapS != null && gapS < PHOTO_S) { on = true; t = 0; return true; } return false; },
    step(realDt) { if (on) { t += realDt; if (t >= P.holdS) { on = false; done = true; } } },
    rate() { return on ? P.rate : 1; },
    get active() { return on; }, get done() { return done; }, get t() { return t; },
    reset() { t = 0; on = false; done = false; },
  };
}

// the committee boat's side view of the line: the camera a little beyond the committee end, 3 m up, looking at the line's middle
export function photoCam(line) {
  const ex = line.committee[0] + (line.committee[0] - line.pin[0]) / line.len * 14, ez = line.committee[1] + (line.committee[1] - line.pin[1]) / line.len * 14;
  return { pos: [ex, 3, ez], target: [line.centre[0], 1.5, line.centre[1]] };
}
