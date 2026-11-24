// The lake bed's seams (fix(terrain) bed edges, 2026-11-13; tools/terrain/build_tahoe.py seamless_bed): the shared grids
// (v1's and v2's) no longer step where the 1998 survey's coverage ends. The transects cross the old seams the edge
// detector found in the first build's bed (the coverage edge off the north shore and north of Fannette, the bay mouth's
// sill: renders/bedseams/edges-before.json on the branch), 61 m each in 2 m steps, all water in both builds. On the first
// build's grids this test fails: steps of 3.8-4.7 m between neighbouring 2 m samples off the north shore, a second
// 99th-percentile bend of 0.375 m on the sill's Voronoi ridges. Real drop-offs (Fannette's flanks, the bay's south wall) are not
// on these lines; their shape is held by the profile test below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ground } from './helpers/ground.mjs';   // v2's own height field (v2/terrain/sample.js), every grid in

const SP = ground('full');

// [x, z, nx, nz]: a transect's centre on an old seam (world metres) and its direction across it
const SEAMS = [[761.0, -1033.0, -0.7071, -0.7071], [710.0, -982.0, -0.7071, -0.7071], [659.0, -931.0, -0.7071, -0.7071], [742.0, -1007.0, -0.669, -0.7433], [732.0, -998.0, -0.669, -0.7433], [722.0, -989.0, -0.669, -0.7433], [677.0, -955.5, -0.6557, -0.755], [639.0, -922.5, -0.6557, -0.755], [-388.0, -90.0, -0.6247, -0.7809], [-408.0, -74.0, -0.6247, -0.7809], [-428.0, -58.0, -0.6247, -0.7809], [586.5, -839.0, -0.8163, -0.5776], [549.0, -786.0, -0.8163, -0.5776], [511.5, -733.0, -0.8163, -0.5776], [608.5, -867.5, -0.8137, -0.5812], [591.0, -843.0, -0.8137, -0.5812], [573.5, -818.5, -0.8137, -0.5812], [749.0, -1025.5, -0.6985, -0.7156], [728.0, -1005.0, -0.6985, -0.7156], [707.0, -984.5, -0.6985, -0.7156], [184.5, -444.0, -0.7295, -0.6839], [177.0, -436.0, -0.7295, -0.6839], [169.5, -428.0, -0.7295, -0.6839], [798.5, -1066.5, -0.7071, -0.7071], [779.0, -1047.0, -0.7071, -0.7071], [759.5, -1027.5, -0.7071, -0.7071], [-297.5, -160.0, -0.6171, -0.7869], [1530.5, -1486.5, -0.5658, -0.8245], [1505.0, -1469.0, -0.5658, -0.8245], [1479.5, -1451.5, -0.5658, -0.8245], [-299.0, -156.0, -0.5882, -0.8087], [-315.5, -144.0, -0.5882, -0.8087], [301.5, -536.5, -0.5346, -0.8451], [-349.0, -114.0, -0.5767, -0.817], [-366.0, -102.0, -0.5767, -0.817], [-383.0, -90.0, -0.5767, -0.817], [-469.0, 333.0, -0.7359, -0.6771], [-71.5, -358.0, -0.6575, -0.7534], [525.0, -749.5, -0.8321, -0.5547], [518.0, -739.0, -0.8321, -0.5547], [511.0, -728.5, -0.8321, -0.5547], [801.0, -1065.5, -0.6965, -0.7176], [784.0, -1049.0, -0.6965, -0.7176], [767.0, -1032.5, -0.6965, -0.7176], [653.5, -929.5, -0.7071, -0.7071], [639.0, -915.0, -0.7071, -0.7071], [299.0, -532.5, -0.4878, -0.8729], [1513.0, -1471.0, -0.5692, -0.8222], [1500.0, -1462.0, -0.5692, -0.8222], [1487.0, -1453.0, -0.5692, -0.8222], [1970.0, -110.0, -0.9995, -0.0312], [1969.0, -78.0, -0.9995, -0.0312], [195.0, -458.5, -0.6866, -0.727], [1160.5, -1610.0, 0.4874, -0.8732], [1139.0, -1622.0, 0.4874, -0.8732], [1117.5, -1634.0, 0.4874, -0.8732], [1125.0, -1631.5, 0.4997, -0.8662], [-182.5, -255.5, 0.6459, -0.7634], [-189.0, -261.0, 0.6459, -0.7634], [-195.5, -266.5, 0.6459, -0.7634], [1431.5, -1239.5, 0.7894, -0.6139], [1159.0, -1604.0, 0.5547, -0.8321], [1150.0, -1610.0, 0.5547, -0.8321], [1141.0, -1616.0, 0.5547, -0.8321], [1491.5, -1497.5, -0.9304, -0.3665], [1485.0, -1481.0, -0.9304, -0.3665], [1478.5, -1464.5, -0.9304, -0.3665]];
export const MAX_STEP = 1.6;   // m between neighbouring samples 2 m apart across an old seam (the first build: up to 4.7; this one 1.45)
export const MAX_BEND = 1.0;   // m: the second difference there (the first build: up to 4.1)

