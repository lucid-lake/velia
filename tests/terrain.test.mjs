// The real Lake Tahoe terrain's contract (src/terrain.js on USGS data). Run: node --test tests/terrain.test.mjs
// Facts checked against the sources: Fannette Island ≈ 8,500 m² (Wikipedia), the bay
// ≈ 2.7–3 km long, the mouth ≈ 380 m between its points (GNIS), Lake Tahoe 501 m deep, Mount Tallac 2,967 m,
// Freel Peak 3,318 m (GNIS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readdirSync } from 'node:fs';
import { makeTerrain, buildLake, heightAt, shoreDistance, coverAt, normalAt, LAKE, LANDMARKS, TAHOE } from '../src/sim/terrain.js';
import { pickDay } from '../src/sim/day.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
import { lonLatToWorld, worldToLonLat, ORIGIN, Y0 } from '../src/sim/geo.js';
import { CAMERAS } from '../src/sim/core/presets.js';
import { loadTerrain, makeSampler } from '../src/sim/terrain-data.js';
import { budget } from './helpers/budget.mjs';

const DATA = await loadTerrain();
const SOLO = DATA.levels.map((l) => makeSampler({ manifest: DATA.manifest, levels: [l] }));   // each level alone

const t = makeTerrain({ seed: 1 });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed?.(2) ?? a} vs ${b}`);

test('the frame: a transverse Mercator on the island; lon/lat round trips to a millimetre', () => {
  const [x0, z0] = lonLatToWorld(ORIGIN.lon, ORIGIN.lat);
  near(x0, 0, 1e-6, 'origin x'); near(z0, 0, 1e-6, 'origin z');
  for (const [lon, lat] of [[-120.0788, 38.9655], [-119.94, 38.935], [-120.143, 39.169], [-120.5, 38.6]]) {
    const [x, z] = lonLatToWorld(lon, lat), [lo, la] = worldToLonLat(x, z);
    near(lo, lon, 1e-8, 'lon'); near(la, lat, 1e-8, 'lat');
  }
  // north is −z: Tahoe City (39.169 N) lies ≈ 23.9 km north, the south-shore town ≈ 10.6 km east
  const [tx, tz] = lonLatToWorld(-120.143, 39.169); near(tz, -23860, 150, 'Tahoe City z'); assert.ok(tx < 0);
  const [sx] = lonLatToWorld(-119.978, 38.932); near(sx, 10600, 150, 'south shore x');
  near(Y0, 1897.9, 0.5, 'the lake surface (m)');
});

test('Fannette Island: a granite knob ≈ 28 m high, ≈ 9,000 m², water all round', () => {
  const I = LAKE.island;
  assert.ok(I.top > 25 && I.top < 31, `top ${I.top} m`);
  near(heightAt(0, 0), I.top, 1.5, 'the summit is the origin');
  assert.ok(I.areaM2 > 7500 && I.areaM2 < 10500, `area ${I.areaM2} m²`);
  assert.ok(I.a > 55 && I.a < 100 && I.b > 25 && I.b < 55, `semi-axes ${I.a} × ${I.b} m`);
  for (let a = 0; a < 16; a++) {
    const x = 150 * Math.cos(a * Math.PI / 8), z = 150 * Math.sin(a * Math.PI / 8);
    assert.ok(heightAt(x, z) < -3, `water 150 m out at ${a * 22.5}°: ${heightAt(x, z).toFixed(1)} m`);
  }
  assert.ok(shoreDistance(0, 0) > 15, 'the island is land for the water');
  // steep: somewhere on it the ground drops 10 m in 10 m or more (a cliff, not a mound)
  let steep = 0;
  for (let z = -60; z <= 60; z += 2) for (let x = -90; x <= 90; x += 2) if (heightAt(x, z) > 2) steep = Math.max(steep, Math.hypot(...[1, 0].map((k) => heightAt(x + 5 * k, z + 5 * (1 - k)) - heightAt(x - 5 * k, z - 5 * (1 - k)))) / 10);
  assert.ok(steep > 1, `steepest grade ${steep.toFixed(2)}`);
});

test('Emerald Bay: ≈ 3 km from head to mouth, ≈ 65 m deep, a narrow shallow mouth to the open lake', () => {
  const m = LAKE.mouth;
  near(m.halfWidth * 2, 380, 60, 'the mouth between its points (m)');
  const head = t.places().bayHead;
  const len = Math.hypot(m.mid[0] - head.x, m.mid[1] - head.z);
  assert.ok(len > 2400 && len < 3300, `head to mouth ${len.toFixed(0)} m`);
  let deep = 0;
  for (let z = -1100; z <= 500; z += 20) for (let x = -500; x <= 1500; x += 20) deep = Math.min(deep, heightAt(x, z));
  assert.ok(deep < -50 && deep > -90, `the bay's deepest ${deep.toFixed(1)} m`);
  assert.ok(heightAt(...m.b) < -10, 'deep water outside the mouth');
  assert.ok(heightAt(...m.a) < 0, 'water inside the mouth');
  // the open lake: 501 m at its deepest, ≈ 33 km of water to the north shore
  let lakeDeep = 0;
  for (let z = -30000; z <= -2000; z += 400) for (let x = -4000; x <= 14000; x += 400) lakeDeep = Math.min(lakeDeep, heightAt(x, z));
  assert.ok(lakeDeep < -470 && lakeDeep > -520, `the lake's deepest ${lakeDeep.toFixed(0)} m`);
  let north = 0; for (let z = -3000; z > -40000; z -= 100) if (heightAt(5000, z) < 0) north = z;
  assert.ok(north < -29000, `water north to z ${north}`);
});

