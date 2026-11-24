// Steady hands (owner, 2026-11-17: "If I don't press any key, why doesn't the boat hold my course?"; v2/ui/steadyHands.js, the hold in
// v2/sim/boat.js): by profile on for the new sailor, off by default for an experienced one (a choice), off for "I race" and Pro; on, with
// no input in Sail's default wind she holds the heading she had within 5° for 60 s; off, she wanders; any steer input takes over at
// once and the hold restarts on the new heading; the choice is kept per profile; Setup › Aids' steady-hands switch in place of the pilot toggle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyOn, steadyUrl, STEADY, STEADY_DEFAULT, saveSteady, loadSteady, steadyChoice, forgetSteady, mountSteadyRow } from '../ui/steadyHands.js';
import { createBoatSim, waterFor, START, STEADY_RAMP_S } from '../sim/boat.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { WindField } from '../../src/sim/wind.js';
import { sailWindOptions } from '../sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { removeRows, REMOVED_OPTS } from '../ui/setup.js';

const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
const DEG = Math.PI / 180, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const memStore = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

// Sail's start in Sail's default wind (level 3 at 13:00, the gust cells and the profile's shifts), the crew trimming as for the new sailor
function sailBoat(profile = 'new', { crew = true } = {}) {
  const start = { ...START };
  const wind = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 13, start }), sailShifts: profile === 'race' ? 'race' : profile });
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind, start });
  B.assists.crewTrim = crew;
  return B;
}
const run = (B, s, inp = { steer: 0, pull: 0 }, f = null) => { for (let i = 0; i < 60 * s; i++) { B.step(1 / 60, inp, 1 / 60); f?.(B.phys.state, i / 60); } };

test('the policy: on for the new sailor, off by default for "I sail" (a choice kept per profile), off for "I race" and in Pro; ?pilot= pins it', () => {
  assert.deepEqual(STEADY_DEFAULT, { new: true, sail: false, race: false });
  assert.equal(steadyOn({ profile: 'new' }), true);
  assert.equal(steadyOn({ profile: 'sail' }), false);
  assert.equal(steadyOn({ profile: 'race' }), false);
  assert.equal(steadyOn({ profile: 'new', pro: true }), false, 'Pro: off');
  assert.equal(steadyOn({ profile: 'sail', choice: { profile: 'sail', on: true } }), true, 'the experienced sailor\'s choice');
  assert.equal(steadyOn({ profile: 'new', choice: { profile: 'sail', on: false } }), true, 'a choice made under another profile: this one\'s default');
  assert.equal(steadyOn({ profile: 'race', choice: { profile: 'race', on: true } }), false, '"I race": no choice');
  assert.equal(steadyOn({ profile: 'sail', pro: true, url: true }), true, '?pilot=1 pins it on');
  assert.deepEqual([steadyUrl({}), steadyUrl({ pilot: '0' }), steadyUrl({ pilot: '1' })], [null, false, true]);
  const st = memStore();
  saveSteady(st, 'sail', true); assert.deepEqual(loadSteady(st), { profile: 'sail', on: true });
  forgetSteady(); assert.deepEqual(steadyChoice(st), { profile: 'sail', on: true }, 'read back from the store');
  assert.equal(loadSteady(memStore()), null);
  assert.equal(STEADY.rampS, STEADY_RAMP_S, 'the grip\'s ramp is one number');
});

test('steady hands on (the new sailor, Sail\'s default wind): let go, she holds the heading she had within 5° for 60 s', () => {
  const B = sailBoat('new');
  B.setPilot(steadyOn({ profile: 'new' }));
  run(B, 2, { steer: 0.4, pull: 0 });   // a hand on the helm, turning her
  run(B, 1);                            // let go: the grip eases in
  const h0 = B.holdHeading; assert.ok(h0 != null, 'the heading held');
  let worst = 0;
  run(B, 60, undefined, (s) => { worst = Math.max(worst, Math.abs(wrap(s.heading - h0))); });
  assert.ok(worst <= 5 * DEG, `the worst ${(worst / DEG).toFixed(1)}° off the held heading over 60 s`);
});

