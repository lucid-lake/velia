// Quality tiers: the table, the pick from adapter/screen/warm-up inputs, the governor, the
// saved cap, the setting. Pure: no GPU, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, TIER_ORDER, COST, GPU_MB, readSignals, ceilingFor, pickTier, resolveTier, predictMs, pixelRatioFor, budgetMs,
  Governor, RETINA_STEPS, readCap, writeCap, CAP_KEY, recordStepDown, clearCap, migrateCap, OLD_CAP_KEY, STEPLOG_KEY, QUALITY_NOTICE, PICK_SLACK, warmupDecides } from '../classic/src/quality/tiers.js';
import { createSettings, QUALITY } from '../src/ui/settings.js';
import { STREAM } from '../classic/src/stream/config.js';
import { AIR } from '../src/sim/air.js';
import { FARMAP } from '../classic/src/forest/far-map.js';
import { LOD, SPLIT } from '../classic/src/terrain-lod.js';
import { FRAME_PX } from '../classic/src/forest/impostor.js';
// trees.js reads the page's URL at load
globalThis.location ??= { search: '' };
const { BANDS } = await import('../classic/src/trees.js');

const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const UA_PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const mac = (extra = {}) => readSignals({ adapter: { isFallbackAdapter: false, info: { vendor: 'apple', architecture: 'metal-3' }, limits: { maxTextureDimension2D: 16384, maxBufferSize: 2 ** 32 } },
  ua: UA_MAC, platform: 'MacIntel', screen: { w: 1280, h: 720, dpr: 2 }, ...extra });

test('the table: three tiers, the same fields, all positive, each cheaper than the last', () => {
  assert.deepEqual(TIER_ORDER, ['high', 'balanced', 'low']);
  const shape = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? shape(v, `${p}${k}.`) : [`${p}${k}`]));
  const keys = shape(TIERS.high).sort();
  for (const n of TIER_ORDER) assert.deepEqual(shape(TIERS[n]).sort(), keys, `${n} has High's fields`);
  const flat = (o) => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v) : [[k, v]]));
  for (const n of TIER_ORDER) for (const [k, v] of flat(TIERS[n])) if (typeof v === 'number') assert.ok(v >= 0 && !Number.isNaN(v), `${n}.${k}`);
  // no feature disappears: every count and distance that draws something stays above zero (MSAA 0 = one sample, not off)
  for (const n of TIER_ORDER) {
    const t = TIERS[n];
    for (const v of [t.water.rippleWavelengths, t.water.probeSize, t.water.lookSize, t.water.reflectionSteps, t.clouds.steps, t.clouds.lightSteps,
      t.forest.NEAR, t.forest.FAR, t.forest.THIN, t.forest.framePx, t.terrain.split, t.air.motes, t.air.lines, t.air.spray, t.stream.near, t.stream.mid]) assert.ok(v > 0, n);
  }
  const order = [['clouds.steps', (t) => t.clouds.steps], ['forest.THIN', (t) => t.forest.THIN],
    ['stream.near', (t) => t.stream.near], ['air.motes', (t) => t.air.motes], ['memory', (t) => t.memory.gpuMB]];
  for (const [name, f] of order) assert.ok(f(TIERS.high) > f(TIERS.balanced) && f(TIERS.balanced) > f(TIERS.low), name);
  // the hero first (owner, 2026-10-31): the water never drops more than the forest or the clouds do, and never below half
  // of High; Balanced keeps High's waves
  const share = (t, k, f) => f(t[k]) / f(TIERS.high[k]);
  for (const n of ['balanced', 'low']) {
    const t = TIERS[n], water = share(t, 'water', (w) => w.rippleWavelengths), forest = share(t, 'forest', (f) => f.THIN), clouds = share(t, 'clouds', (c) => c.steps);
    assert.ok(water >= forest && water >= clouds && water >= 0.5, `${n}: water ${water} forest ${forest} clouds ${clouds}`);
  }
  assert.equal(TIERS.balanced.water.rippleWavelengths, TIERS.high.water.rippleWavelengths);
  assert.ok(COST.high > COST.balanced && COST.balanced > COST.low);
  assert.ok(GPU_MB.high > GPU_MB.balanced && GPU_MB.balanced > GPU_MB.low);
  assert.ok(GPU_MB.low <= 1000, 'Low stays under the phone tab budget (about 1 GB)');
});

