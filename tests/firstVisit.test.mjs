// The first-visit flow: the profile -> settings map, the welcome once, the goal, the pro prompt, Cruise's offer. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../src/ui/settings.js';
import { PATCH, applyProfile, resetWelcome, planFor, needsStep2, isNew, goalBearing, fmtDist, LINES, ARRIVAL, NEXT, nextSuggestion } from '../src/ui/profile.js';
import { createFirstSail, TIMING } from '../classic/src/ui/firstSail.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('each profile maps to its settings', () => {
  const st = mem(), s = createSettings({ storage: st });
  applyProfile(s, 'new');
  assert.deepEqual([s.get('crewTrim'), s.get('pilot'), s.get('shoalAssist'), s.get('proMode'), s.get('words')], [true, true, true, false, 'both']);
  applyProfile(s, 'sail');
  assert.deepEqual([s.get('crewTrim'), s.get('pilot'), s.get('shoalAssist'), s.get('proMode'), s.get('words')], [false, true, true, false, 'sailor']);
  applyProfile(s, 'race');
  assert.deepEqual([s.get('crewTrim'), s.get('pilot'), s.get('shoalAssist'), s.get('autoReef'), s.get('proMode'), s.get('words')], [false, false, false, false, true, 'sailor']);
  assert.equal(s.get('profile'), 'race');
  assert.deepEqual(Object.keys(PATCH), ['new', 'sail', 'race']);
  applyProfile(s, 'nonsense'); assert.equal(s.get('profile'), 'new', 'an unknown profile falls back to New');
});

test('the welcome is once: it persists, and only "show the welcome again" clears it', () => {
  const st = mem(), a = createSettings({ storage: st });
  assert.equal(a.get('welcomed'), false, 'a fresh browser is welcomed');
  applyProfile(a, 'race');
  const b = createSettings({ storage: st });   // a returning visit
  assert.equal(b.get('welcomed'), true); assert.equal(b.get('profile'), 'race'); assert.equal(b.get('proMode'), true);
  resetWelcome(b); assert.equal(b.get('welcomed'), false); assert.equal(b.get('profile'), 'race', 'the profile stays until a new answer');
  assert.equal(b.set('profile', 'bogus'), 'race', 'a bad profile is refused');
});

test('step 2 is New only, and an explicit ?mode= is kept', () => {
  assert.equal(needsStep2('new'), true); assert.equal(needsStep2('sail'), false); assert.equal(needsStep2('race'), false);
  assert.equal(needsStep2('new', 'sail'), false, 'the URL already chose');
  assert.equal(planFor('new', 'cruise'), 'cruise'); assert.equal(planFor('new', 'sail'), 'sail');
  assert.equal(planFor('sail', null), 'sail'); assert.equal(planFor('race', null), 'sail');
  assert.equal(planFor('new', 'cruise', 'regatta'), 'regatta');
  const s = createSettings({ storage: mem() }); assert.equal(isNew(s), false, 'not before the welcome'); applyProfile(s, 'new'); assert.equal(isNew(s), true);
});

test('the goal bearing: right of the bow is positive, the distance in metres', () => {
  const g = { x: 0, z: -1000 };   // due north
  assert.ok(Math.abs(goalBearing({ x: 0, z: 0, heading: 0 }, g).relDeg) < 1e-9);
  assert.ok(Math.abs(goalBearing({ x: 0, z: 0, heading: -Math.PI / 2 }, g).relDeg - 90) < 1e-6, 'heading west, the goal is to the right');
  assert.equal(Math.round(goalBearing({ x: 0, z: 0, heading: 0 }, g).dist), 1000);
  assert.equal(fmtDist(1620), '1.6 km'); assert.equal(fmtDist(480), '480 m');
});

function rig(profile = 'new', extra = {}) {
  const s = createSettings({ storage: mem() }); applyProfile(s, profile);
  const log = { notes: [], goals: [], pro: [], cruise: [], shown: false };
  const effects = {
    note: (t) => { log.notes.push(t); log.shown = true; }, noteShown: () => log.shown,
    goal: (g) => log.goals.push(g), proOffer: (on) => log.pro.push(on), cruiseOffer: (on) => log.cruise.push(on),
  };
  const f = createFirstSail({ settings: s, island: { x: 0, z: 0 }, effects });
  const ctx = { firstSail: 'goal', ready: true, quiet: true, boat: { x: 1200, z: -1050, heading: 4.4 }, islandFound: false, proDetected: false, ...extra };
  const run = (secs, patch = {}) => { Object.assign(ctx, patch); for (let t = 0; t < secs; t += 0.5) f.update(0.5, ctx); };
  return { s, f, log, ctx, run };
}

test('New in Sail: the instruction line once, then the goal with its pointer', () => {
  const { s, log, run, ctx } = rig('new');
  run(1); assert.equal(log.notes.length, 0, 'not before 1.5 s');
  run(3); assert.deepEqual(log.notes, [LINES.new]); assert.equal(s.get('introShown'), true);
  run(20); assert.equal(log.notes.length, 1, 'the line is said once');
  const g = log.goals.at(-1); assert.ok(g && g.text === 'Sail to Fannette Island' && g.dist > 1000);
  assert.ok(Math.abs(g.relDeg) <= 180);
});

