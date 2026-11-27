// The Tessie RPG, phase 6b: Tessie's Deep carries the player's own Tessie ranks (?tessierpg=1 with a bounty save). Her acts by rank
// (Dash rank 2: a dash across the bow, then the race's strike; Tail Surge: a ring wave that heels; Breach: a breach beside the course,
// a heel wave), each warned for the race's DEEP.warnS, escapable by a steer, never a knock from a wave; no flag or no save: today's
// race. The Emerald Bay set without the Regatta rival (a rival sails only in races, where she is never played).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessieDeep, actPlan, DEEP, DEACT } from '../regatta/tessieDeep.js';
import { actsOf } from '../regatta/tessieDeepRpg.js';
import { SURGE_RANKS } from '../sim/tessieSurge.js';
import { readRanks, BOUNTY, SETS, blankSave, scoreInto } from '../sim/tessieBounty.js';
import { areaOf } from '../stage/areas.js';
import { createRegatta } from '../regatta/index.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const DEG = Math.PI / 180, area = areaOf('tessieWaters'), pace = 2;
const mem = (init = {}) => { const m = new Map(Object.entries(init)); let writes = 0; return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { writes++; m.set(k, String(v)); }, get writes() { return writes; } }; };
const saveWith = (ranks, xp = 1100) => JSON.stringify({ ...blankSave(), xp, ranks: { ...blankSave().ranks, ...ranks } });
const boat = (id, x, z, hd, o = {}) => ({ id, x, z, heading: hd * DEG, u: 3, progress: 0, status: 'racing', held: false, ...o });

// one attack sailed on the race clock: the player at her water's middle heading `hd`, holding course or turning `turnDeg` at
// `turnAt` s after the warning; → { warn, events: [[t - t0, e]], me (where the player ended) }
function sail(acts, { hd = 0, turnDeg = 0, turnAt = 1, seed = 3, stepS = 0.25 } = {}) {
  const D = createTessieDeep({ area, pace, seed, acts });
  let me = boat('me', area.x, area.z + 60, hd, { progress: 100 });
  const t0 = DEEP.firstS * pace;
  const warn = D.step(t0, { boats: [me] })[0];
  const events = [];
  for (let t = t0 + stepS; t <= t0 + (DEEP.warnS + DEEP.strikeS + 2) * pace; t += stepS) {
    if (turnDeg && t - t0 >= turnAt && !me.turned) me = { ...me, heading: me.heading + turnDeg * DEG, turned: true };
    me = { ...me, x: me.x + Math.sin(me.heading) * me.u * stepS, z: me.z - Math.cos(me.heading) * me.u * stepS };
    for (const e of D.step(t, { boats: [me] })) events.push([+(t - t0).toFixed(2), e]);
    if (events.some(([, e]) => e.type === 'dive')) break;
  }
  return { D, warn, events, me };
}
const of = (r, type) => r.events.filter(([, e]) => e.type === type);

test('her acts from your ranks: Dash rank 2, Tail Surge unlocked (its rank\'s ring), Breach unlocked; none: null', () => {
  assert.equal(actsOf(null), null);
  assert.equal(actsOf(blankSave().ranks), null, 'a new save (Dash rank 1): today\'s race');
  assert.deepEqual(actsOf({ dash: 2 }).map((a) => a.kind), ['dash']);
  assert.deepEqual(actsOf({ dash: 1, lure: 1, sonar: 1, surge: 3, breach: 1 }).map((a) => a.kind), ['surge', 'breach']);
  assert.equal(actsOf({ surge: 3 })[0].row, SURGE_RANKS[3]);
  assert.deepEqual(actsOf({ dash: 4, surge: 1, breach: 2 }).map((a) => a.kind), ['dash', 'surge', 'breach']);
});

