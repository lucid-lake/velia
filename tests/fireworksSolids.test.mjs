// The show's props are solid and come only in the evening (fix/barge-collision, owner 2026-11-09: "they exist during day
// time, and they do not have a collider mesh, so the boat just sails through it like a ghost"). Behaviour only: the real
// BoatPhysics rammed at each prop under its engine, the contact in the physics' post hook (src/fireworks/solids.js); the
// presence (src/fireworks/presence.js) stepped through a day with a camera that sees or does not see the spots; the
// computer boats' clear(). The ramming sweep and Cruise's trip past the barges run in the slow lane
// (tests/slow/fireworksSolids.slow.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ram, onBody } from './helpers/solids-ram.mjs';
import { createSolids, blocked } from '../classic/src/fireworks/solids.js';
import { createPresence, towPath, TOW, PRESENCE } from '../classic/src/fireworks/presence.js';
import { bargesWorld, VIEW } from '../src/fireworks/stage.js';
import { sailboatSpots } from '../classic/src/fireworks/spectators.js';
import { makeClear } from '../src/sim/race/rival.js';

const DEG = Math.PI / 180;
const B = bargesWorld();
const SO = { barges: B, toward: VIEW, sailboats: sailboatSpots(VIEW) };
const spots = B.map((b) => ({ x: b.x, z: b.z, yaw: Math.atan2(b.axis[0], b.axis[1]) }));

// the ramming sweep (tests/helpers/solids-ram.mjs rammingSweep) runs in the slow lane, both barges

test('a hard hit at hull speed (over 3.8 m/s at the touch) still never leaves the boat inside', () => {
  const b = createSolids(SO).bodies.find((q) => q.kind === 'barge');
  const p = onBody(b, 0, 9, 90);
  for (const rel of [-30, 0, 30]) {
    const r = ram({ solids: SO, target: p, fromDeg: p.out + rel, dist: 6.5, speed: 6, secs: 6 });
    assert.ok(r.uBefore > 3.8, `${r.uBefore.toFixed(2)} m/s at the touch`);
    assert.ok(r.minGap > -0.02 && r.solids.stats.maxPen < 0.15, `from ${rel}°: gap ${r.minGap.toFixed(3)} m, overlap ${r.solids.stats.maxPen.toFixed(3)} m`);
  }
});

test('a patrol boat is shoved a little and goes back on station; an anchored sailboat barely moves; neither is ever inside', () => {
  const bodies = createSolids(SO).bodies;
  for (const kind of ['patrol', 'sail']) {
    for (const k of bodies.map((b, i) => (b.kind === kind ? i : -1)).filter((i) => i >= 0)) {
      const b = bodies[k];
      for (const from of [b.heading / DEG + 90, b.heading / DEG + 180]) {
        const r = ram({ solids: SO, target: { x: b.x, z: b.z }, fromDeg: from, dist: 25, speed: 3, secs: 12 });
        assert.ok(r.hitAt != null && r.minGap > -0.02, `${kind} ${k}: touched, gap ${r.minGap.toFixed(3)} m`);
        const lim = kind === 'patrol' ? [0.2, 6.01] : [0.02, 2.51];
        assert.ok(r.maxMove[k] > lim[0] && r.maxMove[k] < lim[1], `${kind} ${k}: shoved ${r.maxMove[k].toFixed(2)} m`);
        // the boat backed off: the prop alone for 40 s goes back to its station
        const P = r.solids.bodies[k], S = { x: P.x + 500, z: P.z, heading: 0, u: 0, v: 0, yawRate: 0 };
        for (let i = 0; i < 40 * 60; i++) r.solids.post(S, 1 / 60, 12 + i / 60);
        assert.ok(Math.hypot(P.x - P.x0, P.z - P.z0) < 0.3, `${kind} ${k}: ${Math.hypot(P.x - P.x0, P.z - P.z0).toFixed(2)} m off its station after 40 s`);
      }
    }
  }
});

