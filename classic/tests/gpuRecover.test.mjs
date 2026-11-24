// fix/first-load: the GPU's death on iOS (InvalidStateError from createCommandEncoder, no device.lost) is recognised,
// and the tab recovers at most twice: a new device, then WebGL2, then never again (no reload loop).
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRecovery, backendWanted, resumeWanted } from '../src/ui/gpuRecover.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('a tab recovers twice at most: a new device, then WebGL2, then no more reloads', () => {
  const s = mem();
  assert.equal(backendWanted(s), 'gpu');
  assert.deepEqual(nextRecovery(s, 'a', 1000), { action: 'reload', n: 1 });
  assert.equal(backendWanted(s), 'gpu');
  assert.ok(resumeWanted(s, 2000)); assert.ok(!resumeWanted(s, 2000));   // once: the reloaded page skips the card
  assert.deepEqual(nextRecovery(s, 'b', 5000), { action: 'webgl', n: 2 });
  assert.equal(backendWanted(s), 'gl');
  assert.equal(nextRecovery(s, 'c', 9000).action, 'none');
  assert.equal(nextRecovery(s, 'd', 9500).action, 'none');
});
