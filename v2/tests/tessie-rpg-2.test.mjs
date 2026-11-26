// The Tessie RPG, phase 2 (?tessierpg=1): the level-up moment's rules (v2/sim/tessieLevelUp.js), the Dash's ranks
// (v2/sim/tessieSkills.js), the five slots' layout and pips (v2/ui/tessieHud.js), the South Lake runabouts and jet skis in the bounty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelUp, LEVEL_UP, pickable } from '../sim/tessieLevelUp.js';
import { createTessieBounty, scoreInto, blankSave, normalise, BOUNTY, BOUNTY_KIND, SETS, TYPES } from '../sim/tessieBounty.js';
import { createSkills, SKILLS, DASH_RANKS, SLOT_COUNT, RPG_SLOT_COUNT } from '../sim/tessieSkills.js';
import { hudLayout, pipsOf, RPG_LEGEND, LEGEND, legendLineOf, legendLevels, HUD } from '../ui/tessieHud.js';
import { classOf, LEAN_REPEAT, TIP } from '../ui/leanSkipper.js';

const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// a store holding a save at level 4 (52 XP) with Dash at rank `dash`: 4 − 1 − (dash − 1) points to spend
const seeded = (ranks = { dash: 1 }, xp = 52) => memStore({ [BOUNTY.key]: JSON.stringify({ _v: 1, xp, ranks }) });
// the skipper's line as the lean would take it: taken unless refused
const sayer = (ok = () => true) => { const said = []; return { said, say: (text) => { const y = ok(text); if (y) said.push(text); return y; } }; };
const run = (U, s, { dt = 0.1, still = false, say, lineUp = null } = {}) => { for (let t = 0; t < s - 1e-9; t += dt) U.step(dt, { still, say, lineUp }); };

test('a level reached: the line asks at once, "Level N: pick one skill to grow."; the halo is every skill a point can go to', () => {
  const T = createTessieBounty({ storage: seeded() }), U = createLevelUp({ bounty: T }), S = sayer();
  assert.deepEqual(U.halo(), ['dash', 'lure'], 'Dash can grow, Lure can unlock; Sonar waits for Lure');
  U.levelUp(); U.step(0.1, { say: S.say });
  assert.deepEqual(S.said, ['Level 4: pick one skill to grow.']);
  assert.equal(U.open, true);
  assert.equal(LEVEL_UP.lineS, 7);
  assert.equal(classOf(LEVEL_UP.kind), TIP, 'a TIP on the lean skipper: the 20 s gap and the busy rule still hold');
  assert.ok(LEAN_REPEAT[LEVEL_UP.kind] && LEAN_REPEAT[LEVEL_UP.kind].max === Infinity, 'it may come back with no cap');
});

test('a press on a glowing slot within the line picks; outside the halo, or after the line, it is the skill own press', () => {
  const st = seeded(), T = createTessieBounty({ storage: st }), U = createLevelUp({ bounty: T }), S = sayer();
  U.levelUp(); U.step(0.1, { say: S.say });
  assert.deepEqual(U.press('sonar'), { pick: false, why: 'not-pickable' }, 'Sonar does not glow (Lure first)');
  run(U, 3, { say: S.say });
  const p = U.press('lure');
  assert.equal(p.pick, true); assert.equal(p.rank, 1); assert.equal(p.points, 2);
  assert.equal(T.state().ranks.lure, 1, 'the point spent: Lure unlocked');
  assert.equal(U.open, true, 'points left: the line stays open');
  assert.deepEqual(U.halo(), ['dash', 'lure', 'sonar'], 'Sonar glows now');
  run(U, 4.5, { say: S.say });   // 7.6 s since the line: closed
  assert.equal(U.open, false);
  assert.deepEqual(U.press('dash'), { pick: false, why: 'closed' }, 'after the line: the Dash fires as usual');
  assert.equal(T.state().ranks.dash, 1);
  assert.deepEqual(U.halo(), ['dash', 'lure', 'sonar'], 'the halo stays while a point waits');
});

test('the last point picked closes the line; the halo goes', () => {
  const T = createTessieBounty({ storage: seeded({ dash: 3 }) }), U = createLevelUp({ bounty: T }), S = sayer();
  U.levelUp(); U.step(0.1, { say: S.say });
  assert.equal(T.state().points, 1);
  assert.equal(U.press('dash').pick, true);
  assert.equal(T.state().ranks.dash, 4);
  assert.equal(U.open, false); assert.deepEqual(U.halo(), []);
  assert.deepEqual(U.press('lure'), { pick: false, why: 'closed' });
});

