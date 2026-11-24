// Lakeshore sail geometry (M5 mainsail, M6 jib): the two sail surfaces in the RIG frame, and a stub state.
// Plain JS, no three.js, so the meshes, the lines (M7) and the node tests share one set of formulas.
//
// RIG frame (src/boat/dims.js): origin at the mast step on deck, metres, +y up, bow toward −z, +x starboard.
// The 'main' and 'jib' sockets sit at that origin and don't rotate: the sails place themselves from the state.
// Angles follow src/boat/contract.js: boomAngle / jibAngle in radians off the centreline, + to starboard (+x), so the
// boom points along (sin a, 0, cos a): in three.js terms rotation.y = +boomAngle about the gooseneck pin.
//
// The physics state (contract.js STATE) → sail descriptors by sailParams():
//   main: { boomRad, fill (0 luffing .. 1 full), draft (0..1 fullness), reef }
//   jib:  { sheetRad, fill, draft, furl (0..1 on the roller; the reef rolls it: 0, 0.3, 0.55), backed (0..1) }
import { DEFAULT_DIMS } from '../sim/boat/dims.js';
// this page's boat (its profile, src/vessels/current.js): the sails' shape is per page
const { RIG } = DEFAULT_DIMS;
export { RIG };

// f4's spar points (src/boat/spars.js): the main's luff runs in the mast track, the foot on the boom from its pivot,
// and the jib's luff on the forestay (stem pin → hounds tang, through RIG.tack).
import { SPARS, solveRig } from './spars.js';
import { clamp } from '../sim/core/math.js';
export const LUFF_Z = SPARS.luffZ;
export const GOOSENECK_PIN = [0, SPARS.gooseneck, SPARS.goosenZ];
export const STAY_A = SPARS.stem, STAY_B = [0, SPARS.hounds, SPARS.houndsZ];
const stayAt = (y) => [0, y, STAY_A[2] + (y - STAY_A[1]) * (STAY_B[2] - STAY_A[2]) / (STAY_B[1] - STAY_A[1])];
export const jibTack = stayAt(RIG.tack[1]);         // the drum's top
export const jibHeadPt = stayAt(RIG.head[1]);       // on the stay at RIG.head's height
const JIB_FURL_BY_REEF = [0, 0.3, 0.55];

const DEG = Math.PI / 180;
// A table indexed 0, 1, 2 read at a continuous position (the reef animating between steps).
const stepLerp = (tab, x) => { const c = Math.max(0, Math.min(tab.length - 1, x)), i = Math.min(tab.length - 2, Math.floor(c)); return tab[i] + (tab[i + 1] - tab[i]) * (c - i); };
import { smooth } from '../sim/core/math.js';

// Camber profile along the chord: 0 at the luff and the leech, 1 at the draft position (≈ 42 % aft).
export function camber(u) {
  const p = 0.42;
  return u < p ? 1 - ((p - u) / p) ** 2 : 1 - ((u - p) / (1 - p)) ** 2;
}

// Flutter: a travelling wave along the chord, growing aft; deterministic in t. sails.js mirrors it in TSL (keep in step). A little luffing bubbles the front
// third; a full luff flogs the whole sail, most at the leech.
function flutter(u, v, t, luff, chord) {
  if (luff <= 0 || t === null) return 0;   // t = null: the steady shape (the mesh adds the flutter on the GPU)
  const wave = Math.sin(2 * Math.PI * (2.2 * u - 3.1 * t) + 5.0 * v) * 0.6 + Math.sin(2 * Math.PI * (3.7 * u - 4.3 * t) + 2.0 * v + 1.3) * 0.4;
  const bubble = luff * (1 - smooth(0.0, 0.35, u)) * 0.6;
  const flog = smooth(0.4, 1.0, luff) * (0.3 + 0.7 * u);
  return (bubble + flog) * 0.06 * chord * wave;   // 0.06: sails.js FLUTTER
}

