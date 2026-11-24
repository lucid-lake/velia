import { decodeFile } from '../audioFormat.js';
// The VHF's sound (owner, 2026-10-29): the forecast's clips (audio/vhf/forecast.opus, tools/vhf_voice.py) laid end to
// end through a radio: band-passed 350–2,800 Hz with a presence lift, a soft clip, a little hiss under the voice, the
// squelch's open and its tail when the carrier drops. And, near the harbour, now and then, a wordless murmur on 16:
// band-passed noise with a syllable envelope, never words. All synthesised but the voice; nothing loud.
//
//   const radio = createRadio({ audio });            // src/audio.js: joins its context and master (audio.attach)
//   const plan = radio.plan(forecast.tokens);        // the timeline from the clips' lengths alone (the LCD reads it)
//   radio.play(plan); radio.stop(); radio.chatter(seed);
//   radio.update(dtReal) → { playing, at (s into the plan), token (index) }
// Pure parts (planTokens, chatterEnvelope) for tests/vhf.test.mjs.
export const RADIO = {
  gapS: 0.07,                 // between two clips (the weather radio's voice joins its words with short gaps)
  pauseS: { ',': 0.28, '.': 0.55 },
  leadS: 0.35, tailS: 0.22,   // the squelch's open before the first word, the tail after the last
  band: [350, 2800], presence: { hz: 1600, gainDb: 4 }, drive: 1.6,
  level: 0.55,                // the voice into the master (≈ −20 dBFS clips → ≈ −25 dBFS out)
  hiss: 0.012, squelch: 0.09, // the noise under the voice, and the squelch burst's peak
  chatter: { level: 0.25, minS: 1.6, maxS: 3.4, syllableHz: [3.5, 6] },
};

