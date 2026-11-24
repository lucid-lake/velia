// The quality ladder (v2/engine/quality.js): the levels' rows, the first guess, the pin, the stored level, the ladder's
// settle and steps. Pure: fed numbers, read back levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, pinnedLevel, readSignals, guessLevel, gpuKey, readStored, writeStored, startLevel, levelParams, cloudPixels, forestAt,
  pendingRows, levelPixels, createLadder, createBusyProbe, STORE_KEY, LEVER_ROWS, LEVER_OFF, leverRows, createMsaaSwitch, msaaOf } from '../engine/quality.js';
import { keySizeFor, KEY } from '../sim/clouds.js';
import { FOREST } from '../forest/lod.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
};
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('four levels: L1 ≈ 1.2 Mpx, L2 ≈ 0.7 Mpx, L3 ≈ 0.45 Mpx with the heavier rows stepped down', () => {
  assert.equal(LEVELS.length, 4);
  assert.equal(LEVELS[3].maxPx, 0.45e6); assert.equal(LEVELS[3].msaa, 1); assert.ok(LEVELS[3].forestReach < LEVELS[2].forestReach && LEVELS[3].shadowEvery > LEVELS[2].shadowEvery);
  assert.equal(LEVELS[0].maxPx, 3.4e6); assert.equal(LEVELS[1].maxPx, 1.2e6); assert.equal(LEVELS[2].maxPx, 0.7e6);
  assert.equal(LEVELS[0].msaa, 4); assert.equal(LEVELS[2].msaa, 1);
  assert.ok(LEVELS[0].shadowEvery < LEVELS[1].shadowEvery && LEVELS[1].shadowEvery < LEVELS[2].shadowEvery);
  assert.ok(LEVELS[2].forestReach < 1 && LEVELS[2].bedFine === 0 && LEVELS[0].bedFine === 1);
  // a real iPhone (390 × 844 CSS at DPR 3): L0 draws its DPR-2 backing, L1 and L2 the caps
  assert.equal(Math.round(levelPixels(0, 390, 844, 3)), 780 * 1688);
  assert.equal(levelPixels(1, 390, 844, 3), 1.2e6);
  assert.equal(levelPixels(2, 390, 844, 3), 0.7e6);
  // the owner's reference phone, an iPhone 16 Pro (A18 Pro, 2622 × 1206 at DPR 3: 402 × 874 CSS): L0 804 × 1748 = 1.41 Mpx
  assert.equal(Math.round(levelPixels(0, 402, 874, 3)), 804 * 1748);
  assert.equal(levelPixels(1, 402, 874, 3), 1.2e6);
});

test('the reference phone (iPhone 16 Pro, Safari, the GPU name hidden or "apple") starts at L1 (perf(v2) phone 30 fps: MSAA 4, the full water path), upright or sideways', () => {
  for (const [w, h] of [[402, 874], [874, 402]]) {
    for (const info of [{}, { vendor: 'apple', architecture: 'common-3' }]) {
      const g = guessLevel(readSignals({ adapterInfo: info, ua: UA.iphone, touch: 5, screen: { w, h, dpr: 3 } }));
      assert.equal(g.level, 1, `${w}×${h} ${JSON.stringify(info)}: ${g.why}`);
    }
  }
});

test('the cloud key: L0 by size, L1 and L2 the 1024 × 256 key', () => {
  assert.deepEqual(keySizeFor(cloudPixels(0, 3.4e6)), KEY.desktop);
  assert.deepEqual(keySizeFor(cloudPixels(1, 1.2e6)), KEY.phone);
  assert.deepEqual(keySizeFor(cloudPixels(2, 0.7e6)), KEY.phone);
  assert.deepEqual(keySizeFor(cloudPixels(0, 0.33e6)), KEY.phone);   // the 390 × 844 capture: as before the ladder
});