// The standing rigging the cloth bears on: the shrouds (cap, intermediate, lowers) and the spreaders on the sail's side.
// The cloth never passes through them: eased to the shrouds, the main's belly bears on them from aft (the wires crossed
// the cloth's middle from astern at the boom's 60–72°); hard in, the jib's leech bears on the forward lower from inside.
// In plan, about the section's luff point, a cloth point's angle off the centreline aft (+ toward the sail's side) is
// held on the cloth's own side of each wire's point at that height, by the wire's radius and a hand of clearance;
// the hold fades out ≈ 0.9 m along the chord from the wire, so the cloth creases over it and bellies again beyond.
const RIGGING = solveRig(SPARS);
const BEAR = { clear: 0.025, flat: 0.12, fade: 0.9, spreaderBand: [0.06, 0.3], endBand: 1.5, reach: [0.05, 0.35, 0.8] };   // m; reach: the fade past the leech starts 5 cm out, over 0.35 of the section's reach, at most 0.8 m
const SPANS = RIGGING.wires.filter((w) => /^(cap|inter|lower)/.test(w.name)).flatMap((w) =>
  w.pts.slice(1).map((b, k) => ({ a: w.pts[k], b, r: w.r, wire: w.name.split('_')[0] })));
// each wire's top end (the lowers and the intermediates meet the mast there): its hold carries on above it, fading over
// BEAR.endBand, so the cloth eases off the wire's end instead of springing back in one row (a hard-in jib held on the lowers
// turned ≈ 65–85° between two rows at their top: drawn as two halves, owner 2026-11-16)
const ENDS = RIGGING.wires.filter((w) => /^(cap|inter|lower)/.test(w.name)).map((w) => {
  const top = w.pts.reduce((m, p) => (p[1] > m[1] ? p : m)), foot = w.pts.reduce((m, p) => (p[1] < m[1] ? p : m));
  return { p: top, sx: Math.sign(foot[0]), r: w.r, wire: w.name.split('_')[0] };   // sx: the wire's side (its top sits by the mast)
});
const SPREADER_PTS = SPARS.spreaders.flatMap((sp, i) => [0.4, 0.6, 0.8, 1].map((f) => {
  const tip = RIGGING.points.tips[i];
  return { x: tip[0] * f, y: sp.y + (tip[1] - sp.y) * f, z: tip[2] * f, r: 0.016, wire: 'cap' };   // the tip carries the cap
}));
// the wires' points at height y on the sail's side (side ±1), written into the scratch lists B_X, B_Z, B_R, B_W, B_WIRE,
// B_SPR (entry i: x, z, r, w, wire, spreader; w: 1, or a spreader's weight by height; wire: the wire's name without its side,
// 'cap' for a spreader); returns how many. No allocation per call (refactor round 3, B3: it ran per sail point per boat); a
// caller reads the lists before the next call
const B_MAX = SPANS.length + ENDS.length + SPREADER_PTS.length;
const B_X = new Float64Array(B_MAX), B_Z = new Float64Array(B_MAX), B_R = new Float64Array(B_MAX), B_W = new Float64Array(B_MAX), B_SPR = new Uint8Array(B_MAX), B_WIRE = new Array(B_MAX).fill('');
function put(n, x, z, r, w, wire, spreader) { B_X[n] = x; B_Z[n] = z; B_R[n] = r; B_W[n] = w; B_WIRE[n] = wire; B_SPR[n] = spreader ? 1 : 0; return n + 1; }
function bearingsAt(y, side) {
  let n = 0;
  for (let i = 0; i < SPANS.length; i++) {
    const { a, b, r, wire } = SPANS[i];
    if (a[0] * side <= 0 || (y - a[1]) * (y - b[1]) > 0 || a[1] === b[1]) continue;
    const f = (y - a[1]) / (b[1] - a[1]);
    n = put(n, a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f, r, 1, wire, false);
  }
  for (let i = 0; i < ENDS.length; i++) {
    const e = ENDS[i], above = y - e.p[1];
    if (e.sx !== side || above <= 0 || above >= BEAR.endBand) continue;
    n = put(n, e.p[0], e.p[2], e.r, 1 - smooth(0, BEAR.endBand, above), e.wire, false);
  }
  for (let i = 0; i < SPREADER_PTS.length; i++) {
    const p = SPREADER_PTS[i], w = 1 - smooth(BEAR.spreaderBand[0], BEAR.spreaderBand[1], Math.abs(y - p.y));
    if (w > 0) n = put(n, p.x * side, p.z, p.r, w, p.wire, true);
  }
  return n;
}
// Hold the point p ([x, y, z], changed in place) on the cloth's side of the rigging. lx, lz: the section's luff point;
// side: the sail's side (±1); reach: the section's length (a wire past it is out of the cloth's way); keep(wire): which
// side of that wire the cloth keeps, −1 aft / inside (the smaller angle), +1 forward / outside.
function bear(p, lx, lz, side, reach, keep, luffSoft = 0) {
  const dx = (p[0] - lx) * side, dz = p[2] - lz, r = Math.hypot(dx, dz);
  if (r < 0.02) return p;
  let a = Math.atan2(dx, dz);
  const a0 = a, nearHold = luffSoft > 0 ? smooth(0.02, luffSoft, r) : 1;   // luffSoft (the jib): the hold fades in off the luff
  for (let i = 0, n = bearingsAt(p[1], side); i < n; i++) {
    const bx = (B_X[i] - lx) * side, bz = B_Z[i] - lz, rb = Math.hypot(bx, bz);
    // a wire inside the section's reach holds in full; one past the leech holds less the further past it is (BEAR.reach: the fade
    // scales with the section, so a short head is not pulled round the mast): a hard cut at reach + 5 cm switched a wire's hold on and off between two heights (≈ 12° of turn in one row where a hard-in jib's leech passes the
    // lowers by the mast, and at a backed jib's head): a fold across the cloth, the jib drawn in two halves (owner, 2026-11-16)
    const past = B_SPR[i] ? 0 : Math.min(BEAR.reach[2], BEAR.reach[1] * reach);   // a spreader keeps the hard cut (its 0.3 m band would pinch)
    if (rb < 0.05 || rb > reach + BEAR.reach[0] + past) continue;
    const inReach = past > 0 ? 1 - smooth(reach + BEAR.reach[0], reach + BEAR.reach[0] + past, rb) : 1;
    const k = keep(B_WIRE[i]), lim = Math.atan2(bx, bz) + k * (B_R[i] + BEAR.clear) / rb;
    const over = (a - lim) * -k;   // > 0: on the wire's wrong side
    if (over <= 0) continue;
    a += k * over * B_W[i] * inReach * nearHold * (1 - smooth(BEAR.flat, BEAR.fade, Math.abs(r - rb)));
  }
  if (a !== a0) { p[0] = lx + side * r * Math.sin(a); p[2] = lz + r * Math.cos(a); }
  return p;
}