test('steady hands off ("I sail" by default, "I race", Pro): let go, the helm eases amidships and she wanders off her heading', () => {
  for (const [profile, pro] of [['sail', false], ['race', false], ['new', true]]) {
    const B = sailBoat(profile, { crew: profile === 'new' });
    B.pro = pro; B.setPilot(steadyOn({ profile, pro }));
    assert.equal(B.assists.pilot, false, `${profile}${pro ? ' + Pro' : ''}: off`);
    run(B, 2);
    const h0 = B.phys.state.heading; let worst = 0;
    run(B, 60, undefined, (s) => { worst = Math.max(worst, Math.abs(wrap(s.heading - h0))); });
    assert.equal(B.holdHeading, null, 'nothing held');
    assert.ok(worst > 8 * DEG, `${profile}${pro ? ' + Pro' : ''}: she wanders ${(worst / DEG).toFixed(0)}° with no helmsman`);
  }
});

test('any steer input takes over at once; let go, the hold restarts on the new heading (the wheel too)', () => {
  const B = sailBoat('new'); B.setPilot(true);
  run(B, 5);
  const h0 = B.holdHeading;
  B.step(1 / 60, { steer: 1, pull: 0 }, 1 / 60);
  assert.equal(B.holdHeading, null, 'a steering key: the hold lets go that frame');
  assert.ok(B.ctl.rudder > 0, 'and the helm is the hand\'s');
  run(B, 3, { steer: 1, pull: 0 });
  run(B, 0.5);
  const h1 = B.holdHeading;
  assert.ok(h1 != null && Math.abs(wrap(h1 - h0)) > 15 * DEG, `the new heading held (${(wrap(h1 - h0) / DEG).toFixed(0)}° from the old)`);
  run(B, 30);
  assert.ok(Math.abs(wrap(B.phys.state.heading - h1)) < 6 * DEG, 'and kept');
  B.station({ helm: -0.4 }); run(B, 1);
  assert.equal(B.holdHeading, null, 'the wheel in the hand: no hold');
  B.station({ helm: null }); run(B, 0.2);
  assert.ok(B.holdHeading != null, 'let go of the wheel: held again');
});

test('Setup: the steady-hands switch in Aids\' assists row (lit by profile, "I race" locked), saved per profile; the pilot toggle leaves v2\'s card', () => {
  // a minimal DOM: the Aids tab's assists row (.v holding the hints toggle), the settings with on()
  const mk = (tag) => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, disabled: false, textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; },
    remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); },
    insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); },
    get firstChild() { return this.children[0] ?? null; },
    querySelector(sel) { return sel === '[data-sh]' ? this.children.find((c) => c.dataset.sh) ?? null : null; } });
  const v = mk('span'), hints = mk('button'); hints.dataset.t = 'hints'; v.insertBefore(hints, null);
  const root = { querySelector: (sel) => (sel === '#tp-set-aids [data-set="assists"] .v' ? v : null) };
  const vals = { profile: 'sail' }, subs = [];
  const settings = { get: (k) => vals[k], on: (f) => { subs.push(f); return () => subs.splice(subs.indexOf(f), 1); }, set: (k, val) => { vals[k] = val; subs.forEach((f) => f(k, val)); } };
  const st = memStore(); forgetSteady();
  const R = mountSteadyRow(root, { settings, store: st, doc: { createElement: mk } });
  const b = R.btn;
  assert.ok(v.children[0] === b && b.textContent === 'steady hands' && b.attrs.role === 'switch', 'first in the assists row, a switch, before hints');
  assert.equal(b.attrs['aria-checked'], 'false', '"I sail": off by default');
  b.listeners.click({ stopPropagation() {} });
  assert.equal(b.attrs['aria-checked'], 'true'); assert.deepEqual(loadSteady(st), { profile: 'sail', on: true }, 'saved for this profile');
  settings.set('profile', 'new'); assert.equal(b.attrs['aria-checked'], 'true', 'the new sailor: on');
  settings.set('profile', 'race'); assert.equal(b.attrs['aria-checked'], 'false'); assert.ok(b.disabled, '"I race": locked off');
  settings.set('profile', 'sail'); assert.equal(b.attrs['aria-checked'], 'true', 'back to "I sail": the choice kept');
  assert.equal(mountSteadyRow(root, { settings, store: st, doc: { createElement: mk } }), null, 'mounted once');
  R.dispose(); forgetSteady();
  // the Aids pilot toggle: removed from v2's card
  let removed = 0; const r2 = { querySelectorAll: (sel) => (sel === REMOVED_OPTS[0].sel ? [{ remove: () => removed++ }] : []) };
  assert.ok(removeRows(r2, null).includes('pilot') && removed === 1, 'the pilot toggle leaves the card');
});
