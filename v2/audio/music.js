// v2's music (BACKLOG-v2 #7, #7a): v1's pieces at v1's times and moods, on the page's AudioContext (v2/engine/audio.js), with
// v1's own logic imported as it is: the silence-first scheduler and its pools (src/audio.js BedScheduler, src/core/sailMusic.js
// SAIL_BEDS: dawn, wind, vista, golden, night), the entry piece (arrive), the groove's swell (grooveSwell, asked by v1's boat
// engine), the bar's Music (src/musicControl.js createBedMusic: next song, pause, volume), Cruise's playlist (src/modes/chill/
// music.js createMusic) and the fireworks evening's pieces and the boat's radio (src/fireworks/music.js, v2/audio/fireworks.js).
// What src/audio.js createAudio does with the music, here on v2's context: the buses (music through the duck, effects, voice),
// the bus's one owner (claimMusic / yieldMusic), the pieces' fades, M and Settings' sound, music and effects.
//
// Memory (#7a): a piece streams through an <audio> element and a MediaElementSource (src/audioFormat.js streamFile + sourceFor,
// v1's iOS path, on every device in v2: setStreamMusic(true)): only its metadata is read before it plays, nothing is decoded
// whole (a 3-minute stereo piece is ≈ 69 MB of PCM at 48 kHz). An OfflineAudioContext (the proof clip) decodes instead.
// Nothing loads before the first gesture (the context exists only then) and the first frame (the scheduler runs in the frame).
//
//   const music = createMusic({ audio, settings, seed, musicSeed, base });   // audio: v2/engine/audio.js's page sound
//   music.update(t, { hour, windSpeed })     // every frame: the scene clock (s) and the world at the listener (v1's worldState)
//   music.arrive()                            // the gesture that enters Sail (arriveOnEntry): a piece at once
//   music.groove(t)                           // v1's boat engine's 'swell' event (recorded.js passes it)
//   music.player                              // what the top bar's Music drives (the beds in Sail, the playlist in Cruise)
//   music.setMode('cruise' | 'sail', { finish })   // Cruise's music (v2/notes/audio.md § The music: the API for Cruise)
//   music.core                                // v1's audio contract for v1's players: attach(fn, bus), claimMusic, yieldMusic, duck, …
//   music.setPick('shuffle' | 'time')         // Setup › Sound › music (v2/ui/musicRow.js): the shuffle (default) or the beds by time of day
//   music.pace({ pieceS, gapScale })          // a page test's fast clock: each shuffled piece cut at pieceS, the gaps scaled
//
// Shuffle (owner, 2026-11-14; v2/audio/shuffle.js): in Sail the pieces come from a seeded deck (all ten before any again, never the A
// and B of one song back to back, the hour's song weighed lightly), each played whole, 20–45 s of the lake between them on the audio
// clock; Next song is the next card. Cruise's playlist takes the deck too (v2/audio/playlist.js). By time of day is today's: v1's
// scheduler and v1's playlist. A race (race()) keeps the beds' scheduler whatever the pick: Regatta does not join the shuffle.
import { BedScheduler, grooveSwell, BUS_LEVELS, MASTER, NEXT_FADE_S, MUSIC_XFADE_S, BED_LEVEL } from '../../src/audio.js';
import { SAIL_BEDS } from '../../src/core/sailMusic.js';
import { decodeFile, streamFile, sourceFor, streamsMusic } from '../../src/audioFormat.js';
import { songTitle, createBedMusic } from '../../src/musicControl.js';
import { createMusic as createPlaylist, BEDS as CRUISE_BEDS } from '../../src/modes/chill/music.js';
import { ShuffleScheduler, SHUFFLE, loadPick, pageStore } from './shuffle.js';
import { createShufflePlaylist } from './playlist.js';

