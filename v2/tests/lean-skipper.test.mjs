// The lean skipper (owner, 2026-11-17; v2/ui/leanSkipper.js): on v2 every
// line on the skipper's row has a class. MUST shows at once, replaces any other line and shows during a manoeuvre; a TIP shows once
// ever (stored), never mid-manoeuvre, never within 20 s of another line; CHAT never shows. The voice reads only what shows. The
// phone's quiet rule still applies on top. Behaviour only: the real hint row and skill model with the lean rule mounted as
// v2/ui/sail.js mounts it, driven frame by frame. Run: npm run test:v2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../tests/helpers/dom-stub.mjs';
import { features } from '../../src/core/features.js';
import { createSkills } from '../../src/sail/skills.js';
import { createWords } from '../../src/ui/words.js';
import { createPhoneQuiet } from '../../src/ui/phoneQuiet.js';
import { createLeanSkipper, classOf, textKind, LEAN, MUST, TIP, CHAT } from '../ui/leanSkipper.js';
import { planKind } from '../ui/plan.js';
import { DEST_SAY } from '../../src/sim/modes/chill/navigator.js';

const DT = 1 / 30;
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const sailingWell = () => ({ x: 0, z: 1600, heading: 0, sog: 2.6, furl: 0, held: false, mainFill: 1, mainStall: 0, groove: 1,
  trueWind: { angle: Math.PI / 2, speed: 5 }, apparentWind: { angle: 1.2, speed: 6 } });

async function rig({ flat = false, state = sailingWell(), storage = store(), busy = () => false } = {}) {
  install();
  document.documentElement = document.createElement('html');
  if (flat) document.documentElement.classList.add('lk-flat');
  features.mounted('flatControls', !!flat);
  const { createControlsHint } = await import('../../src/ui/controlsHint.js');
  const sk = createSkills({ storage: null });
  const phone = createPhoneQuiet({ storage: null });
  const lean = createLeanSkipper({ phone, storage, busy });
  const spoken = [];
  const voice = { say: (t) => spoken.push(t) };
  const hint = createControlsHint({ state: () => state, skills: sk, words: createWords({ skills: sk }), once: true, storage: store(), touch: () => false, modality: () => 'keys', phoneQuiet: lean, voice });
  const lines = []; let last = 'none', lastText = '', t = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      t += DT;
      sk.update(DT, { twa: state.trueWind.angle, tws: state.trueWind.speed, awa: state.apparentWind.angle, sog: state.sog, heading: state.heading, heel: 0.1,
        mainFill: state.mainFill, mainStall: state.mainStall, boomAngle: 0.5, surf: 0, roundUp: 0, groove: state.groove ?? 0, level: 3, steer: 0, pull: 0, crew: false, gust: null, x: state.x, z: state.z });
      hint.update(DT);
      const c = hint.current, tx = text(hint.el.innerHTML);
      if (c !== 'none' && (c !== last || tx !== lastText)) lines.push({ at: +t.toFixed(2), name: c, text: tx });
      last = c; lastText = tx;
    }
  };
  const secs = (s) => step(Math.round(s / DT));
  return { hint, lean, step, secs, lines, spoken, storage, get t() { return t; }, sk };
}

