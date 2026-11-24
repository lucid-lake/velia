// Fireworks S5 (owner 2026-11-08): the Cruise button and the trip to the viewing spot, the share link
// (?show=fireworks), the show on by default on the highlight day only, Cruise's camera shots and its score. Behaviour only:
// each test calls the module and reads what comes out (the trip on the real physics, wind and terrain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags, withFlags } from '../src/sim/core/flags.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
import { isHighlightDay, dayChoice } from '../src/sim/day.js';
import { createCruiseTrip, crewStep, jumpHour, bearingFrom, CRUISE_SPOT, SHARE_HEADING, SHOW_CENTRE, TRIP, TRIP_NAME, shareOverrides, shareSearch, shareHour, isShare, showOn } from '../classic/src/fireworks/cruise.js';
import { createEvening, SHOW_START, EVENING } from '../src/fireworks/evening.js';
import { showTimeAt } from '../classic/src/fireworks/world.js';
import { SHOTS, showShot, shotAt } from '../classic/src/fireworks/shots.js';
import { musicWant, MUSIC } from '../src/fireworks/music.js';
import { fitShow, spreadShow, wowShow, bargesWorld, SCALE, SILL, SPREAD_LAW, SPREAD_TALL, FALLING, MAST_SIDE } from '../src/fireworks/stage.js';
import { makeShow, SHOW_LENGTH } from '../src/fireworks/show.js';
import { fly } from '../src/fireworks/physics.js';
import { buildShell, burstRadius, SHELL_SPEC } from '../src/fireworks/shells.js';
import { SHOW_NOW } from '../classic/src/sail/showNow.js';
import { Navigator } from '../src/sim/modes/chill/navigator.js';
import { decideFirstVisit } from '../src/ui/firstVisit.js';
import { attractSettings } from '../src/ui/attract.js';
import { runTrip } from './helpers/fireworks-trip.mjs';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hl = (q) => isHighlightDay(CURRENT_WATERS, parseFlags(q).show === 'fireworks' ? 'highlight' : parseFlags(q).day);

test('S5 default on: the show is built on the highlight day only; ?fireworks=0 turns it off; other days have none', () => {
  assert.equal(showOn(parseFlags(''), hl('')), true, 'the normal game: July 4, the show at 21:45');
  assert.equal(showOn(parseFlags('?day=highlight'), hl('?day=highlight')), true);
  assert.equal(showOn(parseFlags('?day=2026-07-04'), hl('?day=2026-07-04')), true, 'July 4 written out');
  assert.equal(showOn(parseFlags('?fireworks=0'), hl('?fireworks=0')), false, '?fireworks=0 off');
  for (const q of ['?day=normal', '?day=2026-08-01', '?day=2026-07-05&fireworks=1']) assert.equal(showOn(parseFlags(q), hl(q)), false, `${q}: no show`);
});

test('S5 button: on another day it opens the share link (the show\'s day); on the show\'s evening the clock jumps to it', () => {
  const link = shareSearch('?day=normal&quality=high&hour=13&fireworks=0&mode=cruise');
  const f = parseFlags(link);
  assert.equal(f.show, 'fireworks'); assert.equal(f.mode, 'cruise'); assert.equal(f.day, null); assert.equal(f.hour, null); assert.equal(f.quality, 'high');
  assert.ok(isShare(f) && showOn(f, hl(link)), 'the link builds the show');
  // the page's own day for the share link is the highlight day, whatever ?day says
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try { globalThis.location = { search: '?show=fireworks&day=normal' }; assert.equal(dayChoice(), 'highlight'); } finally { if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location; }
  // the jump: before 20:00 or after the show's end the clock goes to 20:15; inside the evening it stays
  assert.equal(jumpHour(13), TRIP.eveningHour); assert.equal(jumpHour(5.5), TRIP.eveningHour); assert.equal(jumpHour(23.2), TRIP.eveningHour);
  for (const h of [20.1, 20.9, 21.6, 21.9]) assert.equal(jumpHour(h), null, `${h}: already the evening`);
});

