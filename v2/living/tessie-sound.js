// Tessie's sound, synthesised in code (M2 step 5; owner, 2026-11-17: no Freesound): a deep breath as her head
// clears the water (an exhale, then a softer inhale; lower and softer than a whale's blow), water running off her back as it
// rises, the splashes (the break, the tail's flick and slap, the breach and its fall) and the dive (a low swirl with
// bubbles). Spatial: the level by distance, the side by her bearing from the camera. Desktop only (Tessie is); on the page's
// sound (engine/audio.js: made in the first gesture; a capture is silent). The same voices render offline for a film
// (renderTessieSound: an OfflineAudioContext fed the sim's events).
//   const S = createTessieSound({ audio })    S.play(e, cam)   e: a sim event { type, x, z, s }; cam: { x, z, yaw }
//   voice(ctx, out, e, when, { gain, pan, seed })   one event's voice on any BaseAudioContext
import { mulberry32 } from '../../src/sim/core/rng.js';
import { TMIX, rushMix, worldLowpassHz, underK, ambienceMix, boatHums, nearestHull, surgeLevel, hullOf, createCueTracker } from '../audio/tessieMix.js';

const TSOUND = Object.freeze({ gain: 0.9, near: 40, minGap: { break: 0.45, under: 0.6 } });
// the level by distance (m): full near, half at about 40 m, faint at 300 m
export const tessieGain = (d) => Math.min(1, 1 / (0.3 + d / TSOUND.near));
// her side from the camera: −1 left … 1 right
export function tessiePan(e, cam) {
  if (!cam) return 0;
  const dx = e.x - cam.x, dz = e.z - cam.z, fx = Math.sin(cam.yaw ?? 0), fz = -Math.cos(cam.yaw ?? 0);
  return Math.max(-1, Math.min(1, Math.sin(Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz))));
}

