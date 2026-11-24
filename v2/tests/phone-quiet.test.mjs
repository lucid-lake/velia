// A quiet skipper on a phone (owner ruling 2026-11-16; src/ui/phoneQuiet.js): on the flat phone controls
// (html.lk-flat) a 3-minute sail that goes well shows only the first sail's line; v2 sets no island goal on any device (owner
// ruling 2026-11-16: v2/ui/firstSail.js, goal: false), so no goal chip on a phone or a desktop; a stuck boat gets one stuck line; scenery, coaching, the keep-turning line and the offers never show. Without
// lk-flat (desktop, ?portrait=1) the same sail still shows them. Behaviour only: the real hint row, skill model and first-sail
// guide (mounted as v2 mounts it), driven frame by frame. Run: npm run test:v2
import { features } from '../../src/core/features.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../tests/helpers/dom-stub.mjs';
import { createSkills } from '../../src/sail/skills.js';
import { createWords } from '../../src/ui/words.js';
import { raceLine, keeps } from '../../src/ui/phoneQuiet.js';
import { createCoach } from '../regatta/coach.js';
import { attachGrounding } from '../../src/sail/grounding.js';
import { parseFlags } from '../../src/sim/core/flags.js';

const DT = 1 / 30, KN = 0.514444;
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// the stub's elements, plus what the first-sail guide touches (querySelector children, listeners) and <html>
function dom(flat) {
  install();
  const make = document.createElement;
  document.createElement = (tag) => {
    const el = make(tag), kids = new Map();
    el.querySelector = (sel) => { if (!kids.has(sel)) kids.set(sel, make('span')); return kids.get(sel); };
    el.addEventListener = () => {}; el.setAttribute = () => {};
    el.append = (...c) => c.forEach((x) => el.appendChild(x));
    return el;
  };
  document.documentElement = make('html');
  if (flat) document.documentElement.classList.add('lk-flat');
  features.mounted('flatControls', !!flat);   // the flat layout up, as ui/flat.js reports it (src/core/features.js quietSkipper)
  return document.documentElement;
}
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

async function rig({ flat, state, introShown = false }) {
  dom(flat);
  const { createControlsHint } = await import('../../src/ui/controlsHint.js');
  const { mountFirstSail } = await import('../ui/firstSail.js');
  const sk = createSkills({ storage: null });
  const hint = createControlsHint({ state: () => state, skills: sk, words: createWords({ skills: sk }), once: true, storage: store(), touch: () => true, modality: () => 'mouse' });
  const S = new Map(); const services = { get: (k) => S.get(k), provide: (k, v) => S.set(k, v) };
  let ms = 0;
  services.provide('controls', { hint }); services.provide('player', { phys: { state } }); services.provide('skills', sk);
  services.provide('terrain', { lake: { island: { x: 0, z: 0 } } }); services.provide('logbook', { logbook: { isOpen: false, found: () => false } });
  services.provide('filmNow', () => ms);
  const set = new Map(Object.entries({ welcomed: true, profile: 'new', introShown }));
  const settings = { get: (k) => set.get(k), set: (k, v) => set.set(k, v) };
  const guide = mountFirstSail({ ui: { services, mode: 'sail' }, settings, menu: () => ({ state: 'gone' }) });   // the clock: the filmNow service
  const goalEl = guide.el.children[0];
  const lines = []; let last = 'none', goalSeen = 0, goalOnAtEnd = false;
  let t = 0;
  const step = (steer = 0) => {
    t += DT; ms = t * 1000;
    sk.update(DT, { twa: state.trueWind.angle, tws: state.trueWind.speed, awa: state.apparentWind.angle, sog: state.sog, heading: state.heading, heel: 0.1,
      mainFill: state.mainFill, mainStall: state.mainStall, boomAngle: 0.5, surf: 0, roundUp: 0, groove: state.groove ?? 0, level: 3, steer, pull: 0, crew: true, gust: null, x: state.x, z: state.z });
    hint.update(DT); guide.update();
    const c = hint.current;
    if (c !== last && c !== 'none') lines.push({ at: +t.toFixed(1), name: c, text: text(hint.el.innerHTML) });
    last = c;
    const on = !goalEl.hidden && goalEl.classList.contains('on');
    if (on) goalSeen++;
    goalOnAtEnd = on;
  };
  return { hint, guide, step, lines, get t() { return t; }, get goal() { return { seen: goalSeen, on: goalOnAtEnd, text: goalEl.querySelector('.tx').textContent }; }, settings };
}

