// What "level 4" reads (2026-10-30, fix/blobs-wind). A contractor read 19–21 m/s "at the camera" at level 4 and asked
// for a unit or height slip. There is none: wind.sample is the 10 m wind in m/s with no height term, every display
// shows kn, and the level sets the MEAN (18–24 kn = 9.3–12.3 m/s). 19–21 m/s is the 10-minute PEAK gust (≈ 1.75 × mean).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindField, WIND_LEVELS, LEVEL_REF_HOUR } from '../src/sim/wind.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
const BAY = CURRENT_WATERS.windBay;   // the open bay's box (the lake profile's)
import { makeTerrain } from '../src/sim/terrain.js';
import { KN as KN_HUD } from '../src/ui/captainView.js';

const KT = 0.514444;
test('the HUD converts m/s to kn with the inverse of the field’s kn', () => {
  assert.ok(Math.abs(KN_HUD * KT - 1) < 1e-5, `${KN_HUD} × ${KT}`);
});

test('level 4 at 18:45: the bay’s mean is in 18–24 kn (m/s 9.3–12.3); the peak gust stays under 21 m/s (seeds 1–3)', () => {
  const [lo, hi] = WIND_LEVELS[3].kn;
  for (const seed of [1, 2, 3]) {
    const T = makeTerrain({ seed });
    const w = new WindField({ seed, day: { hour: LEVEL_REF_HOUR, rate: 1 }, level: 4 }); w.setTerrain(T.heightAt);
    let s = 0, n = 0, mx = 0;
    for (let z = BAY.z0; z <= BAY.z1; z += BAY.dz) for (let x = BAY.x0; x <= BAY.x1; x += BAY.dx) {
      if (T.heightAt(x, z) >= BAY.deep) continue;
      for (let t = 0; t < 600; t += 20) { const v = w.sample(x, z, t).speed; s += v; n++; mx = Math.max(mx, v); }
    }
    const meanKn = s / n / KT;
    assert.ok(meanKn >= lo && meanKn <= hi, `seed ${seed}: mean ${meanKn.toFixed(1)} kn, band ${lo}–${hi}`);
    assert.ok(mx < 21, `seed ${seed}: peak ${mx.toFixed(1)} m/s (${(mx / KT).toFixed(1)} kn)`);
    assert.ok(mx > 15, `seed ${seed}: the gusts are real (peak ${mx.toFixed(1)} m/s)`);
  }
});
