// The fireworks' sound (stage S4, owner go 2026-11-08): every shell the engine fires is heard, at its real time
// and place. A launch thumps at the barge; the burst bangs once its sound has crossed the air at 343 m/s (≈ 3.3 s from the
// sill to a burst 780 m out and 900 m up), deeper and louder for a bigger shell, duller and quieter with distance; a
// crackle shell sizzles after its bang; the finale rolls as a wall; the far South Lake and Tahoe City shows are low thuds;
// the bay's walls send a slap-back and the ridges a long tail; a faint cheer comes off the shore after the last salvo.
//
//   const snd = createFireworksSound({ audio: core.audio, show, barges, scale, far: { show, barges } })
//   snd.update(showT, listener, dtReal)    every frame (listener: { x, y, z, fx, fz }: the camera and its look, flat)
//   snd.renderOffline({ t0, t1, listener }) → { wav: ArrayBuffer, peak, rms, ms }   the same cues, an OfflineAudioContext
//   snd.musicBus                            a hook for a show soundtrack later (its own bus, under the same limiter)
//
// The plan (cuesFor, cuesArriving, wallLevel, VoicePool, echoImpulse, ceilingCurve) is plain JS with no Web Audio: the
// node tests drive it (tests/fireworksSound.test.mjs). No Math.random(), no clock: a slot, a pitch or a whistle is picked
// by a hash of the event's own seed, so a page and an offline render make the same sound. The sound joins src/audio.js's
// context through audio.attach on the master (it is the world's sound, like the lake: the menu's Sound switch and M
// mute it; the music and effects switches do not), so it starts only after the user's gesture, as the rest does.
import { isGround, MULTI_BREAKS, cakeTimes } from './shells.js';
import { clamp } from '../sim/core/math.js';

export const SPEED_OF_SOUND = 343;        // m/s (dry air at 20 °C; the lake's July evening)
export const DECK_Y = 2.5;                // m: the barge's deck (src/fireworks/engine.js)
// The sound files (audio/fireworks/, tools/boat_audio_pack.py "fireworks"): one-shot banks, `n` slots of `slot` s each
export const BANKS = {
  fw_boom: { slot: 3.5, n: 1 }, fw_bang: { slot: 1.25, n: 5 }, fw_deep: { slot: 1.25, n: 4 }, fw_launch: { slot: 0.75, n: 4 },
  fw_crackle: { slot: 2.5, n: 3 }, fw_whistle: { slot: 1.5, n: 1 }, fw_whistle2: { slot: 1.5, n: 1 }, fw_cheer: { slot: 9, n: 1 },
};
export const LOOP = 'fw_finale';          // the finale's wall (a 20 s loop)
export const SOUND = {
  refM: 1000,             // the distance where a 6" bang plays at its bank level × BANG
  minM: 120,              // nearer than this counts as this (no blow-up at the barge)
  bang: 0.9, launch: 0.6, whistle: 0.07, crackle: 0.42, cheer: 0.16, wall: 0.42,
  salute: 2.0,            // a salute's report over a shell's bang (and a boom's body under it)
  // a burst heard alone (fewer than ~2 others bursting within ±window s) is louder and fuller than the same shell in the
  // finale's pile: its bang × boost, a deep body under it (the far boom bank, slower) and a wetter echo send. The finale's
  // dense bursts get none of it, so its mix stays as tuned (owner 2026-11-08: "not much sound" in the opening).
  single: { window: 1.2, boost: 1.6, body: 0.6, wet: 1.8 },
  murmur: 0.15, murmurLp: 900, murmurRate: 0.85,   // the shore's crowd under the whole show (the cheer bank, slowed, dulled)
  farGain: 0.75, farLowpassHz: 260,      // the horizon shows: low thuds only
  whistleShare: 0.12,     // about one riser in eight whistles (hashed per event)
  crackleAfterS: 1.8,     // the crackle's pops: ≈ the stars' burn (2 s) after the bang
  lookaheadS: 0.3,        // the live scheduler's window ahead of the show clock
  maxBackS: 70,           // how far back an event's sound can still be on its way (the far shows: 7.7 km is 22 s)
  voices: { desktop: 40, phone: 16 },
  wetNear: 0.32, wetFar: 0.75,           // the echo send: nearer bursts drier
  level: 0.3,             // the fireworks bus (into the limiter): a 6" bang from the sill peaks ≈ −13 dBFS before the master
};
// The limiter: a compressor (−12 dB threshold, ratio 20, 1.5 ms attack) and then a soft ceiling (CEILING, tanh-shaped,
// linear below KNEE): the output never passes −0.5 dBFS, whatever the finale piles up
export const LIMITER = { threshold: -12, knee: 6, ratio: 20, attack: 0.0015, release: 0.25, ceiling: 0.944, knee0: 0.5 };

