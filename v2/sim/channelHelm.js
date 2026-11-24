// The entrance channel's helm (v2/terrain/channel.js: the trough carved through Emerald Bay's bar, a 36 m floor, 4 m deep): the
// navigator (src/sim/modes/chill/navigator.js) keeps open water's rules, a beat's tacks and a run's gybes, and a 36 m lane has room
// for neither, so while the boat is in the channel on her way through it this steers her down its line, as a skipper does in a
// marked channel; the navigator's own sails, trim and engine stay. Used by AUTO (sim/autoNav.js) and Cruise (cruise/voyage.js).
// Pure (no DOM).
//   const H = createChannelHelm({ chart })          chart: the whole-lake chart (ui/planChart.js: channel, channelSide)
//   H.heading(state, dest) → rad | null              the heading to steer while in the channel toward dest's side, else null
// Channel markers (BACKLOG, 2026-11-18; sim/channelMarks.js): she keeps to the starboard side of the line (keepM, COLREG rule 9),
// so outbound she passes the green buoys close to starboard and the red to port, inbound the red to starboard ("red right
// returning"), clear of both rows (the buoys stand 24 m off the line, so 18 m off her track).
import { channelAt } from '../terrain/channel.js';
import { KEEP_RIGHT_M } from './channelMarks.js';

export const CHANNEL_HELM = Object.freeze({ inM: 45, endM: 25, lookM: 40, keepM: KEEP_RIGHT_M });

export function createChannelHelm({ chart, K = CHANNEL_HELM }) {
  const C = chart?.channel, pts = C?.pts ?? [];
  const runs = [0]; for (let i = 1; i < pts.length; i++) runs.push(runs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = (s) => {
    s = Math.max(0, Math.min(runs.at(-1), s));
    for (let i = 1; i < pts.length; i++) if (s <= runs[i] || i === pts.length - 1) { const t = (s - runs[i - 1]) / (runs[i] - runs[i - 1]); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
    return pts.at(-1);
  };
  let sideKey = null, side = null;
  return {
    active: false,
    heading(s, dest) {
      this.active = false;
      if (!C || !dest) return null;
      const c = channelAt(s.x, s.z, C);
      if (c.d > K.inM || c.along < -K.endM || c.along > c.length + K.endM) return null;
      const key = `${Math.round(dest[0])},${Math.round(dest[1])}`;
      if (key !== sideKey) { sideKey = key; side = chart.channelSide?.(dest) ?? null; }
      if (!side) return null;
      const end = side === 'lake' ? c.length : 0, dir = side === 'lake' ? 1 : -1;
      if (Math.abs(c.along - end) <= K.endM) return null;   // through: the navigator again
      const s1 = c.along + dir * K.lookM, q = [...at(s1)], sA = Math.max(0, Math.min(runs.at(-1) - 1, s1)), a = at(sA), b = at(sA + 1);
      const dx = (b[0] - a[0]) * dir, dz = (b[1] - a[1]) * dir, L = Math.hypot(dx, dz) || 1;
      q[0] += (-dz / L) * K.keepM; q[1] += (dx / L) * K.keepM;   // to starboard of the line, going this way (right of (dx, dz) is (−dz, dx))
      this.active = true;
      return Math.atan2(q[0] - s.x, -(q[1] - s.z));
    },
  };
}
