// Day Sail's seamanship rules (moved from src/sail/seamanship.js, a pure seam: no three, no DOM; seamanship.js re-exports
// them, so v1's callers are unchanged; v2/sim/seamanship.js reads them): the lever's repeat, the anchoring's arrival
// camera, the engine-off line's rule, the sunrise wait's numbers, the dock's icons, the next sunrise.
import { analyticSun } from '../sim/timeOfDay.js';

const DEG = Math.PI / 180;

export const SEA = {
  leverRate: 0.55,                // (the helm view's drag) lever travel per second
  repeatS: 0.3,                   // a held + − steps a notch this often
  arrival: { slowMs: 0.3, holdS: 10, riseS: 9, holdWideS: 14, backS: 4, backM: 62, upM: 26, fov: 46 },
  nudge: { sailS: 20, fill: 0.8, minTws: 3.5, minSog: 1.5, showS: 10 },
  sunrise: { fadeS: 1.6, darkS: 0.8, before: 0.35 },   // the clock set to 0.35 h before the sun's rise: the glow first
};
export const ICONS = {
  sails: '<path d="M11 3v15M11 4.5C7.2 8 5.8 12.5 6.4 17H11M12.5 7C15.8 10 17.2 13.5 17 17h-4.5"/><path d="M4 20.5h16"/>',
  engine: '<rect x="4" y="9" width="12" height="9" rx="1.2"/><path d="M8 9V6.5h4V9M16 12h2.5l1.5-1.5v6L18.5 15H16M4 13.5H2.5M7 21v-3M13 21v-3"/>',
  anchor: '<circle cx="12" cy="4.6" r="1.8"/><path d="M12 6.4V20M8 9.5h8M4.5 13.5a7.5 7.5 0 0 0 15 0M4.5 13.5l-1.3 2M19.5 13.5l1.3 2"/>',
  lines: '<circle cx="8" cy="12" r="4.2"/><path d="M12.2 12c2.5 0 3-3 5.3-3S21 11 21 11M12.2 12c2.5 0 3 3 5.3 3"/>',
};

// The engine-off line's rule (pure; tests/seamanship.test.mjs): the engine running while the sails draw on their own
// (full, a breeze, the boat moving) for sailS seconds: once a session, never again whether it was heeded or not, and
// never for a player the skill model calls a sailor (skills.muted) or who has the sails down.
export class EngineNudge {
  constructor(N = SEA.nudge) { this.N = N; this.t = 0; this.done = false; }
  update(dt, s, { muted = false } = {}) {
    if (this.done) return false;
    const sailing = s.engineState === 'running' && (s.furl ?? 0) < 0.2 && (s.mainFill ?? 0) >= this.N.fill && (s.trueWind?.speed ?? 0) >= this.N.minTws && (s.sog ?? 0) >= this.N.minSog;
    this.t = sailing ? this.t + dt : 0;
    if (muted && this.t > 0) { this.done = true; return false; }
    if (this.t >= this.N.sailS) { this.done = true; return true; }
    return false;
  }
}

// The hour of the next sunrise (unwrapped: past `fromHour`), the sun's upper limb at −0.83° (analytic sun)
export function nextSunrise(fromHour, sunAt = analyticSun) {
  const elev = (h) => { const s = sunAt(((h % 24) + 24) % 24); return Math.asin(s.y / Math.hypot(s.x, s.y, s.z)) / DEG; };
  for (let h = Math.floor(fromHour * 60) / 60 + 1 / 60; h < fromHour + 30; h += 1 / 60) if (elev(h - 1 / 60) < -0.83 && elev(h) >= -0.83 && (h % 24) < 12) return h;
  return null;
}
