// Ground tackle and the dock (feat/engine-anchor, 2026-10-29; D3): the anchor and its rode, a
// mooring ball's pennant, and coming alongside a pier (fenders, soft contact, two lines). Plain JS, no three.js and no
// DOM: the physics (src/boat.js) calls env.ext(state, dt) every tick for the outside force and env.post(state, dt)
// after it; tests/tackle.test.mjs drives it in node.
//
//   const tk = createTackle({ depthAt: (x, z) => −terrain.heightAt(x, z), balls, piers });
//   env.ext = tk.ext; env.post = tk.post;            // with the physics' env
//   tk.drop(state) / tk.weigh() / tk.moor(state) / tk.release() / tk.tieUp(state) / tk.fenders(on)
//   tk.state → { mode, anchor: {...}, ball, lines, fenders, near, ... }
//
// Frames: world x east, z south, m; heading clockwise from north (−z); the body frame x forward, y starboard
// (src/boat.js). The force is returned in the body frame { X, Y, N }.
//
// The anchor (a 7 kg Delta-type on a chain-and-nylon rode; [est] for a 28 ft cruiser, the Catalina 28 owners' usual
// kit; holding 1 kN: ≈ 15 × its weight in the bay's soft glacial silt [est]):
//   - drop: only slow (sog under dropMs, 1 kn) and in dropDepth (3–20 m of water); the chain pays out at payMs to the
//     crew's scope (5 : 1 of the depth + the bow's height), up to the rode's length;
//   - the rode is a catenary: for a horizontal pull H the hanging part s = √(h² + 2hH/w) (h: the bow's height over the
//     bottom, w: the chain's weight in water per metre); while s < L the rest lies on the bottom and the anchor feels
//     a level pull; past it the whole chain hangs and the anchor's shank lifts (θ = atan(V/H)). The boat's distance from
//     the anchor X(H) is inverted for H each tick (bisection), so the pull rises gently, then steeply as the chain
//     straightens, softened by the nylon's stretch;
//   - holding: holdN × the set (it digs in over setS of pull) × the lift (1 at θ = 0, falling to 10 % by liftDeg);
//     past it the anchor drags toward the boat (at most dragMs), holds 70 % while it drags, and resets after 8 s still.
//     Short scope lifts the shank sooner: the same wind that holds at 7 : 1 drags at 3 : 1 (tests/tackle.test.mjs);
//   - weigh: the crew hauls at haulMs while the pull is under haulN (else they wait: motor up to it); at short stay
//     (the rode about straight up) the anchor breaks out, comes up, and stows.
// The mooring: pick up a free ball arriving slow (sog under pickMs, 0.6 m/s) with the bow within pickM (3 m); a 4 m
// pennant, a nylon spring past its length; the mooring's block doesn't drag. release() lets it go.
// The dock: piers as rectangles (an axis a → b and a half-width). The hull's sheer line is 30 points; each one closer
// to a pier than the contact gap (the fenders' 0.14 m when they are down, the rubrail's 0.03 m when not) feels a
// spring-damper push and a little friction. post() then makes it a hard rule: no hull point ever inside a pier (the
// pose is moved out along the normal and the inward velocity taken away). tieUp(): stopped (sog under tieMs) with the
// side within tieM (1 m) of a pier, the crew puts a bow and a stern line on the nearest cleats and takes them in.
import { DEFAULT_DIMS } from './dims.js';

const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';

