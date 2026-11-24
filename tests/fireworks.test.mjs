// Fireworks S1: the star physics, the shells' counts and shapes, the show script's determinism and the
// phone tier. Behaviour only: each test calls the module and reads what comes out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fly, starStep, dragK, terminal, riserFor, rng, G } from '../src/fireworks/physics.js';
import { SHELL_SPEC, buildShell, SHELL_TYPES, GROUND_TYPES, ALL_TYPES, starCount, CROSSETTE_SPLIT, CRACKLE_SPARKS, MULTI_BREAKS, cakeTimes, burstRadius, PALETTE } from '../src/fireworks/shells.js';
import { makeShow, loopShow, makeFarShow, peakStars, liveStarsAt, shellStars, SEGMENTS, SHOW_LENGTH } from '../src/fireworks/show.js';
import { shellAngles, finaleSpan, bargesWorld, VIEW } from '../src/fireworks/stage.js';
import { twilightLevel } from '../classic/src/core/milkyway.js';
import { flashSlots, flashAt, glowAt, GLOW, FLASH_SLOTS } from '../src/fireworks/flash.js';
import { puffsFor, puffAt } from '../src/fireworks/smoke.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(...a);

test('physics: without drag the apex is v²/2g; drag lowers it and slows a 100 m/s star to near its terminal speed', () => {
  const free = fly([0, 0, 0], [0, 50, 0], 0, 6);
  assert.ok(Math.abs(free.apex.y - 50 * 50 / (2 * G)) < 0.6, `no drag apex ${free.apex.y}`);
  const k = dragK(0.01, 1100);
  const r = fly([0, 0, 0], [0, 100, 0], k, 6);
  assert.ok(r.apex.y > 40 && r.apex.y < 90, `drag apex ${r.apex.y} m`);
  assert.ok(r.apex.t < 2.5, `it tops out fast (${r.apex.t} s)`);
  // sideways at 100 m/s: after 1 s it has lost most of its speed
  const s = fly([0, 0, 0], [100, 0, 0], k, 1);
  assert.ok(Math.hypot(s.v[0], s.v[1]) < 0.4 * 100, `speed after 1 s ${len(s.v)}`);
  // falling long enough: the terminal speed √(g/k)
  const fall = fly([0, 0, 0], [0, 0, 0], k, 8);
  assert.ok(Math.abs(-fall.v[1] - terminal(k)) < 0.05 * terminal(k), `terminal ${-fall.v[1]} vs ${terminal(k)}`);
});

test('physics: the wind drifts a star downwind, more the slower it falls; scale 3 gives 3 × the height and drift, same times', () => {
  const k = dragK(0.01, 1100);
  const still = fly([0, 0, 0], [0, 80, 0], k, 4), windy = fly([0, 0, 0], [0, 80, 0], k, 4, { wind: [5, 0, 0] });
  assert.equal(Math.abs(still.p[0]) < 1e-9, true);
  assert.ok(windy.p[0] > 5 && windy.p[0] < 5 * 4, `drift ${windy.p[0]} m in 4 s at 5 m/s`);
  const heavy = fly([0, 0, 0], [0, 80, 0], k / 10, 4, { wind: [5, 0, 0] });
  assert.ok(heavy.p[0] < windy.p[0], 'a heavier (lower-drag) body drifts less');
  const s3 = fly([0, 0, 0], [0, 80 * 3, 0], k, 4, { wind: [5, 0, 0], scale: 3 });
  assert.ok(Math.abs(s3.apex.y - 3 * windy.apex.y) < 0.02 * windy.apex.y, `scaled apex ${s3.apex.y} vs 3 × ${windy.apex.y}`);
  assert.ok(Math.abs(s3.p[0] - 3 * windy.p[0]) < 0.02 * windy.p[0], 'scaled drift');
  assert.ok(Math.abs(s3.apex.t - windy.apex.t) < 0.02, 'same apex time');
  // starStep in place matches fly
  const p = [0, 0, 0], v = [0, 80, 0];
  for (let i = 0; i < 240; i++) starStep(p, v, k, 1 / 60, [5, 0, 0]);
  assert.ok(len([p[0] - windy.p[0], p[1] - windy.p[1], p[2] - windy.p[2]]) < 1e-6);
});

test('physics: the riser tops out at the asked height; a taller shell climbs longer', () => {
  const a = riserFor(180), b = riserFor(300);
  assert.ok(Math.abs(a.apex[1] - 180) < 0.5 && Math.abs(b.apex[1] - 300) < 0.5);
  assert.ok(b.t > a.t && a.t > 3 && b.t < 9, `${a.t} s, ${b.t} s`);
  assert.ok(a.v0 > 60 && b.v0 < 200, `muzzle ${a.v0}–${b.v0} m/s`);
});

