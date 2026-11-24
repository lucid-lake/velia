// WGS84 latitude/longitude ↔ UTM (Transverse Mercator, Snyder 1987 "Map Projections — A Working Manual", USGS PP 1395,
// pp. 61–64), for zone 10N by default (Lake Tahoe: −120.2° to −119.9° lies in zone 10, central meridian −123°).
// Accurate to well under 1 m inside the zone. Plain JS: the build tools and the node tests share it.
//   import { toUTM, fromUTM } from './utm.js';
//   toUTM(38.9537, -120.1004)   // → { e, n } metres (EPSG:32610)
//   fromUTM(e, n)               // → { lat, lon } degrees
const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const DEG = Math.PI / 180;

function meridian(phi) {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
}

export function toUTM(lat, lon, zone = 10) {
  const phi = lat * DEG, lam0 = ((zone - 1) * 6 - 180 + 3) * DEG;
  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = EP2 * Math.cos(phi) ** 2;
  const Aa = Math.cos(phi) * (lon * DEG - lam0), M = meridian(phi);
  const e = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120) + 500000;
  const n = K0 * (M + N * Math.tan(phi) * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
  return { e, n };
}

export function fromUTM(e, n, zone = 10) {
  const lam0 = ((zone - 1) * 6 - 180 + 3) * DEG;
  const M = n / K0, mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2), T1 = Math.tan(phi1) ** 2, C1 = EP2 * Math.cos(phi1) ** 2;
  const R1 = A * (1 - E2) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5, D = (e - 500000) / (N1 * K0);
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lam0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(phi1);
  return { lat: lat / DEG, lon: lon / DEG };
}
