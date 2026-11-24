// The front door (2026-11-13): v1's loading screen, home card and pages and settings store, on v2 (no reel, and no
// staged first minute: owner, 2026-11-13, "in v2 we do not need that"; v1 keeps its own).
// No browser: the seams in src/ (the mode registry's names, the features' Setup rows) keep v1's objects, the boot's stages are
// v1's loading stages, the gate is v1's rule, a first visit boots as a returning one (no pinned start, no dissolve, no opening
// camera), the mode picks v2 cannot play (Regatta; Cruise plays since BACKLOG-v2 #11) are marked soon, the settings store is v1's format 2 and shared. The browser half is
// v2/tests/pages/home.page.mjs and loading.page.mjs; the frame is the v2-home golden (a fresh browser: no welcome since 2026-11-21, the card's home view).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE_NAMES, CARDS as ROW_CARDS, pickNames } from '../../src/modes/rows.js';
import { MODE_ROWS, CARDS, pickRows } from '../../classic/src/modes/registry.js';
import { FEATURES, featureSettings as indexSettings } from '../../classic/src/features/index.js';
import { FEATURE_SETUP, featureSettings as setupSettings } from '../../src/features/setup.js';
import { STAGES } from '../../src/ui/loading.js';
import { MODES } from '../../src/ui/home.js';
import { toFlags } from '../../src/sim/core/flags.js';
import * as frontPlan from '../ui/frontPlan.js';
import { BOOT_STAGES, stageOf, frontGate, pickStates, V2_MODES, SOON } from '../ui/frontPlan.js';
import { markSoon } from '../ui/front.js';
import { createM4 } from '../ui/m4.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';

test('seam: the mode registry is its pure names plus a chunk each, the same rows, keys, order and card looks as before', () => {
  assert.equal(MODE_ROWS.length, MODE_NAMES.length);
  MODE_ROWS.forEach((r, i) => {
    const { load, ...name } = r;
    assert.deepEqual(name, MODE_NAMES[i], r.id);
    assert.deepEqual(Object.keys(r), [...Object.keys(MODE_NAMES[i]), 'load'], `${r.id}: the key order (load last, as the old table)`);
    assert.equal(typeof load === 'function', ['cruise', 'sail', 'regatta', 'fly'].includes(r.id), `${r.id}: a chunk where there was one`);
  });
  assert.equal(CARDS, ROW_CARDS, 'one card list (the same array)');
  assert.deepEqual(pickRows().map((r) => r.id), pickNames().map((r) => r.id));
  assert.deepEqual(MODES, [{ id: 'cruise', label: 'Cruise' }, { id: 'sail', label: 'Sail' }, { id: 'regatta', label: 'Regatta' }], 'the home card\'s picks');
});

test('seam: the features\' Setup rows are one source: index.js\'s rows carry setup.js\'s entries, and both lists agree on every page', () => {
  for (const [id, e] of Object.entries(FEATURE_SETUP)) {
    const row = FEATURES.find((f) => f.id === id);
    assert.equal(row.settings, e.settings, `${id}: the same settings array`); assert.equal(row.shown, e.shown, `${id}: the same shown()`);
  }
  for (const q of ['', 'kayaks=0', 'fireworks=1', 'kayaks=0&fireworks=1']) assert.deepEqual(setupSettings(toFlags(q)), indexSettings(toFlags(q)), q || '(none)');
});

test('boot flow: v2\'s steps are v1\'s loading stages, in v1\'s order, so the bar only moves forward', () => {
  const order = Object.keys(STAGES);
  let last = -1;
  for (const [step, name] of BOOT_STAGES) {
    assert.ok(name in STAGES, `${step} → ${name} is a loading stage`);
    assert.ok(order.indexOf(name) > last, `${name} after the one before`);
    last = order.indexOf(name);
    assert.equal(stageOf(step), name);
  }
  assert.equal(stageOf('nonsense'), null);
  assert.ok(BOOT_STAGES.some(([, n]) => n === 'sky'), 'the sky stage is told: a phone\'s film starts there (attractReel.js)');
});