// The mainsail: (u chord 0 luff → 1 leech, v height 0 foot → 1 head) → [x, y, z] in the RIG frame. The luff runs up
// the mast track; the foot follows the boom, swung by boomRad; the cloth bellies to the boom's side.
// out: an [x, y, z] to write into (the sail mesh reuses one; a new array when absent)
export function mainPoint(u, v, s, t = 0, out = [0, 0, 0]) {
  const r = mainRow(v, s);
  const off = r.side * r.depth * camber(u) + flutter(u, v, t, r.luff, r.chord);
  const d = u * r.chord;
  out[0] = r.sin * d + r.cos * off; out[1] = r.y; out[2] = LUFF_Z + r.cos * d - r.sin * off;
  // the main lies aft of the shrouds and the spreaders (the boom stops at the aft lower)
  return bear(out, 0, LUFF_Z, r.side, r.chord, KEEP_AFT);
}
const KEEP_AFT = () => -1;
// A line beside the main (the halyards down the mast): a point q ([x, y, z], changed in place) on the
// belly's side and inside the belly goes out onto it, `clear` m off the cloth: the cloth presses the line out, never
// passes through it. s: the main's descriptor (sailParams().main).
export function outsideMain(q, s, clear = 0.02) {
  const hoist = RIG.mainLuff * (1 - stepLerp(RIG.reefs, s.reef ?? 0)) * (1 - 0.97 * clamp(s.drop ?? 0, 0, 1));
  const v = (q[1] - RIG.gooseneck) / hoist;
  if (!(v >= 0 && v <= 1)) return q;
  const r = mainRow(v, s), dx = q[0], dz = q[2] - LUFF_Z;
  const along = dx * r.sin + dz * r.cos, across = (dx * r.cos - dz * r.sin) * r.side;
  if (across <= 0 || along < 0 || along > r.chord) return q;
  const need = r.depth * camber(along / r.chord) + clear;
  if (across >= need) return q;
  const a = need * r.side;
  q[0] = along * r.sin + a * r.cos; q[2] = LUFF_Z + along * r.cos - a * r.sin;
  return q;
}
// A line inside the main's belly (the lazy jacks): a point q ([x, y, z], changed in place) that lies past the cloth's
// inner face toward the belly's side is held `clear` m inside it, on the windward face. The leeward jacks left the
// mast beside the luff, outside the cloth, and ran into it ≈ 0.15–0.2 m aft (the belly leaves the luff steeper than
// the jack): held inside from their first point off the mast, the only crossing is within the mast's own width at the
// luff groove (the caller puts its first held points within a few cm of the mast), and the rest of each jack keeps its
// line. A held point lies on the belly's concave side, so the segments between held points stay inside too.
// s: the main's descriptor (sailParams().main).
export function insideMain(q, s, clear = 0.02) {
  const hoist = RIG.mainLuff * (1 - stepLerp(RIG.reefs, s.reef ?? 0)) * (1 - 0.97 * clamp(s.drop ?? 0, 0, 1));
  const v = (q[1] - RIG.gooseneck) / hoist;
  if (!(v >= 0 && v <= 1)) return q;
  const r = mainRow(v, s), dx = q[0], dz = q[2] - LUFF_Z;
  const along = dx * r.sin + dz * r.cos, across = (dx * r.cos - dz * r.sin) * r.side;
  if (along < 0 || along > r.chord) return q;
  const lim = r.depth * camber(along / r.chord) - clear;
  if (across > lim) { const a = lim * r.side; q[0] = along * r.sin + a * r.cos; q[2] = LUFF_Z + along * r.cos - a * r.sin; }
  // the cloth's own hold on the shrouds (mainPoint's bear) moves the point as it moves the cloth: the order is kept
  return bear(q, 0, LUFF_Z, r.side, r.chord, KEEP_AFT);
}
// A line's first leg with points 2, 5 and 12 cm off its first point (a new array): insideMain then holds the line inside
// the belly from right beside the mast
export function offMast(pts) {
  const [a, b] = pts, L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const mid = [0.02, 0.05, 0.12].filter((d) => d < L * 0.8).map((d) => [a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L, a[2] + (b[2] - a[2]) * d / L]);
  return [a, ...mid, ...pts.slice(1)];
}
// The per-height constants of the main, cached for the last (v, s): the mesh evaluates a whole row at one v.
let mrV = NaN, mrS = null, mr = null;
function mainRow(v, s) {
  if (v === mrV && s === mrS) return mr;
  const hoist = RIG.mainLuff * (1 - stepLerp(RIG.reefs, s.reef ?? 0)) * (1 - 0.97 * clamp(s.drop ?? 0, 0, 1));   // drop: the sail down on the boom
  const chord = RIG.boom * (1 - v) + RIG.mainHead * v + RIG.roach * 4 * v * (1 - v);
  const side = Math.sign(s.boomRad) || 1;
  // The leech opens to leeward with height; most of the twist is in by mid-height (a straight leech read flat).
  // pro: the extra twist (state.mainTwistX, the physics' degrees past neutral) drawn × PRO_DRAW, so ± 6° reads at 40 m
  const th = s.boomRad + side * (RIG.mainTwistDeg + PRO_DRAW * (s.twistX ?? 0)) * (1 - (1 - v) ** 2) * DEG;
  const luff = 1 - clamp(bandFill(s, v), 0, 1);
  const depth = RIG.mainDraft * clamp(s.draft ?? 1, 0, 1) * (1 - luff) * chord * (0.75 + 0.25 * Math.sin(Math.PI * clamp(v * 1.1, 0, 1)));
  mrV = v; mrS = s;
  mr = { chord, side, luff, depth, sin: Math.sin(th), cos: Math.cos(th), y: RIG.gooseneck + v * hoist };
  return mr;
}

