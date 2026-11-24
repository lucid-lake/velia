// Emerald Bay's birds for v2: v1's cast and its step (src/birds/index.js createBirds) without
// three.js, flown by v1's own flight model (src/birds/flight.js: Bird, stepSoar, stepHunt, stepFlock, stepRaft,
// stepPerch, stepLowPass) on the scene clock. The osprey pair (one hunts round the boat, one soars high), a bald eagle on
// the thermals and a second perched on the snag at Emerald Point, the California gulls' flock, the Canada geese's raft.
// What v1 does with three (the Group, the Vector3s, the instanced meshes) is plain arrays here: each frame fills the
// per-species instance records (v1's mesh.js layout, 24 floats) and the shadows' records (shadows.js, 12 floats) that
// v2/render/birds.js uploads. The logic is v1's line for line (v2/tests/birds.test.mjs runs both and compares them).
// Pure: no GPU, no DOM.
//   const B = createBirdSim({ terrain, waterAt, wind, seed, tier, boat, start, dive });
//   B.setDaylight(elevDeg, sunDir); B.update(t, [x, y, z]);   → B.draw { near: {name: {data, n}}, far: …, shadows: {data, n} }
//   B.cue(kind, opts) (v1's director), B.find(who), B.setShelter(s), B.stats, B.events (this frame's: the calls)
//   B.update(t, cam, beat)   beat (a live page; BACKLOG #24, owner 2026-11-17): the osprey's dive is staged (DIVE below):
//        { playing, view: { x, z, yaw, hHalf } }; v1's random dives off, a dive under way tracked; without it v1's hunt as is
//   B.tryDive(beat, dt)      the stage director's ask (v2/stage/acts.js 'ospreyDive'): the gates, then startDive → { ok, why }
import { Bird, stepSoar, stepHunt, stepFlock, stepRaft, stepPerch, stepLowPass, rng, hashSeed } from '../../src/birds/flight.js';
import { SPECIES } from '../../src/birds/species.js';
import { clamp01 } from '../../src/sim/core/math.js';

import { smooth } from '../../src/sim/core/math.js';
import { createGulls, GULLS } from './gulls.js';
export const NAMES = ['osprey', 'eagle', 'gull', 'goose'];
const TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const ISTRIDE = 24, SSTRIDE = 12, SHADOW_MAX = 12;

// v1's rule (owner, 2026-11-05): birds keep 40 m from the camera (src/birds/index.js keepAway, copied: index.js imports three)
export const KEEP_M = 40, SOFT_M = 75;
// soft false: only the 40 m floor (the staged diver, owner 2026-11-17: "Allow close dive")
export function keepAway(b, cam, dt, soft = true) {
  const dx = b.pos[0] - cam[0], dy = b.pos[1] - cam[1], dz = b.pos[2] - cam[2];
  const d = Math.hypot(dx, dy, dz);
  if (d >= SOFT_M) return d;
  const h = Math.hypot(dx, dz), ux = h > 1e-3 ? dx / h : 1, uz = h > 1e-3 ? dz / h : 0;
  const w = Math.min(1, (SOFT_M - d) / (SOFT_M - KEEP_M));
  const onWater = b.mode === 'raft' && b.state.phase !== 'fly' && b.state.phase !== 'land';
  if (soft && dt > 0 && b.mode !== 'perch') {
    if (!onWater) { b.yaw = wrapPi(b.yaw + Math.max(-1, Math.min(1, wrapPi(Math.atan2(ux, uz) - b.yaw))) * w * dt * 3); b.vy += w * 2.5 * dt; }
    const v = w * w * 6 * dt;
    b.pos[0] += ux * v; b.pos[2] += uz * v;
  }
  const d2 = Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]);
  if (d2 < KEEP_M && b.mode !== 'perch') {
    const ry = b.pos[1] - cam[1], need = Math.sqrt(Math.max(0, KEEP_M * KEEP_M - ry * ry)) + 0.01;
    b.pos[0] = cam[0] + ux * need; b.pos[2] = cam[2] + uz * need;
  }
  return d2;
}

// v1's tiers (src/birds/index.js BIRD_TIERS); phones take 'low'
export const BIRD_TIERS = {
  high: { gulls: 12, geese: 7, near: 70, cull: 1100, drops: 700, shadows: true },
  balanced: { gulls: 10, geese: 7, near: 55, cull: 900, drops: 500, shadows: true },
  low: { gulls: 6, geese: 5, near: 32, cull: 650, drops: 260, shadows: false },
  // a phone's light tier (src/core/features.js birds 'gulls', ?birds=gulls; off by default): the gulls only, 3 that come to the
  // boat; the other species are flown (their CPU is ≈ 0.05 ms) but never drawn or heard, no snag, no shadows
  phone: { gulls: 3, geese: 0, near: 20, cull: 650, drops: 0, shadows: false, only: 'gull' },
};

