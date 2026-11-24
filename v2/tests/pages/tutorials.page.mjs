// Help › Tutorials and Help › About on the real v2 page (owner, 2026-11-18: "Rewrite the tutorial … Put yourself in a newcomer's
// shoes"; "Contact, Support and About should be consolidated into one page"). On a desktop at 1280 × 720 and 1280 × 650: Menu › Keys,
// then Tutorials in the Help nav; the twelve chapters walked from the list and by the next button, one shown at a time; the page body
// never scrolls (only the chapter view), nor the document; every key cap on screen is a cap of its v2/ui/keyMap.js row; the cockpit's
// pictures load. On a phone (844 × 390, the flat controls): the chapters as a strip of numbers, the phone's words (no key caps shown).
// About: the nav has no Contact or Support; the address, Send feedback and Esc back to About. Stills under renders/tutorials/.
// Run by `npm run test:pages:v2 -- tutorials`, or node v2/tests/pages/tutorials.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const OUT = 'renders/tutorials'; mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, hud: 'full' };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the state of the Tutorials page now
const state = () => {
  const pg = document.querySelector('#lk-load .pg.on'), b = pg?.querySelector('.pg-b'), v = pg?.querySelector('.tu-view');
  const shown = [...(pg?.querySelectorAll('.tu-c') ?? [])].filter((a) => !a.hidden);
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; };
  return { page: pg?.dataset.page, shown: shown.map((a) => +a.dataset.ch), title: shown[0]?.querySelector('.tu-h')?.textContent ?? '',
    over: b ? b.scrollHeight - b.clientHeight : -1, docOver: document.scrollingElement.scrollHeight - innerHeight, scrollY,
    viewScrolls: v ? getComputedStyle(v).overflowY : '', caps: shown.flatMap((a) => [...a.querySelectorAll('kbd.kc')].filter(vis).map((k) => ({ row: k.dataset.row, k: k.dataset.k }))),
    imgs: shown.flatMap((a) => [...a.querySelectorAll('img')].filter(vis).map((i) => ({ src: i.currentSrc.split('/').pop(), w: i.naturalWidth }))),
    lit: [...(pg?.querySelectorAll('.tu-li[aria-current=true]') ?? [])].map((x) => +x.dataset.to) };
};

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  // ---------------- desktop ----------------
  for (const H of [720, 650]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: H } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&kayaks=0&cinema=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    const keyRows = await page.evaluate(async () => { const m = await import('/ui/keyMap.js'); return Object.fromEntries(m.KEY_ROWS.map((r) => [r.id, r.k])); });
    await page.click('#lk-load .lk-link[data-go=keys]'); await wait(400);
    await page.click('#lk-load .hnav .hn[data-go=tutorials]'); await wait(400);
    const s0 = await page.evaluate(state);
    check(s0.page === 'tutorials' && s0.shown.length === 1 && s0.shown[0] === 0 && /Your first minute/.test(s0.title), `${H}: Tutorials opens on chapter 1 (${JSON.stringify({ page: s0.page, shown: s0.shown, title: s0.title })})`);
    if (H === 720) await page.screenshot({ path: `${OUT}/desktop-list.png` });
    const seen = [], bad = [], over = [];
    for (let i = 0; i < 12; i++) {
      await page.click(`#lk-load .tu-li[data-to="${i}"]`); await wait(i === 1 || i === 9 ? 900 : 150);
      const s = await page.evaluate(state);
      seen.push(s.shown.length === 1 && s.shown[0] === i && s.lit[0] === i);
      over.push(s.over > 1 || s.docOver > 1 || s.scrollY !== 0 ? `${i + 1}: page ${s.over}, document ${s.docOver}` : null);
      for (const c of s.caps) if (!keyRows[c.row]?.includes(c.k)) bad.push(`${i + 1}: ${c.row}:${c.k}`);
      if (i === 1) check(s.imgs.length === 2 && s.imgs.every((m) => m.w > 0), `${H}: the cockpit chapter's two pictures load (${JSON.stringify(s.imgs)})`);
      if (i === 9) check(s.imgs.length === 1 && s.imgs[0].w > 0, `${H}: Tessie's picture loads (${JSON.stringify(s.imgs)})`);
      if (H === 720 && [1, 3, 9].includes(i)) await page.screenshot({ path: `${OUT}/desktop-${['', 'cockpit', '', 'nav', '', '', '', '', '', 'tessie'][i]}.png` });
      if (H === 650 && i === 1) await page.screenshot({ path: `${OUT}/desktop-650-cockpit.png` });
    }
    check(seen.every(Boolean), `${H}: each chapter from the list, one at a time, its row lit (${seen.map((x, i) => (x ? i + 1 : `!${i + 1}`)).join(' ')})`);
    check(over.every((x) => !x), `${H}: the page body and the document never scroll (${over.filter(Boolean).join('; ') || 'none'})`);
    check(bad.length === 0, `${H}: every key cap on screen is in the key map (${bad.join(', ') || 'all'})`);
    const vs = await page.evaluate(state);
    check(/auto|scroll/.test(vs.viewScrolls), `${H}: the chapter view is what scrolls (${vs.viewScrolls})`);
    // the next button walks on
    await page.click('#lk-load .tu-li[data-to="2"]'); await wait(150);
    await page.click('#lk-load .tu-c[data-ch="2"] .tu-next'); await wait(200);
    const nx = await page.evaluate(state);
    check(nx.shown[0] === 3 && /NAV/.test(nx.title), `${H}: next › opens chapter 4, NAV (${nx.title})`);
    const shell = await page.evaluate(() => { const L = document.querySelector('#lk-load'); return [L.scrollLeft, L.scrollTop]; });
    check(shell[0] === 0 && shell[1] === 0, `${H}: a button low in a chapter never scrolls the shell (${shell})`);
    // the last chapter: Keys › opens the Keys page; Settings that help names Setup › Aids › your sailing (owner, 2026-11-21: no skill question, so no "show the welcome again")
    await page.click('#lk-load .tu-li[data-to="11"]'); await wait(150);
    const set = await page.evaluate(() => { const c = document.querySelector('#lk-load .tu-c[data-ch="11"]'); const p = c?.querySelector('.tu-set'); return { line: p?.textContent || '', again: !!c?.querySelector('[data-act=welcome-again]') }; });
    check(/Settings that help/.test(set.line) && /your sailing/.test(set.line) && !set.again, `${H}: Settings that help, with your sailing and no welcome again, at the end (${JSON.stringify(set)})`);
    await page.click('#lk-load .tu-c[data-ch="11"] [data-go=keys]'); await wait(300);
    check(await page.evaluate(() => document.querySelector('#lk-load .pg.on')?.dataset.page === 'keys'), `${H}: Keys › opens the Keys page`);

    // About: one page for Contact, Support and About
    await page.click('#lk-load .hnav .hn[data-go=about]'); await wait(300);
    const ab = await page.evaluate(() => { const b = document.querySelector('#lk-load .pg.on .pg-b'); return { nav: [...document.querySelectorAll('#lk-load .hnav .hn')].map((n) => n.dataset.go), mail: document.querySelector('#lk-load .pg.on .addr .mail')?.textContent,
      ko: document.querySelector('#lk-load .pg.on a[data-support]')?.dataset.support, over: b.scrollHeight - b.clientHeight, st: window.__veliaLoading.state, cx: Math.round(document.querySelector('#lk-load .lk-card').getBoundingClientRect().x), gone: !document.querySelector('#lk-load .pg[data-page=contact], #lk-load .pg[data-page=support]') }; });
    check(JSON.stringify(ab.nav) === JSON.stringify(['tutorials', 'keys', 'settings', 'news', 'credits', 'about']) && ab.gone, `${H}: the Help nav (${ab.nav.join(' · ')}), no Contact or Support page (${ab.st}, card x ${ab.cx})`);
    check(ab.mail === 'contact@lucidlakelabs.com' && ab.ko === 'about', `${H}: About holds the address and the Ko-fi link (${ab.mail}, ${ab.ko})`);
    check(ab.over <= 1, `${H}: About fits, no scroll (${ab.over})`);
    if (H === 720) await page.screenshot({ path: `${OUT}/desktop-about.png` });
    await page.click('#lk-load .pg.on [data-go=feedback]'); await wait(250);
    const fb = await page.evaluate(() => ({ page: document.querySelector('#lk-load .pg.on')?.dataset.page, lit: document.querySelector('#lk-load .hnav .hn[aria-current=page]')?.dataset.go, back: document.querySelector('#lk-load .pg.on .pg-back')?.textContent.trim() }));
    check(fb.page === 'feedback' && fb.lit === 'about' && fb.back === 'About', `${H}: Send feedback sits under About (${JSON.stringify(fb)})`);
    await page.keyboard.press('Escape'); await wait(250);
    check(await page.evaluate(() => document.querySelector('#lk-load .pg.on')?.dataset.page === 'about'), `${H}: Esc steps back to About`);
    check(errors.length === 0, `${H}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }


  // ---------------- phones: 844 × 390 (the main phone), 667 × 375 (a small one), 390 × 844 (held upright: the page turns itself) ----------------
  for (const [W, H] of [[844, 390], [667, 375], [390, 844]]) {
    const tag = `phone ${W}x${H}`, file = `${W}x${H}`;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);   // a real browser: the flat controls are never mounted in a capture
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&kayaks=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front, null, { timeout: 240000 });
    await page.evaluate(() => document.querySelector('#lk-load .lk-pick[data-mode=sail]').click());
    await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 }); await wait(3000);
    await page.evaluate(() => window.__velia.m4.front.home.open()); await wait(800);
    for (const sel of ['#lk-load .lk-pmore', '#lk-load .lk-link[data-go=keys]', '#lk-load .hnav .hn[data-go=tutorials]']) { await page.evaluate((q) => document.querySelector(q)?.click(), sel); await wait(400); }
    const flat = await page.evaluate(() => document.documentElement.dataset.fFlatControls);
    const strip = await page.evaluate(() => { const l = document.querySelector('#lk-load .tu-list'); const r = [...l.querySelectorAll('.tu-li')].map((b) => b.getBoundingClientRect()); return { row: r.every((x) => Math.abs(x.top - r[0].top) < 2), min: Math.round(Math.min(...r.map((x) => Math.min(x.width, x.height)))), titles: getComputedStyle(l.querySelector('.tu-lt')).display }; });
    check(flat === 'on' && strip.row && strip.min >= 44 && strip.titles === 'none', `${tag}: the chapters as one strip of 44 px numbers (${JSON.stringify({ flat, ...strip })})`);
    const bad = [];
    for (let i = 0; i < 12; i++) {
      // the strip brought to the chip (a chip out of view is reached by the strip's own drag), then a tap on it
      await page.evaluate((n) => { const b = document.querySelector(`#lk-load .tu-li[data-to="${n}"]`); const l = b.closest('.tu-list'); l.scrollLeft += b.getBoundingClientRect().left - l.getBoundingClientRect().left - 20; }, i);
      await page.evaluate((n) => document.querySelector(`#lk-load .tu-li[data-to="${n}"]`).click(), i); await wait(i === 1 || i === 9 ? 900 : 150);
      const s = await page.evaluate(state);
      const lay = await page.evaluate(() => {
        const c = [...document.querySelectorAll('#lk-load .tu-c')].find((a) => !a.hidden), v = document.querySelector('#lk-load .tu-view').getBoundingClientRect(), t = c.querySelector('.tu-try').getBoundingClientRect();
        const lit = document.querySelector('#lk-load .tu-li[aria-current=true]').getBoundingClientRect(), L = document.querySelector('#lk-load .tu-list').getBoundingClientRect();
        const pins = [...c.querySelectorAll('.tu-fig-f .tu-pin')].map((p) => p.getBoundingClientRect()).filter((r) => r.width);
        const overlap = pins.some((a, j) => pins.some((b, k) => k > j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
        return { tryIn: t.top >= v.top - 1 && t.bottom <= v.bottom + 1, litIn: lit.left >= L.left - 1 && lit.right <= L.right + 1, pins: pins.length, pinPx: pins.length ? Math.round(Math.min(...pins.map((r) => r.height))) : 0, overlap };
      });
      const why = [];
      if (s.over > 1 || s.docOver > 1 || s.scrollY !== 0) why.push(`page ${s.over}, document ${s.docOver}`);
      if (s.caps.length) why.push(`${s.caps.length} key caps`);
      if (!lay.tryIn) why.push('Try it not in view');
      if (!lay.litIn) why.push('its chip out of the strip');
      if (i === 1 && (lay.pins !== 7 || lay.pinPx < 18 || lay.overlap)) why.push(`pins ${lay.pins}, ${lay.pinPx} px, overlap ${lay.overlap}`);
      if (why.length) bad.push(`${i + 1}: ${why.join(', ')}`);
      if (i === 1) check(s.imgs.length === 1 && s.imgs[0].src.startsWith('controls-phone') && s.imgs[0].w > 0, `${tag}: the cockpit chapter shows the phone's controls (${JSON.stringify(s.imgs)})`);
      if ([0, 1, 9].includes(i)) await page.screenshot({ path: `${OUT}/phone-${file}-${['list', 'cockpit'][i] ?? 'tessie'}.png` });
    }
    check(bad.length === 0, `${tag}: every chapter in a finger's words, Try it in view, its chip in the strip, the phone's 7 points readable (18 px or more) and apart, no page or document scroll (${bad.join('; ') || 'all 12'})`);
    const txt = await page.evaluate(() => { document.querySelector('#lk-load .tu-li[data-to="3"]').click(); return document.querySelector('#lk-load .tu-c[data-ch="3"]').innerText; });
    check(/bottom-left corner/.test(txt) && !/crescent beside/.test(txt), `${tag}: NAV is the bottom-left corner, not the cockpit crescent`);
    // About: two tabs on a phone, neither scrolls; the Help nav's six rows fit
    await page.evaluate(() => document.querySelector('#lk-load .hnav .hn[data-go=about]')?.click()); await wait(400);
    const ab = await page.evaluate(() => { const b = document.querySelector('#lk-load .pg.on .pg-b'), o = {}; o.velia = b.scrollHeight - b.clientHeight; const l = document.querySelector('#lk-load .hn-list'); o.nav = l.scrollHeight - l.clientHeight;
      o.tabs = [...document.querySelectorAll('#lk-load .pg.on [role=tab]')].filter((t) => t.getBoundingClientRect().width).length; return o; });
    await page.screenshot({ path: `${OUT}/phone-${file}-about.png` });
    await page.evaluate(() => document.querySelector('#lk-load .pg.on [data-tab=touch]')?.click()); await wait(250);
    const ab2 = await page.evaluate(() => { const b = document.querySelector('#lk-load .pg.on .pg-b'); const [t, u] = ['.ab-t', '.ab-su'].map((q) => document.querySelector(`#lk-load .pg.on ${q}`).getBoundingClientRect());
      return { touch: b.scrollHeight - b.clientHeight, mail: document.querySelector('#lk-load .pg.on .addr .mail')?.getBoundingClientRect().width > 0, apart: t.right <= u.left + 1 || u.top >= t.bottom - 1 }; });
    await page.screenshot({ path: `${OUT}/phone-${file}-about-touch.png` });
    check(ab.tabs === 2 && ab.velia <= 1 && ab2.touch <= 1 && ab2.mail && ab2.apart && ab.nav <= 1, `${tag}: About as two tabs, neither scrolls, Get in touch and Support side by side, apart; the Help nav fits (${JSON.stringify({ ...ab, ...ab2 })})`);
    // Controls: the flat controls' own rows (never the cockpit's wheel or winch), no scroll
    await page.evaluate(() => document.querySelector('#lk-load .hnav .hn[data-go=keys]')?.click()); await wait(400);
    const ctl = await page.evaluate(() => { const b = document.querySelector('#lk-load .pg.on .pg-b'); return { over: b.scrollHeight - b.clientHeight, text: [...document.querySelectorAll('#lk-load .pg.on .tr')].map((r) => r.innerText).join(' | ') }; });
    check(ctl.over <= 1 && /left ring/.test(ctl.text) && /bottom-left corner/.test(ctl.text) && !/wheel|winch|lever/i.test(ctl.text), `${tag}: Controls names the phone's rings and corners, no scroll (${ctl.over}; ${ctl.text.replace(/\s+/g, ' ').slice(0, 90)}…)`);
    check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
