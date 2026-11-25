// The performance stats panel (v2/ui/perfHud.js) and the cockpit-up rule it shares with the Pro nav column (v2/ui/cockpitUp.js):
// the meter's FPS and worst frame, the lines and their amber cue, when the page may show it (the policy, ?perfhud, Setup), the rule
// per state, Setup's stored choice, the update rate and the per-frame cost. The live page: v2/tests/pages/perfHud.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERF_HUD, createFrameMeter, perfLines, perfHudAllowed, adapterName, perfHudSettings, createPerfHud, mountPerfRow } from '../ui/perfHud.js';
import { cockpitUp } from '../ui/cockpitUp.js';
import { POLICIES } from '../../src/core/features.js';
import { V2_ROWS, parseV2Flags } from '../engine/flags.js';

// a tiny DOM: what the panel and the row touch
function el(tag) {
  const cls = new Set();
  const e = { tagName: tag, children: [], dataset: {}, attrs: {}, listeners: {}, _text: '', style: {},
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); this.writes = (this.writes ?? 0) + 1; },
    set className(v) { cls.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) cls.add(c); }, get className() { return [...cls].join(' '); },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { const v = on ?? !cls.has(c); if (v) cls.add(c); else cls.delete(c); return v; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c) { this.children.push(c); return c; }, remove() { this.removed = true; },
    addEventListener(k, f) { this.listeners[k] = f; }, removeEventListener(k) { delete this.listeners[k]; },
    set innerHTML(h) { this._html = h; for (const m of h.matchAll(/data-ph="(\w+)"/g)) { const b = el('button'); b.dataset.ph = m[1]; b.closest = () => b; this.children.push(b); } },
    querySelectorAll(sel) { return sel === '[data-ph]' ? this.children.filter((c) => c.dataset.ph) : []; },
    querySelector() { return null; } };
  return e;
}
const fakeDoc = () => { const head = el('head'), body = el('body'); return { head, body, getElementById: () => null, createElement: el }; };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('the meter: FPS over about the last second, the mean interval, the worst frame of the last 5 s', () => {
  const M = createFrameMeter();
  let t = 0;
  for (let i = 0; i < 300; i++) { t += 1000 / 60; M.feed(t, 1000 / 60); }   // 5 s at 60 fps
  let r = M.read(t);
  assert.ok(Math.abs(r.fps - 60) < 0.5, `60 fps (${r.fps})`); assert.ok(Math.abs(r.ms - 16.67) < 0.1);
  t += 80; M.feed(t, 80);   // one hitch
  for (let i = 0; i < 120; i++) { t += 1000 / 60; M.feed(t, 1000 / 60); }
  r = M.read(t); assert.equal(Math.round(r.worst), 80, 'the hitch is the worst frame');
  for (let i = 0; i < 360; i++) { t += 1000 / 60; M.feed(t, 1000 / 60); }   // 6 s later
  r = M.read(t); assert.ok(r.worst < 17, `5 s on, the hitch is gone (${r.worst})`);
  for (let i = 0; i < 120; i++) { t += 40; M.feed(t, 40); }   // 25 fps
  r = M.read(t); assert.ok(Math.abs(r.fps - 25) < 0.5, `25 fps (${r.fps})`);
  M.feed(t + 9000, 9000); assert.ok(M.read(t + 9000).worst < 50, 'a hidden tab\'s gap is not a frame');
});

test('the lines: six short ones; amber under 30 fps only; GPU time only when the diag timer gives one', () => {
  const n = { fps: 59.6, ms: 16.8, worst: 24.12, level: 1, scale: 0.85, draws: 312, tris: 4.42e6, pipes: 86, mb: 412.4, adapter: 'Apple metal-3', gpuMs: null };
  const L = perfLines(n);
  assert.deepEqual(L.map((l) => l[0]), ['FPS', 'Worst', 'Quality', 'Draws', 'Memory', 'GPU']);
  assert.deepEqual(L.map((l) => l[1]), ['60 fps · 16.8 ms', '24.1 ms', 'L1 · 0.85×', '312 · 4.4M tri · 86 pl', '412 MB', 'Apple metal-3']);
  assert.ok(L.every((l) => !l[2]), 'no amber at 60 fps');
  assert.equal(perfLines({ ...n, fps: 29.4 })[0][2], true, 'amber under 30');
  assert.equal(perfLines({ ...n, fps: 30 })[0][2], false, '30 is not under');
  assert.equal(perfLines({ ...n, fps: 0 })[0][2], false, 'no amber before the first second');
  const D = perfLines({ ...n, gpuMs: 2.56 });
  assert.deepEqual(D.at(-1), ['GPU time', '2.6 ms', false]);
  assert.equal(PERF_HUD.amberFps, 30);
});

