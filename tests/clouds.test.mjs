// T2/T2b/T2c clouds, the fast part (no browser): the terrain mask.
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakeTerrainMask } from '../classic/src/clouds.js';
import { heightAt } from '../src/sim/terrain.js';

test('terrain mask (T2c): 1 on a slope at the bank height, 0 over the bay', () => {
  const E = 16000, N = 512, m = bakeTerrainMask(heightAt, 150, { extentM: E, size: N }).image.data;
  const at = (x, z) => m[Math.floor((z / E + 0.5) * N) * N + Math.floor((x / E + 0.5) * N)] / 255;
  // the real bay: a slope at ≈ 144 m above its head (−400, 800); mid-bay water (700, −600)
  assert.ok(at(-400, 800) > 0.95 && at(700, -600) < 0.05, `slope at 144 m → ${at(-400, 800).toFixed(2)}, mid-bay → ${at(700, -600).toFixed(2)}`);
});
