// Round 5 (owner, 2026-11-07): shooting stars, seeded on the scene clock: one every 2–5 min, 0.3–0.8 s, never two at once,
// none unless the night is dark and clear, off in captures (forced: the quick test rhythm).
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meteorAt, meteorPoint } from '../src/core/meteors.js';

test('the schedule: deterministic, 2–5 min apart, 0.3–0.8 s long, never overlapping, mostly sideways or down', () => {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const m = meteorAt(7, i), again = meteorAt(7, i);
    assert.deepEqual(m, again, 'same seed, same sky');
    assert.ok(m.dur >= 0.3 && m.dur <= 0.8 && m.alt >= 18 && m.alt <= 70 && m.slant >= 90 && m.slant <= 270);
    if (prev) { const gap = m.t - prev.t; assert.ok(gap >= 120 - 1e-9 && gap <= 300 + 1e-9, `gap ${gap}`); assert.ok(m.t > prev.t + prev.dur); }
    prev = m;
  }
  assert.notDeepEqual(meteorAt(7, 3), meteorAt(8, 3), 'another seed, another sky');
  const m = meteorAt(1, 0), a = meteorPoint(m, 0), b = meteorPoint(m, 1);
  assert.ok(b.alt <= a.alt + 1e-9, 'it never climbs');
});
