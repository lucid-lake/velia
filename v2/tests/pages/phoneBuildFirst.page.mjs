// A phone builds every shader, then presents the modes (owner, 2026-11-17: "For phones, the best experience is to build the shaders,
// then present. Build it that way, and while loading show more info on the phone to hold the user"; src/core/features.js
// buildAllFirst, v2/engine/buildGate.js, v2/ui/buildCard.js). On the real v2 page with an emulated slow compiler (?pipedelay=: one
// pipeline at a time, a wait before each, as iPhone WebKit builds them):
//   - a phone (844 × 390 and 844 × 340, Safari's UA, touch): the first card shows Sail, Cruise and Regatta dimmed (never hidden), the
//     stage line (one of the five words), one percentage that only rises, the slim line, a fact of 60 characters or fewer; the block
//     sits inside the card, overlapping neither a mode button nor the links
//   - a tap on Sail while building is remembered (lit) and enters the moment the build is done; the modes light then
//   - 0 pipelines built after play starts, through 25 s of Sail and a quality step down and back (the sample count holds)
//   - every declared pipeline built before the modes lit
//   - a desktop and an iPad: no gate (the modes start at once, nothing dimmed, no block)
// Run by `npm run test:pages:v2 -- phoneBuildFirst`, or node v2/tests/pages/phoneBuildFirst.page.mjs --base http://127.0.0.1:<port> [--shots <dir>]
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : (process.env.LAKESHORE_SHOTS || null);
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const WORDS = ['Filling the lake', 'Raising the forest', 'Rigging the boat', 'Setting the sails', 'Ready'];
const DELAY = 200;   // ms before each pipeline: 88 × 200 ≈ 17 s of build on this Mac (the card shows only at the build's tail: the hold below)
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });

const cardRead = (page) => page.evaluate(() => {
  const r = document.getElementById('lk-load'), b = r?.querySelector('.lk-bld'), card = r?.querySelector('.lk-card');
  const vis = (n) => { if (!n) return false; const c = getComputedStyle(n); return c.display !== 'none' && c.visibility !== 'hidden' && n.offsetWidth > 0 && n.offsetHeight > 0; };
  const box = (n) => n ? { top: n.offsetTop, h: n.offsetHeight } : null;
  // the phone card (layout A) puts the block bottom-left and the modes in a right column; the links are folded away until "..."
  // opens them. So test real overlap: the block's rectangle against each visible mode button and the links (when shown), and that it sits in the card.
  const rc = (n) => n.getBoundingClientRect();
  const cross = (a, c) => a.left < c.right - 1 && a.right > c.left + 1 && a.top < c.bottom - 1 && a.bottom > c.top + 1;
  const hits = (blk) => { const a = rc(blk), k = rc(card); const bad = [];
    for (const n of card.querySelectorAll('.lk-pick, .lk-links')) if (vis(n) && cross(a, rc(n))) bad.push(n.dataset.mode ?? n.className);
    return { bad, inCard: a.left >= k.left - 1 && a.right <= k.right + 1 && a.top >= k.top - 1 && a.bottom <= k.bottom + 1 }; };
  const picks = [...(r?.querySelectorAll('.lk-card .lk-pick') ?? [])].map((p) => ({ m: p.dataset.mode, on: p.getAttribute('aria-checked') === 'true', op: +getComputedStyle(p).opacity, vis: vis(p), disabled: !!p.disabled }));
  const st = window.__velia?.stats?.();
  const fx = (r?.querySelector('.lk-bld-fx'));
  return { state: r?.dataset.state, build: r?.dataset.build ?? null, queued: r?.dataset.queued ?? null, picks, block: vis(b), stage: r?.querySelector('.lk-bld-st')?.textContent ?? null,
    pc: r?.querySelector('.lk-bld-pc')?.textContent ?? null, fact: fx?.textContent ?? null, factVis: vis(fx), fxSize: fx ? parseFloat(getComputedStyle(fx).fontSize) : null,
    stSize: b ? parseFloat(getComputedStyle(r.querySelector('.lk-bld-st')).fontSize) : null,
    overlap: b ? hits(b) : null,
    gate: st?.pipelines?.gate ?? null, afterPlay: st?.pipelines?.afterPlay ?? null, built: st?.pipelines?.total ?? null, declared: st?.pipelines?.declared ?? null, atReady: st?.pipelines?.atReady ?? null, late: st?.pipelines?.afterFirstFrame ?? null, box: box(b) };
});