test('the goal arrival: the postcard ends the goal, R.\'s line, then one suggestion, each once', () => {
  const { s, log, run } = rig('new');
  run(5); assert.ok(log.goals.at(-1));
  run(1, { islandFound: true });
  assert.equal(s.get('goalDone'), true); assert.equal(log.goals.at(-1), null, 'the pointer is gone');
  run(TIMING.arrivalLineS + 1); assert.equal(log.notes.at(-1), ARRIVAL);
  run(TIMING.nextS + 1); assert.equal(log.notes.at(-1), NEXT.trim);
  const n = log.notes.length; run(60); assert.equal(log.notes.length, n, 'nothing more');
});

test('an island already in the logbook sets no goal; the crew-off player is sent to the race', () => {
  const a = rig('new', { islandFound: true }); a.run(8);
  assert.equal(a.s.get('goalDone'), true); assert.ok(!a.log.goals.some(Boolean), 'no pointer ever shown');
  const b = rig('new'); b.s.set('crewTrim', false); assert.equal(nextSuggestion(b.s), NEXT.race);
});

test('I sail gets the winch hint, I race the Regatta pointer; neither gets a goal', () => {
  const a = rig('sail'); a.run(6); assert.deepEqual(a.log.notes, [LINES.sail]); assert.ok(!a.log.goals.some(Boolean));
  const b = rig('race'); b.run(6); assert.deepEqual(b.log.notes, [LINES.race]); assert.match(LINES.race, /Regatta/); assert.match(LINES.race, /Hard/);
});

test('the intro retries until the hint row shows it', () => {
  const s = createSettings({ storage: mem() }); applyProfile(s, 'new');
  let calls = 0, shown = false;
  const f = createFirstSail({ settings: s, island: { x: 0, z: 0 }, effects: { note: () => { calls++; if (calls === 3) shown = true; }, noteShown: () => shown, goal() {}, proOffer() {}, cruiseOffer() {} } });
  for (let t = 0; t < 30; t += 0.5) f.update(0.5, { firstSail: 'goal', ready: true, quiet: true, boat: { x: 0, z: 0, heading: 0 } });
  assert.equal(calls, 3); assert.equal(s.get('introShown'), true);
});

test('nothing runs before the welcome is answered, or while a menu is up', () => {
  const s = createSettings({ storage: mem() }), log = [];
  const f = createFirstSail({ settings: s, island: { x: 0, z: 0 }, effects: { note: (t) => log.push(t), noteShown: () => false, goal() {}, proOffer: (o) => log.push(o), cruiseOffer() {} } });
  for (let t = 0; t < 20; t += 0.5) f.update(0.5, { firstSail: 'goal', ready: true, quiet: true, proDetected: true, boat: { x: 0, z: 0, heading: 0 } });
  assert.deepEqual(log, []);
  applyProfile(s, 'new');
  for (let t = 0; t < 20; t += 0.5) f.update(0.5, { firstSail: 'goal', ready: true, quiet: false, boat: { x: 0, z: 0, heading: 0 } });
  assert.deepEqual(log, [], 'quiet: false (the card, the logbook) holds everything');
});

test('the pro prompt: once, when the skills model says pro; not for a racer or when Pro is on', () => {
  const { s, log, run } = rig('new');
  run(2); assert.deepEqual(log.pro, []);
  run(1, { proDetected: true }); assert.deepEqual(log.pro, [true]); assert.equal(s.get('proOffered'), true);
  run(TIMING.proShowS + 1); assert.deepEqual(log.pro, [true, false], 'it leaves by itself');
  run(30, { proDetected: true }); assert.deepEqual(log.pro, [true, false], 'never offered twice');
  const r = rig('race'); r.run(3, { proDetected: true }); assert.deepEqual(r.log.pro, []);
  const p = rig('sail'); p.s.set('proMode', true); p.run(3, { proDetected: true }); assert.deepEqual(p.log.pro, []);
  const c = rig('sail'); c.run(1, { proDetected: true }); c.s.set('proMode', true); c.run(1, { proDetected: true }); assert.equal(c.log.pro.at(-1), false, 'one tap (Pro on) closes it');
});

test('New in Cruise: a gentle "take the helm" after ~60 s, once; not on the home card', () => {
  const { s, log, run } = rig('new');
  run(50, { firstSail: 'offer' }); assert.deepEqual(log.cruise, []);
  run(5, { firstSail: 'offer', quiet: false }); run(5, { firstSail: 'offer', quiet: true }); assert.deepEqual(log.cruise, [], 'time under the card does not count');
  run(10, { firstSail: 'offer' }); assert.deepEqual(log.cruise, [true]); assert.equal(s.get('cruiseOffered'), true);
  run(TIMING.cruiseShowS + 1, { firstSail: 'offer' }); assert.deepEqual(log.cruise, [true, false]);
  run(200, { firstSail: 'offer' }); assert.deepEqual(log.cruise, [true, false]);
  const x = rig('sail'); x.run(120, { firstSail: 'offer' }); assert.deepEqual(x.log.cruise, [], 'only the New profile');
});