test('High is today: the table repeats the engine\'s own numbers', () => {
  const H = TIERS.high;
  assert.equal(H.render.scale, 1); assert.equal(H.render.maxPixels, Infinity); assert.equal(H.render.msaa, 4);
  assert.equal(H.forest.framePx, FRAME_PX); assert.equal(H.forest.farMapCell, FARMAP.cell);
  for (const k of ['FULL', 'NEAR', 'FAR', 'THIN', 'SHRUBS', 'ROCKS', 'LOGS']) assert.equal(H.forest[k], BANDS[k], k);
  assert.equal(H.terrain.split, SPLIT); assert.equal(LOD.split, SPLIT);
  assert.equal(H.air.motes, AIR.motes); assert.equal(H.air.lines, AIR.lines.pool); assert.equal(H.air.spray, AIR.spray.pool);
  assert.equal(H.stream.near, STREAM.bands.near); assert.equal(H.stream.mid, STREAM.bands.mid); assert.equal(H.stream.nearCap, STREAM.speed.nearCap); assert.equal(H.stream.uploadMs, STREAM.upload.budgetMs);
  assert.equal(H.water.reflectionSteps, 16); assert.equal(H.water.probeSize, 256); assert.equal(H.water.rippleWavelengths, 16);
  assert.equal(H.clouds.steps, 96); assert.equal(H.clouds.lightSteps, 5); assert.equal(H.clouds.temporalScale, 0.5);
  assert.equal(pixelRatioFor('high', { w: 5000, h: 3000 }), 1, 'High never changes the ratio');
});

test('signals: phone, tablet, desktop, software adapter', () => {
  assert.ok(readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 393, h: 852, dpr: 3 } }).phone);
  assert.ok(readSignals({ ua: UA_PIXEL, touch: 5, screen: { w: 412, h: 915, dpr: 2.6 } }).phone);
  const ipad = readSignals({ ua: UA_MAC, platform: 'MacIntel', touch: 5, screen: { w: 1024, h: 1366, dpr: 2 } });   // iPadOS asks for the desktop site
  assert.ok(ipad.tablet && !ipad.phone);
  const m = mac(); assert.ok(!m.phone && !m.tablet && !m.fallback);
  assert.ok(readSignals({ adapter: { isFallbackAdapter: true } }).fallback);
});

test('ceiling: what the facts allow before any measuring', () => {
  assert.equal(ceilingFor(mac()).ceiling, 'high');
  assert.equal(ceilingFor(readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 393, h: 852, dpr: 3 } })).ceiling, 'low');
  assert.equal(ceilingFor(readSignals({ ua: UA_MAC, platform: 'MacIntel', touch: 5, screen: { w: 1024, h: 1366, dpr: 2 } })).ceiling, 'balanced');
  assert.equal(ceilingFor(readSignals({ adapter: { isFallbackAdapter: true }, ua: UA_MAC })).ceiling, 'low');
  assert.equal(ceilingFor(mac({ deviceMemory: 4 })).ceiling, 'balanced');
  assert.equal(ceilingFor(mac({ deviceMemory: 2 })).ceiling, 'low');
  assert.equal(ceilingFor(mac({ adapter: { info: { vendor: 'intel', architecture: 'gen-12lp' }, limits: { maxTextureDimension2D: 16384 } } })).ceiling, 'balanced');
  assert.equal(ceilingFor(mac({ adapter: { info: { vendor: 'nvidia' }, limits: { maxTextureDimension2D: 4096 } } })).ceiling, 'low', 'small max texture');
  assert.ok(ceilingFor(readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 393, h: 852, dpr: 3 } })).memMB <= 1000, 'a phone tab budget is about 1 GB');
});

