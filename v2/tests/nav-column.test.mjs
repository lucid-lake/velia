// The nav column on v2 (ui/nav.js: v1's src/ui/navColumn.js and src/ui/passage.js as they are, wired as v1's shell.js).
// The rows' values: v2's boat (v2/sim/boat.js on v1's BoatPhysics) sailed a while in a steady wind, then the same state read by
// v2's column (the services' shapes ui/sail.js gives it) and by v1's (the shapes v1's shell gives it): the same rows, the same
// strings, and the strings are the state's own numbers (COG, TWS, TWA, VMG = SOG cos TWA, HEEL, RUD; DTW, BTW, TTG, XTE from
// passageTo). The show and hide rules as v1's: an empty edge for a regular player, Pro brings the readings, a chart waypoint
// the passage block, a stale edge instruments value ignored (v2 has no row), Clear and the covers, the helm view keeps it, ?navcol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNav } from '../ui/nav.js';
import { createNavColumn, ROWS } from '../../src/ui/navColumn.js';
import { createPassage, passageTo, dtwText, ttgText } from '../../src/ui/passage.js';
import { createServices } from '../../src/sim/core/services.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const D = 180 / Math.PI, KN = 0.514444;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });

// a tiny DOM (v1's tests/navColumn.test.mjs's): createElement / appendChild / textContent only (the column never queries the document)
function fakeDoc() {
  const mk = (tag) => { const set = new Set(); const n = { tagName: tag, children: [], style: {}, dataset: {}, textContent: '', attrs: {},
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, prepend(c) { this.children.unshift(c); c.parent = this; return c; }, appendChild(c) { this.children.push(c); c.parent = this; return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); } };
    Object.defineProperty(n, 'className', { get: () => [...set].join(' '), set: (v) => { set.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) set.add(c); } });
    return n; };
  const head = mk('head'), body = mk('body');
  return { head, body, documentElement: mk('html'), createElement: mk, getElementById: (id) => head.children.find((c) => c.id === id) ?? null };
}
// the shown rows, top to bottom, and a row's strings
const shown = (el) => el.children.filter((r) => !r.classList.contains('fade')).sort((a, b) => +a.style.order - +b.style.order).map((r) => r.dataset.id);
const cell = (el, id) => {
  const r = el.children.find((c) => c.dataset.id === id);
  if (id === 'mark') return r.children[0].children[0].textContent;
  const n = r.children[1];
  return `${n.children[0].children[1].textContent}${n.children[1].textContent}${n.children[2].textContent ? ` ${n.children[2].textContent}` : ''}`;
};
const strings = (el) => Object.fromEntries(shown(el).filter((id) => !id.startsWith('gap')).map((id) => [id, cell(el, id)]));

// v2's boat, sailed 20 s close-hauled on starboard in 6 m/s from 200°, a little helm on
function sailedBoat() {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(6, 200) });
  for (let i = 0; i < 20 * 60; i++) B.step(1 / 60, { steer: i < 300 ? 0.3 : 0, pull: 0 });
  return B;
}
// v2's services as ui/sail.js provides them (player, controls with its pro getter, the Calm HUD, the chart with its state)
function v2Page(B, { pro = false, waypoint = null, setting = 'auto', hud = 'calm' } = {}) {
  const services = createServices();
  let proOn = pro;
  const chart = { chart: { toggle: { big: false, pinned: false } }, update() {}, get state() { return { waypoint: page.waypoint, dest: null }; } };
  services.provide('player', { phys: B.phys });
  services.provide('controls', { hint: { current: 'none' }, get tools() { return { bino: { k: 0 } }; }, ctl: B.ctl, get pro() { return proOn; } });
  services.provide('calm', { get mode() { return page.hud; } });
  services.provide('chart', chart);
  const store = { edgeInstruments: setting };
  const settings = { get: (k) => store[k] };
  let t = 0; const win = { performance: { now: () => t }, innerHeight: 1080, setTimeout: (f) => f(), clearTimeout() {} };
  const doc = fakeDoc();
  const page = { services, store, doc, waypoint, hud, setPro: (on) => { proOn = on; }, tick: (ms = 1100) => { t += ms; } };
  page.col = mountNav({ services, settings, getMode: () => 'sail', doc, win });
  return page;
}
// v1's shell wiring of the same state (src/shell.js: createPassage, then createNavColumn; v1's chart service: src/sail/chart.js pub)
function v1Page(state, { pro = false, waypoint = null } = {}) {
  const svc = { player: { phys: { state } }, controls: { pro }, calm: { mode: 'calm' }, chart: { chart: { toggle: {} }, state: { waypoint, dest: null } } };
  const services = { get: (k) => svc[k], provide: (k, v) => { svc[k] = v; return v; } };
  services.provide('passage', createPassage({ services }));
  let t = 0; const win = { performance: { now: () => t }, innerHeight: 1080, setTimeout: (f) => f(), clearTimeout() {} };
  const col = createNavColumn({ services, settings: { get: () => 'auto' }, getMode: () => 'sail', doc: fakeDoc(), win });
  return { col, tick: (ms = 1100) => { t += ms; } };
}

