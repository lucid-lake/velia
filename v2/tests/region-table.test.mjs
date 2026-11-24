// The region table (refactor round 3 C5, v2/sim/regions.js): every reader's output equals the separate tables it replaced, digit
// for digit (fixtures/regions-before.json: busyLake.js REGIONS, kayakLaunch.js LAUNCH_SPOTS, places.js CUPS and cupAt on a 50 m
// grid, the chart's NAMES and the birthplaces, written from main at cd963ce3 before the merge into one table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGIONS } from '../living/busyLake.js';
import { LAUNCH_SPOTS } from '../living/kayakLaunch.js';
import { CUPS, cupAt, listCups } from '../sim/racePlaces.js';
import { NAMES } from '../ui/chart/chartModel.js';
import { listBirthplaces } from '../sim/birthplace.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/regions-before.json', import.meta.url), 'utf8'));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('region table: the busy lake, the launch spots, the cups and the birthplaces are the old tables', () => {
  assert.deepEqual(plain(REGIONS), BEFORE.REGIONS);
  assert.deepEqual(plain(LAUNCH_SPOTS), BEFORE.LAUNCH_SPOTS);
  assert.deepEqual(plain(CUPS), BEFORE.CUPS);
  assert.deepEqual(plain(listBirthplaces(CURRENT_WATERS, { all: true })), BEFORE.birthplaces);
  assert.deepEqual(listCups().map((c) => c.hunt.name), ['Chart the Bay', 'Chart the Mouth']);
});

test('region table: the chart names are the old ones (the regions\' names first) and cupAt is the old rule everywhere', () => {
  const byId = (a) => [...a].sort((p, q) => p.id.localeCompare(q.id));
  assert.deepEqual(byId(plain(NAMES)), byId(BEFORE.NAMES));
  const { x0, z0, step, rows, nan } = BEFORE.cupAt;
  rows.forEach((row, j) => { let s = ''; for (let i = 0; i < row.length; i++) { const c = cupAt(x0 + i * step, z0 + j * step); s += c === 'the-mouth' ? 'm' : c === 'emerald-bay' ? 'e' : '?'; } assert.equal(s, row, `z ${z0 + j * step}`); });
  assert.equal(cupAt(NaN, 0), nan);
});
