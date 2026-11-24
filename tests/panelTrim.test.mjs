// TRIM and VHF on the helm panels (owner, 2026-10-30): the control panel's TRIM button is Settings → Sailing's basic | pro switch,
// the VHF button lives on the Pro trim panel (on by default, saved), and the panels open no pop-up hints.
// The live wiring (Sail's dock entry 'pro' and the trim panel, the VHF button and the captain's tools, Cruise's and Regatta's radios,
// the helm view's parts) is checked in a real browser: tests/pages/helmWiring.page.mjs; the Settings row: tests/pages/proSetting.page.mjs (retired 2026-11-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL } from '../src/stations/sloop/controlPanel.js';
import { TRIM } from '../src/stations/sloop/trimPanel.js';
import { SETTINGS, createSettings } from '../src/ui/settings.js';
import { keysPageHtml } from '../src/ui/keysContent.js';
import { installDom, memStorage } from './helpers/dom-helm.mjs';
import * as THREE from 'three/webgpu';
import { parseFlags } from '../src/sim/core/flags.js';
import { createServices } from '../src/sim/core/services.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('TRIM replaced VHF in its slot, as a push-button in the same family as BINOCULARS and MOOR', () => {
  const i = PANEL.findIndex((p) => p[1] === 'TRIM');
  assert.equal(i, 2, 'VHF\'s old place');
  assert.equal(PANEL[i][2], 'push'); assert.equal(PANEL[i][0], 'pro');
  assert.ok(!PANEL.some((p) => p[1] === 'VHF'));
});

test('TRIM runs the dock\'s pro switch, and its ring follows that state', async () => {
  const dom = installDom();
  const { createToolDock } = await import('../src/ui/toolDock.js');
  const { createControlPanel } = await import('../src/stations/sloop/controlPanel.js');
  let pro = false; const runs = [];
  const dock = createToolDock();
  dock.register({ id: 'pro', key: '', name: 'pro trim', order: 80, action: () => { runs.push(!pro); pro = !pro; }, visible: () => true });
  const panel = createControlPanel({ dock, lit: { pro: () => pro } });
  const cell = panel.el.querySelector('.c[data-id=pro]');
  panel.update(0.1);
  assert.equal(cell.classList.contains('dead'), false, 'live');
  assert.equal(cell.classList.contains('on'), false);
  cell.click(); panel.update(0.1);
  assert.deepEqual(runs, [true]); assert.equal(cell.classList.contains('on'), true, 'the ring lights while pro is on');
  assert.equal(cell.getAttribute('aria-pressed'), 'true');
  cell.click(); panel.update(0.1);
  assert.deepEqual(runs, [true, false]); assert.equal(cell.classList.contains('on'), false);
  panel.dispose(); dock.dispose(); dom.uninstall();
});

test('VHF: a push-button on the Pro trim panel, on by default and saved', async () => {
  assert.ok(TRIM.some((t) => t.id === 'vhf' && t.kind === 'push' && t.word === 'VHF'));
  assert.equal(SETTINGS.vhf, true);
  const st = mem(); const a = createSettings({ storage: st });
  assert.equal(a.get('vhf'), true);
  a.set('vhf', false);
  assert.equal(createSettings({ storage: st }).get('vhf'), false, 'the choice persists');
  a.set('vhf', 'no'); assert.equal(a.get('vhf'), false, 'a non-boolean is refused');
  // the trim panel's button: a push-button named for a screen reader, its state the radio's, a press runs onVhf
  const dom = installDom();
  const { createTrimPanel } = await import('../src/stations/sloop/trimPanel.js');
  let on = true; const used = [];
  const tp = createTrimPanel({ vhf: () => on, onVhf: () => { on = !on; }, onUse: (id) => used.push(id), shown: () => true });
  tp.update();
  const b = tp.el.querySelector('.c[data-id=vhf] .pb');
  assert.equal(b.localName, 'button'); assert.equal(b.getAttribute('aria-label'), 'VHF radio');
  assert.equal(b.getAttribute('aria-pressed'), 'true'); assert.ok(b.parentNode.classList.contains('on'), 'the ring is lit while the radio is on');
  b.click(); tp.update();
  assert.equal(on, false); assert.deepEqual(used, ['vhf']);
  assert.equal(b.getAttribute('aria-pressed'), 'false'); assert.ok(!b.parentNode.classList.contains('on'));
  tp.dispose(); dom.uninstall();
});

