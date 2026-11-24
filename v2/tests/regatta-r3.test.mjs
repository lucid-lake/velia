// Regatta R3 on v2 (BACKLOG-v2 #12, § 6.5, § 10.3): the coach's step machine over a scripted race (each line once,
// in order, one at a time, never within the gaps; the officer's hails never on top of a coach line), the levels' aids on and off
// (the table, the lines each level draws, the coach each level speaks), the medal and tip rules, a cockpit wheel drag taking the helm
// from the helper, a whole beginner race in node (the helper's start, v1's pro at the helm after it, the results card's model),
// and the race's wind: the course laid in fair wind on the real terrain over seeds, the day's clock held inside a race.
// The browser half: v2/tests/pages/regatta.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { ground } from './helpers/ground.mjs';   // v2's own height field (v2/terrain/sample.js), every grid in
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { sailWindOptions } from '../sim/wind.js';
import { START } from '../sim/boat.js';
import { createCoach, COACH, STEPS, legKind } from '../regatta/coach.js';
import { LEVELS, LEVEL_IDS, aidsFor, loadLevel, saveLevel, LEVEL_KEY } from '../sim/raceLevels.js';
import { createReview, tipFor, medalFor, resultCard, MEDAL } from '../regatta/review.js';
import { createSegmentWriter, buildRaceLines, INK } from '../regatta/lines.js';
import { layFairCourse, courseToWind, racePoints, FAIR, laylines, fairGust, GUST_BAND } from '../regatta/geometry.js';
import { createRegatta } from '../regatta/index.js';
import { mountLevelRow } from '../ui/raceLevelRow.js';
import { SEG_FLOATS } from '../render/raceLines.js';

const DEG = Math.PI / 180;
const COURSE = courseFor('tahoe-emerald', 'island-sprint');
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ---------------- the coach ----------------
// a scripted race at 10 Hz: the box, the gun, the start, the beat (a tack at the layline), W's zone, the reach to I, I's zone, the
// finish leg, the finish. Returns the coach and every line it put on the card, frame by frame
function scripted({ coach = 'all', hails = [], ocsAt = null, penaltyAt = null } = {}) {
  const C = createCoach({ coach });
  const frames = [];
  const sit = (t) => {
    const s = { clock: t, status: 'prestart', ocs: false, legKind: null, leg: 0, finishLeg: false, lay: null, inZone: false, rounding: 'port', next: null, target: null, tacked: false };
    if (ocsAt && t >= ocsAt[0] && t < ocsAt[1]) s.ocs = true;
    if (t >= 0) s.status = t < 1.2 ? 'behind' : 'racing';
    if (t >= 1.2 && t < 120) { s.legKind = 'beat'; s.leg = 0; s.target = { id: 'W', colour: 'orange' }; s.next = { id: 'I', colour: 'orange' }; const m = 70 - (t - 1.2) * 1.0; s.lay = t < 80 ? { side: 'port', m: Math.max(0, m) } : null; s.tacked = Math.abs(t - 72) < 0.05; s.inZone = t >= 108; }
    if (t >= 120 && t < 220) { s.leg = 1; s.legKind = 'reach'; s.target = { id: 'I', colour: 'orange' }; s.next = { id: 'finish' }; s.inZone = t >= 208; }
    if (t >= 220) { s.leg = 2; s.legKind = 'reach'; s.finishLeg = true; s.target = { id: 'finish' }; }
    if (t >= 300) s.status = 'finished';
    return s;
  };
  for (let i = 0; i <= 3200; i++) {
    const t = -45 + i * 0.1;
    if (Math.abs(t - 119.9) < 0.05) C.event({ type: 'rounded', id: 'me', mark: 'W' });
    if (Math.abs(t - 219.9) < 0.05) C.event({ type: 'rounded', id: 'me', mark: 'I' });
    if (penaltyAt != null && Math.abs(t - penaltyAt) < 0.05) C.event({ type: 'penalty', id: 'me', rule: 'port and starboard' });
    for (const h of hails) if (Math.abs(t - h.at) < 0.05 && !C.busy(t)) C.officer(h.text, t);
    const line = C.update(t, sit(t));
    frames.push({ t, line: line ? { ...line } : null });
  }
  return { C, frames };
}

