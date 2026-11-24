// Touch modality (owner, 2026-10-31: iOS still showed key caps, "W", "scroll or click ▼"): on a touch device the hints and
// the Keys card use the finger's words and show no key cap; keyboard hints stay as they were. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModality } from '../src/ui/pointer.js';
import { createWords } from '../src/ui/words.js';
import { createSkills } from '../src/sail/skills.js';
import { keysPageHtml, TOUCH_ROWS } from '../src/ui/keysContent.js';
import { install } from './helpers/dom-stub.mjs';

const bus = () => { const L = new Map(); return { addEventListener: (t, f) => L.set(t, f), removeEventListener() {}, fire: (t, e = {}) => L.get(t)?.(e) }; };
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('modality: a coarse device is touch before any input; a key or a mouse turns it off; a finger turns it on', () => {
  const t = bus(); const m = createModality({ target: t, coarse: () => true });
  assert.equal(m.touch, true); assert.equal(m.hand, 'touch');
  t.fire('keydown', {}); assert.equal(m.touch, false); assert.equal(m.hand, 'keys');
  t.fire('pointerdown', { pointerType: 'touch' }); assert.equal(m.touch, true); assert.equal(m.kind, 'mouse', 'the pointer kind stays mouse (the old readers)');
  t.fire('pointerdown', { pointerType: 'mouse' }); assert.equal(m.touch, false); assert.equal(m.hand, 'mouse');
  const d = createModality({ target: bus(), coarse: () => false });
  assert.equal(d.touch, false); assert.equal(d.hand, null, 'a Mac before any input: the keyboard wording, as before');
});

test('words: a touch phrase never names a key, both levels; no touch wording falls back to the plain phrase', () => {
  const w = createWords();
  for (const k of ['pull', 'ease', 'irons', 'steer', 'tack', 'gybe', 'heavy', 'groove']) {
    const t = text(w.expand(`§${k}§`, { touch: true }));
    assert.match(t, /\b(tap|drag)\b/i, k + ': ' + t);
  }
  assert.match(text(w.expand('§pull§', { touch: true })), /drag a winch down/);
  assert.match(text(w.expand('§steer§', { touch: true })), /drag the wheel/);
  assert.equal(text(w.expand('§gusts§', { touch: true })), text(w.expand('§gusts§')), 'gusts has no hand: same line');
  assert.match(text(createWords({ mode: 'sailor' }).expand('§pull§', { touch: true })), /drag a winch down to trim/);
});

test('the hints: on touch no line shows a key cap, no "scroll or click"; on the keyboard the caps stay', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  let hand = 'touch';
  const sk = createSkills({ storage: null });
  const spoken = [];
  const hint = createControlsHint({ state: () => null, skills: sk, words: createWords({ skills: sk }), once: false, storage: null, voice: { say: (t) => spoken.push(t) },
    modality: () => (hand === 'touch' ? 'mouse' : hand), touch: () => hand === 'touch' });
  for (const n of ['pull', 'ease', 'irons', 'steer', 'tack', 'gybe', 'heavy', 'gusts', 'groove', 'chart', 'wind', 'look']) {
    hint.force('off'); hint.force(n);
    const h = hint.el.innerHTML;
    assert.doesNotMatch(h, /class="cap/, n + ' shows a cap on touch: ' + h);
    assert.doesNotMatch(text(h), /scroll or click|click/i, n + ': ' + text(h));
    assert.doesNotMatch(text(h), /\b[WASDNH1-4]\b/, n + ' names a key: ' + text(h));
  }
  hint.force('off'); hint.force('pull');
  assert.match(text(hint.el.innerHTML), /Sails shaking — drag a winch down/);
  assert.deepEqual(spoken.at(-1), 'Sails shaking. Pull the sails in.', 'the voice reads the plain wording: no key or mouse verb');
  hint.force('off'); hint.force('whisper');
  assert.equal(hint.el.innerHTML.includes('class="cap'), false, 'no "hold H" on a touch device');
  hand = 'keys'; hint.force('off'); hint.force('pull');
  assert.match(hint.el.innerHTML, /data-k="W"/, 'the keyboard keeps its caps');
  assert.match(text(hint.el.innerHTML), /pull the sails in/);
  hint.dispose();
});

test('the Keys card: on touch the Touch sheet comes first and shows no cap; on the keyboard the page is as before', () => {
  const t = keysPageHtml({ touch: true });
  const tabs = [...t.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
  assert.equal(tabs[0], 'touch'); assert.ok(!tabs.includes('hand'), 'the Mouse, touch tab gives way to it');
  assert.match(t, /id="tab-keys-touch"[^>]*aria-selected="true"/);
  const sheet = t.match(/<div class="tp"[^>]*data-tp="touch">([\s\S]*?)<\/div><\/div>/)[1];
  assert.doesNotMatch(sheet, /class="cap/, 'no key cap on the Touch sheet');
  for (const word of ['Steer', 'Trim', 'View', 'Menu']) assert.match(text(sheet), new RegExp(word), word);
  assert.ok(TOUCH_ROWS.length >= 5);
  const k = keysPageHtml({});
  assert.deepEqual([...k.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]), ['keys', 'boat', 'hand', 'pro']);
  assert.match(k, /id="tab-keys-keys"[^>]*aria-selected="true"/);
});
