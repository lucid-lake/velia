// fix/regatta-watchdog-vhf: a race started within ≈ 1 s of load played the race officer's first call on the radio
// with the VHF off: Regatta's hails read the shell's 'settings' service, which lands a moment after the first frame, and an
// absent service read as "on". settingsNow() is the read the hails make: the shell's copy once it is up, the saved settings
// before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../src/sim/core/services.js';

const mem = (saved) => { const m = new Map(saved ? [['lakeshore.settings.v1', JSON.stringify(saved)]] : []); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const load = () => import('../src/ui/settings.js');

test('before the shell is up, the saved VHF off holds for the first call', async () => {
  const { settingsNow } = await load();
  const services = createServices();   // no 'settings' yet: the shell has not run
  assert.equal(settingsNow(services, { storage: mem({ vhf: false }) }).get('vhf'), false);
});
test('before the shell is up, nothing saved: the VHF is on (the default)', async () => {
  const { settingsNow } = await load();
  assert.equal(settingsNow(createServices(), { storage: mem() }).get('vhf'), true);
  assert.equal(settingsNow(createServices(), { storage: null }).get('vhf'), true);
});
test('once the shell provides its settings (after the race started), its copy is the one read, and follows a switch', async () => {
  const { settingsNow, createSettings } = await load();
  const storage = mem({ vhf: false }), services = createServices();
  assert.equal(settingsNow(services, { storage }).get('vhf'), false);   // the first call, before the shell
  const shared = services.provide('settings', createSettings({ storage }));   // the shell lands
  assert.equal(settingsNow(services, { storage }), shared);
  assert.equal(settingsNow(services, { storage }).get('vhf'), false);
  shared.set('vhf', true);   // the trim panel's VHF button
  assert.equal(settingsNow(services, { storage }).get('vhf'), true);
});