// The jib: v along the forestay from the tack to the head, u from the luff toward the clew.
export function jibPoint(u, v, s, t = 0, out = [0, 0, 0]) {
  jibCloth(u, v, s, t, out);
  // the cloth keeps the side of each shroud its clew is on: hard in, inside the forward lower; eased past the
  // chainplates, outside them
  const L2 = jibTack[2] + (jibHeadPt[2] - jibTack[2]) * v;
  const reach = (RIG.jibLP * (1 - v) + RIG.jibHead * v) * (1 - clamp(s.furl ?? 0, 0, 1));
  // luffSoft 0.25 m: a point 2 cm off the head's luff was left free and the next turned ≈ 80° (a hard-in or backed jib's head)
  return bear(out, 0, L2, Math.sign(s.sheetRad) || 1, reach, jibKeep(s), 0.25);
}
const keepMemo = new WeakMap(), CLEW = [0, 0, 0];
function jibKeep(s) {
  let k = keepMemo.get(s);
  if (k) return k;
  const side = Math.sign(s.sheetRad) || 1, c = jibCloth(1, 0, s, null, CLEW);
  const ac = Math.atan2(c[0] * side, c[2] - jibTack[2]), by = {};
  for (let i = 0, n = bearingsAt(c[1], side); i < n; i++) { if (B_W[i] === 1) by[B_WIRE[i]] = ac < Math.atan2(B_X[i] * side, B_Z[i] - jibTack[2]) ? -1 : 1; }
  k = (wire) => by[wire] ?? -1;
  keepMemo.set(s, k);
  return k;
}
function jibCloth(u, v, s, t, out) {
  const L1 = jibTack[1] + (jibHeadPt[1] - jibTack[1]) * v, L2 = jibTack[2] + (jibHeadPt[2] - jibTack[2]) * v;   // the luff point (x 0)
  const furl = clamp(s.furl ?? 0, 0, 1);
  const chord = (RIG.jibLP * (1 - v) + RIG.jibHead * v) * (1 - furl);
  const backed = clamp(s.backed ?? 0, 0, 1);
  const sheetSide = Math.sign(s.sheetRad) || 1;
  const side = sheetSide * (1 - 2 * backed);                       // backed: pushed inside out
  const th = s.sheetRad + sheetSide * (RIG.jibTwistDeg + PRO_DRAW * (s.twistX ?? 0)) * v ** 1.2 * DEG;   // pro: the lead's twist
  // The foot rises aft: the tack is on the bow deck, the clew clears the cabin top (≈ 0.25 m over it at the clew).
  const dx = Math.sin(th), dy = 0.15 * (1 - v), dz = Math.cos(th);
  const n = Math.hypot(dx, dy, dz);
  const luff = 1 - clamp(bandFill(s, v), 0, 1);
  // pro: the car forward deepens the foot, aft flattens it (the lower third most)
  const depth = RIG.jibDraft * clamp(s.draft ?? 1, 0, 1) * (1 - luff) * chord * (1 - 0.3 * (s.lead ?? 0) * (1 - v) ** 2);
  const off = side * depth * camber(u) + flutter(u, v, t, luff, chord);
  const d = u * chord / n;
  out[0] = 0 + dx * d + Math.cos(th) * off; out[1] = L1 + dy * d; out[2] = L2 + dz * d - Math.sin(th) * off;
  return out;
}

