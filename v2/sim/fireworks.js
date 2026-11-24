// The fireworks' CPU side (v2): v1's show (src/fireworks/show.js, stage.js wowShow), its shells (shells.js), its riser
// ballistics (physics.js fly), the smoke (smoke.js), the flash bank (flash.js) and the draw span (drawSpan.js), all
// imported as they are; this file is the scheduler v1's src/fireworks/engine.js keeps beside its TSL kernel (the
// schedule, the ring of slots, the stars written when their launch is near, the bursts' records), line for line, without
// three. The GPU side (render/fireworks.js) uploads the dirty slot ranges and runs v1's starStep on them. Pure: the
// tests drive it in node.
//   const S = createShowState({ show, barges, scale, tier })
//   S.seekPlan(t) → { t0, n }       a seek: everything cleared, the replay's start (n fixed STEPs of 1/60 s to reach t)
//   S.spawnDue(tEnd, wind)          the shells launching up to tEnd written into the staging array (dirty ranges queued)
//   S.advance(dt)                   the show clock forward (a dispatch's dt)
//   S.after(t, wind, camPos)        the live count, the draw span, the flash bank (8 slots), the smoke's instances
//   S.takeDirty()                   → [[startSlot, count]] since the last call (the upload list)
//   S.staging                       Float32Array(capacity × STAR_FLOATS): p, v, c, tr, f, k, x (7 vec4 a star, v1's buffers interleaved)
import { STEP, fly, RISER_K } from '../../src/fireworks/physics.js';
import { buildShell, riserStar, HISTORY, PALETTE, burstRadius, thinStars } from '../../src/fireworks/shells.js';
import { shellLife, makeShow, SHOW_LENGTH, SHOW_START_HOUR } from '../../src/fireworks/show.js';
import { flashSlots, flashOf, FLASH_SLOTS, GLOW } from '../../src/fireworks/flash.js';
import { puffsFor, puffAt, SMOKE } from '../../src/fireworks/smoke.js';
import { createDrawSpan, starEnd } from '../../src/fireworks/drawSpan.js';
import { VIEW, bargesWorld, SCALE, SHOW_FRAME, wowShow, AIM } from '../../src/fireworks/stage.js';
import { showOn } from '../../src/fireworks/share.js';

export { STEP, HISTORY, FLASH_SLOTS, SMOKE, SHOW_LENGTH, SHOW_START_HOUR, VIEW, SCALE, SHOW_FRAME, AIM, showOn, bargesWorld };

// copied from src/fireworks/engine.js (three-bound there): the tiers, the look (screen levels × 1 / exposure), the replay
export const TIERS = Object.freeze({
  desktop: { capacity: 65536, trails: true, smoke: SMOKE.max, flash: true, draw: 32 },   // draw 32 (was 16; 2026-11-18, the v1-grade round: more of v1's lit smoke haze; 64 piled into a white fog at the finale, additive)
  phone: { capacity: 32768, trails: false, smoke: 96, flash: true, draw: 8 },   // draw: v2's puffs drawn a frame (the brightest; the smoke's fill)
});
export const LOOK = Object.freeze({ dying: 0.22, ember: 0.5, head: 1.15, trail: 0.85, vRef: 18, smoke: 6, smokeBase: 0.002, smokeM: 90, smokeCover: 30, headPx: 1.3, trailPx: 1.3 });
export const PREROLL = 26, LOOKAHEAD = 0.5, DECK_Y = 2.5;
export const STAR_FLOATS = 28;   // 7 vec4
export const PUFF_FLOATS = 8;    // pos.xyz, radius, alpha, seed, 0, 0
// a puff is drawn only where the bank lights it enough to see (v2: the smoke's fill is the show's cost): its core's level,
// alpha × the bank's light at its centre (smoke.js, engine.js: LOOK.smoke over (d / smokeM)² + 1) × v2's pile share, in screen levels
// SMOKE_PILE: v1's puffs each cover the smoke drawn before them (its fireworks target's coverage blend), so a pile reads as
// its top puff; v2 adds the brightest T.draw into the scene (desktop 32), each at 0.3 (one to two deep in front of the show)
export const PUFF_SEEN = 1e-3, SMOKE_PILE = 0.3;
export function puffLevel(q, flash, scale = SCALE) {
  let L = 0;
  for (let k = 0; k < FLASH_SLOTS; k++) {
    const e = flash.pos[k * 4 + 3] + flash.col[k * 4 + 3]; if (e <= 0) continue;
    const c = Math.max(flash.col[k * 4], flash.col[k * 4 + 1], flash.col[k * 4 + 2]);
    const d = Math.hypot(q.pos[0] - flash.pos[k * 4], q.pos[1] - flash.pos[k * 4 + 1], q.pos[2] - flash.pos[k * 4 + 2]) / (LOOK.smokeM * scale);
    L += c * e / (d * d + 1);
  }
  return q.alpha * (L * LOOK.smoke + LOOK.smokeBase) * SMOKE_PILE;
}
// copied from src/fireworks/world.js (three-bound there): show s per game s, and the show time for a game hour
export const SHOW_GAME_RATE = 4;
export function showTimeAt(hour) {
  const t = ((hour - SHOW_START_HOUR) * 3600) / SHOW_GAME_RATE;
  return t > -600 && t < SHOW_LENGTH + 120 ? t : null;
}
// the props' evening (src/fireworks/presence.js PRESENCE.barges): the barges lie on their spots 20:30–23:30
export const BARGE_HOURS = Object.freeze([20.5, 23.5]);
export const bargesOut = (hour) => hour > BARGE_HOURS[0] && hour < BARGE_HOURS[1];

