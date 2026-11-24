// The play-test session log (src/ui/playtest.js): opt-in, local, privacy-safe. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, createWatcher, playtestOn, downloadSession, TYPES, SCHEMA, MAX_EVENTS } from '../src/ui/playtest.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const clock = () => { let t = 100; const f = () => t; f.set = (v) => { t = 100 + v; }; return f; };

test('opt-in: only ?playtest=1 turns it on', () => {
  assert.equal(playtestOn('?playtest=1'), true);
  for (const q of ['', '?playtest=0', '?playtest=true', '?mode=sail']) assert.equal(playtestOn(q), false, q);
});

test('recorder: events carry seconds since the start and only allowed fields; unknown types are dropped', () => {
  const now = clock(), st = store(), rec = createRecorder({ storage: st, now });
  now.set(12.34);
  rec.log('hint', { name: 'steer', keys: 'WASD typed text', email: 'a@b.c' });
  assert.equal(rec.log('keystroke', { text: 'hello' }), null);
  assert.deepEqual(rec.events, [{ t: 12.3, type: 'hint', name: 'steer' }]);
  const saved = JSON.parse(st.getItem('lakeshore.playtest.v1'));
  assert.equal(saved.schema, SCHEMA); assert.equal(saved.events.length, 1);
});

test('recorder: strings are cut and cleaned; no field can carry free text or a long value', () => {
  const rec = createRecorder({ now: clock() });
  rec.log('page', { name: '<script>alert(1)</script>' + 'x'.repeat(100) });
  const n = rec.events[0].name; assert.ok(n.length <= 24); assert.ok(!/[<>()/]/.test(n));
  for (const [type, fields] of Object.entries(TYPES)) assert.ok(!fields.some((f) => /text|key|email|name_|pos|^x$|^z$/.test(f)) || type === 'page' || type === 'hint', type);
});

test('recorder: capped, and a failing store does not break it', () => {
  const rec = createRecorder({ storage: { setItem() { throw new Error('full'); } }, now: clock() });
  for (let i = 0; i < MAX_EVENTS + 50; i++) rec.log('menu_open');
  assert.equal(rec.events.length, MAX_EVENTS);
});

test('watcher: a session timeline — play, mode, hints, skills, tacks, grounding, anchor, island, menus; summary times', () => {
  const now = clock(), rec = createRecorder({ now }), w = createWatcher(rec, { island: { x: 0, z: 0, r: 200 } });
  let T = 0;
  const f = (o) => { T += 1; now.set(T); w.frame({ t: T, mode: 'sail', ...o }); };
  f({ ui: 'company' }); f({ ui: 'home' }); f({ ui: 'home' });
  f({ ui: 'gone', twa: 0.9, x: 900, z: 0, depth: 20 });                       // Enter: play at 4
  f({ ui: 'gone', twa: 0.9, hint: 'steer', x: 800, z: 0, depth: 20 });         // a hint
  w.skill('steering');
  f({ ui: 'gone', twa: -0.9, x: 700, z: 0 });                                  // through the wind: tack 1
  f({ ui: 'gone', twa: -0.05, x: 650, z: 0 });                                 // in irons: no event
  f({ ui: 'gone', twa: 0.8, x: 600, z: 0 });                                   // 1 s later: too soon, ignored (no double count)
  for (let i = 0; i < 5; i++) f({ ui: 'gone', twa: 0.8 });
  f({ ui: 'gone', twa: -0.8, depth: 20 });                                     // tack 2
  f({ ui: 'gone', twa: -2.5, depth: 1.0 });                                    // a grounding
  f({ ui: 'gone', twa: -2.5, depth: 0.8 });                                    // still aground: once
  f({ ui: 'gone', twa: -2.5, depth: 9, anchored: true });                      // anchor down
  f({ ui: 'gone', x: 120, z: 90 });                                            // inside the island ring
  f({ ui: 'gone', x: 100, z: 0, logbook: true }); f({ ui: 'gone', logbook: false, chart: true });
  f({ ui: 'menu', page: 'home' }); f({ ui: 'menu', page: 'settings' }); f({ ui: 'gone', mode: 'cruise' });
  const ty = rec.events.map((e) => e.type);
  assert.deepEqual(ty.filter((t) => t === 'play').length, 1);
  assert.equal(ty.filter((t) => t === 'tack').length, 2);
  assert.equal(ty.filter((t) => t === 'gybe').length, 0);
  assert.equal(ty.filter((t) => t === 'grounding').length, 1);
  assert.deepEqual(rec.events.filter((e) => e.type === 'anchor').map((e) => e.down), [true]);
  assert.deepEqual(rec.events.filter((e) => e.type === 'mode'), [{ t: rec.events.find((e) => e.type === 'mode').t, type: 'mode', from: 'sail', to: 'cruise' }]);
  for (const t of ['hint', 'skill', 'island', 'menu_open', 'menu_close', 'logbook_open', 'chart_open', 'page']) assert.equal(ty.filter((x) => x === t).length, 1, t);
  const s = rec.export().summary;
  assert.equal(s.playStartS, 4); assert.equal(s.timeToFirstTackS, 2); assert.ok(s.timeToIslandS > s.timeToFirstTackS);
  assert.equal(s.tacks, 2); assert.equal(s.groundings, 1); assert.equal(s.anchorDowns, 1); assert.equal(s.menuOpens, 1);
});

