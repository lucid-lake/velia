// The sound beds (v2 step 3, hybrid: v2/audio/): the mixer follows the sim the way v1's sound does; the code wind's graph is
// built once and moves only by ramps; v1's recordings on v1's engines (recorded.js) load each file once, make no node on a frame
// without a one-shot, and play the boat's one-shots from their banks; a steady sail touches few parameters; the material is
// deterministic and bounded; the main-thread work is far under 0.1 ms a frame. A stand-in AudioContext (and the node
// constructors v1's engines call) counts every node and records every automation call (node has no Web Audio); the real
// render's checks (peak, silence, clicks, loudness) are v2/tests/pages/beds.page.mjs in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestOf } from '../../tests/helpers/bestOf.mjs';
import { BedsMix, BEDS } from '../audio/bedsMix.js';
import { createBeds } from '../audio/beds.js';
import { createRecorded } from '../audio/recorded.js';
import { material, rms, patter, rng } from '../audio/noise.js';
import { sailScript, frames, PHASES } from '../audio/script.js';
import { meter, maskMix } from '../audio/offline.js';

const KN = 0.514444, DEG = Math.PI / 180;

// ---- a stand-in AudioContext: nodes counted, automation recorded; the constructors v1's engines use (new GainNode(ctx, o) …)
function fakeCtx(sampleRate = 8000) {
  const log = { nodes: 0, calls: {}, starts: 0, stops: 0, hard: 0, decoded: 0 };
  const call = (k) => { log.calls[k] = (log.calls[k] ?? 0) + 1; };
  const param = (v = 0) => ({ value: v, setTargetAtTime() { call('setTargetAtTime'); }, cancelAndHoldAtTime() { call('cancelAndHoldAtTime'); }, cancelScheduledValues() { call('cancelScheduledValues'); },
    setValueAtTime() { log.hard++; call('setValueAtTime'); }, linearRampToValueAtTime() { log.hard++; }, exponentialRampToValueAtTime() { log.hard++; }, setValueCurveAtTime() { log.hard++; } });
  const node = (extra = {}) => { log.nodes++; return { connect(n) { return n; }, disconnect() {}, ...extra }; };
  const fakeBuf = (ch, n, sr) => { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { duration: n / sr, length: n, sampleRate: sr, numberOfChannels: ch, getChannelData: (c) => d[c] }; };
  const ctx = {
    sampleRate, currentTime: 0, destination: node(), state: 'running',
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param(1), start() { log.starts++; }, stop() { log.stops++; } }),
    createOscillator: () => node({ type: 'sine', frequency: param(440), setPeriodicWave() {}, start() { log.starts++; }, stop() { log.stops++; } }),
    createStereoPanner: () => node({ pan: param(0) }),
    createChannelSplitter: () => node(), createChannelMerger: () => node(),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createWaveShaper: () => node({ curve: null }),
    createPeriodicWave: () => ({}),
    createBuffer: fakeBuf,
    decodeAudioData: async () => { log.decoded++; return fakeBuf(1, sampleRate * 8, sampleRate); },   // a bank of 4 two-second slots
  };
  const G = globalThis;
  G.GainNode = function (c, o = {}) { return Object.assign(ctx.createGain(), { gain: param(o.gain ?? 1) }); };
  G.BiquadFilterNode = function (c, o = {}) { return Object.assign(ctx.createBiquadFilter(), { type: o.type }); };
  G.AudioBufferSourceNode = function (c, o = {}) { return Object.assign(ctx.createBufferSource(), { buffer: o.buffer, loop: !!o.loop }); };
  G.OscillatorNode = function () { return ctx.createOscillator(); };
  G.AudioBuffer = function (o) { return fakeBuf(o.numberOfChannels ?? 1, o.length, o.sampleRate); };
  return { ctx, log };
}
const fakeFetch = (seen) => async (u) => { seen.push(u); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1000) }; };

