// Lakeshore's world frame on the real Earth. Plain JS, no three.js.
// A transverse Mercator (GRS80, scale 1) centred on the lake's origin (its profile's lat, lon: Fannette Island's summit
// at Tahoe): x = easting, z = −northing, metres. Krüger's series to the 4th order (Karney 2011): mm-exact within 100 km
// of the centre. The same projection as tools/terrain/build_tahoe.py (pyproj), so world positions and the baked grids agree.
//   makeGeo(waters) → { ORIGIN, Y0, lonLatToWorld, worldToLonLat, PROJ } for a lake profile (src/waters/<id>.json)
//   lonLatToWorld(lon, lat) → [x, z]      worldToLonLat(x, z) → [lon, lat]      (degrees): this page's lake
//   Y0: the lake surface's elevation (m, NAVD88; the profile's terrain.surfaceM); world y = elevation − Y0
import { CURRENT_WATERS } from './waters/current.js';

const a = 6378137, f = 1 / 298.257222101, n = f / (2 - f);
const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
const alpha = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180, 13 * n * n / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440,
  61 * n ** 3 / 240 - 103 * n ** 4 / 140, 49561 * n ** 4 / 161280];
const beta = [n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96 - n ** 4 / 360, n * n / 48 + n ** 3 / 15 - 437 * n ** 4 / 1440,
  17 * n ** 3 / 480 - 37 * n ** 4 / 840, 4397 * n ** 4 / 161280];
const delta = [2 * n - 2 * n * n / 3 - 2 * n ** 3 + 116 * n ** 4 / 45, 7 * n * n / 3 - 8 * n ** 3 / 5 - 227 * n ** 4 / 45,
  56 * n ** 3 / 15 - 136 * n ** 4 / 35, 4279 * n ** 4 / 630];
const D = Math.PI / 180, e2n = 2 * Math.sqrt(n) / (1 + n);

function forward(lon, lat, lon0) {
  const phi = lat * D, lam = (lon - lon0) * D;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e2n * Math.atanh(e2n * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 4; j++) {
    E += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    N += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [A * E, A * N];
}
// one lake's frame: its origin (the profile's lat, lon) and its surface (terrain.surfaceM)
export function makeGeo(waters) {
  const ORIGIN = { lat: waters.lat, lon: waters.lon };
  const N0 = forward(ORIGIN.lon, ORIGIN.lat, ORIGIN.lon)[1];
  function lonLatToWorld(lon, lat) {
    const [E, N] = forward(lon, lat, ORIGIN.lon);
    return [E, -(N - N0)];
  }
  function worldToLonLat(x, z) {
    const xi = (-z + N0) / A, eta = x / A;
    let xp = xi, ep = eta;
    for (let j = 1; j <= 4; j++) {
      xp -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      ep -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
    const lam = Math.atan2(Math.sinh(ep), Math.cos(xp));
    return [ORIGIN.lon + lam / D, phi / D];
  }
  // the proj string the build script uses (one place for both)
  const PROJ = `+proj=tmerc +lat_0=${ORIGIN.lat} +lon_0=${ORIGIN.lon} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
  return { ORIGIN, Y0: waters.terrain.surfaceM, lonLatToWorld, worldToLonLat, PROJ };
}

// this page's lake (src/waters/current.js)
export const { ORIGIN, Y0, lonLatToWorld, worldToLonLat, PROJ } = makeGeo(CURRENT_WATERS);
