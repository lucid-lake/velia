// The world audit's S2 rows on the live v2 page (2026-11-14): the wiring the node tests cannot
// see. Two loads at 1280 × 720:
//   storm (10:00, stormt=150, birds on): the birds shelter (L1: shelter 1, no airborne bird left after 10 s of their film
//     clock; before the fix shelter 0 and 15 in the air), the kayak fleet wants v1's 2 (L2; before: 5), the landmarks and
//     the five flags in, each flag flying downwind of the local wind (G1, G2; before: none)
//   night (21:30 on July 4th, the deck pose): the red bow light's halo at v1's size (A1: ≥ 40 red pixels; before: 5), the
//     show's props solid (L3; before: no solids), and moored to a ball the pennant drawn (A2; before: none)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/worldAudit.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${q}&seed=1&hud=0&headless=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  return { page, errors };
}
try {
  {
    const { page, errors } = await open('mode=sail&hour=10&weather=storm&stormt=150&birds=1&regionkayaks=0')   // L2 checks v1's day fleet; the region kayaks (2026-11-19) replace it on a desktop and go home in a storm;
    const r = await page.evaluate(async () => {
      const h = window.__velia;
      for (let i = 0; i < 4; i++) await h.renderOnce();
      const s = h._stats(), F = h.landmarks.flags, W = h.boat.wind;
      const flags = h.landmarks.sites.map((site, i) => { const f = F.flight(i), w = W.sample(site.x, site.z, h.clock.t); return { name: site.name, dot: f.fx * w.vx / w.speed + f.fz * w.vz / w.speed }; });
      const out = { want: s.kayaks.want, landmarks: s.landmarks, shelter0: h.birds.sim.shelter, flags };
      for (let i = 0; i < 600; i++) await h.birds.frame(1 / 60);
      out.shelter = h.birds.sim.shelter;
      out.airborne = h.birds.sim.birds.filter((b) => b.fade > 0.02 && b.mode !== 'perch' && b.mode !== 'raft').length;
      return out;
    });
    await page.close();
    check(!errors.length, `storm: no page errors (${errors.slice(0, 2).join(' | ')})`);
    check(r.shelter0 === 1 && r.shelter === 1, `L1: the birds shelter in the storm's rain (shelter ${r.shelter0} → ${r.shelter}; before 0)`);
    check(r.airborne === 0, `L1: no bird left in the air after 10 s (${r.airborne}; before 15)`);
    check(r.want === 2, `L2: the kayak fleet wants v1's 2 at 10:00 in the storm (${r.want}; before 5)`);
    check(r.landmarks.ready && r.landmarks.parts.solid > 300 && r.landmarks.parts.blend > 40, `G1: the ruin, the house and the waterfall drawn (${JSON.stringify(r.landmarks.parts)})`);
    check(r.flags.length === 5 && r.flags.every((f) => f.dot > 0.95), `G2: five flags, each flown downwind of its local wind (${r.flags.map((f) => f.dot.toFixed(3)).join(', ')})`);
  }
  {
    const { page, errors } = await open('mode=sail&hour=21.5&settle=5&camyaw=135&camdist=3&timerate=0');
    const r = await page.evaluate(async () => {
      const h = window.__velia;
      for (let i = 0; i < 40; i++) await h.renderOnce();
      return { fw: h.fireworks?.stats?.() ?? null, solids: h.fireworks?.solids?.bodies?.filter((b) => b.on).length ?? 0 };
    });
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
    let red = 0;
    for (let y = 300; y < 650; y++) for (let x = 300; x < 900; x++) { const i = (y * png.width + x) * 4, R = png.data[i], G = png.data[i + 1], B = png.data[i + 2]; if (R > G + 40 && R > B + 20) red++; }
    const m = await page.evaluate(async () => {
      const h = window.__velia, S = h.sea, st = h.boat.state, tk = S.tackle, b = tk.bow(st);
      const ball = { x: b[0] + Math.sin(st.heading) * 2.5, z: b[1] - Math.cos(st.heading) * 2.5 };
      S.setPiers(tk.piers, [ball]); st.u = 0; st.v = 0; st.sog = 0;
      const ok = S.tackle.moor(st).ok;
      for (let i = 0; i < 10; i++) await h.renderOnce();
      return { ok, pennant: h.boat.sim.pose.pennant?.length ?? 0 };
    });
    await page.close();
    check(!errors.length, `night: no page errors (${errors.slice(0, 2).join(' | ')})`);
    check(red >= 40, `A1: the red bow light's halo at v1's size (${red} red pixels; v1 148, before 5)`);
    check(r.fw?.solid === true && r.solids === 6, `L3: the barges, tugs and patrol boats solid in their evening (${r.solids} bodies on, solid ${r.fw?.solid})`);
    check(m.ok && m.pennant === 8, `A2: moored, the pennant's 8 points drawn (${m.pennant})`);
  }
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
