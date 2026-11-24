// The moon and the turning sky, three-free (M5e: the night). v1 reads both from astronomy-engine through
// @takram's celestialDirections (src/core/celestial.js: a 330 kB library for two directions); v2 carries a compact
// ephemeris instead: Meeus's truncated lunar series (Astronomical Algorithms ch. 47, the leading terms: about 0.3° in
// longitude, 0.2° in latitude), the Sun's low-precision longitude, the mean obliquity, the Greenwich mean sidereal time
// and the topocentric parallax (the moon's horizontal parallax is ≈ 1°: an observer on the ground sees it lower).
// The test (moon.test.mjs) holds it within 1° of astronomy-engine's topocentric altitude and azimuth at the lake across
// the map's day and its nights, and the lit fraction within 0.02. Plain JS, no allocation in the per-frame calls.
//
//   const M = createMoon(place);                      // place: v2/sim/sun.js makePlace() (lat, lon, the day, the UTC offset)
//   M.moonAt(hour, out) → { x, y, z, altDeg, azDeg, lit, distKm }   x east, y up, z south (v1's world frame); lit 0–1
//   M.skyMatrix(hour, out9) → the 3 × 3 row-major matrix from J2000 equatorial (x to RA 0, z to the pole) to world
//   moonLightShare(altDeg, lit)                        the moon's share of its full light (src/core/milkyway-math.js)
import { timeAt } from '../../src/sim/place.js';
import { makePlace } from './sun.js';

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);   // 2000-01-01 12:00 TT ≈ UT (the 64 s offset is 0.03° of the moon's motion)
const norm360 = (x) => ((x % 360) + 360) % 360;

// days since J2000 for a Date or ms
export const daysJ2000 = (ms) => (ms - J2000_MS) / 86400000;

// the Sun's geocentric ecliptic longitude (deg) and the mean obliquity (deg): Astronomical Almanac's low-precision formulas
export function sunEcliptic(d) {
  const L = norm360(280.460 + 0.9856474 * d), g = norm360(357.528 + 0.9856003 * d) * DEG;
  return { lonDeg: norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)), obliqDeg: 23.439 - 0.0000004 * d };
}

// the Moon's geocentric ecliptic longitude, latitude (deg) and distance (km): Meeus ch. 47, the leading terms
export function moonEcliptic(d) {
  const T = d / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T) * DEG;   // mean longitude
  const D = norm360(297.8501921 + 445267.1114034 * T) * DEG;     // mean elongation
  const M = norm360(357.5291092 + 35999.0502909 * T) * DEG;      // the Sun's mean anomaly
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * DEG;    // the Moon's mean anomaly
  const F = norm360(93.2720950 + 483202.0175233 * T) * DEG;      // the argument of latitude
  const s = Math.sin, c = Math.cos;
  const lon = Lp / DEG
    + 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) - 0.114332 * s(2 * F)
    + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp) + 0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M)
    - 0.040923 * s(M - Mp) - 0.034720 * s(D) - 0.030383 * s(M + Mp) + 0.015327 * s(2 * D - 2 * F) - 0.012528 * s(Mp + 2 * F)
    + 0.010980 * s(Mp - 2 * F) + 0.010675 * s(4 * D - Mp) + 0.010034 * s(3 * Mp) + 0.008548 * s(4 * D - 2 * Mp);
  const lat = 5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F) + 0.055413 * s(2 * D - Mp + F)
    + 0.046271 * s(2 * D - Mp - F) + 0.032573 * s(2 * D + F) + 0.017198 * s(2 * Mp + F) + 0.009266 * s(2 * D + Mp - F) + 0.008822 * s(2 * Mp - F);
  const dist = 385000.56 - 20905.355 * c(Mp) - 3699.111 * c(2 * D - Mp) - 2955.968 * c(2 * D) - 569.925 * c(2 * Mp) + 48.888 * c(M) - 3.149 * c(2 * F)
    + 246.158 * c(2 * D - 2 * Mp) - 152.138 * c(2 * D - M - Mp) - 170.733 * c(2 * D + Mp) - 204.586 * c(2 * D - M) - 129.620 * c(M - Mp) + 108.743 * c(D);
  return { lonDeg: norm360(lon), latDeg: lat, distKm: dist };
}