test('a prop that comes into the world over our boat stays a ghost until the boat is clear (no shove across the deck)', () => {
  const solids = createSolids(SO), b = solids.bodies[0];
  solids.setOn({ barges: false, crowd: false });
  const S = { x: b.x, z: b.z, heading: b.heading, u: 1, v: 0, yawRate: 0 };
  solids.setOn({ barges: true });
  solids.post(S, 1 / 60, 0);
  assert.ok(Math.hypot(S.x - b.x, S.z - b.z) < 0.1, 'not thrown out');
  S.x += 100; solids.post(S, 1 / 60, 0); S.x -= 100;
  assert.ok(b.armed, 'armed once clear');
});

// Cruise's two 12-minute trips past the barges (about 6 s) run in the slow lane: tests/slow/fireworksSolids.slow.mjs

test('the computer boats (Regatta) treat the props as shoal water: a heading through a barge is not clear', () => {
  const bodies = createSolids(SO).bodies.slice(0, 1), b = bodies[0];   // the first barge alone
  const clear = makeClear(() => 30, 4, (x, z) => blocked(bodies, x, z));
  const from = { x: b.x + 120, z: b.z, u: 3, v: 0 };
  assert.equal(clear(-90 * DEG, 60, from), false, 'west into the barge: blocked');
  assert.equal(clear(90 * DEG, 60, from), true, 'east, away from it: clear');
  assert.equal(makeClear(() => 30)(-90 * DEG, 60, from), true, 'without the props as before');
});

// the presence: a camera that sees what `seen` says; the day stepped at the game's own pace (dt 1/60 s, the hour at 10 game
// s a frame: 600 game s a second, a quick but continuous clock)
function day({ from, to, seen = () => false, boatAt = [0, 0], step = 10 / 3600, first = true }) {
  const pr = createPresence({ spots }), log = [];
  for (let h = from, i = 0; h < to; h += step, i++) log.push({ h, ...pr.step({ hour: h % 24, dt: 1 / 60, cut: first && i === 0, inView: (x, z, r) => seen(x, z, r, h), boatAt, crowdAt: SO.sailboats.map((s) => [s.x, s.z]) }) });
  return log;
}

test('daytime: no barges, tugs, patrol boats or spectators from dawn to 20:30 (sunset 20:25) on the show\'s day, whatever the camera sees', async () => {
  const { analyticSun } = await import('../src/sim/timeOfDay.js');
  const elev = (h) => { const s = analyticSun(h); return Math.asin(s.y / Math.hypot(s.x, s.y, s.z)) / DEG; };
  assert.ok(elev(PRESENCE.barges.from) < 0 && elev(PRESENCE.crowd.from) < 0, 'both windows open after sunset');
  for (const seen of [() => false, () => true]) {
    const log = day({ from: 5, to: 20.49, seen });
    assert.ok(log.every((f) => !f.shown && !f.crowd), 'nothing in the world by day');
  }
  // a page opened at any daytime hour (its first frame a cut)
  for (const h of [6.5, 11, 13, 15, 17, 18.75, 19.5, 19.75, 20.25, 20.45]) {
    const pr = createPresence({ spots });
    const f = pr.step({ hour: h, cut: true, inView: () => true });
    assert.ok(!f.shown && !f.crowd, `${h}: none`);
  }
});

test('evening: the barges come out of view after 20:30 and stay till 23:30; in view they never pop', () => {
  // the camera looks at the spots until 20:40, then away: they appear at the first frame away
  const log = day({ from: 20, to: 23.9, seen: (x, z, r, h) => h < 20.667 || h > 23.4 && h < 23.7 });
  const first = log.find((f) => f.shown);
  assert.ok(first.h > 20.666 && first.h < 20.67 && !first.towing, `appeared at ${first.h.toFixed(3)} h, out of view`);
  assert.ok(log.filter((f) => f.h > 20.67 && f.h < 23.5).every((f) => f.shown), 'there all evening');
  const gone = log.find((f) => f.h > 23.5 && !f.shown);
  assert.ok(gone.h > 23.7 && gone.h < 23.71, `went at ${gone.h.toFixed(3)} h, once out of view`);
  // a page opened in the evening, or the share link (21:43), has them at once
  for (const h of [20.55, 21, 21 + 43 / 60, 22.5]) assert.ok(createPresence({ spots }).step({ hour: h, cut: true, inView: () => true }).shown, `${h}: there`);
  // our boat on the spot keeps them away until it leaves
  const near = day({ from: 20.4, to: 20.7, boatAt: [spots[0].x + 20, spots[0].z] });
  assert.ok(near.every((f) => !f.shown), 'not over our boat');
});

