// Shuffle (owner, 2026-11-14: "Can we play songs randomly so users don't get bored?"; v2/audio/shuffle.js, playlist.js, music.js,
// ui/musicRow.js): the deck plays all ten pieces before any repeats; no piece twice in a row and never the A and B of one song back to
// back, inside a round or across the reshuffle; the gaps stay in 20–45 s; Next song skips to the next card; a race keeps the beds'
// scheduler (Regatta does not join the shuffle); Setup's row switches the pick and stores it; a fixed seed gives the same order.
// A stand-in Web Audio (node has none) runs the music's engine on a hand-set audio clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio as createV1Audio } from '../../src/audio.js';
import { SAIL_BEDS } from '../../src/core/sailMusic.js';
import { URLS as RACE_URLS } from '../../classic/src/modes/regatta/raceMusic.js';
import { createDeck, ShuffleScheduler, gapAt, favouredSong, songOf, SHUFFLE, loadPick, savePick } from '../audio/shuffle.js';
import { createMusic, cruiseBeds } from '../audio/music.js';
import { mountMusicRow } from '../ui/musicRow.js';

const PIECES = cruiseBeds('/audio/');
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// the hour the deck sees as it draws: a day moving on, so the weighting changes through each sequence
const hourAt = (k) => (5 + k * 0.7) % 24;

test('the deck: all ten pieces before any repeats, every round, for 300 seeds', () => {
  assert.equal(PIECES.length, 10);
  assert.equal(new Set(PIECES.map(songOf)).size, 5, 'five songs, two takes each');
  for (let seed = 1; seed <= 300; seed++) {
    const d = createDeck({ pieces: PIECES, seed });
    for (let round = 0; round < 6; round++) {
      const got = Array.from({ length: 10 }, (_, j) => d.draw(favouredSong({ hour: hourAt(round * 10 + j) })));
      assert.deepEqual([...got].sort(), [...PIECES].sort(), `seed ${seed} round ${round}: each piece once`);
    }
  }
});

test('the deck: never the same piece or the A and B of one song back to back, across the reshuffle too (2000 seeds, 8 rounds)', () => {
  let boundaries = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const d = createDeck({ pieces: PIECES, seed });
    let prev = null;
    for (let k = 0; k < 80; k++) {
      const p = d.draw(favouredSong({ hour: hourAt(k), windSpeed: k % 13 === 0 ? 8 : 2 }));
      if (prev) assert.notEqual(songOf(p), songOf(prev), `seed ${seed} card ${k}: ${prev} then ${p}`);
      if (k % 10 === 0 && k) boundaries++;
      prev = p;
    }
  }
  assert.equal(boundaries, 2000 * 7);
});

test('the deck: a fixed seed gives the same order; another seed another order', () => {
  const run = (seed) => { const d = createDeck({ pieces: PIECES, seed }); return Array.from({ length: 30 }, (_, k) => d.draw(favouredSong({ hour: hourAt(k) }))); };
  assert.deepEqual(run(7), run(7));
  assert.deepEqual(run(90210), run(90210));
  assert.notDeepEqual(run(7), run(8));
  // the music's own scheduler: the same seed, the same cards
  const s = (seed) => { const x = new ShuffleScheduler({ seed, pieces: PIECES }); return Array.from({ length: 12 }, (_, k) => x.cue(k * 100, { hour: 12 }).piece); };
  assert.deepEqual(s(42), s(42));
});

test('the deck: the hour weighs its song lightly, never exclusively', () => {
  const N = 4000, first = new Map();
  for (let seed = 1; seed <= N; seed++) { const p = songOf(createDeck({ pieces: PIECES, seed }).draw(favouredSong({ hour: 7 }))); first.set(p, (first.get(p) ?? 0) + 1); }
  const share = first.get('first_light') / N;
  assert.ok(share > 0.28 && share < 0.39, `first light opens a 07:00 visit ${(share * 100).toFixed(1)} % of the time (uniform 20 %, the weight 2: 33 %)`);
  for (const s of ['over_the_ridge', 'wind_rising', 'golden_hour', 'dusk_water']) assert.ok(first.get(s) / N > 0.12, `${s} still opens ${(first.get(s) / N * 100).toFixed(1)} %`);
  assert.equal(favouredSong({ hour: 7 }), 'first_light'); assert.equal(favouredSong({ hour: 19 }), 'golden_hour');
  assert.equal(favouredSong({ hour: 21.5 }), 'dusk_water'); assert.equal(favouredSong({ hour: 13 }), 'over_the_ridge');
  assert.equal(favouredSong({ hour: 13, windSpeed: 8 }), 'wind_rising');
});

