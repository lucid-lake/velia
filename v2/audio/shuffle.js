// Shuffle (owner, 2026-11-14: "Can we play songs randomly so users don't get bored?"): the ten pieces (five songs, an A and a B
// take of each) as a shuffled deck. Every card plays once before any plays again; a new round never starts with the card that
// just played, and the A and the B of one song never play back to back (inside a round or across the reshuffle). The time of day
// weights the draw lightly (the morning's song twice as likely as any other), never exclusively. The order is seeded: the page's
// visit seed (src/visitSeed.js: crypto on a live page, ?seed= on a capture, a golden or a test), so a fixed seed gives the same
// order and a live visit a fresh one. No Math.random, no wall clock.
//
//   const deck = createDeck({ pieces, seed });   deck.draw(favoured) → a piece url    (favoured: a song stem, or null)
//   const s = new ShuffleScheduler({ seed, pieces });   on the audio clock (s): update, arrive, skip, ended, playing, cues
//   gapAt(seed, k) → 20–45 s of the lake alone before the k-th card (SHUFFLE.gapS)
//   favouredSong({ hour, windSpeed }) → the song the hour leans to
//   loadPick(store), savePick(store, 'shuffle' | 'time')   Setup › Sound › music (v2/ui/musicRow.js)

export const SHUFFLE = Object.freeze({
  gapS: [20, 45],   // the lake alone between two songs, real seconds (v1's silence-first gaps are 60–180 s at the game's 2×: v2/notes/audio.md § The music)
  favour: 2,        // the hour's song: each of its two takes weighs this much in a draw, every other card 1
  key: 'velia.musicPick.v1',
  picks: ['shuffle', 'time'],
  pick: 'shuffle',  // the default (owner, 2026-11-14)
});

