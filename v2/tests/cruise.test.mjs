// Cruise on v2 (BACKLOG-v2 #11: v2/cruise; v1's src/modes/chill/ on v2's shared sim). No browser: the page facts are v1's
// (the mode's aliases, the hour, the wind, the day clock, the game speed); the voyage sails v2's boat (v2/sim/boat.js through
// its autopilot hook) with v1's navigator and AI skipper and stays on v1's track (v1's own headless voyage, tests/helpers/
// sim-cruise.mjs, the same world and wall clock: the first 4.6 s tick for tick, 60 s within 0.5 m and 1°); the start is v1's
// chooseStart; the hook hands the boat back to the hands; place() is a fresh boat; the cameras run the director and v1's
// five views on the boat; the chart objects v2 ships are v1's page's (tools/v2-cruise-bake.mjs); the clock's new schedule.
// The browser half: v2/tests/pages/cruise.page.mjs; the frame: the v2-cruise golden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruiseAtBoot, CRUISE_HOUR, cruiseWind, cruiseSchedule, cruiseSpeed, isCruise } from '../cruise/plan.js';
import { createCruiseVoyage, startCamera, NO_TRAFFIC } from '../cruise/voyage.js';
import { cruiseMusic } from '../cruise/music.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createBoatSim, waterFor, START } from '../sim/boat.js';
import { createSeamanship } from '../sim/seamanship.js';
import { createSimClock } from '../engine/clock.js';
import { parseV2Flags } from '../engine/flags.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL, chillClock } from '../../src/sim/modes/chill/params.js';
import { chooseStart } from '../../src/sim/modes/chill/navigator.js';
import { CAMERAS, NIGHT_CAMERAS, nextCamera } from '../cruise/cameras.js';
import { CAMERAS as V1_CAMERAS, nextCamera as v1Next } from '../../src/modes/chill/cameras.js';
import { runCruise } from '../../tests/helpers/sim-cruise.mjs';
import { recorder, frameDt } from '../../tests/helpers/sim-record.mjs';
import { analyticSun, dayClockSchedule, DEFAULT_TIMERATE, RateTable } from '../../src/sim/timeOfDay.js';
import { clampFrame } from '../../src/sim/sail/stepper.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEG = Math.PI / 180;
const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
const sunAt = (t) => Math.asin(analyticSun(((W.clock(t) % 24) + 24) % 24).y) / DEG;
// v2's boat on a flat sea over v1's terrain and v1's Cruise wind (the same world v1's headless voyage sails), and the voyage
function cruiseOnV2({ flags = {}, sun = { v: 0 } } = {}) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: START });
  const V = createCruiseVoyage({ B, lake: W.terrain, wind: W.wind, seed: 1, flags, chartIn: { shoreline: W.shoreline, harbour: W.harbour }, sun: () => sun.v });
  return { B, V, sun };
}

test('the page facts are v1\'s: ?mode=cruise and ?mode=chill open Cruise, at 17:54, Tahoe\'s day wind, the day clock at base 20, 1 ×', () => {
  assert.equal(cruiseAtBoot(parseV2Flags('?mode=cruise')), true);
  assert.equal(cruiseAtBoot(parseV2Flags('?mode=chill')), true, 'v1\'s old name still works');
  assert.equal(cruiseAtBoot(parseV2Flags('?mode=sail')), false); assert.equal(cruiseAtBoot(parseV2Flags('')), false);
  assert.ok(isCruise('Chill') && !isCruise('regatta'));
  assert.equal(CRUISE_HOUR, 17.9);
  assert.deepEqual(cruiseWind({}, 17.9), { day: { hour: 17.9, rate: 1, advisory: undefined } }, 'the day\'s wind, no level row unless ?wind=');
  assert.equal(cruiseWind({ wind: '4' }, 18).level, 4); assert.equal(cruiseWind({ wind: '9' }, 18).level, 4);
  assert.equal(cruiseWind({ windspeed: '5' }, 18), null, 'a pinned wind is the steady base');
  for (const f of [{}, { clock: 'flat' }]) {
    const a = new RateTable(cruiseSchedule(f)), b = new RateTable(chillClock(f));
    for (let h = 0; h < 24; h += 0.25) assert.equal(a.rateAt(h), b.rateAt(h), `v1's Cruise clock at ${h} h (${JSON.stringify(f)})`);
  }
  assert.equal(cruiseSpeed({}), CHILL.simSpeed); assert.equal(cruiseSpeed({ speed: '3' }), 3);
  assert.equal(startCamera({}), 'astern', 'Cruise opens in the Boat view (owner, 2026-11-15)'); assert.equal(startCamera({ cruisecam: 'deck' }), 'above'); assert.equal(startCamera({ cruisecam: 'island' }), 'island'); assert.equal(startCamera({ cruisecam: 'nope' }), 'astern');
  assert.equal(startCamera({ cruisecam: 'cinematic' }), 'cinematic', '?cruisecam=cinematic still opens on it (captures)');
});

