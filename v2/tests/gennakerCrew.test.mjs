// The crew flies the gennaker (owner, 2026-11-21: option A, no G key, no pill; Pro may use R and F): the crew's
// rule (v2/sim/gennakerCrew.js) alone, then on the v2 boat (v2/sim/boat.js: the crew's call each frame, Pro's R/F on the flying
// headsail and the hold at a sheet's end), the Setup row (v2/ui/gennakerRow.js), the quiet lines (leanSkipper.js, phoneQuiet.js) and the
// sock drawn (v2/render/boat/gennaker.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGennakerCrew, GK_CREW } from '../sim/gennakerCrew.js';
import { createBoatSim, waterFor, GK_TRIM, GK_HAND_S } from '../sim/boat.js';
import { keysToTrim } from '../sim/controls.js';
import { steadyWind, KN } from '../../src/sim/boat.js';
import { GENNAKER } from '../../src/sim/sail/gennaker.js';
import { gkDesc, gennakerPoint } from '../render/boat/gennaker.js';
import { createLeanSkipper } from '../ui/leanSkipper.js';
import { createPhoneQuiet } from '../../src/ui/phoneQuiet.js';
import { createSettings } from '../../src/ui/settings.js';
import { mountGennakerRow } from '../ui/gennakerRow.js';
import { KEY_ROWS } from '../ui/keyMap.js';

const DEG = Math.PI / 180, dt = 1 / 60;
// run the crew's rule for secs at a true wind angle (deg) and speed (kn); → the last result and the first time want changed
function run(C, secs, twa, tws = 10, o = {}, st = { up: false, flips: [] , t: 0 }) {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    const r = C.update(dt, { twa: twa * DEG, tws: tws * KN, ...o, up: st.up });
    st.t += dt;
    if (r.want !== st.up) { st.flips.push({ t: +st.t.toFixed(2), want: r.want, said: r.said }); st.up = r.want; }
  }
  return st;
}

test('the crew\'s rule: hoists after 8 s with the wind ≥ 100° off the bow in ≥ 6 kn; douses after 4 s headed up past 85°', () => {
  const st = run(createGennakerCrew(), 12, 120);
  assert.equal(st.flips.length, 1); assert.ok(Math.abs(st.flips[0].t - GK_CREW.hoistS) < 0.05, `up at ${st.flips[0].t} s`);
  assert.equal(st.flips[0].said, 'up');
  const C = createGennakerCrew(), s2 = run(C, 10, 120);
  run(C, 6, 70, 10, {}, s2);
  const down = s2.flips[1];
  assert.ok(down && !down.want && Math.abs(down.t - 10 - GK_CREW.douseS) < 0.05 && down.said === 'down', `down 4 s after heading up (${JSON.stringify(down)})`);
  assert.equal(run(createGennakerCrew(), 30, 120, 5).flips.length, 0, '5 kn: too little wind');
  assert.equal(run(createGennakerCrew(), 30, 95).flips.length, 0, '95°: not abaft the line');
  assert.equal(run(createGennakerCrew(), 30, -130).flips.length, 1, 'either tack');
});

test('hysteresis: never a flicker between 85° and 100°, and a short swing past either line restarts its clock', () => {
  const C = createGennakerCrew(), st = run(C, 9, 120);
  for (let k = 0; k < 20; k++) { run(C, 2, 88, 10, {}, st); run(C, 2, 99, 10, {}, st); }   // up: wandering in the band
  assert.equal(st.flips.length, 1, 'stays up in the band');
  for (let k = 0; k < 10; k++) { run(C, 3.5, 80, 10, {}, st); run(C, 0.5, 90, 10, {}, st); }   // dips under 85° shorter than 4 s
  assert.equal(st.flips.length, 1, 'a dip under 85° shorter than 4 s keeps it up');
  const D = createGennakerCrew(), s2 = { up: false, flips: [], t: 0 };
  for (let k = 0; k < 10; k++) { run(D, 7, 110, 10, {}, s2); run(D, 0.5, 98, 10, {}, s2); }
  assert.equal(s2.flips.length, 0, 'abaft 100° for 7 s at a time never hoists');
});