test('?quality= pins: 0|1|2|3 and v1\'s words; anything else is no pin', () => {
  assert.equal(pinnedLevel('0'), 0); assert.equal(pinnedLevel('2'), 2); assert.equal(pinnedLevel('3'), 3); assert.equal(pinnedLevel('balanced'), 1); assert.equal(pinnedLevel('low'), 2);
  for (const q of [null, '', '4', '-1', '1.5', 'x']) assert.equal(pinnedLevel(q), null, String(q));
});

test('the first guess: a desktop L0, an iPhone L1, a flagship Android L1 (30 fps), an older one L3, a small-memory phone one lower', () => {
  const mac = readSignals({ adapterInfo: { vendor: 'apple', architecture: 'metal-3' }, ua: UA.mac, screen: { w: 1512, h: 945, dpr: 2 } });
  assert.equal(guessLevel(mac).level, 0);
  const iphone = readSignals({ adapterInfo: { vendor: '', architecture: '' }, ua: UA.iphone, touch: 5, screen: { w: 390, h: 844, dpr: 3 } });
  assert.ok(iphone.phone && iphone.apple);
  const g = guessLevel(iphone); assert.equal(g.level, 1); assert.match(g.why, /phone, Apple GPU.*390×844 @3/);
  const pixel = readSignals({ adapterInfo: { vendor: 'qualcomm', architecture: 'adreno-7xx' }, ua: UA.pixel, touch: 5, screen: { w: 412, h: 915, dpr: 2.625 }, deviceMemory: 8 });
  assert.equal(guessLevel(pixel).level, 1);
  const old = readSignals({ adapterInfo: { vendor: 'qualcomm', architecture: 'adreno-6xx' }, ua: UA.pixel, touch: 5, screen: { w: 412, h: 915, dpr: 2.625 } });
  assert.equal(guessLevel(old).level, 3);
  const mali = readSignals({ adapterInfo: { vendor: 'arm', architecture: 'valhall' }, ua: UA.pixel, touch: 5, screen: { w: 412, h: 915, dpr: 2.625 } });
  assert.equal(guessLevel(mali).level, 3);
  const small = readSignals({ adapterInfo: { vendor: 'qualcomm', architecture: 'adreno-7xx' }, ua: UA.pixel, touch: 5, screen: { w: 412, h: 915, dpr: 2.625 }, deviceMemory: 4 });
  const gs = guessLevel(small); assert.equal(gs.level, 2); assert.match(gs.why, /4 GB/);
  assert.equal(guessLevel(readSignals({ ua: UA.ipad, touch: 5, screen: { w: 820, h: 1180, dpr: 2 } })).level, 1);
  assert.equal(guessLevel(readSignals({ adapterInfo: { vendor: 'intel' }, ua: UA.mac })).level, 1);
  assert.equal(guessLevel(readSignals({ adapterInfo: { vendor: 'google', architecture: 'swiftshader' }, ua: UA.mac, fallback: true })).level, 3);
  // a touch screen too small for a desktop, with no phone UA (an emulator, a webview): a phone
  assert.ok(readSignals({ ua: 'x', coarse: true, screen: { w: 360, h: 740, dpr: 2 } }).phone);
});

test('the start: a pin beats a capture, a capture is L0, a stored level beats the guess', () => {
  const guess = { level: 1, why: 'guess: …' };
  assert.equal(startLevel({ pinned: 2, headless: true, guess }).level, 2);
  assert.deepEqual([startLevel({ headless: true, guess }).level, startLevel({ headless: true, guess }).source], [0, 'headless']);
  assert.equal(startLevel({ stored: { level: 2, at: Date.UTC(2026, 10, 13) }, guess }).source, 'stored');
  assert.equal(startLevel({ guess }).level, 1);
});

