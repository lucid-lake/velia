// The bar's music control (src/ui/viewSwitch.js ♪ and ⏭): the bed skip in the scheduler (BedScheduler.skip) and the engine
// (createAudio.nextSong / hold), the titles, the metrics event. The bar itself (♪ ⏭, the title, the event it sends, the
// player each mode hands it): tests/pages/musicNext.page.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BedScheduler, createAudio } from '../src/audio.js';
import { SAIL_BEDS } from '../src/core/sailMusic.js';
import { songTitle, TITLES, createBedMusic, soundOff } from '../src/musicControl.js';
import { EVENTS, createMetrics } from '../src/metrics.js';

const calm = { hour: 6.5, windSpeed: 2 };

test('skip: a different piece now, never one of the last two, the world\'s bed first, seeded', () => {
  const s = new BedScheduler({ seed: 1, pieceSeed: 7, pools: SAIL_BEDS });
  const a = s.arrive(10, calm);
  assert.equal(a.bed, 'dawn');
  const seen = [a.piece];
  for (let i = 0; i < 12; i++) {
    const c = s.skip(20 + i, calm);
    assert.ok(c && c.t === 20 + i, 'a cue at the tap');
    assert.ok(!seen.slice(-2).includes(c.piece), `${c.piece} repeats one of ${seen.slice(-2)}`);
    assert.ok(Object.values(SAIL_BEDS).some((p) => p.includes(c.piece)), 'a piece of a pool');
    seen.push(c.piece);
  }
  // the world's bed has 3 pieces: with 2 blocked one is left, so the first skip stays in 'dawn'
  const w = new BedScheduler({ seed: 1, pieceSeed: 7, pools: SAIL_BEDS }); w.arrive(0, calm);
  assert.equal(w.skip(5, calm).bed, 'dawn');
  // the same seed and the same taps give the same pieces
  const r = (seed) => { const q = new BedScheduler({ seed: 1, pieceSeed: seed, pools: SAIL_BEDS }); q.arrive(0, calm); return [1, 2, 3, 4].map((i) => q.skip(i, calm).piece); };
  assert.deepEqual(r(3), r(3));
});

test('skip: the piece playing is cut short, the normal gaps follow, nothing playing is fine', () => {
  const s = new BedScheduler({ seed: 1, pieceSeed: 2, pools: SAIL_BEDS });
  const first = s.arrive(100, { hour: 13, windSpeed: 3 });
  assert.equal(s.playing(110), first);
  const c = s.skip(110, { hour: 13, windSpeed: 3 });
  assert.equal(first.end, 110, 'the old cue ends at the tap');
  assert.equal(s.playing(111), c);
  assert.ok(s.next >= c.end + s.gapS[0], 'silence after the new piece');
  const cold = new BedScheduler({ seed: 1, pieceSeed: 2, pools: SAIL_BEDS });   // beds out of the way (firstS): a tap still plays
  assert.ok(cold.skip(5, { hour: 13 }), 'music from a standstill');
  // no hour fits and the world has no pool: any pool
  const wide = new BedScheduler({ seed: 1, pieceSeed: 2, pools: { vista: ['/a.opus', '/b.opus', '/c.opus'] } });
  assert.ok(['/a.opus', '/b.opus', '/c.opus'].includes(wide.skip(1, calm).piece));
  // no pools at all: the bed itself
  assert.equal(new BedScheduler({ seed: 1 }).skip(1, calm).bed, 'dawn');
});