// The game's show (v1's: world.js attachFireworks): the wow show over seed's script; the tall layout on an upright screen
export const gameShow = (seed = 1, { tall = false, barges = bargesWorld() } = {}) => wowShow(makeShow, seed, { tall, barges });   // barges: the launch site (sim/fireworksSite.js)

// The show clock of a v2 page (v1's evening runs the game's clock at 4 game s a show s from 21:44; v2's clock has a fixed
// rate, so a page that opens inside the show's window plays it in real time from the hour it opened at): ?fwt pins it.
//   showClock({ pin, hour0, timerate }) → (simT, hourNow) → show s or null (outside the window)
export function showClock({ pin = null, hour0 = 13, timerate = 0 } = {}) {
  const base = pin ?? showTimeAt(hour0);
  return (simT, hourNow) => {
    if (pin == null && timerate > 0) return showTimeAt(hourNow);   // a running day clock: the show follows the hour
    if (base == null) return null;
    const t = base + simT;
    return t < SHOW_LENGTH + 120 ? t : null;
  };
}

// The show clock of a live page whose day clock runs (owner, 2026-11-15: "Fireworks is a time-based event independent of
// the boat and everything"): nothing slows or holds the day clock for the show, so the show keeps its own clock. It starts
// when the day clock passes 21:44 and then counts real seconds (its 5-minute script at real pace, whatever the day clock's
// rate); before 21:44 it counts down in real seconds at the clock's pace now (inside the old 40 game min window, at most
// 600 s: the barges' lamps, the script's lazy build). A page that opens, or a cut (the time menu) that lands, inside v1's
// show window (showTimeAt: 4 game s a show s, to 22:12) starts at v1's show time for its hour; a cut before 21:44 counts
// down again, a cut past the window misses the show (null) until the next evening.
//   const L = liveShowClock(); each frame: L.step({ hour, dt, rate, cuts, gliding }) → show s or null
//   hour: the hour of day; dt: the real frame s; rate: game s per real s now (clock.rate × the game speed); cuts: clock.cuts;
//   gliding: clock.gliding (fix 2026-11-18: a glide's cut is read where it lands, and no show runs while the hour glides: the
//   Fireworks pick in the show glides a whole day on, so the show starts again from 10 s before, not on from where it was)
export const PRE_WINDOW_S = 600;
export function liveShowClock({ start = SHOW_START_HOUR, length = SHOW_LENGTH, gameRate = SHOW_GAME_RATE } = {}) {
  let t = null, lastH = null, lastCuts = null, running = false, landing = false;
  const pre = (h, rate) => {
    const gameS = (start - h) * 3600;
    if (gameS <= 0 || gameS > PRE_WINDOW_S * gameRate) return null;
    const realS = gameS / Math.max(1e-6, rate);
    return realS <= PRE_WINDOW_S ? -realS : null;
  };
  return {
    get t() { return t; },
    step({ hour, dt = 0, rate = 0, cuts = 0, gliding = false }) {
      const h = ((hour % 24) + 24) % 24;
      if (gliding) { running = false; t = null; landing = true; lastH = h; lastCuts = cuts; return t; }   // the hour on its way: no show
      const first = lastH == null, cut = !first && (cuts !== lastCuts || landing);
      landing = false;
      if (first || cut) {
        const v1 = showTimeAt(h);   // a page opened (or a cut landing) in the window: v1's show time for its hour
        running = v1 != null && v1 >= 0; t = running ? v1 : pre(h, rate);
      } else if (running) {
        t += Math.max(0, dt);
      } else if (lastH < start && h >= start && h - lastH < 1) {
        running = true; t = ((h - start) * 3600) / Math.max(1e-6, rate);   // the clock passed 21:44 this frame: the overshoot in real s
      } else {
        t = h < start ? pre(h, rate) : null;
      }
      if (running && t >= length + 120) { running = false; t = null; }
      lastH = h; lastCuts = cuts;
      return t;
    },
  };
}

