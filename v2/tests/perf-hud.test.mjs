// The performance stats panel (v2/ui/perfHud.js) and the cockpit-up rule it shares with the Pro nav column (v2/ui/cockpitUp.js):
// the meter's FPS and worst frame, the lines and their amber cue, when the page may show it (the policy, ?perfhud, Setup), the rule
// per state, Setup's stored choice, the update rate and the per-frame cost. The live page: v2/tests/pages/perfHud.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { PERF_HUD, PERF_LEVELS, MARK, createFrameMeter, perfLines, perfLevels, createLevelHold, createPipeWatch, perfHudAllowed, adapterName, perfHudSettings, createPerfHud, mountPerfRow } from '../ui/perfHud.js';
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

test('the lines: six short ones, cream at today\'s normal; a ▲ before an amber or coral value; GPU time only with the diag timer', () => {
  const n = { fps: 59.6, ms: 16.8, worst: 24.12, level: 0, scale: 1, draws: 238, tris: 1.8e6, pipes: 233, mb: 718.4, adapter: 'Apple metal-3', gpuMs: null };
  const L = perfLines(n);
  assert.deepEqual(L.map((l) => l[0]), ['FPS', 'Worst', 'Quality', 'Draws', 'Memory', 'GPU']);
  assert.deepEqual(L.map((l) => l[1]), ['60 fps · 16.8 ms', '24.1 ms', 'L0 · 1.00×', '238 · 1.8M tri · 233 pl', '718 MB', 'Apple metal-3']);
  assert.deepEqual(L.map((l) => l[2]), [0, 0, 0, 0, 0, 0], 'today\'s typical numbers read all cream');
  const A = perfLines({ ...n, fps: 42 });
  assert.equal(A[0][2], 1); assert.equal(A[0][1], `${MARK}42 fps · 16.8 ms`, 'the ▲ marks it (colour-blind safe)');
  assert.ok(A.slice(1).every((l) => !l[1].startsWith(MARK)), 'only the line that warns');
  const D = perfLines({ ...n, gpuMs: 2.56 });
  assert.deepEqual(D.at(-1), ['GPU time', '2.6 ms', 0]);
  assert.equal(perfLines(n, [2, 0, 0, 0, 0, 0])[0][2], 2, 'the shown levels (after the hold) win over the raw ones');
});

test('the colour table: cream, amber, coral per threshold', () => {
  const base = { fps: 60, worst: 20, level: 0, scale: 1, draws: 240, tris: 1.5e6, mb: 720, pinned: false, pipeLate: false, gpuMs: null };
  const lv = (o) => perfLevels({ ...base, ...o });
  // FPS: >= 50 cream, 30-50 amber, < 30 coral; no data yet: cream
  assert.equal(lv({ fps: 50 })[0], 0); assert.equal(lv({ fps: 49.9 })[0], 1); assert.equal(lv({ fps: 30 })[0], 1); assert.equal(lv({ fps: 29.9 })[0], 2); assert.equal(lv({ fps: 0 })[0], 0);
  // the worst frame: <= 50 cream, 50-100 amber, > 100 coral
  assert.equal(lv({ worst: 50 })[1], 0); assert.equal(lv({ worst: 50.1 })[1], 1); assert.equal(lv({ worst: 100 })[1], 1); assert.equal(lv({ worst: 100.1 })[1], 2);
  // quality: L0 at 1.0 cream; the governor's lower level or scale amber; L3 or scale < 0.7 coral; a level the player holds is not the governor's
  assert.equal(lv({})[2], 0); assert.equal(lv({ scale: 0.92 })[2], 1); assert.equal(lv({ level: 1 })[2], 1); assert.equal(lv({ level: 1, pinned: true })[2], 0);
  assert.equal(lv({ level: 3, pinned: true })[2], 2); assert.equal(lv({ scale: 0.69 })[2], 2); assert.equal(lv({ level: 2, scale: 0.7 })[2], 1);
  // draws, triangles, a late pipeline
  assert.equal(lv({ draws: 400 })[3], 0); assert.equal(lv({ draws: 401 })[3], 1); assert.equal(lv({ draws: 701 })[3], 2);
  assert.equal(lv({ tris: 6.1e6 })[3], 1); assert.equal(lv({ tris: 10.1e6 })[3], 2); assert.equal(lv({ pipeLate: true })[3], 1); assert.equal(lv({ pipeLate: true, draws: 800 })[3], 2);
  // GPU memory: > 1.5 GB amber, > 2.5 GB coral
  assert.equal(lv({ mb: 1536 })[4], 0); assert.equal(lv({ mb: 1600 })[4], 1); assert.equal(lv({ mb: 2600 })[4], 2);
  // GPU time (diag): > 16.7 amber, > 33 coral; no line without it
  assert.equal(lv({}).length, 6); assert.equal(lv({ gpuMs: 16 })[6], 0); assert.equal(lv({ gpuMs: 17 })[6], 1); assert.equal(lv({ gpuMs: 34 })[6], 2);
  assert.equal(PERF_LEVELS.fps.amber, 50); assert.equal(PERF_LEVELS.mb.coral, 2560);
});

test('the hysteresis: a colour changes only after its new level held 1 s; a value flickering at a threshold keeps its colour', () => {
  const H = createLevelHold(1, 1000);
  assert.equal(H.step(0, [0])[0], 0);
  // flicker across a threshold every 300 ms for 5 s: stays cream
  for (let t = 300, k = 1; t <= 5000; t += 300, k ^= 1) assert.equal(H.step(t, [k])[0], 0, `t ${t}`);
  // held amber: amber after 1 s, not before
  assert.equal(H.step(6000, [1])[0], 0); assert.equal(H.step(6900, [1])[0], 0); assert.equal(H.step(7000, [1])[0], 1);
  // amber to coral: the same hold
  assert.equal(H.step(7300, [2])[0], 1); assert.equal(H.step(8300, [2])[0], 2);
  // back to cream after a held second
  assert.equal(H.step(8600, [0])[0], 2); assert.equal(H.step(9600, [0])[0], 0);
});

test('a pipeline built after the load settles: amber for 5 s; the load\'s own builds never warn', () => {
  const W = createPipeWatch({ settleMs: 10000, warnMs: 5000 });
  let t = 0;
  for (const n of [87, 122, 158, 233]) { assert.equal(W.feed(t, n), false, `loading ${n}`); t += 2000; }
  for (; t < 20000; t += 500) assert.equal(W.feed(t, 233), false);
  assert.equal(W.settled, true);
  assert.equal(W.feed(t, 234), true, 'a new one in play'); assert.equal(W.feed(t + 4900, 234), true); assert.equal(W.feed(t + 5100, 234), false, 'gone after 5 s');
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
  budget(s.msPerTick, 0.05, 'the hud a frame'); budget(s.msPerPaint, 0.5, 'the hud a paint');
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