test('v2\'s camera order (owner, 2026-11-15): Boat first, Cinematic last; the stars camera after Island at night; v1\'s order untouched', () => {
  assert.deepEqual([...CAMERAS], ['astern', 'above', 'helm', 'island', 'cinematic']);
  assert.equal(new Set(CAMERAS).size, V1_CAMERAS.length); assert.ok(V1_CAMERAS.every((c) => CAMERAS.includes(c)), 'the same five views as v1');
  let v = 'astern'; const seen = [];
  for (let i = 0; i < 5; i++) { v = nextCamera(v); seen.push(v); }
  assert.deepEqual(seen, ['above', 'helm', 'island', 'cinematic', 'astern'], 'C: round the five, Cinematic last');
  assert.equal(nextCamera('astern', -1), 'cinematic', 'Shift+C from Boat: Cinematic (the end of the list)');
  assert.equal(nextCamera('nonsense'), 'astern');
  assert.deepEqual([...NIGHT_CAMERAS], ['astern', 'above', 'helm', 'island', 'stars', 'cinematic']);
  assert.equal(nextCamera('island', 1, { night: true }), 'stars'); assert.equal(nextCamera('stars', 1, { night: true }), 'cinematic');
  assert.equal(nextCamera('cinematic', 1, { night: true }), 'astern');
  assert.equal(nextCamera('stars', 1), 'cinematic', 'the night ended on the stars camera: on to its neighbour'); assert.equal(nextCamera('stars', -1), 'island');
  assert.equal(v1Next('island', 1), 'cinematic', 'v1 keeps its own order (Cinematic first)');
});

test('the start is v1\'s chooseStart on the same chart; ?start=x,z&heading= pins it', () => {
  const { V } = cruiseOnV2();
  const w0 = W.wind.sample(CHILL.start.x, CHILL.start.z, 0);
  assert.deepEqual(V.startPose(0), chooseStart(W.chart, { seed: 1, traffic: W.traffic, t0: 0, windFrom: Math.atan2(-w0.vx, w0.vz) }));
  assert.deepEqual(cruiseOnV2({ flags: { start: '300,40', heading: '95' } }).V.startPose(0), { x: 300, z: 40, headingDeg: 95, speed: 2.5 });
  assert.equal(V.chart.nx, W.chart.nx); assert.equal(V.chart.objects.length, W.chart.objects.length, 'the same chart objects');
});

