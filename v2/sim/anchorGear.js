// The ground tackle seen close (owner, 2026-11-18, at anchor in the bow camera: "The anchor line is too thin to be noticed, and
// too simple, missing details. Do we have an anchor? I only see a very thin line. These details are desktop only."). The pure
// half: no GPU, no DOM; node runs it (v2/tests/anchor-gear.test.mjs), the page draws from it (v2/render/anchorGear.js).
//   rodeShape({ h, X, L })        the chain's shape in its own plane: the roller at (0, h), the anchor's shackle at (X, 0) on the
//                                 bottom, L m of chain between them. Exact length, exact ends (a catenary fitted to the span, the
//                                 way chain really hangs). Kinds: 'hang' (straight down: falling, coming up), 'slack' (she lies
//                                 over it: the chain drops and the rest lies on the bottom in bights), 'touch' (the catenary to
//                                 where it touches down, then along the bottom), 'lifted' (all of it off the bottom), 'taut'
//                                 (straight: the nylon's stretch, a snatch). a = H / w, the catenary's parameter: the pull.
//   rodeAt(shape, s, out)        the point s m along the chain from the roller (0) to the shackle (L): [x, y, side]
//   rodeSag(shape)               the hanging part's sag below its chord (m)
//   gearPose(...)                where the anchor is: on the roller, sliding over it, hanging, on the bottom (setting in), breaking out
//   layLinks(...)                the chain's links along the roller, the deck and the catenary: a position and two axes a link,
//                                 alternate links turned 90° about the chain, the run's phase tied to the chain out (they run over
//                                 the roller as the chain does: the rattle's own speed), near the eye only (the LOD)
// The real thing: a 28–30 ft cruising sloop carries a 7–10 kg plough (Delta) on a bow roller, 8 or
// 10 mm galvanised short-link chain (10 mm: links about 30 mm pitch, 35 mm wide), a manual vertical windlass on the foredeck whose
// gypsy feeds the chain down a navel pipe into the locker; at 3 : 1 in 10 m the chain hangs in a catenary from the roller and
// straightens as she falls back on it.

export const GEAR = Object.freeze({
  // 10 mm (3/8 in) short-link chain, the heavier of a 30-footer's two usual sizes (8 mm read as a thread from the bow camera; the
  // owner: "too thin to be noticed")
  pitch: 0.030,            // m: the link pitch (inside length)
  wire: 0.010,             // m: its wire
  linkW: 0.035,            // m: a link's outside width
  linkL: 0.050,            // m: a link's outside length (pitch + 2 wire)
  nearM: 16,               // m from the eye: links drawn as links inside it, the thick line past it
  maxLinks: 1600,          // links drawn at most (≈ 40 m of chain)
  slideM: 0.5,             // m of chain the anchor takes to slide forward over the roller and tip down
  anchorLen: 0.62,         // m: shackle to the fluke's toe (the shank and the fluke, hanging)
  bury: 0.12,              // m the toe sinks into the bed once it is set
  toeY: 0.39,              // m: the toe under the shackle (the mesh's lowest point)
  setRoll: 0.18,           // rad it keeps of a list once set (it never sits dead upright)
  rollSide: 1.15,          // rad the anchor lies on its side on the bottom before it sets (it rights as it digs in)
  rattle: 0.004,           // m: a link's jump on the roller at full chain speed
  wetM: 0.6,               // m over the water the chain is still wet
});

import { clampT as clamp } from '../../src/sim/core/math.js';
import { lerp } from '../../src/sim/core/math.js';

// ---- the catenary ----
// the hanging length and span for a catenary of parameter a that is level at the bottom (touchdown) and reaches height h
const hangOf = (a, h) => { const s0 = Math.sqrt(h * h + 2 * h * a); return { s0, xs: a * Math.asinh(s0 / a) }; };