test('the gaps: 20–45 s of the lake alone, spread across the range', () => {
  const g = Array.from({ length: 5000 }, (_, k) => gapAt(12345, k));
  assert.ok(g.every((x) => x >= SHUFFLE.gapS[0] && x <= SHUFFLE.gapS[1]), 'every gap in 20–45 s');
  assert.ok(Math.min(...g) < 21 && Math.max(...g) > 44, `the whole range used (${Math.min(...g).toFixed(1)}–${Math.max(...g).toFixed(1)} s)`);
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  assert.ok(Math.abs(mean - 32.5) < 1, `mean ${mean.toFixed(1)} s`);
});

// ---- the music's engine on a stand-in Web Audio: sources end when the test says so
function fakeAudio() {
  const sources = [];
  const param = (v = 0) => ({ value: v, target: v, setValueAtTime(x) { this.target = x; }, setTargetAtTime(x) { this.target = x; }, linearRampToValueAtTime(x) { this.target = x; }, cancelScheduledValues() {} });
  const ctx = { currentTime: 0, state: 'running', sampleRate: 48000, destination: {}, decodeAudioData: async () => ({ duration: 150, numberOfChannels: 2, length: 150 * 48000, sampleRate: 48000 }) };
  class Node { constructor(c, o = {}) { this.context = c; Object.assign(this, o); } connect(n) { return n; } disconnect() {} }
  globalThis.GainNode = class extends Node { constructor(c, o = {}) { super(c); this.gain = param(o.gain ?? 1); } };
  globalThis.AudioBufferSourceNode = class extends Node { constructor(c, o) { super(c, o); this.stopAt = null; sources.push(this); } start(when, off) { this.startAt = when; this.offset = off; } stop(when) { this.stopAt = when; } };
  globalThis.OscillatorNode = class extends Node { start() {} stop() {} };
  globalThis.BiquadFilterNode = class extends Node { constructor(c, o) { super(c, o); this.frequency = param(350); } };
  const master = new GainNode(ctx, { gain: 0.8 });
  let resolve; const ready = new Promise((r) => { resolve = r; });
  const audio = { ready, start() {}, open: () => resolve({ ctx, master }) };
  const fetchFn = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
  // move the audio clock to t; every source whose stop time has come ends (its onended), as the browser's would
  const advance = (t) => { ctx.currentTime = t; for (const s of sources) if (!s.ended && s.stopAt != null && s.stopAt <= t) { s.ended = true; s.onended?.(); } };
  return { ctx, audio, fetchFn, sources, advance };
}
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };

test('Sail on Shuffle: songs play whole, each followed by a 20–45 s gap on the audio clock, the deck\'s order (measured)', async () => {
  const F = fakeAudio();
  const m = createMusic({ audio: F.audio, seed: 1, musicSeed: 5, base: '/audio/', stream: false, fetchFn: F.fetchFn, pickStore: memStore() });
  assert.equal(m.pick, 'shuffle', 'Shuffle by default');
  F.audio.open(); await settle();
  m.update(0, { hour: 13, windSpeed: 2 }); m.arrive(); await settle();
  const ref = createDeck({ pieces: PIECES, seed: 5 });
  const gaps = [], titles = [];
  let t = 0;
  for (let i = 0; i < 12; i++) {
    const c = m.core.shuffle.cues[i];
    assert.ok(c, `card ${i} cued`);
    assert.equal(c.piece, ref.draw(favouredSong({ hour: 13, windSpeed: 2 })), `card ${i} is the deck's`);
    assert.equal(c.end - c.t, 150, 'the whole piece (150 s here), not the beds\' 120 s');
    titles.push(m.player.title);
    const end = c.end;
    F.advance(end); await settle();   // the piece's own end; then the lake alone, a frame each 0.5 s, until the next card
    for (t = end; t < end + 60; t += 0.5) { F.advance(t); m.update(t * 2, { hour: 13, windSpeed: 2 }); if (m.core.shuffle.cues.length > i + 1) { await settle(); break; } }
    if (i < 11) { const n = m.core.shuffle.cues[i + 1]; gaps.push(n.t - end); }
  }
  assert.ok(gaps.every((g) => g >= 20 && g <= 45.5), `gaps ${gaps.map((g) => g.toFixed(1)).join(', ')} s`);
  assert.equal(new Set(m.core.shuffle.cues.slice(0, 10).map((c) => c.piece)).size, 10, 'all ten in the first round');
  assert.ok(titles.every((x) => x), 'the bar shows each title');
  assert.equal(m.core.scheduler.cues.length, 0, 'the beds\' scheduler stays out');
  console.log(`  measured gaps (s): ${gaps.map((g) => g.toFixed(1)).join(', ')}`);
});

