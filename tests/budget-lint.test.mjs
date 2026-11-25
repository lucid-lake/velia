// A new test may not assert a wall-clock budget without the strict switch (tests/helpers/budget.mjs, LAKESHORE_STRICT=1).
// A line that reads the clock (performance.now, Date.now, hrtime) and asserts in the same statement fails here: time it,
// then call budget(value, limit, what). A file that times with bestOf must import budget(). A count of work (box tests,
// steps) is asserted with assert, always, no switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// file → why a clock-reading assert is fine there
const ALLOW = {
  'v2/tests/pipelines.test.mjs': 'a lower bound on a delay: load only makes it longer',
  'tests/helmStepClock.test.mjs': 'drives the clock itself',
};
const dirs = ['tests', 'v2/tests', 'classic/tests'];
const files = () => dirs.flatMap((d) => { let n = []; try { n = readdirSync(root + d).filter((x) => x.endsWith('.test.mjs')); } catch { /* no such folder */ } return n.map((x) => `${d}/${x}`); })
  .filter((rel) => !ALLOW[rel] && !rel.endsWith('budget-lint.test.mjs'));

test('no test asserts a wall-clock budget without budget()', () => {
  const bad = [];
  for (const rel of files()) {
    readFileSync(root + rel, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*\/\//.test(l) || /\bbudget\(/.test(l)) return;
      if (/\bassert[\w.]*\(/.test(l.replace(/\bbudget\([^;]*;?/, '')) && /(performance\.now|Date\.now|hrtime)\s*\(/.test(l)) bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [], 'time it, then budget(value, limit, what) from tests/helpers/budget.mjs');
});

test('a file that times with bestOf imports budget()', () => {
  const bad = files().filter((rel) => { const s = readFileSync(root + rel, 'utf8'); return /\b(bestOf|bestOfEach)\(/.test(s) && !/helpers\/budget\.mjs/.test(s); });
  assert.deepEqual(bad, []);
});
