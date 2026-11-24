// 10a: the towns on a live headless page, the GPU side the node tests cannot reach.
//   loaded        the shore and the ground's marks in before the first frame (a capture), no page error, 0 pipelines late
//   no trees on the runs, Hwy 89 or its cut   the forest's instance buffer read back (__velia.forest.readInst): no lidar
//                 crown, shrub or rules tree the GPU kept stands where the JS twin (v2/towns/format.js keepOutR) clearly
//                 keeps it out (0.05 past v1's thresholds: f32 against f64 at the edge), and the keep-out did drop some
//   the shore     drawn from the bay's mouth (cam A): its draws and instances in view
//   #41b the colour  the boathouse at v1's pier pose (campos 398,3,-622, 13:00, 1280 × 720): its wall and its roof within
//                 10 levels a channel of v1's there (wall 35,43,52, roof 170,169,163: v1 captured 2026-11-14)
//   #41c the mirror  the shore's mirror read back (__velia.towns.readMirror) at that pose: the column toward the
//                 boathouse covered over the elevations its wall and roof span from the mirror point, the wall's texels
//                 dark and the roof's light, nothing above the roof's apex; the map's count word 0 with the mirror off
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/towns.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { decodeMask, maskAt, KEEP } from '../../towns/format.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const M = decodeMask(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/towns/mask.vtm.gz'))));
// clearly kept out: the marks past the thresholds by 0.05 at the trunk, or (road, cut) at the crown's four reach points
const clearlyOut = (x, z, r) => {
  const over = (m, centre) => (centre && m.ski > KEEP.ski + 0.05) || m.road > KEEP.road + 0.05 || m.cut > KEEP.cut + 0.05;
  if (over(maskAt(M, x, z), true)) return true;
  for (let k = 0; k < 4; k++) { const a = k * 1.5707963, d = r * KEEP.reach; if (over(maskAt(M, x + Math.cos(a) * d, z + Math.sin(a) * d), false)) return true; }
  return false;
};
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&hour=13&cam=A&seed=1&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__velia.renderOnce());
  const s = await page.evaluate(() => { const st = window.__velia.stats(); return { towns: st.towns, pipelines: st.pipelines, errors: window.__velia.errors.slice(0, 3), forest: { trees: st.forest.trees, shrubs: st.forest.shrubs } }; });
  check(!errors.length && !s.errors.length, `no page errors (${errors.concat(s.errors).slice(0, 2).join(' | ')})`);
  check(s.towns.ready && s.towns.maskReady, `the shore (${s.towns.instances} instances) and the marks (${s.towns.maskGpuBytes} B) in before the first frame`);
  check(s.pipelines.afterFirstFrame === 0, `0 pipelines after the first frame (${s.pipelines.total} in all)`);
  check(s.towns.draws > 0 && s.towns.drawn > 0, `the shore drawn from cam A: ${s.towns.draws} draws, ${s.towns.drawn} instances`);
  const parts = await page.evaluate(async () => {
    const F = window.__velia.forest, n = F.stats;
    const R = (first, count) => F.readInst(first, count);
    return { trees: await R(F.OFF.trees, n.trees), shrubs: await R(F.OFF.shrubs, n.shrubs ?? 0), region: await R(F.OFF.region, F.regionSlots) };
  });
  const u32 = new Uint32Array(1), f32 = new Float32Array(u32.buffer);
  const bits = (w) => { f32[0] = w; return u32[0]; };
  for (const [name, a] of Object.entries(parts)) {
    let kept = 0, wrong = 0, dropped = 0;
    for (let i = 0; i < a.length; i += 4) {
      const p = bits(a[i + 3]); if (!p && name === 'region') continue;
      const r = ((p >>> 10) & 255) / 10, valid = (p >>> 23) & 1, out = clearlyOut(a[i], a[i + 1], r);
      if (valid) { kept++; if (out) wrong++; } else if (out) dropped++;
    }
    check(wrong === 0, `${name}: none of the ${kept} kept stands on a run, Hwy 89 or its cut (${wrong} do)`);
    if (name !== 'region') check(dropped > 0, `${name}: the keep-out dropped ${dropped} on the road and its cut`);
  }
  // #41b, #41c: v1's pier pose
  const pier = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await pier.goto(`${BASE}/?start=1200,-1050&heading=251&hour=13&campos=398,3,-622&camlook=371,4,-589&seed=1&headless=1`, { waitUntil: 'load' });
  await pier.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  for (let i = 0; i < 6; i++) await pier.evaluate(() => window.__velia.renderOnce());
  const { PNG } = await import('pngjs');
  const img = PNG.sync.read(await pier.screenshot({ type: 'png' }));
  const med = (x, y, w, h) => [0, 1, 2].map((c) => { const v = []; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) v.push(img.data[(j * img.width + i) * 4 + c]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
  const near = (a, b) => a.every((v, c) => Math.abs(v - b[c]) <= 10);
  const wall = med(560, 350, 120, 40), roof = med(560, 305, 120, 12);
  check(near(wall, [35, 43, 52]), `the boathouse wall ${wall} within 10 levels of v1's 35,43,52`);
  check(near(roof, [170, 169, 163]), `the boathouse roof ${roof} within 10 levels of v1's 170,169,163`);
  // the boathouse (walls 7 × 11 m to 5.45 m, the gable's apex 7.85 m, its centre 371.5, −589.4) from the mirror point
  // 3 m under the surface: its column, and the bins of its wall (the deck's 1.25 m to 5.45 m) and of its roof
  const M2 = await pier.evaluate(async () => { const r = await window.__velia.towns.readMirror(); const az = Math.atan2(-589.4 + 622, 371.5 - 398); const x = Math.floor((az / (2 * Math.PI) + 0.5) * 1024);
    const col = []; for (let b = 0; b < 128; b++) col.push(r.at(x, b)); return { count: r.count, x, top: r.tops[x], col }; });
  const binOf = (eDeg) => Math.round(Math.sqrt(eDeg / 60) * 127);
  const D = Math.hypot(371.5 - 398, -589.4 + 622), elev = (h, d) => Math.atan2(h + 3, d) * 180 / Math.PI;
  const wallBins = [binOf(elev(1.6, D - 3)), binOf(elev(5.0, D - 3))], apex = binOf(elev(7.85, D - 5.5));
  const lum = (t) => 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  const covered = M2.col.slice(wallBins[0], wallBins[1] + 1).every((t) => t[3] > 0.9);
  check(M2.count > 0 && covered, `the mirror's column ${M2.x} toward the boathouse covered over its wall's bins ${wallBins.join('–')} (alpha ${M2.col.slice(wallBins[0], wallBins[1] + 1).map((t) => t[3].toFixed(2)).join(' ')})`);
  const wallL = lum(M2.col[Math.round((wallBins[0] + wallBins[1]) / 2)]), roofL = Math.max(...M2.col.slice(wallBins[1] + 1, apex + 1).map(lum));
  check(roofL > 2 * wallL, `the roof's texels lighter than the wall's (${roofL.toFixed(3)} vs ${wallL.toFixed(3)}), as the draw's`);
  check(M2.top <= apex + 3 && M2.col.slice(apex + 4).every((t) => t[3] === 0), `nothing over the roof's apex (column top ${M2.top}, apex bin ${apex})`);
  await pier.evaluate(async () => { window.__velia.setTownsMirror(false); for (let i = 0; i < 2; i++) await window.__velia.renderOnce(); });
  const off = await pier.evaluate(async () => (await window.__velia.towns.readMirror()).count);
  check(off === 0, `the mirror off: its count word ${off} (the water skips the read)`);
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
