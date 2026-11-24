// The settings store keeps only the player's choices (src/ui/settings.js format 2), so a changed default reaches them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, SETTINGS } from '../src/ui/settings.js';

const mem = (saved) => { const m = new Map(saved ? [['lakeshore.settings.v1', JSON.stringify(saved)]] : []); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('an old full copy saved before 11-11 does not keep the kayak camera on', () => {
  const s = createSettings({ storage: mem({ ...SETTINGS, kayakCam: true, music: false }) });
  assert.equal(s.get('kayakCam'), false, 'the old default is not a choice');
  assert.equal(s.get('music'), false, 'a real choice survives');
});

test('a save keeps only the chosen keys, so later defaults still reach the player', () => {
  const st = mem(null), s = createSettings({ storage: st });
  s.set('music', false);
  assert.deepEqual(JSON.parse(st.m.get('lakeshore.settings.v1')), { _v: 2, music: false });
});

test('a kayak camera turned on in the new format stays on', () => {
  const st = mem(null); createSettings({ storage: st }).set('kayakCam', true);
  assert.equal(createSettings({ storage: st }).get('kayakCam'), true);
});
