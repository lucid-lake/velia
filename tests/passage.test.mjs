// The passage (src/ui/passage.js, § 7.1): distance, bearing, time to go, arrival on the ship's clock and the
// cross-track error to the mark in force, and the service that picks that mark (by hand, the chart's waypoint or destination,
// Regatta's next mark) and starts a new leg when it changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passageTo, etaHour, etaText, ttgText, dtwText, chartTarget, createPassage, NM, KN } from '../src/ui/passage.js';

const north = (kn = 5, x = 0, z = 0) => ({ x, z, sog: kn * KN, cog: 0 });

test('a boat heading north at 5 kn, a waypoint 1 nm north: DTW 1.00, BTW 000, TTG 12 min, XTE 0', () => {
  const p = passageTo(north(), { x: 0, z: -NM }, { from: [0, 0] });
  assert.equal(dtwText(p.dtw), '1.0'); assert.equal(p.dtw.toFixed(2), '1.00');
  assert.equal(Math.round(p.btw), 0); assert.equal(ttgText(p.ttgMin).num, '12'); assert.equal(ttgText(p.ttgMin).unit, 'min');
  assert.equal(p.xte, 0); assert.equal(p.side, '');
  assert.equal(Math.round(passageTo(north(), { x: NM, z: 0 }).btw), 90, 'east is 090');
  assert.equal(Math.round(passageTo(north(), { x: 0, z: NM }).btw), 180);
  assert.equal(Math.round(passageTo(north(), { x: -NM, z: 0 }).btw), 270);
});

test('XTE: the boat 50 m east of a north-going leg is 0.03 nm to starboard; west is port', () => {
  const p = passageTo(north(5, 50, -500), { x: 0, z: -NM }, { from: [0, 0] });
  assert.equal(p.xte.toFixed(2), '0.03'); assert.equal(p.side, 'S');
  assert.equal(passageTo(north(5, -50, -500), { x: 0, z: -NM }, { from: [0, 0] }).side, 'P');
  assert.equal(passageTo(north(5, 50, -500), { x: 0, z: -NM }).xte, 0, 'no leg: no XTE');
});

test('ETA on the ship\'s clock: clock + TTG x the rate (a 12 min TTG at 2x lands 24 clock minutes on), or the day clock itself', () => {
  const p = passageTo(north(), { x: 0, z: -NM }, { hour: 15, rate: 2 });
  assert.equal(etaText(p.eta), '15:24');
  assert.equal(etaText(passageTo(north(), { x: 0, z: -NM }, { hour: 15, rate: 1 }).eta), '15:12');
  // the day clock (TimeOfDay.hourAt(t)) wins: here 10 game seconds per sim second from 15:00 at t = 100
  const hourAt = (t) => 15 + ((t - 100) * 10) / 3600;
  assert.equal(etaText(passageTo(north(), { x: 0, z: -NM }, { hourAt, t: 100 }).eta), '17:00', '720 s x 10 = 2 h');
  assert.equal(etaText(23.99 + 0.5), '00:29', 'past midnight wraps');
  assert.equal(etaHour(null, { hour: 15 }), null);
});

test('TTG: a dash under 0.3 kn of closing speed; hours past 60 min', () => {
  assert.equal(passageTo(north(0.29), { x: 0, z: -NM }).ttgMin, null); assert.equal(ttgText(null).num, '—');
  assert.equal(passageTo({ x: 0, z: 0, sog: 5 * KN, cog: Math.PI }, { x: 0, z: -NM }).ttgMin, null, 'sailing away');
  assert.ok(passageTo(north(0.31), { x: 0, z: -NM }).ttgMin > 0);
  assert.deepEqual(ttgText(65), { num: '1:05', unit: 'h' }); assert.deepEqual(ttgText(14.4), { num: '14', unit: 'min' });
  assert.equal(passageTo(north(), { x: 0, z: -NM }, { hour: 15 }).eta != null, true);
  assert.equal(passageTo(north(0.2), { x: 0, z: -NM }, { hour: 15 }).eta, null, 'no TTG: no ETA');
});

test('DTW: two decimals under 1 nm, one to 100, whole past', () => {
  assert.equal(dtwText(0.456), '0.46'); assert.equal(dtwText(1.23), '1.2'); assert.equal(dtwText(123.4), '123');
});

test('the service: the chart\'s waypoint (Sail Pro), the destination (Cruise), Regatta\'s next mark; a hand-set mark wins', () => {
  const svc = new Map(), services = { get: (k) => svc.get(k) };
  const boat = { x: 10, z: 20, sog: 0, cog: 0 }; svc.set('player', { phys: { state: boat } });
  const ps = createPassage({ services });
  assert.equal(ps.sync(), null); assert.equal(ps.target, null);
  svc.set('chart', { state: { waypoint: { x: 100, z: -900 }, dest: null } });
  assert.deepEqual(ps.sync().target, { x: 100, z: -900, name: 'WP', kind: 'waypoint' });
  assert.deepEqual(ps.from, [10, 20], 'the leg starts where the boat was when the mark appeared');
  boat.x = 60; ps.sync(); assert.deepEqual(ps.from, [10, 20], 'the same mark: the same leg');
  svc.set('chart', { state: { waypoint: null, dest: { x: 500, z: 500, name: 'Fannette' } } });
  assert.equal(ps.sync().target.name, 'Fannette'); assert.deepEqual(ps.from, [60, 20], 'a new mark: a new leg');
  svc.set('chart', { state: { waypoint: null, dest: { x: 500, z: 500, name: null } } });
  assert.equal(ps.sync().target.name, 'your mark', 'a mark with no name (Cruise\'s double-tap)');
  svc.set('chart', { state: { waypoint: null, dest: null } });
  svc.set('regatta', { marks: { tracker: { target: () => ({ mark: 'm2', at: { x: 1, z: 2 }, leg: 1, done: false }) } } });
  assert.deepEqual(chartTarget(services), { x: 1, z: 2, name: '2', kind: 'course' });
  ps.set({ x: 7, z: 8, name: 'WP 1 · 3' }, [0, 0]);
  assert.deepEqual(ps.sync().target, { x: 7, z: 8, name: 'WP 1 · 3', kind: 'route' }); assert.deepEqual(ps.from, [0, 0]);
  ps.clear(); assert.equal(ps.sync().target.kind, 'course');
  svc.delete('regatta'); assert.equal(ps.sync(), null);
});
