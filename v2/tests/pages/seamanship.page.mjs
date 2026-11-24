// #8, #14 on the real v2 page: the engine and the ground tackle (v2/sim/seamanship.js, v2/ui/seamanship.js) wired as v1's Sail wires
// them. The key (I) starts and stops the engine; + − step the throttle lever's notches (out of N it starts itself), 0 is N, the
// throttle column's own steps do the same, and the 3D cockpit's lever and key follow; the engine's sound is v1's engineAudio on
// the beds' bus; J drops the anchor (too fast the crew rounds her up and stops her first: the anchor seen, 2026-11-17), the splash's
// droplets at the bow and the Boat view's ease toward it, "Anchor's holding." on the hint row; too deep the skipper names the nearest
// anchorage; the cockpit's ANCHOR rocker lights, the chain runs (its sound), the anchor
// leaves the bow and the rode is drawn, the crew takes the sails down; it sets, the boat swings to it, the logbook records "at
// anchor"; J weighs it. MOOR wakes near a pier (the cockpit's cap shows it) and U ties up. No page errors.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/seamanship.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); localStorage.removeItem('lakeshore.logbook.v1'); } catch { /* blocked */ } }, SEEN);
  // the Sail start (11 m of water); ?speed=6: the sim at 6 × real time so the chain's minute passes in seconds
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&hm=0&chatter=0&windspeed=5&winddir=160&speed=6`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.sea && window.__velia.m4?.ui?.station?.cockpit && window.__velia.m4.ui.throttle && window.__velia.boat?.sim?.t > 1 && window.__velia.m4.logbook, null, { timeout: 240000 });
  const st = () => page.evaluate(() => { const V = window.__velia, s = V.sea.state, ui = V.m4.ui; const ck = ui.cockpitStates?.() ?? null;
    return { ...s, ctlThrottle: V.boat.sim.ctl.throttle, cockpit: ck && { engine: ck.engine, lever: ck.lever, anchor: ck.toggles.anchor, moor: ck.moor, sails: ck.toggles.sails }, pose: { drop: V.boat.sim.pose.anchorDrop ?? 0, shown: V.boat.sim.pose.anchorShown, links: V.anchorGear?.stats.links ?? 0, rode: V.boat.sim.pose.rode?.length ?? 0 }, hint: ui.hint.el?.textContent ?? '' }; });
  const until = (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);

  // ---- the engine: + out of N starts it (the starter, the catch), the notches, 0, I ----
  check((await st()).engine === 'off', 'the engine starts off');
  await page.keyboard.press('Equal');
  let s = await st();
  check(['cranking', 'running'].includes(s.engine) && s.lever === 0.3, `+ out of N: the starter cranks, SLOW AHEAD (${s.engine}, lever ${s.lever})`);
  await page.keyboard.press('Equal'); await page.keyboard.press('Equal');
  check(await until(() => window.__velia.sea.state.engine === 'running' && window.__velia.sea.state.rpm > 2500), 'two more notches: FULL AHEAD, the diesel spools up');
  s = await st();
  check(s.lever === 1 && s.ctlThrottle === 1 && s.thrust > 300, `the lever reaches the physics (ctl.throttle ${s.ctlThrottle}, thrust ${s.thrust} N)`);
  check(s.cockpit?.engine === 'running' && s.cockpit?.lever === 1, `the 3D cockpit's key and lever follow (${JSON.stringify(s.cockpit)})`);
  check(s.exhaust.alive > 5, `the wet exhaust spurts (${s.exhaust.alive} clots)`);
  const wash = await page.evaluate(() => { const T = window.__velia.wake.track; return T.boat.prop; });
  check(wash > 0.4, `the prop wash enters the wake (churn ${wash.toFixed(2)})`);
  const snd = await page.evaluate(async () => { const e = window.__velia.engineSound(); await e?.ready; return { mix: e?.mix?.gains ?? null, log: e?.log ?? null, on: window.__velia.beds?.live?.stats().on }; });
  check(!!snd.mix && snd.mix.run > 0.5 && !(snd.log?.length), `the engine's sound: v1's engineAudio on the beds (${JSON.stringify(snd)})`);
  // the throttle column's own step (the panel's lever): a notch astern from FULL is HALF
  await page.evaluate(() => window.__velia.m4.ui.throttle && window.__velia.sea.actions.step(-1));
  check((await st()).lever === 0.6, 'the throttle column\'s notch astern: HALF');
  await page.keyboard.press('Digit0');
  check((await st()).lever === 0, '0: N');
  await page.keyboard.press('KeyI');
  check(await until(() => !window.__velia.boat.sim.phys.engine.on), 'I: the engine stops');

  // ---- the anchor: too deep the nearest anchorage is named; J under way: the crew stops her and lets go ----
  await page.evaluate(() => { const V = window.__velia, say = V.sea.hooks.say; window.__said = []; V.sea.hooks.say = (id, k, d) => { window.__said.push(id); window.__saidD = d; return say(id, k, d); }; });
  const deep = await page.evaluate(() => { const V = window.__velia, s = V.boat.sim.phys.state, save = { x: s.x, z: s.z }; Object.assign(s, { x: 250, z: -150, u: 0, v: 0, yawRate: 0 }); const r = V.sea.actions.anchor(); Object.assign(s, save); return { r, said: window.__said.slice(), d: window.__saidD, hint: V.m4.ui.hint.el?.textContent ?? '' }; });
  check(deep.r === 'deep' && deep.said.includes('deepSpot') && / m (ahead|astern|to |off the )/.test(deep.d ?? ''), `too deep: the skipper names the nearest anchorage (${JSON.stringify(deep)})`);
  await page.evaluate(() => { window.__said.length = 0; const s = window.__velia.boat.sim.phys.state; s.u = 2.5; });
  await page.waitForTimeout(100);
  await page.keyboard.press('KeyJ');
  s = await st();
  let said = await page.evaluate(() => window.__said);
  check(s.mode === 'free' && said.includes('rounding') && !said.includes('fast'), `J under way: "Rounding up to anchor", no refusal (${JSON.stringify(said)})`);
  check(await until(() => window.__velia.sea.state.mode === 'anchor', null, 30000), 'the crew stops her and the anchor goes');
  s = await st();
  check(s.mode === 'anchor' && ['falling', 'down'].includes(s.anchor.phase) && s.furl > 0.5, `under 1 kn in ${s.depth.toFixed(1)} m: it goes, the sails down (${s.anchor.phase}, furl ${s.furl})`);
  check(await until(() => (window.__velia.anchorFx?.stats.splashes ?? 0) > 0, null, 8000), 'the splash at the bow');
  const fx = await page.evaluate(() => ({ ...window.__velia.anchorFx.stats, bow: window.__velia.sea.bowLook }));
  check(fx.drops > 20 || fx.msMax > 0, `the droplets fly (${JSON.stringify(fx)})`);
  check(await until(() => window.__velia.sea.state.chainMs > 0.3, null, 8000), 'the chain runs (its speed feeds the chain\'s sound)');
  s = await st();
  check(s.cockpit?.anchor === true, 'the cockpit\'s ANCHOR rocker is down');
  check(s.pose.drop > 0.2 && (s.pose.rode >= 2 || s.pose.links > 0), `the anchor leaves the bow, the rode is drawn (drop ${s.pose.drop.toFixed(2)} m, ${s.pose.rode ?? 0} line points, ${s.pose.links} links near the eye: render/anchorGear.js on a desktop)`);
  const chainGain = await page.evaluate(() => window.__velia.engineSound()?.mix?.gains?.chain ?? 0);
  check(chainGain > 1, `the chain heard (gain ${chainGain.toFixed(2)})`);
  check(await until(() => window.__velia.sea.state.anchor.phase === 'held', null, 60000), 'the rode out to 5 : 1: held');
  check(await until(() => window.__velia.boat.sim.ctl.furl === 1 && window.__velia.sea.held, null, 5000), 'held: the crew keeps the sails down');
  const sh = await page.evaluate(() => { const g = window.__velia.m4.ui.grounding; return g ? { on: g.on, engaged: g.state.engaged } : null; });
  check(!!sh && sh.on && !sh.engaged, `the shallow-water assist is on (Setup's default) and stands down while she is held (${JSON.stringify(sh)})`);
  check(await until(() => window.__said.includes('holding') && /Anchor’s holding/.test(window.__velia.m4.ui.hint.el?.textContent ?? ''), null, 90000), `"Anchor's holding." on the hint row (${JSON.stringify(await page.evaluate(() => window.__said))})`);
  const h0 = (await st()).sog;
  check(await until(() => !!window.__velia.m4.logbook.logbook.found?.('anchor'), null, 90000), `the logbook records "at anchor" (v1's find; sog then ${h0})`);
  s = await st();
  check(s.anchor.phase === 'held' && s.anchor.dragged < 3, `it holds (dragged ${s.anchor.dragged.toFixed(2)} m, pull ${Math.round(s.anchor.H)} N)`);
  // the arrival: v1's rule (src/sail/seamanship.js: held, under 0.3 m/s for 10 s of real time). The boat swings on the rode as
  // v1's does (#21's orbital push included: tools/v2-anchor-arrival.mjs, SOG to 0.55 m/s on both, the arrival 26.1 s after
  // "held" on v2 and 26.6 s on v1), so the moment depends on the swing's slow phase; the check waits for the rule to hold, then
  // the camera must rise at once (a 30 s window from the logbook's find caught that phase 2 runs in 4)
  check(await until(() => window.__velia.sea.holding, null, 90000), 'v1\'s rule: held and under 0.3 m/s for 10 s');
  check(!!(await page.evaluate(() => window.__velia.sea.bowLook)) && !(await page.evaluate(() => window.__velia.sea.arrival)), 'the camera stays at the bow while she lies to it, no wide arrival shot (owner 2026-11-17: "then stay there")');
  await page.keyboard.press('KeyJ');
  check(await until(() => window.__velia.sea.state.anchor.phase === 'stowed', null, 90000), 'J weighs it: hauled in, stowed');

  // ---- MOOR: a pier within 15 m wakes the cap's MOOR; stopped alongside, U ties up ----
  const near = await page.evaluate(() => {
    const V = window.__velia, tk = V.sea.tackle, s = V.boat.sim.phys.state, H = (x, z) => V.terrain.field.height(x, z);
    // a pier side with clear water: the hull 0.3–0.9 m off it (no finger or other deck in the way) and ≥ 2.5 m deep under her
    const save = { x: s.x, z: s.z, heading: s.heading };
    for (const p of tk.piers) {
      if (p.kind === 'breakwater') continue;
      const ex = p.b[0] - p.a[0], ez = p.b[1] - p.a[1], L = Math.hypot(ex, ez); if (L < 12) continue;
      const ux = ex / L, uz = ez / L, nx = -uz, nz = ux;
      for (const side of [1, -1]) {
        const x = (p.a[0] + p.b[0]) / 2 + nx * side * (p.half + 2.15), z = (p.a[1] + p.b[1]) / 2 + nz * side * (p.half + 2.15);
        if (!(H(x, z) < -2.5)) continue;
        Object.assign(s, { x, z, heading: Math.atan2(ux, -uz) });
        const gap = tk.hullGap(s);
        if (gap > 0.3 && gap < 0.9) { const o = { x, z, heading: s.heading, kind: p.kind, gap: +gap.toFixed(2) }; window.__placeDock = () => { Object.assign(s, { x: o.x, z: o.z, heading: o.heading, u: 0, v: 0, yawRate: 0, sog: 0 }); }; window.__placeDock(); return o; }
      }
    }
    Object.assign(s, save);
    return null;
  });
  check(!!near, `beside a dock (${JSON.stringify(near)})`);
  if (near) {
    check(await until(() => window.__velia.sea.linesUp() && window.__velia.m4.ui.cockpitStates?.()?.moor === 'lines', null, 8000), 'MOOR shows on the cap near a pier');
    await page.keyboard.press('KeyY');   // the sails down again (free, the crew set them), then back beside the dock, stopped
    await until(() => window.__velia.sea.state.furl > 0.9, null, 20000);
    await page.evaluate(() => window.__placeDock());
    await page.keyboard.press('KeyU'); await page.waitForTimeout(600);
    check(await page.evaluate(() => window.__velia.sea.state.mode !== 'docked'), 'U does nothing: not docked yet');
    await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('lines'));   // the MOOR button's own call
    check(await until(() => window.__velia.sea.state.mode === 'docked', null, 5000), 'MOOR: the crew ties up alongside');
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
