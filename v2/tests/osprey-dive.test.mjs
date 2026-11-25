// The osprey's dive as a hero beat (BACKLOG #24; owner, 2026-11-17: "I never once saw a bird dive for fish"): the director in
// v2/sim/birds.js (DIVE, placeDive) on v1's real lake (src/sim/terrain.js), a boat sailing on with no input and its follow
// camera, Tessie's first sighting and the kayak pair's beat as the page reports them; the splash and the rings
// (v2/living/birds-splash.js) from the strike's own events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { makeTerrain } from './helpers/ground.mjs';
import { createBirdSim, placeDive, DIVE } from '../sim/birds.js';
import { createBirdWaterFx, BIRD_SPLASH } from '../living/birds-splash.js';
import { createStageDirector, STAGE } from '../stage/director.js';
import { ACTS, actById } from '../stage/acts.js';
import { makeHandle } from '../stage/handle.js';

const T = makeTerrain();
const DEG = Math.PI / 180;
const H_HALF = Math.atan(Math.tan(20 * DEG) * 16 / 9);   // the follow camera's 40° lens at 16:9
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Tessie's act as the stage sees it: on stage 28 s from its start (her ~25 s sighting: 21–49 s at the opening)
const fakeTessie = { ...actById('tessie'), feature: null, load: null, start: () => { let t = 0; return makeHandle({ step(dt, h) { t += dt; if (t >= 28) h.finish('played'); } }); } };
// a no-input session: the boat sails on at 2.75 m/s (bearing away from shoal water as the pilot's assist does), the follow
// camera 32 m behind her (or the helm's eye on her). When the dive comes is the stage director's (v2/stage/director.js): the
// dive's act, with Tessie's (fake: on stage 28 s) unless tessie is false; tessieAt moves her opening
function session({ seed = 1, seconds = 600, heading = 251, helm = false, tessie = true, tessieAt = null, busy = () => false, race = () => false, sun = () => 40, onFrame = null, dt = 1 / 30 } = {}) {
  const boat = { x: 1200, z: -1050, heading: heading * DEG, sog: 2.75 };
  const B = createBirdSim({ terrain: T, seed, boat: () => boat });
  const h = B.find('hunter');
  const out = { B, h, strikes: [], hovers: [], frames: [] };
  let beat = null, now = 0;
  const acts = [...(tessie ? [fakeTessie] : []), actById('ospreyDive')];
  out.stage = createStageDirector({ acts, seed, ctx: { birds: { sim: B }, beat: () => beat }, race: () => race(now), busy: () => (busy(now) ? 'kayaks' : null), overrides: tessieAt ? { tessie: { atS: tessieAt } } : {} });
  for (let t = 0; t <= seconds; t += dt) {
    now = t;
    const ax = boat.x + Math.sin(boat.heading) * 80, az = boat.z - Math.cos(boat.heading) * 80;
    if (T.heightAt(ax, az) > -4) boat.heading += 3 * DEG * dt;
    boat.x += Math.sin(boat.heading) * boat.sog * dt; boat.z -= Math.cos(boat.heading) * boat.sog * dt;
    const back = helm ? 0 : 32;
    const cam = [boat.x - Math.sin(boat.heading) * back, helm ? 2.2 : 6, boat.z + Math.cos(boat.heading) * back];
    B.setDaylight(sun(t), [0.3, 0.8, 0.2]);
    beat = { playing: true, view: { x: cam[0], z: cam[2], y: cam[1], yaw: boat.heading, hHalf: H_HALF }, race: race(t) };
    out.stage.step(dt, { playing: true });
    B.update(t, cam, beat);
    const ang = (x, z) => wrap(Math.atan2(x - cam[0], -(z - cam[2])) - boat.heading);
    if (h.state.phase === 'hover') out.hovers.push({ t, ang: ang(h.pos[0], h.pos[2]), d: Math.hypot(h.pos[0] - cam[0], h.pos[1] - cam[1], h.pos[2] - cam[2]) });
    for (const e of B.events) if (e.kind === 'plunge') {
      const fromBow = wrap(Math.atan2(e.pos[0] - boat.x, -(e.pos[2] - boat.z)) - boat.heading);
      out.strikes.push({ t, ang: ang(e.pos[0], e.pos[2]), fromBow: Math.abs(fromBow) / DEG, dBoat: Math.hypot(e.pos[0] - boat.x, e.pos[2] - boat.z), dCam: Math.hypot(e.pos[0] - cam[0], e.pos[2] - cam[2]), dCam3: Math.hypot(e.pos[0] - cam[0], cam[1], e.pos[2] - cam[2]) });
    }
    onFrame?.(t, B, out);
  }
  return out;
}