const noiseCache = new WeakMap();
function noise(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0), r = mulberry32(977);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}
// a noise source through a chain of filters, under an envelope [t, level] (linear ramps), into out
function noiseVoice(ctx, out, when, filters, env, offset = 0) {
  const src = new AudioBufferSourceNode(ctx, { buffer: noise(ctx), loop: true });
  let node = src;
  for (const f of filters) { const bq = new BiquadFilterNode(ctx, { type: f.type, frequency: f.f, Q: f.q ?? 0.7 }); if (f.to) { bq.frequency.setValueAtTime(f.f, when); bq.frequency.exponentialRampToValueAtTime(f.to, when + f.over); } node.connect(bq); node = bq; }
  const g = new GainNode(ctx, { gain: 0 });
  g.gain.setValueAtTime(0, when);
  for (const [t, v] of env) g.gain.linearRampToValueAtTime(v, when + t);
  node.connect(g).connect(out);
  src.start(when, offset % 1.9); src.stop(when + env[env.length - 1][0] + 0.05);
  return g;
}
function tone(ctx, out, when, f0, f1, dur, level, type = 'sine') {
  const o = new OscillatorNode(ctx, { type, frequency: f0 });
  o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
  const g = new GainNode(ctx, { gain: 0 });
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(level, when + Math.min(0.01, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(out); o.start(when); o.stop(when + dur + 0.02);
}

// one event's voice: a short graph of nodes that frees itself
export function voice(ctx, out, e, when, { gain = 1, pan = 0, seed = 1 } = {}) {
  const r = mulberry32((Math.imul(seed | 0, 2654435761) ^ Math.round((e.x ?? 0) * 13 + (e.z ?? 0) * 7)) >>> 0);
  const bus = new GainNode(ctx, { gain });
  const p = new StereoPannerNode(ctx, { pan });
  bus.connect(p).connect(out);
  const s = e.s ?? 1;
  const splash = (size, at = 0) => {
    noiseVoice(ctx, bus, when + at, [{ type: 'lowpass', f: 3200, to: 700, over: 0.5 + 0.3 * size }], [[0.012, 0.55 * size], [0.25 + 0.25 * size, 0.18 * size], [0.7 + 0.5 * size, 0]], r() * 2);
    tone(ctx, bus, when + at, 85 + 30 * r(), 45, 0.25 + 0.15 * size, 0.35 * Math.min(1.5, size));
  };
  const running = (dur, level) => {
    // water running off her back: a trickling hiss, its level broken in little bursts, fading as it drains
    const g = noiseVoice(ctx, bus, when + 0.05, [{ type: 'highpass', f: 900 }, { type: 'bandpass', f: 2400, q: 0.6 }], [[0.15, level], [dur * 0.4, level * 0.7], [dur, 0]], r() * 2);
    const lfo = new OscillatorNode(ctx, { type: 'triangle', frequency: 7 + 5 * r() }), lg = new GainNode(ctx, { gain: level * 0.35 });
    lfo.connect(lg).connect(g.gain); lfo.start(when); lfo.stop(when + dur + 0.1);
  };
  switch (e.type) {
    case 'breath': {
      // the exhale: a deep breathy whoosh (two formants and a low body), then a softer inhale
      noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 380, q: 0.9, to: 560, over: 1.2 }, { type: 'lowpass', f: 1400 }], [[0.18, 0.75], [1.0, 0.6], [1.6, 0]], r() * 2);
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 150 }], [[0.2, 0.9], [1.1, 0.6], [1.7, 0]], r() * 2);
      noiseVoice(ctx, bus, when + 1.9, [{ type: 'bandpass', f: 820, q: 1.1, to: 640, over: 0.9 }], [[0.5, 0.32], [0.9, 0.2], [1.2, 0]], r() * 2);
      break;
    }
    case 'break': {
      // the burst coming up: the splash, a short bright pop of air and water, then the water running off her
      splash(0.45 * s); running(2.8, 0.22);
      noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 1200, q: 0.9, to: 2600, over: 0.14 }], [[0.01, 0.22], [0.15, 0]], r() * 2);
      tone(ctx, bus, when, 230, 110, 0.14, 0.16);
      break;
    }
    case 'under': {
      // the plunge going under: the splash, a low gulp as the water closes, and a handful of bubbles
      splash(0.3 * s);
      noiseVoice(ctx, bus, when + 0.04, [{ type: 'lowpass', f: 420, to: 160, over: 0.5 }], [[0.1, 0.32], [0.3, 0.2], [0.6, 0]], r() * 2);
      tone(ctx, bus, when + 0.02, 150, 70, 0.22, 0.18);
      for (let i = 0; i < 6; i++) { const at = 0.08 + 0.5 * r(), f = 300 + 500 * r(); tone(ctx, bus, when + at, f, f * 1.6, 0.03 + 0.03 * r(), 0.05 + 0.04 * r()); }
      break;
    }
    case 'dash': {
      // the whoosh when the dash fires: a rush of water that opens up and falls away, with a low push under it (calm: no sting)
      noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 260, q: 0.8, to: 1700, over: 0.4 }, { type: 'lowpass', f: 2600 }], [[0.07, 0.38], [0.35, 0.26], [0.95, 0]], r() * 2);
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 200 }], [[0.1, 0.4], [0.5, 0.2], [1.0, 0]], r() * 2);
      break;
    }
    case 'ready': {
      // the cooldown is over: one soft water-drop tick (a short filtered click and a quiet low-mid note), nothing more
      tone(ctx, bus, when, 720, 690, 0.16, TMIX.ready.gain);
      noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 2800, q: 2 }], [[0.004, TMIX.ready.gain * 0.6], [0.03, 0]], r() * 2);
      break;
    }
    case 'windup': {
      // the bite's wind-up: the water swirling as she coils (a snap's is short, a rail bite's longer)
      const w = e.kind === 'rail' ? 1 : e.kind === 'dash' ? 0.8 : 0.6;
      noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 300, q: 1.1, to: 720, over: 0.45 * w }], [[0.2 * w, 0.3 * w], [0.45 * w, 0.18 * w], [0.7 * w, 0]], r() * 2);
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 190 }], [[0.25 * w, 0.3 * w], [0.7 * w, 0]], r() * 2);
      break;
    }
    case 'knock': {
      // the strike's contact with the hull: a knock (wood: hollow and low; fibreglass: a duller thock with a short ring; the rising strike:
      // a muffled boom from under), the water's thump, then the boat's creak and its sails flapping as it heels
      const m = hullOf(e.boat), k = Math.min(1.4, e.mult ?? 1), rise = e.where === 'bottom';
      if (rise) { tone(ctx, bus, when, 64, 34, 0.55, 0.45 * k); noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 240 }], [[0.02, 0.4 * k], [0.4, 0.15], [0.7, 0]], r() * 2); }
      else if (m === 'wood') { tone(ctx, bus, when, 170, 95, 0.22, 0.34 * k); tone(ctx, bus, when, 330, 300, 0.12, 0.1 * k); noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 700, q: 1.8 }], [[0.004, 0.25 * k], [0.08, 0]], r() * 2); }
      else { tone(ctx, bus, when, 230, 120, 0.2, 0.3 * k); tone(ctx, bus, when, 540, 500, 0.16, 0.07 * k); noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 1300, q: 1.2 }], [[0.004, 0.22 * k], [0.07, 0]], r() * 2); }
      tone(ctx, bus, when, 80, 45, 0.3, 0.3 * k);
      if (!rise && m !== 'shell') {
        // the creak: a slow squeak of the hull and rig under load, then the sails flapping as the boat heels
        const f0 = 170 + 40 * r();
        const c = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f0 }), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 620, Q: 3 }), cg = new GainNode(ctx, { gain: 0 });
        c.frequency.setValueAtTime(f0, when + 0.2); c.frequency.linearRampToValueAtTime(f0 * 1.3, when + 0.85);
        cg.gain.setValueAtTime(0, when + 0.2); cg.gain.linearRampToValueAtTime(0.06 * k, when + 0.4); cg.gain.linearRampToValueAtTime(0, when + 0.9);
        c.connect(bp).connect(cg).connect(bus); c.start(when + 0.2); c.stop(when + 0.95);
        for (let i = 0; i < 3; i++) noiseVoice(ctx, bus, when + 0.3 + 0.13 * i, [{ type: 'bandpass', f: 1100 + 500 * r(), q: 0.9 }], [[0.01, 0.16 * k * (1 - 0.25 * i)], [0.12, 0]], r() * 2);
      }
      break;
    }
    case 'creak': {
      // a hull overhead, under the water: a soft slap and a short creak
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 600 }], [[0.01, 0.2], [0.14, 0]], r() * 2);
      const f0 = 150 + 50 * r(), c = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f0 }), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 520, Q: 3 }), cg = new GainNode(ctx, { gain: 0 });
      c.frequency.setValueAtTime(f0, when + 0.05); c.frequency.linearRampToValueAtTime(f0 * 1.25, when + 0.6);
      cg.gain.setValueAtTime(0, when + 0.05); cg.gain.linearRampToValueAtTime(0.05, when + 0.25); cg.gain.linearRampToValueAtTime(0, when + 0.65);
      c.connect(bp).connect(cg).connect(bus); c.start(when + 0.05); c.stop(when + 0.7);
      break;
    }
    case 'lock': {
      // the lock-on, a very subtle cue: one low throat note, 0.2 s, about -18 dB
      tone(ctx, bus, when, 78, 58, 0.2, TMIX.lock.gain);
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 170 }], [[0.04, TMIX.lock.gain * 0.8], [0.2, 0]], r() * 2);
      break;
    }
    case 'riseStart': {
      // the rising strike begins: the water gathers below (the surge layer swells under it)
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 140, to: 320, over: 1.2 }], [[0.5, 0.2], [1.2, 0.1], [1.6, 0]], r() * 2);
      break;
    }
    case 'lure': {
      // the Lure (the RPG): a school slapping at the surface (small bright splashes, scattered over 1.6 s) and a shimmer over them
      for (let i = 0; i < 7; i++) { const at = 0.05 + 1.6 * (i / 7) + 0.12 * r(); noiseVoice(ctx, bus, when + at, [{ type: 'bandpass', f: 1800 + 1400 * r(), q: 1.4 }], [[0.004, 0.16 + 0.08 * r()], [0.06, 0.05], [0.14, 0]], r() * 2); tone(ctx, bus, when + at, 520 + 260 * r(), 300, 0.05, 0.05); }
      noiseVoice(ctx, bus, when, [{ type: 'highpass', f: 3500 }, { type: 'bandpass', f: 6000, q: 0.7 }], [[0.3, 0.05], [1.4, 0.04], [2.0, 0]], r() * 2);
      break;
    }
    case 'ping': {
      // the Sonar (the RPG): one low ping (the lock note's family, longer), then a faint echo per boat, later and softer by distance
      tone(ctx, bus, when, 196, 188, 0.9, 0.22);
      tone(ctx, bus, when, 392, 380, 0.5, 0.05);
      for (const d of e.echoes ?? []) { const at = 0.35 + d / 700; tone(ctx, bus, when + at, 190, 184, 0.35, 0.07 * Math.min(1, 120 / Math.max(60, d))); }
      break;
    }
    case 'surge': {
      // the Tail Surge (the RPG): the wave's hiss running out from her slap (the slap itself is her own 'slap' event), a low swell under it
      noiseVoice(ctx, bus, when, [{ type: 'bandpass', f: 900, q: 0.8, to: 2400, over: 1.6 }], [[0.15, 0.14], [1.0, 0.1], [2.1, 0]], r() * 2);
      noiseVoice(ctx, bus, when, [{ type: 'lowpass', f: 160 }], [[0.1, 0.22], [0.8, 0.08], [1.5, 0]], r() * 2);
      break;
    }
    case 'flick': splash(0.35); break;
    case 'slap': splash(1.3); break;
    case 'breach': splash(1.0); running(3.5, 0.3); break;
    case 'fall': splash(2.0); splash(0.8, 0.18); break;
    case 'dive': {
      splash(0.7);
      // the swirl: a low swell of water closing over her, and bubbles rising
      noiseVoice(ctx, bus, when + 0.2, [{ type: 'lowpass', f: 320, to: 180, over: 1.6 }], [[0.5, 0.5], [1.2, 0.35], [2.0, 0]], r() * 2);
      for (let i = 0; i < 12; i++) { const at = 0.4 + 1.6 * r(), f = 280 + 600 * r(); tone(ctx, bus, when + at, f, f * 1.7, 0.035 + 0.03 * r(), 0.08 + 0.06 * r()); }
      break;
    }
    default: break;
  }
  return bus;
}

