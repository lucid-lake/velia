// The nav column (src/ui/navColumn.js): which rows it prints in each mode, under the height budget; the strings
// (tabular, units, P/S); the hysteresis on whole degrees; when it shows; and the DOM writes only changed text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsFor, readingsOn, fmt, holdRound, createReadings, createPassageReadings, visibleColumn, budgetRows, footPx, speedText, createNavColumn, NAV, ROWS } from '../src/ui/navColumn.js';
import { EDGE } from '../src/ui/edgeStyle.js';

const D = Math.PI / 180, KN = 0.514444;
const rows = (o) => rowsFor(o).filter((id) => id !== 'gap');

test('Sail prints what the dials lack: COG, TWS, TWA, VMG, HEEL (SOG, HDG, DPT, AWA, AWS are on the dials); Pro adds RUD', () => {
  assert.deepEqual(rowsFor({ mode: 'sail' }), ['cog', 'tws', 'twa', 'gap', 'vmg', 'heel']);
  assert.deepEqual(rows({ mode: 'sail', pro: true }), ['cog', 'tws', 'twa', 'vmg', 'heel', 'rud']);
  assert.deepEqual(rows({ mode: 'school' }), rows({ mode: 'sail' }), 'School: as Sail');
  assert.deepEqual(rows({ mode: 'regatta' }), ['cog', 'tws', 'twa', 'vmg', 'heel', 'rud'], 'Regatta: the race computer, RUD always');
  for (const id of ['sog', 'hdg', 'dpt', 'awa', 'aws']) assert.equal(id in ROWS, false, `${id} is not repeated (owner decision 2)`);
  assert.deepEqual(rowsFor({ mode: 'fly' }), []);
});

test('the height budget: floor((H - foot - 140) / 36), a gap a third of a row; nothing dropped at 1080 or 720 for the six', () => {
  assert.equal(EDGE.rowPx, 36); assert.equal(NAV.rowPx, 36);
  assert.equal(Math.round(footPx(1080)), 179, 'the legend\'s foot at 1080 (measured: y 901)');
  assert.equal(Math.round(footPx(720)), 120, 'at 720 (measured: y 600)');
  assert.equal(budgetRows(1080), 21); assert.equal(budgetRows(720), 12);
  assert.deepEqual(rowsFor({ mode: 'regatta', height: 1080 }), rowsFor({ mode: 'regatta' }));
  assert.deepEqual(rowsFor({ mode: 'regatta', height: 720 }), rowsFor({ mode: 'regatta' }));
  assert.equal(rows({ mode: 'sail', height: 420 }).length < 5, true, 'a very short window drops rows from the bottom');
});

test('the strings: tabular readings with their units, P and S after the degrees', () => {
  assert.deepEqual(fmt('cog', { cog: 221 }), { num: '221', unit: '°', side: '' });
  assert.deepEqual(fmt('cog', { cog: 5 }), { num: '005', unit: '°', side: '' }, 'three digits');
  assert.equal(speedText(9.4), '9.4'); assert.equal(speedText(9.96), '10', 'no "10.0"'); assert.equal(speedText(12.3), '12', 'whole from 10 kn');
  assert.deepEqual(fmt('tws', { tws: 9.4 }), { num: '9.4', unit: 'kn', side: '' });
  assert.deepEqual(fmt('twa', { twa: -48 }), { num: '48', unit: '°', side: 'P' }, 'a negative angle: wind from port');
  assert.deepEqual(fmt('heel', { heel: 12 }), { num: '12', unit: '°', side: 'S' }, 'positive heel: to starboard');
  assert.deepEqual(fmt('vmg', { vmg: -3.62 }), { num: '3.6', unit: 'kn', side: '' }, 'never signed');
  assert.deepEqual(fmt('twa', { twa: 0 }), { num: '0', unit: '°', side: '' });
  assert.deepEqual(fmt('cog', {}), { num: '—', unit: '', side: '' }, 'no reading: a dash');
});

test('hysteresis: 220 holds through 220.4 and flips at 220.7; the compass wraps 359 -> 0 as one step', () => {
  assert.equal(holdRound(220, 220.4), 220); assert.equal(holdRound(220, 220.69), 220); assert.equal(holdRound(220, 220.7), 221);
  assert.equal(holdRound(220, 219.4), 220); assert.equal(holdRound(220, 219.3), 219);
  assert.equal(holdRound(359, 359.6, true), 359); assert.equal(holdRound(359, 0.3, true), 0, '1.3 deg on, across north');
  assert.equal(holdRound(0, 359.6, true), 0); assert.equal(holdRound(null, 359.6, true), 0, 'first reading rounds');
  // a noisy 220.5 never flickers
  let v = 220, flips = 0;
  for (let i = 0; i < 400; i++) { const n = holdRound(v, 220.5 + 0.15 * Math.sin(i * 1.7)); if (n !== v) flips++; v = n; }
  assert.equal(flips, 0);
});

