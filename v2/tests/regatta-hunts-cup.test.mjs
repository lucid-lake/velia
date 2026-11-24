// Regatta's place races, phase 2 (part 2: Sail the cup, the hunts, the shortcut, the Tessie look) (4.4, 4.6, 4.7, 4.8; owner go 2026-11-19 with every default): the registry's new
// rows, Glass Boat Chase (the glass boat held at her stop, her wash, the catch), Storm Run (the storm at the gun, the gust band, a rival
// knocked down), Lights on the Lake (the show's hour), the hunts (the corners' rules, the store, the counts), Sail the cup (the series'
// points), the rivals' Tea House shortcut (and the shelf's grounding), the camera's look toward Tessie (bounded, smooth, returns, none
// under Reduce Motion); the new races sailed to the finish on the real BoatPhysics by the scripted sailor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { makeTerrain } from './helpers/ground.mjs';
import { listCups, raceInfo, placeCourse, placeHand, hasFrom, cupAt, CUPS } from '../sim/racePlaces.js';
import { createRegattaSession, SHORTCUT, AGROUND } from '../regatta/session.js';
import { FleetRival, skillFor } from '../regatta/fleet.js';
import { washAt, createChaseWatch, WASH } from '../regatta/glassChase.js';
import { stormPlan, rivalKnockDue, STORM_RUN } from '../regatta/stormRun.js';
import { createTessieLook, LOOK } from '../regatta/tessieLook.js';
import { createHunts, HUNTS, huntCounts, loadHunts, HUNTS_KEY } from '../regatta/hunts.js';
import { newPlaceCup, recordPlaceRace, placeCupState, placesOf, PLACE_CUP } from '../regatta/placeCup.js';
import { createTourBoat } from '../sim/tourBoat.js';
import { createRegatta } from '../regatta/index.js';
import { createBoatSim, waterFor } from '../sim/boat.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const T = makeTerrain({ seed: 1 }), depthAt = (x, z) => -T.heightAt(x, z);

// a place race sailed to the finish (as regatta-places.test.mjs's sail): the player under the fleet's own mind, rivals on the same physics;
// each(S, t) runs every tick (the glass boat's post, the hazard)
function sail(id, { dir, speedMs = 6, tier = 'hard', maxS = 900, each = null, rivals = null, seed = 3, helper = false } = {}) {
  const course = placeCourse(id, dir);
  const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 }), ctl = { ...CONTROLS };
  const S = createRegattaSession({ course, me: { phys }, rivals: rivals ?? raceInfo(id).rivals, windAt, depthAt, seed, pace: 2, helper, round: 'club', tier: 'medium', onPlace: (p) => Object.assign(phys, new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed })) });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const env = { t: 0, windAt: S.meWind };
  const auto = new FleetRival({ course, tier, skill: skillFor(tier, 'tern'), seed: 11, windAt: S.meWind, vessel: phys.vessel });
  const ev = [];
  let t = 0;
  for (; t < maxS; t += DT) {
    const v = S.race.view('me');
    if (S.helper) S.helperTick(ctl, t); else auto.update(DT, phys.state, ctl, { t, clock: S.race.clock, view: v, line: course.line });
    env.t = t; phys.step(DT, ctl, env);
    each?.(S, t, phys);
    S.advanceTo(t + DT);
    ev.push(...S.drain());
    if (v.status === 'finished') break;
  }
  return { S, ev, course, phys };
}

// ---- the engine in node (regatta-places.test.mjs's engine): the page's hooks called by the race ----
function engine({ dir = 200, flags = {}, storm = null, glass = null, tessie = null, has = null, reduced = false, store = mem() } = {}) {
  const wind = { pattern: null, base: { dirDeg: dir, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', autoplay: '1', autotier: 'hard', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true,
    onSalute: () => true, tessie: () => tessie, glassBoat: () => glass, onStorm: (o) => storm?.(o) ?? false, has, reduced: () => reduced });
  return { R, B, hour: () => hour };
}
const sailTo = (R, f, maxS = 700, each = null) => { for (let s = 0; s < maxS && !f(); s += 2) { R.settle(2); each?.(); } return f(); };

