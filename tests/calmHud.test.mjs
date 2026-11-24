// The Calm HUD (owner, 2026-11-05; src/ui/calmHud.js): the idle timer, the wake sources, the contextual returns, the
// mode defaults and the captures that never run it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sailCoreOptions } from '../classic/src/sail/options.js';
import { coreOptions as regattaCoreOptions } from '../classic/src/modes/regatta/index.js';
import { CalmClock, CALM, hudFor, calmAllowed, approach, DASH_KEYS, HUD_MODES, LINE, createCalmHud, nextPreset, puckText, FOLD_KEY, Glide, easeIO } from '../src/ui/calmHud.js';
import { createSettings, SETTINGS, HUD } from '../src/ui/settings.js';
import { pagesHtml } from '../src/ui/homePages.js';
import { createHud3d } from '../classic/src/ui/hud3d.js';
import * as THREE from 'three/webgpu';
import { parseFlags } from '../src/sim/core/flags.js';
import { createServices } from '../src/sim/core/services.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const run = (c, s, o = {}) => { let v; for (let t = 0; t < s - 1e-9; t += 0.1) v = c.tick(0.1, o); return v; };

// createCalmHud on a small DOM: the elements it makes, the html classes it sets, window listeners (removed on dispose).
// The real page (the shell, the 3D slots, the cascade) is tests/pages/calmHud.page.mjs (retired 2026-11-18).
// L: what the registry holds (the shell's and the mode's services); provided: each provide() Calm makes, by name
function mountCalm({ L = {}, query = 'mode=sail&seed=1', reduced = false, provided = null } = {}) {
  const reg = createServices(); for (const [k, v] of Object.entries(L)) reg.provide(k, v);
  const services = { ...reg, provide: (k, v) => { provided?.push(k); return reg.provide(k, v); } };
  const mk = (tag) => {
    const set = new Set();
    return { tagName: tag, children: [], style: {}, attrs: {}, dataset: {}, set innerHTML(h) { this.html = h; },
      classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parent = this; return c; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      addEventListener() {}, contains: (x) => x === this };
  };
  const head = mk('head'), body = mk('body'), documentElement = mk('html');
  const doc = { head, body, documentElement, createElement: mk, getElementById: (id) => head.children.find((c) => c.id === id) ?? null, querySelectorAll: () => [], querySelector: () => null };
  const g = globalThis, saved = { addEventListener: g.addEventListener, matchMedia: g.matchMedia, innerHeight: g.innerHeight };
  const target = new EventTarget();
  g.addEventListener = (...a) => target.addEventListener(...a);
  g.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q) });
  g.innerHeight = 720;
  const calm = createCalmHud({ services, flags: parseFlags(query), doc, storage: null });
  const restore = () => { calm.dispose(); Object.assign(g, saved); };
  return { calm, doc, H: documentElement, restore, tick: (s, dt = 0.1) => { for (let t = 0; t < s - 1e-9; t += dt) calm.update(dt); } };
}

test('Calm: after 5 s with no input the bar and the dashboard go; the anchor shows only while the bar is gone', () => {
  const c = new CalmClock();
  assert.equal(CALM.idleS, 5); assert.equal(CALM.fadeMs, 600);
  let v = run(c, 4.9); assert.equal(v.bar, true); assert.equal(v.dash, true); assert.equal(v.anchor, false);
  v = run(c, 0.2); assert.equal(v.bar, false); assert.equal(v.dash, false); assert.equal(v.anchor, true);
  assert.equal(v.wheel, 0, 'desktop: the wheel goes with the rest');
});

