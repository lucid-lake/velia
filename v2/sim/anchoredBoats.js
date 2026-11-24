// Boats at anchor (owner, 2026-11-18: "on the map there are anchorages, but during the game the player doesn't know where to
// anchor; real sailors see props, signs, infrastructure"): one or two sloops lying to their anchors
// in each of Emerald Bay's charted anchorages, and one on a Boat Camp ball. Desktop and tablet only (src/core/features.js
// anchoredBoats). Each is the fleet's full-detail boat (render/boat.js setRivals: v1's models, no cabin), bare-poled (sails stowed),
// swinging to the wind on her rode: her bearing from the anchor eases toward downwind (tauS) and sheers either side of it
// (sheerDeg, over her own sheerS period, a real boat "sailing" on her anchor), the bow toward the anchor and yawing a little ahead of
// the swing. Her hull is three circles (bow, middle, stern) as light bodies on short rodes (v2/sim/channelMarks.js createMarkBodies),
// so the player's boat bumps her softly (an impulse with both masses; she gives a little and swings back). At night a white
// all-round riding light on her masthead (COLREGs rule 30) joins the night's glow list. They stand clear of the channel, every
// birthplace's start, the Sail start and the Regatta courses' design layouts (v2/tests/anchored-boats.test.mjs); in a race they
// stand down (none drawn, no bodies). Pure: no DOM, no GPU; deterministic (the sim clock only).
//   const AB = createAnchoredBoats(rows, { depthAt, balls })        rows: ANCHORED_BOATS; balls: the moorings' bodies (a 'ball' row)
//   AB.post(S, dt, t, windFromDeg(x, z))   the boat's tick (sea.addPost): the swing, the hull circles, the bump
//   AB.near(eye, max) → the boats within ANCHORED.drawM of the eye, nearest first: [{ boat, d }]
//   AB.lights(out, o, { sunElevDeg, heightAt, mastHead }) → n glow records (GLOW_FLOATS each)
//   AB.active = false: a race (nothing stepped, drawn or bumped)
import { createMarkBodies } from './channelMarks.js';
import { GLOW_FLOATS, NAV_GLOW, navLevel } from './night.js';

const DEG = Math.PI / 180;
import { wrap as wrapPi } from '../../src/sim/core/math.js';

export const ANCHORED = Object.freeze({
  scope: 4, catenary: 0.8,   // the rode out (scope × depth) and the share of its horizontal reach the boat lies at (the chain's sag)
  minR: 12, maxR: 45,        // m: the swing circle's radius (anchor to her middle) is kept in this range
  ballR: 8.5,                // m: on a mooring ball: the 4 m pennant and half her length
  tauS: 22,                  // s: her bearing from the anchor eases toward downwind this fast (a big shift: 1–2 min to lie to it)
  sheerDeg: 16, yawDeg: 9,   // her sheer either side of downwind, and the bow's yaw ahead of the swing
  sheerS: Object.freeze([48, 74]),   // the sheer's period (s), per boat between these (her phase too: no two in step)
  drawM: 2600,               // m: drawn within this of the eye (the bay's length; a boat this far is a few pixels)
  hull: Object.freeze([[2.7, 1.05], [0, 1.5], [-2.65, 1.25]]),   // the circles: m forward of her middle, radius m
  circleKg: 2600,            // each circle's mass (three: a heavier boat than the player's 3,765 kg, so she gives only a little)
  rode: Object.freeze({ period: 7, tau: 2.6, maxOff: 1.4 }),   // the circles' pull back to her swing (s, s, m: the most a bump shoves her)
  light: Object.freeze({ size: NAV_GLOW.size * 0.8, radiance: NAV_GLOW.radiance }),
  clear: Object.freeze({ channelM: 120, startM: 150, courseM: 90, mooringM: 30 }),   // m kept (the test's gates, from her swing circle's edge)
});

// the boats: the head of the bay is the real anchoring zone (the State Parks' order 683-25-005: from
// 150 yards north of Vikingsholm's pier south to Eagle Creek, out to the 60 ft contour), two boats there; one in the game's
// "Shallows by the narrows" (not a legal anchorage in reality); one on Boat Camp ball 2 (the lakeward row's west end, clear of the Bay Tour's line). tint: the
// topsides' colour (packTint), sheer: her phase 0–1
export const ANCHORED_BOATS = Object.freeze([
  Object.freeze({ id: 'anc-viking-1', anchorage: 'Anchorage off Vikingsholm', at: Object.freeze([-420, 12]), tint: '#1d3557', phase: 0.12 }),
  Object.freeze({ id: 'anc-viking-2', anchorage: 'Anchorage off Vikingsholm', at: Object.freeze([-452, 122]), tint: '#e9e4d8', phase: 0.61 }),
  Object.freeze({ id: 'anc-narrows-1', anchorage: 'Shallows by the narrows', at: Object.freeze([905, -1112]), tint: '#7a1f1f', phase: 0.37 }),
  Object.freeze({ id: 'anc-camp-2', anchorage: 'Boat Camp moorings', ball: 'boat-camp-2', tint: '#2f5d50', phase: 0.84 }),
]);

// her swing circle's radius at an anchor in depth d (m), or on a ball
export const swingRadius = (row, depth) => (row.ball ? ANCHORED.ballR : Math.max(ANCHORED.minR, Math.min(ANCHORED.maxR, Math.sqrt(Math.max(0, ANCHORED.scope ** 2 - 1)) * Math.max(0, depth) * ANCHORED.catenary)));
// her sheer period (s)
export const sheerPeriod = (row) => ANCHORED.sheerS[0] + (ANCHORED.sheerS[1] - ANCHORED.sheerS[0]) * (row.phase ?? 0);

