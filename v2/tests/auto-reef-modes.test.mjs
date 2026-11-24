// The reef selector A · 0 · 1 · 2, one state per mode (owner 2026-11-17): Sail and Regatta on 0, Cruise on A; a choice is kept per
// mode; the old global setting forces nothing; A picks levels, a manual reef holds; K and a click step it; Setup has no row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReefStore, nextReef, keyReef, reefWords, REEF_KEY } from '../ui/autoReef.js';
import { SETUP_ROWS } from '../ui/setup.js';
import { createBoatSim, waterFor } from '../sim/boat.js';

const mem = (o = {}) => { const m = new Map(Object.entries(o)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('defaults: Sail 0, Regatta 0, Cruise A', () => {
  const s = createReefStore({ storage: mem() });
  assert.deepEqual([s.get('sail'), s.get('regatta'), s.get('cruise')], [0, 0, 'A']);
});

test('a choice in Sail is remembered for Sail only, and across a reload', () => {
  const st = mem(); const a = createReefStore({ storage: st });
  a.set('sail', 'A'); a.set('regatta', 2);
  const b = createReefStore({ storage: st });
  assert.deepEqual([b.get('sail'), b.get('regatta'), b.get('cruise')], ['A', 2, 'A']);
  b.set('cruise', 0); assert.equal(createReefStore({ storage: st }).get('cruise'), 0);
  b.set('sail', 7); assert.equal(b.get('sail'), 'A', 'a bad value is refused');
});

test('migration: the old global auto-reef setting (v1\'s, default on) forces nothing in v2', () => {
  const st = mem({ 'lakeshore.settings.v1': JSON.stringify({ _v: 2, autoReef: true }) });
  const s = createReefStore({ storage: st });
  assert.equal(s.get('sail'), 0); assert.equal(s.get('cruise'), 'A'); assert.equal(s.chosen('sail'), false);
  assert.equal(JSON.parse(st.m.get('lakeshore.settings.v1')).autoReef, true, 'v1\'s value is left alone'); assert.ok(REEF_KEY);
});

test('a click steps A → 0 → 1 → 2 → A; K steps 0 → 1 → 2 → 0 and from A holds the level now', () => {
  assert.deepEqual(['A', 0, 1, 2].map(nextReef), [0, 1, 2, 'A']);
  assert.deepEqual([0, 1, 2].map((v) => keyReef(v)), [1, 2, 0]);
  assert.equal(keyReef('A', 1.2), 1); assert.equal(keyReef('A', 0), 0); assert.equal(keyReef(keyReef('A', 1)), 2);
  assert.equal(reefWords('A', 1), 'reef: auto (one in)');
});

test('the boat: A sets the physics\' auto-reef (no manual reef), a number holds that reef; onReef tells the page; a new start keeps it', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { sample: () => ({ vx: 0, vz: -4, speed: 4, dirDeg: 180 }) } });
  assert.equal(B.reefSel, 0); assert.equal(B.ctl.autoReef, false); assert.equal(B.ctl.reef, 0);
  const seen = []; B.onReef = (v) => seen.push(v);
  B.setReef('A'); assert.deepEqual([B.ctl.autoReef, B.ctl.reef], [true, 0]);
  B.setReef(2); assert.deepEqual([B.ctl.autoReef, B.ctl.reef], [false, 2]);
  B.setReef(1, { silent: true }); B.setReef(9);
  assert.deepEqual(seen, ['A', 2]); assert.equal(B.reefSel, 1);
  B.place({ x: 10, z: 10, headingDeg: 0, speed: 1 }); assert.equal(B.ctl.reef, 1, 'a new start keeps the reef');
});

test('Setup has no auto-reef row on v2: the selector is its only place', () => {
  assert.ok(!SETUP_ROWS.some((r) => r.key === 'autoReef'));
});
