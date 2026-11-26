// South Lake's runabouts and jet ski heard (the glass boat's outboards' way: living/tourBoat-sound.js, synthesised, no file): one
// voice that follows the nearest power boat within FAR_M. A runabout: a four-stroke outboard's low firing note rising with the throttle
// (two detuned saws through a low-pass) and the hull's slap and spray (band-passed noise); the jet ski: a higher, buzzier note and a
// hiss. On v2's page sound (engine/audio.js: made in the first gesture; a capture is silent); nothing plays beyond FAR_M.
//   const S = createPowerSound({ audio })   S.update(boats, eye) once a frame (boats: v2/living/powerTraffic.js live boats)
export const POWER_SOUND = Object.freeze({ gain: 0.3, near: 22, farM: 600,
  power: Object.freeze({ idleHz: 48, runHz: 112, lp: [240, 900], hissHz: 900 }), jetski: Object.freeze({ idleHz: 70, runHz: 190, lp: [500, 2200], hissHz: 1800 }) });

// the level by distance (m): full within a few metres, half at ≈ 22 m, faint at 300 m, none past farM
export const powerGain = (d, S = POWER_SOUND) => (d >= S.farM ? 0 : Math.min(1, 1 / (0.4 + d / S.near) ** 1.2) * (1 - d / S.farM));
// the voice's target: the nearest live boat and its level (pure: the tests)
export function nearestVoice(boats, eye, S = POWER_SOUND) {
  let best = null, bd = Infinity;
  for (const b of boats) { const d = Math.hypot(b.x - eye[0], b.z - eye[2]); if (d < bd) { bd = d; best = b; } }
  return best ? { boat: best, d: bd, gain: powerGain(bd, S) } : null;
}

export function createPowerSound({ audio } = {}) {
  let ctx = null, out = null, o1 = null, o2 = null, lp = null, hiss = null, hp = null, hG = null, started = false;
  audio?.ready?.then(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: 0 }); out.connect(master); });
  function start() {
    started = true;
    lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300, Q: 0.8 });
    o1 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 50 }); o2 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 50.6 });
    const eg = new GainNode(ctx, { gain: 0.5 });
    o1.connect(lp); o2.connect(lp); lp.connect(eg).connect(out);
    const n = ctx.sampleRate * 2, buf = new AudioBuffer({ length: n, sampleRate: ctx.sampleRate }), d = buf.getChannelData(0);
    let s = 24680; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
    hiss = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    hp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 0.7 });
    hG = new GainNode(ctx, { gain: 0 });
    hiss.connect(hp).connect(hG).connect(out);
    o1.start(); o2.start(); hiss.start();
  }
  return {
    update(boats, eye) {
      if (!ctx || !out || ctx.state === 'closed') return;
      const v = nearestVoice(boats ?? [], eye), g = v?.gain ?? 0;
      if (!started) { if (g <= 0) return; start(); }
      const now = ctx.currentTime;
      out.gain.setTargetAtTime(g * POWER_SOUND.gain, now, 0.25);
      if (!v) return;
      const P = POWER_SOUND[v.boat.kind] ?? POWER_SOUND.power, k = Math.min(1, v.boat.v / 13);
      const fq = P.idleHz + (P.runHz - P.idleHz) * k;
      o1.frequency.setTargetAtTime(fq, now, 0.4); o2.frequency.setTargetAtTime(fq * 1.012, now, 0.4);
      lp.frequency.setTargetAtTime(P.lp[0] + (P.lp[1] - P.lp[0]) * k, now, 0.4);
      hp.frequency.setTargetAtTime(P.hissHz, now, 0.5); hG.gain.setTargetAtTime(0.15 + 0.45 * k, now, 0.4);
    },
  };
}
