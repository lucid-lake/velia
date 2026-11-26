// The Tessie RPG, phase 1: the bounty's pure module (v2/sim/tessieBounty.js): the XP curve, the multipliers, the old knock total's
// move, a point never lost, the unlock order and the cap, the save's round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNTY, SKILL_ORDER, xpAt, xpToNext, levelOf, blankSave, normalise, migrate, scoreInto, canSpend, spendInto, legendOf, createTessieBounty } from '../sim/tessieBounty.js';

const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };

test('the XP curve: 5L + 5 to the next level; level 2 at 10, 5 at 70, 10 at 270, 15 at 595, 20 at 1,045; never past 20', () => {
  assert.deepEqual([1, 2, 3, 4].map(xpToNext), [10, 15, 20, 25]);
  assert.deepEqual([1, 2, 5, 10, 15, 20].map(xpAt), [0, 10, 70, 270, 595, 1045]);
  assert.equal(levelOf(0), 1); assert.equal(levelOf(9), 1); assert.equal(levelOf(10), 2); assert.equal(levelOf(1044), 19); assert.equal(levelOf(1045), 20); assert.equal(levelOf(99999), 20);
  for (let L = 1; L < 20; L++) assert.equal(xpAt(L + 1) - xpAt(L), xpToNext(L));
  const l = legendOf({ ...blankSave(), xp: 340 });
  assert.equal(l.level, 11); assert.equal(l.at, 325); assert.equal(l.next, 385); assert.ok(l.k > 0 && l.k < 1);
  assert.deepEqual(legendOf({ ...blankSave(), xp: 2000 }), { level: 20, xp: 2000, at: 1045, next: null, k: 1 });
});

test('XP per wreck: the table, × 1.5 from HIDDEN, × 1.5 seen, × 3 the first of a type, + 25 a set', () => {
  const s = blankSave();
  let r = scoreInto(s, { kind: 'sail', depthM: 2 }, { day: '2026-11-26' });
  assert.equal(r.xp, 9, 'the first sailboat: 3 × 3'); assert.equal(r.first, true);
  r = scoreInto(s, { kind: 'sail', depthM: 2 }); assert.equal(r.xp, 3, 'the second: 3');
  r = scoreInto(s, { kind: 'sail', depthM: 9.4 }); assert.equal(r.xp, 5, 'from HIDDEN (deeper than 8 m): 3 × 1.5 = 4.5, rounded');
  assert.equal(r.hidden, true);
  r = scoreInto(s, { kind: 'sail', depthM: 9.4, seen: true }); assert.equal(r.xp, 7, 'hidden and seen: 3 × 2.25 = 6.75');
  r = scoreInto(s, { kind: 'glass', depthM: 1, seen: true }); assert.equal(r.xp, 27, 'the first glass boat, seen: 6 × 1.5 × 3');
  r = scoreInto(s, { kind: 'halcyon', depthM: 0, hidden: true }); assert.equal(r.xp, 18, 'hidden given: 4 × 1.5 × 3');
  r = scoreInto(s, { kind: 'kayak', splash: true, depthM: 0 }); assert.equal(r.xp, 3, 'a kayak pair splashed, the first: 1 × 3');
  assert.equal(s.byType.kayak.splashed, 1); assert.equal(s.byType.kayak.wrecked, 0);
  const row = s.byType.sail;
  assert.deepEqual(row, { wrecked: 4, splashed: 0, first: '2026-11-26', deepestM: 9.4, unseen: 2, fastestS: null });
  assert.equal(scoreInto(s, { kind: 'power' }), null, 'a kind with no row scores nothing');
  assert.equal(scoreInto(s, { kind: 'jetski' }), null);
  // a set: every type of Emerald Bay (the rival's row filled by hand: no rival is a target yet)
  s.byType.rival.wrecked = 1;
  const xp0 = s.xp;
  r = scoreInto(s, { kind: 'kayak', splash: true }); assert.equal(r.set, 'emerald'); assert.equal(r.xp, 1 + 25); assert.equal(s.xp, xp0 + 26);
  r = scoreInto(s, { kind: 'kayak', splash: true }); assert.equal(r.set, null, 'a set pays once');
});

