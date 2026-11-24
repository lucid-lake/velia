// perf/slow-loading: the slow-link rule, the after-ready wait, KTX2's stall clock, the bytes handed over once,
// the coarse photo ground first. Behaviour only: each module is called and its answer read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredMbps, slowLink, afterReady, isReady, afterCard, SLOW_MBPS } from '../src/ui/deferLoad.js';
import { loadWithFallback } from '../classic/src/ktx2-layout.js';
import { prefetchBytes, takeBytes, loadGltf } from '../src/prefetch.js';
import { coarseFirst } from '../classic/src/naip.js';

const page = (entries, connection = {}) => ({ performance: { getEntriesByType: () => entries }, navigator: { connection } });
// a resource entry: bytes on the wire, start and end (ms)
const res = (transferSize, startTime, responseEnd) => ({ transferSize, startTime, responseEnd });

test('the link is measured from the downloads that carried a body, over the span they took together', () => {
  // 10 MB of grids in parallel over 50 s: 1.6 Mbps (Slow 4G)
  const slow = page([res(3e6, 7000, 57000), res(2.5e6, 7000, 55000), res(2e6, 7000, 50000), res(2.5e6, 7000, 52000)]);
  assert.ok(Math.abs(measuredMbps(slow) - 1.6) < 0.05);
  assert.equal(slowLink(slow), true);
  // an idle stretch between two downloads is not the link's: 2 × 1.1 MB, each in 1 s, 10 s apart: 8.8 Mbps, not 1.6
  assert.ok(Math.abs(measuredMbps(page([res(1.1e6, 0, 1000), res(1.1e6, 11000, 12000)])) - 8.8) < 0.05);
  // the same over 1.5 s: 53 Mbps
  assert.equal(slowLink(page([res(10e6, 100, 1600)])), false);
  // revalidated (304) or cached files say nothing: no measure, no hint: fast (as before this branch)
  assert.equal(measuredMbps(page([res(300, 0, 600), res(0, 0, 5)])), null);
  assert.equal(slowLink(page([res(300, 0, 600)])), false);
  // the browser's own estimate and Save-Data count without a measure
  assert.equal(slowLink(page([], { effectiveType: '3g' })), true);
  assert.equal(slowLink(page([], { saveData: true })), true);
  assert.equal(slowLink(page([], { effectiveType: '4g' })), false);
  assert.ok(SLOW_MBPS > 9, 'Fast 4G (9 Mbps) counts as slow');
});

test('the film\'s link verdict: slow under 4 Mbps, mid under 12, fast above, unknown with no measure', async () => {
  const { reelLink } = await import('../src/ui/deferLoad.js');
  assert.equal(reelLink(page([res(2e6, 0, 10000)])), 'slow', '1.6 Mbps');
  assert.equal(reelLink(page([res(200e3, 0, 1000)])), null, 'one small still: the round trips weigh too much, not yet');
  assert.equal(reelLink(page([res(1.1e6, 0, 1000)])), 'mid', '9 Mbps (Fast 4G)');
  assert.equal(reelLink(page([res(200e3, 0, 40)])), 'fast');
  assert.equal(reelLink(page([])), null);
  assert.equal(reelLink(page([], { effectiveType: '3g' })), 'slow');
  assert.equal(reelLink({ ...page([]), __slowFlag: '0' }), 'fast');
});

test('?slow=1|0 forces the rule', () => {
  assert.equal(slowLink({ ...page([res(10e6, 0, 1000)]), __slowFlag: '1' }), true);
  assert.equal(slowLink({ ...page([], { effectiveType: '2g' }), __slowFlag: '0' }), false);
});

test('a desktop on a slow link waits for the card, as a phone does; a fast one does not', async () => {
  const slowDesk = { ...page([res(4e6, 0, 20000)]), __veliaLoading: { state: 'progress' }, addEventListener() {}, removeEventListener() {} };
  let done = false;
  const p = afterCard({ g: slowDesk, phone: slowLink(slowDesk), maxMs: 5000 }).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 30)); assert.equal(done, false);
  slowDesk.__veliaLoading.state = 'home'; await p; assert.equal(done, true);
  const fastDesk = { ...page([res(4e6, 0, 300)]), __veliaLoading: { state: 'progress' } };
  assert.equal(await afterCard({ g: fastDesk, phone: slowLink(fastDesk) }), true);
});

test('afterReady: at once with no card (captures), else at the first live frame', async () => {
  assert.equal(isReady({}), true);
  assert.equal(isReady({ __veliaLoading: { off: true } }), true);
  const g = { __veliaLoading: { log: [['gpu', 0.02, 10]] } };
  assert.equal(isReady(g), false);
  let done = false; const p = afterReady({ g, maxMs: 5000 }).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 300)); assert.equal(done, false);
  g.__veliaLoading.log.push(['ready', 1, 900]); await p; assert.equal(done, true);
});

