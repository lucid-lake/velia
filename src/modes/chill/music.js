import { decodeFile, streamsMusic, streamFile, sourceFor } from '../../audioFormat.js';
import { songTitle, soundOff, soundOn } from '../../musicControl.js';
import { MUSIC_XFADE_S } from '../../audio.js';
// Chill's music: the beds as a playlist, on by default, under nothing and over the boat and the lake (the core's
// ambience loops and the boat's own sound keep playing beneath). Each piece fades in over 4 s and out over 6 s,
// then 6–18 s of the lake alone, then the next; the order is a seeded shuffle (a seed per visit: src/visitSeed.js) that never repeats either of the last two pieces.
// It joins the core's audio context and master (audio.attach), so it starts inside the first gesture with the rest.
// A piece that fails to load is logged and skipped; when every piece has failed the playlist stops and the lake plays
// alone. The playlist owns the music bus while it runs (src/audio.js claimMusic: Sail's bed fades out as it starts; a
// later owner, the next Cruise or the bar's next-song tap in Sail, fades this one out) and gives it back when it stops.
//
//   const music = createMusic({ audio: core.audio, seed });
//   music.start();             // inside the first click or key (the browser's rule)
//   music.finish();            // let the piece playing end, then stop (the hand-over to Day Sail)
//   music.next(); music.pause(); music.resume(); music.toggle(); music.setVolume(0..1);   // the passenger's plate
//   music.stats();             // { started, playing, paused, volume, piece, played, errors }

// The pieces (audio/music/, tools/music_pack.py: −23 LUFS each; ATTRIBUTION.md § Music): both takes of each brief.
export const BEDS = [
  '/audio/music/over_the_ridge_a.opus',
  '/audio/music/first_light_a.opus',
  '/audio/music/wind_rising_a.opus',
  '/audio/music/over_the_ridge_b.opus',
  '/audio/music/first_light_b.opus',
  '/audio/music/wind_rising_b.opus',
  '/audio/music/golden_hour_a.opus',
  '/audio/music/dusk_water_a.opus',
  '/audio/music/golden_hour_b.opus',
  '/audio/music/dusk_water_b.opus',
];
export const MUSIC = { level: 1, fadeInS: 4, fadeOutS: 6, gapS: [6, 18] };