test('boot flow: the gate is v1\'s rule (the card waits for ENTER for a visitor; automation, ?gate=0, a recovery reload or ?menu=0 go straight in)', () => {
  assert.equal(frontGate({ flags: '' }), true, 'a visitor');
  assert.equal(frontGate({ flags: '', webdriver: true }), false, 'automation');
  assert.equal(frontGate({ flags: 'gate=1', webdriver: true }), true, '?gate=1 asks for the card');
  assert.equal(frontGate({ flags: 'gate=0' }), false);
  assert.equal(frontGate({ flags: 'menu=0' }), false, 'no shell, no card');
  assert.equal(frontGate({ flags: '', resumeAt: 1000, now: 30e3 }), false, 'the GPU recovery\'s reload within a minute');
  assert.equal(frontGate({ flags: '', resumeAt: 1000, now: 90e3 }), true, 'an old mark');
});

test('first visit (owner, 2026-11-13): no staged minute in v2: no first-visit decision, no pinned start, so a new visitor boots as a returning one', () => {
  assert.equal(frontPlan.stagedStart, undefined, 'no first-visit decision and no staged start to pin');
  // the gate does not read the stored settings: a new visitor and a returning one get the same card (and no welcome: the profile starts as New, frontPlan.js seedProfile)
  assert.equal(frontGate({ flags: '' }), true, 'a new visitor waits on the card');
  assert.equal(frontGate({ flags: 'first=1' }), true, '?first=1 (v1\'s force) is just the card in v2');
});

// a tiny DOM stand-in: buttons with a class, data-mode / data-w, children
function fakeRoot(specs) {
  const mk = (tag) => ({ tagName: tag, children: [], className: '', textContent: '', attrs: {}, disabled: false,
    classList: { add(c) { this.o.className = `${this.o.className} ${c}`.trim(); } },
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); },
    querySelector(s) { return s === 'small.lk-soon-w' ? this.children.find((c) => c.className === 'lk-soon-w') ?? null : null; } });
  const buttons = specs.map(([cls, k, v]) => { const b = mk('BUTTON'); b.classList.o = b; b.className = cls; b.dataset = { [k]: v }; return b; });
  return {
    buttons, doc: { createElement: (t) => { const e = mk(t.toUpperCase()); e.classList.o = e; return e; } },
    querySelectorAll(sel) {
      return buttons.filter((b) => sel.split(',').map((s) => s.trim()).some((s) => {
        const m = /^\.([\w-]+)\[data-(mode|w)="([^"]+)"\]$/.exec(s);
        return m && b.className.split(' ')[0] === m[1] && b.dataset[m[2]] === m[3];
      }));
    },
  };
}

test('card wiring: Sail, Cruise and Regatta (BACKLOG-v2 #11, #12) are the picks v2 plays; a mode v2 lacks keeps its cell, disabled with v1\'s quiet "soon"', () => {
  assert.deepEqual(pickStates(MODES).map((x) => [x.id, x.ready]), [['cruise', true], ['sail', true], ['regatta', true]], 'the card\'s three: none soon since Regatta (owner 2026-11-14)');
  assert.deepEqual(V2_MODES, ['sail', 'cruise', 'regatta']); assert.equal(SOON, 'soon');
  const p = pickStates(MODES, ['sail', 'cruise']);   // the marking itself, on a page that lacked Regatta (the rule for any later mode)
  const root = fakeRoot([['lk-pick', 'mode', 'cruise'], ['lk-pick', 'mode', 'sail'], ['lk-pick', 'mode', 'regatta'], ['lk-sp', 'mode', 'cruise'], ['lk-sp', 'mode', 'sail'], ['choice', 'w', 'start:cruise'], ['choice', 'w', 'start:sail']]);
  const marked = markSoon(root, p, root.doc);
  assert.deepEqual(marked.sort(), ['regatta:lk-pick'], 'only Regatta is soon: the card\'s Cruise and the strip\'s enter Cruise');
  for (const b of root.buttons) {
    const soon = (b.dataset.mode ?? b.dataset.w.slice(6)) === 'regatta';
    assert.equal(b.disabled, soon, `${b.className} ${JSON.stringify(b.dataset)}`);
    assert.equal(b.children.some((c) => c.tagName === 'SMALL' && c.textContent === 'soon'), soon);
    if (soon) assert.equal(b.attrs['aria-disabled'], 'true');
  }
  markSoon(root, p, root.doc);
  assert.equal(root.buttons[2].children.length, 1, 'marking twice adds no second word');
});