// sailing well: a beam reach toward the island (1.6 km north), 5 kn, sails drawing, a light hand on the helm every few seconds
const sailingWell = () => ({ x: 0, z: 1600, heading: 0, sog: 2.6, furl: 0, held: false, mainFill: 1, mainStall: 0, groove: 1,
  trueWind: { angle: Math.PI / 2, speed: 5 }, apparentWind: { angle: 1.2, speed: 6 } });

async function threeMinutes(flat) {
  const state = sailingWell();
  const R = await rig({ flat, state });
  const events = [
    [30, () => R.hint.flash('Kayakers off the bow.', { secs: 4.5 })],                                    // scenery (v2/living/kayaks.js)
    [50, () => R.hint.flash('Oops — give the kayaks room.', { secs: 4.5 })],                              // the kayak capsize
    [70, () => R.hint.note('The sails can carry her now — stop the engine', '', null, { kind: 'sea.engine' })],   // coaching
    [90, () => R.hint.note('She’s at anchor — the Dawn button waits for the morning', '', null, { kind: 'sea.dawn' })],   // a control a phone lacks
    [110, () => R.hint.flash('Tap Helm for the helm view', { secs: 4 })],                                 // the helm nudge
    [130, () => R.hint.keep(1)], [133, () => R.hint.keep(0)],                                              // the keep-turning line
  ];
  while (R.t < 180) {
    const before = R.t;
    const steer = Math.floor(before) % 5 === 0 && before % 1 < 0.3 ? 0.2 : 0;
    state.z -= state.sog * DT;
    R.step(steer);
    for (const e of events) if (!e.done && R.t >= e[0]) { e.done = true; e[1](); }
  }
  return R;
}

test('a phone (lk-flat): 3 minutes of good sailing show only the first sail\'s line, and no goal chip', async () => {
  const R = await threeMinutes(true);
  assert.deepEqual(R.lines.map((l) => l.name), ['note'], 'one line: ' + JSON.stringify(R.lines));
  assert.match(R.lines[0].text, /steer/i, 'the first sail\'s intro line');
  assert.ok(R.lines[0].at < 5, 'in the first seconds');
  assert.equal(R.goal.seen, 0, 'no goal chip on a phone');
  assert.doesNotMatch(R.goal.text, /Fannette/);
  for (const l of R.lines) assert.doesNotMatch(l.text, /kayak|engine|Dawn|Helm|keep turning/i);
});

test('desktop (no lk-flat) without the lean skipper (the row as v1 builds it): the same sail still shows the scenery, coaching and keep-turning lines (v2 drops them: lean-skipper.test.mjs)', async () => {
  const R = await threeMinutes(false);
  const all = R.lines.map((l) => l.text).join(' | ');
  for (const re of [/Kayakers off the bow/, /give the kayaks room/, /stop the engine/, /Dawn button/, /Tap Helm/, /keep turning/]) assert.match(all, re, all);
  assert.equal(R.goal.seen, 0, 'no goal chip on a desktop either');
  assert.doesNotMatch(R.goal.text, /Fannette/);
});

test('a phone: a boat stuck in irons gets exactly one stuck line in 150 s; aground once; a status reply still shows', async () => {
  const state = { ...sailingWell(), sog: 0.1, mainFill: 0.2, groove: 0, trueWind: { angle: 0.15, speed: 5 }, apparentWind: { angle: 0.15, speed: 5 } };
  const R = await rig({ flat: true, state, introShown: true });
  while (R.t < 150) R.step(0);
  const stuck = R.lines.filter((l) => l.name !== 'note' && l.name !== 'flash');
  assert.equal(stuck.length, 1, JSON.stringify(R.lines));
  assert.equal(stuck[0].name, 'irons');
  assert.ok(stuck[0].at >= 10 && stuck[0].at < 13, 'after 10 s stuck: ' + stuck[0].at);
  assert.match(stuck[0].text, /tap Free/, 'it names the phone\'s control: the assist corner reads Free in irons');
  // aground: one line, not again within minutes
  const n0 = R.lines.length;
  R.hint.note('Aground — reverse the engine, or back the jib', '', null, { kind: 'sea.aground' });
  for (let i = 0; i < 300; i++) R.step(0);
  R.hint.note('Aground — reverse the engine, or back the jib', '', null, { kind: 'sea.aground' });
  for (let i = 0; i < 300; i++) R.step(0);
  assert.equal(R.lines.slice(n0).filter((l) => /Aground/.test(l.text)).length, 1);
  R.hint.flash('Sails coming down…', { kind: 'status' });
  R.step(0);
  assert.equal(R.hint.current, 'flash', 'a status answers the player\'s own tap');
});

