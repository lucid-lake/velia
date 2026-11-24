// T1: the forest cards are not one flat green. On a pinned headless frame of the near shore (the owner's
// complaint pose, 13:00), the cards' own pixels (the frame with the cards drawn against the same frame without them:
// __velia.setForestDraw) must show a sun side and a shade side: their luminance spread (p90 / p10) is wide, the lit
// crowns' brightest tenth well above the median, and the trees differ in hue (the per-tree hue: the spread of g / (r + b)).
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/forestLight.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?hour=13&campos=988,2,-265&camlook=1872,30,1128&seed=1&headless=1&hud=0&birds=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  const shot = async (on) => {
    await page.evaluate(async (o) => { window.__velia.setForestDraw(o); for (let i = 0; i < 8; i++) await window.__velia.renderOnce(); }, on);
    return PNG.sync.read(await page.screenshot());
  };
  const on = await shot(true), off = await shot(false);
  const lum = [], hue = [];
  for (let i = 0; i < on.data.length; i += 4) {
    const d = Math.abs(on.data[i] - off.data[i]) + Math.abs(on.data[i + 1] - off.data[i + 1]) + Math.abs(on.data[i + 2] - off.data[i + 2]);
    if (d < 24) continue;   // a card's pixel: the cards changed it
    const [r, g, b] = [on.data[i], on.data[i + 1], on.data[i + 2]];
    if (r + g + b > 600) continue;   // (the sky through a gap)
    lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    if (g > 30) hue.push(g / Math.max(1, r + b));
  }
  lum.sort((a, b) => a - b); hue.sort((a, b) => a - b);
  const q = (a, p) => a[Math.floor(a.length * p)];
  check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  check(lum.length > 20000, `the cards cover the frame (${lum.length} px)`);
  const spread = q(lum, 0.9) / Math.max(1, q(lum, 0.1));
  check(spread > 5.0, `a sun side and a shade side: card luminance p90 / p10 = ${spread.toFixed(2)} (> 5.0; p10 ${q(lum, 0.1).toFixed(0)}, p50 ${q(lum, 0.5).toFixed(0)}, p90 ${q(lum, 0.9).toFixed(0)})`);
  check(q(lum, 0.9) - q(lum, 0.5) > 25, `lit crowns stand out: p90 − p50 = ${(q(lum, 0.9) - q(lum, 0.5)).toFixed(0)} (> 25)`);
  check(q(hue, 0.9) - q(hue, 0.1) > 0.55, `not one green: the hue (g / (r + b)) spans ${(q(hue, 0.9) - q(hue, 0.1)).toFixed(2)} p10–p90 (> 0.55; one tint per species read 0.49 before T1)`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
