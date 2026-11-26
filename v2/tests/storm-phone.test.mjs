// No storm on a phone (owner, 2026-11-18: "Remove storm from phone"; src/core/features.js storm): the registry row on the six
// devices, the fair stand-in a phone runs instead of the storm (sim/stormOff.js: every start refused, the fair rows), and the
// Weather menu without its Storm row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { createStormOff } from '../sim/stormOff.js';
import { createStorm } from '../sim/storm.js';
import { createFrameUniforms } from '../engine/uniforms.js';
import { weatherMenu } from '../../src/sim/weather/weatherMenu.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const featuresOn = (dev, gpu, ctx = {}, search = '') => {
  const win = { ...DEVICES[dev], location: { search } };
  const pr = { get: () => profileOf(readFacts(win), forcedOf(search), { gpu }), on: () => () => {} };
  return createFeatures({ profile: pr, doc: null }).configure({ headless: false, flags: {}, ...ctx });
};

test('the storm row: off on a phone (fixed at build), on for a tablet and a desktop; a capture keeps it unless ?profile= forces a phone', () => {
  const want = { ipadTrackpad: 'on', touchLaptop: 'on', smallDesktop: 'on', iphoneTurned: 'off', androidSideways: 'off', desktop: 'on' };
  for (const [dev, t] of Object.entries(want)) assert.equal(featuresOn(dev, 1).feature('storm').tier, t, dev);
  assert.equal(featuresOn('iphoneTurned', 1).feature('storm').fixed, true);
  assert.equal(featuresOn('desktop', 3).feature('storm').on, true, 'a weak desktop GPU keeps it (the form decides)');
  assert.equal(featuresOn('iphoneTurned', 1, { headless: true }).feature('storm').on, true, 'a capture keeps the storm');
  assert.equal(featuresOn('desktop', 0, { headless: true }, '?profile=form:phone').feature('storm').on, false, 'a forced phone');
  assert.equal(featuresOn('iphoneTurned', 1, {}, '?profile=form:tablet').feature('storm').on, true, 'a phone forced to a tablet');
});

const field = () => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, base: { dirDeg: 200, speedMs: 6 } }); w.setTerrain(() => 0); return w; };

test('a phone never enters a storm: every start refused through the whole arc, the rows the fair ones, the water\'s wind the base', () => {
  const S = createStormOff();
  // what the page would ask: ?weather=storm&stormt=150, ?storms=natural, the Weather menu's Storm, the fair choice
  assert.equal(S.begin({ natural: true }), false);
  assert.equal(S.start({ s0: 150, rate: 1, ref: [2300, -1400], t0: 0 }), null);
  assert.equal(S.choose('storm'), 'fair');
  for (let t = 0; t <= 400; t += 0.5) {
    const info = S.update(15);
    assert.equal(S.running, false); assert.equal(S.weather.on, 0); assert.equal(S.rain, 0);
    assert.equal(info.phase, 'none'); assert.equal(S.frame.ran, false); assert.equal(S.frame.strikes.length, 0);
  }
  assert.deepEqual(S.strikesFrom(150, 6), []);
  const base = { speedMs: 6, dirDeg: 200, travelRad: 0.3 }, out = {};
  assert.deepEqual(S.waterWind(base, out), { ...base, gain: 1 });
  // the fair rows are the real storm's rows with no storm running, number for number
  const U1 = createFrameUniforms(), U2 = createFrameUniforms(); U1.begin(); U2.begin();
  const real = createStorm({ windField: field(), seed: 1, now: () => 0, eye: () => [0, 2, 0], sunDir: () => ({ x: 0, y: 1, z: 0 }), sunElev: () => 60, exposure: () => 0.26 });
  real.begin(); real.update(14); real.fillFrame(U1, [0, 2, 0]);
  assert.equal(S.fillFrame(U2, [0, 2, 0]), 1);
  const o = U1.layout.offsets;
  for (const f of ['storm', 'rain', 'cell', 'front', 'bow']) for (let i = 0; i < 4; i++) assert.equal(U2.view[o[f] + i], U1.view[o[f] + i], `${f}[${i}]`);
});

test('the Weather menu without a storm: Clear and Fair only, Storm refused, the sky never reads storm', () => {
  const deck = { value: 0.6 };
  const wx = weatherMenu({ storm: null, deck });
  assert.deepEqual(wx.rows.map((r) => r.id), ['clear', 'fair']);
  assert.equal(wx.pick('storm'), null);
  assert.equal(wx.current(), 'fair');
  assert.equal(wx.pick('clear'), 'clear'); wx.update(0); wx.update(20);
  assert.ok(deck.value < 0.6, 'Clear still eases the deck');
  // a tablet or a desktop keeps all three
  assert.deepEqual(weatherMenu({ storm: createStorm({ windField: field() }), deck: { value: 0.6 } }).rows.map((r) => r.id), ['clear', 'fair', 'storm']);
});