test('wake sources: a mouse move brings the bar only; the helm keys bring the dashboard only; a tap brings both; each restarts 5 s', () => {
  const c = new CalmClock(); run(c, 6);
  c.wake('bar'); let v = c.view; assert.equal(v.bar, true); assert.equal(v.dash, false); assert.equal(v.anchor, false);
  run(c, 3); c.wake('dash'); v = run(c, 2.5); assert.equal(v.bar, false, 'the bar left 5 s after its wake'); assert.equal(v.dash, true);
  v = run(c, 3); assert.equal(v.dash, false);
  c.wake('all'); v = c.view; assert.equal(v.bar, true); assert.equal(v.dash, true);
  for (const k of ['KeyA', 'KeyD', 'ArrowLeft', 'KeyW', 'KeyS', 'Equal', 'Minus', 'Digit0']) assert.ok(DASH_KEYS.has(k), k);
  for (const k of ['Escape', 'KeyL', 'KeyN', 'KeyH', 'KeyM']) assert.ok(!DASH_KEYS.has(k), `${k} opens something, as today`);
});

test('nothing fades while busy (a menu, a page, a drag) or while the pointer rests on the bar or the dashboard', () => {
  const c = new CalmClock();
  let v = run(c, 20, { busy: true }); assert.equal(v.bar, true); assert.equal(v.dash, true);
  v = run(c, 20, { hoverBar: true }); assert.equal(v.bar, true); assert.equal(v.dash, false);
  v = run(c, 20, { hoverDash: true }); assert.equal(v.dash, true); assert.equal(v.bar, false);
});

test('contextual returns: one piece back while needed, gone 5 s after the condition clears', () => {
  const c = new CalmClock(); run(c, 6);
  let v = c.tick(0.1, { needs: { trim: true } }); assert.equal(v.dash, false); assert.equal(v.need.trim, true); assert.equal(v.need.depth, false); assert.equal(v.need.thr, false);
  v = run(c, 30, { needs: { trim: true, thr: true } }); assert.equal(v.need.trim, true); assert.equal(v.need.thr, true); assert.equal(v.bar, false);
  v = run(c, 4.9); assert.equal(v.need.trim, true, 'held 5 s after the sails stop shaking');
  v = run(c, 0.2); assert.equal(v.need.trim, false); assert.equal(v.need.thr, false);
  v = run(c, 1, { needs: { depth: true } }); assert.equal(v.need.depth, true);
});

test('a shaking sail calls back its own winch only; the trim hint calls both', () => {
  const c = new CalmClock(); run(c, 6);
  let v = c.tick(0.1, { needs: { jib: true } }); assert.equal(v.need.jib, true); assert.equal(v.need.main, false); assert.equal(v.need.trim, false); assert.equal(v.dash, false);
  v = run(c, 5.1); assert.equal(v.need.jib, false, 'gone 5 s after the jib stops shaking');
  v = c.tick(0.1, { needs: { trim: true } }); assert.equal(v.need.trim, true); assert.equal(v.need.jib, false);
});

test('phone: the wheel stays faint (35 %) and the rest goes; a tap brings it to full', () => {
  const c = new CalmClock({ faintWheel: true }); const v = run(c, 6);
  assert.equal(v.dash, false); assert.equal(v.wheel, CALM.wheelFaint); assert.equal(CALM.wheelFaint, 0.35);
  c.wake('all'); assert.equal(c.view.wheel, 1);
});

test('Full shows everything always; Clear (was Off) hides everything but the boat\'s safety peeks; wakes do nothing there', () => {
  const f = new CalmClock({ mode: 'full' }); let v = run(f, 60); assert.equal(v.bar, true); assert.equal(v.dash, true); assert.equal(v.anchor, false); assert.deepEqual(v.dials, { chart: 'open', wind: 'open' });
  const o = new CalmClock({ mode: 'off', faintWheel: true }); assert.equal(o.mode, 'clear', 'the old name'); v = o.view;
  assert.equal(v.bar, false); assert.equal(v.dash, false); assert.equal(v.wheel, 0); assert.equal(v.anchor, true); assert.deepEqual(v.dials, { chart: 'off', wind: 'off' });
  o.wake('all'); assert.equal(o.view.bar, false, 'Clear: a wake does not bring it');
  v = o.tick(0.1, { needs: { depth: true, jib: true } }); assert.equal(v.need.depth, true, 'the sounder still calls the chart'); assert.equal(v.dials.chart, 'open'); assert.equal(v.need.jib, true); assert.equal(v.dash, false);
  v = run(o, 5.1); assert.equal(v.need.depth, false); assert.equal(v.dials.chart, 'off');
  const c = new CalmClock(); run(c, 6); c.setMode('full'); assert.equal(c.view.bar, true); c.setMode('calm'); assert.equal(c.view.bar, true, 'a mode change wakes it'); assert.equal(run(c, 5.1).bar, false);
});