// (No start at the viewing spot: owner, 2026-11-15, "the boat is independent". A page opened in the show starts where any
// page starts; the 2026-11-08 "boat close" staging is gone.)

export function createShowState({ show, barges = bargesWorld(), scale = SCALE, tier = 'desktop', waterY = 0 } = {}) {
  const T = TIERS[tier] ?? TIERS.desktop, N = T.capacity;
  const staging = new Float32Array(N * STAR_FLOATS);
  for (let j = 0; j < N; j++) staging[j * STAR_FLOATS + 3] = 1e9;   // every slot dead (born far in the future)
  const useSmoke = T.smoke > 0, useFlash = T.flash;
  const S = { t: 0, next: 0, cursor: 0, ranges: [], bursts: [], spawned: 0, overflow: 0, peak: 0, live: 0 };
  const burstCache = new Map();
  const span = createDrawSpan();
  const puffs = [];
  let dirty = [];
  let windNow = [0, 0, 0];
  const bargeOf = (e) => barges[e.barge % barges.length];
  const mortarOf = (e) => {
    const b = bargeOf(e), ax = b.axis ?? [0, 1];
    return [b.x + (ax[0] * e.jitter[0] - ax[1] * e.jitter[1]) * scale, waterY + DECK_Y, b.z + (ax[1] * e.jitter[0] + ax[0] * e.jitter[1]) * scale];
  };
  const riserV = (e, v0) => [v0 * e.tilt[0] * scale, v0 * scale, v0 * e.tilt[1] * scale];
  function burstOf(e) {
    let b = burstCache.get(e.i);
    if (!b) {
      const m = mortarOf(e), col = PALETTE[e.colour] ?? PALETTE.gold;
      const r = e.ground ? { p: m, v: [0, 0, 0] } : fly(m, riserV(e, e.v0), RISER_K, e.rise, { wind: windNow, scale });
      const fl = flashOf(e.type, e.inches);
      b = { pos: r.p, vel: r.v, burst: e.burst, colour: col.slice(), peak: fl.peak * (e.ground ? 0.4 : 1), tau: fl.tau };
      burstCache.set(e.i, b);
    }
    return b;
  }
  function alloc(n) {
    if (n > N) n = N;
    if (S.cursor + n > N) S.cursor = 0;
    const start = S.cursor, end = start + n;
    S.ranges = S.ranges.filter((r) => { const hit = r.start < end && r.end > start; if (hit && r.expiry > S.t) S.overflow++; return !hit; });
    S.cursor = end;
    return start;
  }
  function write(slot, s, born) {
    const o = slot * STAR_FLOATS, a = staging;
    const br = s.bright ?? 1;
    a[o] = s.p[0]; a[o + 1] = s.p[1]; a[o + 2] = s.p[2]; a[o + 3] = born + (s.delay ?? 0);
    a[o + 4] = s.v[0]; a[o + 5] = s.v[1]; a[o + 6] = s.v[2]; a[o + 7] = s.k;
    a[o + 8] = s.col[0] * br; a[o + 9] = s.col[1] * br; a[o + 10] = s.col[2] * br; a[o + 11] = s.burn;
    a[o + 12] = s.trail[0] * br; a[o + 13] = s.trail[1] * br; a[o + 14] = s.trail[2] * br; a[o + 15] = s.tau;
    a[o + 16] = s.flick + (s.hidden ? 16 : 0); a[o + 17] = s.interval; a[o + 18] = s.width; a[o + 19] = s.headPx;
    a[o + 20] = s.kick[0]; a[o + 21] = s.kick[1]; a[o + 22] = s.kick[2]; a[o + 23] = s.kickAge;
    const c2 = s.col2 ?? [0, 0, 0]; a[o + 24] = c2[0] * br; a[o + 25] = c2[1] * br; a[o + 26] = c2[2] * br; a[o + 27] = s.change ?? 0;
    return starEnd(s, born);
  }
  function spawn(e) {
    const b = bargeOf(e), ax = b.axis ?? [0, 1];
    const shell = buildShell(e.type, { inches: e.inches, colour: e.colour, colour2: e.colour2, seed: e.seed, tier, plane: [ax[0], 0, ax[1]], spread: e.spread ?? 1 });
    const bo = burstOf(e), m = mortarOf(e);
    const stars = shell.stars;
    const n = stars.length + (e.ground ? 0 : 1), start = alloc(n);
    let k0 = start, until = -Infinity;
    if (!e.ground) until = write(k0++, { ...riserStar({ v0: 1, t: e.rise, k: RISER_K / scale, trunk: e.type === 'palm' }), p: m, v: riserV(e, bo.v0 ?? e.v0) }, e.t);
    stars.forEach((s, k) => {
      until = Math.max(until, write(k0 + k, {
        ...s, p: [bo.pos[0] + s.p[0] * scale, bo.pos[1] + s.p[1] * scale, bo.pos[2] + s.p[2] * scale],
        v: [bo.vel[0] + s.v[0] * scale, bo.vel[1] + s.v[1] * scale, bo.vel[2] + s.v[2] * scale],
        k: s.k / scale, kick: s.kick.map((x) => x * scale), headPx: s.headPx,
      }, e.burst));
    });
    let life = 0;
    for (const s of stars) life = Math.max(life, s.delay + Math.max(s.burn, s.kickAge) + 3 * s.tau);
    dirty.push([start, n]);
    S.ranges.push({ start, end: start + n, expiry: e.burst + life + 0.5, n, from: e.t });
    span.add(start, start + n, until);
    if (useFlash) S.bursts.push(bo);
    if (useSmoke && !e.ground && e.inches >= SMOKE.minInches) for (const pf of puffsFor(bo, { seed: e.seed, scale, tier, radius: burstRadius(e.inches) * (e.spread ?? 1) })) puffs.push(pf);
    S.spawned++;
  }
  const flash = { pos: new Float32Array(FLASH_SLOTS * 4), col: new Float32Array(FLASH_SLOTS * 4), sum: [0, 0, 0] };
  const puffData = new Float32Array(T.smoke * PUFF_FLOATS);
  let puffCount = 0, drawn = 0;
  return {
    N, tier, trails: T.trails, staging, flash, puffData, history: HISTORY,
    get t() { return S.t; },
    get drawn() { return drawn; },
    get puffCount() { return puffCount; },
    get active() { return S.live > 0 || puffs.length > 0 || drawn > 0; },
    get show() { return show; },
    setShow(s) { show = s; burstCache.clear(); },
    setWind(w) { windNow = [w[0], w[1] ?? 0, w[2]]; },
    spawnDue(tEnd) { const ev = show.events; let k = 0; while (S.next < ev.length && ev[S.next].t <= tEnd) { spawn(ev[S.next++]); k++; } return k; },
    advance(dt) { S.t += dt; },
    drawnAt() { return span.count(S.t); },   // the slots a dispatch must cover now (v1 ran all of them)
    takeDirty() { const d = dirty; dirty = []; return d; },
    // a seek (v1's engine.seek): the replay's start and step count; the caller clears the GPU's slots, then for each of n
    // steps calls spawnDue(t + STEP + LOOKAHEAD), uploads and dispatches one STEP, then sets the clock to t
    seekPlan(t) {
      Object.assign(S, { cursor: 0, ranges: [], bursts: [], next: 0, peak: 0, live: 0 });
      span.reset(); puffs.length = 0; dirty = [];
      const ev = show.events;
      let t0 = t;
      for (const e of ev) if (e.t <= t && e.burst + shellLife(e.type, e.inches) > t) t0 = Math.min(t0, e.t);
      t0 = Math.floor(Math.max(t0, t - PREROLL) / STEP) * STEP - STEP;
      while (S.next < ev.length && ev[S.next].t < t0) S.next++;
      if (useSmoke) for (const e of ev) if (!e.ground && e.inches >= SMOKE.minInches && e.t < t0 && e.burst > t - SMOKE.life && e.burst <= t) for (const pf of puffsFor(burstOf(e), { seed: e.seed, scale, tier, radius: burstRadius(e.inches) * (e.spread ?? 1) })) puffs.push(pf);
      S.t = t0;
      return { t0, n: Math.round((t - t0) / STEP) };
    },
    setTime(t) { S.t = t; },
    // leaving the show (fix 2026-11-18, owner: "the last fireworks are left in the sky"): every star, burst, flash and puff
    // dropped at once, the script's cursor at the first shell after t (null: the start); the caller clears the GPU's slots
    reset(t = null) {
      const ev = show.events;
      let next = 0;
      if (t != null) while (next < ev.length && ev[next].t < t) next++;
      Object.assign(S, { cursor: 0, ranges: [], bursts: [], next, live: 0 });
      span.reset(); puffs.length = 0; dirty = [];
      if (t != null) S.t = t;
      drawn = 0; puffCount = 0;
      flash.pos.fill(0); flash.col.fill(0); flash.sum = [0, 0, 0];
    },
    // after a frame's dispatch (v1's engine after()): the live count, the span, the flash bank, the smoke's instances
    after(t = S.t) {
      S.ranges = S.ranges.filter((r) => r.expiry > t - 1);
      S.live = 0; for (const r of S.ranges) if (t >= r.from && t <= r.expiry) S.live += r.n;
      S.peak = Math.max(S.peak, S.live);
      drawn = span.count(t);
      flash.sum = [0, 0, 0];
      if (useFlash) {
        S.bursts = S.bursts.filter((b) => t - b.burst < GLOW.maxS + 1);
        flashSlots(S.bursts, t).forEach((s, k) => {
          flash.pos.set([s.pos[0], s.pos[1], s.pos[2], s.intensity], k * 4); flash.col.set([s.colour[0], s.colour[1], s.colour[2], s.glow], k * 4);
          for (let c = 0; c < 3; c++) flash.sum[c] += s.colour[c] * s.intensity;
        });
      }
      puffCount = 0;
      if (useSmoke) {
        const w = windNow.map((x) => x * scale), M = T.smoke;
        const cand = [];
        for (let k = puffs.length - 1, n = 0; k >= 0 && n < M; k--) {
          const q = puffAt(puffs[k], t, w);
          if (!q) { if (t - puffs[k].born > SMOKE.life) puffs.splice(k, 1); continue; }
          n++;
          const lv = puffLevel(q, flash, scale);
          if (lv >= PUFF_SEEN) cand.push({ q, lv, seed: puffs[k].seed });   // unlit: nothing to see (it stays in the air)
        }
        // the brightest T.draw of them (v1's pool, v2's fill budget); the order is the level's, then the seed's (deterministic)
        cand.sort((a, b) => b.lv - a.lv || a.seed - b.seed);
        for (const { q, seed } of cand.slice(0, T.draw)) { puffData.set([q.pos[0], q.pos[1], q.pos[2], q.radius, q.alpha, seed, 0, 0], puffCount * PUFF_FLOATS); puffCount++; }
      }
    },
    stats: () => ({ t: +S.t.toFixed(3), live: S.live, peak: S.peak, capacity: N, spawned: S.spawned, overflow: S.overflow, tier, trails: T.trails, puffs: puffCount, drawn }),
  };
}

