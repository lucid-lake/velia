// The engine's sound and the anchor chain (feat/engine-anchor, 2026-10-29). Plugs into src/audio.js's context and master
// (audio.attach) beside src/boatAudio.js, silent until audio.start() (a user gesture), driven every frame by the boat
// state (src/boat.js: engineRpm, engineState, thrust) and the chain's speed (src/boat/tackle.js).
//
//   const ea = createEngineAudio({ audio });          // or { ctx, destination } offline (tools/render_engine_audio.mjs)
//   ea.update(state, { camDist, chainMs }, at);       // every frame
//
// The layers (the recordings: audio/sources.json "boat", CC0 Freesound; the rest synthesised, no Math.random()):
//   idle:  a sailboat's small diesel ticking over below deck (engine_idle), its rate × rpm / idle (± a little): the
//          idle's character, gone by ≈ 1,700 rpm;
//   run:   a sailboat diesel at a steady cruise (engine_run, a four-cylinder firing at 61 Hz), pitched so its firing
//          matches a three-cylinder's at our rpm (rate = rpm / 2,440): the throttle-up, rising over 1,000–1,800 rpm;
//   beat:  the firing's thump, a sawtooth at the firing rate (rpm / 60 × 3 / 2) under a 160 Hz low-pass: the knock that
//          tracks the lever when the recordings' pitch is held;
//   wet:   the wet exhaust's splash at the transom, noise in a 2.4 kHz band chopped at the firing rate;
//   crank: the starter, a 380 Hz band of noise chopped at the compression strokes (≈ 5.5 Hz), only while cranking;
//   load:  the prop's bite opens the low-pass and lifts the run a little (thrust / bollard pull);
//   chain: the rode running out or in (chain_run), its level and rate with the chain's speed.
// The whole engine sits under the ambience (ENGINE.bus) and darkens with the camera's distance, as the boat does.
import { DIST } from './boatAudio.js';
import { decodeFile } from './audioFormat.js';
import { cardFetch } from './ui/deferLoad.js';
import { clamp01 } from './sim/core/math.js';

import { smooth as smoothstep } from './sim/core/math.js';

const ENGINE_FILES = ['engine_idle', 'engine_run', 'chain_run'];
const ENGINE_SOUND = {
  bus: 0.55, idle: 0.5, run: 1.1, beat: 0.2, wet: 0.06, crank: 0.35, chain: 2.6,
  idleRpm: 850, runRefRpm: 2440, cyl: 3,
  idleFade: [900, 1700], runRise: [1000, 1800], lpHz: [700, 5000],
};

// The mix for one frame (pure): gains 0..1 × the layer level, playback rates, the firing rate, the low-pass.
function engineMix(state = {}, { camDist = 20, chainMs = 0 } = {}) {
  const E = ENGINE_SOUND, rpm = Math.max(0, state.engineRpm ?? 0), on = rpm > 30;
  const cranking = state.engineState === 'cranking';
  const load = clamp01(Math.abs(state.thrust ?? 0) / 1450);
  const life = smoothstep(30, 500, rpm);                                  // the run-down fades as it stops
  const fire = rpm / 60 * E.cyl / 2;                                      // Hz
  const near = 1 - smoothstep(DIST.refM, DIST.farM, camDist);
  const n = smoothstep(850, 3000, rpm), loud = 0.45 + 0.55 * n * n;   // ≈ +7 dB of the whole from idle to full, on top of the layers' swap
  const gains = {
    idle: on && !cranking ? E.idle * life * (1 - smoothstep(E.idleFade[0], E.idleFade[1], rpm)) : 0,
    run: on && !cranking ? E.run * smoothstep(E.runRise[0], E.runRise[1], rpm) * loud * (0.85 + 0.25 * load) : 0,
    beat: on && !cranking ? E.beat * life * (0.35 + 0.65 * n) : 0,
    wet: on && !cranking ? E.wet * life * (0.5 + 0.5 * smoothstep(800, 3000, rpm)) : 0,
    crank: cranking ? E.crank : 0,
    chain: E.chain * smoothstep(0.02, 0.25, Math.abs(chainMs)),
  };
  return {
    gains, bus: E.bus * (0.35 + 0.65 * near),
    rates: { idle: Math.min(1.6, Math.max(0.45, rpm / E.idleRpm)), run: Math.min(1.35, Math.max(0.45, rpm / E.runRefRpm)), chain: 0.8 + 0.5 * clamp01(Math.abs(chainMs) / 0.8) },
    fireHz: Math.max(1, fire), lowpassHz: E.lpHz[0] + (E.lpHz[1] - E.lpHz[0]) * (0.25 + 0.5 * smoothstep(850, 3000, rpm) + 0.25 * load) * (0.4 + 0.6 * near),
    rpm, cranking,
  };
}

