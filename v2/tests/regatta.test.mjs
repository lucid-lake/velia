// Regatta on v2 (BACKLOG-v2 #12, R1 the box and the clock, R2 the course on the water). No browser: the page
// facts (the mode's aliases, the 6-boat cap), the start helper on the real BoatPhysics and v1's race rules (an untouched boat
// starts clean on 3 seeds, never OCS), the laylines (geometry for the wind and the tacking angle; a boat on one fetches the
// mark within a length in the real sim), the course laid to the wind, the segment builder per phase, the watch's words, and the
// guard: the race's two pipelines are declared at load and nothing after; outside a race nothing is recorded.
// The browser half: v2/tests/pages/regatta.page.mjs; the frame: the v2-regatta golden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse, BOAT_LENGTH_M } from '../../src/sim/race/course.js';
import { AISkipper, polarTargets } from '../../src/sim/ai/skipper.js';
import { regattaAtBoot, fleetSize, RACE, RACE_CUTS } from '../regatta/plan.js';
import { createRegattaSession, FLEET } from '../regatta/session.js';
import { laylines, laylineAhead, tackAngle, ghostSpot, lineReadout, courseToWind, dirOf, LEEWAY_DEG, ZONE_M } from '../regatta/geometry.js';
import { createSegmentWriter, buildRaceLines, INK, LAY, WIDTH } from '../regatta/lines.js';
import { STEPS } from '../regatta/coach.js';
import { tipFor } from '../regatta/review.js';
import { watchLines, mmss } from '../regatta/ui.js';
import { createRaceLines, MAX_SEGMENTS, SEG_FLOATS } from '../render/raceLines.js';
import { createRaceProps, MAX_PROPS } from '../render/raceProps.js';

const DEG = Math.PI / 180;
const COURSE = courseFor('tahoe-emerald', 'island-sprint');
const wrap = (a) => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };

// an untouched race: the player's boat gets nothing but the helper's hands, `seconds` of sim from −0:45
function untouched({ seed, dir = 210, speedMs = null, rivals = 1, seconds = 55 }) {
  const course = courseToWind(COURSE, dir, { loadCourse, snapCourse });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, ...(speedMs ? { speedMs } : {}) } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind }, log = [];
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) { S.helperTick(ctl, t); env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); log.push(...S.drain()); }
  return { S, log };
}

test('the page facts: ?mode=regatta (and v1\'s aliases), v1\'s 15:00, −0:45, real time, the race cuts', () => {
  for (const m of ['regatta', 'racing', 'race', 'Race']) assert.equal(regattaAtBoot({ mode: m }), true, m);
  for (const m of [undefined, 'sail', 'cruise']) assert.equal(regattaAtBoot({ mode: m }), false, String(m));
  assert.equal(RACE.hour, 15); assert.equal(RACE.prestartS, 45); assert.equal(RACE.speed, 1);
  assert.deepEqual([...RACE_CUTS].sort(), ['birds', 'fireworks', 'kayaks', 'towns']);
});

test('the 6-boat cap: you + 5 rivals at most, on every device (owner 2026-11-14)', () => {
  assert.equal(RACE.maxBoats, 6);
  for (const [n, want] of [[0, 1], [1, 2], [5, 6], [6, 6], [11, 6], [99, 6], [-3, 1], ['x', 1]]) assert.equal(fleetSize(n), want, `rivals ${n}`);
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course: COURSE, me: { phys }, rivals: 11, windAt: () => ({ vx: 2.5, vz: 4.3 }), seed: 1 });
  assert.equal(S.rivals.length, 5); assert.equal(S.boats.length, 6); assert.equal(S.race.ids.length, 6);
  assert.deepEqual(S.rivals.map((r) => r.name), FLEET.map((f) => f.name));
  assert.equal(S.rivals[0].name, 'Osprey'); assert.equal(S.rivals[0].sail, 17);   // v1's rival first: the race uses it alone today
});

