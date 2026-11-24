// Cruise's in-place mode change (the hand-over to Sail and the hand back with the ` key) before and after the shell is in.
// The shell (src/shell.js) is imported only once the core is ready (src/main.js), seconds after Cruise's strip works on a
// slow load: a hand-over then must still reach the shell when it installs, and the ` key must still hand the boat back
// (2026-11-11: the first hand back after the strip's Take the helm did nothing). src/modes/inPlace.js.
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../src/sim/core/services.js';
import { setModeInPlace, switchInPlace } from '../classic/src/modes/inPlace.js';
import { KEY } from '../src/sail/keys.js';

test('before the shell: the hand-over goes to the page registry, the ` key to the mode\'s quick switch', async () => {
  const S = createServices(), mode = S.scope();   // a mode gets a scope of the page's registry (src/core/index.js)
  setModeInPlace(mode, 'sail', { card: 'sail' });
  assert.equal(S.get('mode'), 'sail');
  assert.deepEqual(S.get('modeOptions'), { card: 'sail' });
  mode.dispose();
  assert.equal(S.get('mode'), 'sail', 'the page\'s, not the mode\'s: it outlives the mode\'s scope');
  let back = 0;
  S.provide('quickSwitch', { cruise: async () => { back++; return true; } });
  assert.equal(await switchInPlace(S, 'cruise'), true);
  assert.equal(back, 1);
  assert.equal(await switchInPlace(S, 'regatta'), false, 'no quick switch, no shell: nothing');
});

test('with the shell: both are its services', async () => {
  const S = createServices(), calls = [];
  S.provide('setMode', (id, o) => calls.push(['set', id, o]));
  S.provide('switchMode', async (id) => { calls.push(['switch', id]); return true; });
  S.provide('quickSwitch', { cruise: async () => { calls.push(['quick']); return true; } });
  setModeInPlace(S, 'cruise', { card: 'cruise' });
  await switchInPlace(S, 'cruise');
  assert.deepEqual(calls, [['set', 'cruise', { card: 'cruise' }], ['switch', 'cruise']]);
  assert.equal(S.has('mode'), false, 'the shell keeps the mode');
});

test('Sail\'s ` key hands back to Cruise with no shell yet', () => {
  const s = mountSail({ hud: false });
  try {
    let back = 0;
    s.services.provide('quickSwitch', { cruise: async () => { back++; return true; } });
    s.tap(KEY.cruise);
    assert.equal(back, 1);
    const seen = [];
    s.services.provide('switchMode', (id) => { seen.push(id); return Promise.resolve(true); });
    s.tap(KEY.cruise);
    assert.deepEqual(seen, ['cruise'], 'the shell in: its switch, which asks the quick switch itself');
    assert.equal(back, 1);
  } finally { s.dispose(); }
});

// the shell on the card's DOM (tests/helpers/dom-card.mjs) with a stand-in core, as tests/pages/menu.page.mjs does in a browser
async function shellOn(t, { current, before = () => {} }) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });   // the shell's timers (the card's reel, the dashboard's dimming …) on the test's clock: none outlives it
  const { installDom, shellBody } = await import('./helpers/dom-card.mjs');
  installDom({ body: shellBody(), search: `?mode=${current}&metrics=0&attract=0` });
  window.__veliaLoading = { say() {}, enter() {} };
  const urls = [];
  globalThis.history = { state: null, replaceState: (st, t, u) => urls.push(u) };
  const { installShell } = await import('../classic/src/shell.js');
  const S = createServices(), switched = [];
  S.provide('core', { audio: { setMuted() {}, setBus() {} }, renderer: { getPixelRatio: () => 1, setPixelRatio() {}, setSize() {} }, sun: { hour: 12 }, wind: { level: 3 },
    async switchMode(next) { switched.push(await next); } });
  before(S);
  const shell = installShell({ services: S, modes: { sail: async () => ({ name: 'sail' }), cruise: async () => ({ name: 'cruise' }) }, current });
  return { S, shell, urls, switched };
}

test('the shell takes up a hand-over made before it was in', async (t) => {
  const { S, shell, urls } = await shellOn(t, { current: 'cruise', before: (S) => setModeInPlace(S.scope(), 'sail', { card: 'sail', hud: 'calm' }) });
  assert.equal(shell.mode, 'sail');
  assert.equal(S.get('mode'), 'sail');
  assert.equal(S.get('modeOptions').card, 'sail');
  assert.match(urls.at(-1), /mode=sail/);
});

test('the shell\'s switch: a quick switch runs while the mode is the same; with none, the same mode is no switch', async (t) => {
  const { S, shell, switched } = await shellOn(t, { current: 'cruise' });
  assert.equal(await S.get('switchMode')('cruise'), false, 'no quick switch: Cruise to Cruise does nothing');
  assert.equal(switched.length, 0);
  let back = 0;
  S.provide('quickSwitch', { cruise: async () => { back++; return true; } });
  assert.equal(await S.get('switchMode')('cruise'), true, 'Cruise with the helm taken (still mode cruise): the hand back');
  assert.equal(back, 1);
  assert.equal(switched.length, 0, 'in place: no core switch');
  assert.deepEqual(S.get('modeSwitchLog').at(-1), { from: 'cruise', to: 'cruise', ms: 0, horizon: false, error: null });
  assert.equal(shell.mode, 'cruise');
});