// the anchor's numbers for a boat's dims (its roller; memoised); ANCHOR is this page's boat's
const anchorMemo = new WeakMap();
export function anchorFor(dims = DEFAULT_DIMS) {
  let A = anchorMemo.get(dims);
  if (A) return A;
  const { HULL } = dims;
  A = {
    // the rode: 8 m of 8 mm chain and 37 m of 12 mm nylon, its weight spread along it (0.6 kg/m in air, 0.4 of it
    // left in water: ≈ 2.4 N/m) [est]; a light rode lifts the anchor's shank sooner, so scope matters as it does aboard
    massKg: 7, chainKgM: 0.6, chainSub: 0.4,
    rodeM: 45, scope: 5,                               // all-chain equivalent; the crew's scope
    bowX: HULL.anchorRoller ? -HULL.anchorRoller[2] : HULL.loa / 2 - 0.2, bowY: 0.9,   // the roller (dims.js): m forward of the centre; the fairlead m above the water [est]
    dropMs: 0.514, dropDepth: [3, 20],                 // under 1 kn; 3–20 m of water
    payMs: 0.8, haulMs: 0.3, haulN: 700,               // the chain runs out at 0.8 m/s; hand-hauled at 0.3 m/s up to 700 N
    holdN: 1000, setS: 8, liftDeg: 15, dragMs: 0.6, dragHold: 0.7, resetS: 8,
    chainM: 8, nylonEA: 60000, chainDamp: 500,        // the chain's length; the 12 mm nylon's EA (N; ≈ 15 % stretch at 9 kN); N per m/s along the rode
  };
  anchorMemo.set(dims, A);
  return A;
}
export const ANCHOR = anchorFor(DEFAULT_DIMS);
export const MOORING = { pickMs: 0.6, pickM: 3, pennantM: 4, k: 4000, damp: 1500 };
export const DOCK = { fenderM: 0.14, rubM: 0.03, k: 60000, damp: 4000, mu: 0.3, nearM: 15, tieM: 1, tieMs: 0.3, lineK: 3000, lineDamp: 800, takeInMs: 0.15, lineMinM: 0.6 };

const w0 = (A) => A.chainKgM * 9.81 * A.chainSub;   // N per m in water

// The horizontal distance from the anchor to the bow (m) for a horizontal pull H (N), a vertical h (m, the bottom to
// the roller), L m of rode out, w N/m. Returns { X, lifted: V at the anchor (N, 0 if chain lies on the bottom) }.
export function catenaryX(H, h, L, w) {
  H = Math.max(H, 1e-3);
  const a = H / w, s = Math.sqrt(h * h + 2 * h * a);
  if (s <= L) return { X: (L - s) + a * Math.asinh(s / a), V: 0, s };
  // the whole chain hangs: find the virtual length σ0 below the anchor where the curve would be level
  const hAt = (sg) => a * (Math.sqrt(1 + ((sg + L) / a) ** 2) - Math.sqrt(1 + (sg / a) ** 2));
  let lo = 0, hi = 1;
  while (hAt(hi) < h && hi < 1e7) hi *= 2;
  if (hAt(hi) < h) return { X: Math.sqrt(Math.max(0, L * L - h * h)), V: H * 1e3, s: L };   // can't reach: straight up
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (hAt(m) < h) lo = m; else hi = m; }
  const sg = (lo + hi) / 2;
  return { X: a * (Math.asinh((sg + L) / a) - Math.asinh(sg / a)), V: w * sg, s: L };
}

// The pull H (N) at a distance X, and the anchor's lift (rad). The nylon stretches (L − chainM of it, EA nylonEA): the
// distance for a pull is the catenary's plus that stretch, so a surge to the end of the rode is caught softly.
export function rodePull(X, h, L, A = ANCHOR) {
  const w = w0(A), nylon = Math.max(0, L - A.chainM);
  if (L <= h) return { H: 0, lift: Math.PI / 2, slack: true };
  const Xat = (H) => catenaryX(H, h, L, w).X + nylon * H / A.nylonEA;
  const near = catenaryX(1e-3, h, L, w);
  if (X <= near.X) return { H: 0, lift: 0, slack: true };
  let lo = 1e-3, hi = 1e3;
  while (Xat(hi) < X && hi < 1e7) hi *= 4;
  for (let i = 0; i < 48; i++) { const m = Math.sqrt(lo * hi); if (Xat(m) < X) lo = m; else hi = m; }
  const H = Math.sqrt(lo * hi), c = catenaryX(H, h, L, w);
  return { H, lift: Math.atan2(c.V, H) };
}

