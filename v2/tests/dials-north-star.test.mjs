// The dials' north star (owner, 2026-11-25): the Coach's cues, the Chart's nearest place and shore arcs, the Pro instruments panel,
// the lean skipper holding the same advice while the Coach says it. No browser (the live page: v2/tests/pages/dialModules.page.mjs,
// proColumn.page.mjs, navColumn.page.mjs).
//   the Coach's words appear only on the physics' conditions: luffing (fill < 0.5) "pull in", stalled (stall > 0.6, wind forward
//     of 80°) "ease out", overpowered (heel > 20°) "ease or reef", a sheet at its stop hands the word to the helm (bear away,
//     head up), in irons bear away; a drawing boat says nothing
//   the nearest place: the beacon's target (a mark, the race's next mark) first, else the nearest birthplace or anchorage past 200 m
//   the shore arcs: the bearings with land or shallow water within 240 m, none in open water
//   the Pro panel: off by default, the stored choice persists, ?prohud= overrides, the shown rule (the cockpit up, not the intro,
//     not closed), the × calls onClose, its six lines
import test from 'node:test';
import assert from 'node:assert/strict';
import { trimCue, steerCue, heelCue, tackOf, nearestPoi, nmText, shoreArcs, sheetAtStop, poiRow, DIALS_V2 } from '../ui/dialsV2.js';
import { createProHud, proHudAllowed, proHudShown, proHudSettings, proLines, mountProRow, PRO_HUD } from '../ui/proHud.js';
import { createLeanSkipper, COACH_HINTS } from '../ui/leanSkipper.js';
import { BOAT } from '../../src/sim/boat.js';
import { createReadings } from '../../src/ui/navColumn.js';

const D = Math.PI / 180;
const boat = (o = {}) => ({ mainFill: 1, jibFill: 1, mainStall: 0, jibStall: 0, boomAngle: 35 * D, jibAngle: 32 * D, apparentWind: { angle: -60 * D, speed: 5 }, trueWind: { angle: -75 * D, speed: 4 }, heel: 0, sog: 2.5, cog: 0, rudderAngle: 0, ...o });

test('the Coach says nothing while she draws; luffing says pull in, stalled ease out (wind forward of 80°)', () => {
  assert.deepEqual(trimCue(boat(), 'main'), { state: 'draw', word: '' });
  assert.equal(steerCue(boat(), 'closeReach'), '');
  assert.equal(heelCue(5), '');
  const luff = trimCue(boat({ jibFill: 0.3 }), 'jib');
  assert.equal(luff.state, 'luff'); assert.equal(luff.word, 'pull in'); assert.equal(luff.atStop, false);
  const stall = trimCue(boat({ mainStall: 0.8 }), 'main');
  assert.equal(stall.state, 'stall'); assert.equal(stall.word, 'ease out');
  // a run's sails are stalled by nature: no word with the wind aft of 80°
  assert.equal(trimCue(boat({ mainStall: 0.9, apparentWind: { angle: 150 * D, speed: 3 } }), 'main').state, 'draw');
  // the thresholds themselves
  assert.equal(trimCue(boat({ mainFill: DIALS_V2.luffFill + 0.01 }), 'main').state, 'draw');
  assert.equal(trimCue(boat({ mainStall: DIALS_V2.stallAt - 0.01 }), 'main').state, 'draw');
});

test('a sheet at its stop hands the word to the helm: luffing all the way in bears away, stalled all the way out heads up; in irons bears away', () => {
  const inStop = boat({ jibFill: 0.2, jibAngle: BOAT.jib.lead });
  assert.equal(sheetAtStop(inStop, 'jib', 'in'), true);
  assert.equal(trimCue(inStop, 'jib').atStop, true);
  assert.equal(steerCue(inStop, 'close'), 'bear away');
  const outStop = boat({ mainStall: 0.9, boomAngle: BOAT.main.maxDeg * D });
  assert.equal(steerCue(outStop, 'closeReach'), 'head up');
  assert.equal(steerCue(boat(), 'irons'), 'bear away');
});

test('overpowered over 20° of heel: ease or reef; the tack from the true wind\'s side', () => {
  assert.equal(heelCue(DIALS_V2.overHeelDeg + 1), 'ease or reef');
  assert.equal(heelCue(-(DIALS_V2.overHeelDeg + 1)), 'ease or reef');
  assert.equal(heelCue(DIALS_V2.overHeelDeg - 1), '');
  assert.equal(tackOf(-60 * D), 'port'); assert.equal(tackOf(60 * D), 'starboard'); assert.equal(tackOf(0), ''); assert.equal(tackOf(Math.PI), '');
});