test('the stored level: per GPU, 14 days, never throws', () => {
  const s = mem(), sig = readSignals({ ua: UA.iphone, touch: 5, screen: { w: 390, h: 844, dpr: 3 } }), key = gpuKey(sig), now = Date.UTC(2026, 10, 13);
  assert.equal(readStored(s, key, now), null);
  assert.ok(writeStored(s, key, 2, 'settled', now));
  assert.equal(readStored(s, key, now + 864e5).level, 2);
  assert.equal(readStored(s, 'other|gpu|desk', now), null);
  assert.equal(readStored(s, key, now + 15 * 864e5), null);
  s.setItem(STORE_KEY, '{not json'); assert.equal(readStored(s, key, now), null);
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readStored(bad, key, now), null); assert.equal(writeStored(bad, key, 1, '', now), false);
  assert.equal(readStored(null, key, now), null); assert.equal(writeStored(undefined, key, 1, '', now), false);
});

test('a level\'s scene rows; the URL\'s own ?maxpx= ?dpr= ?msaa= win', () => {
  const P = { maxPx: 3.4e6, dprCap: 2, msaa: 4, hour: 13 };
  assert.deepEqual(levelParams(P, 2), { ...P, maxPx: 0.7e6, dprCap: 1.5, msaa: 1, level: 2 });
  const p = levelParams({ ...P, msaa: 4, maxPx: 5e6 }, 2, new Set(['msaa', 'maxpx']));
  assert.equal(p.msaa, 4); assert.equal(p.maxPx, 5e6); assert.equal(p.dprCap, 1.5);
  assert.deepEqual(levelParams(P, 0), { ...P, level: 0 });   // L0 is today's page
});

test('the forest at a level; the rows a live step leaves for the next load', () => {
  assert.deepEqual(forestAt(FOREST.desktop, 0), { thin: 2000, fade: 3500, far: 5000, shrubFar: 450 });
  assert.equal(forestAt(FOREST.desktop, 1).shrubFar, 0);
  const f2 = forestAt(FOREST.phone, 2); assert.ok(f2.far < 3000 && f2.thin < FOREST.phone.thin);
  assert.deepEqual(pendingRows(0, 0), []);
  assert.deepEqual(pendingRows(0, 1), ['cloud key 1024×256']);
  assert.deepEqual(pendingRows(0, 2), ['cloud key 1024×256', 'boat shadow 1024²']);   // #31: MSAA is live
  assert.deepEqual(pendingRows(2, 1), ['boat shadow 2048²']);
  assert.deepEqual(pendingRows(2, 3), []);
});

// feed `seconds` at `ms` a frame (60 frames a second of wall time) from t; returns [t, the last non-null step]
const feed = (lad, t, seconds, ms, px, floor = false) => { let s = null; for (let i = 0; i < seconds * 60; i++) { t += 1000 / 60; const r = lad.feed(ms, t, px, floor); if (r) s = r; } return [t, s]; };
const PX = [1.32e6, 1.2e6, 0.7e6, 0.45e6];

test('the settle: a fast phone keeps its level; a slow one drops to the level its cost fits; stored', () => {
  const fast = createLadder({ level: 1, pxAt: (k) => PX[k] });
  let [, s] = feed(fast, 0, 7, 14, PX[1]);   // L0 would be 14 × 1.075 = 15.1 ms: over 0.8 × budget, so no step up
  assert.equal(s.level, 1); assert.ok(s.store); assert.match(s.why, /kept/);
  const slow = createLadder({ level: 1, pxAt: (k) => PX[k] });
  [, s] = feed(slow, 0, 7, 26, PX[1]);   // 26 ms at 1.2 Mpx → L2's 0.7 Mpx ≈ 0.25 + 0.75 × 0.58 = 0.69 × 26 = 17.9 ms ≤ 18.3
  assert.equal(s.level, 2); assert.match(s.why, /L1 → L2/);
  const slowest = createLadder({ level: 0, pxAt: (k) => PX[k] });
  [, s] = feed(slowest, 0, 7, 60, PX[0]);
  assert.equal(s.level, 3, 'nothing fits: the lowest level');
});