// The holding factor of the shank's lift: 1 level, down to 0.1 by liftDeg
const liftFactor = (lift, A = ANCHOR) => clamp(1 - lift / (A.liftDeg * DEG), 0.1, 1);

// The steady wind (m/s, 10 m) at which an anchored boat drags, for a depth and a scope: the windage at the bow (bare
// poles, the furled sails; the physics' hull.windCdA + furlCdA) against the holding × the lift at that pull. For the
// tests and the chart's advice; the live boat also sheers and surges, so it drags a little sooner.
export function dragWindMs(depth, scope, { cdA = 5.5, A = ANCHOR, rho = 1.225 } = {}) {
  const h = depth + A.bowY, L = Math.min(A.rodeM, scope * h), w = w0(A);
  let lo = 0, hi = 60;
  for (let i = 0; i < 50; i++) {
    const v = (lo + hi) / 2, H = 0.5 * rho * cdA * v * v;
    const c = catenaryX(H, h, L, w);
    if (H < A.holdN * liftFactor(Math.atan2(c.V, H), A)) lo = v; else hi = v;
  }
  return lo;
}

// the hull's sheer line in the body frame (x forward, y starboard), m: the planform of the C28 (fine bow, full stern)
export function hullOutline(n = 15, HULL = DEFAULT_DIMS.HULL) {
  const L = HULL.loa, B = HULL.beam, pts = [];
  const half = (x) => { const t = (x + L / 2) / L; return B / 2 * (t < 0.55 ? 0.82 + 0.18 * Math.sin(t / 0.55 * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2.2))); };
  for (let i = 0; i < n; i++) { const x = -L / 2 + (L * i) / (n - 1); const y = half(x); pts.push([x, y], [x, -y]); }
  return pts.filter(([x, y], i, a) => a.findIndex(([x2, y2]) => Math.abs(x2 - x) < 1e-6 && Math.abs(y2 - y) < 1e-6) === i);
}

// piers as rectangles from the shoreline's piers ({ x, z, dirX, dirZ, length, width }), the harbour's docks
// ({ a, b, width }) and breakwaters ({ path, crestWidth, baseWidth?, crestY, baseY }: the width at the waterline), and the
// towns' OSM decks ({ count, data: [mx, y, mz, length, width, yaw, k] }, k 1 a breakwater; src/towns-layout.js): every
// structure drawn on the water is solid (fix/no-poor-props: the breakwaters and the towns' decks had been ghosts).
// skip(x, z): a towns deck not drawn (src/towns.js draws the shore region's piers from the shoreline instead).
export function piersFrom({ shoreline = null, harbour = null, towns = null, skip = null } = {}) {
  const out = [];
  for (const q of shoreline?.piers ?? []) out.push({ a: [q.x, q.z], b: [q.x + q.dirX * q.length, q.z + q.dirZ * q.length], half: (q.width ?? 2) / 2, kind: 'pier' });
  for (const d of harbour?.docks ?? []) if (d.kind !== 'gangway') out.push({ a: d.a, b: d.b, half: (d.width ?? 2) / 2, kind: d.kind });
  for (const bw of harbour?.breakwaters ?? []) {
    const w = bw.baseWidth ? bw.crestWidth + (bw.baseWidth - bw.crestWidth) * bw.crestY / (bw.crestY - bw.baseY) : bw.crestWidth;
    for (let i = 1; i < bw.path.length; i++) out.push({ a: bw.path[i - 1], b: bw.path[i], half: w / 2, kind: 'breakwater' });
  }
  const T = towns?.piers;
  for (let k = 0; k < (T?.count ?? 0); k++) {
    const o = k * 7, D = T.data, x = D[o], z = D[o + 2], h = D[o + 3] / 2, ux = Math.cos(D[o + 5]), uz = -Math.sin(D[o + 5]);
    if (skip?.(x, z, D[o + 6])) continue;
    out.push({ a: [x - ux * h, z - uz * h], b: [x + ux * h, z + uz * h], half: D[o + 4] / 2, kind: D[o + 6] ? 'breakwater' : 'pier' });
  }
  return out;
}
// the towns' decks src/towns.js does not draw: plain piers inside the shoreline's region (it draws those itself)
export const townsDeckHidden = (region) => (x, z, k) => !k && x > region.x0 && x < region.x1 && z > region.z0 && z < region.z1;