// TK, the revenge's drone ("a low drone rises"; no sting, no jump-scare): two low detuned tones (55 and
// 55.7 Hz, a slow beat), their octave and a fifth softer, and a dark rumble of noise, all under a lowpass; one graph made at
// the first use and kept (a few nodes), its level set each frame (0 … 1), stopped when it has been silent for DRONE.idleS.
const DRONE = Object.freeze({ gain: 0.32, f: [55, 55.7, 110.4, 82.6], mix: [1, 1, 0.35, 0.22], noise: 0.5, lowpass: 420, idleS: 4 });
function droneGraph(ctx, out) {
  const g = new GainNode(ctx, { gain: 0 }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: DRONE.lowpass, Q: 0.5 });
  lp.connect(g).connect(out);
  const srcs = DRONE.f.map((f, i) => { const o = new OscillatorNode(ctx, { type: i < 2 ? 'sawtooth' : 'sine', frequency: f }), og = new GainNode(ctx, { gain: 0.25 * DRONE.mix[i] }); o.connect(og).connect(lp); return o; });
  const n = new AudioBufferSourceNode(ctx, { buffer: noise(ctx), loop: true }), nf = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 140, Q: 0.7 }), ng = new GainNode(ctx, { gain: DRONE.noise });
  n.connect(nf).connect(ng).connect(lp); srcs.push(n);
  for (const s of srcs) s.start();
  return { gain: g, stop() { for (const s of srcs) try { s.stop(); } catch { /* */ } g.disconnect(); } };
}