test('pick: the highest tier that holds the budget; budgets 16.7 ms (33.3 on phones)', () => {
  const s = { ...mac(), strong: false };   // the prediction path (a strong GPU takes the after-ready path)
  assert.equal(budgetMs(s), 16.7); assert.equal(budgetMs({ mobile: true }), 33.3);
  // a strong GPU: a warm-up of 3 ms predicts High well inside 16.7 ms
  assert.equal(pickTier(s, 3).tier, 'high');
  // the same machine, slower: High no longer fits, Balanced does
  const slow = pickTier(s, 3 / COST.high * 1.0, {});
  const w = 16.7 / predictMs('high', s, 1) * 1.3;   // a warm-up that makes High 21.7 ms, past budget x PICK_SLACK
  const p = pickTier(s, w);
  assert.ok(p.predicted.high > 16.7 && p.tier === 'balanced', JSON.stringify(p));
  // slower again: Low
  assert.equal(pickTier(s, w * 2.5).tier, 'low');
  assert.ok(slow.measured);
  // a phone is never above Low whatever the warm-up says
  const phone = readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 393, h: 852, dpr: 3 } });
  assert.equal(pickTier(phone, 0.1).tier, 'low');
  // an iPad is never above Balanced
  const ipad = readSignals({ ua: UA_MAC, platform: 'MacIntel', touch: 5, screen: { w: 1024, h: 1366, dpr: 2 } });
  assert.equal(pickTier(ipad, 0.1).tier, 'balanced');
  // no warm-up (it failed): the safe middle, never above the ceiling
  assert.equal(pickTier(s, null).tier, 'balanced');
  assert.equal(pickTier(phone, null).tier, 'low');
  // a memory budget below a tier's measured need drops it
  assert.equal(pickTier(mac({ deviceMemory: 2 }), 0.1).tier, 'low');
  // more pixels cost more: the same warm-up on a 4K window predicts more
  assert.ok(predictMs('high', { w: 3840, h: 2160 }, 5) > 3 * predictMs('high', { w: 1280, h: 720 }, 5));
});

test('ratio: High 1; Balanced and Low cap the pixels, never under the floor', () => {
  assert.equal(pixelRatioFor('high', { w: 1280, h: 720 }), 1);
  assert.equal(pixelRatioFor('balanced', { w: 1280, h: 720 }), 0.8);
  assert.ok(pixelRatioFor('balanced', { w: 2560, h: 1440 }) < 0.8);
  assert.equal(pixelRatioFor('low', { w: 393, h: 852 }), 1, 'a phone draws one pixel per CSS pixel');
  assert.ok(Math.abs(pixelRatioFor('low', { w: 1024, h: 1366 }) - Math.sqrt(0.62e6 / (1024 * 1366))) < 1e-9);
  assert.equal(pixelRatioFor('low', { w: 6000, h: 4000 }), 0.5);
});

test('resolve: the setting wins; a saved cap only limits auto', () => {
  const s = mac();
  assert.equal(resolveTier('low', s, 1).tier, 'low');
  assert.equal(resolveTier('high', readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 393, h: 852, dpr: 3 } }), 99).tier, 'high', 'the player asked');
  assert.equal(resolveTier('auto', s, 3).tier, 'high');
  const capped = resolveTier('auto', s, 3, { cap: 'balanced' });
  assert.equal(capped.tier, 'balanced'); assert.ok(capped.why.some((x) => /stepped down/.test(x)));
  assert.equal(resolveTier('auto', s, 3, { cap: 'high' }).tier, 'high', 'a cap never lifts');
});