test('the settle steps up at most one level, and only with clear headroom', () => {
  const lad = createLadder({ level: 2, pxAt: (k) => PX[k] });
  let [, s] = feed(lad, 0, 7, 6, PX[2]);   // 6 ms at 0.7 Mpx → L1 ≈ 6 × (0.25 + 0.75 × 1.71) = 9.2 ≤ 13.3
  assert.equal(s.level, 1);
  const vsync = createLadder({ level: 2, pxAt: (k) => PX[k] });
  [, s] = feed(vsync, 0, 7, 16.7, PX[2]);   // a 60 Hz phone with no GPU timer: the wall interval says nothing about headroom
  assert.equal(s.level, 2);
});

test('the warm-up is ignored; a desktop at 120 Hz never loses a level to vsync (the budget floor is 60 fps)', () => {
  const lad = createLadder({ level: 0, pxAt: (k) => [3.4e6, 1.2e6, 0.7e6][k], budgetMs: 8.33 });
  let t = 0, s; [t, s] = feed(lad, t, 1.9, 200, 3.4e6); assert.equal(s, null);   // the first frames' hitches
  [t, s] = feed(lad, t, 5, 12.5, 3.4e6);   // alternating 8.3 / 16.7 ms frames: 12.5 ms mean, under 16.7 × 1.1
  assert.equal(s.level, 0);
});

test('after the settle: two slow windows at the governor\'s floor step down; never above it; 60 calm windows step up', () => {
  const lad = createLadder({ level: 1, pxAt: (k) => PX[k] });
  let [t, s] = feed(lad, 0, 7, 14, PX[1]); assert.equal(s.level, 1);
  [t, s] = feed(lad, t, 3, 30, PX[1], false); assert.equal(s, null, 'the governor still has room: no level step');
  [t, s] = feed(lad, t, 3, 30, PX[1], true); assert.equal(s.level, 2); assert.match(s.why, /governor/);
  [t, s] = feed(lad, t, 5, 40, PX[2], true); assert.equal(s, null, 'already the lowest');
  [t, s] = feed(lad, t, 62, 5, PX[2]); assert.equal(s.level, 1, 'a minute of headroom: one level back up');
});

test('off: pinned or ?gov=0 never steps', () => {
  const lad = createLadder({ level: 0, pxAt: (k) => PX[k], enabled: false });
  const [, s] = feed(lad, 0, 20, 80, PX[0], true);
  assert.equal(s, null); assert.equal(lad.state().phase, 'off');
});

test('perf(v2) phone: the phone path\'s rows: off at L0 and L1, on at L2 and L3; ?levers= pins them', () => {
  for (const k of LEVER_ROWS) { assert.equal(LEVELS[0][k], LEVER_OFF[k]); assert.equal(LEVELS[1][k], LEVER_OFF[k]); assert.notEqual(LEVELS[2][k], LEVER_OFF[k], k); assert.equal(LEVELS[3][k], LEVELS[2][k]); }
  assert.equal(leverRows(null), null); assert.equal(leverRows(''), null);
  assert.deepEqual(leverRows('none'), { ...LEVER_OFF });
  assert.deepEqual(leverRows('all'), Object.fromEntries(LEVER_ROWS.map((k) => [k, LEVELS[2][k]])));
  const g = leverRows('grid,sim');
  assert.equal(g.waterGrid, 'coarse'); assert.equal(g.simEvery, 2); assert.equal(g.waterLite, false); assert.equal(g.cloudEvery, 1);
  assert.equal(LEVELS[0].boatShadow, 2048); assert.equal(LEVELS[2].boatShadow, 1024);
});

