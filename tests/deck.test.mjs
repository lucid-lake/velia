// The deck (refactor round 2, Phase C step 8): any craft's shared inputs,
// dock, views and bar, on the node DOM with a stub player and no sail code. Held keys, a drag's look, the wheel's zoom, a
// click to the controller's hook (a drag never; a blocked press never), the view switch and its move, the dock's rows,
// the bar built once, C handled once, and nothing left behind after dispose.
import './helpers/terrain-small.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { attachDeck, STEADY } from '../classic/src/deck/index.js';
import { createPlayer } from '../src/sim/core/player.js';
import { FollowCamera } from '../src/sim/boat/followCamera.js';
import { CURRENT_VESSEL } from '../src/sim/vessels/current.js';
import { installDom } from './helpers/dom-cascade.mjs';
import { parseFlags } from '../src/sim/core/flags.js';
import { createServices } from '../src/sim/core/services.js';
import { any } from './helpers/sail-controls.mjs';

function mount({ params = '', services: svc = null } = {}) {
  const dom = installDom({ w: 1280, h: 720, search: `?mode=sail&once=0&${params}` });
  const services = svc ?? createServices();
  const core = { services, flags: parseFlags(`once=0&${params}`), renderer: { domElement: document.createElement('canvas') }, camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(), audio: any('audio'), clock: { hourAt: () => 12, setHour() {}, rateAt: () => 1 }, sun: { hour: 12 }, sky: null };
  document.body.appendChild(core.renderer.domElement);
  const state = { x: 0, z: 0, heading: 0, heave: 0, sog: 0 };
  const cues = [];
  const player = createPlayer({ craft: 'halcyon', kind: 'sail', phys: { state, t: 0, vessel: CURRENT_VESSEL }, follow: new FollowCamera(), cue: (n) => cues.push(n) });
  const deck = attachDeck(core, player, { cruiseKey: 'Backquote' });
  const canvas = core.renderer.domElement;
  const ptr = (type, x, y, o = {}) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', movementX: 0, movementY: 0, ...o }));
  const frame = (dt = 1 / 60) => { deck.begin(dt); deck.camera(dt, { rs: state, pose: { ...state, heel: 0, pitch: 0 }, look: deck.look() }); deck.end(); };
  return { dom, core, services, deck, player, canvas, ptr, frame, state, cues, unmount() { deck.dispose(); dom.uninstall(); } };
}

test('keys: held codes are in deck.keys, a key up or a blur clears them; a virtual key never enters', () => {
  const m = mount();
  try {
    m.dom.key('keydown', 'KeyW'); m.dom.key('keydown', 'KeyA');
    assert.deepEqual([...m.deck.keys].sort(), ['KeyA', 'KeyW']);
    m.dom.key('keyup', 'KeyW');
    assert.deepEqual([...m.deck.keys], ['KeyA']);
    dispatchEvent(new Event('blur'));
    assert.equal(m.deck.keys.size, 0);
    const e = new KeyboardEvent('keydown', { code: 'KeyS' }); e.lkVirtual = true; dispatchEvent(e);
    assert.equal(m.deck.keys.size, 0);
  } finally { m.unmount(); }
});

test('the mouse: a 100 px right-drag looks [0.5, 0.4]; a wheel of 100 zooms e^0.1; end() uses them up', () => {
  const m = mount();
  try {
    m.ptr('pointerdown', 100, 100, { button: 2 });
    m.ptr('pointermove', 200, 200, { button: 2, movementX: 100, movementY: 100 });
    assert.deepEqual(m.deck.look(), [0.5, 0.4]);
    m.ptr('pointerup', 200, 200, { button: 2 });
    m.canvas.dispatchEvent(new Event('wheel', { deltaY: 100 }));
    assert.ok(Math.abs(m.deck.zoom - Math.exp(0.1)) < 1e-12);
    m.deck.end();
    assert.equal(m.deck.look(), null); assert.equal(m.deck.zoom, 1);
  } finally { m.unmount(); }
});