test('shells: every type builds its count; stars leave at about 100 m/s and open to about the burst radius', () => {
  for (const type of SHELL_TYPES) {
    const s = buildShell(type, { inches: 6, seed: 3 });
    const n = starCount(type, 6);
    const simple = { crossette: n * CROSSETTE_SPLIT, crackle: n * (1 + CRACKLE_SPARKS) }[type] ?? (['peony', 'dahlia', 'chrysanthemum', 'changer', 'willow', 'horsetail', 'palm', 'strobe', 'brocade'].includes(type) ? n : null);
    if (simple != null) assert.equal(s.stars.length, 1 + simple, `${type}: ${s.stars.length} stars`);
    if (type === 'ring') assert.equal(s.stars.length - 1, n - 2, `ring: ${n} less a gap of two`);
    else assert.ok(s.stars.length >= n, `${type}: at least its base count`);
    assert.equal(shellStars(type, 6), s.stars.length + 1, `${type}: + the riser`);
    const speeds = s.stars.slice(1).map((x) => len(x.v)).sort((p, q) => p - q), med = speeds[speeds.length >> 1];
    assert.ok(med > (type === "horsetail" ? 6 : 15) && med < 160, `${type}: median launch ${med.toFixed(0)} m/s`);
  }
  const peony = buildShell('peony', { inches: 6, seed: 2 });
  const sp = peony.stars.slice(1).map((x) => len(x.v)), mean = sp.reduce((p, q) => p + q, 0) / sp.length;
  assert.ok(mean > 70 && mean < 130, `peony ${mean.toFixed(0)} m/s`);
  // fly a peony star for its burn: it reaches about the burst radius
  const st = peony.stars[5], r = fly([0, 0, 0], st.v, st.k, st.burn);
  const reach = Math.hypot(r.p[0], r.p[1], r.p[2]);
  assert.ok(reach > 0.6 * burstRadius(6) && reach < 1.5 * burstRadius(6), `reach ${reach.toFixed(0)} m vs ${burstRadius(6)} m`);
  // a peony fills the sphere: stars in every octant
  const oct = new Set(peony.stars.slice(1).map((x) => (x.v[0] > 0) * 1 + (x.v[1] > 0) * 2 + (x.v[2] > 0) * 4));
  assert.equal(oct.size, 8);
  // bigger shells throw more stars
  assert.ok(starCount('peony', 10) > 2.5 * starCount('peony', 6));
});

test('shells: a ring is planar; a crossette splits in 4 square to its path; crackle sparks pop after the parent burns', () => {
  for (const seed of [1, 7, 42]) {
    const ring = buildShell('ring', { inches: 6, seed });
    for (const s of ring.stars.slice(1)) assert.ok(Math.abs(dot(s.v, ring.normal)) < 1e-9 * len(s.v) + 1e-9, 'every ring star in the plane');
    const ups = ring.stars.slice(1).map((s) => Math.atan2(dot(s.v, [1, 0, 0]), dot(s.v, [0, 0, 1])));
    assert.ok(new Set(ups.map((a) => Math.round(a * 4))).size > 8, 'spread all round');
  }
  const cx = buildShell('crossette', { inches: 6, seed: 5 });
  const groups = new Map();
  for (const s of cx.stars.slice(1)) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); }
  assert.equal(groups.size, starCount('crossette', 6));
  for (const g of groups.values()) {
    assert.equal(g.length, 4);
    const v = g[0].v;
    assert.ok(g.every((s) => len([s.v[0] - v[0], s.v[1] - v[1], s.v[2] - v[2]]) < 1e-9 && s.kickAge === g[0].kickAge), 'they fly together until the split');
    assert.equal(g.filter((s) => s.hidden).length, 3, 'one drawn before the split');
    const kicks = g.map((s) => s.kick);
    const sum = kicks.reduce((p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]], [0, 0, 0]);
    assert.ok(len(sum) < 1e-6, 'the four kicks cancel (a cross)');
    for (const k of kicks) assert.ok(Math.abs(dot(k, v)) < 1e-6 * len(k) * len(v), 'each square to the path');
    assert.ok(Math.abs(dot(kicks[0], kicks[1])) < 1e-6 * len(kicks[0]) ** 2, 'neighbours at 90°');
    // flown through the split: four separate stars after it
    const ends = g.map((s) => { const p = [0, 0, 0], vv = [...s.v]; for (let t = 0; t < s.burn; t += 1 / 60) { if (t >= s.kickAge && t - 1 / 60 < s.kickAge) { vv[0] += s.kick[0]; vv[1] += s.kick[1]; vv[2] += s.kick[2]; } starStep(p, vv, s.k, 1 / 60); } return p; });
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(len([ends[a][0] - ends[b][0], ends[a][1] - ends[b][1], ends[a][2] - ends[b][2]]) > 3, 'apart after the split');
  }
  const ck = buildShell('crackle', { inches: 6, seed: 9 });
  const parents = ck.stars.filter((s) => !s.hidden && s.group >= 0), sparks = ck.stars.filter((s) => s.hidden);
  assert.equal(sparks.length, parents.length * CRACKLE_SPARKS);
  for (const s of sparks) { const p = parents.find((q) => q.group === s.group); assert.ok(s.kickAge >= p.burn * 0.9 && s.burn > s.kickAge && s.burn - s.kickAge < 0.2); }
});

test('show: same seed, same events; another seed, another show; five minutes in five parts, the finale the densest', () => {
  const a = makeShow(4), b = makeShow(4), c = makeShow(5);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.events.map((e) => [e.t, e.type]), c.events.map((e) => [e.t, e.type]));
  assert.equal(a.length, SHOW_LENGTH);
  for (let i = 1; i < a.events.length; i++) assert.ok(a.events[i].t >= a.events[i - 1].t);
  assert.ok(a.events.every((e) => e.t >= 0 && e.t < 293 && (e.ground ? e.burst === e.t : e.burst > e.t) && ALL_TYPES.includes(e.type)));
  const per = (seg) => a.events.filter((e) => e.t >= seg.from && e.t < seg.to).length / (seg.to - seg.from);
  const [opening, build, gap, body, finale] = SEGMENTS.map(per);
  assert.ok(gap < 0.2, `the quiet gap: ${gap} shells/s`);
  assert.ok(finale > 3 * build && finale > 3 * body && build > opening * 0.8, `rates ${[opening, build, gap, body, finale].map((x) => x.toFixed(2))}`);
  for (const type of ALL_TYPES) assert.ok(a.events.some((e) => e.type === type), `${type} in the show`);
  // layered: high and low together, the finale's shells the biggest
  const fin = a.events.filter((e) => e.t >= 245 && e.t < 293 && !e.ground), early = a.events.filter((e) => e.t < 140 && !e.ground);
  const mean = (xs) => xs.reduce((p, q) => p + q.inches, 0) / xs.length;
  assert.ok(mean(fin.filter((e) => e.t > 275)) > mean(early), 'the finale climbs to bigger shells');
  assert.ok(a.events.some((e) => e.ground && e.t >= 245), 'cakes and mines under the finale');
  // the loop: one type, a fixed period, deterministic
  const l = loopShow('willow', { seed: 2 });
  assert.ok(l.events.every((e) => e.type === 'willow'));
  assert.deepEqual(l, loopShow('willow', { seed: 2 }));
});