test('the readings: knots from m/s, VMG = SOG cos TWA, smoothing in the data (no jumps on a gust spike)', () => {
  const r = createReadings();
  const v = r.step({ cog: 221 * D, twsMs: 9 * KN, twa: -48 * D, sogMs: 5 * KN, heel: 12 * D, rudder: 4 * D });
  assert.equal(fmt('cog', v).num, '221'); assert.equal(fmt('tws', v).num, '9.0'); assert.deepEqual(fmt('twa', v), { num: '48', unit: '°', side: 'P' });
  assert.equal(fmt('vmg', v).num, (5 * Math.cos(48 * D)).toFixed(1)); assert.deepEqual(fmt('rud', v), { num: '4', unit: '°', side: 'S' });
  const spike = r.step({ cog: 221 * D, twsMs: 20 * KN, twa: -48 * D, sogMs: 5 * KN, heel: 12 * D }, 0.25);
  assert.ok(spike.tws > 9 && spike.tws < 13, `a 0.25 s spike to 20 kn moves TWS a little (${spike.tws.toFixed(2)})`);
});

test('when it shows: the helm view and Instruments yes (numbers are not hints), Clear and the covers no; the flag and the setting', () => {
  const base = { setting: 'auto', flag: null, mode: 'sail', hud: 'calm', blocked: false, loading: false };
  assert.equal(visibleColumn(base), true);
  assert.equal(visibleColumn({ ...base, hud: 'instruments' }), true, 'Instruments: the dials and the column');
  assert.equal(visibleColumn({ ...base, helm: true }), true, 'the helm view: shown (owner decision 4)');
  assert.equal(visibleColumn({ ...base, hud: 'clear' }), false);
  assert.equal(visibleColumn({ ...base, blocked: true }), false, 'a menu, the big chart, the logbook');
  assert.equal(visibleColumn({ ...base, loading: true }), false);
  assert.equal(visibleColumn({ ...base, setting: 'off' }), false); assert.equal(visibleColumn({ ...base, setting: 'off', flag: '1' }), true);
  assert.equal(visibleColumn({ ...base, flag: '0' }), false);
  assert.equal(visibleColumn({ ...base, setting: undefined }), true, 'no setting saved yet: on');
  assert.equal(visibleColumn({ ...base, mode: 'regatta' }), true); assert.equal(visibleColumn({ ...base, mode: 'fly' }), false);
});

// a tiny DOM: createElement / appendChild / textContent only (the column never queries the document)
function fakeDoc() {
  const mk = (tag) => { const set = new Set(); const n = { tagName: tag, children: [], style: {}, dataset: {}, textContent: '', className: '', attrs: {},
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parent = this; return c; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); } };
    Object.defineProperty(n, 'className', { get: () => [...set].join(' '), set: (v) => { set.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) set.add(c); } });
    return n; };
  const head = mk('head'), body = mk('body');
  return { head, body, documentElement: mk('html'), createElement: mk, getElementById: (id) => head.children.find((c) => c.id === id) ?? null };
}