test('S5 button: the trip sets the navigator\'s mark at the spot; invited, the lapse waits only for the boat settled there', () => {
  const trip = createCruiseTrip(); trip.start();
  const nav = new Navigator({ chart: { region: {} }, route: [{ key: 'a', at: [0, 0], look: [0, 0, 0] }] });
  const ctl = {}, phys = { state: { x: 600, z: -400, u: 2.6, sog: 2.6 } };
  const o = crewStep({ trip, phys, ctl, nav, dt: 1 / 60 });
  assert.equal(o.state, 'sailing'); assert.deepEqual(nav.dest.at, CRUISE_SPOT); assert.equal(nav.dest.name, TRIP_NAME);
  assert.ok(!o.hold && ctl.furl === 0, 'the skipper sails her there');
  // the evening at 20:30 (sun still up), invited: settled 6 s at the anchorage → the lapse, then the show at 21:44
  const ev = createEvening({ also: [CRUISE_SPOT] }); ev.invite();
  let hour = 20.5, show = null;
  for (let t = 0; t < 60; t += 1 / 30) {
    const out = ev.step(1 / 30, { hour, sunDeg: 4, x: CRUISE_SPOT[0] + 20, z: CRUISE_SPOT[1], sog: 0.1 });
    if (out.phase === 'show' && !show) show = { t, hour };
    hour += ((out.rate ?? 12) / 30) / 3600;
  }
  assert.ok(show && show.t < 25 && Math.abs(show.hour - SHOW_START) * 3600 < 2, `the show at ${show?.t.toFixed(1)} s, ${show?.hour}`);
  // not invited, the same boat in daylight waits for the dark (S3's rule)
  const ev0 = createEvening({ also: [CRUISE_SPOT] });
  assert.equal(ev0.step(10, { hour: 20.5, sunDeg: 4, x: CRUISE_SPOT[0], z: CRUISE_SPOT[1], sog: 0 }).phase, 'before');
  // invited while still sailing there, the golden hour holds at the invite pace; an evening already over starts again
  const ev1 = createEvening(); ev1.invite();
  assert.equal(ev1.step(1 / 30, { hour: 20.4, sunDeg: 3, x: 0, z: 0, sog: 3 }).rate, EVENING.inviteRate);
  const ev2 = createEvening({ phase: 'show' }); ev2.step(1 / 30, { hour: 22.5, sunDeg: -20, x: 0, z: 0 }); assert.equal(ev2.state.phase, 'after');
  ev2.invite(); assert.equal(ev2.state.phase, 'before');
});

test('S5 trip on the real physics: the navigator makes for the spot, the crew stops her and anchors, then weighs and sails on', () => {
  const r = runTrip({ hour: 19.5, minutes: 14, afterAt: 650 });
  assert.deepEqual(r.rec.states, ['sailing', 'stopping', 'anchoring', 'anchored', 'weighing', 'idle']);
  const anch = r.log.filter((l) => l.state === 'anchored');
  assert.ok(anch.length > 100 && anch.every((l) => l.d < 150), `at anchor within ${Math.max(...anch.map((l) => l.d)).toFixed(0)} m of the spot`);
  assert.ok(anch.every((l) => l.furl > 0.95 && l.tackle === 'anchor'), 'the sails down, on the anchor');
  assert.ok(r.rec.minDepth >= 3, `always 3 m of water or more (${r.rec.minDepth.toFixed(1)} m; the keel draws 1.6)`);
  const last = r.log.at(-1);
  assert.ok(Number.isFinite(last.x) && last.state === 'idle' && last.tackle === 'free' && last.furl < 0.05 && last.sog > 1, 'the anchor up, the sails set, sailing on');
});

