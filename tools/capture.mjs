// Headless capture: renders the scene in Chrome with WebGPU and writes a PNG plus a stats JSON.
//   node tools/capture.mjs --name dawn-A --hour 6.5 --cam A [--seed 1] [--w 1280 --h 720] [--out renders/captures] [--frames 30]
//   node tools/capture.mjs --golden   # writes to golden/<name>.png instead (a new reference; say why)
// Needs the dev server running (bash), or pass --url.
// Uses the installed Google Chrome through playwright-core: no browser download.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter((x) => x.length));

if (args.help || args.h === true) {   // --h 1080 is the height, not help
  console.log('node tools/capture.mjs [--app v2] --name <n> [--hour h] [--cam A|B] [--seed s] [--exposure e] [--extra "k=v&…"] [--url <u>] [--frames n] [--w 1280 --h 720] [--timeout ms] [--golden]');
  process.exit(0);
}
// --app v2: the Velia v2 page (v2/, Vite on 5174): captures under renders/captures/v2/, goldens in v2/golden/.
const APP = args.app === 'v2' ? 'v2' : 'v1';
const PORT = APP === 'v2' ? 5174 : 5173;
const name = args.name ?? 'dawn-A';
const hour = args.hour ?? '6.5';   // 06:30 PDT, sun +8.8° (the old 05:12 UTC at 47° N, +9.0°)
const cam = args.cam ?? 'A';
const seed = args.seed ?? '1';
const W = parseInt(args.w ?? '1280', 10), H = parseInt(args.h ?? '720', 10);
const frames = parseInt(args.frames ?? '30', 10);
// Every scene parameter goes into the URL; --extra "k=v&k2=v2" passes anything else through.
const extra = [args.exposure ? `exposure=${args.exposure}` : '', args.extra ?? ''].filter(Boolean).join('&');
const url = args.url ?? `http://127.0.0.1:${PORT}/?hour=${hour}&cam=${cam}&seed=${seed}${extra ? '&' + extra : ''}&headless=1`;
const outDir = args.golden ? resolve(ROOT, APP === 'v2' ? 'v2/golden' : 'golden') : resolve(ROOT, args.out ?? (APP === 'v2' ? 'renders/captures/v2' : 'renders/captures'));
mkdirSync(outDir, { recursive: true });

const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME}; set LAKESHORE_CHROME`); process.exit(2); }

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--no-first-run'],
});
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('console', (m) => { if (process.env.LAKESHORE_VERBOSE) console.error(`[console.${m.type()}] ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  try {
    await page.waitForFunction(() => (window.__lakeshore ?? window.__velia)?.renderOnce, null, { timeout: parseInt(args.timeout ?? '60000', 10) });
  } catch (e) {
    console.error(`page never became ready (${e.name}). Errors so far:\n${errors.join('\n') || '(none; set LAKESHORE_VERBOSE=1 for the console)'}`);
    process.exit(1);
  }
  const stats = await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await (window.__lakeshore ?? window.__velia).renderOnce();
    return (window.__lakeshore ?? window.__velia).stats();
  }, frames);
  const png = resolve(outDir, `${name}.png`);
  await page.screenshot({ path: png, type: 'png' });
  const record = { name, url, size: [W, H], when: new Date().toISOString(), stats, errors };
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(record, null, 2));
  const gpu = stats.gpuMs != null ? `${stats.gpuMs.toFixed(2)} ms gpu` : 'gpu n/a';
  console.log(`${png}  ${stats.backend}  cpu p50 ${stats.cpuMs.p50?.toFixed(2)} ms  p95 ${stats.cpuMs.p95?.toFixed(2)} ms  ${gpu}  ${stats.calls} calls  ${stats.triangles} tris${errors.length ? `  ERRORS ${errors.length}` : ''}`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
} finally {
  await browser.close();
}
