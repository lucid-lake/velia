// The controls' sounds (owner, 2026-10-29: "sound effects when operating the boat"): diegetic, under the ambience,
// never game-y. They join src/audio.js's context and master (audio.attach) like the boat's own sound.
//
//   W  the winch: one pawl click per CLICK_DEG of sheet coming in (12°/s → 8 clicks a second; the winch slows under
//      load, feel.js, so at 4.7°/s ≈ 3 a second), firmer and lower under load, and the sheet creaking on the drum
//      when the sails are loaded (at most one per 3 s), deeper as the load rises;
//   S  the sheet running out through the block: a rope-on-sheave loop while it runs, its level and speed following
//      the ease rate, cut with a 0.08 s tail, so the sound is exactly as long as the ease;
//   A/D the wheel's quiet creak as it turns (never two within 0.9 s) and the rudder's water, rising with the helm
//      angle and the boat's speed;
//   1–4 the wind changing: a whoosh in the rigging over the ≈ 25 s the new wind takes to blow in, rising (more wind)
//      or falling (less), its size by the step;
//   L  the logbook opening: one soft page turn;
//   a logbook find: one warm wood note (a struck bar: three partials, a felt mallet), rare by nature.
// A press is never silent: W and S each give one sound as the key goes down, even with the sheet at its stop, and the
// first turn of the wheel creaks. The one-shot files are decoded at page load (an OfflineAudioContext needs no
// gesture), so the key that starts the sound is heard; a missing file falls back to a synthesised stand-in.
//
// The core (SfxMix, WIND_CUE, woodNote) is plain JS, no Web Audio, no Math.random(): tests/sfx.test.mjs.
import { afterCard } from './ui/deferLoad.js';
import { rng } from './boatAudio.js';
import { decodeFile } from './audioFormat.js';
import { clamp01 } from './sim/core/math.js';

const DEG = Math.PI / 180;
import { smooth as smoothstep } from './sim/core/math.js';

export const CLICK_DEG = 1.5;                  // sheet travel per pawl click: 12°/s → 8 clicks/s
const SFX_FILES = ['winch_click', 'sheet_run', 'wheel_creak', 'page_turn'];
export const SLOTS = { winch_click: 0.25, wheel_creak: 1.5, page_turn: 0.5 };   // tools/boat_audio_pack.py slot_s
// levels at full drive, before the 0.8 master (the bank one-shots are at −20 dBFS, the loop at −26 dBFS RMS)
export const LEVEL = { click: 0.16, sheetCreak: 0.22, run: 0.35, wheel: 0.14, rudder: 0.35, wind: 0.8, page: 0.12, find: 0.07 };
export const WIND_CUE = { durS: 25, peakAt: 0.35 };
// The bottom (feat/grounding): synthesised in the page, no files (nothing to licence): a keel scrape (a band of
// noise: sand a soft, low hiss; rock a harsher, higher grind with a rough edge), a thud (a low body and a noise knock; rock adds a
// hard crack and a second, smaller hit), and the sounder's beep (a soft 1.76 kHz tick, amber; two tones, red).
const GROUND_SFX = {
  scrape: { sand: { hz: 620, q: 0.7, lp: 1800 }, rock: { hz: 1350, q: 1.6, lp: 4200 }, gain: 0.5 },
  thud: { sand: { hz: 62, decay: 0.22, noise: 420, gain: 0.5 }, rock: { hz: 88, decay: 0.16, noise: 900, gain: 0.7, crack: 2600 } },
  beep: { amber: { hz: [1760], gain: 0.05, durS: 0.07, gapS: 0 }, red: { hz: [1760, 1320], gain: 0.07, durS: 0.07, gapS: 0.09 } },
};
const thudGain = (v) => Math.min(1, Math.max(0.15, v / 3));   // impact speed (m/s) → loudness   // the whoosh spans the blow-in; its swell peaks a third of the way

