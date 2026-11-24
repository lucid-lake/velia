// Tessie under the water (fix/v2-tessie-underwater; owner, 2026-11-17: her underwater part read clearly "even when the water
// isn't clear … as if she's in the foreground"): what is below the surface is seen through the water by the water's own
// coefficients (render/underwater.js on terrain.js WATER.K and bed.js IMAGE_SCATTER), fading with depth and with the
// weather's turbidity, and is always drawn behind the surface on its eye ray. Behaviour only: the modules are called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seenThrough, weatherScatter, apparent, crossing, SEEN } from '../render/underwater.js';
import { WATER, N_WATER } from '../render/terrain.js';
import { IMAGE_SCATTER } from '../render/bed.js';

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('her image fades with depth by the water\'s own K and the image scatter (a calm, clear noon)', () => {
  let prev = Infinity;
  for (const d of [0.5, 1, 2, 3, 4, 6]) {
    const s = seenThrough({ depth: d, path: d });
    const k = lum(s.image);
    assert.ok(k < prev, `fainter at ${d} m (${k.toFixed(3)})`); prev = k;
    // the water's coefficients, not a hand fade: each channel is exp(-(K + the image's scatter) × path)
    s.image.forEach((v, c) => assert.ok(Math.abs(v - Math.exp(-(WATER.K[c] + IMAGE_SCATTER * SEEN.big) * d)) < 1e-12, `channel ${c} at ${d} m`));
    s.light.forEach((v, c) => assert.ok(Math.abs(v - Math.exp(-WATER.K[c] * d)) < 1e-9, `the light at ${d} m (sun overhead)`));
  }
  // a clear shape at 1 m, a soft one a few metres down, little by 6 m (the red goes first: the column's blue-green)
  assert.ok(lum(seenThrough({ depth: 1, path: 1 }).image) > 0.75);
  assert.ok(lum(seenThrough({ depth: 3, path: 3 }).image) > 0.4);
  assert.ok(lum(seenThrough({ depth: 6, path: 6 }).image) < 0.55);
  const s2 = seenThrough({ depth: 2, path: 2 }).image; assert.ok(s2[0] < s2[1] && s2[1] < s2[2], 'red lost first');
});

test('a longer path (a grazing view) and a lower sun hide more', () => {
  assert.ok(lum(seenThrough({ depth: 2, path: 3.5 }).image) < lum(seenThrough({ depth: 2, path: 2 }).image));
  assert.ok(lum(seenThrough({ depth: 3, sunY: 0.15 }).light) < lum(seenThrough({ depth: 3, sunY: 1 }).light));
});

test('the weather\'s turbidity: wind (from the whitecaps\' onset), rain and a storm each hide her more', () => {
  assert.equal(weatherScatter({ wind: 2 }), 0, 'a calm day adds nothing');
  assert.ok(weatherScatter({ wind: SEEN.wind[0] }) === 0 && weatherScatter({ wind: SEEN.wind[1] }) === SEEN.wind[2]);
  let prev = -1;
  for (const w of [3, 5, 7, 9, 11, 13]) { const b = weatherScatter({ wind: w }); assert.ok(b >= prev, `${w} m/s`); prev = b; }
  assert.ok(weatherScatter({ rain: 1 }) > 0 && weatherScatter({ storm: 1 }) > 0);
  const vis = (o, d = 2) => lum(seenThrough({ depth: d, path: d, ...o }).image);
  const calm = vis({ wind: 2 }), chop = vis({ wind: 10 }), rain = vis({ wind: 6, rain: 1 }), storm = vis({ wind: 10, rain: 0.8, storm: 1 });
  assert.ok(chop < calm * 0.4, `chop hides her at 2 m (${chop.toFixed(3)} vs ${calm.toFixed(3)})`);
  assert.ok(rain < calm * 0.3 && storm < chop && storm < 0.02, `rain ${rain.toFixed(3)}, storm ${storm.toFixed(3)}`);
  // next to nothing past 1–2 m in chop; a calm clear day still shows her a few metres down
  assert.ok(vis({ wind: 10 }, 3) < 0.1 && vis({ wind: 2 }, 3) > 0.4);
});

test('refraction: a point under the surface is drawn farther along its eye ray than the surface crossing (the water in front)', () => {
  const eye = [0, 8, 0];
  for (const [x, y, z] of [[20, -0.3, 5], [30, -2, -10], [60, -4, 25], [6, -3, 1], [120, -1.5, 0]]) {
    const { p, air } = apparent(eye, [x, y, z]);
    // the crossing is on the surface, on the segment from the eye's foot toward the point, and Snell holds there
    assert.equal(air[1], 0);
    const h = Math.hypot(x, z), s = Math.hypot(air[0], air[2]), d = -y;
    assert.ok(s > 0 && s < h, 'the crossing lies between the eye and the point');
    const sinI = s / Math.hypot(s, eye[1]), sinT = (h - s) / Math.hypot(h - s, d);
    assert.ok(Math.abs(sinI - N_WATER * sinT) < 1e-4, `Snell at (${x}, ${y}, ${z})`);
    // the drawn point keeps its depth, lies on the straight ray through the crossing, beyond it (the surface nearer the eye)
    assert.equal(p[1], y);
    const t = (eye[1] - p[1]) / eye[1];
    assert.ok(Math.abs(p[0] - air[0] * t) < 1e-9 && Math.abs(p[2] - air[2] * t) < 1e-9, 'on the ray through the crossing');
    assert.ok(Math.hypot(...p.map((v, i) => v - eye[i])) > Math.hypot(...air.map((v, i) => v - eye[i])), 'beyond the surface');
    // refraction lifts it: farther than the straight ray to where it is (it is seen higher, nearer the surface)
    assert.ok(Math.hypot(p[0], p[2]) > h);
  }
  // at the surface it is where it is (the hump that breaks the surface joins its part above the water)
  const at = apparent(eye, [30, -1e-4, 0]).p; assert.ok(Math.abs(at[0] - 30) < 0.01);
  assert.deepEqual(apparent(eye, [30, 1, 0]).p, [30, 1, 0], 'above the water: unchanged');
  assert.equal(crossing(8, 30, 0), 30);
});
