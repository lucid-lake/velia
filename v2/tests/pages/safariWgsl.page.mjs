// The phone pass: iPhone Safari's WGSL safety. Every WGSL module the real v2 page builds (the registry keeps their text:
// __velia.wgsl()), at each quality level and on the paths that build different modules (a live Sail page with the
// cockpit and the birds, a capture, MSAA 1 at L2), linted for the constructs Safari's WebGPU rejects or mis-handles
// (v2/engine/wgsl-lint.js: reversed or equal smoothstep edges, reversed clamp bounds, f16 without enable, f32 overflow).
// Prints the hit list; passes on 0 hits. Also: the pipelines are all built at load at every level (0 after the first frame).
// Run by `npm run test:pages:v2`, or node v2/tests/pages/safariWgsl.page.mjs --base http://127.0.0.1:<port> [--list]
import { chromium } from 'playwright-core';
import { lintModules } from '../../engine/wgsl-lint.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const PAGES = [
  ['live Sail, L0', '/?hour=13&seed=1&quality=0&birds=1'],
  ['live Sail, L1', '/?hour=13&seed=1&quality=1&birds=1'],
  ['live Sail, L2 (MSAA 1)', '/?hour=13&seed=1&quality=2&birds=1&touch=1'],
  ['capture, storm', '/?hour=16&seed=1&headless=1&weather=storm&stormt=150'],
];

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const seen = new Map();   // module text → label (one lint per distinct text)
try {
  for (const [name, url] of PAGES) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.wgsl, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ mods: window.__velia.wgsl(), st: window.__velia.stats() }));
    for (const m of r.mods) if (!seen.has(m.code)) seen.set(m.code, m.label);
    check(r.st.pipelines.afterFirstFrame === 0 && r.st.pipelines.total > 20, `${name}: ${r.st.pipelines.total} pipelines, ${r.st.pipelines.afterFirstFrame} after the first frame, ${r.mods.length} modules, quality ${r.st.quality?.name}, MSAA ${r.st.msaa}`);
    await page.close();
  }
  const hits = lintModules([...seen].map(([code, label]) => ({ label, code })));
  console.log(`\n${seen.size} distinct modules; ${hits.length} hits`);
  for (const h of hits) console.log(`  ${h.rule} (${h.kind})  ${h.label}:${h.line}  ${h.detail}\n      ${h.text}`);
  check(hits.length === 0, `the Safari scan: ${hits.length} hits over ${seen.size} modules`);
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