test('readRanks: the save\'s ranks, read-only (no write, not even a migration); no save: null', () => {
  assert.equal(readRanks(mem()), null);
  assert.equal(readRanks(null), null);
  assert.equal(readRanks({ getItem() { throw new Error('private window'); } }), null);
  const s = mem({ [BOUNTY.key]: saveWith({ dash: 2, lure: 1, sonar: 1, surge: 1 }) });
  assert.deepEqual(readRanks(s), { dash: 2, lure: 1, sonar: 1, surge: 1, breach: 0 });
  const old = mem({ [BOUNTY.key]: JSON.stringify({ _v: 1, xp: 300, ranks: { dash: 2 } }) });
  assert.equal(readRanks(old).dash, 2);
  assert.equal(s.writes + old.writes, 0, 'never written');
});

test('no acts: the race director is today\'s exactly (the same warnings, strikes, catches and dives)', () => {
  const fleet = (t) => [boat('me', 200 + t, -120, 42, { progress: 150 + t }), boat('wren', 180, -60 + t * 0.5, 42, { progress: 90 + t })];
  const run = (o) => { const D = createTessieDeep({ area, pace, seed: 5, ...o }), out = []; for (let t = 0; t < 400; t += 0.25) for (const e of D.step(t, { boats: fleet(t) })) out.push([t, JSON.stringify(e)]); return out; };
  const base = run({});
  assert.ok(base.length > 20);
  assert.deepEqual(run({ acts: null }), base);
  assert.deepEqual(run({ acts: actsOf(blankSave().ranks) }), base);
  assert.ok(base.every(([, e]) => !e.includes('"act"')), 'no act field in today\'s events');
});

test('Dash rank 2: warned for the race\'s warning, she runs across the bow from 60 m off; holding on is caught by her ring, a tack escapes', () => {
  const acts = actsOf({ dash: 2 });
  const hold = sail(acts);
  assert.equal(hold.warn.type, 'warn'); assert.equal(hold.warn.act, 'dash'); assert.equal(hold.warn.target, 'me');
  assert.ok(Math.abs(Math.hypot(hold.warn.from[0] - hold.warn.at[0], hold.warn.from[1] - hold.warn.at[1]) - DEACT.dashFromM) < 1e-6, 'her run: 60 m');
  const off = Math.abs(Math.atan2(Math.sin(hold.warn.heading - Math.PI - DEACT.dashOffDeg * DEG * (hold.D.state.plan.side)), Math.cos(hold.warn.heading - Math.PI - DEACT.dashOffDeg * DEG * hold.D.state.plan.side)));
  assert.ok(off < 1e-6, 'she starts ahead and to one side of the bow and runs at the spot');
  const strike = of(hold, 'strike')[0];
  assert.ok(Math.abs(strike[0] - DEEP.warnS * pace) <= 0.25, `the strike after the warning: ${strike[0]} s of race clock`);
  assert.ok(of(hold, 'catch').every(([t]) => t >= strike[0]), 'nothing caught during the warning');
  assert.deepEqual(of(hold, 'catch').map(([, e]) => e.id), ['me'], 'holding on into her ring: the race\'s own catch');
  const tack = sail(acts, { turnDeg: 90 });
  assert.deepEqual(of(tack, 'catch'), [], 'a tack 1 s into the warning escapes');
  assert.deepEqual(of(tack, 'heel'), [], 'a dash makes no wave');
});

