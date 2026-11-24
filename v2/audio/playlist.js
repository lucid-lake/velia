// Cruise's playlist on Shuffle (v2/audio/shuffle.js): v1's playlist (src/modes/chill/music.js createMusic: 4 s in, 6 s out, 6–18 s
// of the lake between pieces, the music bus's player, the passenger's next / pause / volume) with the deck as its order: every card
// once before any again, never the A and B of one song back to back, the hour's song weighed lightly. v1's file stays as it is (v1
// is frozen); By time of day keeps v1's own playlist (v2/audio/music.js setMode). The same API as v1's createMusic.
//
//   const p = createShufflePlaylist({ audio: core, urls, seed, settings: () => s, state: () => ({ hour, windSpeed }) });
//   p.start(); p.finish(); p.stop(); p.next(); p.pause(); p.resume(); p.toggle(); p.setVolume(v); p.stats()
import { decodeFile, streamsMusic, streamFile, sourceFor } from '../../src/audioFormat.js';
import { songTitle, soundOff, soundOn } from '../../src/musicControl.js';
import { MUSIC_XFADE_S } from '../../src/audio.js';
import { MUSIC, gapAt } from '../../src/modes/chill/music.js';
import { createDeck, favouredSong } from './shuffle.js';

const UI = { fadeNextS: 1.2, fadePauseS: 0.4, resumeInS: 1 };   // v1's MUSIC_UI

export function createShufflePlaylist({ audio, settings = () => null, urls, seed = 1, state = () => ({}), fetchFn = globalThis.fetch?.bind(globalThis), setTimer = globalThis.setTimeout?.bind(globalThis), volume = 1, stream = null } = {}) {
  let ctx = null, out = null, started = false, stopped = false, k = 0, current = null, finishing = false, paused = false, resumeAt = null, epoch = 0, vol = volume;
  const bufs = new Map(), errors = [], played = [], dead = new Set();
  const deck = createDeck({ pieces: urls, seed });
  const index = new Map(urls.map((u, i) => [u, i]));
  const player = { name: 'cruise', release(s) { stopped = true; epoch++; paused = false; resumeAt = null; fadeOutCurrent(s); } };
  const giveBack = () => audio.yieldMusic?.(player);
  const level = () => MUSIC.level * vol;
  const streaming = () => (stream ?? streamsMusic());

  function load(i) {
    if (!bufs.has(i)) bufs.set(i, streaming() ? streamFile(urls[i]) : decodeFile(ctx, fetchFn, urls[i], undefined, { mono: false }));
    return bufs.get(i);
  }
  function startPiece(i, n, buf, offset = 0) {
    const e = epoch, now = ctx.currentTime, rem = buf.duration - offset, inS = offset > 0 ? UI.resumeInS : MUSIC.fadeInS;
    const src = sourceFor(ctx, buf), g = new GainNode(ctx, { gain: 0 });
    src.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + Math.min(inS, rem));
    g.gain.setValueAtTime(1, now + Math.max(inS, rem - MUSIC.fadeOutS));
    g.gain.linearRampToValueAtTime(0, now + rem);
    src.start(now, offset);
    current = { i, n, src, g, t0: now - offset, len: buf.duration };
    if (!offset) played.push({ piece: urls[i].split('/').pop(), at: +now.toFixed(1) });
    src.onended = () => {
      if (current?.src === src) current = null;
      if (!(paused && resumeAt?.i === i)) bufs.delete(i);
      if (finishing || stopped) { stopped = true; giveBack(); }
      else if (!paused) setTimer(() => { if (e === epoch) playNext(); }, gapAt(seed, n) * 1000);
    };
  }
  async function playNext() {
    if (stopped || finishing || paused) return;
    if (dead.size >= urls.length) { stopped = true; return; }
    const e = epoch, i = index.get(deck.draw(favouredSong(state() ?? {}))), n = k++;
    if (dead.has(i)) return playNext();
    let buf;
    try { buf = await load(i); } catch (err) { dead.add(i); errors.push(String(err?.message ?? err)); return playNext(); }
    if (stopped || finishing || e !== epoch) return;
    if (paused) { resumeAt = { i, n, off: 0 }; return; }
    startPiece(i, n, buf);
  }
  function fadeOutCurrent(s) {
    const c = current; if (!c) return null;
    current = null; c.src.onended = null;
    try { const now = ctx.currentTime; c.g.gain.cancelScheduledValues(now); c.g.gain.setValueAtTime(c.g.gain.value, now); c.g.gain.linearRampToValueAtTime(0, now + s); c.src.stop(now + s + 0.05); } catch { /* ended */ }
    return c;
  }

  return {
    shuffle: true,
    start() {
      if (started) return;
      started = true;
      audio.claimMusic?.(player);
      audio.attach(({ ctx: c, master }) => { ctx = c; out = new GainNode(ctx, { gain: level() }); out.connect(master); playNext(); }, 'music');
      audio.start?.();
    },
    finish() { finishing = true; epoch++; if (!current) { stopped = true; giveBack(); } },
    stop() { stopped = true; epoch++; paused = false; resumeAt = null; if (ctx) fadeOutCurrent(MUSIC_XFADE_S); giveBack(); },
    next() {
      if (!started || stopped || finishing || !ctx) return false;
      epoch++; paused = false; resumeAt = null;
      const had = fadeOutCurrent(UI.fadeNextS), e = epoch;
      if (had) bufs.delete(had.i);
      setTimer(() => { if (e === epoch) playNext(); }, had ? (UI.fadeNextS + 0.1) * 1000 : 0);
      return true;
    },
    pause() {
      if (!started || stopped || finishing || paused || !ctx) return false;
      paused = true; epoch++;
      const c = fadeOutCurrent(UI.fadePauseS);
      resumeAt = c ? { i: c.i, n: c.n, off: Math.max(0, Math.min(c.len - 1, ctx.currentTime - c.t0)) } : null;
      return true;
    },
    resume() {
      if (!started || stopped || finishing || !paused || !ctx) return false;
      paused = false; epoch++;
      const r = resumeAt; resumeAt = null;
      if (r && bufs.has(r.i)) bufs.get(r.i).then((b) => { if (!paused && !stopped && !finishing) startPiece(r.i, r.n, b, r.off); });
      else playNext();
      return true;
    },
    toggle() { return paused ? this.resume() : this.pause(); },
    setVolume(v) { vol = Math.min(1, Math.max(0, v)); if (out) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.1); return vol; },
    get volume() { return vol; }, get paused() { return paused; },
    get songId() { return played.length; },
    get off() { return soundOff(audio, settings()); },
    turnOn() { soundOn(audio, settings()); },
    get title() { return current ? songTitle(urls[current.i]) : resumeAt ? songTitle(urls[resumeAt.i]) : ''; },
    stats() { return { started, stopped, finishing, paused, volume: vol, playing: !!current, piece: current ? urls[current.i].split('/').pop() : null, played, errors, shuffle: true }; },
  };
}