test('the code wind is built once, moves only by ramps, never stops; nothing of its graph is made per frame', () => {
  const { ctx, log } = fakeCtx();
  const beds = createBeds(ctx);
  const built = log.nodes, starts = log.starts;
  assert.ok(built > 20 && built < 120, `a graph of ${built} nodes`);
  const mix = new BedsMix({ seed: 1 }), fr = frames(60, 60);
  for (let i = 0; i < fr.length; i++) { ctx.currentTime = i / 60; beds.update(mix.step(fr[i]), ctx.currentTime); }
  assert.equal(log.nodes, built, 'no node after build');
  assert.equal(log.starts, starts, 'no source started after build');
  assert.equal(log.stops, 0, 'no voice ever stops');
  assert.equal(log.hard, 0, `no hard set, linear or curve automation (${JSON.stringify(log.calls)})`);
});

test('the recordings: v1\'s files by their v1 paths, each fetched once; no node on a frame without a one-shot; the one-shots from v1\'s banks', async () => {
  const { ctx, log } = fakeCtx(), seen = [];
  const beds = createBeds(ctx);
  const rec = createRecorded(ctx, { effects: beds.inputs.effects, ambience: beds.inputs.ambience, base: 'audio/', fetchFn: fakeFetch(seen) });
  await rec.ready;
  assert.deepEqual([...new Set(seen)].sort(), seen.slice().sort(), 'each file fetched once');
  for (const f of ['audio/boat/hull_chuckle.opus', 'audio/boat/hull_rush.opus', 'audio/boat/sail_flutter.opus', 'audio/boat/sail_flog.opus', 'audio/boat/creak_rig.opus', 'audio/boat/creak_sheet.opus',
    'audio/boat/sail_snap.opus', 'audio/sfx/winch_click.opus', 'audio/sfx/sheet_run.opus', 'audio/lake_lap.opus', 'audio/rain_water.opus']) assert.ok(seen.includes(f), f);
  assert.ok(!seen.some((u) => /wind_(light|strong)/.test(u)), 'no wind recording: the wind is code');
  const mix = new BedsMix({ seed: 1 }), fr = frames(60, 60);
  let quiet = 0, quietNodes = 0, events = 0, eventNodes = 0;
  for (let i = 0; i < fr.length; i++) {
    ctx.currentTime = i / 60;
    const n0 = log.nodes, m = mix.step(fr[i]);
    beds.update(m, ctx.currentTime); rec.update(fr[i], m, ctx.currentTime);
    const made = log.nodes - n0;
    // a one-shot: the boat's (the mixer's events) or the controls' (v1's sfx: the wheel's creak and the ease's first pull on a
    // change of the hands, the winch's clicks)
    const hands = i > 0 && (fr[i].steer !== fr[i - 1].steer || fr[i].pull !== fr[i - 1].pull);
    if (m.events.length || hands) { events += m.events.length + (hands ? 1 : 0); eventNodes += made; } else { quiet++; quietNodes += made; }
  }
  assert.equal(quietNodes, 0, `no node on the ${quiet} frames without a one-shot`);
  assert.ok(events >= 10 && eventNodes / events <= 20, `${events} one-shots made ${eventNodes} nodes (${(eventNodes / events).toFixed(1)} each, v1's)`);
  const played = rec.stats().boat.events.map((e) => e.kind);
  assert.ok(played.some((k) => k === 'snap' || k === 'creak' || k === 'sheet' || k === 'slap'), `v1's engines played the one-shots (${[...new Set(played)].join(', ')})`);
});

test('the dead band: a steady sail touches almost nothing a frame; a changing one touches what changed', () => {
  const { ctx } = fakeCtx();
  const beds = createBeds(ctx), mix = new BedsMix({ seed: 1 });
  const steady = sailScript(16);
  for (let i = 0; i < 240; i++) beds.update(mix.step({ ...steady, t: 16 + i / 60, wallT: 16 + i / 60 }), i / 60);
  const before = beds.sets;
  for (let i = 240; i < 300; i++) beds.update(mix.step({ ...steady, t: 16 + i / 60, wallT: 16 + i / 60 }), i / 60);
  const perFrame = (beds.sets - before) / 60;
  assert.ok(perFrame < 3, `a steady state: ${perFrame.toFixed(2)} parameter calls a frame`);
});

