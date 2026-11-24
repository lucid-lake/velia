// The lesson seam (refactor round 2, Phase C step 10; src/lessons/index.js): a craft names its lesson set, and the sail
// controller builds its skills, words, hint line and skipper's notes from that set. The sloop's set is exactly today's
// modules; a craft with no set (the kayak, so far) is refused by name rather than handed the sail lessons.
import './helpers/terrain-small.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, lessonsFor, lessonsById } from '../classic/src/lessons/index.js';
import { CRAFTS } from '../src/sim/craft/index.js';
import { createSkills, SKILLS } from '../src/sail/skills.js';
import { createWords, TERMS } from '../src/ui/words.js';
import { NOTES } from '../src/ui/skipper.js';
import { createControlsHint } from '../src/ui/controlsHint.js';
import { CURRENT_VESSEL } from '../src/sim/vessels/current.js';
import { mountSail } from './helpers/sail-controls.mjs';

test('the sloop names the sail set, and the sail set is today\'s modules', () => {
  assert.equal(CRAFTS.sloop.lessons, 'sail');
  const L = lessonsFor(CRAFTS.sloop);
  assert.equal(L, LESSONS.sail);
  assert.equal(L.id, 'sail');
  assert.equal(L.skills, SKILLS);
  assert.equal(L.terms, TERMS);
  assert.equal(L.notes, NOTES);
  assert.equal(L.createSkills, createSkills);
  assert.equal(L.createWords, createWords);
  assert.equal(L.createHint, createControlsHint);
  assert.ok(Object.isFrozen(L));
});

test('a craft with no lesson set, or an unknown set, is refused by name', () => {
  assert.throws(() => lessonsFor(CRAFTS.kayak), /lessons: no lesson set for craft 'kayak'/);
  assert.throws(() => lessonsFor({ id: 'raft', lessons: 'raft' }), /lessons: no lesson set 'raft'/);
  assert.throws(() => lessonsById('toString'), /no lesson set 'toString'/);
});

test('the sail controller takes its lessons from the craft: the sloop mounts its hint line and words', () => {
  const s = mountSail();
  try {
    assert.ok(s.c.hint && document.querySelector('.lk-hint'), 'the hint line is up');
    assert.equal(typeof s.services.get('words')?.level, 'function', 'the sailor\'s words are provided');
    assert.ok(s.services.get('skills'), 'the skill model is provided');
  } finally { s.dispose(); }
});

test('the seam bites: a paddle craft\'s boat in the sail controller fails on its lessons, not with the sail set', () => {
  const vessel = { ...CURRENT_VESSEL, id: 'test-paddle', craft: 'kayak' };
  assert.throws(() => mountSail({ vessel }), /lessons: no lesson set for craft 'kayak'/);
});
