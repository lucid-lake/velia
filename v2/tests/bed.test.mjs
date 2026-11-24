// The clear-water bed (M5c, v2/render/bed.js): its numbers are v1's clarity optics (src/waters/clarity-optics.js), the
// boulder layers fit their cells (one cell a read), the shelf look
// eases to 1 by the deep, the near weight resolves the bed only where the pixel can, and the WGSL it hands the terrain
// pass carries those numbers and nothing WGSL reserves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BED, CAUSTIC_LINE, IMAGE_SCATTER, DIRECT_SHARE, N_WATER, WOBBLE, NEAR_BLUR, WATER_LOOK, TINT_SHELF, SILT, plainAlbedo, BED_WGSL, bedWgsl, bedMean, ROCK_MEAN, BIG, WARP_WGSL, bodyTint, nearWeight, boulderFits, causticMean } from '../render/bed.js';
import * as V1 from '../../src/waters/clarity-optics.js';

test('the numbers are v1\'s: BED, the caustic line fit, the image scatter, the direct share, the water\'s index', () => {
  assert.equal(BED, V1.BED); assert.equal(CAUSTIC_LINE, V1.CAUSTIC_LINE);
  assert.equal(IMAGE_SCATTER, V1.IMAGE_SCATTER); assert.equal(DIRECT_SHARE, V1.DIRECT_SHARE); assert.equal(N_WATER, V1.N_WATER);
  assert.equal(WOBBLE, 0.06); assert.equal(NEAR_BLUR, 0.4);
  assert.ok(boulderFits(BED.boulders) && boulderFits(BED.cobbles), 'each layer\'s largest rock stays inside its cell: one cell a read');
  // v1's visible-depth check holds on the shared numbers: a boulder reads to about the Secchi depth
  const d = V1.visibleDepth({ viewElevDeg: 30, sunElevDeg: 70, big: true });
  assert.ok(d > 15 && d < 30, `a boulder's 2 % step reads to ${d.toFixed(1)} m`);
});

test('v1\'s caustic net identity (the shared optics; v2 draws ultra M2\'s splatted caustics now: v2/tests/caustics.test.mjs)', () => {
  for (const w of [0.08, 0.15, 0.3, 0.5]) {
    const L = CAUSTIC_LINE[0] * w + CAUSTIC_LINE[1];
    assert.ok(Math.abs(causticMean(w) - (L + 1.5 * L * L)) < 1e-12);
  }
});

test('the shelf look: tint × gain in the shallows, exactly 1 by the deep, monotone between; the near weight', () => {
  // v1's WATER_LOOK (src/water.js, S5), relative to its deep value: the shelf's turn, the deep untouched
  assert.deepEqual(WATER_LOOK, { shelf: [0.62, 1.85, 1.12], deep: [0.5, 2.6, 3.2], shelfM: 6, deepM: 16 });
  const s0 = bodyTint(0), s3 = bodyTint(3);
  assert.deepEqual(s0, TINT_SHELF); assert.deepEqual(s3, s0, 'flat inside shelfM');
  assert.ok(TINT_SHELF[1] > TINT_SHELF[0] && TINT_SHELF[2] > TINT_SHELF[0], 'a teal shelf under v2\'s white light');
  // owner, 2026-11-13: no tint past the shelf; every depth from deepM (16 m) down is v2's own navy (round 4's mid tint removed)
  for (const d of [16, 18, 25, 40, 60, 200]) for (const c of bodyTint(d)) assert.ok(Math.abs(c - 1) < 1e-9, `the body is v2's own at ${d} m`);
  let prev = s0;
  for (let d = WATER_LOOK.shelfM; d <= WATER_LOOK.deepM; d += 0.5) { const s = bodyTint(d); for (let c = 0; c < 3; c++) assert.ok(Math.sign(s[c] - prev[c]) * Math.sign(1 - s0[c]) >= 0, `channel ${c} runs toward 1 at ${d} m`); prev = s; }
  // the near weight: all of it at a sharp near pixel, none past the blur or the depth; a rough surface blurs a deep bed sooner
  assert.equal(nearWeight(0.05, 2), 1); assert.equal(nearWeight(1.0, 2), 0); assert.equal(nearWeight(0.05, 30), 0);
  assert.ok(nearWeight(0.1, 10, 0.03) < nearWeight(0.1, 10, 0.0005), 'a rough surface blurs the bed');
  assert.ok(nearWeight(0.3, 2) > 0 && nearWeight(0.3, 2) < 1);
});