test('Sail the cup: the cup\'s races back to back with one fleet, low points, the standings after each, the cup\'s result after the last', async () => {
  // the series' arithmetic
  let pc = newPlaceCup('emerald-bay', ['tea-house-run', 'tessies-deep', 'glass-boat-chase'], 1);
  pc = recordPlaceRace(pc, placesOf(['wren', 'me', 'tern', 'kestrel', 'heron'], {}));
  pc = recordPlaceRace(pc, placesOf(['me', 'wren', 'tern', 'heron', 'kestrel'], {}));
  let st = placeCupState(pc);
  assert.deepEqual([st.raceN, st.of, st.next, st.done], [3, 3, 'glass-boat-chase', false]);
  assert.deepEqual(st.rows.slice(0, 2).map((r) => [r.id, r.pts]), [['me', 3], ['wren', 3]], 'a tie on 3 points');
  assert.equal(st.rows[0].id, 'me', 'the tie to the boat with the better places (a win), then the last race');
  pc = recordPlaceRace(pc, placesOf(['tern', 'wren', 'kestrel', 'heron', 'me'], { me: false }));
  st = placeCupState(pc);
  assert.equal(st.done, true); assert.equal(st.rows.find((r) => r.id === 'me').pts, 3 + 6, 'a DNF scores the fleet + 1');
  assert.equal(recordPlaceRace(pc, placesOf(['me'], {})), pc, 'a finished series takes no more');
  // the engine: Sail the cup from the hub sails the first race with the series' fleet; the results card's Next race › the next
  const store = mem(), G = createTourBoat({ depthAt, hour: 15, seed: 1 });
  const { R } = engine({ store, glass: G, has: (f) => f !== 'tessie' });   // no Tessie: the cup is Tea House Run, Glass Boat Chase
  await R.enter({ hub: true, deal: true });
  R.cupSail('emerald-bay');
  assert.equal(R.placeRace.id, 'tea-house-run'); assert.equal(R.session.rivals.length, PLACE_CUP.rivals);
  assert.deepEqual(R.placeCup.races, ['tea-house-run', 'glass-boat-chase']);
  assert.ok(sailTo(R, () => !!R.stats.result, 900), JSON.stringify(R.state().me));
  assert.deepEqual([R.stats.placeCup.sailed, R.stats.placeCup.of, R.stats.placeCup.done], [1, 2, false]);
  R.cupNext();
  assert.equal(R.placeRace.id, 'glass-boat-chase'); assert.equal(R.hand.placeCup.i, 1); assert.equal(R.session.rivals.length, PLACE_CUP.rivals);
  R.cupNew();
  assert.equal(R.placeRace.id, 'tea-house-run', 'Start a new Cup: the series again'); assert.equal(R.placeCup.results.length, 0);
});