test('the hard stops: sails down, at anchor, moored, docking or a race: down at once, never up; Setup Off never hoists', () => {
  for (const o of [{ sailsUp: false }, { blocked: true }]) {
    assert.equal(run(createGennakerCrew(), 30, 130, 12, o).flips.length, 0, `${JSON.stringify(o)}: never up`);
    const C = createGennakerCrew(), st = run(C, 10, 130, 12);
    run(C, dt, 130, 12, o, st);
    assert.ok(st.flips[1] && !st.flips[1].want && st.flips[1].said === 'down', `${JSON.stringify(o)}: down at once`);
  }
  assert.equal(run(createGennakerCrew(), 60, 130, 12, { mode: 'off' }).flips.length, 0, 'Off: never flown by the crew');
});

test('a Pro hand overrides the crew until the conditions change', () => {
  // a hand's douse on a run: the crew won't hoist again until she has headed up past 85° and borne away again
  const C = createGennakerCrew(), st = run(C, 10, 130);
  run(C, dt, 130, 10, { manual: 'down' }, st);
  assert.equal(st.up, false);
  run(C, 30, 130, 10, {}, st);
  assert.equal(st.up, false, 'not re-hoisted on the same run');
  run(C, 1, 80, 10, {}, st); run(C, 9, 130, 10, {}, st);
  assert.equal(st.up, true, 'headed up past 85°, borne away again: the crew hoists');
  // a hand's hoist at 82°: the crew won't douse it while she stays there; once she bears away past 100° the crew's rules apply
  const D = createGennakerCrew(), s2 = run(D, 1, 82);
  run(D, dt, 82, 10, { manual: 'up' }, s2); run(D, 20, 82, 10, {}, s2);
  assert.equal(s2.up, true, 'the hand\'s hoist holds at 82°');
  run(D, 1, 120, 10, {}, s2); run(D, 5, 70, 10, {}, s2);
  assert.equal(s2.up, false, 'after bearing away, heading up douses again');
  // Off: a hand flies it all the same
  const E = createGennakerCrew(), s3 = run(E, 1, 120, 10, { mode: 'off' });
  run(E, dt, 120, 10, { mode: 'off', manual: 'up' }, s3); run(E, 30, 70, 10, { mode: 'off' }, s3);
  assert.equal(s3.up, true, 'Off: a hand\'s hoist stays until a hand douses it');
  assert.equal(run(createGennakerCrew(), dt, 60, 10, { manual: 'up' }).flips.length, 0, 'no hand hoist forward of 80°');
});

// ---- on the v2 boat
const flat = waterFor(() => 0);
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => steadyWind(ms, fromDeg)(x, z, t) });
function boat({ windKn = 12, heading = 130, flags = {} } = {}) {
  return createBoatSim({ water: flat, heightAt: null, wind: steady(windKn * KN, 0), start: { x: 0, z: 0, headingDeg: heading, speed: 3 }, flags });
}
const step = (B, secs, held = new Set(), each = () => {}) => { const trim = keysToTrim(held); for (let i = 0; i < Math.round(secs * 60); i++) { B.step(dt, { steer: 0, pull: 0, trim }); each(B); } };

test('on the boat: the home card holds the crew: its clocks start when the player enters (the first sail keeps its intro line)', () => {
  const B = boat(); B.gennakerCrew = { card: true };
  step(B, GK_CREW.hoistS + 5);
  assert.equal(B.gennakerUp, false, 'never while the card is up'); assert.equal(B.gennakerCrew.abaft, 0, 'the clock does not run');
  B.gennakerCrew = { card: false }; step(B, GK_CREW.hoistS - 1);
  assert.equal(B.gennakerUp, false, 'a full hoistS after the card goes, not before'); step(B, 2);
  assert.equal(B.gennakerUp, true);
});