test('the adapter, short: the description, else vendor and architecture', () => {
  assert.equal(adapterName({ vendor: 'apple', architecture: 'metal-3', description: '' }), 'Apple metal-3');
  assert.equal(adapterName({ vendor: 'nvidia', architecture: 'ampere', description: 'NVIDIA GeForce RTX 3080 Ti Laptop GPU (0x2420)' }), 'NVIDIA GeForce RTX 30…');
  assert.equal(adapterName({}), 'GPU name hidden');
});

test('the policy: a desktop only; never a capture, a film, a shot or an automated browser unless ?perfhud=1; ?perfhud=0 never', () => {
  const tier = (form, flags = {}, headless = false) => POLICIES.perfHud.tier({ form }, { headless, flags });
  const wd = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false }, configurable: true });
  try {
    assert.equal(tier('desktop'), 'on');
    assert.equal(tier('tablet'), 'off', 'not a tablet'); assert.equal(tier('phone'), 'off');
    assert.equal(tier('desktop', {}, true), 'off', 'a capture'); assert.equal(tier('desktop', { filmui: true }), 'off', 'a ?filmui film (the goldens)');
    assert.equal(tier('desktop', { shot: 'cockpit-astern' }), 'off', 'a ?shot');
    assert.equal(tier('desktop', { perfhud: '1' }, true), 'on', '?perfhud=1 in a capture'); assert.equal(tier('desktop', { perfhud: '0' }), 'off');
    assert.equal(tier('tablet', { perfhud: '1' }), 'off', 'never a tablet');
    Object.defineProperty(globalThis, 'navigator', { value: { webdriver: true }, configurable: true });
    assert.equal(tier('desktop'), 'off', 'an automated browser'); assert.equal(tier('desktop', { perfhud: '1' }), 'on');
  } finally { if (wd) Object.defineProperty(globalThis, 'navigator', wd); else delete globalThis.navigator; }
  assert.ok(V2_ROWS.some((r) => r.name === 'perfhud'), 'the flag has a row');
  assert.equal(parseV2Flags('?perfhud=1').perfhud, '1'); assert.equal(parseV2Flags('').perfhud, null);
});

test('allowed: the policy, then the URL, then Setup (a stored off keeps it hidden; ?perfhud=1 wins for one load)', () => {
  assert.equal(perfHudAllowed({ policy: true, stored: true }), true);
  assert.equal(perfHudAllowed({ policy: true, stored: false }), false);
  assert.equal(perfHudAllowed({ policy: true, stored: false, flag: '1' }), true);
  assert.equal(perfHudAllowed({ policy: true, stored: true, flag: '0' }), false);
  assert.equal(perfHudAllowed({ policy: false, stored: true, flag: '1' }), false);
});

test('the cockpit up: Sail and Regatta with the drawn cockpit; not folded, Clear, Instruments, Cruise, Tessie, under a menu; the helm view keeps it', () => {
  const up = { form: 'cockpit', stationShown: true, fold: false, preset: 'full', modeDials: true, played: false };
  assert.equal(cockpitUp(up), true, 'Full');
  assert.equal(cockpitUp({ ...up, preset: 'calm' }), true, 'Calm');
  assert.equal(cockpitUp({ ...up, fold: true }), false, 'folded (the tab, H)');
  assert.equal(cockpitUp({ ...up, preset: 'clear' }), false, 'Clear');
  assert.equal(cockpitUp({ ...up, preset: 'instruments' }), false, 'Instruments');
  assert.equal(cockpitUp({ ...up, modeDials: false }), false, 'Cruise');
  assert.equal(cockpitUp({ ...up, played: true }), false, 'Tessie');
  assert.equal(cockpitUp({ ...up, stationShown: false }), false, 'a menu or a page over it');
  assert.equal(cockpitUp({ ...up, form: 'thumb' }), false, 'a phone (no drawn cockpit)');
  assert.equal(cockpitUp({ ...up, form: 'grid' }), false, 'the grid form');
});

