// The slow lane (npm run test:slow): the thrill build's surfing check (tests/thrill.test.mjs has the rest; this one ran in
// the fast suite until 2026-11-12, about 11 s). The physics is src/boat.js (§ 6b the waves' surge) on src/boat/float.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KN } from '../../src/sim/boat.js';
import { simSurf, bursts } from '../../src/sim/boat/sim.js';

const f = (x, d = 2) => x.toFixed(d);
const HULL_KN = 0.4 * Math.sqrt(9.81 * 7.26) / KN;   // Fn 0.40: 6.56 kn

test('surfing: none on a beat; at level 4 on a broad reach on the open lake a burst past hull speed every 10–30 s, none on flat water', () => {
  const beat = simSurf({ twaDeg: 42, fetchM: 4500, seconds: 120 });
  const maxSurfBeat = Math.max(...beat.rows.map((r) => r.surf));
  assert.ok(bursts(beat.rows).length === 0 && maxSurfBeat < 0.2, `beat: ${bursts(beat.rows).length} bursts, surf up to ${f(maxSurfBeat)}`);
  const reach = simSurf({ twaDeg: 135, fetchM: 4500, seconds: 240 }), b = bursts(reach.rows);
  const every = 240 / Math.max(1, b.length), peak = Math.max(...b.map((q) => q.peak));
  console.log(`level 4, TWA 135°, fetch 4.5 km (Hs ${f(reach.sea.hs)} m, λp ${f(reach.sea.lambdaP, 1)} m): ${b.length} bursts in 240 s (one every ${f(every, 1)} s), peak ${f(peak)} kn, mean length ${f(b.reduce((s, q) => s + q.len, 0) / b.length, 1)} s`);
  assert.ok(every >= 10 && every <= 30, `a burst every ${f(every, 1)} s`);
  assert.ok(peak > HULL_KN + 0.4, `peak ${f(peak)} kn vs hull speed ${f(HULL_KN)} kn`);
  assert.ok(b.every((q) => q.len < 10), 'bursts, not a plateau');
  const flat = simSurf({ twaDeg: 135, fetchM: 4500, seconds: 240, noSea: true });
  const flatMax = Math.max(...flat.rows.map((r) => r.kn));
  assert.ok(bursts(flat.rows).length === 0 && peak > flatMax + 0.4, `flat water: ${bursts(flat.rows).length} bursts, max ${f(flatMax)} kn`);
  // the lee of the bay (1.2 km of fetch: λp 3 m, shorter than the hull) gives the waves nothing to push with
  const bay = simSurf({ twaDeg: 135, fetchM: 1200, seconds: 240 }), nb = bursts(bay.rows).length;
  assert.ok(nb <= b.length / 3, `the bay's short chop: ${nb} bursts in 240 s vs ${b.length} on the open lake`);
});
