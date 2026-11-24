// The post chain (owner, 2026-11-18; render/bloom.js): the bloom and the dither on the real v2 page, at 1280 × 720 headless.
//   - off is the frame before: ?bloom=0&dither=0 draws the composite as before the change (no bloom pipelines, no pass)
//   - the dither: deterministic (two loads of the same frame are the same pixels), at most 1 level a channel off the
//     undithered frame where no bloom is drawn, and it breaks the dusk sky's 8-bit steps (more distinct colours in a crop)
//   - the bloom: the night pose's stern light gains a glow (pixels round it brighter), a dim frame's mean moves under 0.5 level
//   - the device policy: a page forced to a phone builds no bloom pipeline (0 passes); ?bloom=1 on that phone builds its 3
// Run by `npm run test:pages:v2 -- postChain`, or node v2/tests/pages/postChain.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const W = 1280, H = 720;
const DUSK = 'hour=20.55&cam=B&camyaw=295&campitch=14', NIGHT = 'hour=21.6&wind=2&settle=40', CROP = [560, 40, 160, 90];
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const shot = async (q) => {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${q}&seed=1&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await page.evaluate(async () => { for (let i = 0; i < 30; i++) await window.__velia.renderOnce(); });
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  const info = await page.evaluate(() => { const s = window.__velia.stats(); return { post: window.__velia.post(), names: s.gpuPassNames ?? [], pipes: s.pipelines?.total }; });
  await page.close();
  check(!errors.length, `no page errors (${q}) ${errors.slice(0, 2).join(' | ')}`);
  return { png, ...info };
};
const colours = (png, [x0, y0, w, h]) => { const s = new Set(); for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = 4 * (y * W + x); s.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]); } return s.size; };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c])); return m; };
const same = (a, b) => maxDiff(a, b) === 0;
const mean = (png) => { let s = 0; for (let i = 0; i < png.data.length; i += 4) s += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; return s / (W * H); };
try {
  const off = await shot(`${DUSK}&bloom=0&dither=0`), ditherOnly = await shot(`${DUSK}&bloom=0`), on = await shot(DUSK), on2 = await shot(DUSK);
  check(!off.post.bloomBuilt && off.post.passes === 0 && !off.names.includes('bloom'), `?bloom=0: no bloom built, no pass (${off.post.passes} passes)`);
  check(on.post.bloomBuilt && on.post.passes === 2 * on.post.levels - 1 && on.names.includes('bloom'), `the default (a desktop capture): the bloom built, ${on.post.levels} levels, ${on.post.passes} passes`);
  check(same(on.png, on2.png), 'deterministic: two loads of the dusk frame are the same pixels');
  check(maxDiff(off.png, ditherOnly.png) <= 1, `the dither alone moves a channel by at most 1 level (max ${maxDiff(off.png, ditherOnly.png)})`);
  const c0 = colours(off.png, CROP), c1 = colours(ditherOnly.png, CROP);
  check(c1 > c0 * 1.1, `the dusk sky's crop: ${c0} colours without the dither, ${c1} with it (the steps broken)`);
  check(Math.abs(mean(on.png) - mean(off.png)) < 0.5, `the dusk frame's mean moves ${(mean(on.png) - mean(off.png)).toFixed(2)} levels (no haze)`);
  // the night pose: the glow round the stern light (the brightest spot in the lower half), read in a ring 6–14 px out
  const nOff = await shot(`${NIGHT}&bloom=0&dither=0`), nOn = await shot(`${NIGHT}&dither=0`);
  let best = -1, bx = 0, by = 0;
  for (let y = H >> 1; y < H; y++) for (let x = 0; x < W; x++) { const i = 4 * (y * W + x), l = nOff.png.data[i] + nOff.png.data[i + 1] + nOff.png.data[i + 2]; if (l > best) { best = l; bx = x; by = y; } }
  const ring = (png) => { let s = 0, n = 0; for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) { const r = Math.hypot(dx, dy); if (r < 6 || r > 14) continue; const x = bx + dx, y = by + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = 4 * (y * W + x); s += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; n++; } return s / n; };
  check(ring(nOn.png) - ring(nOff.png) > 2, `the stern light's glow: the ring round it ${ring(nOff.png).toFixed(1)} → ${ring(nOn.png).toFixed(1)} levels`);
  // the device policy: a phone builds none; ?bloom=1 builds the 3
  const phone = await shot(`${NIGHT}&profile=form:phone`), phoneOn = await shot(`${NIGHT}&profile=form:phone&bloom=1`);
  check(!phone.post.bloomBuilt && !phone.names.includes('bloom'), `a phone (forced): no bloom, ${phone.pipes} pipelines`);
  check(phoneOn.post.bloomBuilt && phoneOn.pipes - phone.pipes === 3, `?bloom=1 on that phone: the bloom built, ${phoneOn.pipes - phone.pipes} more pipelines (3)`);
} finally { await browser.close(); }
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
