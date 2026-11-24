// The test-only second lake (tests/profiles.test.mjs): a 1.28 km square of made-up ground, a round lake 450 m across
// the middle with a small island on the origin, written in the game's own grid format (src/terrain-data.js: gzip of a
// 2-D predicted uint16 grid, hi-byte plane then lo-byte plane) so it loads through the same loader as Tahoe's.
// Not a real place and never shipped: it lives under tests/ and no registry lists it.
//   node tests/fixtures/profiles/make-mini-lake.mjs        (re-writes mini.json, mini-h.lsh, mini-d.lsh, mini-lake.json)
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { makeGeo } from '../../../src/sim/geo.js';

const DIR = new URL('./mini-terrain/', import.meta.url);
const N = 129, STEP = 10, X0 = -640;                 // texel centres from −640 to +640 m
const H = { offset: -100, step: 0.01 }, D = { step: 0.5 };
const R_LAKE = 450, R_ISLE = 40, TOP = 12, DEEP = 20;

const height = (x, z) => {
  const r = Math.hypot(x, z);
  const bowl = r < R_LAKE ? -DEEP * (1 - (r / R_LAKE) ** 2) - 0.5 : (r - R_LAKE) * 0.2;   // the bed, then the bank
  return Math.max(bowl, TOP * (1 - (r / R_ISLE) ** 2));                                  // the island's knob
};
const distance = (x, z) => { const r = Math.hypot(x, z); return Math.max(r - R_LAKE, R_ISLE - r); };   // + on land

function encode(f, enc) {
  const n = N * N, q = new Uint16Array(n), p = new Uint8Array(2 * n);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) q[j * N + i] = Math.max(0, Math.min(65535, Math.round(enc(f(X0 + i * STEP, X0 + j * STEP)))));
  for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) {
    const left = i ? q[k - 1] : 0, up = j ? q[k - N] : 0, ul = i && j ? q[k - N - 1] : 0;
    const r = (q[k] - (j && i ? left + up - ul : j ? up : left)) & 0xffff;
    p[k] = r >> 8; p[n + k] = r & 0xff;
  }
  return gzipSync(p, { level: 9 });
}

writeFileSync(new URL('mini-h.lsh', DIR), encode(height, (h) => (h - H.offset) / H.step));
writeFileSync(new URL('mini-d.lsh', DIR), encode(distance, (d) => d / D.step + 32768));
const ORIGIN = { lat: 45.5, lon: -111.25 };
writeFileSync(new URL('mini.json', DIR), JSON.stringify({ version: 1, origin: ORIGIN, y0: 1200, height: H, distance: D,
  levels: [{ name: 'mini', step: STEP, x0: X0, z0: X0, w: N, h: N, height: 'mini-h.lsh', distance: 'mini-d.lsh', dk: 1, dw: N, dh: N }] }, null, 1) + '\n');

// the profile: the same blocks as a shipped lake, every point placed on this ground
const geo = makeGeo({ lat: ORIGIN.lat, lon: ORIGIN.lon, terrain: { surfaceM: 1200 } });
const ll = (x, z) => { const [lon, lat] = geo.worldToLonLat(x, z); return [+lat.toFixed(7), +lon.toFixed(7)]; };
const profile = {
  _: 'A test-only lake (tests/profiles.test.mjs). Never listed in src/waters/index.json; never shipped.',
  id: 'test-mini', hero: 'A test lake.', what: 'Test only.', title: 'Test lake', description: 'A test lake.',
  place: 'Mini Pond', region: 'Testland', stills: { hero: '/none.jpg', hero960: '/none.jpg' }, wind: 'A test breeze.',
  lat: ORIGIN.lat, lon: ORIGIN.lon, soundingsUnit: 'metres',
  chart: { box: [100, 100], metresPerUnit: 10, destination: { name: 'Pebble Isle', at: [50, 50] }, course: { from: [50, 90], to: [50, 60] }, contoursM: [5], northDeg: 0 },
  day: { date: '2026-03-20', utcOffsetH: -6 },
  terrain: { dir: 'tests/fixtures/profiles/mini-terrain', full: 'mini.json', phone: null, surfaceM: 1200, root: 1280,
    fine: { x0: -60, x1: 60, z0: -60, z1: 60, leaf: 40 }, bayCentre: [0, -200], lakeCentre: [0, 0] },
  season: { name: 'spring', snowLine: 1500, fullM: 100, aspectM: 50, maxSlope: 1.0, grassDry: 0.4, bloom: 0 },
  treeline: 1600,
  points: { house: ll(-470, 40), headBeach: ll(-440, 30), mouthNW: ll(-120, -440), mouthSE: ll(120, -440), creekTop: ll(-560, 60),
    creekMouth: ll(-455, 45), peak: ll(300, 560), ridgeFrom: ll(-600, 600), ridgeTo: ll(600, 600), harbour: ll(440, 120) },
  island: { searchM: 60, radiusM: 55 },
  bay: { lengthM: 900, maxDepthM: 20, beachHalfWidthM: 30, mouthInM: 100, mouthOutM: 120 },
  landmarks: { ruin: { sizeM: 2 }, house: { yawDeg: 10, length: 12, width: 6 }, peak: { name: 'knoll' }, overlook: { x: -500, z: -300 } },
  windBay: { x0: -300, x1: 300, dx: 100, z0: -300, z1: 300, dz: 100, deep: -5, factor: 1, levelAt: [0, -150] },
  start: { x: 150, z: 200, headingDeg: 300, speed: 2 },
  firstGust: { aheadM: 80, offsetM: 0, gain: 0.3, edgeM: 10 },
  goal: { text: 'Sail to Pebble Isle', arrival: 'That is Pebble Isle.' },
  stops: { islandE: { at: [120, 0], look: [0, 6, 0], name: 'the isle' }, islandS: { at: [0, 120], look: [0, 6, 0], name: 'the isle' },
    north: { at: [0, -300], look: [0, 0, 0], name: 'the north water' } },
  loop: ['island', 'north'],
  night: { centre: [0, 200], radius: 80 },
  charts: { logbook: { x0: -500, x1: 500, z0: -500, z1: 500 }, plotter: { x0: -640, x1: 640, z0: -640, z1: 640 } },
};
writeFileSync(new URL('./mini-lake.json', import.meta.url), JSON.stringify(profile, null, 2) + '\n');
console.log('wrote the test lake: tests/fixtures/profiles/mini-lake.json and mini-terrain/');