test('on the boat: the crew hoists on a broad reach and says it once; no flight in a race or with Setup Off', () => {
  const B = boat(), said = [];
  B.onGennaker = (up, s) => { if (s) said.push(s.said); };
  step(B, GK_CREW.hoistS + 0.5);
  assert.equal(B.gennakerUp, true); assert.deepEqual(said, ['up']);
  step(B, GENNAKER.hoistS + 1);
  assert.equal(B.state.gk.phase, 'flying');
  B.gennakerCrew = { race: true }; step(B, 0.1);
  assert.equal(B.gennakerUp, false, 'a race starts: down'); assert.deepEqual(said, ['up', 'down']);
  step(B, 20); assert.equal(B.gennakerUp, false, 'never in a race');
  const O = boat(); O.gennakerCrew = { mode: 'off' }; step(O, 20);
  assert.equal(O.gennakerUp, false, 'Off'); assert.equal(O.state.gk, undefined, 'never made');
});

test('on the boat, Pro: F held 1 s at the jib\'s full ease hoists; R/F then trim the gennaker\'s own sheet; R held 1 s at its full trim douses', () => {
  const B = boat({ heading: 120 }); B.gennakerCrew = { mode: 'off' }; B.pro = true;
  let held = 0; while (!B.gennakerUp && held < 15) { step(B, 0.1, new Set(['KeyF'])); held += 0.1; }   // eases the jib to its end, then the hold
  assert.equal(B.gennakerUp, true, 'F held at full ease: hoisted');
  assert.ok(B.gennakerCrew.abaft >= 0 && held > GK_HAND_S, `after the ease and ${GK_HAND_S} s at its end (${held.toFixed(1)} s held)`);
  const jib0 = B.ctl.jibTrim;
  step(B, GENNAKER.hoistS + 1);
  assert.equal(B.state.gk.phase, 'flying');
  step(B, 0.5, new Set(['KeyR']));
  assert.ok(B.ctl.gkTrim < -4 * DEG && B.ctl.jibTrim === jib0, `R trims the gennaker's sheet (${(B.ctl.gkTrim / DEG).toFixed(1)}°), the rolled jib's untouched`);
  step(B, 0.3, new Set(['KeyF']));
  const g1 = B.ctl.gkTrim; step(B, 0.3, new Set(['KeyF']));
  assert.ok(B.ctl.gkTrim > g1, 'F eases it');
  step(B, 6, new Set(['KeyR']));
  assert.ok(Math.abs(B.ctl.gkTrim - GK_TRIM.lower) < 1e-9, 'trimmed to its end');
  assert.equal(B.gennakerUp, false, `R held ${GK_HAND_S} s at full trim: doused`);
  step(B, GENNAKER.douseS + 1);
  assert.equal(B.state.gk.sock, 0); assert.equal(B.ctl.gkTrim, null, 'stowed: the jib\'s winch again');
  // a short press never hoists, and basic's R/F are nobody's
  const C = boat({ heading: 120 }); C.gennakerCrew = { mode: 'off' }; C.pro = true;
  let n = 0; while (C.gennakerCrew.holdF === 0 && n++ < 200) step(C, 0.1, new Set(['KeyF']));
  step(C, 0.5, new Set(['KeyF'])); step(C, 2);
  assert.equal(C.gennakerUp, false, 'half a second at the end: nothing');
  const D = boat({ heading: 120 }); D.gennakerCrew = { mode: 'off' }; step(D, 15, new Set(['KeyF']));
  assert.equal(D.gennakerUp, false, 'basic: R/F are not the gennaker\'s');
});

test('on the boat: a Pro douse holds against the auto crew until she heads up past 85° and bears away', () => {
  const B = boat({ heading: 130 }); B.pro = true;
  step(B, GK_CREW.hoistS + GENNAKER.hoistS + 2);
  assert.equal(B.state.gk.phase, 'flying');
  step(B, 8, new Set(['KeyR']));
  assert.equal(B.gennakerUp, false, 'the hand doused it');
  step(B, 15);
  assert.equal(B.gennakerUp, false, 'the crew leaves it down on the same run');
});

