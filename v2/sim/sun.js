// The sun's direction for the scene's hour, from the shared sim: src/sim/timeOfDay.js's NOAA solar equations
// (solarDeclEqTime, the same v1's analyticSun runs) and src/sim/place.js's place (the lake profile's latitude,
// longitude, the map's day and its UTC offset: Fannette Island, 38.954° N 120.100° W, PDT, 2026-07-04). What stays
// here is the allocation-free per-frame call: v1's analyticSun returns a new object each call; createSun() reads the
// day's declination and equation of time once and writes the direction into one reused record.
//   sunAt(hour) → { x, y, z, elevDeg, azDeg }   x east, y up, z south (v1's world frame); hour = local clock time
import { solarDeclEqTime } from '../../src/sim/timeOfDay.js';
import { makePlace as simMakePlace, timeAt as simTimeAt } from '../../src/sim/place.js';
import { pickDay } from '../../src/sim/day.js';
import waters from '../../src/waters/tahoe-emerald.json' with { type: 'json' };

const DEG = Math.PI / 180;
export { solarDeclEqTime };

// ms since the epoch at a local clock hour on an ISO date with a UTC offset (src/sim/place.js timeAt's arithmetic)
export const timeAt = (hour, date, utcOffsetH) => simTimeAt(hour, { date, utcOffsetH });

// the lake profile's place on the chosen day (the map's highlight day unless ?day= or a key says otherwise)
export function makePlace(profile = waters, dayChoice = null) {
  const p = simMakePlace(profile, pickDay(profile, dayChoice));
  return Object.freeze({ latDeg: p.latDeg, lonDeg: p.lonDeg, date: p.date, dayKey: p.day, utcOffsetH: p.utcOffsetH, altM: p.altM });
}

// one declination / equation-of-time pair per day, read at the place's mean solar noon (continuous when the hour wraps)
export function createSun(place = makePlace()) {
  const { latDeg, lonDeg, utcOffsetH, date } = place;
  const { declDeg, eqTimeMin } = solarDeclEqTime(timeAt(12 - lonDeg / 15 + utcOffsetH, date, utcOffsetH));
  const phi = latDeg * DEG, d = declDeg * DEG;
  const out = { x: 0, y: 1, z: 0, elevDeg: 90, azDeg: 0 };   // reused: no allocation per call
  return {
    place, declDeg, eqTimeMin,
    sunAt(hour, o = out) {
      const solar = hour - utcOffsetH + lonDeg / 15 + eqTimeMin / 60;
      const H = (solar - 12) * 15 * DEG;
      const e = -Math.cos(d) * Math.sin(H);
      const n = Math.cos(phi) * Math.sin(d) - Math.sin(phi) * Math.cos(d) * Math.cos(H);
      const u = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
      o.x = e; o.y = u; o.z = -n;
      o.elevDeg = Math.asin(Math.max(-1, Math.min(1, u))) / DEG;
      o.azDeg = ((Math.atan2(e, n) / DEG) + 360) % 360;   // compass azimuth, 0 = north, 90 = east
      return o;
    },
  };
}
