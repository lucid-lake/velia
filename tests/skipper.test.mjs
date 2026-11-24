// The old skipper (src/ui/skipper.js): the voice rules hold for every hint line and every
// margin note, and every skill has one note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEADS, TEXT, MOUSE_TEXT, MARGIN, SIGN, spoken } from '../src/ui/skipper.js';
import { PHRASES, createWords } from '../src/ui/words.js';
import { SKILL_IDS, SKILLS } from '../src/sail/skills.js';

const stub = (mastered = [], pro = false) => ({ mastered: (id) => mastered.includes(id), pro });
const plainText = (h) => String(h).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const wordsOf = (s) => s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;

test('every lead has a phrase, and lead + phrase is at most 12 words at both levels, with no exclamation mark', () => {
  for (const k of Object.keys(LEADS)) {
    assert.ok(PHRASES[k], `${k}: a phrase in words.js`);
    for (const [lvl, w] of [['plain', createWords({ skills: stub() })], ['sailor', createWords({ skills: stub([], true) })]]) {
      const s = spoken(k, w);
      assert.ok(wordsOf(s) <= 12, `${k}/${lvl}: "${s}" is ${wordsOf(s)} words`);
      assert.ok(!/!/.test(s) && /^[A-Z]/.test(s) && /\.$/.test(s), `${k}/${lvl}: "${s}"`);
    }
    // the on-screen line, with the term tag, is the same words
    const shown = plainText(createWords({ skills: stub() }).expand(`${LEADS[k]} §${k}§`, { mouse: false }));
    assert.ok(wordsOf(shown) <= 14, `${k}: "${shown}"`);
  }
  for (const s of [...Object.values(TEXT), ...Object.values(MOUSE_TEXT)]) assert.ok(wordsOf(s) <= 12 && !/!/.test(s), s);
});

test('plain words first: the plain line speaks no sailing term the tag has not named', () => {
  assert.equal(spoken('pull', createWords({ skills: stub() })), 'Sails shaking. Pull the sails in.');
  assert.equal(spoken('pull', createWords({ skills: stub(['trim']) })), 'Sails shaking. Trim the sheets.');
  assert.equal(spoken('chart', createWords({ skills: stub() })), 'Lost? The chart shows where you are.');
});

test('one margin note per skill, signed R., short, no exclamation mark', () => {
  assert.equal(SIGN, '— R.');
  for (const id of SKILL_IDS) { const n = MARGIN[id]; assert.ok(n, `a note for ${id}`); assert.ok(wordsOf(n) <= 14 && !/!/.test(n), n); }
  assert.deepEqual(Object.keys(MARGIN).sort(), [...SKILL_IDS].sort());
  assert.equal(SKILLS.length, SKILL_IDS.length);
});