test('the Keys page says R/F trim the flying headsail (no G key: keys-help.test.mjs REMOVED)', () => {
  const rf = KEY_ROWS.find((r) => r.id === 'jib');
  assert.ok(/gennaker/.test(rf.g) && rf.pro === true, 'R/F: Pro, the gennaker named');
});

test('Setup › Aids › gennaker: auto | off, default auto, stored in the page\'s settings', () => {
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const S = createSettings({ storage });
  assert.equal(S.get('gennaker'), 'auto');
  S.set('gennaker', 'sometimes'); assert.equal(S.get('gennaker'), 'auto', 'only auto or off');
  // a minimal DOM: the Aids tab and its assists row
  const mk = (tag) => { const el = { tag, children: [], dataset: {}, attrs: {}, listeners: {}, className: '', parent: null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(k, f) { this.listeners[k] = f; }, removeEventListener() {}, remove() {},
    set innerHTML(h) { this.children = [...h.matchAll(/data-gk="(\w+)"/g)].map(([, m]) => Object.assign(mk('button'), { dataset: { gk: m }, closest() { return this; } })); },
    querySelector(sel) { return sel.includes('assists') ? assists : null; }, querySelectorAll() { return this.children; },
    appendChild(c) { this.children.push(c); c.parent = this; }, insertBefore(c) { this.children.push(c); c.parent = this; }, nextSibling: null };
    return el; };
  const assists = mk('div'), tab = mk('div'); tab.querySelector = (sel) => (sel.includes('assists') ? assists : sel.includes('gennaker') ? (tab.children.find((c) => c.dataset.set === 'gennaker') ?? null) : null);
  const root = { querySelector: (sel) => (sel === '#tp-set-aids' ? tab : null) }, doc = { createElement: mk };
  const R = mountGennakerRow(root, { settings: S, doc });
  assert.ok(R && R.row.dataset.set === 'gennaker', 'mounted');
  assert.deepEqual(R.buttons.map((b) => [b.dataset.gk, b.attrs['aria-checked']]), [['auto', 'true'], ['off', 'false']]);
  R.row.listeners.click({ target: R.buttons[1], stopPropagation() {} });
  assert.equal(S.get('gennaker'), 'off'); assert.equal(R.buttons[1].attrs['aria-checked'], 'true');
  assert.equal(mountGennakerRow(root, { settings: S, doc }), null, 'once');
});

test('the quiet lines: "Gennaker up!" and "Gennaker down." show on a desktop; a phone shows each once a session', () => {
  const desk = createLeanSkipper({ storage: null });
  assert.equal(desk.allow('gk.up'), true); assert.equal(desk.allow('gk.down'), true); assert.equal(desk.allow('gk.up'), true);
  const phone = createPhoneQuiet({ on: () => true, storage: null }), lean = createLeanSkipper({ phone, storage: null });
  assert.equal(lean.allow('gk.up'), true); assert.equal(lean.allow('gk.down'), true);
  assert.equal(lean.allow('gk.up'), false, 'a phone: once'); assert.equal(lean.allow('gk.down'), false);
  const m = createLeanSkipper({ storage: null }); m.allow('sea.shoal');
  assert.equal(m.allow('gk.up'), false, 'never over a MUST line');
});

test('the sock drawn: mid-swap a slim tube from the bow to the masthead; lifted, the cloth spreads', () => {
  const span = (g) => { const d = gkDesc({ gk: g }); let w = 0; const p = [0, 0, 0], q = [0, 0, 0];
    for (let v = 0.05; v <= 0.95; v += 0.1) { gennakerPoint(0, v, d, 0, p); gennakerPoint(1, v, d, 0, q); w = Math.max(w, Math.hypot(p[0] - q[0], p[2] - q[2])); } return w; };
  const mid = { deploy: 0.6, sock: 1, roll: 0.5, lift: 0, fill: 0, angle: 1.2, side: 1, bang: 0 };
  assert.ok(span(mid) < 0.6, `in the sock: ${span(mid).toFixed(2)} m wide at most`);
  assert.ok(span({ ...mid, deploy: 1, roll: 1, lift: 1, fill: 1 }) > 3, 'flying: metres across');
  const top = [0, 0, 0]; gennakerPoint(0, 1, gkDesc({ gk: mid }), 0, top);
  const half = [0, 0, 0]; gennakerPoint(0, 1, gkDesc({ gk: { ...mid, sock: 0.5 } }), 0, half);
  assert.ok(top[1] > half[1] + 3, 'the sock climbs the mast');
});