// v1's places (src/birds/index.js bayPlaces), on any v1-shaped terrain ({ heightAt, shoreDistance? }; v1's fallback when
// the shore distance is absent)
export function bayPlaces(terrain, seed = 1) {
  const r = rng(hashSeed(seed, 4041));
  const h = terrain.heightAt, sd = terrain.shoreDistance ?? (() => -100);
  const thermals = [];
  for (let k = 0; k < 64 && thermals.length < 8; k++) {
    const a = r() * Math.PI * 2, d = 700 + r() * 900, x = 400 + Math.cos(a) * d, z = -500 + Math.sin(a) * d;
    const y = h(x, z);
    if (y > 80 && y < 520) thermals.push([x, z]);
  }
  const near = (x0, z0, ok, R = 300) => { let best = null, bd = 1e9; for (let z = z0 - R; z <= z0 + R; z += 10) for (let x = x0 - R; x <= x0 + R; x += 10) { if (!ok(x, z)) continue; const d = Math.hypot(x - x0, z - z0); if (d < bd) { bd = d; best = [x, z]; } } return best ?? [x0, z0]; };
  const snag = near(1400, -1450, (x, z) => h(x, z) > 1.5 && h(x, z) < 8 && sd(x, z) > 6 && sd(x, z) < 25, 160);
  const nest = near(700, -1450, (x, z) => h(x, z) > 25 && h(x, z) < 90, 400);
  const raft = near(1020, -1240, (x, z) => h(x, z) < -3 && sd(x, z) < -35 && sd(x, z) > -70, 300);
  return { thermals, snag, nest, raft };
}

// The snag on Emerald Point (src/birds/snag.js): v1's dead pine as plain arrays (the same rng draws in the same order, so
// the same mesh and the same perch) → { pos, nrm, col, idx, perch, perchYaw, base }
export function snagMesh({ terrain, at, seed = 1, height = 15 }) {
  const r = rng(hashSeed(seed, 5150));
  const P = [], N = [], C = [], I = [];
  const wood = [0.42, 0.4, 0.37], dark = [0.16, 0.15, 0.14];
  function limb(a, dir, len, r0, r1, k = 10, s = 8, bend = [0, 0, 0]) {
    const base = P.length / 3;
    for (let j = 0; j <= s; j++) {
      const t = j / s;
      const c = [a[0] + dir[0] * len * t + bend[0] * t * t, a[1] + dir[1] * len * t + bend[1] * t * t, a[2] + dir[2] * len * t + bend[2] * t * t];
      const ax = dir, u = norm(cross(Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], ax)), v = cross(ax, u);
      const rad = r0 + (r1 - r0) * t;
      for (let q = 0; q <= k; q++) {
        const th = q / k * Math.PI * 2, o = [u[0] * Math.cos(th) + v[0] * Math.sin(th), u[1] * Math.cos(th) + v[1] * Math.sin(th), u[2] * Math.cos(th) + v[2] * Math.sin(th)];
        const jag = 1 + 0.06 * Math.sin(th * 7 + t * 9) + 0.04 * (r() - 0.5);
        P.push(c[0] + o[0] * rad * jag, c[1] + o[1] * rad * jag, c[2] + o[2] * rad * jag); N.push(...o);
        const crack = Math.sin(th * 13 + t * len * 0.8) > 0.92 ? 1 : 0;
        const w = 0.85 + 0.25 * r();
        C.push(...(crack ? dark : wood.map((x) => x * w)));
      }
    }
    for (let j = 0; j < s; j++) for (let q = 0; q < k; q++) { const p0 = base + j * (k + 1) + q, p1 = p0 + k + 1; I.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); }
    return (t) => [a[0] + dir[0] * len * t + bend[0] * t * t, a[1] + dir[1] * len * t + bend[1] * t * t, a[2] + dir[2] * len * t + bend[2] * t * t];
  }
  const lean = [0.05, 1, -0.03], up = norm(lean);
  const trunk = limb([0, -0.5, 0], up, height + 0.5, 0.42, 0.11, 12, 10, [0.2, 0, 0.1]);
  for (let i = 0; i < 7; i++) {
    const t = 0.35 + 0.08 * i + 0.02 * r(), a = r() * Math.PI * 2;
    limb(trunk(t), norm([Math.cos(a), -0.15 - 0.2 * r(), Math.sin(a)]), 0.5 + r() * 1.3, 0.09 * (1 - t * 0.5), 0.03, 6, 3);
  }
  const perchYaw = 2.2;
  const bdir = norm([Math.sin(perchYaw) * 0.95, 0.12, Math.cos(perchYaw) * 0.95]);
  const branchAt = trunk(0.84);
  const branch = limb(branchAt, bdir, 2.2, 0.1, 0.035, 8, 5, [0, -0.15, 0]);
  limb(trunk(1), norm([0.3, 1, 0.1]), 0.5, 0.11, 0.06, 8, 2);
  const y0 = terrain.heightAt(at[0], at[1]);
  // the mesh in the world (v1's group sits at (at.x, y0, at.z) with no rotation)
  const pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { pos[i] = P[i] + at[0]; pos[i + 1] = P[i + 1] + y0; pos[i + 2] = P[i + 2] + at[1]; }
  const bp = branch(0.68);
  return { pos, nrm: new Float32Array(N), col: new Float32Array(C), idx: new Uint32Array(I), triangles: I.length / 3,
    perch: [at[0] + bp[0], y0 + bp[1] + 0.33, at[1] + bp[2]], perchYaw: perchYaw + Math.PI / 2, base: [at[0], y0, at[1]] };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const BIRDS = { diveDefault: true };

