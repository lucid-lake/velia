// The Tessie RPG, phase 1 on the real page (?tessierpg=1; v2/sim/tessieBounty.js, v2/ui/tessieLog.js):
//   the Logbook's Tessie page: a fifth tab after corners; her mark and "Level N · x / y XP · k points to spend"; the bounty rows by
//     boat type (from a seeded save); the five skill rows with their rank pips; a press on a skill row that can take a point spends
//     it (the save, the pips, the line), a press on a locked one does nothing
//   her legend's first line "Tessie · Lv N" with its 2 px fill at the share of XP inside the level
//   the door: a click on her sonar, then on her depth dial, opens the Logbook on its Tessie page
//   a real knockdown (a busy-lake sailboat laid ahead, W and Space once locked) is scored into the save and the legend
//   the flag off: no Tessie tab, no level line, no door
// Evidence: TESSIE_RPG_SHOT=<png> saves the Tessie page as drawn. Run by `npm run test:pages:v2 -- tessieRpg`, or
// node v2/tests/pages/tessieRpg.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
// a seeded save: level 4 (52 XP: 45 at level 4, 60 to go to 5), Dash rank 2, so 2 points to spend
const SAVE = { _v: 1, xp: 52, level: 4, points: 2, ranks: { dash: 2, lure: 0, sonar: 0, surge: 0, breach: 0 }, sets: [],
  byType: { sail: { wrecked: 9, splashed: 0, first: '2026-11-24', deepestM: 9.4, unseen: 2, fastestS: null }, glass: { wrecked: 1, splashed: 0, first: '2026-11-25', deepestM: 3.2, unseen: 0, fastestS: null },
    kayak: { wrecked: 0, splashed: 3, first: '2026-11-25', deepestM: 0, unseen: 0, fastestS: null } } };
const SEED = (save) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); localStorage.removeItem('lakeshore.course.v1');
  if (save) localStorage.setItem('lakeshore.tessie.bounty.v1', save); else localStorage.removeItem('lakeshore.tessie.bounty.v1'); sessionStorage.setItem('seeded', '1'); } } catch {} };