test('no step where the survey\'s coverage ends: across every old seam, neighbours 2 m apart differ by at most 1.6 m', async () => {
  const S = await SP;
  let worstStep = 0, worstBend = 0, at = null;
  for (const [cx, cz, nx, nz] of SEAMS) {
    const h = [];
    for (let t = -30; t <= 30; t += 2) h.push(S.height(cx + nx * t, cz + nz * t));
    assert.ok(h.every((v) => v < 0), `transect at ${cx}, ${cz} is all water`);
    for (let i = 1; i < h.length; i++) { const d = Math.abs(h[i] - h[i - 1]); if (d > worstStep) { worstStep = d; at = [cx, cz]; } }
    for (let i = 2; i < h.length; i++) worstBend = Math.max(worstBend, Math.abs(h[i] - 2 * h[i - 1] + h[i - 2]));
  }
  assert.ok(worstStep <= MAX_STEP, `step ${worstStep.toFixed(2)} m at ${at}`);
  assert.ok(worstBend <= MAX_BEND, `second difference ${worstBend.toFixed(2)} m`);
});

test('no Voronoi fans on the mouth\'s sill: the filled bed\'s bends between 2 m samples stay small (99th percentile under 0.2 m)', async () => {
  const S = await SP;
  const g = [], d2 = [];
  for (let z = -1550; z < -1150; z += 2) { const row = []; for (let x = 1150; x < 1500; x += 2) row.push(S.height(x, z)); g.push(row); }
  const wet = (a, b) => g[a]?.[b] !== undefined && g[a][b] < -0.31;
  for (let j = 0; j < g.length; j++) for (let i = 0; i < g[0].length; i++) {
    if (wet(j, i) && wet(j, i + 1) && wet(j, i + 2)) d2.push(Math.abs(g[j][i + 2] - 2 * g[j][i + 1] + g[j][i]));
    if (wet(j, i) && wet(j + 1, i) && wet(j + 2, i)) d2.push(Math.abs(g[j + 2][i] - 2 * g[j + 1][i] + g[j][i]));
  }
  d2.sort((a, b) => a - b);
  const p99 = d2[Math.floor(d2.length * 0.99)];
  assert.ok(d2.length > 10000, `${d2.length} samples`);
  assert.ok(p99 < 0.2, `the sill's bends, 99th percentile ${p99.toFixed(3)} m (the first build's fans: 0.375)`);
});

test('real drop-offs keep their shape: Fannette\'s east flank still falls from the shelf to the bay floor within 50 m', async () => {
  const S = await SP;
  // bearing 90 off the summit: the water's edge near 47 m out; the bay's floor (-55 m) by 100 m
  const h = (r) => S.height(r, 0);
  assert.ok(h(52) > -5, `the shelf at 52 m: ${h(52).toFixed(1)} m`);
  assert.ok(h(90) < -50, `the floor at 90 m: ${h(90).toFixed(1)} m`);
  let steepest = 0; for (let r = 50; r < 100; r += 2) steepest = Math.max(steepest, (h(r) - h(r + 2)) / 2);
  assert.ok(steepest > 1.2 && steepest < 2.5, `the flank's steepest slope ${steepest.toFixed(2)} (the first build: 2.1)`);
});