// The osprey's dive as a hero beat (BACKLOG #24; owner, 2026-11-17: "I saw a bird hover in the sky once, but I never once saw
// a bird dive for fish"). v1's hunt fired its dive wherever the bird happened to be: round the boat at any bearing (mostly
// abeam or astern, out of the follow camera's view: 2 of 21 in view over five 10-min no-input runs), and the boat sailed on
// from it (dBoat > 120 m blocked 81–99 % of the due frames). WHEN is the stage director's (v2/stage/director.js: the opening's
// strike about 95 s into play, after Tessie's ~25 s sighting, then the random pool's; one act at a time); this file keeps the
// gates (by day, not in the storm's shelter, the hunter free, the boat not turning) and WHERE: it lays the strike 25–40° off the bow and 60–120 m off the boat where the camera will see the hover and the strike
// (the boat's motion predicted to the strike), and sends the hunter in from further out. The bird then flies v1's hunt as it
// is: the hover into the wind, the stoop, the feet-first strike, the wings spread on the water, the heave off, the shake, the
// trout carried head-forward ("cheat on where and when, never on motion"). With a beat (a live page), v1's own random dives are off.
export const DIVE = Object.freeze({
  retryS: 4,                     // no spot fits (the shore, the view): try again this much later
  holdMaxS: 10,                  // s it waits for the hunter to leave the view before it is moved (no pop in plain sight)
  bear: [32, 28, 36, 25, 40],    // ° off the bow, tried in order
  Rmin: 14, Rmax: 110,           // m off the boat at the strike (the camera's window below decides)
  camWin: [45, 70], camAim: 55,  // m from the camera to the hover and the strike (owner, 2026-11-17: "Allow close dive"): inside the
                                 // birds' 75 m soft keep-away (the staged diver is exempt from it), never under the 40 m hard rule;
                                 // a 1.6 m bird ≈ 22–34 px across at 1280 × 720 (it was ≈ 13 px at 110 m)
  hazeM: 2500,                   // m: land behind the hover further than this reads pale (the air), nearer is a dark wall
  viewK: 0.78, viewKv: 0.7,      // share of the camera's half-angles (across, up and down) the hover and the strike stay inside
  hoverY: 11,                    // m: the hover's height (an osprey hovers 10–30 m up; v1's own hunt picks 14–26 m): under
                                 // the camera's eye (≈ 12 m), so the water is behind it, not the dark walls (owner, 2026-11-17)
  approachM: 70, approachY: 16,  // the hunter sent in from this far downwind of the hover, at this height
  stopM: 11,                     // m: the hover starts this far short of its point (the bird slows into the wind to it)
  strikeS: 11, hoverS: 6.3,      // s from the cue to the strike and to the hover's start (the approach ≈ 6 s, the hover 2.2–4.5 s, the stoop ≈ 2 s)
  abortS: 25,                    // s: a hunter that has not reached its hover by then is let go
  minSun: 4, depth: 1.5, shoreM: 15,   // ° of sun; m of water under the strike (an osprey goes under ≤ 1 m); m off the shore
  turnMax: 1.5,                  // °/s: a boat turning faster waits (the strike would leave the view)
});
const hash01 = (seed, k) => { const r = rng(hashSeed(seed, 6262, k)); return r(); };
// where the dive goes (pure): the strike, the hover, the hunter's start, or null. boat { x, z, heading, sog } (forward
// (sin h, −cos h)); view { x, z, yaw (the boat's convention), hHalf }; wind [vx, vz]; side0: ±1 the side tried first
export function placeDive({ boat, view, wind = [0, 0], terrain, side0 = 1, D = DIVE }) {
  if (!boat || !view) return null;
  const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), go = (boat.sog ?? 0);
  const at = (s) => [fx * go * s, fz * go * s];
  const uy = Math.atan2(-wind[0], -wind[1]), up = [Math.sin(uy), Math.cos(uy)];   // the hover faces into the wind (v1's stepHunt upwindYaw, calm too)
  const sd = terrain.shoreDistance;
  const wet = (x, z) => terrain.heightAt(x, z) < -D.depth && (!sd || sd(x, z) < -D.shoreM);
  const camY = view.y ?? 5;
  // across: the yaw inside k of the half-angle; up and down (view.pitch, view.vHalf: rad, when the page gives them): the
  // point's elevation inside k of the vertical half-angle round the camera's pitch (the attract camera looks well down)
  const inView = (cx, cz, x, y, z, k) => {
    const dx = x - cx, dz = z - cz, a = Math.atan2(dx, -dz) - view.yaw;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) >= view.hHalf * k) return false;
    if (view.vHalf == null) return true;
    const el = Math.atan2(y - camY, Math.hypot(dx, dz)) - (view.pitch ?? 0);
    return Math.abs(el) < view.vHalf * D.viewKv;
  };
  // what is behind the hover from the camera (owner, 2026-11-17: the bird lost against the dark forest at dusk): march the eye's
  // ray on past the hover; 'water' (it comes down on the lake), 'sky' (it clears the walls), 'haze' (land past hazeM: pale
  // with distance), else 'land' (the near walls: dark)
  const behind = (cx, cz, H, y) => {
    const dx = H[0] - cx, dy = y - camY, dz = H[1] - cz, L = Math.hypot(dx, dy, dz), ux = dx / L, uy = dy / L, uz = dz / L;
    for (let t = L + 10; t < 4000; t += 15) {
      const px = cx + ux * t, py = camY + uy * t, pz = cz + uz * t;
      if (py <= 0) return terrain.heightAt(px, pz) < 0 ? 'water' : 'land';
      if (terrain.heightAt(px, pz) >= py) return t > D.hazeM ? 'haze' : 'land';
    }
    return 'sky';
  };
  const Rs = [];
  for (let R = D.Rmin; R <= D.Rmax; R += 2) Rs.push(R);
  const [sx0, sz0] = at(D.strikeS), [hx0, hz0] = at(D.hoverS);
  const cS = [view.x + sx0, view.z + sz0], cH = [view.x + hx0, view.z + hz0];
  let fallback = null;
  for (const side of [side0, -side0]) for (const bear of D.bear) {
    const a = boat.heading + side * bear * Math.PI / 180;
    const cands = [];
    for (const R of Rs) {
      const S = [boat.x + sx0 + Math.sin(a) * R, boat.z + sz0 - Math.cos(a) * R];
      const H = [S[0] - up[0] * D.hoverY * 0.45, S[1] - up[1] * D.hoverY * 0.45];
      const dS = Math.hypot(S[0] - cS[0], S[1] - cS[1], camY), dH = Math.hypot(H[0] - cH[0], H[1] - cH[1], D.hoverY - camY);
      if (dS < D.camWin[0] || dS > D.camWin[1] || dH < D.camWin[0] || dH > D.camWin[1]) continue;
      cands.push({ R, S, H, dS, dH });
    }
    cands.sort((p, q) => Math.abs(p.dS - D.camAim) - Math.abs(q.dS - D.camAim));
    for (const { R, S, H, dS, dH } of cands) {
      if (!wet(S[0], S[1]) || !wet(H[0], H[1])) continue;
      if (!inView(cS[0], cS[1], S[0], 0, S[1], D.viewK) || !inView(cH[0], cH[1], H[0], D.hoverY, H[1], D.viewK)) continue;
      const bg = behind(cH[0], cH[1], H, D.hoverY);
      // the camera after the strike (the bird sits, heaves off: ≈ 3 s on) keeps the 40 m floor with a margin
      const [ax0, az0] = at(D.strikeS + 3);
      if (Math.hypot(S[0] - view.x - ax0, S[1] - view.z - az0, camY) < D.camWin[0] - 3) continue;
      // in from downwind, into the wind: the hover starts stopM short of its point and slows along the line (v1's hover turns
      // the bird into the wind; flying in that way, it stops where the plan says)
      const from = [H[0] - up[0] * D.approachM, D.approachY, H[1] - up[1] * D.approachM];
      const start = [H[0] - up[0] * D.stopM, H[1] - up[1] * D.stopM];
      const dSt = Math.hypot(start[0] - cH[0], start[1] - cH[1], D.hoverY - camY);
      if (dSt < D.camWin[0] - 3 || dSt > D.camWin[1] + 12 || !inView(cH[0], cH[1], start[0], D.hoverY, start[1], D.viewK)) continue;   // where it starts to slow: a little wider
      const p = { strike: S, hover: [H[0], D.hoverY, H[1]], start, from, yaw: Math.atan2(H[0] - from[0], H[1] - from[2]), side, bear, R, camS: +dS.toFixed(1), camH: +dH.toFixed(1), bg };
      if (bg !== 'land') return p;
      fallback ??= p;   // a dark wall behind: kept only if nothing better is in the view
    }
  }
  return fallback;
}
// the storm's shelter for the birds (v1's src/weather/storm.js stormSystem: env.shelter = min(1, rain × 1.5)): over a
// bird's rank it leaves the air for the shore; 1 empties it (L1)
export const shelterOf = (rain) => Math.min(1, Math.max(0, (rain ?? 0) * 1.5));

