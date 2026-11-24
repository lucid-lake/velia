// The status line (src/ui/statusLine.js): every action says what it is doing at once, its progress while the crew works,
// and its end, in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatusWatch, STATUS } from '../src/ui/statusLine.js';

const base = { furl: 0, furlWant: 0, engine: 'off', lever: 0, anchor: { phase: 'stowed', depth: 9.2 }, tackle: 'free', bino: false, radio: '16', reef: 0, view: 'follow' };
const run = (steps) => { const w = new StatusWatch(); w.step(base, 0); return steps.map(([patch, t]) => w.step({ ...base, ...patch, anchor: { ...base.anchor, ...(patch.anchor ?? {}) } }, t)); };

test('every action says itself on its first frame', () => {
  const cases = [
    [{ furlWant: 1 }, 'Sails coming down…'], [{ engine: 'cranking' }, 'Engine starting…'], [{ anchor: { phase: 'falling' } }, 'Anchor going down — 9 m'],
    [{ tackle: 'moored' }, 'Mooring picked up'], [{ tackle: 'docked' }, 'Made fast alongside'], [{ bino: true }, 'Binoculars'],
    [{ radio: 'WX 1' }, 'VHF · the weather channel'], [{ reef: 1, reefing: 0 }, 'Reefing…'], [{ view: 'helm' }, 'Helm view'],
  ];
  for (const [patch, line] of cases) assert.equal(run([[patch, 0.016]])[0], line, JSON.stringify(patch));
});

test('a multi-second action keeps its line up, then says its end', () => {
  const w = new StatusWatch(); w.step(base, 0);
  assert.equal(w.step({ ...base, furlWant: 1, furl: 0.1 }, 0.02), 'Sails coming down…');
  assert.equal(w.step({ ...base, furlWant: 1, furl: 0.4 }, 0.5), null);
  assert.equal(w.step({ ...base, furlWant: 1, furl: 0.6 }, 0.02 + STATUS.repeatS), 'Sails coming down…');
  assert.equal(w.busy, 'sails');
  assert.equal(w.step({ ...base, furlWant: 1, furl: 1 }, 1.5), 'Sails down');
  assert.equal(w.busy, null);
});

test('the engine: starting, running at the lever\'s notch, the notches, off', () => {
  const w = new StatusWatch(); w.step(base, 0);
  assert.equal(w.step({ ...base, engine: 'cranking', lever: 0.3 }, 0.1), 'Engine starting…');
  assert.equal(w.step({ ...base, engine: 'running', lever: 0.3 }, 1.2), 'Engine running · slow ahead');
  assert.equal(w.step({ ...base, engine: 'running', lever: 0.6 }, 1.5), 'Half ahead');
  assert.equal(w.step({ ...base, engine: 'running', lever: -0.35 }, 2), 'Slow astern');
  assert.equal(w.step({ ...base, engine: 'stopping', lever: 0 }, 3), 'Engine off');
});

test('the anchor: down with the depth, holding; weighing, up', () => {
  const w = new StatusWatch(); w.step(base, 0);
  assert.equal(w.step({ ...base, anchor: { phase: 'falling', depth: 9.2 } }, 0.1), 'Anchor going down — 9 m');
  assert.equal(w.step({ ...base, anchor: { phase: 'held', depth: 9.2 } }, 6), 'Anchor holding');
  assert.equal(w.step({ ...base, anchor: { phase: 'weighing', depth: 9.2 } }, 9), 'Weighing anchor…');
  assert.equal(w.step({ ...base, anchor: { phase: 'stowed', depth: 9.2 } }, 15), 'Anchor up');
});

test('the reef: "Reefing…" while the crew works, then "One reef in"; shaking it out', () => {
  const w = new StatusWatch(); w.step(base, 0);
  assert.equal(w.step({ ...base, reef: 1, reefing: 0.1 }, 0.1), 'Reefing…');
  assert.equal(w.step({ ...base, reef: 1, reefing: 0.5 }, 1.2), 'Reefing…');
  assert.equal(w.step({ ...base, reef: 1, reefing: 1 }, 3), 'One reef in');
  assert.equal(w.step({ ...base, reef: 0, reefing: 0.9 }, 4), 'Shaking out the reef…');
  assert.equal(w.step({ ...base, reef: 0, reefing: 0 }, 7), 'Reefs shaken out');
});
