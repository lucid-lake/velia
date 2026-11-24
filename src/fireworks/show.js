// The show script (stage S1 round 2): a seeded 5-minute barge show, plain JS. No Math.random(), no clock:
// the same seed gives the same events, and the engine plays it by show time, so a page can seek (?t=).
//   0–30 s     the opening: a salute, then single big shells over a fan cake
//   30–140 s   the build: the pace and the variety rise, high and low layered, red, white and blue
//   140–158 s  a quiet gap: two gold willows hanging over the water, a Niagara along a barge
//   158–242 s  the body: every type, multi-breaks and Saturns over mines and V comets
//   245–293 s  the finale: a barrage that climbs in density and height to 10–12-inch shells, cakes and mines below,
//              a gold willow crown and a last salute
// Each event: { i, t (launch, s), type, inches, colour, colour2, barge (index), jitter [x, z] (m on the deck, before the
// scale), tilt [x, z], seed, ground, height (burst m above the deck), v0 (muzzle m/s), rise (s), burst (s) }.
// The barges are the engine's (world positions; the demo stages two off the bay's mouth, owner 2026-11-08).
import { rng, riserFor, hash } from './physics.js';
import { SHELL_TYPES, GROUND_TYPES, isGround, burstHeight, shellStarsOnly, shellLifeOf } from './shells.js';

export const SHOW_LENGTH = 300;          // s
export const SHOW_START_HOUR = 21 + 44 / 60;   // the show's clock starts at 21:44 local (the first shell at 21:45)
const BARGE_COUNT = 2;
export const SEGMENTS = [
  { name: 'opening', from: 0, to: 30 }, { name: 'build', from: 30, to: 140 }, { name: 'gap', from: 140, to: 158 },
  { name: 'body', from: 158, to: 242 }, { name: 'finale', from: 245, to: 293 },
];
const FLAG = ['red', 'silver', 'blue'];   // the Fourth: red, white and blue lead
const FINALE_RATE = 14;           // the barrage's top pace (shells/s over its base); sets the live-star peak (≈ 60 k)

// the stars an event puts in the sky (its riser included), desktop or phone
export const shellStars = (type, inches, tier = 'desktop') => shellStarsOnly(type, inches, tier) + (isGround(type) ? 0 : 1);
// how long its stars stay drawn after the burst (s)
export const shellLife = (type, inches = 6) => shellLifeOf(type, inches);

const riserCache = new Map();
function rise(height) {
  const key = Math.round(height);
  if (!riserCache.has(key)) riserCache.set(key, riserFor(key));
  return riserCache.get(key);
}

function event(r, i, t, type, { inches, colour, colour2 = null, barge = null } = {}) {
  const ground = isGround(type);
  const size = inches ?? [3, 4, 5, 6, 8][Math.floor(r() * 5)];
  const b = barge ?? Math.floor(r() * BARGE_COUNT);
  const base = { i, t: +t.toFixed(4), type, inches: size, colour: colour ?? FLAG[Math.floor(r() * 3)], colour2, barge: b,
    jitter: [(r() - 0.5) * (ground ? 40 : 24), (r() - 0.5) * 10], tilt: ground ? [0, 0] : [(r() - 0.5) * 0.12, (r() - 0.5) * 0.12],
    seed: hash(i, Math.floor(r() * 1e9)), ground };
  if (ground) return { ...base, height: 0, v0: 0, rise: 0, burst: base.t };
  const h = burstHeight(size) * (0.92 + 0.16 * r()), R = rise(h);
  return { ...base, height: +h.toFixed(2), v0: +R.v0.toFixed(4), rise: +R.t.toFixed(4), burst: +(t + R.t).toFixed(4) };
}