import { smooth as smoothstep } from '../sim/core/math.js';
// a deterministic 0–1 hash of (seed, k)
export function hash01(seed, k = 0) {
  let h = (Math.imul((seed | 0) ^ 0x2545f491, 0x9e3779b1) ^ Math.imul((k | 0) + 0x632be5ab, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ---- the physics of a sound on its way ----
export const delayFor = (distM) => distM / SPEED_OF_SOUND;
// the spreading loss (1/r) against the reference distance, capped near
export const distanceGain = (distM) => SOUND.refM / Math.max(SOUND.minM, distM);
// the air's absorption as one low-pass: 2 kHz at 1 km, falling as d^−1.2 (≈ 430 Hz at 3.6 km, 170 Hz at 7.7 km)
export const airLowpassHz = (distM) => clamp(2000 * (1000 / Math.max(1, distM)) ** 1.2, 140, 12000);
// a shell's calibre: gain (louder), rate (the bank played slower: deeper) and the low-pass's share (duller), from 6"
export function calibre(inches) {
  const r = Math.max(1, inches) / 6;
  return { gain: r ** 0.9, rate: clamp(r ** -0.35, 0.7, 1.4), lp: clamp(r ** -0.45, 0.6, 1.6) };
}
// the bang's bank: the far boom for the big ones, the deep finale bursts for the middle, the lakeside bursts below
export const bangBank = (inches) => (inches >= 10 ? 'fw_boom' : inches >= 7 ? 'fw_deep' : 'fw_bang');
// the stereo place of a source for a listener facing (fx, fz) (world x east, z south): −1 left … +1 right, kept off the
// hard edges (a far show is never in one ear)
export function panFor(pos, L) {
  const dx = pos[0] - L.x, dz = pos[2] - L.z, d = Math.hypot(dx, dz) || 1, f = Math.hypot(L.fx ?? 0, L.fz ?? -1) || 1;
  const rx = -(L.fz ?? -1) / f, rz = (L.fx ?? 0) / f;   // the listener's right
  return clamp(0.75 * (dx * rx + dz * rz) / d, -0.75, 0.75);
}

// ---- where an event's sounds start ----
// the mortar on the deck (jittered along and across the barge, the engine's mortarOf) and the burst above it (the riser's
// small tilt carried up)
export function mortarAt(e, barges, scale) {
  const b = barges[e.barge % barges.length], ax = b.axis ?? [0, 1], j = e.jitter ?? [0, 0];
  return [b.x + (ax[0] * j[0] - ax[1] * j[1]) * scale, DECK_Y, b.z + (ax[1] * j[0] + ax[0] * j[1]) * scale];
}
export function burstAt(e, barges, scale) {
  const m = mortarAt(e, barges, scale), h = (e.height ?? 0) * scale, t = e.tilt ?? [0, 0];
  return [m[0] + t[0] * h, m[1] + h, m[2] + t[1] * h];
}
const dist3 = (p, L) => Math.hypot(p[0] - L.x, p[1] - (L.y ?? 2), p[2] - L.z);

// The sounds of one event for a listener: [{ id, kind, bank, slot, at (arrival, show s), emit (show s), dist, gain, rate,
// lp (Hz), wet, pos }]. far: the horizon shows (a thud for each burst, nothing else).
// neighbours: other aerial bursts within ±SOUND.single.window s of this one (createPlan counts them; 0: heard alone).
export const isolation = (neighbours = 0) => 1 - smoothstep(0.5, 3.5, neighbours);
export function cuesFor(e, { barges, scale = 1, listener, far = false, neighbours = 0 }) {
  const out = [], seed = e.seed ?? e.i;
  const add = (kind, k, emit, pos, o) => {
    const dist = dist3(pos, listener);
    const bank = o.bank, n = BANKS[bank].n;
    out.push({ id: `${far ? 'f' : 'n'}${e.i}:${kind}:${k}`, kind, bank, slot: Math.floor(hash01(seed, 11 + k) * n) % n, emit, at: emit + delayFor(dist), dist,
      gain: o.gain * distanceGain(dist), rate: o.rate, lp: o.lp ?? airLowpassHz(dist), wet: SOUND.wetNear + (SOUND.wetFar - SOUND.wetNear) * smoothstep(400, 4000, dist), pos });
  };
  const cal = calibre(e.inches ?? 6), jit = (k) => 0.94 + 0.12 * hash01(seed, 31 + k);
  if (far) {
    if (e.ground) return out;
    const p = burstAt(e, barges, scale), d = dist3(p, listener);
    add('bang', 0, e.burst, p, { bank: e.inches >= 8 ? 'fw_boom' : 'fw_deep', gain: SOUND.bang * SOUND.farGain * cal.gain, rate: 0.8 * cal.rate * jit(0), lp: Math.min(SOUND.farLowpassHz, airLowpassHz(d)) });
    return out;
  }
  const m = mortarAt(e, barges, scale);
  const thump = (k, at, g = 1) => add('launch', k, at, m, { bank: 'fw_launch', gain: SOUND.launch * cal.gain ** 0.6 * g, rate: 0.85 * cal.rate * jit(k), lp: Math.min(1400, airLowpassHz(dist3(m, listener)) * 1.6) });
  if (e.ground) {
    // a fan cake: a thump on every other shot (realism round: single comets one by one; every shot would crowd the voices)
    if (e.type === 'cake') cakeTimes(e.inches ?? 6, e.seed).forEach((dt, v) => { if (v % 2 === 0) thump(v, e.t + dt, 0.6); });
    else if (e.type === 'vcomets') for (let v = 0; v < 6; v++) thump(v, e.t + 0.3 * v, 0.55);
    else if (e.type === 'mine') thump(0, e.t, 1.2);
    else if (e.type === 'niagara') for (let v = 0; v < 4; v++) add('crackle', v, e.t + 0.5 + 2.6 * v, [m[0], m[1] + 12 * scale, m[2]], { bank: 'fw_crackle', gain: SOUND.crackle * 0.35, rate: 0.9 + 0.1 * hash01(seed, 41 + v), lp: clamp(airLowpassHz(dist3(m, listener)) * 3, 600, 9000) });
    return out;
  }
  thump(0, e.t);
  if (hash01(seed, 7) < SOUND.whistleShare) {
    const mid = [m[0], m[1] + (e.height ?? 0) * scale * 0.3, m[2]];
    add('whistle', 0, e.t + 0.15, mid, { bank: hash01(seed, 8) < 0.5 ? 'fw_whistle' : 'fw_whistle2', gain: SOUND.whistle, rate: 0.92 + 0.16 * hash01(seed, 9), lp: clamp(airLowpassHz(dist3(mid, listener)) * 2, 800, 12000) });
  }
  const p = burstAt(e, barges, scale), lpB = airLowpassHz(dist3(p, listener));
  const salute = e.type === 'salute', iso = isolation(neighbours), S1 = SOUND.single;
  const boost = 1 + (S1.boost - 1) * iso, wetK = 1 + (S1.wet - 1) * iso;
  const bang = (k, at, g = 1, pos = p) => add('bang', k, at, pos, { bank: salute ? 'fw_bang' : bangBank(e.inches), gain: SOUND.bang * cal.gain * g * boost * (salute ? SOUND.salute : 1), rate: cal.rate * jit(20 + k) * (salute ? 1.1 : 1), lp: lpB * cal.lp * (salute ? 1.5 : 1) });
  if (e.type === 'multibreak') for (let b = 0; b < MULTI_BREAKS; b++) bang(b, e.burst + 0.42 * b, 0.6, [p[0], p[1] + 0.55 * 0.35 * 30 * (e.inches ?? 6) * scale * b, p[2]]);
  else bang(0, e.burst);
  // the body: a burst heard alone (and every salute) carries a deep boom under its report, the shell's air thump rolling
  // off the water; the far boom bank for most, the deep bursts under a 10–12" (its bang is already the boom)
  const bodyK = salute ? Math.max(iso, 0.8) : iso;
  if (bodyK > 0.05 && (e.inches ?? 6) >= 4) {
    const big = !salute && (e.inches ?? 6) >= 10;
    add('body', 0, e.burst + 0.02, p, { bank: big ? 'fw_deep' : 'fw_boom', gain: SOUND.bang * cal.gain * S1.body * bodyK * (salute ? 1.6 : 1), rate: clamp(cal.rate * 0.82 * jit(70), 0.6, 1.1), lp: Math.min(lpB * 0.6, 900) });
  }
  for (const c of out) if (c.kind === 'bang' || c.kind === 'body') c.wet = Math.min(1, c.wet * wetK);
  if (e.type === 'crossette') for (let k = 0; k < 3; k++) add('bang', 10 + k, e.burst + 0.75 + 0.12 * k, p, { bank: 'fw_bang', gain: SOUND.bang * 0.12, rate: 1.35 * jit(50 + k), lp: lpB * 1.3 });
  if (e.type === 'crackle' || e.type === 'strobe') {
    add('crackle', 0, e.burst + (e.type === 'crackle' ? SOUND.crackleAfterS : 0.3), p, { bank: 'fw_crackle', gain: SOUND.crackle * cal.gain ** 0.5 * (e.type === 'crackle' ? 1 : 0.4), rate: 0.92 + 0.16 * hash01(seed, 61), lp: clamp(lpB * 3, 600, 12000) });
  }
  return out;
}

// The cheer: the shore's crowd (the state park's beach, ≈ 450 m south-west of the sill) cheers 1.5 s after it sees the
// last salvo; the sound then crosses to the listener. One cue.
const CHEER = { offsetS: 1.5, pos: [1400, 2, -930] };
export function cheerCue(show, listener) {
  const last = show.events.reduce((m, e) => (e.ground ? m : Math.max(m, e.burst)), -Infinity);
  const dist = dist3(CHEER.pos, listener), emit = last + CHEER.offsetS;
  return { id: 'cheer', kind: 'cheer', bank: 'fw_cheer', slot: 0, emit, at: emit + delayFor(dist), dist, gain: SOUND.cheer * distanceGain(dist) * 0.5, rate: 1, lp: clamp(airLowpassHz(dist) * 2.5, 1200, 6000), wet: 0.5, pos: CHEER.pos };
}

// The opening cheer: the shore greets the opening salvo (the aerials bursting in the show's first 12 s) 1.5 s after its
// last burst, as it greets the finale. One cue (id 'cheer0').
function openCheerCue(show, listener) {
  const last = show.events.reduce((m, e) => (e.ground || e.burst > 12 ? m : Math.max(m, e.burst)), -Infinity);
  if (!Number.isFinite(last)) return null;
  const dist = dist3(CHEER.pos, listener), emit = last + CHEER.offsetS;
  return { id: 'cheer0', kind: 'cheer', bank: 'fw_cheer', slot: 0, emit, at: emit + delayFor(dist), dist, gain: SOUND.cheer * distanceGain(dist) * 0.9, rate: 0.97, lp: clamp(airLowpassHz(dist) * 2.5, 1200, 6000), wet: 0.5, pos: CHEER.pos };
}

// first index with events[i].t >= t (events by launch time)
function lowerBound(events, t) { let lo = 0, hi = events.length; while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].t < t) lo = m + 1; else hi = m; } return lo; }