// The barges, their pushboats and the patrol boats (owner, 2026-11-18: "bring them to at least the channel buoys' quality";
//, 2026-11-18: a fleet deck barge of 120 × 30 × 7 ft, sand on the deck, black tubes in wooden racks, a
// container and a shed, a pushboat at the stern), as boxes in the world (pure). Each box:
// { c: [x, y, z] centre, h: [hx, hy, hz] half sizes, yaw, tone: [r, g, b] (linear albedo), mat, rake, pivot: [x, z], bob, seed }
//   mat (render/fireworks.js PROP_WGSL): 0 paint, 1 hull steel (rust runs, the waterline's stain), 2 the deck (scuffed steel), 3 a
//   rack crate (planks, the tubes' black mouths on top), 4 sand, 5 a rail (galvanised), 6 a tyre fender, 7 the container
//   (ribbed, rusted), 8 glass (the wheelhouse's windows)
//   rake: the bottom of the box's +x (rake > 0) or −x (< 0) end drawn in by |rake| of its length (the barge's raked ends)
//   pivot, bob: the craft the box rides on (its middle) and its bob's share (1 a barge, 0 none): the boxes heave and roll as one
// lamps: { p, col, px, kind } (kind 0 work light, 1 white (anchor, masthead), 2 red side, 3 green side, 4 the patrol's blue bar)
export const BARGE = Object.freeze({ length: 36.6, beam: 9.1, depth: 2.1, freeboard: 1.0, zone: 110, tug: Object.freeze({ length: 12, beam: 5 }) });
export const BOX_FLOATS = 16;   // centre.xyz yaw | half sizes, rake | tone, seed | pivot.xz, mat, bob
const srgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const C = { hull: 0x2b2e30, deck: 0x55595b, sand: 0xb9a77c, rack: 0x8a6b45, cont: 0xa8321f, cont2: 0x3e5c76, shed: 0xc9c4b6, gen: 0x3d4a3a,
  rail: 0x8c9094, fender: 0x0e0e0e, tugHull: 0x1f2a33, tugHouse: 0xe2ddd0, glass: 0x10161c, ring: 0xe0561c, cake: 0x6a4a2c, box: 0x2a2a2a };