test('budget: the finale peaks near 30 k live stars (realism round: real counts), under the desktop capacity; the phone tier halves it', () => {
  for (const seed of [1, 2, 3]) {
    const show = makeShow(seed);
    const d = peakStars(show, 'desktop', 0.25), p = peakStars(show, 'phone', 0.25);
    assert.ok(d.n > 20000 && d.n < 65536, `seed ${seed}: desktop peak ${d.n}`);
    assert.ok(d.t > 245, `the peak is in the finale (${d.t} s)`);
    assert.ok(Math.abs(p.n / d.n - 0.5) < 0.03, `phone ${p.n} vs desktop ${d.n}`);
    assert.ok(p.n < 32768);
  }
  for (const type of ALL_TYPES) {
    const d = buildShell(type, { inches: 8, seed: 1 }).stars.length, p = buildShell(type, { inches: 8, seed: 1, tier: 'phone' }).stars.length;
    assert.ok(Math.abs(p / d - 0.5) < 0.08, `${type}: phone ${p} vs ${d}`);
  }
  const show = makeShow(1);
  assert.equal(liveStarsAt(show, 150), liveStarsAt(show, 150), 'pure');
});

test('flash bank: 8 slots, the brightest first, a fast rise and a fade; smoke drifts on the wind and thins', () => {
  const bursts = Array.from({ length: 12 }, (_, i) => ({ burst: i * 0.1, pos: [i, 0, 0], colour: [1, 0, 0], peak: 1 + i, tau: 0.4 }));
  const s = flashSlots(bursts, 1.2);
  assert.equal(s.length, FLASH_SLOTS);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].intensity <= s[i - 1].intensity);
  const b = { burst: 0, peak: 1, tau: 0.5 };
  assert.equal(flashAt(b, -0.1), 0); assert.ok(flashAt(b, 0.04) > flashAt(b, 0.5)); assert.equal(flashAt(b, 3), 0);
  assert.ok(flashSlots([], 0).every((x) => x.intensity === 0));
  const puffs = puffsFor({ burst: 10, pos: [0, 200, 0] }, { seed: 3, radius: 60 });
  const p0 = puffAt(puffs[0], 16, [4, 0, 0]), p1 = puffAt(puffs[0], 40, [4, 0, 0]);   // (wow round: the puff ramps in over 5 s)
  assert.ok(p1.pos[0] - p0.pos[0] > 4 * 23, 'downwind');
  assert.ok(p1.radius > p0.radius && p1.alpha < p0.alpha, 'grows and thins');
  assert.equal(puffAt(puffs[0], 5, [4, 0, 0]), null);
  assert.equal(puffAt(puffs[0], 100, [4, 0, 0]), null);
  const r = rng(1), r2 = rng(1);
  assert.equal(r(), r2());
});

test('variety: each type has its own shape (pistil core, Saturn ring and ball, multi-break, colour change, horsetail, willow hang)', () => {
  const pistil = buildShell('pistil', { inches: 6, seed: 4, colour: 'blue', colour2: 'gold' }).stars.slice(1);
  const speeds = pistil.map((s) => len(s.v)), slow = pistil.filter((s, i) => speeds[i] < 0.6 * Math.max(...speeds));
  assert.ok(slow.length > 40 && slow.every((s) => s.col === PALETTE.gold), 'a slower core of the second colour');
  const sat = buildShell('saturn', { inches: 6, seed: 5, colour: 'green', colour2: 'purple' });
  const ringStars = sat.stars.filter((s) => s.col === PALETTE.green), ballStars = sat.stars.filter((s) => s.col === PALETTE.purple);
  for (const s of ringStars) assert.ok(Math.abs(dot(s.v, sat.normal)) < 1e-6 * len(s.v) + 1e-9, 'the ring is flat');
  assert.ok(ballStars.length > ringStars.length && Math.max(...ballStars.map((s) => len(s.v))) < Math.min(...ringStars.map((s) => len(s.v))), 'a smaller ball inside');
  const mb = buildShell('multibreak', { inches: 6, seed: 6 }).stars;
  const delays = [...new Set(mb.map((s) => s.delay))].sort((p, q) => p - q);
  assert.equal(delays.length, MULTI_BREAKS);
  assert.ok(delays[0] === 0 && delays.at(-1) > 1, 'four breaks in sequence');
  const ys = delays.map((d) => mb.find((s) => s.delay === d).p[1]);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], 'each break higher');
  const ch = buildShell('changer', { inches: 6, seed: 7, colour: 'red', colour2: 'green' }).stars.slice(1);
  assert.ok(ch.every((s) => s.change > 0.3 * s.burn && s.change < 0.6 * s.burn && s.col2 === PALETTE.green), 'red, then green mid-burn');
  const ht = buildShell('horsetail', { inches: 6, seed: 8 }).stars.slice(1);
  assert.ok(ht.every((s) => s.v[1] > 0), 'a horsetail throws up, then falls in a sheet');
  const wl = buildShell('willow', { inches: 10, seed: 9 }).stars.slice(1), pe = buildShell('peony', { inches: 10, seed: 9 }).stars.slice(1);
  assert.ok(wl[0].burn > 2 * pe[0].burn && wl[0].tau > 4 * pe[0].tau, 'a willow burns and streaks long');
  const fall = fly([0, 0, 0], wl[3].v, wl[3].k, wl[3].burn), drop = -fall.p[1];
  assert.ok(drop > 0.25 * 300, `a 10-inch willow star hangs down ${drop.toFixed(0)} m toward the water`);
  const br = buildShell('brocade', { inches: 6, seed: 2 }).stars.slice(1), dah = buildShell('dahlia', { inches: 6, seed: 2 }).stars.slice(1);
  assert.ok(dah.length < 0.5 * br.length && dah[0].headPx > 2 * br[0].headPx, 'a dahlia: few fat stars; a brocade: many fine streaks');
  const salute = buildShell('salute', { inches: 6, seed: 2 }).stars;
  assert.ok(salute[0].headPx > 15 && salute.every((s) => s.burn < 0.3), 'a salute: one white flash, gone in 0.3 s');
});

