// Two songs at once (owner, 2026-11-06): the music bus has one owner (src/audio.js claimMusic). Sail's beds, Cruise's
// playlist (src/modes/chill/music.js) and Regatta's score (src/modes/regatta/raceMusic.js) run on a fake audio context
// whose gains follow their automation and whose sources end on their stop time; the decoding takes fake time too. The
// mode switches are driven the way the modes do them (src/modes/chill/index.js, src/modes/regatta/extras.js,
// src/modes/daysail/index.js). Each sequence samples which pieces of audio/music/ are audible (gain > 0.01) every 50 ms
// and asserts that two are never audible together for longer than the bus's crossfade (MUSIC_XFADE_S).
// The same sequences in a real browser: tests/pages/doubleMusic.page.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, MUSIC_XFADE_S } from '../src/audio.js';
import { SAIL_BEDS } from '../src/core/sailMusic.js';
import { createMusic } from '../src/modes/chill/music.js';
import { createRaceMusic } from '../classic/src/modes/regatta/raceMusic.js';

const DT = 0.05, DECODE_S = 0.6, PIECE_S = 150;

// ---- a fake Web Audio with a clock -------------------------------------------------------------------------------
function fakeWorld() {
  const W = { now: 0, timers: [], srcs: [] };
  class Param {
    constructor(v = 0) { this.v0 = v; this.ev = []; }
    get value() { return this.at(W.now); }
    set value(v) { this.v0 = v; this.ev = []; }
    setValueAtTime(v, t) { this.ev.push({ k: 'set', v, t }); return this; }
    linearRampToValueAtTime(v, t) { this.ev.push({ k: 'lin', v, t }); return this; }
    setTargetAtTime(v, t, tc) { this.ev.push({ k: 'tgt', v, t, tc }); return this; }
    cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); return this; }
    at(T) {
      let v = this.v0, pt = 0, tgt = null;
      for (const e of this.ev) {
        if (tgt) { const end = Math.min(e.t, T); v = tgt.v + (v - tgt.v) * Math.exp(-(end - tgt.t) / tgt.tc); tgt = null; if (e.t > T) return v; pt = e.t; }
        if (e.t > T) return e.k === 'lin' && e.t > pt ? v + (e.v - v) * (T - pt) / (e.t - pt) : v;
        if (e.k === 'tgt') { tgt = { v: e.v, t: e.t, tc: e.tc }; pt = e.t; continue; }
        v = e.v; pt = e.t;
      }
      if (tgt) v = tgt.v + (v - tgt.v) * Math.exp(-(T - tgt.t) / tgt.tc);
      return v;
    }
  }
  class Node { constructor(_c, o = {}) { this.gain = new Param(o.gain ?? 1); this.frequency = new Param(o.frequency ?? 0); this.Q = new Param(o.Q ?? 1); } connect(d) { return d; } disconnect() {} }
  class Src extends Node {
    constructor(_c, o = {}) { super(_c, o); this.buffer = o.buffer; this.loop = false; this.out = null; this.t0 = null; this.tEnd = Infinity; this.onended = null; this.done = false; W.srcs.push(this); }
    connect(d) { if (!this.out && d instanceof Gain) this.out = d; return d; }
    start(when = 0, offset = 0) { this.t0 = Math.max(when, W.now); if (!this.loop && this.buffer) this.tEnd = Math.min(this.tEnd, this.t0 + this.buffer.duration - offset); }
    stop(when = 0) { if (this.t0 == null) throw new Error('stop before start'); this.tEnd = Math.min(this.tEnd, Math.max(when, W.now)); }
  }
  class Gain extends Node {}
  class Osc extends Src {}
  class Ctx {
    constructor() { this.state = 'running'; this.destination = new Node(); }
    get currentTime() { return W.now; }
    async resume() {} addEventListener() {}
    decodeAudioData(ab) { return new Promise((res) => W.timers.push({ at: W.now + DECODE_S, fn: () => res({ duration: ab.url.includes('/music/') ? PIECE_S : 30, url: ab.url, numberOfChannels: 2 }) })); }
  }
  const fetchFn = async (url) => ({ ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(8), { url }) });
  const setTimer = (fn, ms) => { W.timers.push({ at: W.now + (ms ?? 0) / 1000, fn }); return W.timers.length; };
  const g = globalThis, keep = { GainNode: g.GainNode, AudioBufferSourceNode: g.AudioBufferSourceNode, BiquadFilterNode: g.BiquadFilterNode, OscillatorNode: g.OscillatorNode };
  Object.assign(g, { GainNode: Gain, AudioBufferSourceNode: Src, BiquadFilterNode: Node, OscillatorNode: Osc });
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  // the music pieces audible now: their own gain above 0.01
  const audible = () => W.srcs.filter((s) => s.buffer?.url?.includes('/audio/music/') && s.t0 != null && W.now >= s.t0 && W.now < s.tEnd && s.out && s.out.gain.at(W.now) > 0.01).map((s) => `${s.buffer.url.split('/').pop()}#${W.srcs.indexOf(s)}`);
  return { W, Ctx, fetchFn, setTimer, flush, audible, restore: () => Object.assign(g, keep) };
}

