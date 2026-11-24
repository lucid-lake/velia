// Ultra M2 (texture room, then the caustics) on a live headless page:
//   the packing   the bay's height codes in the terrain fragment's storage buffer (render/terrain.js copyBed) read back
//                 identically to the slot's texture: every texel, and the bilinear height at the probe points bit for bit
//                 (__velia.terrain.runBedProbe)
//   the caustics  render/caustics.js splats with the sun up (its pass drawn, the light's mean ≈ 1 over a tile) and not at
//                 night (no pass: the bed reads no caustic then)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/bedPack.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${q}&seed=1&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  return { page, errors };
}
try {
  {
    const { page, errors } = await open('hour=13&cam=I');
    const r = await page.evaluate(() => window.__velia.terrain.runBedProbe());
    check(!!r, 'the bay\'s codes are in the fragment\'s buffer');
    check(r && r.texels === r.w * r.h && r.texelsDiffer === 0, `every texel reads back identically: ${r?.texelsDiffer} of ${r?.texels} differ (${r?.w} × ${r?.h} at ${r?.step} m)`);
    check(r && r.heights > 100 && r.heightsDiffer === 0, `the bed's bilinear height bit for bit at the probe points: ${r?.heightsDiffer} of ${r?.heights} differ`);
    await page.evaluate(() => window.__velia.renderOnce());
    const c = await page.evaluate(() => { const C = window.__velia.caustics; return C ? { up: C.state.up, drawn: C.drawn } : null; });
    check(c && c.up && c.drawn > 0, `noon: the caustics splat (${c?.drawn} draws)`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  {
    const { page, errors } = await open('hour=23&cam=I');
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await window.__velia.renderOnce(); });
    const c = await page.evaluate(() => { const C = window.__velia.caustics; return C ? { up: C.state.up, drawn: C.drawn } : null; });
    check(c && !c.up && c.drawn === 0, `night: no caustics drawn (${c?.drawn} draws, sun up ${c?.up})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