test('ground effects: fired from the deck with no riser; a cake fans in volleys, a Niagara drips along the barge', () => {
  for (const type of GROUND_TYPES) assert.equal(shellStars(type, 6), buildShell(type, { inches: 6 }).stars.length, `${type}: no riser`);
  const cake = buildShell('cake', { inches: 6, seed: 3, plane: [0, 0, 1] }).stars;
  // realism round: single comets one by one (0.08–0.15 s apart), the sound's thumps on the same shots
  const delays = cake.map((s) => s.delay);
  assert.equal(new Set(delays).size, cake.length, 'one comet a shot');
  assert.deepEqual(delays, cakeTimes(6, 3));
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] - delays[i - 1] >= 0.079 && delays[i] - delays[i - 1] <= 0.151, 'fired 0.08–0.15 s apart');
  assert.ok(cake.every((s) => Math.abs(s.v[0]) < 1e-9 && s.v[1] > 0), 'fanned in the barge\'s plane, upward');
  const ang = cake.map((s) => Math.atan2(s.v[2], s.v[1]) * 180 / Math.PI);
  assert.ok(Math.max(...ang) > 40 && Math.min(...ang) < -40, 'a wide fan');
  const ni = buildShell('niagara', { inches: 6, seed: 3, plane: [1, 0, 0] }).stars;
  const xs = ni.map((s) => s.p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 60 && ni.every((s) => s.v[1] < 0 && s.p[1] > 5), 'a curtain along the barge, falling');
  assert.ok(Math.max(...ni.map((s) => s.delay)) > 10, 'dripping for over 10 s');
  const mine = buildShell('mine', { inches: 6, seed: 3 }).stars;
  assert.ok(mine.every((s) => s.v[1] > 0.85 * len(s.v)), 'a mine: a narrow cone straight up');
});

test('staging (wow round): from the viewing spot the shells fill the sky, 4" bursts 40°+ up, the biggest overhead; the barges 250 m off', () => {
  const B = bargesWorld();
  for (const b of B) {
    const big = shellAngles(VIEW, b, 12), small = shellAngles(VIEW, b, 4);
    assert.ok(small.burst > 40 && small.width > 40 && big.burst > 65, `4": ${small.burst.toFixed(1)}° up, ${small.width.toFixed(0)}° wide; 12": ${big.burst.toFixed(1)}°`);
    assert.ok(b.d > 230 && b.d < 280, 'the barges 230–280 m from the viewing spot');
  }
  assert.ok(finaleSpan() > 100, `the finale spans ${finaleSpan().toFixed(0)}° of the sky round the boat`);
});

test('far shows and twilight: South Lake starts minutes before ours and keeps popping; the twilight is gone by 22:30', () => {
  const sl = makeFarShow({ seed: 3, start: -240, length: 560 });
  assert.deepEqual(sl, makeFarShow({ seed: 3, start: -240, length: 560 }));
  assert.ok(sl.events[0].t < -20 && sl.events.some((e) => e.t > 145 && e.t < 158), 'before ours and in our gap');
  assert.ok(sl.events.every((e) => !e.ground));
  assert.equal(twilightLevel(-12.5), 1, '21:45: the deep blue twilight');
  assert.equal(twilightLevel(-19), 0, 'after 22:30: the approved galaxy night');
  assert.ok(twilightLevel(-16) > 0 && twilightLevel(-16) < 1, 'a fade between');
  assert.equal(twilightLevel(10), 0, 'never by day');
});

test('round 3 shapes: cake and V comets bend into arcs; a low kamuro hangs 4–6 s and droops near the water', () => {
  const bend = (s, T) => {   // the turn of the path (degrees) between its start and T s, at scale 3
    const v = s.v.map((x) => x * 3), p = [0, 0, 0], v0 = [...v];
    const r = fly(p, v, s.k, T, { scale: 3 });
    const a = Math.acos(Math.max(-1, Math.min(1, dot(v0, r.v) / (len(v0) * len(r.v))))) * 180 / Math.PI;
    return a;
  };
  const cake = buildShell('cake', { inches: 6, seed: 3, plane: [0, 0, 1] }).stars;
  const outer = cake.filter((s) => Math.abs(s.v[2]) > 0.5 * len(s.v));
  assert.ok(outer.length > 0 && outer.every((s) => bend(s, s.burn) > 25), 'the outer comets of the fan arc over');
  const vc = buildShell('vcomets', { inches: 6, seed: 3 }).stars;
  assert.ok(vc.every((s) => bend(s, s.burn) > 10), 'V comets curve');
  // a 4-inch kamuro at the show's 3×: bursts at 360 m, hangs 4–6 s and droops to within ≈ 150 m of the water
  const w = buildShell('willow', { inches: 4, seed: 1 }).stars.slice(1);
  assert.ok(w[0].burn >= 6, `burns ${w[0].burn.toFixed(1)} s`);
  const drop = (s) => -fly([0, 0, 0], s.v.map((x) => x * 3), s.k, s.burn, { scale: 3 }).p[1];
  const down = w.filter((s) => s.v[1] < 0).map(drop).sort((p, q) => p - q);
  assert.ok(down[down.length >> 1] > 200, `the lower half hangs down ${down[down.length >> 1].toFixed(0)} m from 360 m`);
});