test('watcher: nothing from the boat is recorded before Enter; a gybe is not a tack', () => {
  const now = clock(), rec = createRecorder({ now }), w = createWatcher(rec);
  w.frame({ t: 1, mode: 'sail', ui: 'home', twa: 0.9, depth: 0.2, anchored: true });
  w.frame({ t: 9, mode: 'sail', ui: 'home', twa: -0.9, depth: 0.2 });
  assert.equal(rec.events.length, 0);
  w.frame({ t: 10, mode: 'sail', ui: 'gone', twa: 2.6 }); w.frame({ t: 20, mode: 'sail', ui: 'gone', twa: -2.6 });
  assert.deepEqual(rec.events.map((e) => e.type), ['play', 'gybe']);
});

test('export: JSON file download, no network (a Blob, an anchor click, a revoke)', () => {
  const rec = createRecorder({ now: clock() }); rec.log('play');
  const made = []; let blobText = '', revoked = null;
  const doc = { createElement: () => { const a = { style: {}, click() { made.push(a); }, remove() {} }; return a; }, body: { appendChild() {} } };
  class B { constructor(parts, o) { blobText = parts[0]; this.type = o.type; } }
  const url = downloadSession(rec, { doc, Blob: B, URLApi: { createObjectURL: () => 'blob:x', revokeObjectURL: (u) => { revoked = u; } } });
  assert.equal(url, 'blob:x'); assert.equal(made[0].download, 'velia-session.json');
  const j = JSON.parse(blobText); assert.equal(j.schema, SCHEMA); assert.equal(j.events[0].type, 'play');
});

test('privacy: a whole session (record, watch, save, export) touches no network API, no navigator and no cookie', () => {
  // trap every way a module could talk to a server or read the browser; each touch is recorded
  const touched = [], trap = (name) => () => { touched.push(name); throw new Error(`${name} touched`); };
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator'];
  const saved = Object.fromEntries(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { touched.push(n); return new Proxy(function () {}, { get: (_, k) => trap(`${n}.${String(k)}`), apply: trap(n), construct: trap(`new ${n}`) }); } });
  const cookieDoc = { get cookie() { touched.push('document.cookie'); return ''; }, set cookie(v) { touched.push('document.cookie='); },
    createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
  try {
    playtestOn(); playtestOn('?playtest=1');
    const st = store(), now = clock(), rec = createRecorder({ storage: st, now });
    for (const type of Object.keys(TYPES)) rec.log(type, Object.fromEntries(TYPES[type].map((f) => [f, 'x'])));
    const w = createWatcher(rec, { island: { x: 0, z: 0, r: 200 } });
    for (let i = 0; i < 40; i++) { now.set(i); w.frame({ t: i, mode: 'sail', ui: i < 3 ? 'home' : i > 30 ? 'menu' : 'gone', page: 'settings', twa: i % 10 < 5 ? 0.9 : -0.9, x: 400 - i * 10, z: 0, depth: i === 20 ? 0.5 : 9, anchored: i > 25, hint: 'steer', logbook: i === 28, chart: i === 29 }); }
    w.skill('steering');
    rec.export();
    const url = downloadSession(rec, { doc: cookieDoc, Blob: class { constructor(p) { this.p = p; } }, URLApi: { createObjectURL: () => 'blob:y', revokeObjectURL() {} } });
    assert.equal(url, 'blob:y');
    assert.ok(rec.events.length > 10 && st.getItem('lakeshore.playtest.v1'), 'the session ran and was saved locally');
  } finally { for (const n of names) if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n]; }
  assert.deepEqual(touched, []);
});

test('the About page shows Export session only when the flag is on', async () => {
  const { pagesHtml } = await import('../src/ui/homePages.js');
  const base = { waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' };
  assert.ok(!pagesHtml(base).includes('export-session'));
  assert.ok(pagesHtml({ ...base, playtest: true }).includes('data-act="export-session"'));
  // the shell turning it on from ?playtest=1 and the button downloading the session: tests/pages/shellRows.page.mjs (retired 2026-11-18)
});