test('the voyage: v1\'s navigator and skipper sail v2\'s boat on v1\'s track (tick for tick at first, within 0.5 m and 1° after 60 s)', () => {
  const SEC = 60;
  const v1 = runCruise({ seed: 1, seconds: SEC });
  const { B, V, sun } = cruiseOnV2();
  V.place(V.startPose(0)); V.attach();
  const rec = recorder(), step = B.phys.step.bind(B.phys);
  B.phys.step = (dt, c, e) => { const o = step(dt, c, e); rec.tick(o, e.t); return o; };
  for (let i = 0; B.t < SEC; i++) { const dt = clampFrame(frameDt(i)); sun.v = sunAt(B.t); B.step(dt * CHILL.simSpeed, null, dt); }
  const got = rec.out();
  assert.equal(got.ticks, v1.ticks, 'the same ticks on the same wall clock');
  let same = 0; while (same < got.ticks && got.rows.slice(same * 8, same * 8 + 8) === v1.rows.slice(same * 8, same * 8 + 8)) same++;
  assert.ok(same >= 240, `bit for bit for the first ${same} ticks (≥ 4 s; then v2's sea in the env: its float's heave, its waveAt)`);
  for (const [i, a] of v1.marks.entries()) {
    const b = got.marks[i];
    const d = Math.hypot(a[2] - b[2], a[3] - b[3]), dh = Math.abs(Math.atan2(Math.sin(a[4] - b[4]), Math.cos(a[4] - b[4]))) / DEG;
    assert.ok(d < 0.5 && dh < 1, `t ${a[1].toFixed(0)} s: |Δpos| ${d.toFixed(3)} m, |Δheading| ${dh.toFixed(3)}°`);
  }
  assert.ok(V.ticks >= got.ticks - 1, 'the autopilot ran every tick');
  assert.equal(V.stats().helm, 'cruise');
});

test('the hook: detach hands the boat back to the hands (the pilot holds her heading), attach takes it again', () => {
  const { B, V } = cruiseOnV2();
  V.place(V.startPose(0)); V.attach();
  for (let i = 0; i < 300; i++) B.step(1 / 60, null, 1 / 60);
  assert.ok(B.driven && V.attached);
  const ticks = V.ticks;
  V.detach();
  assert.ok(!B.driven && !V.attached);
  const h0 = B.state.heading;
  for (let i = 0; i < 300; i++) B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60);
  assert.equal(V.ticks, ticks, 'no autopilot ticks while detached');
  assert.ok(Math.abs(Math.atan2(Math.sin(B.state.heading - h0), Math.cos(B.state.heading - h0))) < 8 * DEG, 'the hands\' pilot holds the heading she was on');
  V.attach(); B.step(0.5, null, 0.5);
  assert.ok(V.ticks > ticks);
});

test('place(): a fresh boat at the pose (the same objects), the follow camera behind her, the hands fresh', () => {
  const { B } = cruiseOnV2();
  const phys = B.phys, follow = B.follow;
  for (let i = 0; i < 120; i++) B.step(1 / 60, { steer: 1, pull: 0 }, 1 / 60);
  B.place({ x: 250, z: 60, headingDeg: 120, speed: 2.5 });
  assert.equal(B.phys, phys, 'the same physics object'); assert.equal(B.follow, follow);
  assert.deepEqual([B.state.x, B.state.z, B.state.heading, B.state.u], [250, 60, 120 * DEG, 2.5]);
  assert.equal(B.ctl.rudder, 0); assert.equal(B.holdHeading, 120 * DEG);
  B.settle(1);
  assert.ok(Math.abs(B.state.heading - 120 * DEG) < 3 * DEG, 'the settle holds the placed heading (not the boot start\'s)');
});

// the page's boat carries the engine and the tackle (v2/sim/seamanship.js); a Sail boat at anchor, then Cruise from the card
function sailAtAnchor() {
  const { B, V, sun } = cruiseOnV2();
  const sea = B.sea = createSeamanship({ B, depthAt: (x, z) => -W.terrain.heightAt(x, z) });
  const sail = (s) => { for (let i = 0; i < s * 60; i++) B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60); };
  sail(3); sea.actions.sails();
  let r = null;
  for (let k = 0; k < 60 && r !== 'drop'; k++) { sail(2); r = sea.actions.anchor(); }
  assert.equal(r, 'drop', 'the anchor goes down once she has slowed');
  sail(40);
  assert.ok(sea.held, `she lies to her anchor in Sail (${sea.state.anchor.phase})`);
  return { B, V, sea, sun };
}

