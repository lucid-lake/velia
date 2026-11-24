// The features list (src/features/index.js, refactor round 2 Phase C step 3): the fireworks, the marks, the kayak stage and
// fleet attach in one loop; the clock menu's Fireworks row and the Setup rows come from the rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, checkFeatures, featuresFor, attachFeatures, featureSettings, featureTimeRows, SHOW_START_HOUR, FIREWORKS_LEAD_H } from '../classic/src/features/index.js';
import { SHOW_START_HOUR as SHOW_HOUR } from '../src/fireworks/show.js';
import { FIREWORKS_LEAD_H as LEAD } from '../src/ui/timeMenu.js';
import { featureTimeRows as pureTimeRows, SHOW_START_HOUR as PURE_HOUR } from '../src/features/timeRows.js';
import { MODE_ROWS } from '../classic/src/modes/registry.js';
import { parseFlags } from '../src/sim/core/flags.js';
import { pagesHtml } from '../src/ui/homePages.js';

const core = (q = '', headless = false) => ({ flags: parseFlags(q), headless });

test('the show\'s hour and the clock lead agree with the fireworks\' own', () => {
  assert.equal(SHOW_START_HOUR, SHOW_HOUR); assert.equal(FIREWORKS_LEAD_H, LEAD);
});

test('the clock menu\'s pure half (src/features/timeRows.js, v2 mounts it) is the same rows as the features list\'s', () => {
  assert.deepEqual(pureTimeRows(), featureTimeRows());
  pureTimeRows().forEach((r, i) => assert.equal(r, featureTimeRows()[i], 'the very same row objects'));
  assert.equal(PURE_HOUR, SHOW_START_HOUR);
});

test('which features attach where: Sail marks + fleet (+ the stage with ?kayak), Regatta marks, Cruise the fleet; the core the show', () => {
  const ids = (c, o) => featuresFor(c, o).map((f) => f.id);
  assert.deepEqual(ids(core(''), { scope: 'mode', mode: 'sail' }), ['marks', 'kayakFleet']);
  assert.deepEqual(ids(core('kayak=1'), { scope: 'mode', mode: 'sail' }), ['marks', 'kayakStage', 'kayakFleet']);
  assert.deepEqual(ids(core('kayaks=0'), { scope: 'mode', mode: 'sail' }), ['marks']);
  assert.deepEqual(ids(core(''), { scope: 'mode', mode: 'regatta' }), ['marks']);
  assert.deepEqual(ids(core(''), { scope: 'mode', mode: 'cruise' }), ['kayakFleet']);
  assert.deepEqual(ids(core(''), { scope: 'mode', mode: 'fly' }), []);
  assert.deepEqual(ids(core(''), { scope: 'core', ctx: { fireworksOn: true, options: {} } }), ['fireworks']);
  assert.deepEqual(ids(core(''), { scope: 'core', ctx: { fireworksOn: true, options: { ownFireworks: true } } }), []);
  assert.deepEqual(ids(core('fwlook=20', true), { scope: 'core', ctx: { fireworksOn: false, options: {} } }), ['fireworksLook']);
  assert.deepEqual(ids(core('fwlook=20', false), { scope: 'core', ctx: { fireworksOn: false, options: {} } }), []);
  const modeIds = new Set(MODE_ROWS.map((r) => r.id));
  for (const f of FEATURES.filter((f) => f.scope === 'mode')) for (const m of f.modes) assert.ok(modeIds.has(m), `${f.id}: mode ${m} is a registry row`);
});

test('the loop: list order, the caller\'s arguments, the context; update in order, dispose in reverse', async () => {
  const log = [];
  const row = (id, extra = {}) => ({ id, scope: 'mode', modes: ['sail'], load: async () => ({ id }),
    attach: (m, c, player, ctx) => { log.push(`attach ${m.id} ${player} ${ctx.tag}`); return { update: (...a) => log.push(`update ${id} ${a.join(',')}`), dispose: () => log.push(`dispose ${id}`) }; }, ...extra });
  const list = checkFeatures([row('a'), row('b', { on: () => false }), row('c'), { ...row('d'), attach: () => null }]);
  const F = await attachFeatures(core(''), 'P', { scope: 'mode', mode: 'sail', ctx: { tag: 'T' }, list });
  assert.deepEqual(F.ids, ['a', 'c', 'd']);
  assert.equal(F.get('b'), null); assert.equal(typeof F.get('a').update, 'function'); assert.equal(F.get('d'), null);
  F.update(0.5, 1);
  F.dispose();
  assert.deepEqual(log, ['attach a P T', 'attach c P T', 'update a 0.5,1', 'update c 0.5,1', 'dispose c', 'dispose a']);
});

test('the menus\' rows come from the features: Setup (camera to kayaks, the radio) and the clock\'s Fireworks', () => {
  assert.deepEqual(featureSettings(parseFlags('')).map((s) => s.key), ['kayakCam', 'boatRadio']);
  assert.deepEqual(featureSettings(parseFlags('kayaks=0')).map((s) => s.key), ['boatRadio']);
  assert.deepEqual(featureSettings(parseFlags('kayaks=0&fireworks=0')).map((s) => s.key), []);
  assert.deepEqual(featureTimeRows().map((r) => r.id), ['fireworks']);
  const base = { waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' };
  const none = pagesHtml(base), all = pagesHtml({ ...base, features: featureSettings(parseFlags('')) });
  assert.ok(!none.includes('data-r="kayakCam:on"') && !none.includes('data-t="boatRadio"'));
  assert.ok(all.includes('data-r="kayakCam:on"') && all.includes('data-r="kayakCam:off"'), 'the kayak camera row');
  assert.match(all, /boatRadio/, 'the radio toggle in the sound row');
});

test('a malformed feature row fails loudly', () => {
  const ok = { id: 'x', scope: 'mode', modes: ['sail'], load: () => null, attach: () => null };
  assert.doesNotThrow(() => checkFeatures([...FEATURES, ok]));
  const bad = {
    'no id': { ...ok, id: '' },
    'duplicate id': { ...ok, id: 'marks' },
    'unknown scope': { ...ok, scope: 'world' },
    'unknown key': { ...ok, colour: 'red' },
    'mode row with no modes': { ...ok, modes: [] },
    'attach not a function': { ...ok, attach: 'attachX' },
    'load not a function': { ...ok, load: null },
    'Setup row with no key': { ...ok, settings: [{ tab: 'sail', label: 'x', radio: [['a', 'b']] }] },
    'Setup row with no options': { ...ok, settings: [{ tab: 'sail', key: 'k', label: 'x' }] },
    'clock row with no pick': { ...ok, timeRows: [{ id: 'y', name: 'Y', lit: () => false }] },
    'clock row twice': { ...ok, timeRows: [{ id: 'fireworks', name: 'F', lit: () => false, pick: () => null }] },
  };
  for (const [why, row] of Object.entries(bad)) assert.throws(() => checkFeatures([...FEATURES, row]), Error, why);
});