// ---- the page, reduced to its music: the core's audio, the modes' players, a frame loop ----------------------------
async function lake() {
  const F = fakeWorld();
  const audio = createAudio({ Ctx: F.Ctx, fetchFn: F.fetchFn, beds: SAIL_BEDS, musicSeed: 5 });
  const state = { hour: 6.5, windSpeed: 2, shoreDist: -200 };
  const L = { F, audio, t: 10, samples: [], race: null, cruise: null, raceClock: -60 };
  L.frame = async () => {
    F.W.now += DT; L.t += DT;
    for (const tm of F.W.timers.filter((x) => x.at <= F.W.now)) { F.W.timers.splice(F.W.timers.indexOf(tm), 1); tm.fn(); }
    for (const s of F.W.srcs) if (!s.done && s.t0 != null && F.W.now >= s.tEnd) { s.done = true; s.onended?.(); }
    await F.flush();
    audio.update(L.t, state);
    if (L.race) { L.raceClock += DT; L.race.update(DT, { clock: L.raceClock }); }
    L.samples.push({ t: F.W.now, on: F.audible() });
  };
  L.run = async (s) => { for (let i = 0; i < Math.round(s / DT); i++) await L.frame(); };
  // the modes' music moves, as their code makes them
  L.sail = () => { audio.arrive(); };   // the gesture that enters Sail (arriveOnEntry)
  L.cruise = () => { audio.scheduler.next = Infinity; L.cruiseMusic = createMusic({ audio, seed: 3, fetchFn: F.fetchFn, setTimer: F.setTimer }); L.cruiseMusic.start(); };
  L.leaveCruise = () => { L.cruiseMusic.stop(); audio.scheduler.next = L.t + 240; };
  L.regatta = () => { L.raceClock = -60; L.race = createRaceMusic({ audio, fetchFn: F.fetchFn }); L.race.start(); };
  L.leaveRegatta = () => { L.race.stop(); L.race = null; };
  L.takeHelm = () => { L.cruiseMusic.finish(); audio.scheduler.next = L.t + 240; };
  L.handBack = () => { L.cruiseMusic = createMusic({ audio, seed: 4, fetchFn: F.fetchFn, setTimer: F.setTimer }); L.cruiseMusic.start(); audio.scheduler.next = Infinity; };
  audio.start(); await F.flush();   // its loops decode on the fake clock, frame by frame
  audio.update(L.t, state);
  return L;
}