test('Tail Surge: she surfaces off the bow at 0.65 × her ring; the wave heels a boat that holds on (capped, away from her, never caught); a bear-away escapes', () => {
  for (const rank of [1, 4]) {
    const acts = actsOf({ dash: 1, lure: 1, sonar: 1, surge: rank }), row = SURGE_RANKS[rank];
    const hold = sail(acts, { hd: 30 });
    assert.equal(hold.warn.act, 'surge'); assert.equal(hold.warn.ringM, row.ringM);
    const strike = of(hold, 'strike')[0];
    assert.ok(Math.abs(strike[0] - DEEP.warnS * pace) <= 0.25, 'the slap after the warning');
    const heels = of(hold, 'heel');
    assert.equal(heels.length, 1, `rank ${rank}: heeled once`);
    const [tH, h] = heels[0];
    assert.ok(tH >= strike[0], 'the wave reaches the boat after the slap');
    assert.ok(h.heelDeg > 5 && h.heelDeg <= DEACT.heelMaxDeg, `a heel, capped: ${h.heelDeg.toFixed(1)}°`);
    // away from her: the side opposite where she lies off the boat
    const c = hold.D.state.last, hd = 30 * DEG, dot = (c[0] - hold.me.x) * Math.cos(hd) + (c[1] - hold.me.z) * Math.sin(hd);
    assert.equal(h.side, dot > 0 ? -1 : 1);
    assert.deepEqual(of(hold, 'catch'), [], 'a wave never knocks a boat down in the race');
    assert.equal(hold.D.ring, null, 'gone after the dive');
    const side = hold.D.state.plan.side;
    const away = sail(acts, { hd: 30, turnDeg: -side * 90 });
    assert.deepEqual(of(away, 'heel'), [], `rank ${rank}: a turn away from her 1 s into the warning stays outside her ring`);
  }
});

test('Breach: beside the course (never on it); the wave heels a boat that holds on; a turn away escapes; nothing is caught', () => {
  const acts = actsOf({ dash: 1, lure: 1, sonar: 1, surge: 1, breach: 1 }).filter((a) => a.kind === 'breach');
  const hold = sail(acts, { hd: -40 });
  assert.equal(hold.warn.act, 'breach');
  const hd = -40 * DEG, me0 = { x: area.x, z: area.z + 60 }, lead = 3 * DEEP.warnS * pace;
  const px = me0.x + Math.sin(hd) * lead, pz = me0.z - Math.cos(hd) * lead;
  const abeam = (hold.warn.at[0] - px) * Math.cos(hd) + (hold.warn.at[1] - pz) * Math.sin(hd);
  assert.ok(Math.abs(Math.abs(abeam) - DEACT.besideM) < 1e-6, `beside the course: ${abeam.toFixed(1)} m abeam`);
  const heels = of(hold, 'heel');
  assert.equal(heels.length, 1); assert.ok(heels[0][1].heelDeg <= DEACT.heelMaxDeg);
  assert.equal(heels[0][1].side, -Math.sign(abeam), 'heeled away from her');
  assert.deepEqual(of(hold, 'catch'), []);
  const away = sail(acts, { hd: -40, turnDeg: -Math.sign(abeam) * 90 });
  assert.deepEqual(of(away, 'heel'), [], 'a turn away 1 s into the warning');
  assert.equal(actPlan('breach', boat('me', 0, 0, 0), area, 10, 1, { depthAt: () => 2 }), null, 'never in water too shallow for her');
});

test('her attacks alternate: an act, today\'s strike, the next act, today\'s strike; an act waits for you (out of her reach: a strike on a rival)', () => {
  const D = createTessieDeep({ area, pace, seed: 2, acts: actsOf({ dash: 2, lure: 1, sonar: 1, surge: 2, breach: 1 }) });
  const acts = [];
  for (let t = 0; t < 900; t += 0.25) {
    const far = t > 600;   // after 600 s the player sails far off her water
    const fleet = [boat('me', far ? 2000 : 280, far ? 2000 : -100, 10, { progress: 200 }), boat('wren', 260, -60, 10, { progress: 50 })];
    for (const e of D.step(t, { boats: fleet })) if (e.type === 'warn') acts.push([far, e.act, e.target]);
  }
  const near = acts.filter((a) => !a[0]).map((a) => a[1]);
  assert.deepEqual(near.slice(0, 8), ['dash', 'strike', 'surge', 'strike', 'breach', 'strike', 'dash', 'strike']);
  for (let i = 1; i < near.length; i++) assert.ok(near[i] === 'strike' || near[i - 1] === 'strike', `never two acts in a row (${near.join()})`);
  for (const a of acts.filter((x) => !x[0] && x[1] !== 'strike')) assert.equal(a[2], 'me', 'an act is aimed at you');
  const farOnes = acts.filter((a) => a[0]);
  assert.ok(farOnes.length >= 2 && farOnes.every((a) => a[1] === 'strike' && a[2] === 'wren'), JSON.stringify(farOnes));
});

