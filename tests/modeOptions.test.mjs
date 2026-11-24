// The mode options schema (src/modes/options.js, refactor round 2 Phase C step 4): every mode's coreOptions validate; a bad one
// throws in dev and is dropped (with one error line) in a build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODE_OPTIONS, checkModeOptions, isDev } from '../classic/src/modes/options.js';
import { MODE_ROWS } from '../classic/src/modes/registry.js';
import { parseFlags } from '../src/sim/core/flags.js';

const QUERIES = ['', 'clock=flat', 'nowake=1', 'winddir=200&windspeed=5', 'wind=4', 'first=1', 'show=fireworks', 'advisory=1'];

test('every mode\'s options validate, for the URL\'s variants; a good table comes back as the same object', async () => {
  for (const r of MODE_ROWS.filter((r) => r.load)) {
    const m = await r.load();
    for (const q of QUERIES) {
      const o = m.coreOptions?.(parseFlags(`mode=${r.id}&${q}`)) ?? {};
      assert.equal(checkModeOptions(o, { mode: r.id, dev: true }), o, `${r.id} ?${q}`);
    }
  }
});

test('node counts as dev: a bad option throws here', () => {
  assert.equal(isDev(), true);
  assert.throws(() => checkModeOptions({ hud: 'loud' }), /hud/);
});

test('a malformed option fails loudly in dev', () => {
  const bad = {
    'unknown key': { hudd: 'calm' },
    'hud not a HUD': { hud: 'loud' },
    'card not a card': { card: 'kayak' },
    'stage not a boolean': { stage: 'yes' },
    'firstSail word': { firstSail: 'maybe' },
    'hour not a string': { defaultHour: 18 },
    'hour out of the day': { defaultHour: '25' },
    'negative rate': { timeRate: -1 },
    'wind not a function': { wind: { level: 3 } },
    'wake not a factory': { createWake: true },
    'ownFireworks not a boolean': { ownFireworks: 1 },
    'not an object': ['calm'],
  };
  for (const [why, o] of Object.entries(bad)) assert.throws(() => checkModeOptions(o, { mode: 'x', dev: true }), Error, why);
});

test('in a build a bad option falls back: the bad keys dropped (the readers\' defaults apply), one error line, the rest kept', () => {
  const lines = [];
  const o = { hud: 'loud', card: 'cruise', colour: 'red', timeRate: 2 };
  const out = checkModeOptions(o, { mode: 'cruise', dev: false, report: (m) => lines.push(m) });
  assert.deepEqual(out, { card: 'cruise', timeRate: 2 });
  assert.deepEqual(o, { hud: 'loud', card: 'cruise', colour: 'red', timeRate: 2 }, 'the mode\'s own object untouched');
  assert.equal(lines.length, 1); assert.match(lines[0], /mode cruise: .*hud.*colour/);
  assert.deepEqual(checkModeOptions('calm', { dev: false, report: (m) => lines.push(m) }), {});
  assert.deepEqual(checkModeOptions(null), {});
});

test('the modes README names every option in the schema', () => {
  const doc = readFileSync(new URL('../src/modes/README.md', import.meta.url), 'utf8');
  for (const k of Object.keys(MODE_OPTIONS)) assert.ok(doc.includes(`\`${k}\``), k);
});
