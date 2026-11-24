// The race's picture on the water as segments (the layout render/raceLines.js draws: 12 floats a segment).
// Pure: no GPU (v2/tests/regatta.test.mjs, regatta-guidance.test.mjs: counts ≤ MAX_SEGMENTS, no NaN, the laylines' colours, each
// phase's pieces). The writer owns one Float32Array made once; a rebuild writes into it from the start and allocates nothing.
//   const W = createSegmentWriter();  const n = buildRaceLines(W, pic);  RL.write(W.f32, n)
// One thing at a time (owner 2026-11-16, the guidance pass):
//   the pre-start   the start line (cream, its posts), the ghost and its path (amber), the "stay below" guide, leg 1 dashed faint;
//                   nothing later (no other leg, no laylines, no zone)
//   racing          the CURRENT leg only, dashed cream from the boat to the next mark, its dashes marching toward the mark; a faint
//                   "then" leg (that mark → the one after; amber for THEN_LIT_S on the coach's nextLeg cue; none on a compact screen); the start
//                   line faint and unlit; the laylines only near the mark (LAY.showM) and only the one to tack on (amber; Pro shows the
//                   other, cream); the zone ring (cream, amber inside); the rounding gate on the side not to pass (marks.js gateArc)
//   the last leg    the finish line only (the chequer at 6 px), the pin's post cream, the leg dashed to the line's middle; no mark,
//                   no layline, no zone (the committee boat's pillar is the beacon's: render/waymark.js)
//   pic: { line, clock, ocs, gunLitS, ghost, ghostHeading, legs, leg, started, laylines: { port, stbd } | null, zone: { at, r, inside, rounding } | null,
//          finish: bool (the last leg), path: [x, z] | null (the boat, for the dashed path to the ghost), boat: [x, z] (the current leg's
//          start), march: s (the dashes' clock), thenLit: bool, compactScreen: bool (the race's compact plates: regatta/ui.js), markM: m (the boat to the next mark),
//          gate: { at, r, rounding, a, hot } | null (a: the boat's bearing angle from the mark, marks.js gateArc; hot: brightened, near
//          the mark and not counted yet), legLit: bool (the leg just begun by a rounding: amber for LEG.litS),
//          layTarget: 'port' | 'stbd' | null (the layline she meets first), layTargetM: metres to it,
//          aids: { ghost, ghostPath, laylines, turnArrow, level } (the level's, R3; absent: all on),
//          lit: Set of the coach's cues ('line', 'ghost', 'laylines' (the target one), 'layline:port' | 'layline:stbd', 'zone', 'nextLeg', 'gate', 'finish'):
//          their segments carry the pulse flag (render/raceLines.js: the glow breathes, the core brightens),
//          trail: [[x, z]…] | null (a time trial: the best run's path, faint amber dashes), trailBoat: { x, z, heading } | null (the
//          best run's ghost at this race clock: the gold hull outline) }
import { MAX_SEGMENTS, SEG_FLOATS } from '../render/raceLines.js';
import { ring, ZONE_M } from './geometry.js';
import { gateArc, GATE } from './marks.js';
import { BOAT_LENGTH_M } from '../../src/sim/race/course.js';

// the brand's colours on the water (cream the course, amber a lit/next state): linear RGB 0–1 and alpha. The laylines
// are cream too, never red and green (owner 2026-11-15: "normally a red line means cross it, you die"; a non-sailor reads a red line
// as danger): the one she should tack on lights amber and breathes, so each reads as a target to reach, not a wall
export const INK = Object.freeze({
  cream: [0.95, 0.90, 0.76, 1], creamFaint: [0.95, 0.90, 0.76, 0.45], amber: [1.0, 0.62, 0.12, 1], amberFaint: [1.0, 0.62, 0.12, 0.6],
  layline: [0.95, 0.90, 0.76, 0.85], navy: [0.05, 0.08, 0.20, 0.9],
  // the rounding gate only (owner 2026-11-16): port and starboard's own colours, never a line across the path
  port: [0.86, 0.14, 0.12, 1], stbd: [0.12, 0.78, 0.34, 1],
});
// R3: the laylines with a wide glow and wider with distance (render/raceLines.js far); 2026-11-15: thin and calm at rest (3 px, a 9 px
// glow; R3's red and green were 5 + 14), the lit one 5 + 18
export const WIDTH = Object.freeze({ line: 3, lineGlow: 9, post: 3, guide: 1.6, course: 2, layline: 3, laylineGlow: 9, laylineLit: 5, laylineLitGlow: 18, zone: 2.5, ghost: 2, finish: 6, leg: 2.5, then: 1.6, gate: 3, gateHot: 5, gateHotGlow: 14, legLit: 4, legLitGlow: 9 });
// the layline she should tack on (the one her heading meets first) lights on the coach's cue or within nearM of it; the laylines show
// only with the boat within showM (2.5 zone radii) of the mark or of that layline (owner 2026-11-16: "only within ~2.5× the zone")
export const LAY = Object.freeze({ nearM: 40, showM: 2.5 * ZONE_M });
// the current leg's dashes march toward the mark at marchMs (m/s); the "then" leg lights amber for thenLitS on the coach's cue; on a
// rounding the new leg lights amber for litS, its dashes marching (owner 2026-11-17: "leg 2 didn't light up")
export const LEG = Object.freeze({ dashM: 5, marchMs: 1, thenLitS: 3, litS: 2.5 });

