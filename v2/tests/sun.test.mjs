// The sun (v2/sim/sun.js) against the published times for Tahoe on the highlight day (src/place.js header: USNO,
// 2026-07-04: sunrise 05:40, solar noon 13:05, sunset 20:29 PDT) and v1's analytic sun's conventions (x east, y up,
// z south).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSun, makePlace, solarDeclEqTime, timeAt } from '../sim/sun.js';

test('the place: Fannette Island on the highlight day, PDT', () => {
  const p = makePlace();
  assert.equal(p.date, '2026-07-04'); assert.equal(p.utcOffsetH, -7);
  assert.ok(Math.abs(p.latDeg - 38.954) < 0.01); assert.ok(Math.abs(p.lonDeg + 120.100) < 0.01);
  assert.equal(makePlace(undefined, 'normal').date, '2026-06-15');
});

test('declination and the equation of time on 2026-07-04 19:00 UTC (NOAA: +22.82°, −4.51 min)', () => {
  const { declDeg, eqTimeMin } = solarDeclEqTime(Date.parse('2026-07-04T19:00:00Z'));
  assert.ok(Math.abs(declDeg - 22.82) < 0.02, `decl ${declDeg}`);
  assert.ok(Math.abs(eqTimeMin + 4.51) < 0.1, `eqt ${eqTimeMin}`);
  assert.equal(timeAt(0, '2026-07-04', -7), Date.parse('2026-07-04T07:00:00Z'));
});

test('sunrise, noon and sunset within 3 minutes of the almanac; the frame is x east, y up, z south', () => {
  const sun = createSun();
  const elev = (h) => sun.sunAt(h).elevDeg;
  // the geometric horizon crossing is ≈ 0.83° below (refraction + the disc); the almanac times are for that
  const cross = (a, b) => { for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if ((elev(m) + 0.833 > 0) === (elev(a) + 0.833 > 0)) a = m; else b = m; } return (a + b) / 2; };
  const rise = cross(3, 9), set = cross(17, 23);
  assert.ok(Math.abs(rise - (5 + 40 / 60)) < 0.05, `sunrise ${rise.toFixed(3)} h`);
  assert.ok(Math.abs(set - (20 + 29 / 60)) < 0.05, `sunset ${set.toFixed(3)} h`);
  let best = 10, bh = 0; for (let h = 12; h < 14; h += 1 / 600) { const s = sun.sunAt(h); if (Math.abs(s.x) < best) { best = Math.abs(s.x); bh = h; } }
  assert.ok(Math.abs(bh - (13 + 5 / 60)) < 0.05, `solar noon ${bh.toFixed(3)} h`);
  const noon = sun.sunAt(13.08);
  assert.ok(noon.elevDeg > 73 && noon.elevDeg < 75, `noon elevation ${noon.elevDeg}`);
  assert.ok(noon.z > 0 && Math.abs(noon.x) < 0.02, 'at noon the sun is south: +z in the x-east, y-up, z-south frame');
});

test('the direction is unit and reused (no allocation per call); morning east, evening west', () => {
  const sun = createSun();
  const a = sun.sunAt(7), b = sun.sunAt(20);
  assert.equal(a, b, 'the same object');
  assert.ok(Math.abs(Math.hypot(b.x, b.y, b.z) - 1) < 1e-9);
  assert.ok(sun.sunAt(7).x > 0.5, 'morning: east');
  assert.ok(sun.sunAt(20).x < -0.5, 'evening: west');
  assert.ok(sun.sunAt(7).azDeg > 60 && sun.sunAt(7).azDeg < 90);
  assert.ok(sun.sunAt(20).azDeg > 290 && sun.sunAt(20).azDeg < 305);
  assert.ok(sun.sunAt(1).elevDeg < -20, 'night');
});
