// T5: the forest cards' bake on the GPU (v2/render/forest.js TREE_BAKE_WGSL → CARD_DOWN → CARD_DILATE), read back from a
// live headless page (__velia.forest.readLayer): the atlas keeps what each tree is, not how it was lit.
//   no light baked   the atlas is byte-identical at 07:00 and 19:00 (the sun on opposite sides): no sun reaches the bake
//   true normals     the stored normals are unit vectors; a fir's crown is not shaded as a ball: across a frame, the
//                    normal's sideways part does not follow the texel's place left or right of the stem only as far as a cone of
//                    boughs does (r < 0.6; a ball gives r ≈ 1); its sprays mostly face up
//   depth per texel  each tree's frames carry real depth (std inside the outline > 0.025 of the tree's height)
//   the outline      inside it the alpha is ≥ 0.5 (0.5 + 0.5 × the share filled); outside it falls in steps of 0.07
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/forestBake.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const LAYERS = ['pine', 'lodgepole', 'whitefir', 'redfir', 'cedar', 'snag', 'shrub', 'pine-young', 'pine-old', 'whitefir-young', 'whitefir-old', 'redfir-young', 'redfir-old'];   // T1: + the variants
async function atlas(hour) {
  const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?hour=${hour}&cam=I&seed=1&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await page.evaluate(() => window.__velia.renderOnce());
  const out = [];
  for (let l = 0; l < LAYERS.length; l++) out.push(await page.evaluate((k) => window.__velia.forest.readLayer(k), l));
  await page.close();
  return { layers: out, errors };
}
try {
  const am = await atlas(7), pm = await atlas(19);
  check(!am.errors.length && !pm.errors.length, `no page errors (${am.errors.concat(pm.errors).slice(0, 2).join(' | ')})`);
  const same = am.layers.every((d, l) => d.a.every((x, i) => x === pm.layers[l].a[i]) && d.b.every((x, i) => x === pm.layers[l].b[i]));
  check(same, 'no light baked: every layer byte-identical at 07:00 and 19:00');
  for (const [l, d] of am.layers.entries()) {
    const [fw, fh] = d.frame, W = d.width;
    let n = 0, unit = 0, up = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, dS = 0, dSS = 0, badOut = 0, outside = 0;
    for (let y = 0; y < fh; y++) for (let x = 0; x < W; x++) {   // the 0° row (every boat view)
      const i = (y * W + x) * 4, a = d.a[i + 3] / 255;
      if (a < 0.5) { outside++; const k = (0.5 - a) / 0.07; if (a > 0.01 && Math.abs(k - Math.round(k)) > 0.15) badOut++; continue; }
      const nx = d.a[i] / 127.5 - 1, ny = d.a[i + 1] / 127.5 - 1, nz = d.a[i + 2] / 127.5 - 1;
      n++; if (Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.08) unit++;
      if (ny > 0.35) up++;
      // the texel's place from its frame's stem (−1 left .. 1 right) against the normal's sideways part in that frame
      const fa = Math.floor(x / fw), u = ((x % fw) + 0.5) / fw * 2 - 1, ang = fa * 2 * Math.PI / d.az;
      const side = nx * Math.cos(ang) - nz * Math.sin(ang);   // the frame's right: (cos a, 0, −sin a)
      sx += u; sy += side; sxx += u * u; syy += side * side; sxy += u * side;
      const dep = d.b[i] / 255; dS += dep; dSS += dep * dep;
    }
    const corr = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt(Math.max(1e-9, (sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2)));
    const dStd = Math.sqrt(Math.max(0, dSS / n - (dS / n) ** 2));
    check(unit / n > 0.97, `${LAYERS[l]}: ${(100 * unit / n).toFixed(1)} % of the stored normals are unit`);
    const dUnit = dStd * 2 * (d.R + 0.5);   // the channel spans ± (R + 0.5) of the unit frame (height 1)
    check(dUnit > 0.025 || LAYERS[l] === 'snag', `${LAYERS[l]}: depth per texel, std ${dUnit.toFixed(3)} of the tree's height (> 0.025: ≈ 0.4 m on a 16 m lodgepole)`);
    check(badOut / Math.max(1, outside) < 0.02, `${LAYERS[l]}: outside the outline the alpha falls in 0.07 steps (${badOut} off of ${outside})`);
    // T1: the frame holds the whole crown: in every frame of every row, the tile's left and right edge columns lie outside
    // the outline (alpha < 0.5: at most the dilation's falling alpha); a bough cut by the frame would fill them
    let edge = 0;
    for (let y = 0; y < fh * d.el.length; y++) for (let fa = 0; fa < d.az; fa++) for (const x of [fa * fw, fa * fw + fw - 1]) if (d.a[(y * W + x) * 4 + 3] >= 128) edge++;
    check(edge === 0 || LAYERS[l] === 'shrub', `${LAYERS[l]}: no crown at the frame's side edges (${edge} texels inside the outline there)`);
    if (/fir/.test(LAYERS[l])) {
      check(corr < 0.6, `${LAYERS[l]}: not a ball: sideways normal vs place across the crown, r = ${corr.toFixed(2)} (< 0.6; a ball's normals give r ≈ 1)`);
      check(up / n > 0.35, `${LAYERS[l]}: the sprays face up: ${(100 * up / n).toFixed(0)} % of texels' normals over 20° up`);
    }
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
