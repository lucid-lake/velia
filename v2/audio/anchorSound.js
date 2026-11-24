// The anchor heard (the anchor seen, owner 2026-11-17): what the seamanship's events and the chain's speed sound like, on the
// engine's bus (live pages; a capture is silent). v1's chain_run recording keeps playing with the engine's sound (v2/audio/engine.js);
// this adds what it lacked to read as the anchor going:
//   letgo    the anchor leaving the roller: a short heavy clunk (synthesised: a damped 70 Hz knock and a steel tick)
//   rattle   the chain running over the roller: steel links clacking, their rate and level with the chain's speed (synthesised:
//            a looped buffer of seeded metallic clicks, band-passed; nothing plays while the chain is still)
//   splash   the anchor meeting the water: the kayaks' recorded splash (audio/sfx/kayak_splash: Freesound 585744, CC0), a smaller
//            body, played a touch faster; the break-out on the way up its second take, quieter
// The splash file is fetched on the first anchor press (sea.actions: the page calls prime()), never before.
//   const S = createAnchorSound({ core, beds });   S.prime();   S.update(events, chainMs, camDist)   each frame
//   renderAnchor({ frames: [{ events, chainMs, camDist }], fps, base, sampleRate }) → { channels, sampleRate } (the film's sound)
import { decodeFile } from '../../src/audioFormat.js';
import { mulberry32 } from '../../src/sim/core/rng.js';

export const ANCHOR_SOUND = Object.freeze({
  url: 'sfx/kayak_splash.opus', slot: 2.5,          // the splash file (under audio/), its two takes 2.5 s apart
  splash: { gain: 1.0, rate: 1.18 }, brk: { gain: 0.45, rate: 1.3 },
  clunk: { gain: 0.9, hz: 70, tau: 0.09 },
  rattle: { gain: 0.75, loopS: 1.2, clicksS: 34, lo: 1800, q: 1.4, minMs: 0.05, fullMs: 1.0, rate: [0.7, 1.35] },
  near: 20,                                           // m: full level within a few metres, half at ≈ 20 m
});
export const anchorGain = (d, S = ANCHOR_SOUND) => Math.min(1, 1 / (0.3 + Math.max(0, d) / S.near));
// the rattle's level and rate for the chain's speed (m/s of rode a second of game time; pure)
export function rattleMix(chainMs, S = ANCHOR_SOUND.rattle) {
  const v = Math.abs(chainMs), k = Math.min(1, Math.max(0, (v - S.minMs) / (S.fullMs - S.minMs)));
  return { gain: v < S.minMs ? 0 : S.gain * (0.35 + 0.65 * Math.sqrt(k)), rate: S.rate[0] + (S.rate[1] - S.rate[0]) * k };
}

// the rattle's loop: seeded clicks of steel on steel (each a few ms of decaying ringing at two link pitches)
function rattleBuffer(ctx, S = ANCHOR_SOUND.rattle) {
  const sr = ctx.sampleRate, n = Math.round(S.loopS * sr), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = mulberry32(4421);
  const clicks = Math.round(S.clicksS * S.loopS);
  for (let c = 0; c < clicks; c++) {
    const at = Math.floor((c + 0.35 * (r() - 0.5)) / clicks * n), amp = 0.4 + 0.6 * r(), f1 = 2300 + 900 * r(), f2 = 4100 + 1500 * r(), len = Math.round(sr * (0.012 + 0.02 * r()));
    for (let i = 0; i < len; i++) { const k = (at + i + n) % n, t = i / sr, e = Math.exp(-t / 0.0045); d[k] += amp * e * (0.6 * Math.sin(2 * Math.PI * f1 * t) + 0.4 * Math.sin(2 * Math.PI * f2 * t) + 0.5 * (r() - 0.5)); }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] *= 0.9 / (peak || 1);
  return buf;
}
// the clunk: one damped low knock and a short steel tick
function clunkBuffer(ctx, S = ANCHOR_SOUND.clunk) {
  const sr = ctx.sampleRate, n = Math.round(0.5 * sr), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = mulberry32(77);
  for (let i = 0; i < n; i++) { const t = i / sr; d[i] = Math.exp(-t / S.tau) * Math.sin(2 * Math.PI * S.hz * t * (1 - 0.25 * t)) + 0.35 * Math.exp(-t / 0.006) * Math.sin(2 * Math.PI * 3100 * t) + 0.12 * Math.exp(-t / 0.02) * (r() - 0.5); }
  return buf;
}

