// The touch UX and the throttle (feat/touch-ux): the per-device layout, the throttle's auto-start and
// auto-stop by state, PANEL holding the moved buttons, and no key caps on touch. Pure; the hittability at the six sizes is
// tools/touch_ux_check.mjs (a browser). Run: node --test tests/
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import { installDom, computed, displayed } from './helpers/dom-cascade.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceKind, deviceClasses } from '../src/ui/device.js';
import { helmLayout, overlaps } from '../classic/src/stations/sloop/helmStation.js';
import { slotsBox, crispWanted } from '../classic/src/ui/hud3d.js';
import { CAP_ICONS, capSvg } from '../src/stations/sloop/controlPanel.js';
import { autoStart, autoStop, sailsDrawing, litWord, AUTO_STOP, NOTCHES } from '../src/stations/sloop/throttleLever.js';
import { PANEL, PHONE_KEYS, PANEL_MORE, PHONE_CELLS, panelCells } from '../src/stations/sloop/controlPanel.js';
import { keysPageHtml } from '../src/ui/keysContent.js';
import { NOTES } from '../src/ui/skipper.js';
import { Engine, ENGINE } from '../src/sim/boat/engine.js';
import { createDashboard } from '../classic/src/ui/dashboard.js';

// Sail's real controls in node (helpers/sail-controls.mjs) in a Mac window or on an upright iPhone; one at a time, each built once
let open = null;
const use = (kind) => { if (open?.kind !== kind) { open?.s.dispose(); open = { kind, s: kind === 'mac' ? mountSail() : mountSail({ w: 390, h: 844, coarse: true }) }; } return open.s; };
test.after(() => open?.s.dispose());
const PHONE = { w: 390, h: 844, coarse: true }, MAC = { w: 1280, h: 720, coarse: false };

const inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

test('the device tier: a Mac is the desktop, an iPad the tablet, an iPhone a phone by how it is held', () => {
  assert.equal(deviceKind({ w: 1280, h: 720, coarse: false }), 'desktop');
  assert.equal(deviceKind({ w: 1920, h: 1080, coarse: false }), 'desktop');
  assert.equal(deviceKind({ w: 1180, h: 820, coarse: true }), 'tablet');
  assert.equal(deviceKind({ w: 820, h: 1180, coarse: true }), 'tablet', 'an upright iPad keeps the desktop layout, not the phone\'s');
  assert.equal(deviceKind({ w: 844, h: 390, coarse: true }), 'phone-land');
  assert.equal(deviceKind({ w: 390, h: 844, coarse: true }), 'phone-port');
  assert.equal(deviceKind({ w: 844, h: 390, coarse: false }), 'phone-land', 'a desktop window that small takes the phone layout');
  assert.deepEqual(deviceClasses('phone-land'), ['lk-phone', 'lk-phone-l']);
  assert.deepEqual(deviceClasses('tablet'), ['lk-tablet']);
  assert.deepEqual(deviceClasses('desktop'), []);
});

test('the Mac layout: one group (wheel 128 · JIB · MAIN · panel 192 · lever 64 · the lit word) between the two circles', () => {
  for (const [w, h, d, mx] of [[1280, 720, 220, 40.96], [1920, 1080, 330, 56]]) {
    const L = helmLayout({ w, h, d, by: 14, mx, coarse: false });
    assert.equal(L.kind, 'desktop'); assert.equal(L.form, 'grid'); assert.equal(L.steps, true);
    const u = d / 220;
    assert.equal(L.wheel.w, Math.round(128 * u)); assert.equal(L.panel.w, Math.round(192 * u)); assert.equal(L.thr.w, Math.round(64 * u)); assert.equal(L.thr.h, L.wheel.h);
    assert.ok(L.thr.x > L.panel.x + L.panel.w, 'the lever stands right of the panel');
    assert.ok(L.group.x > mx + d && L.group.x + L.group.w < w - mx - d, `the group (${L.group.x}–${L.group.x + L.group.w}) clears both circles`);
    assert.ok(Math.abs(L.word - 15 * u) < 1e-9 && Math.abs(L.eng - 11 * u) < 1e-9, 'the lit word 15 px, the engraved words 11 px at 1280 × 720');
    for (const [a, b] of [['wheel', 'jib'], ['jib', 'main'], ['main', 'panel'], ['panel', 'thr']]) assert.ok(!overlaps(L[a], L[b]), `${a} / ${b}`);
  }
  const M = helmLayout({ w: 1280, h: 720, d: 220, by: 14, mx: 40 });
  for (const [k, x] of [['wheel', 276], ['panel', 636], ['thr', 836]]) assert.ok(Math.abs(M[k].x - x) <= 6, `${k} at ${M[k].x}: the mock-up mac-sail-after has ${x}`);
});

