// refactor round 3 C2: the plug-in list (engine/plugins.js) and the living lake's rows (living/lakePlugins.js). The order per
// anchor is boot()'s order before the move (recorded from main.js at d08ea590; Tessie's rows from main.js at 64a42977, C3; the fireworks' from main.js at cf282a91); a change
// here is a change of step or draw order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginList, checkOrder, fetchChunks } from '../engine/plugins.js';
import { LAKE_PLUGINS, ORDER } from '../living/lakePlugins.js';

// boot()'s order at each anchor before the move (Tessie moved in at C3; the fireworks at the round 3 follow-up, from main.js at cf282a91)
const RECORDED = {
  'create.living': ['kayaks', 'tour', 'paddle', 'power'],
  'create.birds': ['birds'],
  'create.tessie': ['tessie'],
  'create.fireworks': ['fireworks'],
  'create.anchorage': ['anchored', 'busy'],
  boat: ['anchored', 'tour', 'busy', 'paddle', 'power'],
  'boot.night': ['fireworks'],
  'boot.pipes': ['fireworks'],
  'graph.post': ['fireworks'],
  'compute.forest': ['fireworks'],
  'scene.depth': ['fireworks'],
  'start.pose': ['fireworks'],
  attach: ['fireworks', 'kayaks', 'tessie'],
  audio: ['kayaks', 'tessie'],
  'audio.late': ['tour', 'power'],
  'audio.prepare': ['birds'],
  music: ['birds'],
  'compute.water': ['tessie', 'tour', 'paddle', 'power', 'birds'],
  'fill.boats': ['anchored', 'busy', 'tour', 'paddle', 'power'],
  'fill.living': ['kayaks', 'tessie'],
  'fill.birds': ['birds'],
  'night.lights': ['anchored', 'tour', 'paddle'],
  'scene.solid': ['kayaks', 'tessie'],
  'scene.solid2': ['birds', 'fireworks'],
  'scene.solid3': ['tour', 'paddle', 'power'],
  'scene.water': ['birds', 'tour'],
  'scene.mirror': ['kayaks', 'tessie'],
  'scene.light': ['fireworks'],
  'scene.clear': ['tour'],
  'sim.living': ['kayaks'],
  'sim.tessie': ['tessie'],
  'camera.cruise': ['fireworks'],
  'camera.race': ['fireworks'],
  'race.salute': ['fireworks'],
  'show.t': ['fireworks'],
  'sim.show': ['fireworks'],
  'post.bloom': ['fireworks'],
  'prime.terrain': ['birds'],
  'prime.boat': ['kayaks', 'tour'],
  'prime.tessie': ['tessie'],
  'prime.show': ['fireworks'],
  'stats.living': ['kayaks'],
  'stats.tessie': ['tessie'],
  'stats.birds': ['birds'],
  'stats.show': ['fireworks'],
  'stats.lake': ['anchored', 'busy', 'tour', 'paddle', 'power'],
};

test('the lake list: every plug-in and anchor in ORDER, the order as boot() had it', () => {
  assert.deepEqual(checkOrder(LAKE_PLUGINS, ORDER), []);
  assert.deepEqual(ORDER, RECORDED);
});

test('the three boot paths read one prime list; each plug-in says which paths prime it', () => {
  const list = createPluginList(LAKE_PLUGINS, ORDER, { inGroup: (g, f) => f() });
  for (const [k, ids] of Object.entries(ORDER)) if (k.startsWith('prime.')) {
    const st = k.slice(6);
    for (const path of ['capture', 'filmui', 'live']) assert.deepEqual(list.primeOrder(st, path), ids.filter((id) => LAKE_PLUGINS.find((d) => d.id === id).prime.paths.includes(path)));
  }
  assert.deepEqual(list.primeOrder('boat', 'live'), []);   // kayaks stream on a live page: not primed
  assert.deepEqual(list.primeOrder('tessie', 'live'), []);   // Tessie: a capture's and a film's only (a live page loads her on its own)
});

// a fake lake: the runner's order, the switch, the async load, stats and hooks
const calls = [];
const def = (id, on, extra = {}) => ({ id, on: () => on, createAt: 'a', group: `g-${id}`, create: (c, mods) => ({ id, mods, dispose: () => calls.push(`dispose ${id}`) }),
  at: { step: (i, c, dt) => calls.push(`step ${i.id} ${dt}`), lit: (i, c, n) => n + 1 }, statsAt: 's', stats: (i) => ({ [id]: i ? 'on' : null }), hook: (i) => ({ [id]: i }),
  prime: { stage: 'p', paths: ['capture'], run: async (i) => { calls.push(`prime ${i.id}`); } }, ...extra });
const FAKE_ORDER = { 'create.a': ['x', 'y', 'z'], step: ['z', 'x', 'y'], lit: ['x', 'y', 'z'], 'prime.p': ['y', 'x', 'z'], 'stats.s': ['x', 'y', 'z'] };

