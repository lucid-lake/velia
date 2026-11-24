// fix/ios-start-2: what a phone fetches only once the card is live; the skipper's first clips first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterCard, cardLive } from '../src/ui/deferLoad.js';
import { createSkipperVoice } from '../src/ui/skipperVoice.js';

test('a desktop gets everything at once; a phone waits for the card', async () => {
  const g = { __veliaLoading: { state: 'company' }, addEventListener() {}, removeEventListener() {} };
  assert.equal(await afterCard({ g, phone: false }), true);
  let done = false; const p = afterCard({ g, phone: true, maxMs: 5000 }).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 50)); assert.equal(done, false);
  g.__veliaLoading.state = 'home'; await p; assert.equal(done, true);
  assert.equal(cardLive({ __veliaLoading: { off: true } }), true, 'no card (captures): at once');
});

test('the skipper prefetch: the first 3 clips at the usual pace, the rest behind them', async () => {
  const clips = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`h${i}`, { text: `line ${i}` }]));
  const fetched = [], gaps = [];
  const fetchFn = async (u) => { fetched.push(u); return u.endsWith('manifest.json') ? { ok: true, json: async () => ({ clips }) } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  let attach = null;
  const audio = { attach: (fn) => { attach = fn; } };
  createSkipperVoice({ audio, storage: null, fetchFn, exts: ['opus'], prefetch: true, prefetchGapMs: 1, prefetchFirst: 3, prefetchRestGapMs: 50, timers: { setTimeout: (f, ms) => { gaps.push(ms); return setTimeout(f, 0); } } });
  attach({ ctx: { state: 'running', decodeAudioData: async () => ({}) }, master: {} });
  // wait on the fetches themselves, not on 50 ms of real time (a loaded machine ran the chain past it)
  for (let i = 0; i < 2000 && fetched.filter((u) => u.endsWith('.opus')).length < 6; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetched.filter((u) => u.endsWith('.opus')).length, 6);
  assert.deepEqual(gaps.slice(0, 5), [1, 1, 50, 50, 50]);
});