test('S5 share link: Cruise at anchor on the spot, a minute before the show, the show phase held until the card goes', () => {
  const f0 = parseFlags('?show=fireworks'), f = withFlags(f0, shareOverrides(f0));
  assert.equal(f.mode, 'cruise'); assert.equal(f.fireworks, true); assert.equal(f.start, `${CRUISE_SPOT[0]},${CRUISE_SPOT[1]}`);
  assert.ok(Math.abs(parseFloat(f.heading) - bearingFrom(CRUISE_SPOT)) < 0.1, 'heading for the show');
  assert.ok(Math.abs(SHARE_HEADING - bearingFrom(CRUISE_SPOT, SHOW_CENTRE)) < 0.1);
  assert.ok(Math.abs(parseFloat(f.hour) - shareHour()) < 1e-4 && Math.abs(showTimeAt(parseFloat(f.hour)) + 15) < 0.01, 'show time −15 s: 15 real s before the first riser');
  assert.equal(withFlags(f0, shareOverrides(parseFlags('?show=fireworks&hour=21.8'))).hour, null, 'a capture\'s own hour wins (not overridden)');
  assert.ok(showOn(withFlags(parseFlags('?show=fireworks&fireworks=0'), shareOverrides(f0)), true), 'the link always builds the show');
  assert.equal(decideFirstVisit({ search: '?show=fireworks' }).stage, false, 'no staged first visit: the link lands in Cruise');
  assert.equal(attractSettings('?show=fireworks').on, false, 'no attract: the card waits for Enter');
  // the evening: in the show's phase from the first frame; rate 0 while the card is up, then 4 (show s = real s)
  let up = true; const ev = createEvening({ phase: 'show', held: () => up });
  let hour = parseFloat(f.hour);
  for (let i = 0; i < 90; i++) { const o = ev.step(1 / 30, { hour, sunDeg: -12, x: CRUISE_SPOT[0], z: CRUISE_SPOT[1] }); assert.equal(o.rate, 0); hour += (o.rate / 30) / 3600; }
  up = false;
  for (let i = 0; i < 30 * 20; i++) { const o = ev.step(1 / 30, { hour, sunDeg: -12, x: CRUISE_SPOT[0], z: CRUISE_SPOT[1] }); assert.equal(o.rate, 4); hour += (o.rate / 30) / 3600; }
  assert.ok(Math.abs(showTimeAt(hour) - 5) < 0.05, `20 s after Enter the show is at ${showTimeAt(hour).toFixed(2)} s`);
  // the trip at anchor from the start: the anchor goes down at once (the boat stopped on the spot)
  const trip = createCruiseTrip(); trip.start({ anchored: true });
  assert.equal(trip.step({ x: CRUISE_SPOT[0], z: CRUISE_SPOT[1], sog: 0, u: 0, dt: 1 / 60 }).drop, true);
});

// the finale's star apexes (every aerial of 8" and up from 240 s), as tests/fireworks.test.mjs flies them
function finaleApexes(show, t0 = 240, t1 = 1e9, minInches = 8) {
  const B = bargesWorld(), pts = [];
  for (const e of show.events) {
    if (e.ground || e.t < t0 || e.t >= t1 || e.inches < minInches) continue;
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
function burstCentres(show, t0, t1) {
  const B = bargesWorld(), pts = [];
  for (const e of show.events) {
    if (e.ground || e.t < t0 || e.t >= t1) continue;
    const b = B[e.barge % B.length], ax = b.axis;
    const m = [b.x + (ax[0] * e.jitter[0] - ax[1] * e.jitter[1]) * SCALE, 2.6, b.z + (ax[1] * e.jitter[0] + ax[0] * e.jitter[1]) * SCALE];
    pts.push(fly(m, [e.v0 * e.tilt[0] * SCALE, e.v0 * SCALE, e.v0 * e.tilt[1] * SCALE], 0.0026, e.rise, { scale: SCALE }).p);
  }
  return pts;
}
function screenY(pts, pos, target, fov) {
  const f = target.map((x, i) => x - pos[i]), fl = Math.hypot(...f); f.forEach((_, i) => { f[i] /= fl; });
  const rt = [-f[2], 0, f[0]], rl = Math.hypot(...rt); rt.forEach((_, i) => { rt[i] /= rl; });
  const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]], t = Math.tan(fov * Math.PI / 360);
  const ys = [];
  for (const p of pts) { const d = p.map((x, i) => x - pos[i]), z = dot(d, f); if (z > 0 && Math.abs(dot(d, rt) / z / (t * 16 / 9)) <= 1) ys.push(dot(d, up) / z / t); }
  const h = [f[0] * 5000, -pos[1], f[2] * 5000];
  return { ys: ys.sort((a, b) => a - b), horizon: dot(h, up) / dot(h, f) / t };
}