export const MODES = Object.freeze(['sail', 'cruise']);
export const CRUISE_HANDBACK_S = 240;   // v1's hand-over to Sail (src/modes/chill/handover.js): the beds wait this long after it
import { clamp01 } from '../../src/sim/core/math.js';
// v1's absolute '/audio/…' paths under the page's base (dist-v2 may not sit at a host's root)
export const rebase = (url, base) => String(url).replace(/^\/audio\//, base);
export const sailBeds = (base = '/audio/') => Object.fromEntries(Object.entries(SAIL_BEDS).map(([k, v]) => [k, v.map((u) => rebase(u, base))]));
export const cruiseBeds = (base = '/audio/') => CRUISE_BEDS.map((u) => rebase(u, base));
// every file the music may play (the vite config serves and copies these)
export const MUSIC_FILES = Object.freeze([...new Set([...Object.values(SAIL_BEDS).flat(), ...CRUISE_BEDS])].map((u) => u.split('/').pop().replace(/\.opus$/, '')));

// audio: { ready: Promise<{ ctx, master }>, start(), master } (engine/audio.js; an offline render passes its own)
// stream: play the pieces through media elements (default: src/audioFormat.js streamsMusic(): v2's live page sets it on)
// pick: 'shuffle' | 'time' (default: the stored choice, loadPick(pickStore), else Shuffle); race: () => a race is on (main.js)
export function createMusic({ audio, settings = null, seed = 1, musicSeed = seed, base = '/audio/', stream = null, fetchFn = (u) => fetch(u), scheduler = null, setTimer, pick = null, pickStore = pageStore(), race = () => false } = {}) {
  const beds = sailBeds(base);
  const sched = scheduler ?? new BedScheduler({ seed, pieceSeed: musicSeed, pools: beds });
  const shuffle = new ShuffleScheduler({ seed: musicSeed, pieces: cruiseBeds(base) });
  let pickNow = SHUFFLE.picks.includes(pick) ? pick : loadPick(pickStore), capS = Infinity;
  const raceOn = () => { try { return !!race(); } catch { return false; } };
  const shuffling = () => pickNow === 'shuffle' && !raceOn();
  const active = () => (shuffling() ? shuffle : sched);
  const now = () => ctx?.currentTime ?? 0;   // the shuffle's clock: the audio's, real seconds
  let ctx = null, master = null, duckNode = null, duckDb = 0, lastT = 0, lastState = {}, muted = settings ? settings.get('sound') === false : false;
  let held = false, musicVol = 1, songSeq = 0, song = null, bedGen = 0, owner = null, mode = 'sail', playlist = null, arrivePending = false;
  const buses = {}, busOn = { music: settings ? settings.get('music') !== false : true, effects: settings ? settings.get('effects') !== false : true };
  const attached = [], bedBufs = {}, bedNodes = [], log = [], played = new WeakSet(), follows = [];
  const loads = { streamed: 0, decoded: 0, errors: 0, skipped: 0 };
  const streaming = () => (stream ?? streamsMusic());

  // ---- the bus's one owner (v1's claimMusic / yieldMusic): the beds by default; Cruise's playlist and the fireworks claim it
  const bedsPlayer = { name: 'beds', release: (s) => fadeBeds(s) };
  function claimMusic(player = null, fadeS = MUSIC_XFADE_S) {
    const prev = owner ?? bedsPlayer, next = player ?? bedsPlayer;
    if (prev === next) return false;
    owner = next === bedsPlayer ? null : next;
    try { prev.release?.(fadeS); } catch { /* a player already gone */ }
    if (!owner && ctx) shuffle.rest(now());   // the bus back: the shuffle waits a gap (a tap's own card is already playing)
    return true;
  }
  const yieldMusic = (player) => { if (player && owner === player) { owner = null; if (ctx) shuffle.rest(now()); } };
  const bedsOwn = () => owner === null;

  // ---- the context: the buses, built once in the gesture's task (v1's start(), after its own context)
  audio.ready.then(({ ctx: c, master: m }) => {
    ctx = c; master = m;
    master.gain.setValueAtTime(muted ? 0 : MASTER, ctx.currentTime);
    duckNode = new GainNode(ctx, { gain: duckDb === 0 ? 1 : 10 ** (duckDb / 20) }); duckNode.connect(master);
    for (const k of Object.keys(busOn)) { buses[k] = new GainNode(ctx, { gain: busOn[k] ? BUS_LEVELS[k] * (k === 'music' ? musicVol : 1) : 0 }); buses[k].connect(k === 'music' ? duckNode : master); }
    buses.voice = new GainNode(ctx, { gain: 1 }); buses.voice.connect(master);
    for (const [fn, bus] of attached) fn({ ctx, master: busFor(bus) });
    for (const f of follows) f.set(muted);
    const c0 = shuffling() ? null : sched.playing(lastT);
    if (c0 && !played.has(c0)) playBed(c0);
    else if (arrivePending) { arrivePending = false; arrive(); }
  });
  const busFor = (bus) => buses[bus] ?? master;   // 'world' (the fireworks' shells, as v1's): the master itself

  // ---- the pieces (v1's playBed, fadeBeds): streamed on a live page, decoded offline
  function bedBuffer(bed, piece = null) {
    const url = piece ?? beds[bed]?.[0];
    if (!url) return Promise.resolve(null);
    bedBufs[url] ??= (streaming() ? streamFile(url).then((b) => { loads.streamed++; return b; }) : decodeFile(ctx, fetchFn, url, undefined, { mono: false }).then((b) => { loads.decoded++; return b; }))
      .catch((e) => { loads.errors++; log.push({ bed, piece: url, error: String(e?.message ?? e) }); return null; });
    return bedBufs[url];
  }
  // a shuffled card (c.clock 'audio') plays whole from the top (or to pace's pieceS); its cue's end is set when it really starts, and
  // whenever the last piece stops (its end, a fade, a failed load) the shuffle waits a gap from then (ShuffleScheduler.ended)
  const sounding = (except = null) => bedNodes.some((n) => !n.done && n.src !== except);
  const shuffleSounding = () => bedNodes.some((n) => !n.done && n.shuffle);
  const dropped = (c) => { if (c.clock !== 'audio' || !ctx) return; c.end = Math.min(c.end, ctx.currentTime); if (!sounding()) shuffle.ended(ctx.currentTime); };
  // music off (Settings' sound or music, or M): a cue passes silently and its piece is never fetched (owner
  // 2026-11-17: "the music bed downloads only when music is on"; every device); the shuffle's gap runs from it, so the next cue after
  // the music comes back on plays
  const musicHeard = () => !muted && busOn.music;
  async function playBed(c) {
    if (!ctx || played.has(c) || !bedsOwn()) return dropped(c);
    if (!musicHeard()) { played.add(c); loads.skipped++; log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, off: true }); return dropped(c); }
    played.add(c);
    const gen = bedGen, buf = await bedBuffer(c.bed, c.piece);
    if (gen !== bedGen || !bedsOwn()) return dropped(c);   // let go while it loaded (a tap, a hand-over): it never starts
    const card = c.clock === 'audio', at = card ? 0 : lastT - c.t;
    if (!buf || at >= Math.min(buf.duration, card ? capS : c.end - c.t)) return dropped(c);
    const gain = new GainNode(ctx, { gain: 0 }); gain.connect(buses.music ?? master);
    const src = sourceFor(ctx, buf); src.connect(gain);
    const url = c.piece ?? beds[c.bed]?.[0];
    src.onended = () => {
      if (bedBufs[url] && !bedNodes.some((n) => n.src !== src && n.url === url && !n.done)) delete bedBufs[url];
      const me = bedNodes.find((n) => n.src === src); if (me) me.done = true; if (song?.node === me) song = null;
      if (!sounding()) {   // the lake alone from now: the shuffle's gap starts here; after a shuffled piece the beds wait their shortest gap
        const t = ctx.currentTime;
        if (card && c.end > t) c.end = t;
        shuffle.ended(t);
        if (me?.shuffle && !shuffling()) sched.next = Math.max(sched.next, lastT + sched.gapS[0]);
      }
    };
    const now = ctx.currentTime, len = card ? Math.min(buf.duration, capS) : Math.min(buf.duration, c.end - c.t) - at;
    if (card) { c.t = now; c.end = now + len; }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(BED_LEVEL, now + Math.min(4, len / 3));
    gain.gain.setValueAtTime(BED_LEVEL, now + Math.max(0, len - 6));
    gain.gain.linearRampToValueAtTime(0, now + len);
    src.start(now, at); src.stop(now + len);
    const node = { src, gain, url, streamed: !!src.streamed, shuffle: card };
    bedNodes.push(node);
    song = { id: ++songSeq, url, title: songTitle(url), node };
    log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, played: true, streamed: node.streamed });
  }
  function fadeBeds(s) {
    bedGen++;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const n of bedNodes) if (!n.done && !(n.goneAt <= now + s)) { try { n.gain.gain.cancelScheduledValues(now); n.gain.gain.setValueAtTime(n.gain.gain.value, now); n.gain.gain.linearRampToValueAtTime(0, now + s); n.src.stop(now + s + 0.05); n.goneAt = now + s; } catch { /* ended */ } }
    song = null;
  }
  const cue = (c) => { log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, ...(c.place ? { place: c.place } : {}) }); playBed(c); };

  // ---- the bar's controls (v1's nextSong, hold, setMusicVolume)
  function nextSong() {
    audio.start?.();
    if (!ctx) return null;
    held = false;
    const s = active(), c = s === shuffle ? shuffle.skip(now(), lastState) : sched.skip(lastT, lastState);
    if (!c) return null;
    claimMusic(null, NEXT_FADE_S);
    fadeBeds(NEXT_FADE_S);
    log.push({ bed: c.bed, ...(c.piece ? { piece: c.piece } : {}), t: c.t, skip: true });
    playBed(c);
    return c;
  }
  function hold(on) { held = !!on; if (held) fadeBeds(0.4); return held; }
  function setMusicVolume(v) {
    musicVol = clamp01(v);
    if (buses.music && busOn.music) buses.music.gain.setTargetAtTime(BUS_LEVELS.music * musicVol, ctx.currentTime, 0.1);
    return musicVol;
  }
  // the entry into Sail (src/audio.js arriveOnEntry): a piece at once; before the context exists it waits for it
  function arrive() {
    if (!ctx) { arrivePending = true; return null; }
    if (held || !bedsOwn()) return null;
    const c = shuffling() ? (sounding() ? null : shuffle.arrive(now(), lastState)) : sched.arrive(lastT, lastState);
    if (c) cue(c);
    return c;
  }
  // every frame: the scene clock and { hour, windSpeed } at the listener (v1's worldState)
  function update(t, state = {}) {
    lastT = t; lastState = state;
    if (held || !bedsOwn()) return;
    if (shuffling()) { if (ctx && !sounding()) for (const c of shuffle.update(now(), state)) cue(c); }
    else if (!shuffleSounding()) for (const c of sched.update(t, state)) cue(c);   // a shuffled piece plays out before the beds (a race, a switch)
  }
  function groove(t) {
    if (held || !bedsOwn() || (shuffling() && sounding())) return null;   // the swell never over a piece
    const c = sched.groove(t);
    if (!c) return null;
    log.push({ bed: 'groove', t });
    if (ctx && master && !muted && busOn.music) grooveSwell(ctx, buses.music ?? master, ctx.currentTime);
    return c;
  }
  function vista(t, place) { if (held || !bedsOwn() || shuffling()) return null; const c = sched.vista(t, place); if (c) cue(c); return c; }
  // Setup › Sound › music: the pick changes from the next piece on (the one playing plays out)
  function setPick(p) {
    if (!SHUFFLE.picks.includes(p) || p === pickNow) return pickNow;
    pickNow = p;
    if (p === 'shuffle' && ctx && !sounding()) shuffle.rest(now());
    if (playlist && mode === 'cruise' && !!playlist.shuffle !== (p === 'shuffle')) { playlist.stop(); startPlaylist(); }   // Cruise's playlist follows
    return pickNow;
  }
  function pace({ pieceS = Infinity, gapScale = 1 } = {}) { capS = Math.max(1, pieceS); shuffle.gapScale = Math.max(0.01, gapScale); if (ctx && !sounding()) shuffle.rest(now()); return { pieceS: capS, gapScale: shuffle.gapScale }; }

  // ---- the switches (v1's setBus, setMuted, duck); Settings' rows follow
  function setBus(name, on) {
    if (!(name in busOn)) return null;
    busOn[name] = !!on;
    if (buses[name]) buses[name].gain.setTargetAtTime(on ? BUS_LEVELS[name] * (name === 'music' ? musicVol : 1) : 0, ctx.currentTime, 0.05);
    return busOn[name];
  }
  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
    for (const f of follows) f.set(muted);
    return muted;
  }
  function duck(db = 0, { attackS = 0.3, releaseS = 1.2 } = {}) {
    duckDb = Math.min(0, db);
    if (!ctx || !duckNode) return duckDb;
    duckNode.gain.setTargetAtTime(10 ** (duckDb / 20), ctx.currentTime, Math.max(0.01, (duckDb < 0 ? attackS : releaseS) / 3));
    return duckDb;
  }
  // another context's master that the sound switch and M mute too (the birds' own door, v2/engine/birdAudio.js)
  function follow(gainNode, level = 1) {
    const f = { set: (m) => { try { gainNode.gain.setTargetAtTime(m ? 0 : level, gainNode.context.currentTime, 0.05); } catch { /* closed */ } } };
    follows.push(f); f.set(muted);
  }
  function attach(fn, bus = 'effects') { attached.push([fn, bus]); if (ctx) fn({ ctx, master: busFor(bus) }); }

  if (settings) settings.on?.((k, v) => {
    if (k === 'sound') setMuted(v === false);
    else if (k === 'music') setBus('music', v !== false);
    else if (k === 'effects') setBus('effects', v !== false);
  });

  // v1's audio contract (src/audio.js createAudio's api, the parts v1's players read)
  const core = {
    attach, claimMusic, yieldMusic, setBus, setMuted, duck, nextSong, hold, setMusicVolume, arrive, update, groove, vista,
    start: () => audio.start?.(),
    toggleMute: () => setMuted(!muted),
    bus: (name) => busOn[name],
    get muted() { return muted; }, get held() { return held; }, get duckDb() { return duckDb; },
    get song() { return song ? { id: song.id, url: song.url, title: song.title } : null; }, get songId() { return songSeq; },
    get started() { return !!ctx; }, get state() { return ctx?.state ?? 'none'; },
    get musicHolder() { return owner?.name ?? 'beds'; },
    scheduler: sched, shuffle,
  };
  const bedMusic = createBedMusic(core, () => settings);

  // ---- Cruise (v2/notes/audio.md § The music: the API for Cruise): v1's playlist claims the bus; the beds stay out until Sail again
  function setMode(m, { finish = false } = {}) {
    if (!MODES.includes(m) || m === mode) return mode;
    mode = m;
    if (m === 'cruise') {
      sched.next = Infinity;   // v1 src/modes/chill/passenger.js: the core's silence-first beds stay out of Cruise
      shuffle.out = true;      // and the shuffle's cards
      startPlaylist();
    } else {
      shuffle.out = false;     // the shuffle waits a gap once the playlist gives the bus back (yieldMusic → rest)
      if (finish) playlist?.finish(); else playlist?.stop();   // finish: the piece playing plays out (v1's hand-over); stop: fades over 1.5 s
      sched.next = lastT + CRUISE_HANDBACK_S;
    }
    return mode;
  }
  // Cruise's playlist: on Shuffle the deck's (v2/audio/playlist.js), By time of day v1's own (src/modes/chill/music.js)
  function startPlaylist() {
    const o = { audio: core, seed: musicSeed, settings: () => settings, urls: cruiseBeds(base), fetchFn, ...(setTimer ? { setTimer } : {}) };
    playlist = pickNow === 'shuffle' ? createShufflePlaylist({ ...o, state: () => lastState, stream }) : createPlaylist(o);
    playlist.start();
  }

  return {
    core, update, arrive, groove, vista, setMode, follow, setPick, pace,
    get mode() { return mode; },
    get pick() { return pickNow; },
    get shuffling() { return shuffling(); },
    get playlist() { return playlist; },
    // the top bar's Music (src/ui/viewSwitch.js music: () => player): the beds in Sail, the playlist in Cruise
    get player() { return mode === 'cruise' && playlist ? playlist : bedMusic; },
    stats() {
      return { started: !!ctx, state: ctx?.state ?? 'none', mode, holder: owner?.name ?? 'beds', muted, buses: { ...busOn }, held, volume: musicVol, t: +lastT.toFixed(2),
        song: core.song, pick: pickNow, shuffling: shuffling(), cues: active().cues.map((c) => ({ bed: c.bed, piece: c.piece?.split('/').pop() ?? null, t: +c.t.toFixed(2), end: +c.end.toFixed(2), ...(c.clock ? { clock: c.clock } : {}) })), next: active().next,
        shuffle: { cues: shuffle.cues.length, round: shuffle.deck.round, drawn: shuffle.deck.drawn, next: +shuffle.next.toFixed(2), now: +now().toFixed(2), gapScale: shuffle.gapScale, pieceS: capS },
        grooves: (sched.grooves ?? []).length, loads: { ...loads }, streaming: streaming(), log: log.slice(-20), playlist: playlist?.stats() ?? null };
    },
  };
}

// The fireworks' audio door before the music exists (v2/living/fireworksPlugin.js is built before the page's sound): v1's attach
// contract, queued until bind(music) (main.js), then forwarded to the music's core: one context, one music bus with one owner.
export function createLateCore() {
  let core = null, music = null, settings = null;
  const waiting = [];
  return {
    bind(m, s = null) { music = m; core = m.core; settings = s; for (const [fn, bus] of waiting.splice(0)) core.attach(fn, bus); return this; },
    attach(fn, bus = 'effects') { if (core) core.attach(fn, bus); else waiting.push([fn, bus]); },
    claimMusic(p, s) { return core?.claimMusic(p, s) ?? false; },
    yieldMusic(p) { core?.yieldMusic(p); },
    start() { core?.start(); },
    get state() { return core?.state ?? 'none'; },
    radioOn: () => settings?.get?.('boatRadio') === true,
    mode: () => music?.mode ?? 'sail',
  };
}
