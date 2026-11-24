// v1's smoke (/classic/): the v1-only code v2 never loads keeps one short behaviour check per
// path a /classic/ player takes, in node with no browser: the mode chunks load and start, Sail's live controls sail a few
// seconds on keys, the home card's menu opens and a pick starts a mode. The rest of v1's own suites were trimmed to 1-2
// representative tests per area (the renderers, the loop, the kayak figure, the boot guards) in their own files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountSail } from './helpers/sail-controls.mjs';
import { mountHome } from './helpers/home-mount.mjs';
import { MODE_ROWS } from '../classic/src/modes/registry.js';
import { parseFlags } from '../src/sim/core/flags.js';

test('v1 boots its modes: every mode chunk loads and has start(); Sail, Cruise and Regatta are there', async () => {
  const ids = [];
  for (const r of MODE_ROWS.filter((r) => r.load)) {
    const m = await r.load();
    assert.equal(typeof m.start, 'function', `${r.id}: start()`);
    if (m.coreOptions) assert.ok(m.coreOptions(parseFlags(`mode=${r.id}`)), `${r.id}: coreOptions()`);
    ids.push(r.id);
  }
  for (const id of ['sail', 'cruise', 'regatta']) assert.ok(ids.includes(id), id);
});

test('v1 sails: Sail\'s live controls, 6 s on W then D: the boat gathers way, turns, and every number stays finite', () => {
  const s = mountSail({ headingDeg: 90, windKn: 12 });
  try {
    const p0 = { x: s.phys.state.x, z: s.phys.state.z, h: s.phys.state.heading };
    s.key('KeyW'); s.step(60); s.key('KeyW', false);   // 2 s of sheet
    s.key('KeyD'); s.step(60); s.key('KeyD', false);   // 2 s of helm
    s.step(60);                                         // 2 s free
    const st = s.phys.state;
    for (const k of ['x', 'z', 'heading', 'u']) assert.ok(Number.isFinite(st[k]), `${k} finite: ${st[k]}`);
    assert.ok(Math.hypot(st.x - p0.x, st.z - p0.z) > 1, `she moved: ${Math.hypot(st.x - p0.x, st.z - p0.z).toFixed(2)} m`);
    // 2 s of D turns her about 0.30 rad; the wind alone about 0.04
    assert.ok(Math.abs(st.heading - p0.h) > 0.15, `the helm turned her: ${(st.heading - p0.h).toFixed(3)} rad`);
  } finally { s.dispose(); }
});

test('v1 menu: Esc in play opens the card\'s menu; a mode pick starts that mode', async (t) => {
  const c = await mountHome({ state: 'home', clock: t });
  c.root.dataset.state = 'gone';   // in play: the card is away
  c.D.key('Escape');
  assert.equal(c.home.state, 'menu', 'Esc opens the menu');
  c.q('.lk-pick[data-mode=cruise]').click(); await c.D.settle();
  assert.deepEqual(c.log.mode, ['cruise'], 'the pick switches the world to Cruise');
  assert.equal(c.home.mode, 'cruise');
});