// makeShow(seed) → { seed, length, events (by launch time) }
export function makeShow(seed = 1) {
  const r = rng(hash(seed, 0x5eed));
  const ev = [];
  const add = (t, type, o = {}) => ev.push(event(r, ev.length, t, type, o));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const anyColour = () => pick(['red', 'silver', 'blue', 'red', 'silver', 'blue', 'green', 'gold', 'purple', 'cyan', 'pink', 'orange']);
  const other = (c) => pick(FLAG.filter((x) => x !== c));

  // the opening: a salute, red-white-blue big shells over a fan cake
  add(0.5, 'salute', { inches: 8, barge: 0 });
  add(1.0, 'peony', { inches: 10, colour: 'red', barge: 0 });
  add(1.0, 'strobe', { inches: 10, barge: 1 });
  add(1.4, 'pistil', { inches: 10, colour: 'blue', colour2: 'silver', barge: 1 });
  add(5, 'cake', { inches: 6, colour: 'gold', barge: 0 });
  for (let t = 8; t < 30; t += 3.0 + r() * 1.6) add(t, pick(['peony', 'chrysanthemum', 'ring', 'willow', 'dahlia', 'saturn']), { inches: pick([6, 8, 10]), colour: pick(FLAG) });
  add(20, 'vcomets', { inches: 6, colour: 'silver', barge: 1 });
  // the build: one every 2.4 s at first, every 0.8 s by its end; high and low layered
  const BUILD = ['peony', 'pistil', 'chrysanthemum', 'changer', 'ring', 'strobe', 'palm', 'crossette', 'willow', 'dahlia', 'brocade', 'horsetail', 'saturn'];
  for (let t = 30; t < 140;) {
    const u = (t - 30) / 110, type = pick(BUILD);
    const colour = r() < 0.6 ? pick(FLAG) : anyColour(), colour2 = r() < 0.4 ? other(colour) : null;
    const inches = pick(u > 0.6 ? [5, 6, 8, 10] : [4, 5, 6, 8]);
    if (r() < 0.2 + 0.3 * u) { add(t, type, { colour, colour2, barge: 0, inches }); add(t + 0.06, type, { colour, colour2, barge: 1, inches }); }
    else add(t, type, { colour, colour2, inches });
    if (r() < 0.18) add(t + 0.3, pick(GROUND_TYPES.filter((g) => g !== 'niagara')), { inches: 6, colour: pick(FLAG) });
    t += (2.4 - 1.6 * u) * (0.7 + 0.6 * r());
  }
  // the quiet gap: a Niagara along barge 0, two slow willows hanging over the water
  add(140, 'niagara', { inches: 6, barge: 0 });
  add(141, 'willow', { inches: 4, colour: 'gold', barge: 0 });   // low: they hang down toward the water
  add(146.5, 'willow', { inches: 5, colour: 'gold', barge: 1 });
  // the body: everything, multi-breaks and Saturns, mines and V comets low
  const BODY = ['ring', 'saturn', 'crossette', 'palm', 'crackle', 'chrysanthemum', 'peony', 'pistil', 'strobe', 'willow', 'brocade', 'multibreak', 'changer', 'horsetail', 'dahlia'];
  for (let t = 158; t < 242;) {
    const u = (t - 158) / 84, type = pick(BODY);
    const colour = anyColour(), colour2 = r() < 0.45 ? anyColour() : null;
    if (type === 'ring' && r() < 0.4) for (let k = 0; k < 3; k++) add(t + k * 0.35, 'ring', { colour, barge: k % 2, inches: 6 });
    else add(t, type, { colour, colour2, inches: pick([5, 6, 8, 10]) });
    if (r() < 0.25) add(t + 0.2, pick(['mine', 'cake', 'vcomets']), { inches: 6, colour: anyColour() });
    t += (1.6 - 0.8 * u) * (0.6 + 0.8 * r());
  }
  add(200, 'niagara', { inches: 6, barge: 1 });
  // the finale: density and height climb together; cakes and mines below
  const FIN = ['chrysanthemum', 'peony', 'crackle', 'strobe', 'crossette', 'palm', 'brocade', 'pistil', 'changer', 'multibreak', 'horsetail'];
  for (let t = 245; t < 288;) {
    const u = (t - 245) / 43;
    add(t, pick(FIN), { colour: r() < 0.7 ? pick(FLAG) : anyColour(), colour2: r() < 0.3 ? anyColour() : null, inches: pick(u > 0.7 ? [8, 10, 12] : u > 0.35 ? [6, 8, 10] : [4, 5, 6]) });
    if (r() < 0.12) add(t, pick(['mine', 'cake', 'vcomets']), { inches: 6, colour: pick(FLAG) });
    t += 1 / (2 + FINALE_RATE * u * u * u) * (0.6 + 0.8 * r());
  }
  add(279, 'niagara', { inches: 6, barge: 0 }); add(279, 'niagara', { inches: 6, barge: 1 });
  for (let k = 0; k < 10; k++) add(287.5 + k * 0.25, 'willow', { inches: 5, colour: 'gold', barge: k % 2 });
  add(291.5, 'crackle', { inches: 12, barge: 0 }); add(291.5, 'salute', { inches: 10, barge: 1 }); add(291.6, 'peony', { inches: 12, colour: 'red', barge: 1 });

  ev.sort((a, b) => a.t - b.t || a.i - b.i);
  ev.forEach((e, i) => { e.i = i; });
  return { seed, length: SHOW_LENGTH, events: ev };
}