test('the coach: the steps in race order, each once, the cue it names lit', () => {
  const { C } = scripted();
  const ids = C.log.filter((l) => !l.id.startsWith('note')).map((l) => l.id);
  assert.deepEqual(ids, ['prestart', 'gun', 'beat', 'layline', 'rounding', 'run', 'rounding', 'finish'], JSON.stringify(C.log));
  const at = Object.fromEntries(C.log.map((l) => [l.id, l.at]));
  assert.ok(at.prestart <= -44.5, `the box's line at once (${at.prestart})`);
  assert.ok(at.gun >= 0 && at.gun < 0.2, `the gun's line at 0:00 (${at.gun})`);
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));
  assert.deepEqual(byId.prestart.lit, ['line', 'ghost']);
  assert.deepEqual(byId.beat.lit, ['laylines']);
  assert.deepEqual(byId.layline.lit({ lay: { side: 'stbd' } }), ['layline:stbd']);
  assert.match(byId.beat.text({ lay: { side: 'port' } }), /Tack when its line lights up\.$/); assert.doesNotMatch(byId.beat.text({ lay: { side: 'stbd' } }), /red|green/);
  // the marks by their numbers on screen (owner 2026-11-16: the course's ids stay internal)
  assert.equal(byId.rounding.text({ rounding: 'port', next: { id: 'I', num: '2' } }), 'Turn left round the mark, then head for mark 2.');
  assert.equal(byId.rounding.text({ rounding: 'starboard', next: { id: 'finish' } }), 'Turn right round the mark, then head for the finish.');
  assert.equal(byId.run.text({ target: { id: 'I', num: '2 (lap 2)' } }), 'Ease the sails. Head for mark 2 (lap 2).');
  for (const st of STEPS) for (const sx of [{ rounding: 'port', next: { id: 'I', num: '2' }, target: { id: 'W', num: '1' }, lay: { side: 'port' } }]) assert.doesNotMatch(st.text(sx), /\b[WI]\b/, `${st.id}: no course id on screen`);
});

test('the coach never spams: one line at a time, a teaching line ≥ 8 s after the last, an urgent one ≥ 2.5 s, each cleared', () => {
  const { C, frames } = scripted();
  const starts = C.log;
  for (let i = 1; i < starts.length; i++) {
    const st = STEPS.find((s) => s.id === starts[i].id), gap = starts[i].at - starts[i - 1].at;
    assert.ok(gap >= (st?.urgent ? COACH.urgentS : st ? COACH.gapS : COACH.urgentS) - 1e-6, `${starts[i - 1].id} → ${starts[i].id}: ${gap.toFixed(1)} s`);
  }
  // a line is cleared by its action: the gun's when she starts (1.2 s), the beat's when she tacks, the rounding's when she rounds
  const shownUntil = (id) => { let last = null; for (const f of frames) if (f.line?.id === id) last = f.t; return last; };
  assert.ok(shownUntil('gun') < 1.4, `the gun's line cleared by the start (${shownUntil('gun')})`);
  assert.ok(shownUntil('finish') <= 300.05, 'the finish line cleared at the finish');
  // and none lasts past its time
  for (const st of STEPS) { let run = 0, worst = 0; for (const f of frames) { run = f.line?.id === st.id ? run + 0.1 : 0; worst = Math.max(worst, run); } assert.ok(worst <= st.maxS + 0.15, `${st.id}: ${worst.toFixed(1)} s on screen (max ${st.maxS})`); }
  // the card is empty most of the race: the coach speaks, then lets her sail
  const busyShare = frames.filter((f) => f.line).length / frames.length;
  assert.ok(busyShare < 0.35, `the card shows a line ${(busyShare * 100).toFixed(0)} % of the race`);
});

