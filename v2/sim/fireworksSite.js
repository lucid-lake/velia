// The July 4th show's launch site (owner, 2026-11-18, after the A/B: "B at 1,000 m outside the mouth, plus the fireworks
// scene starting with the boat facing the mouth"). One URL row keeps the old site for comparisons (v2/engine/flags.js
// fwsite, fwsited):
//   mouth  (default) the two barges out on the big lake, fwsited m (1,000 by default) past the mouth on the bay's axis: the
//          line from the start through the channel's lake end (v2/terrain/channel.js), so the start looks out through the
//          mouth at them. Each barge's long axis square to that line, the pair SPREAD_M apart across it (the line between
//          them); the patrol boats on the start's side. Clear of the channel and its marks (> 900 m at 1,000 m)
//   bay    the wow round's two barges inside Emerald Bay, 250 m from v1's viewing spot (src/fireworks/stage.js bargesWorld):
//          170–260 m from the start, the bursts high overhead (the A/B's A)
// The fireworks scene faces the show (owner, 2026-11-18): a Sail page opened in the show's window, or a cut (the Fireworks
// pick) landing in it, turns the boat to face the barges where she is (from the start: about 60°, the mouth dead ahead), so
// the show is in the default Boat view from the first second. Cheat on where, not on motion: the turn is part of the cut.
// Pure (no DOM): the plug-in (living/fireworksPlugin.js), main.js, the tools (tools/fireworks/site_*.mjs), the tests.
//   fireworksSite(flags) → { id, d, barges, centre: [x, z], toward: [x, z] }
//   inShowScene(hour, pinned) → true inside the show's window (a minute before the first shell to the show's end)
//   facingShow(site, x, z) → the heading (deg) from (x, z) to the show's middle
//   showStartHeading(site, x, z, windFromDeg) → the heading the fireworks scene gives the boat (facing the show, SHOW_VIEW.offsetDeg off)
import { bargesWorld, VIEW } from '../../src/fireworks/stage.js';
import { SHOW_START_HOUR, SHOW_LENGTH } from '../../src/fireworks/show.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { CHANNEL } from '../terrain/channel.js';

export const SITE = Object.freeze({ dDefault: 1000, dMin: 300, dMax: 2500, spreadM: 160 });
export const SCENE = Object.freeze({ preS: 60, postS: 120, gameRate: 4 });   // v1's window: 4 game s a show s (sim/fireworks.js showTimeAt)

function mouthBarges(d = SITE.dDefault, { start = CURRENT_WATERS.start, pts = CHANNEL.pts, spreadM = SITE.spreadM } = {}) {
  const S = [start.x, start.z], E = pts.at(-1);
  const dx = E[0] - S[0], dz = E[1] - S[1], L = Math.hypot(dx, dz), u = [dx / L, dz / L];
  const c = [E[0] + u[0] * d, E[1] + u[1] * d];
  const bearing = ((Math.atan2(u[0], -u[1]) * 180 / Math.PI) + 360) % 360, a = bearing * Math.PI / 180;
  const axis = [Math.cos(a), Math.sin(a)];   // the viewer's right (stage.js bargesWorld's convention)
  return [-1, 1].map((s) => {
    const x = c[0] + axis[0] * s * spreadM / 2, z = c[1] + axis[1] * s * spreadM / 2;
    return { x, z, axis, bearing, d: Math.hypot(x - S[0], z - S[1]), toward: S };
  });
}

export function fireworksSite(flags = {}) {
  const id = flags.fwsite === 'bay' ? 'bay' : 'mouth';
  const raw = Number.isFinite(flags.fwsited) ? flags.fwsited : SITE.dDefault;
  const d = Math.min(SITE.dMax, Math.max(SITE.dMin, raw));
  const barges = id === 'mouth' ? mouthBarges(d) : bargesWorld();
  const centre = [barges.reduce((s, b) => s + b.x, 0) / barges.length, barges.reduce((s, b) => s + b.z, 0) / barges.length];
  const st = CURRENT_WATERS.start;
  return { id, d: id === 'mouth' ? d : null, barges, centre, toward: id === 'mouth' ? [st.x, st.z] : VIEW };
}

// the show's window on the day clock: from a minute (show s) before the first shell to two after the finale (v1's 4 game s a
// show s); pinned (?fwt): always
export function inShowScene(hour, pinned = false) {
  if (pinned) return true;
  if (hour == null || !Number.isFinite(hour)) return false;
  const h = ((hour % 24) + 24) % 24, t = ((h - SHOW_START_HOUR) * 3600) / SCENE.gameRate;
  return t >= -SCENE.preS && t < SHOW_LENGTH + SCENE.postS;
}
export const facingShow = (site, x, z) => ((Math.atan2(site.centre[0] - x, -(site.centre[1] - z)) * 180 / Math.PI) + 360) % 360;

// The show beside the mast (owner, 2026-11-18, filming the week-3 video: "the mast and mainsail sit dead in front of the show and
// hide its middle"): the fireworks scene turns her to face the show SHOW_VIEW.offsetDeg off, so in the default Boat view (the
// follow camera dead astern) the bursts stand clear to one side of the mast with the boat in frame. To starboard by default (the show
// on her port bow: from the start about 77.5°, the show left of the mast; 18°: the finale's 550 px spread stays in frame, clear of the mast, the shoal off the start further ahead that way); the other
// side when that heading is within SHOW_VIEW.ironsDeg of the wind and the other is not (never a start in irons: either side under
// it, the one further off the wind). windFromDeg: the true wind's direction (from) at her place; null keeps starboard
export const SHOW_VIEW = Object.freeze({ offsetDeg: 18, ironsDeg: 50 });
const offWind = (h, from) => Math.abs(((h - from + 540) % 360) - 180);
export function showStartHeading(site, x, z, windFromDeg = null) {
  const f = facingShow(site, x, z), wrap = (h) => ((h % 360) + 360) % 360;
  const a = wrap(f + SHOW_VIEW.offsetDeg), b = wrap(f - SHOW_VIEW.offsetDeg);
  if (windFromDeg == null || !Number.isFinite(windFromDeg)) return a;
  const ta = offWind(a, windFromDeg), tb = offWind(b, windFromDeg);
  if (ta >= SHOW_VIEW.ironsDeg || ta >= tb) return a;
  return b;
}

// The show's own start in deep water (fix/v2-fireworks-view-clouds, round 2; coordinator 2026-11-18: "start the show in deep water
// rather than hold the shoal assist off"): the general start (1200, −1050) looks at the show over the 1–3 m shelf toward the mouth,
// so the shoal assist bore her away from it about 10 s in. A page opened in the show's window (Sail, no ?start) starts here instead,
// 437 m north-west of the start, past the mouth's site only: 16.6 m or more for 500 m ahead along the show heading (77.4°: the show's
// first 60 s at Sail's 2x game speed is about 370 m, plus the assist's 8 s look ahead) and 9.6 m (8 m under the 1.6 m keel) for 60 m
// all round; both barges' bursts at 150 and 300 m clear of the land and the island (renders/fireworks-view/search.mjs, the
// occluder's own rays); the show 1.96 km off (was 1.65; a spot 230 m out met 300 m ahead but reached 6 m by 60 s). The bay's old
// site keeps the start. The Fireworks pick still turns her where she is (no move)
export const SHOW_START = Object.freeze({ x: 825, z: -825 });
export const showStartPose = (site) => (site?.id === 'mouth' ? { x: SHOW_START.x, z: SHOW_START.z } : null);