test('S5 shots: calm and varied, cut only between shots, the finale fits its frame with the water in view', async () => {
  const { heightAt } = await import('../src/sim/terrain.js');
  const boat = { x: CRUISE_SPOT[0] - 30, z: CRUISE_SPOT[1] + 10 };
  assert.ok(new Set(SHOTS.map((s) => s.kind)).size >= 5, 'five kinds or more: wide, the mouth, the reflection, the boat, the kayaks, the finale');
  assert.ok(SHOTS.some((s) => s.at === 'crowd') && SHOTS.some((s) => s.up < 2), 'from the crowd (the spectators) and low over the water');
  assert.equal(showShot(-100, { boat }), null); assert.equal(showShot(SHOW_LENGTH + 13, { boat }), null, 'outside the show: the director\'s own');
  assert.deepEqual(showShot(100, { boat, heightAt }), showShot(100, { boat, heightAt }), 'deterministic');
  // inside a shot the camera only drifts (no shake): under 1 cm a frame at 30 fps; it moves more only at a cut
  let prev = null, cuts = 0;
  for (let t = -60; t < SHOW_LENGTH + 12; t += 1 / 30) {
    const p = showShot(t, { boat, heightAt });
    assert.ok(p.pos[1] >= Math.max(0, heightAt(p.pos[0], p.pos[2])) + 1, `${p.kind} at ${t.toFixed(1)}: over the ground`);
    if (prev) { const d = Math.hypot(...p.pos.map((x, i) => x - prev.pos[i])); if (prev.cut !== p.cut) cuts++; else assert.ok(d < 0.01, `${p.kind} at ${t.toFixed(2)}: ${d.toFixed(3)} m a frame`); }
    prev = p;
  }
  assert.equal(cuts, SHOTS.length - 1);
  // wow round (owner: big and close; "fine if a few of the very biggest leave the top"): every shot holds 90 % of its span's
  // burst centres inside the frame (the biggest overhead may leave), with the water in view
  for (const S of SHOTS) {
    for (const t of S.kind === 'finale' ? [250, 280, 292] : [Math.max(S.from, 0) + 3]) {
      const p = showShot(t, { boat, heightAt }), c = burstCentres(wowShow(makeShow, 1), Math.max(S.from, 0) - 8, S.to);
      const s = screenY(c, p.pos, p.target, p.fov), inside = s.ys.filter((y) => y < 1).length / c.length;
      assert.ok(inside >= 0.9, `${S.kind} at ${t}: ${(inside * 100).toFixed(0)} % of the burst centres in frame`);
      assert.ok(s.horizon < -0.2 && s.horizon > -0.95, `${S.kind}: the horizon at ${s.horizon.toFixed(2)}`);
    }
  }
});

