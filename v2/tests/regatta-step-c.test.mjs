// Regatta step C through the race itself (v2/regatta/index.js on the real boat, headless): the hub's Cup card continues a stored Cup
// (clamped on read), the last race's places close it with the podium and Start a new Cup begins again; a time trial keeps its best run,
// and the next run sails against its ghost with a split at each mark; a match race's chip; a pursuit's order on the hub and the chip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createRegatta } from '../regatta/index.js';
import { CUP, CUP_KEY, newCup, recordRace, saveCup, loadCup } from '../regatta/cup.js';
import { TRIAL_KEY, loadTrial, trialKey } from '../regatta/events.js';
import { SETUP_KEY, DEFAULT_SETUP, DEFAULT_CUSTOM } from '../regatta/setup.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
function raceInNode({ flags = {}, store = memStore() } = {}) {
  const wind = { pattern: null, base: { dirDeg: 210, speedMs: 6 }, levelSet: [], setLevel(n) { this.levelSet.push(n); this.level = n; return 1; },
    sample(x, z, t) { const d = 210 + (this.pattern ? this.pattern.deg(t) : 0), v = steadyWind(6, d)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true, sky: () => {} });
  return { R, B, store };
}
// sail on (the helper at the start, ?autoplay's pro after it) until the results card, at most maxS of game time
const sailToCard = (R, maxS = 600) => { for (let k = 0; k < maxS / 10 && !R.stats.result; k++) R.settle(10); return R.stats.result; };
const custom = (store, c) => store.setItem(SETUP_KEY, JSON.stringify({ ...DEFAULT_SETUP, aids: 'beginner', skill: 'easy', useCustom: true, custom: { ...DEFAULT_CUSTOM, ...c } }));

test('the Emerald Cup: the hub continues the stored Cup; the last race closes it (standings, the podium); Start a new Cup begins again', async () => {
  const store = memStore();
  let c = newCup(5, { ...DEFAULT_SETUP, skill: 'easy', aids: 'beginner' });
  const finishOrder = (lead) => Object.fromEntries(CUP.ids.map((id, i) => [id, ((i + lead) % 6) + 1]));
  for (let i = 0; i < 3; i++) c = recordRace(c, finishOrder(i));
  saveCup(store, c);
  const { R } = raceInNode({ store, flags: { autoplay: '1' } });
  await R.enter({ hub: true, deal: true });
  assert.equal(R.cup.results.length, 3, 'the stored Cup read back');
  R.cupGo();
  assert.equal(R.hubOpen, false); assert.deepEqual(R.hand.cup, { id: c.id, i: 3, of: 4 }); assert.equal(R.hand.event, 'fleet'); assert.equal(R.session.rivals.length, 5);
  assert.equal(R.hand.course, c.races[3].course); assert.equal(R.hand.length, c.races[3].length);
  const res = sailToCard(R);
  assert.ok(res && res.place >= 1, JSON.stringify(res));
  const stored = loadCup(store);
  assert.equal(stored.results.length, 4, 'the race\'s places saved'); assert.equal(stored.results[3].me, res.place);
  assert.deepEqual(res.cup, { sailed: 4, done: true }); assert.equal(R.stats.cup.done, true);
  assert.equal(new Set(Object.values(stored.results[3])).size, 6, 'six places, each once');
  // the card again a second later: the Cup is not scored twice
  R.settle(2); assert.equal(loadCup(store).results.length, 4);
  // Start a new Cup (the results card): a new Cup's first race at once, no hub
  R.cupNew();
  assert.equal(R.hubOpen, false); assert.equal(R.cup.results.length, 0); assert.notEqual(R.cup.id, c.id); assert.equal(R.hand.cup.i, 0);
  assert.equal(R.stats.result, null, 'a fresh race');
  assert.equal(loadCup(store).id, R.cup.id, 'the new Cup saved');
  // a broken store: the hub's Cup card offers a new Cup
  store.setItem(CUP_KEY, '{"v":1,"id":3,"races":[1,2]}');
  const b = raceInNode({ store }); await b.R.enter({ hub: true, deal: true });
  assert.equal(b.R.cup, null); b.R.cupGo(); assert.equal(b.R.cup.results.length, 0); assert.equal(b.R.hand.cup.i, 0);
});