test('the rows\' values: v2\'s column prints v1\'s strings for the same boat state, and they are the state\'s own numbers', () => {
  const B = sailedBoat(), s = B.phys.state;
  assert.ok(s.sog > 1 && Math.abs(s.heel) > 1 / D && Math.abs(s.trueWind.angle) > 20 / D, 'the boat is sailing, heeled, off the wind\'s eye');
  const wp = { x: s.x + 600, z: s.z - 900 };
  // v2's page and v1's shell on the same state, the same chart waypoint, the same frames
  const v2 = v2Page(B, { pro: true, waypoint: wp }), v1 = v1Page(s, { pro: true, waypoint: wp });
  for (let i = 0; i < 3; i++) { v2.col.update(); v2.tick(); v1.col.update(); v1.tick(); }
  v2.col.update(); v1.col.update();
  assert.deepEqual(shown(v2.col.el), ['cog', 'tws', 'twa', 'gap0', 'vmg', 'heel', 'rud', 'gap1', 'mark', 'dtw', 'btw', 'ttg', 'xte'], 'Pro and a mark: v1\'s Sail rows');
  const a = strings(v2.col.el);
  assert.deepEqual(a, strings(v1.col.el), 'v2 = v1, row for row');
  // the state's own numbers (a steady boat: the smoothed TWS and VMG sit on the state's)
  const r = v2.col.readings;
  const legFrom = v2.services.get('passage').from;
  const pad3 = (d) => String(((Math.round(d) % 360) + 360) % 360).padStart(3, '0');
  const side = (deg) => (Math.round(deg) > 0 ? ' S' : Math.round(deg) < 0 ? ' P' : '');
  const twsKn = s.trueWind.speed / KN, vmgKn = Math.abs((s.sog / KN) * Math.cos(s.trueWind.angle));
  assert.equal(a.cog, `${pad3(s.cog * D)}°`, 'COG: the course over ground, three digits');
  assert.ok(Math.abs(r.tws - twsKn) < 0.05, `TWS ${r.tws} vs the state's ${twsKn} kn`); assert.match(a.tws, /^\d+(\.\d)?kn$/);
  assert.equal(a.twa, `${Math.abs(Math.round(s.trueWind.angle * D))}°${side(s.trueWind.angle * D)}`, 'TWA: degrees off the bow, P or S');
  assert.ok(Math.abs(r.vmg - vmgKn) < 0.05, `VMG ${r.vmg} vs SOG cos TWA ${vmgKn} kn`);
  assert.equal(a.heel, `${Math.abs(Math.round(s.heel * D))}°${side(s.heel * D)}`, 'HEEL, to which side');
  assert.equal(a.rud, `${Math.abs(Math.round(s.rudderAngle * D))}°${side(s.rudderAngle * D)}`, 'RUD (Pro)');
  const p = passageTo(s, wp, { from: legFrom });
  assert.equal(a.mark, 'WP', 'MARK: Sail Pro\'s waypoint (v1\'s chartTarget)');
  assert.equal(a.dtw, `${dtwText(p.dtw)}nm`); assert.equal(a.btw, `${pad3(p.btw)}°`);
  const tt = ttgText(p.ttgMin); assert.equal(a.ttg, `${tt.num}${tt.unit}`);
  assert.equal(a.xte, `${p.xte.toFixed(2)}nm${p.xte.toFixed(2) === '0.00' || !p.side ? '' : ` ${p.side}`}`);
  // the boat sails on and tacks: the two columns stay row for row
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < 60; i++) B.step(1 / 60, { steer: k < 4 ? -1 : 0, pull: 0 });
    v2.tick(1000); v1.tick(1000); v2.col.update(); v1.col.update();
    assert.deepEqual(strings(v2.col.el), strings(v1.col.el), `v2 = v1 ${k + 1} s on`);
  }
});

