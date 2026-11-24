import { decodeFile, isIOS, streamsMusic, streamFile, sourceFor } from './audioFormat.js';
import { touchDevice } from './ui/device.js';
import { afterCard } from './ui/deferLoad.js';
import { songTitle } from './musicControl.js';
import { clamp01 } from './sim/core/math.js';
// The adaptive mixer (T6b): the six loops of audio/ as gain layers driven by world state, and a silence-first scheduler
// for the MusicAPI beds. Everything runs on the scene clock t (s), never the audio clock: a given state gives the same
// gains, and a given sequence of update times gives the same bed cues. The browser part starts muted until a user
// gesture (start()), the browser's autoplay rule; before that the mix and the scheduler still run, silently.
//
//   import { createAudio, worldState } from './audio.js';
//   const audio = createAudio({ base: '/audio/' });
//   button.onclick = () => audio.start();                       // inside a user gesture
//   audio.update(t, worldState({ t, hour, camera, wind, terrain, rain }));   // every frame
//   audio.vista(t, 'headland');                                 // a vista event: one swell, once per place
//
// The core (mixAt, BedScheduler, worldState) is plain JS with no Web Audio, so node tests drive it (tests/audio.test.mjs).

export const LOOPS = ['lake_lap', 'wind_light', 'wind_strong', 'rain_water', 'birds_dawn', 'loon'];
// each layer's level at full drive (the loops are all cut to −26 dBFS RMS, tools/audio_pack.py)
export const LEVEL = { lake_lap: 0.9, wind_light: 0.7, wind_strong: 0.8, rain_water: 0.8, birds_dawn: 0.6, loon: 0.5 };
export const LAKE_LP = { nearHz: 12000, farHz: 800, nearM: 15, farM: 600 };   // the lapping's low-pass by shore distance
// The hour windows below are local clock time at Tahoe (PDT, src/place.js), set 2026-10-29 at the sun elevations the old
// 47° N clock's windows had: e.g. the chorus from +2.7° (05:55) to +31.7° (08:32).
export const BIRDS_HOURS = [5.9, 8.5];   // the dawn chorus, 05:54–08:30, with a 30 min fade inside each end
export const MASTER = 0.8;
export const NEXT_FADE_S = 1.5;   // the bar's next-song tap: the piece playing fades out over this
export const MUSIC_XFADE_S = 1.5;   // a hand-over of the music bus (claimMusic): the song that had it fades out over this
export const BED_LEVEL = 0.9;   // the pieces are at −23 LUFS (tools/music_pack.py): ≈ −24 LUFS under the 0.8 master, level with the lake
// the menu's two buses' levels (owner, 2026-10-30: "make the background music louder relative to the effects; right now I mainly
// hear the effects"); createAudio's buses, exported for Velia v2's music core (v2/audio/music.js), the same numbers
export const BUS_LEVELS = Object.freeze({ music: 1.8, effects: 0.6 });

import { smooth as smoothstep } from './sim/core/math.js';