test('perf(v2) phone round 2: a 30 Hz display (Low Power Mode) settles against 60 Hz; the step stores the busy span it read', () => {
  // 24 ms of GPU at L2 on a display pinned at 30 Hz: on budget at 30 Hz, but 60 Hz is the device's real target
  // (fix(v2) governor: 20 ms now keeps L2: at the governor's 0.85 scale it projects 15.8 ms)
  const lad = createLadder({ level: 2, pxAt: (k) => PX[k], budgetMs: 1000 / 30 });
  const [, s] = feed(lad, 0, 7, 24, PX[2]);
  assert.equal(lad.state().budgetMs, 16.67, 'the ladder aims at 60 Hz');
  assert.equal(s.level, 3, '24 ms fits neither 16.7 at 0.85 scale (19.0) nor 16.7 × 1.1 at full pixels at L2');
  assert.match(s.why, /24\.0 ms GPU work at L2, 0\.70 Mpx/); assert.match(s.why, /display 30 Hz/);
  assert.deepEqual(s.measured, { workMs: 24, level: 2, px: 700000, hz: 30, metric: 'work' });
  assert.equal(feed(createLadder({ level: 2, pxAt: (k) => PX[k], budgetMs: 1000 / 30 }), 0, 7, 20, PX[2])[1].level, 2);
  const ok = createLadder({ level: 2, pxAt: (k) => PX[k], budgetMs: 1000 / 30 });
  assert.equal(feed(ok, 0, 7, 13, PX[2])[1].level, 2, '13 ms keeps L2 (and never steps up on a 30 Hz reading: L1 would be 19.9)');
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(writeStored(storage, 'apple|?|phone', 3, s.why, 1e12, s.measured));
  const back = readStored(storage, 'apple|?|phone', 1e12 + 1000);
  assert.deepEqual(back.measured, { ...s.measured, rule: 'q30' });   // perf(v2) phone 30 fps: every record carries the 30 fps rule
  assert.match(startLevel({ stored: back, guess: { level: 2, why: '' } }).why, /24 ms GPU work at L2, 0\.70 Mpx, 30 Hz/);
});

test('perf(v2) phone round 2: the new phone-path rows are on at L2 and L3, off at L0 and L1, and pinnable', () => {
  assert.deepEqual([LEVELS[0].simSplit, LEVELS[0].waterCascades, LEVELS[0].waterFused, LEVELS[0].boatShadowEvery], [false, 4, false, 1]);
  assert.deepEqual([LEVELS[2].simSplit, LEVELS[2].waterCascades, LEVELS[2].waterFused, LEVELS[2].boatShadowEvery], [true, 3, true, 2]);
  const g = leverRows('split,bshadow');
  assert.equal(g.simSplit, true); assert.equal(g.boatShadowEvery, 2); assert.equal(g.waterCascades, 4); assert.equal(g.waterFused, false);
});

// ---- BACKLOG-v2 #32: no GPU timer (Safari, iOS) ----
// the forced no-timer mode: a 60 Hz phone whose rAF interval is the vsync (16.7 ms) at every level that fits; `busy` is what
// the work-done probe reads (or null: no probe)
const feedBusy = (lad, t, seconds, ms, px, busy, floor = false) => { let s = null; for (let i = 0; i < seconds * 60; i++) { t += 1000 / 60; const r = lad.feed(ms, t, px, floor, busy); if (r) s = r; } return [t, s]; };

