// BACKLOG-v2 #31, MSAA live, on the real v2 page:
//   - every scene pipeline is declared at MSAA 4 and 1; the load builds the start count only; the other set builds in the
//     background (the hook's prebuild, as a live page does after the ladder's settle) with no frame over 50 ms
//   - a live level step across MSAA (L0 → L2 → L0) switches the scene's count between two frames: no error, no frame over
//     50 ms, the switch frame's own ms recorded, 0 pipelines built synchronously after the first frame
//   - a step whose set is not built yet keeps the scene's count, builds async, then switches by itself (a desktop)
//   - a phone (build-first, f1d454c2, 2026-11-17: every pipeline before play, none in play) holds its start count through a
//     live step and builds nothing more; the stored level's count comes with the next load
//   - a live page with the ladder on builds the other set once the settle is in (a desktop; a phone builds none in play);
//     a capture keeps one count (the goldens)
// Run by `npm run test:pages:v2`, or node v2/tests/pages/msaaLive.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const ready = (p) => p.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
const LIMIT = 50;   // ms: no frame over this through a background build or a switch

// the page's rAF intervals from now (a ring the test reads back), started after the page settles its first seconds
const watch = (p) => p.evaluate(() => { const w = { dts: [], last: null, on: true }; window.__msaaWatch = w; const f = (t) => { if (w.last != null) w.dts.push(t - w.last); w.last = t; if (w.on) requestAnimationFrame(f); }; requestAnimationFrame(f); });
const read = (p) => p.evaluate(() => { const w = window.__msaaWatch; const d = w.dts.splice(0); const f = window.__velia.frames, drawn = f - (w.f0 ?? f); w.f0 = f; return { n: d.length, drawn, max: d.length ? Math.max(...d) : 0, over: d.filter((x) => x > 50).length }; });

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // a desktop pinned at L0 (MSAA 4): the 1× set in the background, then L2 and back, live
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1&quality=0`, { waitUntil: 'load' }); await ready(p);
    await p.waitForTimeout(3000);   // the first seconds' streams
    const a = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state }));
    check(a.st.msaa === 4 && a.q.msaa.ready[4] === true && a.q.msaa.ready[1] === false && a.st.pipelines.perCount > 30,
      `the load built MSAA 4 only: ${a.st.pipelines.total} pipelines, ${a.st.pipelines.perCount} scene pipelines per count, counts ${a.st.pipelines.counts}, ready ${JSON.stringify(a.q.msaa.ready)}`);
    await watch(p);
    const b = await p.evaluate(async () => { const t = performance.now(); await window.__velia.quality.prebuild(); return { ms: performance.now() - t, q: window.__velia.quality.state.msaa, st: window.__velia.stats() }; });
    await p.waitForTimeout(300);
    const fb = await read(p);
    check(b.q.ready[1] === true && b.q.background[1]?.n === a.st.pipelines.perCount, `the 1× set built in the background: ${b.q.background[1]?.n} pipelines in ${b.ms.toFixed(0)} ms`);
    check(fb.max <= LIMIT, `no frame over ${LIMIT} ms while it built (${fb.n} frames, worst ${fb.max.toFixed(1)} ms)`);
    check(b.st.pipelines.afterFirstFrame === 0 && b.st.errors.length === 0, `0 built synchronously, no error (${b.st.errors.join('; ')})`);
    for (const [k, m] of [[2, 1], [0, 4]]) {
      await p.waitForTimeout(800); await read(p);
      await p.evaluate((k) => window.__velia.quality.set(k), k);
      await p.waitForTimeout(1500);
      const fr = await read(p);
      const r = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state, text: document.getElementById('diag').textContent }));
      const sw = r.q.msaa.switches.at(-1);
      check(r.st.msaa === m && r.q.level === k && sw?.to === m, `L${k}: the scene draws at MSAA ${r.st.msaa} (switch ${JSON.stringify(sw)})`);
      check(fr.max <= LIMIT && Math.abs(fr.drawn - fr.n) <= 1, `L${k}: no frame over ${LIMIT} ms, none lost (${fr.n} intervals, ${fr.drawn} frames drawn, worst ${fr.max.toFixed(1)} ms)`);
      check(sw && sw.cpuMs != null && sw.dtMs != null && sw.dtMs <= LIMIT, `L${k}: the switch frame: targets remade in ${sw?.ms} ms, its frame ${sw?.cpuMs} ms of CPU, ${sw?.dtMs} ms interval, GPU work ${sw?.gpuMs} ms (the frame before ${sw?.gpuBeforeMs} ms)`);
      check(r.st.pipelines.afterFirstFrame === 0 && r.st.errors.length === 0, `L${k}: 0 built synchronously, no error (${r.st.errors.join('; ')})`);
      check(new RegExp(`MSAA ${m}(?! →)`).test(r.text) && !r.q.pending.some((x) => /MSAA/.test(x)), `L${k}: the panel reads MSAA ${m}, nothing waits for a reload (${r.q.pending.join(', ') || 'none pending'})`);
    }
    // the switch frame is drawn: the canvas is not black after it
    const shot = await p.screenshot();
    check(shot.length > 20000, `the frame after the switches is drawn (${shot.length} B png)`);
    await p.close();
  }

  // a desktop pinned at L2 (MSAA 1): a step to L0 before the 4× set is built keeps MSAA 1, builds it, then switches by itself.
  // (A desktop since f1d454c2, 2026-11-17: a phone builds every pipeline before play and holds its start count; checked below.)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1&quality=2`, { waitUntil: 'load' }); await ready(p);
    await p.waitForTimeout(3000);
    await watch(p);
    const a = await p.evaluate(() => { window.__velia.quality.set(0); const q = window.__velia.quality.state.msaa; return { q, msaa: window.__velia.stats().msaa }; });
    check(a.msaa === 1 && a.q.want === 4 && a.q.ready[4] === false && a.q.background[4]?.building === true, `a step to L0 wants MSAA 4; the scene keeps MSAA 1 while it builds (${JSON.stringify(a.q.background)})`);
    await p.waitForFunction(() => window.__velia.stats().msaa === 4, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state.msaa }));
    const fr = await read(p);
    check(r.st.msaa === 4 && r.q.switches.at(-1)?.to === 4, `built, then switched by itself: MSAA ${r.st.msaa} (${r.q.background[4]?.n} pipelines in ${r.q.background[4]?.ms} ms; switch ${r.q.switches.at(-1)?.ms} ms)`);
    check(fr.max <= LIMIT && r.st.errors.length === 0 && r.st.pipelines.afterFirstFrame === 0, `no frame over ${LIMIT} ms (worst ${fr.max.toFixed(1)} of ${fr.n}), no error, 0 built synchronously`);
    await ctx.close();
  }

  // a phone pinned at L2 (MSAA 1): a live step to L1 keeps MSAA 1 and builds nothing (no build in play), no error
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1&quality=2`, { waitUntil: 'load' }); await ready(p);
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__velia.quality.set(1));
    await p.waitForTimeout(3000);
    const r = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state }));
    check(r.q.level === 1 && r.st.msaa === 1 && r.q.msaa.want === 1 && Object.keys(r.q.msaa.background).length === 0 && r.q.msaa.switches.length === 0 && r.st.errors.length === 0 && r.st.pipelines.afterFirstFrame === 0,
      `a phone's live step to L1 holds MSAA ${r.st.msaa} (want ${r.q.msaa.want}), builds nothing (${JSON.stringify(r.q.msaa.background)}), no error`);
    await ctx.close();
  }

  // a live page with the ladder on: the other set builds by itself once the settle is in (a desktop); a live phone builds none
  for (const [name, o, both] of [['a desktop', { viewport: { width: 1280, height: 720 } }, true], ['a phone', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, false]]) {
    const ctx = await browser.newContext(o);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?hour=13&seed=1&diag=1`, { waitUntil: 'load' }); await ready(p);
    await p.waitForFunction(() => window.__velia.quality.state.ladder.phase === 'settled', null, { timeout: 30000 }).catch(() => {});
    if (both) await p.waitForFunction(() => { const m = window.__velia.quality.state.msaa; return m.ready[1] && m.ready[4]; }, null, { timeout: 60000 }).catch(() => {});
    else await p.waitForTimeout(4000);
    const q = await p.evaluate(() => ({ q: window.__velia.quality.state, st: window.__velia.stats() }));
    const built = q.q.msaa.counts.filter((n) => q.q.msaa.ready[n]);
    const ok = both ? built.length === 2 : built.length === 1 && built[0] === q.st.msaa && Object.keys(q.q.msaa.background).length === 0;
    check(q.q.ladder.phase === 'settled' && ok && q.st.errors.length === 0, `${name}, after the settle (${q.q.ladder.why}): ${both ? 'both counts' : 'its start count only'} built (${JSON.stringify(q.q.msaa.ready)}, ${JSON.stringify(q.q.msaa.background)}), no error`);
    await ctx.close();
  }

  // a capture keeps one count: nothing more declared, nothing built later (the goldens)
  {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await p.goto(`${BASE}/?hour=13&seed=1&headless=1`, { waitUntil: 'load' }); await ready(p);
    const r = await p.evaluate(() => ({ st: window.__velia.stats(), q: window.__velia.quality.state.msaa }));
    check(JSON.stringify(r.st.pipelines.counts) === '[4]' && r.st.msaa === 4 && Object.keys(r.q.background).length === 0, `a capture: MSAA 4 only (counts ${JSON.stringify(r.st.pipelines.counts)}), no background build`);
    await p.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
