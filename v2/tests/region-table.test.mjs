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
// the rows added since the merge into one table (South Lake, Phase A: its row, its pin, its chart names, its level), taken out so the
// old rows still read digit for digit; the added rows have their own test (region-level.test.mjs)
const ADDED = { regions: ['south-lake'], birthplaces: ['ski-run'], names: ['n-south-lake', 'n-ski-run', 'n-tahoe-keys', 'n-camp-richardson'] };
const old = (rows) => plain(rows).filter((r) => !ADDED.regions.includes(r.id)).map((r) => (r.neighbours ? { ...r, neighbours: r.neighbours.filter((n) => !ADDED.regions.includes(n)) } : r));

test('region table: the busy lake, the launch spots, the cups and the birthplaces are the old tables', () => {
  assert.deepEqual(old(REGIONS), BEFORE.REGIONS);
  assert.deepEqual(Object.fromEntries(Object.entries(plain(LAUNCH_SPOTS)).filter(([id]) => !ADDED.regions.includes(id))), BEFORE.LAUNCH_SPOTS);   // (South Lake's put-ins: south-paddlers.test.mjs)
  assert.deepEqual(plain(CUPS), BEFORE.CUPS);
  assert.deepEqual(plain(listBirthplaces(CURRENT_WATERS, { all: true })).filter((b) => !ADDED.birthplaces.includes(b.id)), BEFORE.birthplaces);
  assert.deepEqual(REGIONS.map((r) => r.id), ['emerald-bay', 'tahoe-west', 'south-lake']);
  assert.deepEqual(listCups().map((c) => c.hunt.name), ['Chart the Bay', 'Chart the Mouth']);
});

test('region table: the chart names are the old ones (the regions\' names first) and cupAt is the old rule everywhere', () => {
  const byId = (a) => [...a].sort((p, q) => p.id.localeCompare(q.id));
  assert.deepEqual(byId(plain(NAMES).filter((n) => !ADDED.names.includes(n.id))), byId(BEFORE.NAMES));
  const { x0, z0, step, rows, nan } = BEFORE.cupAt;
  rows.forEach((row, j) => { let s = ''; for (let i = 0; i < row.length; i++) { const c = cupAt(x0 + i * step, z0 + j * step); s += c === 'the-mouth' ? 'm' : c === 'emerald-bay' ? 'e' : '?'; } assert.equal(s, row, `z ${z0 + j * step}`); });
  assert.equal(cupAt(NaN, 0), nan);
});
