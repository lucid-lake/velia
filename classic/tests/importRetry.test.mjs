// perf/phone-load: a module that fails to import is tried once more, then the tab reloads once with ?fresh= (never in a
// loop, never without storage).
// v1 only (/classic/): trimmed to its representative check(s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { importRetry } from '../src/core/importRetry.js';

const noWait = { sleep: async () => {} };

test('importRetry: a failed import is tried once more; a second failure or another error goes to the caller', async () => {
  let n = 0;
  assert.equal(await importRetry(async () => { if (n++ === 0) throw new TypeError('Importing a module script failed.'); return 'mod'; }, noWait), 'mod');
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(importRetry(async () => { n++; throw new TypeError('Importing a module script failed.'); }, noWait), /Importing/);
  assert.equal(n, 2, 'tried twice, no more');
  n = 0;
  await assert.rejects(importRetry(async () => { n++; throw new Error('a bug in the module'); }, noWait), /bug/);
  assert.equal(n, 1, 'a module that throws is not fetched again');
});
