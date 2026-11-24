// Leaving the fireworks and choosing them (owner, 2026-11-18), on a live v2 page (Sail, desktop 1280 × 720):
//   no beacon        "When I click Fireworks, I always see a huge beacon beam to the sky on the water … no need to do that":
//                    the time menu's Fireworks sets no target and lights no beacon; a target the player set before stays as it was
//   leaving the show "If I switch to Fireworks first, then switch to another time, say Golden, the last fireworks are left in the
//                    sky": after Golden hour is picked mid-show, no star, smoke, flash or post pass is left (the module's state and
//                    the GPU side's counts, frame by frame), the shells' voices stop;
//                    Fireworks picked again mid-show starts clean (the old bursts gone at the cut, the show again from its start);
//                    Golden → Fireworks starts clean too
//   the jump         "jump straight there with a short fade" (owner, 2026-11-18): every pick fades to dark, cuts the clock, fades
//                    back in (v2/ui/dayClock.js); Fireworks picked at night (22:30 → the next 21:44) shows no bright frame: the
//                    composited frames' mean luminance (the page's screencast, the veil included) never rises over the night's
//                    own during the switch, and the show starts clean
// Stills: FW_STILLS=<dir> [FW_TAG=before|after] writes golden-after-leave-<tag>.png and fireworks-pick-<tag>.png (1280 × 720).
// Run by `npm run test:pages:v2 -- fireworksLeave`, or node v2/tests/pages/fireworksLeave.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const STILLS = process.env.FW_STILLS || null, TAG = process.env.FW_TAG || 'now';
if (STILLS) mkdirSync(STILLS, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const frames = (page, n = 3) => page.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// the show's numbers now: the state (stars live and drawn, smoke, the flash), the GPU side (dispatched, drawn, post, glow), the sound
const FW = (page) => page.evaluate(() => {
  const V = window.__velia, F = V.fireworks, st = F.state.stats(), g = F.gpu.stats, snd = F.audio?.sound?.stats?.() ?? null;
  return { showT: F.showT, live: st.live, drawn: st.drawn, puffs: st.puffs, spawned: st.spawned, flash: F.state.flash.sum.reduce((a, b) => a + b, 0), active: F.state.active,
    gpu: { dispatched: g.dispatched, drawn: g.drawn, puffs: g.puffs, post: !!g.post, glow: !!g.glow, reflect: !!g.reflect }, voices: snd?.live ?? null, ctx: snd?.state ?? null,
    hour: V.clock.hour, leaves: V._stats().fireworks?.leaves ?? null };
});
const BEACON = (page) => page.evaluate(() => { const B = window.__velia.beacon, s = B?.state?.() ?? null; return { mark: B?.mark?.mark ? { ...B.mark.mark } : null, visible: !!s?.visible, kind: s?.kind ?? null, key: s?.key ?? null }; });
// a time pick's jump (owner, 2026-11-18: a short fade to dark, the cut, the fade back in; v2/ui/dayClock.js): the cut's frame, and
// the landing (the fade over): the show's numbers on its first frame
const cutSince = (page, cuts0) => page.waitForFunction((c) => window.__velia.clock.cuts > c, cuts0, { timeout: 20000, polling: 'raf' });
const cuts = (page) => page.evaluate(() => window.__velia.clock.cuts);
const landed = async (page) => { await page.waitForFunction(() => !window.__velia.m4.ui.dayClock.switching && !window.__velia.clock.gliding, null, { timeout: 20000, polling: 'raf' }); await frames(page, 2); return FW(page); };
const pick = (page, id) => page.evaluate((k) => window.__velia.m4.ui.dayClock.menu.pick(k), id);
// a pick to the show: the show's numbers on the cut's own frame (read in that frame's rAF) and on the landing; the show starts
// clean: a countdown with nothing in the air at the cut, then at most the first shell's launch when the fade is over (the clock
// lands 10 game s before it: 0.5 real s at Sail's pace, about the fade-in)
const toShow = async (page) => {
  const c0 = await cuts(page);
  const r = await pick(page, 'fireworks');
  const cut = await (await page.waitForFunction((c) => { const V = window.__velia; if (!(V.clock.cuts > c)) return null; const F = V.fireworks, st = F.state.stats();
    return { showT: F.showT, live: st.live, drawn: st.drawn, puffs: st.puffs, spawned: st.spawned, flash: F.state.flash.sum.reduce((a, b) => a + b, 0), gpuDrawn: F.gpu.stats.drawn, hour: V.clock.hour, cuts: V.clock.cuts - c }; }, c0, { timeout: 20000, polling: 'raf' })).jsonValue();
  const land = await landed(page);
  return { r, cut, land };
};
const cleanAtCut = (c) => c.cuts === 1 && c.showT != null && c.showT < 0 && c.showT > -1.5 && c.live === 0 && c.drawn === 0 && c.puffs === 0 && c.flash === 0 && c.gpuDrawn === 0;
const cleanLanding = (c, f) => f.showT != null && f.showT < 0.5 && f.live === 0 && f.puffs === 0 && f.flash === 0 && f.spawned - c.spawned <= 4;
const shot = async (page, name) => { const b = await page.screenshot(); if (STILLS) writeFileSync(join(STILLS, `${name}-${TAG}.png`), b); return b; };
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=sail&hour=19.25&fireworks=1&seed=1&attract=0&music=0&once=0&kayaks=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready === true && window.__velia.m4?.ui?.dayClock && window.__velia.fireworks && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000, polling: 200 });
  await page.keyboard.press('Shift');   // a gesture: the show's audio context may start
  return { page, errors };
}
// wait for the show to be up with bursts in the air (stars drawn, the post on)
const waitBursts = (page, minT = 12) => page.waitForFunction((m) => { const F = window.__velia.fireworks; return F.showT != null && F.showT > m && F.state.stats().drawn > 0 && F.gpu.stats.drawn > 0; }, minT, { timeout: 90000, polling: 200 }).then(() => true, () => false);