const endOf = (stage, id) => stage.timeline.find((e) => e.id === id && e.ev === 'end')?.t;

test('reach: the first dive about 95 s into a no-input session (the stage\'s opening), after Tessie, struck and hovered in the camera\'s view, 45–70 m from it', () => {
  for (const [seed, heading] of [[1, 251], [3, 30], [5, 200]]) {
    const s = session({ seed, heading, seconds: 140 });
    assert.ok(s.strikes.length >= 1, `seed ${seed}: a strike`);
    const f = s.strikes[0];
    assert.ok(f.t >= 85 && f.t <= 110, `seed ${seed}: the first strike at ${f.t.toFixed(1)} s`);
    assert.ok(Math.abs(f.ang) < H_HALF, `seed ${seed}: the strike in the view (${(f.ang / DEG).toFixed(1)}°)`);
    assert.ok(f.dCam3 >= 42 && f.dCam3 <= 74, `seed ${seed}: ${f.dCam3.toFixed(0)} m from the camera`);
    assert.ok(f.fromBow >= 18 && f.fromBow <= 45, `seed ${seed}: ${f.fromBow.toFixed(0)}° off the bow`);
    const hv = s.hovers.filter((x) => x.t < f.t);
    assert.ok(hv.length > 60, 'a hover of 2 s or more before it');
    assert.ok(hv.every((x) => Math.abs(x.ang) < H_HALF && x.d >= 40 && x.d <= 85), 'the whole hover in the view (it slows in from ≤ 82 m), never under the 40 m floor');
    assert.ok(hv.at(-1).d >= 43 && hv.at(-1).d <= 72, `the hover's point close (owner: "Allow close dive"): ${hv.at(-1).d.toFixed(0)} m`);
    const d = s.B.director.dives[0];
    assert.ok(d.cueAt >= endOf(s.stage, 'tessie') + STAGE.GAP_S - 0.1, `never over Tessie's sighting, with the stage's gap after it (${d.cueAt})`);
  }
});

test('reach: the helm view sees it too (the camera on the boat)', () => {
  const s = session({ seed: 2, heading: 251, seconds: 130, helm: true });
  assert.ok(s.strikes.length >= 1 && Math.abs(s.strikes[0].ang) < H_HALF, 'struck in the helm\'s view');
  assert.ok(s.hovers.every((x) => x.d >= 40 && x.d <= 85) && s.hovers.at(-1).d <= 72, 'the hover close to the helm, never under 40 m');
});

test('cadence: then the random pool after its cooldown (each in view); v1\'s random dives are off while staged', () => {
  const s = session({ seed: 4, seconds: 600, tessie: false });
  const cool = actById('ospreyDive').random.cooldownS;
  assert.ok(s.strikes.length >= 3 && s.strikes.length <= 7, `${s.strikes.length} strikes in 10 min`);
  for (let i = 1; i < s.strikes.length; i++) {
    const gap = s.strikes[i].t - s.strikes[i - 1].t;
    assert.ok(gap >= cool && gap <= cool + STAGE.RANDOM_S[1] + 60, `gap ${gap.toFixed(0)} s`);
  }
  assert.ok(s.strikes.every((x) => Math.abs(x.ang) < H_HALF), 'every strike in the view');
  assert.equal(s.strikes.length, s.B.director.dives.filter((d) => d.strikeAt != null).length, 'every strike is a directed one');
});

test('no overlap: a kayak pair\'s beat holds it, Tessie first in the opening order; a dive under way is on stage', () => {
  // the kayak pair near the boat from 75 s to 100 s: the due cue waits (the stage's busy wait), then goes
  const k = session({ seed: 1, seconds: 150, busy: (t) => t > 75 && t < 100 });
  assert.ok(k.B.director.dives[0].cueAt >= 100 - 0.1 && k.B.director.dives[0].cueAt < 112, `cued at ${k.B.director.dives[0].cueAt}`);
  // Tessie's break at 110 s (106–134 s on stage): the dive comes after her and the stage's gap
  const ts = session({ seed: 1, seconds: 220, tessieAt: 110 });
  const d = ts.B.director.dives[0];
  assert.ok(d.cueAt >= endOf(ts.stage, 'tessie') + STAGE.GAP_S - 0.1, `cued at ${d.cueAt}, after Tessie`);
  // while the dive runs, the sim says so (the act stays on stage)
  let busyFrames = 0, during = 0;
  session({ seed: 1, seconds: 130, onFrame: (t, B, o) => { if (B.diveBusy) busyFrames++; if (o.h.state.phase === 'stoop' && B.diveBusy) during++; } });
  assert.ok(busyFrames > 30 * 8 && during > 0, 'busy from the cue through the strike');
});

