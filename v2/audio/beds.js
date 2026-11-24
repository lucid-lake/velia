// The beds' code half (v2 step 3; BACKLOG-v2 #7), after the owner's ear test (2026-11-13: the code hull, sails
// and rain "very poor, not like real"; the wind kept; "hybrid sound"): the wind in code, on one Web Audio graph built once, and
// the way out every bed shares. The hull and water, the sails, the load, the controls and the lake's lap and rain are v1's
// recordings on v1's own engines (v2/audio/recorded.js), fed into this graph's effects and ambience inputs.
//
//   const beds = createBeds(ctx, { destination });   // any BaseAudioContext: the page's, or an OfflineAudioContext (the WAV test)
//   beds.update(mix.step(input), at);                // every frame: the wind's targets at audio time `at`
//   beds.inputs.effects, beds.inputs.ambience        // where recorded.js plugs v1's boat and lake sound in
//   beds.sound(on); beds.effects(on); beds.fade(v)   // v1's Settings: sound (all) and effects (the boat); the hide fade
//
// Engine habits (Cold Smoke's): every wind voice runs from build to the end; parameters move only by
// setTargetAtTime; a 0.6 % dead band; a compressor and a soft ceiling (straight to 0.7, bending over under 1) on the way out,
// which v1's recorded sound passes through too.
//
// The wind (ambience, v1: on the master, "sound"): pink → HP 42 → shelf → LP·LP at 300 + 830·u^1.1 Hz → each ear's buffeting →
// the slow gust → panned by the apparent wind. The rig (boat bus): its rush above 1.4 kHz and the whistle, panned with it.
//
// The compressor and soft ceiling, the dead band, the always-running voices and the wind's chain are Cold Smoke's
// (https://github.com/huiskylabs/cold-smoke, commit eaf635c, src/18_sound.js), MIT, Copyright (c) 2026 Huisky; the full
// notice is in v2/audio/noise.js.
import { material } from './noise.js';

export const EFFECTS = 0.6;   // v1's effects bus level (src/audio.js BUS_LEVEL.effects)
// Each voice's make-up: at gain 1 every continuous voice reads about −26 dBFS RMS, the level v1's loops were cut to
// (tools/audio_pack.py, tools/boat_audio_pack.py), so v1's LEVEL tables give v1's mix. Measured by the offline render's
// calibration (node tools/v2-beds-render.mjs --calibrate, 48 kHz, at the mid settings listed there).
// The Web Audio compressor adds its own make-up gain (the spec's: + 4.4 dB at these settings, measured in Chrome against v1's
// recordings, 2026-11-13). A gain after it takes that back out, so v1's recordings play at v1's level; the wind's make-ups below
// carry the 4.4 dB themselves, so the wind sounds as the owner heard it.
export const COMP_MAKEUP_DB = 4.4;
const K = 10 ** (COMP_MAKEUP_DB / 20);
export const MAKEUP = {
  wind: 0.24 * K,
  // the rig's rush: ≈ −34 dBFS at gain 1, what is left of a −26 dBFS wind recording above v1's 1.4 kHz high-pass
  rig: 0.12 * K,
  // v1's synthesised whistle keeps v1's absolute level (two Q 28–34 bands × 14 ≈ −4 dBFS at gain 1)
  whistle: 22 * K,
};
const DEAD = 0.006;

