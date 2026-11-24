// The shell and ground-effect library (stages S1 and S1 round 2): plain JS, so the tests read the stars a
// shell throws. An aerial shell is described by its size in inches (3–12); it bursts at about 30 m per inch and opens
// about 0.7 × that wide (] [9]). A ground effect (cake, mine, Niagara, V comets) fires from the barge's
// deck with no riser. buildShell() returns the stars, each relative to the burst point and the shell's own drift:
//   { p, v, k, burn, col, trail, tau, flick, width, headPx, interval, hidden, kick, kickAge, delay, col2, change, group }
//   p, v      offset (m) and velocity (m/s), before the scale (src/fireworks/physics.js)
//   k, burn   drag (1/m) and burn time (s), from the star's radius, density and burn rate
//   col       the head's colour (linear); trail: the streak's colour; tau: the streak's fade (s; the long exposure's look)
//   col2, change   a colour-changing star turns to col2 at `change` s of its age (0: never)
//   flick     bits: 1 the head glitters, 2 the head strobes, 4 the streak sparkles, 8 a flash (bright, brief)
//   width     the streak's physical width (m); headPx: the head's least size on screen (px)
//   interval  the streak's history spacing (s): HISTORY points span about 3 tau
//   hidden    1: not drawn until its kick (a crossette's three passengers, a crackle's sparks)
//   kick      a velocity added at kickAge s (the crossette's split, the crackle's pop); kickAge 0: none
//   delay     s after the burst this star is born (a multi-break's later breaks; a cake's volleys; Niagara's drip)
//   group     the stars that share one parent (a crossette's four; a crackle parent and its sparks; a break)
//   bright    the star's own brightness (× its head and streak colour; the engine applies it): no two stars alike
// The realism round (owner 2026-11-08: "these few fireworks patterns are very fake"): every star is jittered on its own
// (speed, direction, burn time and brightness: `mk` below), the counts are a real shell's (a ring is a few dozen distinct
// stars, not a filled band), the streaks are what a video sees (a colour star leaves a short smear; only charcoal, glitter
// and comet stars leave long sparkling tails: `tau` by composition), a fan cake fires single comets one by one along a
// sweeping fan, and the engine makes each star sputter and warm a little as it burns out (src/fireworks/engine.js).
// Ideas from published descriptions of real shells; no code from any simulator.
import { dragK, burnTime, speedForReach, rng, hash } from './physics.js';

export const SHELL_TYPES = ['peony', 'pistil', 'dahlia', 'chrysanthemum', 'changer', 'willow', 'horsetail', 'palm', 'ring',
  'saturn', 'crossette', 'strobe', 'crackle', 'brocade', 'multibreak', 'salute'];
export const GROUND_TYPES = ['cake', 'mine', 'niagara', 'vcomets'];
export const ALL_TYPES = [...SHELL_TYPES, ...GROUND_TYPES];
export const isGround = (type) => GROUND_TYPES.includes(type);
export const HISTORY = 9;               // the streak's points per star (round 3: 12 → 9, the budget)
const M_PER_INCH = 30;           // burst height (m) per inch of shell
const SPREAD = 0.35;             // the burst's radius over its height

// linear colours of the real compositions (strontium red, barium green, copper blue, …), saturated for a photo's look
export const PALETTE = {
  red: [1.0, 0.06, 0.025], green: [0.12, 1.0, 0.16], blue: [0.1, 0.24, 1.0], purple: [0.62, 0.1, 1.0],
  gold: [1.0, 0.48, 0.1], silver: [0.92, 0.94, 1.0], orange: [1.0, 0.26, 0.03], cyan: [0.08, 0.72, 1.0], pink: [1.0, 0.22, 0.52],
};
export const COLOURS = Object.keys(PALETTE);
const GOLD_TAIL = [1.0, 0.42, 0.08];    // charcoal: the warm streak of chrysanthemums, willows, palms and comets
const WHITE_GOLD = [1.0, 0.72, 0.36];   // the brocade's and the spider's glittering white-gold
const WHITE_HOT = [1.0, 0.9, 0.75];