test('never in a race (and a gap after it), never at night or in the storm\'s shelter', () => {
  const r = session({ seed: 1, seconds: 170, tessie: false, race: (t) => t < 100 });
  assert.ok(r.strikes.length >= 1 && r.strikes.every((x) => x.t > 100 + STAGE.RACE_GAP_S), 'none in the race or its gap');
  const n = session({ seed: 1, seconds: 150, sun: () => -6 });
  assert.equal(n.strikes.length, 0, 'none at night');
});

test('placement: 25–40° off the bow, 45–70 m from the camera, in the predicted view, over deep water, a bright background first; null with no water in view', () => {
  const boat = { x: 1200, z: -1050, heading: 251 * DEG, sog: 2.75 };
  const cam = { x: boat.x - Math.sin(boat.heading) * 32, z: boat.z + Math.cos(boat.heading) * 32, yaw: boat.heading, hHalf: H_HALF };
  const p = placeDive({ boat, view: cam, wind: [2, -3], terrain: T });
  assert.ok(p && p.bear >= 25 && p.bear <= 40 && p.camS >= 45 && p.camS <= 70 && p.camH >= 45 && p.camH <= 70, JSON.stringify(p));
  assert.ok(['water', 'sky', 'haze', 'land'].includes(p.bg));
  assert.ok(T.heightAt(p.strike[0], p.strike[1]) < -DIVE.depth, 'deep water under the strike');
  assert.ok(Math.hypot(p.from[0] - boat.x, p.from[2] - boat.z) > p.R, 'sent in from beyond the hover');
  // a camera looking well down (the home card's idle camera): only spots inside its vertical frame, or none
  const steep = placeDive({ boat, view: { ...cam, y: 30, pitch: -35 * DEG, vHalf: 20 * DEG }, wind: [2, -3], terrain: T });
  if (steep) { const el = Math.atan2(-30, Math.hypot(steep.strike[0] - cam.x, steep.strike[1] - cam.z)) / DEG; assert.ok(Math.abs(el + 35) < 20 * DIVE.viewK, `strike at ${el.toFixed(1)}°`); }
  const level = placeDive({ boat, view: { ...cam, y: 6, pitch: -3 * DEG, vHalf: 20 * DEG }, wind: [2, -3], terrain: T });
  assert.ok(level, 'a level camera finds a spot');
  const ashore = placeDive({ boat: { x: 0, z: 2000, heading: 0, sog: 0 }, view: { x: 0, z: 2032, yaw: 0, hHalf: H_HALF }, terrain: { heightAt: () => 50 } });
  assert.equal(ashore, null);
});

test('close: the staged diver keeps its 45–70 m (the soft keep-away does not push it out), never under the 40 m floor', () => {
  let minD = Infinity, maxStrike = 0;
  const s = session({ seed: 2, heading: 120, seconds: 130 });
  for (const x of s.hovers) minD = Math.min(minD, x.d);
  for (const x of s.strikes) maxStrike = Math.max(maxStrike, x.dCam3);
  assert.ok(minD >= 40 - 1e-6, `the floor: ${minD.toFixed(1)} m`);
  assert.ok(s.strikes.length && maxStrike <= 72, `struck ${maxStrike.toFixed(0)} m from the camera`);
  const d = s.B.director.dives[0];
  assert.ok(['water', 'sky', 'haze', 'land'].includes(d.bg) && d.camH >= 45 && d.camH <= 70, JSON.stringify(d));
});

test('impact: the strike throws its burst and starts the rings and the foam patch; the lift and the slaps add theirs; then nothing (0 ms)', () => {
  const fx = createBirdWaterFx({ seed: 1 });
  const s = session({ seed: 1, seconds: 130, onFrame: (t, B) => { for (const e of B.events) fx.emit(e); fx.step(1 / 30); } });
  const strike = s.strikes[0];
  assert.ok(fx.stats.strikes === 1 && fx.stats.lifts === 1 && fx.stats.slaps >= 2 && fx.stats.shakes >= 5, JSON.stringify(fx.stats));
  // the strike's frame on its own
  const g = createBirdWaterFx({ seed: 2 });
  g.emit({ kind: 'plunge', species: 'osprey', pos: [10, 0, 20], gain: 1 });
  g.step(1 / 60);
  assert.ok(g.count > 200, `the burst: ${g.count} droplets`);
  const src = g.sources();
  assert.deepEqual(src.rings[0].slice(0, 2), [10, 20], 'a ring at the strike');
  assert.ok(src.contacts.length === 1 && src.contacts[0][2] > 0.3, 'the foam patch where it sits');
  assert.deepEqual(g.centre, [10, 20]);
  for (let i = 0; i < 30; i++) g.step(1 / 60);
  assert.ok(g.sources().rings.length === 2, 'the second ring 0.35 s on');
  let tallest = 0; for (let i = 0; i < 40; i++) { g.step(1 / 60); for (const d of g.sim.P) tallest = Math.max(tallest, d.y); }
  assert.ok(tallest > 0.8 && tallest < 1.6, `the spout rises ${tallest.toFixed(2)} m`);
  for (let i = 0; i < 60 * (BIRD_SPLASH.ringLife + 1); i++) g.step(1 / 60);
  assert.equal(g.live, false, 'all settled: nothing to step, write or draw');
  // other birds' events leave the osprey's water alone
  const o = createBirdWaterFx({ seed: 3 }); o.emit({ kind: 'wingslap', species: 'goose', pos: [0, 0, 0] }); assert.equal(o.live, false);
  assert.ok(strike.t > 60);
});