test('a phone: the sails luffing 15 s while she moves get the pull line once', async () => {
  const state = { ...sailingWell(), sog: 1.5, mainFill: 0.3, groove: 0 };
  const R = await rig({ flat: true, state, introShown: true });
  while (R.t < 120) R.step(Math.floor(R.t) % 5 === 0 ? 0.2 : 0);
  const pulls = R.lines.filter((l) => l.name === 'pull');
  assert.equal(pulls.length, 1, JSON.stringify(R.lines));
  assert.ok(pulls[0].at >= 15, 'not before 15 s of luffing: ' + pulls[0].at);
  assert.ok(R.lines.every((l) => l.name === 'pull'), 'nothing else: ' + JSON.stringify(R.lines));
});

test('Regatta on a phone: the start cues, "over early", penalties and a missed mark only; Cruise\'s look and stars lines and the offers drop', () => {
  const coach = (id) => ({ kind: 'coach', id, text: id });
  for (const id of ['prestart', 'ocs', 'gun']) assert.ok(raceLine(coach(id), true), id);
  for (const id of ['beat', 'layline', 'rounding', 'run', 'finish']) assert.equal(raceLine(coach(id), true), null, id);
  for (const c of ['rc_pen_pst', 'rc_pen_wl', 'rc_pen_mark', 'rc_wrong']) assert.ok(raceLine({ kind: 'officer', call: c, text: 'x' }, true), c);
  assert.ok(raceLine({ kind: 'officer', call: 'rc_ocs_me', text: 'x' }, true));
  assert.ok(raceLine({ kind: 'officer', call: 'rc_thirty', text: 'x' }, true));
  assert.equal(raceLine({ kind: 'officer', call: 'rc_w_wren', text: 'x' }, true), null);
  assert.equal(raceLine({ kind: 'note', id: 'clean', text: 'A clean start!' }, true), null);
  for (const id of ['beat', 'rounding']) assert.ok(raceLine(coach(id), false), 'desktop keeps ' + id);
  for (const k of ['cruise.look', 'cruise.stars', 'offer']) { assert.equal(keeps(k, true), false, k); assert.equal(keeps(k, false), true, k); }
});

test('Regatta on a phone: a penalty shows its line on the card (the coach and the committee\'s call)', () => {
  const C = createCoach({ coach: 'all' });
  const sit = { clock: 60, status: 'racing', legKind: 'beat', lay: null, inZone: false, finishLeg: false, leg: 1 };   // no teaching step due
  let shown = null;
  for (let t = 60; t < 62; t += 0.1) { if (Math.abs(t - 60.5) < 0.05) C.event({ type: 'penalty', id: 'me' }); const l = raceLine(C.update(t, { ...sit, clock: t }), true); if (l?.id === 'penalty') shown = l; }
  assert.ok(shown, 'the penalty line reaches a phone\'s card');
  assert.match(shown.text, /Penalty: sail one full turn/);
  C.officer('Mark touched. One turn.', 70, 'rc_pen_mark');
  assert.equal(raceLine(C.update(70.1, { ...sit, clock: 70.1 }), true)?.text, 'Mark touched. One turn.');
  C.officer('Missed the mark. Go back round it.', 80, 'rc_wrong');
  assert.ok(raceLine(C.update(80.1, { ...sit, clock: 80.1 }), true), 'the missed mark too');
});

test('a phone: a boat heading into a shoal gets the warning once, and it fades', async () => {
  const state = { ...sailingWell(), x: 0, z: 0, heading: 0, sog: 3, u: 3, v: 0 };
  const R = await rig({ flat: true, state, introShown: true });
  const phys = { state };
  const ground = { state: { mode: 'afloat', under: 10, depth: 12, scrape: 0, mat: 'sand' }, take: () => [], kedge: () => ({ ok: false }) };
  const GT = { depthAt: (x, z) => (z < -60 ? 0.8 : 12), rockAt: () => false };
  const g = attachGrounding({ flags: parseFlags('') }, { phys, ground, groundTerrain: GT }, { hint: R.hint });
  g.setAssist(false);   // the plain warning (the assist's own, said as it bears away, is the same kind of line)
  // three runs at the shoal, 40 s apart: each turned away just short of it
  for (let run = 0; run < 3; run++) {
    state.z = 0;
    for (let i = 0; i < 1200; i++) { if (state.z > -55) state.z -= 1.5 * DT; g.update(DT, { windFrom: Math.PI / 2 }); R.step(0.2); }
  }
  const warn = R.lines.filter((l) => /ahead|Shoaling/.test(l.text));
  assert.equal(warn.length, 1, JSON.stringify(R.lines));
  assert.notEqual(R.hint.current, 'note', 'faded');
});
