// Boat detail step 1): the boat's shadow map by tier (never on Low). Plain JS, no GPU.
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadowSizeFor } from '../src/core/sunShadow.js';
import { TIERS } from '../src/quality/tiers.js';
import { tierFor } from '../src/quality/apply.js';

test('the boat\'s shadow map by tier: 2048 on High, 1024 on Balanced, none on Low (a phone too); ?boatshadow= overrides', () => {
  assert.equal(shadowSizeFor(TIERS.high), 2048);
  assert.equal(shadowSizeFor(TIERS.balanced), 1024);
  assert.equal(shadowSizeFor(TIERS.low), 0);
  assert.equal(shadowSizeFor(tierFor('low', { phone: true })), 0);
  assert.equal(shadowSizeFor(tierFor('high', { phone: false })), 2048);
  assert.equal(shadowSizeFor(TIERS.high, '0'), 0);
  assert.equal(shadowSizeFor(TIERS.low, '1024'), 1024);
  assert.equal(shadowSizeFor(TIERS.high, 'x'), 2048, 'a bad value keeps the tier');
});