test('Instruments: the dials only, the cockpit folded (wheel 0), the bar up; the peeks still call a winch back', () => {
  const c = new CalmClock({ mode: 'instruments' }); let v = run(c, 30);
  assert.equal(v.bar, true); assert.equal(v.dash, false); assert.equal(v.wheel, 0); assert.equal(v.fold, true); assert.deepEqual(v.dials, { chart: 'open', wind: 'open' });
  c.wake('dash'); assert.equal(c.view.dash, false, 'the helm keys do not unfold it');
  v = c.tick(0.1, { needs: { main: true } }); assert.equal(v.need.main, true); assert.equal(v.need.jib, false);
  v = run(c, 5.1); assert.equal(v.need.main, false);
});

// two states only (owner, 2026-11-12, look/cockpit-fold): folded, the whole cockpit is away, nothing peeks and no pucks stay behind
test('the fold: the whole cockpit away, no peek and no pucks (two states only); back up, all of it; only where a cockpit is', () => {
  for (const mode of ['full', 'calm']) {
    const c = new CalmClock({ mode }); c.setFold(true);
    let v = c.view; assert.equal(v.fold, true, mode); assert.equal(v.dash, false); assert.equal(v.wheel, 0); assert.deepEqual(v.dials, { chart: 'off', wind: 'off' }, `${mode}: no pucks`);
    assert.equal(v.bar, true, `${mode}: the bar as the preset has it`);
    c.openDial('wind'); assert.deepEqual(c.view.dials, { chart: 'off', wind: 'off' }, 'nothing to open');
    v = c.tick(0.1, { needs: { depth: true, jib: true, main: true, trim: true, thr: true } });
    assert.deepEqual(v.need, { trim: false, jib: false, main: false, depth: false, thr: false }, `${mode}: no peek (a luffing sail, the sounder, the engine)`);
    assert.deepEqual(v.dials, { chart: 'off', wind: 'off' });
    c.setFold(false); v = c.view; assert.equal(v.fold, false); assert.equal(v.wheel, 1); assert.equal(v.dials.wind, 'open');
  }
  const p = new CalmClock({ mode: 'full', fold: true, foldable: false }); assert.equal(p.view.fold, false, 'a phone: no cockpit, no fold'); assert.equal(p.view.dash, true);
});

test('the fold slides, eased, in 0.4 s with no bounce: the Glide', () => {
  assert.equal(CALM.foldMs, 400);
  const g = new Glide(1), seen = [];
  for (let t = 0; t < 0.6; t += 0.05) seen.push(g.step(0, 0.05, 0.4));
  assert.ok(seen.every((x, i) => x >= 0 && x <= 1 && (i === 0 || x <= seen[i - 1])), `monotonic, inside 0..1 (${seen.map((x) => x.toFixed(2))})`);
  assert.equal(seen[7], 0, 'there at 0.4 s'); assert.ok(seen[0] > 0.95, 'eases in'); assert.ok(seen[3] > 0.4 && seen[3] < 0.6, 'half way at 0.2 s');
  // a target it stops short of (a phone's faint wheel) lands exactly; a turn mid-way glides on from where it stood
  const f = new Glide(0); for (let i = 0; i < 20; i++) f.step(0.35, 0.05, 0.4); assert.equal(f.v, 0.35);
  const h = new Glide(1); h.step(0, 0.1, 0.4); const mid = h.v; h.step(1, 0.01, 0.4); assert.ok(Math.abs(h.v - mid) < 0.02, 'no jump on a turn');
  assert.equal(new Glide(1).step(0, 0.01, 0.4, true), 0, 'reduced motion: at once');
  assert.equal(easeIO(-1), 0); assert.equal(easeIO(2), 1); assert.equal(easeIO(0.5), 0.5);
});