test('wind: louder, brighter and buffeting harder with the wind at the listener; panned to the apparent wind\'s side', () => {
  const at = (earWind, pan = 0) => new BedsMix().step({ ...sailScript(16), earWind, pan });
  const lo = at(1.5), hi = at(10);
  assert.ok(hi.gains.wind > lo.gains.wind * 1.2, `gain ${lo.gains.wind.toFixed(3)} → ${hi.gains.wind.toFixed(3)}`);
  assert.ok(hi.hz.wind > lo.hz.wind + 300, `cutoff ${lo.hz.wind.toFixed(0)} → ${hi.hz.wind.toFixed(0)} Hz`);
  assert.equal(Math.round(at(BEDS.windRefMs).hz.wind), 1130, 'Cold Smoke\'s 300 + 830·u^1.1 at u = 1');
  assert.ok(hi.rate.buffet > lo.rate.buffet && hi.rate.buffetDepth > lo.rate.buffetDepth);
  assert.ok(at(8, 1).pan.wind > 0.5 && at(8, -1).pan.wind < -0.5 && Math.abs(at(8, 0).pan.wind) < 1e-9, 'the side follows the pan input');
  assert.ok(Math.abs(at(8, 5).pan.wind) <= BEDS.panMax + 1e-9, 'never past panMax');
  // the rig's rush and whistle rise with the apparent wind (v1's windMix)
  const aw = (speed) => new BedsMix().step({ ...sailScript(16), state: { ...sailScript(16).state, apparentWind: { speed, angle: 0.6 } } });
  assert.ok(aw(10).gains.rig > aw(4).gains.rig && aw(12.5).gains.whistle > 0 && aw(4).gains.whistle === 0);
});

test('hull and water: the still lap when nearly stopped, the chuckle then the rush with speed, the rush with heel, slaps from chop', () => {
  const base = sailScript(16).state;
  const at = (sogKn, heelDeg = 10) => new BedsMix().step({ ...sailScript(16), state: { ...base, sog: sogKn * KN, heel: heelDeg * DEG } });
  assert.ok(at(0.3).gains.still > 0.2 && at(4).gains.still < 0.02, `still lap ${at(0.3).gains.still.toFixed(3)} at 0.3 kn, ${at(4).gains.still.toFixed(3)} at 4 kn`);
  assert.ok(at(1.5).gains.chuckle > at(6.5).gains.chuckle, 'the chuckle gives way');
  assert.ok(at(6.5).gains.rush > 4 * at(2.5).gains.rush && at(6.5).hz.hull > at(2.5).hz.hull, 'the rush opens with speed');
  assert.ok(at(6, 22).gains.rush > at(6, 2).gains.rush * 1.2, 'heel brings the lee water nearer');
  // the bow on the waves: chop (the gusty phase's pitch and bow speed) slaps, a flat sea does not
  const count = (fn) => { const m = new BedsMix({ seed: 3 }); let n = 0; for (let i = 0; i < 16 * 60; i++) n += m.step(fn(8 + i / 60)).events.filter((e) => e.kind === 'slap').length; return n; };
  const chop = count((t) => sailScript(t)), flat = count((t) => ({ ...sailScript(t), pitch: 0, bowRelVel: 0 }));
  assert.ok(chop >= 2 && flat === 0, `slaps: ${chop} in chop, ${flat} on a flat sea`);
});

test('sails: the luff flutters at a flap rate from the apparent wind, a tack flogs and snaps as the new side fills, the winch clicks', () => {
  const m = new BedsMix({ seed: 1 }), seen = { snap: 0, click: 0, flutter: 0, flog: 0, creak: 0 };
  for (const f of frames(60, 60)) {
    const o = m.step(f);
    for (const e of o.events) { if (e.kind in seen) seen[e.kind]++; if (e.kind === 'sheet' || e.kind === 'sheetCreak') seen.creak++; }
    if (f.t > PHASES.luff[0] + 1.5 && f.t < PHASES.luff[0] + 6) { seen.flutter = Math.max(seen.flutter, o.gains.flutter); assert.ok(o.rate.flutter > 4 && o.rate.flutter < 16, `flap ${o.rate.flutter.toFixed(1)} Hz`); }
    if (f.t > 26.5 && f.t < 28) seen.flog = Math.max(seen.flog, o.gains.flog);
  }
  assert.ok(seen.flutter > 0.15, `the eased main flutters (${seen.flutter.toFixed(3)})`);
  assert.ok(seen.flog > 0.1, `head to wind it flogs (${seen.flog.toFixed(3)})`);
  assert.ok(seen.snap >= 1, `the sails snap full after the tack (${seen.snap})`);
  assert.ok(seen.click >= 8, `the winch clicks as the sheet comes in (${seen.click})`);
  assert.ok(seen.creak >= 1, `the sheet creaks under load (${seen.creak})`);
});

