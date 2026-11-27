// Play as Tessie, the cheat mode: every skill at rank 4, no cooldowns, no trial spent, the save never written; the typed code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHEAT, createCheatCode, cheatBounty } from '../sim/tessieCheat.js';
import { createTessieBounty, BOUNTY, SKILL_ORDER } from '../sim/tessieBounty.js';
import { createSkills, RPG_SKILLS_TABLE, SKILLS } from '../sim/tessieSkills.js';
import { useSkill } from '../sim/tessieTrials.js';
import { createLevelUp } from '../sim/tessieLevelUp.js';
import { V2_ROWS } from '../engine/flags.js';

const store = (init = {}) => { const m = new Map(Object.entries(init)); const writes = []; return { writes, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push(k); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) }; };
const SAVE = { _v: 2, xp: 52, byType: { sail: { wrecked: 3, splashed: 0, first: '2026-11-20', deepestM: 9, unseen: 1, fastestS: null } }, ranks: { dash: 2, lure: 1, sonar: 0, surge: 0, breach: 0 }, trials: { lure: 5, sonar: 4, surge: 2, breach: 5 }, sets: [] };

test('the code: G R U F F, none of her control keys; a wrong key restarts it; the same code turns it off again', () => {
  const controls = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyC', 'KeyT', 'Space', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  assert.ok(CHEAT.code.every((k) => !controls.includes(k)), 'no letter of the code is a control');
  assert.equal(CHEAT.code.map((k) => k.slice(3).toLowerCase()).join(''), CHEAT.word);
  const K = createCheatCode();
  const type = (codes) => codes.map((c) => K.feed(c)).filter(Boolean).length;
  assert.equal(type(CHEAT.code), 1, 'typed once: on');
  assert.equal(type(['KeyG', 'KeyR', 'KeyW', 'KeyU', 'KeyF', 'KeyF']), 0, 'a control key in between breaks it');
  assert.equal(type(['KeyG', 'KeyG', 'KeyR', 'KeyU', 'KeyF', 'KeyF']), 1, 'a repeated first letter starts it again');
  assert.equal(type([...CHEAT.code, ...CHEAT.code]), 2, 'twice: on, then off');
  assert.equal(CHEAT.on, 'Cheat on: every skill, no cooldown.');
});

test('the flag: ?tessiecheat=1 is a row of the v2 flag table, off by default', () => {
  const row = V2_ROWS.find((r) => r.name === 'tessiecheat');
  assert.ok(row && row.default === false && row.parse('1') === true && row.parse('0') === false);
});

test('cheat on: every skill at rank 4, no point to spend, no halo, and a wreck, a spend and a trial never write the save', () => {
  const S = store({ [BOUNTY.key]: JSON.stringify(SAVE) });
  let on = true;
  const B = cheatBounty(createTessieBounty({ storage: S }), { on: () => on, storage: S });
  const before = S.dump();
  const st = B.state();
  assert.deepEqual(SKILL_ORDER.map((id) => st.ranks[id]), [4, 4, 4, 4, 4]);
  assert.equal(st.points, 0); assert.equal(st.xp, 52, 'her XP as the save had it');
  const r = B.score({ kind: 'glass', depthM: 10, hidden: true }, { day: '2026-11-26' });
  assert.ok(r && r.xp > 0 && B.state().xp === 52 + r.xp, 'the wreck counts in play');
  assert.deepEqual(SKILL_ORDER.map((id) => B.state().ranks[id]), [4, 4, 4, 4, 4], 'still rank 4 after a level');
  assert.equal(B.state().points, 0);
  assert.equal(B.spend('lure').ok, false); assert.equal(B.trial('sonar').ok, false);
  const L = createLevelUp({ bounty: B }); L.levelUp(); assert.deepEqual(L.halo(), [], 'no glowing slot');
  const u = useSkill({ bounty: B, id: 'breach', run: (id, rank) => rank === 4 });
  assert.ok(u.used && !u.trial && u.rank === 4, 'a locked skill fires at rank 4, no trial spent');
  assert.deepEqual(S.writes, [], 'nothing written'); assert.deepEqual(S.dump(), before, 'the save byte for byte');
  // off: the real save again, as it was; the cheat's XP is dropped
  on = false;
  assert.equal(B.state().xp, 52); assert.equal(B.state().ranks.lure, 1); assert.equal(B.state().trials.sonar, 4);
  assert.equal(B.state().byType.glass.wrecked, 0, 'the cheat\'s wreck is not in the save');
  on = true; assert.equal(B.state().xp, 52, 'a new cheat starts again from the save');
});

test('cheat on with no save on the device: a blank copy in memory; nothing is created in the store', () => {
  const S = store();
  const B = cheatBounty(createTessieBounty({ storage: S }), { on: () => true, storage: S });
  assert.equal(B.state().ranks.breach, 4); B.score({ kind: 'sail', depthM: 2 }, {});
  assert.deepEqual(S.writes, []);
});

test('no cooldowns: free(true) makes a skill ready once its active phase ends; the Sonar re-pings while its marks last; free(false) restores the cooldown', () => {
  const S = createSkills(SKILLS);
  S.free(true);
  assert.ok(S.press('dash')); S.step(SKILLS.dash.activeS + 0.01);
  assert.equal(S.state('dash').phase, 'ready', 'no cooldown after the burst');
  assert.ok(S.press('dash'));
  S.free(false); S.step(SKILLS.dash.activeS + 0.01);
  assert.equal(S.state('dash').phase, 'cool'); assert.equal(S.press('dash'), false);
  const R = createSkills(RPG_SKILLS_TABLE); R.free(true);
  assert.ok(R.press('sonar')); R.step(1);
  assert.equal(R.state('sonar').phase, 'active'); assert.ok(R.press('sonar'), 'a second ping while the first one\'s marks last'); assert.equal(R.state('sonar').count, 2);
  assert.ok(R.press('surge')); R.step(0.5); assert.equal(R.press('surge'), false, 'the Tail Surge never restarts mid-wave');
  R.free(false); assert.equal(R.press('sonar'), false, 'off: one ping at a time again');
  // a skill cooling when the cheat comes on is ready at the next step
  const D = createSkills(SKILLS); D.press('dash'); D.step(SKILLS.dash.activeS + 0.5); assert.equal(D.state('dash').phase, 'cool');
  D.free(true); D.step(0.016); assert.equal(D.state('dash').phase, 'ready');
});