// (8 s since the race fixes, 2026-11-18: the helper lets the jib fly on a luff and bears away when a luff would still carry her over,
// so it is never over early; seed 3 sits beside the rival's hull on its hold and starts 7.3 s late)
test('the start helper: an untouched boat makes a clean start on 3 seeds (racing within 8 s of the gun, never OCS)', () => {
  for (const seed of [1]) {   // seeds 2 and 3: v2/tests/slow/regatta.slow.mjs
    const { S, log } = untouched({ seed, seconds: 60 });
    const ocs = log.filter((e) => e.type === 'ocs' && e.id === 'me'), st = log.find((e) => e.type === 'started' && e.id === 'me');
    assert.equal(ocs.length, 0, `seed ${seed}: never over early (${JSON.stringify(ocs)})`);
    assert.ok(st && st.delayS >= 0 && st.delayS < 8, `seed ${seed}: started ${st?.delayS?.toFixed(2)} s after the gun`);
    assert.equal(S.state().me.status, 'racing');
    assert.equal(S.helper, false, `seed ${seed}: the helper handed the helm back after the start`);
    assert.ok(log.some((e) => e.type === 'helperOff' && e.why === 'started'));
  }
});

test('the helper starts clean in a full fleet and in other winds (the course laid to the wind)', () => {
  const { log } = untouched({ seed: 5, dir: 250, speedMs: 7, rivals: 5, seconds: 50 });
  const st = log.find((e) => e.type === 'started' && e.id === 'me');
  assert.ok(!log.some((e) => e.type === 'ocs' && e.id === 'me') && st && st.delayS < 5, `5 rivals, wind 250 at 7 m/s: started ${st?.delayS}`);
});

test('a steer hands the helm back: takeHelm turns the helper off; helperOn turns it back on until the gun', () => {
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course: COURSE, me: { phys }, rivals: 1, windAt: () => ({ vx: 2.5, vz: -4.3 }), seed: 1 });
  assert.equal(S.helper, true);
  assert.equal(S.takeHelm(), true); assert.equal(S.helper, false);
  const ctl = { ...CONTROLS, rudder: 0.3 }; assert.equal(S.helperTick(ctl), false); assert.equal(ctl.rudder, 0.3, 'off: the helper writes nothing');
  assert.equal(S.helperOn(), true); assert.equal(S.helper, true);
  assert.deepEqual(S.drain().map((e) => e.type), ['helperOff', 'helperOn']);
});

test('the laylines: the close-hauled courses through the mark, 2α apart, moving with the wind, drawn cream', () => {
  const m = [-60, 180], f = 210 * DEG, a = tackAngle(5);
  assert.ok(Math.abs(a / DEG - (polarTargets(5).up.twa + LEEWAY_DEG)) < 1e-9, 'α: the polar\'s best-VMG angle + the leeway');
  const L = laylines(m, f, a, 300);
  const hd = (seg) => Math.atan2(seg[0][0] - seg[1][0], -(seg[0][1] - seg[1][1]));   // the heading from the far end to the mark
  assert.ok(Math.abs(wrap(hd(L.stbd) - (f - a))) < 1e-9, 'starboard: fetched on the course windFrom − α');
  assert.ok(Math.abs(wrap(hd(L.port) - (f + a))) < 1e-9, 'port: fetched on the course windFrom + α');
  assert.ok(Math.abs(Math.abs(wrap(hd(L.stbd) - hd(L.port))) - 2 * a) < 1e-9, 'they open 2α');
  for (const s of [L.stbd, L.port]) { assert.deepEqual(s[0], m); assert.ok(Math.abs(Math.hypot(s[1][0] - m[0], s[1][1] - m[1]) - 300) < 1e-9); }
  // both run downwind of the mark (the side a boat on the beat comes from)
  const up = [Math.sin(f), -Math.cos(f)];
  for (const s of [L.stbd, L.port]) assert.ok((s[1][0] - m[0]) * up[0] + (s[1][1] - m[1]) * up[1] < -150);
  const L2 = laylines(m, f + 10 * DEG, a, 300);
  assert.ok(Math.abs(wrap(hd(L2.stbd) - hd(L.stbd) - 10 * DEG)) < 1e-9, 'a 10° veer turns them 10°');
  // the colour on the water: cream (owner 2026-11-15: no red or green laylines), never broadcast yellow (Pro's both, near the mark)
  const W = createSegmentWriter(); const n = buildRaceLines(W, { line: COURSE.line, clock: 30, legs: COURSE.legs, leg: 0, laylines: L, zone: null, finish: false, markM: 50, aids: { laylines: true, level: 'pro' } });
  const cols = new Set(); for (let i = 0; i < n; i++) if (W.f32[i * SEG_FLOATS + 11] >= 2) cols.add(W.u32[i * SEG_FLOATS + 8]);
  const pk = (c) => ((Math.round(c[0] * 255)) | (Math.round(c[1] * 255) << 8) | (Math.round(c[2] * 255) << 16) | (Math.round(c[3] * 255) << 24)) >>> 0;
  assert.deepEqual([...cols], [pk(INK.layline)]);
  assert.ok(INK.layline[0] > 0.9 && INK.layline[1] > 0.85 && INK.layline[2] > 0.7, 'cream');
});

