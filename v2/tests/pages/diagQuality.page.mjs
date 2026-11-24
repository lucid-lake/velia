// The phone pass on the real v2 page: ?diag=1 and ?quality=.
//   - no ?diag: no panel; ?diag=1: one navy-glass panel in the top-left corner, cream text ≥ 15 px, under 4 updates a second,
//     every line the owner sends back (fps, frame ms, GPU ms, the quality and why, the backing and DPR, the adapter, the UA, errors)
//   - ?quality=0|1|2 pins the level: its caps on the backing (1.2 Mpx, 0.7 Mpx at a DPR-3 phone), MSAA, the shadow's cadence,
//     the forest's reach; 0 pipelines after the first frame at each; a capture without ?quality is L0
//   - a live level step (the hook's set) changes the caps live; a phone holds its MSAA (build-first, 2026-11-17: no build in
//     play; a desktop's live switch is msaaLive's), lists the cloud key and the boat's shadow as pending, builds nothing synchronously
//   - the settled level is stored: a second visit starts from it
//   - a pipeline failure shows the card (not a black screen) and the failing pipeline's name in the panel
// Run by `npm run test:pages:v2`, or node v2/tests/pages/diagQuality.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const ready = (p) => p.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // no ?diag: no panel; a capture is L0
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await p.goto(`${BASE}/?hour=13&seed=1&headless=1`, { waitUntil: 'load' }); await ready(p);
    const r = await p.evaluate(() => ({ panel: !!document.getElementById('diag'), q: window.__velia.stats().quality, msaa: window.__velia.stats().msaa }));
    check(!r.panel, 'no ?diag: no panel');
    check(r.q.level === 0 && r.q.source === 'headless' && r.msaa === 4, `a capture without ?quality is L0, MSAA 4 (${r.q.name}, ${r.q.source})`);
    await p.close();
  }
  // each level pinned on a DPR-3 phone, upright: the caps, MSAA, the panel
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const expect = [{ px: 780 * 1688, msaa: 4, every: 4 }, { px: 1.2e6, msaa: 4, every: 8 }, { px: 0.95e6, msaa: 1, every: 12 }, { px: 0.6e6, msaa: 1, every: 24 }];   // perf(v2) phone 30 fps: a live phone's L2 and L3 (MOBILE30_CAPS)
  for (const k of [0, 1, 2, 3]) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1&quality=${k}`, { waitUntil: 'load' }); await ready(p);
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      const st = window.__velia.stats(), el = document.getElementById('diag'), cs = el && getComputedStyle(el), b = el?.getBoundingClientRect();
      return { st, t: performance.now(), text: el?.textContent ?? '', font: cs ? parseFloat(cs.fontSize) : 0, bg: cs?.backgroundColor, color: cs?.color, box: b && { x: b.x, y: b.y, w: b.width, h: b.height }, iw: innerWidth, pe: cs?.pointerEvents,
        updates: window.__velia.diag.stats.updates, every: window.__velia.tshadow.every, reach: window.__velia.forest?.L.far, q: window.__velia.quality.state };
    });
    const px = r.st.size[0] * r.st.size[1];
    check(r.st.quality.level === k && r.st.quality.source === 'pinned', `?quality=${k}: level ${r.st.quality.name} (${r.st.quality.source})`);
    check(Math.abs(px - expect[k].px) / expect[k].px < 0.01, `L${k}: backing ${r.st.size.join('×')} = ${(px / 1e6).toFixed(2)} Mpx (expect ${(expect[k].px / 1e6).toFixed(2)})`);
    check(r.st.msaa === expect[k].msaa && r.every === expect[k].every, `L${k}: MSAA ${r.st.msaa}, terrain shadow every ${r.every}th frame, forest far ${Math.round(r.reach)} m`);
    check(r.st.pipelines.afterFirstFrame === 0, `L${k}: ${r.st.pipelines.total} pipelines, 0 after the first frame`);
    check(r.st.quality.ladder.phase === 'off', `L${k}: pinned, the ladder is off (${r.st.quality.ladder.phase})`);
    if (k === 1) {
      const lines = ['fps ', 'frame ', 'GPU ', `quality L1`, 'pinned: ?quality=1', 'backing ', 'DPR 3 (cap 2)', 'adapter ', 'UA ', 'errors'];
      const miss = lines.filter((l) => !r.text.includes(l));
      check(!miss.length, `the panel shows every line (missing: ${miss.join(', ') || 'none'})\n${r.text.split('\n').map((l) => '      | ' + l).join('\n')}`);
      check(/GPU (work )?\d+\.\d+ ms avg/.test(r.text), 'the GPU ms with timestamps (?diag asks for the timer; fix(v2) governor: the work)');
      check(r.font >= 15 && r.bg.startsWith('rgba(28, 35, 64') && r.color.startsWith('rgba(243, 231, 200'), `navy glass, cream ${r.font} px text (${r.bg}, ${r.color})`);
      check(/memory GPU ≈ \d+ MB/.test(r.text), 'the GPU memory line');
      // #54: the rate over a timed 1.5 s window, not the count since the panel came up (a loaded Mac takes longer to be ready)
      await p.waitForTimeout(1500);
      const u1 = await p.evaluate(() => ({ updates: window.__velia.diag.stats.updates, t: performance.now() }));
      const du = u1.updates - r.updates, dt = (u1.t - r.t) / 1000;
      await p.tap('#diag'); await p.waitForTimeout(100);
      const mini = await p.evaluate(() => document.getElementById('diag').textContent.split('\n'));
      check(mini.length === 4 && /^fps/.test(mini[0]) && /^GPU/.test(mini[1]) && /^quality/.test(mini[2]) && /^errors/.test(mini[3]), `a tap folds it to four lines: fps, GPU, the level, the errors (${mini.join(' | ')})`);
      await p.tap('#diag'); await p.waitForTimeout(100);
      check((await p.evaluate(() => document.getElementById('diag').textContent.split('\n').length)) > 8, 'a second tap opens it');
      // the page's frame is 844 × 390 (phones are landscape-only: an upright phone shows the landscape page turned on its side)
      check(r.box.x <= 16 && r.box.y < 140 && r.box.x + r.box.w <= r.iw, `in the top-left corner, on screen (${JSON.stringify(r.box)} in ${r.iw} px)`);
      check(du <= Math.ceil(dt * 4) + 1, `≤ 4 updates a second (${du} in ${dt.toFixed(2)} s; ${r.updates} since the panel came up)`);
    }
    await p.close();
  }
  await ctx.close();

  // a live level step: the caps now, a phone's MSAA held, the cloud key pending, nothing built synchronously
  {
    const p = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1&quality=0`, { waitUntil: 'load' }); await ready(p);
    await p.waitForTimeout(800);
    await p.evaluate(() => window.__velia.quality.set(2));
    await p.waitForTimeout(2000);
    const r = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state.msaa, text: document.getElementById('diag').textContent, every: window.__velia.tshadow.every }));
    const px = r.st.size[0] * r.st.size[1];
    check(r.st.quality.level === 2 && Math.abs(px - 0.95e6) / 0.95e6 < 0.01 && r.every === 12, `a live step to L2: backing ${r.st.size.join('×')}, shadow every ${r.every}`);
    // a phone builds every pipeline before play and none in play (f1d454c2, 2026-11-17): it holds its start count, MSAA 4, with no
    // background build; the stored level's count comes with the next load (a desktop's live switch: msaaLive.page.mjs)
    check(r.st.msaa === 4 && r.q.want === 4 && Object.keys(r.q.background).length === 0 && JSON.stringify(r.st.quality.pending) === JSON.stringify(['cloud key 1024×256', 'boat shadow 1024²']) && /next load: cloud key/.test(r.text) && /MSAA 4(?! →)/.test(r.text),
      `a phone holds MSAA ${r.st.msaa} live (no build in play); the cloud key and the boat's shadow wait for the next load (${r.st.quality.pending.join(', ')})`);
    check(r.st.pipelines.afterFirstFrame === 0 && r.st.errors.length === 0, `no pipeline built synchronously, no error (${r.st.errors.join('; ')})`);
    await p.close();
  }

  // the settled level is stored and the next visit starts from it (a live page with the ladder on: the governor's settle)
  {
    const c = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1`, { waitUntil: 'load' }); await ready(p);
    await p.waitForFunction(() => window.__velia.quality.state.ladder.phase === 'settled', null, { timeout: 30000 }).catch(() => {});
    const a = await p.evaluate(() => ({ q: window.__velia.quality.state, stored: localStorage.getItem('velia.v2.quality') }));
    check(a.q.ladder.phase === 'settled' && !!a.stored, `the ladder settles in the first seconds and stores it (${a.q.why}; ${a.stored})`);
    await p.reload({ waitUntil: 'load' }); await ready(p);
    const b = await p.evaluate(() => window.__velia.quality.state);
    check(b.source === 'stored' && b.level === JSON.parse(a.stored).level, `the next visit starts from the stored level (L${b.level}, ${b.source})`);
    await c.close();
  }

  // #32, the forced no-timer mode (?timer=0: Safari or iOS without timestamp-query): an iPhone's guess boots at L1 (perf(v2) phone
  // 30 fps); the limiter's 33.3 ms interval says nothing of the GPU, the work-done probe's busy span steps the settle up one level
  // on this Mac; the panel shows the probe's span; the stored decision is marked as a no-timer one
  {
    const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const c = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
    const p = await c.newPage();
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1&timer=0`, { waitUntil: 'load' }); await ready(p);
    await p.waitForFunction(() => window.__velia.quality.state.ladder.phase === 'settled', null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state, text: document.getElementById('diag').textContent, stored: localStorage.getItem('velia.v2.quality') }));
    const stored = r.stored ? JSON.parse(r.stored) : null;
    check(r.st.timestamps === false && r.q.source === 'guess' && r.q.steps[0]?.from === 1, `no GPU timer, an iPhone's guess at L1 (${r.st.timestamps}, ${r.q.startWhy})`);
    check(r.q.busy?.span > 0 && r.q.busy.span < 16.7 && /GPU ≈ \d+\.\d ms \(work-done probe; no timestamp-query\)/.test(r.text), `the work-done probe reads a busy span under the vsync (${r.q.busy?.span?.toFixed(2)} ms over ${r.q.busy?.count}; the panel: ${r.text.split('\n').find((l) => l.startsWith('GPU'))})`);
    check(r.q.level === 0 && /work-done probe; no GPU timer\) at L1/.test(r.q.ladder.why), `the settle steps up on it: L1 → L${r.q.level} (${r.q.ladder.why}; the frame interval ${r.q.ladder.lastMean} ms)`);
    check(stored?.measured?.vsync === true && stored.level === r.q.level, `stored as a no-timer decision (${r.stored})`);
    await c.close();
  }

  // a pipeline failure: the card, never a black screen; the pipeline's name in the panel (the plain tonemap: built before the first
  // frame on every page; the storm's variants are built after it, perf(v2) iOS pipelines)
  {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p.addInitScript(() => {
      const orig = GPUDevice.prototype.createRenderPipelineAsync;
      GPUDevice.prototype.createRenderPipelineAsync = function (d) { if (d?.label === 'tonemap-plain') return Promise.reject(new Error('injected: Safari refused the module')); return orig.call(this, d); };
    });
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1`, { waitUntil: 'load' });
    await p.waitForFunction(() => !document.getElementById('nogpu').hidden, null, { timeout: 120000 });
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => { const c = document.getElementById('nogpu'), cs = getComputedStyle(c); return { kind: c.dataset.kind, msg: c.querySelector('[data-msg]').textContent, link: c.querySelector('a')?.href, why: c.querySelector('[data-why]').textContent, bg: cs.backgroundColor, diag: document.getElementById('diag')?.textContent ?? '' }; });
    check(r.kind === 'failed' && /could not start/.test(r.msg) && /\/classic\/$/.test(r.link) && r.bg !== 'rgb(0, 0, 0)', `the card links the classic Velia (${r.msg} → ${r.link}; ${r.bg})`);   //: the launch gate's page
    check(/pipeline "tonemap-plain"/.test(r.why) && /pipeline "tonemap-plain" failed/.test(r.diag) && /injected: Safari refused/.test(r.diag), `the failing pipeline's name and message in the card and the panel (${r.why})`);
    await p.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
