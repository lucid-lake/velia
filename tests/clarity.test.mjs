// wow/clarity: the plain-JS optics and the boat's shadow outline (src/waters/clarity-optics.js), and the caustic net's
// mean (src/waters/clarity.js keeps the bed's mean light: the net only gathers it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BED, HULL, N_WATER, sunUnder, viewUnderCos, pathLength, transmission, bodyRadiance, bedContrast, visibleDepth, shallowHue,
  boulderFits, boatShadow, inHull, inTriangle, surfaceAbove, SECCHI_2025_M,
} from '../src/waters/clarity-optics.js';
import { WATER_K } from '../src/sim/water-spectrum.js';

const DEG = Math.PI / 180;
const sunAt = (elevDeg, azDeg = 180) => [Math.cos(elevDeg * DEG) * Math.sin(azDeg * DEG), Math.sin(elevDeg * DEG), -Math.cos(elevDeg * DEG) * Math.cos(azDeg * DEG)];

test('red is absorbed first: the transmission is ordered blue > green > red at every depth', () => {
  for (const d of [1, 3, 10, 30]) {
    const [r, g, b] = transmission(2 * d);
    assert.ok(b > g && g > r, `${d} m: ${[r, g, b]}`);
  }
  assert.ok(WATER_K[1] > 0.07 && WATER_K[1] < 0.1, 'green from Secchi ≈ 19–21 m');
});

test('Snell: the refracted sun and view rays are steeper under water', () => {
  const s = sunAt(30), u = sunUnder(s);
  assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-9);
  assert.ok(u[1] > s[1], 'steeper');
  assert.ok(Math.abs(Math.hypot(u[0], u[2]) - Math.hypot(s[0], s[2]) / N_WATER) < 1e-12);
  assert.ok(viewUnderCos(30) > Math.sin(30 * DEG));
  assert.ok(Math.abs(viewUnderCos(90) - 1) < 1e-12);
});

test('the path grows with depth and with a lower sun', () => {
  assert.ok(pathLength(5, 1, 1) === 10);
  assert.ok(pathLength(5, 0.7, 0.8) > pathLength(5, 1, 1));
  assert.ok(pathLength(10, 0.8, 0.9) > pathLength(5, 0.8, 0.9));
});

test('the shallows read turquoise and the deep reads cobalt', () => {
  const [r1, g1, b1] = shallowHue(2);
  assert.ok(g1 > 0.75 && b1 >= g1 * 0.95 && r1 < 0.6, `2 m: ${[r1, g1, b1].map((x) => x.toFixed(2))}`);   // green-blue, red down
  const [r2, g2, b2] = shallowHue(60);
  assert.ok(b2 === 1 && g2 < 0.25 && r2 < 0.05, `60 m: ${[r2, g2, b2].map((x) => x.toFixed(2))}`);        // blue alone
  // the deep colour is the backscatter alone, unchanged by the bed
  const deepSand = bodyRadiance(200, BED.sand), deepRock = bodyRadiance(200, BED.graniteDark);
  deepSand.forEach((c, i) => assert.ok(Math.abs(c - deepRock[i]) < 1e-6));
});

test('the bed is visible to 15–20 m on a calm, sunlit day, and fades with depth', () => {
  const c = [1, 5, 10, 20, 40].map((d) => bedContrast(d, { viewCos: viewUnderCos(30), sunCos: 0.95 }));
  for (let i = 1; i < c.length; i++) assert.ok(c[i] < c[i - 1], `contrast falls: ${c}`);
  const vis = visibleDepth({ viewElevDeg: 30, sunElevDeg: 70 });
  assert.ok(vis >= 15 && vis <= 25, `visible depth ${vis.toFixed(1)} m`);
  // a lower sun and a flatter view shorten it
  assert.ok(visibleDepth({ viewElevDeg: 15, sunElevDeg: 30 }) < vis);
  assert.ok(SECCHI_2025_M > 20 && SECCHI_2025_M < 22);
});

test('a boulder layer fits its cell (the shader reads one cell a layer)', () => {
  assert.ok(boulderFits(BED.boulders));
  assert.ok(boulderFits(BED.cobbles));
  assert.ok(!boulderFits({ cell: 2, rMin: 0.2, rMax: 1, flat: 0.6 }));
});

test('the boat shadow: the hull sits under the boat at noon, the sails fall away from the sun', () => {
  const pose = { x: 100, z: 200, heading: 90 * DEG, boomAngle: 20 * DEG, jibAngle: 15 * DEG, heel: 0 };   // heading east
  const noon = boatShadow(pose, sunAt(89.9));
  assert.ok(noon.on);
  assert.ok(inHull([100, 200], noon.hull), 'the hull centre');
  assert.ok(inHull([100 + 3.5, 200], noon.hull), 'near the bow');
  assert.ok(!inHull([100 + 4.6, 200], noon.hull), 'past the stem');
  assert.ok(!inHull([100, 200 + 1.6], noon.hull), 'past the beam');
  // the sun low in the south (az 180; world z points south), the shadow goes north (z −)
  const low = boatShadow(pose, sunAt(25, 180));
  const cz = (t) => (t[0][1] + t[1][1] + t[2][1]) / 3;
  assert.ok(cz(low.main) < 200 - 5, `the main's shadow north of the boat: ${cz(low.main)}`);
  assert.ok(low.hull.c[1] < 200, 'the hull shadow shifted north too');
  // no sun, no shadow
  assert.equal(boatShadow(pose, sunAt(-5)).on, false);
});

