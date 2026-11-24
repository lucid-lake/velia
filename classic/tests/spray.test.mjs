// The bow spray's droplets (src/boat/spray.js; fix/helm-spray, 2026-11-06): thin streaks, never big round puffs.
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpray } from '../src/boat/spray.js';

const STATE = { u: 3.2, heading: 1.0, x: 0, z: 0, slam: 1, trueWind: { speed: 7, angle: 0.6 } };
const sail = (s, n = 90) => { for (let i = 0; i < n; i++) s.update(STATE, { heave: 0, pitch: 0 }, 1 / 60); return s.core; };

test('deterministic: the same seed and inputs give the same droplets', () => {
  const a = sail(createSpray({ seed: 3 })), b = sail(createSpray({ seed: 3 }));
  assert.deepEqual([...a.pos], [...b.pos]);
  assert.deepEqual([...a.size], [...b.size]);
});
