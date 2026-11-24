// #56 M1, the water's surface (render/water-surface.js): the owner's ruling "no need to change the water colour". At fixed
// poses where the water's body is what the eye sees (the deep bay from 12 m, the Sail start's follow camera at noon), the
// median sRGB of the open water with M1 (the default) must be within 3 levels a channel of the water before (?m1=0, M5c's
// fades and shading), while the pattern changes (the luma's mean per-pixel change over the same region is over 2 levels: the
// check can fail). (At a 1.6 m eye the water is mostly mirror, and M1 changes the mirror on purpose: v1's masking reads
// 7–17 levels darker there; v2/notes/water.md § The water's surface.) Also: no page errors, the switch reads on, Ultra's foam reaches
// the wind-4 whitecaps (bright foam pixels). The follow camera's pose is pinned at its orbit before the owner's Boat view
// (?campitch=20&camdist=3.5&camtilt=0): the Boat view (8fc209dc, 2026-11-18: pitch 8°, the 5.5° tilt, the horizon at about
// 52 %) sees these rects at a grazing angle, where the water is mostly mirror (7 levels apart there, by design).
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/waterSurface.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { regionMedian } from '../../../tools/v2-storm.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const TOL = 3;
const POSES = [
  { name: 'deep bay, 12 m eye', q: 'hour=13&wind=2&boat=0&campos=1183.55,12.09,-1047.06&camlook=1137.46,2.16,-1030.41&camfov=41.35', rects: [[0.05, 0.55, 0.95, 0.95]] },
  { name: 'the follow camera, noon', q: 'hour=13&wind=3&settle=20&campitch=20&camdist=3.5&camtilt=0', rects: [[0.02, 0.62, 0.25, 0.85], [0.75, 0.62, 0.98, 0.85]] },
];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const W = 1280, H = 720;
const meanAbsDiff = (A, B, rects) => { let s = 0, n = 0; const l = (P, i) => 0.2126 * P.data[i] + 0.7152 * P.data[i + 1] + 0.0722 * P.data[i + 2]; for (const [x0, y0, x1, y1] of rects) for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x++) { const i = (y * W + x) * 4; s += Math.abs(l(A, i) - l(B, i)); n++; } return s / n; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function shot(q) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${q}&seed=1&hud=0&birds=0&kayaks=0&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#label { display: none !important; }' });
  const m1 = await page.evaluate(async () => { for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); return window.__velia.water.m1; });
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  await page.close();
  return { png, m1, errors };
}
try {
  for (const p of POSES) {
    const before = await shot(`${p.q}&m1=0`), after = await shot(p.q);
    check(!before.errors.length && !after.errors.length, `${p.name}: no page errors (${[...before.errors, ...after.errors].slice(0, 2).join(' | ')})`);
    check(after.m1 === true && before.m1 === false, `${p.name}: M1 on by default, off under ?m1=0`);
    const a = regionMedian(after.png, p.rects), b = regionMedian(before.png, p.rects), d = a.map((v, i) => Math.abs(v - b[i]));
    check(Math.max(...d) <= TOL, `${p.name}: the water's colour ${a.join(', ')} vs before ${b.join(', ')}: within ${TOL} levels (max ${Math.max(...d)})`);
    const md = meanAbsDiff(after.png, before.png, p.rects);
    check(md > 2, `${p.name}: the pattern moved (the luma's mean per-pixel change ${md.toFixed(1)} levels)`);
  }
  // Ultra's foam on the wind-4 whitecaps: bright foam pixels in the open water round the boat (none of the glint: noon, the
  // sun high behind the camera's side)
  const w4 = await shot('hour=13&wind=4&settle=20');
  let bright = 0, n = 0;
  for (let y = Math.floor(0.55 * H); y < Math.floor(0.95 * H); y++) for (let x = 0; x < W; x++) { if (x > 0.3 * W && x < 0.7 * W) continue; const i = (y * W + x) * 4; n++; if (Math.min(w4.png.data[i], w4.png.data[i + 1], w4.png.data[i + 2]) > 150) bright++; }
  check(!w4.errors.length, `wind 4: no page errors (${w4.errors.slice(0, 2).join(' | ')})`);
  check(bright / n > 0.001, `wind 4: whitecap foam drawn (${(100 * bright / n).toFixed(2)} % of the open water's pixels white)`);
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