test('Setup › Screen › performance stats: off by default; the choice persists in its own key; the row hears a change from elsewhere', () => {
  const store = memStore();
  const S = perfHudSettings(store);
  assert.equal(S.on, false, 'off by default (a fresh profile)');
  const tab = el('div'), text = el('div'); text.nextSibling = el('div');
  tab.querySelector = (sel) => (sel === '[data-set="text"]' ? text : sel === '[data-set="perfhud"]' ? (tab.children.find((c) => c.dataset.set === 'perfhud') ?? null) : null);
  const root = { querySelector: (sel) => (sel === '#tp-set-screen' ? tab : null) };
  const R = mountPerfRow(root, { settings: S, doc: { createElement: el } });
  assert.ok(R && R.row.dataset.set === 'perfhud');
  assert.deepEqual(R.buttons.map((b) => [b.dataset.ph, b.attrs['aria-checked']]), [['on', 'false'], ['off', 'true']]);
  R.row.listeners.click({ target: R.buttons[0], stopPropagation() {} });
  assert.equal(S.on, true); assert.equal(R.buttons[0].attrs['aria-checked'], 'true');
  assert.deepEqual(JSON.parse(store.getItem(PERF_HUD.key)), { on: true });
  S.forget(); assert.equal(S.on, true, 'on, read back after a reload');
  S.set(false);   // the panel's ×
  assert.equal(R.buttons[1].attrs['aria-checked'], 'true', 'the row repaints when the × turns it off');
  assert.deepEqual(JSON.parse(store.getItem(PERF_HUD.key)), { on: false });
  S.forget(); assert.equal(S.on, false, 'read back from the store (a reload)');
  assert.equal(mountPerfRow(root, { settings: S, doc: { createElement: el } }), null, 'once');
  const fresh = memStore(); fresh.setItem(PERF_HUD.key, 'not json'); assert.equal(perfHudSettings(fresh).on, false, 'a broken value reads as off');
});

test('the panel: shown with the rule, hidden at once without it; the text at 3 Hz, never every frame; nothing painted while hidden', () => {
  const doc = fakeDoc();
  let show = true, reads = 0;
  const H = createPerfHud({ doc, shown: () => show, read: () => { reads++; return { level: 0, scale: 1, draws: 250, tris: 1.1e6, pipes: 103, mb: 718, adapter: 'Apple metal-3', gpuMs: null }; } });
  assert.equal(doc.body.children[0], H.el); assert.equal(H.el.classList.contains('gone'), true, 'starts hidden');
  let t = 0;
  for (let i = 0; i < 600; i++) { t += 1000 / 60; H.tick(t, 1000 / 60); }   // 10 s at 60 fps
  let s = H.state;
  assert.equal(H.el.classList.contains('gone'), false);
  assert.ok(s.paints >= 29 && s.paints <= 31, `about 3 paints a second (${s.paints} in 10 s, ${s.ticks} frames)`);
  assert.equal(reads, s.paints, 'the numbers are read only for a paint');
  assert.equal(s.lines[0][1], '60 fps · 16.7 ms');
  show = false; const p0 = s.paints;
  for (let i = 0; i < 300; i++) { t += 1000 / 60; H.tick(t, 1000 / 60); }
  s = H.state;
  assert.equal(H.el.classList.contains('gone'), true, 'hidden'); assert.equal(s.paints, p0, 'no paint while hidden');
  show = true; t += 1000 / 60; H.tick(t, 1000 / 60);
  assert.equal(H.state.paints, p0 + 1, 'painted at once when it shows again');
  // the same text is not written twice (a DOM write only on a change)
  const fpsCell = H.el.children[1], w0 = fpsCell.writes;
  for (let i = 0; i < 120; i++) { t += 1000 / 60; H.tick(t, 1000 / 60); }
  assert.equal(fpsCell.writes, w0, 'a steady 60 fps writes nothing new');
  assert.equal(H.el.children.length, 13, 'six rows (no GPU time without ?diag) and the ×');
  assert.equal(createPerfHud({ doc: fakeDoc(), diag: true, read: () => ({}) }).el.children.length, 15, 'seven with ?diag');
});

test('the cost: the frame\'s part (meter and rule) stays far under 0.05 ms', () => {
  const H = createPerfHud({ doc: fakeDoc(), shown: () => true, read: () => ({ level: 1, scale: 0.85, draws: 300, tris: 4e6, pipes: 90, mb: 400, adapter: 'Apple metal-3', gpuMs: null }) });
  let t = 0;
  for (let i = 0; i < 3000; i++) { t += 1000 / 60; H.tick(t, 1000 / 60); }
  const s = H.state;
  assert.ok(s.msPerTick < 0.05, `${s.msPerTick.toFixed(4)} ms a frame`);
  assert.ok(s.msPerPaint < 0.5, `${s.msPerPaint.toFixed(4)} ms a paint`);
});

test('the ×: a labelled button that calls onClose; its click never reaches the page', () => {
  let closed = 0, stopped = 0;
  const H = createPerfHud({ doc: fakeDoc(), shown: () => true, onClose: () => { closed++; }, read: () => ({ level: 0, scale: 1, draws: 0, tris: 0, pipes: 0, mb: 0, adapter: 'x', gpuMs: null }) });
  assert.equal(H.close.tagName, 'button'); assert.equal(H.close.attrs['aria-label'], 'Close performance stats');
  H.close.listeners.click({ stopPropagation() { stopped++; } });
  H.close.listeners.pointerdown({ stopPropagation() { stopped++; } });
  assert.equal(closed, 1); assert.equal(stopped, 2);
  assert.ok(PERF_HUD.closePx >= 24, 'a 24 px target or more');
});