// look round 2 (F2 staging): where each whole burst (its centre and 0.9 of its radius up, left and right) lands in the one-tap
// show's frame (the boat shots, the boat on the spot) → the share that fits and the centres' screen x (−1..1)
function burstFit(show, { aspect, fov = null, pitchAdd }) {
  const B = bargesWorld(), boat = { x: CRUISE_SPOT[0], z: CRUISE_SPOT[1] }, xs = [];
  let n = 0, whole = 0;
  for (const e of show.events) {
    if (e.ground || e.burst < 0) continue;
    const p = showShot(Math.min(e.burst + 0.5, SHOW_LENGTH), { boat, boatOnly: true, pitchAdd }); if (!p) continue;
    const b = B[e.barge % B.length], ax = b.axis;
    const m = [b.x + (ax[0] * e.jitter[0] - ax[1] * e.jitter[1]) * SCALE, 2.6, b.z + (ax[1] * e.jitter[0] + ax[0] * e.jitter[1]) * SCALE];
    const c = fly(m, [e.v0 * e.tilt[0] * SCALE, e.v0 * SCALE, e.v0 * e.tilt[1] * SCALE], 0.0026, e.rise, { scale: SCALE }).p;
    const f = p.target.map((x, i) => x - p.pos[i]), fl = Math.hypot(...f); f.forEach((_, i) => { f[i] /= fl; });
    const rt = [-f[2], 0, f[0]], rl = Math.hypot(...rt); rt.forEach((_, i) => { rt[i] /= rl; });
    const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]], t = Math.tan((fov ?? p.fov) * Math.PI / 360);
    const pr = (q) => { const d = q.map((x, i) => x - p.pos[i]), z = dot(d, f); return [dot(d, rt) / z / (t * aspect), dot(d, up) / z / t]; };
    const R = burstRadius(e.inches) * (e.spread ?? 1) * SCALE * 0.9;
    const x = pr(c)[0], yt = pr(c.map((v, i) => v + up[i] * R))[1], xl = pr(c.map((v, i) => v - rt[i] * R))[0], xr = pr(c.map((v, i) => v + rt[i] * R))[0];
    n++; xs.push(x); if (yt <= 1 && xl >= -1 && xr <= 1) whole++;
  }
  xs.sort((a, b) => a - b);
  return { n, whole: whole / n, x5: xs[Math.floor((n - 1) * 0.05)], x95: xs[Math.floor((n - 1) * 0.95)] };
}
test('look round 2 staging: the bursts are spread across the sky and whole in the frame, on a wide screen and an upright phone', () => {
  const base = fitShow(makeShow(1)), s = spreadShow(base);
  assert.deepEqual(spreadShow(base), s, 'deterministic');
  assert.equal(s.events.length, base.events.length);
  s.events.forEach((e, i) => {
    const o = base.events[i];
    if (o.ground) { assert.deepEqual(e, o, 'ground effects stay as they were'); return; }
    assert.equal(e.t, o.t); assert.equal(e.type, o.type); assert.equal(e.inches, o.inches); assert.equal(e.seed, o.seed);
    // never higher than the frame law's height, never under floor x its own radius (its bottom stars open well over the water)
    const R = burstRadius(e.inches) * (SHELL_SPEC[e.type]?.reach ?? 1) * (e.spread ?? 1);
    assert.ok(e.height <= o.height + 0.01 && e.height >= Math.min(o.height, SPREAD_LAW.floor * R) - 0.01, `${e.type} ${e.inches}" at ${e.t}: ${e.height} m of ${o.height} m, radius ${R.toFixed(0)} m`);
    assert.ok(Math.abs(e.burst - e.t - e.rise) < 1e-3 && e.rise > 0, 'a real riser to the new height');
    // the mortars lean along the barge or away from the viewer, never toward the crowd (no star near the camera)
    const ax = bargesWorld()[e.barge % 2].axis, dt = [e.tilt[0] - o.tilt[0], e.tilt[1] - o.tilt[1]];
    assert.ok(dt[0] * ax[1] - dt[1] * ax[0] >= -1e-3, `${e.type} at ${e.t}: leans toward the viewer`);
    // a falling shell leans away from the boat's mast (MAST_SIDE: the side of the frame she stands on at the burst)
    if (FALLING.has(e.type)) assert.ok(Math.sign(dt[0] * ax[0] + dt[1] * ax[1]) === -MAST_SIDE(e.burst), `${e.type} at ${e.t}: leans toward the mast`);
  });
  // MAST_SIDE is the one-tap show's boat shots' own: the mast stands on that side of the frame's middle in each of them
  for (const S of SHOTS) {
    if (S.at === 'crowd') continue;
    const t = Math.max(S.from, 0) + 2, boat = { x: CRUISE_SPOT[0], z: CRUISE_SPOT[1] }, p = showShot(t, { boat, boatOnly: true, pitchAdd: SHOW_NOW.pitchAdd });
    const f = p.target.map((x, i) => x - p.pos[i]), side = (boat.x - p.pos[0]) * -f[2] + (boat.z - p.pos[2]) * f[0];
    assert.equal(Math.sign(side), MAST_SIDE(t), `${S.kind}: the mast on the ${side > 0 ? 'right' : 'left'}`);
  }
  // shells that follow each other on one barge land apart: the lean changes at every shot
  const leans = s.events.map((e, i) => ({ e, o: base.events[i] })).filter(({ e }) => !e.ground && e.barge % 2 === 0).map(({ e, o }) => Math.hypot(e.tilt[0] - o.tilt[0], e.tilt[1] - o.tilt[1]) * Math.sign((e.tilt[0] - o.tilt[0]) || 1));
  let apart = 0; for (let i = 1; i < leans.length; i++) if (Math.abs(leans[i] - leans[i - 1]) > 0.05) apart++;
  assert.ok(apart / (leans.length - 1) > 0.6, `${apart} of ${leans.length - 1} neighbours lean apart`);
  // the wide screen (16:9, the boat shots' own lens + the one-tap show's pitch)
  const wide = burstFit(wowShow(makeShow, 1), { aspect: 16 / 9, pitchAdd: SHOW_NOW.pitchAdd });
  assert.ok(wide.whole >= 0.97, `wide: ${(wide.whole * 100).toFixed(1)} % of ${wide.n} bursts whole in frame`);
  assert.ok(wide.x5 < -0.3 && wide.x95 > 0.3, `wide: the centres span ${wide.x5.toFixed(2)}..${wide.x95.toFixed(2)} of the half width (round 1: -0.1..0.14)`);
  // an upright phone (390 x 844): the tall layout
  const tall = burstFit(wowShow(makeShow, 1, { tall: true }), { aspect: 390 / 844, fov: SHOW_NOW.portraitFov, pitchAdd: SHOW_NOW.portraitPitchAdd });
  assert.ok(tall.whole >= 0.97, `phone: ${(tall.whole * 100).toFixed(1)} % of ${tall.n} bursts whole in frame`);
  assert.notDeepEqual(SPREAD_TALL, SPREAD_LAW);
});