test('the table: MUST, TIP and CHAT kinds; a kind not in the table is chatter', () => {
  for (const k of ['sea.shoal', 'sea.aground', 'sea.deep', 'sea.fast', 'knock.warn', 'refuse.plan', 'refuse.mark', 'refuse.pilot', 'race.wrongSide', 'race.ocs', 'race.penalty', 'officer.rc_wrong']) assert.equal(classOf(k), MUST, k);
  for (const k of ['first', 'hint.pull', 'hint.ease', 'hint.irons', 'tip.helm', 'tip.plan', 'tip.logbook', 'sea.motorKeys', 'cruise.look']) assert.equal(classOf(k), TIP, k);
  for (const k of ['status', 'reply', 'hint.steer', 'hint.groove', 'sea.engineOffSails', 'sea.helm', 'sea.floating', 'tessie.mark', 'cruise.stars', 'race.finish', 'moment.place', 'chat', undefined, null, 'whatever'])
    assert.equal(classOf(k), CHAT, String(k));
  // a line with no kind: its text (the helm nudge, the Calm HUD, the first find a tip; a practice mark's wrong side MUST; the rest chatter)
  assert.equal(textKind('Tap Helm for the helm view'), 'tip.helm');
  assert.equal(textKind('First gust — added to your logbook'), 'tip.logbook');
  assert.equal(textKind('The waterfall — in the logbook'), 'chat');
  assert.equal(textKind('The windward mark: wrong side, go round again'), 'course.wrongSide');
  for (const s of ['Kayakers off the bow.', 'Hold on — that rock just moved.', 'Wave if you like. She has been ignoring sailors for ten thousand years.', 'Wind level 3', 'The stars come out…'])
    assert.equal(classOf(textKind(s)), CHAT, s);
  // the planner's replies: a refusal MUST, the first open's how-to a tip, the course lines status
  assert.equal(classOf(planKind(DEST_SAY.land)), MUST);
  assert.equal(classOf(planKind('Click the water to add a waypoint. Click a name to sail there.')), TIP);
  assert.equal(classOf(planKind('Course cleared.')), CHAT);
});

test('no chatter: 10 minutes of call-outs, statuses and flavour show nothing and say nothing', async () => {
  const R = await rig();
  const chatter = [
    () => R.hint.flash('Kayakers off the bow.', { secs: 4.5, kind: textKind('Kayakers off the bow.') }),
    () => R.hint.flash('Anchor holding', { kind: 'status' }),
    () => R.hint.flash('Freeing her', { secs: 4, kind: 'reply' }),
    () => R.hint.flash('Hold on — that rock just moved.', { secs: 4.5, kind: 'chat' }),
    () => R.hint.note('Engine off — the sails have her', 'I', 'Engine off. The sails have her.', { kind: 'sea.engineOffSails' }),
    () => R.hint.flash('Course set. Waypoint 1 bears 190°, 0.3 nm.', { kind: planKind('Course set. Waypoint 1 bears 190°, 0.3 nm.') }),
    () => R.hint.keep(1), () => R.hint.keep(0),
  ];
  for (let i = 0; i < 600 / 5; i++) { chatter[i % chatter.length](); R.secs(5); }
  assert.deepEqual(R.lines, [], JSON.stringify(R.lines));
  assert.deepEqual(R.spoken, []);
});

test('MUST shows at once and replaces the line on screen; it shows during a manoeuvre; it is spoken', async () => {
  let busy = false;
  const R = await rig({ busy: () => busy });
  R.secs(2);
  assert.ok(R.hint.note('Drag the wheel to steer — the crew handles the sails.', '', 'Drag the wheel to steer.', { kind: 'first' }));
  R.secs(1.5);
  assert.equal(R.hint.current, 'note');
  assert.match(text(R.hint.el.innerHTML), /steer/);
  // a tack under way: a shoal warning still takes the row within a second, over the tip
  busy = true;
  R.hint.note('Shoaling — bear away', 'A', 'Shoaling. Bear away.', { kind: 'sea.shoal' });
  R.secs(1);
  assert.match(text(R.hint.el.innerHTML), /Shoaling/, JSON.stringify(R.lines));
  assert.ok(R.spoken.includes('Shoaling. Bear away.'));
  // a flash MUST (a refusal) takes it at once, even mid-manoeuvre
  R.hint.flash('Too shallow there. Mark open water.', { secs: 4, kind: 'refuse.mark' });
  R.step(1);
  assert.equal(R.hint.current, 'flash');
  assert.match(text(R.hint.el.innerHTML), /Too shallow/);
  // two MUST lines a second apart: both show (no 20 s rule for MUST)
  R.secs(5);
  R.hint.flash('Overpowered — ease the sails or reef', { secs: 4, kind: 'knock.warn' });
  R.step(1);
  assert.match(text(R.hint.el.innerHTML), /Overpowered/);
});