// the graph on a context (live or offline): out → destination; returns its handlers
function anchorGraph(ctx, destination, { base = 'audio/', fetchFn = (u) => fetch(u) } = {}) {
  const S = ANCHOR_SOUND;
  const out = new GainNode(ctx, { gain: 1 }); out.connect(destination);
  const rat = new GainNode(ctx, { gain: 0 }), bp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: S.rattle.lo, Q: S.rattle.q });
  const loop = new AudioBufferSourceNode(ctx, { buffer: rattleBuffer(ctx), loop: true });
  loop.connect(bp).connect(rat).connect(out); loop.start(0);
  const clunk = clunkBuffer(ctx);
  let splash = null, loading = null;
  const load = () => (loading ??= decodeFile(ctx, fetchFn, `${base}${S.url}`).then((b) => { splash = b; return b; }).catch(() => { loading = null; return null; }));
  const play = (buf, at, gain, rate, offset = 0, dur = undefined) => {
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate }), v = new GainNode(ctx, { gain });
    src.connect(v).connect(out); src.start(at, offset, dur);
  };
  return {
    load,
    // events this frame, the chain's speed, the camera's distance from the bow; at: the context time (a live page: now)
    update(events, chainMs = 0, camDist = 15, at = ctx.currentTime) {
      const g = anchorGain(camDist), m = rattleMix(chainMs);
      rat.gain.setTargetAtTime(m.gain * g, at, 0.06); loop.playbackRate.setTargetAtTime(m.rate, at, 0.1);
      for (const e of events ?? []) {
        if (e.kind === 'letgo') { play(clunk, at + 0.005, S.clunk.gain * g, 1); load(); }
        else if (e.kind === 'splash' && splash) play(splash, at + 0.005, S.splash.gain * g, S.splash.rate, 0, S.slot);
        else if (e.kind === 'break' && splash) play(splash, at + 0.005, S.brk.gain * g, S.brk.rate, S.slot, S.slot);
      }
    },
  };
}

// on the engine's bus (v2/audio/engine.js's way): the music's effects bus (Settings' sound and effects, M), else the beds' effects
export function createAnchorSound({ core = null, beds = null, base = 'audio/', fetchFn = (u) => fetch(u) } = {}) {
  let G = null, want = false;
  const make = (ctx, destination) => { if (ctx.state === 'closed') return; G = anchorGraph(ctx, destination, { base, fetchFn }); if (want) G.load(); };
  if (core) core.attach(({ ctx, master }) => make(ctx, master), 'effects');
  else beds?.attach(({ ctx, effects }) => make(ctx, effects));
  return {
    prime() { want = true; G?.load(); },   // the first anchor press: the splash file now, before it is needed
    update(events, chainMs, camDist) { G?.update(events, chainMs, camDist); },
    get ready() { return !!G; },
  };
}

// the film's sound: the same graph on an OfflineAudioContext, fed frame by frame
export async function renderAnchor({ frames, fps = 30, base = 'audio/', sampleRate = 48000, fetchFn = (u) => fetch(u) }) {
  const length = Math.ceil((frames.length / fps + 3) * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const G = anchorGraph(ctx, ctx.destination, { base, fetchFn });
  await G.load();
  frames.forEach((f, i) => G.update(f.events, f.chainMs, f.camDist, i / fps));
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate };
}
