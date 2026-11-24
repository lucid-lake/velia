// Button tips (Solaria stage 1; src/ui/tips.js on src/ui/nameTag.js): one tip for every icon button, naming its key
// ("Binoculars · B"), 120 ms after a hover, a long-press on touch, off from Settings › Screen, never over the skipper's
// line, gone on a drag or a steer. The real page (the dock, the top bar, a phone's long-press): tests/pages/tips.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom-cascade.mjs';
import { NAME_TAG, tipText, keyOf, nameOf } from '../src/ui/nameTag.js';
import { createTips, sharedTips, setTipsOn, tipsOn } from '../src/ui/tips.js';
import { createToolDock, ICONS } from '../src/ui/toolDock.js';
import { createViewSwitch } from '../src/ui/viewSwitch.js';
import { createControlPanel } from '../src/stations/sloop/controlPanel.js';
import { SETTINGS, createSettings } from '../src/ui/settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ptr = (b, type, pointerType, extra = {}) => b.dispatchEvent(new PointerEvent(type, { pointerType, bubbles: true, ...extra }));
const button = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d.querySelector('button'); };

test('the tip names the key: from the aria-label "Name (K)", data-tip as it stands, else the name', () => {
  const dom = installDom();
  try {
    const b = button('<button aria-label="binoculars (B)"></button>');
    assert.equal(keyOf(b), 'B'); assert.equal(tipText(b), 'Binoculars · B');
    assert.equal(tipText(button('<button aria-label="Menu (Esc)"><span class="w">Menu</span></button>')), 'Menu · Esc');
    assert.equal(tipText(button('<button aria-label="Full screen (Shift+F)"><span class="w">Full</span></button>')), 'Full screen · Shift+F', 'with a key, the label says more than the one word');
    assert.equal(tipText(button('<button aria-label="Wind 3 · Fresh, 13–17 kn" data-tip="Wind 3 · Fresh, 13–17 kn"><span class="w">Fresh</span></button>')), 'Wind 3 · Fresh, 13–17 kn');
    const plain = button('<button aria-label="settings"></button>');
    assert.equal(keyOf(plain), ''); assert.equal(tipText(plain), 'Settings');
    assert.equal(nameOf(button('<button aria-label="logbook (L)"></button>')), 'Logbook', 'the name alone drops the key');
  } finally { dom.uninstall(); }
});

test('the dock, the top bar and the control panel name their keys through the one tip', async () => {
  const dom = installDom();
  try {
    const dock = createToolDock();
    for (const [id, key, name] of [['binoculars', 'B', 'binoculars'], ['chart', 'N', 'chart'], ['sails', 'Y', 'sails up / down'], ['anchor', 'J', 'anchor'], ['reef', 'K', 'reef'], ['lines', 'U', 'lines'], ['pro', '', 'pro trim'], ['engine', 'I', 'engine']])
      dock.register({ id, key, name, icon: ICONS[id] ?? '', action: () => {} });
    const tips = sharedTips();
    const bino = dock.el.querySelector('.it[data-id=binoculars]');
    assert.equal(tipText(bino), 'Binoculars · B', 'the dock: "Binoculars · B"');
    ptr(bino, 'pointerenter', 'mouse');
    await sleep(NAME_TAG.hoverMs / 2); assert.equal(tips.shown, false, 'not before 120 ms');
    await sleep(NAME_TAG.hoverMs); assert.equal(tips.text, 'Binoculars · B', 'a hover of 120 ms shows it');
    assert.equal(tips.side, 'up', 'above the bottom row');
    ptr(bino, 'pointerleave', 'mouse'); assert.equal(tips.shown, false);
    assert.equal(NAME_TAG.hoverMs, 120);
    // the top bar (Sail): the view segments and the menu name C and Esc, under the bar
    const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: null, once: false, nudge: false, fullscreen: { supported: () => true, active: () => false, on() {}, toggle() {} } });
    vs.update(0.1);
    const helm = vs.el.querySelector('.seg[data-view=helm]'), menu = vs.el.querySelector('.mn');
    assert.equal(tipText(helm), 'Helm view · C'); assert.equal(tipText(menu), 'Menu · Esc');
    assert.equal(vs.el.querySelectorAll('[title]').length, 0, 'no browser title on the bar');
    ptr(menu, 'pointerenter', 'mouse'); await sleep(NAME_TAG.hoverMs + 40);
    assert.equal(tips.text, 'Menu · Esc'); assert.equal(tips.side, 'down', 'under the top bar');
    ptr(menu, 'pointerleave', 'mouse');
    // the control panel (the cockpit's hit layer is its cells): a push button and a rocker
    const cp = createControlPanel({ dock }); cp.update(0.1);
    assert.equal(tipText(cp.el.querySelector('.c[data-id=binoculars]')), 'Binoculars · B');
    assert.equal(tipText(cp.el.querySelector('.c[data-id=sails]')), 'Sails up / down · Y');
    assert.equal(document.querySelectorAll('.lk-ntag').length, 1, 'one tip element for every bar');
    cp.dispose(); vs.dispose(); dock.dispose();
  } finally { dom.uninstall(); }
});