test('the laylines read as a target: cream and thin at rest, the one to tack on amber and wider near it or on the coach\'s cue, clear of the zone\'s ring; the words name the glow', () => {
  const m = [-60, 180], f = 210 * DEG, L = laylines(m, f, tackAngle(5), 420), zone = { at: m, r: ZONE_M, inside: false, rounding: 'port' };
  const pk = (c) => ((Math.round(c[0] * 255)) | (Math.round(c[1] * 255) << 8) | (Math.round(c[2] * 255) << 16) | (Math.round(c[3] * 255) << 24)) >>> 0;
  const draw = (o) => { const W = createSegmentWriter(), n = buildRaceLines(W, { line: COURSE.line, clock: 60, legs: COURSE.legs, leg: 0, laylines: L, zone, finish: false, ...o }); const segs = [];
    for (let i = 0; i < n; i++) { const b = i * SEG_FLOATS; if (W.f32[b + 11] >= 2) segs.push({ col: W.u32[b + 8], w: W.f32[b + 3], lit: (W.f32[b + 11] & 1) === 1, a: [W.f32[b], W.f32[b + 2]] }); } return segs; };   // the far flag: the laylines' pieces
  // the guidance pass (owner 2026-11-16): near the mark only, the one to tack on only, amber; Pro sees the other too, cream
  assert.equal(draw({ layTarget: 'port', layTargetM: 200, markM: 300 }).length, 0, 'far from the mark and the line: no layline');
  const one = draw({ layTarget: 'port', layTargetM: 200, markM: LAY.showM - 5 });
  assert.equal(one.length, 1, 'near the mark: the one to tack on only'); assert.equal(one[0].col, pk(INK.amber), 'amber'); assert.ok(!one[0].lit && one[0].w === WIDTH.layline, 'calm (not lit) far from the line with no cue');
  assert.equal(draw({ layTarget: 'stbd', layTargetM: LAY.showM - 5, markM: 400 }).length, 1, 'near the line itself: shown');
  assert.equal(draw({ layTarget: null, markM: 50 }).length, 0, 'no target (heading away from both): none');
  const rest = draw({ layTarget: 'port', layTargetM: 200, markM: 50, aids: { laylines: true, level: 'pro' } });
  assert.equal(rest.length, 2, 'Pro: two segments (phone cost flat)');
  assert.ok(rest.every((s) => !s.lit && s.w === WIDTH.layline), 'nothing lit far from the line with no cue');
  assert.deepEqual(rest.map((s) => s.col).sort(), [pk(INK.amber), pk(INK.layline)].sort(), 'Pro: the target amber, the other cream');
  for (const s of rest) assert.ok(Math.hypot(s.a[0] - m[0], s.a[1] - m[1]) >= ZONE_M - 1e-3, 'clear of the zone\'s ring');
  assert.ok(INK.layline[3] < INK.cream[3] && WIDTH.layline < WIDTH.laylineLit, 'softer than the course\'s cream; thinner than lit');
  const pro = { laylines: true, level: 'pro' }, near = draw({ layTarget: 'port', layTargetM: LAY.nearM - 1, aids: pro }), cue = draw({ layTarget: 'stbd', layTargetM: 300, markM: 50, lit: new Set(['laylines']), aids: pro }), side = draw({ layTarget: 'port', layTargetM: 300, markM: 50, lit: new Set(['layline:stbd']), aids: pro });
  for (const [segs, name] of [[near, 'near'], [cue, 'the beat cue'], [side, 'the layline cue']]) {
    const lit = segs.filter((s) => s.lit);
    assert.equal(lit.length, 1, `${name}: one lit`); assert.equal(lit[0].col, pk(INK.amber), `${name}: amber`); assert.equal(lit[0].w, WIDTH.laylineLit, `${name}: wider`);
    assert.ok(segs.filter((s) => !s.lit).length === 1, `${name}: the other stays calm`);
  }
  const words = (o) => { const W = createSegmentWriter(), n = buildRaceLines(W, { line: COURSE.line, clock: 60, legs: COURSE.legs, leg: 0, laylines: null, zone, finish: false, ...o }); return new Set(Array.from({ length: n }, (_, i) => W.u32[i * SEG_FLOATS + 8])); };
  assert.ok(!words({}).has(pk(INK.layline)), 'the course, the line and the zone keep their own inks');
  const beat = STEPS.find((x) => x.id === 'beat');
  assert.equal(beat.text({ lay: { side: 'port' } }), 'The mark is upwind: zig-zag. Tack when its line lights up.');
  assert.equal(watchLines({ clock: 70, status: 'racing', line: { distM: -100 }, next: { text: 'Leg 1 of 3 · Mark 1 · round to port' }, layline: { side: 'port', m: 140.2 } }).l2, 'Tack line in 140 m');
  assert.match(tipFor([{ id: 'overstood', costS: 5, m: 30 }]).text, /Tack at the glowing line\.$/);
});