// the swing (pure): her bearing from the anchor (rad, compass) eased toward downwind plus the sheer; the heading toward the anchor
// plus the yaw. state { theta }: theta null takes the target at once (a fresh page: she has lain there all day)
export function swingStep(state, row, dt, t, windFromDeg, K = ANCHORED) {
  const P = sheerPeriod(row), ph = 2 * Math.PI * (t / P + (row.phase ?? 0));
  const target = windFromDeg * DEG + Math.PI + K.sheerDeg * DEG * Math.sin(ph);
  if (state.theta == null) state.theta = target;
  else state.theta = wrapPi(state.theta + wrapPi(target - state.theta) * (1 - Math.exp(-Math.max(0, dt) / K.tauS)));
  state.heading = wrapPi(state.theta + Math.PI + K.yawDeg * DEG * Math.cos(ph));
  return state;
}

export function createAnchoredBoats(rows = ANCHORED_BOATS, { depthAt = () => 10, balls = [], onBump = null, K = ANCHORED } = {}) {
  const boats = [];
  for (const row of rows) {
    let ax, az, ball = null;
    if (row.ball) { ball = balls.find((b) => b.id === row.ball) ?? null; if (!ball) continue; ax = ball.x0 ?? ball.x; az = ball.z0 ?? ball.z; ball.boat = true; }   // the ball is taken: the tackle never picks it up
    else [ax, az] = row.at;
    const depth = depthAt(ax, az), r = swingRadius(row, depth);
    boats.push({ id: row.id, row, anchorage: row.anchorage, ax, az, depth, r, ball, theta: null, heading: 0, x: ax, z: az, ox: 0, oz: 0, tint: row.tint });
  }
  // the hull circles, three a boat, as light bodies on short rodes
  const circles = [];
  boats.forEach((b, i) => K.hull.forEach(([f, rr], k) => circles.push({ id: `${b.id}:${k}`, boat: i, f, x: b.ax, z: b.az, r: rr, mass: K.circleKg })));
  const bodies = createMarkBodies(circles, { onBump, rode: K.rode });
  let active = true, ticks = 0;
  const place = (b, t, dt, windFromDeg) => {
    swingStep(b, b.row, dt, t, windFromDeg, K);
    const ax = b.ball ? b.ball.x : b.ax, az = b.ball ? b.ball.z : b.az;   // on a ball she follows its own bob
    b.x = ax + Math.sin(b.theta) * b.r; b.z = az - Math.cos(b.theta) * b.r;
  };
  // the circles' stations from her swing, then the contact; her drawn place moves with their mean offset (a bump shoves her)
  function post(S, dt, t = 0, windFromDeg = () => 270) {
    if (!active) return;
    ticks++;
    for (const b of boats) place(b, t, dt, windFromDeg(b.ax, b.az));
    const bs = bodies.bodies;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i], b = boats[c.boat], fx = Math.sin(b.heading), fz = -Math.cos(b.heading), body = bs[i];
      const nx = b.x + fx * c.f, nz = b.z + fz * c.f;
      if (ticks === 1) { body.x = nx; body.z = nz; }   // the first tick: she is where her swing puts her
      body.x0 = nx; body.z0 = nz;
    }
    bodies.post(S, dt, t);
    for (const b of boats) { b.ox = 0; b.oz = 0; }
    for (let i = 0; i < circles.length; i++) { const b = boats[circles[i].boat], body = bs[i]; b.ox += (body.x - body.x0) / K.hull.length; b.oz += (body.z - body.z0) / K.hull.length; }
  }
  // the boats to draw: within drawM of the eye, nearest first, at most max
  const nearOut = [];
  function near(eye, max = 5) {
    nearOut.length = 0;
    if (!active) return nearOut;
    for (const b of boats) { const d = Math.hypot(b.x - eye[0], b.z - eye[2]); if (d < K.drawM) nearOut.push({ boat: b, d }); }
    nearOut.sort((p, q) => p.d - q.d);
    if (nearOut.length > max) nearOut.length = max;
    return nearOut;
  }
  // the riding lights: the masthead (mastHead: the hull frame's point, y up from the waterline) over her drawn place, by the night's
  // ramp (0 by day: nothing written)
  function lights(out, o, { sunElevDeg = 90, heightAt = () => 0, mastHead = [0, 12, 0] } = {}) {
    const level = navLevel(sunElevDeg);
    if (!active || !(level > 0)) return 0;
    const cap = Math.floor((out.length - o) / GLOW_FLOATS);
    let n = 0;
    for (const b of boats) {
      if (n >= cap) break;
      const x = b.x + b.ox, z = b.z + b.oz, fx = Math.sin(b.heading), fz = -Math.cos(b.heading), aft = mastHead[2];
      const w = o + n * GLOW_FLOATS;
      out[w] = x - fx * aft; out[w + 1] = heightAt(x, z) + mastHead[1]; out[w + 2] = z - fz * aft; out[w + 3] = -K.light.size;   // negative: a far point light (sim/night.js FAR_POINT: small and faint far off)
      out[w + 4] = 1.0; out[w + 5] = 0.95; out[w + 6] = 0.85; out[w + 7] = K.light.radiance * level;
      n++;
    }
    return n;
  }
  return { boats, bodies, post, near, lights, get stats() { return { boats: boats.length, bumps: bodies.stats.bumps, contacts: bodies.stats.contacts }; },
    get active() { return active; }, set active(v) { active = !!v; } };
}
