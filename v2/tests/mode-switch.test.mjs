// The page's mode switch (v2/ui/modeSwitch.js; MODE-1 to MODE-6, MODE-8, DRV-10; U4). No browser:
// Cruise and the race are fakes with their real contract (v2/cruise/index.js enter, leave, takeHelm, handBack, on, handed,
// speed; v2/regatta/index.js enter, leave, on, speed), the clock is v2's own (engine/clock.js). The browser half, on the real
// modes: v2/tests/pages/modeSwitch.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeSwitch, sailClock, raceClock, proWanted } from '../ui/modeSwitch.js';
import { createSimClock } from '../engine/clock.js';
import { dayClockSchedule, DEFAULT_TIMERATE } from '../../src/sim/timeOfDay.js';

const DEG = Math.PI / 180;
// Cruise's contract (v2/cruise/index.js): enter({ fresh, at }) sails; leave({ fresh, race }); takeHelm(o) the hand-over (Pro on,
// handed); handBack() back in place
function fakeCruise(ui, log) {
  const C = { on: false, handed: false, speed: () => (C.on ? 1 : 2),
    async enter({ fresh = true, at = null } = {}) { log.push(['cruise.enter', { fresh, at }]); if (fresh) C.handed = false; C.on = true; return C; },
    takeHelm({ pro = true } = {}) { if (!C.on) return false; C.on = false; C.handed = true; if (pro) ui.setPro(true); log.push(['cruise.takeHelm', { pro }]); return true; },
    handBack() { if (C.on) return false; C.on = true; C.handed = false; log.push(['cruise.handBack']); return true; },
    leave({ fresh = true, race = false } = {}) { const plain = fresh || race; log.push(['cruise.leave', { fresh, race }]); if (!C.on) { if (plain) C.handed = false; return C; } C.takeHelm({ pro: !plain }); if (plain) C.handed = false; return C; } };
  return C;
}
function fakeRace(log) {
  const R = { on: false, speed: () => 1, async enter() { R.on = true; log.push(['race.enter']); return R; }, leave() { R.on = false; log.push(['race.leave']); } };
  return R;
}
function rig({ flags = {}, settings = { proMode: false }, initial = 'sail', clockMode = 'day' } = {}) {
  const log = [], landed = [];
  const ui = { pro: false, setPro(on) { ui.pro = !!on; } };
  const clock = createSimClock({ hour0: 13, timerate: clockMode === 'rate' ? DEFAULT_TIMERATE : 0, schedule: clockMode === 'day' ? dayClockSchedule({ base: DEFAULT_TIMERATE }) : null });
  const B = { state: { x: 1187, z: -1046, heading: 251 * DEG } };
  let cruise = null, regatta = null;
  const store = { get: (k) => settings[k] };
  const M = createModeSwitch({ initial, P: { speed: 2 }, flags, clock, B,
    chunks: { cruise: { load: async () => (cruise ??= fakeCruise(ui, log)), get: () => cruise }, regatta: { load: async () => (regatta ??= fakeRace(log)), get: () => regatta } },
    ui: () => ui, settings: () => store, onMode: (m) => landed.push(m) });
  return { M, ui, clock, B, log, landed, get cruise() { return cruise; }, get regatta() { return regatta; } };
}

test('MODE-1: Regatta after Cruise runs at real time (1 ×), Cruise at its own, Sail at 2 ×', async () => {
  const r = rig();
  assert.equal(r.M.speed(), 2);
  await r.M.go('cruise'); assert.equal(r.M.speed(), 1, 'Cruise sails at 1 ×');
  await r.M.go('sail'); assert.equal(r.M.speed(), 2, 'Sail after Cruise: 2 × (Cruise is loaded but not on)');
  await r.M.go('regatta'); assert.equal(r.M.speed(), 1, 'the race at 1 ×, not Cruise\'s idle speed() (P.speed, 2 ×)');
});

test('MODE-2, MODE-4: Cruise → Regatta is no hand-over (no Pro forced, not handed), so ` in the race does not hand her back to Cruise', async () => {
  const r = rig();
  await r.M.go('cruise');
  await r.M.go('regatta');
  assert.equal(r.ui.pro, false, 'Pro stays off (the setting)');
  assert.equal(r.cruise.handed, false); assert.equal(r.cruise.on, false); assert.equal(r.regatta.on, true);
  assert.deepEqual(r.log.find((e) => e[0] === 'cruise.takeHelm')[1], { pro: false }, 'the quiet leave never forces Pro');
  r.M.backquote(); await new Promise((res) => setTimeout(res, 0));
  assert.ok(!(r.cruise.on && r.regatta.on), 'never both on');
  assert.equal(r.regatta.on, false, '` in a race goes to Cruise as v1\'s cruise key: the race left first');
  assert.ok(!r.log.some((e) => e[0] === 'cruise.handBack'), 'no in-place hand-back under the race');
});

