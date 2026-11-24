// The boat sound's mapping (src/boatAudio.js): state → layer levels, the load-trend detector, the snap trigger, the
// sparse seeded creaks, and the scripted sail end to end on the real physics. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hullMix, windMix, distanceMix, breath, loadOf, loadLog, sailMix, Trend, CreakScheduler, SailWatch, SlapDetector, BoatMix,
  ThrillWatch, waterHit, WATER, THRILL, createBoatAudio, LEVEL, SNAP, DIST, KN, rng,
} from '../src/boatAudio.js';
import { createAudio } from '../src/audio.js';
import { scriptedSail, marks, SCRIPT } from '../demos/boat-audio-sail.js';

const DEG = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} ± ${tol}`);
const state = (o = {}) => ({ sog: 0, pitch: 0, mainFill: 1, jibFill: 1, drive: 0, side: 0, apparentWind: { speed: 0, angle: 0 }, ...o });

test('hull: a soft chuckle at 1 kn, a steady rush at 6–7 kn, brighter with speed', () => {
  const at1 = hullMix(1), at65 = hullMix(7.5), at0 = hullMix(0);
  assert.equal(at0.chuckle, 0); assert.equal(at0.rush, 0);
  assert.ok(at1.chuckle > 0.5 * LEVEL.chuckle, 'chuckle at 1 kn');
  assert.ok(at1.rush < 0.05 * LEVEL.rush, 'no rush at 1 kn');
  near(at65.rush, LEVEL.rush, 1e-9, 'full rush at 7.5 kn');
  assert.ok(hullMix(6.5).rush > 0.8 * LEVEL.rush, 'nearly full at 6.5 kn');
  assert.ok(hullMix(7.3).rush > 1.2 * hullMix(5.9).rush, 'a gust near hull speed still adds rush');
  assert.ok(at65.chuckle < 0.5 * at1.chuckle, 'the chuckle gives way to the rush');
  let pLp = 0, pRush = -1;
  for (let s = 0; s <= 8; s += 0.25) {
    const h = hullMix(s);
    assert.ok(h.lowpassHz >= pLp, `low-pass falls at ${s} kn`); assert.ok(h.rush >= pRush - 1e-12, `rush falls at ${s} kn`);
    pLp = h.lowpassHz; pRush = h.rush;
  }
  assert.ok(hullMix(0.5).lowpassHz < 800 && hullMix(7.5).lowpassHz > 8000, 'the filter opens from ≈700 Hz to ≈9 kHz');
});

test('wind: the rig layer rises with the apparent wind and on a rising trend; the whistle only above 15 kn', () => {
  assert.equal(windMix(4).rig, 0);
  assert.ok(windMix(16).rig > windMix(10).rig);
  assert.ok(windMix(12, 0.15).rig > 1.5 * windMix(12, 0).rig, 'a gust arriving lifts the rig');
  near(windMix(12, -0.3).rig, windMix(12, 0).rig, 1e-12, 'a falling trend adds nothing');
  assert.equal(windMix(14.9).whistle, 0);
  assert.ok(windMix(18).whistle > 0);
  near(windMix(30).whistle, LEVEL.whistle, 1e-12, 'whistle at full');
  assert.ok(windMix(22).whistleHz > windMix(16).whistleHz, 'pitch rises with speed');
});

test('distance: full inside the reference, ≈1/d beyond, duller far off', () => {
  near(distanceMix(10).gain, 1, 1e-12, 'near'); near(distanceMix(DIST.refM).gain, 1, 1e-12, 'ref');
  near(distanceMix(2 * DIST.refM).gain, 0.5, 1e-12, 'twice the ref');
  near(distanceMix(DIST.refM).lowpassHz, DIST.nearHz, 1e-6, 'bright near');
  near(distanceMix(DIST.farM).lowpassHz, DIST.farHz, 1e-6, 'dull far');
});

test('load trend: a ramp reads as its slope; rising, stable and falling with hysteresis', () => {
  const tr = new Trend({ tauFast: 0.3, tauSlow: 2, on: 0.12, off: 0.05 });
  const dt = 1 / 60;
  let r;
  for (let i = 0; i < 600; i++) r = tr.update(dt, 1);                          // 10 s flat
  assert.equal(r.phase, 'stable'); near(r.trend, 0, 1e-9, 'flat');
  const entered = [];
  for (let i = 0; i < 600; i++) { r = tr.update(dt, 1 + 0.3 * i * dt); if (r.entered) entered.push(r.entered); }   // +0.3 /s for 10 s
  near(r.trend, 0.3, 0.005, 'the trend on a steady ramp is its slope');
  assert.equal(r.phase, 'rising'); assert.deepEqual(entered, ['rising']);
  // a small wobble (±0.08 /s) after the ramp ends does not chatter back and forth
  const x0 = 1 + 0.3 * 10;
  const seen = new Set();
  for (let i = 0; i < 1200; i++) { r = tr.update(dt, x0 + 0.02 * Math.sin(i * dt * 4)); if (i > 300) seen.add(r.phase); }
  assert.deepEqual([...seen], ['stable'], 'a wobble under the threshold stays stable');
  for (let i = 0; i < 600; i++) r = tr.update(dt, x0 - 0.4 * i * dt);           // falls at 0.4 /s for 10 s
  assert.equal(r.phase, 'falling'); near(r.trend, -0.4, 0.02, 'falling slope');
});

test('load trend: on the log of the force, a doubling reads the same at any wind', () => {
  const rise = (F0) => {
    const tr = new Trend(), dt = 1 / 60;
    let r;
    for (let i = 0; i < 300; i++) r = tr.update(dt, loadLog(F0 / 2000));
    for (let i = 0; i < 180; i++) r = tr.update(dt, loadLog(F0 * (1 + i / 180) / 2000));   // ×2 over 3 s
    return r.trend;
  };
  near(rise(2000) / rise(4000), 1, 0.1, 'a doubling at 2 kN vs 4 kN');
  near(loadOf({ drive: 1200, side: 1600 }), 1, 1e-12, 'load is the force over 2 kN');
});

test('breathing matrix: rising breathes in, stable holds, falling exhales', () => {
  for (const l of [0.2, 0.5, 0.9]) {
    const up = breath(l, 'rising'), st = breath(l, 'stable'), dn = breath(l, 'falling');
    assert.ok(up.hum > st.hum && st.hum > dn.hum, `hum order at load ${l}`);
    assert.ok(up.creakRate > st.creakRate && st.creakRate > dn.creakRate, `creak order at load ${l}`);
    assert.equal(dn.creakRate, 0, 'no creaks while easing');
    assert.ok(up.hum <= 1.4 * LEVEL.hum && st.hum <= LEVEL.hum);
  }
  assert.ok(breath(0.9, 'stable').hum > breath(0.2, 'stable').hum, 'more load, more hum');
  assert.ok(breath(1.5, 'rising').hum > 1.3 * breath(1.5, 'stable').hum, 'past full load, a rising gust still breathes in');
});

test('creaks: seeded, deterministic, never two within 3 s, a groan on the gust and one sigh as it eases', () => {
  const run = (seed) => {
    const c = new CreakScheduler({ seed }), out = [], dt = 1 / 60;
    for (let i = 0; i < 60 * 120; i++) {   // two minutes of hard, rising load: the worst case for density
      const t = i * dt;
      const phase = t < 60 ? 'rising' : 'falling', entered = i === 0 ? 'rising' : i === 3600 ? 'falling' : null;
      for (const e of c.update(t, dt, { load: 1, phase, entered, creakRate: breath(1, phase).creakRate })) out.push({ t, ...e });
    }
    return out;
  };
  const a = run(7), b = run(7), c = run(8);
  assert.deepEqual(a, b, 'same seed, same creaks');
  assert.notDeepEqual(a, c, 'another seed, other creaks');
  assert.equal(a[0].kind, 'sheet', 'the gust loads the sheet first'); assert.equal(a[0].t, 0);
  const creaks = a.filter((e) => e.kind !== 'sigh');
  for (let i = 1; i < creaks.length; i++) assert.ok(creaks[i].t - creaks[i - 1].t >= 3 - 1e-9, `gap at ${creaks[i].t}`);
  assert.ok(creaks.length >= 8 && creaks.length <= 20, `${creaks.length} creaks in 60 s of rising load`);
  for (let i = 1; i < creaks.length; i++) assert.ok(creaks[i].slot !== creaks[i - 1].slot || creaks[i].kind !== creaks[i - 1].kind, 'no slot twice in a row');
  assert.equal(a.filter((e) => e.kind === 'sigh').length, 1, 'one sigh');
  assert.ok(a.filter((e) => e.t > 60 && e.kind !== 'sigh').length === 0, 'no creaks while falling');
  const r1 = rng(3), r2 = rng(3);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
});

test('sails: flutter when luffing off the wind, a flog head to wind, silent when full or windless', () => {
  const aws = 5;
  assert.equal(sailMix(state({ apparentWind: { speed: aws, angle: 60 * DEG } })).flutter, 0, 'full sails are silent');
  const luff = sailMix(state({ mainFill: 0, jibFill: 0.2, apparentWind: { speed: aws, angle: 60 * DEG } }));
  assert.ok(luff.flutter > 0.5 * LEVEL.flutter && luff.flog === 0, 'a luff on a reach flutters');
  const htw = sailMix(state({ mainFill: 0, jibFill: 0, apparentWind: { speed: 8, angle: 5 * DEG } }));
  assert.ok(htw.flog > 0.9 * LEVEL.flog && htw.flutter === 0, 'head to wind flogs');
  assert.equal(sailMix(state({ mainFill: 0, jibFill: 0, apparentWind: { speed: 0.5, angle: 0 } })).flog, 0, 'no wind, no flog');
});

test('snap: fill rising fast through 0.6 after a luff; not on a slow fill, a short dip, or head to wind', () => {
  const dt = 1 / 60;
  const run = (fills, awa = 40 * DEG, aws = 6) => {
    const w = new SailWatch(), out = [];
    fills.forEach((f, i) => { for (const e of w.update(i * dt, dt, state({ mainFill: f, jibFill: 1, apparentWind: { speed: aws, angle: awa } }))) out.push({ i, ...e }); });
    return out;
  };
  const luffed = Array(60).fill(0);                       // 1 s luffing
  const fast = [...luffed, ...Array.from({ length: 12 }, (_, i) => i / 11), ...Array(60).fill(1)];   // 0 → 1 in 0.2 s
  const s = run(fast);
  assert.equal(s.length, 1); assert.equal(s[0].sail, 'main'); assert.ok(s[0].gain > 0.5 * LEVEL.snap);
  assert.equal(run([...luffed, ...Array.from({ length: 120 }, (_, i) => i / 119), ...Array(30).fill(1)]).length, 0, 'a 2 s fill is no snap');
  assert.equal(run([...Array(60).fill(1), ...Array(12).fill(0), ...Array(60).fill(1)]).length, 0, 'a 0.2 s dip is not a luff');
  assert.equal(run(fast, 5 * DEG).length, 0, 'head to wind (a backed flicker) is no snap');
  assert.equal(run(fast, 40 * DEG, 0.5).length, 0, 'no wind, no snap');
  const twice = [...fast, ...luffed, ...fast.slice(60)];
  assert.equal(run(twice).length, 2, 'two luffs, two snaps');
  assert.ok(SNAP.high > SNAP.low);
});

test('bow slap: at a pitch low point in chop with way on, not every trough, never in a beat; none when still or flat', () => {
  const dt = 1 / 60, run = (amp, sogKn, rough, seed = 1, hz = 0.6) => {
    const d = new SlapDetector({ seed }), out = [];
    for (let i = 0; i < 3600; i++) { const e = d.update(i * dt, dt, amp * Math.sin(2 * Math.PI * hz * i * dt), sogKn, rough); if (e) out.push({ t: i * dt + e.hit.delay, ...e }); }
    return out;   // 60 s: 36 troughs at 0.6 Hz
  };
  const rough = run(1.5 * DEG, 6, 1), calm = run(0.4 * DEG, 6, 0);
  assert.ok(rough.length >= 15 && rough.length <= 33, `${rough.length} slaps in 60 s of rough chop (36 troughs)`);
  const gaps = rough.slice(1).map((e, i) => e.t - rough[i].t), mg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mg) ** 2, 0) / gaps.length);
  assert.ok(sd > 0.2, `the gaps vary (sd ${sd.toFixed(2)} s): no machine-gun beat`);
  const gains = rough.map((e) => e.gain);
  assert.ok(Math.max(...gains) > 1.2 * Math.min(...gains), 'no two hits the same size');
  assert.ok(calm.length <= 8 && calm.every((e) => e.gain < 0.35 * LEVEL.slap), `calm small chop: few, soft (${calm.length})`);
  assert.equal(run(1.5 * DEG, 0.5, 1).length, 0, 'no way on, no slap');
  assert.equal(run(0.05 * DEG, 6, 1).length, 0, 'flat water, no slap');
  assert.deepEqual(run(1.5 * DEG, 6, 1).map((e) => e.t), rough.map((e) => e.t), 'seeded: the same run twice');
  assert.notDeepEqual(run(1.5 * DEG, 6, 1, 2).map((e) => e.t), rough.map((e) => e.t), 'another seed, another run');
});

test('water hits: every hit its own noise, filters, onset and spray; a slow onset, no tone; a slam deeper and longer', () => {
  const r = rng(3), slaps = Array.from({ length: 20 }, () => waterHit(r, 'slap', 0.6));
  for (const k of ['offset', 'bodyHz', 'splashHz', 'attack', 'decay', 'sprayDelay', 'sprayHz']) {
    assert.ok(new Set(slaps.map((h) => h[k].toFixed(4))).size >= 18, `${k} varies hit to hit`);
  }
  for (const h of slaps) {
    assert.ok(h.attack >= 0.015 && h.attack <= 0.05, `onset ${h.attack} s: a swell, not a click`);
    assert.ok(h.bodyHz >= 80 && h.bodyHz <= 150 && h.sprayHz >= 2000 && h.sprayHz <= 6000 && h.sprayDelay > 0.04);
    assert.ok(h.spray < h.splash && h.body < h.splash, 'the splash leads; the body and the spray sit under it');
  }
  const mean = (a, k) => a.reduce((s, h) => s + h[k], 0) / a.length;
  const slams = Array.from({ length: 20 }, () => waterHit(r, 'slam', 0.8));
  assert.ok(mean(slams, 'splashHz') < mean(slaps, 'splashHz') && mean(slams, 'decay') > 1.5 * mean(slaps, 'decay') && mean(slams, 'attack') > mean(slaps, 'attack'), 'a slam: deeper, duller, longer');
  assert.ok(mean(slams, 'spray') > mean(slaps, 'spray') && slams.every((h) => h.drops.length >= 2), 'a slam throws a spray sheet that patters back');
  const big = Array.from({ length: 20 }, () => waterHit(r, 'slap', 1)), small = Array.from({ length: 20 }, () => waterHit(r, 'slap', 0));
  assert.ok(mean(big, 'decay') > mean(small, 'decay') && mean(big, 'splashHz') < mean(small, 'splashHz'), 'a bigger slap is longer and deeper');
  assert.ok(Object.keys(WATER).join() === 'slap,slam');
});

test('water hits in the engine: noise layers through filters, no oscillator (the old 52 and 68 Hz sine thumps rang like metal)', () => {
  // a recording Web Audio stand-in: every node the engine builds is counted by kind
  const made = [], P = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setValueCurveAtTime() {} });
  class Node { constructor(ctx, o = {}) { made.push(this.constructor.name); this.o = o; this.started = []; for (const k of ['gain', 'frequency', 'Q', 'playbackRate']) this[k] = P(); if (o.gain != null) this.gain.value = o.gain; }
    connect(n) { return n; } start(...a) { this.started.push(a); } }
  const kinds = { GainNode: class GainNode extends Node {}, BiquadFilterNode: class BiquadFilterNode extends Node {}, AudioBufferSourceNode: class AudioBufferSourceNode extends Node {}, OscillatorNode: class OscillatorNode extends Node {},
    AudioBuffer: class AudioBuffer { constructor({ length, sampleRate }) { this.length = length; this.sampleRate = sampleRate; this.duration = length / sampleRate; this.d = new Float32Array(length); } getChannelData() { return this.d; } } };
  const saved = Object.fromEntries(Object.keys(kinds).map((k) => [k, globalThis[k]]));
  Object.assign(globalThis, kinds);
  try {
    const ctx = { sampleRate: 8000, currentTime: 0, destination: {} };
    const boat = createBoatAudio({ ctx, files: {}, windUrl: null, fetchFn: () => new Promise(() => {}) });   // the clips never arrive: only the synthesised layers
    const count = (k) => made.filter((m) => m === k).length;
    const base = { osc: count('OscillatorNode'), src: count('AudioBufferSourceNode'), bq: count('BiquadFilterNode') };
    assert.ok(base.osc > 0, 'the stand-in sees oscillators (the stays\' note uses two)');
    const r = rng(3);
    for (const [kind, size] of [['slap', 0.6], ['slam', 0.9], ['slap', 0.1]]) {
      const before = { osc: count('OscillatorNode'), src: count('AudioBufferSourceNode'), bq: count('BiquadFilterNode') };
      const hit = waterHit(r, kind, size);
      boat.update(1, state({ sog: 3 * KN }), { camDist: 30, extra: [{ kind, gain: 0.5, hit }] }, 2);
      assert.equal(count('OscillatorNode'), before.osc, `${kind}: no oscillator`);
      assert.equal(count('AudioBufferSourceNode') - before.src, 3 + hit.drops.length, `${kind}: body, splash, spray and a source per drop, all noise`);
      assert.ok(count('BiquadFilterNode') - before.bq >= 4 + hit.drops.length, `${kind}: each layer filtered`);
    }
    assert.ok(boat.stats().events.some((e) => e.kind === 'slam'), 'the hits were played');
  } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
});

test('a water hit scheduled behind the audio clock never lands its tail inside the swell curve (Chrome throws "overlaps setValueCurveAtTime")', () => {
  // a Web Audio stand-in with Chrome's rules: a curve that starts before currentTime starts at currentTime instead, and an
  // event inside a curve's span throws NotSupportedError
  const ctx = { sampleRate: 8000, currentTime: 0, destination: {} }, curves = [];
  const P = () => { const own = []; return { value: 0,
    setValueCurveAtTime(v, t, d) { const s = Math.max(t, ctx.currentTime); own.push([s, s + d]); curves.push({ s, d, asked: t }); },
    setTargetAtTime(v, t) { if (own.some(([a, b]) => t > a && t < b)) { const e = new Error(`setTargetAtTime(${v}, ${t}) overlaps setValueCurveAtTime`); e.name = 'NotSupportedError'; throw e; } },
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; };
  class Node { constructor(ctx, o = {}) { this.o = o; for (const k of ['gain', 'frequency', 'Q', 'playbackRate']) this[k] = P(); if (o.gain != null) this.gain.value = o.gain; } connect(n) { return n; } start() {} }
  const kinds = { GainNode: class GainNode extends Node {}, BiquadFilterNode: class BiquadFilterNode extends Node {}, AudioBufferSourceNode: class AudioBufferSourceNode extends Node {}, OscillatorNode: class OscillatorNode extends Node {},
    AudioBuffer: class AudioBuffer { constructor({ length, sampleRate }) { this.length = length; this.sampleRate = sampleRate; this.duration = length / sampleRate; this.d = new Float32Array(length); } getChannelData() { return this.d; } } };
  const saved = Object.fromEntries(Object.keys(kinds).map((k) => [k, globalThis[k]]));
  Object.assign(globalThis, kinds);
  try {
    const boat = createBoatAudio({ ctx, files: {}, windUrl: null, fetchFn: () => new Promise(() => {}) });
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const at = 20 + i * 0.5;
      ctx.currentTime = at + 0.002 + (i % 4) * 0.01;   // the audio clock ran ahead of the frame's `at` (the owner's console, 2026-11-11)
      const hit = waterHit(r, i % 3 ? 'slap' : 'slam', (i % 5) / 4);
      assert.doesNotThrow(() => boat.update(1 + i, state({ sog: 3 * KN }), { camDist: 30, extra: [{ kind: hit.kind ?? 'slap', gain: 0.5, hit }] }, at));
    }
    assert.ok(curves.length >= 40 * 3, `every layer still scheduled (${curves.length} curves)`);
    assert.ok(curves.every((c) => c.asked >= c.s - 1e-12), 'no curve was asked to start in the past');
  } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
});

test('slams: never in a beat (a seeded gap of 0.6–1.3 s), and a slap never follows on a slam\'s heels', () => {
  const w = new ThrillWatch({ seed: 1 }), ts = [];
  for (let i = 0; i < 600; i++) { const t = i * 0.05, out = w.update(t, { sog: 3, slam: i % 4 === 0 ? 0.9 : 0 }); if (out.some((e) => e.kind === 'slam')) ts.push(t); }
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  assert.ok(gaps.every((g) => g >= THRILL.slamGapS - 1e-9 && g <= THRILL.slamGapS + 0.85), `gaps ${Math.min(...gaps).toFixed(2)}–${Math.max(...gaps).toFixed(2)} s`);
  assert.ok(new Set(gaps.map((g) => g.toFixed(2))).size >= 2, 'the gap varies');
  // the bow plunging: the slam cue and a pitch trough together give one hit, the slam
  const m = new BoatMix({ seed: 1 }), kinds = [];
  for (let i = 0; i < 600; i++) {
    const t = i / 60, ph = 2 * Math.PI * 0.6 * t, d = ((ph % (2 * Math.PI)) - Math.PI + 0.25), slam = Math.exp(-d * d / 0.08);   // the cue peaks just before the trough
    for (const e of m.step(t, { ...state({ sog: 3, apparentWind: { speed: 8, angle: 0.8 } }), pitch: 2 * DEG * Math.cos(ph), slam, seaRough: 1 }).events) if (e.kind === 'slap' || e.kind === 'slam') kinds.push({ t, k: e.kind });
  }
  const slamTs = kinds.filter((e) => e.k === 'slam').map((e) => e.t);
  assert.ok(slamTs.length >= 3, `${slamTs.length} slams`);
  assert.ok(kinds.filter((e) => e.k === 'slap').every((e) => slamTs.every((s) => e.t - s < 0 || e.t - s >= 0.45)), 'no slap in the 0.45 s after a slam');
});

test('scripted sail on the real physics: the gust loads and the tack flogs, then snaps', () => {
  const fr = scriptedSail({ hz: 30 }), m = new BoatMix({ seed: 1 }), mk = marks(fr);
  const rows = fr.map((f) => m.step(f.t, f.s, { camDist: f.camDist }));
  const at = (a, b, fn) => { const r = rows.filter((x) => x.t >= a && x.t < b); return r.reduce((s, x) => s + fn(x), 0) / r.length; };
  const evs = rows.flatMap((r) => r.events.map((e) => ({ t: r.t, ...e })));
  const [g0, g1, g2, g3] = SCRIPT.gust;
  assert.ok(rows.some((r) => r.t > g0 && r.t < g1 + 1 && r.phase === 'rising'), 'the gust reads as rising load');
  assert.ok(at(g1, g2, (r) => r.gains.hum) > 2 * at(5, 19, (r) => r.gains.hum), 'the rig hums up in the gust');
  assert.ok(at(g1, g2, (r) => r.gains.rush) > 1.3 * at(5, 19, (r) => r.gains.rush), 'the hull rushes in the gust');
  assert.ok(evs.some((e) => e.kind === 'sheet' && e.t > g0 && e.t < g1 + 1), 'the sheet groans as the gust loads');
  assert.ok(evs.some((e) => e.kind === 'sigh' && e.t > g2 && e.t < g3 + 2), 'a sigh as it eases');
  assert.ok(mk.headToWind && mk.headToWind[1] - mk.headToWind[0] > 3, 'the tack stalls head to wind');
  const [h0, h1] = mk.headToWind;
  assert.ok(at(h0 + 1, h1, (r) => r.gains.flog) > 0.5 * LEVEL.flog, 'the sails flog head to wind');
  assert.ok(evs.some((e) => e.kind === 'snap' && e.t > h1 - 1 && e.t < h1 + 8), 'a snap as they refill');
  assert.ok(!evs.some((e) => e.kind === 'snap' && e.t > h0 + 0.5 && e.t < h1 - 1), 'no snap in irons');
  const cr = evs.filter((e) => e.kind === 'creak' || e.kind === 'sheet');
  for (let i = 1; i < cr.length; i++) assert.ok(cr[i].t - cr[i - 1].t >= 3, 'creaks ≥ 3 s apart');
  assert.ok(cr.length <= SCRIPT.seconds / 6, `${cr.length} creaks in ${SCRIPT.seconds} s: sparse`);
  // determinism: the same run twice
  const m2 = new BoatMix({ seed: 1 });
  const evs2 = fr.flatMap((f) => m2.step(f.t, f.s, { camDist: f.camDist }).events.map((e) => ({ t: f.t, ...e })));
  assert.deepEqual(evs2, evs);
});

test('engine: silent and context-free until audio.start(); it joins the ambience context through attach', () => {
  const audio = createAudio({ Ctx: class { constructor() { throw new Error('no context before a gesture'); } } });
  const boat = createBoatAudio({ audio, fetchFn: () => { throw new Error('no fetch before start'); } });
  const m = boat.update(1, state({ sog: 3 * KN }), { camDist: 30 });
  assert.ok(m.gains.chuckle > 0 && boat.stats().started === false, 'the mix runs, silently');
  let called = 0;
  audio.attach(() => { called++; });
  assert.equal(called, 0, 'attach waits for start()');
});

test('the stall creak: a soft groan as the main stalls forward of a broad reach, again every 4–7 s, never on a run', async () => {
  const { StallWatch, STALL } = await import('../src/boatAudio.js');
  const run = (awaDeg, stall, secs = 30) => {
    const w = new StallWatch({ seed: 3 }), ev = [];
    for (let i = 0; i < secs * 60; i++) { const e = w.update(i / 60, 1 / 60, { mainStall: stall(i / 60), apparentWind: { angle: awaDeg * Math.PI / 180, speed: 7 } }); if (e) ev.push({ t: i / 60, ...e }); }
    return ev;
  };
  const ev = run(60, (t) => (t > 5 ? 0.9 : 0));
  assert.ok(ev.length >= 4 && ev.length <= 7, `${ev.length} creaks in 25 s stalled`);
  assert.ok(ev[0].t > 5 + STALL.armS - 0.02 && ev[0].t < 5.5, `the first at ${ev[0].t.toFixed(2)} s`);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t - ev[i - 1].t >= 4 - 1e-9 && ev[i].t - ev[i - 1].t <= 7 + 0.02);
  assert.ok(ev.every((e) => e.kind === 'stall' && e.gain > 0.1 && e.gain <= STALL.gain && e.rate < 0.9));
  assert.equal(run(150, () => 1).length, 0, 'a run is a flat plate: no creak');
  assert.equal(run(60, () => 0.3).length, 0, 'drawing: no creak');
  assert.deepEqual(run(60, (t) => (t > 5 ? 0.9 : 0)), ev, 'deterministic');
});