function hash01(seed, i) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((i | 0) + 0x7f4a7c15, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// the k-th piece's index: a fresh shuffle of all n every round, the first of a round never the last of the one before
export function pieceAt(seed, k, n) {
  const round = Math.floor(k / n), order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(hash01(seed * 131 + round, i) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  // a round's first two never repeat either of the last two of the round before (fix/regressions, 2026-10-30): move them back
  if (round > 0 && n > 3) {
    const prev = [pieceAt(seed, round * n - 1, n), pieceAt(seed, round * n - 2, n)];
    for (let i = 0; i < 2; i++) if (prev.includes(order[i])) { const j = order.findIndex((p, x) => x >= 2 && !prev.includes(p)); [order[i], order[j]] = [order[j], order[i]]; }
  } else if (round > 0 && n > 1) {
    const prev = pieceAt(seed, round * n - 1, n);
    if (order[0] === prev) [order[0], order[1]] = [order[1], order[0]];
  }
  return order[k % n];
}
export const gapAt = (seed, k) => MUSIC.gapS[0] + (MUSIC.gapS[1] - MUSIC.gapS[0]) * hash01(seed * 7 + 3, k);

// "over_the_ridge_a.opus" → "Over the ridge" (the plate's line)
export const pieceTitle = songTitle;   // the real title (src/musicControl.js)
const MUSIC_UI = { fadeNextS: 1.2, fadePauseS: 0.4, resumeInS: 1 };

export function createMusic({ audio, settings = () => null, urls = BEDS, seed = 1, fetchFn = globalThis.fetch?.bind(globalThis), setTimer = globalThis.setTimeout?.bind(globalThis), volume = 1 } = {}) {
  let ctx = null, out = null, started = false, stopped = false, k = 0, current = null, finishing = false, paused = false, resumeAt = null, epoch = 0, vol = volume;
  const bufs = new Map(), errors = [], played = [];
  const dead = new Set();
  // this playlist as the music bus's player: another owner's claim lets go of it (the piece fades out over s, nothing follows)
  const player = { name: 'cruise', release(s) { stopped = true; epoch++; paused = false; resumeAt = null; fadeOutCurrent(s); } };
  const giveBack = () => audio.yieldMusic?.(player);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const level = () => MUSIC.level * vol;

  async function load(i) {
    if (!bufs.has(i)) bufs.set(i, (async () => {
      return streamsMusic() ? streamFile(urls[i]) : decodeFile(ctx, fetchFn, urls[i], undefined, { mono: false });   // iOS streams (src/audioFormat.js)
    })());
    return bufs.get(i);
  }

  // one piece from `offset` s: faded in (over 4 s from the top, 1 s mid-piece), faded out over its last 6 s
  function startPiece(i, n, buf, offset = 0) {
    const e = epoch, now = ctx.currentTime, len = buf.duration, rem = len - offset, inS = offset > 0 ? MUSIC_UI.resumeInS : MUSIC.fadeInS;
    const src = sourceFor(ctx, buf), g = new GainNode(ctx, { gain: 0 });
    src.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + Math.min(inS, rem));
    g.gain.setValueAtTime(1, now + Math.max(inS, rem - MUSIC.fadeOutS));
    g.gain.linearRampToValueAtTime(0, now + rem);
    src.start(now, offset);
    current = { i, n, src, g, t0: now - offset, len };
    if (!offset) played.push({ piece: urls[i].split('/').pop(), at: +now.toFixed(1) });
    src.onended = () => {
      if (current?.src === src) current = null;
      if (!(paused && resumeAt?.i === i)) bufs.delete(i);   // the piece has played: its PCM goes (fix/ios-start); a later turn decodes it again
      if (finishing || stopped) { stopped = true; giveBack(); }
      else if (!paused) setTimer(() => { if (e === epoch) playNext(); }, gapAt(seed, n) * 1000);
    };
  }

  async function playNext() {
    if (stopped || finishing || paused) return;
    if (dead.size >= urls.length) { stopped = true; return; }   // nothing loads (a production build): the lake alone
    const e = epoch, i = pieceAt(seed, k, urls.length), n = k++;
    if (dead.has(i)) return playNext();
    let buf;
    try { buf = await load(i); } catch (err) { dead.add(i); errors.push(String(err.message ?? err)); return playNext(); }
    if (stopped || finishing || e !== epoch) return;
    if (paused) { resumeAt = { i, n, off: 0 }; return; }
    startPiece(i, n, buf);
  }

  // let go of the piece playing: fade it out over `s`, its end no longer schedules the next
  function fadeOutCurrent(s) {
    const c = current; if (!c) return null;
    current = null; c.src.onended = null;
    try { const now = ctx.currentTime; c.g.gain.cancelScheduledValues(now); c.g.gain.setValueAtTime(c.g.gain.value, now); c.g.gain.linearRampToValueAtTime(0, now + s); c.src.stop(now + s + 0.05); } catch { /* ended */ }
    return c;
  }

  return {
    // inside a user gesture: the core's audio starts (its context and master), then the first piece
    start() {
      if (started) return;
      started = true;
      audio.claimMusic?.(player);   // the bus is the playlist's now: the piece another player had fades out
      audio.attach(({ ctx: c, master }) => {
        ctx = c;
        out = new GainNode(ctx, { gain: level() }); out.connect(master);
        playNext();
      }, 'music');   // the music bus: the menu's music switch
      audio.start();
    },
    // the piece playing plays on and keeps the bus to its end (the hand-over to Sail): nothing follows it
    finish() { finishing = true; epoch++; if (!current) { stopped = true; giveBack(); } },
    // the mode goes: the piece fades out over the bus's crossfade, the bus goes back to the beds
    stop() { stopped = true; epoch++; paused = false; resumeAt = null; if (ctx) fadeOutCurrent(MUSIC_XFADE_S); giveBack(); },
    // the passenger's plate (src/ui/passengerPlate.js): next piece, pause and play, volume 0–1
    next() {
      if (!started || stopped || finishing || !ctx) return false;
      epoch++; paused = false; resumeAt = null;
      const had = fadeOutCurrent(MUSIC_UI.fadeNextS), e = epoch;
      if (had) bufs.delete(had.i);   // the skipped piece's PCM goes too
      setTimer(() => { if (e === epoch) playNext(); }, had ? (MUSIC_UI.fadeNextS + 0.1) * 1000 : 0);
      return true;
    },
    pause() {
      if (!started || stopped || finishing || paused || !ctx) return false;
      paused = true; epoch++;
      const c = fadeOutCurrent(MUSIC_UI.fadePauseS);
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
    setVolume(v) { vol = clamp01(v); if (out) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.1); return vol; },
    get volume() { return vol; }, get paused() { return paused; },
    get songId() { return played.length; },   // pieces started: the bar's caption shows when it changes
    get off() { return soundOff(audio, settings()); },
    turnOn() { soundOn(audio, settings()); },   // settings(): the shell's (the 'settings' service), or none
    get title() { return current ? pieceTitle(urls[current.i]) : resumeAt ? pieceTitle(urls[resumeAt.i]) : ''; },
    stats() { return { started, stopped, finishing, paused, volume: vol, playing: !!current, piece: current ? urls[current.i].split('/').pop() : null, played, errors }; },
  };
}
