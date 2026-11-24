// The glass boat's outboards: two four-stroke outboards at a slow tour pace, synthesised (no file): a low firing note
// (two detuned saws at the idle's ≈ 14 Hz firing rate × 3, through a low-pass) and the water's churn (noise, band-passed), louder and
// higher while she makes way, a soft idle at a stop. On v2's page sound (engine/audio.js: made in the first gesture; a capture is
// silent); nothing plays beyond FAR_M.
//   const S = createTourSound({ audio })   S.update(T, eye) once a frame (T: v2/sim/tourBoat.js)
const TOUR_SOUND = Object.freeze({ gain: 0.32, near: 18, farM: 450, idleHz: 41, runHz: 58, churnHz: 420 });

// the level by distance (m): full within a few metres, half at ≈ 18 m, faint at 200 m, none past farM
const engineGain = (d, S = TOUR_SOUND) => (d >= S.farM ? 0 : Math.min(1, 1 / (0.4 + d / S.near) ** 1.3) * (1 - d / S.farM));

export function createTourSound({ audio } = {}) {
  let ctx = null, out = null, o1 = null, o2 = null, lp = null, churn = null, chG = null, engG = null, started = false;
  audio?.ready?.then(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: 0 }); out.connect(master); });
  function start() {
    started = true;
    lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260, Q: 0.7 });
    engG = new GainNode(ctx, { gain: 0.5 });
    o1 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: TOUR_SOUND.idleHz }); o2 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: TOUR_SOUND.idleHz * 1.013 });
    o1.connect(lp); o2.connect(lp); lp.connect(engG).connect(out);
    // the churn: 2 s of seeded noise, looped (deterministic, no Math.random)
    const n = ctx.sampleRate * 2, buf = new AudioBuffer({ length: n, sampleRate: ctx.sampleRate }), d = buf.getChannelData(0);
    let s = 12345; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
    churn = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: TOUR_SOUND.churnHz, Q: 0.8 });
    chG = new GainNode(ctx, { gain: 0 });
    churn.connect(bp).connect(chG).connect(out);
    o1.start(); o2.start(); churn.start();
  }
  return {
    update(T, eye) {
      if (!ctx || !out || ctx.state === 'closed') return;
      const b = T.boat, d = Math.hypot(b.x - eye[0], b.z - eye[2]), g = T.active ? engineGain(d) : 0;
      if (!started) { if (g <= 0) return; start(); }
      const k = Math.min(1, b.v / 2.06), now = ctx.currentTime;
      out.gain.setTargetAtTime(g * TOUR_SOUND.gain, now, 0.3);
      const f = TOUR_SOUND.idleHz + (TOUR_SOUND.runHz - TOUR_SOUND.idleHz) * k;
      o1.frequency.setTargetAtTime(f, now, 0.6); o2.frequency.setTargetAtTime(f * 1.013, now, 0.6);
      lp.frequency.setTargetAtTime(220 + 260 * k, now, 0.6);
      engG.gain.setTargetAtTime(0.35 + 0.45 * k, now, 0.5);
      chG.gain.setTargetAtTime(0.5 * k, now, 0.5);
    },
  };
}