test('the coach and the race officer: a hail takes the card, the coach waits under it, the officer waits for a fresh coach line', () => {
  const hails = [{ at: -30, text: 'Thirty seconds.' }, { at: 0.05, text: 'The race is started.' }, { at: 150, text: 'Halcyon rounds the windward mark first.' }];
  const { C, frames } = scripted({ hails });
  // at 0:00 the coach's gun line is fresh: the officer is told to wait (busy) and the hail is not taken
  assert.equal(frames.find((f) => Math.abs(f.t - 0.1) < 0.05).line.id, 'gun', 'the gun line holds the card at 0:00');
  // the hail at −30 shows for COACH.officerS, alone
  const h = frames.filter((f) => f.line?.kind === 'officer');
  assert.ok(h.length > 0 && h.every((f) => f.line.text === 'Thirty seconds.' || f.line.text.startsWith('Halcyon')), 'the hails show as the officer\'s');
  // no coach line starts during a hail
  for (const l of C.log) { const f = frames.find((x) => Math.abs(x.t - l.at) < 0.05); assert.notEqual(f?.line?.kind, 'officer', `${l.id} started under a hail`); }
  // the officer is busy while a coach line is fresh, free otherwise
  const C2 = createCoach(); const s = { clock: -44, status: 'prestart', ocs: false };
  C2.update(-44, s); assert.equal(C2.busy(-43), true); assert.equal(C2.busy(-40), false);
});

test('the coach per level: Club speaks only for mistakes (over early, the layline, a penalty), Pro not at all', () => {
  const club = scripted({ coach: 'mistakes', ocsAt: [-20, -12], penaltyAt: 160 }).C.log.map((l) => l.id);
  assert.deepEqual(club, ['ocs', 'layline', 'penalty'], JSON.stringify(club));
  assert.deepEqual(scripted({ coach: 'off', ocsAt: [-20, -12], penaltyAt: 160 }).C.log, []);
  const all = scripted({ ocsAt: [-20, -12] }).C.log.map((l) => l.id);
  assert.ok(all.indexOf('ocs') === 1 && !all.includes('gun') === false, JSON.stringify(all));
  assert.equal(legKind([0, 0], [0, -500], 0), 'beat'); assert.equal(legKind([0, 0], [0, 500], 0), 'run'); assert.equal(legKind([0, 0], [500, 0], 0), 'reach');
});

// ---------------- the levels ----------------
test('the levels: the plan\'s table, stored, and the aids each draws on the water', () => {
  assert.deepEqual(LEVEL_IDS, ['beginner', 'club', 'pro']);
  const b = aidsFor('beginner'), c = aidsFor('club'), p = aidsFor('pro'), pl = aidsFor('pro', { laylines: true });
  assert.deepEqual([b.helper, b.ghost, b.ghostPath, b.laylines, b.turnArrow, b.zone, b.coach, b.forgiving, b.tier], [true, true, true, true, true, true, 'all', true, 'easy']);
  assert.deepEqual([c.helper, c.ghost, c.ghostPath, c.laylines, c.turnArrow, c.zone, c.coach, c.forgiving, c.tier], [false, true, false, true, false, true, 'mistakes', false, 'medium']);
  assert.deepEqual([p.helper, p.ghost, p.laylines, p.turnArrow, p.zone, p.coach, p.forgiving, p.tier], [false, false, false, false, true, 'off', false, 'hard']);
  assert.equal(pl.laylines, true, 'Pro\'s laylines are an option');
  assert.equal(aidsFor('club', { laylines: false }).laylines, true, 'Club keeps its laylines');
  // the stored choice
  const st = memStore();
  assert.deepEqual(loadLevel(st), { level: 'beginner', laylines: false, chosen: false });
  saveLevel(st, { level: 'pro', laylines: true }); assert.deepEqual(loadLevel(st), { level: 'pro', laylines: true, chosen: true });
  st.setItem(LEVEL_KEY, '{"level":"wizard"}'); assert.equal(loadLevel(st).level, 'beginner');
  // the lines: a pre-start and a beat in the zone at each level
  const line = { pin: [0, 0], committee: [200, 0], up: [0, -1], centre: [100, 0] };
  const legs = [{ from: [100, 0], to: [100, -500] }, { from: [100, -500], to: [300, -300] }];
  const W = createSegmentWriter();
  const count = (pic) => buildRaceLines(W, pic);
  const pre = (aids) => count({ line, clock: -30, legs, leg: 0, ghost: [120, 10], ghostHeading: 0, path: [100, 60], aids });
  const ghostSegs = pre(aidsFor('beginner')) - pre(aidsFor('pro'));
  assert.equal(ghostSegs, 7, 'Pro: no ghost (5 hull + mast + path)');
  assert.equal(pre(aidsFor('beginner')) - pre(aidsFor('club')), 1, 'Club: the ghost without its path');
  const lay = laylines([100, -500], 0, 45 * DEG, 300);
  const beat = (aids) => count({ line, clock: 60, legs, leg: 0, laylines: lay, layTarget: 'stbd', layTargetM: 30, markM: 50, zone: { at: [100, -500], r: 26, inside: true, rounding: 'port', a0: 0 }, aids });
  assert.equal(beat(aidsFor('beginner')) - beat(aidsFor('club')), 26, 'Club: no turn arrow (24 arc pieces and the head)');
  assert.equal(beat(aidsFor('club')) - beat(aidsFor('pro')), 1, 'Pro: no laylines (Club: the one to tack on)');
  assert.equal(beat(aidsFor('pro', { laylines: true })) - beat(aidsFor('pro')), 2, 'Pro with its laylines option: both lines');
});