test('on the boat, a hand on the sheets: W/S trim the gennaker with the main (W over-trims it, S eases it); the crew\'s trim leaves it to sheetBias', () => {
  const run = (crew, pull) => {
    const B = boat({ heading: 125 }); B.assists.crewTrim = crew;
    step(B, GK_CREW.hoistS + GENNAKER.hoistS + 4);
    const e0 = B.state.gk.err, d0 = B.state.gk.drive;
    for (let i = 0; i < 4 * 60; i++) B.step(dt, { steer: 0, pull, trim: null });
    step(B, 2);
    return { de: B.state.gk.err - e0, d0, d1: B.state.gk.drive, f1: B.state.gk.fill, gkHand: B.ctl.gkHand };
  };
  const ease = run(false, -1), trim = run(false, 1);
  assert.ok(ease.de > 15 * DEG && ease.f1 < 0.7, `S: the gennaker eased ${(ease.de / DEG).toFixed(0)}°, its luff curling (fill ${ease.f1.toFixed(2)})`);
  assert.ok(trim.de < -15 * DEG && trim.d1 < trim.d0, `W: over-trimmed ${(trim.de / DEG).toFixed(0)}°, its drive down (${trim.d0.toFixed(0)} → ${trim.d1.toFixed(0)} N)`);
  const crew = run(true, 0);
  assert.equal(crew.gkHand, null, 'the crew trims: no hand offset (W/S ride on sheetBias, as before)');
});

// owner, 2026-11-21: "the problem is in downwind, using WS I did not see it move the main sail at all" (v2's crew trim, New's default,
// threw W/S away). Downwind with the gennaker up, in both modes: W sheets the boom in, S eases it back out to its stop
test('downwind under the gennaker, W/S move the boom in every mode, and the gennaker\'s sheet with it', () => {
  for (const crew of [true, false]) {
    const B = createBoatSim({ water: flat, heightAt: null, wind: steady(15 * KN, 0), start: { x: 0, z: 0, headingDeg: 150, speed: 4 }, flags: { gennaker: '1' } });
    B.assists.crewTrim = crew;
    const hold = (s, pull) => { for (let i = 0; i < s * 60; i++) B.step(dt, { steer: 0, pull, trim: null }); };
    hold(15, 0);
    const b0 = Math.abs(B.state.boomAngle), e0 = B.state.gk.err;
    hold(3, 1); const bW = Math.abs(B.state.boomAngle), eW = B.state.gk.err;
    hold(3, -1); const bS = Math.abs(B.state.boomAngle);
    assert.equal(B.state.gk.phase, 'flying');
    assert.ok(b0 - bW > 40 * DEG, `${crew ? 'crew' : 'hand'}: W sheets the boom in ${(b0 / DEG).toFixed(0)}° → ${(bW / DEG).toFixed(0)}°`);
    assert.ok(eW < e0 - 10 * DEG, `${crew ? 'crew' : 'hand'}: the gennaker over-trimmed with it (${(e0 / DEG).toFixed(0)}° → ${(eW / DEG).toFixed(0)}°)`);
    assert.ok(bS > b0 - 2 * DEG, `${crew ? 'crew' : 'hand'}: S eases it back out to its stop (${(bS / DEG).toFixed(0)}°)`);
  }
});