test('a boat close-hauled on the starboard layline fetches the mark within one length (the real BoatPhysics)', () => {
  const f = 210 * DEG, tws = 5, to = f + Math.PI, windAt = () => ({ vx: Math.sin(to) * tws, vz: -Math.cos(to) * tws });
  const m = [0, 0], L = laylines(m, f, tackAngle(tws), 260);
  // settle her on the line's course first, then start her at the far end of the layline
  const p = new BoatPhysics({ x: L.stbd[1][0], z: L.stbd[1][1], heading: f - tackAngle(tws), speed: 2.6 });
  const sk = new AISkipper({ skill: 1, seed: 3, windAt }), ctl = { ...CONTROLS };
  let best = Infinity;
  for (let i = 0; i < 60 * 140; i++) {
    const s = p.state;
    sk.update(DT, s, ctl, { t: i * DT, waypoint: [s.x + Math.sin(f) * 900, s.z - Math.cos(f) * 900], advice: { evade: true, closeHauled: true, side: 1, chDeg: polarTargets(tws).up.twa, mode: 'beat' } });
    p.step(DT, ctl, { t: i * DT, windAt });
    best = Math.min(best, Math.hypot(s.x - m[0], s.z - m[1]));
  }
  assert.ok(best < BOAT_LENGTH_M, `passed the mark at ${best.toFixed(1)} m (a length: ${BOAT_LENGTH_M} m)`);
});

test('the ghost, the line\'s readout and the zone', () => {
  const L = COURSE.line, f = COURSE.designWindFrom * DEG, g = ghostSpot(L, f);
  const below = -((g[0] - L.centre[0]) * L.up[0] + (g[1] - L.centre[1]) * L.up[1]);
  assert.ok(Math.abs(below - BOAT_LENGTH_M) < 0.05, 'one length below the line');
  const r = lineReadout(L, { x: L.centre[0] - L.up[0] * 40, z: L.centre[1] - L.up[1] * 40, heading: f, u: 2 }, -30, 2);
  assert.ok(Math.abs(r.distM - 40) < 1e-6 && Math.abs(r.timeS - 20) < 1e-6 && Math.abs(r.burnS - 10) < 1e-6, JSON.stringify(r));
  assert.equal(ZONE_M, 26);
});

test('the course laid to the wind: turned about its line, the line square to the new wind, the marks kept', () => {
  for (const dir of [190, 230, 250]) {
    const c = courseToWind(COURSE, dir, { loadCourse, snapCourse });
    const up = dirOf(dir * DEG);
    assert.ok(Math.abs(c.line.dir[0] * up[0] + c.line.dir[1] * up[1]) < 0.01, `square to ${dir} (as the design course is to 210)`);
    assert.deepEqual(c.markIds, COURSE.markIds);
    assert.ok(Math.abs(c.legs[0].len - COURSE.legs[0].len) < 1e-6 && Math.abs(c.line.len - COURSE.line.len) < 1e-6);
    const w = c.legs[0], bearing = Math.atan2(w.to[0] - w.from[0], -(w.to[1] - w.from[1]));
    const w0 = COURSE.legs[0], b0 = Math.atan2(w0.to[0] - w0.from[0], -(w0.to[1] - w0.from[1]));
    assert.ok(Math.abs(wrap(bearing - b0 - (dir - 210) * DEG)) < 1e-9, 'the first leg turns with the wind');
  }
});