async function phone(W, H, { tap = true, shots = '' } = {}) {
  const name = `phone ${W}x${H}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/?hour=13&seed=1&attract=0&pipedelay=${DELAY}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
  // the cold load's hold (ui/loadWords.js): the card stays hidden under the still, the facts and a phone's advice until the
  // card's layout (Sail's UI chunk) arrives, late in the build; the build card's lines show from then on, for the build's tail
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-lk-hold'), null, { timeout: 60000, polling: 50 });
  await page.waitForTimeout(150);
  const a = await cardRead(page);
  check(a.build === 'wait' && a.gate && !a.gate.ready, `${name}: the card is live while the shaders still build (data-build=${a.build}, ${a.gate?.built}/${a.gate?.total})`);
  check(a.picks.length === 3 && a.picks.every((p) => p.vis && !p.disabled && p.op < 0.7), `${name}: Sail, Cruise and Regatta dimmed, not hidden (${a.picks.map((p) => `${p.m} ${p.op.toFixed(2)}`).join(', ')})`);
  check(a.block && WORDS.includes(a.stage), `${name}: the stage line shows the work (${a.stage})`);
  check(/^\d{1,2} %$/.test(a.pc ?? ''), `${name}: one percentage (${a.pc})`);
  check(a.factVis && a.fact && a.fact.length <= 60, `${name}: a fact of 60 characters or fewer (${a.fact})`);
  check(a.stSize >= 15 && a.fxSize >= 15, `${name}: text 15 px or more (stage ${a.stSize}, fact ${a.fxSize})`);
  check(a.overlap && a.overlap.inCard && a.overlap.bad.length === 0, `${name}: the block sits inside the card, clear of the modes and the links (overlaps: ${a.overlap?.bad.join(', ') || 'none'}; in card ${a.overlap?.inCard})`);
  if (shots) await page.screenshot({ path: `${shots}-midload.png` });
  // the percentage only rises while building
  const pcs = [];
  for (let i = 0; i < 6; i++) { const r = await cardRead(page); if (r.gate?.ready) break; pcs.push(parseInt(r.pc, 10)); await page.waitForTimeout(250); }
  check(pcs.every((v, i) => i === 0 || v >= pcs[i - 1]), `${name}: the percentage only rises (${pcs.join(', ')})`);
  if (tap) {
    await page.tap('#lk-load .lk-pick[data-mode=sail]');
    await page.waitForTimeout(150);
    const q = await cardRead(page);
    const stillBuilding = !q.gate?.ready;
    check(!stillBuilding || (q.queued === 'sail' && q.state === 'home' && q.picks.find((p) => p.m === 'sail').on), `${name}: a tap while building is remembered and lit (queued ${q.queued}, state ${q.state})`);
  }
  await page.waitForFunction(() => window.__velia?.stats?.()?.pipelines?.gate?.ready, null, { timeout: 120000 });
  if (!tap) await page.waitForTimeout(700);   // the modes' 0.4 s light-up
  const ready = await cardRead(page);
  check(ready.atReady === ready.declared && ready.built === ready.declared, `${name}: every pipeline built before the modes lit (${ready.atReady} of ${ready.declared})`);
  if (!tap) {
    check(ready.build === 'ready' && ready.stage === 'Ready' && ready.pc === '100 %' && ready.picks.every((p) => p.op > 0.9), `${name}: the modes light, "Ready", 100 % (${ready.picks.map((p) => p.op.toFixed(2)).join(', ')})`);
    if (shots) await page.screenshot({ path: `${shots}-ready.png` });
    await ctx.close(); return;
  }
  await page.waitForFunction(() => { const r = document.getElementById('lk-load'); return !r || r.dataset.state === 'gone' || r.dataset.state === 'out'; }, null, { timeout: 20000 }).catch(() => {});
  const p0 = await cardRead(page);
  check(p0.state === 'out' || p0.state === 'gone', `${name}: the remembered Sail entered the moment the build was done (state ${p0.state})`);
  check(p0.afterPlay === 0, `${name}: 0 pipelines at entry (${p0.afterPlay})`);
  // play: sail, step the quality down and back (a desktop would build the other sample count), sail on
  await page.waitForTimeout(8000);
  await page.evaluate(() => window.__velia.quality?.set?.(2));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__velia.quality?.set?.(1));
  await page.waitForTimeout(13000);
  const p1 = await cardRead(page);
  check(p1.afterPlay === 0 && p1.built === p1.declared, `${name}: 0 pipelines built after play started, through 25 s of Sail and a quality step (${p1.afterPlay}; ${p1.built} built of ${p1.declared})`);
  check(!errors.length, `${name}: no page errors${errors.length ? ` (${errors.slice(0, 2).join(' | ')})` : ''}`);
  await ctx.close();
}

async function noGate(name, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/?hour=13&seed=1&attract=0&pipedelay=${DELAY}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
  await page.waitForTimeout(300);
  const a = await cardRead(page);
  check(a.gate && a.gate.on === false && a.gate.ready && a.build == null && !a.block, `${name}: no build gate (the modes start at once, nothing dimmed, no block)`);
  check(a.picks.every((p) => p.op > 0.9), `${name}: the modes at full (${a.picks.map((p) => p.op.toFixed(2)).join(', ')})`);
  await ctx.close();
}

try {
  await phone(844, 390, { tap: true, shots: SHOTS ? `${SHOTS}/phone-844x390` : '' });
  await phone(844, 340, { tap: false, shots: SHOTS ? `${SHOTS}/phone-844x340` : '' });
  await noGate('desktop 1280x720', { viewport: { width: 1280, height: 720 } });
  await noGate('iPad 1180x820', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA });
} finally { await browser.close(); }
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