test('the one entry: startDive({ view }) places a dive in the view at once (a stage director\'s handle); one at a time', () => {
  const boat = { x: 1200, z: -1050, heading: 251 * DEG, sog: 2.75 };
  const B = createBirdSim({ terrain: T, seed: 1, boat: () => boat });
  B.setDaylight(40, [0.3, 0.8, 0.2]);
  const cam = [boat.x - Math.sin(boat.heading) * 32, 6, boat.z + Math.cos(boat.heading) * 32];
  const view = { x: cam[0], z: cam[2], y: 6, yaw: boat.heading, hHalf: H_HALF };
  const beat = { playing: true, view, busy: () => false, tessie: () => null };
  B.update(0, cam, beat);
  const d = B.startDive({ view });
  assert.ok(d && d.bear >= 25 && d.bear <= 40 && d.R >= 14 && d.R <= 110 && B.diveBusy);
  assert.equal(B.startDive({ view }), null, 'one dive at a time');
  let struck = null;
  for (let t = 1 / 30; t < 20 && !struck; t += 1 / 30) { boat.x += Math.sin(boat.heading) * boat.sog / 30; boat.z -= Math.cos(boat.heading) * boat.sog / 30; const c = [boat.x - Math.sin(boat.heading) * 32, 6, boat.z + Math.cos(boat.heading) * 32]; B.update(t, c, { ...beat, view: { ...view, x: c[0], z: c[2] } }); if (B.events.some((e) => e.kind === 'plunge')) struck = t; }
  assert.ok(struck > 8 && struck < 16, `struck ${struck?.toFixed(1)} s after the start`);
});

test('desktop only (owner, 2026-11-17): with the dive off (a phone, a tablet, L3: the registry\'s ospreyDive) the osprey never dives, not even v1\'s own random dive', () => {
  const boat = { x: 1200, z: -1050, heading: 251 * DEG, sog: 2.75 };
  for (const beat of [true, false]) {
    const B = createBirdSim({ terrain: T, seed: 1, boat: () => boat, dive: false });
    B.setDaylight(40, [0.3, 0.8, 0.2]);
    let plunges = 0;
    for (let t = 0; t <= 600; t += 1 / 20) {
      boat.x += Math.sin(boat.heading) * boat.sog / 20; boat.z -= Math.cos(boat.heading) * boat.sog / 20;
      const ax = boat.x + Math.sin(boat.heading) * 80, az = boat.z - Math.cos(boat.heading) * 80; if (T.heightAt(ax, az) > -4) boat.heading += 3 * DEG / 20;
      const cam = [boat.x - Math.sin(boat.heading) * 32, 6, boat.z + Math.cos(boat.heading) * 32];
      B.update(t, cam, beat ? { playing: true, view: { x: cam[0], z: cam[2], yaw: boat.heading, hHalf: H_HALF }, busy: () => false, tessie: () => null } : null);
      plunges += B.events.filter((e) => e.kind === 'plunge').length;
    }
    assert.equal(plunges, 0, beat ? 'no staged dive' : 'no random dive');
    assert.equal(B.director.count, 0);
  }
});

test('cost: the splash\'s CPU step stays under 0.1 ms a frame while it splashes', () => {
  const fx = createBirdWaterFx({ seed: 1 });
  fx.emit({ kind: 'plunge', species: 'osprey', pos: [0, 0, 0], gain: 1 });
  for (let i = 0; i < 30; i++) fx.step(1 / 60);   // warm
  const t0 = performance.now(); let n = 0;
  for (; n < 300; n++) { fx.step(1 / 60); fx.sources(); }
  const ms = (performance.now() - t0) / n;
  budget(ms, 0.1, 'the splash step a frame');
});
