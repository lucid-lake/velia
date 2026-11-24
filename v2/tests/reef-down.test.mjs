// Reefing with the sails down (owner OK, 2026-11-16): it works (reef before hoisting) and says so: (1) a reply line a phone keeps,
// (2) the tied-in reef on the boom with the main up or down, (3) the switches show 1 or 2 reefs, (4) the hoist stops at the reef.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StatusWatch, REEF_DOWN } from '../../src/ui/statusLine.js';
import { PHONE_KEEP } from '../../src/ui/phoneQuiet.js';
import { lineSet, reefBundle, REEF_ROLL } from '../render/boat/mesh.js';
import { mainPoint, sailParams, RIG } from '../../src/boat/rig.js';
import { reefNow, reefLever, reefWords } from '../ui/reefState.js';

const snap = (o) => ({ furl: 1, furlWant: 1, engine: 'off', lever: 0, anchor: {}, tackle: 'free', bino: false, radio: '16', reef: 0, reefing: 0, view: 'follow', ...o });

test('(1) a reef set with the sails down: one reply that says what the hoist will be; a phone keeps it', () => {
  const sw = new StatusWatch(); let t = 0;
  sw.step(snap({}), t);
  assert.equal(sw.step(snap({ reef: 1 }), t += 0.1), REEF_DOWN.in); assert.equal(sw.kind, 'reply');
  for (let i = 0; i < 60; i++) { const l = sw.step(snap({ reef: 1, reefing: Math.min(1, i / 20) }), t += 0.1); assert.notEqual(l, 'Reefing…'); assert.notEqual(l, 'One reef in'); }
  assert.equal(sw.step(snap({ reef: 2, reefing: 1 }), t += 0.1), REEF_DOWN.second);
  assert.equal(sw.step(snap({ reef: 1, reefing: 2 }), t += 0.1), REEF_DOWN.one);
  assert.equal(sw.step(snap({ reef: 0, reefing: 1 }), t += 0.1), REEF_DOWN.out); assert.equal(sw.kind, 'reply');
  assert.match(REEF_DOWN.in, /Reef in — the main will go up reefed/); assert.match(REEF_DOWN.out, /Reef shaken out — full main when hoisted/);
  assert.ok(PHONE_KEEP.hint.includes('reply'), 'a phone keeps reply lines');
  // the sails up: the crew at work as before, a status line
  const up = new StatusWatch(); up.step(snap({ furl: 0, furlWant: 0 }), 0);
  assert.equal(up.step(snap({ furl: 0, furlWant: 0, reef: 1 }), 0.1), 'Reefing…'); assert.equal(up.kind, 'status');
  // the hoist after: its end says the reef
  const h = new StatusWatch(); h.step(snap({ reef: 1, reefing: 1 }), 0);
  h.step(snap({ furlWant: 0, reef: 1, reefing: 1 }), 0.1);
  assert.equal(h.step(snap({ furl: 0, furlWant: 0, reef: 1, reefing: 1 }), 0.2), 'Sails up · one reef in');
});

test('(2) the tied-in reef shows on the boom with the main lowered (and up); none without a reef', () => {
  const names = (st) => lineSet(st).map((l) => l.name);
  assert.ok(!names({ reef: 0, reefing: 0, furl: 1 }).some((n) => n.startsWith('reef')), 'no reef: no bundle');
  for (const furl of [1, 0]) {
    const L = lineSet({ reef: 1, reefing: 1, furl });
    const roll = L.filter((l) => l.name.startsWith('reef-bundle')), ties = L.filter((l) => l.name.startsWith('reef-tie'));
    assert.equal(roll.length, 2, `the roll's two strands (furl ${furl})`); assert.ok(ties.length >= 5, `${ties.length} reef points`);
    const ys = ties[0].points.map((p) => p[1]), boomY = RIG.gooseneck ?? ys[0];
    assert.ok(Math.min(...ys) < boomY && Math.max(...ys) > boomY + 0.25, 'a tie goes under the boom and over the bag');
  }
  assert.ok(reefBundle({ reef: 2 })[0].diameterM > reefBundle({ reef: 1 })[0].diameterM, 'two reefs: a fatter roll');
  assert.equal(reefBundle({ reef: 1 })[0].diameterM, (REEF_ROLL.base + REEF_ROLL.perReef) * 0.8);
});

test('(3) the REEF selector A · 0 · 1 · 2: its lever place, its words, the level now from the boat\'s reef', () => {
  assert.deepEqual(['A', 0, 1, 2].map(reefLever), [0, 1 / 3, 2 / 3, 1]);
  assert.deepEqual([[0, 0], [1, 0], [2, 0], ['A', 1]].map(([v, l]) => reefWords(v, l)), ['reef: none', 'reef: one in', 'reef: two in', 'reef: auto (one in)']);
  assert.equal(reefNow({ reef: 2 }, { reef: 0 }), 2, 'the automatic reef counts (the physics\' target)');
  assert.equal(reefNow(null, { reef: 1 }), 1); assert.equal(reefNow({ reef: 5 }), 2);
});

test('(4) the hoist stops at the reef point: the head rises to the reefed luff, never the full one', () => {
  const head = (reef, drop) => mainPoint(0, 1, sailParams({ reef, reefing: reef, furl: drop }).main)[1];
  const full = head(0, 0), reefed = head(1, 0), two = head(2, 0);
  assert.ok(reefed < full - 0.5 && two < reefed - 0.5, `full ${full.toFixed(2)} m > one reef ${reefed.toFixed(2)} > two ${two.toFixed(2)}`);
  let was = -Infinity;
  for (let i = 20; i >= 0; i--) { const d = i / 20, y = head(1, d); assert.ok(y >= was - 1e-9 && y <= reefed + 1e-9, `drop ${d.toFixed(2)}: ${y.toFixed(2)} m`); was = y; }
  assert.ok(Math.abs(was - reefed) < 1e-6, 'up: at the reef point');
  assert.ok(head(1, 1) < head(0, 0) * 0.2, 'down: on the boom');
});