export function rodeShape({ h, X, L }) {
  h = Math.max(1e-3, h); X = Math.max(0, X); L = Math.max(0, L);
  const base = { h, X, L, a: 0, s0: 0, xs: 0, x0: 0, sg0: 0, bottom: 0, amp: 0, waves: 0 };
  if (L <= h + 1e-6 || X < 1e-4) return { ...base, kind: 'hang' };                              // straight down (falling, coming up)
  const chord = Math.hypot(X, h);
  if (L <= chord + 1e-6) return { ...base, kind: 'taut', a: Infinity };                          // straight (the nylon's stretch)
  // touching down: solve a for xs(a) + (L − s0(a)) = X, with s0(a) ≤ L
  const aMax = (L * L - h * h) / (2 * h);
  const span = (a) => { const { s0, xs } = hangOf(a, h); return xs + L - s0; };
  if (X <= L - h) {                                                                               // she lies over it: down, then bights on the bottom
    const a = 1e-3 * h, { s0, xs } = hangOf(a, h), bottom = L - s0, run = Math.max(1e-4, X - xs);
    // the bottom's chain in bights: a sine across the run (3 half-waves a 2 m, at least 2) whose length is the chain's
    const waves = Math.max(2, Math.round(run / 0.7)), k = Math.PI * waves / run;
    let lo = 0, hi = bottom;
    const lenAt = (amp) => { let s = 0, px = 0, py = 0; for (let i = 1; i <= 64; i++) { const x = run * i / 64, y = amp * Math.sin(k * x); s += Math.hypot(x - px, y - py); px = x; py = y; } return s; };
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (lenAt(m) < bottom) lo = m; else hi = m; }
    return { ...base, kind: 'slack', a, s0, xs, bottom, amp: (lo + hi) / 2, waves };
  }
  if (span(aMax) >= X) {
    let lo = 1e-3 * h, hi = aMax;
    for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (span(m) < X) lo = m; else hi = m; }
    const a = Math.sqrt(lo * hi), { s0, xs } = hangOf(a, h);
    return { ...base, kind: 'touch', a, s0, xs, bottom: L - s0 };
  }
  // lifted: the whole chain off the bottom; sqrt(L² − h²) = 2a sinh(X / 2a), the vertex x0 past the middle toward the anchor
  const need = Math.sqrt(L * L - h * h);
  let lo = 1e-3, hi = 1;
  while (2 * hi * Math.sinh(X / (2 * hi)) > need && hi < 1e7) hi *= 2;
  for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); if (2 * m * Math.sinh(X / (2 * m)) > need) lo = m; else hi = m; }
  const a = Math.sqrt(lo * hi), x0 = X / 2 + a * Math.asinh(h / (2 * a * Math.sinh(X / (2 * a))));
  return { ...base, kind: 'lifted', a, x0, sg0: a * Math.sinh(-x0 / a), s0: L };
}

// the point s m from the roller along the chain: [x (horizontal, toward the anchor), y (over the bottom), side (across, m)]
export function rodeAt(S, s, out = [0, 0, 0]) {
  s = clamp(s, 0, S.L);
  const { h, X, L } = S;
  out[2] = 0;
  if (S.kind === 'hang') { const k = L > 0 ? s / L : 0; out[0] = X * k; out[1] = h - Math.min(L, h) * k; return out; }
  if (S.kind === 'taut') { const k = L > 0 ? s / L : 0; out[0] = X * k; out[1] = h * (1 - k); return out; }
  if (S.kind === 'lifted') { const sg = S.sg0 + s, x = S.x0 + S.a * Math.asinh(sg / S.a); out[0] = x; out[1] = h + (Math.sqrt(S.a * S.a + sg * sg) - Math.sqrt(S.a * S.a + S.sg0 * S.sg0)); return out; }
  // touch and slack: the hanging part from the roller to the touchdown at x = xs (measured from the roller), then the bottom
  if (s <= S.s0) { const sg = S.s0 - s, u = S.a * Math.asinh(sg / S.a); out[0] = S.xs - u; out[1] = Math.sqrt(S.a * S.a + sg * sg) - S.a; return out; }
  const b = s - S.s0;
  if (S.kind === 'touch') { out[0] = S.xs + b; out[1] = 0; return out; }
  // slack: along the bights, by arc length (the same 64-step walk as its fit)
  const run = Math.max(1e-4, X - S.xs), k = Math.PI * S.waves / run;
  let acc = 0, px = 0, py = 0;
  for (let i = 1; i <= 64; i++) {
    const x = run * i / 64, y = S.amp * Math.sin(k * x), d = Math.hypot(x - px, y - py);
    if (acc + d >= b || i === 64) { const f = d > 0 ? clamp((b - acc) / d, 0, 1) : 0; out[0] = S.xs + px + (x - px) * f; out[1] = 0; out[2] = py + (y - py) * f; return out; }
    acc += d; px = x; py = y;
  }
  return out;
}