function fakeEngine() {
  const events = [];
  class Param { constructor() { this.value = 0; } setValueAtTime() {} linearRampToValueAtTime(v, t) { events.push(['ramp', v, t]); } cancelScheduledValues() {} setTargetAtTime() {} }
  class Node { constructor() { this.gain = new Param(); this.frequency = new Param(); } connect() { return this; } }
  class Src extends Node { constructor(_c, o) { super(); this.buffer = o?.buffer; } start() { events.push(['start', this.buffer?.url]); } stop(t) { events.push(['stop', this.buffer?.url, t]); } }
  const g = globalThis, keep = { GainNode: g.GainNode, AudioBufferSourceNode: g.AudioBufferSourceNode, BiquadFilterNode: g.BiquadFilterNode };
  Object.assign(g, { GainNode: Node, AudioBufferSourceNode: Src, BiquadFilterNode: Node });
  class Ctx { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } async resume() {} addEventListener() {} async decodeAudioData(ab) { return { duration: 200, url: ab.url }; } }
  const fetchFn = async (url) => ({ ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(8), { url }) });
  return { events, Ctx, fetchFn, restore: () => Object.assign(g, keep) };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('nextSong: fades the piece out over 1.5 s and starts another; the title and the id follow; hold keeps the beds out', async () => {
  const E = fakeEngine();
  try {
    const audio = createAudio({ Ctx: E.Ctx, fetchFn: E.fetchFn, beds: SAIL_BEDS, musicSeed: 5 });
    await audio.start();
    audio.update(50, { hour: 6.5, windSpeed: 2, shoreDist: -200 });
    const a = audio.arrive(); await tick();
    const first = audio.song;
    assert.ok(first && first.title && !/\.opus|\//.test(first.title), `a real title: ${first?.title}`);
    assert.equal(audio.songId, 1);
    const c = audio.nextSong(); await tick();
    assert.ok(c.piece && c.piece !== a.piece);
    assert.equal(audio.songId, 2, 'a second piece started');
    assert.notEqual(audio.song.url, first.url);
    assert.ok(E.events.some((e) => e[0] === 'stop' && e[1] === a.piece), 'the first piece was stopped');
    assert.ok(E.events.some((e) => e[0] === 'ramp' && e[1] === 0 && Math.abs(e[2] - 1.5) < 1e-9), 'faded out over 1.5 s');
    // pause: the piece goes and the scheduler stays quiet until play
    assert.equal(audio.hold(true), true);
    assert.equal(audio.song, null);
    audio.update(5000, { hour: 6.5, windSpeed: 2 }); await tick();
    assert.equal(audio.songId, 2, 'no bed while held');
    // play: a piece at once
    const bar = createBedMusic(audio);
    assert.equal(bar.paused, true);
    bar.toggle(); await tick();
    assert.equal(bar.paused, false);
    assert.equal(audio.songId, 3);
    assert.ok(bar.title);
  } finally { E.restore(); }
});

test('the bar\'s next turns the music on first (M, or the Settings switch), and a tap before the sound started starts it', async () => {
  const E = fakeEngine();
  try {
    const audio = createAudio({ Ctx: E.Ctx, fetchFn: E.fetchFn, beds: SAIL_BEDS, musicSeed: 5 });
    const store = { sound: false, music: false }, settings = { get: (k) => store[k], set: (k, v) => { store[k] = v; if (k === 'sound') audio.setMuted(!v); if (k === 'music') audio.setBus('music', v); } };
    audio.setMuted(true); audio.setBus('music', false);
    const bar = createBedMusic(audio, () => settings);
    assert.equal(bar.off, true);
    const c = bar.next(); await tick();
    assert.ok(c, 'the first tap started the sound and a piece');
    assert.equal(bar.off, false);
    assert.deepEqual(store, { sound: true, music: true });
    assert.equal(audio.songId, 1);
    assert.equal(soundOff(audio), false);
  } finally { E.restore(); }
});

test('titles: real ones for the shipped pieces, a short name otherwise, never a filename', () => {
  assert.equal(songTitle('/audio/music/first_light_b.opus'), 'Lake at first light');
  assert.equal(songTitle('/audio/music/dusk_water_a.opus'), 'Dusk over the water');
  assert.equal(songTitle('/audio/music/some_new_tune_a.opus'), 'Some new tune');
  for (const u of Object.values(SAIL_BEDS).flat()) assert.ok(TITLES[u.split('/').pop().replace(/\.opus$/, '').replace(/_[ab]$/, '')], u);
});

test('metrics: music_next is an allowed event with the mode (the bar sends it: tests/pages/musicNext.page.mjs)', () => {
  assert.deepEqual(EVENTS.music_next, ['mode']);
  const sent = [];
  const M = createMetrics({ env: { search: '?metrics=1', hostname: 'velia.lucidlakelabs.com' }, send: (u, body) => sent.push(JSON.parse(body)), setTimer: () => 1, clearTimer: () => {} });
  assert.equal(M.track('music_next', { mode: 'cruise', title: 'not sent' }), true);
  M.flush();
  assert.deepEqual(sent.flatMap((b) => b.e), [{ n: 'music_next', p: { mode: 'cruise' } }], 'the mode only');
});