test('the landmarks stand where the real ones do', () => {
  const H = LANDMARKS.house; const hh = heightAt(H.x, H.z);
  assert.ok(hh > 0.5 && hh < 15 && shoreDistance(H.x, H.z) < 150, `the stone house: ${hh.toFixed(1)} m up, ${shoreDistance(H.x, H.z).toFixed(0)} m from the water`);
  const w = t.waterfall();
  assert.ok(w.top - w.bottom > 15, `the falls drop ${(w.top - w.bottom).toFixed(1)} m in 40 m`);
  assert.ok(Math.hypot(w.x - H.x, w.z - H.z) < 700, 'the falls are above the head');
  // Mount Tallac 2,967 m, ≈ 5.3 km south; Freel Peak 3,318 m on the ring
  let tallac = 0; for (let z = -300; z <= 300; z += 10) for (let x = -300; x <= 300; x += 10) tallac = Math.max(tallac, heightAt(LANDMARKS.peak.x + x, LANDMARKS.peak.z + z));
  near(tallac + Y0, 2967, 25, 'Mount Tallac (m)');
  const [fx, fz] = lonLatToWorld(-119.900, 38.858);
  let freel = 0; for (let z = -600; z <= 600; z += 30) for (let x = -600; x <= 600; x += 30) freel = Math.max(freel, heightAt(fx + x, fz + z));
  near(freel + Y0, 3318, 60, 'Freel Peak (m)');
});

test('the cameras sit over the water (or, for the overlook, over the ground)', () => {
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'I', 'L', 'M']) {
    const [x, y, z] = CAMERAS[k].pos;
    assert.ok(shoreDistance(x, z) < -20 && heightAt(x, z) < y, `cam ${k} at (${x}, ${z}): ${shoreDistance(x, z).toFixed(0)} m from the shore`);
  }
  const [ox, oy, oz] = CAMERAS.O.pos;
  assert.ok(oy - heightAt(ox, oz) > 5 && oy - heightAt(ox, oz) < 40, 'the overlook stands just over the ground');
  near(Math.hypot(ox - LANDMARKS.overlook.x, oz - LANDMARKS.overlook.z), 0, 1, 'cam O at the overlook');
});