test('the nearest place: the beacon\'s target first, else the nearest birthplace or anchorage past 200 m; the bearing is true', () => {
  const b = { x: 0, z: 0 };
  const list = [{ kind: 'birthplace', name: 'Here', x: 50, z: 0 }, { kind: 'anchorage', name: '', x: 0, z: -600 }, { kind: 'birthplace', name: 'Far', x: 2000, z: 0 }];
  const n = nearestPoi(b, list);
  assert.equal(n.kind, 'anchorage'); assert.equal(Math.round(n.dM), 600); assert.equal(Math.round(n.brgDeg), 0, 'north (−z) is 0°');
  const m = nearestPoi(b, [{ kind: 'race', name: '', x: 3000, z: 0 }, ...list]);
  assert.equal(m.kind, 'race'); assert.equal(Math.round(m.brgDeg), 90, 'a far race mark east still wins');
  assert.equal(nearestPoi(b, [{ kind: 'mark', name: '', x: 0, z: 900 }, ...list]).kind, 'mark');
  assert.equal(nearestPoi(b, []), null);
  assert.equal(nmText(315), '.17'); assert.equal(nmText(3000), '1.6');
});

test('the Chart\'s row: a short birthplace name or the kind; PRO adds the bearing (and shortens the kind)', () => {
  const a = poiRow({ kind: 'anchorage', name: '', dM: 315, brgDeg: 273.4 }, false);
  assert.equal(a.label, 'Anchorage'); assert.equal(a.dText, '.17'); assert.equal(a.bText, '');
  const p = poiRow({ kind: 'anchorage', name: '', dM: 315, brgDeg: 273.4 }, true);
  assert.equal(p.label, 'Anch'); assert.equal(p.bText, ' 273°');
  const f = poiRow({ kind: 'birthplace', name: 'Fannette', dM: 1111, brgDeg: 42 }, true);
  assert.equal(f.label, 'Fannette'); assert.equal(f.dText, '.60'); assert.equal(f.bText, ' 042°');
  assert.equal(poiRow(null), null);
});

test('the shore arcs: land or water under 2.2 m within 240 m, on 24 bearings; none in open water', () => {
  const open = () => -30;
  assert.deepEqual(shoreArcs(open, 0, 0), new Array(24).fill(0));
  // a shore 100 m east (x > 100 is land), a shoal 1.5 m deep 200 m north (z < −200)
  const h = (x, z) => (x > 100 ? 5 : z < -200 ? -1.5 : -20);
  const arcs = shoreArcs(h, 0, 0);
  assert.equal(arcs.length, 24);
  assert.equal(arcs[6], 120, 'east (90°, index 6): the first 30 m step past 100 m');
  assert.equal(arcs[0], 210, 'north: the shoal at 210 m');
  assert.equal(arcs[12], 0, 'south: open');
  assert.equal(arcs[18], 0, 'west: open');
  // deeper than 2.2 m is not a hazard
  assert.deepEqual(shoreArcs(() => -2.3, 0, 0), new Array(24).fill(0));
});

test('the lean skipper holds the trim and steering tips while the Coach shows a word; MUST lines still pass', () => {
  let says = true;
  const store = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
  const lean = createLeanSkipper({ storage: store, coachSays: () => says });
  lean.update(30);
  for (const h of COACH_HINTS) assert.deepEqual(lean.wants([{ hint: h }]), [], `${h} waits while the Coach speaks`);
  assert.deepEqual(lean.wants([{ hint: 'gusts' }]), [{ hint: 'gusts' }], 'another tip still shows');
  assert.equal(lean.allow('knock.warn'), true, 'a MUST line passes');
  says = false; lean.update(30);
  assert.deepEqual(lean.wants([{ hint: 'pull' }]), [{ hint: 'pull' }], 'the Coach quiet: the tip may show');
});

test('the Pro panel: off by default; the stored choice persists; ?prohud overrides; a desktop only', () => {
  const mem = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
  const S = proHudSettings(mem);
  assert.equal(S.on, false, 'off by default');
  assert.equal(proHudAllowed({ policy: true, stored: S.on }), false);
  let heard = null; S.listen((v) => { heard = v; });
  S.set(true); assert.equal(heard, true);
  assert.equal(JSON.parse(mem.getItem(PRO_HUD.key)).on, true, 'stored under its own key');
  S.forget(); assert.equal(S.on, true, 'read back from the store (a reload)');
  assert.equal(proHudAllowed({ policy: true, stored: true }), true);
  assert.equal(proHudAllowed({ policy: true, stored: true, flag: '0' }), false, '?prohud=0 never');
  assert.equal(proHudAllowed({ policy: true, stored: false, flag: '1' }), true, '?prohud=1 for this load');
  assert.equal(proHudAllowed({ policy: false, stored: true, flag: '1' }), false, 'a tablet or a phone: never');
  S.set(false);
});

test('the Pro panel\'s rule matches the perf panel\'s: the cockpit up (folded, Clear, Cruise, Tessie take it), not the intro, not closed', () => {
  assert.equal(proHudShown({ allowed: true, cockpitUp: true }), true);
  assert.equal(proHudShown({ allowed: true, cockpitUp: false }), false, 'folded, Clear, Instruments, Cruise, Tessie: cockpitUp false');
  assert.equal(proHudShown({ allowed: true, cockpitUp: true, intro: true }), false, 'the cinematic intro');
  assert.equal(proHudShown({ allowed: true, cockpitUp: true, closed: true }), false, 'the ×');
  assert.equal(proHudShown({ allowed: false, cockpitUp: true }), false, 'Setup off');
});