// One frame of the controls' sounds. input: { pull (+1 W, −1 S, 0), sheet (rad or null), rudder (−1..1), steer (the
// player's hand on the helm, −1/0/+1), sog (m/s), load (0..1.5, the boat's sail force over 2 kN) }.
// Returns { events: [{ kind, … }], gains: { run, rudder }, rate: { run } }.
export class SfxMix {
  constructor({ seed = 1 } = {}) {
    this.r = rng(seed ^ 0x5f3c);
    this.lastT = null; this.lastSheet = null; this.acc = 0; this.lastPull = 0; this.lastSteer = 0;
    this.lastClickSlot = -1; this.lastCreak = -Infinity; this.lastWheel = -Infinity; this.lastRudder = 0; this.runLevel = 0;
  }
  step(t, { pull = 0, sheet = null, rudder = 0, steer = 0, sog = 0, load = 0 } = {}) {
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const ev = [], L = clamp01(load);
    const dSheet = sheet != null && this.lastSheet != null ? sheet - this.lastSheet : 0;
    this.lastSheet = sheet;
    // W: the winch. A press always gives one click (the pawl takes the drum), then one per CLICK_DEG of sheet in
    if (pull > 0 && this.lastPull <= 0) { ev.push(this.click(L, 1.1)); this.acc = 0; this.fresh = true; }
    if (dSheet < 0) {
      this.acc += -dSheet / DEG;
      while (this.acc >= CLICK_DEG) { this.acc -= CLICK_DEG; ev.push(this.click(L, 1)); }
      const draw = this.r(), fresh = this.fresh; this.fresh = false;   // the first turn of the drum on a press always creaks, if loaded
      if (L > 0.25 && t - this.lastCreak >= 3 && (fresh || draw < 1 - Math.exp(-0.8 * dt))) {
        // the creak deepens with the load (a loaded drum groans lower: −16 % of pitch at full load; feel.js)
        ev.push({ kind: 'sheetCreak', slot: Math.floor(this.r() * 4), gain: LEVEL.sheetCreak * (0.5 + 0.5 * L), rate: (0.97 + 0.06 * this.r()) * (1.06 - 0.22 * L) });
        this.lastCreak = t;
      }
    } else if (pull <= 0) this.acc = 0;
    // S: the sheet runs out. Its level follows the ease rate (25°/s full) and the load on it
    const easeRate = dSheet > 0 && dt > 0 ? dSheet / dt / DEG : 0;
    const runTarget = LEVEL.run * clamp01(easeRate / 25) * (0.45 + 0.55 * L);
    if (pull < 0 && this.lastPull >= 0) ev.push({ kind: 'easeStart', gain: LEVEL.run * (0.35 + 0.3 * L) });   // the first pull on the cleat, even at the stop
    this.runLevel = runTarget;
    this.lastPull = pull;
    // A/D: the wheel creaks as it turns (the first turn always), never two within 0.9 s
    const dRud = Math.abs(rudder - this.lastRudder); this.lastRudder = rudder;
    const turning = steer !== 0 && dt > 0 ? dRud / dt : 0;
    if (steer !== 0 && (this.lastSteer === 0 || (turning > 0.4 && this.r() < 1 - Math.exp(-1.2 * dt))) && t - this.lastWheel >= 0.9) {
      ev.push({ kind: 'wheel', slot: Math.floor(this.r() * 3), gain: LEVEL.wheel * (0.6 + 0.4 * clamp01(turning / 2)), rate: 0.92 + 0.16 * this.r() });
      this.lastWheel = t;
    }
    this.lastSteer = steer;
    const rudderGain = LEVEL.rudder * smoothstep(0.08, 0.9, Math.abs(rudder)) * smoothstep(0.5, 3.5, sog);
    return { events: ev, gains: { run: this.runLevel, rudder: rudderGain }, rate: { run: 0.85 + 0.3 * clamp01(easeRate / 25) } };
  }
  click(L, accent) {
    let slot = Math.floor(this.r() * 7);
    if (slot === this.lastClickSlot) slot = (slot + 1) % 7;
    this.lastClickSlot = slot;
    // firmer and a touch lower under load; ±4 % so a run of clicks is never a machine gun
    return { kind: 'click', slot, gain: LEVEL.click * accent * (0.55 + 0.45 * L) * (0.85 + 0.15 * this.r()), rate: (1.04 - 0.08 * L) * (0.96 + 0.08 * this.r()) };
  }
}

// The wind-change cue for a step from level a to b (1–4): null for no change. dir +1 rising, −1 falling; size 1–3.
export function windCue(a, b) {
  if (!(a >= 1 && b >= 1) || a === b) return null;
  const size = Math.abs(b - a), dir = Math.sign(b - a);
  return { kind: 'wind', dir, size, gain: LEVEL.wind * (0.55 + 0.15 * size), durS: WIND_CUE.durS,
    fromHz: dir > 0 ? 450 : 1800, toHz: dir > 0 ? 1800 + 300 * size : 380 };
}