test('a click calls onClick once; a drag never; clickBlocked swallows it', () => {
  const m = mount(), clicks = [];
  try {
    let blocked = false;
    m.deck.setHooks({ onClick: (x, y) => clicks.push([x, y]), clickBlocked: () => blocked });
    m.ptr('pointerdown', 300, 300); m.ptr('pointerup', 302, 301);
    assert.deepEqual(clicks, [[302, 301]]);
    m.ptr('pointerdown', 300, 300); m.ptr('pointermove', 360, 300, { movementX: 60 }); m.ptr('pointerup', 360, 300);
    assert.equal(clicks.length, 1, 'a drag is no click');
    blocked = true;
    m.ptr('pointerdown', 300, 300); m.ptr('pointerup', 300, 300);
    assert.equal(clicks.length, 1, 'blocked');
  } finally { m.unmount(); }
});

test('views: setView(helm) flips the view and the move grows over a second of frames; C toggles once; Shift+C the chase', () => {
  const m = mount();
  try {
    assert.equal(m.deck.view, 'follow'); assert.equal(m.deck.helmCam.steady, STEADY);
    m.deck.mountBar({});
    assert.equal(m.deck.setView('helm'), 'helm');
    const ks = [];
    for (let i = 0; i < 60; i++) { m.frame(); ks.push(m.deck.blend.k); }
    assert.ok(ks[10] > 0 && ks[59] > ks[10], `blend ${ks[10].toFixed(2)} → ${ks[59].toFixed(2)}`);
    m.dom.key('keydown', 'KeyC'); m.dom.key('keyup', 'KeyC');
    assert.equal(m.deck.view, 'follow', 'one C, one switch');
    assert.equal(m.player.follow.chase, true);
    m.dom.key('keydown', 'KeyC', { shiftKey: true });
    assert.equal(m.deck.view, 'follow', 'Shift+C is the chase, not the view');
    assert.equal(m.player.follow.chase, false);
  } finally { m.unmount(); }
});

test('the dock: chart, logbook, helm, keys; cruise only with a switchMode service; the click cue goes to the player', () => {
  const m = mount();
  try {
    const dock = m.deck.mountDock();
    for (const id of ['chart', 'logbook', 'helm', 'keys', 'cruise']) assert.ok(dock.spec(id), id);
    assert.equal(dock.visible('cruise'), false);
    m.services.provide('switchMode', () => {});
    assert.equal(dock.visible('cruise'), true);
    dispatchEvent(new Event('lk-click'));
    assert.deepEqual(m.cues, ['click']);
    assert.equal(m.services.get('dock'), dock);
  } finally { m.unmount(); }
});

test('the bar is built once, when asked; dispose leaves no service, no bar and no listener', () => {
  const m = mount();
  const keyFn = []; m.deck.onKey((e) => keyFn.push(e.code));
  assert.equal(document.querySelectorAll('.lk-view').length, 0, 'no bar before mountBar');
  m.deck.mountDock(); m.deck.mountBar({});
  assert.equal(document.querySelectorAll('.lk-view').length, 1);
  m.dom.key('keydown', 'KeyR');
  assert.deepEqual(keyFn, ['KeyR'], 'a controller key runs inside the deck\'s listener');
  for (const k of ['dock', 'modality', 'viewSwitch']) assert.ok(m.services.get(k), k);
  m.deck.dispose();
  for (const k of ['dock', 'modality', 'viewSwitch']) assert.equal(m.services.get(k) ?? null, null, k);
  assert.equal(document.querySelectorAll('.lk-view').length, 0, 'the bar is gone');
  m.dom.key('keydown', 'KeyR'); m.dom.key('keydown', 'KeyC');
  assert.deepEqual(keyFn, ['KeyR'], 'no listener after dispose');
  assert.ok(!m.deck.keys.has('KeyC'), 'the held keys no longer listen');
  assert.equal(m.deck.view, 'follow', 'C no longer switches');
  m.dom.uninstall();
});