const pack = (c) => ((Math.round(c[0] * 255) & 255) | ((Math.round(c[1] * 255) & 255) << 8) | ((Math.round(c[2] * 255) & 255) << 16) | ((Math.round(c[3] * 255) & 255) << 24)) >>> 0;
const PACKED = new Map();
const packed = (c) => { let p = PACKED.get(c); if (p == null) { p = pack(c); PACKED.set(c, p); } return p; };

export function createSegmentWriter(max = MAX_SEGMENTS) {
  const f32 = new Float32Array(max * SEG_FLOATS), u32 = new Uint32Array(f32.buffer);
  let n = 0, pulse = 0, far = 0;
  const W = {
    f32, u32, max,
    // the pulse flag on the segments written next (the coach's lit cue)
    lit(on) { pulse = on ? 1 : 0; return W; },
    // the far flag on the segments written next (the laylines: wider with distance, render/raceLines.js)
    far(on) { far = on ? 2 : 0; return W; },
    get n() { return n; },
    reset() { n = 0; pulse = 0; far = 0; return W; },
    // one segment a(x, y, z) → b(x, y, z); o: { w (px), glow (px), col, dash (m), phase (m) }
    seg(ax, ay, az, bx, by, bz, w, glow, col, dash = 0, phase = 0) {
      if (n >= max) return false;
      const o = n * SEG_FLOATS;
      f32[o] = ax; f32[o + 1] = ay; f32[o + 2] = az; f32[o + 3] = w;
      f32[o + 4] = bx; f32[o + 5] = by; f32[o + 6] = bz; f32[o + 7] = glow;
      u32[o + 8] = packed(col); f32[o + 9] = dash; f32[o + 10] = phase; f32[o + 11] = pulse + far;
      n++; return true;
    },
    // on the water (y = 0)
    flat(a, b, w, glow, col, dash = 0, phase = 0) { return W.seg(a[0], 0, a[1], b[0], 0, b[1], w, glow, col, dash, phase); },
    poly(pts, w, glow, col, dash = 0) { let along = 0; for (let i = 1; i < pts.length; i++) { W.flat(pts[i - 1], pts[i], w, glow, col, dash, along); along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); } },
  };
  return W;
}

// a boat's outline on the water (the ghost): a pointed bow, a square stern, `len` m long, heading h
function hullOutline(W, at, h, col, len = BOAT_LENGTH_M, beam = 2.9) {
  const f = [Math.sin(h), -Math.cos(h)], r = [Math.cos(h), Math.sin(h)], P = (a, s) => [at[0] + f[0] * a + r[0] * s, at[1] + f[1] * a + r[1] * s];
  const L = len / 2, B = beam / 2;
  W.poly([P(L, 0), P(L * 0.25, B), P(-L, B * 0.8), P(-L, -B * 0.8), P(L * 0.25, -B), P(L, 0)], WIDTH.ghost, 4, col);
  W.seg(at[0], 0, at[1], at[0], 9, at[1], WIDTH.ghost, 4, col);   // her mast: the ghost stands up out of the water
}

// the turn arrow round a mark (a three-quarter arc at 0.6 of the zone, the way the rounding goes, an arrowhead at its end);
// port rounding: the mark on your left, so the boat turns counter-clockwise as seen from above (x east, z south: the angle
// in the screen sense decreasing). The rounding gate reuses it: a shorter sweep, its own colour and width, `heads` arrowheads
// spread along it (the last at its end)
function turnArrow(W, at, r, rounding, col, a0 = 0, { sweep = 1.5 * Math.PI, heads = 1, w = WIDTH.zone, glow = 5, hs = 4 } = {}) {
  const ccw = rounding === 'port', sgn = ccw ? -1 : 1, n = 24, pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + sgn * sweep * (i / n); pts.push([at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r]); }
  W.poly(pts, w, glow, col);
  for (let h = 0; h < heads; h++) {
    const k = Math.max(2, Math.round(n * (h + 1) / heads)), e = pts[k], p = pts[k - 2], d = [e[0] - p[0], e[1] - p[1]], l = Math.hypot(d[0], d[1]) || 1, u = [d[0] / l, d[1] / l], nn = [-u[1], u[0]];
    W.flat(e, [e[0] - u[0] * hs + nn[0] * hs * 0.7, e[1] - u[1] * hs + nn[1] * hs * 0.7], w, glow, col);
    W.flat(e, [e[0] - u[0] * hs - nn[0] * hs * 0.7, e[1] - u[1] * hs - nn[1] * hs * 0.7], w, glow, col);
  }
}

