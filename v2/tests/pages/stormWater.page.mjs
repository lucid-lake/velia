// #18 (2026-11-14): the storm's water locked to v1's navy. v2 renders v1's storm golden pose (off Emerald Bay's mouth, the
// follow camera) at 147 s into the arc (between two strikes: the hero bolt at 150.27 s flashes the whole frame) at
// 1280 × 720; the median sRGB of the open water either side of the boat (tools/v2-storm.mjs `follow`: x 2–22 % and
// 80–98 %, y 62–80 %) must be within 10 levels a channel of v1's at the same pose, measured the same way
// (tools/v2-storm.mjs on v1 at 94da477c: V1_FOLLOW below). Before the fix v2 read V2_BEFORE: grey, not navy.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/stormWater.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { regionMedian } from '../../../tools/v2-storm.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
export const V1_FOLLOW = Object.freeze([5, 8, 17]);
// the v1 approach (owner, 2026-11-18: "go with the plan, v1's way"): round 2's rain murk is gone and the water stays real, so the
// lock is v1's level again (V1_FOLLOW; measured 5, 10, 17 on fix/v2-storm-v1-approach); round 2's is kept for the line
export const ROUND2 = Object.freeze([19, 28, 34]);
export const V2_BEFORE = Object.freeze([17, 19, 23]);
const WATER = [[0.02, 0.62, 0.22, 0.80], [0.80, 0.62, 0.98, 0.80]];
const TOL = 10;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const W = 1280, H = 720;
const Q = 'hour=18.25&wind=2&start=2300,-1400&heading=330&weather=storm&cloudcov=0.6&stormref=2300,-1400&stormt=147&settle=8';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${Q}&seed=1&hud=0&birds=0&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  const st = await page.evaluate(async () => { for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); const w = window.__velia.storm.weather; return { on: w.on, flash: w.flash, rain: w.rain }; });
  const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
  await page.close();
  check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  check(st.on === 1 && st.rain > 0.5 && st.flash === 0, `the storm runs, the rain is on, no flash (on ${st.on}, rain ${st.rain.toFixed(2)}, flash ${st.flash})`);
  const m = regionMedian(png, WATER);
  const d = m.map((v, i) => Math.abs(v - V1_FOLLOW[i]));
  check(Math.max(...d) <= TOL, `the storm water ${m.join(', ')} vs v1's ${V1_FOLLOW.join(', ')}: within ${TOL} levels (max ${Math.max(...d)}; round 2 ${ROUND2.join(', ')}; before the fix ${V2_BEFORE.join(', ')})`);
  check(m[2] > m[0] + 6, `navy, not grey: blue over red by more than 6 levels (${m[2] - m[0]})`);
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