test('the coach\'s cue lights its segments: the pulse flag on the laylines, the line, the ghost, the zone', () => {
  const line = { pin: [0, 0], committee: [200, 0], up: [0, -1], centre: [100, 0] };
  const legs = [{ from: [100, 0], to: [100, -500] }];
  const W = createSegmentWriter();
  const lay = laylines([100, -500], 0, 45 * DEG, 300);
  const pulsed = (n) => { const out = []; for (let i = 0; i < n; i++) if ((Math.round(W.f32[i * SEG_FLOATS + 11]) & 1) === 1) out.push(W.u32[i * SEG_FLOATS + 8]); return out; };
  const pack = (c) => ((Math.round(c[0] * 255) & 255) | ((Math.round(c[1] * 255) & 255) << 8) | ((Math.round(c[2] * 255) & 255) << 16) | ((Math.round(c[3] * 255) & 255) << 24)) >>> 0;
  let n = buildRaceLines(W, { line, clock: 60, legs, leg: 0, laylines: lay, layTarget: 'stbd', layTargetM: 200, markM: 50, lit: new Set(['laylines']) });
  assert.deepEqual(pulsed(n), [pack(INK.amber)], 'the beat cue: the one to tack on pulses, amber');
  n = buildRaceLines(W, { line, clock: 60, legs, leg: 0, laylines: lay, layTarget: 'port', layTargetM: 10, markM: 50, lit: new Set(['layline:port']) });
  assert.deepEqual(pulsed(n), [pack(INK.amber)], 'the layline cue: that one only');
  n = buildRaceLines(W, { line, clock: -30, legs, leg: 0, ghost: [120, 10], ghostHeading: 0, path: [100, 60], lit: new Set(['line', 'ghost']) });
  assert.ok(pulsed(n).length >= 1 + 2 + 6, `the line, its posts and the ghost pulse (${pulsed(n).length})`);
  n = buildRaceLines(W, { line, clock: 60, legs, leg: 0, laylines: lay, markM: 50 });
  assert.equal(pulsed(n).length, 0, 'nothing pulses without a cue');
});

// ---------------- the medals and the tip ----------------
test('the medals: gold the win, silver second, bronze third; nothing for a DNF or 4th; second of two far behind is bronze', () => {
  assert.equal(medalFor({ place: 1, boats: 2 }), 'gold');
  assert.equal(medalFor({ place: 2, boats: 6 }), 'silver');
  assert.equal(medalFor({ place: 2, boats: 2, gapS: MEDAL.closeS - 1 }), 'silver');
  assert.equal(medalFor({ place: 2, boats: 2, gapS: MEDAL.closeS + 1 }), 'bronze');
  assert.equal(medalFor({ place: 3, boats: 6 }), 'bronze');
  assert.equal(medalFor({ place: 4, boats: 6 }), null);
  assert.equal(medalFor({ place: 1, boats: 2, finished: false }), null);
});