// the laylines from the zone's edge out (the zone's cream ring stays the mark's own), solid (the course is dashed). Only near the mark
// (LAY.showM of the mark or of the target layline) and only the target one, amber (pic.layTarget: the one her heading meets first);
// Pro shows the other too, cream. The coach's cue ('laylines' the target, 'layline:<side>' that side) or LAY.nearM of it lights it
export function laylinesShown(pic) {
  const aids = pic.aids ?? ALL;
  if (!pic.laylines || !aids.laylines || pic.finish) return [];
  const near = Math.min(pic.markM ?? Infinity, pic.layTarget ? (pic.layTargetM ?? Infinity) : Infinity) < LAY.showM;
  if (!near) return [];
  const out = [];
  if (pic.layTarget) out.push(pic.layTarget);
  if (aids.level === 'pro') for (const sd of ['port', 'stbd']) if (!out.includes(sd)) out.push(sd);
  return out;
}
function laylineLines(W, pic, lit, sides) {
  const all = lit.has('laylines'), near = pic.layTarget && (pic.layTargetM ?? Infinity) < LAY.nearM, r0 = pic.zone?.r ?? 0;
  W.far(true);
  for (const sd of sides) {
    const [m, e] = pic.laylines[sd], len = Math.hypot(e[0] - m[0], e[1] - m[1]) || 1, u = [(e[0] - m[0]) / len, (e[1] - m[1]) / len];
    const target = pic.layTarget === sd, on = (target && (all || near)) || lit.has(`layline:${sd}`);
    W.lit(on);
    W.flat([m[0] + u[0] * r0, m[1] + u[1] * r0], e, on ? WIDTH.laylineLit : WIDTH.layline, on ? WIDTH.laylineLitGlow : WIDTH.laylineGlow, target || on ? INK.amber : INK.layline);
  }
  W.lit(false); W.far(false);
}

// the rounding gate: an arc at GATE.zoneK zone radii on the side of the mark she must not pass, arrowheads the way round; green when
// the mark is left to port, red when to starboard (owner 2026-11-16). hot (owner 2026-11-17: near the mark and not counted yet, or
// the coach's wrong-side cue): wider, a wide glow, breathing (the pulse flag), so she sees what is missing
export const gateInk = (rounding) => (rounding === 'starboard' ? INK.port : INK.stbd);
function gateLines(W, g, lit = false) {
  const A = gateArc(g.a ?? 0, g.rounding, GATE.sweep), hot = !!g.hot || lit;
  W.lit(hot);
  turnArrow(W, g.at, g.r, g.rounding, gateInk(g.rounding), A.a0, { sweep: GATE.sweep, heads: GATE.heads, w: hot ? WIDTH.gateHot : WIDTH.gate, glow: hot ? WIDTH.gateHotGlow : 6, hs: Math.max(3, g.r * (hot ? 0.12 : 0.09)) });
  W.lit(false);
}

// a dashed leg whose dashes march toward its end at LEG.marchMs (the phase counted from the end, so the pattern sits on the mark, not
// on the moving boat)
function marching(W, a, b, w, glow, col, t) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), P = 2 * LEG.dashM;
  W.flat(a, b, w, glow, col, LEG.dashM, -(((len + (t ?? 0) * LEG.marchMs) % P) + P) % P);
}

