// The chart's routing (2026-11-25): "Sail here" on the live map's existing card sets the target and puts NAV on it, the chart left
// open; the map's boat is the Coach's own drawing; the left panel hides like a dock. No browser: the card's action through the page's
// services, the dock's rule, the boat's size by zoom and its one replaceable drawing. The browser half: v2/tests/pages/sailHere.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartActions } from '../ui/chart/liveChart.js';
import { createDockState, DOCK } from '../ui/chart/panelDock.js';
import { mapBoatPx, MAP_BOAT, setMapBoat, mountMapBoat } from '../ui/chart/mapBoat.js';
import { modeRows, bootMode } from '../engine/modes.js';

test('Sail here: open water sends its point, a place its aim and name, to the page\'s chartTarget.sailHere; no service, a plain refusal', () => {
  const calls = [];
  const services = { get: (n) => (n === 'chartTarget' ? { sailHere: (p) => { calls.push(p); return { ok: true }; } } : null) };
  const A = chartActions(services, () => 'play');
  assert.deepEqual(A.sailHere({ id: 'water', kind: 'water', x: 300, z: -400, name: 'Open water' }, { x: 1, z: 2 }), { ok: true });
  assert.deepEqual(A.sailHere({ id: 'pl-fannette', kind: 'place', x: 0, z: 0, name: 'Fannette Island' }, { x: 60, z: -80 }), { ok: true });
  assert.deepEqual(calls, [{ x: 300, z: -400 }, { x: 60, z: -80, name: 'Fannette Island' }]);
  assert.deepEqual(chartActions({ get: () => null }).sailHere({ kind: 'water', x: 0, z: 0 }), { ok: false, why: 'unknown' });
});

test('Plan is not a mode: no Plan row, ?mode=plan opens Sail (one tap on the card, as before)', () => {
  assert.deepEqual(modeRows().map((r) => r.id), ['sail', 'cruise', 'regatta']);
  assert.equal(bootMode({ mode: 'plan' }), 'sail');
});

test('the dock: the panel goes 3 s after the pointer left it for the map, never before the pointer was on the map or with a plate open; the edge brings it back', () => {
  const D = createDockState();
  for (let i = 0; i < 50; i++) D.step(0.1, { map: false }); assert.equal(D.hidden, false, 'a fresh menu: the panel stays until the pointer goes to the map');
  for (let i = 0; i < 29; i++) D.step(0.1, { map: true }); assert.equal(D.hidden, false);
  D.step(0.2, { map: true }); assert.equal(D.hidden, true, `out after ${DOCK.delayS} s`);
  D.step(0.1, { map: true, edge: true }); assert.equal(D.hidden, false, 'the left edge brings it back');
  for (let i = 0; i < 50; i++) D.step(0.1, { map: true, over: true }); assert.equal(D.hidden, false, 'the pointer on it holds it');
  for (let i = 0; i < 50; i++) D.step(0.1, { map: true, plate: true }); assert.equal(D.hidden, false, 'an open plate holds it');
  for (let i = 0; i < 40; i++) D.step(0.1, { map: true }); assert.equal(D.hidden, true);
  D.step(0.1, { active: false }); assert.equal(D.hidden, false, 'the menu closed (or the entrance): the panel is back for next time');
});

test('the map\'s boat: 70–130 px by zoom, the rig from 90 px, words at 10 px; one replaceable drawing', () => {
  assert.equal(mapBoatPx(0.01), MAP_BOAT.minPx); assert.equal(mapBoatPx(5), MAP_BOAT.maxPx);
  assert.deepEqual([MAP_BOAT.minPx, MAP_BOAT.maxPx, MAP_BOAT.detailPx, MAP_BOAT.wordPx], [70, 130, 90, 10]);
  let made = null; setMapBoat((o) => (made = o, { el: null, place() {}, update() {}, destroy() {} }));
  mountMapBoat({ root: 'r', state: () => null }); assert.equal(made.root, 'r'); setMapBoat(null);
});
