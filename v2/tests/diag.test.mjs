// The diag panel (v2/engine/diag.js): the 2 s window's average and worst, the short user agent, the lines, the DOM update
// on a timer (never from the frame), at most 4 a second, off by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowStats, shortUA, diagLines, createDiag, createCrashLog, CRASH_KEY, DIAG, verdictOf } from '../engine/diag.js';
import { textureBytes } from '../engine/device.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('the crash log: a visit that never closed is reported by the next one, with its last error and memory', () => {
  const s = mem(), errors = [];
  let t = 1000;
  const a = createCrashLog({ storage: s, errors, snapshot: () => ({ level: 1, mb: 412.34, frames: 900 }), now: () => t });
  assert.equal(a.line(), null, 'a first visit: nothing before it');
  errors.push('device lost: unknown: GPU process gone\nstack');
  t = 5000; a.beat(true);
  // the tab is killed here (no pagehide): the reload reads the note
  t = 9000;
  const b = createCrashLog({ storage: s, errors: [], snapshot: () => ({ level: 2 }), now: () => t });
  assert.match(b.line(), /last visit may have crashed \(4 s ago; L1, GPU 412.3 MB, 900 frames; device lost: unknown: GPU process gone\)/);
  b.close();   // a clean exit
  const c = createCrashLog({ storage: s, now: () => t });
  assert.equal(c.line(), null);
  assert.equal(JSON.parse(s.getItem(CRASH_KEY)).alive, true, 'the new visit is alive');
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => { const d = createCrashLog({ storage: bad }); d.beat(); d.close(); assert.equal(d.line(), null); });
});

test('the memory line and the failed pipeline line', () => {
  const t = diagLines({ mem: { gpuMB: 412.4, buffers: 310, textures: 128, heapMB: null, deviceGB: null }, pipeline: { name: 'water', message: 'Safari refused\nmore' }, errors: [] }).join('\n');
  assert.match(t, /memory GPU ≈ 412 MB \(310 buffers, 128 textures\)/);
  assert.match(t, /failed pipeline "water": Safari refused/);
  assert.ok(!/JS heap/.test(t), 'Safari has no heap number: none shown');
  assert.equal(textureBytes({ size: [2048, 512, 4], format: 'rgba16float', mipLevelCount: 9 }), Math.round(2048 * 512 * 4 * 8 * 4 / 3));
  assert.equal(textureBytes({ size: { width: 780, height: 1688 }, format: 'rgba16float', sampleCount: 4 }), 780 * 1688 * 8 * 4);
});

test('windowStats: the last 2 s only, the average and the worst; the GPU\'s missing samples skipped', () => {
  const N = 8, t = new Float64Array(N), v = new Float64Array(N);
  const put = (i, ti, vi) => { t[i % N] = ti; v[i % N] = vi; };
  put(0, 0, 100); put(1, 1000, 10); put(2, 2000, 20); put(3, 2500, 30);
  assert.deepEqual(windowStats(t, v, 4, 2600), { avg: 20, worst: 30, count: 3 });
  put(4, 2600, -1);   // no GPU sample this frame
  assert.equal(windowStats(t, v, 5, 2600).count, 3);
  for (let i = 5; i < 20; i++) put(i, 3000 + i, 5);   // the ring wraps
  assert.deepEqual(windowStats(t, v, 20, 3100), { avg: 5, worst: 5, count: 8 });
  assert.equal(windowStats(t, v, 0, 0), null);
});