// ecliptic (deg) → equatorial right ascension and declination (rad), for the obliquity (deg)
export function eclipticToEquatorial(lonDeg, latDeg, obliqDeg) {
  const l = lonDeg * DEG, b = latDeg * DEG, e = obliqDeg * DEG;
  const x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e), z = Math.cos(b) * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e);
  return { ra: Math.atan2(y, x), dec: Math.asin(Math.max(-1, Math.min(1, z))) };
}

// Greenwich mean sidereal time (deg) at d days since J2000 (UT)
export const gmstDeg = (d) => norm360(280.46061837 + 360.98564736629 * d);

// the horizontal direction (x east, y up, z south) of an equatorial direction (ra, dec in rad) at local sidereal time
// lstRad and latitude phiRad; written into o
export function toHorizontal(ra, dec, lstRad, phiRad, o) {
  const H = lstRad - ra;
  const cd = Math.cos(dec), sd = Math.sin(dec), cH = Math.cos(H), sH = Math.sin(H), sp = Math.sin(phiRad), cp = Math.cos(phiRad);
  o.x = -cd * sH;                       // east
  o.y = sp * sd + cp * cd * cH;         // up
  o.z = -(sd * cp - cd * cH * sp);      // south (= −north)
  return o;
}

// the lit fraction of the disc from the Sun's and the Moon's equatorial directions: (1 − cos ψ) / 2, ψ the elongation
export function litFraction(sun, moon) {
  const cosPsi = Math.sin(sun.dec) * Math.sin(moon.dec) + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra);
  return 0.5 * (1 - Math.max(-1, Math.min(1, cosPsi)));
}

const EARTH_KM = 6371;
export function createMoon(place = makePlace()) {
  const { latDeg, lonDeg, utcOffsetH, date } = place;
  const phi = latDeg * DEG;
  const out = { x: 0, y: -1, z: 0, altDeg: -90, azDeg: 0, lit: 0, distKm: 385000 };   // reused: no allocation per call
  const eqS = { ra: 0, dec: 0 }, eqM = { ra: 0, dec: 0 }, tmp = { x: 0, y: 0, z: 0 };
  const msAt = (hour) => timeAt(hour, { date, utcOffsetH });
  return {
    place,
    // the moon at the local clock hour: its topocentric direction in the world frame, altitude and azimuth (deg, from
    // north through east), lit fraction and distance
    moonAt(hour, o = out) {
      const d = daysJ2000(msAt(hour));
      const se = sunEcliptic(d), me = moonEcliptic(d);
      const s = eclipticToEquatorial(se.lonDeg, 0, se.obliqDeg); eqS.ra = s.ra; eqS.dec = s.dec;
      const m = eclipticToEquatorial(me.lonDeg, me.latDeg, se.obliqDeg); eqM.ra = m.ra; eqM.dec = m.dec;
      const lst = (gmstDeg(d) + lonDeg) * DEG;
      toHorizontal(m.ra, m.dec, lst, phi, tmp);
      // the topocentric parallax: the observer stands EARTH_KM from the centre, straight up; the geocentric vector less
      // the observer's, normalised (an altitude ≈ 0.95° lower at the horizon, none at the zenith)
      const r = me.distKm;
      let x = tmp.x * r, y = tmp.y * r - EARTH_KM, z = tmp.z * r;
      const n = Math.hypot(x, y, z) || 1; x /= n; y /= n; z /= n;
      o.x = x; o.y = y; o.z = z;
      o.altDeg = Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
      o.azDeg = norm360(Math.atan2(x, -z) / DEG);
      o.lit = litFraction(eqS, eqM);
      o.distKm = r;
      return o;
    },
    // the rotation from J2000 equatorial coordinates (the star catalogue's and the Milky Way map's: x to RA 0 on the
    // equator, z to the north pole) to the world frame at the hour; 3 × 3, row-major: world = M · star. Precession since
    // J2000 (0.36° by 2026) is left out: under a third of a key texel
    skyMatrix(hour, o = new Float32Array(9)) {
      const d = daysJ2000(msAt(hour));
      const L = (gmstDeg(d) + lonDeg) * DEG, cL = Math.cos(L), sL = Math.sin(L), cp = Math.cos(phi), sp = Math.sin(phi);
      o[0] = -sL; o[1] = cL; o[2] = 0;                 // east
      o[3] = cp * cL; o[4] = cp * sL; o[5] = sp;        // up
      o[6] = sp * cL; o[7] = sp * sL; o[8] = -cp;       // south
      return o;
    },
  };
}