try {
  const { page, errors } = await open();
  // ---------------- Golden → Fireworks: no target, no beacon; the show starts clean ----------------
  {
    const b0 = await BEACON(page);
    check(!b0.mark && !b0.visible, `before: no target, no beacon (${JSON.stringify(b0)})`);
    const { r, cut, land: f1 } = await toShow(page);
    check(r === 'show', 'the time menu\'s Fireworks: the show');
    await frames(page, 2);
    const b1 = await BEACON(page);
    await shot(page, 'fireworks-pick');
    check(!b1.mark && !b1.visible && b1.kind == null, `Fireworks sets no target and lights no beacon (${JSON.stringify(b1)})`);
    check(cleanAtCut(cut), `Golden → Fireworks: one cut, a countdown with nothing in the air (${JSON.stringify(cut)})`);
    check(cleanLanding(cut, f1), `Golden → Fireworks starts clean: the fade over by the first shell, no stars, smoke or flash (${JSON.stringify(f1)})`);
  }
  // ---------------- a target the player set stays as it was ----------------
  {
    const at = await page.evaluate(() => { const s = window.__velia.boat.state; return window.__velia.beacon.mark.set(s.x + 300, s.z - 300); });
    await frames(page, 4);
    const before = await BEACON(page);
    await pick(page, 'fireworks'); await page.waitForTimeout(2500); await frames(page, 4);
    const after = await BEACON(page);
    check(before.visible && before.kind === 'sail' && after.mark && Math.abs(after.mark.x - at.x) < 1e-6 && Math.abs(after.mark.z - at.z) < 1e-6 && after.key === before.key,
      `the player's own target stays (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
    await page.evaluate(() => window.__velia.beacon.mark.clear());
  }
  // ---------------- Fireworks → Fireworks mid-show: the old bursts gone at once, the show again from its start ----------------
  {
    const up = await waitBursts(page, 14);
    const f0 = await FW(page);
    check(up && f0.live > 0 && f0.gpu.post, `the show is up: bursts in the air, the post on (${JSON.stringify(f0)})`);
    const { cut, land: f1 } = await toShow(page);
    check(cleanAtCut(cut), `Fireworks again: the old bursts gone at the cut, under the fade (${JSON.stringify(cut)})`);
    check(cleanLanding(cut, f1), `Fireworks again: the show from its start, 10 game s before the first shell (${JSON.stringify(f1)})`);
  }
  // ---------------- Fireworks → Golden mid-show: nothing left in the sky, no post, no sound ----------------
  {
    const up = await waitBursts(page, 14);
    const f0 = await FW(page);
    check(up && f0.live > 0 && f0.puffs > 0 && f0.gpu.post, `the show is up again: stars, smoke, the post (${JSON.stringify(f0)})`);
    const c1 = await cuts(page);
    await pick(page, 'golden');
    await cutSince(page, c1); await frames(page, 6);
    const f1 = await FW(page);
    check(f1.hour > 19 && f1.hour < 19.5 && f1.showT == null, `Golden hour: the show clock is off (${f1.hour.toFixed(3)}, ${f1.showT})`);
    check(f1.live === 0 && f1.drawn === 0 && f1.puffs === 0 && f1.flash === 0 && !f1.active, `no star, smoke or flash left in the state (${JSON.stringify(f1)})`);
    check(f1.gpu.dispatched === 0 && f1.gpu.drawn === 0 && f1.gpu.puffs === 0 && !f1.gpu.post && !f1.gpu.glow && !f1.gpu.reflect, `the GPU side draws and posts nothing (${JSON.stringify(f1.gpu)})`);
    check(f1.voices == null || f1.voices === 0, `no shell's voice plays (${f1.voices}, context ${f1.ctx})`);
    await shot(page, 'golden-after-leave');
    // frame by frame for 30 frames: nothing of the show is dispatched, drawn or posted (the post pass encodes nothing)
    const rows = await page.evaluate(() => new Promise((ok) => { const out = []; const f = () => { const F = window.__velia.fireworks, g = F.gpu.stats; out.push(g.dispatched + g.drawn + g.puffs + (g.post ? 1 : 0) + (g.glow ? 1 : 0) + (g.reflect ? 1 : 0) + F.state.drawn); if (out.length >= 30) ok(out); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    check(rows.every((x) => x === 0), `30 frames on: nothing of the show dispatched, drawn or posted (${rows.join(',')})`);
    await page.waitForTimeout(1500); await frames(page, 3);
    const f2 = await FW(page);
    check(f2.live === 0 && f2.gpu.drawn === 0 && !f2.gpu.post, `1.5 s later still nothing (${JSON.stringify(f2)})`);
  }
  // ---------------- Night → Fireworks: a fade to dark and a jump a day on, no daylight frame; the show starts clean ----------------
  {
    const c0 = await cuts(page);
    await pick(page, 'night');
    await landed(page);
    const n0 = await FW(page);
    check(await cuts(page) === c0 + 1 && n0.hour >= 22.5 && n0.hour < 22.6, `Night: one cut to 22:30 under the fade (${n0.hour.toFixed(3)})`);
    await page.waitForTimeout(800); await frames(page, 4);
    // the composited frames (the canvas and the veil) from the screencast, before, through and after the switch
    const cdp = await page.context().newCDPSession(page);
    const shots = []; let phase = 'before';
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => { shots.push({ data, phase }); cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 320, maxHeight: 180, everyNthFrame: 1 });
    await page.waitForTimeout(700);
    phase = 'during';
    const { r, cut, land: f1 } = await toShow(page);
    check(r === 'show', 'Night → Fireworks: the show');
    phase = 'after';
    await page.waitForTimeout(700);
    await cdp.send('Page.stopScreencast'); await cdp.detach();
    check(cleanAtCut(cut) && cut.hour > 21.7 && cut.hour < 21.74, `Night → Fireworks: one cut a day on to 21:43:50, a countdown with nothing in the air (${JSON.stringify(cut)})`);
    check(cleanLanding(cut, f1), `Night → Fireworks starts clean (${JSON.stringify(f1)})`);
    // each frame's mean luminance (Rec. 709 on sRGB, 0..1), decoded on a blank page
    const dec = await browser.newPage();
    const lum = await dec.evaluate(async (list) => {
      const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
      const out = [];
      for (const b64 of list) {
        const im = new Image(); im.src = `data:image/jpeg;base64,${b64}`; await im.decode();
        c.width = im.width; c.height = im.height; g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        out.push(s / (d.length / 4) / 255);
      }
      return out;
    }, shots.map((x) => x.data));
    await dec.close();
    const by = (ph) => lum.filter((_, i) => shots[i].phase === ph);
    const before = by('before'), during = by('during'), after = by('after');
    const ref = Math.max(...before, ...after), peak = Math.max(...during);
    const r3 = (a) => a.map((x) => x.toFixed(3)).join(',');
    console.log(`  luminance: before ${r3(before)} | during ${r3(during)} | after ${r3(after)}`);
    check(before.length >= 3 && during.length >= 8 && after.length >= 3, `the screencast sampled the switch (${before.length} | ${during.length} | ${after.length} frames)`);
    check(peak <= ref * 1.15 + 0.01, `no bright frame during the switch: peak ${peak.toFixed(3)} against the night's ${ref.toFixed(3)}`);
    check(Math.min(...during) < Math.min(...before) * 0.5 + 0.005, `the switch goes dark under the veil (lowest ${Math.min(...during).toFixed(3)})`);
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  await page.close();
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