test('the WGSL the terrain pass gets: v1\'s constants in it, the slope read on all four cascades, nothing WGSL reserves', () => {
  for (const s of [`const WOBBLE = ${WOBBLE}`, `const ISCAT = ${IMAGE_SCATTER}`, `const DSHARE = ${DIRECT_SHARE}`, `BO_CELL = ${BED.boulders.cell}`, `CO_CELL = ${BED.cobbles.cell}`, 'fn bedRadiance', 'fn waveCaustic', 'fn causticStrength', 'fn surfaceSlope', 'fn warpOf']) assert.ok(BED_WGSL.includes(s), `BED_WGSL has ${s}`);
  assert.ok(BED_WGSL.includes(WARP_WGSL), 'the water\'s cascade warp, the same text');
  assert.ok(/for \(var c = 0u; c < 4u; c\+\+\)/.test(BED_WGSL), 'the four slope cascades');
  // identifiers WGSL reserves and a port from TSL walks into (2026-11-13: cast, patch)
  const reserved = /\b(?:let|var)\s+(cast|patch|filter|layout|new|null|set|target|type|mod|get|from|shared|smooth|common|active|ref|self|super|with|move|match|mut|pub|std|use|where|union|demote|pass|precise|final|export|import|class|enum|static|this|meta|macro|module|package|partition|register|require|resource|restrict|template|trait|try|typedef|typeof|unless|using|virtual|volatile|yield|of|as|do|auto)\b/;
  assert.equal(BED_WGSL.match(reserved), null, 'no reserved identifier');
});

test('the plain column\'s bed past the shelf (owner, 2026-11-13: the water past the shelf is v2\'s navy): sand under the whole shelf tint, M2\'s silt by 25 m, monotone between', () => {
  assert.deepEqual(SILT, { albedo: [0.20, 0.19, 0.16], band: [12, 25] });
  assert.deepEqual(plainAlbedo(0), BED.mean); assert.deepEqual(plainAlbedo(SILT.band[0]), BED.mean, 'sand to the band\'s start');
  for (const d of [25, 40, 60]) assert.deepEqual(plainAlbedo(d), SILT.albedo, `silt at ${d} m`);
  let prev = plainAlbedo(SILT.band[0]);
  for (let d = SILT.band[0]; d <= SILT.band[1]; d += 0.5) { const a = plainAlbedo(d); for (let c = 0; c < 3; c++) assert.ok(a[c] <= prev[c] + 1e-12, `channel ${c} falls toward the silt at ${d} m`); prev = a; }
  // the shelf tint ends at 16 m: from there down nothing lifts the column but the sand's fading share
  for (const d of [16, 20, 30, 60]) for (const c of bodyTint(d)) assert.equal(c, 1);
});

test(': the photos\' look: a greener shelf held to 9 m, mossy dark boulders, their far mean darkens a rocky shallows only', () => {
  assert.ok(TINT_SHELF[1] > TINT_SHELF[2], 'the shelf is green-teal (green over blue), as the photos\' sand under 2-6 m');
  for (const d of [0, 4, 8.9]) assert.deepEqual(bodyTint(d), TINT_SHELF, `the teal holds at ${d} m`);
  assert.ok(bodyTint(12)[2] > TINT_SHELF[2] && bodyTint(12)[2] < 1, 'turning to the navy between 9 and 16 m');
  // the boulders are darker and greener than the sand (the photos: 0.6-0.8 of the sand's level, green over blue)
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(ROCK_MEAN) < 0.6 * lum(BED.mean) && ROCK_MEAN[1] > ROCK_MEAN[2], 'mossy, darker than the sand');
  // the far mean: a rocky shallows darker than the flats, the same sand by the boulders' depth limit, the lite path in between
  assert.ok(lum(bedMean(4, { rocky: 1 })) < lum(bedMean(4, { rocky: BIG.flats })));
  assert.ok(lum(bedMean(4, { big: false })) < lum(BED.mean) && lum(bedMean(4, { big: false })) > lum(bedMean(4, { rocky: 1 })));
  assert.deepEqual(bedMean(BIG.depthNone), BED.mean); assert.deepEqual(bedMean(BED.boulders.depthNone, { big: false }), BED.mean);
  // each big layer's largest stone stays inside its cell (one cell a read), and the big bed is compiled only where asked
  for (const L of BIG.layers) assert.ok(boulderFits(L), `big layer ${L.cell} m fits`);
  assert.ok(bedWgsl({ big: true }).includes('const BED_BIG = true;') && bedWgsl({ big: false }).includes('const BED_BIG = false;'));
});