test('Cruise after Sail left her at anchor: the tackle comes aboard at the start, the skipper sails her at v1\'s pace within 30 s', () => {
  const { B, V, sea } = sailAtAnchor();
  const pose = V.place(V.startPose(0)); V.attach();
  assert.equal(sea.state.mode, 'free'); assert.equal(sea.state.anchor.phase, 'stowed', 'the anchor aboard on the fresh boat');
  let maxKn = 0, sumKn = 0, n = 0;
  for (let s = 1; s <= 30; s++) {
    for (let i = 0; i < 60; i++) B.step(1 / 60, null, 1 / 60);
    const kn = B.state.sog / 0.514444; maxKn = Math.max(maxKn, kn); if (s > 5) { sumKn += kn; n++; }
  }
  const d = Math.hypot(B.state.x - pose.x, B.state.z - pose.z);
  assert.ok(maxKn > 2 && sumKn / n > 3 && sumKn / n < 6, `she sails at v1's Cruise pace (3.4-5 kn; mean ${(sumKn / n).toFixed(2)} kn, max ${maxKn.toFixed(2)} kn)`);
  assert.ok(d > 30 && d < 120, `30 s from the start, as v1's voyage (${d.toFixed(1)} m; the old tackle flung her km off and held her)`);
});

test('the hand-back: Cruise takes the boat from the player\'s sails down, anchor down and lever ahead, and sails at v1\'s pace', () => {
  const { B, V, sea } = sailAtAnchor();
  V.place(V.startPose(0)); V.attach();
  for (let i = 0; i < 600; i++) B.step(1 / 60, null, 1 / 60);
  V.detach();   // the player takes the helm: the sails down (Y), the engine ahead, then the anchor (J) once she is slow
  B.place({ x: START.x, z: START.z, headingDeg: START.headingDeg, speed: 0 });   // over Sail's start (18 m: Cruise's water is too deep to anchor)
  const sail = (s) => { for (let i = 0; i < s * 60; i++) B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60); };
  sea.actions.sails(); sea.actions.engine(); sail(2); sea.actions.lever(0.5); sail(5);
  let r = null;   // a touch astern to stop her (the breeze keeps a bare hull at 1.5 kn), then the anchor
  for (let k = 0; k < 60 && r !== 'drop'; k++) { sea.actions.lever(B.state.u > 0.3 ? -0.5 : 0); sail(1); r = sea.actions.anchor(); }
  sea.actions.lever(0); sail(20);
  for (let k = 0; k < 60 && !(sea.anchoredNow && B.state.sog < 0.3); k++) sail(1);   // v2's crew backs her down to set it (v2/sim/seamanship.js): she lies to it
  if (!B.phys.engine.on) { sea.actions.engine(); sail(1); }   // at N at anchor the engine stops by itself (v1's rule): the player starts it again
  assert.ok(B.ctl.furl === 1 && sea.held && B.phys.engine.on, `the player left her: furled, at anchor, engine on (${B.ctl.furl}, ${r} ${sea.state.anchor.phase} depth ${sea.state.depth.toFixed(1)} sog ${B.state.sog.toFixed(2)}, ${B.phys.engine.state})`);
  const p0 = { x: B.state.x, z: B.state.z };
  V.attach();   // the hand-back (\`)
  assert.equal(B.ctl.furl, 0, 'the sails up'); assert.equal(B.ctl.throttle, null); assert.equal(sea.state.mode, 'free', 'the anchor aboard');
  assert.ok(!B.phys.engine.on && B.phys.engine.lever === 0, 'the engine off, the lever in neutral');
  let sumKn = 0, n = 0;
  for (let s = 1; s <= 60; s++) { for (let i = 0; i < 60; i++) B.step(1 / 60, null, 1 / 60); if (s > 20) { sumKn += B.state.sog / 0.514444; n++; } }
  const d = Math.hypot(B.state.x - p0.x, B.state.z - p0.z);
  assert.ok(B.state.furl < 0.1, `the sails drawing (furl ${B.state.furl.toFixed(2)})`);
  assert.ok(sumKn / n > 3, `she sails herself at v1's pace (mean ${(sumKn / n).toFixed(2)} kn from 20 to 60 s, head to wind off the anchor; a clean Cruise from rest here 4.0; the old hand-back drifted under bare poles)`);
  assert.ok(d > 40 && d < 1000, `she made way from where she lay (${d.toFixed(0)} m in 60 s)`);
});