// A plan: the show, its barges and scale, a listener; cues per event, cached until the listener moves 25 m
export function createPlan({ show, barges, scale = 1, far = null }) {
  let L0 = null, cache = new Map(), cheer = null, cheer0;
  // each aerial's neighbours: the other aerial bursts within ±SOUND.single.window s (a burst alone is heard fuller)
  const bursts = show.events.filter((e) => !e.ground).map((e) => e.burst).sort((a, b) => a - b);
  const firstAt = (t) => { let lo = 0, hi = bursts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (bursts[m] < t) lo = m + 1; else hi = m; } return lo; };
  const neighboursOf = (e) => (e.ground ? 0 : firstAt(e.burst + SOUND.single.window + 1e-9) - firstAt(e.burst - SOUND.single.window) - 1);
  const ok = (L) => L0 && Math.hypot(L.x - L0.x, L.z - L0.z, (L.y ?? 2) - (L0.y ?? 2)) < 25;
  const of = (e, isFar, L) => {
    const key = (isFar ? 'f' : 'n') + e.i;
    let c = cache.get(key);
    if (!c) { c = cuesFor(e, { barges: isFar ? far.barges : barges, scale: isFar ? 1 : scale, listener: L, far: isFar, neighbours: isFar ? 0 : neighboursOf(e) }); cache.set(key, c); }
    return c;
  };
  // the cues whose sound arrives in [t0, t1) (show s), in arrival order
  function between(t0, t1, L) {
    if (!ok(L)) { L0 = { ...L }; cache = new Map(); cheer = null; cheer0 = undefined; }
    const out = [];
    const scan = (events, isFar) => {
      for (let i = lowerBound(events, t0 - SOUND.maxBackS); i < events.length && events[i].t < t1; i++) for (const c of of(events[i], isFar, L)) if (c.at >= t0 && c.at < t1) out.push(c);
    };
    scan(show.events, false);
    if (far) scan(far.show.events, true);
    cheer ??= cheerCue(show, L);
    if (cheer.at >= t0 && cheer.at < t1) out.push(cheer);
    if (cheer0 === undefined) cheer0 = openCheerCue(show, L);
    if (cheer0 && cheer0.at >= t0 && cheer0.at < t1) out.push(cheer0);
    return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }
  // the barges' middle (for the wall's delay)
  const mid = barges.reduce((s, b) => [s[0] + b.x / barges.length, s[1] + b.z / barges.length], [0, 0]);
  return { between, neighboursOf, wallDelay: (L) => delayFor(Math.hypot(mid[0] - L.x, 500 * scale * 0.5, mid[1] - L.z)), get cheer() { return cheer; } };
}
export function cuesArriving(show, t0, t1, opts) { return createPlan({ show, ...opts }).between(t0, t1, opts.listener); }

