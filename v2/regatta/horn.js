// The committee boat's horn (v1's src/modes/regatta/extras.js createHorn, not exported there: v1 is frozen, so its few lines
// are here): an air horn is two detuned reeds through a horn bell, no asset; a long blast 1.3 s, a short one 0.22 s, louder
// near the committee boat. On v2's page sound (engine/audio.js: made in the first gesture; a capture is silent).
export function createHorn({ audio, at }) {
  let ctx = null, out = null;
  audio?.ready?.then(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: 0.5 }); out.connect(master); });
  return {
    play({ long = false } = {}, from = null) {
      if (!ctx || ctx.state === 'closed') return false;
      const d = from ? Math.hypot(from.x - at.x, from.z - at.z) : 40, g = Math.min(1, 1 / (0.25 + d / 120)), t0 = ctx.currentTime + 0.01, dur = long ? 1.3 : 0.22;
      const env = new GainNode(ctx, { gain: 0 }), bell = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 520, Q: 1.4 }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400 });
      env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.7 * g, t0 + 0.03); env.gain.setValueAtTime(0.7 * g, t0 + dur - 0.05); env.gain.linearRampToValueAtTime(0, t0 + dur);
      for (const f of [415, 523]) { const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f }); o.connect(bell); o.start(t0); o.stop(t0 + dur + 0.02); }
      bell.connect(lp).connect(env).connect(out);
      return true;
    },
  };
}

// The rounding's chime (owner 2026-11-17: the moment a mark counts must be unmistakable): two soft bell tones a fifth apart (sine
// partials, a fast attack, a 0.6 s ring), no asset; quiet beside the horn. On v2's page sound (a capture is silent).
export function createChime({ audio }) {
  let ctx = null, out = null;
  audio?.ready?.then(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: 0.22 }); out.connect(master); });
  return {
    play() {
      if (!ctx || ctx.state === 'closed') return false;
      const t0 = ctx.currentTime + 0.01;
      [[880, 0], [1320, 0.11]].forEach(([f, dt]) => {
        const env = new GainNode(ctx, { gain: 0 }), t = t0 + dt;
        env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.8, t + 0.008); env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        for (const [k, a] of [[1, 1], [2.76, 0.25]]) { const o = new OscillatorNode(ctx, { type: 'sine', frequency: f * k }), g = new GainNode(ctx, { gain: a }); o.connect(g).connect(env); o.start(t); o.stop(t + 0.62); }
        env.connect(out);
      });
      return true;
    },
  };
}