test('spectators: two sailboats and four kayaks between the viewing spot and the show, all outside the 300 m safety zone', async () => {
  const { SPECTATORS } = await import('../classic/src/fireworks/spectators.js');
  const { at, AIM } = await import('../src/fireworks/stage.js');
  const { BARGE } = await import('../classic/src/fireworks/barges.js');
  const B = bargesWorld();
  assert.equal(SPECTATORS.sailboats.length, 2);
  assert.ok(SPECTATORS.kayaks.length >= 3 && SPECTATORS.kayaks.length <= 4);
  for (const s of [...SPECTATORS.sailboats, ...SPECTATORS.kayaks]) {
    const [x, z] = at(s.bearing, s.d, VIEW);
    for (const b of B) assert.ok(Math.hypot(x - b.x, z - b.z) > BARGE.zone, `${s.bearing}°/${s.d} m clear of the zone`);
    assert.ok(Math.abs(s.bearing - AIM) <= 30 && s.d < 400, 'toward the show, in front of the viewing spot');
  }
});

test('S2: the show clock starts at 21:44 on show seconds; the twilight rises from 21:00 to the show and is gone by 22:30', async () => {
  const { showTimeAt, SHOW_START_HOUR, SHOW_GAME_RATE } = await import('../classic/src/fireworks/world.js');
  assert.equal(showTimeAt(SHOW_START_HOUR), 0);
  assert.ok(Math.abs(showTimeAt(SHOW_START_HOUR + 20 / 60) - SHOW_LENGTH) < 1e-6, 'the show\'s 20 game minutes are its 5-minute script');
  assert.equal(SHOW_GAME_RATE, 4);
  assert.equal(showTimeAt(18), null, 'nothing by day');
  assert.equal(showTimeAt(23), null, 'nothing after the smoke');
  assert.equal(twilightLevel(-4), 0, 'before 21:00 (sun −5°): the approved dusk');
  assert.ok(twilightLevel(-8) > 0.2 && twilightLevel(-8) < 0.9, 'rising toward the show');
  assert.equal(twilightLevel(-12.5), 1, 'full at the show');
});

test('S2 / S5: the flags gate the show: on by default (S5, owner 2026-11-08), ?fireworks=0 turns it off', async () => {
  const { parseFlags } = await import('../src/sim/core/flags.js');
  const dflt = parseFlags('?hour=21.75'), off = parseFlags('?fireworks=0'), on = parseFlags('?fireworks=1&fwt=120&fwlook=14');
  assert.equal(dflt.fireworks, true);
  assert.equal(off.fireworks, false);
  assert.equal(on.fireworks, true);
  assert.equal(on.fwt, '120'); assert.equal(on.fwlook, '14');
});

// S3: the evening, driven on a fake clock (game hours advance at the step's rate, or a day clock's 12 when released)
async function runEvening({ startHour, at: pos, sog = 0, secs = 120, dt = 1 / 30, dayRate = 12, sun = (h) => -6 - (h - 21.0167) * 7.3 }) {
  const { createEvening } = await import('../src/fireworks/evening.js');
  const ev = createEvening();
  let hour = startHour; const log = [];
  for (let t = 0; t < secs; t += dt) {
    const out = ev.step(dt, { hour, sunDeg: sun(hour), x: pos[0], z: pos[1], sog });
    log.push({ t, hour, ...out });
    hour += ((out.rate ?? dayRate) * dt) / 3600;
  }
  return log;
}

test('S3 evening: hints in the afternoon and at dusk; settled at the mouth after dark, a quick time-lapse lands on 21:44', async () => {
  const { LINES, SHOW_START } = await import('../src/fireworks/evening.js');
  const inBay = [900, -900];
  const before = await runEvening({ startHour: 20.2, at: inBay, secs: 300, dayRate: 12 });
  const said = before.flatMap((s) => s.lines);
  assert.ok(said.includes(LINES.afternoon) && said.includes(LINES.dusk), `lines: ${said.join(' | ')}`);
  assert.ok(said.every((l) => l.length <= 46), 'quiet, short lines');
  // at the spot, just after civil dusk: the lapse starts after the 6 s settle, reaches 21:44 within ≈ 10 s, never overshoots
  const log = await runEvening({ startHour: 21.03, at: VIEW, secs: 40 });
  const lapse = log.find((s) => s.phase === 'lapse'), show = log.find((s) => s.phase === 'show');
  assert.ok(lapse && lapse.t >= 5.9 && lapse.t < 7, `lapse at ${lapse?.t}`);
  assert.ok(show && show.t - lapse.t < 12, `lapse ${(show.t - lapse.t).toFixed(1)} s`);
  assert.ok(Math.abs(show.hour - SHOW_START) * 3600 < 2, `lands at ${((show.hour - SHOW_START) * 3600).toFixed(2)} s from 21:44`);
  assert.ok(log.filter((s) => s.phase === 'lapse').every((s) => s.hour <= SHOW_START), 'the lapse never passes 21:44');
  assert.ok(Math.max(...log.map((s) => s.rate ?? 0)) <= 360, 'at most 360 game s a real s');
  // the ramp: the first second of the lapse stays slow (an ease, not a cut)
  const first = log.filter((s) => s.phase === 'lapse' && s.t - lapse.t < 0.3);
  assert.ok(first.every((s) => s.rate < 120));
});

