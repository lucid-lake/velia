// The buildings on a live headless page (v2/render/buildings.js), the GPU side the node tests cannot reach.
//   Ski Run       a start at the Ski Run pin loads the lake and south sets before the first frame, draws them in one
//                 instanced draw, no page error, 0 pipelines late
//   grounding     the compute pass's foot and eaves for the kept boxes (__velia.buildings.readGround) match the CPU's twin
//                 (v2/towns/buildings.js groundBox) on the page's own drawn ground (terrain.field.height) within 0.05 m
//   night         the south's lights (the towers' facades, the docks) join the lake's after it
//   the bay       a start in Emerald Bay loads the lake set only (the owner's per-region rule)
//   a phone       ?profile=form:phone: no buildings, no fetch of their files
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/buildings.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { groundBox } from '../../towns/buildings.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const open = async (q) => {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [], fetched = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('request', (r) => fetched.push(r.url()));
  await page.goto(`${BASE}/?${q}&seed=1&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__velia.renderOnce());
  return { page, errors, fetched };
};
try {
  {
    const { page, errors } = await open('start=11800,-875&heading=100&hour=21.6');
    const s = await page.evaluate(() => { const st = window.__velia.stats(); return { b: st.buildings, pipelines: st.pipelines, errors: window.__velia.errors.slice(0, 3), night: window.__velia.night?.stats ?? null }; });
    check(!errors.length && !s.errors.length, `no page errors (${errors.concat(s.errors).slice(0, 2).join(' | ')})`);
    check(s.b?.ready && s.b.sets.join() === 'lake,south', `the Ski Run start loads the lake and south sets before the first frame (${s.b?.sets}, ${s.b?.records} records)`);
    check(s.b.drawn > 500 && s.b.draws === 1, `one instanced draw: ${s.b.drawn} boxes in ${s.b.chunks} chunks`);
    check(s.pipelines.afterFirstFrame === 0, `0 pipelines after the first frame (${s.pipelines.total} in all)`);
    // the GPU's grounding against the CPU's twin on the page's drawn ground
    const rows = await page.evaluate(async () => {
      const B = window.__velia.buildings, T = window.__velia.terrain, g = await B.readGround(), out = [];
      for (let k = 0; k < g.length; k += Math.max(1, Math.floor(g.length / 300))) {
        const r = B.rec(g[k].i), ca = Math.cos(r.yaw), sa = Math.sin(r.yaw), pts = [[r.x, r.z]];
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push([r.x + u * r.len / 2 * ca + v * r.wid / 2 * sa, r.z - u * r.len / 2 * sa + v * r.wid / 2 * ca]);
        out.push({ r, base: g[k].base, top: g[k].top, h: pts.map(([x, z]) => [x, z, T.field.height(x, z)]) });
      }
      return out;
    });
    let worst = 0, n = 0, worstRow = null;
    for (const row of rows) {
      const H = new Map(row.h.map(([x, z, y]) => [`${x.toFixed(3)},${z.toFixed(3)}`, y]));
      const [b, t] = groundBox((x, z) => H.get(`${x.toFixed(3)},${z.toFixed(3)}`) ?? NaN, row.r);
      if (!Number.isFinite(b)) continue;
      const e = Math.max(Math.abs(b - row.base), Math.abs(t - row.top)); if (e > worst) { worst = e; worstRow = { kind: row.r.kind, mode: row.r.mode, x: row.r.x, z: row.r.z, cpu: [b, t], gpu: [row.base, row.top] }; } n++;
    }
    check(n > 100 && worst < 0.05, `the GPU grounds ${n} sampled boxes as the CPU's twin does on the drawn ground (worst ${worst.toFixed(3)} m${worst >= 0.05 ? ` ${JSON.stringify(worstRow)}` : ''})`);
    check((s.night?.extra ?? 0) > 300, `the south's night lights after the lake's (${s.night?.extra} of ${s.night?.lights})`);
    await page.close();
  }
  {
    const { page } = await open('start=1200,-1050&heading=251&hour=13&cam=A');
    const b = await page.evaluate(() => window.__velia.stats().buildings);
    check(b?.sets.join() === 'lake', `an Emerald Bay start loads the lake set only (${b?.sets}, ${b?.records} records, ${b?.drawn} drawn)`);
    await page.close();
  }
  {
    const { page, fetched } = await open('start=11800,-875&heading=100&hour=13&profile=form:phone');
    const b = await page.evaluate(() => window.__velia.stats().buildings);
    const got = fetched.filter((u) => /buildings-[a-z]+\.vbd/.test(u) && !u.includes('?import'));   // Vite's dev server resolves the URL as a module (?import&url); the data is the plain path
    check(b == null && !got.length, `a phone: no buildings and no fetch of their files (${got.join(' ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