// the captain's tools on a stand-in core: the radio is spied, a boat 300 m from the harbour mouth
async function captainTools({ vhf = true, auto = true } = {}) {
  const dom = installDom();
  const prefs = new Map([['vhf', vhf]]);
  const services = createServices();
  services.provide('settings', { get: (k) => prefs.get(k), set: (k, v) => prefs.set(k, v) });   // the shell's shared settings
  const { createCaptainTools, AUTO_FORECAST_S, CHATTER } = await import('../classic/src/sail/captainTools.js');
  const core = { services, flags: parseFlags(''), renderer: { domElement: document.createElement('canvas') }, wind: { day: null, hourAt: () => 12, sample: () => ({ speed: 5, vx: 0, vz: -5 }) }, terrain: { heightAt: () => -30 },
    audio: null, harbour: { layout: { entrance: { centre: [400, 0] } } }, time: 0 };
  const phys = { state: { x: 100, z: 0, trueWind: { speed: 5 } } };
  const tools = createCaptainTools(core, { boat: { sockets: { hull: new THREE.Group() } }, phys, auto });
  const heard = [];
  tools.radio.play = () => heard.push('play'); tools.radio.chatter = () => heard.push('chatter');
  const run = (s) => { for (let i = 0; i < s * 10; i++) tools.update(0.1); };
  return { dom, tools, prefs, heard, run, AUTO_FORECAST_S, CHATTER };
}

test('VHF off silences the forecast, the harbour master and the chatter; on, they come back', async () => {
  const c = await captainTools({ vhf: false });
  c.tools.hmAsk('hm_storm');
  c.run(c.CHATTER.firstS + c.AUTO_FORECAST_S + 5);
  assert.deepEqual(c.heard, [], 'off: nothing on the radio');
  assert.equal(c.tools.forecast, null, 'off: no forecast by itself'); assert.deepEqual(c.tools.hmDone, []);
  assert.equal(c.tools.on, false);
  c.tools.toggle(); assert.equal(c.prefs.get('vhf'), true, 'the switch is the saved setting');
  c.run(30);
  assert.ok(c.tools.hmDone.includes('hm_storm'), 'on: the harbour master makes the asked call');
  assert.ok(c.heard.includes('play'), 'on: the radio speaks');
  c.tools.dispose(); c.dom.uninstall();
  const d = await captainTools({ vhf: true });
  d.run(d.CHATTER.firstS + 1);
  assert.ok(d.heard.includes('chatter'), 'on, near the harbour: its chatter on 16');
  d.run(d.AUTO_FORECAST_S);
  assert.notEqual(d.tools.forecast, null, 'on: the forecast by itself after the start');
  d.tools.toggle(); const n = d.heard.length; d.run(d.CHATTER.gapS[1] + 5);
  assert.equal(d.heard.length, n, 'turned off: silent from then on');
  d.tools.dispose(); d.dom.uninstall();
});

test('Cruise\'s tools (auto: false) never speak the forecast by themselves', async () => {
  const c = await captainTools({ vhf: true, auto: false });
  c.run(c.AUTO_FORECAST_S * 3);
  assert.equal(c.tools.forecast, null); assert.equal(c.tools.channel, '16');
  c.tools.dispose(); c.dom.uninstall();
});

test('the keys page names the VHF in Pro trim, not a main-panel button', () => {
  const html = keysPageHtml({ pro: false });
  assert.match(html, /VHF weather, now/); assert.match(html, /button is on the pro panel/);
});

// what a pointer could hover: titles, tooltips and the ghost boxes; and the stylesheet's .tip and .gh rules
const popups = (el) => el.querySelectorAll('[title], .tip, [role=tooltip], .gh');