test('place() keeps the engine the seamanship and the dock hold: after Cruise\'s start the lever runs the physics\' engine', () => {
  const { B, V, sea } = sailAtAnchor();
  V.place(V.startPose(0)); V.attach(); B.step(1, null, 1);
  V.detach();
  assert.equal(sea.engine, B.phys.engine, 'one engine object');
  sea.actions.engine(); sea.actions.lever(1);
  for (let i = 0; i < 300; i++) B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60);
  assert.equal(B.phys.engine.state, 'running', 'the engine the physics steps is the one the lever started');
  assert.ok(B.state.thrust > 0, `thrust ahead (${B.state.thrust.toFixed(0)} N)`);
});

test('the cameras: the director and v1\'s five views frame the boat (a pose each, the boat in front of the lens)', () => {
  const { B, V } = cruiseOnV2();
  V.place(V.startPose(0)); V.attach();
  for (const view of CAMERAS) {
    V.rig.set(view, { instant: true });
    let p = null;
    for (let i = 0; i < 90; i++) p = V.frame(1 / 30, 1 / 30, { aspect: 16 / 9, sunDir: { x: 0.3, y: 0.5, z: 0.8 } });
    assert.ok(p && p.pos.every(Number.isFinite) && p.target.every(Number.isFinite) && p.fov > 5 && p.fov < 100, `${view}: a pose`);
    const s = B.state, f = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], b = [s.x - p.pos[0], 1 - p.pos[1], s.z - p.pos[2]];
    const cos = (f[0] * b[0] + f[1] * b[1] + f[2] * b[2]) / (Math.hypot(...f) * Math.hypot(...b));
    assert.ok(cos > Math.cos(p.fov * DEG), `${view}: the boat inside the lens (${(Math.acos(cos) / DEG).toFixed(1)}° off the axis, fov ${p.fov.toFixed(0)}°)`);
    assert.equal(V.rig.view, view);
  }
  assert.ok(['wide', 'follow', 'low', 'pace', 'orbit', 'drone'].includes(V.director.shot?.kind), 'the director has a shot');
});

test('your mark: the chart\'s checks (dry land, too shallow refused), the navigator makes for a good mark', () => {
  const { V, B } = cruiseOnV2();
  V.place(V.startPose(0)); V.attach();
  const s = B.state;
  V.nav.setDestination([s.x + 300, s.z], { name: 'your mark' });
  assert.equal(V.stats().dest, 'your mark');
  V.nav.clearDestination();
  assert.equal(V.stats().dest, null);
});

test('chart objects: v2/cruise/chartWorld.json is v1\'s page (the real piers, the harbour) and reads as buildChart\'s rows', async () => {
  const { bakeChartWorld, stringify, OUT } = await import('../../tools/v2-cruise-bake.mjs');
  const now = readFileSync(OUT, 'utf8');
  assert.equal(now, stringify(await bakeChartWorld()), 'stale: run node tools/v2-cruise-bake.mjs');
  const rows = chartInputs(JSON.parse(now));
  assert.ok(rows.shoreline.piers.length > 10 && rows.shoreline.piers.every((p) => Number.isFinite(p.x) && Number.isFinite(p.length)));
  assert.deepEqual(rows.harbour.boats, [], 'the slips empty, as v1\'s page');
  const { V } = (() => { const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: START }); return { V: createCruiseVoyage({ B, lake: W.terrain, wind: W.wind, chartIn: rows }) }; })();
  assert.ok(V.chart.objects.length > 0);
});