// pro (feat/pro-sailing): the physics' two bands per sail (state.mainLowFill / mainTopFill …): the cloth luffs by
// height, the head first when over-twisted. fillLow / fillTop absent: the whole sail's fill.
const PRO_DRAW = 1.5;
const BAND_V = [0.3, 0.75];
export function bandFill(s, v) {
  if (s.fillTop == null) return s.fill ?? 1;
  return s.fillLow + (s.fillTop - s.fillLow) * smooth(BAND_V[0], BAND_V[1], v);
}

// the stall (0..1) by height from the bands' angles of attack (15–25°, as the physics' mainStall / jibStall)
export function bandStall(st, k, v) {
  const lo = smooth(15 * DEG, 25 * DEG, st[`${k}LowAoA`] ?? 0), top = smooth(15 * DEG, 25 * DEG, st[`${k}TopAoA`] ?? 0);
  return lo + (top - lo) * smooth(BAND_V[0], BAND_V[1], v);
}

// The physics state (contract.js STATE) → the two sail descriptors.
export function sailParams(state) {
  // state.reefing: the reef's position, continuous 0..2, ramping over ≈ 4 s (S1); state.reef is the target step.
  const reef = state.reefing ?? state.reef ?? 0;
  return {
    // state.furl (feat/engine-anchor): the crew's sails down, 0..1: the main comes down onto the boom (drop), the jib
    // rolls up on its furler
    main: { boomRad: state.boomAngle ?? 0, fill: state.mainFill ?? 1, draft: state.mainDraft ?? 1, reef, ...(state.furl > 0 ? { drop: state.furl } : {}), ...proBands(state, 'main') },
    jib: { sheetRad: state.jibAngle ?? 0, fill: state.jibFill ?? 1, draft: state.jibDraft ?? 1,
      furl: Math.max(stepLerp(JIB_FURL_BY_REEF, reef), state.furl ?? 0, state.gk?.jibFurl ?? 0),   // the gennaker up: the jib rolled away
      backed: state.jibBacked ? 1 : 0, ...proBands(state, 'jib') },
  };
}