// "/audio/music/first_light_b.opus" → "first_light" (the song: both takes share it)
export const songOf = (url) => String(url ?? '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/_[ab]$/, '');

function hash01(seed, i) {
  let h = (Math.imul(seed | 0, 0x2545f491) ^ Math.imul((i | 0) + 0x6a09e667, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// a seeded stream (mulberry32)
function rng(seed) {
  let a = (seed ^ 0x5f3759df) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const gapAt = (seed, k, [g0, g1] = SHUFFLE.gapS) => g0 + (g1 - g0) * hash01(seed, 0x9a7 + k);

// the song the world leans to (the beds' own windows, src/audio.js BedScheduler): the wind past 7 m/s, the morning calm, the golden
// hour, the night; the open lake's song through the day
export function favouredSong({ hour = 12, windSpeed = 0 } = {}) {
  if (windSpeed >= 7) return 'wind_rising';
  if (hour >= 5.9 && hour < 9) return 'first_light';
  if (hour >= 18.3 && hour < 20.7) return 'golden_hour';
  if (hour >= 20.7 || hour < 5.9) return 'dusk_water';
  return 'over_the_ridge';
}

// can these cards follow `last` with no song twice in a row? (five songs of at most two cards: a tiny search)
function orderable(songs, last) {
  const n = new Map();
  for (const s of songs) n.set(s, (n.get(s) ?? 0) + 1);
  const go = (lastS, left) => {
    if (!left) return true;
    for (const [s, c] of n) {
      if (!c || s === lastS) continue;
      n.set(s, c - 1); const ok = go(s, left - 1); n.set(s, c);
      if (ok) return true;
    }
    return false;
  };
  return go(last, songs.length);
}

export function createDeck({ pieces, seed = 1, favour = SHUFFLE.favour } = {}) {
  const all = [...pieces], song = all.map(songOf), next = rng(seed);
  let left = [], round = -1, last = -1, drawn = 0;
  return {
    // the next card: from the round's cards left, never the song that just played, never one that would force a song twice in a
    // row before the round ends; the hour's song weighs `favour`
    draw(favoured = null) {
      if (!left.length) { left = all.map((_, i) => i); round++; }
      const lastS = last >= 0 ? song[last] : null;
      let ok = left.filter((i) => song[i] !== lastS && orderable(left.filter((j) => j !== i).map((j) => song[j]), song[i]));
      if (!ok.length) ok = left.filter((i) => song[i] !== lastS);   // never reached with two takes a song (the tests sweep it)
      if (!ok.length) ok = left;
      const w = ok.map((i) => (song[i] === favoured ? favour : 1)), sum = w.reduce((a, b) => a + b, 0);
      let r = next() * sum, k = 0;
      while (k < ok.length - 1 && (r -= w[k]) >= 0) k++;
      const i = ok[k];
      left.splice(left.indexOf(i), 1); last = i; drawn++;
      return all[i];
    },
    get round() { return Math.max(0, round); }, get drawn() { return drawn; }, get left() { return left.map((i) => all[i]); },
  };
}

// Sail's shuffle on the audio clock (the page's AudioContext time, real seconds: the gaps are a listener's, not the game's 2×). The
// same calls as the beds' scheduler (src/audio.js BedScheduler), so v2/audio/music.js plays its cues the same way. A cue's end is
// open (Infinity) until the piece really ends (music.js: ended(now) when the last piece stops, or when a piece fails to load);
// then the next card waits a gap. out: Cruise holds it (its own playlist plays).
export class ShuffleScheduler {
  constructor({ seed = 1, pieces, gapS = SHUFFLE.gapS, favour = SHUFFLE.favour } = {}) {
    Object.assign(this, { seed, gapS, pieces: [...pieces] });
    this.deck = createDeck({ pieces, seed, favour });
    this.cues = [];
    this.gapScale = 1;              // a page test's fast clock (music.js pace)
    this.next = this.gap(0);        // the first card waits one gap after the sound starts, if no entry cues one first
    this.out = false;
  }
  gap(k) { return gapAt(this.seed, k, this.gapS) * this.gapScale; }
  playing(now) { const c = this.cues[this.cues.length - 1]; return c && now < c.end ? c : null; }
  update(now, state = {}) {
    if (this.out || now < this.next || this.playing(now)) return [];
    return [this.cue(now, state)];
  }
  // the gesture into Sail: a card at once, unless one plays
  arrive(now, state = {}) { return this.out || this.playing(now) ? null : this.cue(now, state); }
  // the bar's Next song: the next card now; the one playing ends here (the caller fades it out)
  skip(now, state = {}) { const p = this.playing(now); if (p) p.end = now; return this.cue(now, state); }
  // the last piece stopped at `now` (its end, a fade, a failed load, the bus handed back): the next card after a gap
  // (a card still loading counts as playing: its own end comes later). rest(now): the music bus came back (Cruise's playlist, the
  // fireworks or the radio let go): the same gap
  ended(now) { if (!this.playing(now)) this.next = now + this.gap(this.cues.length); return this.next; }
  rest(now) { return this.ended(now); }
  vista() { return null; }   // the open lake's swell is the beds'; the deck plays songs only
  cue(now, state = {}) {
    const piece = this.deck.draw(favouredSong(state));
    const c = { bed: 'shuffle', t: now, end: Infinity, piece, clock: 'audio' };
    this.cues.push(c);
    this.next = Infinity;   // until the piece ends
    return c;
  }
}

// Setup › Sound › music: Shuffle (default) or By time of day (the beds' scheduler, today's behaviour); its own key, as Regatta's
// level (v2/sim/raceLevels.js), since v1's settings store keeps only v1's keys
// the page's store (a browser's localStorage; none in node, where touching globalThis.localStorage only warns)
export const pageStore = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
export function loadPick(store = pageStore()) {
  try { const v = store?.getItem?.(SHUFFLE.key); return SHUFFLE.picks.includes(v) ? v : SHUFFLE.pick; } catch { return SHUFFLE.pick; }
}
export function savePick(store = pageStore(), pick) {
  if (!SHUFFLE.picks.includes(pick)) return loadPick(store);
  try { store?.setItem?.(SHUFFLE.key, pick); } catch { /* private mode: this page only */ }
  return pick;
}