test('levels and points: one point a level, reported as the levels crossed; the level 20 cap', () => {
  const s = blankSave();
  const r = scoreInto(s, { kind: 'glass', depthM: 9, seen: true });   // 6 × 1.5 × 1.5 × 3 = 40.5 → 41 XP: level 3 (25), not 4 (45)
  assert.equal(r.xp, 41); assert.deepEqual(r.levels, [2, 3]); assert.equal(s.level, 3); assert.equal(s.points, 2);
  s.xp = xpAt(20) - 1; const r2 = scoreInto(s, { kind: 'sail' }); assert.equal(s.level, 20); assert.equal(s.points, 19); assert.deepEqual(r2.levels, [20]);
  scoreInto(s, { kind: 'sail' }); assert.equal(s.level, 20, 'never past 20'); assert.equal(s.points, 19);
});

test('the unlock order (Lure → Sonar → Surge → Breach), the cap at rank 4, an unlock costs a point, Dash rank 1 free: 19 ranks to buy', () => {
  const s = normalise({ _v: 1, xp: xpAt(20) });
  assert.equal(s.points, 19); assert.equal(s.ranks.dash, 1);
  assert.equal(canSpend(s, 'sonar'), 'order'); assert.equal(canSpend(s, 'breach'), 'order');
  assert.equal(spendInto(s, 'sonar').ok, false);
  assert.equal(spendInto(s, 'lure').ok, true); assert.equal(s.points, 18);
  assert.equal(canSpend(s, 'sonar'), null);
  for (const id of ['sonar', 'surge', 'breach']) assert.ok(spendInto(s, id).ok, id);
  assert.equal(s.points, 15);
  let bought = 4;
  for (const id of SKILL_ORDER) while (spendInto(s, id).ok) bought++;
  assert.equal(bought, 19); assert.equal(s.points, 0);
  for (const id of SKILL_ORDER) { assert.equal(s.ranks[id], 4); assert.equal(canSpend(s, id), 'max'); }
  const t = normalise({ _v: 1, xp: 0 }); assert.equal(canSpend(t, 'lure'), 'points'); assert.equal(canSpend(t, 'dash'), 'points'); assert.equal(canSpend(t, 'nope'), 'unknown');
});

test('a point is never lost: points are earned − spent on every read, whatever the save says', () => {
  const s = normalise({ _v: 1, xp: xpAt(6), points: 0, ranks: { dash: 2 } });   // a save that wrote points 0 by mistake
  assert.equal(s.level, 6); assert.equal(s.points, 4, 'level 6: 5 earned, 1 spent on Dash');
  const t = normalise({ _v: 1, xp: xpAt(3), ranks: { dash: 4, lure: 4, sonar: 4 } });   // more ranks than levels (hand-edited): refunded from the top
  assert.equal(t.points, 0); assert.ok(t.points >= 0); assert.equal(t.level - 1, Object.values(t.ranks).reduce((a, b) => a + b, 0) - 1);
  const u = normalise({ _v: 1, xp: xpAt(10), ranks: { dash: 1, lure: 0, sonar: 3 } });   // a rank past a locked slot: refunded
  assert.equal(u.ranks.sonar, 0); assert.equal(u.points, 9);
  const v = normalise({ _v: 1, xp: -5, ranks: { dash: 0 } }); assert.equal(v.xp, 0); assert.equal(v.ranks.dash, 1); assert.equal(v.points, 0);
  // through the store: score, spend, read again: earned − spent each time
  const st = memStore(), T = createTessieBounty({ storage: st });
  for (let i = 0; i < 12; i++) T.score({ kind: 'sail', depthM: 3 }, { day: '2026-11-26' });
  const a = T.state(); assert.equal(a.points, a.level - 1);
  assert.ok(T.spend('lure').ok); const b = T.state(); assert.equal(b.points, a.points - 1); assert.equal(b.ranks.lure, 1);
  const j = JSON.parse(st.map.get(BOUNTY.key)); j.points = 0; st.setItem(BOUNTY.key, JSON.stringify(j));   // a stale writer
  assert.equal(T.state().points, b.points, 'a stale points field is repaired on the next read');
});