test('the tip: one, from the biggest loss measured (over early, a late start, the layline overstood, a slow tack, a wide rounding)', () => {
  // over early, then a late start: the race's events
  const R = createReview();
  R.event({ type: 'ocs', id: 'me', early: true }); R.event({ type: 'started', id: 'me', delayS: 7.5 }); R.event({ type: 'ocs', id: 'wren' });
  assert.deepEqual(R.faults.map((f) => f.id).sort(), ['lateStart', 'overEarly']);
  assert.equal(tipFor(R.faults).id, 'overEarly', 'over early (12 s) beats a 7.5 s late start');
  assert.match(tipFor([{ id: 'lateStart', costS: 7.5, delayS: 7.5 }]).text, /started 8 s late/);
  // a slow tack: 14 s to get back to 85 % of her speed
  const T = createReview(); let tw = 1;
  for (let t = 0; t < 40; t += 0.1) { if (Math.abs(t - 20) < 0.05) tw = -1; const u = t < 20 ? 3 : Math.min(3, 0.5 + (t - 20) * 0.16); T.sample(0.1, { status: 'racing', legKind: 'beat', leg: 0, x: 0, z: 0, u, twaSign: tw }); }
  const slow = T.faults.find((f) => f.id === 'slowTack'); assert.ok(slow && slow.s > 12 && slow.s < 16, JSON.stringify(T.faults));
  // a quick tack (4 s) is no fault
  const Q = createReview(); tw = 1;
  for (let t = 0; t < 40; t += 0.1) { if (Math.abs(t - 20) < 0.05) tw = -1; const u = t < 20 ? 3 : t < 24 ? 2 : 3; Q.sample(0.1, { status: 'racing', legKind: 'beat', leg: 0, x: 0, z: 0, u, twaSign: tw }); }
  assert.equal(Q.faults.length, 0);
  // overstood: 60 m outside the layline's cone below the mark (the wind from the north, the mark at the origin, alpha 45°)
  const O = createReview();
  for (let k = 0; k < 20; k++) O.sample(0.1, { status: 'racing', legKind: 'beat', leg: 0, x: 200 + k, z: 100, u: 3, twaSign: 1, mark: [0, 0], windFrom: 0, alpha: 45 * DEG, inZone: false });
  const ov = O.faults.find((f) => f.id === 'overstood'); assert.ok(ov && ov.m > 60 && ov.m < 90, JSON.stringify(O.faults));
  assert.match(tipFor(O.faults).text, /past the layline/);
  // inside the cone: no fault
  const I = createReview(); for (let k = 0; k < 20; k++) I.sample(0.1, { status: 'racing', legKind: 'beat', leg: 0, x: 50, z: 200, u: 3, twaSign: 1, mark: [0, 0], windFrom: 0, alpha: 45 * DEG });
  assert.equal(I.faults.length, 0);
  // a wide rounding: 24 m from the mark at the closest
  const Z = createReview();
  for (let k = 0; k < 30; k++) Z.sample(0.1, { status: 'racing', legKind: 'reach', leg: 1, x: 24, z: k - 15, u: 3, twaSign: 1, mark: [0, 0], inZone: true });
  Z.sample(0.1, { status: 'racing', legKind: 'reach', leg: 1, x: 60, z: 0, u: 3, twaSign: 1, mark: [0, 0], inZone: false });
  const wide = Z.faults.find((f) => f.id === 'wideRounding'); assert.ok(wide && wide.m === 24, JSON.stringify(Z.faults));
  // a clean race: the next step
  assert.match(tipFor([], { level: 'beginner', place: 1 }).text, /Try Club next/);
});