const ALL = Object.freeze({ ghost: true, ghostPath: true, laylines: true, turnArrow: true });
const NONE_LIT = new Set();
export function buildRaceLines(W, pic) {
  W.reset();
  const aids = pic.aids ?? ALL, lit = pic.lit ?? NONE_LIT;
  const L = pic.line, pre = pic.clock < 0, gunLit = pic.clock >= 0 && pic.clock < (pic.gunLitS ?? 4), last = !!pic.finish && !pre;
  const legs = pic.legs ?? [], leg = Math.max(0, Math.min(legs.length - 1, pic.leg ?? 0)), boat = pic.boat ?? null;
  // the start line, its posts at the committee boat and the pin: lit before the gun and at it; faint once racing; gone on the last leg
  // (the finish takes its place; the pin keeps a cream post, the committee boat the beacon's pillar)
  const loud = pre || gunLit || pic.ocs, lineCol = pic.ocs ? INK.amber : pre ? INK.cream : gunLit ? INK.amber : INK.creamFaint;
  W.lit(lit.has('line'));
  if (!last || pic.ocs) {
    W.flat(L.pin, L.committee, WIDTH.line, loud ? WIDTH.lineGlow : 0, lineCol);
    for (const e of [L.pin, L.committee]) W.seg(e[0], 0, e[1], e[0], 7, e[1], WIDTH.post, pre || gunLit ? 6 : 0, lineCol);
  } else { const F = pic.finishLine ?? L; W.seg(F.pin[0], 0, F.pin[1], F.pin[0], 9, F.pin[1], WIDTH.post + 1, 5, INK.cream); }
  W.lit(false);
  if (pre) {
    // the "stay below" guide 20 m under the line, dashed
    W.flat([L.pin[0] - L.up[0] * 20, L.pin[1] - L.up[1] * 20], [L.committee[0] - L.up[0] * 20, L.committee[1] - L.up[1] * 20], WIDTH.guide, 0, INK.creamFaint, 3);
    // the gold ghost, "be here at 0:00", and the dashed path to it
    if (pic.ghost && aids.ghost) {
      W.lit(lit.has('ghost'));
      hullOutline(W, pic.ghost, pic.ghostHeading ?? 0, INK.amber);
      if (pic.path && aids.ghostPath) W.flat(pic.path, pic.ghost, WIDTH.guide, 0, INK.amberFaint, 2.5);
      W.lit(false);
    }
    // leg 1 only, dashed faint (where the race goes after the gun)
    if (legs[0]) W.flat(legs[0].from, legs[0].to, WIDTH.course, 0, INK.creamFaint, LEG.dashM, 0);
  } else if (legs[leg]) {
    // the current leg: from the boat to its mark (the last leg: to the line's middle), dashed cream, marching
    const g = legs[leg];
    W.lit(!!pic.legLit);
    marching(W, boat ?? g.from, g.to, pic.legLit ? WIDTH.legLit : WIDTH.leg, pic.legLit ? WIDTH.legLitGlow : 3, pic.legLit ? INK.amber : INK.cream, pic.march);
    W.lit(false);
    // then: that mark to the one after (none on the last leg, none on a compact screen), faint; amber for a moment on the coach's cue
    const n = legs[leg + 1];
    if (n && !last && !pic.compactScreen) { W.lit(!!pic.thenLit); W.flat(n.from, n.to, WIDTH.then, pic.thenLit ? 5 : 0, pic.thenLit ? INK.amber : INK.creamFaint, LEG.dashM, 0); W.lit(false); }
  }
  // a time trial (step C): the best run's path, faint, and its ghost where it was at this clock (racing only)
  if (!pre && pic.trail?.length > 1) W.poly(pic.trail, WIDTH.guide, 0, INK.amberFaint, 2.5);
  if (!pre && pic.trailBoat) hullOutline(W, [pic.trailBoat.x, pic.trailBoat.z], pic.trailBoat.heading, INK.amber);
  // the laylines near the mark, the target one only (Pro: both)
  const sides = pre ? [] : laylinesShown(pic);
  if (sides.length) laylineLines(W, pic, lit, sides);
  // the next mark's zone, the turn arrow inside it, the rounding gate outside it (never on the last leg)
  if (pic.zone && !last && !pre) {
    const z = pic.zone, col = z.inside ? INK.amber : INK.cream;
    W.lit(lit.has('zone'));
    W.poly(ring(z.at, z.r, 48), WIDTH.zone, z.inside ? 7 : 3, col);
    if (z.inside && aids.turnArrow) turnArrow(W, z.at, z.r * 0.6, z.rounding, INK.amber, z.a0 ?? 0);
    W.lit(false);
  }
  if (pic.gate && !last && !pre) gateLines(W, pic.gate, lit.has('gate'));
  // a place race: the gate to pass, a line between its two buoys (red to port: the buoys say the side); the finish of its
  // own (pic.finishLine). Tessie's ring is never drawn (owner, 2026-11-20: "let Tessie happen naturally, from the human's eye"): her
  // drone, her dark shape under the water, the coach's line and the water breaking before the breach are the warning
  if (pic.gateLine && !last && !pre) { const g = pic.gateLine; W.flat(g.green, g.red, WIDTH.gate, 5, INK.cream, 0); }
  // the finish: the line lit and chequered (cream and navy dashes over each other)
  if (last) {
    const F = pic.finishLine ?? L;
    W.lit(lit.has('finish'));
    W.flat(F.pin, F.committee, WIDTH.finish, 10, INK.cream, 0);
    W.lit(false);
    W.flat(F.pin, F.committee, WIDTH.finish - 2, 0, INK.navy, 3, 3);
  }
  return W.n;
}