// The gains for one state. state: { hour (0–24), windSpeed (m/s at the listener), shoreDist (m, signed; negative on
// the lake), rain (0–1) }. Returns { gains: { <loop>: 0–1 }, lakeLowpassHz }.
export function mixAt({ hour = 12, windSpeed = 0, shoreDist = 0, rain = 0 }) {
  const s = Math.max(0, windSpeed), d = Math.abs(shoreDist), r = clamp01(rain);
  // wind: one level that grows with speed, split between the two loops by an equal-power crossfade from 4 to 9 m/s;
  // the strong loop keeps rising to 14 m/s (it started at 0.7 of its level, which made the beds ≈5 dB quieter as the
  // wind rose from 4 to 8 m/s: a gust dipped the ambience; boat-audio study, 2026-10-29)
  const windLevel = smoothstep(0.3, 3, s), x = smoothstep(4, 9, s) * Math.PI / 2;
  const windLight = windLevel * Math.cos(x);
  const windStrong = windLevel * Math.sin(x) * (1 + 0.3 * smoothstep(9, 14, s));
  // lapping: loudest on the shore, stronger with wind, falling with distance (≈ 1/d past 15 m) and duller (a low-pass)
  const lake = (0.5 + 0.5 * smoothstep(0, 8, s)) / (1 + Math.max(0, d - LAKE_LP.nearM) / 60);
  const lp = LAKE_LP.nearHz * (LAKE_LP.farHz / LAKE_LP.nearHz) ** smoothstep(LAKE_LP.nearM, LAKE_LP.farM, d);
  // birds: the dawn window only; rain quiets them, and they sing from the land (fainter far out on the lake)
  const [h0, h1] = BIRDS_HOURS;
  const dawn = smoothstep(h0, h0 + 0.5, hour) * (1 - smoothstep(h1 - 0.5, h1, hour));
  const birds = dawn * (1 - 0.7 * r) * (shoreDist < 0 ? 1 - 0.8 * smoothstep(100, 800, d) : 1);
  // loons: night and twilight (20:30–08:06, faded: the sun from −1.0° down and back up to +26.6°), on calm water;
  // strong wind hides them
  const night = clamp01(1 - smoothstep(6.8, 8.1, hour) + smoothstep(20.5, 21.6, hour));
  const loon = night * (1 - smoothstep(6, 10, s)) * (1 - 0.5 * r);
  return {
    gains: {
      lake_lap: LEVEL.lake_lap * lake, wind_light: LEVEL.wind_light * windLight, wind_strong: LEVEL.wind_strong * windStrong,
      rain_water: LEVEL.rain_water * Math.sqrt(r), birds_dawn: LEVEL.birds_dawn * birds, loon: LEVEL.loon * loon,
    },
    lakeLowpassHz: lp,
  };
}

// The world state at the listener: wind speed from the wind field at the camera, shore distance from the terrain.
export function worldState({ t, hour, camera, wind, terrain, rain = 0 }) {
  const p = camera.position ?? camera;
  return { t, hour, windSpeed: wind ? wind.sample(p.x, p.z, t).speed : 0, shoreDist: terrain ? terrain.shoreDistance(p.x, p.z) : 0, rain };
}