test('the iPad: the desktop layout at u = 1 (not the phone\'s 0.62 group), hover steps off, a 30 px knob', () => {
  for (const [w, h, d] of [[1180, 820, 200], [820, 1180, 180]]) {
    const L = helmLayout({ w, h, d, by: 20, mx: 14, coarse: true });
    assert.equal(L.kind, 'tablet'); assert.equal(L.u, 1); assert.equal(L.wheel.w, 128); assert.equal(L.steps, false);
    assert.ok(L.knob >= 30);
    assert.ok(inside(L.group, w, h));
    if (w > h) assert.ok(L.group.x > 14 + d && L.group.x + L.group.w < w - 14 - d, 'landscape: the group clears the 200 px circles');
  }
});

test('the iPhone on its side: steering under the left thumb, the sheets under the right, the keys in the middle, 44 pt targets', () => {
  const w = 844, h = 390;
  for (const inset of [{}, { l: 59, r: 59, b: 21 }]) {
    const L = helmLayout({ w, h, coarse: true, inset });
    assert.equal(L.kind, 'phone-land'); assert.equal(L.form, 'keys');
    const left = Math.max(16, inset.l ?? 0), right = Math.max(16, inset.r ?? 0);
    assert.equal(L.wheel.x, left, 'the wheel in the left corner, inside the safe area');
    assert.ok(L.thr.x > L.wheel.x + L.wheel.w && L.thr.x < w / 3, 'the throttle beside the wheel');
    assert.equal(L.main.x + L.main.w, w - right, 'MAIN in the right corner'); assert.ok(L.jib.x < L.main.x);
    assert.ok(L.dial.y + L.dial.h <= L.main.y && L.dial.x + L.dial.w === L.main.x + L.main.w, 'the wind dial above the winches');
    assert.ok(L.panel.x > L.thr.x + L.thr.w && L.panel.x + L.panel.w < L.jib.x, 'the keys between the two hands');
    for (const k of ['wheel', 'thr', 'jib', 'main', 'panel', 'dial', 'more']) { assert.ok(inside(L[k], w, h), k); assert.ok(L[k].w >= 44 && L[k].h >= 44, `${k} ≥ 44 px`); }
    for (const [a, b] of [['wheel', 'thr'], ['thr', 'panel'], ['panel', 'jib'], ['jib', 'main'], ['dial', 'main'], ['dial', 'jib']]) assert.ok(!overlaps(L[a], L[b]), `${a} / ${b}`);
    assert.ok(L.wheel.y + L.wheel.h <= h - Math.max(14, (inset.b ?? 0) - 4), 'over the home indicator');
  }
});