// per type: the base star count of a 6-inch shell (desktop), the star (radius m, density kg/m³, burn rate m/s), the
// reach over the burst's radius, the streak's fade (s), the width (m), the head's least size (px); grow: the count's power of
// the size (2: a shell's star layer grows with its surface; 1: a ring's or a palm's arms with its girth)
// Realism round counts (a real 6" ball shell carries about 100–200 stars, a ring shell a few dozen, a palm 6–12 comets)
// and fades (a colour star in a video: about 0.15 s of smear; charcoal, glitter and comet tails linger 0.5–2.6 s).
export const SHELL_SPEC = {
  peony:         { n: 170, r: 0.010, rho: 1100, rate: 0.0040, reach: 1.0,  tau: 0.15, width: 0.5, headPx: 1.6 },
  pistil:        { n: 140, r: 0.010, rho: 1100, rate: 0.0040, reach: 1.0,  tau: 0.15, width: 0.5, headPx: 1.6 },
  dahlia:        { n: 44,  r: 0.022, rho: 1100, rate: 0.0060, reach: 1.0,  tau: 0.35, width: 1.4, headPx: 3.0 },
  chrysanthemum: { n: 180, r: 0.011, rho: 1100, rate: 0.0040, reach: 1.0,  tau: 0.8,  width: 0.6, headPx: 1.3 },
  changer:       { n: 150, r: 0.012, rho: 1100, rate: 0.0038, reach: 1.0,  tau: 0.16, width: 0.6, headPx: 1.7 },
  willow:        { n: 150, r: 0.009, rho: 500,  rate: 0.0011, reach: 0.7,  tau: 2.6,  width: 0.7, headPx: 1.0 },
  horsetail:     { n: 70,  r: 0.014, rho: 1700, rate: 0.0032, reach: 0.5,  tau: 1.2,  width: 0.8, headPx: 1.3 },
  palm:          { n: 11,  r: 0.025, rho: 1500, rate: 0.0115, reach: 1.15, tau: 1.0,  width: 1.8, headPx: 2.6, grow: 1 },
  ring:          { n: 34,  r: 0.010, rho: 1100, rate: 0.0040, reach: 1.0,  tau: 0.15, width: 0.5, headPx: 2.0, grow: 1 },
  saturn:        { n: 30,  r: 0.010, rho: 1100, rate: 0.0040, reach: 1.1,  tau: 0.15, width: 0.5, headPx: 2.0, grow: 1 },
  crossette:     { n: 26,  r: 0.012, rho: 1100, rate: 0.0040, reach: 0.8,  tau: 0.35, width: 0.7, headPx: 1.8 },
  strobe:        { n: 150, r: 0.010, rho: 1100, rate: 0.0034, reach: 1.0,  tau: 0.05, width: 0.5, headPx: 2.0 },
  crackle:       { n: 80,  r: 0.008, rho: 1100, rate: 0.0040, reach: 0.75, tau: 0.3,  width: 0.4, headPx: 1.1 },
  brocade:       { n: 110, r: 0.012, rho: 1700, rate: 0.0045, reach: 1.25, tau: 1.1,  width: 0.6, headPx: 0.8 },
  multibreak:    { n: 55,  r: 0.009, rho: 1100, rate: 0.0045, reach: 0.55, tau: 0.15, width: 0.5, headPx: 1.6 },
  salute:        { n: 40,  r: 0.006, rho: 1100, rate: 0.0080, reach: 0.3,  tau: 0.1,  width: 0.3, headPx: 1.6 },
  // ground effects: their "inches" is their size class (6 = a normal piece); a cake's n is its shots, V comets' its pairs
  cake:          { n: 26,  r: 0.016, rho: 1200, rate: 0.0055, reach: 1.0,  tau: 0.22, width: 0.9, headPx: 1.9 },
  mine:          { n: 60,  r: 0.008, rho: 1100, rate: 0.0050, reach: 1.0,  tau: 0.12, width: 0.5, headPx: 1.5 },
  niagara:       { n: 20,  r: 0.004, rho: 1100, rate: 0.0030, reach: 1.0,  tau: 0.35, width: 0.3, headPx: 1.2 },
  vcomets:       { n: 6,   r: 0.014, rho: 1100, rate: 0.0060, reach: 1.0,  tau: 0.22, width: 1.2, headPx: 2.2 },
};
// the per-star jitter (realism round): launch speed × [lo, hi], burn time × 1 ± burn, brightness × [lo, hi], and the
// lattice's direction jitter (a sphere's stars are packed by hand, never on a lattice)
// the streaks' width over the spec's (wow round: from 250 m a 0.9 m comet streak at 2.2× read as a beam)
const STREAK_WIDTH = 0.35;
const JITTER = { speed: [0.86, 1.12], burn: 0.2, bright: [0.55, 1.25], dir: 0.24 };
const SATURN_BALL = 80;          // a Saturn's inner ball at 6" (grows with the surface)
const CAKE = { sweepDeg: 50, gap: [0.08, 0.15], aimJitterDeg: 3.5 };   // a fan cake: shots one by one along a sweep
export const CROSSETTE_SPLIT = 4;      // a crossette star splits in 4
export const CRACKLE_SPARKS = 6;       // a crackle star pops into 6 sparks
const NIAGARA = { emitters: 20, dropsEach: 60, every: 0.2, lengthM: 70, heightM: 12 };
export const MULTI_BREAKS = 4;