test('the tow: a camera that never looks away from the spots gets the barges towed in up the bay, bow first, in by 21:36', async () => {
  const { heightAt } = await import('../src/sim/terrain.js');
  // the camera sees the spots (and the far end of the tow until 20:55)
  const seenSpot = (x, z) => spots.some((p) => Math.hypot(p.x - x, p.z - z) < 1);
  const log = day({ from: 20.4, to: 22, seen: (x, z, r, h) => seenSpot(x, z) || h < 20.917 });
  const start = log.find((f) => f.towing);
  assert.ok(start && start.h > 20.916 && start.h < 20.92, `the tow started at ${start?.h.toFixed(3)} h, its far end out of view`);
  assert.ok(log.filter((f) => f.h < start.h).every((f) => !f.shown), 'nothing before');
  const end = log.find((f) => f.h > start.h && f.shown && !f.towing);
  assert.ok(end && end.h <= TOW.by + 0.01, `in at ${end?.h.toFixed(3)} h`);
  const p0 = start.poses[0], p1 = end.poses[0];
  assert.ok(Math.hypot(p0.x - spots[0].x, p0.z - spots[0].z) > 600, 'it started up the bay');
  assert.ok(Math.hypot(p1.x - spots[0].x, p1.z - spots[0].z) < 1e-6 && Math.abs(p1.yaw - spots[0].yaw) < 1e-6, 'it ends on its spot');
  // a camera that sees everything: the tow starts at TOW.force regardless, and is still in by 21:36
  const all = day({ from: 20.4, to: 22, seen: () => true });
  const s2 = all.find((f) => f.towing), e2 = all.find((f) => f.h > s2.h && !f.towing && f.shown);
  assert.ok(Math.abs(s2.h - TOW.force) < 0.01 && e2.h <= TOW.by + 0.01, `forced tow ${s2.h.toFixed(3)} → ${e2.h.toFixed(3)} h`);
  // the path floats: the barge, its tug and its patrol boats in ≥ 3 m of water all the way; never within 100 m of the
  // viewing spot or the spectators
  const so = createSolids(SO);
  for (const [i, sp] of spots.entries()) {
    const path = towPath(sp);
    for (let s = 0; s <= path.len; s += 10) {
      const p = path.pose(s);
      so.setBargePose(i, p);
      for (const b of so.bodies.filter((q) => q.barge === i)) {
        for (const [bx, by] of b.polys.flat()) { const q = onBody(b, bx, by, 0); assert.ok(heightAt(q.x, q.z) < -3, `barge ${i} at ${s} m: its ${b.kind} aground at ${q.x.toFixed(0)}, ${q.z.toFixed(0)}`); }
      }
      assert.ok(Math.hypot(p.x - VIEW[0], p.z - VIEW[1]) > 200, 'clear of the viewing spot');
    }
  }
});

test('the crowd comes out of view after 20:30, or at 21:30 regardless; gone after 22:40', () => {
  const log = day({ from: 20, to: 23, seen: (x, z, r, h) => h < 20.9 });
  const c = log.find((f) => f.crowd);
  assert.ok(c.h > 20.9 && c.h < 20.91, `out at ${c.h.toFixed(3)} h`);
  const all = day({ from: 20, to: 23, seen: () => true });
  const c2 = all.find((f) => f.crowd);
  assert.ok(Math.abs(c2.h - PRESENCE.crowd.force) < 0.01, `forced at ${c2.h.toFixed(3)} h`);
});
