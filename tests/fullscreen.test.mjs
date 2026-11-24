// Full screen toggle (stubbed document), the Esc hand-off, the Shift+F key, and the Wind picker's levels (owner, 2026-10-30).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, computed } from './helpers/dom-cascade.mjs';
import { createFullscreen, escIsBrowsers, markLeft } from '../src/ui/fullscreen.js';
import { WIND_LEVELS, createViewSwitch } from '../src/ui/viewSwitch.js';
import { tipText } from '../src/ui/nameTag.js';
import { createHome } from '../src/ui/home.js';
import { createSettings } from '../src/ui/settings.js';
import { KEYMAP, collisions, CRUISE_KEYMAP } from '../src/sail/keys.js';
// the loading card's markup (index.html), for the home card on a dom-cascade.mjs page
const SHELL_BODY = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/ {2}<!-- lk-load:body -->[\s\S]*?<!-- lk-load:body:end -->/)[0];
// the top bar on a dom-cascade.mjs page: a view held here, a full screen and a wind picker the test can see
function bar({ level = 3 } = {}) {
  const dom = installDom();
  const fs = createFullscreen(document), picks = [];
  const windPick = { level: () => level, set: (n) => { picks.push(n); level = n; } };
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: null, once: false, fullscreen: fs, windPick, music: () => null });
  vs.update(0.1);
  return { el: vs.el, fs, picks, done() { vs.dispose(); fs.dispose(); dom.uninstall(); } };
}

const stub = ({ prefixed = false, none = false } = {}) => {
  const d = { calls: [], fullscreenElement: null, webkitFullscreenElement: null, ls: {}, addEventListener(t, f) { this.ls[t] = f; }, removeEventListener() {} };
  const enter = prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen', leave = prefixed ? 'webkitExitFullscreen' : 'exitFullscreen', key = prefixed ? 'webkitFullscreenElement' : 'fullscreenElement';
  d.documentElement = {};
  if (!none) {
    d.documentElement[enter] = function () { d.calls.push('enter'); d[key] = this; d.ls[prefixed ? 'webkitfullscreenchange' : 'fullscreenchange']?.(); return Promise.resolve(); };
    d[leave] = function () { d.calls.push('exit'); d[key] = null; d.ls[prefixed ? 'webkitfullscreenchange' : 'fullscreenchange']?.(); return Promise.resolve(); };
  }
  return d;
};

test('toggle enters then exits, and tells its listeners (standard and webkit-prefixed)', () => {
  for (const prefixed of [false, true]) {
    const d = stub({ prefixed }), fs = createFullscreen(d), seen = [];
    fs.on((a) => seen.push(a));
    assert.ok(fs.supported()); assert.equal(fs.active(), false);
    fs.toggle(); assert.equal(fs.active(), true);
    fs.toggle(); assert.equal(fs.active(), false);
    assert.deepEqual(d.calls, ['enter', 'exit']); assert.deepEqual(seen, [true, false]);
  }
});

test('no API (iPhone): not supported, toggle does nothing', () => {
  const d = stub({ none: true }), fs = createFullscreen(d);
  assert.equal(fs.supported(), false); assert.equal(fs.toggle(), false); assert.deepEqual(d.calls, []);
});

test('the first Esc is the browser\'s: ignored while full screen is on, and for 400 ms after it ends', () => {
  const d = stub(), fs = createFullscreen(d, () => 1000);
  markLeft(-1e9); assert.equal(escIsBrowsers(d, 5000), false);
  fs.toggle(); assert.equal(escIsBrowsers(d, 5000), true);
  fs.toggle(); markLeft(5000); assert.equal(escIsBrowsers(d, 5200), true); assert.equal(escIsBrowsers(d, 5500), false);
  // the home card (home.js) on a page in play: Esc opens the menu, but not while full screen is on or just left
  const dom = installDom();
  try {
    document.body.innerHTML = SHELL_BODY;
    document.documentElement.classList.add('lk-nol');   // ?noload: no loading card, the game is up
    const menu = createHome({ settings: createSettings({ storage: null }) });
    const esc = () => { dom.key('keydown', 'Escape', { key: 'Escape' }); dom.key('keyup', 'Escape', { key: 'Escape' }); };
    assert.equal(menu.state, 'gone');
    document.documentElement.requestFullscreen(); esc();
    assert.equal(menu.isOpen, false, 'full screen: the first Esc is the browser\'s');
    document.exitFullscreen(); markLeft(Date.now()); esc();
    assert.equal(menu.isOpen, false, 'just left full screen: still the browser\'s');
    markLeft(Date.now() - 1000); esc();
    assert.equal(menu.isOpen, true, 'then Esc opens the menu');
    menu.dispose();
  } finally { dom.uninstall(); markLeft(-1e9); }
});