test('rain: on the water from the storm\'s rain, on the deck only near the boat', () => {
  const at = (rain, camDist) => new BedsMix().step({ ...sailScript(50), rain, camDist });
  assert.equal(at(0, 10).gains.rain, 0); assert.equal(at(0, 10).gains.deck, 0);
  assert.ok(at(1, 10).gains.rain > at(0.2, 10).gains.rain && at(1, 10).gains.deck > 0.2 && at(1, 120).gains.deck === 0);
});

test('deterministic: the same frames give the same targets and events; a bed alone keeps only its voices', () => {
  const run = () => { const m = new BedsMix({ seed: 5 }); return frames(30, 30).map((f) => m.step(f)); };
  assert.deepEqual(JSON.stringify(run()), JSON.stringify(run()));
  const o = maskMix(new BedsMix().step(sailScript(16)), ['wind']);
  assert.ok(o.gains.wind > 0 && o.gains.rush === 0 && o.gains.flutter === 0 && o.events.length === 0);
});

test('main thread: the mixer and the parameter pass cost well under 0.1 ms a frame (node, stand-in graph)', () => {
  const { ctx } = fakeCtx();
  const beds = createBeds(ctx), mix = new BedsMix(), fr = frames(60, 60);
  for (let i = 0; i < 600; i++) beds.update(mix.step(fr[i]), i / 60);   // warm
  // the fastest of 15 batches over the rest of the script, in order: the mixer's own cost, not the load (v2 #29)
  const rest = fr.length - 600;
  let i = 600;
  const per = bestOf(() => { beds.update(mix.step(fr[i]), i / 60); i = i + 1 < fr.length ? i + 1 : 600; }, { batches: 15, per: Math.floor(rest / 15) });
  assert.ok(per < 0.05, `${(per * 1000).toFixed(1)} µs a frame`);
});

test('the material: deterministic, bounded, the loops seamless; the patter soft-limited; the lfo unit variance', () => {
  const a = material(8000, 7), b = material(8000, 7);
  assert.deepEqual(a.pink[0].slice(0, 64), b.pink[0].slice(0, 64));
  const p = a.pink[0];
  assert.ok(Math.abs(p[0] - p[p.length - 1]) < 4 * rms(p), 'pink: the seam steps no more than the noise itself');
  assert.ok(Math.abs(rms(a.lfo[0]) - 1) < 0.25, `lfo rms ${rms(a.lfo[0]).toFixed(2)}`);
  const pt = patter(8000, rng(3), 8000, { rate: 900 })[0];
  assert.ok(Math.max(...pt.map(Math.abs)) <= 0.5 && pt[0] === 0, 'patter: under its 0.5 ceiling, faded in at the seam');
});

test('the meter: a step, a gap and the levels', () => {
  const sr = 1000, L = new Float32Array(3 * sr), R = new Float32Array(3 * sr);
  for (let i = 0; i < L.length; i++) { const on = i < sr || i >= 2 * sr; L[i] = R[i] = on ? 0.1 * Math.sin(i * 0.3) : 0; }
  const m = meter([L, R], sr);
  assert.ok(Math.abs(m.longestSilenceS - 1) < 0.06, `gap ${m.longestSilenceS}`);
  assert.ok(m.maxStep <= 0.1 + 1e-6 && Math.abs(m.peakDb + 20) < 0.1);
  L[1500] = 0.5;
  assert.ok(meter([L, R], sr).maxStep >= 0.5);
});