test('the DOM: an empty edge for a regular player; Pro brings the readings; a text node is written only when its string changes', () => {
  const doc = fakeDoc();
  const state = { cog: 221 * D, trueWind: { speed: 9 * KN, angle: -48 * D }, sog: 5 * KN, heel: 12 * D, rudderAngle: 0 };
  const svc = { player: { phys: { state } }, controls: { pro: false }, calm: { mode: 'calm' } };
  let t = 0; const timers = [];
  const win = { performance: { now: () => t }, innerHeight: 1080, setTimeout: (f) => timers.push(f), clearTimeout() {} };
  const set = { edgeInstruments: 'auto' };
  const col = createNavColumn({ services: { get: (k) => svc[k] }, settings: { get: (k) => set[k] }, getMode: () => 'sail', doc, win });
  col.update();
  const el = col.el, shown = () => el.children.filter((r) => !r.classList.contains('fade')).sort((a, b) => +a.style.order - +b.style.order);
  assert.equal(el.classList.contains('on'), false, 'Pro off, no mark: nothing on the left (owner, 2026-11-12)');
  assert.equal(shown().length, 0);
  svc.controls.pro = true; t += 300; col.update();
  assert.equal(el.classList.contains('lk-edgepair') && el.classList.contains('left') && el.classList.contains('on'), true, 'the shared edge style, on the left');
  assert.deepEqual(shown().map((r) => r.dataset.id), ['cog', 'tws', 'twa', 'gap0', 'vmg', 'heel', 'rud'], 'Pro on: the instruments, RUD last');
  const cell = (id) => { const r = el.children.find((c) => c.dataset.id === id); const n = r.children[1]; return { label: r.children[0].textContent, num: n.children[0].children[1], unit: n.children[1], side: n.children[2] }; };
  assert.equal(cell('cog').label, 'COG'); assert.equal(cell('cog').num.textContent, '221'); assert.equal(cell('twa').side.textContent, 'P');
  assert.equal(cell('twa').side.className, 'sd p'); assert.equal(cell('heel').side.className, 'sd s');
  const r = el.children.find((c) => c.dataset.id === 'tws'); assert.equal(r.children[1].children[0].children[0].textContent, ROWS.tws.ghost, 'the ghost box');
  let writes = 0; const numEl = cell('cog').num; let val = numEl.textContent;
  Object.defineProperty(numEl, 'textContent', { get: () => val, set: (v) => { writes++; val = v; } });
  t += 300; col.update(); t += 300; col.update();
  assert.equal(writes, 0, 'unchanged readings write nothing');
  state.cog = 223 * D; t += 300; col.update();
  assert.equal(writes, 1); assert.equal(val, '223');
  // always: the instruments with Pro off; off: nothing
  svc.controls.pro = false; set.edgeInstruments = 'always'; t += 300; col.update();
  assert.deepEqual(shown().map((r2) => r2.dataset.id), ['cog', 'tws', 'twa', 'gap0', 'vmg', 'heel']);
  set.edgeInstruments = 'off'; t += 300; col.update();
  assert.equal(el.classList.contains('on'), false);
  set.edgeInstruments = 'always'; svc.calm.mode = 'clear'; t += 300; col.update();
  assert.equal(el.classList.contains('on'), false, 'Clear: the block goes'); assert.equal(shown().length, 0);
  col.dispose(); assert.equal(doc.body.children.length, 0);
});

test('auto (the default): the instruments only with Pro on and in Regatta; always and off force them; never in Cruise', () => {
  assert.equal(readingsOn({ mode: 'sail' }), false, 'a regular player: no instrument rows');
  assert.equal(readingsOn({ mode: 'sail', pro: true }), true);
  assert.equal(readingsOn({ mode: 'school' }), false);
  assert.equal(readingsOn({ mode: 'regatta' }), true, 'the race computer');
  assert.equal(readingsOn({ mode: 'sail', setting: 'always' }), true); assert.equal(readingsOn({ mode: 'regatta', setting: 'off' }), false);
  assert.equal(readingsOn({ mode: 'cruise', pro: true, setting: 'always' }), false, 'Cruise: the passage block only');
  assert.deepEqual(rowsFor({ mode: 'sail', readings: false }), [], 'Pro off, no mark: an empty edge');
  assert.deepEqual(rowsFor({ mode: 'sail', readings: false, passage: true }), ['mark', 'dtw', 'btw', 'ttg', 'xte'], 'Pro off, a mark: the passage block alone');
});

test('the passage block: only with a mark; no ETA (the bar\'s clock has game time); the budget drops XTE, then BTW', () => {
  assert.deepEqual(rowsFor({ mode: 'sail', passage: true }), ['cog', 'tws', 'twa', 'gap', 'vmg', 'heel', 'gap', 'mark', 'dtw', 'btw', 'ttg', 'xte']);
  assert.equal(rowsFor({ mode: 'sail', passage: true }).includes('eta'), false); assert.equal('eta' in ROWS, false);
  assert.deepEqual(rows({ mode: 'regatta', passage: true }).slice(6), ['mark', 'dtw', 'btw', 'ttg']);
  assert.deepEqual(rowsFor({ mode: 'sail', pro: true, passage: true, height: 1080 }), rowsFor({ mode: 'sail', pro: true, passage: true }), '1080: nothing dropped');
  assert.deepEqual(rowsFor({ mode: 'sail', pro: true, passage: true, height: 720 }), rowsFor({ mode: 'sail', pro: true, passage: true }), '720: Pro and a mark fit');
  // shrink the window: XTE goes first, then BTW, and only then the bottom rows
  let seen = [];
  for (let h = 720; h > 400; h -= 4) {
    const r = rows({ mode: 'sail', pro: true, passage: true, height: h });
    for (const id of ['xte', 'btw', 'ttg', 'dtw']) if (!r.includes(id) && !seen.includes(id)) seen.push(id);
  }
  assert.deepEqual(seen.slice(0, 2), ['xte', 'btw']);
});