test('S5 view: from the anchorage both barges are in sight over the terrain, 150 m bursts and up', async () => {
  const { heightAt } = await import('../src/sim/terrain.js');
  for (const b of bargesWorld()) {
    const d = Math.hypot(b.x - CRUISE_SPOT[0], b.z - CRUISE_SPOT[1]);
    let ridge = -90;
    for (let i = 1, n = Math.ceil(d / 8); i < n; i++) { const t = i / n; ridge = Math.max(ridge, Math.atan2(Math.max(0, heightAt(CRUISE_SPOT[0] + (b.x - CRUISE_SPOT[0]) * t, CRUISE_SPOT[1] + (b.z - CRUISE_SPOT[1]) * t)) - 2.5, d * t)); }
    assert.ok(Math.atan2(150 - 2.5, d) > ridge, `barge ${b.bearing}°: a 150 m burst at ${(Math.atan2(147.5, d) * 57.3).toFixed(1)}° over the ridge at ${(ridge * 57.3).toFixed(1)}°`);
  }
  assert.ok(heightAt(...CRUISE_SPOT) < -3 && heightAt(...CRUISE_SPOT) > -20, 'anchoring depth (3–20 m)');
  assert.ok(Math.hypot(CRUISE_SPOT[0] - SILL[0], CRUISE_SPOT[1] - SILL[1]) < 500);
});