test('hunts: eight corners a cup; each rule found by sailing there, once, kept with its day; the counts, the chart and the Logbook\'s page', () => {
  assert.deepEqual(HUNTS.map((h) => [h.id, h.cup, h.corners.length]), [['chart-the-bay', 'emerald-bay', 8], ['chart-the-mouth', 'the-mouth', 8]]);
  const store = mem(), H = createHunts({ store, day: () => '2026-11-20' }), got = [];
  H.onChange((f) => got.push(...f.map((c) => c.id)));
  const at = (x, z, o = {}) => ({ x, z, heading: 0, sog: 2, twaDeg: 90, windLevel: 3, depth: 10, sunElevDeg: 30, bino: null, moored: false, engine: false, tessie: null, glass: null, ...o });
  assert.deepEqual(H.step(at(0, -400), 0.2), [], 'nothing in open water');
  assert.deepEqual(H.step(at(-856 + 300, 171), 0.2).map((c) => c.id), ['falls', 'stonehouse'].filter((id) => id === 'falls' || Math.hypot(-556 + 549, 171 - 217) <= 320));
  // the sweep round the island: 300° within 260 m (either way round)
  for (let a = 0; a <= 310; a += 10) H.step(at(Math.cos(a * Math.PI / 180) * 200, Math.sin(a * Math.PI / 180) * 200), 0.2);
  assert.ok(H.found('round'));
  // the tea house in the glasses for a second (aimed within 3°), not a glance
  const eye = { x: 300, y: 3, z: 300 }, f = [2 - 300, 12 - 3, 0 - 300], bino = { ...eye, fx: f[0], fy: f[1], fz: f[2] };
  H.step(at(300, 300, { bino }), 0.5); assert.equal(H.found('teahouse'), null, 'half a second');
  H.step(at(300, 300, { bino }), 0.6); assert.ok(H.found('teahouse'));
  // a ball under sail (engine off), not with the engine on
  H.step(at(400, -576, { moored: true, engine: true }), 0.2); assert.equal(H.found('ball'), null);
  H.step(at(400, -576, { moored: true }), 0.2); assert.ok(H.found('ball'));
  H.step(at(300, -130, { depth: 61 }), 0.2); assert.ok(H.found('deep'));
  H.step(at(100, 100, { tessie: { x: 150, z: 120 } }), 0.2); assert.ok(H.found('tessie'));
  for (let i = 0; i < 9; i++) H.step(at(0, -300, { glass: { x: 20, z: -300, fast: false } }), 1); assert.equal(H.found('glass'), null, '9 s alongside');
  H.step(at(0, -300, { glass: { x: 20, z: -300, fast: false } }), 1.1); assert.ok(H.found('glass'));
  assert.equal(H.counts()['chart-the-bay'].found, 8, JSON.stringify(H.chart().filter((c) => c.hunt === 'chart-the-bay' && !c.found).map((c) => c.id)));
  // the mouth: the channel's gates out (red to port), the barges at night, a surf run, the points, deep water, the glass boat on the lake
  const path = [[1300, -950], [1440, -1075], [1535, -1160], [1585, -1245], [1650, -1315]];
  for (let i = 1; i < path.length; i++) for (let k = 0; k <= 20; k++) H.step(at(path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k / 20, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k / 20), 0.1);
  assert.ok(H.found('buoys') && H.found('narrows') && H.found('emerald'), JSON.stringify(H.counts()));
  H.step(at(2512, -1700, { sunElevDeg: 10 }), 0.2); assert.equal(H.found('barges'), null, 'by day');
  H.step(at(2512, -1700, { sunElevDeg: -8 }), 0.2); assert.ok(H.found('barges'));
  for (let i = 0; i < 10; i++) H.step(at(2000, -1500, { windLevel: 4, twaDeg: 160, sog: 4 }), 2.1);
  assert.ok(H.found('surf'));
  H.step(at(1850, -1330), 0.2); assert.ok(H.found('eagle'));
  H.step(at(2600, -1800, { depth: 351 }), 0.2); assert.ok(H.found('deep300'));
  H.step(at(2250, -1650, { glass: { x: 2300, z: -1700, fast: false } }), 0.2); assert.equal(H.found('glasslake'), null, 'only out on her lake loop');
  H.step(at(2250, -1650, { glass: { x: 2300, z: -1700, fast: true } }), 0.2); assert.ok(H.found('glasslake'));
  assert.deepEqual(H.counts(), { 'chart-the-bay': { found: 8, of: 8 }, 'chart-the-mouth': { found: 8, of: 8 } });
  assert.equal(got.length, 16, 'each corner announced once');
  // kept: a new tracker on the same store has them, with the day; the Logbook's page and the chart read them
  const H2 = createHunts({ store });
  assert.equal(H2.found('falls'), '2026-11-20'); assert.equal(Object.keys(loadHunts(store)).length, 16);
  const pg = H2.pages(); assert.deepEqual(pg.map((p) => [p.name, p.found, p.of]), [['Chart the Bay', 8, 8], ['Chart the Mouth', 8, 8]]);
  assert.ok(pg[0].rows.every((r) => r.foundAt === '2026-11-20' && r.clue));
  const H3 = createHunts({ store: mem() });
  assert.ok(H3.chart().every((c) => !c.found && c.line === HUNTS.flatMap((h) => h.corners).find((k) => k.id === c.id).clue), 'unfound corners carry their clue');
  const bad = mem(); bad.setItem(HUNTS_KEY, '{nope'); assert.deepEqual(loadHunts(bad), {});
});