test('ground cover: forest on the slopes, built ground in the south-shore town, the season\'s snow on the high peaks', () => {
  const c = (lon, lat) => { const [x, z] = lonLatToWorld(lon, lat); return coverAt(x, z, {}); };
  // built ground (roofs, roads, lots, lawns) over 1.6 km round the south-shore town's centre
  const [tx, tz] = lonLatToWorld(-119.978, 38.932);
  let built = 0, k = 0;
  for (let dz = -800; dz <= 800; dz += 100) for (let dx = -800; dx <= 800; dx += 100) { const q = coverAt(tx + dx, tz + dz, {}); if (q.water < 0.5) { built += q.urban + q.open; k++; } }
  assert.ok(built / k > 0.4, `south-shore town built ${(built / k).toFixed(2)}`);
  const freel = c(-119.900, 38.858);
  assert.ok(freel.snow > 0.5, `snow on Freel Peak's summit in early July: ${freel.snow.toFixed(2)}`);
  // Mount Tallac's north bowls hold patches; its south face is bare
  const [qx, qz] = lonLatToWorld(-120.0998, 38.9058);
  let tallac = 0, tn = 0;
  for (let dz = -200; dz <= 200; dz += 50) for (let dx = -200; dx <= 200; dx += 50) { tallac += coverAt(qx + dx, qz + dz, {}).snow; tn++; }
  assert.ok(tallac / tn > 0.1 && tallac / tn < 0.6, `patchy snow round Tallac's summit: ${(tallac / tn).toFixed(2)}`);
  assert.ok(coverAt(1050, -820, {}).water === 1, 'the bay is water');
  // the bay's walls: mostly forest and shrub below 300 m, no snow at the lake
  let forest = 0, n = 0, snowLow = 0;
  for (let z = -1500; z <= 1000; z += 100) for (let x = -1500; x <= 2500; x += 100) {
    const h = heightAt(x, z); if (h < 5 || h > 300) continue;
    const k = coverAt(x, z, {}); forest += k.forest + k.shrub; snowLow += k.snow; n++;
  }
  assert.ok(forest / n > 0.4, `forest + shrub on the bay's walls ${(forest / n).toFixed(2)}`);
  assert.equal(snowLow, 0, 'no snow by the bay in early July');
  for (const k of Object.values(coverAt(-2000, 2000, {}))) assert.ok(k >= 0 && k <= 1.0001);
  near(TAHOE.season.snowLine, 3000, 100, 'snow line (m), early July (the highlight day)');
  assert.equal(TAHOE.season.name, 'early July');
});

test('?day=normal restores the mid-June season exactly; the highlight day has less snow and drier grass', () => {
  const N = buildLake(CURRENT_WATERS, DATA, pickDay(CURRENT_WATERS, 'normal'));
  assert.deepEqual(N.climate.season, { name: 'mid-June', snowLine: 2850, fullM: 250, aspectM: 300, maxSlope: 1.0, grassDry: 0.15, bloom: 1 });
  assert.equal(N.place.date, '2026-06-15'); assert.equal(t.place.date, '2026-07-04');
  assert.ok(TAHOE.season.grassDry > N.climate.season.grassDry, 'the meadows drier in July');
  // the June numbers: Freel's summit white, Tallac's summit patchy (the values the June tests held)
  const c = (T, lon, lat) => { const [x, z] = lonLatToWorld(lon, lat); return T.coverAt(x, z, {}); };
  assert.ok(c(N, -119.900, 38.858).snow > 0.5, 'June: Freel');
  const tallac = (T) => { const [qx, qz] = lonLatToWorld(-120.0998, 38.9058); let s = 0, n = 0; for (let dz = -200; dz <= 200; dz += 50) for (let dx = -200; dx <= 200; dx += 50) { s += T.coverAt(qx + dx, qz + dz, {}).snow; n++; } return s / n; };
  const tj = tallac(N), tl = tallac(t);
  assert.ok(tj > 0.1 && tj < 0.6, `June Tallac ${tj.toFixed(2)}`);
  assert.ok(tl < tj, `less snow round Tallac in July: ${tl.toFixed(2)} vs ${tj.toFixed(2)}`);
  // the snow over the whole basin, a coarse sweep: July < June
  let sj = 0, sl = 0;
  for (let z = -20000; z <= 20000; z += 400) for (let x = -20000; x <= 20000; x += 400) { sj += N.coverAt(x, z, {}).snow; sl += t.coverAt(x, z, {}).snow; }
  console.log(`# basin snow (sum of weights on a 400 m grid): June ${sj.toFixed(1)}, July ${sl.toFixed(1)}`);
  assert.ok(sl < sj * 0.8, `July snow ${sl.toFixed(1)} vs June ${sj.toFixed(1)}`);
});

