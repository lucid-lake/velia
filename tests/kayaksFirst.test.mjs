// The first pair (owner 2026-11-09, late: "it just needs to be close and noticeable; it does not need to compete
// with the sailboat"): at the start of play two kayakers are placed in the follow camera's view, 20–40 m off the boat, ahead
// and to port; then they paddle the old way, on the fleet's own minds and their own route, at a kayaker's cruise, never timed
// to meet the boat (no meetSteer). The skipper names them once; the chart draws them as small paddle marks. Behaviour only
// (the modules are called and their output read); the sail is the real physics and wind (tests/helpers/first-sail.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFirst, T, poseOf } from './helpers/first-sail.mjs';
import { placePair, pairLooks, defaultView, createSpotLine, FIRST } from '../src/sim/kayaks/first.js';
import * as MIND from '../src/sim/kayaks/mind.js';
import { SPEED } from '../src/sim/kayaks/mind.js';
import { minDepthAt } from '../src/sim/kayaks/routes.js';
import { drawKayakMarks, KAYAK_MARK } from '../src/ui/chartplotter.js';
import { makeView } from '../src/ui/chartplotterData.js';

const D = Math.PI / 180;
const wrapD = (a) => Math.atan2(Math.sin(a), Math.cos(a)) / D;
// bearing of (x, z) off a heading (deg, + to starboard)
const rel = (from, x, z, heading) => wrapD(Math.atan2(x - from.x, -(z - from.z)) - heading);
const PHONE = 390 / 844, DESK = 1280 / 720;

test('at load the pair is in the camera\'s view, 20–40 m off the boat, ahead and to port (desktop and phone, seeds 1–4)', () => {
  for (const aspect of [DESK, PHONE]) for (let seed = 1; seed <= 4; seed++) {
    const pose = poseOf('default'), view = defaultView(pose, aspect), r = placePair({ seed, terrain: T, pose, view });
    assert.ok(r, `seed ${seed}: placed`);
    assert.equal(r.side, -1, `seed ${seed}: to port`);
    for (const s of r.slots) {
      const { x, z } = s.place, d = Math.hypot(x - pose.x, z - pose.z), b = rel(pose, x, z, pose.heading);
      assert.ok(d >= 20 && d <= 40, `seed ${seed} ${s.id}: ${d.toFixed(1)} m off`);
      assert.ok(b < -2 && b > -80, `seed ${seed} ${s.id}: ${b.toFixed(0)}° off the bow (port, ahead)`);
      const cam = rel(view, x, z, view.yaw);
      assert.ok(cam < 0 && Math.abs(cam) < view.hHalf / D * 0.9, `seed ${seed} ${s.id}: ${cam.toFixed(1)}° off the camera's axis (half ${(view.hHalf / D).toFixed(1)}°)`);
    }
  }
});

test('the pair: two colours, one group, on good water, the fleet\'s own minds (no meeting, no timing), the same for the same seed', () => {
  const pose = poseOf('default');
  const sig = (r) => r.slots.map((s) => [s.id, s.colour, s.sex, s.pfd, s.seed, s.place.x.toFixed(3), s.route.path.length.toFixed(3)].join('|'));
  assert.deepEqual(sig(placePair({ seed: 3, terrain: T, pose })), sig(placePair({ seed: 3, terrain: T, pose })));
  assert.notDeepEqual(sig(placePair({ seed: 3, terrain: T, pose })), sig(placePair({ seed: 4, terrain: T, pose })));
  for (const start of ['default', 'staged']) {
    const r = placePair({ seed: 1, terrain: T, pose: poseOf(start) });
    assert.ok(r, start);
    assert.notEqual(r.slots[0].colour, r.slots[1].colour, 'two kayaks of two colours');
    assert.equal(r.slots[0].group, r.slots[1].group);
    assert.deepEqual(r.slots.map((s) => s.meet), [null, null], 'not timed to meet the boat');
    // the looks built before ENTER are the placed pair's
    assert.deepEqual(pairLooks(1).map((l) => [l.id, l.colour, l.sex, l.pfd, l.seed]), r.slots.map((s) => [s.id, s.colour, s.sex, s.pfd, s.seed]));
    for (const s of r.slots) {
      const path = s.route.path;
      for (let q = 0; q < path.length; q += 2) { const p = path.at(q); assert.ok(-T.heightAt(p.x, p.z) >= minDepthAt(T, p.x, p.z) && -T.shoreDistance(p.x, p.z) >= FIRST.margin * 0.8, `${start} ${s.id}: ${q} m`); }
      const m = MIND.createMind(s);
      assert.deepEqual([m.P.scan, m.P.want], [MIND.PERSONA[FIRST.persona].scan, MIND.PERSONA[FIRST.persona].want], 'the personality\'s own looks and gap');
    }
  }
  assert.equal(MIND.meetSteer, undefined, 'round A\'s timed crossing is gone');
  assert.equal(placePair({ seed: 1, terrain: T, pose: null }), null, 'no pose: none');
});