test('S5 music: in Cruise the playlist hushes 20 s before the show, "Full Moon" from 75 s; Sail keeps its own plan', () => {
  assert.deepEqual(musicWant({ showT: -30, mode: 'cruise', score: true }), { want: null });
  assert.deepEqual(musicWant({ showT: -10, mode: 'cruise', score: true }), { want: 'hush' });
  assert.deepEqual(musicWant({ showT: 40, mode: 'cruise', score: true }), { want: 'hush' });
  assert.equal(musicWant({ showT: 80, mode: 'cruise', score: true }).want, 'score');
  assert.deepEqual(musicWant({ showT: MUSIC.score.fromShowT + MUSIC.score.lengthS + 1, mode: 'cruise', score: true, hour: 22.1 }), { want: null }, 'then the bus goes back (the playlist returns)');
  assert.deepEqual(musicWant({ showT: 40, mode: 'sail', score: false }), { want: null }, 'Sail: the natural sound');
});

test('wow round: one viewing spot (Cruise\'s anchorage); the mouth\'s carved channel (v2/terrain/channel.js) the keel\'s only way out; the barges 250 m off in deep water inside the bay; patrol boats afloat', async () => {
  const { heightAt } = await import('../src/sim/terrain.js');
  const { VIEW, SILL: S } = await import('../src/fireworks/stage.js');
  const { patrolAngle, BARGE } = await import('../classic/src/fireworks/barges.js');
  assert.deepEqual(VIEW, CRUISE_SPOT, 'Sail, Cruise and the share link share the spot');
  // the mouth: the widest path from the anchorage to the sill on a 10 m grid crosses water under the keel's 1.6 m
  const W = 86, H = 86, X0 = 1250, Z0 = -1650, D = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) D[j * W + i] = -heightAt(X0 + i * 10, Z0 + j * 10);
  const id = (x, z) => Math.round((z - Z0) / 10) * W + Math.round((x - X0) / 10), A = id(...CRUISE_SPOT), B = id(...S);
  const joined = (th) => {
    const seen = new Uint8Array(W * H), q = [A]; seen[A] = 1;
    while (q.length) {
      const k = q.pop(); if (k === B) return true;
      const i = k % W, j = (k / W) | 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const kk = jj * W + ii; if (!seen[kk] && D[kk] >= th) { seen[kk] = 1; q.push(kk); }
      }
    }
    return false;
  };
  // the owner's channel (2026-11-16: the entrance bar carved 4 m deep, a 36 m floor) is the keel's way out; nothing deeper than it
  assert.equal(joined(1.6), true, 'the carved channel takes the 1.6 m keel');
  assert.equal(joined(4.5), false, 'and no water deeper than its 4 m floor crosses the bar');
  for (const b of bargesWorld()) {
    const d = Math.hypot(b.x - VIEW[0], b.z - VIEW[1]);
    assert.ok(d > 230 && d < 280, `barge ${b.bearing}°: ${d.toFixed(0)} m`);
    const { shoreDistance } = await import('../src/sim/terrain.js');
    assert.ok(heightAt(b.x, b.z) < -20 && shoreDistance(b.x, b.z) < -150, 'in deep water, well off the shore');
    const base = Math.atan2(VIEW[0] - b.x, VIEW[1] - b.z);
    for (const s of [-1, 1]) {
      const a = patrolAngle(base, s, b, (x, z) => heightAt(x, z) < -0.5);
      assert.ok(heightAt(b.x + Math.sin(a) * BARGE.zone, b.z + Math.cos(a) * BARGE.zone) < -0.5, 'the patrol boat floats');
    }
  }
});
