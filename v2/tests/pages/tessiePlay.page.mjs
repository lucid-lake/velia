// Play as Tessie on the real page (owner, 2026-11-20, every default approved):
//   the panel: the waters row is a plain label, one conditions row (the clock, the weather, the wind); the Boat plate offers Tessie; picked, the
//     mode pill goes (one way to play: owner, 2026-11-20) and Set sail reads Dive in; back on the Halcyon the pill and its lit mode return; Dive in starts you as her (the menu's entry), the Halcyon 150 m off
//     with the skipper aboard, a sailboat laid ahead within 10 s
//   the swap: she shows herself near the boat and the skipper's line says "Tessie's up. [T] to be her." (no pill); T swaps you in (her dial, the folded cockpit's flag),
//     T swaps back (the boat's hands again)
//   the controls (the owner's final scheme; phase 2a's climb rate): C near or far; a drag down and W take her under and the eye
//     goes under with her (the eye-under flag), a drag up brings her up (the flag off); Q dives, E comes up; Space with nothing in
//     reach is the snap; a knockdown: a sailboat of the busy lake ahead, W and Space when the corners turn amber (locked): over past 55°, and still capsized on camera 30 s later (owner: "they stay capsized")
//   her mark: the live map's card on her water offers Be Tessie; it moves you there and you are her
//   a tablet: the line reads "Tessie's up. Tap here to be her." and is the tap target (44 px or more); the tap swaps her in
//   a phone: no play as Tessie at all (no hook, no Tessie cell, no line)
// Run by `npm run test:pages:v2 -- tessiePlay`, or node v2/tests/pages/tessiePlay.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { openMap } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const SEEN = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); localStorage.removeItem('lakeshore.course.v1'); } catch {} };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const Q = 'mode=sail&seed=1&wind=3&noload=1&attract=0&fv=1&once=0&hm=0&chatter=0&hour=13&stage=off&cinema=0';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open(q, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(SEEN);
  await page.goto(`${BASE}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
  return { ctx, page, errors };
}
// the skipper's line while she shows herself (v2/living/tessiePlayer.js createBeLine): up on the hint row, no pill
const BE_UP = () => window.__velia.tessiePlay?.pill && /Tessie.s up\./.test(document.querySelector('.lk-hint .row.in')?.textContent ?? '');
// the line's facts, read in the frame it is found (a loaded machine: a later read can meet the next line)
const beLine = (page) => page.waitForFunction(() => { const r = document.querySelector('.lk-hint .row.in'), b = r?.getBoundingClientRect();
  if (!window.__velia.tessiePlay?.pill || !/Tessie.s up\./.test(r?.textContent ?? '')) return null;
  return { text: (r?.textContent ?? '').replace(/\s+/g, ' ').trim(), caps: [...(r?.querySelectorAll('.cap') ?? [])].map((c) => c.textContent), tap: r?.dataset.tap != null, h: Math.round(b?.height ?? 0), top: Math.round(b?.top ?? -1),
    pe: r ? getComputedStyle(r).pointerEvents : null, barB: Math.round(document.querySelector('.lk-view')?.getBoundingClientRect().bottom ?? -1), pill: !!document.querySelector('#lk-tplay .tp-be') }; }, null, { timeout: 30000 }).then((h) => h.jsonValue(), () => ({}));
const stats = (page) => page.evaluate(() => window.__velia.tessiePlay?.stats() ?? null);
try {
  // ---- the panel and Dive in ----
  {
    const { ctx, page, errors } = await open('seed=1&hour=13&tessie=1&cinema=0');
    await page.waitForFunction(() => document.querySelector('#lk-load')?.dataset.state === 'home' && document.querySelector('.lk-ledger [data-lr=vessel]'), null, { timeout: 120000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lk-ledger > .lr')].filter((r) => !r.hidden).map((r) => ({ id: r.dataset.lr, tag: r.tagName, ch: !!r.querySelector('.ch'), v: r.querySelector('.v')?.textContent })));
    check(rows.length === 4 && rows[0].id === 'waters' && rows[0].tag === 'DIV' && !rows[0].ch, `panel: the waters row is a plain label, no chevron (${JSON.stringify(rows[0])})`);
    check(rows[3]?.id === 'cond' && /\d{1,2}:\d\d · \w+/.test(rows[3].v ?? ''), `panel: one conditions row, the clock and the weather (${rows[3]?.v})`);
    await page.click('.lk-ledger [data-lr=waters]');
    check(await page.evaluate(() => document.getElementById('lk-cond')?.hidden !== false), 'panel: the waters label opens no plate');
    await page.click('.lk-ledger [data-lr=cond]');
    const caps = await page.evaluate(() => [...document.querySelectorAll('#lk-cond .cap')].map((c) => c.textContent));
    check(caps.join('|') === 'Time of day|Weather|Wind', `panel: the conditions row opens the captioned plate (${caps.join(' · ')})`);
    //: the vessel row is two buttons, Halcyon | Tessie (icon + name), the chosen one filled; no plate
    const vb = await page.evaluate(() => [...document.querySelectorAll('.lk-ledger [data-lr=vessel] [data-vb]')].map((b) => ({ id: b.dataset.vb, name: b.textContent.trim(), icon: !!b.querySelector('svg'), on: b.getAttribute('aria-checked'), role: b.getAttribute('role'), bg: getComputedStyle(b).backgroundColor, tab: b.tabIndex })));
    check(vb.map((b) => `${b.id}:${b.name}:${b.on}`).join() === 'halcyon:Halcyon:true,tessie:Tessie:false' && vb.every((b) => b.icon && b.role === 'radio') && vb[0].bg !== vb[1].bg && vb[0].tab === 0 && vb[1].tab === -1, `panel: two buttons, Halcyon | Tessie, icon and name, the chosen one filled, one tab stop (${JSON.stringify(vb)})`);
    const pick = async (id) => { await page.click(`.lk-ledger [data-vb=${id}]`); await page.waitForTimeout(300); };
    await pick('tessie');
    check(await page.evaluate(() => document.getElementById('lk-cond')?.hidden !== false && document.querySelector('.lk-ledger [data-vb=tessie]').getAttribute('aria-checked') === 'true'), 'panel: a press on Tessie picks her at once (no plate)');
    await pick('halcyon');
    await page.focus('.lk-ledger [data-vb=halcyon]'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const kb = await page.evaluate(() => ({ focus: document.activeElement?.dataset.vb, on: document.querySelector('.lk-ledger [data-vb=tessie]').getAttribute('aria-checked') }));
    check(kb.focus === 'tessie' && kb.on === 'true', `panel: → moves to Tessie, Enter picks her (${JSON.stringify(kb)})`);
    await pick('halcyon');
    const lit = () => page.evaluate(() => ({ shown: [...document.querySelectorAll('.lk-pick')].filter((b) => b.getClientRects().length).map((b) => b.dataset.mode), lit: document.querySelector('.lk-pick[aria-checked=true]')?.dataset.mode }));
    await page.click('.lk-pick[data-mode=cruise]'); await page.waitForTimeout(200);
    await pick('halcyon'); await pick('tessie');
    const p = await page.evaluate(() => ({ row: document.querySelector('.lk-ledger [data-vb][aria-checked=true]')?.textContent.trim(), pill: !!document.querySelector('.lk-sheet .lk-row.plan')?.getClientRects().length,
      modes: [...document.querySelectorAll('.lk-pick')].filter((b) => b.getClientRects().length).length, go: document.querySelector('.lk-links .lk-go')?.getAttribute('aria-label'),
      after: getComputedStyle(document.querySelector('.lk-links .lk-go .pq'), '::after').content, hunt: /hunt|swim/i.test(document.querySelector('#lk-load .lk-card')?.innerText ?? '') }));
    check(p.row === 'Tessie' && !p.pill && p.modes === 0 && !p.hunt, `panel: Tessie picked, no mode pill at all (one way to play) (${JSON.stringify(p)})`);
    await pick('halcyon');
    const back = await lit();
    check(back.shown.join() === 'cruise,sail,regatta' && back.lit === 'cruise', `panel: back on the Halcyon, Cruise · Sail · Regatta return with the mode lit before (${JSON.stringify(back)})`);
    await pick('tessie');
    check(p.go === 'Dive in' && /Dive in/.test(p.after), `panel: the button reads Dive in (${p.go}, ${p.after})`);
    await page.click('.lk-links .lk-go');
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie', null, { timeout: 120000 }).then(() => true, () => false);
    const s = await stats(page);
    check(inT && s?.entry === 'menu' && s.fleeOn, `Dive in: you are her, the skipper sails the Halcyon (${s?.entry}, flee ${s?.fleeOn})`);
    await page.waitForFunction(() => !!window.__velia.tessie.sim.state.nose, null, { timeout: 10000 }).catch(() => {});
    const off = await page.evaluate(() => { const T = window.__velia.tessie.sim.state.nose, b = window.__velia.boat.sim.state; return Math.hypot(T.x - b.x, T.z - b.z); });
    check(off > 90 && off < 260, `Dive in: the Halcyon about 150 m off (${off.toFixed(0)} m)`);
    await page.waitForTimeout(9000);
    const s2 = await stats(page);
    check(!!s2?.log?.reach, `Dive in: a sailboat laid ahead of her within 10 s (${JSON.stringify(s2?.log?.reach)})`);
    check(errors.length === 0, `panel: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- the line, T in, a knockdown, T back ----
  {
    const { ctx, page, errors } = await open(`${Q}&tessie=now`);
    await page.evaluate(() => { const hm = window.__velia.m4?.front?.home; if (hm?.isOpen) hm.close(); });
    const up = await page.waitForFunction(BE_UP, null, { timeout: 120000 }).then(() => true, () => false);
    check(up, 'swap: she shows herself near the boat, the skipper\'s line says so');
    // owner, 2026-11-24: one skipper line, not a pill: "Tessie's up. [T] to be her.", the cap inline, on the hint row under the bar
    const be = await beLine(page);
    check(/^Tessie's up\. ?T to be her\.$/.test(be.text) && be.caps.join() === 'T' && !be.tap && !be.pill && be.barB > 0 && be.top >= be.barB && be.top < be.barB + 60, `the line: "Tessie's up. [T] to be her." on the skipper's row under the bar, no pill (${JSON.stringify(be)})`);
    // owner, 2026-11-21: the boat's instrument plate (COG, TWS, TWA, VMG, HEEL, RUD) showed while you were her. Pro puts it up first
    const boatHud = () => page.evaluate(() => ['.lk-nav', '.lk-pro', '.lk-cp', '.lk-thr', '.lk-guide', '.lk-calm-mark'].filter((q) => [...document.querySelectorAll(q)].some((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05)));
    await page.evaluate(() => window.__velia.m4.ui.setPro(true)); await page.waitForTimeout(1200);
    const hud0 = await boatHud();
    check(hud0.includes('.lk-nav'), `the boat's HUD: the instrument plate up as the Halcyon with Pro (${JSON.stringify(hud0)})`);
    await page.keyboard.press('KeyT');
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie', null, { timeout: 8000 }).then(() => true, () => false);
    const h = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-tessie-play'), dial: !document.querySelector('#lk-tplay .tp-dial')?.hidden, sw: !!document.querySelector('.lk-view .lk-tsw'), driven: window.__velia.boat.sim.driven }));
    check(inT && h.attr && h.dial && h.sw && h.driven, `swap: T swaps you in: her dial, the Halcyon | Tessie switch, the skipper has the boat (${JSON.stringify(h)})`);
    // decisions A + D: Halcyon | Tessie, Tessie lit amber
    const sw = await page.evaluate(() => [...document.querySelectorAll('.lk-view .lk-tsw .seg')].map((b) => ({ id: b.dataset.tw, on: b.classList.contains('on'), color: getComputedStyle(b).color })));
    check(sw.map((x) => x.id).join() === 'halcyon,tessie' && sw[1]?.on && !sw[0]?.on && /247, 192, 96|255, 160, 104/.test(sw[1]?.color ?? ''), `the switch: Halcyon | Tessie, Tessie lit amber (${JSON.stringify(sw)})`);
    // her first line is the skipper's line: the hint row, its own caps, the lean kind (no line of her own)
    const tipped = await page.waitForFunction(() => window.__velia.tessiePlay.stats().log.tips.includes('tip.tessie.swim') && [...document.querySelectorAll('.lk-hint .row .cap')].some((c) => c.textContent === 'W'), null, { timeout: 30000 }).then(() => true, () => false);
    const line = await page.evaluate(() => ({ text: document.querySelector('.lk-hint .row')?.textContent ?? '', caps: [...document.querySelectorAll('.lk-hint .row .cap')].map((c) => c.textContent), own: !!document.querySelector('#lk-tplay .tp-line') }));
    check(tipped && !line.own && line.caps.includes('SPC'), `her tip on the skipper's line with caps, no .tp-line (${JSON.stringify(line)})`);
    await page.waitForTimeout(600);
    const hud1 = await boatHud();
    check(hud1.length === 0, `as Tessie: no boat instrument, trim readout, cockpit plate or coaching on screen (${JSON.stringify(hud1)})`);
    await page.evaluate(() => window.__velia.m4.ui.setPro(false));   // her own checks below run as before (Pro back on before she is given back)
    //: the HUD family at 1280 × 720: DEPTH bottom left, SONAR bottom right, the skills row bottom centre, her keys on the right edge above the sonar
    await page.waitForTimeout(400);
    const hud = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(innerWidth - b.right), b: Math.round(innerHeight - b.bottom) }; };
      return { vw: innerWidth, vh: innerHeight, depth: r('#lk-tplay .tp-dial'), sonar: r('#lk-tplay .tp-sonar'), skills: r('#lk-tplay .tp-skills'), legend: r('#lk-tplay .tp-keys'), legendCls: document.querySelector('#lk-tplay .tp-keys')?.className, rowOp: +getComputedStyle(document.querySelector('#lk-tplay .tp-keys .kl') ?? document.body).opacity, slots: document.querySelectorAll('#lk-tplay .tp-slot').length, dash: document.querySelector('#lk-tplay .tp-slot.sk .nm')?.textContent, lv: document.querySelector('#lk-tplay .tp-slot.sk .lv')?.textContent, empty: document.querySelectorAll('#lk-tplay .tp-slot.empty').length, rows: document.querySelectorAll('#lk-tplay .tp-keys .kl').length }; });
    check(hud.depth && hud.depth.x === 22 && hud.depth.b === 22 && hud.depth.w === 132, `HUD: DEPTH bottom left (${JSON.stringify(hud.depth)})`);
    check(hud.sonar && hud.sonar.r === 22 && hud.sonar.b === 22 && hud.sonar.w === 132, `HUD: SONAR bottom right (${JSON.stringify(hud.sonar)})`);
    check(hud.skills && Math.abs(hud.skills.x + hud.skills.w / 2 - hud.vw / 2) <= 2 && hud.skills.b <= 40 && hud.slots === 4 && hud.empty === 3 && /DASH/.test(hud.dash ?? '') && hud.lv === 'Lv 1', `HUD: the skills row bottom centre, DASH ⇧ Lv 1 and three empty slots (${JSON.stringify({ s: hud.skills, d: hud.dash, lv: hud.lv })})`);
    check(hud.legend && hud.legend.r >= 28 && hud.legend.r <= 56 && hud.legend.b >= 22 + 132 && hud.rows === 6 && /lk-edgepair/.test(hud.legendCls) && Math.abs(hud.rowOp - 0.6) < 0.02, `HUD: her keys are Sail's legend: the --lk-mx margin, above the sonar, six lines at 60 % (${JSON.stringify({ l: hud.legend, c: hud.legendCls, o: hud.rowOp })})`);
    // Setup › key hints off hides her legend, as Sail's
    await page.evaluate(() => window.__velia.settings().set('keyHints', false)); await page.waitForTimeout(300);
    const hintsOff = await page.evaluate(() => { const e = document.querySelector('#lk-tplay .tp-keys'); return !!e && (e.hidden || !e.classList.contains('on')); });
    await page.evaluate(() => window.__velia.settings().set('keyHints', true)); await page.waitForTimeout(300);
    const hintsOn = await page.evaluate(() => document.querySelector('#lk-tplay .tp-keys')?.classList.contains('on'));
    check(hintsOff && hintsOn, `key hints off hides her legend, on shows it (${hintsOff}, ${hintsOn})`);
    // the dash: Shift's press runs the ring amber, then it cools
    await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.press('ShiftLeft'); await page.waitForTimeout(400);
    const d1 = await page.evaluate(() => ({ ink: document.querySelector('#lk-tplay .tp-slot.sk')?.dataset.ink, dash: window.__velia.tessiePlay.stats().ctl.dash }));
    await page.waitForTimeout(2000);
    const d2 = await page.evaluate(() => document.querySelector('#lk-tplay .tp-slot.sk')?.dataset.ink);
    await page.keyboard.up('KeyW');
    check(d1.ink === 'amber' && d1.dash && d2 === 'cool', `HUD: Shift dashes, the DASH ring runs amber, then cools (${JSON.stringify(d1)} → ${d2})`);
    // the skills row is an RPG bar (owner, 2026-11-21): the number on each slot, 1 dashes like Shift, a click on the slot dashes (a mouse too), one cooldown for all
    const kn = await page.evaluate(() => [...document.querySelectorAll('#lk-tplay .tp-slot .kn')].map((e) => e.textContent));
    check(kn.join('|') === '1 · ⇧|2|3|4', `HUD: slot labels (${kn.join('|')})`);
    await page.keyboard.down('KeyW'); await page.waitForFunction(() => document.querySelector('#lk-tplay .tp-slot.sk')?.dataset.ink === 'ready', null, { timeout: 12000 }).catch(() => {});   // the Shift dash's cooldown ends (6.3 s of sim time from its press; a fixed wall wait raced a slower frame rate)
    const cnt = () => page.evaluate(() => window.__velia.tessiePlay.stats().ctl.dash);
    await page.keyboard.press('Digit1'); await page.waitForTimeout(300);
    const k1 = await cnt();
    await page.keyboard.press('Digit2'); await page.keyboard.press('Digit1'); await page.waitForTimeout(300);   // 2: nothing; 1 in the cooldown: nothing more
    await page.waitForTimeout(6300);
    await page.locator('#lk-tplay .tp-slot.sk').click(); await page.waitForTimeout(300);
    const k2 = await cnt();
    await page.keyboard.up('KeyW');
    check(k1 && k2, `HUD: 1 dashes, then a click on the slot dashes once the cooldown is over (${k1}, ${k2})`);
    // C: first person, C again third person; the eye eased over 0.35 s; the 60° lens
    await page.keyboard.press('KeyC'); await page.waitForTimeout(600);
    const fp = await stats(page), fov = await page.evaluate(() => window.__velia.tessiePlay?.cam && window.__velia.tessiePlay.stats().viewK);
    await page.keyboard.press('KeyC'); await page.waitForTimeout(600);
    const tp = await stats(page);
    check(fp?.view === 'first' && fov > 0.99 && tp?.view === 'third' && tp.viewK < 0.01, `camera: C her eyes, C again behind her (${fp?.view} ${fov} → ${tp?.view} ${tp?.viewK})`);
    // phase 2a: the look sets her climb rate: a drag down past the guard and W take her under, and the eye goes under
    // with her (the eye-under flag, the water's frame); a drag up and W bring her up to the surface's catch (the eye back over the water,
    // the flag off: the frame above the water is the one it always was), and the look levels there (the assist)
    const look = () => page.evaluate(() => ({ look: window.__velia.tessiePlay.cam.state.look, pitch: window.__velia.tessiePlay.cam.pitch, nose: window.__velia.tessiePlay.stats().ctl.nose, under: window.__velia.under?.() ?? null, medium: window.__velia.tessiePlay.stats().under?.medium }));
    await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(700, 420, { steps: 6 }); await page.mouse.up();
    const l1 = await look();
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__velia.tessiePlay.stats().ctl.nose > 3 && window.__velia.under?.().depth > 0.6 && window.__velia.tessiePlay.stats().under?.medium === 'water', null, { timeout: 20000 }).catch(() => {});
    const l2 = { ...(await look()), want: (await stats(page)).ctl.noseWant };
    check(l1.pitch > 15 * Math.PI / 180 && l2.nose > 2.5, `look: a drag down (${(l1.pitch * 180 / Math.PI).toFixed(0)}°) and W take her under (${l2.nose.toFixed(1)} m, asked ${l2.want?.toFixed(1)})`);
    check(l2.medium === 'water' && l2.under?.on === true && l2.under.depth > 0.5 && l2.under.built['water-under'] && l2.under.built['terrain-under'] && l2.under.back?.back > 0, `under: the eye goes under with her: the flag on, the water's frame drawn (${JSON.stringify({ m: l2.medium, on: l2.under?.on, d: l2.under?.depth, back: l2.under?.back })})`);
    await page.mouse.move(700, 420); await page.mouse.down(); await page.mouse.move(700, 160, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(() => window.__velia.tessiePlay.stats().ctl.nose < 1.2 && !window.__velia.under?.().on, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
    const l3 = await look();
    check(l3.nose < 1.2 && l3.medium === 'air' && l3.under?.on === false && l3.under.depth < 0, `look: a drag up and W bring her up, the eye over the water, the flag off (${l3.nose.toFixed(1)} m, ${l3.medium}, ${l3.under?.depth})`);
    check(Math.abs(l3.look) < 8 * Math.PI / 180, `assist: at the surface's catch the look levels (${(l3.look * 180 / Math.PI).toFixed(1)}°)`);
    // E and Q: Q (held) takes her down at the cap, E brings her up; the dial reads 0–20 m
    await page.keyboard.down('KeyQ'); await page.waitForTimeout(5000); await page.keyboard.up('KeyQ');
    const q1 = await look();
    await page.keyboard.down('KeyE'); await page.waitForFunction(() => window.__velia.tessiePlay.stats().ctl.nose < 1.2, null, { timeout: 12000 }).catch(() => {}); await page.keyboard.up('KeyE');
    const e1 = await look();
    const legend = await page.evaluate(() => [...document.querySelectorAll('#lk-tplay .tp-keys .kl')].map((k) => `${k.querySelector('.w').textContent} ${[...k.querySelectorAll('.cap')].map((c) => c.textContent).join(' ')}${k.classList.contains('learned') ? '~' : ''}`).join(' · '));
    check(q1.nose > 1.8 && e1.nose < 1.2 && /Up \/ Down E Q/.test(legend), `keys: Q dives (${q1.nose.toFixed(1)} m), E comes up (${e1.nose.toFixed(1)} m); the legend "${legend}"`);
    // the gradual crossing (owner, 2026-11-20): Q at a drift takes the eye through the surface slowly; with it at the waterline the frame is
    // split per pixel (the split pass on), the pixels over the line by the air's path (the land and the sky), under it by the water's (its
    // blue); the eye's side flips once down, never flip-flopping
    await page.waitForFunction(() => window.__velia.under?.().on === false, null, { timeout: 10000 }).catch(() => {});   // the eye back over the water first (E's 4.5 m/s outruns the eye's 0.9 m/s through the surface)
    await page.evaluate(() => { window.__flips = 0; let last = null; const tick = () => { const u = window.__velia.under?.(); if (u && last != null && u.on !== last) window.__flips++; last = u?.on ?? null; if (window.__flips < 50) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.keyboard.down('KeyQ');
    const atLine = await page.waitForFunction(() => { const u = window.__velia.under?.(); return u && u.split && Math.abs(u.depth) < 0.2; }, null, { timeout: 15000, polling: 16 }).then(() => true, () => false);
    await page.keyboard.up('KeyQ');
    const shotBuf = atLine ? await page.screenshot({ clip: { x: 200, y: 0, width: 880, height: 720 } }) : null;
    const uLine = await page.evaluate(() => window.__velia.under?.());
    let split = null;
    if (shotBuf) {
      const { PNG } = await import('pngjs'); const png = PNG.sync.read(shotBuf);
      const band = (y0, y1) => { const m = [0, 0, 0]; let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < png.width; x += 4) { const k = (y * png.width + x) * 4; m[0] += png.data[k]; m[1] += png.data[k + 1]; m[2] += png.data[k + 2]; n++; } return m.map((v) => Math.round(v / n)); };
      split = { top: band(70, 200), bottom: band(560, 690) };
    }
    check(atLine && uLine?.split && split && split.bottom[2] > split.bottom[0] * 2 && split.bottom[2] > split.bottom[1] && (split.top[1] > split.bottom[1] + 15 || split.top[0] > split.bottom[0] + 15),
      `crossing: at the waterline the frame is split, the air's path over the line, the water's under it (${JSON.stringify({ d: uLine?.depth, split: uLine?.split, top: split?.top, bottom: split?.bottom })})`);
    await page.keyboard.down('KeyQ'); await page.waitForTimeout(1500); await page.keyboard.up('KeyQ');   // on down through the surface (the fast hunter's Q: she would rest with the eye at the line)
    await page.waitForTimeout(3000);
    await page.keyboard.down('KeyE'); await page.waitForTimeout(5000); await page.keyboard.up('KeyE');
    await page.waitForTimeout(1500);
    const flips = await page.evaluate(() => window.__flips);
    check(flips >= 1 && flips <= 4, `crossing: the eye's side flipped ${flips} times down and up (no flip-flop)`);
    // every Space press bites: the snap plays out of reach
    const b0 = await page.evaluate(() => window.__velia.tessie.sim.state.bites ?? 0);
    for (let k = 0; k < 2; k++) { await page.keyboard.press('Space'); await page.waitForTimeout(900); }
    const b1 = await page.evaluate(() => window.__velia.tessie.sim.state.bites ?? 0);
    check(b1 - b0 === 2, `bite: every Space press plays the bite (${b1 - b0} snaps for 2 presses)`);
    // Space with nothing in reach: the snap, no attack, steering never under 30 %
    await page.waitForTimeout(1500);   // (the cooldown: 0.8 s after a miss)
    await page.keyboard.press('Space'); await page.waitForTimeout(200);
    const sg = await stats(page);
    check(!sg.ctl.lunge && sg.ctl.bite?.kind === 'snap' && sg.ctl.steer >= 0.3, `bite: Space with nothing in reach is the snap, never an attack (${JSON.stringify({ lunge: sg.ctl.lunge, bite: sg.ctl.bite, steer: sg.ctl.steer })})`);
    await page.waitForTimeout(1500);
    // a sailboat of the busy lake laid 17 m ahead of her, head to wind (all but still); W, and Space once she is locked:
    // the rail bite
    const laid = await page.evaluate(() => {
      const V = window.__velia, L = V.busy.lake, n = V.tessie.sim.state.nose, b = V.boat.sim.state, from = b.heading + (b.trueWind?.angle ?? 0);
      const live = L?.liveBoats ?? []; if (!live.length) return null;
      const id = live[0].id; L.lay(id, { x: n.x + Math.sin(n.psi) * 17, z: n.z - Math.cos(n.psi) * 17, heading: from, speed: 0 });
      window.__kd = { id, max: 0, low: null }; const tick = () => { const B2 = L.boats.find((o) => o.id === id); const hh = Math.abs(B2?.phys?.state.heel ?? 0); window.__kd.max = Math.max(window.__kd.max, hh); if (window.__kd.max > 0.96 && hh < 0.26 && window.__kd.low == null) window.__kd.low = performance.now(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      return id;
    });
    check(!!laid, `knockdown: a busy-lake sailboat laid ahead of her (${laid})`);
    await page.keyboard.down('KeyW');
    const locked = await page.waitForFunction(() => window.__velia.tessiePlay.stats().aim?.locked, null, { timeout: 8000 }).then(() => true, () => false);
    check(locked, 'the lock: the corners amber within 10 m');
    await page.keyboard.press('Space');   // the bite: locked
    const hit = await page.waitForFunction(() => window.__velia.tessiePlay.stats().log.hits > 0, null, { timeout: 12000 }).then(() => true, () => false);
    await page.keyboard.up('KeyW');
    const k0 = await stats(page);
    check(hit, `knockdown: her rail bite lands (${JSON.stringify(k0?.log?.lastContact)}; ${JSON.stringify(k0?.log?.knocks)})`);
    await page.waitForFunction(() => window.__kd.max > 1.0, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(30000);
    const down = await page.evaluate(() => { const L = window.__velia.busy.lake, B2 = L.boats.find((o) => o.id === window.__kd.id); return { heel: Math.abs(B2?.phys?.state.heel ?? 0), capsized: !!B2?.knock?.capsized, seen: !!B2?.knock?.seen, target: window.__velia.tessiePlay.stats().aim?.id ?? null }; });
    const kd = await page.evaluate(() => window.__kd);
    check(kd.max > 55 * Math.PI / 180 && down.capsized && down.heel > 70 * Math.PI / 180, `knockdown: over to ${(kd.max * 180 / Math.PI).toFixed(0)}°, still capsized 30 s on (${JSON.stringify(down)})`);
    check(down.target !== kd.id, 'knockdown: a capsized boat is no target');
    await page.evaluate(() => window.__velia.m4.ui.setPro(true));
    await page.keyboard.press('KeyT');
    const back = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'boat' && !window.__velia.boat.sim.driven && !document.documentElement.hasAttribute('data-tessie-play'), null, { timeout: 8000 }).then(() => true, () => false);
    check(back, 'swap: T again gives you the Halcyon back (the boat\'s hands, the cockpit)');
    // the plate comes back at once (the Calm HUD may fade it again a few seconds later, as it does on any idle boat)
    const navBack = await page.waitForFunction(() => [...document.querySelectorAll('.lk-nav')].some((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05), null, { timeout: 3000 }).then(() => true, () => false);
    check(navBack, `given back: the instrument plate returns (${JSON.stringify(await boatHud())})`);
    check(errors.length === 0, `swap: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- a tablet's hands: the line tapped, the floating stick, Lunge and Dive ----
  {
    const { ctx, page, errors } = await open(`${Q}&tessie=now&touch=1`);
    await page.evaluate(() => { const hm = window.__velia.m4?.front?.home; if (hm?.isOpen) hm.close(); });
    // read the line and tap it in the frame it is found (a loaded machine: a later read can meet the next line)
    const tl0 = await page.waitForFunction(() => { const r = document.querySelector('.lk-hint .row.in'); if (!window.__velia.tessiePlay?.pill || !/Tessie.s up\./.test(r?.textContent ?? '')) return null;
      const b = r.getBoundingClientRect(), out = { text: r.textContent.replace(/\s+/g, ' ').trim(), caps: r.querySelectorAll('.cap').length, tap: r.dataset.tap != null, pe: getComputedStyle(r).pointerEvents, h: Math.round(b.height), pill: !!document.querySelector('#lk-tplay .tp-be') };
      const x = b.left + b.width / 2, y = b.top + b.height / 2; out.hit = document.elementFromPoint(x, y)?.closest?.('.lk-hint .row') === r;   // the line is what a finger there touches
      r.click(); return out; }, null, { timeout: 120000 }).then((h) => h.jsonValue(), () => ({}));
    check(tl0.text === "Tessie's up. Tap here to be her." && !tl0.caps && tl0.tap && tl0.pe === 'auto' && tl0.hit && tl0.h >= 44 && !tl0.pill, `tablet: "Tessie's up. Tap here to be her.", the line its own tap target, ${tl0.h} px high (${JSON.stringify(tl0)})`);
    const tapped = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie', null, { timeout: 8000 }).then(() => true, () => false);
    check(tapped && (await stats(page))?.entry === 'swap', 'tablet: a tap on the line swaps her in');
    const t = await page.evaluate(() => { const L = document.querySelector('#lk-tplay .tp-lunge'); return { shown: !document.querySelector('#lk-tplay .tp-touch')?.hidden, bite: L ? Math.round(L.getBoundingClientRect().width) : 0, word: L?.textContent, dive: !!document.querySelector('#lk-tplay .tp-dive'), keys: !!document.querySelector('#lk-tplay .tp-legend')?.getClientRects().length }; });
    check(t.shown && t.bite === 104 && t.word === 'Bite' && !t.dive && !t.keys, `tablet: the stick's zone, one Bite button (${t.bite} px), no Dive, no key line (${JSON.stringify(t)})`);
    const v0 = (await stats(page))?.ctl?.want ?? 0;
    await page.mouse.move(200, 500); await page.mouse.down(); await page.mouse.move(200, 430, { steps: 4 }); await page.waitForTimeout(2500);
    const v1 = (await stats(page))?.ctl?.want ?? 0;
    await page.mouse.up();
    check(v1 > v0 + 1, `tablet: the stick pushed up raises her pace (to her cruise) (${v0.toFixed(2)} → ${v1.toFixed(2)} m/s)`);
    //: a tablet: DEPTH and SONAR in the top corners under the bar, the skills row bottom centre; a tap on DASH dashes
    const tl = await page.evaluate(() => { const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), r: Math.round(innerWidth - b.right), b: Math.round(innerHeight - b.bottom) } : null; }; return { depth: r('#lk-tplay .tp-dial'), sonar: r('#lk-tplay .tp-sonar'), skills: r('#lk-tplay .tp-skills') }; });
    check(tl.depth?.x === 16 && tl.depth.y < 140 && tl.depth.w === 104 && tl.sonar?.r === 16 && tl.sonar.y < 140 && tl.skills?.b <= 40, `tablet: the dials in the top corners, the skills row at the foot (${JSON.stringify(tl)})`);
    await page.locator('#lk-tplay .tp-slot.sk').dispatchEvent('pointerdown'); await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__velia.tessiePlay.stats().ctl.dash), 'tablet: a tap on DASH dashes');
    const lk0 = await page.evaluate(() => window.__velia.tessiePlay.cam.state.look);
    await page.mouse.move(900, 300); await page.mouse.down(); await page.mouse.move(900, 380, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200);
    const lk1 = await page.evaluate(() => window.__velia.tessiePlay.cam.state.look);
    check(lk1 - lk0 > 0.2, `tablet: a drag outside the stick looks (${((lk1 - lk0) * 180 / Math.PI).toFixed(0)}° down)`);
    check(errors.length === 0, `tablet: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- Be Tessie from her chart mark ----
  {
    const { ctx, page, errors } = await open(`${Q}&tessie=1&start=700,-160&heading=265`);
    await page.waitForFunction(() => window.__velia.tessie?.render?.ready && window.__velia.m4?.ui?.services?.get?.('tessiePlay'), null, { timeout: 180000 }).catch(() => {});
    await openMap(page);
    await page.evaluate(() => window.__velia.m4.ui.services.get('liveChart').focus('ar-tessieWaters'));
    const more = await page.waitForFunction(() => !!document.querySelector('.lk-livechart .lkc-card [data-act=beTessie]'), null, { timeout: 8000 }).then(() => true, () => false);
    check(more, 'her mark: the card on her water offers Be Tessie');
    if (more) await page.click('.lk-livechart .lkc-card [data-act=beTessie]');
    const inT = await page.waitForFunction(() => window.__velia.tessiePlay?.as === 'tessie', null, { timeout: 20000 }).then(() => true, () => false);
    const s = await stats(page);
    const near = await page.evaluate(() => { const n = window.__velia.tessie.sim.state.nose; return Math.hypot(n.x - 300, n.z + 130); });
    check(inT && s?.entry === 'chart' && near < 420, `her mark: Be Tessie, and you are her in her water (${s?.entry}, ${near.toFixed(0)} m from its centre)`);
    check(errors.length === 0, `her mark: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- a phone never sees her ----
  {
    const { ctx, page } = await open('seed=1', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE });
    await page.waitForTimeout(6000);
    const ph = await page.evaluate(() => ({ hook: window.__velia.tessiePlay, cell: !!document.querySelector('[data-vb=tessie]:not([hidden] *)') && !document.querySelector('.lk-ledger [data-lr=vessel]')?.hidden, pill: !!document.getElementById('lk-tplay'), f: document.documentElement.dataset.fPlayTessie ?? null }));
    check(ph.hook === null && !ph.cell && !ph.pill, `phone: no play as Tessie at all (${JSON.stringify(ph)})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