test('#32: without a GPU timer the vsync interval alone never steps up; the work-done probe\'s busy span does (settle and calm windows)', () => {
  // before: the interval alone, a fast GPU (4 ms of work) at L2 is held there
  const old = createLadder({ level: 2, pxAt: (k) => PX[k], vsync: true });
  let [t, s] = feedBusy(old, 0, 7, 16.7, PX[2], null); assert.equal(s.level, 2, 'the settle keeps L2');
  [t, s] = feedBusy(old, t, 70, 16.7, PX[2], null); assert.equal(s, null, 'and a minute of calm never steps up');
  // the probe: 4 ms busy at 0.7 Mpx → L1 ≈ 4 × 1.53 = 6.1 ms ≤ 13.3: the settle steps up one; 60 s calm at L1 steps to L0
  const lad = createLadder({ level: 2, pxAt: (k) => PX[k], vsync: true });
  [t, s] = feedBusy(lad, 0, 7, 16.7, PX[2], 4);
  assert.equal(s.level, 1); assert.match(s.why, /4\.0 ms busy \(the work-done probe; no GPU timer\) at L2/);
  assert.equal(s.measured.vsync, true, 'stored as a no-timer decision');
  [t, s] = feedBusy(lad, t, 62, 16.7, PX[1], 4);
  assert.equal(s.level, 0); assert.match(s.why, /calm at 4\.0 ms busy \(the work-done probe/);
  // a busy GPU: the probe reads 15 ms at L2 → L1 ≈ 23 ms: no step up; the step down still reads the interval
  const busy = createLadder({ level: 2, pxAt: (k) => PX[k], vsync: true });
  [t, s] = feedBusy(busy, 0, 7, 16.7, PX[2], 15); assert.equal(s.level, 2);
  [t, s] = feedBusy(busy, t, 3, 33.3, PX[2], 15, true); assert.equal(s.level, 3, 'missed vsyncs at the governor\'s floor: down, as before');
  // a probe that reads more than the interval (a queue still busy) is capped by it: never a false step up
  const cap = createLadder({ level: 2, pxAt: (k) => PX[k], vsync: true });
  assert.equal(feedBusy(cap, 0, 7, 16.7, PX[2], 40)[1].level, 2);
});

test('#32: a level settled without a GPU timer is retried one up at the next visit, at most once every 3 days', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const day = 864e5, t0 = 1.8e12, guess = { level: 2, why: 'guess' };
  const down = createLadder({ level: 2, pxAt: (k) => PX[k], vsync: true });
  const [, s] = feedBusy(down, 0, 7, 33.3, PX[2], null);   // missed every vsync at L2: L3, stored as a no-timer decision
  assert.equal(s.level, 3); writeStored(storage, 'apple|?|phone', s.level, s.why, t0, s.measured);
  const next = startLevel({ stored: readStored(storage, 'apple|?|phone', t0 + 1000), guess, nowMs: t0 + 1000 });
  assert.equal(next.source, 'retry'); assert.equal(next.level, 2); assert.match(next.why, /retry: L3 was settled on the frame interval alone/);
  // the retry visit's ladder carries its retryAt into what it stores; the retry fails (still 33 ms): L3 again, no retry for 3 days
  const again = createLadder({ level: next.level, pxAt: (k) => PX[k], vsync: true, retryAt: next.retryAt });
  const [, s2] = feedBusy(again, 0, 7, 33.3, PX[2], null);
  assert.equal(s2.level, 3); assert.equal(s2.measured.retryAt, t0 + 1000);
  writeStored(storage, 'apple|?|phone', s2.level, s2.why, t0 + 2000, s2.measured);
  const soon = startLevel({ stored: readStored(storage, 'apple|?|phone', t0 + day), guess, nowMs: t0 + day });
  assert.equal(soon.source, 'stored'); assert.equal(soon.level, 3);
  const later = startLevel({ stored: readStored(storage, 'apple|?|phone', t0 + 3.1 * day), guess, nowMs: t0 + 3.1 * day });
  assert.equal(later.source, 'retry'); assert.equal(later.level, 2);
  // a level decided with the GPU timer is never retried
  writeStored(storage, 'apple|?|phone', 3, 'timer', t0, { spanMs: 30, level: 2, px: 7e5, hz: 60 });
  assert.equal(startLevel({ stored: readStored(storage, 'apple|?|phone', t0 + 1000), guess, nowMs: t0 + 1000 }).source, 'stored');
});

test('#32: the work-done probe: one in flight, the median of its spans, null until 8, off for good when the queue throws', async () => {
  let clock = 0, resolve = null;
  const probe = createBusyProbe({ done: () => new Promise((r) => { resolve = r; }), now: () => clock });
  for (let i = 0; i < 10; i++) {
    assert.equal(probe.sample(), true); assert.equal(probe.sample(), false, 'one in flight');
    clock += 3 + (i % 3); resolve(); await null; await null;
  }
  assert.equal(probe.count, 10); assert.equal(probe.span, 4);
  const early = createBusyProbe({ done: () => Promise.resolve(), now: () => 0 });
  early.sample(); await null; assert.equal(early.span, null, 'fewer than 8 spans: no reading');
  const bad = createBusyProbe({ done: () => { throw new Error('no queue'); } });
  assert.equal(bad.sample(), false); assert.equal(bad.failed, true); assert.equal(bad.sample(), false);
});