test('the iPhone upright (owner, 2026-10-31): a three-column bottom band, both circles at the top, both winches back', () => {
  for (const [w, h, inset, top] of [[390, 844, { b: 34 }, 125], [375, 667, { b: 0 }, 86], [430, 932, { b: 34 }, 125], [390, 844, {}, 66]]) {
    const L = helmLayout({ w, h, coarse: true, inset, top });
    const tag = `${w}×${h}`;
    assert.equal(L.kind, 'phone-port', tag); assert.equal(L.form, 'keys'); assert.equal(L.litAt, 'top');
    const C = L.cols;
    // the columns: left the wheel, middle the winches over the keys, right the throttle with its lit word above it
    assert.ok(L.wheel.x === C.x[0] && L.wheel.x + L.wheel.w <= C.x[1], `${tag}: the wheel in the left column`);
    for (const k of ['jib', 'main', 'panel']) assert.ok(L[k].x >= C.x[1] && L[k].x + L[k].w <= C.x[1] + C.mid, `${tag}: ${k} in the middle column`);
    assert.ok(L.jib.x < L.main.x && L.jib.y === L.main.y, `${tag}: JIB and MAIN side by side, JIB at the left`);
    assert.ok(L.jib.y + L.jib.h + 12 <= L.panel.y, `${tag}: the winches (and their tapes) over the keys row`);
    for (const k of ['thr', 'lit']) assert.ok(L[k].x === C.x[2] && L[k].x + L[k].w <= w - C.r, `${tag}: ${k} in the right column`);
    assert.ok(L.lit.y + L.lit.h <= L.thr.y, `${tag}: the lit word above the lever, inside the column`);
    // the circles: the chart top-left, the wind dial top-right, under the bar, clear of each other
    assert.ok(L.chart.x < w / 2 && L.dial.x > w / 2 && L.chart.y === top && L.dial.y === top, `${tag}: the circles under the bar`);
    assert.ok(!overlaps(L.chart, L.dial), `${tag}: the circles apart`);
    // the boat's room: at least 40 % of the screen between the circles and the band
    assert.ok(L.band.y - (L.chart.y + L.chart.h) >= 0.4 * h, `${tag}: ${L.band.y - (L.chart.y + L.chart.h)} px for the boat`);
    // every target 44 px or more, a key a quarter of the middle, all inside the window, over the home bar, no overlaps
    for (const k of ['wheel', 'thr', 'jib', 'main', 'panel', 'dial', 'chart']) { assert.ok(inside(L[k], w, h), `${tag}: ${k} inside`); assert.ok(L[k].w >= 44 && L[k].h >= 44, `${tag}: ${k} ≥ 44 px`); }
    assert.ok(L.panel.w / 4 >= 44, `${tag}: a key ${L.panel.w / 4} px wide`);
    assert.ok(L.panel.y + L.panel.h <= h - Math.max(12, inset.b ?? 0) && L.wheel.y + L.wheel.h <= h - Math.max(12, inset.b ?? 0), `${tag}: over the home bar`);
    const keys = ['wheel', 'jib', 'main', 'panel', 'thr', 'lit', 'chart', 'dial'];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(!overlaps(L[keys[i]], L[keys[j]]), `${tag}: ${keys[i]} / ${keys[j]}`);
  }
  // the JIB winch is always there now (the reduced set is gone), whatever the crew does
  assert.ok(helmLayout({ w: 390, h: 844, coarse: true, jib: false }).jib, 'JIB stays in portrait');
  // the turn-the-phone line is gone: portrait is the full helm (an upright phone with the station up, 6 s of play: no such
  // line; it came 4 s in)
  const s = use('phone');
  s.step(60, 0.1);
  assert.ok(/\bportrait\b/.test(document.documentElement.dataset.screen ?? '') && document.documentElement.classList.contains('lk-phone') && window.__lakeshore.station?.shown, 'the upright phone\'s helm station is up');
  assert.deepEqual(s.said.filter((l) => /turn the phone/i.test(l)), [], 'never "turn the phone"');
  assert.doesNotMatch(document.body.textContent, /turn the phone/i);
});

test('the portrait choice: only an upright phone takes the band; the landscape iPhone, the iPad and the Mac keep their layouts', () => {
  assert.equal(helmLayout({ w: 390, h: 844, coarse: true }).kind, 'phone-port');
  assert.equal(helmLayout({ w: 375, h: 667, coarse: true }).kind, 'phone-port');
  assert.equal(helmLayout({ w: 430, h: 932, coarse: true }).kind, 'phone-port');
  assert.equal(helmLayout({ w: 844, h: 390, coarse: true }).kind, 'phone-land');
  assert.equal(helmLayout({ w: 820, h: 1180, coarse: true }).kind, 'tablet');
  assert.equal(helmLayout({ w: 1280, h: 720 }).kind, 'desktop');
  for (const v of [{ w: 820, h: 1180, coarse: true, d: 180 }, { w: 1280, h: 720 }]) {
    const L = helmLayout(v);
    assert.equal(L.chart, undefined, `${v.w}×${v.h}: no portrait chart rect`); assert.notEqual(L.litAt, 'top', `${v.w}×${v.h}: the lit word beside the lever`);
  }
  // the landscape iPhone also shows the heading circle, above the Tack button that stands on the wheel; it clears every other control
  for (const [w, h, d] of [[844, 390, 136], [932, 430, 136], [667, 375, 124]]) {
    const L = helmLayout({ w, h, d, coarse: true });
    assert.ok(L.chart && L.chart.y >= 56 && L.chart.x >= 0 && L.chart.y + L.chart.h <= L.wheel.y - 50, `${w}×${h}: the chart circle fits above the Tack button`);
    for (const k of ['wheel', 'thr', 'jib', 'main', 'panel', 'dial']) assert.ok(!overlaps(L.chart, L[k]), `${w}×${h}: chart clear of ${k}`);
    assert.ok(L.panel.y + L.panel.h + 8 <= h, `${w}×${h}: the key row is 8 px or more above the bottom edge`);
  }
  // the landscape iPhone as built: the wheel in the left corner at 114 px, MAIN in the right corner
  const Lnd = helmLayout({ w: 844, h: 390, coarse: true });
  assert.deepEqual([Lnd.wheel.x, Lnd.wheel.w, Lnd.main.x + Lnd.main.w], [16, 114, 828]);
});