// Sound on by default: the browser lets a page make sound only after a user gesture, so the context starts on the very
// first one of any kind (a key, a click, a touch, the press that starts a drag; the loading card's too), in the capture
// phase so no handler can swallow it. Returns a function that removes the listeners.
export const GESTURES = ['keydown', 'pointerdown', 'mousedown', 'touchstart'];
// Safari on iOS only lets a context run from a touchend or a click, not from touchstart or pointerdown: after the first
// start, every one of these re-tries resume() until the context runs (audio.unlock)
export const UNLOCKERS = ['touchend', 'pointerup', 'click', 'keydown'];
// iOS routes Web Audio to the "ambient" session, which the ring/silent switch mutes (media elements use "playback", which
// ignores it). On an iPhone or iPad only (the Mac keeps its behaviour): navigator.audioSession.type = 'playback' (Safari
// 16.4+) before the context is created; older iOS gets the usual trick, a tiny silent looping <audio> played inside the
// gesture, which moves the page's session to playback. Returns what it did: 'session' | 'element' | null.
export { isIOS };
let silentEl = null;
export function playbackSession(nav = globalThis.navigator, doc = globalThis.document) {
  if (!isIOS(nav)) return null;
  try { if (nav.audioSession && 'type' in nav.audioSession) { if (nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback'; return 'session'; } } catch { /* fall through */ }
  if (!doc?.createElement) return null;
  try {
    if (!silentEl) {
      // 0.25 s of 8 kHz mono 8-bit silence as a WAV
      const n = 2000, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
      silentEl = doc.createElement('audio'); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); silentEl.preload = 'auto';
      silentEl.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    }
    silentEl.play?.()?.catch?.(() => {});
    return 'element';
  } catch { return null; }
}
// A gesture made before this runs (on the loading card, while the world builds) counts too: the browser's activation
// is sticky, so the context starts at once.
export function startOnFirstGesture(audio, target = globalThis, nav = globalThis.navigator) {
  const go = () => { off(); audio.start(); };
  const off = () => { for (const k of GESTURES) target.removeEventListener?.(k, go, true); };
  if (nav?.userActivation?.hasBeenActive) { audio.start(); return () => {}; }
  for (const k of GESTURES) target.addEventListener?.(k, go, true);
  return off;
}

// The gesture that enters Sail (fix/regressions, 2026-10-30): the first key, click or touch once the home card is away
// (cardUp() false) calls audio.arrive() once. A click on the card itself (Waters, Settings) does not; a mode tap or Enter does
// (the card has left by the time the deferred check runs). Returns a function that removes the listeners.
export function arriveOnEntry(audio, { target = globalThis, cardUp = () => false, defer = (f) => setTimeout(f, 0) } = {}) {
  let done = false;
  const go = () => defer(() => { if (done || cardUp()) return; done = true; off(); audio.arrive(); });
  // 'lakeshore:entered': the home card entered a mode that was tapped while the world loaded (no gesture follows)
  const kinds = [...GESTURES, 'lakeshore:entered'];
  const off = () => { for (const k of kinds) target.removeEventListener?.(k, go, true); };
  for (const k of kinds) target.addEventListener?.(k, go, true);
  return off;
}

// a deterministic 0–1 hash of (seed, i): the gap lengths
function hash01(seed, i) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// The beds, silence first: nothing for firstS; then a bed only after a long gap (gapS, hashed per cue) since the last
// one ended, and only when the world calls for it: 'wind' when the wind at the listener passes windRiseMs, 'dawn' in
// the calm hours (first light and the golden hour: a [from, to] pair or a list of them; PDT: golden from +22.2° at
// 18:20 to −3.4° at 20:43, night to −19.2° at 22:37, the old windows' elevations). Otherwise silence. A bed does not repeat within repeatS of its last start. 'vista' plays only on a vista(t, place) event, once per place, never over a bed.
//
// Pools (fix/regressions, 2026-10-30): with pools = { <bed>: [piece, …] } each cue picks a piece from its bed's pool by
// pieceSeed (a per-visit seed, src/visitSeed.js), never one of the last two pieces, and the repeat rule applies per piece
// (a piece does not repeat within repeatS); a bed with no pool keeps the old rule (the bed does not repeat within repeatS).
// arrive(t, state): the entry into Sail (the gesture that enters it) cues a piece at once, then the gaps resume.
export class BedScheduler {
  constructor({ seed = 1, pieceSeed = seed, pools = null, firstS = 90, gapS = [240, 480], bedS = 120, repeatS = 1800, calmHours = [[5.9, 9.0], [18.3, 20.5]], goldenHours = [18.3, 20.7], nightHours = [20.7, 22.6], windRiseMs = 7, vistaQuietS = 30 } = {}) {
    Object.assign(this, { seed, pieceSeed, pools, firstS, gapS, bedS, repeatS, windRiseMs, vistaQuietS, goldenHours, nightHours });
    this.calmHours = typeof calmHours[0] === 'number' ? [calmHours] : calmHours;
    this.cues = [];            // every cue so far: { bed, t, end, place? }
    this.places = new Set();   // the places whose swell has played
    this.next = firstS;        // the earliest t for the next ambient bed
  }

  playing(t) {
    const c = this.cues[this.cues.length - 1];
    return c && t < c.end ? c : null;
  }

  // the bed the world calls for: the evening has its own pieces (2026-10-29): 'golden' through the golden hour, 'night' from
  // dusk; the morning calm keeps 'dawn'; the wind past windRiseMs 'wind'; else null (silence). A bed with no file in
  // createAudio's table is skipped (silence).
  bedFor({ hour = 12, windSpeed = 0 } = {}) {
    const inH = ([a, b]) => hour >= a && hour < b;
    return windSpeed >= this.windRiseMs ? 'wind'
      : inH(this.goldenHours) ? 'golden'
      : inH(this.nightHours) ? 'night'
      : this.calmHours.some(inH) ? 'dawn' : null;
  }

  // the piece a cue of this bed would play at t, or null when every piece of its pool is blocked (the last two, or
  // repeatS since it started); without a pool: the bed itself, under the bed's repeat rule
  pick(bed, t) {
    const pool = this.pools?.[bed];
    if (!pool?.length) { const last = this.cues.findLast((c) => c.bed === bed); return last && t < last.t + this.repeatS ? null : bed; }
    const recent = this.cues.filter((c) => c.piece).slice(-2).map((c) => c.piece);
    const free = pool.filter((p) => !recent.includes(p) && !this.cues.some((c) => c.piece === p && t < c.t + this.repeatS));
    if (!free.length) return null;
    return free[Math.floor(hash01(this.pieceSeed, 0x51ed + this.cues.length) * free.length)];
  }

  // New cues for this update (0 or 1). state: { hour, windSpeed }.
  update(t, state = {}) {
    if (t < this.next || this.playing(t)) return [];
    const bed = this.bedFor(state);
    if (!bed || this.pick(bed, t) == null) return [];
    return [this.cue(bed, t)];
  }

  // The entry into Sail (the first gesture that enters it): a piece at once, unless one plays or the beds are held out
  // (Cruise sets next = Infinity). Its bed is the world's, else 'vista' (the open-lake piece); a blocked pool tries the
  // others. Then the silence-first gaps follow as after any cue. Returns the cue or null.
  arrive(t, state = {}) {
    if (this.next === Infinity || this.playing(t)) return null;
    const want = this.bedFor(state) ?? 'vista';
    const beds = [want, ...Object.keys(this.pools ?? {}).filter((b) => b !== want)];
    const bed = beds.find((b) => this.pick(b, t) != null);
    return bed ? this.cue(bed, t) : null;
  }

  // The bar's next-song tap: a different piece now. The one playing is cut short (its cue ends at t; the caller fades it
  // out); the bed is the world's when it has a pool, else any pool; never one of the last two pieces (the repeatS rule
  // does not apply: a tap asks for a change). The pick is seeded (pieceSeed, the cue count). Then the silence-first gaps
  // follow as after any cue. Returns the cue, or null when every piece is blocked.
  skip(t, state = {}) {
    const names = Object.keys(this.pools ?? {});
    const want = this.bedFor(state) ?? 'vista';
    if (!names.length) return this.cue(want, t);
    const recent = this.cues.filter((c) => c.piece).slice(-2).map((c) => c.piece);
    const from = (beds) => [...new Set(beds.flatMap((b) => this.pools[b] ?? []))].filter((p) => !recent.includes(p));
    let free = this.pools[want]?.length ? from([want]) : [];
    if (!free.length) free = from(names);
    if (!free.length) return null;
    const piece = free[Math.floor(hash01(this.pieceSeed, 0x7a11 + this.cues.length) * free.length)];
    const bed = (this.pools[want]?.includes(piece) ? want : names.find((b) => this.pools[b].includes(piece)));
    const now = this.playing(t); if (now) now.end = t;
    return this.cue(bed, t, undefined, piece);
  }

  // A vista event: the swell, if this place has not had one and nothing is playing (and the last bed ended
  // vistaQuietS ago); the silence before it is part of the swell. Returns the cue or null.
  vista(t, place) {
    if (t < this.firstS || this.places.has(place) || this.playing(t)) return null;
    const last = this.cues[this.cues.length - 1];
    if (last && t < last.end + this.vistaQuietS) return null;
    this.places.add(place);
    return this.cue('vista', t, place);
  }

  // The groove's swell (src/boatAudio.js: the boat held in the groove for 8 s): a short soft swell, not a bed. Never
  // before firstS, never over a bed or within grooveQuietS of one ending, and at most once per grooveGapS. It does
  // not move the beds' schedule. Returns the cue ({ bed: 'groove', t, end }) or null.
  groove(t) {
    if (t < this.firstS || this.playing(t)) return null;
    const lastBed = this.cues.findLast((c) => c.bed !== 'groove'), lastG = this.grooves?.at(-1);
    if (lastBed && t < lastBed.end + GROOVE_SWELL.quietS) return null;
    if (lastG && t < lastG.t + GROOVE_SWELL.gapS) return null;
    const c = { bed: 'groove', t, end: t + GROOVE_SWELL.durS };
    (this.grooves ??= []).push(c);
    return c;
  }

  cue(bed, t, place, chosen = null) {
    const piece = chosen ?? (this.pools?.[bed]?.length ? this.pick(bed, t) ?? this.pools[bed][0] : null);
    const c = { bed, t, end: t + this.bedS, ...(piece ? { piece } : {}), ...(place ? { place } : {}) };
    this.cues.push(c);
    const [g0, g1] = this.gapS;
    this.next = c.end + g0 + (g1 - g0) * hash01(this.seed, this.cues.length);
    return c;
  }
}

// The groove's swell (owner, 2026-10-29: "a soft musical swell"): four sine voices of an open D chord (D3 A3 D4 F#4,
// each with a quiet octave and a 0.4 % detune), swelling in over 2.5 s, holding, gone by durS; under the ambience
// (level: −30 dBFS-ish peak before the master). Synthesised, no file. At most once every gapS (BedScheduler.groove).
export const GROOVE_SWELL = { durS: 8, attackS: 2.5, releaseS: 4, level: 0.035, notes: [146.83, 220.0, 293.66, 369.99], gapS: 240, quietS: 30 };
export function grooveSwell(ctx, dest, at, { level = GROOVE_SWELL.level, notes = GROOVE_SWELL.notes, durS = GROOVE_SWELL.durS, attackS = GROOVE_SWELL.attackS, releaseS = GROOVE_SWELL.releaseS } = {}) {
  const env = new GainNode(ctx, { gain: 0 }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1800, Q: 0.4 });
  env.connect(lp).connect(dest);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(level, at + attackS);
  env.gain.setValueAtTime(level, at + durS - releaseS);
  env.gain.linearRampToValueAtTime(0, at + durS);
  notes.forEach((hz, i) => {
    for (const [mul, g, det] of [[1, 1, 1], [1, 0.6, 1.004], [2, 0.18, 1]]) {
      const o = new OscillatorNode(ctx, { frequency: hz * mul * det }), v = new GainNode(ctx, { gain: g / notes.length });
      o.connect(v).connect(env); o.start(at + 0.15 * i); o.stop(at + durS + 0.1);
    }
  });
  return env;
}

// ---- the browser engine -----------------------------------------------------------------------------------------
// files: { <loop>: url } (default base + <loop>.opus); beds: { dawn, wind, vista, golden, night: url | [url, …] } (a missing
// bed is skipped; a list is a pool, picked by musicSeed: BedScheduler).
export function createAudio({ base = '/audio/', files = {}, beds = {}, seed = 1, musicSeed = seed, scheduler, Ctx = globalThis.AudioContext, fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  const pools = Object.values(beds).some(Array.isArray) ? Object.fromEntries(Object.entries(beds).map(([k, v]) => [k, [].concat(v)])) : null;
  const sched = scheduler ?? new BedScheduler({ seed, pieceSeed: musicSeed, pools });
  const urls = Object.fromEntries(LOOPS.map((k) => [k, files[k] ?? `${base}${k}.opus`]));
  let ctx = null, master = null, duckNode = null, duckDb = 0, lastT = 0, mix = mixAt({}), started = false, muted = false;
  let held = false, musicVol = 1, songSeq = 0, song = null;   // held: the bar's pause (no beds until play); song: the piece playing now
  // the menu's two sound switches: music (the beds, the groove, Chill's pieces) and effects (the boat,
  // the controls' sounds); each a bus into the master. The lake's ambience stays on the master: "sound" mutes it all.
  const buses = {}, busOn = { music: true, effects: true };
  // the mix (owner, 2026-10-30: "make the background music louder relative to the effects; right now I mainly hear the effects")
  const BUS_LEVEL = BUS_LEVELS;
  const layers = {};      // <loop>: { buf, src, gain, filter? }
  const bedBufs = {};     // <bed>: Promise<AudioBuffer | null>
  const bedNodes = [];    // the playing bed's { src, gain }
  const log = [];         // cues and what happened to them (stats)
  const played = new WeakSet();   // the cues whose piece has started (a next-song tap before the loops loaded must not start twice)
  const attached = [];    // other sound layers on this context (src/boatAudio.js): fn({ ctx, master }) at start
  let bedGen = 0;         // bumped when the beds let go (fadeBeds): a piece still decoding from before never starts

  // The music bus has one owner (fix/double-music, 2026-11-06: two songs played at once after a mode switch): the player
  // whose song is on it now. The beds of this file own it by default (owner null). Cruise's playlist and Regatta's score
  // claim it (claimMusic(player)); the player that had it lets go at once (player.release(s): its song fades out over s,
  // anything it had pending is cancelled). A player that stops gives the bus back to the beds (yieldMusic(player)). The
  // beds cue on their own (the scheduler, arrive, vista, groove) only while they own it; the bar's next-song tap claims it.
  let owner = null;
  const bedsPlayer = { name: 'beds', release: (s) => fadeBeds(s) };
  function claimMusic(player = null, fadeS = MUSIC_XFADE_S) {
    const prev = owner ?? bedsPlayer, next = player ?? bedsPlayer;
    if (prev === next) return false;
    owner = next === bedsPlayer ? null : next;
    try { prev.release?.(fadeS); } catch { /* a player already gone */ }
    return true;
  }
  function yieldMusic(player) { if (player && owner === player) owner = null; }
  const bedsOwn = () => owner === null;

  async function decode(url) {
    return decodeFile(ctx, fetchFn, url);
  }

  function startLayer(k) {
    const L = layers[k];
    if (!L?.buf) return;
    L.src = new AudioBufferSourceNode(ctx, { buffer: L.buf, loop: true });
    L.src.connect(L.filter ?? L.gain);
    L.src.start(0, lastT % L.buf.duration);   // the loop's position follows the scene clock
  }

  // Must run inside a user gesture (a click, key or touch): creates the context, decodes the loops, starts them.
  // The master and every attached layer (the boat, the controls' sounds, the music) are built at once, in the gesture,
  // before any await: the key that started the sound is heard (sounds scheduled now play as the context resumes).
  let paused = false;   // the page is in the background: the context stays suspended
  const unlock = () => { if (ctx && !paused) playbackSession(); if (ctx && !paused && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
  async function suspend() { paused = true; if (ctx && ctx.state === 'running') { try { await ctx.suspend(); } catch { /* closed */ } } }
  async function resume() { paused = false; if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') { try { await ctx.resume(); } catch { /* needs a gesture: unlock() tries again */ } } }
  async function start() {
    if (started) return;
    started = true;
    playbackSession();   // iOS: the playback session, so the silent switch does not mute the game
    // a phone or tablet (fix/ios-start-2): 32 kHz and mono effects and beds, a third and then half the decoded PCM
    // (88 MB of beds at 48 kHz stereo); the music keeps its stereo (and streams on iOS). The Mac: 48 kHz as before.
    const phone = touchDevice();
    ctx = new Ctx({ sampleRate: phone ? 32000 : 48000 });
    if (phone) ctx.__lkMono = true;
    for (const k of UNLOCKERS) globalThis.addEventListener?.(k, unlock, true);
    ctx.addEventListener?.('statechange', () => { if (ctx.state === 'interrupted') ctx.resume().catch(() => {}); });
    master = new GainNode(ctx, { gain: muted ? 0 : MASTER });
    master.connect(ctx.destination);
    // the music bus runs through a duck stage (the skipper's voice lowers it while he speaks); the voice has a bus of its own
    duckNode = new GainNode(ctx, { gain: duckDb === 0 ? 1 : 10 ** (duckDb / 20) }); duckNode.connect(master);
    for (const k of Object.keys(busOn)) { buses[k] = new GainNode(ctx, { gain: busOn[k] ? BUS_LEVEL[k] * (k === 'music' ? musicVol : 1) : 0 }); buses[k].connect(k === 'music' ? duckNode : master); }
    buses.voice = new GainNode(ctx, { gain: 1 }); buses.voice.connect(master);
    for (const [fn, bus] of attached) fn({ ctx, master: buses[bus] ?? master });
    await ctx.resume();
    await afterCard();   // a phone: the beds wait for the card (src/ui/deferLoad.js)
    await Promise.all(LOOPS.map(async (k) => {
      const gain = new GainNode(ctx, { gain: mix.gains[k] });
      gain.connect(master);
      const filter = k === 'lake_lap' ? new BiquadFilterNode(ctx, { type: 'lowpass', frequency: mix.lakeLowpassHz, Q: 0.5 }) : null;
      filter?.connect(gain);
      layers[k] = { gain, filter, buf: await decode(urls[k]) };
      startLayer(k);
    }));
    const c = sched.playing(lastT);
    if (c && !played.has(c)) playBed(c);
    else if (arrivePending) { arrivePending = false; arrive(); }
  }

  function bedBuffer(bed, piece = null) {
    const url = piece ?? (Array.isArray(beds[bed]) ? beds[bed][0] : beds[bed]);
    if (!url) return Promise.resolve(null);
    // iOS: the piece streams (a stand-in with its duration, src/audioFormat.js); elsewhere the decoded buffer
    bedBufs[url] ??= (streamsMusic() ? streamFile(url) : decodeFile(ctx, fetchFn, url, undefined, { mono: false })).catch((e) => { log.push({ bed, piece: url, error: String(e.message ?? e) }); return null; });
    return bedBufs[url];
  }

  async function playBed(c) {
    if (!ctx || played.has(c) || !bedsOwn()) return;
    played.add(c);
    const gen = bedGen;
    const buf = await bedBuffer(c.bed, c.piece);
    if (gen !== bedGen || !bedsOwn()) return;   // let go while it decoded (a tap, a hand-over): it never starts
    const at = lastT - c.t;   // how far into the cue the scene clock is
    if (!buf || at >= Math.min(buf.duration, c.end - c.t)) return;
    const gain = new GainNode(ctx, { gain: 0 });
    gain.connect(buses.music ?? master);
    const src = sourceFor(ctx, buf);
    src.connect(gain);
    // the buffer goes once the piece has played (fix/ios-start: a decoded piece is ≈ 60 MB of PCM); a later cue decodes it again
    const url = c.piece ?? (Array.isArray(beds[c.bed]) ? beds[c.bed][0] : beds[c.bed]);
    src.onended = () => { if (bedBufs[url] && !bedNodes.some((n) => n.src !== src && n.url === url && !n.done)) delete bedBufs[url]; const me = bedNodes.find((n) => n.src === src); if (me) me.done = true; if (song?.node === me) song = null; };
    const now = ctx.currentTime, len = Math.min(buf.duration, c.end - c.t) - at;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(BED_LEVEL, now + Math.min(4, len / 3));
    gain.gain.setValueAtTime(BED_LEVEL, now + Math.max(0, len - 6));
    gain.gain.linearRampToValueAtTime(0, now + len);
    src.start(now, at);
    src.stop(now + len);
    const node = { src, gain, url };
    bedNodes.push(node);
    song = { id: ++songSeq, url, title: songTitle(url), node };
    log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, played: true });
  }

  // let the pieces playing go: fade out over s, then stop
  function fadeBeds(s) {
    bedGen++;
    if (!ctx) return;
    const now = ctx.currentTime;
    // a piece already fading out keeps its own end: a second let-go (a tap, then a hand-over) never stretches its tail
    for (const n of bedNodes) if (!n.done && !(n.goneAt <= now + s)) { try { n.gain.gain.cancelScheduledValues(now); n.gain.gain.setValueAtTime(n.gain.gain.value, now); n.gain.gain.linearRampToValueAtTime(0, now + s); n.src.stop(now + s + 0.05); n.goneAt = now + s; } catch { /* ended */ } }
    song = null;
  }

  // The bar's next song: the piece playing fades out over 1.5 s, a different one starts now (BedScheduler.skip); the normal
  // schedule resumes after it. Inside a tap, so the first one may start the sound itself. Returns the cue or null.
  function nextSong() {
    if (!started) start();
    if (!ctx) return null;
    held = false;
    const c = sched.skip(lastT, lastState);
    if (!c) return null;
    claimMusic(null, NEXT_FADE_S);   // the tap is the beds': another player's song fades out
    fadeBeds(NEXT_FADE_S);
    log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, skip: true });
    playBed(c);
    return c;
  }
  // The bar's pause: the piece stops (0.4 s) and the beds stay out until hold(false)
  function hold(on) {
    held = !!on;
    if (held) fadeBeds(0.4);
    return held;
  }
  // the music's volume 0–1 (the bar's slider), on top of the music bus's own level
  function setMusicVolume(v) {
    musicVol = clamp01(v);
    if (buses.music && busOn.music) buses.music.gain.setTargetAtTime(BUS_LEVEL.music * musicVol, ctx.currentTime, 0.1);
    return musicVol;
  }

  function cue(c) {
    log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, ...(c.place ? { place: c.place } : {}) });
    playBed(c);
  }

  // The entry into Sail (arriveOnEntry): a piece at once (BedScheduler.arrive). Before the context exists it waits for
  // start(), which runs in the same gesture, so the music starts on the gesture that enters Sail, never on a load clock.
  let arrivePending = false, lastState = {};
  function arrive() {
    if (!ctx) { arrivePending = true; return null; }
    if (held || !bedsOwn()) return null;
    const c = sched.arrive(lastT, lastState);
    if (c) cue(c);
    return c;
  }

  // Every frame: the scene time and the world state (worldState()).
  function update(t, state) {
    lastT = t; lastState = state ?? {};
    mix = mixAt(state);
    if (!held && bedsOwn()) for (const c of sched.update(t, state)) cue(c);
    if (!ctx) return mix;
    const now = ctx.currentTime;
    for (const k of LOOPS) layers[k]?.gain.gain.setTargetAtTime(mix.gains[k], now, 0.4);   // 0.4 s: smooth, not laggy
    layers.lake_lap?.filter?.frequency.setTargetAtTime(mix.lakeLowpassHz, now, 0.4);
    return mix;
  }

  // the groove's swell (src/boatAudio.js asks; the scheduler decides)
  function groove(t) {
    if (held || !bedsOwn()) return null;
    const c = sched.groove(t);
    if (!c) return null;
    log.push({ bed: 'groove', t });
    if (ctx && master && !muted && busOn.music) grooveSwell(ctx, buses.music ?? master, ctx.currentTime);
    return c;
  }

  function vista(t, place) {
    if (held || !bedsOwn()) return null;
    const c = sched.vista(t, place);
    if (c) cue(c);
    return c;
  }

  function stats() {
    return { started, muted: !ctx || ctx.state !== 'running', t: lastT, gains: mix.gains, lakeLowpassHz: mix.lakeLowpassHz, cues: sched.cues, log };
  }

  // Another sound layer joins this context and master: fn({ ctx, master }) runs when start() creates them (inside the
  // user gesture), or at once if they exist already. bus: 'effects' (the default: the boat, the controls' sounds) or
  // 'music'; `master` is then that bus, which feeds the master.
  function attach(fn, bus = 'effects') {
    attached.push([fn, bus]);
    if (ctx && master) fn({ ctx, master: buses[bus] ?? master });
  }
  // the menu's switches: setBus('music' | 'effects', on); kept if set before start
  function setBus(name, on) {
    if (!(name in busOn)) return null;
    busOn[name] = !!on;
    if (buses[name]) buses[name].gain.setTargetAtTime(on ? BUS_LEVEL[name] * (name === 'music' ? musicVol : 1) : 0, ctx.currentTime, 0.05);
    return busOn[name];
  }

  // The music ducks under a spoken line (the skipper's voice, src/ui/skipperVoice.js): db < 0 lowers the music bus over
  // attackS, duck(0) brings it back over releaseS. The gain follows the target exponentially (time constant = a third of the time).
  function duck(db = 0, { attackS = 0.3, releaseS = 1.2 } = {}) {
    duckDb = Math.min(0, db);
    if (!ctx || !duckNode) return duckDb;
    const tc = Math.max(0.01, (duckDb < 0 ? attackS : releaseS) / 3);
    duckNode.gain.setTargetAtTime(10 ** (duckDb / 20), ctx.currentTime, tc);
    return duckDb;
  }

  // M: mute for courtesy (the master fades over 0.15 s; kept if set before start)
  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
    return muted;
  }

  return { start, update, nextSong, hold, setMusicVolume, get held() { return held; }, get song() { return song ? { id: song.id, url: song.url, title: song.title } : null; }, get songId() { return songSeq; }, suspend, resume, unlock, arrive, get state() { return ctx?.state ?? 'none'; }, vista, groove, stats, attach, setMuted, setBus, duck, get duckDb() { return duckDb; }, bus: (name) => busOn[name], toggleMute: () => setMuted(!muted), get muted() { return muted; }, get started() { return started; }, scheduler: sched, claimMusic, yieldMusic, get musicHolder() { return owner?.name ?? 'beds'; } };
}