test('the clock: setSchedule runs another day clock from now, the hour continuous (a frozen clock ignores it)', () => {
  const c = createSimClock({ step: 1 / 120, hour0: 18, schedule: dayClockSchedule({ base: DEFAULT_TIMERATE }) });
  c.advance(10);
  const h = c.hourUnwrapped;
  c.setSchedule(chillClock({}), c.t);
  assert.ok(Math.abs(c.hourUnwrapped - h) < 1e-9, 'continuous');
  const r = c.rate; assert.ok(Math.abs(r - new RateTable(chillClock({})).rateAt(h)) < 1e-9, `Cruise's base (${r.toFixed(2)} game s per sim s)`);
  c.resume(); assert.ok(Math.abs(c.rate - new RateTable(dayClockSchedule({ base: DEFAULT_TIMERATE })).rateAt(c.hourUnwrapped)) < 1e-9, 'resume: the clock\'s own schedule');
  const f = createSimClock({ step: 1 / 120, hour0: 15 });
  f.setSchedule(chillClock({}), 0); f.advance(5);
  assert.equal(f.hour, 15, 'a capture\'s time stands still');
});

test('the music: v1\'s Cruise playlist on the page\'s music (enter, the hand-over\'s finish, a card switch\'s fade, ] and [); a no-op with none', () => {
  const none = cruiseMusic({ music: null });
  assert.equal(none.enter(), null); none.next(); none.finish();
  assert.deepEqual(none.stats(), { wired: false, mode: null, calls: ['enter', 'next', 'finish'], song: null });
  const got = [], player = { title: 'Lake', next: () => got.push('next'), toggle: () => got.push('toggle') };
  const sys = { mode: 'sail', setMode(m, o = {}) { got.push([m, !!o.finish]); this.mode = m; return m; }, get player() { return player; } };
  const m = cruiseMusic({ music: sys });
  m.next(); assert.deepEqual(got, [], 'no next in Sail (the beds are Sail\'s)');
  m.enter(); m.next(); m.toggle(); m.finish(); m.enter(); m.leave();
  assert.deepEqual(got, [['cruise', false], 'next', 'toggle', ['sail', true], ['cruise', false], ['sail', false]]);
  assert.equal(m.player(), player); assert.ok(m.wired); assert.equal(m.stats().song, 'Lake');
  assert.equal(NO_TRAFFIC.agents(0).length, 0);
});

test('Cruise keeps v1\'s 4 x night (Sail\'s night runs at the day\'s rate); neither says "The night passes…": v1\'s night-sky line instead (owner, 2026-11-15)', async () => {
  const { sailSchedule } = await import('../engine/clock.js');
  const { STARS_LINE, starsCue } = await import('../ui/dayClock.js');
  const { NIGHT_LINE } = await import('../../src/sim/timeOfDay.js');
  const cruise = cruiseSchedule({}), sail = sailSchedule();
  assert.ok(Math.abs(cruise(0.5) / cruise(13) - 4) < 1e-9, `Cruise's deep night: 4 x its day (${cruise(0.5) / cruise(13)})`);
  assert.ok(Math.abs(sail(0.5) / sail(13) - 1) < 1e-9, 'Sail\'s deep night: 1 x');
  assert.notEqual(STARS_LINE, NIGHT_LINE);
  // Cruise's quiet line on a 4 x night: one line, v1's night-sky words, never repeated
  const q = starsCue(); const shown = [];
  for (let i = 0; i < 60 * 60; i++) if (q.step(1 / 60, { band: 0.95, coverage: 0, storm: false, sun: -25 })) shown.push(STARS_LINE);
  assert.deepEqual(shown, [STARS_LINE]);
});