test('the presets cycle (the H tap with no cockpit): the base (Full or Calm) → Instruments → Clear → the base', () => {
  assert.equal(nextPreset('full'), 'instruments'); assert.equal(nextPreset('calm'), 'instruments');
  assert.equal(nextPreset('instruments', 'calm'), 'clear'); assert.equal(nextPreset('clear', 'calm'), 'calm'); assert.equal(nextPreset('clear', 'full'), 'full');
  assert.equal(nextPreset('clear', 'auto'), 'auto'); assert.equal(nextPreset('clear', 'junk'), 'auto'); assert.equal(nextPreset('off', 'full'), 'full');
  // the live module: H writes the setting (remembered), comes back to the base, the fold and base kept in localStorage
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const settings = createSettings({ storage });
  const reg = createServices();
  const g = globalThis, saved = { addEventListener: g.addEventListener, matchMedia: g.matchMedia, innerHeight: g.innerHeight };
  const mk = () => { const set = new Set(); return { children: [], style: {}, dataset: {}, set innerHTML(h) { this.html = h; }, classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
    setAttribute() {}, appendChild(c) { this.children.push(c); return c; }, remove() {}, addEventListener() {}, contains: () => false, querySelector: () => ({ textContent: '' }) }; };
  const head = mk(), doc = { head, body: mk(), documentElement: mk(), createElement: mk, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  g.addEventListener = () => {}; g.matchMedia = () => ({ matches: false }); g.innerHeight = 720;
  try {
    const calm = createCalmHud({ services: reg, settings, getOptions: () => ({ hud: 'calm' }), flags: parseFlags('mode=sail&seed=1'), doc, storage });
    calm.update(0.1); assert.equal(calm.mode, 'calm');
    assert.equal(calm.cycle(), 'instruments'); assert.equal(settings.get('hud'), 'instruments', 'remembered across visits');
    calm.update(0.1); assert.ok(doc.documentElement.classList.contains('lk-hud-instruments')); assert.ok(doc.documentElement.classList.contains('lk-folded'));
    assert.equal(calm.cycle(), 'clear'); assert.equal(calm.cycle(), 'calm'); assert.equal(settings.get('hud'), 'auto', 'back to the base the player had (auto)');
    assert.equal(calm.tab(), false, 'the tab does nothing without a cockpit (no station)');
    reg.provide('station', { cockpit: {} }); calm.update(0.1);
    assert.equal(calm.tab(), true); calm.update(0.1); assert.equal(calm.view.fold, true); assert.equal(JSON.parse(store.get(FOLD_KEY)).fold, true);
    const again = createCalmHud({ services: reg, settings, getOptions: () => ({ hud: 'calm' }), flags: parseFlags('mode=sail&seed=1'), doc, storage });
    again.update(0.1); assert.equal(again.view.fold, true, 'the fold kept across visits');
    again.cycle(); again.cycle(); again.cycle(); assert.equal(again.view.fold, false, 'H back to the base unfolds');
    calm.dispose(); again.dispose();
  } finally { Object.assign(g, saved); }
});

test('mode defaults: Calm in Sail and Cruise, Full in Regatta (each mode\'s coreOptions hud); the setting, then the URL, win', () => {
  assert.equal(sailCoreOptions({}).hud, 'calm'); assert.equal(regattaCoreOptions({}).hud, 'full');
  assert.equal(hudFor({ setting: 'auto', modeHud: 'calm' }), 'calm'); assert.equal(hudFor({ setting: 'auto' }), 'calm', 'a mode with none (fly)');
  assert.equal(hudFor({ setting: 'auto', modeHud: 'full' }), 'full');
  assert.equal(hudFor({ setting: 'clear', modeHud: 'full' }), 'clear'); assert.equal(hudFor({ setting: 'off', modeHud: 'full' }), 'clear', 'the old name');
  assert.equal(hudFor({ setting: 'off', modeHud: 'calm', url: 'full' }), 'full'); assert.equal(hudFor({ url: 'instruments' }), 'instruments');
  assert.equal(hudFor({ setting: 'bogus', modeHud: 'calm', url: 'nope' }), 'calm');
  assert.deepEqual(HUD_MODES, ['full', 'calm', 'instruments', 'clear']);
});

test('the setting persists like the others: hud auto by default, full | calm | instruments | clear kept (off read as clear), junk refused', () => {
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(SETTINGS.hud, 'auto'); assert.deepEqual(HUD, ['auto', 'full', 'calm', 'instruments', 'clear']);
  const s = createSettings({ storage }); assert.equal(s.set('hud', 'off'), 'clear'); assert.equal(s.set('hud', 'loud'), 'clear');
  assert.equal(createSettings({ storage }).get('hud'), 'clear', 'kept across pages');
  store.set('lakeshore.settings.v1', JSON.stringify({ hud: 'off' })); assert.equal(createSettings({ storage }).get('hud'), 'clear', 'an old saved Off');
  // Settings → Screen has the row: HUD, four radios full | calm | instruments | clear
  const html = pagesHtml({ waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' });
  const row = html.match(/<div class="set" data-set="hud">([\s\S]*?)<\/div>/);
  assert.ok(row, 'the HUD row is on the Settings page');
  assert.match(row[1], /<span class="k">HUD<\/span>/);
  assert.deepEqual([...row[1].matchAll(/role="radio" data-r="(hud:[a-z]+)"/g)].map((m) => m[1]), ['hud:full', 'hud:calm', 'hud:instruments', 'hud:clear']);
});

test('the pucks read HDG (three digits) and AWA with its side', () => {
  const D = Math.PI / 180;
  assert.deepEqual(puckText({ heading: 5 * D, awa: -31 * D }), { hdg: '005°', awa: '31°', side: 'P' });
  assert.deepEqual(puckText({ heading: -10 * D, awa: 120 * D }), { hdg: '350°', awa: '120°', side: 'S' });
  assert.equal(puckText({ heading: 360 * D }).hdg, '000°');
});
test('captures never run Calm: headless, a pinned shot or the gate frame stay Full (the goldens hold)', () => {
  assert.equal(calmAllowed(parseFlags('mode=sail&seed=1&headless=1&once=0&noload=1')), false);
  assert.equal(calmAllowed(parseFlags('mode=sail&shot=cockpit-astern')), false);
  assert.equal(calmAllowed(parseFlags('mode=sail&gate=1&quality=high')), false);
  assert.equal(calmAllowed(parseFlags('mode=sail&seed=1')), true);
  const frames = JSON.parse(read('golden/frames.json'));
  // the live UI frames (film: hud-full, hud-calm, first-visit) run the HUD on purpose, with hud= pinned; every other frame never does
  for (const f of frames.frames) {
    const q = new URLSearchParams(`${f.query}&${f.pin ?? frames.pin}`);
    if (f.film) assert.ok(['full', 'calm', 'instruments', 'clear'].includes(q.get('hud')), `${f.name}: hud= pinned`);
    else assert.equal(calmAllowed(parseFlags(q)), false, f.name);
  }
  // mounted on a headless page anyway, it stays Full (the shell itself never loads there: tests/pages/calmHud.page.mjs (retired 2026-11-18))
  const m = mountCalm({ query: 'mode=sail&headless=1' });
  try { m.tick(20); assert.equal(m.calm.mode, 'full'); assert.ok(!m.H.classList.contains('lk-calm-bar') && !m.H.classList.contains('lk-calm-dash')); } finally { m.restore(); }
});

test('the fades: 600 ms, instant with reduced motion; the 3D objects have a real per-slot opacity', () => {
  assert.equal(approach(1, 0, 0.3, 0.6), 0.5); assert.equal(approach(0, 0.35, 1, 0.6), 0.35); assert.equal(approach(1, 0, 0.016, 0.6, true), 0);
  // the injected stylesheet: 600 ms, 0 ms under reduced motion (the real cascade: tests/pages/calmHud.page.mjs (retired 2026-11-18))
  let m = mountCalm();
  try {
    const st = m.doc.getElementById('lk-calm-css');
    assert.ok(st && st.tagName === 'style', 'the Calm stylesheet is injected once');
    const css = st.textContent.replace(/\s+/g, '');
    assert.ok(css.includes(':root{--lk-calm-fade:600ms}'), 'the fade token');
    assert.ok(css.includes('@media(prefers-reduced-motion:reduce){:root{--lk-calm-fade:0ms}}'), 'reduced motion: no fade');
    // the 3D slots ease at the DOM's pace: one frame after Calm takes the dashboard, the wheel is part-way down
    m.tick(5.05); const t = m.calm.slotTargets.wheel; assert.ok(m.H.classList.contains('lk-calm-dash'));
    assert.ok(t > 0 && t < 1, `fading over 600 ms (${t})`);
    m.tick(1); assert.equal(m.calm.slotTargets.wheel, 0);
  } finally { m.restore(); }
  m = mountCalm({ reduced: true });
  try { m.tick(5.05); assert.equal(m.calm.slotTargets.wheel, 0, 'reduced motion: the slot is gone at once'); } finally { m.restore(); }
  // the hud3d slot: a real per-slot opacity, clamped, 1 by default and again after dispose
  const hud = createHud3d({ renderer: { backend: {} }, scene: null });
  const slot = hud.slot({ object: new THREE.Object3D(), camera: new THREE.PerspectiveCamera(), rect: () => null });
  assert.equal(slot.opacity, 1);
  slot.setOpacity(0.35); assert.equal(slot.opacity, 0.35); assert.equal(hud.slots[0].op.value, 0.35, 'the shader\'s uniform');
  slot.setOpacity(4); assert.equal(slot.opacity, 1); slot.setOpacity(-1); assert.equal(slot.opacity, 0);
  slot.dispose(); assert.equal(hud.slots[0].op.value, 1);
  // no keys-hint hack: the keys card simply keeps the HUD up; Calm never forces the hint or flags the controls
  const writes = [], spy = (o, path) => new Proxy(o, { set(t, k, v) { writes.push(`${path}.${String(k)}`); t[k] = v; return true; } });
  let forced = 0;
  const hint = spy({ current: 'keys', force: () => { forced++; }, flash() {} }, 'hint');
  const provided = [];
  m = mountCalm({ L: { controls: spy({ hint }, 'controls') }, provided });
  try {
    m.tick(20);
    assert.equal(m.calm.view.dash, true, 'the keys card up: the dashboard stays'); assert.equal(m.calm.view.bar, true);
    hint.current = null; writes.length = 0; m.tick(6);
    assert.equal(m.calm.view.dash, false, 'the card gone: Calm takes over');
    assert.equal(forced, 0, 'the hint is never forced'); assert.deepEqual(writes, [], 'Calm writes nothing into the controls'); assert.deepEqual(provided, [], 'nor into the registry');
  } finally { m.restore(); }
  assert.equal(LINE.mouse, 'Move the mouse to show the helm'); assert.equal(LINE.touch, 'Tap to show the helm');
});
