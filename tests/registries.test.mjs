// The waters and vessels registries: the lists, the defaults, the choice from the URL and
// from the saved value, and the rule that a lake or boat that is not ready cannot be chosen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WATERS, DEFAULT_WATERS, chosenWaters, watersById, watersReady } from '../src/sim/waters/index.js';
import { VESSELS, DEFAULT_VESSEL, chosenVessel, vesselById } from '../src/sim/vessels/index.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('waters: tahoe-emerald is the default, with its photo, chart and coordinates', () => {
  assert.equal(DEFAULT_WATERS, 'tahoe-emerald');
  const w = watersById(DEFAULT_WATERS);
  assert.equal(w.ready, true);
  assert.ok(w.place && w.region && w.stills.hero && w.stills.hero960 && w.wind && w.chart.destination.name);
  assert.ok(Math.abs(w.lat - 38.95) < 0.1 && Math.abs(w.lon + 120.1) < 0.1);
  assert.equal(new Set(WATERS.map((x) => x.id)).size, WATERS.length, 'unique ids');
});

test('the choice: ?waters= wins, then the saved value, then the default; an unknown or not-ready id is refused', () => {
  assert.equal(chosenWaters('?waters=tahoe-emerald'), 'tahoe-emerald');
  assert.equal(chosenWaters('?waters=nowhere', 'tahoe-emerald'), 'tahoe-emerald');
  assert.equal(chosenWaters('', 'nowhere'), DEFAULT_WATERS);
  assert.equal(watersReady('nowhere'), null);
  assert.equal(chosenVessel('?vessel=halcyon'), 'halcyon');
  assert.equal(chosenVessel('?vessel=ghost', 'ghost'), DEFAULT_VESSEL);
});

test('vessels: halcyon is the default; the plate has the five lines in feet and metres; no maker or model', () => {
  const v = vesselById(DEFAULT_VESSEL);
  assert.equal(v.ready, true);
  assert.deepEqual(v.plate.map((r) => r[0]), ['Length overall', 'Beam', 'Draft', 'Sail area', 'Displacement']);
  for (const r of v.plate) assert.equal(r.length, 3);
  for (const k of ['hull', 'mast', 'main', 'jib', 'keel']) assert.match(v.profile[k], /^M /, k);
  assert.doesNotMatch(JSON.stringify(v), /Catalina|C ?28\b/i);
  assert.equal(new Set(VESSELS.map((x) => x.id)).size, VESSELS.length);
});

test('index.json: every entry has a file in its folder; the old src/lake.json is gone', () => {
  const wi = JSON.parse(read('src/waters/index.json')), vi = JSON.parse(read('src/vessels/index.json'));
  for (const w of wi.waters) assert.doesNotThrow(() => read('src/waters/' + w.file), w.file);
  for (const v of vi.vessels) assert.doesNotThrow(() => read('src/vessels/' + v.file), v.file);
  assert.throws(() => read('src/lake.json'));
  assert.ok(wi.waters.find((w) => w.id === wi.default)?.ready && vi.vessels.find((v) => v.id === vi.default)?.ready, 'the defaults are ready');
});
