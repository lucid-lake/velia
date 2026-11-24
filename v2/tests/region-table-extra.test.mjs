// The region table (refactor round 3 C5): a lake profile with one more region row (a fake 'tahoe-city': one lane, one birthplace,
// one put-in, one boat, a cup and its chart name) reaches every reader with no code edit: the busy lake, the resident kayakers, the
// launch spots, the birthplaces, Regatta's cups and cupAt, the chart's names. Its own process (node --test runs a file a process),
// so the fixture profile is the page's CURRENT_WATERS (src/sim/waters/current.js: globalThis.__lakeshoreWaters wins in node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LAKE = JSON.parse(readFileSync(new URL('../../src/waters/tahoe-emerald.json', import.meta.url), 'utf8'));
const CITY = {
  id: 'tahoe-city', name: 'Tahoe City', centre: [-6000, 0], radiusM: 1200, area: [[null, -3000, null, null]], neighbours: [],
  label: { id: 'n-tahoe-city', text: 'Tahoe City', x: -6000, z: 0, cls: 'A', kind: 'water' },
  birthplaces: [{ id: 'city-pier', name: 'Off the pier', x: -6000, z: 100, look: [-6200, 100], why: 'A fixture.' }],
  kayaks: [{ id: 'kayak-city', lane: [[-6100, -100], [-5900, -100], [-5900, 100], [-6100, 100]], colour: 'red', pfd: 'blue' }],
  launchSpots: [{ id: 'city-beach', name: 'the city beach', at: [-6150, 0] }],
  boats: [{ id: 'city-lane', prio: 0, tint: '#f4f2ec', sail: null, route: [[-6300, -300], [-5700, 300]] }],
  cup: { id: 'tahoe-city', name: 'Tahoe City', line: 'A fixture cup.', races: ['tea-house-run'], hunt: 'chart-the-city', huntName: 'Chart the City' },
};
globalThis.__lakeshoreWaters = { ...LAKE, regions: [...LAKE.regions, CITY] };

const { REGIONS, regionsWithBirthplaces, activeRegions, residentKayaks } = await import('../living/busyLake.js');
const { LAUNCH_SPOTS } = await import('../living/kayakLaunch.js');
const { CUPS, cupAt, listCups } = await import('../sim/racePlaces.js');
const { NAMES } = await import('../ui/chart/chartModel.js');
const { listBirthplaces } = await import('../sim/birthplace.js');
const { CURRENT_WATERS } = await import('../../src/sim/waters/current.js');
const { polyline } = await import('../../src/sim/kayaks/routes.js');

test('region table: an extra region row reaches every reader', () => {
  const bps = listBirthplaces(CURRENT_WATERS);
  assert.deepEqual(bps.at(-1), { id: 'city-pier', name: 'Off the pier', x: -6000, z: 100, look: [-6200, 100], region: 'tahoe-city', unlock: 'always', why: 'A fixture.', locked: false }, 'its birthplace, with its region');
  assert.equal(bps.length, 6);
  assert.deepEqual(REGIONS.map((r) => r.id), ['emerald-bay', 'tahoe-west', 'tahoe-city'], 'the busy lake has its row');
  assert.deepEqual(regionsWithBirthplaces(REGIONS, bps).map((r) => r.id), ['emerald-bay', 'tahoe-west', 'tahoe-city'], 'live: it has a birthplace');
  assert.deepEqual([...activeRegions(REGIONS, -6000, 0)], ['tahoe-city'], 'the player inside it');
  assert.deepEqual(REGIONS[2].boats.map((b) => b.id), ['city-lane'], 'its traffic');
  const slots = residentKayaks(REGIONS, bps, { seed: 1, hour: 13, polyline }).filter((s) => s.region === 'tahoe-city');
  assert.deepEqual(slots.map((s) => s.route.id), ['kayak-city'], 'its kayaker on its one lane');
  assert.deepEqual(LAUNCH_SPOTS['tahoe-city'].map((s) => s.id), ['city-beach'], 'its put-in');
  assert.deepEqual(CUPS.map((c) => c.id), ['emerald-bay', 'the-mouth', 'tahoe-city'], 'its cup, last in hub order');
  assert.equal(listCups().at(-1).hunt.name, 'Chart the City');
  assert.equal(cupAt(-6000, 0), 'tahoe-city', 'the hub opens on its cup inside its area');
  assert.equal(cupAt(300, -400), 'emerald-bay', 'the bay is still the bay');
  assert.equal(cupAt(2200, -1500), 'the-mouth');
  assert.ok(NAMES.some((n) => n.id === 'n-tahoe-city' && n.text === 'Tahoe City'), 'the chart names it');
});