test('first visit: m4\'s camera is the views\' chain alone (no opening camera hook)', () => {
  const B = { vessel: CURRENT_VESSEL, follow: { yaw: null }, pose: { x: 61, z: -406, heading: 80 * Math.PI / 180, heel: 0, pitch: 0, heave: 0 } };
  const m4 = createM4({ flags: {}, P: { headless: true } });
  m4.attach({ B });
  assert.equal(m4.setIntro, undefined); assert.equal(m4.intro, undefined);
  const follow = { pos: [61 - 20, 6, -406 + 5], target: [61, 2, -406], fov: 50 };
  let p = null; for (let i = 0; i < 60; i++) p = m4.camera(1 / 60, follow);
  assert.deepEqual(p.pos, follow.pos, 'the follow camera exactly, from the first frame');
});

test('settings: one store for the page (v1\'s format 2, only the chosen keys saved), shared by the card and Sail\'s UI', async () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: (k) => saved.delete(k) };
  try {
    const { pageSettings } = await import('../ui/settingsStore.js');
    const a = pageSettings(), b = pageSettings();
    assert.equal(a, b, 'the same store for every chunk');
    assert.equal(a.get('hud'), 'auto'); assert.equal(a.get('largeText'), false);
    let heard = null; a.on((k, v) => { heard = [k, v]; });
    a.set('largeText', true);
    assert.deepEqual(heard, ['largeText', true]);
    assert.deepEqual(JSON.parse(saved.get('lakeshore.settings.v1')), { _v: 2, largeText: true }, 'format 2: the chosen key only');
    assert.equal(a.set('hud', 'nonsense'), 'auto', 'a bad value is refused');
  } finally { delete globalThis.localStorage; }
});

test('no reel (owner, 2026-11-13): the film\'s controls go, the mark thins onto the still at once, the card stands over the live lake', async () => {
  const { installNoReel, NO_REEL } = await import('../ui/noReel.js');
  const removed = [], cls = new Set(), timers = [], heard = {};
  const company = { classList: { add: (c) => cls.add(c) } };
  const root = { dataset: { state: 'company' }, querySelector: (s) => (s === '.lk-company' ? company : null),
    querySelectorAll: (s) => (s.includes('.lk-corner') ? [{ remove: () => removed.push('corner') }, { remove: () => removed.push('fcap') }] : []) };
  const win = { addEventListener: (k, f) => { heard[k] = f; }, removeEventListener: (k) => { delete heard[k]; } };
  const R = installNoReel({ root, first: true, win, clock: (f, ms) => timers.push([ms, f]) });   // (a stale first: ignored)
  assert.equal(root.dataset.reel, 'none'); assert.equal('first' in root.dataset, false, 'no staged dissolve: a first visit gets the card as any other'); assert.equal(R.first, false);
  assert.deepEqual(removed, ['corner', 'fcap'], 'Skip, the sound chip and the caption are gone');
  assert.equal(R.mode, 'none'); assert.equal(R.video, null); assert.equal(R.playing, false);
  for (const f of ['stage', 'skip', 'play', 'sound']) assert.doesNotThrow(() => R[f]('sky'));
  assert.deepEqual(timers.map(([ms]) => ms), [NO_REEL.logoAtMs]); assert.ok(NO_REEL.logoAtMs < 500, 'the mark thins in the first fraction of a second');
  timers[0][1](); assert.ok(cls.has('off') && R.logoDone);
  root.dataset.state = 'home'; heard['lakeshore:home']();
  assert.equal(root.dataset.reelEnd, 'live', 'the card over the live lake');
  R.gone(); assert.equal(heard['lakeshore:home'], undefined);
});

test('no skill question (owner, 2026-11-21): a player never asked starts as New, once; a chosen profile is kept; Setup changes it', async () => {
  const { seedProfile, DEFAULT_PROFILE } = frontPlan;
  const store = (o = {}) => { const m = new Map(Object.entries(o)); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }; };
  assert.equal(DEFAULT_PROFILE, 'new');
  const fresh = store();
  assert.equal(seedProfile(fresh), 'new');
  assert.equal(fresh.get('profile'), 'new'); assert.equal(fresh.get('welcomed'), true, 'nothing left to ask');
  assert.equal(fresh.get('crewTrim'), true, 'New\'s bundle: the crew trims');
  assert.equal(seedProfile(fresh), null, 'once');
  const racer = store({ welcomed: true, profile: 'race', proMode: true });
  assert.equal(seedProfile(racer), null); assert.equal(racer.get('profile'), 'race'); assert.equal(racer.get('proMode'), true, 'a chosen profile stays');
  assert.equal(seedProfile(null), null);
});