test('S3 evening: during the show the clock runs at 4, so the show clock and the game clock agree; then it is released', async () => {
  const { showTimeAt } = await import('../classic/src/fireworks/world.js');
  const { SHOW_START, EVENING } = await import('../src/fireworks/evening.js');
  const log = await runEvening({ startHour: SHOW_START, at: VIEW, secs: 420 });
  const inShow = log.filter((s) => s.phase === 'show');
  assert.ok(inShow.every((s) => s.rate === 4));
  // after 100 real s of show the show time is 100 s
  const s100 = log.find((s) => s.t >= 100);
  assert.ok(Math.abs(showTimeAt(s100.hour) - s100.t) < 0.1, `show ${showTimeAt(s100.hour).toFixed(2)} vs real ${s100.t.toFixed(2)}`);
  const after = log.find((s) => s.phase === 'after');
  assert.ok(after && after.rate === null && after.hour >= EVENING.endHour, 'the day clock takes over after the show');
});

test('S3 evening: away from the spot the time-lapse still starts at 21:35, the show plays on time, and the hint says next time', async () => {
  const { LINES, EVENING, SHOW_START } = await import('../src/fireworks/evening.js');
  const away = [-200, 400];
  const log = await runEvening({ startHour: 21.5, at: away, sog: 3, secs: 480, dayRate: 12 });
  const lapse = log.find((s) => s.phase === 'lapse');
  assert.ok(lapse && Math.abs(lapse.hour - EVENING.capHour) < 0.01, `the cap at ${lapse?.hour}`);
  assert.ok(log.some((s) => s.phase === 'show' && Math.abs(s.hour - SHOW_START) < 0.001));
  assert.ok(log.flatMap((s) => s.lines).includes(LINES.nextTime));
  // at the spot: no "next time"
  const good = await runEvening({ startHour: 21.03, at: VIEW, secs: 480 });
  assert.ok(!good.flatMap((s) => s.lines).includes(LINES.nextTime));
});

// Polish round (owner, 2026-11-08): the finale fits the frame; the chart's mark has a name; the far shows fire no rings
// the finale's star apexes (every aerial of 8" and up from 240 s, each star flown over its burn as the engine does)
async function finaleApexes(show) {
  const { fitShow: _f, SCALE } = await import('../src/fireworks/stage.js');
  const B = bargesWorld(), pts = [];
  for (const e of show.events) {
    if (e.ground || e.t < 240 || e.inches < 8) continue;
    const b = B[e.barge % B.length], ax = b.axis;
    const m = [b.x + (ax[0] * e.jitter[0] - ax[1] * e.jitter[1]) * SCALE, 2.6, b.z + (ax[1] * e.jitter[0] + ax[0] * e.jitter[1]) * SCALE];
    const r = fly(m, [e.v0 * e.tilt[0] * SCALE, e.v0 * SCALE, e.v0 * e.tilt[1] * SCALE], 0.0026, e.rise, { scale: SCALE });
    for (const s of buildShell(e.type, { inches: e.inches, seed: e.seed, plane: [ax[0], 0, ax[1]], spread: e.spread ?? 1 }).stars) {
      if (s.burn < 0.3) continue;
      pts.push(fly(r.p.map((x, i) => x + s.p[i] * SCALE), r.v.map((x, i) => x + s.v[i] * SCALE), s.k, Math.min(s.burn, 2.5), { scale: SCALE, dt: 1 / 15 }).apex.p);
    }
  }
  return pts;
}
// the points' screen heights (−1 bottom … 1 top) in a 16:9 camera at pos aimed at target with a vertical fov (degrees),
// those inside the frame's width; and the horizon's height
function screenY(pts, pos, target, fov) {
  const f = target.map((x, i) => x - pos[i]), fl = Math.hypot(...f); f.forEach((_, i) => { f[i] /= fl; });
  const rt = [-f[2], 0, f[0]], rl = Math.hypot(...rt); rt.forEach((_, i) => { rt[i] /= rl; });
  const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]], t = Math.tan(fov * Math.PI / 360);
  const ys = [];
  for (const p of pts) {
    const d = p.map((x, i) => x - pos[i]), z = dot(d, f);
    if (z > 0 && Math.abs(dot(d, rt) / z / (t * 16 / 9)) <= 1) ys.push(dot(d, up) / z / t);
  }
  const h = [f[0] * 5000, -pos[1], f[2] * 5000];
  return { ys: ys.sort((a, b) => a - b), horizon: dot(h, up) / dot(h, f) / t };
}
const pct = (ys, q) => ys[Math.floor(q * (ys.length - 1))];

