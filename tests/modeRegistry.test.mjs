// The mode registry (src/modes/registry.js, refactor round 2 Phase C step 1): one row per mode; the names, aliases, home
// picks, card classes, the watchdog's modes and the chunks all come from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MODE_ROWS, CARDS, checkRows, modeRow, pickRows, isPlayMode, modeLoaders } from '../classic/src/modes/registry.js';
import { MODE_LABELS, modeId } from '../src/modeNames.js';
import { MODES } from '../src/ui/home.js';
import { parseFlags } from '../src/sim/core/flags.js';

const ROOT = new URL('../', import.meta.url);

test('every row with a chunk loads a mode: start(), and its coreOptions().card is the row\'s card', async () => {
  for (const r of MODE_ROWS.filter((r) => r.load)) {
    const m = await r.load();
    assert.equal(typeof m.start, 'function', r.id);
    const card = m.coreOptions ? m.coreOptions(parseFlags(`mode=${r.id}`)).card : 'sail';
    assert.equal(card, r.card, `${r.id}: coreOptions().card`);
  }
});

test('labels, aliases and picks come from the rows', () => {
  assert.deepEqual(Object.keys(MODE_LABELS), MODE_ROWS.map((r) => r.id));
  for (const r of MODE_ROWS) { assert.equal(modeId(r.id), r.id); for (const a of r.aliases) assert.equal(modeId(a.toUpperCase()), r.id, a); }
  assert.deepEqual(MODES.map((m) => m.id), ['cruise', 'sail', 'regatta'], 'the home card lists the same 3 picks');
  assert.deepEqual(pickRows().map((r) => r.id), MODES.map((m) => m.id));
  assert.ok(CARDS.includes(modeRow('cruise').card) && modeRow('nonsense') === null);
});

test('the watchdog arms in the modes that sail; the loaders skip planned rows and mark dev ones', async () => {
  assert.deepEqual(MODE_ROWS.map((r) => r.id).filter(isPlayMode), ['cruise', 'sail', 'regatta']);
  assert.equal(isPlayMode('fly'), false); assert.equal(isPlayMode(undefined), false);
  const seen = [];
  const L = modeLoaders((load) => { seen.push(load); return 'x'; });
  assert.deepEqual(Object.keys(L), ['cruise', 'sail', 'regatta', 'fly']);
  assert.equal(L.fly.dev, true); assert.equal(L.sail.dev, undefined);
  assert.equal(L.sail(), 'x'); assert.equal(seen[0], modeRow('sail').load);
});

test('a malformed row fails loudly', () => {
  const ok = { id: 'kayak', label: 'Kayak', aliases: [], card: 'sail', order: 9, load: () => null };
  assert.doesNotThrow(() => checkRows([...MODE_ROWS, ok]));
  const bad = {
    'no id': { ...ok, id: undefined },
    'duplicate id': { ...ok, id: 'sail' },
    'alias of another mode': { ...ok, aliases: ['chill'] },
    'alias that is an id': { ...ok, aliases: ['regatta'] },
    'unknown card': { ...ok, card: 'paddle' },
    'unknown key': { ...ok, colour: 'red' },
    'no label': { ...ok, label: '' },
    'load not a function': { ...ok, load: './kayak/index.js' },
    'order taken': { ...ok, order: 2 },
    'dev pick': { ...ok, dev: true },
  };
  for (const [why, row] of Object.entries(bad)) assert.throws(() => checkRows([...MODE_ROWS, row]), Error, why);
});

test('the first paint\'s card class (tools/loading_shell.py) comes from the rows: Cruise\'s ids and aliases', () => {
  execFileSync('python3', ['-I', 'tools/loading_shell.py', '--check'], { cwd: ROOT });
  const want = MODE_ROWS.filter((r) => r.card === 'cruise').flatMap((r) => [r.id, ...r.aliases]).join('|');
  for (const f of ['index.html', 'demos/loading.html']) assert.ok(readFileSync(new URL(f, ROOT), 'utf8').includes(`/[?&]mode=(${want})\\b/i`), f);
});