test('the segments per phase: within MAX_SEGMENTS, finite, the pieces each phase shows', () => {
  const W = createSegmentWriter(), L = COURSE.line, ghost = ghostSpot(L, 210 * DEG);
  const lay = laylines(COURSE.marks[0].at, 210 * DEG, tackAngle(5), 420);
  const phases = {
    pre: { line: L, clock: -30, legs: COURSE.legs, leg: 0, ghost, ghostHeading: 165 * DEG, path: [L.centre[0] - L.up[0] * 60, L.centre[1] - L.up[1] * 60] },
    ocs: { line: L, clock: -10, ocs: true, legs: COURSE.legs, leg: 0, ghost, path: null },
    gun: { line: L, clock: 1, legs: COURSE.legs, leg: 0 },
    beat: { line: L, clock: 60, legs: COURSE.legs, leg: 0, laylines: lay, zone: { at: COURSE.marks[0].at, r: 26, inside: false, rounding: 'port' } },
    round: { line: L, clock: 200, legs: COURSE.legs, leg: 0, zone: { at: COURSE.marks[0].at, r: 26, inside: true, rounding: 'port', a0: 1 } },
    finish: { line: L, clock: 400, legs: COURSE.legs, leg: 2, finish: true },
  };
  const counts = {};
  for (const [k, pic] of Object.entries(phases)) {
    const n = buildRaceLines(W, pic); counts[k] = n;
    assert.ok(n > 0 && n <= MAX_SEGMENTS, `${k}: ${n}`);
    for (let i = 0; i < n * SEG_FLOATS; i++) if (i % SEG_FLOATS !== 8) assert.ok(Number.isFinite(W.f32[i]), `${k}: NaN at ${i}`);   // slot 8: the colour's bits
  }
  assert.ok(counts.pre > counts.gun, 'the ghost and the 20 m line before the gun');
  assert.ok(counts.round > counts.beat - 2, 'the turn arrow inside the zone');
  assert.ok(createSegmentWriter(4).seg(0, 0, 0, 1, 0, 1, 1, 0, INK.cream) && (() => { const w = createSegmentWriter(2); w.seg(0, 0, 0, 1, 0, 0, 1, 0, INK.cream); w.seg(0, 0, 0, 1, 0, 0, 1, 0, INK.cream); return w.seg(0, 0, 0, 1, 0, 0, 1, 0, INK.cream) === false && w.n === 2; })(), 'the writer never overruns');
});

test('the watch\'s words: the countdown, the line, the time to burn, OCS', () => {
  assert.equal(mmss(-35.2), '0:35'); assert.equal(mmss(125), '2:05');
  const w = watchLines({ clock: -35, status: 'prestart', ocs: false, line: { distM: 48.2, timeS: 16.4, burnS: 19.2 }, wind: { from: 'SSW', kn: 12 } });
  assert.deepEqual([w.clk, w.l1, w.l2, w.l3], ['0:35', 'Line 48 m · 16 s away', 'Time to burn 19 s', 'Wind from SSW, 12 kn']);
  const o = watchLines({ clock: -8, ocs: true, line: { distM: -6, timeS: 0, burnS: 8 } });
  assert.match(o.l2, /Over early/); assert.equal(o.l2amber, true);
  assert.match(watchLines({ clock: -3, line: { distM: 20, timeS: 12, burnS: -4 } }).l2, /Late by 4 s/);
  assert.equal(watchLines({ clock: 70, status: 'racing', line: { distM: -100 }, next: { text: 'Leg 1 of 3 · Mark 1 · round to port' } }).l1, 'Leg 1 of 3 · Mark 1 · round to port');
    // the layline ahead: a boat below the mark sailing on port tack reaches the starboard... the one her heading ray meets first
  const lay = laylines([0, 0], 0, 45 * DEG, 500);   // wind from the north: the mark upwind at the origin, the lines run south-west and south-east
  const a = laylineAhead(lay, 0, 200, 45 * DEG);   // 200 m south of it, heading north-east (starboard tack… wind over the port bow: port tack)
  assert.ok(a && Math.abs(a.m - 200 / Math.SQRT2) < 1e-6, JSON.stringify(a));
  assert.equal(laylineAhead(lay, 0, -50, 0), null, 'above the mark: none ahead');
});

