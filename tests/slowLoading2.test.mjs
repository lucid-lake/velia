// perf/slow-loading-2: the self-hosted blue noise, the treetops posted after the grids, the mode's chunks
// fetched together. Behaviour only: each module is called and its answer read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pointStbn, STBN_URL } from '../classic/src/core/stbn.js';
import { acceptFiles, workerPrime } from '../src/sim/terrain-data.js';
import { preloadModeChunks } from '../classic/src/preloadChunks.js';

test('every STBN node builds its texture from our file, clones made before included', () => {
  class Node { constructor() { this.url = 'https://elsewhere/stbn.bin'; } setup() { return this.url; } }
  const early = new Node();   // made before the wrap, as the library's sampled clone is
  assert.equal(pointStbn(Node, '/assets/stbn.bin'), true);
  assert.equal(early.setup(), '/assets/stbn.bin');
  assert.equal(new Node().setup(), '/assets/stbn.bin');
});

test('the self-hosted file is the library\'s own: 128 × 128 × 64 bytes', () => {
  const bytes = readFileSync(fileURLToPath(STBN_URL));
  assert.equal(bytes.length, 128 * 128 * 64);
});

test('a phone worker takes the grids first and the treetops in a second message; its treetops wait for that', async () => {
  const g = globalThis;
  Object.assign(workerPrime, { files: null, tops: null, wait: null, done: null });
  // the wait's 30 s safety timer (never a deadlock on a page) is kept, then cleared at the end, so this file does not wait
  // 30 s for it to fire
  const realTimeout = g.setTimeout, safety = [];
  g.setTimeout = (f, ms, ...a) => { const h = realTimeout(f, ms, ...a); if (ms >= 30000) safety.push(h); return h; };
  try { assert.equal(acceptFiles({ terrainFiles: [['a.lsh', new ArrayBuffer(4)]], tops: null, topsLater: true }), true); } finally { g.setTimeout = realTimeout; }
  assert.equal(safety.length, 1, 'the wait has its safety timer');
  let landed = false; workerPrime.wait.then(() => { landed = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(landed, false, 'waiting for the treetops');
  const tops = new ArrayBuffer(8);
  assert.equal(acceptFiles({ topsOnly: true, tops }), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(landed, true); assert.equal(workerPrime.tops, tops);
  assert.equal(acceptFiles({ job: 'shore' }), false, 'a job is not a priming message');
  Object.assign(workerPrime, { files: null, tops: null, wait: null, done: null });
  for (const h of safety) clearTimeout(h);
});

test('the mode\'s chunks start together; a failed one is silent', async () => {
  const started = [];
  const list = [async () => { started.push('a'); }, async () => { started.push('b'); throw new Error('gone'); }, async () => { started.push('c'); }];
  assert.equal(preloadModeChunks(list), 3);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(started, ['a', 'b', 'c']);
});
