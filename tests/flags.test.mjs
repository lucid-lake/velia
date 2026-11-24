// The URL flags table (src/core/flags.js): one row per flag, and every flag the game reads is a row.
// The first three tests read the source on purpose: they check the table's coverage (a contract between src/ and the
// table, like a lint), not behaviour. The rest drive the module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAG_TABLE, FLAGS, parseFlags, withFlags, toFlags, isFlags } from '../src/sim/core/flags.js';
import { FLAG_DOCS } from '../src/core/flags-docs.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = new Set(FLAG_TABLE.map((r) => r.name));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const SRC = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'classic', 'src'))]   // C7b: v1's private files in classic/src/
  .filter((p) => p.endsWith('.js') && !p.endsWith(join('core', 'flags.js')));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

test('the table: one row per flag, each typed and documented', () => {
  assert.equal(NAMES.size, FLAG_TABLE.length, 'no duplicate names');
  for (const r of FLAG_TABLE) {
    assert.match(r.name, /^[A-Za-z][A-Za-z0-9_]*$/, r.name);
    assert.ok(['capture', 'debug', 'setting'].includes(r.kind), `${r.name}: kind`);
    assert.ok(['string', 'bool', 'number'].includes(r.type), `${r.name}: type`);
    assert.equal(typeof r.parse, 'function', `${r.name}: parse`);
    assert.ok(typeof FLAG_DOCS[r.name] === 'string' && FLAG_DOCS[r.name].length > 3, `${r.name}: doc (src/core/flags-docs.js)`);
    assert.equal(r.doc, undefined, `${r.name}: no doc text in the shipped table`);
    assert.deepEqual(r.parse(null), r.default, `${r.name}: an absent flag reads as its default`);
  }
});

test('every flag read in src/ is a row of the table, and nothing reads the URL around it', () => {
  const read = /(?<![\w.$/])(?:FLAGS|flags)\??\.([A-Za-z_]\w*)|toFlags\([^()]*\)\.([A-Za-z_]\w*)/g;
  const missing = [], adHoc = [], seen = new Set();
  for (const p of SRC) {
    const rel = p.slice(ROOT.length + 1), lines = strip(readFileSync(p, 'utf8')).split('\n');
    lines.forEach((l, i) => {
      for (const m of l.matchAll(read)) { const n = m[1] ?? m[2]; seen.add(n); if (!NAMES.has(n)) missing.push(`${rel}:${i + 1} ${n}`); }
      // a dynamic read names its keys in the list just above it (src/modes/daysail/index.js: the wake's tuning uniforms)
      if (/flags\[/.test(l)) {
        const keys = [...lines.slice(Math.max(0, i - 2), i + 1).join('\n').matchAll(/\['([A-Za-z_]\w*)',/g)].map((k) => k[1]);
        assert.ok(keys.length > 0, `${rel}:${i + 1}: a dynamic flag read names its keys`);
        for (const k of keys) { seen.add(k); if (!NAMES.has(k)) missing.push(`${rel}:${i + 1} ${k}`); }
      }
      // the URL is read only through the table: no URLSearchParams on the page's query, no regex on it
      // (src/shell.js builds the next URL from the current one: a write, not a read)
      if (/URLSearchParams\((?:globalThis\.)?location\.search\)\.(get|has)\(|[[(]\?&\]/.test(l)) adHoc.push(`${rel}:${i + 1}`);
      if (/new URLSearchParams\((?:globalThis\.)?location\.search\)/.test(l) && !/\.set\(/.test(l) && !rel.endsWith('shell.js')) adHoc.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(missing, [], 'flags read in src/ but not in src/core/flags.js');
  assert.deepEqual(adHoc, [], 'ad hoc reads of location.search');
  // and the table has no row nothing reads (src/ or the loading shell's inline script below)
  const shell = readFileSync(join(ROOT, 'src/ui/loading-shell.html'), 'utf8');
  for (const m of shell.matchAll(/\[\?&\]\(?([A-Za-z_|]+)\)?=/g)) for (const n of m[1].split('|')) seen.add(n);
  assert.deepEqual([...NAMES].filter((n) => !seen.has(n)), [], 'rows that nothing reads');
});

test('the loading shell (src/ui/loading-shell.html, inlined by tools/loading_shell.py) reads only flags in the table', () => {
  const pages = ['src/ui/loading-shell.html', 'index.html', 'demos/loading.html'].map((f) => readFileSync(join(ROOT, f), 'utf8'));
  for (const html of pages) {
    const names = [...html.matchAll(/\[\?&\]\(?([A-Za-z_|]+)\)?=/g)].flatMap((m) => m[1].split('|'));
    assert.ok(names.length >= 4, 'the shell reads card, headless, noload and mode');
    for (const n of names) assert.ok(NAMES.has(n), `the shell reads ?${n}=, not in the table`);
  }
});

test('parseFlags: typed values, defaults, frozen; a string, a URLSearchParams or a "?" query alike', () => {
  const f = parseFlags('?mode=sail&headless&gustfx=0&film=1&exposure=4.5&golden=');
  assert.equal(f.mode, 'sail');
  assert.equal(f.headless, '', 'a string flag keeps its raw value (present, empty)');
  assert.equal(f.gustfx, false); assert.equal(f.warm, true, 'an on flag is on unless =0');
  assert.equal(f.film, true); assert.equal(f.bank, false, 'an opt-in flag is off unless =1');
  assert.equal(f.golden, true, 'a present flag is on with any value');
  assert.equal(f.exposure, 4.5); assert.equal(f.t, 0, 'a number flag has its default');
  assert.equal(f.hour, null); assert.equal(f.nonsense, undefined);
  assert.ok(Object.isFrozen(f) && isFlags(f));
  assert.deepEqual(parseFlags(new URLSearchParams('mode=sail&headless')), parseFlags('mode=sail&headless'));
  assert.deepEqual(parseFlags('a=1'), parseFlags(''));
  assert.throws(() => { 'use strict'; f.mode = 'cruise'; });
});

test('withFlags: a frozen copy (a mode\'s own), the original untouched; an unknown name throws', () => {
  const base = parseFlags('mode=regatta&headless=1');
  const own = withFlags(base, { speed: '1', settle: '0' });
  assert.equal(own.speed, '1'); assert.equal(own.settle, '0'); assert.equal(own.mode, 'regatta');
  assert.equal(base.speed, null); assert.equal(base.settle, null);
  assert.ok(Object.isFrozen(own) && isFlags(own));
  assert.throws(() => withFlags(base, { nosuchflag: '1' }), /nosuchflag/);
});

test('toFlags: a flags object passes through; a string is parsed once; FLAGS follows location.search and is read-only', () => {
  const f = parseFlags('seed=3');
  assert.equal(toFlags(f), f);
  assert.equal(toFlags('seed=4'), toFlags('seed=4'), 'cached by string');
  assert.equal(toFlags(null).seed, null);
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', { value: { search: '?seed=7&clouds=0' }, configurable: true, writable: true });
    assert.equal(FLAGS.seed, '7'); assert.equal(FLAGS.clouds, false);
    assert.equal(withFlags(FLAGS, {}).seed, '7', 'a copy of the page\'s flags');
    globalThis.location = { search: '' };
    assert.equal(FLAGS.seed, null);
    assert.throws(() => { FLAGS.seed = '1'; }, TypeError);
    assert.ok('seed' in FLAGS && !('nosuchflag' in FLAGS));
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location;
  }
});
