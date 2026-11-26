// The Tessie RPG, phase 1 on the real page (?tessierpg=1; v2/sim/tessieBounty.js, v2/ui/tessieLog.js):
//   the Logbook's Tessie page: a fifth tab after corners; her mark and "Level N · x / y XP · k points to spend"; the bounty rows by
//     boat type (from a seeded save); the five skill rows with their rank pips; a press on a skill row that can take a point spends
//     it (the save, the pips, the line), a press on a locked one does nothing
//   her legend's first line "Tessie · Lv N" with its 2 px fill at the share of XP inside the level
//   the door: a click on her sonar, then on her depth dial, opens the Logbook on its Tessie page
//   a real knockdown (a busy-lake sailboat laid ahead, W and Space once locked) is scored into the save and the legend
//   the flag off: no Tessie tab, no level line, no door; today's four slots ("Lv 1" on the dash, three empty)
// Phase 2 (v2/sim/tessieLevelUp.js, the five slots in v2/ui/tessieHud.js):
//   five slots in order with four rank pips each (filled to the rank), a locked skill in the empty slot's look (glyph 25 %, no pips,
//     its number key), no "Lv" tag; the halo on the slots a point can go to
//   the row clear of the dials and the legend at 1280, 1180 and 1100 px wide
//   a waiting point: once she is still the skipper's line says "Level 4: pick one skill to grow."; a number key on a glowing slot
//     during the line picks (the pips, the unlock, its legend line); a press after the line fires the skill (the dash); a click on a
//     glowing slot during a fresh level's line picks the last point, and the halo goes
//   the free trials: a locked skill with uses left shows its glyph at 60 % and the count (its legend line too); a press with no
//     behaviour spends none; a real use (a stub behaviour) spends one and at 0 the slot returns to the locked look
// Evidence: TESSIE_RPG_SHOT=<png> saves the Tessie page as drawn; TESSIE_RPG2_SHOT=<prefix> saves her HUD during the level-up line
// at 1280 and 1180 (<prefix>-1280.png, <prefix>-1180.png). Run by `npm run test:pages:v2 -- tessieRpg`, or
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
// phase 2: the same at _v 2 with the free trials: Lure 5 (tried in any order), Breach 1, Sonar and Surge used up
const SAVE2 = { ...SAVE, _v: 2, trials: { lure: 5, sonar: 0, surge: 0, breach: 1 } };
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
    check(b && b.rows.map((r) => r.id).join() === 'sail,halcyon,glass,kayak,runabout,jetski' && /9 wrecked · deepest from 9\.4 m · 2 unseen · first 2026-11-24/.test(b.rows[0].g) && b.rows[1].g === 'not yet' && /^3 splashed/.test(b.rows[3].g),
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
  // ---- phase 2: the five slots, the level-up line and its pick ----
  {
    const { ctx, page, errors } = await open(`${Q}&tessierpg=1`, SAVE2);
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden, null, { timeout: 30000 }).then(() => true, () => false);
    check(inT, 'phase 2: you are her');
    await page.waitForTimeout(800);
    const slots = () => page.evaluate(() => [...document.querySelectorAll('#lk-tplay .tp-skills .tp-slot')].map((s) => {
      const pp = s.querySelector('.pp'), kn = s.querySelector('.kn'), gl = s.querySelector('.gl');
      const tr = s.querySelector('.tr');
      return { id: s.dataset.skill ?? null, locked: s.classList.contains('locked'), tries: tr && getComputedStyle(tr).display !== 'none' ? tr.textContent : null, pips: pp && getComputedStyle(pp).display !== 'none' ? pp.querySelectorAll('b').length : 0, on: s.querySelectorAll('.pp b.on').length,
        glyph: gl ? +getComputedStyle(gl).opacity : null, key: kn && getComputedStyle(kn).display !== 'none' ? kn.textContent : null, lv: !!s.querySelector('.lv'), halo: s.hasAttribute('data-halo') };
    }));
    let sl = await slots();
    const pip = await page.evaluate(() => { const b = document.querySelector('#lk-tplay .tp-slot[data-skill=dash] .pp b.on'), e = document.querySelector('#lk-tplay .tp-slot[data-skill=dash] .pp b:not(.on)'); const r = b?.getBoundingClientRect(); return { w: r?.width, h: r?.height, fill: b && getComputedStyle(b).backgroundColor, empty: e && getComputedStyle(e).borderTopColor }; });
    check(sl.map((x) => x.id).join() === 'dash,lure,sonar,surge,breach' && sl[0].pips === 4 && sl[0].on === 2 && !sl[0].locked && sl.every((x) => !x.lv),
      `five slots in order; Dash rank 2: four pips, two filled; no "Lv" tag (${JSON.stringify(sl.map((x) => `${x.id}:${x.on}/${x.pips}`))})`);
    check(pip.w === 4 && pip.h === 4 && /0\.9\)$/.test(pip.fill ?? '') && /0\.28\)$/.test(pip.empty ?? ''), `a pip is 4 px: filled cream 90 %, empty outlined 28 % (${JSON.stringify(pip)})`);
    check([sl[2], sl[3]].every((x) => x.locked && x.pips === 0 && Math.abs(x.glyph - 0.25) < 0.01 && x.tries === null) && sl.slice(1).map((x) => x.key).join() === '2,3,4,5',
      `a locked skill with no trials: glyph at 25 %, no pips, its number key (${JSON.stringify(sl.slice(1))})`);
    check(sl[1].locked && sl[1].tries === '5' && sl[1].pips === 0 && Math.abs(sl[1].glyph - 0.6) < 0.01 && sl[4].tries === '1' && Math.abs(sl[4].glyph - 0.6) < 0.01,
      `a locked skill with free trials: glyph at 60 %, the uses left (Lure 5, Breach 1) (${JSON.stringify([sl[1], sl[4]])})`);
    check(sl.map((x) => x.halo).join() === 'true,true,false,false,false', `the halo on Dash and Lure, the slots a point can go to (${JSON.stringify(sl.map((x) => x.halo))})`);
    const lines0 = await page.evaluate(() => [...document.querySelectorAll('#lk-tplay .tp-keys .kl')].filter((k) => getComputedStyle(k).display !== 'none').map((k) => k.dataset.id));
    check(lines0.join() === 'level,swim,dash,lure,breach,bite,updown,view,boat', `the legend: a line for each skill with trials left, none for Sonar and Surge (${lines0.join()})`);
    // a press with no behaviour yet (Breach until its phase): nothing happens, no trial spent
    const open0 = await page.evaluate(() => window.__velia.tessiePlay.stats().rpg.open);
    await page.keyboard.press('Digit5'); await page.waitForTimeout(250);
    check(!open0 && (await saved(page)).trials.breach === 1 && (await slots())[4].tries === '1', 'a trial press with no behaviour spends nothing');
    // the row clear of the dials and the legend at three widths
    const clear = () => page.evaluate(() => {
      const R = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none' ? e.getBoundingClientRect() : null;
      const rs = [...document.querySelectorAll('#lk-tplay .tp-skills .tp-slot, #lk-tplay .tp-skills .tp-slot .nm, #lk-tplay .tp-skills .tp-slot .kn')].map(R).filter(Boolean);
      const row = { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)), t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)) };
      const hit = (a) => a && !(a.right <= row.l || a.left >= row.r || a.bottom <= row.t || a.top >= row.b);
      const dial = R(document.querySelector('#lk-tplay .tp-dial')), sonar = R(document.querySelector('#lk-tplay .tp-sonar')), leg = R(document.querySelector('#lk-tplay .tp-keys'));
      return { w: innerWidth, row: [Math.round(row.l), Math.round(row.r)], dial: dial && Math.round(dial.right), sonar: sonar && Math.round(sonar.left), legend: !!leg, legL: leg && Math.round(leg.left), legB: leg && Math.round(leg.bottom), rowT: Math.round(row.t),
        ok: !hit(dial) && !hit(sonar) && !hit(leg) && row.l >= 0 && row.r <= innerWidth && !!dial && !!sonar };
    });
    for (const w of [1280, 1180, 1100]) {
      await page.setViewportSize({ width: w, height: 720 }); await page.waitForTimeout(500);
      const c = await clear();
      check(c.ok && c.legend, `${w} px: the five slots clear of DEPTH, SONAR and the legend (${JSON.stringify(c)})`);
    }
    await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(400);
    // a waiting point: the line once she is still 2 s (nothing held), after the lean skipper's 20 s gap from her first tip
    const lineUp = await page.waitForFunction(() => window.__velia.tessiePlay.stats().rpg?.open, null, { timeout: 40000 }).then(() => true, () => false);
    await page.waitForTimeout(900);
    const said = await page.evaluate(() => [...document.querySelectorAll('.lk-hint .row.in')].map((r) => r.textContent.trim()).join(' | '));
    check(lineUp && /^Level 4: pick one skill to grow\.$/.test(said ?? ''), `the skipper's line: "Level 4: pick one skill to grow." (${JSON.stringify(said)})`);
    if (process.env.TESSIE_RPG2_SHOT) {
      await page.screenshot({ path: `${process.env.TESSIE_RPG2_SHOT}-1280.png` });
      await page.setViewportSize({ width: 1180, height: 720 }); await page.waitForTimeout(350);
      await page.screenshot({ path: `${process.env.TESSIE_RPG2_SHOT}-1180.png` });
      await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(250);
    }
    const c0 = (await page.evaluate(() => window.__velia.tessiePlay.stats().rpg.dash.count));
    await page.keyboard.press('Digit2'); await page.waitForTimeout(500);
    let sv = await saved(page); sl = await slots();
    const lureLine = await page.evaluate(() => { const k = document.querySelector('#lk-tplay .tp-keys .kl[data-id=lure]'); return k ? getComputedStyle(k).display !== 'none' && k.textContent : null; });
    const c1 = (await page.evaluate(() => window.__velia.tessiePlay.stats().rpg.dash.count));
    check(sv.ranks.lure === 1 && sv.points === 1 && !sl[1].locked && sl[1].on === 1 && sl[1].pips === 4 && /Lure/.test(lureLine || '') && c1 === c0,
      `2 during the line picks: Lure unlocked (a pip, its legend line), one point left (${JSON.stringify({ ranks: sv.ranks, points: sv.points, lure: sl[1], lureLine })})`);
    check(sl.map((x) => x.halo).join() === 'true,true,true,false,false', `the halo moves on: Dash, Lure and now Sonar (${JSON.stringify(sl.map((x) => x.halo))})`);
    // after the line: a press is the skill's own
    await page.waitForFunction(() => !window.__velia.tessiePlay.stats().rpg?.open, null, { timeout: 12000 }).catch(() => {});
    const d0 = (await page.evaluate(() => window.__velia.tessiePlay.stats().rpg.dash.count));
    await page.keyboard.press('Digit1'); await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__velia.tessiePlay.stats().rpg);
    sv = await saved(page);
    check(after.dash.count === d0 + 1 && sv.ranks.dash === 2 && sv.points === 1 && after.halo.join() === 'dash,lure,sonar', `1 after the line dashes; the point still waits, the halo stays (${JSON.stringify({ count: [d0, after.dash.count], ranks: sv.ranks, halo: after.halo })})`);
    const idle = await page.evaluate(() => { const l0 = window.__velia.tessiePlay.stats().log.idle ?? 0; return l0; });
    await page.keyboard.press('Digit2'); await page.waitForTimeout(200);
    const idle1 = await page.evaluate(() => window.__velia.tessiePlay.stats().log.idle ?? 0);
    check(idle1 === idle + 1 && (await saved(page)).ranks.lure === 1, `2 on the unlocked Lure, after the line: a quiet no-op (${idle} → ${idle1})`);
    // a fresh level's line: a click on a glowing slot picks the last point; the halo goes
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.__velia.tessiePlay.levelUp.levelUp());
    const up2 = await page.waitForFunction(() => window.__velia.tessiePlay.stats().rpg?.open, null, { timeout: 30000 }).then(() => true, () => false);
    const so = await page.evaluate(() => { const r = document.querySelector('#lk-tplay .tp-slot[data-skill=sonar]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(so.x, so.y); await page.waitForTimeout(500);
    sv = await saved(page); sl = await slots();
    const st2 = await page.evaluate(() => window.__velia.tessiePlay.stats().rpg);
    check(up2 && sv.ranks.sonar === 1 && sv.points === 0 && sl.every((x) => !x.halo) && !st2.open && st2.halo.length === 0, `a click on the glowing Sonar during the line unlocks it; no point left, no halo (${JSON.stringify({ up2, ranks: sv.ranks, points: sv.points, halo: sl.map((x) => x.halo) })})`);
    // a real use (a stub behaviour, as phases 3–5 will register theirs): the last free Breach spent; the slot locked again
    await page.evaluate(() => { window.__velia.tessiePlay.skillRun.breach = (rank) => rank === 1; });
    await page.keyboard.press('Digit5'); await page.waitForTimeout(400);
    sl = await slots(); sv = await saved(page);
    const brLine = await page.evaluate(() => { const k = document.querySelector('#lk-tplay .tp-keys .kl[data-id=breach]'); return k ? getComputedStyle(k).display !== 'none' : null; });
    await page.keyboard.press('Digit5'); await page.waitForTimeout(250);
    const sv2 = await saved(page);
    check(sv.trials.breach === 0 && sv.ranks.breach === 0 && sl[4].locked && sl[4].tries === null && Math.abs(sl[4].glyph - 0.25) < 0.01 && brLine === false && sv2.trials.breach === 0,
      `a real trial use spends the last one: the locked look again, its legend line gone, never below 0 (${JSON.stringify({ trials: sv.trials, breach: sl[4], brLine })})`);
    check(errors.length === 0, `phase 2: no page errors (${errors.slice(0, 2).join(' | ')})`);
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
    const four = await page.evaluate(() => ({ slots: [...document.querySelectorAll('#lk-tplay .tp-skills .tp-slot')].map((s) => s.dataset.skill ?? `empty${s.dataset.slot}`), lv: document.querySelector('#lk-tplay .tp-slot[data-skill=dash] .lv')?.textContent, pips: document.querySelectorAll('#lk-tplay .tp-slot .pp').length, halo: document.querySelectorAll('#lk-tplay [data-halo]').length, lines: document.querySelectorAll('#lk-tplay .tp-keys .kl').length }));
    check(four.slots.join() === 'dash,empty2,empty3,empty4' && four.lv === 'Lv 1' && four.pips === 0 && four.halo === 0 && four.lines === 6, `flag off: today's four slots, "Lv 1" on the dash, six legend lines (${JSON.stringify(four)})`);
    check(errors.length === 0, `flag off: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
