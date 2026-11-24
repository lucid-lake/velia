// The mark's nudge (owner 2026-11-20: NAV does not start itself after a double-click): the line says what comes next,
// "Mark set. Click NAV to sail there.", and NAV pulses once; with NAV already on the mark just follows. The crew's net, on screen
// (H + 5 went): its Setup button's words and its cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markLine, createSailMark } from '../ui/sailMark.js';
import { netWords, NET_STEPS } from '../ui/netRow.js';
import { createSkills } from '../../src/sail/skills.js';

test('the mark\'s line: set, moved, a finger\'s Tap, NAV already on', () => {
  assert.equal(markLine(false), 'Mark set. Click NAV to sail there.');
  assert.equal(markLine(true), 'Mark moved. Click NAV to sail there.');
  assert.equal(markLine(false, { touch: true }), 'Mark set. Tap NAV to sail there.');
  assert.equal(markLine(false, { on: true }), 'Mark set. NAV is sailing there.');
  assert.equal(markLine(true, { on: true }), 'Mark moved. NAV is sailing there.');
});

test('a double-click on the water: the line names NAV and the page is told to pulse it once (only when NAV is off)', () => {
  const lines = [], sets = [];
  let navOn = false;
  const M = createSailMark({ waterAt: () => ({ x: 0, z: -400 }), depthAt: () => 30, boat: () => ({ x: 0, z: 0 }), say: (t) => lines.push(t),
    nav: () => ({ on: navOn, touch: false }), onSet: (on) => sets.push(on) });
  assert.equal(M.at(10, 10), 'set');
  assert.equal(lines.at(-1), 'Mark set. Click NAV to sail there.');
  assert.deepEqual(sets, [false], 'NAV off: the page pulses it');
  navOn = true;
  assert.equal(M.place({ x: 200, z: -500 }), 'moved');
  assert.equal(lines.at(-1), 'Mark moved. NAV is sailing there.');
  assert.deepEqual(sets, [false, true], 'NAV on: told, and the page does not pulse');
  assert.equal(M.place({ x: 200, z: -500 }), 'cleared', 'a double-click on the mark clears it');
  assert.equal(sets.length, 2, 'a clear is no set');
});

test('the crew\'s net on screen: the button says what it is now and steps the skill model\'s own cycle', () => {
  const sk = createSkills({ storage: null });
  assert.deepEqual(NET_STEPS, ['auto', 12, 25, 'off']);
  assert.match(netWords(sk), /^crew’s net: auto · 12 s$/);
  assert.equal(sk.cycleNet(), 12); assert.equal(netWords(sk), 'crew’s net: 12 s');
  assert.equal(sk.cycleNet(), 25); assert.equal(netWords(sk), 'crew’s net: 25 s');
  assert.equal(sk.cycleNet(), 'off'); assert.equal(netWords(sk), 'crew’s net: off'); assert.equal(sk.netAfter, Infinity);
  assert.equal(sk.cycleNet(), 'auto'); assert.match(netWords(sk), /auto/);
});