test('retina: ratio per tier above DPR 1; DPR 1 is unchanged (the goldens)', () => {
  const at = (name, w, h, dpr) => pixelRatioFor(name, { w, h, dpr });
  assert.equal(at('high', 1440, 900, 2), 1.5);
  assert.equal(at('high', 1440, 900, 1), 1, 'DPR 1: the golden path');
  assert.equal(at('high', 1440, 900, undefined), 1);
  assert.equal(at('high', 1440, 900, 1.25), 1.25, 'min(DPR, 1.5)');
  assert.equal(at('balanced', 1280, 720, 2), 1.15);
  assert.equal(at('balanced', 1280, 720, 1), 0.8, 'Balanced at DPR 1 keeps its 0.8');
  assert.ok(at('balanced', 2560, 1440, 2) < 1.15 && at('balanced', 2560, 1440, 2) >= 1, 'the 2.6 Mpx ceiling, never under 1');
  assert.equal(at('low', 393, 852, 3), 1, 'a phone keeps 1.0');
  assert.equal(at('low', 1024, 1366, 2), pixelRatioFor('low', { w: 1024, h: 1366 }), 'Low ignores DPR');
  assert.equal(pixelRatioFor('high', { w: 1440, h: 900, dpr: 2 }, 1.25), 1.25, 'the governor cap');
  assert.equal(pixelRatioFor('high', { w: 1440, h: 900, dpr: 2 }, 1), 1);
});

test('governor: on a retina screen the first steps lower the render ratio, 1.5 -> 1.25 -> 1.0, then the tier', () => {
  assert.deepEqual(RETINA_STEPS, [1.5, 1.25, 1.0]);
  const g = new Governor({ tier: 'high', budget: 16.7, now: 0, retina: 1.5 });
  let t = 0; const steps = [];
  for (let i = 0; i < 3; i++) { let st = null; const t0 = t; for (; t < t0 + 11 && !st; t += 0.04) st = g.feed(0.04, t); steps.push(st); }
  assert.deepEqual(steps.map((x) => [x.tier, x.retina]), [['high', 1.25], ['high', 1], ['balanced', 1]]);
  const g2 = new Governor({ tier: 'balanced', budget: 16.7, now: 0, retina: 1.15 });
  let s2 = null; for (t = 0; t < 11 && !s2; t += 0.04) s2 = g2.feed(0.04, t);
  assert.deepEqual([s2.tier, s2.retina], ['balanced', 1]);
});

test('governor: steps down after 10 s over budget, never up, one rung at a time', () => {
  const g = new Governor({ tier: 'high', budget: 16.7, now: 0 });
  let t = 0, step = null;
  // 9 s at 25 ms: not yet
  for (; t < 9; t += 0.025) assert.equal(g.feed(0.025, t), null);
  for (; t < 10.2 && !step; t += 0.025) step = g.feed(0.025, t);
  assert.ok(step && step.tier === 'balanced', JSON.stringify(step));
  // good frames afterwards: nothing happens, and it does not go up
  for (t = 11; t < 40; t += 0.0167) assert.equal(g.feed(0.0167, t), null);
  assert.equal(g.tier, 'balanced');
  // slow again: the next rung, a full 10 s after
  let s2 = null; for (t = 40; t < 52 && !s2; t += 0.04) s2 = g.feed(0.04, t);
  assert.equal(s2?.tier, 'low');
  assert.ok(t - 40 >= 8.5, 'about a full window of slow frames each time');
  // on Low: a smaller render ratio, down to the floor, then it stops
  const factors = [];
  for (let i = 0; i < 12; i++) { let st = null; const t0 = t; for (; t < t0 + 11 && !st; t += 0.05) st = g.feed(0.05, t); if (st) factors.push(st.factor); }
  assert.ok(factors[0] < 1 && factors.every((f, i) => i === 0 || f <= factors[i - 1]) && factors.at(-1) >= 0.6 - 1e-9, JSON.stringify(factors));
  assert.equal(g.steps.at(-1).tier, 'low');
  // a stall (tab switch) or a spike is not a frame time
  const g2 = new Governor({ tier: 'high', budget: 16.7, now: 0 });
  for (t = 0; t < 30; t += 0.0167) g2.feed(t % 5 < 0.03 ? 3 : 0.0167, t);
  assert.equal(g2.tier, 'high');
  // 33 ms phones: a 30 fps session at budget 33.3 holds
  const g3 = new Governor({ tier: 'low', budget: 33.3, now: 0 });
  for (t = 0; t < 40; t += 0.0333) assert.equal(g3.feed(0.0333, t), null);
});