test('no steps: level borders blend (a border adds under 1 m in 1 m); real cliffs only (under 12 m in 1 m)', () => {
  const step = (x, z) => { const h = heightAt(x, z); return Math.max(Math.abs(heightAt(x + 1, z) - h), Math.abs(heightAt(x, z + 1) - h)); };
  // anywhere over the bay: the 2 m lidar holds real granite cliffs (80°+ in places: Eagle Falls' walls), never a seam
  let worst = 0, at = null;
  for (let z = -2500; z <= 2500; z += 23) for (let x = -3000; x <= 4000; x += 23) { const s = step(x, z); if (s > worst) { worst = s; at = [x, z]; } }
  assert.ok(worst < 12, `worst step ${worst.toFixed(2)} m in 1 m at ${at}`);
  // across each level's border (island ±192 m, bay x −2304..3328 / z ±1792, basin ±10.24 km), within its blend band
  let border = 0, bat = null;
  const lines = [];
  for (let k = -180; k <= 180; k += 7) lines.push([k, -185], [k, 185], [-185, k], [185, k]);
  for (let k = -2290; k <= 3310; k += 31) lines.push([k, -1780], [k, 1780]);
  for (let k = -1780; k <= 1780; k += 31) lines.push([-2290, k], [3310, k]);
  for (let k = -10200; k <= 10200; k += 97) lines.push([k, -10230], [k, 10230], [-10230, k], [10230, k]);
  // the seam's own share: the blended step over the larger of the two levels' own steps there (the slope is real)
  const levelStep = (S, x, z) => { const h = S.height(x, z); return Math.max(Math.abs(S.height(x + 1, z) - h), Math.abs(S.height(x, z + 1) - h)); };
  for (const [x, z] of lines) for (let o = -30; o <= 30; o += 3) for (const [px, pz] of [[x + o, z], [x, z + o]]) {
    const own = Math.max(...SOLO.map((S) => levelStep(S, px, pz)));
    const extra = step(px, pz) - own;
    if (extra > border) { border = extra; bat = [px, pz]; }
  }
  assert.ok(border < 1, `a level border adds ${border.toFixed(2)} m in 1 m at ${bat}`);
});

test('fast: under 0.3 µs a height (the scatter calls it per tree)', () => {
  const n = 500000, t0 = performance.now();
  let s = 0;
  for (let i = 0; i < n; i++) s += heightAt((i % 997) * 13.1 - 6000, Math.floor(i / 997) * 29.3 - 3000);
  const us = (performance.now() - t0) * 1000 / n;
  assert.ok(Number.isFinite(s));
  budget(us, 0.3, 'heightAt a sample', 'µs');   // gates with LAKESHORE_STRICT=1 (tests/helpers/budget.mjs)
});

test('places for the shoreline layout: each near the shore; normals point up', () => {
  const P = t.places();
  for (const q of [P.bayHead, ...P.mouth, P.headland, P.river, P.harbour]) assert.ok(Math.abs(shoreDistance(q.x, q.z)) < 400, `${q.x.toFixed(0)}, ${q.z.toFixed(0)} is ${shoreDistance(q.x, q.z).toFixed(0)} m from the shore`);
  const n = normalAt(500, 500); near(Math.hypot(...n), 1, 1e-9, '|n|'); assert.ok(n[1] > 0);
});

test('the committed grids stay compact (under 30 MB)', () => {
  const dir = new URL('../terrain/', import.meta.url);
  const bytes = readdirSync(dir).reduce((s, f) => s + statSync(new URL(f, dir)).size, 0);
  assert.ok(bytes < 30e6, `${(bytes / 1e6).toFixed(1)} MB`);
});