// ---- the guard: two pipelines at load, none after; nothing recorded outside a race ----
function mockGpu() {
  const n = { pipelines: 0, buffers: 0, writes: 0 };
  const device = {
    createBuffer: (d) => { n.buffers++; return { d }; }, createBindGroupLayout: (d) => d, createBindGroup: (d) => d, createPipelineLayout: (d) => d,
    createShaderModule: (d) => d, createRenderPipeline: () => { n.pipelines++; return {}; }, createRenderPipelineAsync: async () => { n.pipelines++; return {}; },
    createTexture: () => ({ createView: () => ({}) }), createSampler: () => ({}),   // the sail-art atlas (render/sailArt.js; no canvas here: a stand-in, made at load)
    queue: { writeBuffer: () => { n.writes++; }, writeTexture: () => {} },
  };
  const added = [];
  const reg = { shader: (l, code) => ({ l, code }), add: (name) => { added.push(name); }, get: (name) => ({ name }) };
  return { device, reg, added, n };
}
function mockPass() { const rec = []; const p = new Proxy({}, { get: (t, k) => (...a) => { rec.push(k); } }); return { p, rec }; }

test('the guard: the race declares its 2 pipelines at load, builds none after, and records nothing outside a race', () => {
  const { device, reg, added, n } = mockGpu();
  const common = { device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', hdrTarget: { format: 'rgba16float' }, sky: { skyBGL: {}, skyBG: {} } };
  const RL = createRaceLines(common), RP = createRaceProps(common);
  assert.deepEqual(added, ['race-lines', 'race-props'], 'the two pipelines, declared at load');
  const buffers0 = n.buffers, added0 = added.length, c = { calls: 0, triangles: 0 };
  // outside a race (Sail, Cruise, the home card): many frames, nothing recorded, nothing uploaded
  const W = createSegmentWriter(), k = buildRaceLines(W, { line: COURSE.line, clock: -30, legs: COURSE.legs, leg: 0 });
  for (let f = 0; f < 120; f++) {
    const { p, rec } = mockPass();
    RL.write(W.f32, k); RP.begin(); RP.put('pin', 0, 0, 0); RP.end();
    RL.draw(p, c); RP.draw(p, c);
    assert.equal(rec.length, 0, 'no command recorded off a race');
  }
  assert.equal(c.calls, 0); assert.equal(RL.stats.draws + RP.stats.draws, 0); assert.equal(n.writes, 1, 'only the props\' mesh at load');
  // in a race: one draw for the lines, one run per prop kind; still no pipeline, no buffer
  RL.setActive(true); RP.setActive(true);
  const { p, rec } = mockPass();
  RL.write(W.f32, k); RP.begin(); RP.put('pin', 0, 0, 0); RP.put('sloop', 5, 0, 5, 1); RP.end();
  RL.draw(p, c); RP.draw(p, c);
  assert.equal(rec.filter((x) => x === 'setPipeline').length, 2);
  assert.equal(rec.filter((x) => x === 'draw').length, 3, 'the lines (1) and the props\' two kinds (2)');
  assert.equal(added.length, added0, 'no pipeline declared after load'); assert.equal(n.buffers, buffers0, 'no buffer made in the frame'); assert.equal(n.pipelines, 0, 'the registry builds them (buildAll), never the race');
  // back off: nothing again
  RL.setActive(false); RP.setActive(false);
  const q = mockPass(); RL.draw(q.p, c); RP.draw(q.p, c); assert.equal(q.rec.length, 0);
  assert.equal(MAX_PROPS >= 1 + 1 + 2 + 5, true, 'the props hold the committee boat, the pin, two marks and 5 rivals');
});