// a tiny DOM for the plate and the row
function fakeDoc() {
  const byId = new Map();
  const mk = (tag) => {
    const set = new Set(), L = {};
    const n = { tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, textContent: '', innerHTML: '', parent: null,
      classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') byId.set(v, this); }, getAttribute(k) { return this.attrs[k] ?? null; },
      append(...cs) { for (const c of cs) this.appendChild(c); }, appendChild(c) { this.children.push(c); c.parent = this; if (c.id) byId.set(c.id, c); return c; },
      addEventListener(t, f) { (L[t] ??= []).push(f); }, removeEventListener() {}, fire(t, e = {}) { for (const f of L[t] ?? []) f({ stopPropagation() {}, ...e }); },
      blur() {}, remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); } };
    Object.defineProperty(n, 'className', { get: () => [...set].join(' '), set: (v) => { set.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) set.add(c); } });
    return n;
  };
  const head = mk('head'), body = mk('body');
  return { head, body, documentElement: mk('html'), createElement: mk, getElementById: (id) => byId.get(id) ?? head.children.find((c) => c.id === id) ?? null };
}
const all = (n, out = []) => { out.push(n); for (const c of n.children) all(c, out); return out; };

test('the Pro panel: six lines (COG, TWA, VMG, AWA, HEEL, RUD), shown only by its rule, the × calls onClose', () => {
  const doc = fakeDoc();
  let shown = false, closed = 0;
  const hud = createProHud({ doc, state: () => boat({ heel: 12 * D, rudderAngle: -3 * D, cog: 236 * D }), shown: () => shown, onClose: () => { closed++; } });
  assert.ok(hud.el.classList.contains('gone'), 'hidden at first');
  hud.update(0.3); assert.equal(hud.state.paints, 0, 'no paint while hidden');
  shown = true; hud.update(0.3);
  assert.equal(hud.shown, true); assert.ok(!hud.el.classList.contains('gone'));
  assert.deepEqual(hud.state.lines.map((l) => l[0]), ['COG', 'TWA', 'VMG', 'AWA', 'HEEL', 'RUD']);
  const L = Object.fromEntries(hud.state.lines.map(([k, v, s]) => [k, [v, s]]));
  assert.deepEqual(L.COG, ['236°', '']); assert.deepEqual(L.AWA, ['60°', 'P']); assert.deepEqual(L.TWA, ['75°', 'P']);
  assert.deepEqual(L.HEEL, ['12°', 'S']); assert.deepEqual(L.RUD, ['3°', 'P']);
  assert.match(L.VMG[0], /^\d+\.\d kn$/);
  hud.close.fire('click'); assert.equal(closed, 1, 'the × calls onClose');
  assert.equal(hud.close.getAttribute('aria-label'), 'Close Pro instruments');
  // the readings' own maths, as the panel reads them
  const r = createReadings().step({ cog: 0, twsMs: 4, twa: 60 * D, sogMs: 2.572, heel: 0, rudder: 0 }, 0.25);
  assert.equal(proLines(r, 0.5)[2][1], '2.5 kn', 'VMG = SOG × cos TWA');
});

test('Setup › Screen › Pro instruments: the row reads the store, a click stores it, the panel\'s × repaints it', () => {
  const doc = fakeDoc(), tab = doc.createElement('div'); tab.id = 'tp-set-screen';
  const rows = [];
  tab.querySelector = (q) => (q === '[data-set="prohud"]' ? rows.find((r) => r.dataset.set === 'prohud') ?? null : null);
  tab.insertBefore = (c) => { rows.push(c); };
  tab.appendChild = (c) => { rows.push(c); return c; };
  const root = { querySelector: (q) => (q === '#tp-set-screen' ? tab : null) };
  const mem = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
  const settings = proHudSettings(mem);
  const btn = (pi) => { const b = doc.createElement('button'); b.dataset.pi = pi; b.closest = (q) => (q === '[data-pi]' ? b : null); return b; };
  const on = btn('on'), off = btn('off');
  const origCreate = doc.createElement;
  doc.createElement = (t) => { const n = origCreate(t); n.querySelectorAll = () => [on, off]; return n; };
  const R = mountProRow(root, { settings, doc });
  assert.ok(R, 'mounted'); assert.equal(off.getAttribute('aria-checked'), 'true', 'reads off by default');
  R.row.fire('click', { target: on }); assert.equal(settings.on, true); assert.equal(on.getAttribute('aria-checked'), 'true');
  settings.set(false); assert.equal(off.getAttribute('aria-checked'), 'true', 'the ×\'s off repaints the row');
  R.dispose();
});