test('one act: act, strike, act, strike; acts set after create (their module loaded) give the same race as acts at create', () => {
  const run = (D) => { const out = []; for (let t = 0; t < 400; t += 0.25) for (const e of D.step(t, { boats: [boat('me', 280, -100, 10, { progress: 200 })] })) if (e.type === 'warn') out.push(e.act); return out; };
  const one = run(createTessieDeep({ area, pace, seed: 2, acts: actsOf({ dash: 2 }) }));
  assert.deepEqual(one.slice(0, 4), ['dash', 'strike', 'dash', 'strike']);
  const acts = actsOf({ dash: 2, surge: 1, breach: 1 }), late = createTessieDeep({ area, pace, seed: 2 });
  late.setActs(acts);
  assert.deepEqual(run(late), run(createTessieDeep({ area, pace, seed: 2, acts })));
});

test('the Emerald Bay set: no Regatta rival row (a rival sails only in a race, where she is never played)', () => {
  const S = SETS.find((x) => x.id === 'emerald');
  assert.deepEqual(S.types, ['halcyon', 'sail', 'glass', 'kayak']);
  const s = blankSave();
  for (const k of ['halcyon', 'sail', 'glass']) scoreInto(s, { kind: k });
  assert.equal(scoreInto(s, { kind: 'kayak', splash: true }).set, 'emerald', 'completable without a rival');
});