// pro: the bands and the twist, only when the physics reports them and they differ from the plain sail (so a basic
// state keeps the same descriptor, and the same cached mesh)
function proBands(st, k) {
  const lo = st[`${k}LowFill`], top = st[`${k}TopFill`], tx = st[`${k}TwistX`] ?? 0, lead = k === 'jib' ? st.jibLead ?? 0 : 0;
  const o = {};
  if (lo != null && top != null && Math.abs(lo - top) > 1e-3) { o.fillLow = lo; o.fillTop = top; }
  if (Math.abs(tx) > 1e-3) o.twistX = tx;
  if (Math.abs(lead) > 1e-3) o.lead = lead;
  if (k === 'main' && Math.abs(st.traveller ?? 0) > 1e-3) o.trav = st.traveller;
  return o;
}

// Key points for the lines (M7) and the spars, in the RIG frame.
export const boomPoint = (boomRad, along) => [GOOSENECK_PIN[0] + Math.sin(boomRad) * along, GOOSENECK_PIN[1], GOOSENECK_PIN[2] + Math.cos(boomRad) * along];
export const jibClew = (jib, t = 0) => jibPoint(1, 0, jib, t);

// Sail area by integrating the surface (m²), for the tests and the reef / furl numbers.
export function area(pointFn, s, nu = 40, nv = 60) {
  let a = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const p00 = pointFn(i / nu, j / nv, s), p10 = pointFn((i + 1) / nu, j / nv, s);
    const p01 = pointFn(i / nu, (j + 1) / nv, s), p11 = pointFn((i + 1) / nu, (j + 1) / nv, s);
    for (const [a0, b0, c0] of [[p00, p10, p11], [p00, p11, p01]]) {
      const ab = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]], ac = [c0[0] - a0[0], c0[1] - a0[1], c0[2] - a0[2]];
      a += 0.5 * Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    }
  }
  return a;
}

// --- Stub state (the demo and the tests, until S1) ---------------------------------------------------------------
// A contract.js STATE from the apparent wind and the controls, with's rules: the sail goes to leeward
// until its sheet stops it or it lines up with the wind; under ≈ 3° of attack it luffs; inside ≈ 25° everything flogs.
// main / jib: how far the sheet lets the sail out, 0 sheeted in .. 1 eased (80° / 75°), as contract.js controls.
export function stubState({ awaDeg = 45, awsMs = 6, main = 0.2, jib = 0.18, flatten = 0, reef = 0, backed = false } = {}) {
  const awa = ((awaDeg + 540) % 360) - 180, off = Math.abs(awa);
  const lee = awa >= 0 ? -1 : 1;                                   // wind from starboard → sails to port
  const mainOut = Math.min(main * 80, Math.max(0, off - 1)), jibOut = Math.min(Math.max(jib * 75, 6), Math.max(0, off - 1));
  const fillOf = (alpha) => 1 - (1 - smooth(0, 3, alpha) * 0.85 - smooth(3, 8, alpha) * 0.15);
  const irons = 1 - smooth(15, 28, off);
  return {
    boomAngle: lee * mainOut * DEG, jibAngle: (backed ? -lee : lee) * jibOut * DEG,
    mainFill: Math.min(fillOf(off - mainOut), 1 - irons), jibFill: backed ? 1 : Math.min(fillOf(off - jibOut), 1 - irons),
    mainDraft: 1 - 0.6 * flatten, jibDraft: 1 - 0.6 * flatten, jibBacked: backed, reef,
    apparentWind: { speed: awsMs, angle: awa * DEG },
    heel: lee * clamp(awsMs * 1.6 * Math.sin(off * DEG), 0, 25) * DEG * (1 - irons),   // heels to leeward
  };
}