// the sound's long layers, built at the first play and stopped when she is given back: her rush (and its stroke's swell), the water's rumble and
// wash, the reverb they share (a 5 s decaying-noise impulse), the bubbles' bus, three engine voices, the surge. Returns the nodes and every source.
function impulse(ctx, secs = 5) {
  const n = Math.round(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate), r = mulberry32(4242);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.exp(-3.2 * i / n) * (1 - Math.exp(-i / 800)); }
  return b;
}
function buildLayers(ctx, out, noiseOf) {
  const sources = [], nb = noiseOf(ctx);
  const loop = (off = 0) => { const n = new AudioBufferSourceNode(ctx, { buffer: nb, loop: true }); sources.push(n); n.start(0, off); return n; };
  // the reverb: only the water's layers send to it
  const send = new GainNode(ctx, { gain: 0 }), conv = new ConvolverNode(ctx, { buffer: impulse(ctx) }), wet = new GainNode(ctx, { gain: 0.8 });
  send.connect(conv).connect(wet).connect(out);
  const dry = new GainNode(ctx, { gain: 1 }); dry.connect(out); dry.connect(send);
  // the rush: a low-passed noise through her gain, plus the same noise swelling at her stroke's rate
  const rush = { bp: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 420, Q: 0.6 }), g: new GainNode(ctx, { gain: 0 }) };
  loop(0.3).connect(rush.bp).connect(rush.g).connect(out);
  const pulse = new OscillatorNode(ctx, { type: 'sine', frequency: 0.8 }), pulseG = new GainNode(ctx, { gain: 0 });
  pulse.connect(pulseG).connect(rush.g.gain); pulse.start(); sources.push(pulse);
  // the water: a brown-noise rumble (low-pass 150 Hz) and a band-passed wash
  const rumble = new GainNode(ctx, { gain: 0 }), rl = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150, Q: 0.5 });
  loop(0.7).connect(rl).connect(rumble).connect(dry);
  const washBp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 0.7 }), wash = new GainNode(ctx, { gain: 0 });
  loop(1.1).connect(washBp).connect(wash).connect(dry);
  // the surge from below
  const surge = { lp: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 120, Q: 0.7 }), g: new GainNode(ctx, { gain: 0 }) };
  loop(1.5).connect(surge.lp).connect(surge.g).connect(out);
  // the engines: two detuned saws through a low-pass, a propeller's blade rate as a tremolo, panned
  const hums = [0, 1, 2].map(() => {
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260, Q: 0.7 }), g = new GainNode(ctx, { gain: 0 }), pan = new StereoPannerNode(ctx, { pan: 0 }), am = new GainNode(ctx, { gain: 0.7 });
    const o1 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 41 }), o2 = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 41.5 });
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 8 }), lg = new GainNode(ctx, { gain: 0.3 });
    o1.connect(lp); o2.connect(lp); lp.connect(am).connect(g).connect(pan).connect(dry);
    lfo.connect(lg).connect(am.gain);
    for (const o of [o1, o2, lfo]) { o.start(); sources.push(o); }
    return { o1, o2, lfo, g, pan };
  });
  return { rush, pulse, pulseG, rumble, wash, washBp, send, surge, hums, bubbleBus: dry, sources };
}