test('TIP: never mid-manoeuvre, never within 20 s of another line, then once ever (the store remembers; a blocked store does not throw)', async () => {
  let busy = true;
  const storage = store();
  const R = await rig({ busy: () => busy, storage });
  R.secs(1);
  assert.equal(R.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' }), true);
  R.step(1);
  assert.equal(R.hint.current, 'none', 'mid-manoeuvre: dropped');
  busy = false;
  R.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' });
  R.step(1);
  assert.equal(R.hint.current, 'flash', 'quiet water: it shows');
  R.secs(5);
  // another tip 5 s later: the 20 s rule drops it; after 20 s it shows
  R.hint.note('+ for more power, − to slow — she holds the setting', '', null, { kind: 'sea.motorKeys' });
  R.secs(2);
  assert.equal(R.hint.current, 'none', 'within 20 s of the last line: dropped');
  R.secs(LEAN.gapS);
  R.hint.note('+ for more power, − to slow — she holds the setting', '', null, { kind: 'sea.motorKeys' });
  R.secs(1);
  assert.equal(R.hint.current, 'note');
  // once ever: the same tip again, much later, in this visit and the next
  R.secs(60);
  R.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' });
  R.step(1);
  assert.equal(R.hint.current, 'none', 'a tip shows once');
  const R2 = await rig({ storage });
  R2.secs(30);
  R2.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' });
  R2.step(1);
  assert.equal(R2.hint.current, 'none', 'the next visit remembers it');
  // a store that throws: no crash, the tip shows once this visit
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const R3 = await rig({ storage: bad });
  R3.secs(30);
  R3.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' });
  R3.step(1);
  assert.equal(R3.hint.current, 'flash');
});

test('the skill lines: a trim tip shows once ever; "She needs a hand — steer" never; nothing within 20 s of a MUST line', async () => {
  const state = { ...sailingWell(), mainFill: 0.2 };   // luffing: the model asks for "pull the sails in"
  const storage = store();
  const R = await rig({ state, storage });
  R.secs(120);
  const pulls = R.lines.filter((l) => l.name === 'pull');
  assert.equal(pulls.length, 1, JSON.stringify(R.lines));
  assert.match(pulls[0].text, /Sails shaking/);
  assert.ok(!R.lines.some((l) => l.name === 'steer' || l.name === 'keep'), JSON.stringify(R.lines));
  const R2 = await rig({ state: { ...state }, storage });
  R2.secs(120);
  assert.equal(R2.lines.filter((l) => l.name === 'pull').length, 0, 'once ever: not on the next visit');
  // priority: a MUST line holds the row; the skill tips wait mustHoldS after it
  const R3 = await rig({ state: { ...state } });
  R3.hint.note('Rocks ahead — bear away', 'A', null, { kind: 'sea.rocks' });
  R3.secs(LEAN.mustHoldS - 0.5);
  assert.ok(!R3.lines.some((l) => l.name === 'pull'), JSON.stringify(R3.lines));
  assert.match(R3.lines[0]?.text ?? '', /Rocks ahead/);
});

test('one line every 20 s at most outside MUST; the phone rule still applies on top', async () => {
  const R = await rig();
  const tips = [['tip.helm', 'Tap Helm for the helm view'], ['tip.calm', 'Move the mouse to show the helm'], ['tip.logbook', 'First gust — added to your logbook'], ['sea.motorKeys', '+ for more power']];
  for (let i = 0; i < 40; i++) { const [k, s] = tips[i % tips.length]; R.hint.flash(s, { secs: 3, kind: k }); R.secs(3); }   // a tip offered every 3 s for 2 minutes
  const at = R.lines.map((l) => l.at);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= LEAN.gapS - 0.1, JSON.stringify(R.lines));
  assert.equal(R.lines.length, 4, 'each tip once: ' + JSON.stringify(R.lines));
  // a phone: the quiet rule drops what it dropped before (the helm nudge), even when lean would allow it
  const P = await rig({ flat: true });
  P.secs(30);
  P.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' });
  P.step(1);
  assert.equal(P.hint.current, 'none');
  P.hint.note('Shoaling — bear away', 'A', null, { kind: 'sea.shoal' });
  P.secs(1);
  assert.match(text(P.hint.el.innerHTML), /Shoaling/, 'a MUST the phone keeps still shows');
});