// owner, 2026-11-21: "if assist on, and user do nothing we do auto crew; however if user start using WS RF it should always take over,
// let user see the feedback". The take-over per sheet, no hand-back on any idle time, handed back by Setup's switch or a fresh start
test('crew trim on: the first W/S takes the main (and the gennaker) for good; R/F in Pro takes the headsail; Setup\'s switch or a fresh start hands back', () => {
  const B = createBoatSim({ water: flat, heightAt: null, wind: steady(15 * KN, 0), start: { x: 0, z: 0, headingDeg: 140, speed: 4 }, flags: { gennaker: '1' } });
  B.assists.crewTrim = true; const said = [];
  B.onTakeOver = (w) => said.push(w);
  const hold = (s, pull, held = new Set()) => { const trim = keysToTrim(held); for (let i = 0; i < Math.round(s * 60); i++) B.step(dt, { steer: 0, pull, trim }); };
  hold(10, 0);
  assert.equal(B.ctl.sheet, null, 'hands off: the crew trims'); assert.deepEqual(B.owned, { main: false, head: false });
  const b0 = Math.abs(B.state.boomAngle);
  hold(1 / 60, 1);
  assert.equal(B.owned.main, true, 'the first W press takes the main'); assert.deepEqual(said, ['main']);
  assert.ok(Math.abs(B.ctl.sheet - (B.phys.auto.main)) < 3 * DEG, 'it starts where the crew had it: no jump');
  hold(2, 1);
  const bW = Math.abs(B.state.boomAngle), sheetW = B.ctl.sheet, gW = B.ctl.gkHand;
  assert.ok(b0 - bW > 20 * DEG && gW < -5 * DEG, `W at once: the boom in ${(b0 / DEG).toFixed(0)}° → ${(bW / DEG).toFixed(0)}°, the gennaker's sheet with it`);
  hold(120, 0);
  assert.ok(Math.abs(B.ctl.sheet - sheetW) < 1e-9 && B.ctl.gkHand === gW, 'two minutes idle: no hand-back, the sheets stay where the player left them');
  assert.equal(B.owned.head, false, 'W/S take the main, not the headsail');
  B.pro = true; hold(0.3, 0, new Set(['KeyR']));
  assert.equal(B.owned.head, true, 'R in Pro takes the flying headsail'); assert.deepEqual(said, ['main', 'head']);
  B.handBack(); hold(1, 0);
  assert.deepEqual(B.owned, { main: false, head: false }); assert.equal(B.ctl.sheet, null, 'Setup\'s switch: the crew trims again');
  hold(0.1, -1); assert.equal(B.owned.main, true);
  B.place({ x: 0, z: 0, headingDeg: 140, speed: 4 }); hold(0.5, 0);
  assert.deepEqual(B.owned, { main: false, head: false }, 'a fresh start (a new sail, a rebirth): the crew has the sheets');
});

test('the crew\'s ease in a hard heel only while it holds the sheets: taken over and held in a gust, the gennaker lays her far over (toward the broach)', () => {
  const gust = { sample: (x, z, t) => ({ vx: 0, vz: (22 + 12 * (t > 30 && t < 38 ? 1 : 0)) * KN }) };
  const heel = (take) => {
    const B = createBoatSim({ water: flat, heightAt: null, wind: gust, start: { x: 0, z: 0, headingDeg: 110, speed: 4 }, flags: { gennaker: '1' } });
    B.assists.crewTrim = true; B.gennakerCrew = { mode: 'off' };
    let m = 0;
    for (let i = 0; i < 45 * 60; i++) { B.step(dt, { steer: 0, pull: take && i > 20 * 60 && i < 20 * 60 + 20 ? 1 : 0, trim: null }); if (i > 25 * 60) m = Math.max(m, Math.abs(B.state.heel)); }
    return m / DEG;
  };
  const crew = heel(false), held = heel(true);
  assert.ok(held > crew + 10, `held by the player: ${held.toFixed(0)}° vs the crew's ${crew.toFixed(0)}°`);
});

test('"You have the sheets." is a quiet crew line: shown on a desktop, once a session on a phone', () => {
  const phone = createPhoneQuiet({ on: () => true, storage: null }), lean = createLeanSkipper({ phone, storage: null });
  assert.equal(lean.allow('crew.sheets'), true); assert.equal(lean.allow('crew.sheets'), false);
  assert.equal(createLeanSkipper({ storage: null }).allow('crew.sheets'), true);
});