export function bargeProps(barges = bargesWorld(), toward = VIEW, waterY = 0) {
  const boxes = [], lamps = [], patrols = [];
  barges.forEach((b, bi) => {
    // the long axis square to the line of sight (stage.js bargesWorld axis); local x along it, local z toward the far side
    const ax = b.axis, yaw = Math.atan2(-ax[1], ax[0]);   // rotate local +x onto the axis (world x east, z south)
    const L = (lx, ly, lz) => [b.x + ax[0] * lx - ax[1] * lz, waterY + ly, b.z + ax[1] * lx + ax[0] * lz];
    let seed = bi * 97 + 1;
    const box = (lx, ly, lz, hx, hy, hz, hex, mat = 0, rake = 0) => boxes.push({ c: L(lx, ly, lz), h: [hx, hy, hz], yaw, tone: srgb(hex), mat, rake, pivot: [b.x, b.z], bob: 1, seed: (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const H = BARGE.length / 2, Bm = BARGE.beam / 2, F = BARGE.freeboard, D = BARGE.depth - F, end = 1.8;
    // the hull: the box between the rakes, and the raked ends (the bottom drawn in: a box bow and stern), to D under the water
    box(0, (F - D) / 2, 0, H - end, (F + D) / 2, Bm, C.hull, 1);
    box(H - end / 2, (F - D) / 2, 0, end / 2, (F + D) / 2, Bm, C.hull, 1, 0.75);
    box(-H + end / 2, (F - D) / 2, 0, end / 2, (F + D) / 2, Bm, C.hull, 1, -0.75);
    box(0, F + 0.03, 0, H - 0.1, 0.03, Bm - 0.1, C.deck, 2);                                                // the deck plate
    for (const s of [-1, 1]) box(0, F + 0.15, s * (Bm - 0.08), H - 0.1, 0.15, 0.08, C.hull, 1);             // the coamings
    for (const s of [-1, 1]) box(s * (H - 0.08), F + 0.15, 0, 0.08, 0.15, Bm - 0.1, C.hull, 1);
    // the firing deck: two rows of rack crates (2.4 × 1.2 m, about a metre tall, the black tubes in them) in sand, the cakes
    for (const rz of [-2.1, 1.3]) {
      box(-4, F + 0.22, rz, 12.6, 0.22, 1.45, C.sand, 4);                                                  // the sand under and round the row
      for (let k = 0; k < 6; k++) { const hy = 0.5 + 0.06 * ((k + bi) % 2); box(-15 + k * 4.4, F + 0.44 + hy, rz, 1.2, hy, 0.6, C.rack, 3); }
    }
    for (let k = 0; k < 7; k++) box(-15 + k * 3.6, F + 0.3, -0.4, 0.25, 0.3, 0.25, C.sand, 4);              // sandbags between the rows
    for (let k = 0; k < 4; k++) box(-13 + k * 6.5, F + 0.2, 3.3, 0.35, 0.2, 0.3, C.cake, 0);                // the cakes, boxed
    // the container and the shed at the bow end, the generator and the firing cabinet between
    box(H - 5.2, F + 1.3, 1.3, 3.05, 1.3, 1.22, bi % 2 ? C.cont2 : C.cont, 7);
    box(H - 5.0, F + 1.0, -2.6, 1.2, 1.0, 1.0, C.shed, 0);
    box(H - 9.6, F + 0.45, -2.9, 0.8, 0.45, 0.6, C.gen, 0);
    box(H - 9.6, F + 0.6, 3.2, 0.4, 0.6, 0.3, C.box, 0);
    // the rails: stanchions every 3 m round the deck edge, the top rail a metre over it and a middle rail
    for (const s of [-1, 1]) {
      for (let x = -H + 1; x <= H - 1; x += 3) box(x, F + 0.6, s * (Bm - 0.15), 0.03, 0.6, 0.03, C.rail, 5);
      box(0, F + 1.18, s * (Bm - 0.15), H - 1, 0.03, 0.03, C.rail, 5); box(0, F + 0.65, s * (Bm - 0.15), H - 1, 0.02, 0.02, C.rail, 5);
    }
    box(-H + 0.6, F + 1.18, 0, 0.03, 0.03, Bm - 0.15, C.rail, 5);
    // tyre fenders hung on both sides, two life rings on the rail
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) box(-14 + k * 7, F - 0.55, s * (Bm + 0.2), 0.45, 0.45, 0.16, C.fender, 6);
    for (const s of [-1, 1]) box(-H + 6, F + 0.75, s * (Bm - 0.12), 0.36, 0.36, 0.05, C.ring, 0);
    // the pushboat at the stern (12 × 5 m), its push knees against the barge's transom, the deckhouse, the wheelhouse and its
    // glass, the mast with the lights
    const T = -H - BARGE.tug.length / 2 - 0.2, th = BARGE.tug.length / 2, tb = BARGE.tug.beam / 2;
    box(T, 0.15, 0, th, 0.95, tb, C.tugHull, 1);
    box(T + th + 0.1, 1.4, 0, 0.15, 0.4, tb, C.fender, 6);                                                  // the bow's rubber
    for (const s of [-1, 1]) box(T + th - 0.3, 2.1, s * 1.6, 0.25, 1.0, 0.2, C.tugHull, 1);                 // the push knees
    box(T - 1.2, 1.9, 0, 3.4, 0.8, 2.0, C.tugHouse, 0);
    box(T - 1.6, 3.35, 0, 1.6, 0.65, 1.7, C.tugHouse, 0);
    box(T - 1.6, 3.45, 0, 1.62, 0.3, 1.72, C.glass, 8);
    box(T - 2.4, 5.1, 0, 0.06, 1.1, 0.06, C.rail, 5);
    lamps.push({ p: L(T - 2.4, 6.3, 0), col: [1, 0.96, 0.9], px: 3.0, kind: 1 }, { p: L(T - 2.4, 5.6, 0), col: [1, 0.96, 0.9], px: 3.0, kind: 1 });   // the masthead lights (pushing ahead)
    lamps.push({ p: L(T - 0.6, 3.6, 1.75), col: [1, 0.08, 0.04], px: 2.6, kind: 2 }, { p: L(T - 0.6, 3.6, -1.75), col: [0.1, 1, 0.25], px: 2.6, kind: 3 });
    // the barge's white anchor lights at both ends (two: over 50 m with the pushboat), its amber work lights on short poles
    lamps.push({ p: L(H - 0.8, F + 2.4, 0), col: [1, 0.96, 0.9], px: 2.8, kind: 1 }, { p: L(-H + 0.8, F + 2.0, 0), col: [1, 0.96, 0.9], px: 2.8, kind: 1 });
    box(H - 0.8, F + 1.2, 0, 0.04, 1.2, 0.04, C.rail, 5); box(-H + 0.8, F + 1.0, 0, 0.04, 1.0, 0.04, C.rail, 5);
    for (const lx of [-12, 0, 12]) { box(lx, F + 1.25, Bm - 0.6, 0.04, 1.25, 0.04, C.rail, 5); lamps.push({ p: L(lx, F + 2.55, Bm - 0.6), col: [1.0, 0.68, 0.32], px: 3.6, kind: 0 }); }
    // two patrol boats on the zone, toward the viewer, ±35° off the line of sight (v1's patrolAngle); patrols[i]: the box and
    // lamp index of each, for patrolInto
    const tw = b.toward ?? toward, toV = Math.atan2(tw[0] - b.x, tw[1] - b.z);   // b.toward: the site's viewer (sim/fireworksSite.js)
    for (const s of [-1, 1]) {
      const a = toV + s * 0.6, px = b.x + Math.sin(a) * BARGE.zone, pz = b.z + Math.cos(a) * BARGE.zone, pyaw = a + Math.PI / 2;
      patrols.push({ box: boxes.length, lamp: lamps.length, x: px, z: pz, yaw: pyaw });
      for (const [lx, ly, lz, hx, hy, hz, hex] of PATROL_BOXES) boxes.push({ c: patrolPoint(px, pz, pyaw, lx, ly, lz, waterY), h: [hx, hy, hz], yaw: pyaw, tone: srgb(hex), mat: 0, rake: 0, pivot: [px, pz], bob: 0, seed: 0.5 });
      for (const [lx, ly, lz] of PATROL_LAMPS) lamps.push({ p: patrolPoint(px, pz, pyaw, lx, ly, lz, waterY), col: [0.04, 0.16, 1.0], px: 3.4, kind: 4 });
    }
  });
  return { boxes, lamps, patrols };
}
// a box's GPU record (BOX_FLOATS)
export const boxRecord = (b) => [...b.c, b.yaw, ...b.h, b.rake ?? 0, ...b.tone, b.seed ?? 0, b.pivot?.[0] ?? b.c[0], b.pivot?.[1] ?? b.c[2], b.mat ?? 0, b.bob ?? 0];
// a patrol boat's parts in its own frame (three's rotation.y = yaw: local x across, z along; v1's barges.js patrol)
const PATROL_BOXES = [[0, 0.2, 0, 1.35, 0.7, 4.25, 0xe6e4de], [0, 1.5, 0.5, 0.6, 0.6, 0.7, 0x5a6068]];
const PATROL_LAMPS = [[-0.5, 2.6, 0.5], [0.5, 2.6, 0.5]];
function patrolPoint(px, pz, yaw, lx, ly, lz, waterY = 0, out = [0, 0, 0]) {
  out[0] = px + Math.cos(yaw) * lx + Math.sin(yaw) * lz; out[1] = waterY + ly; out[2] = pz - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
  return out;
}
// L3: a patrol boat moved by a bump (v1's solids.js light body: x, z, heading; the drawn yaw is −heading) written into the
// props' GPU records in place (boxData: BOX_FLOATS a box; lampData: 8 a lamp, pos.xyz px | colour kind): no allocation
const tmpP = [0, 0, 0];
export function patrolInto(boxData, lampData, patrol, x, z, yaw, waterY = 0) {
  PATROL_BOXES.forEach(([lx, ly, lz], k) => { const o = (patrol.box + k) * BOX_FLOATS; patrolPoint(x, z, yaw, lx, ly, lz, waterY, tmpP); boxData[o] = tmpP[0]; boxData[o + 1] = tmpP[1]; boxData[o + 2] = tmpP[2]; boxData[o + 3] = yaw; boxData[o + 12] = x; boxData[o + 13] = z; });
  PATROL_LAMPS.forEach(([lx, ly, lz], k) => { const o = (patrol.lamp + k) * 8; patrolPoint(x, z, yaw, lx, ly, lz, waterY, tmpP); lampData[o] = tmpP[0]; lampData[o + 1] = tmpP[1]; lampData[o + 2] = tmpP[2]; });
}

// the lights' levels (screen levels, before 1 / exposure; v1's barges.update): the work lights dim 70 % once the show
// runs, the navigation lights steady, the patrol's blue bar blinking at 1.25 Hz; all after dusk only (night 0..1)
export function lampLevels(showT, night) {
  const showOn = showT != null && showT > -60 ? 1 : 0;
  return { work: 2.4 * night * (1 - 0.7 * showOn), nav: 1.6 * night, blue: 3.0 * night * (showT == null ? 0.5 : 1) };
}
// the far land's dark; 0 by day … 1 after dusk (v1's world.js lightAll: the sun 2° to 8° under the horizon)
export const nightOf = (sunElevDeg) => Math.min(1, Math.max(0, (-sunElevDeg - 2) / 6));
