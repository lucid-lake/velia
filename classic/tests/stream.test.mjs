// The streaming core's contract (src/stream/: config, grid, manager), on a fake clock.
// Run: node --test tests/stream.test.mjs
// v1 only (/classic/): trimmed to its representative check(s).
// The headroom rule (owner, 2026-10-29): the stream keeps up at 30 m/s of camera ground speed (4× today's worst case),
// the near radius and the prefetch grow with the observed speed, and a late tile is logged, never a hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STREAM } from '../src/stream/config.js';
import { tileOf, tileKey, parseKey, tileRect, rectDist, tilesWithin, predictPath } from '../src/stream/grid.js';
import { StreamManager } from '../src/stream/manager.js';

test('grid: ids round-trip; tiles within a radius, nearest first; the path ahead', () => {
  assert.deepEqual(tileOf(-1, 499), [-1, 0]);
  assert.deepEqual(parseKey(tileKey(-3, 7)), [-3, 7]);
  const r = tileRect(2, -1); assert.deepEqual([r.x0, r.z0, r.x1, r.z1], [1000, -500, 1500, 0]);
  assert.equal(rectDist(1200, -100, r), 0);
  assert.equal(rectDist(900, -100, r), 100);
  const t = tilesWithin(250, 250, 600);
  assert.equal(t[0][2], 0); for (let i = 1; i < t.length; i++) assert.ok(t[i][2] >= t[i - 1][2]);
  assert.ok(t.every(([, , d]) => d <= 600));
  const p = predictPath({ x: 0, z: 0 }, { x: 30, z: 0 }, 4, 250);
  assert.equal(p[0].t, 0); assert.equal(p.at(-1).t, 4); assert.ok(Math.abs(p.at(-1).x - 120) < 1e-9);
  assert.equal(predictPath({ x: 5, z: 5 }, { x: 0, z: 0 }, 4).length, 1);
});

// a fake system on the 500 m grid: wants the tiles within the near radius of every path point; builds take
// `buildMs` of fake time, uploads one slice each
function fakeWorld({ buildMs = 200, sliceMs = 0.5 } = {}) {
  let now = 0;
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const sm = new StreamManager({ now: clock.now });
  const resident = new Set(), pending = [];
  sm.register({
    name: 'tiles',
    want(view) {
      const out = new Map();
      for (const p of view.path) for (const [i, j, d] of tilesWithin(p.x, p.z, 600)) {
        const k = tileKey(i, j);
        const due = p.t === 0 && d <= 300;
        const o = out.get(k); if (!o || p.t < o.eta || due) out.set(k, { key: k, eta: p.t, due: due || o?.due });
      }
      return [...out.values()];
    },
    keep: (k, view) => { const [i, j] = parseKey(k); return rectDist(view.x, view.z, tileRect(i, j)) < 600 + STREAM.hysteresis; },
    build: (k) => new Promise((res) => pending.push({ at: now + buildMs, res: () => res(k) })),
    upload: (k) => { clock.advance(sliceMs); resident.add(k); return true; },
    drop: (k) => { resident.delete(k); },
  });
  const flush = () => { for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= now) { pending[i].res(); pending.splice(i, 1); } };
  return { sm, clock, resident, flush };
}

async function drive(world, speed, seconds, dt = 1 / 60) {
  const { sm, clock, flush } = world;
  let x = 0; const cam = { position: { x: 0, y: 3, z: 0 } };
  let maxUpload = 0;
  // the start: settle at rest
  for (let i = 0; i < 400 && (!sm.idle() || i === 0); i++) { sm.update(cam, dt); clock.advance(dt * 1000); flush(); await null; }
  sm.log.length = 0; sm.missing.clear();
  for (let i = 0; i < seconds / dt; i++) {
    x += speed * dt; cam.position.x = x;
    const u0 = clock.now(); sm.update(cam, dt); maxUpload = Math.max(maxUpload, clock.now() - u0);
    clock.advance(dt * 1000); flush(); await null; await null;
  }
  return { log: sm.log, maxUpload, report: sm.report() };
}

test('manager: at 30 m/s, the near tiles are resident before the camera arrives (no incomplete arrival)', async () => {
  const r = await drive(fakeWorld({ buildMs: 300 }), STREAM.speed.design, 40);
  assert.equal(r.log.length, 0, JSON.stringify(r.log.slice(0, 3)));
  assert.ok(r.report.view.speed > 25 && r.report.view.speed < 35, `observed ${r.report.view.speed}`);
  assert.ok(r.report.view.nearR > STREAM.bands.near, 'the near radius grows with speed');
});