test('Next song: the next card at once, the one playing fades; pause and play resumes with the next card', async () => {
  const F = fakeAudio();
  const m = createMusic({ audio: F.audio, seed: 1, musicSeed: 11, base: '/audio/', stream: false, fetchFn: F.fetchFn, pickStore: memStore() });
  F.audio.open(); await settle();
  m.update(0, { hour: 13 }); m.arrive(); await settle();
  const ref = createDeck({ pieces: PIECES, seed: 11 });
  const first = m.core.shuffle.cues[0];
  assert.equal(first.piece, ref.draw(favouredSong({ hour: 13 })));
  F.advance(30);
  const c = m.player.next(); await settle();
  assert.ok(c && c.piece === ref.draw(favouredSong({ hour: 13 })), 'next: the deck\'s next card');
  assert.notEqual(songOf(c.piece), songOf(first.piece), 'never the same song');
  assert.equal(first.end, 30, 'the skipped piece ends at the tap');
  assert.equal(F.sources[0].stopAt, 30 + 1.5 + 0.05, 'and fades over 1.5 s');
  assert.equal(m.stats().song.url, c.piece);
  F.advance(32); m.update(64, { hour: 13 }); await settle();
  assert.equal(m.core.shuffle.cues.length, 2, 'the fade\'s end does not cue a third (the new card plays)');
  m.player.toggle(); assert.ok(m.player.paused);
  m.player.toggle(); await settle();
  assert.equal(m.core.shuffle.cues.length, 3, 'play again: the next card');
  assert.equal(m.core.shuffle.cues[2].piece, ref.draw(favouredSong({ hour: 13 })));
});

test('Regatta is unaffected: a race keeps the beds\' scheduler, v1\'s cues, no shuffled card; its race tracks are not in the deck', async () => {
  const { audio } = fakeAudio();
  for (const seed of [1, 7]) {
    const v1 = createV1Audio({ beds: SAIL_BEDS, seed, musicSeed: seed });
    const v2 = createMusic({ audio, seed, musicSeed: seed, base: '/audio/', pickStore: memStore(), race: () => true });
    assert.equal(v2.pick, 'shuffle'); assert.equal(v2.shuffling, false, 'the pick is Shuffle, but a race does not shuffle');
    for (let t = 0; t < 7200; t += 0.5) { const st = { hour: 5 + (t / 7200) * 18.5, windSpeed: 3 }; v1.update(t, st); v2.update(t, st); }
    assert.deepEqual(v2.core.scheduler.cues.map((c) => [c.bed, c.piece, c.t]), v1.scheduler.cues.map((c) => [c.bed, c.piece, c.t]), `seed ${seed}: v1's cues in the race`);
    assert.equal(v2.core.shuffle.cues.length, 0);
  }
  assert.ok(Object.values(RACE_URLS).every((u) => !PIECES.includes(u)), 'the pre-start and race pieces are not cards');
  // a race that starts mid-song: the song plays out; the beds wait for it
  const F = fakeAudio();
  let race = false;
  const m = createMusic({ audio: F.audio, seed: 1, musicSeed: 3, base: '/audio/', stream: false, fetchFn: F.fetchFn, pickStore: memStore(), race: () => race });
  F.audio.open(); await settle();
  m.update(0, { hour: 13 }); m.arrive(); await settle();
  race = true; F.advance(20); m.update(500, { hour: 13, windSpeed: 9 }); await settle();
  assert.equal(m.core.scheduler.cues.length, 0, 'no bed over the song');
  F.advance(151); m.update(800, { hour: 13, windSpeed: 9 }); await settle();
  assert.ok(m.core.scheduler.next >= 500 + m.core.scheduler.gapS[0], 'after it, the beds wait their shortest gap');
});