// the hanging part's greatest depth under the straight chord from the roller to its far end (the touchdown, or the shackle)
export function rodeSag(S) {
  if (S.kind === 'hang' || S.kind === 'taut') return 0;
  const end = S.kind === 'lifted' ? S.L : S.s0, e = rodeAt(S, end, [0, 0, 0]), p = [0, 0, 0];
  let sag = 0;
  for (let i = 1; i < 64; i++) { rodeAt(S, end * i / 64, p); const yc = S.h + (e[1] - S.h) * (e[0] > 1e-9 ? p[0] / e[0] : 0); sag = Math.max(sag, yc - p[1]); }
  return Math.max(0, sag);
}
// the chain's horizontal pull for a shape (N), w the chain's weight in water (N/m): a = H / w
export const rodePullN = (S, w) => (S.kind === 'taut' ? Infinity : S.kind === 'hang' ? 0 : S.a * w);

// ---- where the anchor is ----
// phase: the tackle's (stowed, falling, down, held, weighing, up); out: chain out (m); roller: the chain's point on the roller
// (world); bottomY: the bed's height under the anchor (world); anchorXZ: where it lies (the tackle's an.x, an.z); heading (rad);
// set: 0 → 1 as it digs in. Returns { where: 'roller' | 'slide' | 'hang' | 'bottom', slide (0 → 1), shackle (world), down (the
// shank's direction: 0 level forward, 1 straight down), yaw (rad: the shank's heading, from the shackle toward the crown), roll,
// bury (m) }
export function gearPose({ phase, out, roller, bottomY, anchorXZ, heading = 0, set = 0, t = 0 }, o = {}) {
  o.shackle ??= [0, 0, 0];
  if (phase === 'stowed' || !(out > 0)) { o.where = 'roller'; o.slide = 0; o.down = 0; o.yaw = heading; o.roll = 0; o.bury = 0; o.swing = 0; o.shackle[0] = roller[0]; o.shackle[1] = roller[1]; o.shackle[2] = roller[2]; return o; }
  const onBottom = phase === 'down' || phase === 'held' || phase === 'weighing';
  if (onBottom) {
    // pulled by the chain: the shank points from the shackle (toward the boat) to the crown (away from her)
    const dx = anchorXZ[0] - roller[0], dz = anchorXZ[1] - roller[2];
    // seen, not hidden (the owner's goal: "Do we have an anchor?"): its toe in the bed, the fluke's wings and the shank above it, the
    // shank rising a little toward the shackle; lying on its side until it sets, then righted with the toe dug in by bury
    const k = clamp(set, 0, 1);
    o.where = 'bottom'; o.slide = 1; o.down = 0;
    o.yaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, -dz) : heading;
    o.roll = GEAR.rollSide * (1 - k) + GEAR.setRoll * k; o.bury = GEAR.bury * k; o.swing = 0;
    o.shackle[0] = anchorXZ[0]; o.shackle[1] = bottomY + GEAR.toeY * Math.cos(o.roll) + 0.03; o.shackle[2] = anchorXZ[1];
    return o;
  }
  if (out < GEAR.slideM) {   // sliding forward over the roller, the crown tipping down (falling: going; up: coming home)
    const k = out / GEAR.slideM;
    o.where = 'slide'; o.slide = k; o.down = k; o.yaw = heading; o.roll = 0; o.bury = 0; o.swing = 0;
    o.shackle[0] = roller[0]; o.shackle[1] = roller[1]; o.shackle[2] = roller[2];
    return o;
  }
  // hanging from the roller on its chain, a slow small swing (deterministic in t)
  const hang = Math.min(out - GEAR.slideM, roller[1] - (bottomY + GEAR.anchorLen));
  o.where = 'hang'; o.slide = 1; o.down = 1; o.yaw = heading; o.roll = 0; o.bury = 0; o.swing = 0.06 * Math.sin(t * 2.1);
  o.shackle[0] = roller[0]; o.shackle[1] = roller[1] - Math.max(0, hang); o.shackle[2] = roller[2];
  return o;
}