// a pier's frame (its start, unit axis, length, half-width), computed once per pier: the same expressions as before, so
// the distances below are bit-identical to computing it per call
function pierFrame(p) {
  const ex = p.b[0] - p.a[0], ez = p.b[1] - p.a[1], len = Math.hypot(ex, ez) || 1;
  return { ax: p.a[0], az: p.a[1], ux: ex / len, uz: ez / len, len, half: p.half };
}
// the signed distance written into `o` (no allocation): see pierDistance
function pierDistInto(g, x, z, o) {
  const ux = g.ux, uz = g.uz, len = g.len;
  const rx = x - g.ax, rz = z - g.az;
  const al = rx * ux + rz * uz - len / 2, ac = rx * -uz + rz * ux;   // along from the middle, across (left +)
  const dx = Math.abs(al) - len / 2, dy = Math.abs(ac) - g.half;
  let d, nAl = 0, nAc = 0;
  if (dx > 0 || dy > 0) {
    const ox = Math.max(dx, 0), oy = Math.max(dy, 0); d = Math.hypot(ox, oy);
    nAl = ox * Math.sign(al) / (d || 1); nAc = oy * Math.sign(ac) / (d || 1);
  } else if (dx > dy) { d = dx; nAl = Math.sign(al); } else { d = dy; nAc = Math.sign(ac); }
  const nx = nAl * ux + nAc * -uz, nz = nAl * uz + nAc * ux;
  o.d = d; o.nx = nx; o.nz = nz; o.cx = x - nx * d; o.cz = z - nz * d;   // c: the nearest point on the pier's edge
  return o;
}
// signed distance from (x, z) to a pier rectangle (m; < 0 inside) and the outward normal there
export function pierDistance(p, x, z) {
  return pierDistInto(pierFrame(p), x, z, { d: 0, nx: 0, nz: 0, cx: 0, cz: 0 });
}

const bodyToWorld = (h, bx, by) => [bx * Math.sin(h) + by * Math.cos(h), -bx * Math.cos(h) + by * Math.sin(h)];
// a world force at body point (px, py) → { X, Y, N }
function toBody(h, fx, fz, px, py) {
  const X = fx * Math.sin(h) - fz * Math.cos(h), Y = fx * Math.cos(h) + fz * Math.sin(h);
  return { X, Y, N: px * Y - py * X };
}
// the world velocity of body point (px, py)
function pointVel(s, px, py) {
  const vb = s.u - s.yawRate * py, vs = s.v + s.yawRate * px;
  const [vx, vz] = bodyToWorld(s.heading, vb, vs);
  return [vx, vz];
}

