// fix(v2) frame look (2026-11-14; the owner, on the storm cam E stack: "why does v2 have such a gap?"): the black band across
// Emerald Bay's mouth. Rasterised without refraction, a grazing ray over the mouth's sill reaches the floor past it, where
// the terrain draws no node (wholly under 60 m: v2/terrain/quadtree.js floorCut); the water there let the cleared
// background through (a black band, 9, 16, 23). The water is now its own opaque body where its straight ray passes the floor
// cut clear (render/water.js WV.hole), and the sky draw keeps the deck off the below-horizon hole and fogs it (render/sky.js).
// Locked at v1's storm cam E pose (tools/v2-storm.mjs camE, 147 s), 1280 × 720: the band's median (x 700–960, y 420–428)
// within 20 levels a channel of v1's (62, 70, 78) and never under 0.7 of the fogged far water just above it (y 404–412).
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/stormMouth.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
export const V1_BAND = Object.freeze([62, 70, 78]);
// the v1 approach (owner, 2026-11-18: "go with the plan, v1's way"): round 2's rain murk is gone; the lock is v1's band again
// (V1_BAND; measured 56, 65, 72 on fix/v2-storm-v1-approach); round 2's is kept for the line
export const ROUND2_BAND = Object.freeze([130, 138, 144]);
const W = 1280, H = 720, TOL = 20;
const Q = 'hour=18.25&cam=E&wind=2&weather=storm&cloudcov=0.6&stormref=1050,-820&stormt=147';
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const median = (png, [x0, y0, x1, y1]) => [0, 1, 2].map((c) => { const a = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a.push(png.data[4 * (y * W + x) + c]); a.sort((p, q) => p - q); return a[a.length >> 1]; });
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${Q}&seed=1&hud=0&birds=0&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await page.evaluate(async () => { for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); });
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  await page.close();
  check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  const band = median(png, [700, 420, 960, 428]), above = median(png, [700, 404, 960, 412]);
  const d = band.map((v, i) => Math.abs(v - V1_BAND[i]));
  check(Math.max(...d) <= TOL, `the mouth's band ${band.join(', ')} vs v1's ${V1_BAND.join(', ')}: within ${TOL} (max ${Math.max(...d)}; round 2 ${ROUND2_BAND.join(', ')})`);
  const Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  check(Y(band) >= 0.7 * Y(above), `no dark band: ${Y(band).toFixed(1)} against the far water's ${Y(above).toFixed(1)}`);
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