export function createBeds(ctx, { destination = ctx.destination, materialSeed = 90210, level = 1 } = {}) {
  const sr = ctx.sampleRate;
  let nodes = 0;
  const count = (n) => { nodes++; return n; };
  const G = (v = 0) => { const g = count(ctx.createGain()); g.gain.value = v; return g; };
  const F = (type, f, Q = 0.707, dB = 0) => { const b = count(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = dB; return b; };
  const buf = (chs) => { const b = ctx.createBuffer(chs.length, chs[0].length, sr); chs.forEach((d, c) => b.getChannelData(c).set(d)); return b; };
  const loop = (b, rate = 1, off = 0) => { const s = count(ctx.createBufferSource()); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(0, off % b.duration); return s; };
  const pan = () => { const p = count(ctx.createStereoPanner()); return p; };
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
  const mono = (b, c) => { const sp = count(ctx.createChannelSplitter(2)), g = G(1); b.connect(sp); sp.connect(g, c); return g; };

  // ---- the material, once
  // (the whole material from its seed, as the owner heard it on 2026-11-13; the patter's two loops are drawn but unused)
  const M = material(sr, materialSeed);
  const B = { white: buf(M.white), pink: buf(M.pink), lfo: buf(M.lfo) };
  const lfoRate = (perS) => perS / sr;   // the curve's playback rate for `perS` curve samples a second

  // ---- the way out: ambience + boat → compressor → the fade → the soft ceiling → destination
  const amb = G(1), boatSw = G(EFFECTS), boat = G(0), dist = F('lowpass', 16000, 0.5), sum = G(level);
  chain(boat, dist, boatSw, sum); amb.connect(sum);
  const comp = count(ctx.createDynamicsCompressor());
  comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.16;
  const out = G(0), pre = G(1 / 1.6), ceil = count(ctx.createWaveShaper()), cv = new Float32Array(1025);
  for (let i = 0; i < 1025; i++) { const x = ((i - 512) / 512) * 1.6, a = Math.abs(x); cv[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.29 * Math.tanh((a - 0.7) / 0.29)); }
  ceil.curve = cv;
  const unMakeup = G(1 / K);
  chain(sum, comp, unMakeup, out, pre, ceil); ceil.connect(destination);

  // the shared sources: each noise is a loop at its own offset
  const pinkA = loop(B.pink, 1, 0.2), white = loop(B.white, 1, 0.4), whiteB = loop(B.white, 1, 1.9);
  const pinkA0 = mono(pinkA, 0), white0 = mono(white, 0), whiteB0 = mono(whiteB, 0);

  // ---- wind at the listener
  const wHP = F('highpass', 42, 0.7), wSh = F('highshelf', 230, 0.7, -7), wL1 = F('lowpass', 500, 0.6), wL2 = F('lowpass', 560, 1.0), wSp = count(ctx.createChannelSplitter(2)), wMg = count(ctx.createChannelMerger(2));
  const wEar = [G(1), G(1)], wLfo = loop(B.lfo, lfoRate(60)), wLs = count(ctx.createChannelSplitter(2)), wDep = [G(0.3), G(0.3)], wMk = G(MAKEUP.wind), wG = G(0), wPan = pan();
  chain(pinkA, wHP, wSh, wL1, wL2, wSp);
  wLfo.connect(wLs);
  for (let c = 0; c < 2; c++) { wSp.connect(wEar[c], c); wLs.connect(wDep[c], c); wDep[c].connect(wEar[c].gain); wEar[c].connect(wMg, 0, c); }
  chain(wMg, wMk, wG, wPan, amb);
  const wGust = loop(B.lfo, lfoRate(9), 1500 / sr), wGustM = mono(wGust, 0), wGd = G(0); chain(wGustM, wGd); wGd.connect(wG.gain);

  // ---- the wind in the rig: its rush above 1.4 kHz (v1: wind_strong through a high-pass) and the whistle (Cold Smoke's Q 18
  // band wandering 60 Hz, and v1's two narrow bands at the apparent wind's pitch), panned to the wind's side
  const rigHP = F('highpass', 1400, 0.6), rigPk = F('peaking', 2600, 1.2, 4), rigAM = G(1), rigD = G(0.3), rigMk = G(MAKEUP.rig), rigG = G(0), rigPan = pan();
  chain(pinkA0, rigHP, rigPk, rigAM, rigMk, rigG, rigPan, boat);
  const wLfoM = mono(wLfo, 0); chain(wLfoM, rigD); rigD.connect(rigAM.gain);
  const whBP = F('bandpass', 900, 18), whLfo = mono(loop(B.lfo, lfoRate(5), 700 / sr), 1), whD = G(60), whBP2 = F('bandpass', 1900, 28), whMk = G(MAKEUP.whistle), whistleG = G(0);
  chain(white0, whBP, whMk); chain(whiteB0, whBP2, whMk); chain(whLfo, whD); whD.connect(whBP.frequency); chain(whMk, whistleG, rigPan);

  // ---- parameters: the dead band
  const H = (p) => ({ p, v: NaN });
  const h = {
    wL1: H(wL1.frequency), wL2: H(wL2.frequency), wSh: H(wSh.gain), wG: H(wG.gain), wGd: H(wGd.gain), wD0: H(wDep[0].gain), wD1: H(wDep[1].gain), wRate: H(wLfo.playbackRate), wPan: H(wPan.pan),
    bus: H(boat.gain), dist: H(dist.frequency),
    rigG: H(rigG.gain), rigPan: H(rigPan.pan), whistleG: H(whistleG.gain), whBP: H(whBP.frequency), whBP2: H(whBP2.frequency),
  };

  let sets = 0;
  const set = (k, v, at, tau) => { const x = h[k]; if (!x.p || !Number.isFinite(v)) return; if (Math.abs(v - x.v) <= DEAD * Math.max(Math.abs(v), Math.abs(x.v), 0.02)) return; x.v = v; x.p.setTargetAtTime(v, at, tau); sets++; };
  // cancelAndHold keeps a value where it is, so a fade never jumps
  const hold = (p, t) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t); };

  // ---- every frame
  function update(m, at = ctx.currentTime) {
    const g = m.gains, z = m.hz, r = m.rate, pn = m.pan;
    set('wL1', z.wind, at, 0.05); set('wL2', z.wind * 1.12, at, 0.05); set('wSh', z.windShelfDb, at, 0.1);
    set('wG', g.wind, at, 0.25); set('wGd', 0.25 * g.wind, at, 0.4); set('wD0', r.buffetDepth, at, 0.2); set('wD1', r.buffetDepth, at, 0.2);
    set('wRate', r.buffet / sr, at, 0.2); set('wPan', pn.wind, at, 0.3);
    set('bus', g.bus, at, 0.3); set('dist', z.dist, at, 0.3);
    set('rigG', g.rig, at, 0.4); set('rigPan', pn.rig, at, 0.3); set('whistleG', g.whistle, at, 0.6); set('whBP', z.whistleCs, at, 0.4); set('whBP2', z.whistle, at, 0.8);
  }

  // ---- the switches and the fade (v1 Settings: sound mutes all, effects the boat; the page's hide)
  const sw = { sound: true, effects: true, fade: 0 };
  const applyOut = (at, tau) => { const p = out.gain; hold(p, at); p.setTargetAtTime(sw.sound ? sw.fade : 0, at, tau); };
  return {
    update,
    sound(on, at = ctx.currentTime) { sw.sound = !!on; applyOut(at, 0.05); },
    effects(on, at = ctx.currentTime) { sw.effects = !!on; const p = boatSw.gain; hold(p, at); p.setTargetAtTime(on ? EFFECTS : 0, at, 0.05); },
    fade(v, at = ctx.currentTime, tau = 0.25) { sw.fade = v; applyOut(at, tau); },
    get nodes() { return nodes; }, get sets() { return sets; },
    // v1's recorded sound goes in here: the boat's and the controls' (after v1's own bus and distance) into the effects switch,
    // the lake's loops into the ambience (both then through the compressor, the fade and the ceiling)
    inputs: { effects: boatSw, ambience: amb },
    taps: { amb, boat, out: ceil },
  };
}