test('the saved cap expires and survives a broken store', () => {
  const mem = {}; const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(readCap(store), null);
  writeCap(store, 'balanced', 1000);
  assert.equal(readCap(store, 1000 + 2 * 864e5), 'balanced');
  assert.equal(readCap(store, 1000 + 3.1 * 864e5), null, 'expires after 3 days');
  assert.equal(readCap({ getItem: () => '{bad', setItem() { throw new Error('x'); } }), null);
  writeCap({ setItem() { throw new Error('full'); } }, 'low');
  mem[CAP_KEY] = JSON.stringify({ cap: 'ultra', at: 1 }); assert.equal(readCap(store, 2), null);
});

test('the setting: auto · high · balanced · low, saved', () => {
  assert.deepEqual(QUALITY, ['auto', 'high', 'balanced', 'low']);
  const mem = {}; const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const s = createSettings({ storage });
  assert.equal(s.get('quality'), 'auto', 'auto is the default');
  for (const q of ['low', 'balanced', 'high', 'auto']) { s.set('quality', q); assert.equal(createSettings({ storage }).get('quality'), q); }
  s.set('quality', 'ultra'); assert.equal(s.get('quality'), 'auto');
  storage.setItem('lakeshore.settings.v1', JSON.stringify({ quality: 'medium' })); assert.equal(createSettings({ storage }).get('quality'), 'auto');
});

