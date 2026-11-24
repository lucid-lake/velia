// audit W1–W3 on the GPU (v2/render/windWater.js): each part switched off and on (__velia.setWindFx) on two pages that render
// the same steps, at the audit's poses: the gust patches at cam A (14:00, level 3) darken the water where a gust blows; the
// whitecaps (#56 M1's) follow the local wind at level 3 (cam B); the lanes at level 3 (cam B) move the water both ways. The wind texture is filled in a capture.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/windWater.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const W = 1280, H = 720, Y0 = Math.floor(0.6 * H);   // the water: the frame's bottom 40 %
const L = (P, i) => 0.2126 * P.data[i] + 0.7152 * P.data[i + 1] + 0.0722 * P.data[i + 2];

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const frame = async (q, part, on) => {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${q}&seed=1&hud=0&birds=0&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  const fills = await page.evaluate(async ([part, on]) => { window.__velia.setWindFx({ [part]: on }); for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); return window.__velia.windTex.fills; }, [part, on]);
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  await page.close();
  return { png, errors, fills };
};
const compare = (a, b) => {
  let n = 0, darker = 0, lighter = 0, white = [0, 0], dl = 0;
  for (let y = Y0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, la = L(a, i), lb = L(b, i), d = la - lb;
    if (Math.abs(d) > 2) { n++; dl += d; if (d < 0) darker++; else lighter++; }
    if (la > 170) white[0]++; if (lb > 170) white[1]++;
  }
  const px = W * (H - Y0);
  return { pct: 100 * n / px, darker: 100 * darker / px, lighter: 100 * lighter / px, meanD: n ? dl / n : 0, white };
};
try {
  for (const [name, q, part] of [['gust patches, cam A', 'hour=14&cam=A&wind=3', 'gust'], ['whitecaps on the local wind, level 3', 'hour=13&cam=B&wind=3', 'caps'], ['lanes, level 3', 'hour=13&cam=B&wind=3', 'lanes']]) {
    const on = await frame(q, part, true), off = await frame(q, part, false);
    check(!on.errors.length && !off.errors.length, `${name}: no page errors (${[...on.errors, ...off.errors].slice(0, 2).join(' | ')})`);
    check(on.fills >= 1, `${name}: the wind texture is filled (${on.fills} fills in 40 frames)`);
    const c = compare(on.png, off.png);
    const msg = `${c.pct.toFixed(1)} % of the water moves (darker ${c.darker.toFixed(1)} %, lighter ${c.lighter.toFixed(1)} %, mean ${c.meanD.toFixed(1)}; white px ${c.white[0]} vs ${c.white[1]})`;
    if (part === 'gust') check(c.darker > 10, `${name}: the patches darken the water where a gust blows (the lees' smoother ripples lighten the rest): ${msg}`);
    if (part === 'caps') check(c.pct > 0.05 && c.white[0] !== c.white[1], `${name}: the caps follow the local wind (more in the gusts, fewer in the lees) against the frame's one wind: ${msg}`);
    if (part === 'lanes') check(c.pct > 1 && c.darker > 0.2 && c.lighter > 0.2, `${name}: the lanes move the water both ways: ${msg}`);
  }
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