// storm round 2 (2026-11-18): the sea's inputs under the outflow; calmer (2026-11-26): only a little bigger than the fair day's
import { stormSea, STORM_SEA } from '../sim/stormSea.js';
import { seaTables, seaWeights, composeSea, significantHeight, LENGTHS, CPU_CASCADES } from '../sim/spectrum.js';
import { createWeatherState } from '../../src/sim/weather/state.js';

const tablesBy = new Map();
const hsAt = (U, fetchM, x, z) => {   // the drawn sea's significant height (m) at a spot, as render/water.js composes it (the default sea state)
  if (!tablesBy.has(U)) tablesBy.set(U, seaTables({ speedMs: U, sea: 'big' }));
  return significantHeight(composeSea(tablesBy.get(U), seaWeights({ U, fetchM, x, z })), LENGTHS, CPU_CASCADES);
};

test('the storm\'s sea: no storm and the phone\'s stand-in leave it alone; the outflow eases it in; the spot\'s fetch kept', () => {
  const fair = { speedMs: 9.1, gain: 1.45, fetchM: 2500 };
  assert.deepEqual(stormSea({ ...fair }, createWeatherState()), { ...fair, capK: 1 }, 'no storm');
  assert.deepEqual(stormSea({ ...fair }, createStormOff().weather), { ...fair, capK: 1 }, 'a phone');
  const W = createWeatherState(); W.on = 1; W.front[3] = 1;
  const o = stormSea({ ...fair }, W);
  assert.ok(Math.abs(o.speedMs - 9.1 / 1.45 * (1 + STORM_SEA.wind)) < 1e-9, 'the day\'s wind (the outflow\'s gain out) x (1 + wind)');
  assert.equal(o.fetchM, fair.fetchM, 'the spot\'s own fetch');
  assert.ok(o.capK > 1.5, `the whitecaps' share raised: x ${o.capK}`);
  W.front[3] = 0.5; const h = stormSea({ ...fair }, W);
  assert.ok(Math.abs(h.speedMs - (fair.speedMs + o.speedMs) / 2) < 1e-9 && h.capK > 1 && h.capK < o.capK, 'half the outflow, half the way');
  assert.equal(stormSea({ speedMs: 9 }, { on: 1, front: [0, 0, 0, 1] }).speedMs, 9 * (1 + STORM_SEA.wind), 'no gain given: the speed is the day\'s');
});

test('the storm\'s sea is only a little bigger than the fair day\'s at the storm\'s spots (Hs x 1.3 to 1.5), never the first cheat\'s 2-4 x', () => {
  // the spots and the winds a storm brings (measured on the page at 18:25, wind level 2, the storm over each spot 150 s in):
  // the day's wind 6.28 m/s, the outflow's gain 1.41 at the eye; the fair fetch along the day's wind (main.js seaNow)
  const U = 6.28, gain = 1.41;
  const spots = [
    { name: 'Emerald Bay\'s mouth', x: 2300, z: -1400, fetchM: 1005 },
    { name: 'the open lake', x: 3000, z: -3500, fetchM: 3050 },
    { name: 'the bay\'s entrance (cam E)', x: 1050, z: -820, fetchM: 1219 },
  ];
  const W = createWeatherState(); W.on = 1; W.front[3] = 1;
  for (const s of spots) {
    const fair = hsAt(U, s.fetchM, s.x, s.z);
    const o = stormSea({ speedMs: U * gain, gain, fetchM: s.fetchM }, W);
    const r = hsAt(o.speedMs, o.fetchM, s.x, s.z) / fair;
    assert.ok(r >= 1.3 && r <= 1.5, `${s.name}: storm ${hsAt(o.speedMs, o.fetchM, s.x, s.z).toFixed(2)} m vs fair ${fair.toFixed(2)} m (x ${r.toFixed(2)})`);
    // the first cheat (the sea's wind x 1.6 on the outflow's, the fetch toward 10 km) for contrast: far outside the band
    const old = hsAt(U * gain * 1.6, 10000, s.x, s.z) / fair;
    assert.ok(old > 2, `${s.name}: the first cheat drew x ${old.toFixed(2)}`);
  }
});

test('a phone (no clouds, no storm) has no Weather rows; clouds or a storm bring them back (owner, 2026-11-21)', () => {
  assert.deepEqual(weatherMenu({ storm: null, deck: { value: 0.4 }, sky: false }).rows, []);
  assert.deepEqual(weatherMenu({ storm: null, deck: { value: 0.4 } }).rows.map((r) => r.id), ['clear', 'fair']);
  assert.deepEqual(weatherMenu({ storm: { running: false }, deck: { value: 0.4 }, sky: false }).rows.map((r) => r.id), ['clear', 'fair', 'storm']);
});