test('MODE-3: the race runs the day clock at real time (rate 1); Sail\'s schedule comes back after it; ?timerate and a frozen clock hold', async () => {
  const r = rig();
  assert.equal(r.clock.rate > 1, true);
  await r.M.go('regatta');
  assert.equal(r.clock.rate, 1, 'v1\'s timeRate 1');
  await r.M.go('sail');
  assert.equal(r.clock.rate, new (await import('../../src/sim/timeOfDay.js')).RateTable((await import('../engine/clock.js')).sailSchedule()).rateAt(r.clock.hourUnwrapped), 'Sail\'s day clock again (no quick night)');
  const f = rig({ flags: { timerate: '30' }, clockMode: 'rate' });
  await f.M.go('regatta'); assert.equal(f.clock.rate, DEFAULT_TIMERATE, '?timerate wins in every mode');
  const z = createSimClock({ hour0: 13, timerate: 0 });
  assert.equal(raceClock(z, {}), false); assert.equal(z.rate, 0, 'a frozen clock stays frozen');
  assert.equal(sailClock(z, {}), false);
});

test('MODE-5: a fresh Sail after Cruise takes Pro from the setting, not from the hand-over', async () => {
  for (const proMode of [false, true]) {
    const r = rig({ settings: { proMode } });
    await r.M.go('cruise');
    await r.M.go('sail');
    assert.equal(r.ui.pro, proMode, `proMode ${proMode}`);
  }
  assert.equal(proWanted({ pro: '1' }, { get: () => false }), true, '?pro=1 wins');
  assert.equal(proWanted({ pro: '0' }, { get: () => true }), false);
});

test('MODE-6 (owner 2026-11-14: match v1): Sail → Cruise starts Cruise where she is; Cruise → Sail is a fresh Sail in place', async () => {
  const r = rig();
  await r.M.go('cruise');
  const e = r.log.find((x) => x[0] === 'cruise.enter')[1];
  assert.equal(e.fresh, true);
  assert.deepEqual({ x: e.at.x, z: e.at.z, h: +e.at.headingDeg.toFixed(3) }, { x: 1187, z: -1046, h: 251 }, 'v1: start=x,z&heading=');
  await r.M.go('sail');
  assert.deepEqual(r.log.at(-1), ['cruise.takeHelm', { pro: false }]);
  assert.deepEqual(r.log.find((x) => x[0] === 'cruise.leave')[1], { fresh: true, race: false }, 'the fresh leave (v2/cruise places her where she is)');
  assert.deepEqual(r.landed.at(-1), 'sail');
});

test('MODE-8: Cruise picked after taking the helm hands her back in place; after a race it is a fresh Cruise', async () => {
  const r = rig();
  await r.M.go('cruise');
  r.cruise.takeHelm({});
  assert.equal(r.cruise.handed, true);
  await r.M.go('cruise');
  assert.deepEqual(r.log.filter((x) => x[0] === 'cruise.enter').at(-1)[1], { fresh: false, at: null }, 'the hand-back, not a new start');
});

test('DRV-10, U4: the switch (no key now: the top bar\'s button) in a fresh Sail lets her sail herself (Cruise), with no Cruise loaded; in Cruise it takes the helm; after the hand-over it hands back', async () => {
  const r = rig();
  assert.equal(r.cruise, null);
  assert.equal(r.M.backquote(), 'cruise'); await new Promise((res) => setTimeout(res, 0));
  assert.equal(r.cruise.on, true);
  assert.equal(r.M.backquote(), 'helm'); assert.equal(r.cruise.handed, true);
  assert.equal(r.M.backquote(), 'handback'); assert.equal(r.cruise.on, true);
});

test('no ` listener any more: a window keydown never reaches the switch; the buttons call it', async () => {
  const fns = [];
  const target = { addEventListener: (t, fn) => { if (t === 'keydown') fns.push(fn); } };
  const M = createModeSwitch({ P: { speed: 2 }, chunks: { cruise: { load: async () => ({ on: false, handed: false, enter: async () => { M.entered = true; } }), get: () => null } }, target });
  assert.equal(fns.length, 0, 'the mode switch listens to no key');
  void M;
});

test('swap (owner 2026-11-18, the top bar\'s Cruise ⇄ Sail button): in place both ways, no place, no fresh start; none in a race', async () => {
  const r = rig();
  assert.equal(r.M.swap(), 'cruise'); await new Promise((res) => setTimeout(res, 0));
  assert.equal(r.cruise.on, true);
  assert.deepEqual(r.log.find((x) => x[0] === 'cruise.enter')[1], { fresh: false, at: null }, 'the hand-back path: no place, no fresh boat');
  assert.equal(r.M.swap(), 'helm');
  assert.deepEqual(r.log.at(-1), ['cruise.takeHelm', { pro: true }], 'the hand-over, not a fresh Sail');
  assert.ok(!r.log.some((x) => x[0] === 'cruise.leave'), 'no leave: nothing resets her');
  assert.equal(r.M.swap(), 'handback'); assert.equal(r.cruise.on, true);
  await r.M.go('regatta');
  assert.equal(r.M.swap(), null, 'in a race the button is not shown, and swap does nothing');
});