test('the results card\'s model: place, time, the gap to the winner, the medal, the tip', () => {
  const views = { wren: { finishedAt: 400.0, place: 1 }, me: { finishedAt: 412.4, place: 2 } };
  const m = resultCard({ order: ['wren', 'me'], views, names: { wren: 'Osprey', me: 'You' }, faults: [{ id: 'lateStart', costS: 6, delayS: 6 }] });
  assert.equal(m.ord, '2nd'); assert.equal(m.boats, 2); assert.equal(m.time, '6:52.4'); assert.equal(m.gap, '+12.4 s behind Osprey'); assert.equal(m.medal, 'silver'); assert.equal(m.tip.id, 'lateStart');
  const w = resultCard({ order: ['me', 'wren'], views: { me: { finishedAt: 300, place: 1 }, wren: { finishedAt: 304.2, place: 2 } }, names: { wren: 'Osprey' } });
  assert.equal(w.medal, 'gold'); assert.equal(w.gap, 'Won by 4.2 s');
  const lead = resultCard({ order: ['me', 'wren'], views: { me: { finishedAt: 300, place: 1 }, wren: { finishedAt: null } }, names: { wren: 'Osprey' } });
  assert.equal(lead.gap, 'You won');
});

// ---------------- the page's race in node: the wheel, a whole beginner race, the wind's clock ----------------
const fakeLines = () => ({ stats: { active: false, count: 0 }, setActive(on) { this.stats.active = on; }, write(f, n) { this.stats.count = n; } });
const fakeProps = () => ({ stats: { instances: 0 }, setActive() {}, begin() {}, put() {}, end() {} });
function raceInNode({ flags = {}, windMs = 6, dir = 210 } = {}) {
  const wind = { sample: (x, z, t) => { const v = steadyWind(windMs, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; }, base: { dirDeg: dir, speedMs: windMs } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const R = createRegatta({ B, windField: wind, clock: null, terrain: { field: { height: () => -40 } }, flags: { seed: '1', ...flags }, P: { headless: true }, lines: fakeLines(), props: fakeProps() });
  return { B, R };
}

test('a cockpit wheel drag takes the helm from the helper, as the keys and the touch strip do', async () => {
  for (const how of ['wheel', 'keys']) {
    const { B, R } = raceInNode();
    await R.enter();
    assert.equal(R.session.helper, true); assert.equal(B.driven, true, 'the helper sails her');
    R.settle(2);
    if (how === 'wheel') R.beforeStep({ steer: 0, pull: 0 }, 0.3); else R.beforeStep({ steer: 0.6, pull: 0 }, null);
    assert.equal(R.session.helper, false, `${how}: the helper is off`); assert.equal(B.driven, false, `${how}: the hands have her`);
    R.afterStep();
    assert.equal(R.coach.log.at(-1)?.id, 'helperOff', `${how}: the coach says so`);
    if (how === 'wheel') assert.equal(R.stats.wheel, 1);
    // a wheel not held does nothing
    const n2 = raceInNode(); await n2.R.enter(); n2.R.beforeStep({ steer: 0, pull: 0 }, null); assert.equal(n2.R.session.helper, true);
  }
});

test('a whole beginner race in node: the helper\'s clean start, v1\'s pro at the helm, the coach\'s steps, the results card', async () => {
  const { R } = raceInNode({ flags: { autoplay: '1', course: 'short' } });
  await R.enter();
  let s = null;
  for (let k = 0; k < 600 && !R.stats.result; k++) { R.settle(1); s = R.state(); }
  assert.ok(R.stats.start != null && R.stats.start < 5, `a clean start (${R.stats.start})`);
  assert.ok(R.stats.result, `the results card's model at ${s?.clock?.toFixed(0)} s (${s?.me?.status})`);
  assert.ok(['gold', 'silver', 'bronze'].includes(R.stats.result.medal) && R.stats.result.place >= 1 && /^\d+:\d\d\.\d$/.test(R.stats.result.time), JSON.stringify(R.stats.result));
  const ids = R.coach.log.map((l) => l.id).filter((id) => STEPS.some((st) => st.id === id));
  for (const want of ['prestart', 'gun', 'beat', 'rounding', 'finish']) assert.ok(ids.includes(want), `the coach said ${want}: ${ids.join(', ')}`);
  // Race again: back in the box at −0:45, the card and the coach fresh
  R.restart();
  assert.ok(R.state().clock < -44 && R.stats.result == null && R.coach.log.length === 0 && R.session.helper === true);
  // a level change: Pro, no helper, the hands have her; the rivals' tier
  R.setLevel('pro');
  assert.equal(R.aids.helper, false); assert.equal(R.session.helper, false);
  assert.equal(R.session.rivals[0].brain.sk.skill, R.session.rivals[0].brain.base ?? R.session.rivals[0].brain.sk.skill);
});

test('the rivals\' skill follows the level (easy, medium, hard: v1\'s tiers)', async () => {
  const skill = [];
  for (const id of ['beginner', 'club', 'pro']) { const { R } = raceInNode(); await R.enter(); R.setLevel(id); skill.push(R.session.rivals[0].brain.base); }
  assert.ok(skill[0] < skill[1] && skill[1] < skill[2], JSON.stringify(skill));
});

test('the race holds the wind\'s day clock (fair inside a race), and lets it go after', async () => {
  const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 15, rate: 10, start: START }) });
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: wf, headless: true });
  const own = (tt) => 15 + tt * 10 / 3600;
  wf.setClock(own);
  const R = createRegatta({ B, windField: wf, clock: null, terrain: { field: { height: () => -40 } }, flags: { seed: '1' }, P: { headless: true }, lines: fakeLines(), props: fakeProps() });
  await R.enter();
  const h0 = wf.hourAt(B.t);
  assert.equal(wf.hourAt(B.t + 600), h0, 'ten minutes of race: the same hour for the wind');
  R.leave();
  assert.equal(wf.day.clock, own, 'the page\'s clock again');
});