export function createTessieSound({ audio, seed = 1, settings = null } = {}) {
  let ctx = null, out = null;
  const last = {};
  // her own door under the page's master (the sound switch and M mute the master) and under Setup's effects switch
  audio?.ready?.then(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: settings?.get?.('effects') === false ? 0 : TSOUND.gain }); out.connect(master); });
  settings?.on?.((k, v) => { if (k === 'effects' && out) out.gain.setTargetAtTime(v === false ? 0 : TSOUND.gain, ctx.currentTime, 0.05); });
  const stats = { played: 0, skipped: 0, drone: 0 };
  let dr = null, quietS = 0, lastLevel = 0, under = null, L = null, bubbleAcc = 0, creakAt = 0;
  const tracker = createCueTracker(), br = mulberry32(seed * 7919 + 13);
  return {
    stats,
    // the revenge's drone at `level` (0 … 1) this frame; dt: the frame's real time (the idle stop)
    drone(level, dt = 1 / 60) {
      if (!ctx || ctx.state === 'closed' || !out) return false;
      level = Math.max(0, Math.min(1, level || 0));
      if (level < 0.002) { if (dr) { quietS += dt; if (lastLevel >= 0.002) dr.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1); if (quietS > DRONE.idleS) { dr.stop(); dr = null; } } lastLevel = level; stats.drone = 0; return true; }
      quietS = 0; dr ??= droneGraph(ctx, out);
      if (Math.abs(level - lastLevel) > 0.004) dr.gain.gain.setTargetAtTime(DRONE.gain * level, ctx.currentTime, 0.08);
      lastLevel = level; stats.drone = +level.toFixed(3);
      return true;
    },
    // play as Tessie, her sound as she is played: every frame the player gives her state and this builds what is heard,
    // through v2/audio/tessieMix.js's mappings. f: { on, speedK (0 … 1 of her top), speed (m/s), nose (m), dash, eyeDepth (m under the surface, null: from the nose),
    // boats ({ id, kind, x, z, u, motoring, rpm }), her ({ x, z, psi }), cam ({ x, z, yaw }), dt (s), events (the controller's), knocks, skill ({ phase }), phase, bite,
    // lunge, lockId }. Off: everything fades and the nodes stop; the world's low-pass opens.
    played(f = {}) {
      if (!ctx || ctx.state === 'closed' || !out) return false;
      const now = ctx.currentTime, on = f.on !== false, dt = f.dt ?? 1 / 60;
      const depth = !on ? 0 : f.eyeDepth ?? (f.nose >= 2 ? f.nose : 0), uk = on ? underK(depth) : 0;
      if (on && !L) L = buildLayers(ctx, out, noise);
      if (on && !under && audio?.master) {
        // the low-pass after the master (every bed, the music and her own sound under it); opened back at 20 kHz when not under
        try { const m = audio.master, lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 }); m.disconnect(); m.connect(lp).connect(ctx.destination); under = { lp, m }; } catch { under = null; }
      }
      const k = on ? Math.max(0, Math.min(1, f.speedK || 0)) : 0;
      const R = rushMix(k, { dash: !!f.dash, under: uk > 0.5, speed: f.speed ?? 0, nose: f.nose ?? 0 });
      const A = ambienceMix(depth);
      if (L) {
        L.rush.g.gain.setTargetAtTime(on ? R.gain : 0, now, 0.3); L.rush.bp.frequency.setTargetAtTime(R.hz, now, 0.3);
        L.pulse.frequency.setTargetAtTime(R.strokeHz, now, 0.3); L.pulseG.gain.setTargetAtTime(on ? R.gain * R.pulse : 0, now, 0.3);   // the stroke's swell: her gait's rate
        L.rumble.gain.setTargetAtTime(A.rumble, now, 0.3); L.wash.gain.setTargetAtTime(A.wash, now, 0.3); L.washBp.frequency.setTargetAtTime(A.washHz, now, 0.3);
        L.send.gain.setTargetAtTime(A.reverb / Math.max(0.01, TMIX.ambience.reverb) * 0.5, now, 0.3);
        const sg = on ? surgeLevel(f.lunge) : 0;
        L.surge.g.gain.setTargetAtTime(TMIX.surge.gain * sg * sg, now, 0.25); L.surge.lp.frequency.setTargetAtTime(120 + 260 * sg, now, 0.25);
        stats.surge = +sg.toFixed(2);
      }
      // the world's low-pass: the eye's depth (800 Hz just under, 350 Hz at 20 m), eased
      const hz = !on ? 20000 : worldLowpassHz(depth);
      if (under) under.lp.frequency.setTargetAtTime(hz, now, 0.8 / 3);
      stats.under = Math.round(hz); stats.rush = +k.toFixed(2); stats.rushGain = +R.gain.toFixed(3); stats.depth = +depth.toFixed(2);
      if (on && L) {
        // bubbles, at a rate that follows how deep she is; a pooled one-shot each (a short tone), no node held
        bubbleAcc += A.bubbles * dt;
        let n = 0; while (bubbleAcc >= 1 && n < 3) { bubbleAcc -= 1; n++; const fq = 260 + 520 * br(); tone(ctx, L.bubbleBus, now + 0.01, fq, fq * 1.6, 0.04 + 0.03 * br(), 0.06 + 0.04 * br()); }
        if (bubbleAcc > 3) bubbleAcc = 0;
        // distant engines and propellers heard under the water: up to three pooled voices, panned by bearing
        const hums = uk > 0.15 ? boatHums(f.boats, f.her, uk) : [];
        for (let i = 0; i < L.hums.length; i++) {
          const h = hums[i], v = L.hums[i];
          if (h) { v.o1.frequency.setTargetAtTime(h.hz, now, 0.5); v.o2.frequency.setTargetAtTime(h.hz * 1.013, now, 0.5); v.lfo.frequency.setTargetAtTime(h.blade, now, 0.5); v.pan.pan.setTargetAtTime(h.pan, now, 0.2); v.g.gain.setTargetAtTime(h.gain, now, 0.4); }
          else v.g.gain.setTargetAtTime(0, now, 0.4);
        }
        stats.hums = hums.length;
        // a hull overhead: a soft slap and creak now and then
        const hull = uk > 0.3 ? nearestHull(f.boats, f.her) : null;
        if (hull && now >= creakAt) { creakAt = now + 3.5 + 3 * br(); this.play({ type: 'creak', x: hull.x, z: hull.z, s: 1 }, f.cam); }
      }
      // the one-shots, each once (the tracker keeps the edges)
      if (on) {
        for (const c of tracker.step({ ...f, t: now })) {
          if (c.type === 'knock' || c.type === 'miss') { if (c.type === 'knock') voice(ctx, out, { ...c, type: 'knock' }, now + 0.02, { gain: tessieGain(f.cam && c.x != null ? Math.hypot(c.x - f.cam.x, c.z - f.cam.z) : 20), pan: tessiePan(c, f.cam), seed }); }
          else voice(ctx, out, c, now + 0.02, { gain: 1, pan: 0, seed });
          stats.cues = (stats.cues ?? 0) + 1; stats.lastCue = c.type;
        }
      } else tracker.reset();
      if (!on && L && k === 0) { const l = L; L = null; setTimeout(() => { for (const s of l.sources) try { s.stop(); } catch { /* */ } try { l.send.disconnect(); } catch { /* */ } }, 1500); }
      return true;
    },
    // the old entry: the rush and the low-pass from her nose's depth alone
    swim(speedK, noseM, on = true) { return this.played({ on, speedK, nose: noseM, eyeDepth: null }); },
    play(e, cam) {
      if (!ctx || ctx.state === 'closed' || !out) return false;
      const gap = TSOUND.minGap[e.type];
      if (gap && ctx.currentTime - (last[e.type] ?? -1e9) < gap) { stats.skipped++; return false; }
      last[e.type] = ctx.currentTime;
      const d = cam ? Math.hypot(e.x - cam.x, e.z - cam.z) : 40;
      voice(ctx, out, e, ctx.currentTime + 0.02, { gain: tessieGain(d), pan: tessiePan(e, cam), seed });
      stats.played++;
      return true;
    },
  };
}