test('heel leans the rig to the side whose rail is down', () => {
  const s = sunAt(89.9), base = { x: 0, z: 0, heading: 0, boomAngle: 0, jibAngle: 0 };   // heading north: starboard = +x
  const up = boatShadow({ ...base, heel: 0 }, s), heeled = boatShadow({ ...base, heel: 20 * DEG }, s);
  assert.ok(heeled.main[1][0] > up.main[1][0] + 3, 'the masthead moved to starboard');
});

test('the point-in-shape tests and the surface point above the bed', () => {
  const tri = [[0, 0], [4, 0], [0, 3]];
  assert.ok(inTriangle([1, 1], tri) && inTriangle([1, 1], [tri[0], tri[2], tri[1]]));
  assert.ok(!inTriangle([3, 3], tri));
  const s = sunAt(40, 270), u = sunUnder(s), p = surfaceAbove([0, 0], 5, s);
  assert.ok(Math.abs(p[0] - u[0] / u[1] * 5) < 1e-12 && p[0] < 0, 'toward the sun (west)');
  assert.equal(HULL.halfL > HULL.halfB, true);
});

test('the caustic net keeps the mean light (its normaliser matches a Monte Carlo of the Worley net)', async () => {
  const { causticMean, causticLineMean } = await import('../src/waters/clarity-optics.js');
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pts = new Map(), pt = (i, j) => { const k = `${i},${j}`; if (!pts.has(k)) pts.set(k, [i + rnd(), j + rnd()]); return pts.get(k); };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const f = (x, y) => { let a = 1e9, b = 1e9; const i = Math.floor(x), j = Math.floor(y); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const p = pt(i + di, j + dj), d = Math.hypot(p[0] - x, p[1] - y); if (d < a) { b = a; a = d; } else if (d < b) b = d; } return b - a; };
  for (const w of [0.1, 0.2, 0.35]) {
    let s1 = 0, sc = 0; const n = 40000;
    for (let k = 0; k < n; k++) {
      const l1 = 1 - ss(0, w, f(rnd() * 30, rnd() * 30)), l2 = 1 - ss(0, w, f(rnd() * 30 + 100, rnd() * 30));
      s1 += l1; sc += (l1 + l2) * 0.5 + l1 * l2 * 1.5;
    }
    assert.ok(Math.abs(s1 / n - causticLineMean(w)) < 0.03, `line mean at w ${w}: ${(s1 / n).toFixed(3)} vs ${causticLineMean(w).toFixed(3)}`);
    assert.ok(Math.abs(sc / n / causticMean(w) - 1) < 0.12, `net mean at w ${w}: ${(sc / n).toFixed(3)} vs ${causticMean(w).toFixed(3)}`);
  }
});

test('round 2: the boulders stand out first: a lichen-dark boulder at 1–8 m beats the fine detail by a wide margin', () => {
  const o = { viewCos: viewUnderCos(30), sunCos: 0.95 };
  for (const d of [1, 3, 5, 8]) {
    const fine = bedContrast(d, o), boulder = bedContrast(d, { ...o, big: true, target: BED.lichen });
    assert.ok(boulder > 0.4 && boulder > fine * 1.5, `${d} m: boulder ${boulder.toFixed(2)}, detail ${fine.toFixed(2)}`);
  }
  assert.ok(BED.granite.every((c, i) => c > BED.sand[i]), 'pale tops lighter than the sand');
  assert.ok(BED.boulders.depthFull >= 6 && BED.boulders.rMax >= 2.5);
});

test('fix/bed-zebra: the sand ripples are small, faint, shallow-only and never alias', async () => {
  const { rippleAA, rippleDepth, rippleContrast } = await import('../src/waters/clarity-optics.js');
  const R = BED.ripples;
  // real lake ripples: 8–20 cm crests (the zebra was one 0.6 m sine)
  for (const lam of R.lambda) assert.ok(lam >= 0.08 && lam <= 0.2, `crest spacing ${lam} m`);
  // faint: under 10 % from crest to trough with the sun 10–30° up square to the crests (the zebra: 35 %)
  for (const e of [10, 15, 30]) assert.ok(rippleContrast({ sunElevDeg: e }) < 0.1, `${e}°: ${rippleContrast({ sunElevDeg: e }).toFixed(3)}`);
  assert.ok(rippleContrast({ R: { tilt: 0.22, albedo: 0 } }) > 0.3, 'the old ripple was the strong one');
  // the wave-washed shallows only
  assert.equal(rippleDepth(0.5), 1);
  assert.equal(rippleDepth(R.depthNone), 0);
  assert.equal(rippleDepth(10), 0);
  for (let d = 0; d < 5; d += 0.25) assert.ok(rippleDepth(d + 0.25) <= rippleDepth(d), 'fades with depth');
  // gone before Nyquist (2 pixels a crest), full when the pixel resolves it well
  for (const lam of R.lambda) {
    assert.equal(rippleAA(0.1 * lam, lam), 1);
    assert.equal(rippleAA(0.45 * lam, lam), 0);
    assert.equal(rippleAA(0.5 * lam, lam), 0);
    assert.equal(rippleAA(3, lam), 0);
  }
});