// the real terrain (v1's full set): the course laid where the wind is fair, over seeds, hours and levels
const terrainP = ground('full');
test('the race\'s wind stays in the fair band: the course moved out of the lee, every leg within 25 % of the line\'s wind over seeds', async () => {
  const S = await terrainP, h = (x, z) => S.height(x, z);
  const KN = 0.514444;
  for (const [seed, hour, wind] of [[1, 15, 3], [2, 15, 2], [3, 13, 3], [4, 17.5, 3], [5, 15, 4]]) {
    const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, ...sailWindOptions({ wind }, { hour, rate: 0, start: START }) });
    wf.setTerrain(h); wf.at(0);
    const dir = Math.round(wf.base.dirDeg), [k, w] = WindField.bins(wf.base.dirDeg);
    const factorAt = (x, z) => wf.binAt(k, x, z)[2] * (1 - w) + wf.binAt(k + 1, x, z)[2] * w;
    const r = layFairCourse(COURSE, dir, { loadCourse, snapCourse, depthAt: (x, z) => -h(x, z), factorAt });
    assert.ok(r.fair && r.ratio >= FAIR.minRatio, `seed ${seed}: laid fair (ratio ${r.ratio?.toFixed(2)}, moved ${r.offset})`);
    // the wind a boat meets over a race's span (7 min), each point's mean against the line's: no collapse
    const c = r.course, pts = racePoints({ committee: c.line.committee, pin: c.line.pin }, c.marks, c.legs.map((l) => l.toId), c.line.up, 120);
    const mean = (x, z) => { let s = 0, n = 0; for (let t = 0; t < 420; t += 30) { const v = wf.sample(x, z, t); s += Math.hypot(v.vx, v.vz); n++; } return s / n; };
    const lineMs = mean(c.line.centre[0], c.line.centre[1]);
    for (const p of pts) { const m = mean(p[0], p[1]); assert.ok(m >= 0.75 * lineMs, `seed ${seed} h ${hour}: ${(m / KN).toFixed(1)} kn at ${p.map(Math.round)} vs ${(lineMs / KN).toFixed(1)} kn at the line`); }
    // and second by second at each mark, the race's gusts in their band round the day's base: no hole, no blast
    for (const mk of c.marks) for (let t = 0; t < 420; t += 1) { wf.at(t); const g = fairGust(wf.sample(mk.at[0], mk.at[1], t), wf.base.speedMs), sp = Math.hypot(g.vx, g.vz) / wf.base.speedMs; assert.ok(sp >= GUST_BAND.lo - 1e-9 && sp <= GUST_BAND.hi + 1e-9, `seed ${seed} at ${mk.id}, ${t} s: ${sp.toFixed(2)} x the base`); }
  }
  // the Emerald Bay lee the fix moves out of: R2's place reads under 0.6 of its best point on a SSW wind
  const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 15, rate: 0, start: START }) });
  wf.setTerrain(h); wf.at(0);
  const [k, w] = WindField.bins(wf.base.dirDeg);
  const r0 = layFairCourse(COURSE, Math.round(wf.base.dirDeg), { loadCourse, snapCourse, depthAt: (x, z) => -h(x, z), factorAt: (x, z) => wf.binAt(k, x, z)[2] * (1 - w) + wf.binAt(k + 1, x, z)[2] * w });
  assert.ok(r0.ratio0 < 0.6 && (r0.offset[0] !== 0 || r0.offset[1] !== 0), `R2's place: ${r0.ratio0?.toFixed(2)}; moved ${r0.offset}`);
  void courseToWind;
});

