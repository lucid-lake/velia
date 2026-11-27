// The Tessie RPG, phase 1 on the real page (on by default where she is playable; ?tessierpg=0 off; v2/sim/tessieBounty.js, v2/ui/tessieLog.js):
//   (phase 6: the bounty rows grouped by set, Emerald Bay (no rival row since phase 6b) then South Lake, each with its set row; then the skills)
//   the Logbook's Tessie page: a fifth tab after corners; her mark and "Level N · x / y XP · k points to spend"; the bounty rows by
//     boat type (from a seeded save); the five skill rows with their rank pips; a press on a skill row that can take a point spends
//     it (the save, the pips, the line), a press on a locked one does nothing
//   her legend's first line "Tessie · Lv N" with its 2 px fill at the share of XP inside the level
//   the door: a click on her sonar, then on her depth dial, opens the Logbook on its Tessie page
//   a real knockdown (a busy-lake sailboat laid ahead, W and Space once locked) is scored into the save and the legend
//   no flag (the RPG's default, the last block): the Tessie tab, her level line, the five slots; ?tessierpg=0: no Tessie tab, no level line, no door; today's four slots ("Lv 1" on the dash, three empty)
// Phase 2 (v2/sim/tessieLevelUp.js, the five slots in v2/ui/tessieHud.js):
//   five slots in order with four rank pips each (filled to the rank), a locked skill in the empty slot's look (glyph 25 %, no pips,
//     its number key), no "Lv" tag; the halo on the slots a point can go to
//   the row clear of the dials and the legend at 1280, 1180 and 1100 px wide
//   a waiting point: once she is still the skipper's line says "Level 4: pick one skill to grow."; a number key on a glowing slot
//     during the line picks (the pips, the unlock, its legend line); a press after the line fires the skill (the dash); a click on a
//     glowing slot during a fresh level's line picks the last point, and the halo goes
//   the free trials: a locked skill with uses left shows its glyph at 60 % and the count (its legend line too); a press with no
//     behaviour spends none; a real use (a stub behaviour) spends one and at 0 the slot returns to the locked look
// Phase 3 (Lure and Sonar, v2/sim/tessieLure.js, tessieSonar.js): 2 fires the Lure (a busy-lake sailboat laid 90 m ahead of her,
//     crossing, turns toward her; the slot's ring amber then cooling; the lure's ring on the water); 3 pings (the marks under the
//     hulls in the world, ticks on the SONAR dial's rim, its word "300 M"; the ring); a click on the Sonar slot while it cools does nothing
// Phase 4 (Tail Surge, v2/sim/tessieSurge.js): 4 winds up 1.2 s (the slot amber), then the slap: the wave's cream ring on the water
//     runs out to 40 m, a busy-lake sailboat laid 20 m abeam heels away from her; a click on the slot while it cools does nothing; in a
//     strong wind (?wind=4, the fleet out 25 s, then a gust laying one past 22°) a boat leaning past 20° moved 9 m off her just before the slap goes over (scored as wrecked)
// Phase 5 (Breach, v2/sim/tessieBreach.js): 5 held from 7 m down with a busy-lake sailboat laid 45 m ahead crossing her bow: the run at
//     6 m (the slot amber, a free trial spent), the corners on it turning amber; let go then: the arc, her play clock 0.5x about the apex
//     (?slowbreach=0: never), the eye eased back; her fall on its rail knocks it over (scored as wrecked); a press while it cools does nothing
// Evidence: TESSIE_RPG5_SHOT=<prefix> saves <prefix>-apex.png (the arc's apex).
// Evidence: TESSIE_RPG4_SHOT=<prefix> saves <prefix>-wave.png (0.9 s after the slap) and <prefix>-knock.png (the knockdown, 2.5 s after).
// Evidence: TESSIE_RPG3_SHOT=<prefix> saves <prefix>-lure.png (2.5 s after the lure) and <prefix>-sonar.png (1 s after the ping).
// TESSIE_RPG_SHOT=<png> saves the Tessie page as drawn; TESSIE_RPG2_SHOT=<prefix> saves her HUD during the level-up line
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
    check(b?.id === 'tessie-emerald' && b.mark && b.lead === 'Level 4 · 52 / 70 XP · 2 points to spend', `the page: her mark and "Level 4 · 52 / 70 XP · 2 points to spend" (${JSON.stringify(b?.lead)})`);
    check(b && b.rows.map((r) => r.id).join() === 'halcyon,sail,glass,kayak,set' && /9 wrecked · deepest from 9\.4 m · 2 unseen · first 2026-11-24/.test(b.rows[1].g) && b.rows[0].g === 'not yet' && /^3 splashed/.test(b.rows[3].g)
      && b.rows[4].t === '◇ The set · 3 of 4' && /^Emerald Bay\s*3 of 4$/.test(b.label ?? ''),
      `phase 6: the bounty by set, Emerald Bay's rows and its set row (${JSON.stringify([b?.label, b?.rows.map((r) => `${r.t}: ${r.g}`)])})`);
    const fitB = await page.evaluate(() => { const c = document.querySelector('.lk-log .card').getBoundingClientRect(), x = document.querySelector('.lk-log .close').getBoundingClientRect(), t = document.querySelector('.lk-log .title').getBoundingClientRect(), v = document.querySelector('.lk-log .view.tessie.on'), last = v?.querySelector('.w:last-child')?.getBoundingClientRect(); return { title: t.right <= x.left && x.right <= c.right - 4, rows: !!last && last.bottom <= c.bottom + 0.5 }; });
    check(fitB.title && fitB.rows, `the tab row, its close and the rows fit in the card (${JSON.stringify(fitB)})`);
    if (process.env.TESSIE_RPG_SHOT) { await page.waitForTimeout(600); await page.screenshot({ path: process.env.TESSIE_RPG_SHOT }); }   // the bounty view, as drawn
    await page.click('.lk-log .pv[data-step="1"]'); await page.waitForTimeout(500);
    const sv = await tessieView(page);
    check(sv?.id === 'tessie-south' && sv.rows.map((r) => r.id).join() === 'paddle,still,kayak,runabout,jetski,set' && sv.rows[5].t === '◇ The set · 1 of 5',
      `South Lake's rows and its set row (${JSON.stringify(sv?.rows.map((r) => `${r.t}: ${r.g}`))})`);
    const fitS = await page.evaluate(() => { const c = document.querySelector('.lk-log .card').getBoundingClientRect(), last = document.querySelector('.lk-log .view.tessie.on .w:last-child')?.getBoundingClientRect(); return !!last && last.bottom <= c.bottom + 0.5; });
    check(fitS, 'South Lake\'s rows fit in the card');
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
    const { ctx, page, errors } = await open(Q, SAVE2);
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
    // a waiting point: the line once she is still 2 s (nothing held), 7 s after her first tip (it jumps the lean skipper's 20 s gap)
    const lineUp = await page.waitForFunction(() => window.__velia.tessiePlay.stats().rpg?.open, null, { timeout: 40000 }).then(() => true, () => false);
    await page.waitForTimeout(900);
    const said = await page.evaluate(() => [...document.querySelectorAll('.lk-hint .row.in')].map((r) => r.textContent.trim()).join(' | '));
    const caps = await page.evaluate(() => [...document.querySelectorAll('.lk-hint .row.in .cap')].map((c) => c.textContent));
    check(lineUp && /^Level 4: pick one skill to grow: 1 or 2\.$/.test(said ?? '') && caps.join() === '1,2', `the skipper's line: "Level 4: pick one skill to grow: [1] or [2]." with the glowing slots' keys as caps (${JSON.stringify(said)}, caps ${caps})`);
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
    await page.keyboard.press('Digit2'); await page.waitForTimeout(200);
    const lu = await page.evaluate(() => ({ lure: window.__velia.tessiePlay.stats().log.lure ?? null, phase: window.__velia.tessiePlay.stats().rpg.lure.phase }));
    check(!!lu.lure && lu.lure.rank === 1 && lu.phase === 'active' && (await saved(page)).ranks.lure === 1, `2 on the unlocked Lure, after the line: the Lure fires at rank 1 (${JSON.stringify(lu)})`);
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
  // ---- phase 3: Lure and Sonar ----
  {
    const SAVE3 = { ...SAVE, _v: 2, xp: 30, ranks: { dash: 1, lure: 1, sonar: 1, surge: 0, breach: 0 }, trials: { lure: 5, sonar: 5, surge: 5, breach: 5 } };
    const { ctx, page, errors } = await open(`${Q}&tessierpg=1`, SAVE3);
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden && window.__velia.tessie.sim.state.nose, null, { timeout: 30000 }).then(() => true, () => false);
    check(inT, 'phase 3: you are her');
    await page.waitForTimeout(2500);
    // a busy-lake sailboat laid 90 m ahead of her, crossing her bow on a reach (she is at the surface: it would see her inside 60 m)
    const laid = await page.evaluate(() => {
      const V = window.__velia, L = V.busy.lake, n = V.tessie.sim.state.nose, b = V.boat.sim.state, from = b.heading + (b.trueWind?.angle ?? 0);
      const live = L?.liveBoats ?? []; if (!live.length) return null;
      const w = (a) => Math.atan2(Math.sin(a), Math.cos(a)), hs = [n.psi + Math.PI / 2, n.psi - Math.PI / 2].sort((p, q) => Math.abs(w(q - from)) - Math.abs(w(p - from)));
      const id = live[0].id; L.lay(id, { x: n.x + Math.sin(n.psi) * 90, z: n.z - Math.cos(n.psi) * 90, heading: hs[0], speed: 2.6 }); return id;
    });
    await page.waitForTimeout(300);
    const offNow = (id) => page.evaluate((i) => { const V = window.__velia, b = V.busy.lake.liveBoats.find((o) => o.id === i)?.phys.state, n = V.tessie.sim.state.nose; if (!b || !n) return null; const a = Math.atan2(n.x - b.x, -(n.z - b.z)) - b.heading; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI; }, id);
    const slot = (id) => page.evaluate((i) => { const s = document.querySelector(`#lk-tplay .tp-slot[data-skill=${i}]`), r = s.querySelector('.rg'); return { ink: s.dataset.ink, ring: +r.getAttribute('stroke-dasharray').split(' ')[0], full: +r.getAttribute('stroke-dasharray').split(' ')[1], shown: getComputedStyle(r).display !== 'none' }; }, id);
    const off0 = await offNow(laid);
    await page.keyboard.press('Digit2'); await page.waitForTimeout(150);
    const l1 = await page.evaluate(() => ({ lure: window.__velia.tessiePlay.stats().log.lure, ring: document.querySelector('#lk-tplay .tp-world .lr')?.getAttribute('visibility'), world: getComputedStyle(document.querySelector('#lk-tplay .tp-world')).display !== 'none' }));
    const r1 = await slot('lure');
    check(!!laid && l1.lure?.ids.includes(laid) && l1.lure.rangeM === 120 && l1.lure.curiousS === 12, `2 fires the Lure: the boat 90 m off is lured, 120 m, 12 s (${JSON.stringify(l1.lure)})`);
    check(l1.world && l1.ring === 'visible', `the lure's ring on the water (${JSON.stringify(l1)})`);
    check(r1.ink === 'amber' && r1.shown, `the Lure slot's ring runs amber (${JSON.stringify(r1)})`);
    await page.waitForTimeout(2350);
    if (process.env.TESSIE_RPG3_SHOT) await page.screenshot({ path: `${process.env.TESSIE_RPG3_SHOT}-lure.png` });
    const off2 = await offNow(laid), r2 = await slot('lure');
    check(off0 != null && off2 != null && off2 < off0 - 5, `the lured boat turned toward her within 2.5 s (${off0?.toFixed(0)}° → ${off2?.toFixed(0)}° off its bow)`);
    check(r2.ink === 'cool' && r2.ring < r2.full * 0.3, `then the ring cools, refilling (${JSON.stringify(r2)})`);
    // the Sonar: 3 pings; its rings under the hulls, the rim, the word
    await page.keyboard.press('Digit3'); await page.waitForTimeout(1000);
    const p1 = await page.evaluate(() => { const so = document.querySelector('#lk-tplay .tp-sonar'), w = document.querySelector('#lk-tplay .tp-world'); return { log: window.__velia.tessiePlay.stats().log.sonar, rim: +(so.dataset.rim ?? 0), ticks: so.querySelectorAll('.rim line').length, word: so.querySelector('.sw').textContent, marks: +(w.dataset.marks ?? 0), shown: [...w.querySelectorAll('.mk')].filter((e) => e.getAttribute('visibility') === 'visible').length }; });
    if (process.env.TESSIE_RPG3_SHOT) await page.screenshot({ path: `${process.env.TESSIE_RPG3_SHOT}-sonar.png` });
    const n3 = p1.log?.ids.length ?? 0;
    check(n3 >= 1 && p1.log.rangeM === 300 && p1.log.markS === 8, `3 pings: ${n3} boats within 300 m marked for 8 s (${JSON.stringify(p1.log)})`);
    check(p1.rim === n3 && p1.ticks === n3, `the SONAR dial's rim: a tick per marked boat (${p1.ticks} of ${n3})`);
    check(/^(300 M|HIDDEN)$/.test(p1.word), `the dial's word reads the ping's range (${p1.word})`);
    check(p1.marks >= 1 && p1.shown === p1.marks, `the marks in the world: a ring under each hull in view (${p1.marks} drawn)`);
    // the marks are world: every HUD box (each legend line, the two dials, the slots) lies inside a cut of the marks' mask
    const under = await page.evaluate(() => {
      const cuts = [...document.querySelectorAll('#lk-tplay .tp-world .cut rect')].map((r) => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') }));
      const masked = document.querySelector('#lk-tplay .tp-world .mk')?.closest('[mask]')?.getAttribute('mask');
      const boxes = [...document.querySelectorAll('#lk-tplay .tp-keys .kl, #lk-tplay .tp-sonar, #lk-tplay .tp-dial, #lk-tplay .tp-skills .tp-slot')].filter((e) => getComputedStyle(e).display !== 'none' && !e.closest('[hidden]')).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const inside = (b) => cuts.some((c) => b.left >= c.x && b.top >= c.y && b.right <= c.x + c.w && b.bottom <= c.y + c.h);
      return { masked, cuts: cuts.length, boxes: boxes.length, uncovered: boxes.filter((b) => !inside(b)).map((b) => [Math.round(b.left), Math.round(b.top)]) };
    });
    check(under.masked === 'url(#tp-wm)' && under.boxes >= 10 && under.uncovered.length === 0, `no world ring paints over the legend, the dials or the slots: each box is cut from the marks' mask (${JSON.stringify(under)})`);
    const r3 = await slot('sonar');
    check(r3.ink === 'amber' && r3.ring < r3.full, `the Sonar slot's ring runs amber while the marks last (${JSON.stringify(r3)})`);
    const so = await page.evaluate(() => { const r = document.querySelector('#lk-tplay .tp-slot[data-skill=sonar]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(so.x, so.y); await page.waitForTimeout(200);
    const p2 = await page.evaluate(() => window.__velia.tessiePlay.stats().log.sonar.at);
    check(p2 === p1.log.at, 'a click on the Sonar slot while it runs does nothing (no second ping)');
    await page.waitForTimeout(7500);
    const p3 = await page.evaluate(() => ({ rim: document.querySelector('#lk-tplay .tp-sonar').dataset.rim, word: document.querySelector('#lk-tplay .tp-sonar .sw').textContent, marks: document.querySelector('#lk-tplay .tp-world').dataset.marks }));
    check(p3.rim === '0' && p3.marks === '0' && /^(SONAR|HIDDEN)$/.test(p3.word), `after 8 s the marks are gone, the dial says SONAR again (${JSON.stringify(p3)})`);
    check(errors.length === 0, `phase 3: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- phase 4: Tail Surge ----
  for (const strong of [false, true]) {
    const SAVE4 = { ...SAVE, _v: 2, xp: 52, ranks: { dash: 1, lure: 1, sonar: 1, surge: 1, breach: 0 }, trials: { lure: 5, sonar: 5, surge: 5, breach: 5 } };
    const { ctx, page, errors } = await open(`${strong ? Q.replace('wind=3', 'wind=4') : Q}&tessierpg=1`, SAVE4);
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden && window.__velia.tessie.sim.state.nose, null, { timeout: 30000 }).then(() => true, () => false);
    check(inT, `phase 4${strong ? ' (strong wind)' : ''}: you are her`);
    await page.waitForTimeout(2500);
    const tag = strong ? 'strong wind' : 'phase 4';
    if (!strong) {
      // a busy-lake sailboat laid 20 m off her middle, 35° off her bow (in the camera's view), on her heading (she is at the surface)
      const laid = await page.evaluate(() => {
        const V = window.__velia, L = V.busy.lake, n = V.tessie.sim.state.nose, c = V.tessie.sim.state.centre, live = L?.liveBoats ?? []; if (!live.length) return null;
        const a = n.psi + 35 * Math.PI / 180, id = live[0].id; L.lay(id, { x: c[0] + Math.sin(a) * 20, z: c[1] - Math.cos(a) * 20, heading: n.psi, speed: 1.5 }); return id;
      });
      await page.waitForTimeout(400);
      const heel0 = await page.evaluate((i) => Math.abs(window.__velia.busy.lake.liveBoats.find((o) => o.id === i)?.phys.state.heel ?? 0) * 180 / Math.PI, laid);
      await page.keyboard.press('Digit4'); await page.waitForTimeout(400);
      const w1 = await page.evaluate(() => { const st = window.__velia.tessiePlay.stats(), s = document.querySelector('#lk-tplay .tp-slot[data-skill=surge]'); return { surge: st.log.surge, fx: st.rpg.surgeFx, ink: s.dataset.ink, ring: document.querySelector('#lk-tplay .tp-world .sr')?.getAttribute('visibility') }; });
      check(w1.surge?.rank === 1 && w1.surge.ringM === 40 && w1.fx?.phase === 'windup' && !w1.surge.slap, `4 winds up: rank 1, 40 m, no slap yet at 0.4 s (${JSON.stringify(w1)})`);
      check(w1.ink === 'amber' && w1.ring === 'hidden', `the Surge slot runs amber; no ring before the slap (${JSON.stringify({ ink: w1.ink, ring: w1.ring })})`);
      await page.waitForTimeout(1700);
      if (process.env.TESSIE_RPG4_SHOT) await page.screenshot({ path: `${process.env.TESSIE_RPG4_SHOT}-wave.png` });
      const w2 = await page.evaluate((i) => { const st = window.__velia.tessiePlay.stats(), w = document.querySelector('#lk-tplay .tp-world'); return { slap: st.log.surge.slap, ring: w.querySelector('.sr')?.getAttribute('visibility'), r: +(w.dataset.surge || 0), heel: Math.abs(window.__velia.busy.lake.liveBoats.find((o) => o.id === i)?.phys.state.heel ?? 0) * 180 / Math.PI }; }, laid);
      const h = w2.slap?.heels.find((x) => x.id === laid);
      // the boat's peak heel over the 2 s after this (the wave reaches it at its distance / 20 m/s)
      // and the ring's radius as it runs (read 2.1 s after the press it is only about 0.9 s into its 2 s run: about 18 m; it reaches
      // 40 m at 2 s, then fades); each read also checks the drawn ring against the wave's own clock (ringM / waveS = 20 m/s)
      const ringAt = () => page.evaluate(() => { const w = document.querySelector('#lk-tplay .tp-world'), fx = window.__velia.tessiePlay.stats().rpg.surgeFx; return { r: w.dataset.surge === '' || w.dataset.surge == null ? null : +w.dataset.surge, t: fx?.phase === 'wave' ? fx.t : null }; });
      const ring = { max: w2.r, off: [] };
      const ringRead = (q) => { if (q.r == null) return; ring.max = Math.max(ring.max, q.r); if (q.t != null) { const want = 40 * Math.min(1, Math.max(0, q.t - 1.2) / 2); if (Math.abs(q.r - want) > 3) ring.off.push([q.t, q.r]); } };
      for (let i = 0; i < 20; i++) { w2.heel = Math.max(w2.heel, await page.evaluate((id) => Math.abs(window.__velia.busy.lake.liveBoats.find((o) => o.id === id)?.phys.state.heel ?? 0) * 180 / Math.PI, laid)); ringRead(await ringAt()); await page.waitForTimeout(100); }
      for (let i = 0; i < 30 && ring.max < 40; i++) { const q = await ringAt(); if (q.r == null) break; ringRead(q); await page.waitForTimeout(100); }
      check(!!w2.slap && Math.abs(w2.slap.at - w1.surge.at - 1.2) < 0.15, `the slap 1.2 s after the press (${JSON.stringify(w2.slap && { at: w2.slap.at, press: w1.surge.at })})`);
      check(w2.ring === 'visible' && w2.r > 0 && ring.max === 40 && !ring.off.length, `the wave's ring on the water, running out to 40 m at 20 m/s (${w2.r} m at the first read, ${ring.max} m at most; off its clock: ${JSON.stringify(ring.off)})`);
      check(!!h && h.heelDeg > 15 && Math.abs(w2.heel - h.heelDeg) < 4 && w2.heel > heel0 + 8, `the boat ${h?.d} m off heels away from her (${heel0.toFixed(0)}° → ${w2.heel.toFixed(0)}°, the wave's ${h?.heelDeg}°)`);
      const so = await page.evaluate(() => { const r = document.querySelector('#lk-tplay .tp-slot[data-skill=surge]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.click(so.x, so.y); await page.waitForTimeout(200);
      const again = await page.evaluate(() => window.__velia.tessiePlay.stats().log.surge.at);
      check(again === w1.surge.at, 'a click on the Surge slot while it cools does nothing (no second slap)');
    } else {
      // the boat leaning most (about 20° in 21 kn, once the fleet has sailed 25 s) moved 9 m off her middle, 30° off her bow, in the
      // wind-up's last 0.5 s (kept there, its heel kept, the most-heeled re-picked each 50 ms); a slap that finds no boat past 20° is
      // tried again after the 30 s cooldown (up to four slaps: the gusts come and go)
      await page.waitForTimeout(25000);
      let mv = null, k = null;
      for (let tries = 0; tries < 4; tries++) {
        if (tries) await page.waitForTimeout(29000);
        await page.waitForFunction(() => (window.__velia.busy.lake?.liveBoats ?? []).some((b) => !b.knock && Math.abs(b.phys.state.heel) > 21 * Math.PI / 180), null, { timeout: 30000, polling: 50 }).catch(() => {});
        const at0 = await page.evaluate(() => window.__velia.tessiePlay.stats().log.surge?.at ?? null);
        await page.keyboard.press('Digit4'); await page.waitForTimeout(700);
        for (let i = 0; i < 12; i++) {
          const m = await page.evaluate(() => {
            const V = window.__velia, st = V.tessiePlay.stats(); if (st.log.surge?.slap) return null;   // slapped: leave it be
            const c = V.tessie.sim.state.centre, n = V.tessie.sim.state.nose, live = (V.busy.lake?.liveBoats ?? []).filter((b) => !b.knock);
            const b = live.sort((p, q) => Math.abs(q.phys.state.heel) - Math.abs(p.phys.state.heel))[0]; if (!b) return null;
            const q = b.phys.state, a = n.psi + 30 * Math.PI / 180; q.x = c[0] + Math.sin(a) * 9; q.z = c[1] - Math.cos(a) * 9;
            return { id: b.id, lean: +(q.heel * 180 / Math.PI).toFixed(1) };
          });
          if (!m) break; mv = m; await page.waitForTimeout(50);
        }
        await page.waitForTimeout(2600);
        k = await page.evaluate((i) => { const V = window.__velia, st = V.tessiePlay.stats(), b = V.busy.lake.liveBoats.find((o) => o.id === i); return { at: st.log.surge?.at, slap: st.log.surge?.slap, capsized: !!b?.knock?.capsized, wrecked: V.tessiePlay.bounty.state().byType.sail.wrecked }; }, mv?.id);
        if (k.at === at0) continue;   // (no new press: the cooldown)
        if (k.slap?.knock) break;
      }
      if (process.env.TESSIE_RPG4_SHOT) await page.screenshot({ path: `${process.env.TESSIE_RPG4_SHOT}-knock.png` });
      // the rule as the slap saw it (its lean then: a gust comes and goes in the 0.15 s after the move)
      const lean = k.slap?.knock?.lean ?? k.slap?.heels.find((x) => x.id === mv?.id)?.lean;
      if (k.slap?.knock) check(k.slap.knock.id === mv.id && k.slap.over.includes(mv.id) && k.capsized && k.wrecked === 10, `strong wind: the boat leaning ${lean}° 9 m off goes over and is scored (${JSON.stringify({ knock: k.slap?.knock, over: k.slap?.over, capsized: k.capsized, wrecked: k.wrecked })})`);
      else check(!!mv && Math.abs(lean) <= 20 && !k.capsized, `strong wind: the boat leaning only ${lean}° at the slap (not past 20°) only heels (${JSON.stringify(k.slap?.heels)})`);
    }
    check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- phase 5: Breach ----
  for (const slow of [true, false]) {
    const SAVE5 = { ...SAVE, _v: 2, xp: 52, ranks: { dash: 1, lure: 1, sonar: 1, surge: 1, breach: 0 }, trials: { lure: 5, sonar: 5, surge: 5, breach: 5 } };
    const { ctx, page, errors } = await open(`${Q}&tessierpg=1${slow ? '' : '&slowbreach=0'}`, SAVE5);
    const tag = slow ? 'phase 5' : 'phase 5 (?slowbreach=0)';
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden && window.__velia.tessie.sim.state.nose, null, { timeout: 30000 }).then(() => true, () => false);
    check(inT, `${tag}: you are her`);
    await page.waitForTimeout(2000);
    // 7 m down (the boats see her at 15 m there), then a busy-lake sailboat laid 45 m ahead, crossing her bow
    await page.evaluate(() => window.__velia.tessiePlay.pin({ nose: 7 }));
    await page.waitForFunction(() => window.__velia.tessiePlay.ctl.state.nose > 6, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => window.__velia.tessiePlay.pin(null));
    const laid = await page.evaluate(() => {
      const V = window.__velia, L = V.busy.lake, n = V.tessie.sim.state.nose, live = L?.liveBoats ?? []; if (!live.length) return null;
      const id = live[0].id; L.lay(id, { x: n.x + Math.sin(n.psi) * 45, z: n.z - Math.cos(n.psi) * 45, heading: n.psi + 2.1, speed: 2.5 }); return id;
    });
    await page.waitForTimeout(200);
    const w0 = await page.evaluate(() => window.__velia.tessiePlay.bounty.state().byType.sail.wrecked);
    await page.keyboard.down('Digit5'); await page.waitForTimeout(500);
    const r1 = await page.evaluate(() => { const st = window.__velia.tessiePlay.stats(), s = document.querySelector('#lk-tplay .tp-slot[data-skill=breach]'); return { b: st.log.breach, fx: st.rpg.breachFx, ink: s?.dataset.ink, trials: window.__velia.tessiePlay.bounty.state().trials.breach }; });
    check(r1.fx?.phase === 'run' && r1.b?.target === laid && r1.trials === 4 && r1.ink === 'amber', `${tag}: 5 held: the run at the laid boat, the slot amber, a free trial spent (${JSON.stringify({ fx: r1.fx, target: r1.b?.target, laid, trials: r1.trials, ink: r1.ink })})`);
    // held until the corners turn amber (a release now lands the arc on it), then let go. The release is made in the page on the
    // frame the corners turn amber (raf polling, the slot's own release as the key-up calls it): a key-up sent from here arrives a
    // round trip later, and under load that is a second or more of game time, long enough for the crew to see the run-up within
    // 25 m and bear away (the game's rule: she then lands where the boat was). The key-up itself follows and changes nothing.
    const amber = await page.waitForFunction(() => {
      const P = window.__velia.tessiePlay, fx = P.stats().rpg.breachFx;
      if (!fx?.near || !document.querySelector('#lk-tplay .tp-aim')?.hasAttribute('data-reach')) return false;
      return { released: P.releaseSlot('breach'), phase: fx.phase };
    }, null, { timeout: 8000, polling: 'raf' }).then((h) => h.jsonValue(), () => null);
    await page.keyboard.up('Digit5');
    check(!!amber?.released, `${tag}: the corners on the boat turn amber before the release (${JSON.stringify(amber)})`);
    let minK = 1, slowMs = 0, eyeMax = 0, shot = false, t0 = Date.now(), last = t0;
    for (let i = 0; i < 160; i++) {
      const s = await page.evaluate(() => { const V = window.__velia, st = V.tessiePlay.stats(), n = V.tessie.sim.state.nose, e = st.eye; return { k: st.rpg.slowK, fall: st.log.breach?.fall ?? null, phase: st.rpg.breachFx?.phase, d: e && n ? Math.hypot(e[0] - n.x, e[2] - n.z) : 0 }; });
      const now = Date.now(); if (s.k < 1) slowMs += now - last; last = now;
      minK = Math.min(minK, s.k); eyeMax = Math.max(eyeMax, s.d);
      if (s.k < 1 && !shot && process.env.TESSIE_RPG5_SHOT) { shot = true; await page.screenshot({ path: `${process.env.TESSIE_RPG5_SHOT}-apex.png` }); }
      if (s.fall) break;
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(1500);
    const r2 = await page.evaluate((i) => { const V = window.__velia, st = V.tessiePlay.stats(), b = V.busy.lake.liveBoats.find((o) => o.id === i); return { b: st.log.breach, knocked: !!b?.knock, wrecked: V.tessiePlay.bounty.state().byType.sail.wrecked, playK: V.tessie.playK }; }, laid);
    check(r2.b?.launch?.why === 'release' && !!r2.b.fall, `${tag}: let go: the arc and her fall (${JSON.stringify(r2.b?.launch)})`);
    check(r2.b?.fall?.hit === laid && r2.knocked && r2.wrecked === w0 + 1, `${tag}: her fall on its rail knocks it over, scored (${JSON.stringify({ fall: r2.b?.fall, knocked: r2.knocked, wrecked: r2.wrecked })})`);
    if (slow) check(minK === 0.5 && slowMs > 300 && slowMs < 2500, `${tag}: her clock 0.5x about the apex (${slowMs} ms of samples at ${minK})`);
    else check(minK === 1, `${tag}: no slow clock under ?slowbreach=0 (${minK})`);
    check(r2.playK === 1, `${tag}: her clock back to 1x after the fall`);
    check(eyeMax > 14, `${tag}: the eye eased back from her (${eyeMax.toFixed(1)} m)`);
    await page.keyboard.down('Digit5'); await page.waitForTimeout(200); await page.keyboard.up('Digit5');
    const again = await page.evaluate(() => window.__velia.tessiePlay.stats().log.breach.at);
    check(again === r1.b.at, `${tag}: 5 while it cools does nothing`);
    check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- the flag off: nothing of it ----
  {
    const { ctx, page, errors } = await open(`${Q}&tessierpg=0`, SAVE);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lk-log .title [data-tab]')].map((t) => t.dataset.tab));
    check(!tabs.includes('tessie'), `flag off: no Tessie tab (${tabs.join()})`);
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => ({ level: !!document.querySelector('#lk-tplay .tp-lv'), doors: document.querySelectorAll('#lk-tplay [data-door]').length, pe: getComputedStyle(document.querySelector('#lk-tplay .tp-sonar')).pointerEvents, bounty: window.__velia.tessiePlay.bounty }));
    check(!off.level && off.doors === 0 && off.pe === 'none' && off.bounty === null, `flag off: no level line, no door, no bounty (${JSON.stringify(off)})`);
    const four = await page.evaluate(() => ({ slots: [...document.querySelectorAll('#lk-tplay .tp-skills .tp-slot')].map((s) => s.dataset.skill ?? `empty${s.dataset.slot}`), lv: document.querySelector('#lk-tplay .tp-slot[data-skill=dash] .lv')?.textContent, pips: document.querySelectorAll('#lk-tplay .tp-slot .pp').length, halo: document.querySelectorAll('#lk-tplay [data-halo]').length, lines: document.querySelectorAll('#lk-tplay .tp-keys .kl').length }));
    check(four.slots.join() === 'dash,empty2,empty3,empty4' && four.lv === 'Lv 1' && four.pips === 0 && four.halo === 0 && four.lines === 6, `flag off: today's four slots, "Lv 1" on the dash, six legend lines (${JSON.stringify(four)})`);
    await page.keyboard.press('Digit2'); await page.keyboard.press('Digit3'); await page.keyboard.press('Digit4'); await page.waitForTimeout(1500);
    const off3 = await page.evaluate(() => ({ world: !!document.querySelector('#lk-tplay .tp-world'), rim: document.querySelectorAll('#lk-tplay .tp-sonar .rim line').length, lure: window.__velia.tessiePlay.stats().log.lure ?? null, surge: window.__velia.tessiePlay.stats().log.surge ?? null }));
    check(!off3.world && off3.rim === 0 && off3.lure === null && off3.surge === null, `flag off: 2, 3 and 4 do nothing, no world marks (${JSON.stringify(off3)})`);
    check(errors.length === 0, `flag off: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- no flag: the RPG is on by default where she is playable ----
  {
    const { ctx, page, errors } = await open(Q, SAVE);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lk-log .title [data-tab]')].map((t) => t.dataset.tab));
    check(tabs.includes('tessie'), `no flag: the Logbook's Tessie tab (${tabs.join()})`);
    await page.evaluate(() => window.__velia.tessiePlay.become('menu'));
    await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie' && !document.querySelector('#lk-tplay .tp-sonar')?.hidden, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    const on = await page.evaluate(() => ({ level: !!document.querySelector('#lk-tplay .tp-lv'), slots: [...document.querySelectorAll('#lk-tplay .tp-skills .tp-slot')].map((s) => s.dataset.skill ?? 'empty'), bounty: !!window.__velia.tessiePlay.bounty }));
    check(on.level && on.bounty && on.slots.join() === 'dash,lure,sonar,surge,breach', `no flag: her level line, the bounty, five slots (${JSON.stringify(on)})`);
    check(errors.length === 0, `no flag: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