const Q = 'mode=sail&seed=1&wind=3&noload=1&attract=0&fv=1&once=0&hm=0&chatter=0&hour=13&stage=off&cinema=0&tessie=1';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open(q, save) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(SEED, save ? JSON.stringify(save) : null);
  await page.goto(`${BASE}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.services?.get('logbook')?.logbook && window.__velia.tessiePlay, null, { timeout: 240000 });
  await page.evaluate(() => { const hm = window.__velia.m4?.front?.home; if (hm?.isOpen) hm.close(); });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
const logState = (page) => page.evaluate(() => { const l = document.querySelector('.lk-log'); return { state: l?.dataset.state, page: l?.dataset.page }; });
const tessieView = (page) => page.evaluate(() => {
  const v = document.querySelector('.lk-log .view.tessie.on');
  return v ? { id: v.dataset.view, lead: v.querySelector('.lead')?.textContent.trim(), mark: !!v.querySelector('.lead svg'), label: document.querySelector('.lk-log .plabel')?.textContent,
    rows: [...v.querySelectorAll('.w')].map((r) => ({ id: r.dataset.row, t: r.querySelector('.t').textContent.trim(), g: r.querySelector('.g').textContent.trim(), press: r.hasAttribute('data-press'), pips: r.querySelectorAll('.pip.on').length, of: r.querySelectorAll('.pip').length })) } : null;
});
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.tessie.bounty.v1') ?? 'null'));
const legend = (page) => page.evaluate(() => { const r = document.querySelector('#lk-tplay .tp-keys .kl'); const b = r?.querySelector('.xp b'), x = r?.querySelector('.xp'); return { first: r?.dataset.id, text: r?.querySelector('.w')?.textContent, fill: b && x ? +(b.getBoundingClientRect().width / x.getBoundingClientRect().width).toFixed(3) : null, h: x ? Math.round(x.getBoundingClientRect().height) : null, shown: !document.querySelector('#lk-tplay .tp-keys')?.hidden }; });
const closeLog = async (page) => { await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelector('.lk-log')?.dataset.state === 'closed', null, { timeout: 4000 }).catch(() => {}); };
try {
  {
    const { ctx, page, errors } = await open(`${Q}&tessierpg=1`, SAVE);
    // ---- the Logbook's Tessie page ----
    await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('logbook'));
    await page.waitForFunction(() => document.querySelector('.lk-log')?.dataset.state === 'open', null, { timeout: 8000 }).catch(() => {});
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lk-log .title [data-tab]')].map((t) => t.dataset.tab));
    check(tabs.join() === 'log,sea,words,corners,tessie', `the tab row: Logbook · seamanship · sailor's words · corners · Tessie (${tabs.join()})`);
    await page.click('.lk-log .title [data-tab=tessie]'); await page.waitForTimeout(500);
    const b = await tessieView(page);
    check(b?.id === 'tessie-bounty' && b.mark && b.lead === 'Level 4 · 52 / 70 XP · 2 points to spend', `the page: her mark and "Level 4 · 52 / 70 XP · 2 points to spend" (${JSON.stringify(b?.lead)})`);
    check(b && b.rows.map((r) => r.id).join() === 'sail,halcyon,glass,kayak' && /9 wrecked · deepest from 9\.4 m · 2 unseen · first 2026-11-24/.test(b.rows[0].g) && b.rows[1].g === 'not yet' && /^3 splashed/.test(b.rows[3].g),
      `the bounty rows by type (${JSON.stringify(b?.rows.map((r) => `${r.t}: ${r.g}`))})`);
    const fitB = await page.evaluate(() => { const c = document.querySelector('.lk-log .card').getBoundingClientRect(), x = document.querySelector('.lk-log .close').getBoundingClientRect(), t = document.querySelector('.lk-log .title').getBoundingClientRect(), v = document.querySelector('.lk-log .view.tessie.on'), last = v?.querySelector('.w:last-child')?.getBoundingClientRect(); return { title: t.right <= x.left && x.right <= c.right - 4, rows: !!last && last.bottom <= c.bottom + 0.5 }; });
    check(fitB.title && fitB.rows, `the tab row, its close and the rows fit in the card (${JSON.stringify(fitB)})`);
    if (process.env.TESSIE_RPG_SHOT) { await page.waitForTimeout(600); await page.screenshot({ path: process.env.TESSIE_RPG_SHOT }); }   // the bounty view, as drawn
    await page.click('.lk-log .pv[data-step="1"]'); await page.waitForTimeout(500);
    let k = await tessieView(page);
    check(k?.id === 'tessie-skills' && k.rows.map((r) => `${r.id}:${r.pips}/${r.of}:${r.press}`).join() === 'dash:2/4:true,lure:0/4:true,sonar:0/4:false,surge:0/4:false,breach:0/4:false',
      `the skill rows: five, four pips each, Dash at rank 2; Dash and Lure take a point, the rest wait their turn (${JSON.stringify(k?.rows.map((r) => `${r.id} ${r.pips} ${r.g}`))})`);
    await page.click('.lk-log .tessie .w[data-row=sonar]'); await page.waitForTimeout(300);
    check((await saved(page)).ranks.sonar === 0, 'a press on a locked skill (Sonar before Lure) spends nothing');
    await page.click('.lk-log .tessie .w[data-row=lure]'); await page.waitForTimeout(400);
    k = await tessieView(page);
    const s1 = await saved(page);
    check(s1.ranks.lure === 1 && s1.points === 1 && k.rows[1].pips === 1 && /1 point to spend/.test(k.lead) && k.rows[2].press, `a press on Lure unlocks it: a pip, one point left, Sonar next in line (${JSON.stringify({ ranks: s1.ranks, points: s1.points, lead: k.lead })})`);
    check((await logState(page)).state === 'open', 'the Logbook stays open after the press');
    await page.click('.lk-log .tessie .w[data-row=dash]'); await page.waitForTimeout(400);
    k = await tessieView(page);
    const s2 = await saved(page);
    check(s2.ranks.dash === 3 && s2.points === 0 && k.rows.every((r) => !r.press) && !/to spend/.test(k.lead), `Dash grows to rank 3; no point left, no row to press (${JSON.stringify({ ranks: s2.ranks, points: s2.points })})`);
    await closeLog(page);

    // ---- as Tessie: the legend's level line, the door ----
    const went = await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden, null, { timeout: 30000 }).then(() => true, () => false);
    check(inT, `you are her (${JSON.stringify(went)})`);
    await page.waitForTimeout(800);
    const lg = await legend(page);
    check(lg.first === 'level' && lg.text === 'Tessie · Lv 4' && lg.h === 2 && Math.abs(lg.fill - 7 / 25) < 0.02 && lg.shown, `her legend's first line "Tessie · Lv 4", a 2 px fill at 7 / 25 of the level (${JSON.stringify(lg)})`);
    const door = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, pe: getComputedStyle(document.querySelector(s)).pointerEvents }; }, sel);
    const so = await door('#lk-tplay .tp-sonar');
    await page.mouse.click(so.x, so.y); await page.waitForTimeout(700);
    const l1 = await logState(page);
    check(so.pe === 'auto' && l1.state === 'open' && l1.page === 'tessie', `a click on her sonar opens the Logbook on its Tessie page (${JSON.stringify({ ...l1, pe: so.pe })})`);
    await closeLog(page);
    await page.evaluate(() => window.__velia.m4.ui.services.get('logbook').logbook.page = 'log');   // the next open must not inherit the page
    const de = await door('#lk-tplay .tp-dial');
    await page.mouse.click(de.x, de.y); await page.waitForTimeout(700);
    const l2 = await logState(page);
    check(l2.state === 'open' && l2.page === 'tessie', `a click on her depth dial does the same (${JSON.stringify(l2)})`);
    await closeLog(page);
    await page.waitForTimeout(600);

    // ---- a real knockdown, scored: a busy-lake sailboat laid 17 m ahead, W, and Space once locked ----
    const xp0 = (await saved(page)).xp, w0 = (await saved(page)).byType.sail.wrecked;
    const laid = await page.evaluate(() => {
      const V = window.__velia, L = V.busy.lake, n = V.tessie.sim.state.nose, b = V.boat.sim.state, from = b.heading + (b.trueWind?.angle ?? 0);
      const live = L?.liveBoats ?? []; if (!live.length) return null;
      const id = live[0].id; L.lay(id, { x: n.x + Math.sin(n.psi) * 17, z: n.z - Math.cos(n.psi) * 17, heading: from, speed: 0 }); return id;
    });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__velia.tessiePlay.stats().aim?.locked, null, { timeout: 8000 }).catch(() => {});
    await page.keyboard.press('Space');
    const hit = await page.waitForFunction(() => window.__velia.tessiePlay.stats().log.bounty.length > 0, null, { timeout: 12000 }).then(() => true, () => false);
    await page.keyboard.up('KeyW');
    const st = await page.evaluate(() => window.__velia.tessiePlay.stats().log), s3 = await saved(page), lg2 = await legend(page);
    check(!!laid && hit && s3.byType.sail.wrecked === w0 + 1 && s3.xp === xp0 + st.bounty[0].xp && st.bounty[0].kind === 'sail' && st.bounty[0].xp >= 3,
      `a knockdown scores into the bounty: sail ${w0} → ${s3.byType.sail.wrecked}, +${st.bounty[0]?.xp} XP (${JSON.stringify(st.bounty)}; ${JSON.stringify(st.lastContact)})`);
    check(lg2.text === `Tessie · Lv ${s3.level}` && lg2.fill > lg.fill - 0.001, `the legend follows (${JSON.stringify(lg2)})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- the flag off: nothing of it ----
  {
    const { ctx, page, errors } = await open(Q, SAVE);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lk-log .title [data-tab]')].map((t) => t.dataset.tab));
    check(!tabs.includes('tessie'), `flag off: no Tessie tab (${tabs.join()})`);
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => ({ level: !!document.querySelector('#lk-tplay .tp-lv'), doors: document.querySelectorAll('#lk-tplay [data-door]').length, pe: getComputedStyle(document.querySelector('#lk-tplay .tp-sonar')).pointerEvents, bounty: window.__velia.tessiePlay.bounty }));
    check(!off.level && off.doors === 0 && off.pe === 'none' && off.bounty === null, `flag off: no level line, no door, no bounty (${JSON.stringify(off)})`);
    check(errors.length === 0, `flag off: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
