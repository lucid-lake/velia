// Setup holds only what has no other on-screen path (owner, 2026-11-17: "On my left I no longer see the Pro status even though I
// toggled the Pro button … remove redundant settings from Setup if they can be done from the cockpit and the top bar").
//   the cause    a stored edgeInstruments 'off' (v1's Setup › Aids row) hid the nav column while the cockpit's PRO was on (v2's
//                column has since gone: the Pro instruments panel, ui/proHud.js)
//   the fix      v2 takes wind, weather, Pro, auto-reef and edge instruments off its card (setup.js REMOVED_ROWS) and reads a retired
//                key as its default (v2Settings), so no old stored value can hide the column; v1's page and store are untouched
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, SETTINGS } from '../../src/ui/settings.js';
import { pagesHtml } from '../../src/ui/homePages.js';
import { featureSettings } from '../../src/features/setup.js';
import { WATERS, WATERS_SOON } from '../../src/sim/waters/index.js';
import { VESSELS, VESSELS_SOON } from '../../src/sim/vessels/index.js';
import { SETUP_ROWS, REMOVED_ROWS, RETIRED_KEYS, removeRows, v2Settings } from '../ui/setup.js';
import { createNavColumn } from '../../src/ui/navColumn.js';
import { createPassage } from '../../src/ui/passage.js';
import { createServices } from '../../src/sim/core/services.js';

const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const page = () => pagesHtml({ waters: WATERS, vessels: VESSELS, wChosen: WATERS[0].id, vChosen: VESSELS[0].id, wSoon: WATERS_SOON, vSoon: VESSELS_SOON, features: featureSettings({ fireworks: true, kayaks: '1' }) });
const setupPanel = (html) => html.slice(html.indexOf('data-page="settings"'), html.indexOf('data-page="about"'));
// a card root over v1's Setup html: its .set rows, each removable (removeRows' only DOM call is querySelectorAll + remove)
function fakeRoot(html) {
  const rows = [...setupPanel(html).matchAll(/class="set[^"]*" data-set="([^"]+)"/g)].map((m) => ({ set: m[1] }));
  const root = { rows, querySelectorAll: (sel) => { const k = /data-set="([^"]+)"/.exec(sel)?.[1]; return rows.filter((r) => r.set === k).map((r) => ({ remove: () => rows.splice(rows.indexOf(r), 1) })); } };
  return root;
}

test('the card: v2 removes exactly the rows with another on-screen path; v1\'s page still has every one', () => {
  const html = page(), root = fakeRoot(html);
  const before = root.rows.map((r) => r.set);
  for (const r of REMOVED_ROWS) assert.ok(before.includes(r.set), `v1's Setup still has "${r.set}" (v1 at /classic/ unchanged)`);
  const removed = removeRows(root);
  assert.deepEqual(removed.sort(), REMOVED_ROWS.map((r) => r.set).sort(), 'each removed row once');
  const after = root.rows.map((r) => r.set);
  assert.deepEqual(after, before.filter((k) => !REMOVED_ROWS.some((r) => r.set === k)), 'the rest kept, in order');
  assert.deepEqual(removeRows(root), [], 'a second call is a no-op');
  // nothing left in v2's acting table points at a removed row
  const goneKeys = new Set(REMOVED_ROWS.map((r) => r.key).filter(Boolean));
  for (const r of SETUP_ROWS) assert.ok(!goneKeys.has(r.key), `${r.key} is not both kept and removed`);
  for (const r of REMOVED_ROWS) assert.ok(r.other && r.other.length > 10, `${r.set}: its other on-screen path is named`);
});

test('the store as v2 reads it: a retired key reads as its default whatever is stored; the rest pass through; v1\'s value is left alone', () => {
  const stored = { _v: 2, edgeInstruments: 'off', hud: 'full', proMode: true };
  const st = memStore({ 'lakeshore.settings.v1': JSON.stringify(stored) });
  const raw = createSettings({ storage: st }), s = v2Settings(raw);
  assert.equal(raw.get('edgeInstruments'), 'off', 'v1 still reads its choice');
  for (const [k, v] of Object.entries(RETIRED_KEYS)) { assert.equal(s.get(k), v, `${k} reads as ${v} on v2`); assert.equal(SETTINGS[k], v, `${k}: today's default`); }
  assert.equal(s.get('hud'), 'full'); assert.equal(s.get('proMode'), true, 'kept keys pass through');
  assert.equal(s.all().edgeInstruments, 'auto');
  let heard = null; const off = s.on((k, v) => { heard = [k, v]; });
  s.set('hud', 'calm'); assert.deepEqual(heard, ['hud', 'calm'], 'set and on are the store\'s own'); off();
  assert.equal(JSON.parse(st.m.get('lakeshore.settings.v1')).edgeInstruments, 'off', 'nothing clears v1\'s stored value');
  assert.equal(v2Settings(null), null);
});

// the column's show rule, on the services ui/sail.js gives it (no boat needed for on/off: a still boat state)
function column(stored, { pro }) {
  const services = createServices();
  const state = { cog: 0, sog: 2, trueWind: { speed: 5, angle: 0.8 }, heel: 0.1, rudderAngle: 0, x: 0, z: 0 };
  services.provide('player', { phys: { state } });
  services.provide('controls', { hint: { current: 'none' }, get tools() { return { bino: { k: 0 } }; }, get pro() { return pro; } });
  services.provide('calm', { mode: 'calm' });
  services.provide('chart', { chart: { toggle: { big: false, pinned: false } }, get state() { return { waypoint: null, dest: null }; } });
  const settings = createSettings({ storage: memStore({ 'lakeshore.settings.v1': JSON.stringify({ _v: 2, ...stored }) }) });
  let t = 0; const win = { performance: { now: () => (t += 1100) }, innerHeight: 1080, setTimeout: (f) => f(), clearTimeout() {} };
  const doc = { head: { children: [], appendChild(c) { this.children.push(c); } }, body: { children: [], appendChild(c) { this.children.push(c); } }, documentElement: { classList: { contains: () => false } },
    getElementById: () => null,
    createElement: () => { const set = new Set(); const n = { children: [], style: {}, dataset: {}, textContent: '', setAttribute() {}, appendChild(c) { n.children.push(c); return c; }, remove() {},
      classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) } };
      Object.defineProperty(n, 'className', { get: () => [...set].join(' '), set: (v) => { set.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) set.add(c); } }); return n; } };
  const v1 = createNavColumn({ services: { get: (k) => services.get(k), provide() {} }, settings, getMode: () => 'sail', passage: createPassage({ services }), doc, win });
  v1.update(); v1.update();
  return { v1: v1.el.classList.contains('on') };
}

// v2 has no nav column since 2026-11-25 (the Pro instruments panel, ui/proHud.js, has its own Setup row): v1 keeps its row
test('v1 (/classic/) still honours its edge instruments row', () => {
  assert.equal(column({ edgeInstruments: 'off' }, { pro: true }).v1, false, 'v1 (/classic/) keeps its row: off hides it there');
});