test('Setup\'s race level row: Beginner, Club, Pro and Pro\'s laylines, stored', () => {
  // a tiny DOM: the Sail tab's panel and the "sailing" row it follows
  const el = (tag) => { const n = { tagName: tag, children: [], dataset: {}, attrs: {}, listeners: {}, parent: null, className: '', hidden: false, disabled: false, title: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener() {},
    appendChild(c) { c.parent = this; this.children.push(c); return c; }, insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; },
    get parentNode() { return this.parent; }, remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }, get nextSibling() { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] ?? null : null; },
    contains(x) { let c = x; while (c) { if (c === this) return true; c = c.parent; } return false; },
    set innerHTML(h) { this.children = []; for (const m of h.matchAll(/<button[^>]*data-(rl|rll)="([^"]+)"[^>]*>/g)) { const b = el('button'); b.dataset[m[1]] = m[2]; this.appendChild(b); } },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (match(c, sel)) out.push(c); walk(c); } }; walk(this); return out; } };
    return n; };
  const match = (n, sel) => { let m = sel.match(/^#([\w-]+)$/); if (m) return n.id === m[1]; m = sel.match(/^\[data-set="(\w+)"\]$/); if (m) return n.dataset.set === m[1]; m = sel.match(/^\[data-(rl|rll)\]$/); if (m) return n.dataset[m[1]] != null; return false; };
  const root = el('div'), list = el('div'), pages = el('div'); root.appendChild(list); root.appendChild(pages);
  const tabScreen = el('button'); tabScreen.id = 'tab-set-screen'; list.appendChild(tabScreen);
  const screen = el('div'); screen.id = 'tp-set-screen'; pages.appendChild(screen);
  const st = memStore();
  const row = mountLevelRow(root, { store: st, doc: { createElement: el } });
  assert.ok(row && list.children[1].id === 'tab-set-race' && pages.children[1].id === 'tp-set-race' && pages.children[1].children[0] === row.row, 'a fifth tab, Race, after Screen');
  const btn = (k, v) => row.row.querySelectorAll(`[data-${k}]`).find((b) => v == null || b.dataset[k] === v);
  assert.equal(btn('rl', 'beginner').getAttribute('aria-checked'), 'true'); assert.equal(btn('rll').disabled, true);
  row.row.listeners.click({ target: { closest: () => btn('rl', 'pro') }, stopPropagation() {} });
  assert.deepEqual(loadLevel(st), { level: 'pro', laylines: false, chosen: true });
  assert.equal(btn('rll').disabled, false);
  row.row.listeners.click({ target: { closest: () => btn('rll') }, stopPropagation() {} });
  assert.deepEqual(loadLevel(st), { level: 'pro', laylines: true, chosen: true });
  assert.equal(mountLevelRow(root, { store: st, doc: { createElement: el } }), null, 'mounted once');
  row.dispose(); assert.equal(list.children.length, 1); assert.equal(pages.children.length, 1);
  void LEVELS;
});