test('Shift+F is the key: free in every table, and the bar names it', () => {
  assert.deepEqual(collisions().map(([a, b]) => `${a.code}: ${a.action} / ${b.action}`), []);
  assert.ok(KEYMAP.some((k) => k.code === 'KeyF' && k.shift === true && k.action === 'full screen'));
  assert.equal(CRUISE_KEYMAP.filter((k) => k.code === 'KeyF').length, 1, 'Cruise: the button only');
  // the bar's Full button names the key, and says Exit while full screen is on
  const b = bar();
  try {
    const btn = b.el.querySelector('.xt[data-x=fullscreen]');
    assert.equal(btn.hidden, false, 'the API is there: the button shows');
    assert.deepEqual([tipText(btn), btn.getAttribute('aria-label'), btn.querySelector('.w').textContent], ['Full screen · Shift+F', 'Full screen (Shift+F)', 'Full']);
    assert.equal(btn.title, '', 'no browser title: the tip names it (tips.js)');
    btn.click();
    assert.equal(b.fs.active(), true, 'a tap goes full screen');
    assert.deepEqual([tipText(btn), btn.getAttribute('aria-pressed'), btn.querySelector('.w').textContent], ['Exit full screen · Shift+F', 'true', 'Exit']);
    btn.click(); assert.equal(b.fs.active(), false);
  } finally { b.done(); }
});

test('the Wind picker: four levels with a plain name and range; a tap applies the level through setLevel', () => {
  assert.deepEqual(WIND_LEVELS.map((l) => `${l.name} ${l.range}`), ['Light 4–7 kn', 'Moderate 8–12 kn', 'Fresh 13–17 kn', 'Strong 18–24 kn']);
  // the bar says the word; the number and range are its tip (Sail's picker sets the wind through the controls:
  // tests/viewSwitch.test.mjs, on Sail's real controls)
  const b = bar({ level: 3 });
  try {
    const btn = b.el.querySelector('.xt[data-x=wind]'), pick = () => b.el.querySelector('.lk-windpick');
    assert.deepEqual([btn.querySelector('.w').textContent, tipText(btn), btn.getAttribute('aria-label')], ['Fresh', 'Wind 3 · Fresh, 13–17 kn', 'Wind 3 · Fresh, 13–17 kn']);
    assert.equal(pick().hidden, true, 'the picker starts closed');
    btn.click();
    assert.equal(pick().hidden, false, 'a tap on Wind opens it');
    const levels = pick().querySelectorAll('button');
    assert.deepEqual(levels.map((x) => x.textContent), ['1Light4–7 kn', '2Moderate8–12 kn', '3Fresh13–17 kn', '4Strong18–24 kn']);
    assert.deepEqual(levels.map((x) => x.getAttribute('aria-checked')), ['false', 'false', 'true', 'false']);
    for (const x of levels) { const c = computed(x); assert.deepEqual([c['min-height'], c['min-width']], ['44px', '44px'], '44 px targets'); }
    levels[0].click();
    assert.deepEqual(b.picks, [1], 'a tap applies the level (setLevel)'); assert.equal(pick().hidden, true, 'and closes');
    assert.deepEqual([btn.querySelector('.w').textContent, tipText(btn)], ['Light', 'Wind 1 · Light, 4–7 kn']);
    assert.deepEqual(levels.map((x) => x.getAttribute('aria-checked')), ['true', 'false', 'false', 'false']);
  } finally { b.done(); }
});