// seeded noise (mulberry32), so a render is the same every time
function noiseData(n, seed = 7) {
  let a = seed >>> 0; const d = new Float32Array(n);
  for (let i = 0; i < n; i++) { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); d[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; }
  return d;
}

export function createEngineAudio({ audio, ctx: ctx0, destination, base = '/audio/boat/', files = {}, fetchFn = cardFetch } = {}) {   // fetchFn: on a phone, once the card is live (src/ui/deferLoad.js)
  let ctx = null, g = null, mix = engineMix();
  const bufs = {}, log = [];
  const decode = (url) => decodeFile(ctx, fetchFn, url);
  let ready = null;
  function init(c, dest) {
    ctx = c;
    const G = (v = 0) => new GainNode(ctx, { gain: v }), F = (type, frequency, Q = 0.7) => new BiquadFilterNode(ctx, { type, frequency, Q });
    g = { bus: G(0), lp: F('lowpass', 2000, 0.5) };
    g.lp.connect(g.bus).connect(dest);
    for (const k of ['idle', 'run', 'beat', 'wet', 'crank', 'chain']) { g[k] = G(0); g[k].connect(k === 'chain' ? g.bus : g.lp); }
    // the beat: a sawtooth at the firing rate under a low-pass
    g.beatOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 20 }); g.beatOsc.connect(F('lowpass', 160, 0.9)).connect(g.beat); g.beatOsc.start(0);
    // noise, chopped at the firing rate (the wet exhaust) and at the compressions (the starter)
    const nb = new AudioBuffer({ length: ctx.sampleRate * 4, sampleRate: ctx.sampleRate, numberOfChannels: 1 }); nb.copyToChannel(noiseData(nb.length), 0);
    const chop = (hz, depth) => {   // a gain swinging between 1 − depth and 1 with a square LFO at hz
      const v = G(1 - depth / 2), lfo = new OscillatorNode(ctx, { type: 'square', frequency: hz }), lg = G(depth / 2);
      lfo.connect(lg).connect(v.gain); lfo.start(0); return { v, lfo };
    };
    const wn = new AudioBufferSourceNode(ctx, { buffer: nb, loop: true }); wn.start(0, 0.3);
    g.wetChop = chop(20, 0.9); wn.connect(F('highpass', 900, 0.5)).connect(F('bandpass', 2400, 1.1)).connect(g.wetChop.v).connect(g.wet);
    const cn = new AudioBufferSourceNode(ctx, { buffer: nb, loop: true }); cn.start(0, 1.7);
    g.crankChop = chop(5.5, 0.85); cn.connect(F('bandpass', 380, 2.5)).connect(g.crankChop.v).connect(g.crank);
    const urls = Object.fromEntries(ENGINE_FILES.map((k) => [k, files[k] ?? `${base}${k}.opus`]));
    ready = Promise.all(Object.entries(urls).map(async ([k, u]) => {
      try { bufs[k] = await decode(u); } catch (e) { log.push({ error: String(e.message ?? e), file: k }); return; }
      const src = new AudioBufferSourceNode(ctx, { buffer: bufs[k], loop: true });
      src.connect({ engine_idle: g.idle, engine_run: g.run, chain_run: g.chain }[k]); src.start(0, k === 'engine_run' ? 7.3 : 0);
      g[`${k}Src`] = src;
    }));
    return ready;
  }
  if (ctx0) init(ctx0, destination ?? ctx0.destination);
  else audio?.attach?.(({ ctx: c, master }) => init(c, master));

  // every frame; at: the audio time to set the values at (default now; an offline render passes its timeline)
  function update(state, opts = {}, at = ctx?.currentTime) {
    mix = engineMix(state, opts);
    if (!ctx || !g) return mix;
    const T = (p, v, tau = 0.08) => p.setTargetAtTime(v, at, tau);
    T(g.bus.gain, mix.bus, 0.2); T(g.lp.frequency, mix.lowpassHz, 0.15);
    for (const k of ['idle', 'run', 'beat', 'wet', 'crank', 'chain']) T(g[k].gain, mix.gains[k], k === 'crank' ? 0.03 : 0.12);
    g.engine_idleSrc && T(g.engine_idleSrc.playbackRate, mix.rates.idle, 0.15);
    g.engine_runSrc && T(g.engine_runSrc.playbackRate, mix.rates.run, 0.15);
    g.chain_runSrc && T(g.chain_runSrc.playbackRate, mix.rates.chain, 0.2);
    T(g.beatOsc.frequency, mix.fireHz, 0.1); T(g.wetChop.lfo.frequency, mix.fireHz, 0.1);
    return mix;
  }
  return { update, get mix() { return mix; }, get ready() { return ready; }, log, dispose() { try { g?.bus.disconnect(); } catch { /* gone */ } } };
}