test('a long-press on touch shows the tip and is not a press; a tap is a press', async () => {
  const dom = installDom({ w: 390, h: 844, coarse: true });
  try {
    let runs = 0;
    const dock = createToolDock();
    dock.register({ id: 'binoculars', key: 'B', name: 'binoculars', icon: ICONS.binoculars, action: () => runs++ });
    const tips = sharedTips(), b = dock.el.querySelector('.it[data-id=binoculars]');
    ptr(b, 'pointerdown', 'touch'); ptr(b, 'pointerup', 'touch'); b.click();
    assert.equal(runs, 1, 'a tap runs it'); assert.equal(tips.shown, false, 'and shows nothing');
    ptr(b, 'pointerdown', 'touch'); await sleep(NAME_TAG.holdMs + 60);
    assert.equal(tips.text, 'Binoculars', 'a long-press names it, without its key: a touch device shows no key hints (owner, 2026-11-15)');
    ptr(b, 'pointerup', 'touch'); b.click();
    assert.equal(runs, 1, 'the click that ends the long-press is swallowed');
    b.click(); assert.equal(runs, 2, 'the next tap runs it');
    dock.dispose();
  } finally { dom.uninstall(); }
});

test('Settings › Screen › button tips: on by default; off, nothing shows', async () => {
  assert.equal(SETTINGS.tips, true, 'on by default');
  const dom = installDom();
  try {
    const s = createSettings({ storage: null });
    assert.equal(s.get('tips'), true);
    const tips = createTips(), b = button('<button aria-label="chart (N)"></button>'); tips.add(b);
    setTipsOn(false); assert.equal(tipsOn(), false); assert.equal(document.documentElement.dataset.lkTips, 'off');
    ptr(b, 'pointerenter', 'mouse'); await sleep(NAME_TAG.hoverMs + 40);
    assert.equal(tips.shown, false, 'off: no tip on a hover');
    ptr(b, 'pointerleave', 'mouse');
    setTipsOn(true); assert.equal(tipsOn(), true);
    ptr(b, 'pointerenter', 'mouse'); await sleep(NAME_TAG.hoverMs + 40);
    assert.equal(tips.text, 'Chart · N', 'on again');
    tips.dispose();
  } finally { dom.uninstall(); }
});

test('the tip never covers the skipper\'s line: it takes the other side, else it stays down', async () => {
  const dom = installDom();
  try {
    let line = [];
    const tips = createTips({ avoid: () => line }), b = button('<button aria-label="chart (N)"></button>');
    b.getBoundingClientRect = () => ({ left: 600, right: 640, top: 300, bottom: 340, width: 40, height: 40 });
    tips.el.getBoundingClientRect = () => ({ width: 80, height: 30 });
    Object.defineProperty(tips.el, 'offsetWidth', { get: () => 80 }); Object.defineProperty(tips.el, 'offsetHeight', { get: () => 30 });
    tips.add(b, { side: 'down' });
    tips.show(b); assert.equal(tips.side, 'down', 'nothing in the way: its own side');
    line = [{ left: 400, right: 900, top: 345, bottom: 400 }];   // the skipper's line just under the button
    tips.show(b); assert.equal(tips.side, 'up', 'the line is under it: the tip goes above');
    line.push({ left: 400, right: 900, top: 250, bottom: 299 });   // and a second line above
    tips.show(b); assert.equal(tips.shown, false, 'both sides covered: no tip at all');
    tips.dispose();
  } finally { dom.uninstall(); }
});

test('the tip goes on a drag or a steer: a key, a press elsewhere, a wheel', async () => {
  const dom = installDom();
  try {
    const tips = createTips(), b = button('<button aria-label="chart (N)"></button>'), other = button('<button>x</button>');
    tips.add(b);
    for (const go of [() => dom.key('keydown', 'KeyA'), () => ptr(other, 'pointerdown', 'mouse', { buttons: 1 }), () => dispatchEvent(new Event('wheel'))]) {
      tips.show(b); assert.equal(tips.shown, true);
      go(); assert.equal(tips.shown, false);
    }
    // a hover's wait is cancelled by a steer too
    ptr(b, 'pointerenter', 'mouse'); dom.key('keydown', 'ArrowLeft'); await sleep(NAME_TAG.hoverMs + 40);
    assert.equal(tips.shown, false, 'steering during the wait: no tip');
    tips.dispose();
  } finally { dom.uninstall(); }
});