test('the migration: the old knock total moves into sail.wrecked on the first read, once, with no XP', () => {
  const m = migrate(null, '7'); assert.equal(m.migrated, true); assert.equal(m.save.byType.sail.wrecked, 7); assert.equal(m.save.xp, 0);
  assert.equal(migrate(null, null).save.byType.sail.wrecked, 0);
  assert.equal(migrate(null, 'junk').save.byType.sail.wrecked, 0);
  assert.equal(migrate('{not json', '3').save.byType.sail.wrecked, 3, 'a corrupt save starts again from the knocks');
  const st = memStore({ [BOUNTY.knocksKey]: '5' }), T = createTessieBounty({ storage: st });
  assert.equal(T.state().byType.sail.wrecked, 5);
  assert.ok(st.map.has(BOUNTY.key), 'written at the first read');
  st.setItem(BOUNTY.knocksKey, '9');   // the old counter keeps counting elsewhere: never read again
  assert.equal(T.state().byType.sail.wrecked, 5);
  T.score({ kind: 'sail', depthM: 1 });
  assert.equal(T.state().byType.sail.wrecked, 6); assert.equal(T.state().xp, 3, 'not the first of its type: the migrated count holds it');
});

test('the save round trip: _v, every field kept, a fresh holder reads the same; no store keeps it in memory', () => {
  const st = memStore(), T = createTessieBounty({ storage: st });
  T.score({ kind: 'glass', depthM: 9.6, seen: true, sinceS: 4.23 }, { day: '2026-11-26' });
  T.score({ kind: 'kayak', splash: true }, { day: '2026-11-27' });
  T.spend('dash');
  const raw = JSON.parse(st.map.get(BOUNTY.key));
  assert.equal(raw._v, 1);
  assert.deepEqual(Object.keys(raw).sort(), ['_v', 'byType', 'level', 'points', 'ranks', 'sets', 'xp']);
  assert.deepEqual(raw.byType.glass, { wrecked: 1, splashed: 0, first: '2026-11-26', deepestM: 9.6, unseen: 1, fastestS: 4.2 });
  assert.equal(raw.byType.kayak.first, '2026-11-27');
  const U = createTessieBounty({ storage: st });
  assert.deepEqual(U.state(), normalise(raw)); assert.deepEqual(U.state(), T.state());
  assert.equal(U.state().ranks.dash, 2);
  const M = createTessieBounty({ storage: null });
  M.score({ kind: 'sail' }); assert.equal(M.state().xp, 9);
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const B = createTessieBounty({ storage: bad }); assert.equal(B.state().xp, 0); B.score({ kind: 'sail' }); assert.equal(B.state().xp, 9, 'a store that throws: kept in memory');
});

test('the Logbook\'s Tessie page (v2/ui/tessieLog.js): the level line, the bounty rows, the skill rows; a press spends a point', async () => {
  const { tessiePage, levelLine } = await import('../ui/tessieLog.js');
  assert.equal(levelLine(normalise({ _v: 1, xp: 40 })), 'Level 3 · 40 / 45 XP · 2 points to spend');
  assert.equal(levelLine(normalise({ _v: 1, xp: 5, ranks: {} })), 'Level 1 · 5 / 10 XP');
  assert.match(levelLine(normalise({ _v: 1, xp: 1100 })), /^Level 20 · 1100 XP · the Lake’s legend · 19 points to spend$/);
  const st = memStore(), T = createTessieBounty({ storage: st }), P = tessiePage({ bounty: T, mark: '<svg></svg>' });
  T.score({ kind: 'sail', depthM: 9.4 }, { day: '2026-11-26' }); T.score({ kind: 'kayak', splash: true }, { day: '2026-11-26' });
  let [b, k] = P.views();
  assert.deepEqual(b.rows.map((r) => r.id), ['sail', 'halcyon', 'glass', 'kayak'], 'only the boats on the water today');
  assert.match(b.rows[0].g, /1 wrecked · deepest from 9\.4 m · 1 unseen · first 2026-11-26/); assert.equal(b.rows[0].got, true);
  assert.equal(b.rows[1].g, 'not yet'); assert.match(b.rows[3].g, /^1 splashed/);
  assert.match(b.lead, /Level 2 · 17 \/ 25 XP · 1 point to spend/);
  assert.deepEqual(k.rows.map((r) => [r.id, r.press]), [['dash', true], ['lure', true], ['sonar', false], ['surge', false], ['breach', false]]);
  assert.match(k.rows[2].g, /after Lure/);
  assert.equal(P.press('sonar'), false, 'out of order: nothing spent');
  assert.equal(P.press('lure'), true); assert.equal(P.press('lure'), false, 'no point left');
  [, k] = P.views();
  assert.equal(T.state().ranks.lure, 1); assert.equal((k.rows[1].t.match(/pip on/g) ?? []).length, 1); assert.equal(k.rows.every((r) => !r.press), true);
});