// the longest stretch any two pieces are audible together, and which two (quick taps chain crossfades: each pair counts alone)
function worstOverlap(samples) {
  let best = { s: 0, pieces: [] };
  const runs = new Map();   // "a|b" → the time their current run began
  samples.forEach((x, i) => {
    const now = new Set();
    for (const a of x.on) for (const b of x.on) if (a < b) { const k = `${a}|${b}`; now.add(k); if (!runs.has(k)) runs.set(k, x.t); }
    for (const [k, t0] of runs) {
      const end = !now.has(k) || i === samples.length - 1;
      if (!end) continue;
      const s = (now.has(k) ? x.t : samples[i - 1].t) - t0 + DT;
      if (s > best.s) best = { s, pieces: k.split('|'), at: t0 };
      if (!now.has(k)) runs.delete(k);
    }
  });
  return best;
}
const LIMIT = MUSIC_XFADE_S + 2 * DT;

const SEQUENCES = {
  'Sail -> Cruise -> Sail': async (L) => { L.sail(); await L.run(8); L.cruise(); await L.run(15); L.leaveCruise(); L.sail(); await L.run(15); },
  'Sail -> Regatta (the gun, then ⏭)': async (L) => { L.sail(); await L.run(8); L.regatta(); await L.run(70); L.audio.nextSong(); await L.run(10); },
  'Cruise -> Regatta': async (L) => { L.cruise(); await L.run(10); L.leaveCruise(); L.regatta(); await L.run(20); },
  'Regatta -> Sail': async (L) => { L.regatta(); await L.run(10); L.leaveRegatta(); L.sail(); await L.run(10); },
  'Regatta left while its first piece decodes': async (L) => { L.regatta(); await L.run(0.2); L.leaveRegatta(); L.sail(); await L.run(10); },
  'quick double switch Sail -> Cruise -> Sail -> Cruise': async (L) => { L.sail(); await L.run(4); L.cruise(); await L.run(0.3); L.leaveCruise(); L.sail(); await L.run(0.3); L.cruise(); await L.run(12); },
  'a switch during the ⏭ crossfade, ⏭ twice while decoding': async (L) => { L.sail(); await L.run(4); L.audio.nextSong(); await L.run(0.5); L.cruise(); await L.run(3); L.leaveCruise(); L.audio.nextSong(); await L.run(0.2); L.audio.nextSong(); await L.run(10); },
  'take the helm, ⏭ in Sail, hand back, take and give quickly': async (L) => {
    L.cruise(); await L.run(8); L.takeHelm(); await L.run(4); L.audio.nextSong(); await L.run(6); L.handBack(); await L.run(10);
    L.takeHelm(); await L.run(1); L.handBack(); await L.run(12);
  },
  'take the helm, the beds come back while the Cruise piece still plays': async (L) => { L.cruise(); await L.run(8); L.takeHelm(); L.audio.scheduler.next = L.t + 5; await L.run(30); },
};

for (const [name, seq] of Object.entries(SEQUENCES)) {
  test(`one song at a time: ${name}`, async () => {
    const L = await lake();
    try {
      await seq(L);
      const heard = new Set(L.samples.flatMap((x) => x.on));
      assert.ok(heard.size > 0, 'music was heard');
      const o = worstOverlap(L.samples);
      assert.ok(o.s <= LIMIT, `two pieces at once for ${o.s.toFixed(2)} s (limit ${LIMIT.toFixed(2)} s) at ${o.at?.toFixed(1)} s: ${o.pieces.join(' + ')}`);
    } finally { L.F.restore(); }
  });
}

test('the bus: one owner; the beds wait while another player owns it; a stop gives it back', async () => {
  const L = await lake();
  try {
    assert.equal(L.audio.musicHolder, 'beds');
    L.cruise(); assert.equal(L.audio.musicHolder, 'cruise');
    assert.equal(L.audio.arrive(), null, 'no arrival piece over Cruise');
    L.leaveCruise(); assert.equal(L.audio.musicHolder, 'beds');
    L.regatta(); await L.run(0.2); assert.equal(L.audio.musicHolder, 'regatta');
    L.audio.nextSong(); assert.equal(L.audio.musicHolder, 'beds', 'the tap takes the bus back');
    L.leaveRegatta(); assert.equal(L.audio.musicHolder, 'beds');
  } finally { L.F.restore(); }
});
