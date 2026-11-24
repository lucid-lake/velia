// The services registry (src/core/services.js) and its read-only mirror, window.__lakeshore (src/core/mirror.js).
// The last test reads the source on purpose, as tests/flags.test.mjs does: it checks a contract between src/ and the
// mirror (game code never reads window.__lakeshore), like a lint, not behaviour.
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServices } from '../src/sim/core/services.js';
import { mirrorOf, installMirror } from '../classic/src/core/mirror.js';

test('provide, get, has, remove: one object per name, the newest wins', () => {
  const S = createServices(), boat = { phys: {} }, other = { phys: {} };
  assert.equal(S.get('boat'), undefined); assert.equal(S.has('boat'), false);
  assert.equal(S.provide('boat', boat), boat, 'provide returns the object');
  assert.equal(S.get('boat'), boat); assert.equal(S.has('boat'), true);
  S.provide('boat', other); assert.equal(S.get('boat'), other, 'a later provide replaces');
  assert.equal(S.remove('boat', boat), false, 'remove(name, obj): not while the name holds another object');
  assert.equal(S.get('boat'), other);
  assert.equal(S.remove('boat', other), true); assert.equal(S.has('boat'), false);
  S.provide('dock', 1); assert.equal(S.remove('dock'), true, 'remove(name): whatever it holds'); assert.equal(S.remove('dock'), false);
  S.provide('nothing', null); assert.equal(S.has('nothing'), true, 'a provided null is provided'); assert.equal(S.remove('nothing', null), true);
  S.provide('a', 1); S.provide('b', 2); assert.deepEqual(S.names(), ['a', 'b']);
});

test('a mode\'s scope: what the mode provides goes when it is disposed; the rest stays', () => {
  const S = createServices();
  S.provide('settings', 'shell');                 // the shell's: lasts the page
  const mode = S.scope();
  assert.equal(mode.root, S);
  mode.provide('boat', 'b1'); mode.provide('controls', 'c1'); mode.provide('switchMode', 'mode-own');
  assert.equal(S.get('boat'), 'b1', 'one registry: the shell sees the mode\'s boat'); assert.equal(mode.get('settings'), 'shell', 'and the mode the shell\'s settings');
  S.provide('switchMode', 'shell-own');           // the shell's later provide of the same name
  mode.remove('controls');                        // a part that left early (Cruise's hand-back) removed its own
  S.provide('controls', 'c2');                    // and something else took the name
  assert.deepEqual(mode.owned().sort(), ['boat', 'switchMode']);
  mode.dispose();
  assert.equal(S.has('boat'), false, 'the mode\'s boat is gone');
  assert.equal(S.get('switchMode'), 'shell-own', 'a name the shell provided since stays');
  assert.equal(S.get('controls'), 'c2', 'a name the mode had removed and another took stays');
  assert.equal(S.get('settings'), 'shell');
  assert.equal(mode.live, false);
  // the next mode: its own scope, the same registry
  const next = S.scope(); next.provide('boat', 'b2'); assert.equal(S.get('boat'), 'b2'); next.dispose(); assert.equal(S.has('boat'), false);
});

test('the mirror: window.__lakeshore reads the registry live and refuses writes', () => {
  const S = createServices(), M = mirrorOf(S);
  S.provide('ready', Promise.resolve()); S.provide('boat', { phys: { state: { x: 1 } } });
  assert.equal(M.boat.phys.state.x, 1); assert.equal('boat' in M, true); assert.equal('chart' in M, false); assert.equal(M.chart, undefined);
  assert.deepEqual(Object.keys(M), ['ready', 'boat']);
  S.remove('boat'); assert.equal(M.boat, undefined, 'live: a removal shows at once');
  assert.throws(() => { M.boat = {}; }, TypeError); assert.throws(() => { delete M.ready; }, TypeError);
  assert.equal(S.has('boat'), false, 'the refused write never reached the registry');
  M.ready.foo = 1;   // a tool may still set a field on an object it read (the probes set boat.env)
  const g = {}; const inst = installMirror(S, g); assert.equal(g.__lakeshore, inst);
  g.__lakeshore = { own: true }; assert.deepEqual(g.__lakeshore, { own: true }, 'the global itself stays replaceable (a demo page, a test)');
});

test('Sail\'s controls provide through the mode\'s scope; dispose and the scope leave only the shell\'s', () => {
  const s = mountSail();
  const disposeControls = s.c.dispose; s.c.dispose = () => {};   // disposed below, step by step (s.dispose() then only uninstalls)
  try {
    s.services.provide('settings', { get: () => undefined, set() {} });   // the shell's (root, lasting)
    for (const n of ['boat', 'controls', 'dock', 'modality', 'hint', 'seamanship', 'viewSwitch', 'skills', 'station', 'throttle']) assert.ok(s.services.has(n), `provided: ${n}`);
    assert.equal(window.__lakeshore.controls, s.c, 'the tools see the controls through the mirror');
    assert.equal(window.__lakeshore.boat.phys, s.phys);
    disposeControls();
    for (const n of ['controls', 'dock', 'modality', 'hint', 'viewSwitch', 'skills', 'station']) assert.equal(s.services.has(n), false, `the controls removed their own: ${n}`);
    const left = s.core.services.owned();
    assert.ok(left.includes('boat') && left.includes('throttle'), `the mode still holds some: ${left}`);
    s.core.services.dispose();
    for (const n of left) assert.equal(s.services.has(n), false, `gone with the mode: ${n}`);
    assert.deepEqual(s.services.names(), ['settings'], 'only the shell\'s stays');
  } finally { s.dispose(); }
});

// ---- the contract: game code never reads window.__lakeshore (the mirror is for the tools) ----
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

test('no window.__lakeshore in src/ outside the mirror module', () => {
  const MIRROR = join('classic', 'src', 'core', 'mirror.js');
  const hits = [];
  for (const p of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'classic', 'src'))].filter((f) => /\.(m?js|html)$/.test(f))) {
    const rel = p.slice(ROOT.length + 1);
    if (rel === MIRROR) continue;
    strip(readFileSync(p, 'utf8')).split('\n').forEach((l, i) => { if (/\b__lakeshore\b/.test(l)) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, [], 'game code gets the registry passed in (core.services), never the global');
});