test('the line closes early when the skipper line goes (another line took the row)', () => {
  const T = createTessieBounty({ storage: seeded() }), U = createLevelUp({ bounty: T }), S = sayer();
  U.levelUp(); U.step(0.1, { say: S.say });
  U.step(0.1, { say: S.say, lineUp: false });
  assert.equal(U.open, false);
  assert.equal(U.press('lure').pick, false);
});

test('a refused line asks again every second until the lean takes it; nothing asks without a point', () => {
  let open = false;
  const T = createTessieBounty({ storage: seeded() }), U = createLevelUp({ bounty: T }), S = sayer(() => open);
  let asks = 0; const say = (x) => { asks++; return S.say(x); };
  U.levelUp(); run(U, 3.3, { say, dt: 0.25 });
  assert.equal(asks, 4, 'at 0.25, 1.25, 2.25, 3.25 s'); assert.equal(U.open, false);
  open = true; run(U, 1.0, { say });
  assert.equal(S.said.length, 1); assert.equal(U.open, true);
  const none = createLevelUp({ bounty: createTessieBounty({ storage: memStore() }) }), N = sayer();
  none.levelUp(); run(none, 70, { still: true, say: N.say });
  assert.deepEqual(N.said, [], 'level 1, no point: no line'); assert.deepEqual(none.halo(), []);
});

test('the point waits: the line comes back once she is still 2 s, at most every 60 s, with no cap', () => {
  const T = createTessieBounty({ storage: seeded() }), U = createLevelUp({ bounty: T }), S = sayer();
  run(U, 1.9, { still: true, say: S.say });
  assert.equal(S.said.length, 0, 'still under 2 s: no line yet');
  run(U, 0.2, { still: true, say: S.say });
  assert.equal(S.said.length, 1, 'a waiting point (a seeded save): the line once she is still 2 s');
  run(U, 30, { still: true, say: S.say });
  assert.equal(S.said.length, 1, 'never within 60 s of the last');
  run(U, 40, { still: false, say: S.say });
  assert.equal(S.said.length, 1, 'swimming: no line, however long');
  run(U, 1.5, { still: true, say: S.say });
  assert.equal(S.said.length, 1, 'still 1.5 s: not yet');
  run(U, 0.6, { still: true, say: S.say });
  assert.equal(S.said.length, 2, 'still 2 s, 70 s after the last: again');
  for (let i = 0; i < 5; i++) run(U, 61, { still: true, say: S.say });
  assert.equal(S.said.length, 7, 'no cap: once every 60 s while she rests');
  assert.equal(T.state().points, 3, 'the points never expire');
});

test('spent elsewhere (the Logbook tab): the halo clears when no point is left; the line stops', () => {
  const st = seeded({ dash: 3 }), T = createTessieBounty({ storage: st }), U = createLevelUp({ bounty: T }), S = sayer();
  U.levelUp(); U.step(0.1, { say: S.say });
  assert.deepEqual(U.halo(), ['dash', 'lure']);
  createTessieBounty({ storage: st }).spend('lure');   // the Logbook's own holder of the same save
  assert.deepEqual(U.halo(), []);
  U.step(0.1, { say: S.say });
  assert.equal(U.open, false);
  run(U, 200, { still: true, say: S.say });
  assert.equal(S.said.length, 1);
});

test('pickable follows the unlock order and the cap', () => {
  const s = normalise({ _v: 1, xp: 1045, ranks: { dash: 4, lure: 4, sonar: 1 } });
  assert.deepEqual(pickable(s), ['sonar', 'surge']);
  assert.deepEqual(pickable({ ...s, points: 0 }), []);
});

test('the Dash by rank: burst/cooldown 1.8/4.5 → 2.1/4.0 → 2.4/3.5 → 2.6/3.0 s; rank 4 bites × 1.25 (× 1.15 below)', () => {
  assert.deepEqual(DASH_RANKS.slice(1).map((r) => [r.activeS, r.cooldownS, r.bite]), [[1.8, 4.5, 1.15], [2.1, 4.0, 1.15], [2.4, 3.5, 1.15], [2.6, 3.0, 1.25]]);
  const S = createSkills(SKILLS);
  assert.equal(S.state('dash').bite, null, 'no rank set (the flag off): the bite keeps its own knock');
  const cycle = (rank) => {
    const K = createSkills(SKILLS); assert.equal(K.rank('dash', rank), true);
    assert.equal(K.state('dash').level, rank);
    K.press('dash'); let active = 0, cool = 0;
    for (let i = 0; i < 1000 && (K.state('dash').phase !== 'ready' || i === 0); i++) { const ph = K.state('dash').phase; K.step(0.01); if (ph === 'active') active += 0.01; else if (ph === 'cool') cool += 0.01; }
    return [+active.toFixed(1), +cool.toFixed(1), K.state('dash').bite];
  };
  assert.deepEqual(cycle(1), [1.8, 4.5, 1.15]);
  assert.deepEqual(cycle(2), [2.1, 4.0, 1.15]);
  assert.deepEqual(cycle(3), [2.4, 3.5, 1.15]);
  assert.deepEqual(cycle(4), [2.6, 3.0, 1.25]);
  assert.equal(S.rank('dash', 0), false, 'the Dash is never locked'); assert.equal(S.rank('dash', 5), false); assert.equal(S.rank('lure', 1), false, 'Lure has no numbers yet');
});

