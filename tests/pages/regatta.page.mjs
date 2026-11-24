// Regatta in a real browser (commit 4): ?mode=regatta&hour=15&headless=1 builds the race with both boats, the line
// (committee boat and pin) and the two marks, and draws them. Run by `npm run test:pages` (LAKESHORE_BASE set), or
//   node tests/pages/regatta.page.mjs --base http://127.0.0.1:<port>
// Capture: renders/captures/regatta-prestart.png.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const Q = 'mode=regatta&hour=15&headless=1&racecam=318,5,-300,258,1,-228&camfov=62';

execFileSync('node', [resolve(ROOT, 'tools/capture.mjs'), '--url', `${BASE}/?${Q}`, '--name', 'regatta-prestart', '--frames', '20', '--timeout', '300000'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
const rec = JSON.parse(readFileSync(resolve(ROOT, 'renders/captures/regatta-prestart.json'), 'utf8'));
check(rec.errors.length === 0, `no page errors (${rec.errors.length})`);

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${BASE}/?${Q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lakeshore?.regatta, null, { timeout: 240000 });
  const r = await page.evaluate(() => { const R = window.__lakeshore.regatta, s = R.state(); return { clock: s.clock, ids: R.race.ids, marks: R.marks.field.marks.map((m) => m.id), wren: s.wrenPose, me: s.player, sail: R.race.view('wren').sail }; });
  check(r.clock === -60 && r.ids.join() === 'me,wren', `the race at -60 s with both boats (${r.ids})`);
  check(['committee', 'pin', 'W', 'I'].every((id) => r.marks.includes(id)), `the line and both marks are laid (${r.marks})`);
  check(Math.hypot(r.wren.x - r.me.x, r.wren.z - r.me.z) > 55 && Math.hypot(r.wren.x - r.me.x, r.wren.z - r.me.z) < 125, 'Osprey starts 60-120 m off, in view, below the line');
  check(r.sail === 17, 'Osprey carries sail 17');
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