test('the throttle starts when the lever leaves N', () => {
  assert.equal(autoStart({ from: 0, to: 0.3, engineOn: false }), true);
  assert.equal(autoStart({ from: 0, to: -0.35, engineOn: false }), true);
  assert.equal(autoStart({ from: 0, to: 0, engineOn: false }), false);
  assert.equal(autoStart({ from: 0, to: 0.3, engineOn: true }), false);
});

test('the throttle stops by state at N, never by a timer', () => {
  const S = AUTO_STOP.settleS;
  const at = (o) => autoStop({ engineOn: true, lever: 0, atNeutralS: S + 0.1, detent: ENGINE.detent, ...o });
  // 1. the sails drawing at N: stops, 3 s after the lever settles
  assert.equal(at({ drawing: true }), 'sails');
  assert.equal(autoStop({ engineOn: true, lever: 0, atNeutralS: S - 0.1, drawing: true }), null, 'not before the lever has settled');
  // 2. the anchor holding, or the boat made fast: stops
  assert.equal(at({ held: true }), 'held');
  // 3. the sails down or luffing at N: it idles, for as long as the skipper likes (no timer)
  for (const s of [10, 60, 600, 3600]) assert.equal(autoStop({ engineOn: true, lever: 0, atNeutralS: s, drawing: false, held: false }), null, `${s} s at N`);
  // 4. in gear (motoring or motor-sailing): never
  assert.equal(at({ lever: 0.3, drawing: true }), null); assert.equal(at({ lever: -0.35, held: true }), null);
  assert.equal(at({ engineOn: false, drawing: true }), null, 'an engine already off');
  // the sails "drawing": up (furl under 0.2) and full; hoisting (furled, or luffing head to wind) is not
  assert.equal(sailsDrawing({ furl: 0, mainFill: 0.9 }), true);
  assert.equal(sailsDrawing({ furl: 0, jibFill: 0.8, mainFill: 0.2 }), true);
  assert.equal(sailsDrawing({ furl: 0.6, mainFill: 0.9 }), false, 'still hoisting');
  assert.equal(sailsDrawing({ furl: 0, mainFill: 0.3, jibFill: 0.2 }), false, 'luffing');
  assert.equal(sailsDrawing({}), false);
  // the skipper says why, once each
  assert.match(NOTES.engineOffSails.text, /Engine off — the sails have her/);
  assert.match(NOTES.engineOffAnchor.text, /Engine off — \{anchor\} holding/);
  assert.match(NOTES.engineOffFast.text, /Engine off/);
  // the rule is wired (seamanship.js on Sail's real controls): at N with the sails drawing it stops, 3 s after the lever
  // settles, and says why; with the sails down it idles at N on and on
  const s = use('mac'), eng = s.phys.engine;
  s.step(30, 0.1);
  assert.ok(sailsDrawing(s.phys.state), 'a beam reach: the sails draw');
  s.tap('Equal'); s.tap('Digit0');
  const on = []; for (let i = 0; i < 60 && eng.on; i++) { s.step(1, 0.1); on.push(eng.on); }
  const off = on.indexOf(false);
  assert.ok(off >= (S - 0.1) * 10 && off <= (S + 1.5) * 10, `stopped ${(off / 10).toFixed(1)} s after the lever came to N`);
  assert.ok(s.said.some((l) => /Engine off — the sails have her/.test(l)), 'the skipper says why');
  s.tap('KeyY'); for (let i = 0; i < 150 && sailsDrawing(s.phys.state); i++) s.step(1, 0.1);
  assert.equal(sailsDrawing(s.phys.state), false, 'Y: the sails down');
  s.tap('Equal'); s.tap('Digit0'); s.step(200, 0.1);
  assert.ok(eng.on && eng.lever === 0, '20 s at N with the sails down: still running');
  const e = new Engine(); e.start(); e.setLever(0); for (let i = 0; i < 6000; i++) e.step(0.1, 0); assert.equal(e.on, true, 'the engine itself has no idle timer');
});