// ?shell=<type>: that type on a loop, one every `period` s, its colours turning (a ground effect: from barge 0)
export function loopShow(type, { seed = 1, period = null, length = 3600, inches = 8 } = {}) {
  if (!SHELL_TYPES.includes(type) && !GROUND_TYPES.includes(type)) throw new Error(`unknown shell type ${type}`);
  const r = rng(hash(seed, 0x100b));
  const ev = [], P = period ?? (type === 'niagara' ? 16 : type === 'willow' ? 9 : 6);
  const colours = ['red', 'silver', 'blue', 'green', 'gold', 'purple', 'cyan', 'pink'];
  const all = [...SHELL_TYPES, ...GROUND_TYPES];
  for (let i = 0, t = 0.5; t < length; i++, t += P) {
    const c = colours[(i + 7 + all.indexOf(type) * 3) % colours.length];
    ev.push(event(r, i, t, type, { inches: isGround(type) ? 6 : inches, colour: c, colour2: colours[(i + 3 + all.indexOf(type)) % colours.length], barge: 0 }));
  }
  return { seed, length, events: ev, loop: type };
}

// The far shows on the horizon (owner go, 2026-11-08): plain single shells at a steady pace, on our show's clock.
//   South Lake's Lights on the Lake: starts `start` s before ours (−240: 4 min), one shell every 1.5–4 s, a little denser
//   in our quiet gap, through its own finale; Tahoe City (start −900, sparse, ends near our start + 300).
export function makeFarShow({ seed = 1, start = -240, length = 1200, gap = [2, 5], finaleAt = null } = {}) {
  const r = rng(hash(seed, 0xfa4));
  const ev = [];
  // no rings (polish round): a small smooth ring just over the horizon read as a blue ring floating over the water
  const types = ['peony', 'chrysanthemum', 'willow', 'peony', 'strobe', 'peony', 'chrysanthemum', 'crackle'];
  const colours = ['red', 'silver', 'blue', 'gold', 'green', 'red', 'silver', 'blue'];
  for (let t = start; t < start + length;) {
    const fin = finaleAt != null && t > finaleAt && t < finaleAt + 40;
    ev.push(event(r, ev.length, t, types[Math.floor(r() * types.length)], { inches: [4, 5, 6, 8][Math.floor(r() * 4)], colour: colours[Math.floor(r() * colours.length)], barge: 0 }));
    t += fin ? 0.3 + r() * 0.5 : gap[0] + r() * (gap[1] - gap[0]);
  }
  return { seed, length, events: ev.filter((e) => e.burst > -30), far: true };
}

// the stars alive at show time t (desktop or phone): every event between its launch and the end of its life
export function liveStarsAt(show, t, tier = 'desktop') {
  let n = 0;
  for (const e of show.events) {
    if (t < e.t || t > e.burst + shellLife(e.type, e.inches)) continue;
    n += t < e.burst ? 1 : shellStars(e.type, e.inches, tier);
  }
  return n;
}
// the peak of liveStarsAt over the show, sampled every `dt` s: { t, n }
export function peakStars(show, tier = 'desktop', dt = 0.1) {
  let best = { t: 0, n: 0 };
  for (let t = 0; t < show.length + 10; t += dt) { const n = liveStarsAt(show, t, tier); if (n > best.n) best = { t: +t.toFixed(2), n }; }
  return best;
}