// The finale's wall: the bursts per second about show time t (a 2 s window), mapped to 0–1 from 3 to 12 a second. The loop
// plays under the single bangs at SOUND.wall × this, delayed like them.
function burstRate(show, t, w = 2) { let n = 0; for (const e of show.events) if (!e.ground && e.burst >= t - w / 2 && e.burst < t + w / 2) n++; return n / w; }
export const wallLevel = (show, t) => smoothstep(3, 12, burstRate(show, t));

// The voices: at most `max` at once. A new cue takes a free voice; with none free it steals the quietest playing one if it
// is louder than that, else it is dropped (a quiet thump under the finale is never missed). Deterministic.
export class VoicePool {
  constructor(max = SOUND.voices.desktop) { this.max = max; this.live = []; this.dropped = 0; this.stolen = 0; }
  // cue: { id, gain }, now and end (any clock). Returns { ok, steal: the voice's id to stop, or null }
  admit(cue, now, end) {
    this.live = this.live.filter((v) => v.end > now);
    if (this.live.length < this.max) { this.live.push({ id: cue.id, gain: cue.gain, end }); return { ok: true, steal: null }; }
    let q = 0;
    for (let i = 1; i < this.live.length; i++) if (this.live[i].gain < this.live[q].gain) q = i;
    if (cue.gain <= this.live[q].gain) { this.dropped++; return { ok: false, steal: null }; }
    const [gone] = this.live.splice(q, 1);
    this.live.push({ id: cue.id, gain: cue.gain, end });
    this.stolen++;
    return { ok: true, steal: gone.id };
  }
  get count() { return this.live.length; }
}