test('the pair paddles at a kayaker\'s cruise, never a sprint or a rest to keep time; the boat goes by, nobody under 6 m, no "Too close"', () => {
  for (const start of ['default', 'staged']) for (let seed = 1; seed <= 8; seed++) for (const aspect of [DESK, PHONE]) {
    const r = runFirst({ start, seed, secs: 25, aspect });
    assert.ok(r.place, `${start} ${seed}`);
    for (const k of r.ks) {
      assert.ok(k.vMax < SPEED.cruise + 0.15, `${start} ${seed} ${k.id}: up to ${k.vMax.toFixed(2)} m/s (cruise ${SPEED.cruise})`);
      assert.ok(k.vMin > 0.8, `${start} ${seed} ${k.id}: down to ${k.vMin.toFixed(2)} m/s`);
      assert.ok(k.minD >= 6, `${start} ${seed} ${k.id}: ${k.minD.toFixed(1)} m`);
      assert.equal(k.closeCalls, 0, `${start} ${seed} ${k.id}`);
    }
    // the boat has gone by within 25 s: both astern of her beam (she does not wait for them, they do not keep up)
    assert.ok(r.track.at(-1).ks.every((q) => Math.abs(q.rel) > 90), `${start} ${seed}: ${r.track.at(-1).ks.map((q) => q.rel.toFixed(0))}°`);
  }
});

test('out in any wind and at any hour: placed and paddling in a level-4 blow at noon, 18:45 and 22:00', () => {
  for (const hour of [12, 18.75, 22]) for (const seed of [1, 3, 5, 6]) {
    const r = runFirst({ seed, level: 4, hour, secs: 10 });
    assert.ok(r.place, `${hour} h seed ${seed}`);
    for (const k of r.ks) assert.ok(k.vMin > 0.8, `${hour} h seed ${seed} ${k.id}: ${k.vMin.toFixed(2)} m/s`);
  }
});

test('the skipper\'s line once: "Kayakers off the bow.", only when the pair is seen, after the card has gone, when the line is free', () => {
  const said = []; let free = false;
  const line = createSpotLine({ show: (t) => { said.push(t); return true; }, free: () => free });
  assert.equal(line.tick(0, { seen: true }), false);
  assert.equal(line.tick(1.0, { seen: true }), false, 'not before the card has gone (1.5 s)');
  free = true;
  assert.equal(line.tick(2.0, { seen: false }), false, 'not before it is seen');
  free = false;
  assert.equal(line.tick(2.5, { seen: true }), false, 'not over another line');
  free = true;
  assert.equal(line.tick(3.0, { seen: true }), true);
  for (let t = 3.1; t < 60; t += 0.5) line.tick(t, { seen: true });
  assert.deepEqual(said, ['Kayakers off the bow.'], 'once');
  assert.equal(line.at, 3.0);
  // a line refused by the subtitle (a capture pins a hint) is tried again; one that found no moment in 25 s is dropped
  let ok = false; const s2 = [];
  const l2 = createSpotLine({ show: (t) => { if (ok) s2.push(t); return ok; } });
  for (let t = 0; t < 10; t += 0.5) l2.tick(t, { seen: true });
  ok = true; l2.tick(10, { seen: true });
  assert.deepEqual(s2, ['Kayakers off the bow.']);
  const l3 = createSpotLine({ show: () => true });
  for (let t = 0; t < 30; t += 0.5) l3.tick(t, { seen: false });
  assert.equal(l3.tick(31, { seen: true }), false); assert.equal(l3.dropped, true);
});

test('the chart draws each kayak inside its range as a small paddle mark in its ink: a hull stroke, the shaft across, two blades', () => {
  // a 2D context that records the strokes, fills and ellipses
  const rec = { strokes: 0, fills: 0, ellipses: 0, lines: [], styles: new Set() };
  const g = { beginPath() {}, moveTo(x, y) { this.at = [x, y]; }, lineTo(x, y) { rec.lines.push([this.at, [x, y]]); }, ellipse() { rec.ellipses++; },
    stroke() { rec.strokes++; rec.styles.add(this.strokeStyle); }, fill() { rec.fills++; rec.styles.add(this.fillStyle); } };
  const view = makeView({ cx: 0, cz: 0, mPerPx: 5, rot: 0, ox: 100, oy: 100 });   // north-up, 5 m a px, centred
  const inside = (x, z) => Math.hypot(x, z) < 500;
  const ink = (a) => `ink/${a}`;
  const n = drawKayakMarks(g, view, [{ x: 0, z: -100, heading: 0 }, { x: 200, z: 0, heading: Math.PI / 2 }, { x: 2000, z: 0, heading: 0 }], { ink, near: inside });
  assert.equal(n, 2, 'the one beyond the range is not drawn');
  assert.equal(rec.ellipses, 4, 'two blades each');
  assert.deepEqual([...rec.styles], [`ink/${KAYAK_MARK.alpha}`], 'the chart\'s own ink, one alpha: quiet, no colour');
  // the first: heading north at (100, 80) px: the hull stroke vertical, the shaft across it, about 9 px wide
  const [hull, shaft] = rec.lines;
  assert.ok(Math.abs(hull[0][0] - 100) < 1e-9 && Math.abs(hull[1][0] - 100) < 1e-9 && hull[0][1] > hull[1][1], 'the hull along the heading');
  assert.ok(Math.abs(shaft[0][1] - 80) < 1e-9 && Math.abs(shaft[1][1] - 80) < 1e-9);
  assert.ok(Math.abs(Math.abs(shaft[1][0] - shaft[0][0]) - 2 * KAYAK_MARK.span) < 1e-9);
  // the enlarged chart draws them a quarter bigger
  rec.lines.length = 0;
  drawKayakMarks(g, view, [{ x: 0, z: -100, heading: 0 }], { ink, k: 1.25, near: inside });
  assert.ok(Math.abs(Math.abs(rec.lines[1][1][0] - rec.lines[1][0][0]) - 2.5 * KAYAK_MARK.span) < 1e-9);
});
