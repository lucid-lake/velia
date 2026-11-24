// K3 the end card's words (v2/ui/endCard.js): the line from the sim's event, the one tip (reef first; reefed on a reach: ease, don't
// luff, owner 2026-11-17), the session's line in the log, and the cause field Tessie's revenge reuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endCardModel, knockdownLine, knockdownTip, logLine, windWords } from '../ui/endCard.js';

test('the line: the gust, where it was, the sail and the sheets', () => {
  assert.equal(knockdownLine({ gustKn: 30.6, twsKn: 28, twaDeg: -85, reef: 0, boomDeg: 22, mainFill: 0.9 }), 'A 31 kn gust on the beam, full sail, sheets in');
  assert.equal(knockdownLine({ gustKn: 27, twaDeg: 40, reef: 1, boomDeg: 55, mainFill: 0.4 }), 'A 27 kn gust close-hauled, one reef in, sheets eased');
  assert.deepEqual([30, 60, 90, 130, 170].map(windWords), ['close-hauled', 'forward of the beam', 'on the beam', 'on the quarter', 'from astern']);
});

test('the tip: reef first; reefed on a reach, ease and don\'t luff; else ease in the gusts', () => {
  assert.equal(knockdownTip({ reef: 0, twaDeg: 90 }), 'Reef early, or ease the main in the gusts.');
  assert.equal(knockdownTip({ reef: 1, twaDeg: -95 }), 'On a reach, ease the sheets in a gust. Don\'t luff.');
  assert.equal(knockdownTip({ reef: 2, twaDeg: 40 }), 'Ease the main in the gusts, and reef early.');
});

test('the log line and the model; the cause picks the title (Tessie reuses the card)', () => {
  assert.equal(logLine({ seconds: 1020, metres: 4445, topMs: 4.01 }, 14.2), '14:12 · 17 min · 2.4 nm · top 7.8 kn');
  assert.equal(logLine({ seconds: 20, metres: 30, topMs: 1 }), 'under a minute · 0.0 nm · top 1.9 kn');
  const m = endCardModel({ event: { gustKn: 31, twaDeg: 90, reef: 0, boomDeg: 20, mainFill: 1 }, log: { seconds: 600, metres: 1852, topMs: 3 }, hour: 15.5 });
  assert.deepEqual(Object.keys(m).sort(), ['cause', 'kicker', 'line', 'log', 'tip', 'title']);
  assert.equal(m.title, 'Knocked down'); assert.equal(m.cause, 'knockdown'); assert.equal(m.log, '15:30 · 10 min · 1.0 nm · top 5.8 kn');
  const t = endCardModel({ cause: 'tessie', log: {} });
  assert.equal(t.title, 'Tessie said no.'); assert.equal(t.cause, 'tessie');
});