test('Tea House Run: some rivals cut inside the shelf; a keel on it grounds (stopped a few seconds), then sails on', () => {
  const course = placeCourse('tea-house-run', 200);
  const takers = [];
  for (let seed = 1; seed <= 8; seed++) {
    const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
    const S = createRegattaSession({ course, me: { phys }, rivals: 4, windAt: steadyWind(6, 200), depthAt, seed, pace: 2, round: 'club', tier: 'hard' });
    takers.push(S.rivals.filter((r) => r.brain.shortcut).length);
  }
  const all = takers.reduce((a, b) => a + b, 0);
  assert.ok(all > 0 && all < 32, `sometimes: ${takers}`);
  assert.ok(SHORTCUT.share.pro > SHORTCUT.share.easy, 'the better rivals more often');
  // the shortcut sailed: a rival bound for the shelf steers for its via point; a keel in under 1.75 m grounds
  const { S } = sail('tea-house-run', { dir: 200, maxS: 150, rivals: 2, seed: 5, each: (S2) => {
    const r = S2.rivals[0];
    if (!r.brain.shortcut) r.brain.shortcut = { mark: 'M1', via: [...course.shortcut.via], done: false };
  } });
  const r0 = S.rivals[0];
  assert.ok((r0.brain.shortcutS ?? 0) > 5 || r0.brain.shortcut.done, 'she took the shortcut');
  // put a rival on the shelf: aground, held, her way gone; then free again
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S3 = createRegattaSession({ course, me: { phys }, rivals: 2, windAt: steadyWind(6, 200), depthAt: (x, z) => (Math.hypot(x + 100, z) < 30 ? 1 : 20), seed: 2, pace: 2, round: 'club' });
  Object.assign(phys, new BoatPhysics({ x: S3.me0.x, z: S3.me0.z, heading: S3.me0.heading, speed: S3.me0.speed }));
  for (let t = 0; t < 40 && S3.race.view(S3.rivals[0].id).status !== 'racing'; t += DT) { phys.step(DT, { ...CONTROLS }, { t, windAt: S3.meWind }); S3.advanceTo(t + DT); S3.drain(); }
  const b = S3.rivals[0]; Object.assign(b.phys, new BoatPhysics({ x: -100, z: 0, heading: 0, speed: 3, vessel: b.phys.vessel }));
  S3.tick(); const e = S3.drain();
  assert.ok(e.some((x) => x.type === 'aground' && x.id === b.id), JSON.stringify(e.map((x) => x.type)));
  assert.equal(S3.aground(b.id), true);
  for (let i = 0; i < 120; i++) S3.tick();
  assert.ok(b.phys.state.u < 0.6, `her way gone on the shelf: ${b.phys.state.u.toFixed(2)}`);
  for (let i = 0; i < (AGROUND.holdS * 60); i++) S3.tick();
  assert.equal(S3.aground(b.id), false, 'free again after the hold');
});