// --- 2026-10-30: the governor bug (a busy warm-up, then a 14-day cap on the first step) ---------------------------
const memStore = () => { const m = {}; return { m, getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
const DAY = 864e5;

test('cap: one session stepping down (twice, even) saves no cap; the second separate session does', () => {
  const st = memStore(), t0 = 1e12;
  assert.equal(recordStepDown(st, 'balanced', 'A', t0).capped, null);
  assert.equal(recordStepDown(st, 'low', 'A', t0 + 20e3).capped, null, 'the same session again is still one session');
  assert.equal(readCap(st, t0 + 30e3), null, 'no cap after one session');
  const r = recordStepDown(st, 'balanced', 'B', t0 + DAY);
  assert.equal(r.capped, 'balanced'); assert.equal(r.sessions, 2);
  assert.equal(readCap(st, t0 + DAY + 1), 'balanced');
});

test('cap: sessions more than 7 days apart do not add up; the cap lives 3 days', () => {
  const st = memStore(), t0 = 1e12;
  recordStepDown(st, 'balanced', 'A', t0);
  assert.equal(recordStepDown(st, 'balanced', 'B', t0 + 8 * DAY).capped, null, '8 days apart: one session counts');
  assert.equal(recordStepDown(st, 'low', 'C', t0 + 10 * DAY).capped, 'low', 'B and C are 2 days apart');
  assert.equal(readCap(st, t0 + 10 * DAY + 2.9 * DAY), 'low');
  assert.equal(readCap(st, t0 + 10 * DAY + 3.1 * DAY), null);
});

test('warm-up never saves a cap: a busy warm-up picks a tier and writes nothing', () => {
  const st = memStore();
  const s = readSignals({ adapter: { info: { vendor: 'apple' }, limits: { maxTextureDimension2D: 16384, maxBufferSize: 2 ** 32 } }, deviceMemory: 8, screen: { w: 1440, h: 900, dpr: 2 }, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' });
  const busy = resolveTier('auto', s, 30, { cap: readCap(st) });
  assert.notEqual(busy.tier, 'high');
  assert.deepEqual(st.m, {}, 'pick/resolve has no storage to write to');
  assert.equal(readCap(st), null);
});

test('capsule notice and the Settings reset', () => {
  assert.equal(QUALITY_NOTICE, 'Quality lowered for smooth sailing \u00b7 Setup');
  const st = memStore(); const t0 = 1e12;
  recordStepDown(st, 'low', 'A', t0); recordStepDown(st, 'low', 'B', t0 + 1);
  assert.equal(readCap(st, t0 + 2), 'low');
  clearCap(st);
  assert.equal(readCap(st, t0 + 2), null); assert.equal(st.m[STEPLOG_KEY], undefined);
  assert.equal(recordStepDown(st, 'low', 'C', t0 + 3).capped, null, 'the log was cleared too: one session again');
  clearCap({ removeItem() { throw new Error('x'); } });   // a broken store is fine
});

test('capable Mac, quiet GPU: auto picks High (simulated inputs)', () => {
  const mac2 = (w, h, extra = {}, dpr = 1) => readSignals({ adapter: { info: { vendor: 'apple', architecture: 'metal-3' }, limits: { maxTextureDimension2D: 16384, maxBufferSize: 2 ** 32 }, ...extra }, deviceMemory: 8, screen: { w, h, dpr }, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' });
  for (const [w, h] of [[1280, 720], [1440, 900], [1512, 982], [1728, 1117]]) {
    const r = resolveTier('auto', mac2(w, h), 4.6);   // the dev Mac's quiet warm-up
    assert.equal(r.tier, 'high', `${w}x${h}: ${JSON.stringify(r.predicted)}`);
  }
  // on a retina screen the pixel prediction put this Mac on Balanced or Low (High at ratio 1.5 predicted 35 ms on 1512 x 945);
  // since fix/ios-start-2 a strong GPU starts at High and the real frames after ready step the ratio (AfterReady)
  assert.equal(resolveTier('auto', mac2(1280, 720, {}, 2), 4.6).tier, 'high');
  assert.equal(resolveTier('auto', mac2(1512, 945, {}, 2), 5.5).tier, 'high');
  assert.equal(resolveTier('high', mac2(1280, 720, {}, 2), 4.6).tier, 'high');
  assert.ok(PICK_SLACK > 1 && PICK_SLACK <= 1.2, 'the pick never accepts more than the governor would');
  // an Intel laptop, a struggling GPU and a phone still step down
  assert.notEqual(resolveTier('auto', mac2(1440, 900), 13).tier, 'high');
  assert.equal(resolveTier('auto', readSignals({ adapter: { info: { vendor: 'intel' } }, screen: { w: 1440, h: 900, dpr: 2 }, ua: 'Mac', platform: 'MacIntel' }), 4.6).tier, 'balanced');
  assert.equal(resolveTier('auto', readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 393, h: 852, dpr: 3 } }), 4.6).tier, 'low');
  // and a saved cap from a past slow session no longer holds High down once reset
  const st = memStore(); writeCap(st, 'low', 1000); clearCap(st);
  assert.equal(resolveTier('auto', mac2(1440, 900), 4.6, { cap: readCap(st, 2000) }).tier, 'high');
});

test('migration: any cap from the old 14-day rule is cleared once', () => {
  const st = memStore();
  st.setItem(OLD_CAP_KEY, JSON.stringify({ cap: 'low', at: Date.now() }));
  st.setItem(CAP_KEY, JSON.stringify({ cap: 'low', at: Date.now() }));
  assert.equal(migrateCap(st), true);
  assert.equal(st.getItem(OLD_CAP_KEY), null); assert.equal(readCap(st), null);
  // a cap saved by the NEW rule afterwards survives the next start
  writeCap(st, 'balanced'); assert.equal(migrateCap(st), false); assert.equal(readCap(st), 'balanced');
  assert.equal(migrateCap(null), false);
});

test('wiring: Settings has the active tier and the quality cards (Auto also resets the governor)', async () => {
  // the core's step logged through recordStepDown (never a cap at once), migrateCap at boot and resetAuto: a real page
  // (tests/pages/liveFlags.page.mjs (retired 2026-11-18)); the shell saying QUALITY_NOTICE on a step: tests/pages/shellRows.page.mjs (retired 2026-11-18)
  const { pagesHtml } = await import('../src/ui/homePages.js');
  const html = pagesHtml({ waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '', mark: '', playtest: false });
  assert.match(html, /data-qnow/);
  assert.deepEqual([...html.matchAll(/class="qc"[^>]*data-r="quality:(\w+)"[\s\S]*?<b>([^<]+)<\/b>/g)].map((m) => [m[1], m[2]]), [['auto', 'Auto'], ['high', 'High'], ['low', 'Battery']]);
  const { mountHome } = await import('./helpers/home-mount.mjs');
  let resets = 0;
  const c = await mountHome({ state: 'home', quality: { active: () => 'auto: High, render 1280 × 720 px (1×)', reset() { resets++; c.settings.set('quality', 'auto'); } } });
  try {
    c.home.show('settings', false);
    c.q('[data-r="quality:low"]').click(); assert.equal(c.settings.get('quality'), 'low');
    c.q('[data-r="quality:auto"]').click(); assert.equal(resets, 1, 'Auto runs the old "reset auto"'); assert.equal(c.settings.get('quality'), 'auto');
    assert.equal(c.q('[data-qnow]').textContent, 'Now: High, render 1280 × 720 px (1×)');
    c.settings.set('quality', 'balanced'); c.home.paint();
    assert.equal(c.q('[data-r="quality:low"]').getAttribute('aria-checked'), 'true', 'a Balanced pin shows on Battery');
  } finally { c.home.dispose(); }
});

test('a strong Mac (Apple M-series) with good frame times starts at High; its governor waits for under 40 fps', async () => {
  const { governorSlack, budgetMs: bm, Governor: G } = await import('../classic/src/quality/tiers.js');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
  const s = readSignals({ adapter: { info: { vendor: 'apple', architecture: 'metal-3' }, limits: { maxTextureDimension2D: 16384, maxBufferSize: 4294967296 } }, ua: UA, platform: 'MacIntel', screen: { w: 1728, h: 1000, dpr: 1 } });
  assert.equal(s.strong, true);
  for (const warm of [3, 4.6]) assert.equal(resolveTier('auto', s, warm).tier, 'high', `warm-up ${warm} ms`);
  // the governor: 45 fps for 12 s does not step down; 35 fps does
  const run = (fps) => { const g = new G({ tier: 'high', budget: bm(s), slack: governorSlack(s) }); let st = null; for (let t = 0; t < 12; t += 1 / fps) st = g.feed(1 / fps, t) ?? st; return st; };
  assert.equal(run(45), null); assert.ok(run(35));
  // phones and other desktops keep the old slack
  assert.equal(governorSlack(readSignals({ ua: 'iPhone', touch: 5, screen: { w: 390, h: 844, dpr: 3 } })), 1.2);
});

test('Low thins the forest by a fixed hash (the same trees every load); High keeps every tree', async () => {
  const { thinPayload } = await import('../classic/src/forest/scatter-tiles.js');
  const n = 1000, p = { count: n, data: new Float32Array(n * 8).map((_, i) => i), species: new Uint8Array(n), variant: new Uint8Array(n), snag: new Uint8Array(n) };
  assert.equal(thinPayload(p, 'bay:3', 1), p);
  const a = thinPayload(p, 'bay:3', 0.5), b = thinPayload(p, 'bay:3', 0.5);
  assert.ok(a.count > 420 && a.count < 580, String(a.count)); assert.deepEqual(a.data, b.data);
  assert.equal(a.data.length, a.count * 8); assert.equal(a.data[0] % 8, 0, 'whole trees');
  assert.equal(TIERS.high.forest.KEEP, 1); assert.equal(TIERS.balanced.forest.KEEP, 1); assert.ok(TIERS.low.forest.KEEP < 1);
});

test('after ready: a strong start keeps High; slow GPU frames step the retina ratio 1.5 -> 1.25 -> 1, never the tier', async () => {
  const { AfterReady, AFTER_READY } = await import('../classic/src/quality/tiers.js');
  const run = (msAt, { gpu = true, retina = 1.5, fps = 60 } = {}) => {
    const a = new AfterReady({ retina, start: Infinity }); const out = [];
    for (let t = 10; t < 40 && !a.done; t += 1 / fps) { const r = a.feed(t, gpu ? { gpuMs: msAt(a.retina), dt: 1 / fps } : { dt: msAt(a.retina) / 1000 }); if (r && r !== 'done') out.push(r.retina); }
    return { steps: out, result: a.result };
  };
  // the M-series at a fast GPU: no step
  assert.deepEqual(run(() => 7).steps, []);
  // 20 ms at 1.5, 15 at 1.25, 10 at 1: two steps, it stops at 1
  const r = run((ratio) => (ratio > 1.3 ? 20 : ratio > 1.1 ? 15 : 10));
  assert.deepEqual(r.steps, [1.25, 1]); assert.equal(r.result.retina, 1); assert.ok(r.result.ms < AFTER_READY.targetMs);
  // Safari (no GPU timestamps): frames at the display's refresh are fast enough; frames at half of it are not
  assert.deepEqual(run(() => 16.7, { gpu: false }).steps, []);
  assert.deepEqual(run((ratio) => (ratio > 1.3 ? 33.4 : 16.7), { gpu: false }).steps, [1.25]);
  assert.deepEqual(run(() => 8.3, { gpu: false, fps: 120 }).steps, [], 'a 120 Hz display at its pace');
});

test('a strong Mac picks High for any window; a phone, an Intel GPU or a software adapter never take the strong path', async () => {
  const { strongStart } = await import('../classic/src/quality/tiers.js');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  const m = (extra = {}) => readSignals({ adapter: { info: { vendor: 'apple', architecture: 'metal-3' }, limits: { maxTextureDimension2D: 16384, maxBufferSize: 2 ** 32 }, ...extra }, ua: UA, platform: 'MacIntel', screen: { w: 1512, h: 945, dpr: 2 } });
  for (const warm of [3, 4.6, 5.5, 11]) assert.equal(pickTier(m(), warm).tier, 'high', `warm ${warm}`);
  assert.equal(strongStart(m({ isFallbackAdapter: true }), 5), false);
  assert.equal(strongStart(readSignals({ adapter: { info: { vendor: 'intel' } }, ua: UA, platform: 'MacIntel' }), 5), false);
  assert.equal(strongStart(readSignals({ adapter: { info: { vendor: 'apple' } }, ua: 'iPhone', touch: 5, screen: { w: 390, h: 844, dpr: 3 } }), 5), false);
  assert.equal(strongStart(m(), null), false, 'no warm-up: no strong start');
});

test('a phone skips the GPU warm-up: its facts cap it at Low, and Low is the pick with or without it (perf/phone-load)', () => {
  const phone = readSignals({ ua: UA_IPHONE, touch: 5, screen: { w: 402, h: 874, dpr: 3 } });
  const pixel = readSignals({ ua: UA_PIXEL, touch: 5, screen: { w: 412, h: 915, dpr: 2.6 } });
  const soft = readSignals({ adapter: { isFallbackAdapter: true, info: {} }, ua: UA_MAC, screen: { w: 1280, h: 720, dpr: 1 } });
  for (const s of [phone, pixel, soft]) {
    assert.equal(warmupDecides(s), false);
    assert.equal(pickTier(s, null).tier, 'low', 'no warm-up: Low');
    for (const ms of [0.5, 4, 40]) assert.equal(pickTier(s, ms).tier, 'low', `a ${ms} ms warm-up: Low too`);
  }
  assert.equal(warmupDecides(mac()), true, 'a desktop still measures (the strong start and the pick need it)');
  assert.equal(warmupDecides(readSignals({ ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', touch: 5, screen: { w: 1024, h: 1366, dpr: 2 } })), true, 'a tablet still measures');
});