test('shortUA: device, OS and browser', () => {
  assert.equal(shortUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), 'iPhone · iOS 18.1 · Safari 18.1');
  assert.equal(shortUA('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'), 'Pixel 8 · Android 15 · Chrome 131');
  assert.equal(shortUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36'), 'Mac · Headless Chrome 146');
  assert.equal(shortUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1'), 'iPhone · iOS 17.5 · Chrome 131');
});

test('the lines: every number the owner sends back, and the errors (the last 3, first line each)', () => {
  const lines = diagLines({ frame: { avg: 16.7, worst: 33.4 }, gpu: null, timestamps: false, level: 1, levelName: 'L1', why: 'guess: a phone', pending: ['MSAA 1'],
    backing: [780, 1538], css: [390, 844], dpr: 3, dprCap: 2, scale: 1, msaa: 4, adapter: { vendor: 'apple', architecture: 'common-3' },
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile Safari/604.1', errors: ['a', 'b', 'pipeline "water" failed: bad\nmore', 'd'] });
  const t = lines.join('\n');
  assert.match(t, /fps 59\.9 avg · 29\.9 worst/);
  assert.match(t, /frame 16\.7 ms avg · 33\.4 worst \(2 s\)/);
  assert.match(t, /GPU – \(no timestamp-query\)/);
  assert.match(t, /quality L1 \(next load: MSAA 1\)/);
  assert.match(t, /guess: a phone/);
  assert.match(t, /backing 780×1538 · 1\.20 Mpx/);
  assert.match(t, /DPR 3 \(cap 2\) · css 390×844 · MSAA 4/);
  assert.match(t, /adapter apple · common-3/);
  assert.match(t, /UA iPhone · iOS 18\.1/);
  assert.match(t, /errors 4 \(last 3, newest last\):/);
  assert.ok(t.includes('pipeline "water" failed: bad') && !t.includes('more') && !t.includes('  a\n'));
});

// a fake DOM and timers: what the panel writes and when
function fakeDoc() {
  const mk = (tag) => ({ tag, id: '', textContent: '', children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; } });
  return { head: mk('head'), body: mk('body'), createElement: mk };
}
function fakeTimers() { const t = { fns: [], every: [], setInterval(fn, ms) { t.fns.push(fn); t.every.push(ms); return t.fns.length; }, clearInterval(id) { t.fns[id - 1] = null; } }; return t; }

test('off by default: nothing mounted, the frame hook does nothing', () => {
  const doc = fakeDoc(), timers = fakeTimers();
  const d = createDiag({ doc, timers });
  d.frame(16, 5, 1000);
  assert.equal(d.on, false); assert.equal(doc.body.children.length, 0); assert.equal(timers.fns.length, 0);
});

test('on: one panel, updated on a 250 ms timer (≤ 4 a second), the frame only fills rings; text rewritten only when it changed', () => {
  const doc = fakeDoc(), timers = fakeTimers(), errors = [];
  let calls = 0;
  const d = createDiag({ on: true, doc, timers, errors, info: () => { calls++; return { level: 0, levelName: 'L0 full', backing: [1280, 720] }; } });
  assert.equal(d.on, true); assert.equal(doc.body.children[0].id, 'diag');
  assert.deepEqual(timers.every, [DIAG.updateMs]); assert.ok(DIAG.updateMs >= 250);
  const c0 = calls;
  const now = performance.now();
  for (let i = 0; i < 120; i++) d.frame(16.7, 4.2, now - 1900 + i * 16);
  assert.equal(calls, c0, 'the frame never builds the text');
  timers.fns[0]();
  assert.match(d.el.textContent, /frame 16\.7 ms avg/); assert.match(d.el.textContent, /GPU 4\.20 ms avg/);
  errors.push('pipeline "sky" failed: x');
  timers.fns[0]();
  assert.match(d.el.textContent, /pipeline "sky" failed/);
  // the fastest of 9 updates: the update's own cost, not the machine's load (v2 #29)
  let upd = d.stats.lastUpdateMs;
  for (let i = 0; i < 8; i++) { timers.fns[0](); upd = Math.min(upd, d.stats.lastUpdateMs); }
  assert.ok(upd < 1, `an update costs ${upd} ms`);
  d.stop(); assert.equal(timers.fns[0], null);
});

test('perf(v2) phone: the loading lines (no "Lundefined", no 300×150, no "cap undefined")', () => {
  const t = diagLines({ stage: 'terrain', css: [402, 660], dpr: 3, errors: [] }).join('\n');
  assert.match(t, /quality – \(loading: terrain\)/);
  assert.ok(!/undefined/.test(t), t);
  assert.ok(!/backing/.test(t), 'no backing before the first frame');
  assert.match(t, /DPR 3 · css 402×660/);
});

test('perf(v2) phone: the busy span, the passes sum, the top 6 passes over 2 s, the pace and the verdict', () => {
  const doc = fakeDoc(), timers = fakeTimers();
  const d = createDiag({ on: true, doc, timers, info: () => ({ level: 2, levelName: 'L2', budgetMs: 1000 / 60, refreshMeasured: true, gov: { scale: 0.72, min: 0.6, cuts: 3 } }) });
  d.setPassNames(['boat-shadow', 'terrain-shadow', 'water-sim', 'sky-lut', 'aerial', 'cloud-key', 'forest', 'scene', 'composite']);
  const now = performance.now();
  for (let i = 0; i < 60; i++) d.frame(33.4, { span: 30, total: 42, passes: [1, 0.5, 6, 0.2, 2, 3, 1.5, 25, 0.8], seq: i }, now - 1900 + i * 30, 4);
  d.frame(33.4, { span: 30, total: 42, passes: [100, 0, 0, 0, 0, 0, 0, 0, 0], seq: 59 }, now, 4);   // the same resolved frame again: counted once
  timers.fns[0]();
  const t = d.el.textContent;
  assert.match(t, /GPU 30\.00 ms avg · 30\.00 worst \(busy span; passes sum 42\.0\)/);
  assert.match(t, /passes scene 25\.0 · water-sim 6\.00 · cloud-key 3\.00\n  aerial 2\.00 · forest 1\.50 · boat-shadow 1\.00/);
  assert.match(t, /pace 60 Hz display \(budget 16\.7 ms\) · scale 0\.72 \(floor 0\.60, 3 cuts\)/);
  assert.match(t, /GPU-bound: misses 60 Hz by 13\.3 ms \(busy 30\.0 of 16\.7\), quantized to 30 Hz/);
  assert.match(t, /frame 33\.4 ms avg · 33\.4 worst \(2 s\) · CPU 4\.0/);
});

test('perf(v2) phone round 2: the passes by their own share, the idle gap, the refresh measured at load', () => {
  const doc = fakeDoc(), timers = fakeTimers();
  const d = createDiag({ on: true, doc, timers, info: () => ({ level: 2, levelName: 'L2', budgetMs: 1000 / 60, refreshMeasured: true, refreshSource: 'idle' }) });
  d.setPassNames(['water-sim', 'scene', 'composite']);
  const now = performance.now();
  // the composite stamped from the scene's vertex start: 5.1 ms of time, 0.1 ms of its own
  for (let i = 0; i < 30; i++) d.frame(33.4, { span: 20, total: 26, passes: [4, 16, 5.1], own: [4, 15.4, 0.1], gap: 0.5, seq: i }, now - 900 + i * 30, 2);
  timers.fns[0]();
  const t = d.el.textContent;
  assert.match(t, /passes \(own ms\) scene 15\.4 · water-sim 4\.00 · composite 0\.10/);
  assert.match(t, /GPU work 19\.50 ms avg · 19\.50 worst \(span 20\.0, idle 0\.5\)/, 'fix(v2) governor: the work (span − idle) first');
  assert.match(t, /budget 16\.7 ms, measured at load/);
  assert.match(t, /GPU-bound: misses 60 Hz by 2\.8 ms \(work 19\.5 of 16\.7\), quantized to 30 Hz/);
});

test('perf(v2) phone: the verdict tells vsync or the page from the GPU', () => {
  assert.match(verdictOf({ avg: 33.4 }, { avg: 9 }, { avg: 3 }, 16.67), /not GPU-bound .*pinned at 30 Hz/);
  assert.match(verdictOf({ avg: 16.7 }, { avg: 9 }, { avg: 3 }, 16.67), /on budget/);
  assert.match(verdictOf({ avg: 33.4 }, { avg: 9 }, { avg: 20 }, 16.67), /CPU-bound/);
});

test('#31: the DPR line shows a live MSAA step while its pipelines build, and nothing once it landed', () => {
  const base = { frame: null, gpu: null, timestamps: false, level: 2, levelName: 'L2', why: '', pending: [], backing: [569, 1231], css: [390, 844], dpr: 3, dprCap: 1.5, scale: 1, adapter: {}, ua: '', errors: [] };
  assert.match(diagLines({ ...base, msaa: 4, msaaWant: 1 }).join('\n'), /· MSAA 4 → 1 \(building\)/);
  const t = diagLines({ ...base, msaa: 1, msaaWant: 1 }).join('\n');
  assert.match(t, /· MSAA 1$/m); assert.ok(!t.includes('building'));
});