test('Cruise shuffles too: the deck\'s order on Shuffle, v1\'s playlist By time of day', async () => {
  const F = fakeAudio();
  const timers = [];
  const m = createMusic({ audio: F.audio, seed: 4, musicSeed: 4, base: '/audio/', stream: false, fetchFn: F.fetchFn, pickStore: memStore(), setTimer: (f, ms) => timers.push([f, ms]) });
  F.audio.open(); await settle();
  m.update(0, { hour: 13 });
  m.setMode('cruise'); await settle();
  assert.ok(m.playlist.shuffle, 'the shuffle playlist');
  assert.equal(m.core.musicHolder, 'cruise');
  for (let i = 0; i < 25; i++) { const s = F.sources.at(-1); s.onended?.(); const [f, ms] = timers.shift(); assert.ok(ms >= 6000 && ms <= 18000, `v1's 6–18 s between Cruise pieces (${ms} ms)`); f(); await settle(); }
  const order = m.playlist.stats().played.map((p) => `/audio/music/${p.piece}`);
  assert.equal(order.length, 26);
  assert.deepEqual([...order.slice(0, 10)].sort(), [...PIECES].sort(), 'all ten before a repeat');
  for (let i = 1; i < order.length; i++) assert.notEqual(songOf(order[i]), songOf(order[i - 1]), `${order[i - 1]} then ${order[i]}`);
  const ref = createDeck({ pieces: PIECES, seed: 4 });
  assert.deepEqual(order, order.map(() => ref.draw(favouredSong({ hour: 13 }))), 'the deck\'s order (seeded)');
  m.setMode('sail');
  assert.equal(m.core.musicHolder, 'beds');
  // By time of day: v1's playlist
  const G = fakeAudio();
  const t = createMusic({ audio: G.audio, seed: 4, base: '/audio/', stream: false, fetchFn: G.fetchFn, pick: 'time', setTimer: () => {} });
  G.audio.open(); await settle(); t.setMode('cruise');
  assert.ok(!t.playlist.shuffle, 'v1\'s own playlist');
});

test('Setup\'s row: Shuffle and By time of day on the Sound tab, stored, and the music follows', async () => {
  const el = (tag) => { const n = { tagName: tag, children: [], dataset: {}, attrs: {}, listeners: {}, parent: null, className: '', id: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener() {},
    appendChild(c) { c.parent = this; this.children.push(c); return c; }, insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }, get nextSibling() { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] ?? null : null; },
    contains(x) { let c = x; while (c) { if (c === this) return true; c = c.parent; } return false; },
    set innerHTML(h) { this.children = []; for (const m of h.matchAll(/<button[^>]*data-mp="([^"]+)"[^>]*>([^<]*)</g)) { const b = el('button'); b.dataset.mp = m[1]; b.text = m[2]; this.appendChild(b); } },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
    querySelectorAll(sel) { const out = []; const walk = (x) => { for (const c of x.children) { if (match(c, sel)) out.push(c); walk(c); } }; walk(this); return out; } };
    return n; };
  const match = (n, sel) => { let m = sel.match(/^#([\w-]+)$/); if (m) return n.id === m[1]; m = sel.match(/^\[data-set="(\w+)"\]$/); if (m) return n.dataset.set === m[1]; if (sel === '[data-mp]') return n.dataset.mp != null; return false; };
  const root = el('div'), panel = el('div'); panel.id = 'tp-set-sound'; root.appendChild(panel);
  const soundRow = el('div'); soundRow.dataset.set = 'sound'; panel.appendChild(soundRow);
  const voiceRow = el('div'); voiceRow.dataset.set = 'skipperVoice'; panel.appendChild(voiceRow);
  const st = memStore();
  const F = fakeAudio();
  const music = createMusic({ audio: F.audio, base: '/audio/', stream: false, fetchFn: F.fetchFn, pickStore: st });
  const row = mountMusicRow(root, { store: st, music, doc: { createElement: el } });
  assert.ok(row && panel.children[1] === row.row, 'under the sound switches, above the skipper\'s voice');
  const btn = (v) => row.row.querySelectorAll('[data-mp]').find((b) => b.dataset.mp === v);
  assert.deepEqual(row.row.querySelectorAll('[data-mp]').map((b) => b.text), ['shuffle', 'by time of day']);
  assert.equal(btn('shuffle').getAttribute('aria-checked'), 'true', 'Shuffle by default'); assert.equal(music.pick, 'shuffle');
  row.row.listeners.click({ target: { closest: () => btn('time') }, stopPropagation() {} });
  assert.equal(loadPick(st), 'time', 'stored'); assert.equal(music.pick, 'time', 'the music follows'); assert.equal(btn('time').getAttribute('aria-checked'), 'true');
  assert.equal(createMusic({ audio: F.audio, base: '/audio/', pickStore: st }).pick, 'time', 'a new page starts By time of day');
  row.row.listeners.click({ target: { closest: () => btn('shuffle') }, stopPropagation() {} });
  assert.equal(loadPick(st), 'shuffle'); assert.equal(music.pick, 'shuffle');
  assert.equal(mountMusicRow(root, { store: st, music, doc: { createElement: el } }), null, 'mounted once');
  assert.equal(savePick(st, 'nonsense'), 'shuffle', 'an unknown pick is refused');
  assert.equal(loadPick({ getItem: () => { throw new Error('blocked'); } }), 'shuffle', 'a blocked store: the default');
  row.dispose(); assert.equal(panel.children.length, 2);
});