// a film's sound: the events (with { t: s from the clip's start, cam }) rendered offline → { channels: [L, R], sampleRate };
// drone: the revenge's drone level per frame ([{ t, level }], TK), as the page sets it
export async function renderTessieSound({ events, seconds, sampleRate = 48000, seed = 1, drone = null, Ctx = globalThis.OfflineAudioContext }) {
  const ctx = new Ctx({ numberOfChannels: 2, length: Math.ceil(seconds * sampleRate), sampleRate });
  const out = new GainNode(ctx, { gain: TSOUND.gain }); out.connect(ctx.destination);
  if (drone?.some((d) => d.level > 0.002)) {
    const dr = droneGraph(ctx, out);
    let last = -1;
    for (const d of drone) { const l = Math.max(0, Math.min(1, d.level)); if (Math.abs(l - last) > 0.004) { dr.gain.gain.setTargetAtTime(DRONE.gain * l, Math.max(0, d.t), 0.08); last = l; } }
  }
  const last = {};
  for (const e of events) {
    const gap = TSOUND.minGap[e.type];
    if (gap && e.t - (last[e.type] ?? -1e9) < gap) continue;
    last[e.type] = e.t;
    const d = e.cam ? Math.hypot(e.x - e.cam.x, e.z - e.cam.z) : 40;
    voice(ctx, out, e, Math.max(0, e.t), { gain: tessieGain(d), pan: tessiePan(e, e.cam), seed });
  }
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate };
}