// The find's wood note: a struck bar (a marimba's partial ratios 1 : 3.93 : 9.2) with felt mallet decays. Pure data
// for the engine and the tests: [{ hz, gain, decayS }], and the mallet's noise burst.
export function woodNote(hz = 392) {
  return { partials: [{ hz, gain: 1, decayS: 1.4 }, { hz: hz * 3.93, gain: 0.22, decayS: 0.35 }, { hz: hz * 9.2, gain: 0.05, decayS: 0.08 }], malletS: 0.012 };
}

// ---- the browser engine -------------------------------------------------------------------------------------------
// Either { audio } (src/audio.js) or { ctx, destination } (a demo, an OfflineAudioContext). boatBase: the boat's banks
// (the sheet creak reuses audio/boat/creak_sheet.opus). windUrl: the wind loop the whoosh is made from.
export function createSfx({ audio, ctx: ctx0, destination, base = '/audio/sfx/', boatBase = '/audio/boat/', windUrl = '/audio/wind_strong.opus', seed = 1, preload = true, fetchFn = globalThis.fetch?.bind(globalThis), tap = null } = {}) {
  const mixer = new SfxMix({ seed });
  let ctx = null, out = null, run = null, rud = null, mix = null;
  const bufs = {}, played = [];
  const urls = { ...Object.fromEntries(SFX_FILES.map((k) => [k, `${base}${k}.opus`])), creak_sheet: `${boatBase}creak_sheet.opus`, hull_chuckle: `${boatBase}hull_chuckle.opus`, wind: windUrl };

  // decode without a gesture: an OfflineAudioContext may decode at page load; an AudioBuffer plays in any context
  async function decodeAll(dc) {
    await Promise.all(Object.entries(urls).map(async ([k, u]) => {
      if (bufs[k]) return;
      try { bufs[k] = await decodeFile(dc, fetchFn, u); }
      catch (e) { played.push({ error: `${u}: ${e.message ?? e}` }); }
    }));
  }
  // a phone decodes them once the card is live (src/ui/deferLoad.js); a desktop at once, before any gesture, as before
  const early = preload && !ctx0 && globalThis.OfflineAudioContext && fetchFn ? afterCard().then(() => decodeAll(new OfflineAudioContext(1, 1, 48000))) : null;

  function noise(sec, s) {
    const r = rng(s), b = new AudioBuffer({ length: Math.round(sec * ctx.sampleRate), sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    return b;
  }

  let ready = null;
  function init(c, dest) {
    ctx = c;
    out = new GainNode(ctx, { gain: 1 }); out.connect(dest); if (tap) out.connect(tap);
    bufs.noise = noise(3, seed + 17);
    // the two continuous layers: the sheet running (its own loop, gated) and the rudder's water (the hull's chuckle,
    // band-passed low and narrow, so it reads as water at the stern, not a second bow)
    run = { g: new GainNode(ctx, { gain: 0 }), hp: new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300, Q: 0.6 }) };
    run.hp.connect(run.g).connect(out);
    rud = { g: new GainNode(ctx, { gain: 0 }), bp: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 520, Q: 1.4 }) };
    rud.bp.connect(rud.g).connect(out);
    ready = (async () => {
      if (early) await early; else await decodeAll(ctx);
      const loop = (buf, into, off = 0) => { if (!buf) return null; const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }); s.connect(into); s.start(0, off % buf.duration); return s; };
      run.src = loop(bufs.sheet_run, run.hp);
      rud.src = loop(bufs.hull_chuckle, rud.bp, 11.3);
    })();
    return ready;
  }
  if (ctx0) init(ctx0, destination ?? ctx0.destination);
  else audio?.attach?.(({ ctx: c, master }) => init(c, master));

  const G = (v) => new GainNode(ctx, { gain: v });
  function slot(file, i, gain, rate, at) {
    const buf = bufs[file], len = SLOTS[file] ?? 2;
    if (!buf) return false;
    const n = Math.max(1, Math.round(buf.duration / len));
    const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate ?? 1 });
    s.connect(G(gain)).connect(out);
    s.start(at, (i % n) * len, len);
    return true;
  }
  // stand-ins when a file is missing: a metal tick, a soft friction burst
  function tick(gain, at) {
    const s = new AudioBufferSourceNode(ctx, { buffer: bufs.noise }), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3400, Q: 6 }), e = G(0);
    e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(gain * 4, at + 0.001); e.gain.setTargetAtTime(0, at + 0.002, 0.012);
    s.connect(bp).connect(e).connect(out); s.start(at, 0.2, 0.1);
  }
  function fire(ev, at) {
    if (ev.kind === 'click') { if (!slot('winch_click', ev.slot, ev.gain, ev.rate, at)) tick(ev.gain, at); }
    else if (ev.kind === 'sheetCreak') slot('creak_sheet', ev.slot, ev.gain, ev.rate, at) || null;
    else if (ev.kind === 'wheel') slot('wheel_creak', ev.slot, ev.gain, ev.rate, at);
    else if (ev.kind === 'easeStart') {
      // a short run of rope, 0.18 s: the hand lifting the sheet off the cleat
      const buf = bufs.sheet_run;
      if (buf) { const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: 1.1 }), e = G(0); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(ev.gain, at + 0.02); e.gain.setTargetAtTime(0, at + 0.12, 0.05); s.connect(e).connect(run.hp); s.start(at, 2.3, 0.5); }
      else tick(ev.gain * 0.5, at);
    } else if (ev.kind === 'page') slot('page_turn', 0, LEVEL.page, 1, at);
    else if (ev.kind === 'wind') whoosh(ev, at);
    else if (ev.kind === 'thud') thud(ev, at);
    else if (ev.kind === 'beep') beep(ev, at);
    else if (ev.kind === 'find') note(ev, at);
  }
  // the bottom: a thud (the hull and keel stopping), the sounder's beep
  function thud(ev, at) {
    const T = GROUND_SFX.thud[ev.mat === 'rock' ? 'rock' : 'sand'], g = ev.gain * T.gain, e = G(0), o = new OscillatorNode(ctx, { frequency: T.hz * 1.6 });
    o.frequency.setValueAtTime(T.hz * 1.6, at); o.frequency.exponentialRampToValueAtTime(T.hz * 0.6, at + T.decay);
    e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(g, at + 0.006); e.gain.setTargetAtTime(0, at + 0.01, T.decay / 3);
    o.connect(e).connect(out); o.start(at); o.stop(at + T.decay * 3 + 0.1);
    const hit = (hz, q, g2, dly, dur, type = 'lowpass') => {
      const s2 = new AudioBufferSourceNode(ctx, { buffer: bufs.noise }), f = new BiquadFilterNode(ctx, { type, frequency: hz, Q: q }), e2 = G(0), t0 = at + dly;
      e2.gain.setValueAtTime(0, t0); e2.gain.linearRampToValueAtTime(g2, t0 + 0.002); e2.gain.setTargetAtTime(0, t0 + 0.004, dur / 3);
      s2.connect(f).connect(e2).connect(out); s2.start(t0, 0.3, dur * 2 + 0.05);
    };
    hit(T.noise, 0.7, g * 0.9, 0, T.decay * 0.8);
    if (T.crack) { hit(T.crack, 3, g * 0.45, 0, 0.05, 'bandpass'); hit(T.noise * 0.8, 0.7, g * 0.35, 0.11, 0.1); }
  }
  function beep(ev, at) {
    const B = GROUND_SFX.beep[ev.level === 'red' ? 'red' : 'amber'];
    B.hz.forEach((hz, i) => {
      const t0 = at + i * B.gapS, o = new OscillatorNode(ctx, { frequency: hz }), e = G(0);
      e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(B.gain * (ev.gain ?? 1), t0 + 0.008); e.gain.setValueAtTime(B.gain * (ev.gain ?? 1), t0 + B.durS * 0.6); e.gain.linearRampToValueAtTime(0, t0 + B.durS);
      o.connect(e).connect(out); o.start(t0); o.stop(t0 + B.durS + 0.05);
    });
  }
  // the keel on the bed: a loop of noise through a band, its level and colour following the grind (set each frame)
  let scr = null;
  function scrape(level, mat = 'sand') {
    if (!ctx || !bufs.noise) return;
    if (!scr) {
      const s2 = new AudioBufferSourceNode(ctx, { buffer: bufs.noise, loop: true }), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 620, Q: 0.7 }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1800 }), g = G(0);
      s2.connect(bp).connect(lp).connect(g).connect(out); s2.start();
      scr = { s: s2, bp, lp, g };
    }
    const C = GROUND_SFX.scrape[mat === 'rock' ? 'rock' : 'sand'], at = ctx.currentTime;
    scr.bp.frequency.setTargetAtTime(C.hz * (0.85 + 0.3 * level), at, 0.1); scr.bp.Q.setTargetAtTime(C.q, at, 0.1); scr.lp.frequency.setTargetAtTime(C.lp, at, 0.1);
    scr.g.gain.setTargetAtTime(level * GROUND_SFX.scrape.gain * 0.5, at, level > 0.01 ? 0.05 : 0.15);
  }
  // the wind changing: the wind loop through a band sweeping up (rising) or down (falling) over durS, a swell that
  // peaks a third of the way in and fades out by the end
  function whoosh(ev, at) {
    const buf = bufs.wind ?? bufs.noise;
    const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: ev.fromHz, Q: 0.9 }), e = G(0);
    const d = ev.durS, pk = at + d * WIND_CUE.peakAt;
    bp.frequency.setValueAtTime(ev.fromHz, at); bp.frequency.exponentialRampToValueAtTime(ev.toHz, at + d * 0.6);
    e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(ev.gain, pk); e.gain.setTargetAtTime(0, pk + 1, d * 0.18);
    s.connect(bp).connect(e).connect(out); s.start(at, (ev.size * 7.3) % buf.duration); s.stop(at + d + 2);
  }
  // the find: one struck wood bar, and an octave-and-a-fifth answer 0.42 s later, quieter (warm, not a chime)
  function note(ev, at) {
    for (const [hz, k, dt] of [[ev.hz ?? 392, 1, 0], [(ev.hz ?? 392) * 1.5, 0.55, 0.42]]) {
      const n = woodNote(hz), t0 = at + dt;
      for (const p of n.partials) {
        const o = new OscillatorNode(ctx, { frequency: p.hz }), e = G(0);
        e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(ev.gain * k * p.gain, t0 + 0.004); e.gain.setTargetAtTime(0, t0 + 0.006, p.decayS / 3);
        o.connect(e).connect(out); o.start(t0); o.stop(t0 + p.decayS * 2 + 0.1);
      }
      const s = new AudioBufferSourceNode(ctx, { buffer: bufs.noise }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1800 }), e = G(0);
      e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(ev.gain * k * 0.25, t0 + 0.001); e.gain.setTargetAtTime(0, t0 + 0.002, n.malletS / 2);
      s.connect(lp).connect(e).connect(out); s.start(t0, 1, 0.05);
    }
  }

  // Every frame (Sail's controls): t (s, any clock that runs with the audio), the input above. `at`: audio time.
  function update(t, input, at = ctx?.currentTime) {
    mix = mixer.step(t, input);
    if (!ctx) return mix;
    run.g.gain.setTargetAtTime(mix.gains.run, at, mix.gains.run > run.g.gain.value ? 0.03 : 0.08);
    run.src?.playbackRate.setTargetAtTime(mix.rate.run, at, 0.05);
    rud.g.gain.setTargetAtTime(mix.gains.rudder, at, 0.25);
    for (const ev of mix.events) { fire(ev, at); played.push({ t, kind: ev.kind }); }
    if (played.length > 200) played.splice(0, played.length - 200);
    return mix;
  }
  // one-off cues: cue('page'), cue('find'), cue('click') (a panel switch: the winch click, higher and quieter), cue('wind', { from, to })
  function cue(kind, o = {}, at = ctx?.currentTime) {
    const ev = kind === 'wind' ? windCue(o.from, o.to) : kind === 'click' ? { kind, slot: o.slot ?? 0, gain: o.gain ?? LEVEL.click * 0.7, rate: o.rate ?? 1.25 } : kind === 'find' ? { kind, gain: LEVEL.find, hz: o.hz ?? 392 } : kind === 'thud' ? { kind, gain: thudGain(o.v ?? 1.5), mat: o.mat ?? 'sand' } : kind === 'beep' ? { kind, level: o.level ?? 'amber', gain: o.gain ?? 1 } : { kind };
    if (!ev) return null;
    played.push({ t: mix?.t ?? null, kind });
    if (ctx) fire(ev, at);
    return ev;
  }
  return { update, cue, scrape, ready: () => ready ?? early, stats: () => ({ started: !!ctx, played: played.slice(-20) }), mixer };
}