const rng = (seed) => { let a = (seed | 0) + 0x6d2b79f5; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// The timeline: each clip's start in the plan, from the sprite's clip lengths; pauses for the punctuation.
// clips: { id: [startInSprite, dur] }. Returns { items: [{ id, at, dur, off, token }], dur, chars: [char offset per token] }
export function planTokens(tokens, clips, R = RADIO) {
  const items = [];
  let at = R.leadS, chars = 0;
  const charAt = [];
  tokens.forEach((tk, i) => {
    if (tk.pause) { at += R.pauseS[tk.pause] ?? 0.3; charAt.push(chars); chars += 1; return; }
    charAt.push(chars); chars += 1 + (tk.show ?? tk.say ?? '').length;
    const c = clips?.[tk.id];
    const dur = c ? c[1] : Math.max(0.25, 0.075 * (tk.say ?? '').length);   // no clip: the LCD still runs on an estimate
    items.push({ id: tk.id, at, dur, off: c ? c[0] : null, token: i });
    at += dur + R.gapS;
  });
  return { items, dur: at - R.gapS + R.tailS, charAt };
}

// The murmur's loudness over its length: syllables at 3.5–6 Hz, in two or three phrases (0..1 per sample)
export function chatterEnvelope(seed, durS, rate = 100, R = RADIO.chatter) {
  const r = rng(seed), n = Math.round(durS * rate), env = new Float32Array(n);
  let t = 0.05, k = 0;
  while (t < durS - 0.15) {
    const syl = 1 / (R.syllableHz[0] + (R.syllableHz[1] - R.syllableHz[0]) * r());
    const a = 0.45 + 0.55 * r();
    for (let i = Math.floor(t * rate); i < Math.min(n, Math.floor((t + syl) * rate)); i++) {
      const u = (i / rate - t) / syl; env[i] = Math.max(env[i], a * Math.sin(Math.PI * u) ** 1.5);
    }
    t += syl; k++;
    if (k % (5 + Math.floor(r() * 5)) === 0) t += 0.18 + 0.3 * r();   // a breath between phrases
  }
  return env;
}

export function createRadio({ audio = null, base = '/audio/vhf/', fetchFn = globalThis.fetch?.bind(globalThis), R = RADIO } = {}) {
  let ctx = null, out = null, voiceIn = null, hiss = null, sq = null, sprite = null, meta = null, playing = null, loading = null;
  const state = { playing: false, at: 0, token: -1, plan: null, chatter: false };
  const metaP = fetchFn ? fetchFn(`${base}forecast.json`).then((r) => r.json()).then((m) => (meta = m)).catch(() => null) : Promise.resolve(null);

  function build({ ctx: c, master }) {
    ctx = c;
    out = new GainNode(ctx, { gain: 1 }); out.connect(master);
    // the voice: band-pass, a presence lift, a soft clip (the transmitter's limiter), then the level
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: R.band[0], Q: 0.7 });
    const hp2 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: R.band[0], Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: R.band[1], Q: 0.7 });
    const lp2 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: R.band[1], Q: 0.7 });
    const pk = new BiquadFilterNode(ctx, { type: 'peaking', frequency: R.presence.hz, Q: 0.9, gain: R.presence.gainDb });
    const sh = new WaveShaperNode(ctx, { curve: (() => { const n = 1024, k = R.drive, a = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; a[i] = Math.tanh(k * x) / Math.tanh(k); } return a; })(), oversample: '2x' });
    voiceIn = new GainNode(ctx, { gain: 1 });
    const lvl = new GainNode(ctx, { gain: R.level });
    voiceIn.connect(hp).connect(hp2).connect(pk).connect(sh).connect(lp).connect(lp2).connect(lvl).connect(out);
    // the noise: one looping second of white noise through a band-pass, for the hiss and the squelch
    const nb = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    { const d = nb.getChannelData(0), r = rng(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
    const src = new AudioBufferSourceNode(ctx, { buffer: nb, loop: true });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.5 });
    hiss = new GainNode(ctx, { gain: 0 }); sq = new GainNode(ctx, { gain: 0 });
    src.connect(bp); bp.connect(hiss).connect(out); bp.connect(sq).connect(out);
    src.start();
  }
  audio?.attach?.(build);

  async function loadSprite() {
    if (sprite || !ctx) return sprite;
    if (!loading) loading = decodeFile(ctx, fetchFn, `${base}forecast.opus`).then((b) => (sprite = b)).catch(() => null);
    return loading;
  }

  // the carrier opens (a squelch burst, then the hiss) at t0, closes at t1 (the tail)
  function carrier(t0, t1) {
    const g = sq.gain, h = hiss.gain;
    g.cancelScheduledValues(t0); h.cancelScheduledValues(t0);
    g.setValueAtTime(0, t0); g.linearRampToValueAtTime(R.squelch, t0 + 0.01); g.setTargetAtTime(0, t0 + 0.02, 0.05);
    h.setValueAtTime(0, t0); h.linearRampToValueAtTime(R.hiss, t0 + 0.08);
    h.setValueAtTime(R.hiss, t1); h.linearRampToValueAtTime(0, t1 + 0.02);
    g.setValueAtTime(0, t1); g.linearRampToValueAtTime(R.squelch * 1.2, t1 + 0.012); g.setTargetAtTime(0, t1 + 0.03, 0.06);   // the tail
  }

  function plan(tokens) { return planTokens(tokens, meta?.clips, R); }

  async function play(p) {
    stop();
    state.plan = p; state.playing = true; state.at = 0; state.token = -1; state.chatter = false;
    playing = { p, t0: null, sources: [] };
    const mine = playing;
    if (!ctx) return;   // no sound yet (before a gesture): the LCD still runs on the plan's clock
    await loadSprite();
    if (playing !== mine) return;
    const t0 = ctx.currentTime + 0.05;
    mine.t0 = t0; mine.started = state.at;
    const skip = state.at;   // the LCD may have run a little while the sprite decoded: start where it is
    carrier(t0, t0 + Math.max(0.2, p.dur - skip - R.tailS));
    if (!sprite) return;
    for (const it of p.items) {
      if (it.off == null || it.at + it.dur < skip) continue;
      const s = new AudioBufferSourceNode(ctx, { buffer: sprite });
      s.connect(voiceIn);
      const when = t0 + Math.max(0, it.at - skip);
      s.start(when, it.off + Math.max(0, skip - it.at), it.dur - Math.max(0, skip - it.at));
      mine.sources.push(s);
    }
  }

  function stop() {
    if (!playing) return;
    for (const s of playing.sources) { try { s.stop(); } catch { /* not started */ } }
    if (ctx && state.playing) { const t = ctx.currentTime; carrier(t - 1e-3, t); }
    playing = null; state.playing = false; state.chatter = false; state.token = -1;
  }

  // a wordless call on 16: the murmur's envelope on band-passed noise through the same radio
  function chatter(seed = 1) {
    if (!ctx || state.playing) return false;
    const C = R.chatter, r = rng(seed * 31 + 5), dur = C.minS + (C.maxS - C.minS) * r();
    const env = chatterEnvelope(seed, dur);
    const t0 = ctx.currentTime + 0.05;
    const nb = new AudioBuffer({ length: Math.round(dur * ctx.sampleRate), sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    const d = nb.getChannelData(0), rr = rng(seed * 7 + 1), sr = ctx.sampleRate;
    // a voice-like buzz: a glottal pulse train (≈ 110–140 Hz, wandering) times noise, shaped by the envelope; the
    // band-pass and the radio's filters leave a murmur, no phonemes
    let ph = 0; const f0 = 110 + 30 * r();
    for (let i = 0; i < d.length; i++) {
      const t = i / sr, e = env[Math.min(env.length - 1, Math.floor(t * 100))];
      ph += (f0 * (1 + 0.08 * Math.sin(2 * Math.PI * 0.7 * t))) / sr; ph -= Math.floor(ph);
      const pulse = Math.exp(-ph * 9);
      d[i] = e * (0.65 * pulse + 0.35 * (rr() * 2 - 1)) * 0.5;
    }
    const s = new AudioBufferSourceNode(ctx, { buffer: nb });
    const f1 = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 700 + 300 * r(), Q: 1.2 });
    const f2 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1500, Q: 0.5 });
    const g = new GainNode(ctx, { gain: C.level });
    s.connect(f1).connect(f2).connect(g).connect(voiceIn);
    s.start(t0);
    carrier(t0 - 0.12, t0 + dur);
    state.chatter = true;
    const until = t0 + dur + 0.4;
    playing = { p: null, t0, sources: [s], chatterUntil: until };
    return true;
  }

  function update(dt) {
    if (playing?.chatterUntil) { if (ctx.currentTime > playing.chatterUntil) { playing = null; state.chatter = false; } return state; }
    if (!state.playing || !state.plan) return state;
    const p = state.plan;
    state.at = playing?.t0 != null && ctx ? playing.started + Math.max(0, ctx.currentTime - playing.t0) : state.at + dt;
    let k = -1; for (const it of p.items) if (it.at <= state.at) k = it.token;
    state.token = k;
    if (state.at >= p.dur) { playing = null; state.playing = false; state.token = -1; }
    return state;
  }

  return { plan, play, stop, chatter, update, state, ready: metaP, get meta() { return meta; }, get ctx() { return ctx; } };
}