// dims: the boat's (src/boat/dims.js; this page's boat by default): its roller, its outline, its length and beam
export function createTackle({ depthAt = () => 10, balls = [], piers = [], dims = DEFAULT_DIMS, A = anchorFor(dims), M = MOORING, D = DOCK, outline = hullOutline(15, dims.HULL) } = {}) {
  const { HULL } = dims;
  const st = {
    mode: 'free',            // 'free' | 'anchor' | 'moored' | 'docked'
    anchor: { phase: 'stowed', x: 0, z: 0, out: 0, target: 0, depth: 0, set: 0, H: 0, lift: 0, hold: 0, dragging: false, dragged: 0, stillS: 0, dragS: 0, scope: 0 },
    ball: null, pennant: 0,
    fenders: false, fendersAuto: true, lines: [], nearPier: null, pierGap: Infinity, minGap: Infinity, contact: 0,
    force: { X: 0, Y: 0, N: 0 }, why: null,
  };
  const an = st.anchor;
  const bow = (s) => { const [dx, dz] = bodyToWorld(s.heading, A.bowX, 0); return [s.x + dx, s.z + dz]; };

  // ---- the anchor ----
  function canDrop(s) {
    const [bx, bz] = bow(s), d = depthAt(bx, bz);
    if (st.mode === 'moored' || st.mode === 'docked') return { ok: false, why: st.mode };
    if (an.phase !== 'stowed') return { ok: false, why: 'out' };
    if (s.sog > A.dropMs) return { ok: false, why: 'fast', depth: d };
    if (!(d >= A.dropDepth[0])) return { ok: false, why: 'shallow', depth: d };
    if (d > A.dropDepth[1]) return { ok: false, why: 'deep', depth: d };
    return { ok: true, depth: d };
  }
  function drop(s, { scope = A.scope } = {}) {
    const c = canDrop(s); st.why = c.why ?? null;
    if (!c.ok) return c;
    const [bx, bz] = bow(s);
    Object.assign(an, { phase: 'falling', x: bx, z: bz, out: 0, depth: c.depth, target: Math.min(A.rodeM, scope * (c.depth + A.bowY)), set: 0, H: 0, lift: 0, dragging: false, dragged: 0, stillS: 0, dragS: 0 });
    st.mode = 'anchor';
    return c;
  }
  function weigh() { if (st.mode !== 'anchor' || an.phase === 'stowed') return false; an.phase = an.phase === 'up' ? 'up' : 'weighing'; return true; }
  function setScope(scope) { an.target = Math.min(A.rodeM, scope * (an.depth + A.bowY)); if (an.phase === 'held') an.phase = 'down'; }

  function anchorForce(s, dt) {
    const [bx, bz] = bow(s);
    if (an.phase === 'falling' || an.phase === 'down') {
      an.out = Math.min(an.target, an.out + (an.phase === 'falling' ? A.fallMs ?? A.payMs : A.payMs) * dt);   // fallMs: a page's own fall to the bottom (v2's crew; v1: payMs)
      if (an.phase === 'falling' && an.out >= an.depth + A.bowY - 0.01) { an.phase = 'down'; an.x = bx; an.z = bz; an.depth = depthAt(bx, bz); }
      if (an.phase === 'down' && an.out >= an.target - 1e-6) an.phase = 'held';
    }
    if (an.phase === 'falling') { an.x = bx; an.z = bz; return null; }
    if (an.phase === 'weighing') {
      if (an.H < A.haulN) an.out = Math.max(0, an.out - A.haulMs * dt);
      if (an.out <= (an.depth + A.bowY) * 1.05) an.phase = 'up';          // short stay: it breaks out
    }
    if (an.phase === 'up') {
      an.out = Math.max(0, an.out - A.haulMs * dt);
      an.x = bx; an.z = bz; an.H = 0;
      if (an.out <= 0) { an.phase = 'stowed'; st.mode = 'free'; }
      return null;
    }
    const h = an.depth + A.bowY, dx = an.x - bx, dz = an.z - bz, X = Math.hypot(dx, dz);
    const r = rodePull(X, h, an.out, A);
    let H = r.H;
    // the chain's drag in the water damps the surge along the rode
    const ux = X > 1e-6 ? dx / X : 0, uz = X > 1e-6 ? dz / X : 0;
    const [vx, vz] = pointVel(s, A.bowX, 0), vAway = -(vx * ux + vz * uz);
    if (!r.slack) H = Math.max(0, H + A.chainDamp * vAway);
    if (A.maxN) H = Math.min(H, A.maxN);   // a page's cap on the pull (v2: a near-vertical all-chain rode is rigid, and its tick blew up)
    an.H = H; an.lift = r.lift; an.scope = an.out / h;
    // the set and the holding; past it the anchor drags toward the boat
    if (H > 150) an.set = Math.min(1, an.set + dt / A.setS);
    const hold = A.holdN * (0.3 + 0.7 * an.set) * liftFactor(r.lift, A) * (an.dragging ? A.dragHold : 1);
    an.hold = hold;
    if (H > hold && X > 1e-3) {
      const v = Math.min(A.dragMs, A.dragMs * (H / hold - 1) * 2);
      an.x -= ux * v * dt; an.z -= uz * v * dt; an.dragged += v * dt;
      an.dragging = true; an.stillS = 0; an.dragS += dt;
      an.depth = depthAt(an.x, an.z);
    } else if (an.dragging) { an.stillS += dt; if (an.stillS > A.resetS) an.dragging = false; }
    return toBody(s.heading, ux * H, uz * H, A.bowX, 0);
  }

  // ---- the mooring ----
  function nearestBall(s) {
    const [bx, bz] = bow(s); let best = null, bd = Infinity;
    for (const b of balls) { if (b.boat) continue; const d = Math.hypot(b.x - bx, b.z - bz); if (d < bd) { bd = d; best = b; } }
    return best ? { ball: best, d: bd } : null;
  }
  function canMoor(s) {
    const n = nearestBall(s);
    if (st.mode !== 'free') return { ok: false, why: st.mode, ...n };
    if (!n || n.d > M.pickM) return { ok: false, why: 'far', ...n };
    if (s.sog > M.pickMs) return { ok: false, why: 'fast', ...n };
    return { ok: true, ...n };
  }
  function moor(s) { const c = canMoor(s); st.why = c.why ?? null; if (!c.ok) return c; st.mode = 'moored'; st.ball = c.ball; st.pennant = Math.max(M.pennantM, Math.min(c.d, M.pickM)); return c; }
  function mooringForce(s) {
    const [bx, bz] = bow(s), dx = st.ball.x - bx, dz = st.ball.z - bz, d = Math.hypot(dx, dz);
    st.pennant += (M.pennantM - st.pennant) * 0.002;   // the crew shortens a long pickup to the pennant's length
    if (d <= st.pennant || d < 1e-6) return { X: 0, Y: 0, N: 0, T: 0 };
    const ux = dx / d, uz = dz / d, [vx, vz] = pointVel(s, A.bowX, 0), vAway = -(vx * ux + vz * uz);
    const T = Math.max(0, M.k * (d - st.pennant) + M.damp * vAway);
    return { ...toBody(s.heading, ux * T, uz * T, A.bowX, 0), T };
  }

  // ---- the dock ----
  // the piers' frames and their bounding boxes, once (perf P1: every pier, every step, a new object each time cost 1.7 ms
  // and 2 MB of garbage a frame near the harbour). A pier whose box is farther than the radius on x or z is farther
  // than it in distance too, so the box test only skips piers the exact test would reject: the same list, same order.
  const F = piers.map(pierFrame), BOX = new Float64Array(piers.length * 4), SLACK = 1e-3;
  F.forEach((g, i) => {
    const bx = g.ax + g.ux * g.len, bz = g.az + g.uz * g.len, hx = Math.abs(g.uz) * g.half, hz = Math.abs(g.ux) * g.half;
    BOX[i * 4] = Math.min(g.ax, bx) - hx - SLACK; BOX[i * 4 + 1] = Math.max(g.ax, bx) + hx + SLACK;
    BOX[i * 4 + 2] = Math.min(g.az, bz) - hz - SLACK; BOX[i * 4 + 3] = Math.max(g.az, bz) + hz + SLACK;
  });
  const q0 = { d: 0, nx: 0, nz: 0, cx: 0, cz: 0 };   // the scratch distance (one per tackle; nothing holds it across calls)
  // the piers within r + the hull's length of the boat's centre: into `list` (and their frames into `frames`)
  function nearInto(s, r, list, frames) {
    const R = r + HULL.loa, x = s.x, z = s.z;
    list.length = 0; frames.length = 0;
    for (let i = 0; i < F.length; i++) {
      const o = i * 4;
      if (x < BOX[o] - R || x > BOX[o + 1] + R || z < BOX[o + 2] - R || z > BOX[o + 3] + R) continue;
      if (pierDistInto(F[i], x, z, q0).d < R) { list.push(piers[i]); frames.push(F[i]); }
    }
    return list;
  }
  const nearPiers = (s, r = 40) => nearInto(s, r, [], []);
  const extList = [], extFrames = [], postList = [], postFrames = [];
  function contactForce(s, list, frames) {
    const gap = st.fenders ? D.fenderM : D.rubM, sh = Math.sin(s.heading), ch = Math.cos(s.heading), q = q0;
    let X = 0, Y = 0, N = 0, n = 0, minD = Infinity, near = null;
    for (const [px, py] of outline) {
      const ox = px * sh + py * ch, oz = -px * ch + py * sh, wx = s.x + ox, wz = s.z + oz;   // bodyToWorld, inline
      for (let j = 0; j < list.length; j++) {
        const p = list[j];
        pierDistInto(frames[j], wx, wz, q);
        if (q.d < minD) { minD = q.d; near = p; }
        if (q.d >= gap) continue;
        const pen = gap - q.d, [vx, vz] = pointVel(s, px, py), vn = vx * q.nx + vz * q.nz;
        const Fn = Math.max(0, D.k * pen - D.damp * vn);
        // friction against the slide along the edge
        const tx = vx - vn * q.nx, tz = vz - vn * q.nz, tv = Math.hypot(tx, tz), Ft = tv > 1e-4 ? Math.min(D.mu * Fn, 3000 * tv) / tv : 0;
        const f = toBody(s.heading, q.nx * Fn - tx * Ft, q.nz * Fn - tz * Ft, px, py);
        X += f.X; Y += f.Y; N += f.N; n++;
      }
    }
    st.minGap = minD; st.contact = n; st.nearPier = near; st.pierGap = minD;
    return { X, Y, N };
  }
  function canTie(s) {
    if (st.mode !== 'free') return { ok: false, why: st.mode };
    const list = nearPiers(s, 5); let minD = Infinity;
    for (const [px, py] of outline) { const [ox, oz] = bodyToWorld(s.heading, px, py); for (const p of list) minD = Math.min(minD, pierDistance(p, s.x + ox, s.z + oz).d); }
    if (!(minD <= D.tieM)) return { ok: false, why: 'far', gap: minD };
    if (s.sog > D.tieMs) return { ok: false, why: 'fast', gap: minD };
    return { ok: true, gap: minD, list };
  }
  function tieUp(s) {
    const c = canTie(s); st.why = c.why ?? null; if (!c.ok) return c;
    st.lines = [[A.bowX - 0.3, 0], [-HULL.loa / 2 + 0.4, 0]].map(([px]) => {
      // the deck edge on the pier's side, the nearest cleat on that pier's edge
      let best = null;
      for (const side of [1, -1]) {
        const py = side * HULL.beam * 0.38, [ox, oz] = bodyToWorld(s.heading, px, py), wx = s.x + ox, wz = s.z + oz;
        for (const p of c.list) { const q = pierDistance(p, wx, wz); if (!best || q.d < best.q.d) best = { q, px, py }; }
      }
      const cleat = [best.q.cx, best.q.cz], len0 = Math.max(D.lineMinM, best.q.d + 0.3);
      return { px: best.px, py: best.py, cleat, rest: len0, T: 0 };
    });
    st.mode = 'docked'; st.fenders = true;
    return c;
  }
  function lineForce(s, dt) {
    let X = 0, Y = 0, N = 0;
    for (const L of st.lines) {
      L.rest = Math.max(D.lineMinM, L.rest - D.takeInMs * dt);
      const [ox, oz] = bodyToWorld(s.heading, L.px, L.py), wx = s.x + ox, wz = s.z + oz;
      const dx = L.cleat[0] - wx, dz = L.cleat[1] - wz, d = Math.hypot(dx, dz);
      if (d <= L.rest || d < 1e-6) { L.T = 0; continue; }
      const ux = dx / d, uz = dz / d, [vx, vz] = pointVel(s, L.px, L.py), vAway = -(vx * ux + vz * uz);
      L.T = Math.max(0, D.lineK * (d - L.rest) + D.lineDamp * vAway);
      const f = toBody(s.heading, ux * L.T, uz * L.T, L.px, L.py); X += f.X; Y += f.Y; N += f.N;
    }
    return { X, Y, N };
  }

  function release() {
    if (st.mode === 'moored') { st.mode = 'free'; st.ball = null; return 'mooring'; }
    if (st.mode === 'docked') { st.mode = 'free'; st.lines = []; return 'lines'; }
    return null;
  }

  // ---- the physics hooks ----
  function ext(s, dt) {
    let f = { X: 0, Y: 0, N: 0 };
    const add = (g) => { if (g) { f.X += g.X; f.Y += g.Y; f.N += g.N; } };
    if (st.mode === 'anchor') add(anchorForce(s, dt));
    if (st.mode === 'moored') add(mooringForce(s));
    const list = piers.length ? nearInto(s, 40, extList, extFrames) : extList;
    if (list.length) {
      // the crew hangs the fenders when the boat is slow near a pier (and takes them in when it leaves)
      if (st.fendersAuto) { const g = st.pierGap; st.fenders = st.mode === 'docked' || (g < D.nearM && s.sog < 1.5) || (st.fenders && g < D.nearM * 1.5); }
      add(contactForce(s, list, extFrames));
    } else { st.minGap = Infinity; st.pierGap = Infinity; st.contact = 0; st.nearPier = null; if (st.fendersAuto && st.mode !== 'docked') st.fenders = false; }
    if (st.mode === 'docked') add(lineForce(s, dt));
    st.force = f;
    return f;
  }
  // never inside a pier: move the pose out along the normal, take the inward velocity away
  function post(s) {
    if (!piers.length) return;
    const list = nearInto(s, 10, postList, postFrames);
    if (!list.length) return;
    for (let it = 0; it < 3; it++) {
      let worst = null;
      const sh = Math.sin(s.heading), ch = Math.cos(s.heading);
      for (const [px, py] of outline) {
        const ox = px * sh + py * ch, oz = -px * ch + py * sh;   // bodyToWorld, inline
        for (let j = 0; j < list.length; j++) {
          pierDistInto(postFrames[j], s.x + ox, s.z + oz, q0);
          if (q0.d < 0.005 && (!worst || q0.d < worst.q.d)) worst = { q: { ...q0 }, px, py };
        }
      }
      if (!worst) break;
      const push = 0.005 - worst.q.d;
      s.x += worst.q.nx * push; s.z += worst.q.nz * push;
      const [vx, vz] = bodyToWorld(s.heading, s.u, s.v), vn = vx * worst.q.nx + vz * worst.q.nz;
      if (vn < 0) {
        const nvx = vx - vn * worst.q.nx, nvz = vz - vn * worst.q.nz, h = s.heading;
        s.u = nvx * Math.sin(h) - nvz * Math.cos(h); s.v = nvx * Math.cos(h) + nvz * Math.sin(h);
      }
    }
  }

  // the hull's smallest gap to any pier now (m; < 0 is inside): the tests' and the probe's check
  function hullGap(s) {
    let m = Infinity;
    for (const [px, py] of outline) { const [ox, oz] = bodyToWorld(s.heading, px, py); for (const g of F) m = Math.min(m, pierDistInto(g, s.x + ox, s.z + oz, q0).d); }
    return m;
  }

  return {
    ext, post, drop, weigh, setScope, canDrop, moor, canMoor, release, tieUp, canTie, nearestBall, hullGap, bow,
    fenders(on) { st.fendersAuto = on == null; if (on != null) st.fenders = !!on; },
    get state() { return st; }, get mode() { return st.mode; }, piers, balls,
  };
}