// The echoes as one impulse response (a ConvolverNode): four slap-backs off the bay's granite walls (the mouth's two points
// 300–600 m away), each a short smear, duller as it goes; two late returns off the ridge walls above the bay (≈ 600–800 m
// up and back: 3.5 and 4.8 s); then the long tail off the ridges (the Sierra crest behind the bay, the Carson Range across
// the lake), a decaying rumble that darkens. Stereo: each channel its own seed (width).
// Each part is scaled to its energy (Σh² = gain²), so the echo's loudness does not depend on the sample rate or length: a
// noise IR left at sample level is ≈ +35 dB of gain (2026-11-08: the first render was all reverb).
// 2026-11-08 (owner: "not much sound" in the opening): the late returns added, the tail τ 1.6 → 2.8 s and gain 0.42 → 0.6,
// so a lone burst rolls on through the gap to the next one.
export const ECHO = { taps: [[0.62, 0.45], [1.05, 0.33], [1.7, 0.24], [2.6, 0.15], [3.5, 0.24], [4.8, 0.16]], tailFrom: 0.9, tailTau: 2.8, tailGain: 0.6, seconds: 7 };
export function echoImpulse(sampleRate, { seconds = ECHO.seconds, seed = 1, channel = 0 } = {}) {
  const n = Math.ceil(seconds * sampleRate), y = new Float32Array(n);
  let s = (Math.imul(seed + 977 * channel, 2654435761) >>> 0) || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const place = (part, o, gain) => { let e = 0; for (const v of part) e += v * v; const k = gain / Math.sqrt(e || 1); for (let i = 0; i < part.length && o + i < n; i++) y[o + i] += part[i] * k; };
  // the walls: each tap a 40 ms smear, low-passed the further it is (no dry path: the send is wet only)
  for (const [d, g] of ECHO.taps) {
    const len = Math.round(0.04 * sampleRate), a = Math.exp(-2 * Math.PI * (1800 / (1 + d)) / sampleRate), part = new Float32Array(len);
    let z = 0;
    for (let i = 0; i < len; i++) { z = a * z + (1 - a) * rnd(); part[i] = z * Math.sin(Math.PI * i / len); }
    place(part, Math.round((d + 0.04 * channel) * sampleRate), g);
  }
  // the ridges: noise under an exponential, its low-pass sliding from 1.5 kHz down to 250 Hz
  const t0 = Math.round(ECHO.tailFrom * sampleRate), tail = new Float32Array(Math.max(0, n - t0));
  let z = 0;
  for (let i = 0; i < tail.length; i++) {
    const t = (t0 + i) / sampleRate, fc = 250 + 1250 * Math.exp(-(t - ECHO.tailFrom) / 1.2), a = Math.exp(-2 * Math.PI * fc / sampleRate);
    z = a * z + (1 - a) * rnd();
    tail[i] = z * Math.exp(-(t - ECHO.tailFrom) / ECHO.tailTau) * smoothstep(ECHO.tailFrom, ECHO.tailFrom + 0.6, t) * (1 - smoothstep(seconds - 0.5, seconds, t));
  }
  place(tail, t0, ECHO.tailGain);
  return y;
}