test('show and hide: an empty edge by default, Pro, a waypoint, stale always / off ignored, Clear, the covers, the helm view', () => {
  const B = sailedBoat();
  const P = v2Page(B);
  const step = () => { P.tick(); P.col.update(); };
  const on = () => P.col.el.classList.contains('on');
  step();
  assert.equal(on(), false, 'Pro off, no mark: nothing on the left (owner, 2026-11-12: "regular people should not always look at it")');
  assert.deepEqual(shown(P.col.el), []);
  P.setPro(true); step();
  assert.equal(on(), true); assert.deepEqual(shown(P.col.el), ['cog', 'tws', 'twa', 'gap0', 'vmg', 'heel', 'rud'], 'Pro: the readings, RUD last');
  assert.ok(P.col.el.classList.contains('lk-edgepair') && P.col.el.classList.contains('left'), 'the edge pair\'s left block (the legend\'s style)');
  P.setPro(false); step();
  assert.equal(on(), false, 'Pro off again: empty');
  P.waypoint = { x: B.phys.state.x + 500, z: B.phys.state.z }; step();
  assert.deepEqual(shown(P.col.el), ['mark', 'dtw', 'btw', 'ttg', 'xte'], 'a mark with Pro off: the passage block alone');
  P.waypoint = null; step(); assert.equal(on(), false, 'the mark cleared: empty');
  // v2 has no edge instruments row (owner, 2026-11-17): a stored value from v1's row is not read, the column follows Pro
  P.store.edgeInstruments = 'always'; step();
  assert.equal(on(), false, 'a stale "always" with Pro off: still empty (the column follows Pro)');
  P.store.edgeInstruments = 'off'; P.setPro(true); step();
  assert.deepEqual(shown(P.col.el), ['cog', 'tws', 'twa', 'gap0', 'vmg', 'heel', 'rud'], 'a stale "off" with Pro on: the readings show (the owner\'s screenshot, 2026-11-17)');
  P.hud = 'instruments'; step(); assert.equal(on(), true, 'Instruments: kept');
  P.hud = 'clear'; step(); assert.equal(on(), false, 'Clear takes it'); P.hud = 'calm'; step(); assert.equal(on(), true);
  // the covers (the key legend's): the menu, the logbook, the big chart, the keys list, the binoculars
  P.services.provide('menu', { isOpen: true }); step(); assert.equal(on(), false, 'the menu'); P.services.provide('menu', { isOpen: false }); step(); assert.equal(on(), true);
  P.services.provide('logbook', { logbook: { isOpen: true } }); step(); assert.equal(on(), false, 'the logbook'); P.services.provide('logbook', { logbook: { isOpen: false } });
  P.services.get('chart').chart.toggle.big = true; step(); assert.equal(on(), false, 'the big chart'); P.services.get('chart').chart.toggle.big = false;
  P.services.get('controls').hint.current = 'keys'; step(); assert.equal(on(), false, 'the keys list'); P.services.get('controls').hint.current = 'none'; step();
  assert.equal(on(), true, 'the helm view is not a cover: the column stays (owner decision 4; the legend goes)');
  P.setPro(false); step(); assert.equal(on(), false, 'Pro off: nothing (?navcol=0|1: v2/tests/pages/navColumn.page.mjs)');
  P.col.dispose(); assert.equal(P.doc.body.children.length, 0);
});

test('the wiring: the passage service is provided once (v1\'s shell order) and the column is a service; the row set is v1\'s', () => {
  const B = sailedBoat(), P = v2Page(B);
  assert.equal(typeof P.services.get('passage').sync, 'function');
  assert.equal(P.services.get('navColumn'), P.col);
  const passage = P.services.get('passage');
  mountNav({ services: P.services, settings: { get: () => 'auto' }, doc: fakeDoc(), win: { performance: { now: () => 0 }, setTimeout() {}, clearTimeout() {} } });
  assert.equal(P.services.get('passage'), passage, 'a second mount keeps the one passage service');
  assert.deepEqual(Object.keys(ROWS), ['cog', 'tws', 'twa', 'vmg', 'heel', 'rud', 'dtw', 'btw', 'ttg', 'xte']);
});