test('KTX2: a file still arriving is never dropped for its plain twin; a silent loader still is', async () => {
  // bytes every 10 ms for 120 ms under a 30 ms stall clock: the compressed file wins
  const arriving = (u, alive) => new Promise((ok) => { let n = 0; const iv = setInterval(() => { alive?.(); if (++n === 12) { clearInterval(iv); ok('tex'); } }, 10); });
  let plain = 0;
  const r = await loadWithFallback('/t/a.webp', { loadCompressed: arriving, loadPlain: async () => { plain++; return 'bitmap'; }, timeoutMs: 30 });
  assert.deepEqual(r, { kind: 'ktx2', value: 'tex' });
  assert.equal(plain, 0, 'the plain file is never fetched');
  const silent = await loadWithFallback('/t/a.webp', { loadCompressed: () => new Promise(() => {}), loadPlain: async () => 'bitmap', timeoutMs: 20, warn: () => {} });
  assert.deepEqual(silent, { kind: 'plain', value: 'bitmap' });
});

test('prefetched bytes are handed over once; the loader parses them, never fetching again', async () => {
  const asked = [];
  const fetchFn = async (u) => { asked.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
  prefetchBytes('/m/hull.glb', fetchFn); prefetchBytes('/m/hull.glb', fetchFn);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ['/m/hull.glb'], 'one request per url');
  const loader = { parsed: [], loaded: [], parse(ab, path, ok) { this.parsed.push([ab.byteLength, path]); ok('gltf'); }, loadAsync(u) { this.loaded.push(u); return Promise.resolve('fetched'); } };
  assert.equal(await loadGltf(loader, '/m/hull.glb'), 'gltf');
  assert.deepEqual(loader.parsed, [[4, '/m/']]);
  assert.equal(takeBytes('/m/hull.glb'), null, 'handed over once');
  assert.equal(await loadGltf(loader, '/m/hull.glb'), 'fetched', 'a second use loads as before');
  // a failed prefetch: the loader's own fetch
  prefetchBytes('/m/gone.glb', async () => ({ ok: false }));
  assert.equal(await loadGltf(loader, '/m/gone.glb'), 'fetched');
});

test('the coarse photo ground first: only a live page on a slow link whose tier wants finer than the phone set', () => {
  const slow = () => true, fast = () => false;
  assert.equal(coarseFirst({ pick: { bay: 1, region: 16 }, live: true, slow }), true, 'High on a slow link');
  assert.equal(coarseFirst({ pick: { bay: 4, region: 64 }, live: true, slow }), true, 'Low on a desktop');
  assert.equal(coarseFirst({ pick: { bay: 8, region: 128 }, live: true, slow }), false, 'a phone: already the coarse set');
  assert.equal(coarseFirst({ pick: { bay: 1, region: 16 }, live: true, slow: fast }), false, 'a fast link: the tier at once');
  assert.equal(coarseFirst({ pick: { bay: 1, region: 16 }, live: false, slow }), false, 'a capture: the tier at once');
});

test('the gzip twin: inflated when it is gzip, the plain file on a 404, an HTML fallback or a dev page', async () => {
  const { fetchBytes, hasTwin } = await import('../src/fetchGz.js');
  const { gzipSync } = await import('node:zlib');
  const plain = Buffer.from('glTF-plain-bytes');
  const resp = (body, ok = true) => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
  const asked = [];
  const site = (twin) => async (u) => { asked.push(u); return u.endsWith('.gz') ? twin : resp(plain); };
  const text = (ab) => Buffer.from(ab).toString();
  assert.equal(text(await fetchBytes('/models/boat/hull.glb', undefined, { fetchFn: site(resp(gzipSync(plain))), twin: true })), 'glTF-plain-bytes');
  assert.deepEqual(asked.splice(0), ['/models/boat/hull.glb.gz'], 'one request: the twin');
  assert.equal(text(await fetchBytes('/models/boat/hull.glb', undefined, { fetchFn: site(resp(Buffer.from('x'), false)), twin: true })), 'glTF-plain-bytes');
  assert.equal(text(await fetchBytes('/models/boat/hull.glb', undefined, { fetchFn: site(resp(Buffer.from('<!doctype html>'))), twin: true })), 'glTF-plain-bytes', 'the SPA fallback is never taken for the model');
  asked.splice(0);
  await fetchBytes('/models/boat/hull.glb', undefined, { fetchFn: site(null), twin: false });
  assert.deepEqual(asked, ['/models/boat/hull.glb'], 'no twin: the plain file only');
  assert.equal(hasTwin('/models/boat/hull.glb', { production: true, ds: true }), true);
  assert.equal(hasTwin('/terrain/forest/treetops.tps', { production: true, ds: true }), true);
  assert.equal(hasTwin('/models/boat/hull.glb', { production: false, ds: true }), false, 'the dev server has no twins');
  assert.equal(hasTwin('/models/boat/hull.glb', { production: true, ds: false }), false, 'no DecompressionStream');
  assert.equal(hasTwin('/models/paddler/ubc-male.glb', { production: true, ds: true }), false);
});