// ---- the links ----
// path: a function s → [x, y, z] (world) along the chain from the roller (s = 0) to the shackle (s = L), deck: the chain on deck aft
// of the roller (world points, the roller first), eye (world), out: the chain out (its phase), chainMs (m/s), t (s); writes into
// buf (Float32Array, 12 floats a link: position + scale, axis along + wet, axis across + 0) and returns the count. Links counted from
// the shackle (k = 0) so they travel with the chain; every other link turned 90° about the chain's axis
export function layLinks({ L, path, deck = null, eye, out, chainMs = 0, t = 0, nearM = GEAR.nearM, max = GEAR.maxLinks, waterY = 0 }, buf) {
  const P = GEAR.pitch, near2 = nearM * nearM;
  let n = 0;
  const a = [0, 0, 0], b = [0, 0, 0];
  const deckLen = deck ? polyLen(deck) : 0;
  const k0 = 0, k1 = Math.floor((L + deckLen) / P);
  const rattle = GEAR.rattle * clamp(Math.abs(chainMs), 0, 1);
  for (let k = k0; k <= k1 && n < max; k++) {
    const s = L - k * P;            // from the roller: the shackle's link at s = L; links aft of the roller at s < 0
    if (s >= 0) { path(s, a); path(Math.max(0, s - P * 0.5), b); if (s - P * 0.5 < 0) { path(Math.min(L, s + P * 0.5), b); b[0] = 2 * a[0] - b[0]; b[1] = 2 * a[1] - b[1]; b[2] = 2 * a[2] - b[2]; } }
    else { if (!deck || -s > deckLen) break; polyAt(deck, -s, a); polyAt(deck, Math.min(deckLen, -s + P * 0.5), b); }
    const ex = a[0] - eye[0], ey = a[1] - eye[1], ez = a[2] - eye[2];
    if (ex * ex + ey * ey + ez * ez > near2) continue;
    // the axis along the chain (toward the roller), the across axis: level for even links, up for odd
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let cx = -tz, cy = 0, cz = tx; let cl = Math.hypot(cx, cy, cz);
    if (cl < 1e-4) { cx = 1; cy = 0; cz = 0; cl = 1; }
    cx /= cl; cy /= cl; cz /= cl;
    if (k & 1) { const ux = ty * cz - tz * cy, uy = tz * cx - tx * cz, uz = tx * cy - ty * cx; cx = ux; cy = uy; cz = uz; }
    // the rattle: a link on or near the roller jumps a little while the chain runs (seeded by its own number, not a random)
    const near = Math.abs(s) < 0.4 ? 1 - Math.abs(s) / 0.4 : 0, j = rattle * near * Math.sin(k * 12.9898 + t * 47.0);
    const o = n * 12, wet = a[1] < waterY + GEAR.wetM ? clamp(1 - (a[1] - waterY) / GEAR.wetM, 0, 1) : 0;
    buf[o] = a[0]; buf[o + 1] = a[1] + j; buf[o + 2] = a[2]; buf[o + 3] = 1;
    buf[o + 4] = tx; buf[o + 5] = ty; buf[o + 6] = tz; buf[o + 7] = wet;
    buf[o + 8] = cx; buf[o + 9] = cy; buf[o + 10] = cz; buf[o + 11] = 0;
    n++;
  }
  return n;
}
function polyLen(P) { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]); return s; }
function polyAt(P, s, o = [0, 0, 0]) {
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
    if (s <= d || i === P.length - 1) { const f = d > 0 ? clamp(s / d, 0, 1) : 0; for (let c = 0; c < 3; c++) o[c] = lerp(P[i - 1][c], P[i][c], f); return o; }
    s -= d;
  }
  o[0] = P[0][0]; o[1] = P[0][1]; o[2] = P[0][2]; return o;
}

// the world path of a shape: the roller (world), the shackle's horizontal direction (ux, uz), the bottom's height
export function rodePath(S, roller, ux, uz, bottomY) {
  const p = [0, 0, 0];
  return (s, o) => { rodeAt(S, s, p); o[0] = roller[0] + ux * p[0] - uz * p[2]; o[1] = bottomY + p[1]; o[2] = roller[2] + uz * p[0] + ux * p[2]; return o; };
}
