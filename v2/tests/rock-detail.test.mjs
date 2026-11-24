// The close rock (feat/v2-look-ponlai): the hex tiling's grid and weights, the fade, the shader's two tiers, and the
// detail array's layers (render/rockDetail.js, render/ground.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROCK, hexGrid, hexBase, rockFade, ROCK_DETAIL_WGSL } from '../render/rockDetail.js';
import { DETAIL, ROCK_FILES, detailLayers } from '../render/ground.js';

test('the hex grid: three distinct tiles, barycentric weights in [0, 1] summing to 1', () => {
  for (let i = 0; i < 400; i++) {
    const st = [Math.sin(i * 12.9898) * 37.1, Math.cos(i * 78.233) * 41.7];
    const g = hexGrid(st);
    const sum = g.w[0] + g.w[1] + g.w[2];
    assert.ok(Math.abs(sum - 1) < 1e-6, `sum ${sum}`);
    for (const w of g.w) assert.ok(w >= -1e-6 && w <= 1 + 1e-6, `weight ${w}`);
    assert.equal(new Set(g.v.map((v) => v.join(','))).size, 3);
  }
});

test('the hex grid: a tile\'s weight moves smoothly with the point (no jump at a triangle\'s edge)', () => {
  const tileW = (st, key) => { const g = hexGrid(st); const k = g.v.findIndex((v) => v.join(',') === key); return k < 0 ? 0 : g.w[k]; };
  for (const y of [0.1, 0.23, 0.37]) {
    const key = hexGrid([0.1, y]).v[0].join(',');
    let prev = tileW([0.1, y], key);
    for (let x = 0.1; x < 0.5; x += 0.001) { const w = tileW([x, y], key); assert.ok(Math.abs(w - prev) < 0.02, `jump at ${x}: ${prev} → ${w}`); prev = w; }
  }
});

test('the blend: the strongest tile always read, a weak one dropped, under two reads a point on average', () => {
  let reads = 0, n = 0;
  for (let i = 0; i < 2000; i++) {
    const g = hexGrid([i * 0.0137, i * 0.0071 + 0.3]);
    const b = hexBase(g.w);
    assert.ok(b[g.w.indexOf(Math.max(...g.w))] > 0, 'the strongest tile is read');
    reads += b.filter((x) => x > 0).length; n++;
  }
  assert.ok(reads / n < 2, `reads a point ${reads / n}`);
});

test('the fade: whole inside 25 m, none past 40 m, never rising with distance', () => {
  assert.equal(rockFade(10), 1); assert.equal(rockFade(ROCK.near), 1); assert.equal(rockFade(ROCK.far), 0); assert.equal(rockFade(80), 0);
  let prev = 1; for (let d = 20; d <= 45; d += 0.5) { const f = rockFade(d); assert.ok(f <= prev + 1e-12); prev = f; }
});

test('the shader: an empty function off; on, it reads the two layers past v1\'s twelve', () => {
  const off = ROCK_DETAIL_WGSL('off');
  assert.match(off, /fn rockDetail\([^)]*\) \{\}/);
  assert.doesNotMatch(off, /textureSample/);
  const on = ROCK_DETAIL_WGSL('on');
  assert.match(on, /fn rockDetail\(/);
  assert.match(on, /const RD_L = 12;/);
  assert.equal(ROCK.layer, DETAIL.layers);
  assert.equal(ROCK_FILES[0].layer0, ROCK.layer); assert.equal(ROCK_FILES[1].layer0, ROCK.layer + 1);
  assert.equal(detailLayers(false), 12); assert.equal(detailLayers(true), 14);
});