test('the time trial: alone; the first run kept as the best; the next run sails against its ghost with a split at each mark', async () => {
  const store = memStore();
  custom(store, { event: 'trial', course: 'harbour-dash', length: 'short', wind: 3, shifts: 'steady' });
  const { R } = raceInNode({ store, flags: { autoplay: '1' } });
  await R.enter({ hub: true, deal: true });
  R.raceCustom();
  assert.equal(R.hand.event, 'trial'); assert.equal(R.session.rivals.length, 0); assert.equal(R.stats.trial.best, null); assert.equal(R.chip, null);
  const a = sailToCard(R);
  assert.ok(a, 'finished'); const key = trialKey(R.hand), best = loadTrial(store, key);
  assert.ok(best && Math.abs(best.t - R.stats.trial.t) < 0.11, `the best kept (${best?.t})`);
  assert.equal(R.stats.trial.newBest, true); assert.match(a.gap, /First time round/); assert.equal(a.medal, 'gold');
  assert.equal(best.splits.length, R.course.markIds.length, 'a split at each mark'); assert.ok(best.path.length > 60, `the path (${best.path.length} points)`);
  assert.ok(R.stats.splits.every((x) => x.d == null), 'the first run has nothing to beat');
  // Race again: the best run's ghost on the water, a split against it at each mark, the chip says it
  R.restart();
  assert.ok(R.trial.pts.length === best.path.length && R.trial.draw.length > 1, 'the ghost\'s path laid on today\'s course');
  assert.equal(R.stats.trial.best, best.t);
  R.settle(40);
  const g = R.trial.pts.length && R.session.race.clock > 0 ? (await import('../regatta/events.js')).ghostAt(R.trial.pts, R.session.race.clock) : null;
  assert.ok(g && Number.isFinite(g.x), 'the ghost sails');
  const b = sailToCard(R);
  assert.ok(b);
  assert.equal(R.stats.splits.length, R.course.markIds.length);
  assert.ok(R.stats.splits.every((x) => Number.isFinite(x.d)), `splits against the best: ${JSON.stringify(R.stats.splits)}`);
  assert.match(b.tm, /^Mark 1 [+−]\d+\.\d s/);
  // the same boat, the same steady wind: a near-identical run (never a new best by more than a few seconds)
  assert.ok(Math.abs(R.stats.trial.t - best.t) < 8, `${R.stats.trial.t} against ${best.t}`);
});

test('a match race: one rival, the chip "Match · 1 v 1" before the start and the gap in metres after it; a pursuit: its order', async () => {
  const store = memStore();
  custom(store, { event: 'match', course: 'harbour-dash', length: 'short', wind: 3, shifts: 'steady' });
  const { R } = raceInNode({ store, flags: { autoplay: '1' } });
  await R.enter({ hub: true, deal: true });
  R.raceCustom();
  assert.equal(R.session.rivals.length, 1); assert.equal(R.session.event, 'match'); assert.equal(R.session.rivals[0].brain.cover, true);
  // the chip is painted with the race UI (none headless): its words from the race's state
  const words = () => { const r = R.session.race, v = r.view('me'), rv = r.view('wren'); return r.clock < 0 ? 'pre' : (v.progressM ?? 0) - (rv.progressM ?? 0); };
  assert.equal(words(), 'pre');
  R.settle(40);
  assert.ok(Number.isFinite(words()), 'a gap in metres once racing');
  const res = sailToCard(R);
  assert.ok(res && /wins the match|You win the match/.test(res.title), JSON.stringify(res));
  assert.ok(res.event === 'match' && (res.medal === 'gold') === (res.place === 1));
  // a pursuit: the start order said once, the slots in the stats
  custom(store, { event: 'pursuit', course: 'harbour-dash', length: 'short', rivals: 4, wind: 3, shifts: 'steady' });
  const p = raceInNode({ store }); await p.R.enter({ hub: true, deal: true }); p.R.raceCustom();
  assert.equal(p.R.session.event, 'pursuit'); assert.equal(p.R.session.rivals.length, 4);
  assert.ok(p.R.stats.pursuit && /^You start (first|\dnd|\drd|\dth|\dst)/.test(p.R.stats.pursuit.text), JSON.stringify(p.R.stats.pursuit));
  assert.equal(Object.keys(p.R.stats.slots).length, 5);
});
