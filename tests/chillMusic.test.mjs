// Chill's music (src/modes/chill/music.js): a seeded playlist with no piece twice in a row, and a playlist that stops
// quietly when nothing loads (the drafts are local-only: a production build 404s them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pieceAt, gapAt, createMusic, BEDS, MUSIC } from '../src/modes/chill/music.js';

test('the order: every piece once a round, never the same twice running, the same for a seed', () => {
  for (const seed of [1, 2, 7]) {
    const seq = Array.from({ length: 60 }, (_, k) => pieceAt(seed, k, 6));
    for (let r = 0; r < 10; r++) assert.deepEqual([...seq.slice(r * 6, r * 6 + 6)].sort(), [0, 1, 2, 3, 4, 5]);
    for (let k = 1; k < seq.length; k++) assert.notEqual(seq[k], seq[k - 1], `seed ${seed} at ${k}`);
    assert.deepEqual(seq, Array.from({ length: 60 }, (_, k) => pieceAt(seed, k, 6)));
  }
  assert.notDeepEqual(Array.from({ length: 6 }, (_, k) => pieceAt(1, k, 6)), Array.from({ length: 6 }, (_, k) => pieceAt(2, k, 6)));
  for (let k = 0; k < 20; k++) { const g = gapAt(1, k); assert.ok(g >= MUSIC.gapS[0] && g <= MUSIC.gapS[1]); }
});

class FakeNode { constructor(ctx, o = {}) { this.o = o; this.gain = { setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }; } connect() {} start() { this.started = true; } stop() {} }

test('nothing loads (production): every piece is tried once in each format (Opus, then AAC), logged, and the lake plays alone', async () => {
  globalThis.GainNode = FakeNode; globalThis.AudioBufferSourceNode = FakeNode;
  const tried = [];
  const ctx = { currentTime: 0, decodeAudioData: async () => ({ duration: 120 }) };
  const audio = { attach(fn) { this.fn = fn; }, start() { this.fn({ ctx, master: new FakeNode() }); } };
  const music = createMusic({ audio, seed: 3, fetchFn: async (u) => { tried.push(u); return { ok: false, status: 404 }; }, setTimer: () => {} });
  music.start();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const s = music.stats();
  assert.equal(s.stopped, true);
  assert.equal(s.errors.length, BEDS.length);
  assert.equal(new Set(tried).size, BEDS.length * 2);   // each .opus and its .m4a twin, once
  assert.ok(tried.every((u) => /\.(opus|m4a)$/.test(u)));
  assert.ok(s.errors[0].includes('404'));
});

test('a piece that loads plays, fades in and out, and finish() lets it end', async () => {
  globalThis.GainNode = FakeNode; globalThis.AudioBufferSourceNode = FakeNode;
  const ctx = { currentTime: 5, decodeAudioData: async () => ({ duration: 120 }) };
  const audio = { attach(fn) { this.fn = fn; }, start() { this.fn({ ctx, master: new FakeNode() }); } };
  const music = createMusic({ audio, seed: 1, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }), setTimer: () => {} });
  music.start();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.equal(music.stats().playing, true);
  assert.equal(music.stats().played.length, 1);
  music.finish();
  assert.equal(music.stats().finishing, true);
});