export const burstHeight = (inches) => inches * M_PER_INCH;
export const burstRadius = (inches) => inches * M_PER_INCH * SPREAD;
const tierN = (n, tier) => (tier === 'phone' ? Math.max(2, Math.round(n / 2)) : n);
// a type's base count at this size: the spec's n × (inches / 6)² (aerials) or × inches / 6 (ground), halved on the phone
export const starCount = (type, inches, tier = 'desktop') => {
  const g = isGround(type), sp = SHELL_SPEC[type], n = Math.max(g ? 3 : 6, Math.round(sp.n * (inches / 6) ** (sp.grow ?? (g ? 1 : 2))));
  return tierN(n, tier);
};
// a fan cake's shot times (s after its first): one comet at a time, 0.08–0.15 s apart (its own stream, so the sound's
// thumps fall on the same shots: src/fireworks/sound.js)
export function cakeTimes(inches = 6, seed = 1, tier = 'desktop') {
  const r = rng(hash(seed, 0xca4e)), n = starCount('cake', inches, tier), out = [];
  for (let i = 0, t = 0; i < n; i++) { out.push(+t.toFixed(4)); t += CAKE.gap[0] + (CAKE.gap[1] - CAKE.gap[0]) * r(); }
  return out;
}
// The horizon shows (the engine's 'far' tier; S4 fix): a far burst keeps at most FAR_STARS of its stars, an even pick
// along the lattice. Far stars are heads only (no trails), so a full shell's 150 heads at 3.6 km merged into one glowing
// disc: a dense blue peony just over the horizon read as a floating moon. A few dozen points read as a burst.
export const FAR_STARS = 36;
export function thinStars(stars, max = FAR_STARS) {
  if (stars.length <= max) return stars;
  const k = stars.length / max;
  return Array.from({ length: max }, (_, j) => stars[Math.floor(j * k)]);
}