// BACKLOG-v2 #31: MSAA live. The ladder's steps (its hysteresis: two slow windows at the governor's floor down, 60 calm
// windows up, the 10 s cooldown) now carry the level's MSAA: the switch asks for the count's pipelines when they are not
// built, keeps the scene's count until they are, then lands; a URL ?msaa= or a capture's single count never moves
test('#31: the ladder steps across MSAA: L1 (4) → L2 (1) once the 1× set is built, and back up to 4 after the calm', () => {
  const built = new Set([4]), asked = [];
  const sw = createMsaaSwitch({ start: 4, counts: [1, 4], ready: (n) => built.has(n), build: (n) => { asked.push(n); } });
  const lad = createLadder({ level: 1, pxAt: (k) => PX[k] });
  const step = (r) => { if (r) sw.want(msaaOf(r.level)); };
  let [t, s] = feed(lad, 0, 7, 14, PX[1]); step(s); assert.equal(s.level, 1); assert.equal(sw.due(), null, 'the settle kept L1: MSAA 4 stays');
  [t, s] = feed(lad, t, 3, 30, PX[1], true); step(s);
  assert.equal(s.level, 2); assert.equal(sw.wanted, 1);
  assert.deepEqual(asked, [1], 'the 1× set is asked for (async)');
  assert.equal(sw.due(), null, 'not built yet: the scene keeps MSAA 4, nothing waits');
  assert.equal(sw.now, 4);
  built.add(1);
  assert.equal(sw.due(), 1, 'built: the switch is due between two frames'); sw.done(1);
  assert.equal(sw.now, 1); assert.equal(sw.due(), null);
  [t, s] = feed(lad, t, 8, 5, PX[2]); assert.equal(s, null, 'the cooldown and the calm windows: no step straight back');
  [t, s] = feed(lad, t, 62, 5, PX[2]); step(s);
  assert.equal(s.level, 1); assert.equal(sw.due(), 4, 'a minute of headroom: L1, and MSAA 4 at once (its set was built at load)'); sw.done(4);
  assert.deepEqual(asked, [1], 'nothing new asked for');
});

test('#31: the count a level draws at; a URL ?msaa= and a single declared count never move', () => {
  assert.deepEqual([0, 1, 2, 3].map((k) => msaaOf(k)), [4, 4, 1, 1]);
  assert.equal(msaaOf(2, 4), 4, '?msaa=4 wins over L2');
  const sw = createMsaaSwitch({ start: 4, counts: [4], ready: () => true, build: () => assert.fail('no build') });
  assert.equal(sw.want(1), false); assert.equal(sw.due(), null); assert.equal(sw.wanted, 4);
});

test('perf(v2) iOS pipelines: a slow compiler (its last load built the first frame\'s pipelines in over 4 s) is not sent on a retry', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const t0 = 1.8e12, guess = { level: 2, why: 'guess' };
  const down = createLadder({ level: 2, pxAt: (k) => PX[k], vsync: true });
  const [, s] = feedBusy(down, 0, 7, 33.3, PX[2], null);
  writeStored(storage, 'apple|?|phone', s.level, s.why, t0, s.measured);
  const stored = readStored(storage, 'apple|?|phone', t0 + 1000);
  const slow = startLevel({ stored, guess, nowMs: t0 + 1000, lastBuildMs: 26400 });
  assert.equal(slow.source, 'stored'); assert.equal(slow.level, 3); assert.match(slow.why, /no retry: the shaders took 26\.4 s here/);
  assert.equal(startLevel({ stored, guess, nowMs: t0 + 1000, lastBuildMs: 900 }).source, 'retry', 'a quick compiler still retries');
  assert.equal(startLevel({ stored, guess, nowMs: t0 + 1000 }).source, 'retry', 'no record: as before');
});
