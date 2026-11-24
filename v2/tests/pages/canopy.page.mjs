// T3: the far forest's canopy grid on the GPU (render/canopy.js) against its JS twin (forest/canopy.js) over
// the lidar's crowns round Fannette Island: the same cover where the trees are, none on the bay's water; two page loads
// give the same grid word for word (deterministic); the far hillside's frame has fewer cards than T1's 40,903.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/canopy.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve as rp, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeForest, unpackBits } from '../../forest/format.js';
import { splatTree, resolve, unpackWord } from '../../forest/canopy.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const ROOT = rp(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const grab = async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?hour=13&cam=B&camyaw=270&seed=1&headless=1&hud=0&birds=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  const r = await page.evaluate(async () => { const V = window.__velia; for (let i = 0; i < 4; i++) await V.renderOnce(); const d = await V.forest.canopy.read(); return { ...d, words: Array.from(d.words), visible: V.stats().forest?.visible ?? 0 }; });
  await page.close();
  return { ...r, errors };
};
try {
  const a = await grab(), b = await grab();
  check(!a.errors.length && !b.errors.length, `no page errors (${[...a.errors, ...b.errors].slice(0, 2).join(' | ')})`);
  let diff = 0; for (let k = 0; k < a.words.length; k++) if (a.words[k] !== b.words[k]) diff++;
  check(diff === 0, `deterministic: two loads, ${diff} of ${a.words.length} words differ`);
  check(a.visible > 0 && a.visible < 40903 * 0.85, `the far hillside's cards: ${a.visible} (T1: 40,903)`);
  // the twin over a 1 km block round the island (the lidar's crowns; the place pass drops the few in the lake or keep-outs)
  const T = decodeForest(gunzipSync(readFileSync(rp(ROOT, 'v2/forest/data/trees.vft'))));
  const i0 = Math.round((-700 - a.x0) / a.texel), j0 = Math.round((-500 - a.z0) / a.texel), n = 128;
  const G = { x0: a.x0 + i0 * a.texel, z0: a.z0 + j0 * a.texel, texel: a.texel, nx: n, nz: n };
  const c = new Uint32Array(n * n), t = new Uint32Array(n * n);
  // the block's margin: the trees within 3 texels outside it too (their crowns reach in)
  const m = 3 * a.texel;
  for (let q = 0; q < T.n; q++) {
    const f = new Float32Array(T.inst.buffer, q * 16, 2), bt = unpackBits(T.inst[4 * q + 3]);
    if (bt.layer === 5 || f[0] < G.x0 - m || f[0] >= G.x0 + n * a.texel + m || f[1] < G.z0 - m || f[1] >= G.z0 + n * a.texel + m) continue;
    splatTree(G, c, t, f[0], f[1], bt.h, bt.r);
  }
  const words = resolve(G, c, t);
  let sum = 0, cnt = 0, gpuWet = 0, wet = 0;
  for (let j = 4; j < n - 4; j++) for (let i = 4; i < n - 4; i++) {
    const g = unpackWord(a.words[(j0 + j) * a.nx + i0 + i]), w = unpackWord(words[j * n + i]);
    sum += Math.abs(g.cover - w.cover); cnt++;
    if (w.cover === 0) { wet++; if (g.cover > 0) gpuWet++; }
  }
  check(sum / cnt < 0.02, `the GPU's cover is the twin's: mean |Δ| ${(sum / cnt).toFixed(4)} over ${cnt} texels (< 0.02)`);
  check(wet > 100 && gpuWet === 0, `none on the water: ${gpuWet} of ${wet} treeless texels carry cover on the GPU`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