test('polish / wow: from the viewing spot the finale fills the show framing, the water in view (follow and hero cameras)', async () => {
  const { fitShow, SHOW_FRAME, HERO_CAM, AIM } = await import('../src/fireworks/stage.js');
  const { FollowCamera } = await import('../src/sim/boat/followCamera.js');
  const follow = (look, fov) => {
    const st = { x: VIEW[0], z: VIEW[1], heave: 0, heading: AIM * Math.PI / 180, sog: 0 }, fc = new FollowCamera({ x: st.x, z: st.z, heading: st.heading });
    fc.lookBias = look; fc.fovBias = fov;
    let p; for (let i = 0; i < 300; i++) p = fc.update(1 / 60, st);
    return p;
  };
  const a = AIM * Math.PI / 180, hero = (pitch) => {
    const pos = [VIEW[0] - Math.sin(a) * HERO_CAM.back, HERO_CAM.y, VIEW[1] + Math.cos(a) * HERO_CAM.back], pt = pitch * Math.PI / 180;
    return { pos, target: [pos[0] + Math.sin(a) * Math.cos(pt) * 100, pos[1] + Math.sin(pt) * 100, pos[2] - Math.cos(a) * Math.cos(pt) * 100], fov: HERO_CAM.fov };
  };
  // wow round (owner: big and close, the biggest may leave the top): the finale's stars mostly in frame (the median well
  // inside, 70 % under the top), the water in view
  const fitted = await finaleApexes(fitShow(makeShow(1)));
  const f = follow(SHOW_FRAME.look, SHOW_FRAME.fov), sf = screenY(fitted, f.pos, f.target, f.fov);
  assert.ok(pct(sf.ys, 0.5) < 0.75 && pct(sf.ys, 0.7) < 1, `follow: the finale's median star at ${pct(sf.ys, 0.5).toFixed(3)}, 70 % at ${pct(sf.ys, 0.7).toFixed(3)}`);
  assert.ok(sf.horizon < -0.6 && sf.horizon > -0.95, `follow: the horizon at ${sf.horizon.toFixed(2)} (the water and the boats in view)`);
  const h = hero(HERO_CAM.pitch), sh = screenY(fitted, h.pos, h.target, h.fov);
  assert.ok(pct(sh.ys, 0.5) < 0.75 && pct(sh.ys, 0.7) < 1, `hero: the median at ${pct(sh.ys, 0.5).toFixed(3)}`);
  assert.ok(sh.horizon < -0.3, `hero: the reflections in view (horizon ${sh.horizon.toFixed(2)})`);
  // the test can fail: S3's show and framing clipped the finale far past the top
  const raw = await finaleApexes(makeShow(1)), f0 = follow(0.42, 14), s0 = screenY(raw, f0.pos, f0.target, f0.fov);
  assert.ok(pct(s0.ys, 0.995) > 1.5, `S3 clipped (${pct(s0.ys, 0.995).toFixed(2)})`);
});

test('polish: the frame law draws shells over 6" lower and smaller, keeps their stars, and leaves the rest alone', async () => {
  const { fitShow, frameGain } = await import('../src/fireworks/stage.js');
  const show = makeShow(2), fit = fitShow(show);
  assert.deepEqual(fit, fitShow(makeShow(2)), 'deterministic');
  assert.equal(frameGain(6), 1); assert.ok(frameGain(12) > 0.65 && frameGain(12) < 0.8, `12": × ${frameGain(12).toFixed(3)}`);
  assert.ok(frameGain(8) > frameGain(10) && frameGain(10) > frameGain(12), 'the biggest shrink most; they stay the biggest');
  show.events.forEach((e, i) => {
    const g = fit.events[i];
    assert.equal(g.t, e.t); assert.equal(g.type, e.type); assert.equal(g.inches, e.inches);
    if (e.ground || e.inches <= 6) assert.deepEqual(g, e);
    else { assert.ok(g.height < e.height && g.burst < e.burst && g.spread < 1); assert.equal(buildShell(g.type, { inches: g.inches, seed: g.seed, spread: g.spread }).stars.length, buildShell(e.type, { inches: e.inches, seed: e.seed }).stars.length); }
  });
  // 12" still bursts higher and wider than 8"
  assert.ok(frameGain(12) * 12 > frameGain(8) * 8 + 1);
});

test('polish: the far shows fire no ring shells (a small ring over the horizon read as a floating blue ring)', () => {
  for (const seed of [8, 15, 1, 2]) assert.ok(makeFarShow({ seed, start: -240, length: 560, gap: [1.5, 4], finaleAt: 300 }).events.every((e) => e.type !== 'ring' && e.type !== 'saturn'));
});

test('polish: the chart\'s mark at the viewing spot carries a short label on the small round chart', async () => {
  const { installDom } = await import('./helpers/dom-helm.mjs');
  const { MARK } = await import('../classic/src/fireworks/world.js');
  assert.ok(MARK.label.length <= 10 && MARK.name.length <= 10, 'short');
  const dom = installDom();
  const { createChartplotter } = await import('../src/ui/chartplotter.js');
  const state = { x: 1200, z: -1100, heading: 1.2, sog: 0 };
  const cp = createChartplotter({ terrain: { heightAt: () => -20 }, boat: () => state });
  cp.toggle.shown = true;
  cp.setDestination({ x: VIEW[0], z: VIEW[1], name: MARK.name, label: MARK.label });
  for (let i = 0; i < 30; i++) cp.update(0.1);
  const small = cp.el.querySelectorAll('canvas')[0];
  assert.ok(small.drawnText.includes(MARK.label), `the small chart prints "${MARK.label}"`);
  // without a label the small chart prints no name (Cruise's marks as before)
  small.drawnText.length = 0;
  cp.setDestination({ x: VIEW[0], z: VIEW[1], name: MARK.name });
  for (let i = 0; i < 30; i++) cp.update(0.1);
  assert.ok(!small.drawnText.includes(MARK.label) && !small.drawnText.includes(MARK.name));
  cp.dispose(); dom.uninstall();
});

test('S4 fix: the enlarged chart sets the mark\'s name clear of its ring and cross and of the sloop beside it', async () => {
  const { installDom } = await import('./helpers/dom-helm.mjs');
  const { MARK } = await import('../classic/src/fireworks/world.js');
  const dom = installDom();
  const { createChartplotter } = await import('../src/ui/chartplotter.js');
  // the polish capture's case: the sloop ≈ 260 m north-east of the sill (≈ 30 px on the enlarged chart), beside the mark
  for (const [dx, dz] of [[230, -120], [0, 0], [-200, 80], [150, 150], [120, -60]]) {
    const state = { x: VIEW[0] + dx, z: VIEW[1] + dz, heading: 1.2, sog: 0 };
    const cp = createChartplotter({ terrain: { heightAt: () => -20 }, boat: () => state });
    cp.toggle.shown = true; cp.toggle.pin();
    cp.setDestination({ x: VIEW[0], z: VIEW[1], name: MARK.name, label: MARK.label });
    for (let i = 0; i < 30; i++) cp.update(0.1);
    const big = cp.el.querySelectorAll('canvas')[1];
    const ring = big.drawnArcs.filter(([, , r]) => r === 7).at(-1), boatAt = big.drawnTranslates.at(-1);
    const t = big.drawnAt.filter((d) => d.s === MARK.name).at(-1);
    assert.ok(ring && boatAt && t, 'the mark, the sloop and the name are drawn');
    const w = MARK.name.length * 6, x0 = t.align === 'left' ? t.x : t.align === 'right' ? t.x - w : t.x - w / 2, box = [x0, t.y - 8, x0 + w, t.y + 8];
    const clear = (cx, cy, r) => box[2] < cx - r || box[0] > cx + r || box[3] < cy - r || box[1] > cy + r;
    assert.ok(clear(ring[0], ring[1], 11), `clear of the cross (boat at ${dx}, ${dz}): ${JSON.stringify(box)} vs ${ring.slice(0, 2)}`);
    assert.ok(clear(boatAt[0], boatAt[1], 9.4), `clear of the sloop (boat at ${dx}, ${dz})`);
    cp.dispose();
  }
  dom.uninstall();
});