// unit directions on a sphere, evenly spread (a Fibonacci lattice), turned by a random rotation and jittered
function sphereDirs(n, r, jitter = JITTER.dir) {
  const out = [], off = r() * Math.PI * 2, ga = Math.PI * (3 - Math.sqrt(5));
  const tz = r() * Math.PI * 2, tx = Math.acos(2 * r() - 1);
  const cz = Math.cos(tz), sz = Math.sin(tz), cx = Math.cos(tx), sx = Math.sin(tx);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rad = Math.sqrt(1 - y * y), th = off + ga * i;
    let x = Math.cos(th) * rad, z = Math.sin(th) * rad, yy = y;
    x += (r() - 0.5) * jitter; yy += (r() - 0.5) * jitter; z += (r() - 0.5) * jitter;
    const y1 = yy * cx - z * sx, z1 = yy * sx + z * cx;
    const x2 = x * cz + z1 * sz, z2 = -x * sz + z1 * cz;
    const l = Math.hypot(x2, y1, z2);
    out.push([x2 / l, y1 / l, z2 / l]);
  }
  return out;
}
const scaleV = (d, s) => [d[0] * s, d[1] * s, d[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mixC = (a, b, t) => a.map((x, k) => x * (1 - t) + b[k] * t);

function star(spec, dir, speed, extra = {}) {
  const k = dragK(spec.r, spec.rho), burn = extra.burn ?? burnTime(spec.r, spec.rate);
  const tau = extra.tau ?? spec.tau;
  return {
    p: extra.p ?? [0, 0, 0], v: scaleV(dir, speed), k, burn, col: extra.col, trail: extra.trail ?? extra.col, tau,
    flick: extra.flick ?? 0, width: (extra.width ?? spec.width) * STREAK_WIDTH, headPx: extra.headPx ?? spec.headPx,
    interval: Math.max(1 / 40, (tau * 3) / HISTORY), hidden: extra.hidden ?? 0, kick: extra.kick ?? [0, 0, 0],
    kickAge: extra.kickAge ?? 0, delay: extra.delay ?? 0, col2: extra.col2 ?? [0, 0, 0], change: extra.change ?? 0,
    group: extra.group ?? -1, bright: extra.bright ?? 1,
  };
}
// the launch speed that carries this spec's star to `reach` m by its burn's end
const speedOf = (spec, reach) => speedForReach(reach, dragK(spec.r, spec.rho), burnTime(spec.r, spec.rate) * 0.9);

// buildShell(type, { inches, colour, colour2, seed, tier, plane, spread }) → { type, stars, normal? (a ring's plane) }
// spread: the burst's radius × this (1 by default; the near show's frame law, src/fireworks/stage.js fitShow)
// plane: the unit horizontal axis a ground effect fans along (across the viewer's line of sight; default x)
export function buildShell(type, { inches = 6, colour = 'red', colour2 = null, seed = 1, tier = 'desktop', plane = [1, 0, 0], spread = 1 } = {}) {
  const spec = SHELL_SPEC[type];
  if (!spec) throw new Error(`unknown shell type ${type}`);
  const r = rng(seed), R = burstRadius(inches) * spec.reach * spread;
  const col = PALETTE[colour] ?? PALETTE.red, col2 = colour2 ? PALETTE[colour2] : null;
  const n = starCount(type, inches, tier);
  const stars = [];
  const out = { type, inches, stars, ground: isGround(type) };
  const J = JITTER;
  const vary = () => J.speed[0] + (J.speed[1] - J.speed[0]) * r();
  // one star with its own jitter: its burn time (± J.burn, or extra.burnJ) and its brightness; extra.exact: none (flashes)
  const mk = (dir, speed, extra = {}) => {
    const s = star(spec, dir, speed, extra);
    if (!extra.exact) {
      s.burn *= 1 + (r() - 0.5) * 2 * (extra.burnJ ?? J.burn);
      s.bright = extra.bright ?? (J.bright[0] + (J.bright[1] - J.bright[0]) * r());
    }
    return s;
  };
  const flash = (c, px = 7, burn = 0.12) => stars.push(star(spec, [0, 1, 0], 0, { col: mixC(c, WHITE_HOT, 0.5), trail: [0, 0, 0], burn, headPx: px, tau: 0.05, width: 0.01, flick: 8 }));
  const ball = (m, reach, c, extra = {}) => { const v0 = speedOf(spec, reach); sphereDirs(m, r).forEach((d) => stars.push(mk(d, v0 * vary(), { col: c, trail: scaleV(c, 0.7), ...extra }))); };
  // a ring: m stars round a tilted plane; the stars keep the plane (a real ring is flat) but not a lattice: each its own
  // angle (± 40 % of the spacing), speed (± 4 %: a ring must stay a ring), burn and brightness, and a gap
  const ringOf = (m, reach, c, normal, extra = {}) => {
    const ref = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(normal, ref)), w = cross(normal, u), v0 = speedOf(spec, reach), ph = r() * Math.PI * 2;
    const g0 = Math.floor(r() * m);   // a gap: two neighbours missing (always two: the count is fixed, the budget's sum)
    for (let i = 0; i < m; i++) {
      if (i === g0 || i === (g0 + 1) % m) continue;
      const a = ph + ((i + (r() - 0.5) * 0.8) / m) * Math.PI * 2;
      stars.push(mk([u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)], v0 * (0.96 + 0.08 * r()), { col: c, trail: scaleV(c, 0.7), ...extra }));
    }
  };
  const tilted = () => { const t = r() * 0.95, az = r() * Math.PI * 2; return norm([Math.sin(t) * Math.cos(az), Math.cos(t), Math.sin(t) * Math.sin(az)]); };
  const other = (c) => col2 ?? (c === PALETTE.silver ? PALETTE.gold : PALETTE.silver);
  const pickCol = (c) => (col2 && r() < 0.5 ? col2 : c);   // a two-colour shell: mixed at random, not in stripes

  if (!out.ground && type !== 'salute') flash(col);
  if (type === 'peony') {
    const v0 = speedOf(spec, R);
    sphereDirs(n, r).forEach((d) => { const c = pickCol(col); stars.push(mk(d, v0 * vary(), { col: c, trail: scaleV(c, 0.7) })); });
  } else if (type === 'pistil') {
    // a peony with a core of a second colour: the inner ball at 45 % of the reach
    ball(n, R, col);
    ball(tierN(Math.round(n * 0.35), 'desktop'), R * 0.45, other(col), { tau: 0.12 });
  } else if (type === 'dahlia') {
    // few, fat, slow stars: big heads and short thick smears; their speeds spread wider (hand-rolled big stars)
    const v0 = speedOf(spec, R);
    sphereDirs(n, r, 0.3).forEach((d) => stars.push(mk(d, v0 * (0.8 + 0.34 * r()), { col, trail: scaleV(col, 0.85) })));
  } else if (type === 'chrysanthemum') {
    // stars that leave a sparkling charcoal tail behind a coloured tip: the tails are the look
    const v0 = speedOf(spec, R);
    sphereDirs(n, r).forEach((d) => { const c = pickCol(col); stars.push(mk(d, v0 * vary(), { col: scaleV(c, 1.4), trail: mixC(GOLD_TAIL, c, 0.35), flick: 4 })); });
  } else if (type === 'changer') {
    // colour-changing stars: col, then col2 near half the burn, each star at its own moment (the layers burn unevenly)
    const c2 = other(col), burn = burnTime(spec.r, spec.rate), v0 = speedOf(spec, R);
    sphereDirs(n, r).forEach((d) => stars.push(mk(d, v0 * vary(), { col, trail: scaleV(col, 0.7), col2: c2, change: burn * (0.36 + 0.18 * r()), burnJ: 0.1 })));
  } else if (type === 'willow') {
    // kamuro: gold, light stars that burn 8 s and hang, long glittering tails that droop toward the water
    const v0 = speedOf(spec, R);
    sphereDirs(n, r).forEach((d) => stars.push(mk(d, v0 * vary(), { col: scaleV(GOLD_TAIL, 0.8), trail: GOLD_TAIL, flick: 4 | 1, burnJ: 0.12, bright: 0.75 + 0.35 * r() })));
  } else if (type === 'horsetail') {
    // a fountain of heavy stars thrown up and out at low speed: they fall together in a sheet
    const v0 = speedOf(spec, R);
    sphereDirs(n * 4, r, 0.1).filter((d) => d[1] > 0.35).slice(0, n)
      .forEach((d) => stars.push(mk(d, v0 * (0.8 + 0.35 * r()), { col: col2 ?? WHITE_GOLD, trail: mixC(GOLD_TAIL, col, 0.25), flick: 4 })));
  } else if (type === 'palm') {
    // a few thick comet arms thrown up and out (the trunk is the shell's riser: the engine draws it thick); uneven arms
    const v0 = speedOf(spec, R);
    sphereDirs(n * 2, r, 0.3).filter((d) => d[1] > -0.15).slice(0, n)
      .forEach((d) => stars.push(mk(norm([d[0], d[1] + 0.35, d[2]]), v0 * (0.82 + 0.3 * r()), { col: col2 ?? [1.0, 0.62, 0.22], trail: GOLD_TAIL, flick: 4, burnJ: 0.15 })));
  } else if (type === 'ring') {
    out.normal = tilted();
    ringOf(n, R, col, out.normal);
  } else if (type === 'saturn') {
    // a ring around a ball: the ring wide in one colour, the ball inside in another
    out.normal = tilted();
    ringOf(n, R, col, out.normal);
    ball(tierN(Math.round(SATURN_BALL * (inches / 6) ** 2), tier), R * 0.5, other(col));
  } else if (type === 'crossette') {
    const v0 = speedOf(spec, R), ks = 0.5 * v0;
    sphereDirs(n, r).forEach((d, g) => {
      const kickAge = burnTime(spec.r, spec.rate) * (0.28 + 0.16 * r());
      const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let u = norm(cross(d, ref)), w = cross(d, u);
      const a = r() * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      [u, w] = [[u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa], [w[0] * ca - u[0] * sa, w[1] * ca - u[1] * sa, w[2] * ca - u[2] * sa]];
      const dirs = [u, w, scaleV(u, -1), scaleV(w, -1)], sp = v0 * vary(), burn = burnTime(spec.r, spec.rate) * (0.85 + 0.3 * r());
      for (let j = 0; j < CROSSETTE_SPLIT; j++) stars.push(mk(d, sp, { col, trail: mixC(col, WHITE_GOLD, 0.4), flick: 4, hidden: j === 0 ? 0 : 1, kick: scaleV(dirs[j], ks * (0.9 + 0.2 * r())), kickAge, group: g, burn, burnJ: 0 }));
      // the four kicks must still cancel (a cross): give the pair opposite each other the same push
      const k = stars.length - 4; stars[k + 2].kick = scaleV(stars[k].kick, -1); stars[k + 3].kick = scaleV(stars[k + 1].kick, -1);
    });
  } else if (type === 'strobe') {
    ball(n, R, PALETTE.silver, { trail: scaleV(PALETTE.silver, 0.3), flick: 2 });
  } else if (type === 'crackle') {
    const v0 = speedOf(spec, R);
    sphereDirs(n, r).forEach((d, g) => {
      const sp = v0 * vary(), parent = mk(d, sp, { col: PALETTE.gold, trail: GOLD_TAIL, flick: 4, group: g });
      stars.push(parent);
      for (let j = 0; j < CRACKLE_SPARKS; j++) {
        const kickAge = parent.burn * (0.92 + 0.1 * r()) + 0.5 * r(), life = 0.05 + 0.08 * r();
        stars.push(star(spec, d, sp, { col: WHITE_HOT, trail: scaleV(WHITE_HOT, 0.4), flick: 8, hidden: 1, kick: scaleV(sphereDirs(1, r, 0)[0], 10 + 18 * r()), kickAge, burn: kickAge + life, tau: 0.06, headPx: 2.2, group: g, bright: 0.5 + 0.8 * r() }));
      }
    });
  } else if (type === 'brocade') {
    // spider: fast, low-drag stars with dim heads and long glittering white-gold tails
    ball(n, R, scaleV(WHITE_GOLD, 0.4), { trail: WHITE_GOLD, flick: 4 | 1 });
  } else if (type === 'multibreak') {
    // one shell that bursts 4 times in sequence, each break a little higher, colours alternating
    for (let b = 0; b < MULTI_BREAKS; b++) {
      const c = b % 2 ? other(col) : col, v0 = speedOf(spec, R * (1 - 0.1 * b)), up = [0, R * 0.55 * b, 0];
      sphereDirs(n, r).forEach((d) => stars.push(mk(d, v0 * vary(), { col: c, trail: scaleV(c, 0.7), p: up, delay: 0.42 * b, group: b })));
      stars.push(star(spec, [0, 1, 0], 0, { col: mixC(c, WHITE_HOT, 0.5), trail: [0, 0, 0], burn: 0.1, headPx: 6, tau: 0.05, width: 0.01, flick: 8, p: up, delay: 0.42 * b, group: b }));
    }
  } else if (type === 'salute') {
    // a white flash and a bang: one blinding star and a quick spray of white sparks
    flash(WHITE_HOT, 22, 0.09);
    ball(n, R, WHITE_HOT, { trail: scaleV(WHITE_HOT, 0.5), burn: 0.2, burnJ: 0.15, flick: 8 });
  } else if (type === 'cake') {
    // a fan cake (realism round): single comets fired one by one, 0.08–0.15 s apart, the tubes' angles sweeping across the
    // view and back (−50° → +50° → −50°), each a little off its tube's aim and speed; heavy comets with sparkling gold
    // tails that burn past the top of their climb, so each arcs over under gravity; colours in runs
    const v0 = speedOf(spec, burstHeight(inches) * 0.55), times = cakeTimes(inches, seed, tier), m = times.length;
    for (let i = 0; i < m; i++) {
      const u = i / Math.max(1, m - 1), sweep = Math.cos(u * Math.PI * 2);   // 1 → −1 → 1: across and back
      const a = (-sweep * CAKE.sweepDeg + (r() - 0.5) * 2 * CAKE.aimJitterDeg) * Math.PI / 180;
      const d = norm([plane[0] * Math.sin(a), Math.cos(a), plane[2] * Math.sin(a)]);
      const c = Math.floor(i / 6) % 2 ? other(col) : col;
      stars.push(mk(d, v0 * (0.93 + 0.14 * r()), { col: mixC(c, WHITE_GOLD, 0.25), trail: mixC(GOLD_TAIL, c, 0.3), flick: 4 | 1, delay: times[i], burnJ: 0.12 }));
    }
  } else if (type === 'mine') {
    // a mine: a ragged cone of stars straight up from the deck, all at once, speeds and burns spread wide
    const v0 = speedOf(spec, burstHeight(inches) * 0.6);
    sphereDirs(n * 20, r, 0.12).filter((d) => d[1] > 0.88).slice(0, n)
      .forEach((d) => { const c = pickCol(col); stars.push(mk(d, v0 * (0.65 + 0.6 * r()), { col: c, trail: scaleV(c, 0.7), burnJ: 0.35 })); });
  } else if (type === 'niagara') {
    // Niagara: gold sparks dripping from a line of emitters along the barge, for 12 s
    const N = tierN(NIAGARA.emitters * Math.max(1, Math.round(inches / 6)), tier), L = NIAGARA.lengthM;
    for (let e = 0; e < N; e++) for (let k = 0; k < NIAGARA.dropsEach; k++) {
      const p = [plane[0] * (e / (N - 1) - 0.5) * L, NIAGARA.heightM, plane[2] * (e / (N - 1) - 0.5) * L];
      const d = norm([(r() - 0.5) * 0.4, -0.3 - r() * 0.5, (r() - 0.5) * 0.4]);
      stars.push(star(spec, d, 2 + 4 * r(), { col: scaleV(WHITE_GOLD, 0.9), trail: GOLD_TAIL, flick: 1 | 4, delay: k * NIAGARA.every + r() * NIAGARA.every, burn: 1.0 + 0.6 * r(), p, bright: 0.6 + 0.6 * r() }));
    }
  } else if (type === 'vcomets') {
    // comets in V pairs: each pair leans about ±25° across the view, one pair every 0.3 s; each comet its own lean and speed
    const v0 = speedOf(spec, burstHeight(inches) * 0.7);
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const a = s * (22 + 6 * r()) * Math.PI / 180, d = norm([plane[0] * Math.sin(a), Math.cos(a), plane[2] * Math.sin(a)]);
      stars.push(mk(d, v0 * (0.94 + 0.12 * r()), { col: i % 2 ? WHITE_GOLD : col, trail: GOLD_TAIL, flick: 4, delay: 0.3 * i + 0.04 * r(), burnJ: 0.1 }));
    }
  }
  return out;
}

