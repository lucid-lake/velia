// fix(v2) cloud colour (2026-11-14; the owner: "Our cloud color … do not match V1"): the noon deck's colour locked to v1's.
// v2 renders noon from cam E (toward the open lake) at 1280 × 720 with the deck and with ?clouds=0; the difference is the
// cloud mask (tools/cloud-colour-measure.mjs). The median sRGB of the sunlit tops (the core's brightest quarter) and the
// undersides (its darkest quarter) must be within 8 levels a channel of v1's at the same pose, measured the same way
// (tools/v2-cloud-colour.mjs on v1 at 71d773ff: tops 206, 209, 216; undersides 163, 176, 193). Before the fix v2 read
// 174, 175, 183 and 109, 116, 132.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/cloudColour.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { measurePixels } from '../../../tools/cloud-colour-measure.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
export const V1_NOON_E = Object.freeze({ top: [206, 209, 216], under: [163, 176, 193] });
const TOL = 8;
const V1_DECK = 0.6;   // v1's CLOUD_DECK coverage, the deck its samples were measured under
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const W = 1280, H = 720;
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const shot = async (off) => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    // v1's numbers were taken under v1's deck (0.6); the page's default deck is clearer since 2026-11-19 (Fair 0.28,
    // item 1, the owner's wallpaper fixes), so the colour is compared under v1's deck, as frameLook does (V1_DECK)
    await page.goto(`${BASE}/?hour=13&cam=E&seed=1&hud=0&birds=0&cloudcov=${V1_DECK}${off ? '&clouds=0' : ''}&headless=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
    const cam = await page.evaluate(async () => { for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); const c = window.__velia.camera; return { fwd: [...c.fwd], fov: c.fov }; });
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
    await page.close();
    check(!errors.length, `no page errors${off ? ' (?clouds=0)' : ''} (${errors.slice(0, 2).join(' | ')})`);
    return { px: png.data, cam };
  };
  const on = await shot(false), off = await shot(true);
  const m = measurePixels(on.px, off.px, on.cam, W, H);
  check(m.cover > 20, `the deck covers the frame's sky (${m.cover} % of the frame)`);
  for (const r of ['top', 'under']) {
    const d = m[r] ? m[r].map((v, i) => Math.abs(v - V1_NOON_E[r][i])) : [999];
    check(Math.max(...d) <= TOL, `noon ${r === 'top' ? 'cloud tops' : 'undersides'} ${m[r]?.join(', ')} vs v1's ${V1_NOON_E[r].join(', ')}: within ${TOL} levels (max ${Math.max(...d)})`);
  }
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