test('the throttle shows one lit word: the notch while it runs, no word when stopped (the lever at N says it); no ENGINE button, no notch words', () => {
  assert.deepEqual(NOTCHES.map((n) => n.lit), ['FULL AHEAD', 'HALF AHEAD', 'SLOW AHEAD', 'NEUTRAL', 'SLOW ASTERN', 'FULL ASTERN']);
  assert.deepEqual(litWord(0.3, 'running'), { text: 'SLOW AHEAD', on: true });
  assert.deepEqual(litWord(0, 'running'), { text: 'NEUTRAL', on: true });
  assert.deepEqual(litWord(0.3, 'cranking'), { text: 'SLOW AHEAD', on: true });
  assert.deepEqual(litWord(0, 'off'), { text: '', on: false });
  assert.deepEqual(litWord(0, 'stopping'), { text: '', on: false });
  // the lever as Sail builds it: no key, no ENGINE word, no notch words; three engraved words and the one lit word
  for (const kind of ['mac', 'phone']) {
    const s = use(kind), thr = window.__lakeshore.throttle.el, eng = s.phys.engine;
    if (eng.on) s.c.sea.actions.engine();   // the engine off (an earlier test left it running)
    s.step(5);
    assert.equal(thr.querySelectorAll('button, .key, [class^=nt], [class*=" nt"]').length, 0, `${kind}: no key, no notch words`);
    assert.deepEqual(thr.querySelectorAll('text.e').map((t) => t.textContent), ['AHEAD', 'ASTERN', 'N'], `${kind}: engraved AHEAD, ASTERN, N`);
    assert.doesNotMatch(thr.textContent, /ENGINE/, `${kind}: no ENGINE on the lever`);
    assert.equal(thr.querySelector('.lit').textContent, '', `${kind}: stopped: no word`);
    s.tap('Equal'); s.step(1); assert.equal(eng.on, true); assert.equal(thr.querySelector('.lit').textContent, 'SLOW AHEAD', `${kind}: running: the notch's word`);
  }
  // (the 3D cockpit's key switch is a hidden cell of the panel, shown only in its cockpit form: tests/cockpit3d.test.mjs)
  assert.ok(!document.querySelectorAll('.lk-cp .c, .lk-cpx .c').some((c) => !c.hidden && /ENGINE/.test(c.textContent)), 'no ENGINE button on the panel');
});

test('PANEL holds the moved buttons: a phone keeps SAILS · ANCHOR · PANEL · CHART; the row has BINOCULARS · VHF · REEF · MOOR · TRIM · LOG', () => {
  assert.deepEqual(PHONE_KEYS, ['sails', 'anchor', 'more', 'chart']);
  assert.deepEqual(PANEL_MORE, ['binoculars', 'radio', 'reef', 'lines', 'pro', 'logbook']);
  const word = Object.fromEntries([...PANEL, ...PHONE_CELLS].map((p) => [p[0], p[1]]));
  assert.deepEqual(PHONE_KEYS.map((id) => word[id]), ['SAILS', 'ANCHOR', 'PANEL', 'CHART']);
  assert.deepEqual(PANEL_MORE.map((id) => word[id]), ['BINOCULARS', 'VHF', 'REEF', 'MOOR', 'TRIM', 'LOG']);
  // every desktop switch is on a phone's screen or one tap behind PANEL
  for (const [id] of PANEL) assert.ok(PHONE_KEYS.includes(id) || PANEL_MORE.includes(id), id);
  const k = panelCells('keys'), g = panelCells('grid');
  assert.deepEqual(k.main, PHONE_KEYS); assert.deepEqual(k.more, PANEL_MORE);
  assert.deepEqual(g.main, PANEL.map((p) => p[0])); assert.equal(g.more, null, 'the Mac and the iPad: no PANEL row, the panel as built');
});

