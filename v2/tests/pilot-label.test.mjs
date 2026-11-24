// The autopilot button's one name (owner, 2026-11-17: "rename the button to NAV"; v2/ui/pilotLabel.js): every place the player reads
// it (the Keys page and the hold-H list, the phone's loading tips) takes PILOT_LABEL, and none still says AUTO or Auto for the button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_LABEL } from '../ui/pilotLabel.js';
import { KEY_ROWS } from '../ui/keyMap.js';
import { TIPS } from '../ui/loadFacts.js';

test('NAV, from one constant: the Keys page row, the steer row and the loading tip; no AUTO left', () => {
  assert.equal(PILOT_LABEL, 'NAV');
  const row = KEY_ROWS.find((r) => r.id === 'auto');
  assert.equal(row.v, PILOT_LABEL); assert.ok(row.a.includes(PILOT_LABEL));
  assert.ok(KEY_ROWS.find((r) => r.id === 'steer').g.includes(`lets ${PILOT_LABEL} go`));
  assert.ok(!KEY_ROWS.some((r) => /\bAUTO\b/.test(`${r.v} ${r.g ?? ''} ${r.a ?? ''}`)), 'no AUTO in the key rows');
  assert.ok(TIPS.some((t) => t.startsWith(`Tap ${PILOT_LABEL},`)), 'the phone\'s tip names it');
  assert.ok(!TIPS.some((t) => /\bAuto\b/.test(t)), 'no Auto in the tips');
});