test('realism round: every star its own (speed, burn, brightness); a ring a few dozen distinct stars; colour stars smear short, charcoal tails long', () => {
  for (const type of ['peony', 'chrysanthemum', 'ring', 'dahlia', 'willow', 'mine']) {
    const st = buildShell(type, { inches: 8, seed: 11, tier: 'desktop' }).stars.filter((s) => s.flick !== 8);
    const burns = new Set(st.map((s) => s.burn.toFixed(4))), brights = new Set(st.map((s) => s.bright.toFixed(4)));
    assert.ok(burns.size > 0.9 * st.length && brights.size > 0.9 * st.length, `${type}: no two stars burn or shine alike`);
    const sp = st.map((s) => len(s.v)).sort((a, b) => a - b);
    assert.ok(sp.at(-1) / sp[0] > (type === 'ring' ? 1.05 : 1.2), `${type}: speeds spread ${(sp.at(-1) / sp[0]).toFixed(2)}`);
  }
  // a ring: a few dozen stars even at 12" (a filled band read as a sticker), with a gap
  const ring = buildShell('ring', { inches: 12, seed: 3 }).stars.slice(1);
  assert.ok(ring.length >= 40 && ring.length <= 80, `12" ring: ${ring.length} stars`);
  // a video's streaks: a colour star's smear is short, a charcoal or glitter tail long
  for (const t of ['peony', 'ring', 'changer', 'mine']) assert.ok(SHELL_SPEC[t].tau <= 0.2, `${t}: a short smear`);
  for (const t of ['chrysanthemum', 'willow', 'brocade', 'palm']) assert.ok(SHELL_SPEC[t].tau >= 0.8, `${t}: a long tail`);
  // a fan cake sweeps across and back: its comets' leans change side at least twice
  const cake = buildShell('cake', { inches: 6, seed: 4, plane: [1, 0, 0] }).stars;
  const lean = cake.map((s) => Math.sign(s.v[0]));
  let flips = 0; for (let i = 1; i < lean.length; i++) if (lean[i] !== lean[i - 1]) flips++;
  assert.ok(flips >= 2 && flips <= 6, `the fan sweeps across and back (${flips} crossings)`);
});

test('flash bank glow (look round 1): the burn outlasts the flash, holds a slot, and the slots go to the most light', () => {
  const b = { burst: 10, pos: [0, 200, 0], colour: [1, 0.5, 0], peak: 2, tau: 0.5 };
  assert.equal(glowAt(b, 9.9), 0, 'nothing before the burst');
  assert.ok(glowAt(b, 10.02) < glowAt(b, 10.05), 'a 40 ms rise');
  assert.ok(glowAt(b, 10.05) <= b.peak * GLOW.level, 'never over its level');
  assert.equal(flashAt(b, 13), 0); assert.ok(glowAt(b, 13) > 0.1, 'the flash is over at 3 s, the glow is not');
  assert.ok(glowAt(b, 11) > glowAt(b, 13), 'it fades');
  assert.equal(glowAt(b, 10 + Math.min(4 * b.tau * GLOW.stretch, GLOW.maxS) + 0.01), 0, 'and ends');
  assert.equal(glowAt({ ...b, tau: 3 }, 10 + GLOW.maxS + 0.01), 0, 'a long fade (a niagara) ends at maxS all the same');
  // a burst past its flash keeps a slot by its glow
  const s = flashSlots([b], 13);
  assert.equal(s.length, FLASH_SLOTS);
  assert.equal(s[0].intensity, 0); assert.ok(s[0].glow > 0.1); assert.deepEqual(s[0].colour, [1, 0.5, 0]);
  assert.ok(s.slice(1).every((x) => x.intensity === 0 && x.glow === 0), 'the unused slots are dark');
  // ten bursts for eight slots: one big glowing burst past its flash stays in; the faintest fresh flashes drop out
  const many = [{ burst: 0, pos: [9, 9, 9], colour: [0, 1, 0], peak: 6, tau: 0.5 }, ...Array.from({ length: 9 }, (_, i) => ({ burst: 2.9, pos: [i, 0, 0], colour: [1, 0, 0], peak: 0.1 + 0.1 * i, tau: 0.4 }))];
  const m = flashSlots(many, 3);
  assert.ok(m.some((x) => x.pos[0] === 9 && x.intensity === 0 && x.glow > 0.5), 'the big glow holds a slot');
  assert.ok(!m.some((x) => x.pos[0] === 0 && x.pos[1] === 0), 'the faintest flash does not');
  for (let i = 1; i < m.length; i++) assert.ok(m[i].intensity <= m[i - 1].intensity, 'the brightest flash first');
  const light = (x) => x.intensity + x.glow, least = Math.min(...m.map(light));
  assert.ok(least >= flashAt(many[1], 3) + glowAt(many[1], 3), 'no slot holds less light than the one left out');
});
