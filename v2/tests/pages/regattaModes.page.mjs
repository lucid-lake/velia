// Regatta step C on a live v2 page (owner 2026-11-17: match race, time trial, pursuit; the Emerald Cup left the hub on
// 2026-11-20,'s hub: select, then go):
//   1280 × 720   the hub has no Cup block; Custom's Race type row picks a match race: one rival, the chip "Match · 1 v 1" before the start and
//                "Ahead 12 m" / "Behind 8 m" after it, the 1 v 1 results card; a time trial: alone, its best kept, the next run's ghost and a
//                split at each mark; a pursuit: the chip counts down to her own start
//   844 × 390    a sideways phone: the hub with nothing off the screen, text ≥ 15 px, 44 px targets, no scroll; a match race's chip top centre
// The player's boat is sailed by ?autoplay (the fleet's own mind at &autotier); the hub is opened over it with enter({ hub }).
// Run by `npm run test:pages:v2 -- regattaModes`, or node v2/tests/pages/regattaModes.page.mjs --base http://127.0.0.1:<port>
// [--shots <dir>]: the evidence stills (the hub with the Cup card, a match start and a cover, the standings and the podium, a split,
// the pursuit's order)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { newCup, recordRace, CUP, CUP_KEY } from '../../regatta/cup.js';
import { SETUP_KEY, DEFAULT_SETUP, DEFAULT_CUSTOM } from '../../regatta/setup.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const PHONE = { deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
// the stored race settings and Cup the page opens with
const setupFor = (custom, o = {}) => JSON.stringify({ ...DEFAULT_SETUP, skill: 'hard', aids: 'club', ...o, useCustom: !!custom, custom: { ...DEFAULT_CUSTOM, ...(custom ?? {}) } });
async function open({ viewport = { width: 1280, height: 720 }, extra = {}, store = {}, query = '' } = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(([s, kv]) => { try { if (sessionStorage.getItem('rgm')) return; sessionStorage.setItem('rgm', '1'); localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } catch { /* blocked */ } }, [SEEN, store]);
  await page.goto(`${BASE}/?mode=regatta&once=0&seed=1&handseed=7&autoplay=1&autotier=medium${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 20, null, { timeout: 240000 });
  // the hub over the race (the URL's autoplay skips it): leave and enter by the front door
  await page.evaluate(async () => { const r = window.__velia.regatta.r; r.leave(); await r.enter({ hub: true, deal: true }); });
  await page.waitForTimeout(1200);
  return { page, errors };
}
// the hub's Custom race, as its sheet's Race › sends it (the sheet itself is regattaCustom's)
const goCustom = (page) => page.evaluate(() => window.__velia.regatta.r.raceCustom());
const st = (page) => page.evaluate(() => {
  const r = window.__velia.regatta.r, S = r?.session, q = (s) => document.querySelector(s);
  const txt = (s) => q(s)?.textContent?.trim() ?? null, vis = (s) => { const e = q(s); if (!e) return false; const cs = getComputedStyle(e), b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && !e.closest('[hidden]'); };
  return { hub: !!r?.hubOpen, event: r?.hand?.event ?? null, cupI: r?.hand?.cup?.i ?? null, cupN: r?.cup?.results?.length ?? null, cupId: r?.cup?.id ?? null, rivals: S?.rivals?.length ?? null, clock: r?.on ? r.state().clock : null,
    status: r?.on ? r.state().me?.status : null, chip: txt('#rg .fleet .h'), result: r?.stats?.result ? { ...r.stats.result } : null, splits: r?.stats?.splits ?? [], trialBest: r?.stats?.trial?.best ?? null, draw: r?.trial?.draw?.length ?? 0,
    cover: S?.rivals?.[0]?.brain?.coverWhy ?? null, coverTacks: S?.rivals?.[0]?.brain?.coverTacks ?? 0, slots: S?.slots ?? null, pursuit: r?.stats?.pursuit?.text ?? null,
    cupCard: { k: txt('#rgh .cupc .k'), go: txt('#rgh .cupgo'), shown: vis('#rgh .cupc'), row: txt('#rgh .cupr .t'), rowShown: vis('#rgh .cupr') }, l2: txt('#rgh .hand .l2'), handK: txt('#rgh .hand .k'),
    res: { shown: vis('#rg .res'), pn: txt('#rg .res .pn'), gp: txt('#rg .res .gp'), tm: txt('#rg .res .tm'), next: vis('#rg .res .next') ? txt('#rg .res .next') : null, again: vis('#rg .res .again'), rows: document.querySelectorAll('#rg .res .cup tr').length, pod: vis('#rg .res .pod') ? document.querySelectorAll('#rg .res .pod > div').length : 0, podMe: !!q('#rg .res .pod .me') || !!q('#rg .res .cup tr.me') } };
});
// sail on (the page's own sim, in chunks) until a test is true, or maxS of game time
const sailUntil = (page, fn, maxS = 700, chunk = 5) => page.evaluate(async ([src, maxS, chunk]) => {
  const r = window.__velia.regatta.r, f = new Function('r', `return (${src})(r)`);
  for (let s = 0; s < maxS && !f(r); s += chunk) { r.settle(chunk); await new Promise((ok) => requestAnimationFrame(() => ok())); }
  return f(r);
}, [fn.toString(), maxS, chunk]);
// the results card, painted on the next frame. A race can run to its time limit, then the card says DNF; the limit grows with the
// laid course (regatta/geometry.js TIME_LIMIT: the Cup's Twice Round is 1800 s), so sail to that limit plus 30 s, not a fixed 1000 s
const toCard = async (page) => {
  const maxS = await page.evaluate(() => { const r = window.__velia.regatta.r; return Math.ceil((r.course?.timeLimitS ?? 900) - Math.min(0, r.state().clock ?? 0) + 30); });
  const ok = await sailUntil(page, (r) => !!r.stats.result, maxS);
  await page.waitForSelector('#rg .res:not([hidden])', { timeout: 10000 }).catch(() => {});
  return ok;
};
// the hub's layout: every shown piece inside the frame, the smallest text, the buttons' height, no scroll
const layout = (page) => page.evaluate(() => {
  const vis = (e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !e.closest('[hidden]') ? r : null; };
  const pieces = [...document.querySelectorAll('#rgh .col > *, #rgh .col .rr > *, #rgh .col .rr2 > *, #rgh .cupc > *, #rgh .board, #rgh .hand > *')].map((e) => [e.className || e.tagName, vis(e)]).filter(([, r]) => r);
  const W = innerWidth, H = innerHeight, out = pieces.filter(([, r]) => r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5).map(([c, r]) => `${c} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
  let minPx = 99; for (const e of document.querySelectorAll('#rgh *')) { if (!vis(e) || [...e.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue; minPx = Math.min(minPx, parseFloat(getComputedStyle(e).fontSize)); }
  const btns = [...document.querySelectorAll('#rgh .go, #rgh .row, #rgh .cupgo')].map(vis).filter(Boolean);
  const boxes = pieces.filter(([c]) => /row|cupc/.test(String(c))).map(([, r]) => r), overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
  return { W, H, out, minPx, minBtn: Math.min(...btns.map((r) => r.height)), overlap, scroll: document.documentElement.scrollHeight > H + 1 };
});
const resFits = (page) => page.evaluate(() => { const r = document.querySelector('#rg .res').getBoundingClientRect(), e = document.querySelector('#rg .res'); return { ok: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && e.scrollHeight <= e.clientHeight + 1, box: [r.left, r.top, r.right, r.bottom].map(Math.round) }; });
// a Cup stored at race 4 of 4 (three races sailed)
const cupAt4 = () => { let c = newCup(31, { ...DEFAULT_SETUP, skill: 'hard', aids: 'club' }); const order = (k) => Object.fromEntries(CUP.ids.map((id, i) => [id, ((i + k) % 6) + 1])); for (const k of [1, 0, 2]) c = recordRace(c, order(k)); return JSON.stringify(c); };

try {
  // ---------------- 1280 × 720: the hub's Cup card; a match race picked on Custom's Race type row ----------------
  {
    const { page, errors } = await open({ store: { [SETUP_KEY]: setupFor(null) } });
    const a = await st(page), L = await layout(page);
    check(a.hub && !a.cupCard.shown && !a.cupCard.rowShown, 'the hub has no Emerald Cup block (select, then go)');
    check(!L.out.length && L.minPx >= 15 && !L.scroll && !L.overlap, `1280 × 720: the hub inside the frame, text ≥ 15 px (${L.minPx}), no overlap, no scroll (${L.out.join('; ') || 'ok'})`);
    // Custom › Race type › Match 1 v 1 › Race
    await page.click('#rgh .cusr'); await page.waitForTimeout(300);
    await page.click('#rgh .cus .r[data-row=event] > .val'); await page.waitForTimeout(200);
    const opts = await page.$$eval('#rgh .cus [data-dial=event] [data-v]', (b) => b.map((x) => x.textContent));
    await page.click('#rgh .cus [data-dial=event] [data-v=match]'); await page.click('#rgh .cus .r[data-row=event] .pick-x'); await page.waitForTimeout(200);
    const rows = await page.$$eval('#rgh .cus .r', (r) => r.map((x) => x.dataset.row));
    check(opts.join('|') === 'Fleet race|Match 1 v 1|Time trial|Pursuit' && !rows.includes('rivals'), `the Race type row (${opts.join(', ')}); Rivals steps aside for a match`);
    await page.click('#rgh .cus .race'); await page.waitForTimeout(800);
    const b = await st(page);
    check(!b.hub && b.event === 'match' && b.rivals === 1 && b.chip === 'Match · 1 v 1', `a match race: one rival, the chip "${b.chip}" before the start`);
    await page.waitForTimeout(1500); await shot(page, 'match-start-desktop');
    await sailUntil(page, (r) => r.state().clock > 20 && r.state().me.status === 'racing', 120, 1);
    await page.waitForTimeout(400);
    const c = await st(page);
    check(/^(Ahead|Behind) \d+ m$|^Level$/.test(c.chip ?? ''), `racing: the chip "${c.chip}"`);
    // a cover: sail on until the rival holds or takes the player's tack (ahead upwind), then a still
    const covered = await sailUntil(page, (r) => !!r.session.rivals[0].brain.coverWhy && Math.hypot(r.session.rivals[0].phys.state.x - window.__velia.boat.state.x, r.session.rivals[0].phys.state.z - window.__velia.boat.state.z) < 120, 240, 1).catch(() => false);
    const cv = await st(page);
    console.log(`  (the rival ${covered ? `covers: ${cv.cover}` : 'did not need to cover on this run'}; cover tacks ${cv.coverTacks}; chip ${cv.chip})`);
    if (covered) { await page.waitForTimeout(500); await shot(page, 'match-cover-desktop'); }
    await toCard(page); await page.waitForTimeout(600);
    const d = await st(page);
    check(d.res.shown && /^(You win the match|Osprey wins the match)$/.test(d.res.pn) && /^By \d+\.\d s$|still racing$/.test(d.res.gp ?? ''), `the 1 v 1 card: "${d.res.pn}" · "${d.res.gp}"`);
    await shot(page, 'match-result-desktop');
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- 1280 × 720: a time trial (best, ghost, splits) ----------------
  {
    const { page, errors } = await open({ store: { [SETUP_KEY]: setupFor({ event: 'trial', course: 'harbour-dash', length: 'short', wind: 3, shifts: 'steady' }) } });
    const a = await st(page);
    check(a.hub, 'the hub is open over the stored Custom time trial');
    await goCustom(page); await page.waitForTimeout(800);
    const b = await st(page);
    check(b.rivals === 0 && b.chip === 'Time trial', `alone on the course, the chip "${b.chip}"`);
    await toCard(page); await page.waitForTimeout(600);
    const c = await st(page);
    check(/^Time \d+:\d\d\.\d$/.test(c.res.pn ?? '') && /First time round/.test(c.res.gp ?? ''), `the first run: "${c.res.pn}" · "${c.res.gp}"`);
    await page.click('#rg .res .again'); await page.waitForTimeout(600);
    const d = await st(page);
    check(d.trialBest != null && d.draw > 1 && /^Best \d+:\d\d\.\d$/.test(d.chip ?? ''), `Race again: the best run's ghost laid (${d.draw} points), the chip "${d.chip}"`);
    await sailUntil(page, (r) => r.stats.splits.length >= 1, 400, 1); await page.waitForTimeout(300);
    const e = await st(page);
    check(/^Mark 1 · [+−]\d+\.\d s$/.test(e.chip ?? '') && Number.isFinite(e.splits[0]?.d), `the split at mark 1 against the best: "${e.chip}"`);
    await shot(page, 'trial-split-desktop');
    await toCard(page); await page.waitForTimeout(600);
    const f = await st(page);
    check(/^Mark 1 [+−]\d+\.\d s/.test(f.res.tm ?? ''), `the card's splits: "${f.res.tm}"`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- 1280 × 720: a pursuit (the start order on the hub, the chip to her own start) ----------------
  {
    const { page, errors } = await open({ store: { [SETUP_KEY]: setupFor({ event: 'pursuit', course: 'harbour-dash', length: 'short', rivals: 4, wind: 3, shifts: 'steady' }, { skill: 'medium', aids: 'pro' }) } });
    const a = await st(page);
    check(a.hub, 'the hub is open over the stored Custom pursuit');
    await goCustom(page); await page.waitForTimeout(1000);
    const b = await st(page), mine = b.slots?.me ?? 0;
    check(mine === 0 ? !/^Start in/.test(b.chip ?? '') : /^Start in \d+ s$/.test(b.chip ?? ''), `the chip to her own start (${mine} s): "${b.chip}"`);
    await sailUntil(page, (r) => r.state().clock > 2, 60, 0.5); await page.waitForTimeout(300);
    await shot(page, 'pursuit-start-desktop');
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- 844 × 390: the hub's Cup row; a match race's chip; the Cup's standings on the screen ----------------
  {
    const { page, errors } = await open({ viewport: { width: 844, height: 390 }, extra: PHONE, store: { [SETUP_KEY]: setupFor(null), [CUP_KEY]: cupAt4() }, query: '&touch=1' });
    const a = await st(page), L = await layout(page);
    check(a.hub && !a.cupCard.rowShown && !L.out.length && L.minPx >= 15 && L.minBtn >= 43.5 && !L.scroll && !L.overlap, `844 × 390: the hub has no Cup row, inside the screen, text ≥ 15 px (${L.minPx}), buttons ${L.minBtn.toFixed(0)} px, no overlap, no scroll (${L.out.join(';') || 'ok'})`);
    await page.close();
    const m = await open({ viewport: { width: 844, height: 390 }, extra: PHONE, store: { [SETUP_KEY]: setupFor({ event: 'match', course: 'harbour-dash', length: 'short', wind: 3 }) }, query: '&touch=1' });
    await goCustom(m.page); await m.page.waitForTimeout(1500);
    const c = await st(m.page);
    const chipBox = await m.page.evaluate(() => { const r = document.querySelector('#rg .fleet').getBoundingClientRect(); return { cx: (r.left + r.right) / 2, top: r.top, W: innerWidth }; });
    check(c.event === 'match' && c.chip === 'Match · 1 v 1' && Math.abs(chipBox.cx - chipBox.W / 2) < 4, `the phone's chip top centre: "${c.chip}" at ${chipBox.cx.toFixed(0)} of ${chipBox.W}`);
    await shot(m.page, 'match-start-phone');
    await sailUntil(m.page, (r) => r.state().clock > 20, 120, 1); await m.page.waitForTimeout(400);
    const d = await st(m.page);
    check(/^(Ahead|Behind) \d+ m$|^Level$/.test(d.chip ?? ''), `the phone's chip racing: "${d.chip}"`);
    check(!errors.length && !m.errors.length, `no page errors (${[...errors, ...m.errors].slice(0, 2).join(' | ')})`);
    await m.page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