test('no key caps on touch: the Keys page, the hint words, the throttle and the panel', () => {
  const page = keysPageHtml({ touch: true });
  const shown = page.match(/data-tp="touch">([\s\S]*?)<\/div><div class="tp"/)?.[1] ?? '';
  assert.ok(shown.length > 100 && /aria-selected="true" data-tab="touch"/.test(page), 'a finger opens the Keys card on its Touch page');
  assert.ok(!/class="cap/.test(shown), 'the Touch page shows no key cap');
  assert.match(keysPageHtml({ touch: false }), /class="cap/, 'the keyboard\'s page keeps its caps');
  // the panel as Sail builds it: a cell's key is in its aria-label only (read aloud, never shown)
  const x = (id) => document.querySelector(`.lk-view .xt[data-x=${id}]`);
  for (const kind of ['phone', 'mac']) {
    const s = use(kind), dock = window.__lakeshore.dock, env = kind === 'mac' ? MAC : PHONE;
    if (kind === 'phone') document.querySelector('.lk-cp .c[data-id=more]').click();   // the PANEL row open: its cells too
    s.step(2);
    const cells = document.querySelectorAll('.lk-cp button.c, .lk-cpx button.c').filter((c) => !c.hidden && !c.closest('[hidden]') && dock.spec(c.dataset.id)?.key);
    const cockpit = document.querySelector('.lk-cp')?.dataset.form === 'cockpit';   // a desktop's 3D cockpit: its push cells are the engine key (and MOOR near a mooring)
    assert.ok(cells.length >= (cockpit ? 1 : 3), `${kind}: ${cells.length} cells with a key`);
    for (const c of cells) {
      const { key, name } = dock.spec(c.dataset.id);
      assert.equal(c.getAttribute('aria-label'), `${name} (${key})`, `${kind} ${c.dataset.id}: the key is read aloud`);
      assert.equal(c.textContent.trim(), c.querySelector('.w').textContent, `${kind} ${c.dataset.id}: only its word shows ("${c.textContent.trim()}")`);
    }
    // the lever has no ▲ ▼ steps on any device (owner, 2026-10-31)
    assert.equal(document.querySelectorAll('.lk-thr .stp, .lk-thr button').length, 0, `${kind}: no lever steps`);
    const stp = document.querySelectorAll('.lk-helm .stp');
    assert.equal(stp.length, 2);
    if (kind === 'mac') {
      for (const id of ['wind', 'fullscreen', 'sound']) assert.ok(displayed(x(id), MAC), `the Mac keeps ${id}`);
      for (const id of ['log', 'keys']) assert.equal(x(id), null, `no ${id} button in the bar (owner, 2026-11-09: the Menu has Log and Keys)`);
      assert.equal(x('cruise'), null, 'no Cruise button in Sail\'s bar: the Menu switches modes (owner, 2026-11-06)');
      assert.ok(stp.every((t) => displayed(t, MAC)), 'the Mac keeps the winch steps (on hover)');
      continue;
    }
    // the bar on a phone: Menu | Boat · Helm | ♪ ⏭ | Settings (no Cruise button: modes switch from the Menu, owner 2026-11-06) (Wind, Log, Keys and Full go; the music segment stays, 44 px
    // targets), in Sail and in Cruise's five-camera bar. Sail's bar keeps Full where the Fullscreen API exists (an Android phone:
    // entering turns it sideways, feat/cockpit-phone; an iPhone has no API, so no button); Cruise's never shows it
    const bar = document.querySelector('.lk-view');
    bar.classList.add('ico');   // a 390 px bar has no room for its words: the measured fit sets this in a browser (tests/pages/barWords.page.mjs); the stand-in DOM has no layout
    assert.ok(bar.classList.contains('fsph'), 'Sail\'s bar: Full on a phone that has the API');
    assert.equal(displayed(x('fullscreen'), env), !x('fullscreen').hidden, 'phone: Full follows the API');
    for (const five of [false, true]) {
      bar.classList.toggle('five', five); bar.classList.toggle('fsph', !five);
      const tag = five ? 'phone (Cruise)' : 'phone';
      for (const id of five ? ['wind', 'fullscreen'] : ['wind']) assert.equal(displayed(x(id), env), false, `${tag}: no ${id} in the bar`);
      for (const id of ['log', 'keys']) assert.equal(x(id), null, `${tag}: no ${id} button`);
      assert.equal(x('next'), null, `${tag}: no ⏭ on the bar (the Music menu's first row)`);
      for (const id of ['sound']) {
        assert.ok(displayed(x(id), env), `${tag}: ${id} shows`);
        assert.equal(computed(x(id), env).width, '44px', `${tag}: ${id} 44 px wide`); assert.equal(computed(x(id), env)['min-width'], '44px');
      }
    }
    bar.classList.remove('five'); bar.classList.add('fsph');
    // the winches' hover steps are gone on touch (hidden, and no touch rule lights them)
    for (const t of stp) { assert.equal(displayed(t, env), false, 'phone: the winch steps hidden'); assert.equal(computed(t, env).opacity, '0', 'no touch rule lights them'); }
  }
});

test('crisp on a 3x phone: the helm objects take their own canvas when the scene draws below the screen; vector caps and rockers', () => {
  assert.equal(crispWanted({ dpr: 3, ratio: 1.37 }), true, 'a 3x phone on Low');
  assert.equal(crispWanted({ dpr: 2, ratio: 1.5 }), true, 'a Retina Mac on High');
  assert.equal(crispWanted({ dpr: 1, ratio: 1 }), false, 'the goldens (1x): the scene path, unchanged');
  assert.equal(crispWanted({ dpr: 3, ratio: 1.37, able: false }), false, 'WebGL2: the scene path');
  assert.deepEqual(slotsBox([{ x: 10.4, y: 600.2, w: 100, h: 100 }, null, { x: 150, y: 590, w: 80.5, h: 80 }]), { x: 9, y: 589, w: 223, h: 113 }, 'whole pixels round every shown slot');
  assert.equal(slotsBox([null, null]), null);
  // the panel draws its caps and rockers (no ctl or rocker2 sprite left on the panel), the rockers' words live text
  for (const [k, g] of Object.entries(CAP_ICONS)) { const svg = capSvg(g); assert.match(svg, /^<svg class="cap" viewBox="0 0 48 48"/, k); assert.ok(svg.includes(g), k); }
  for (const [kind, env] of [['mac', MAC], ['phone', PHONE]]) {
    use(kind).step(2);
    const sprite = (el) => { const c = computed(el, env); return /image-set|url\(/.test(`${c.background ?? ''} ${c['background-image'] ?? ''}`); };
    const rockers = document.querySelectorAll('.lk-cp .c[data-k=rocker], .lk-cpx .c[data-k=rocker]');
    assert.ok(rockers.length >= 2, `${kind}: the rockers`);
    for (const r of rockers) {
      assert.deepEqual(r.querySelectorAll('.rk button > b[aria-hidden=true]').map((b) => b.textContent), ['UP', 'DOWN'], `${kind} ${r.dataset.id}: live words`);
      for (const n of [r, ...r.querySelectorAll('*')]) assert.ok(!sprite(n), `${kind} ${r.dataset.id}: no rocker sprite (${n.localName}.${n.className})`);
    }
    const caps = document.querySelectorAll('.lk-cp .c[data-k=push] .o, .lk-cpx .c[data-k=push] .o');
    assert.ok(caps.length >= 4, `${kind}: the caps`);
    for (const o of caps) { assert.ok(o.querySelector('svg.cap'), `${kind}: a drawn cap`); assert.ok(!sprite(o), `${kind}: no cap sprite`); }
    // the top bar: no half-pixel translate, whole-pixel glyphs
    for (const el of [document.querySelector('.lk-view'), ...document.querySelectorAll('.lk-view .lay')]) assert.doesNotMatch(computed(el, env).transform ?? 'none', /translate(X)?\(-50%/, `${kind} ${el.className}: no translate(-50%)`);
    for (const svg of document.querySelectorAll('.lk-view button svg')) { const c = computed(svg, env); for (const d of ['width', 'height']) assert.match(c[d], /^round\(1\.4em,1px\)$|^\d+px$/, `${kind}: the glyph's ${d} at whole pixels (${c[d]})`); }
  }
});

test('the flip dots are gone: the phone\'s dashboard adds nothing between the circles', () => {
  open?.s.dispose(); open = null;   // its own bare document
  const dom = installDom(PHONE);
  try {
    document.documentElement.classList.add('lk-phone', 'lk-phone-p');
    const dash = createDashboard();
    assert.equal(document.querySelectorAll('.lk-flip').length, 0); assert.equal(document.body.children.length, 0, 'no element of its own');
    dash.dispose();
  } finally { dom.uninstall(); }
});