test('the runner: per-anchor order, an off plug-in skipped whole, its stats and hook off, groups, dispose', async () => {
  calls.length = 0;
  const groups = [];
  const defs = [def('x', true), def('y', false), def('z', true, { load: async () => 'chunk' })];
  const list = createPluginList(defs, FAKE_ORDER, { inGroup: (g, f) => { groups.push(g); return f(); } });
  const p = list.create('a');
  assert.ok(p instanceof Promise, 'a load() makes create async');
  await p;
  assert.deepEqual(groups, ['g-x', 'g-z']);
  assert.deepEqual(list.on, ['x', 'z']);
  assert.equal(list.get('y'), null);
  assert.equal(list.get('z').mods, 'chunk');
  list.run('step', 0.5);
  assert.deepEqual(calls, ['step z 0.5', 'step x 0.5']);
  assert.equal(list.reduce('lit', 3), 5);
  await list.prime('p', 'capture'); await list.prime('p', 'live');
  assert.deepEqual(calls.slice(2), ['prime x', 'prime z']);
  assert.deepEqual(list.stats('s'), { x: 'on', y: null, z: 'on' });
  assert.deepEqual(Object.keys(list.hooks()), ['x', 'y', 'z']);
  assert.equal(list.hooks().y, null);
  list.dispose();
  assert.deepEqual(calls.slice(-2), ['dispose z', 'dispose x']);
});

test('a sync anchor stays sync (no extra await in boot)', () => {
  const list = createPluginList([def('x', true)], { 'create.a': ['x'], step: ['x'], lit: ['x'], 'prime.p': ['x'], 'stats.s': ['x'] }, { inGroup: (g, f) => f() });
  assert.equal(list.create('a'), undefined);
  assert.ok(list.has('x'));
});

test('a plug-in anchor missing from ORDER, or an ORDER row with no hook, is refused', () => {
  const ok = { 'create.a': ['x'], step: ['x'], lit: ['x'], 'prime.p': ['x'], 'stats.s': ['x'] };
  assert.throws(() => createPluginList([def('x', true)], { ...ok, step: [] }, {}), /ORDER misses step: x/);
  assert.throws(() => createPluginList([def('x', true)], { ...ok, draw: ['x'] }, {}), /no such anchor/);
  assert.throws(() => createPluginList([def('x', true)], { ...ok, step: ['x', 'q'] }, {}), /unknown q/);
});

test('asking the list: some (every on plug-in asked), first (the first answer not null), runs; fetchChunks', async () => {
  const asked = [];
  const q = (id, on, v) => ({ id, on: () => on, createAt: 'a', create: () => ({ id }), at: { ask: (i) => { asked.push(i.id); return v; }, pick: () => (v === false ? null : v) } });
  const list = createPluginList([q('x', true, false), q('y', false, true), q('z', true, 7)], { 'create.a': ['x', 'y', 'z'], ask: ['z', 'x', 'y'], pick: ['x', 'y', 'z'] }, { inGroup: (g, f) => f() });
  list.create('a');
  assert.equal(list.some('ask'), true);
  assert.deepEqual(asked, ['z', 'x'], 'each on plug-in asked once, in ORDER (an event reaches all)');
  assert.equal(list.first('pick'), 7);
  assert.equal(list.first('none'), null);
  assert.equal(list.runs('ask'), true);
  assert.equal(list.runs('none'), false);
  const chunks = fetchChunks([{ id: 'a', fetch: (f) => (f('a').on ? Promise.resolve('A') : null) }, { id: 'b', fetch: (f) => (f('b').on ? Promise.resolve('B') : null) }, { id: 'c' }], (k) => ({ on: k === 'a' }));
  assert.deepEqual(Object.keys(chunks), ['a', 'b']);
  assert.equal(await chunks.a, 'A');
  assert.equal(chunks.b, null);
});

test('the fireworks row: off whole where its chunk is not fetched (a phone), its prime a capture\'s only', () => {
  const fwRow = LAKE_PLUGINS.find((d) => d.id === 'fireworks');
  const list = createPluginList(LAKE_PLUGINS, ORDER, { inGroup: (g, f) => f(), chunks: { fireworks: null } });
  assert.equal(fwRow.on({ chunks: { fireworks: null } }), false);
  assert.equal(list.create('fireworks'), undefined);
  assert.equal(list.has('fireworks'), false);
  assert.deepEqual(list.stats('show'), { fireworks: null });
  assert.equal(list.hooks().fireworks, null);
  assert.equal(list.reduce('post.bloom', 1), 1);
  assert.equal(list.first('show.t'), null);
  assert.equal(list.some('race.salute'), false);
  assert.deepEqual(list.primeOrder('show', 'capture'), ['fireworks']);
  assert.deepEqual(list.primeOrder('show', 'live'), []);
});