// The comet riser: the shell's climb, a gold glittering comet with a streak; burns until the burst. A palm's is its trunk.
export function riserStar({ v0, t, k, tiltX = 0, tiltZ = 0, trunk = false }) {
  return {
    p: [0, 0, 0], v: [v0 * tiltX, v0, v0 * tiltZ], k, burn: t, col: trunk ? [1.0, 0.6, 0.22] : [0.5, 0.28, 0.1], trail: trunk ? scaleV(GOLD_TAIL, 0.6) : scaleV(GOLD_TAIL, 0.16), tau: trunk ? 1.0 : 0.4,
    flick: 1 | 4, width: trunk ? 0.4 : 0.1, headPx: trunk ? 2.4 : 1.6, interval: ((trunk ? 1.0 : 0.4) * 3) / HISTORY, hidden: 0, kick: [0, 0, 0], kickAge: 0,
    delay: 0, col2: [0, 0, 0], change: 0, group: -1, bright: 1, riser: true,
  };
}

// a type's stars at this size and tier (cached: the show's budget sums them), and how long they stay drawn after the
// burst (s): the latest star's delay + burn + three streak fades
const cache = new Map();
function summary(type, inches, tier) {
  const key = `${type}|${inches}|${tier}`;
  if (!cache.has(key)) {
    const s = buildShell(type, { inches, tier, seed: 1, colour: 'red', colour2: 'blue' });
    cache.set(key, { n: s.stars.length, life: Math.max(...s.stars.map((x) => x.delay + Math.max(x.burn, x.kickAge) + 3 * x.tau)) });
  }
  return cache.get(key);
}
export const shellStarsOnly = (type, inches, tier = 'desktop') => summary(type, inches, tier).n;
export const shellLifeOf = (type, inches = 6) => summary(type, inches, 'desktop').life;