// The soft ceiling's curve (a WaveShaperNode): x for |x| ≤ knee0, then a tanh that approaches ±ceiling
export function ceilingCurve(n = 2049, { ceiling = LIMITER.ceiling, knee0 = LIMITER.knee0 } = {}) {
  const c = new Float32Array(n), room = ceiling - knee0;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x) * 4;   // the shaper's input is pre-scaled by 1/4 (headroom to +12 dBFS)
    const y = ax <= knee0 ? ax : knee0 + room * Math.tanh((ax - knee0) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

// ---- the browser part ------------------------------------------------------------------------------------------------
// One graph on a context: voices → (dry, echo send) → the fireworks bus → compressor → ¼ → soft ceiling → dest. The music
// hook (musicBus) joins before the compressor.
function buildGraph(ctx, dest, { seed = 1, phone = false } = {}) {
  const bus = new GainNode(ctx, { gain: SOUND.level });
  const comp = new DynamicsCompressorNode(ctx, { threshold: LIMITER.threshold, knee: LIMITER.knee, ratio: LIMITER.ratio, attack: LIMITER.attack, release: LIMITER.release });
  const pre = new GainNode(ctx, { gain: 0.25 });
  const shaper = new WaveShaperNode(ctx, { curve: ceilingCurve(), oversample: 'none' });
  bus.connect(comp).connect(pre).connect(shaper).connect(dest);
  const echo = new ConvolverNode(ctx, { disableNormalization: true });
  const secs = phone ? 3.5 : ECHO.seconds, sr = ctx.sampleRate;
  const ir = new AudioBuffer({ length: Math.ceil(secs * sr), sampleRate: sr, numberOfChannels: 2 });
  for (let ch = 0; ch < 2; ch++) ir.copyToChannel(echoImpulse(sr, { seconds: secs, seed, channel: ch }), ch);
  echo.buffer = ir;
  echo.connect(bus);
  const musicBus = new GainNode(ctx, { gain: 1 });   // a show soundtrack later: nothing plays on it yet
  musicBus.connect(comp);
  return { bus, comp, echo, musicBus, shaper };
}

// play one cue at context time `when`; from `offset` s into the cue (an offline render that starts mid-sound)
function playCue(ctx, g, bufs, c, when, pan, offset = 0) {
  const buf = bufs[c.bank];
  if (!buf) return null;
  const B = BANKS[c.bank], start = c.slot * B.slot, len = Math.min(B.slot, buf.duration - start);
  const off = offset * c.rate;
  if (len - off <= 0.01) return null;
  const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: c.rate });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: c.lp, Q: 0.5 });
  const gain = new GainNode(ctx, { gain: c.gain });
  const panner = new StereoPannerNode(ctx, { pan });
  const send = new GainNode(ctx, { gain: c.wet });
  src.connect(lp).connect(gain).connect(panner);
  panner.connect(g.bus); panner.connect(send).connect(g.echo);
  src.start(when, start + off, len - off);
  src.onended = () => { src.disconnect(); lp.disconnect(); gain.disconnect(); panner.disconnect(); send.disconnect(); };
  return { src, gain, end: when + (len - off) / c.rate };
}

// the crowd's murmur: the cheer bank's middle looped, slowed and dulled, faint, into the bus (the compressor dips it under
// each bang, as a crowd hushes); its gain set by the caller (0 outside the show)
const murmurLevel = (show, t) => (t > -10 && t < (show.length ?? 300) + 15 ? SOUND.murmur : 0);
function murmurNode(ctx, g, buf) {
  if (!buf) return null;
  const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, loopStart: 0.6, loopEnd: Math.min(8.6, buf.duration - 0.2), playbackRate: SOUND.murmurRate });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: SOUND.murmurLp, Q: 0.5 });
  const gain = new GainNode(ctx, { gain: 0 }), send = new GainNode(ctx, { gain: 0.3 });
  src.connect(lp).connect(gain); gain.connect(g.bus); gain.connect(send).connect(g.echo);
  return { src, gain };
}

const NAMES = [...Object.keys(BANKS), LOOP];
async function decodeAll(ctx, base, fetchFn, decode) {
  const out = {};
  await Promise.all(NAMES.map(async (k) => { try { out[k] = await decode(ctx, fetchFn, `${base}${k}.opus`); } catch { out[k] = null; } }));
  return out;
}