test('the camera\'s look toward Tessie: bounded, smooth (never a snap), returns after the strike, none under Reduce Motion', () => {
  const L = createTessieLook();
  const pose = { pos: [0, 7.5, 24], target: [0, 0, -30], fov: 50 };   // the follow eye behind a boat at (0, 0) heading north
  const boat = [0, 0], her = [120, -40];   // off the starboard bow, 126 m
  const yaws = [];
  for (let t = 0; t < 8; t += 1 / 60) { L.step(1 / 60, pose, { active: t < 4, boat, target: her }); yaws.push(L.yawDeg); }
  const max = Math.max(...yaws.map(Math.abs));
  assert.ok(max > 15 && max <= LOOK.maxDeg + 1e-9, `turned toward her, bounded: ${max.toFixed(1)}°`);
  for (let i = 1; i < yaws.length; i++) assert.ok(Math.abs(yaws[i] - yaws[i - 1]) <= LOOK.maxDegS / 60 + 1e-9, `smooth at frame ${i}`);
  assert.ok(Math.abs(yaws.at(-1)) < 1.5, `back after the strike: ${yaws.at(-1).toFixed(2)}°`);
  // the turn is toward her side, about the boat: the eye keeps its height and distance
  const L2 = createTessieLook(); let p = pose;
  for (let t = 0; t < 3; t += 1 / 60) p = L2.step(1 / 60, pose, { active: true, boat, target: her });
  assert.ok(p.target[0] > 0, 'toward her (east)'); assert.equal(p.pos[1], 7.5);
  assert.ok(Math.abs(Math.hypot(p.pos[0], p.pos[2]) - Math.hypot(0, 24)) < 1e-6);
  // the same at 30 fps and at 120 fps (rates per second)
  const at = (fps) => { const L3 = createTessieLook(); for (let t = 0; t < 1.5; t += 1 / fps) L3.step(1 / fps, pose, { active: true, boat, target: her }); return L3.yawDeg; };
  assert.ok(Math.abs(at(30) - at(120)) < 2, `${at(30).toFixed(2)} vs ${at(120).toFixed(2)}`);
  // Reduce Motion: no look; a strike far from the boat: no look
  const R = createTessieLook(); for (let t = 0; t < 3; t += 1 / 60) assert.equal(R.step(1 / 60, pose, { active: true, boat, target: her, reduced: true }), pose);
  const F = createTessieLook(); for (let t = 0; t < 3; t += 1 / 60) F.step(1 / 60, pose, { active: true, boat, target: [900, 0] }); assert.equal(F.yawDeg, 0);
});

test('engine: Tessie\'s Deep turns the race camera toward her strike near the player and back; under Reduce Motion it never turns', async () => {
  for (const reduced of [false, true]) {
    const st = { visible: false, centre: [0, 0], t: 0, phase: 'idle' };
    const sim = { state: st, riseUnder: (x, z) => { st.visible = true; st.phase = 'swim'; st.centre = [x, z]; }, hunt() {}, swimTo() {}, play: (n) => { if (n === 'dive') { st.visible = false; st.phase = 'idle'; } } };
    const { R, B } = engine({ tessie: { sim, raceCue() {} }, reduced });
    await R.enter({ hub: true, deal: true });
    R.racePlace('tessies-deep');
    let maxYaw = 0;
    const cam = () => { const q = B.phys.state, base = { pos: [q.x - Math.sin(q.heading) * 24, 7.5, q.z + Math.cos(q.heading) * 24], target: [q.x + Math.sin(q.heading) * 30, 0, q.z - Math.cos(q.heading) * 30], fov: 50 }; for (let i = 0; i < 4; i++) R.camera(1 / 60, base); maxYaw = Math.max(maxYaw, Math.abs(R.look.yawDeg)); };
    // her strike near the player: the spot set beside the boat when the strike comes
    assert.ok(sailTo(R, () => R.deep?.state.phase === 'strike', 300, cam), 'a strike');
    const q = B.phys.state; st.centre = [q.x + 60, q.z - 30]; st.visible = true;
    for (let i = 0; i < 90; i++) { R.settle(1 / 30); cam(); }
    if (reduced) assert.equal(maxYaw, 0, 'Reduce Motion: no look');
    else assert.ok(maxYaw > 5 && maxYaw <= LOOK.maxDeg, `the look: ${maxYaw.toFixed(1)}°`);
  }
});