test('other channels (Regatta\'s card, Cruise\'s line): the same classes; a mark rounding holds all but MUST', () => {
  const L = createLeanSkipper({ storage: store() });
  L.update(30);
  L.hold('rounding', true);
  assert.equal(L.gate('race.rounding'), false, 'a teaching step waits out the rounding');
  assert.equal(L.gate('race.wrongSide'), true, 'the wrong side shows at once');
  assert.equal(L.gate('moment.place'), false);
  L.hold('rounding', false);
  L.update(LEAN.gapS);
  assert.equal(L.gate('race.rounding'), true, 'after the rounding, the first time');
  L.update(LEAN.gapS);
  assert.equal(L.gate('race.rounding'), false, 'once ever');
  assert.equal(L.gate('refuse.dest'), true);
  assert.equal(L.gate('cruise.stars'), false);
  assert.equal(L.gate('officer.rc_w_wren'), false);
});

test('the knockdown: its warning (knock.warn) shows over a tip mid-manoeuvre; once she is over, the hush holds the row', async () => {
  let busy = false;
  const R = await rig({ busy: () => busy });
  R.secs(25);
  R.hint.flash('Tap Helm for the helm view', { secs: 4, kind: 'tip.helm' });
  R.step(1);
  busy = true;   // a tack under way as the gust hits
  assert.equal(R.hint.flash('Overpowered — ease the sails or reef', { secs: 4, kind: 'knock.warn' }), true);
  R.step(1);
  assert.match(text(R.hint.el.innerHTML), /Overpowered/, 'the MUST replaces the tip at once');
  // knocked down: v2/main.js hushes the row (no "Freeing her", no further warning) until Start again
  R.hint.hush(true);
  R.secs(1);
  assert.equal(R.hint.flash('Overpowered — ease the sails or reef', { secs: 4, kind: 'knock.warn' }), false, 'a hushed row takes no flash');
  R.step(1);
  assert.notEqual(R.hint.current, 'flash');
  R.hint.hush(false);
  R.secs(1);
  assert.equal(R.hint.flash('Overpowered — ease the sails or reef', { secs: 4, kind: 'knock.warn' }), true, 'after Start again it warns again');
});

test('the anchor branch\'s kinds: deepSpot and dragging MUST, holding a tip that shows once at anchor (held is not busy), the rest chatter', async () => {
  assert.equal(classOf('sea.deepSpot'), MUST); assert.equal(classOf('sea.dragging'), MUST); assert.equal(classOf('sea.holding'), TIP);
  for (const k of ['sea.rounding', 'sea.up', 'sea.anchorage']) assert.equal(classOf(k), CHAT, k);
  // the busy test as v2/ui/sail.js builds it: the anchor working is busy, held is not
  const ANCHOR_WORK = new Set(['falling', 'down', 'weighing', 'up']);
  let phase = 'falling';
  const R = await rig({ busy: () => ANCHOR_WORK.has(phase) });
  R.secs(25);
  R.hint.flash('Anchor’s holding.', { secs: 3, kind: 'sea.holding' });
  R.step(1);
  assert.equal(R.hint.current, 'none', 'not while the chain runs');
  phase = 'held';
  R.hint.flash('Anchor’s holding.', { secs: 3, kind: 'sea.holding' });
  R.step(1);
  assert.match(text(R.hint.el.innerHTML), /holding/, 'held: it shows');
  R.secs(60);
  R.hint.flash('Anchor’s holding.', { secs: 3, kind: 'sea.holding' });
  R.step(1);
  assert.equal(R.hint.current, 'none', 'once ever');
});

test('the first sail\'s intro goes first: while it is due no other tip takes the row (a start by the island finds it at once)', () => {
  let due = true;
  const lean = createLeanSkipper({ storage: store(), firstDue: () => due });
  lean.update(30);
  assert.equal(lean.allow('tip.logbook'), false, 'the island\'s logbook line waits for the intro');
  assert.equal(lean.allow('first'), true, 'the intro shows');
  assert.equal(lean.allow('sea.shore'), true, 'a MUST still shows at once');
  due = false;
  lean.update(30);
  assert.equal(lean.allow('tip.logbook'), true, 'the intro said: tips as before');
});