export function createFireworksSound({ audio = null, show, barges, scale = 1, far = null, base = '/audio/fireworks/', seed = 1, phone = false,
  fetchFn = globalThis.fetch?.bind(globalThis), decode = null, onBang = null } = {}) {
  const plan = createPlan({ show, barges, scale, far });
  const pool = new VoicePool(phone ? SOUND.voices.phone : SOUND.voices.desktop);
  let ctx = null, g = null, bufs = null, loading = null, wall = null, murmur = null, lastShowT = null, scheduledTo = null;
  const live = new Map();   // id → { src, gain, end }
  const stats = { scheduled: 0, dropped: 0, stolen: 0, updateMs: 0, maxUpdateMs: 0, voices: 0 };
  const dec = decode ?? (async (c, f, url) => (await import('../audioFormat.js')).decodeFile(c, f, url));

  function attach() {
    audio?.attach?.(({ ctx: c, master }) => {
      ctx = c; g = buildGraph(ctx, master, { seed, phone });
      loading = decodeAll(ctx, base, fetchFn, dec).then((b) => { bufs = b; });
    }, 'world');   // not a bus of src/audio.js: the master itself (the world's sound, like the lake)
  }
  attach();

  function stopAll(at = ctx?.currentTime ?? 0) {
    for (const v of live.values()) { try { v.gain.gain.setTargetAtTime(0, at, 0.05); v.src.stop(at + 0.3); } catch { /* ended */ } }
    live.clear(); pool.live = [];
  }
  // the show left at once (Velia v2's time pick out of the show, 2026-11-18): every voice stopped, the crowd's murmur and the
  // wall of sound off in about 0.1 s, the scheduler re-armed (the next update with a show clock starts afresh)
  function hush(at = ctx?.currentTime ?? 0) {
    stopAll(at);
    for (const n of [murmur, wall]) { try { n?.gain.gain.cancelScheduledValues(at); n?.gain.gain.setTargetAtTime(0, at, 0.03); } catch { /* none */ } }
    lastShowT = null; scheduledTo = null;
  }
  function setWall(level, when) {
    if (!bufs?.[LOOP]) return;
    if (!wall && level > 0.001) {
      const src = new AudioBufferSourceNode(ctx, { buffer: bufs[LOOP], loop: true });
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700, Q: 0.5 });
      const gain = new GainNode(ctx, { gain: 0 }), send = new GainNode(ctx, { gain: 0.6 });
      src.connect(lp).connect(gain); gain.connect(g.bus); gain.connect(send).connect(g.echo);
      src.start(when);
      wall = { src, gain };
    }
    if (wall) wall.gain.gain.setTargetAtTime(SOUND.wall * level, when, 0.35);
  }

  // every frame: showT (show s), the listener, and the real seconds since the last frame. The show clock runs at real speed
  // during the show (src/fireworks/world.js), so a cue due `x` show s from now plays `x` s from now. A jump of the show clock
  // (a seek, the evening's time-lapse) schedules nothing for the skipped span; a jump back stops what plays.
  function update(showT, listener, dtReal = 1 / 60) {
    const t0 = performance?.now?.() ?? 0;
    if (!ctx || !g || !bufs || ctx.state !== 'running' || showT == null || !listener) {
      if (ctx) { const now0 = ctx.currentTime; murmur?.gain.gain.setTargetAtTime(0, now0, 1); wall?.gain.gain.setTargetAtTime(0, now0, 0.5); }
      lastShowT = showT; scheduledTo = null; return;
    }
    const now = ctx.currentTime;
    const jumped = lastShowT == null || showT < lastShowT - 0.05 || showT - lastShowT > Math.max(0.5, 1.5 * dtReal + 0.25);
    if (jumped) { if (lastShowT != null && showT < lastShowT) stopAll(now); scheduledTo = showT; }
    lastShowT = showT;
    const until = showT + SOUND.lookaheadS;
    if (scheduledTo == null) scheduledTo = showT;
    if (until > scheduledTo) {
      for (const c of plan.between(scheduledTo, until, listener)) {
        const when = now + Math.max(0, c.at - showT), len = BANKS[c.bank].slot / c.rate;
        const r = pool.admit(c, when, when + len);
        if (!r.ok) { stats.dropped++; continue; }
        if (r.steal) { const v = live.get(r.steal); if (v) { try { v.gain.gain.setTargetAtTime(0, when, 0.03); v.src.stop(when + 0.15); } catch { /* ended */ } live.delete(r.steal); } stats.stolen++; }
        const v = playCue(ctx, g, bufs, c, when, panFor(c.pos, listener));
        if (v) { live.set(c.id, v); stats.scheduled++; if (c.kind === 'bang') onBang?.(when, c.gain); }
      }
      scheduledTo = until;
    }
    for (const [id, v] of live) if (v.end < now) live.delete(id);
    // the wall: the burst rate where the sound now arriving left the barges
    const w = showT > 230 && showT < 320 ? wallLevel(show, showT - plan.wallDelay(listener)) : 0;
    setWall(w, now);
    const mu = murmurLevel(show, showT);
    if (!murmur && mu > 0) { murmur = murmurNode(ctx, g, bufs.fw_cheer); murmur?.src.start(now); }
    murmur?.gain.gain.setTargetAtTime(mu, now, 1);
    stats.voices = live.size;
    const ms = (performance?.now?.() ?? 0) - t0; stats.updateMs += (ms - stats.updateMs) * 0.05; stats.maxUpdateMs = Math.max(stats.maxUpdateMs, ms);
  }

  // The same show offline (films, the CPU measure): every cue arriving in [t0, t1) for a fixed listener, rendered on an
  // OfflineAudioContext through the same graph into the same limiter. Returns a 16-bit stereo WAV and its peak and RMS.
  // music: [{ name, at (s into the render), offset, fadeInS, level, loop, radio }] (src/fireworks/music.js's pieces, on the
  // music bus's level); ambience: { hour, windSpeed, shoreDist } (src/audio.js's loops at its mix): a film's whole mix,
  // the game's master over all of it
  async function renderOffline({ t0, t1, listener, sampleRate = 48000, tail = 0, music = [], musicBase = '/audio/fireworks/music/', ambience = null, ambienceBase = '/audio/' }) {
    const len = Math.ceil((t1 - t0 + tail) * sampleRate);
    const oc = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate });
    const A = await import('../audio.js'), M = await import('./music.js');
    const master = new GainNode(oc, { gain: A.MASTER }); master.connect(oc.destination);
    const og = buildGraph(oc, master, { seed, phone: false });
    const musicBus = new GainNode(oc, { gain: 1.8 }); musicBus.connect(master);   // src/audio.js BUS_LEVEL.music at full volume
    for (const m of music) {
      const buf = await dec(oc, fetchFn, `${musicBase}${m.name}.opus`).catch(() => null);
      if (!buf) continue;
      const n = M.pieceChain(oc, buf, musicBus, { radio: !!m.radio, loop: !!m.loop });
      n.fade.gain.setValueAtTime(0, m.at); n.fade.gain.linearRampToValueAtTime(m.level, m.at + (m.fadeInS ?? 1));
      n.src.start(m.at, m.offset ?? 0);
    }
    if (ambience) {
      const mix = A.mixAt(ambience);
      for (const k of A.LOOPS) {
        const gn = mix.gains[k]; if (gn < 0.005) continue;
        const buf = await dec(oc, fetchFn, `${ambienceBase}${k}.opus`).catch(() => null); if (!buf) continue;
        const src = new AudioBufferSourceNode(oc, { buffer: buf, loop: true }), gain = new GainNode(oc, { gain: gn });
        if (k === 'lake_lap') { const lp = new BiquadFilterNode(oc, { type: 'lowpass', frequency: mix.lakeLowpassHz, Q: 0.5 }); src.connect(lp).connect(gain); } else src.connect(gain);
        gain.connect(master); src.start(0, (((t0 * 7.3) % buf.duration) + buf.duration) % buf.duration);   // (a film from before the show: t0 < 0)
      }
    }
    const ob = await decodeAll(oc, base, fetchFn, dec);
    const op = createPlan({ show, barges, scale, far }), opool = new VoicePool(SOUND.voices.desktop);
    const cues = op.between(t0 - 12, t1, listener);
    let n = 0;
    for (const c of cues) {
      const when = c.at - t0, len2 = BANKS[c.bank].slot / c.rate;
      if (when + len2 < 0) continue;
      const r = opool.admit(c, when, when + len2);
      if (!r.ok) continue;
      if (playCue(oc, og, ob, c, Math.max(0, when), panFor(c.pos, listener), Math.max(0, -when))) n++;
    }
    // the wall, automated every 0.1 s
    if (ob[LOOP]) {
      const src = new AudioBufferSourceNode(oc, { buffer: ob[LOOP], loop: true }), lp = new BiquadFilterNode(oc, { type: 'lowpass', frequency: 700, Q: 0.5 });
      const gain = new GainNode(oc, { gain: 0 }), send = new GainNode(oc, { gain: 0.6 });
      src.connect(lp).connect(gain); gain.connect(og.bus); gain.connect(send).connect(og.echo);
      const wd = op.wallDelay(listener);
      for (let s = 0; s <= t1 - t0 + tail; s += 0.1) { const t = t0 + s; gain.gain.setTargetAtTime(t > 230 && t < 320 ? SOUND.wall * wallLevel(show, t - wd) : 0, s, 0.35); }
      src.start(0);
    }
    // the crowd's murmur (deterministic: started at the render's 0, its loop phase from t0)
    const mn = murmurNode(oc, og, ob.fw_cheer);
    if (mn) {
      mn.gain.gain.setValueAtTime(murmurLevel(show, t0), 0);
      for (let s = 0; s <= t1 - t0 + tail; s += 0.5) mn.gain.gain.setTargetAtTime(murmurLevel(show, t0 + s), s, 1);
      mn.src.start(0, 0.6 + ((t0 * SOUND.murmurRate) % 7.5 + 7.5) % 7.5);
    }
    const ms0 = performance.now();
    const out = await oc.startRendering();
    const ms = performance.now() - ms0;
    const L = out.getChannelData(0), R = out.getChannelData(1);
    let peak = 0, ss = 0;
    for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); ss += L[i] * L[i] + R[i] * R[i]; }
    return { wav: wavBytes(out), peak, rms: Math.sqrt(ss / (2 * L.length)), ms, seconds: t1 - t0 + tail, cues: n, dropped: opool.dropped };
  }

  return {
    update, renderOffline, stopAll, hush, plan,
    get musicBus() { return g?.musicBus ?? null; },
    get ready() { return !!bufs; },
    loaded: () => loading,
    stats: () => ({ ...stats, dropped: stats.dropped, live: live.size, state: ctx?.state ?? 'none', ready: !!bufs }),
  };
}

// a 16-bit PCM WAV of an AudioBuffer (2 channels)
function wavBytes(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { v.setInt16(o, Math.max(-32767, Math.min(32767, Math.round(data[c][i] * 32767))), true); o += 2; }
  return b;
}
