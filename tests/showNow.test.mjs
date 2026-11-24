// The one-tap fireworks (src/sail/showNow.js): the clock menu's Fireworks row in Sail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TimeOfDay } from '../src/sim/timeOfDay.js';
import { installDom } from './helpers/dom-helm.mjs';

test('Fireworks in one tap: fade, then the boat on the close spot facing the show, sails down, anchor going down, the clock on the build, the evening invited', async () => {
  const dom = installDom();
  const { createShowNow, showNowHour, SHOW_NOW } = await import('../classic/src/sail/showNow.js');
  const { CRUISE_SPOT, SHARE_HEADING } = await import('../src/fireworks/share.js');
  const clock = new TimeOfDay({ hour: 11, rate: 20, t0: 0 });
  const calls = [];
  const phys = { state: { x: 100, z: 200, heading: 1, u: 3, sog: 3, heel: 0.3 }, engine: { on: true }, furlPos: 0, p: 5, acc: 0.01 };
  const follow = { c: [0, 0, 0], cv: [1, 1, 1], yaw: 0, chase: true };
  const tk = { state: { mode: 'anchor', anchor: { phase: 'held', out: 30 } }, get mode() { return this.state.mode; } };
  let furlWant = 0;
  const sea = { tackle: tk, get furlWant() { return furlWant; }, arrivalOff: false,
    actions: { sails: () => { furlWant = furlWant > 0.5 ? 0 : 1; calls.push('sails'); }, engine: () => { phys.engine.on = false; calls.push('engine'); }, anchor: () => calls.push('anchor') } };
  const fw = { phase: 'before', invite: () => { calls.push('invite'); fw.phase = 'show'; } };
  const services = { get: (k) => (k === 'fireworks' ? fw : null) };
  const sn = createShowNow({ core: { clock }, phys, follow, sea, services, simT: () => 50, interp: { mark: () => calls.push('mark') }, ground: { reset: () => calls.push('ground') } });
  assert.equal(sn.lit, false);
  assert.equal(sn.go(), 'show'); assert.equal(sn.go(), 'busy', 'a second tap during the fade is ignored');
  assert.equal(phys.state.x, 100, 'the fade first: nothing has moved yet');
  sn.update(SHOW_NOW.outS + 0.01);
  assert.deepEqual([phys.state.x, phys.state.z], CRUISE_SPOT);
  assert.ok(Math.abs(phys.state.heading - SHARE_HEADING * Math.PI / 180) < 1e-9);
  assert.equal(phys.state.u, 0); assert.equal(phys.state.sog, 0); assert.equal(phys.furlPos, 1); assert.equal(phys.engine.on, false);
  assert.equal(tk.mode, 'free', 'the old anchor is let go before the drop'); assert.deepEqual(follow.c, [CRUISE_SPOT[0], 0, CRUISE_SPOT[1]]);
  assert.ok(Math.abs(clock.hourOfDay(50) - showNowHour()) < 1e-9, 'the clock is on the show\'s build');
  assert.ok(calls.includes('invite') && calls.includes('anchor') && calls.includes('sails') && calls.includes('engine'));
  assert.equal(sn.lit, true); sn.update(0.1); assert.equal(follow.chase, false, 'the camera holds on the show'); assert.equal(sea.arrivalOff, true);
  // look round 2: no status line over the show while the show camera holds (the page hides .lk-hint under this class)
  const H = globalThis.document.documentElement;
  assert.equal(sn.cam, true); assert.equal(H.classList.contains('lk-showcam'), true, 'the line is off the show');
  // a second tap while the show runs casts off: the anchor up, the sails up; the boat stays where she is
  tk.state.mode = 'anchor'; calls.length = 0; sn.update(SHOW_NOW.inS + 0.1);
  const at = [phys.state.x, phys.state.z];
  assert.equal(sn.go(), 'cast-off'); assert.deepEqual(calls, ['anchor', 'sails']); assert.deepEqual([phys.state.x, phys.state.z], at);
  fw.phase = 'after'; sn.update(0.1); assert.equal(sn.lit, false); assert.equal(follow.chase, true, 'the camera is the player\'s again');
  assert.equal(sn.cam, false); assert.equal(H.classList.contains('lk-showcam'), false, 'and back with the player\'s camera');
  sn.dispose(); dom.uninstall();
});

test('Fireworks with no show on the page (another day): the share link, no jump', async () => {
  const dom = installDom();
  const { createShowNow } = await import('../classic/src/sail/showNow.js');
  globalThis.location = { search: '?day=normal' };
  const clock = new TimeOfDay({ hour: 11, rate: 20, t0: 0 });
  const sn = createShowNow({ core: { clock }, phys: { state: {} }, follow: {}, sea: {}, services: { get: () => null }, simT: () => 0 });
  assert.equal(sn.go(), 'share'); assert.match(globalThis.location.search, /show=fireworks/); assert.doesNotMatch(globalThis.location.search, /day=/);
  assert.equal(clock.hourOfDay(0), 11);
  delete globalThis.location; sn.dispose(); dom.uninstall();
});

test('Fireworks in one tap warms the show\'s hidden objects as the fade starts, in play, once a page (refactor round 2 B4)', async () => {
  const dom = installDom();
  const { createShowNow, SHOW_NOW } = await import('../classic/src/sail/showNow.js');
  const clock = new TimeOfDay({ hour: 11, rate: 20, t0: 0 });
  const warms = [];
  const roots = [{ name: 'fireworks-barges' }, { name: 'fireworks-spectators' }];
  const fw = { phase: 'before', invite: () => { fw.phase = 'show'; }, warmRoots: () => roots };
  const tk = { state: { mode: 'free', anchor: { phase: 'stowed', out: 0 } }, get mode() { return this.state.mode; } };
  const sea = { tackle: tk, furlWant: 1, actions: { sails() {}, engine() {}, anchor() {} } };
  const core = { clock, warm: (r, o) => { warms.push([r, o]); return Promise.resolve({ objects: r.length }); } };
  const sn = createShowNow({ core, phys: { state: { x: 0, z: 0 }, engine: { on: false } }, follow: { c: [0, 0, 0] }, sea, services: { get: (k) => (k === 'fireworks' ? fw : null) }, simT: () => 0 });
  assert.equal(sn.warmed, false);
  assert.equal(sn.go(), 'show');
  assert.equal(warms.length, 1, 'the warm-up starts with the fade, before the jump');
  assert.deepEqual(warms[0][0], roots); assert.deepEqual(warms[0][1], { live: true }, 'frame-safe, in play');
  assert.equal(sn.warmed, true);
  sn.update(SHOW_NOW.outS + 0.01); sn.update(SHOW_NOW.inS + 0.1);
  fw.phase = 'after'; sn.update(0.1);
  assert.equal(sn.go(), 'show'); assert.equal(warms.length, 1, 'once a page');
  // no warm-up to start (?warm=0: core.warm is null) never stops the show
  const sn2 = createShowNow({ core: { clock, warm: null }, phys: { state: { x: 0, z: 0 }, engine: { on: false } }, follow: { c: [0, 0, 0] }, sea, services: { get: (k) => (k === 'fireworks' ? { ...fw, phase: 'before' } : null) }, simT: () => 0 });
  assert.equal(sn2.go(), 'show'); assert.equal(sn2.warmed, false);
  sn.dispose(); sn2.dispose(); dom.uninstall();
});