// the engine: ?tessierpg=1 with a save carries the ranks into the race; no flag, or no save: today's race (the same attacks)
function engine({ flags = {}, store = mem(), sim = null } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const waves = []; const wave0 = B.wave.bind(B); B.wave = (o) => { waves.push(o); return wave0(o); };
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const st = { visible: false, centre: [0, 0], t: 0, phase: 'idle' }, log = [];
  const s = sim ?? { state: st, riseUnder: (x, z, o) => { log.push(['rise', o.breach]); st.visible = true; st.phase = 'swim'; st.centre = [x, z]; }, ambush: (x, z) => { log.push(['ambush']); st.visible = true; st.phase = 'swim'; st.centre = [x, z]; },
    hunt() {}, swimTo: (x, z) => { if (x != null) st.centre = [x, z]; }, ring: () => log.push(['ring']), emit: () => {}, play: (n) => { log.push(['play', n]); if (n === 'dive') { st.visible = false; st.phase = 'idle'; } } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', autoplay: '1', autotier: 'hard', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true, tessie: () => ({ sim: s, raceCue() {} }) });
  return { R, B, waves, log };
}
const sailTo = (R, f, maxS = 400) => { for (let s = 0; s < maxS && !f(); s += 2) R.settle(2); return f(); };

test('engine: no flag, or no save: today\'s Tessie\'s Deep; ?tessierpg=1 with a save: her first attack is your act, warned, aimed at you', async () => {
  const runs = [];
  for (const [flags, store] of [[{}, mem()], [{}, mem({ [BOUNTY.key]: saveWith({ dash: 2 }) })], [{ tessierpg: true }, mem()]]) {
    const { R } = engine({ flags, store });
    await R.enter({ hub: true, deal: true }); R.racePlace('tessies-deep'); await R.deepReady;
    assert.ok(sailTo(R, () => R.deep.state.n >= 2), 'two attacks');
    runs.push(JSON.stringify(R.stats.attacks));
    assert.ok(R.stats.attacks.every((a) => !('act' in a)));
  }
  assert.equal(runs[1], runs[0], 'a save without the flag: today\'s race'); assert.equal(runs[2], runs[0], 'the flag without a save: today\'s race');
  const { R, log } = engine({ flags: { tessierpg: true }, store: mem({ [BOUNTY.key]: saveWith({ dash: 2 }) }) });
  await R.enter({ hub: true, deal: true }); R.racePlace('tessies-deep'); await R.deepReady;
  assert.ok(sailTo(R, () => R.deep.state.n >= 1));
  const w = R.stats.attacks.find((a) => a.type === 'warn');
  if (w.act === 'dash') { assert.equal(w.id, 'me'); assert.ok(log.some((e) => e[0] === 'ambush'), 'her run starts at the surface'); }
  else assert.equal(w.act, 'strike', 'out of her reach at the first attack: today\'s strike');
});

test('engine: Tail Surge in the race: the wave heels the player through the boat\'s own wave roll, the race never knocks her down for it', async () => {
  const { R, B, waves } = engine({ flags: { tessierpg: true }, store: mem({ [BOUNTY.key]: saveWith({ dash: 1, lure: 1, sonar: 1, surge: 4 }) }) });
  await R.enter({ hub: true, deal: true }); R.racePlace('tessies-deep'); await R.deepReady;
  assert.ok(sailTo(R, () => R.deep.state.phase === 'warn' && R.deep.state.act === 'surge', 600), `a surge (${JSON.stringify(R.stats.attacks)})`);
  // hold the player on her slap's spot's edge: the wave reaches her
  const at = R.deep.state.at; B.place({ x: at[0] + 30, z: at[1], headingDeg: 0, speed: 3 }); R.session.t = B.t;
  assert.ok(sailTo(R, () => (R.stats.heels ?? []).some((h) => h.id === 'me'), 60), JSON.stringify(R.stats.heels));
  const h = R.stats.heels.find((x) => x.id === 'me');
  assert.ok(h.heelDeg <= DEACT.heelMaxDeg);
  assert.equal(waves.length, 1); assert.ok(Math.abs(Math.abs(waves[0].heel) / DEG - h.heelDeg) < 0.06);
  R.settle(6);
  assert.deepEqual(R.stats.knocks, [], 'no knockdown from her wave');
  assert.equal(R.held, false);
});

test('engine: a race wave heels a rival too, through its own physics (the same cap), never a knockdown', async () => {
  const { R } = engine({ flags: { tessierpg: true }, store: mem({ [BOUNTY.key]: saveWith({ dash: 1, lure: 1, sonar: 1, surge: 4 }) }) });
  await R.enter({ hub: true, deal: true }); R.racePlace('tessies-deep'); await R.deepReady;
  assert.ok(sailTo(R, () => R.deep.state.phase === 'warn' && R.deep.state.act === 'surge', 600), `a surge (${JSON.stringify(R.stats.attacks)})`);
  // a rival on her slap's ring, inside the knock radius: the wave reaches it at once
  const rv = R.session.rivals.find((b) => R.session.race.view(b.id).status === 'racing'), q = rv.phys.state, at = R.deep.state.at;
  const calls = [], wave0 = R.session.wave; R.session.wave = (id, heel) => { calls.push([id, heel]); return wave0(id, heel); };
  let maxHeel = 0;
  for (let s = 0; s < 30 && !calls.some((c) => c[0] === rv.id); s += 0.5) { q.x = at[0] + 10; q.z = at[1]; R.settle(0.5); }
  const c = calls.find((x) => x[0] === rv.id);
  assert.ok(c, `the wave reached the rival (${JSON.stringify(R.stats.heels)})`);
  assert.ok(Math.abs(c[1]) <= DEACT.heelMaxDeg * DEG + 1e-9, 'the race cap');
  for (let s = 0; s < 4; s += 0.1) { R.settle(0.1); maxHeel = Math.max(maxHeel, Math.abs(q.heel ?? 0) / DEG); }
  assert.ok(maxHeel > 12 && maxHeel < DEACT.heelMaxDeg + 8, `the rival rolled (${maxHeel.toFixed(1)}°)`);
  R.settle(6);
  assert.ok(Math.abs(q.heel ?? 0) / DEG < 30, 'upright again');
  assert.ok(!R.stats.knocks.some((k) => k.id === rv.id) && R.session.race.view(rv.id).status === 'racing', 'never a knockdown from her wave');
});