// gulls: the gulls that come to the boat (sim/gulls.js; on with a boat, GULLS.on); false: v1's far flock only
export function createBirdSim({ terrain, waterAt = null, wind = null, seed = 1, tier = 'high', boat = () => null, start = null, dive = BIRDS.diveDefault, gulls: gullsOn = GULLS.on } = {}) {
  const T = BIRD_TIERS[tier] ?? BIRD_TIERS.high;
  const places = bayPlaces(terrain, seed);
  const counts = { osprey: 3, eagle: 3, gull: T.gulls, goose: T.geese };
  const snag = snagMesh({ terrain, at: places.snag, seed });

  // --- the cast (v1's, in v1's order: the ids and the seeds follow it) ---
  const s0 = start ?? [1200, -1050];
  const birds = [];
  const make = (name, mode, opts) => { const b = new Bird(name, birds.length, seed, opts); b.mode = mode; birds.push(b); return b; };
  const hunter = make('osprey', 'hunt', { pos: [s0[0] - 120, 38, s0[1] - 80], yaw: 1.2 });
  const osprey2 = make('osprey', 'soar', { pos: [200, 160, -300], yaw: 0 });
  osprey2.state.centre = [200, -300];
  const eagle = make('eagle', 'soar', { pos: [places.thermals[0]?.[0] ?? 0, 230, places.thermals[0]?.[1] ?? 400], yaw: 0 });
  eagle.state.centre = [...(places.thermals[0] ?? [0, 400])];
  const perch = [...snag.perch];
  const perched = make('eagle', 'perch', { pos: [...snag.perch] });
  perched.yaw = snag.perchYaw;
  const gulls = [];
  for (let i = 0; i < T.gulls; i++) { const r = rng(hashSeed(seed, 900 + i)); gulls.push(make('gull', 'flock', { pos: [s0[0] + 150 + (r() - 0.5) * 60, 30 + r() * 15, s0[1] - 250 + (r() - 0.5) * 60], yaw: r() * 6.28 })); }
  const geese = { members: [], alarm: null, dest: null };
  for (let i = 0; i < T.geese; i++) {
    const a = i * 2.4, rr = 2.5 + 1.6 * Math.sqrt(i);
    const g = make('goose', 'raft', { pos: [places.raft[0] + Math.cos(a) * rr, 0, places.raft[1] + Math.sin(a) * rr], yaw: a * 1.7, speed: 0.3 });
    g.state.home = [places.raft[0], places.raft[1]];
    geese.members.push(g);
  }

  // --- the world the birds read ---
  const events = [], log = [];
  let simT = 0, lastT = null, shelter = 0, sunElev = 30, windAt = null;
  const sunDir = [0.3, 0.8, 0.2];
  const env = {
    heightAt: terrain.heightAt,
    waterAt: (x, z) => { try { return waterAt ? waterAt(x, z, simT) : 0; } catch { return 0; } },
    wind: [0, 0], camera: [0, 0, 0], sunElev: 30, shelter: 0, dive,
    boat: () => { const s = boat(); return s && Number.isFinite(s.x) ? { x: s.x, z: s.z, sog: s.sog ?? Math.hypot(s.u ?? 0, s.v ?? 0), heading: s.heading ?? 0 } : null; },
    emit: (e) => { if (T.only && e.species !== T.only) return; e.t = simT; events.push(e); log.push(e); if (log.length > 4000) log.splice(0, 1000); },
    thermals: places.thermals.length ? places.thermals : [[0, 600], [1200, 300]],
    nest: places.nest,
    gooseDest: (b) => {
      const r = b.r;
      for (let k = 0; k < 40; k++) {
        const a = r() * 6.28, d = 500 + r() * 500, x = b.pos[0] + Math.cos(a) * d, z = b.pos[2] + Math.sin(a) * d;
        const sd = terrain.shoreDistance?.(x, z) ?? -60;
        if (terrain.heightAt(x, z) < -3 && sd < -30 && sd > -110) return [x, z];
      }
      return [places.raft[0], places.raft[1]];
    },
  };
  const flockGoal = () => {
    const b = env.boat() ?? { x: s0[0], z: s0[1] };
    return [b.x + Math.sin(simT * 0.031) * 220 + 80, 30 + 12 * Math.sin(simT * 0.05), b.z + Math.cos(simT * 0.023) * 180 - 60];
  };

  // the gulls that come to the boat (sim/gulls.js): the first few of the flock, in visits; without a boat v1's flock as it is
  const circle = gullsOn ? createGulls({ gulls, seed, env }) : null;

  // the staged dive (DIVE): play time, the dive under way, the dives it laid (WHEN is the stage director's: tryDive below)
  const dv = { playT: 0, count: 0, active: null, holdWait: 0, side: hash01(seed, 2) < 0.5 ? 1 : -1, dives: [], why: {}, on: false, turn: 0, lastH: null };
  const why = (k) => { dv.why[k] = (dv.why[k] ?? 0) + 1; };
  function direct(dt, beat) {
    dv.on = !!dive;
    if (!dive) return;
    env.dive = false;   // the stage owns when: v1's random dives off
    const playing = beat.playing !== false;
    if (!playing || !(dt > 0)) return;
    dv.playT += dt;
    const b0 = env.boat();   // the boat's turn rate (a turning boat would carry the strike out of the view)
    if (b0) { dv.turn = dv.lastH == null ? 0 : Math.abs(Math.atan2(Math.sin(b0.heading - dv.lastH), Math.cos(b0.heading - dv.lastH))) / dt; dv.lastH = b0.heading; }
    const A = dv.active;
    if (A) {   // a dive under way: done once the hunter carries its fish, let go if it never hovers
      const ph = hunter.state.phase;
      if (ph !== 'patrol' && !A.hoverAt) A.hoverAt = +dv.playT.toFixed(2);
      if (ph === 'carry' || (ph === 'patrol' && A.hoverAt) || (!A.hoverAt && dv.playT - A.cueAt > DIVE.abortS)) {
        A.endAt = +dv.playT.toFixed(2); A.done = ph === 'carry'; dv.active = null;
        hunter.state.directed = false;   // its carry is v1's own; the next patrol is not this dive's
        if (!A.done) hunter.state.force = false;
      }
    }
  }
  // the stage director's ask (one call a frame while it waits; dt counts the hold): the gates, then the dive. beat { view, race }
  // → { ok: true, dive } or { ok: false, why } (why: off, active, race, night, storm, hunting, noView, turning, hunterInView, noSpot)
  function tryDive(beat = {}, dt = 0) {
    const no = (k) => { why(k); return { ok: false, why: k }; };
    if (!dive) return no('off');
    if (dv.active) return no('active');
    if (beat.race) return no('race');
    if (sunElev < DIVE.minSun) return no('night');
    if (shelter >= 0.3) return no('storm');
    const ph = hunter.state.phase;
    if (ph !== 'patrol' && ph !== 'carry') return no('hunting');
    const b = env.boat(), view = beat.view;
    if (!b || !view) return no('noView');
    if (dv.turn > DIVE.turnMax * Math.PI / 180) return no('turning');
    // the hunter in plain sight: wait a little for it to leave the view before it is moved
    const hv = Math.atan2(hunter.pos[0] - view.x, -(hunter.pos[2] - view.z)) - view.yaw;
    const seen = hunter.fade > 0.05 && Math.abs(Math.atan2(Math.sin(hv), Math.cos(hv))) < view.hHalf + 0.1 && Math.hypot(hunter.pos[0] - view.x, hunter.pos[2] - view.z) < 600;
    if (seen && dv.holdWait < DIVE.holdMaxS) { dv.holdWait += dt; return no('hunterInView'); }
    const d = startDive({ view, seen });
    return d ? { ok: true, dive: d } : no('noSpot');
  }
  // the dive's one entry (tryDive's last step; a film may call it directly): place it
  // in the view and send the hunter in; the bird's motion is v1's hunt. ctx { view, seen? }; → the dive's record, or null (no
  // spot in the view, or a dive already under way)
  function startDive(ctx = {}) {
    const b = env.boat(), view = ctx.view;
    if (dv.active || !b || !view) return null;
    const p = placeDive({ boat: b, view, wind: env.wind, terrain, side0: dv.side });
    if (!p) return null;
    // the cue (v1's 'plunge' cue: a forced patrol to the hover point), sent in from beyond it; it fades in out there
    Object.assign(hunter.pos, p.from); hunter.yaw = p.yaw; hunter.speed = hunter.sp.flight.cruise * 0.9; hunter.vy = 0; hunter.fade = ctx.seen ? hunter.fade : 0;
    hunter.state = { phase: 'patrol', t: 0, next: 1e9, wp: [...p.start], alt: p.hover[1] + 1, force: true, directed: true, plan: { side: p.side, bear: p.bear, R: p.R } };
    env.dive = false;
    dv.count++; dv.holdWait = 0; dv.side = -p.side;
    dv.active = { n: dv.count, cueAt: +dv.playT.toFixed(2), strike: p.strike.map((v) => +v.toFixed(1)), side: p.side, bear: p.bear, R: p.R, hoverAt: null, strikeAt: null, endAt: null, start: p.start.map((v) => +v.toFixed(1)), camS: p.camS, camH: p.camH, bg: p.bg };
    dv.dives.push(dv.active);
    return dv.active;
  }
  // the directed hunter at its hover point: into the hover (v1's own transition; the boat's 50–120 m rule is the director's)
  function directedHover() {
    const S = hunter.state;
    if (!S.directed || S.phase !== 'patrol' || Math.hypot(hunter.pos[0] - S.wp[0], hunter.pos[2] - S.wp[1]) >= 2.5) return;
    S.phase = 'hover'; S.t = 0; S.next = null; S.hoverFor = hunter.rand(2.2, 4.5); S.alt = null; S.hoverY = DIVE.hoverY;   // the planned height (v1 holds S.hoverY)
  }

  // the stoop's fish where the plan put it: at the stoop's start the strike is re-laid off the boat as she is now (her bearing and
  // distance, ≈ 2 s on), so a close dive keeps its 25–40° off the bow; the bird's own stoop flies to it (a shift of 12 m at most)
  function directedAim() {
    const S = hunter.state;
    if (!S.directed || S.phase !== 'stoop' || S.reaimed || !S.aim || !S.plan) return;
    S.reaimed = true;
    const b = env.boat(); if (!b) return;
    const go = (b.sog ?? 0) * 2.0, a = b.heading + S.plan.side * S.plan.bear * Math.PI / 180;
    const x = b.x + Math.sin(b.heading) * go + Math.sin(a) * S.plan.R, z = b.z - Math.cos(b.heading) * go - Math.cos(a) * S.plan.R;
    if (!(terrain.heightAt(x, z) < -DIVE.depth)) return;
    const dx = x - S.aim[0], dz = z - S.aim[1], d = Math.hypot(dx, dz), k = d > 12 ? 12 / d : 1;
    S.aim = [S.aim[0] + dx * k, S.aim[1] + dz * k];
  }

  // the director (v1's cues, for captures and films)
  const lowpass = { bird: null, S: null };
  function cue(kind, o = {}) {
    if (kind === 'plunge') {
      const x = o.x ?? s0[0], z = o.z ?? s0[1];
      Object.assign(hunter.pos, [x - Math.sin(o.yaw ?? 0) * (o.back ?? 35), o.y ?? 26, z - Math.cos(o.yaw ?? 0) * (o.back ?? 35)]);
      hunter.yaw = o.yaw ?? 0; hunter.speed = 8; hunter.vy = 0;
      hunter.state = { phase: 'patrol', t: 0, next: o.after ?? 4, wp: [x, z], alt: o.y ?? 26, force: true };
      hunter.fade = 1;
    } else if (kind === 'lowpass') {
      const b = o.bird === 'osprey' ? osprey2 : eagle;
      lowpass.bird = b; lowpass.S = { offset: o.offset, height: o.height, side: o.side, direct: !!o.from };
      if (o.from) { Object.assign(b.pos, o.from); b.yaw = o.yaw ?? b.yaw; }
      b.mode = 'lowpass';
    } else if (kind === 'takeoff') {
      geese.alarm = simT; geese.hold = false;
      for (const g of geese.members) if (g.state.phase === 'rest') { g.state.phase = 'alarm'; g.state.t = 0; g.state.delay = g.rand(0.1, 0.9); g.state.runYaw = o.yaw ?? null; }
    } else if (kind === 'raft') {
      geese.members.forEach((g, i) => { const a = i * 2.4, rr = 2.5 + 1.6 * Math.sqrt(i); g.state = { phase: 'rest', t: 0, home: [o.x, o.z] }; g.pos = [o.x + Math.cos(a) * rr, 0, o.z + Math.sin(a) * rr]; g.yaw = o.yaw ?? a * 1.7; });
      geese.alarm = null; geese.dest = null; geese.hold = !!o.hold;
    } else if (kind === 'flock') {
      for (const g of gulls) { g.pos[0] += (o.x ?? 0) - g.pos[0] + (g.id % 4) * 5; g.pos[2] += (o.z ?? 0) - g.pos[2] + (g.id % 3) * 6; g.pos[1] = o.y ?? g.pos[1]; }
    } else if (kind === 'place') {
      const b = { hunter, osprey2, eagle, perched }[o.who];
      if (b) { if (o.pos) b.pos = [...o.pos]; if (o.yaw != null) b.yaw = o.yaw; if (o.mode) b.mode = o.mode; if (o.state) b.state = { ...o.state }; }
    }
  }

  // --- the step: fixed substeps on the scene clock (v1's stepAll) ---
  const H = 1 / 60;
  function stepAll(dt) {
    simT += dt;
    env.simT = simT;
    const day = smooth(-4, 3, sunElev);
    for (const b of birds) {
      b.t += dt;
      const airborne = b.mode !== 'raft' && b.mode !== 'perch';
      const rank = ((b.id * 0.618034) % 1) * 0.9 + 0.05;
      const away = airborne && (shelter > rank || day < 0.5);
      b.fadeTarget = away || b.homing ? 0 : 1;
      b.fade += Math.max(-dt / 6, Math.min(dt / 6, b.fadeTarget - b.fade));
      if (b === perched) {
        const dc = Math.hypot(perch[0] - env.camera[0], perch[1] - env.camera[1], perch[2] - env.camera[2]);
        if (b.mode === 'perch' && dc < SOFT_M + 25) { b.mode = 'soar'; b.yaw = Math.atan2(perch[0] - env.camera[0], perch[2] - env.camera[2]); b.speed = 6; b.vy = 1.5; b.forceFlap = 1; b.state = { centre: [perch[0] + Math.sin(b.yaw) * 160, perch[2] + Math.cos(b.yaw) * 160], top: 140, phase: 'glide', next: [perch[0] + Math.sin(b.yaw) * 160, perch[2] + Math.cos(b.yaw) * 160] }; b.left = simT; }
        else if (b.mode === 'soar' && dc > 320 && simT - b.left > 60 && Math.hypot(b.pos[0] - env.camera[0], b.pos[2] - env.camera[2]) > 300) { b.homing = true; if (b.fade < 0.01) { b.mode = 'perch'; b.pos = [...perch]; b.yaw = snag.perchYaw; b.state = {}; b.homing = false; } }
      }
      if (b === hunter) directedHover();
      switch (b.mode) {
        case 'hunt': stepHunt(b, dt, env, b.state); if (b === hunter) directedAim(); break;
        case 'soar': stepSoar(b, dt, env, b.state); break;
        case 'perch': stepPerch(b, dt, env, b.state); break;
        case 'raft': stepRaft(b, dt, env, b.state, geese); break;
        case 'lowpass': if (stepLowPass(b, dt, env, lowpass.S) === 'done') { b.mode = 'soar'; b.state = { centre: [b.pos[0] + 60, b.pos[2]], top: 160 }; } break;
      }
      keepAway(b, env.camera, dt, !(b === hunter && dv.active) && b.mode !== 'circle');   // the staged dive and a circling gull: the soft push off (their distance is planned), the floor kept
      b.update(dt);
    }
    stepFlock(gulls, dt, env, flockGoal);
    circle?.step(dt, simT, { day, shelter });   // the circling gulls (mode 'circle'): stepFlock leaves them out
    for (const g of gulls) { keepAway(g, env.camera, dt, g.mode !== 'circle'); g.update(dt); }
  }

  // --- the frame's draw records (v1's mesh.js push and shadows.js push, as arrays) ---
  const mk = (n) => ({ data: new Float32Array(Math.max(1, n) * ISTRIDE), n: 0, max: n });
  const draw = {
    near: Object.fromEntries(NAMES.map((n) => [n, mk(counts[n])])),
    far: Object.fromEntries(NAMES.map((n) => [n, mk(counts[n])])),
    shadows: { data: new Float32Array(SHADOW_MAX * SSTRIDE), n: 0, max: SHADOW_MAX },
  };
  function push(rec, b, fade) {
    if (rec.n >= rec.max) return;
    const arr = rec.data, o = rec.n * ISTRIDE, P = b.pose;
    arr[o] = b.pos[0]; arr[o + 1] = b.pos[1]; arr[o + 2] = b.pos[2]; arr[o + 3] = b.scale ?? 1;
    arr[o + 4] = b.quat[0]; arr[o + 5] = b.quat[1]; arr[o + 6] = b.quat[2]; arr[o + 7] = b.quat[3];
    arr[o + 8] = P.flap; arr[o + 9] = P.hand; arr[o + 10] = P.armSweep; arr[o + 11] = P.handSweep;
    arr[o + 12] = P.fold; arr[o + 13] = P.splay; arr[o + 14] = P.tail; arr[o + 15] = P.curl;
    arr[o + 16] = P.legs; arr[o + 17] = P.fish; arr[o + 18] = P.headYaw; arr[o + 19] = fade;
    arr[o + 20] = P.headPitch; arr[o + 21] = P.tailPitch; arr[o + 22] = 0; arr[o + 23] = 0;
    rec.n++;
  }
  function pushShadow(b, sun, waterY, opacity) {
    const S = draw.shadows;
    if (S.n >= S.max || opacity < 0.01) return;
    const h = b.pos[1] - waterY, k = h / Math.max(0.05, sun[1]);
    const x = b.pos[0] - sun[0] * k, z = b.pos[2] - sun[2] * k;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), sp = b.sp;
    const blur = Math.min(0.9, 0.25 + h * 0.03);
    const span = sp.spanM * 0.5 * Math.cos(b.roll) * (b.pose.fold > 0.5 ? 0.25 : 1) * (1 + blur * 0.3);
    const len = sp.lengthM * 0.5 / Math.max(0.35, sun[1]) ** 0.5;
    const arr = S.data, o = S.n * SSTRIDE;
    arr[o] = x; arr[o + 1] = waterY + 0.06; arr[o + 2] = z; arr[o + 3] = opacity * 0.38;
    arr[o + 4] = fz; arr[o + 5] = -fx; arr[o + 6] = span; arr[o + 7] = 0.25 + blur * 0.6;
    arr[o + 8] = fx; arr[o + 9] = fz; arr[o + 10] = len * (1 + blur * 0.4); arr[o + 11] = 0.3 + blur * 0.5;
    S.n++;
  }

  const stats = { birds: birds.length, drawn: 0, near: 0, far: 0, shadows: 0, ms: 0 };
  // a frame: t the scene clock (s), cam the eye [x, y, z] (v1's update(t, camera))
  function update(t, cam, beat = null) {
    const t0 = globalThis.performance?.now?.() ?? 0;
    env.camera[0] = cam[0]; env.camera[1] = cam[1]; env.camera[2] = cam[2];
    if (wind && (windAt == null || Math.abs(t - windAt) > 0.5)) {   // the one wind field, read twice a second
      windAt = t;
      try { const w = wind.sample(cam[0], cam[2], t); env.wind[0] = w.vx; env.wind[1] = w.vz; } catch { /* no wind here */ }
    }
    env.sunElev = sunElev; env.shelter = shelter;
    events.length = 0;
    let dt = lastT == null ? 0 : t - lastT;
    lastT = t;
    if (beat && dt > 2) dv.wasRace = true;   // the page away (a race skips the birds' frames): a gap after it
    if (!(dt > 0) || dt > 10) dt = 0;
    if (beat) direct(dt, beat);
    let n = Math.ceil(dt / H);
    if (n > 40) n = 40;
    for (let i = 0; i < n; i++) stepAll(dt / n);
    for (const b of birds) { keepAway(b, env.camera, 0); b.update(0); }
    if (dv.dives.length) { const A = dv.dives[dv.dives.length - 1]; for (const e of events) if (e.kind === 'plunge' && e.id === hunter.id && A.strikeAt == null) { A.strikeAt = +dv.playT.toFixed(2); A.at = [+e.pos[0].toFixed(1), +e.pos[2].toFixed(1)]; } }

    for (const name of NAMES) { draw.near[name].n = 0; draw.far[name].n = 0; }
    draw.shadows.n = 0;
    let nn = 0, nf = 0;
    for (const b of birds) {
      if (T.only && b.name !== T.only) continue;   // the phone tier: the gulls only
      const sp = SPECIES[b.name];
      const d = Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]);
      const nearD = sp.spanM * T.near, cull = sp.spanM * T.cull;
      if (b.lod === 0 && d > nearD * 1.1) b.lod = 1; else if (b.lod === 1 && d < nearD * 0.9) b.lod = 0;
      b.lodT += Math.max(-dt / 0.6, Math.min(dt / 0.6, b.lod - b.lodT));
      if (dt === 0) b.lodT = b.lod;
      const vis = b.fade * smooth(cull, cull * 0.8, d);
      if (vis < 0.01) continue;
      if (b.lodT < 0.999) { push(draw.near[b.name], b, vis * (1 - b.lodT)); nn++; }
      if (b.lodT > 0.001) { push(draw.far[b.name], b, vis * b.lodT); nf++; }
      if (T.shadows && sunDir[1] > 0.05 && b.pos[1] < 30 && d < 250) pushShadow(b, sunDir, env.waterAt(b.pos[0], b.pos[2]), vis * smooth(30, 4, b.pos[1]) * smooth(0.05, 0.25, sunDir[1]));
    }
    stats.near = nn; stats.far = nf; stats.drawn = nn + nf; stats.shadows = draw.shadows.n;
    stats.ms = (globalThis.performance?.now?.() ?? 0) - t0;
  }

  return {
    update, cue, places, birds, stats, log, events, draw, snag, counts, tier: T,
    // the daylight: the sun's height (none in the air at night) and its direction (the shadows)
    setDaylight(elevDeg, dir) { sunElev = elevDeg; if (dir) { sunDir[0] = dir[0]; sunDir[1] = dir[1]; sunDir[2] = dir[2]; } },
    setShelter(s) { shelter = clamp01(s); },
    get shelter() { return shelter; },
    get dive() { return dive; },
    get time() { return simT; },
    // the staged dive: the dives it laid (the tests, the diag); diveBusy: a dive under way
    get director() { return { on: dv.on, playT: +dv.playT.toFixed(2), count: dv.count, active: !!dv.active, dives: dv.dives, why: { ...dv.why } }; },
    get diveBusy() { return !!dv.active; },
    tryDive,     // the stage director's ask: the gates, then startDive → { ok, dive } | { ok: false, why }
    startDive,   // the dive's one entry: startDive({ view }) → its record or null (DIVE; a stage director's handle)
    find: (who) => ({ hunter, osprey2, eagle, perched, gulls, geese: geese.members })[who],
    circle,      // the gulls at the boat (sim/gulls.js): state, calls, params (the tests, the diag)
  };
}
