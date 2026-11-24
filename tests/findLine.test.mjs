// node --test tests/findLine.test.mjs — what a logbook find says in play (owner, 2026-11-07): a subtitle line, never a panel;
// the first find teaches the book, notable finds get a quiet line, routine finds are silent, 3 lines a session at most.
// The DOM side (the subtitle row shows the line, no .toast exists) is tests/pages/findLine.page.mjs (retired 2026-11-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFindLine, findText, NOTABLE, ROUTINE, GAP_S, MAX_WAIT_S, MAX_LINES } from '../src/sail/findLine.js';
import { ENTRIES } from '../src/ui/logbook.js';
import { IDS } from '../src/sail/discoveries.js';

const rig = (over = {}) => {
  let t = 0, busy = false; const said = [];
  const q = createFindLine({ now: () => t, busy: () => busy, show: (text, o) => { said.push([t, text, o]); return true; }, ...over });
  return { q, said, at: (s) => { t = s; }, busy: (b) => { busy = b; } };
};

test('every entry is either notable or routine, and the removed ones are gone', () => {
  for (const e of ENTRIES) assert.ok(NOTABLE.has(e.id) !== ROUTINE.has(e.id), `${e.id} is in exactly one table`);
  for (const id of [...NOTABLE, ...ROUTINE]) assert.ok(ENTRIES.some((e) => e.id === id), `${id} is an entry`);
  for (const gone of ['wheeler', 'moorings']) { assert.ok(!ENTRIES.some((e) => e.id === gone), `${gone} is not in the book`); assert.ok(!IDS.includes(gone), `${gone} has no rule`); }
});

test('the first find teaches the book; later notable finds are quiet lines; routine finds are silent', () => {
  const r = rig();
  r.q.push({ id: 'gust', name: 'first gust', first: true }); r.q.tick();
  assert.equal(r.said[0][1], 'First gust — added to your logbook');
  assert.equal(r.said[0][2].key, 'L');
  r.at(GAP_S);
  assert.equal(r.q.push({ id: 'tack', name: 'first tack' }), false, 'a routine find after the first says nothing');
  r.q.push({ id: 'waterfall', name: 'the waterfall' }); r.q.tick();
  assert.equal(r.said[1][1], 'The waterfall — in the logbook');
  assert.equal(findText('the ruin'), 'The ruin — in the logbook');
});

test('a session says at most MAX_LINES lines, GAP_S apart', () => {
  const r = rig(); let t = 0;
  for (const id of ['island', 'waterfall', 'house', 'light', 'ruin']) { r.q.push({ id, name: id }); r.at(t); r.q.tick(); t += GAP_S; }
  r.at(t); r.q.tick();
  assert.equal(r.said.length, MAX_LINES);
  assert.ok(r.said.every((s, i) => i === 0 || s[0] - r.said[i - 1][0] >= GAP_S));
});

test('never at a bad moment: waits while busy, drops after MAX_WAIT_S, a refused line stays queued', () => {
  const r = rig();
  r.busy(true); r.q.push({ id: 'island', name: 'the island' }); r.q.tick();
  assert.equal(r.said.length, 0, 'never cuts a note, a tack, a hushed minute');
  r.at(MAX_WAIT_S + 1); r.busy(false); r.q.tick();
  assert.equal(r.said.length, 0, 'said late: dropped');
  let ok = false; const h = rig({ show: () => ok });
  h.q.push({ id: 'island', name: 'x' }); h.q.tick(); assert.equal(h.q.pending, 1, 'the hush refused it: still queued');
  ok = true; h.at(1); h.q.tick(); assert.equal(h.q.pending, 0);
  h.q.push({ id: 'waterfall', name: 'y' }); h.q.clear(); assert.equal(h.q.pending, 0, 'opening the book clears the queue');
});
