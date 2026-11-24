// The compact ephemeris (v2/sim/moon.js) against astronomy-engine (v1's library, a dev dependency here): the moon's
// topocentric altitude and azimuth at the lake within 1°, its lit fraction within 0.02, over the map's day, its night
// and a run of other dates; the sky matrix turns a star to the horizontal frame astronomy-engine gives it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Observer, Equator, Horizon, Body, Illumination, MakeTime, SiderealTime } from 'astronomy-engine';
import { createMoon, daysJ2000, gmstDeg, moonEcliptic } from '../sim/moon.js';
import { makePlace, timeAt } from '../sim/sun.js';

const place = makePlace();
const obs = new Observer(place.latDeg, place.lonDeg, place.altM ?? 1897);
const ref = (ms) => {
  const t = MakeTime(new Date(ms));
  const eq = Equator(Body.Moon, t, obs, true, true);
  const h = Horizon(t, obs, eq.ra, eq.dec, 'normal');
  return { altDeg: h.altitude, azDeg: h.azimuth, lit: Illumination(Body.Moon, t).phase_fraction };
};
const dAz = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

test('the moon at the lake: within 1° of astronomy-engine over the map day and night, the lit fraction within 0.02', () => {
  const M = createMoon(place);
  let worst = 0, worstLit = 0;
  for (let hour = 0; hour < 48; hour += 0.5) {
    const m = M.moonAt(hour), r = ref(timeAt(hour, place.date, place.utcOffsetH));
    const dAlt = Math.abs(m.altDeg - r.altDeg), da = dAz(m.azDeg, r.azDeg) * Math.cos(r.altDeg * Math.PI / 180);
    worst = Math.max(worst, Math.hypot(dAlt, da)); worstLit = Math.max(worstLit, Math.abs(m.lit - r.lit));
    assert.ok(Math.abs(m.x * m.x + m.y * m.y + m.z * m.z - 1) < 1e-9, 'unit');
    assert.ok(Math.abs(Math.sin(m.altDeg * Math.PI / 180) - m.y) < 1e-9, 'y is sin altitude');
  }
  assert.ok(worst < 1.0, `worst angular error ${worst.toFixed(3)}°`);
  assert.ok(worstLit < 0.02, `worst lit fraction error ${worstLit.toFixed(4)}`);
});

test('other dates (a year of first-of-month nights): still within 1° and 0.02', () => {
  let worst = 0, worstLit = 0;
  for (let mo = 0; mo < 12; mo++) {
    const date = `2026-${String(mo + 1).padStart(2, '0')}-01`;
    const M = createMoon({ ...place, date });
    for (const hour of [1, 5, 13, 21, 23.5]) {
      const m = M.moonAt(hour), r = ref(timeAt(hour, date, place.utcOffsetH));
      worst = Math.max(worst, Math.hypot(m.altDeg - r.altDeg, dAz(m.azDeg, r.azDeg) * Math.cos(r.altDeg * Math.PI / 180)));
      worstLit = Math.max(worstLit, Math.abs(m.lit - r.lit));
    }
  }
  assert.ok(worst < 1.0, `worst ${worst.toFixed(3)}°`);
  assert.ok(worstLit < 0.02, `lit ${worstLit.toFixed(4)}`);
});

test('the sidereal time and the sky matrix: a J2000 star lands where astronomy-engine puts it (within 0.7°: precession and nutation left out)', () => {
  const M = createMoon(place);
  for (const hour of [0, 3.3, 12, 22.7]) {
    const ms = timeAt(hour, place.date, place.utcOffsetH), d = daysJ2000(ms), t = MakeTime(new Date(ms));
    const gst = SiderealTime(t) * 15;
    assert.ok(dAz(gmstDeg(d), gst) < 0.02, `GMST ${gmstDeg(d).toFixed(3)} vs ${gst.toFixed(3)}`);
    // Vega (J2000 RA 18h36m56s, Dec +38°47′): as a J2000 unit vector through the matrix, against Horizon() of its J2000 coordinates
    const ra = (18 + 36 / 60 + 56.3 / 3600) * 15 * Math.PI / 180, dec = (38 + 47 / 60 + 1 / 3600) * Math.PI / 180;
    const s = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const K = M.skyMatrix(hour);
    const w = [K[0] * s[0] + K[1] * s[1] + K[2] * s[2], K[3] * s[0] + K[4] * s[1] + K[5] * s[2], K[6] * s[0] + K[7] * s[1] + K[8] * s[2]];
    const alt = Math.asin(w[1]) * 180 / Math.PI, az = ((Math.atan2(w[0], -w[2]) * 180 / Math.PI) + 360) % 360;
    const h = Horizon(t, obs, ra * 12 / Math.PI, dec * 180 / Math.PI, 'normal');   // RA in sidereal hours, Dec in degrees, no refraction
    assert.ok(Math.hypot(alt - h.altitude, dAz(az, h.azimuth) * Math.cos(h.altitude * Math.PI / 180)) < 0.7, `Vega at ${hour}: ${alt.toFixed(2)}/${az.toFixed(2)} vs ${h.altitude.toFixed(2)}/${h.azimuth.toFixed(2)}`);
  }
});

test('the lunar distance stays within the real range and the series is continuous across a day', () => {
  for (let d = 9000; d < 9400; d += 7) { const m = moonEcliptic(d); assert.ok(m.distKm > 356000 && m.distKm < 407000, `${m.distKm}`); }
  const M = createMoon(place);
  let prev = M.moonAt(0).altDeg;
  for (let h = 0.01; h <= 24; h += 0.01) { const a = M.moonAt(h).altDeg; assert.ok(Math.abs(a - prev) < 0.3, `jump at ${h}`); prev = a; }
});