test('the passage strings: DTW nm, BTW three digits, TTG min, XTE with its side (none at 0.00)', () => {
  const v = { dtw: 1.234, btw: 38, ttg: 14.2, xte: 0.021, xteSide: 'P' };
  assert.deepEqual(fmt('dtw', v), { num: '1.2', unit: 'nm', side: '' }); assert.deepEqual(fmt('btw', v), { num: '038', unit: '°', side: '' });
  assert.deepEqual(fmt('ttg', v), { num: '14', unit: 'min', side: '' }); assert.deepEqual(fmt('xte', v), { num: '0.02', unit: 'nm', side: 'P' });
  assert.deepEqual(fmt('xte', { xte: 0.001, xteSide: 'P' }), { num: '0.00', unit: 'nm', side: '' });
  assert.deepEqual(fmt('ttg', { ttg: null }), { num: '—', unit: '', side: '' }, 'no closing speed');
});

test('the passage readings: TTG smoothed over 10 s, BTW held', () => {
  const p = createPassageReadings();
  let v = p.step({ dtw: 1, btw: 10.4, ttgMin: 12, xte: 0, side: '' });
  assert.equal(v.ttg, 12); assert.equal(v.btw, 10);
  v = p.step({ dtw: 1, btw: 10.6, ttgMin: 30, xte: 0, side: '' }, 1);
  assert.ok(v.ttg > 12 && v.ttg < 14, `a 1 s jump to 30 min moves TTG a little (${v.ttg.toFixed(2)})`); assert.equal(v.btw, 10, 'held');
  assert.equal(p.step(null), null);
});

test('Cruise: nothing at rest; with a mark the passage block only (MARK, DTW, TTG); on a phone too', () => {
  const base = { setting: 'auto', flag: null, mode: 'cruise', hud: 'calm', blocked: false, loading: false };
  assert.equal(visibleColumn(base), false, 'no mark: nothing on the left');
  assert.equal(visibleColumn({ ...base, target: true }), true);
  assert.deepEqual(rowsFor({ mode: 'cruise' }), []);
  assert.deepEqual(rowsFor({ mode: 'cruise', passage: true }), ['mark', 'dtw', 'ttg']);
  assert.deepEqual(rowsFor({ mode: 'cruise', passage: true, phone: true }), ['mark', 'dtw', 'ttg']);
  assert.deepEqual(rowsFor({ mode: 'regatta', passage: true, height: 720 }).slice(-4), ['mark', 'dtw', 'btw', 'ttg'], 'Regatta at 720: the next mark fits');
});

test('the setting: Setup › Aids › edge instruments: auto (default) | always | off, saved, nothing else taken', async () => {
  const { SETTINGS, createSettings, EDGE_INSTRUMENTS } = await import('../src/ui/settings.js');
  assert.equal(SETTINGS.edgeInstruments, 'auto'); assert.deepEqual(EDGE_INSTRUMENTS, ['auto', 'always', 'off']);
  const m = new Map(), storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const s = createSettings({ storage }); s.set('edgeInstruments', 'off'); s.set('edgeInstruments', true); s.set('edgeInstruments', 'on');
  assert.equal(createSettings({ storage }).get('edgeInstruments'), 'off');
  assert.equal(visibleColumn({ setting: 'off', mode: 'sail' }), false); assert.equal(visibleColumn({ setting: 'off', flag: '1', mode: 'sail' }), true);
});

test('phones: TWS, VMG, HEEL with the instruments on, DTW and TTG with a mark (the circle prints HDG, SOG, DPT); no height budget', () => {
  assert.deepEqual(rowsFor({ mode: 'sail', phone: true }), ['tws', 'vmg', 'heel']);
  assert.deepEqual(rowsFor({ mode: 'sail', phone: true, passage: true, pro: true }), ['tws', 'vmg', 'heel', 'gap', 'dtw', 'ttg'], 'Pro adds nothing more on a phone');
  assert.deepEqual(rowsFor({ mode: 'sail', phone: true, readings: false, passage: true }), ['dtw', 'ttg'], 'a regular player with a mark');
  assert.deepEqual(rowsFor({ mode: 'sail', phone: true, readings: false }), []);
  assert.deepEqual(rowsFor({ mode: 'regatta', phone: true, passage: true }), ['tws', 'vmg', 'heel', 'gap', 'dtw', 'ttg']);
});