test('South Lake: a runabout knocked down 3 XP, the jet ski rider splashed 2 XP, both in the South Lake set', () => {
  assert.equal(BOUNTY_KIND.power, 'runabout'); assert.equal(BOUNTY_KIND.jetski, 'jetski');
  assert.deepEqual(TYPES.filter((t) => t.live).map((t) => t.id), ['sail', 'halcyon', 'glass', 'kayak', 'runabout', 'jetski']);
  assert.deepEqual(SETS.find((x) => x.id === 'south').types, ['paddle', 'still', 'kayak', 'runabout', 'jetski']);
  const s = blankSave();
  let r = scoreInto(s, { kind: 'runabout', depthM: 1 }); assert.equal(r.xp, 9, 'the first runabout: 3 × 3');
  r = scoreInto(s, { kind: 'runabout', depthM: 1 }); assert.equal(r.xp, 3);
  r = scoreInto(s, { kind: 'jetski', splash: true, depthM: 0 }); assert.equal(r.xp, 6, 'the first jet ski: 2 × 3');
  r = scoreInto(s, { kind: 'jetski', splash: true, depthM: 0 }); assert.equal(r.xp, 2);
  assert.deepEqual([s.byType.runabout.wrecked, s.byType.jetski.splashed, s.byType.jetski.wrecked], [2, 2, 0]);
  s.byType.kayak.splashed = 1;
  r = scoreInto(s, { kind: 'jetski', splash: true }); assert.equal(r.set, null, 'the set waits for the paddle-wheeler and an anchored boat');
});

test('five slots fit between the dials: 1280, 1180 and 1100 px wide, and a tablet; flag off keeps four', () => {
  assert.equal(SLOT_COUNT, 4); assert.equal(RPG_SLOT_COUNT, 5); assert.equal(HUD.slots, 4);
  for (const w of [1280, 1180, 1100, 1000]) {
    const L = hudLayout({ w, h: 720, slots: 5 }), r = L.skills, right = r.left + r.width;
    assert.equal(r.width, 5 * r.slot + 4 * r.gap);
    assert.ok(r.left >= L.depth.left + L.depth.size + 24, `${w}: clear of DEPTH (${r.left})`);
    assert.ok(right <= w - L.sonar.right - L.sonar.size - 24, `${w}: clear of SONAR (${right})`);
  }
  assert.equal(hudLayout({ w: 1280, slots: 5 }).skills.width, 368);
  const T = hudLayout({ w: 1180, h: 820, tablet: true, slots: 5 }).skills;
  assert.ok(T.left >= 1180 * 0.4 && T.left + T.width <= 1180 - 236, 'a tablet: inside the free band');
  assert.equal(hudLayout({ w: 1280 }).skills.width, 4 * 64 + 3 * 12, 'four slots by default');
});

test('the pips: four by rank, none on a locked skill; the legend gains a line per skill, keyed 2 to 5', () => {
  assert.deepEqual(pipsOf(0), []); assert.deepEqual(pipsOf(1), [true, false, false, false]); assert.deepEqual(pipsOf(4), [true, true, true, true]);
  assert.deepEqual(RPG_LEGEND.map((l) => l.id), ['swim', 'dash', 'lure', 'sonar', 'surge', 'breach', 'bite', 'updown', 'view', 'boat']);
  assert.equal(legendLineOf('Digit3', RPG_LEGEND), 'sonar'); assert.equal(legendLineOf('Digit5', RPG_LEGEND), 'breach');
  assert.equal(legendLineOf('Digit3'), null, 'flag off: no such line');
  assert.equal(legendLevels({ lure: 3 }, RPG_LEGEND).find((l) => l.id === 'lure').level, 'learned');
  assert.equal(LEGEND.length, 6);
});
