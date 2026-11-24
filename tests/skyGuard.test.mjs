// fix/sky-load: the sky's LUT build never blocks the load (src/core/skyGuard.js), and its failure is a non-fatal event.
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardLut, waitForLut, lutBusy, SKY_BUDGET_MS } from '../classic/src/core/skyGuard.js';
import { EVENTS } from '../src/metrics.js';
import { pointOf } from '../functions/api/e.js';

// a fake clock: sleep() advances it, so a 12 s budget runs in no time
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } }; };
const fakeLut = ({ fail = null, builds = true } = {}) => ({
  updating: false, currentVersion: undefined, version: 1,
  async updateTextures() { this.updating = true; try { await null; if (fail) throw fail; } finally { this.updating = false; } },
  updateBefore() { if (!builds || this.version === this.currentVersion) return; this.currentVersion = this.version; this.updateTextures().catch((e) => { throw e; }); },
});

test('a LUT build that throws is caught (no unhandled rejection) and ends the wait with its reason', async () => {
  let unhandled = null; const on = (e) => { unhandled = e; }; process.on('unhandledRejection', on);
  const lut = fakeLut({ fail: new Error('compute pipeline failed') }), c = clock();
  let err = null;
  guardLut(lut, (e) => { err = e; });
  lut.updateBefore();
  const r = await waitForLut(lut, { ...c, failed: () => err });
  await new Promise((res) => setTimeout(res, 10));
  process.off('unhandledRejection', on);
  assert.equal(unhandled, null);
  assert.deepEqual(r, { ok: false, reason: 'error: compute pipeline failed' });
  assert.equal(lutBusy(lut), false);
});

test('a LUT that never starts times out after the budget of visible time, not by a loop count', async () => {
  const lut = fakeLut({ builds: false }), c = clock();
  const r = await waitForLut(lut, c);
  assert.deepEqual(r, { ok: false, reason: 'timeout' });
  assert.ok(c.now() >= SKY_BUDGET_MS && c.now() < SKY_BUDGET_MS + 100, `waited ${c.now()} ms`);
});

test('sky_fallback is a known, non-urgent event the server stores with its reason', () => {
  assert.deepEqual(EVENTS.sky_fallback, ['reason']);
  const p = pointOf({ n: 'sky_fallback', p: { reason: 'timeout' } });
  assert.equal(p.event, 'sky_fallback'); assert.equal(p.detail, 'timeout');
});
