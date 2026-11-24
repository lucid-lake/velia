// fix(v2) terrain shadow (2026-11-14): the land out of the sun keeps the sky's light (render/sky.js landSky). Locks, at
// 1280 × 720 from the bay at 18:30 (the owner's report: the shore in a ridge's shadow read pure black, 0,1,18):
//   the shaded forest (the NW shore under the ridge) within TOL levels a channel of v1's (7,27,30 measured on v1 at the
//     same pose, v2 before this fix 1,7,21) and its green at least 15 (not black);
//   the mountain's back side (the W shore, the face turned from the sun) within TOL of v1's (8,28,34; before 1,9,28);
//   fix(v2) mountains: the W slopes' sunlit granite within 16 of v1's and the peak's snow within 30 (v1's spring snow line);
//   the night (21:36): the terrain shadow's sky light never lights it (the same forest with ?tshadow=0 within 3 levels a
//     channel); look/v2-night-look (2026-11-15, "never sailing blind") made the night readable on purpose (the
//     forest 1,6,8 → 5,24,22 with the shadow on or off alike), so the forest stays a silhouette (its luma ≤ 0.7 × the sky's
//     above the far shore: 19.8 against 30.6, 0.65) and is never black (green ≥ 12: 6 before the night look). The old lock
//     (within 3 of 2,8,10) pinned the pre-night-look exposure, not the shadow.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/terrainShadow.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const W = 1280, H = 720, TOL = 12;
export const CASES = Object.freeze([
  { name: 'the shaded forest at 18:30', q: 'hour=18.5&campos=1050,3,-820&camlook=-1071,40,-2941', box: [120, 300, 400, 350], v1: [7, 27, 30] },
  { name: 'the mountain\'s back side at 18:30', q: 'hour=18.5&campos=1050,3,-820&camlook=-1950,40,-820', box: [400, 300, 600, 350], v1: [8, 28, 34] },
  // fix(v2) mountains: the W slopes at 13:00 (v2 before: the rock 98,104,98 olive, the peak 110,117,108 bare)
  { name: 'the sunlit granite at 13:00', q: 'hour=13&campos=1050,3,-820&camlook=-1950,40,-820', box: [600, 180, 660, 200], v1: [123, 122, 116], tol: 16 },
  { name: 'the snow cap at 13:00', q: 'hour=13&campos=1050,3,-820&camlook=-1950,40,-820', box: [770, 95, 800, 105], v1: [230, 229, 228], tol: 30 },
]);
export const NIGHT = Object.freeze({ q: 'hour=21.6&campos=1050,3,-820&camlook=-1071,40,-2941', box: [120, 300, 400, 350], sky: [800, 20, 1200, 140], silhouette: 0.7, green: 12 });
const luma = (m) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const median = (png, [x0, y0, x1, y1]) => [0, 1, 2].map((c) => { const a = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a.push(png.data[4 * (y * W + x) + c]); a.sort((p, q) => p - q); return a[a.length >> 1]; });
try {
  const shot = async (q) => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/?${q}&seed=1&hud=0&birds=0&headless=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
    await page.evaluate(async () => { for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); });
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
    await page.close();
    check(!errors.length, `no page errors (${q}) ${errors.slice(0, 2).join(' | ')}`);
    return png;
  };
  for (const c of CASES) {
    const m = median(await shot(c.q), c.box), d = Math.max(...m.map((x, i) => Math.abs(x - c.v1[i]))), tol = c.tol ?? TOL;
    check(d <= tol && m[1] >= 15, `${c.name} ${m.join(', ')} vs v1's ${c.v1.join(', ')}: within ${tol} (max ${d}), green ${m[1]} ≥ 15 (not black)`);
  }
  const nightPng = await shot(NIGHT.q), n = median(nightPng, NIGHT.box), sky = median(nightPng, NIGHT.sky);
  const off = median(await shot(`${NIGHT.q}&tshadow=0`), NIGHT.box), dn = Math.max(...n.map((x, i) => Math.abs(x - off[i])));
  check(dn <= 3, `the terrain shadow leaves the night's forest alone: ${n.join(', ')} vs ${off.join(', ')} with ?tshadow=0 (max ${dn})`);
  check(luma(n) <= NIGHT.silhouette * luma(sky), `the night's tree line stays a silhouette: luma ${luma(n).toFixed(1)} ≤ ${NIGHT.silhouette} × the sky's ${luma(sky).toFixed(1)}`);
  check(n[1] >= NIGHT.green, `the night's tree line is not black: green ${n[1]} ≥ ${NIGHT.green}`);
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