test('no pop-up hints on the panels: no .tip, title, tooltip or ghost box on the wheel, winches, buttons, rockers, cars and knobs', async () => {
  const dom = installDom();
  const { createToolDock, ICONS } = await import('../src/ui/toolDock.js');
  const { createControlPanel } = await import('../src/stations/sloop/controlPanel.js');
  const { createTrimPanel } = await import('../src/stations/sloop/trimPanel.js');
  const { createThrottleColumn } = await import('../src/stations/sloop/throttleLever.js');
  const { createHelmStation } = await import('../classic/src/stations/sloop/helmStation.js');
  const dock = createToolDock();
  for (const [id, key, name, order] of [['chart', 'N', 'chart', 25], ['logbook', 'L', 'logbook', 20], ['binoculars', 'B', 'binoculars', 30], ['radio', 'O', 'VHF radio', 40], ['reef', 'K', 'reef: in, a second, out', 48],
    ['sails', 'Y', 'sails', 46], ['anchor', 'J', 'anchor', 47], ['lines', 'U', 'moor', 49], ['engine', 'I', 'engine', 10], ['pro', '', 'pro trim', 80], ['keys', 'H', 'keys', 70]])
    dock.register({ id, key, name, icon: ICONS[id] ?? '', order, action: () => {}, lit: () => true, badge: id === 'reef' ? () => 1 : undefined });
  const panel = createControlPanel({ dock, lit: { pro: () => true } });
  const trim = createTrimPanel({ shown: () => true, get: () => ({ traveller: 0, twist: 0, backstay: 0.5, jibLead: 0, wing: true }) });
  let st = 'off', lever = 0;
  const thr = createThrottleColumn({ lever: () => lever, engineState: () => st });
  panel.attach(thr);
  const wheel = new THREE.Group(), cockpit = new THREE.Group();
  const helm = createHelmStation({ hud: null, camera: new THREE.PerspectiveCamera() }, { boat: { modules: { wheel, cockpit } }, state: () => ({ heading: 0, rudder: 0, sog: 0 }), storage: memStorage(), once: true });
  for (let i = 0; i < 40; i++) {   // the first session's first seconds, a press on every switch, the throttle through its range
    dock.update(0.6); panel.update(0.1); trim.update(); helm.update?.(0.1);
    if (i === 5) { for (const c of panel.el.querySelectorAll('.c')) c.click(); panel.open(true); }
    if (i === 10) { st = 'running'; lever = 0.5; } if (i === 20) lever = -1;
  }
  for (const [name, el] of [['control panel', panel.el], ['panel row', panel.row], ['trim panel', trim.el], ['dock', dock.el], ['throttle', thr.el], ['helm station', helm.el]])
    assert.deepEqual(popups(el).map((n) => n.outerHTML.slice(0, 80)), [], `${name}: nothing pops up`);
  for (const id of ['lk-cp-css', 'lk-tp-css', 'lk-dock-css', 'lk-thr-css', 'lk-helm-css']) {
    const css = dom.style(id); assert.ok(css.length > 100, id);
    assert.doesNotMatch(css, /\.tip\b[^-]|\.gh\b/, `${id}: no tooltip or ghost-box rule`);
  }
  assert.doesNotMatch(dom.text(helm.el), /drag the wheel to steer/i, 'the first-time ghost boxes on the wheel and winches are gone');
  // aria-labels stay, so a screen reader still names every part
  const binos = panel.el.querySelector('.c[data-id=binoculars]');
  assert.equal(binos.getAttribute('aria-label'), 'binoculars (B)', 'a panel switch is read aloud with its key');
  assert.equal(panel.el.querySelector('.c[data-id=sails]').getAttribute('aria-label'), 'sails (Y)', 'a rocker by its word and key (the button tip reads it on a hover: tips.js, Solaria stage 1)');
  for (const t of TRIM.filter((x) => x.kind === 'track' || x.kind === 'knob')) assert.equal(trim.el.querySelector(`.c[data-id=${t.id}] [role=slider]`).getAttribute('aria-label'), t.word.toLowerCase());
  assert.equal(helm.el.querySelector('.pad.wheel').getAttribute('aria-label'), 'Helm');
  assert.equal(helm.el.querySelector('.pad.winch[data-w=main]').getAttribute('aria-label'), 'Mainsheet winch');
  assert.equal(thr.el.querySelector('[role=slider]').getAttribute('aria-label'), 'Throttle');
  helm.dispose(); thr.dispose(); trim.dispose(); panel.dispose(); dock.dispose(); dom.uninstall();
});
