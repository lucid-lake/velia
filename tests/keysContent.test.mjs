// The keys page and the H list say the same words from one table (src/ui/keysContent.js); every cap is a real key of src/sail/keys.js.
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESSENTIALS, GROUPS, PRO, CODE, HANDS, keysPageHtml, LIST_ROWS, PRO_ROWS } from '../src/ui/keysContent.js';
import { KEYMAP, collisions } from '../src/sail/keys.js';

const allRows = [...GROUPS.flatMap((g) => g.rows), ...PRO.rows, ...ESSENTIALS];
const strip = (s) => s.replace(/\{(?:[^|}]*\|)*([^}|]*)\}/g, '$1').replace(/<[^>]*>/g, '');

test('every cap names a real key (or a hand), and the table has no collisions', () => {
  assert.deepEqual(collisions().map(([a, b]) => `${a.code}: ${a.action} / ${b.action}`), []);
  for (const r of allRows) for (const k of r.k) {
    if (HANDS.includes(k)) continue;
    assert.ok(CODE[k], `${k} has a code`);
    assert.ok(KEYMAP.some((e) => e.code === CODE[k] || (CODE[k] === 'Equal' && e.code === 'NumpadAdd')), `${k} (${CODE[k]}) is in the key table`);
  }
});

test('the essentials are five, each with one plain verb; the rows are short; Pro is its own tab, lit while Pro is on', () => {
  assert.equal(ESSENTIALS.length, 5);
  assert.deepEqual(ESSENTIALS.map((e) => e.k.join(' ')), ['A D', 'W S', 'C', 'Esc', 'H']);
  for (const r of allRows) assert.ok(strip(r.v).split(/\s+/).length <= 5, `"${r.v}" is a short verb phrase`);
  assert.deepEqual(GROUPS.map((g) => g.title), ['Sailing', 'Views', 'The boat', 'Tools', 'Wind']);
  // the cheat card (owner, 2026-10-30: compact, no scroll): Keys | Mouse, touch | Pro trim; Keys first, the others hidden
  const off = keysPageHtml({ pro: false }), on = keysPageHtml({ pro: true });
  assert.deepEqual([...off.matchAll(/role="tab"[^>]*data-tab="(\w+)"/g)].map((m) => m[1]), ['keys', 'boat', 'hand', 'pro']);
  assert.match(off, /data-tp="keys">/); assert.match(off, /data-tp="hand" hidden>/); assert.match(off, /data-tp="boat" hidden>/); assert.match(off, /class="tab phone"/); assert.match(off, /data-tp="pro" hidden>/);
  assert.doesNotMatch(off, /class="tab lit"/); assert.match(on, /class="tab lit"[^>]*data-tab="pro"/);
  assert.equal((off.slice(0, off.indexOf('data-tp="boat"')).match(/<div class="kcol">/g) ?? []).length, 2, 'two columns on the Keys tab');
  // the first five: A D, W S and C filled once in the columns, Esc and H in the foot
  assert.equal((off.match(/caps ess/g) ?? []).length, 5);
  // every row with a mouse or touch way is on the Mouse, touch tab
  for (const r of GROUPS.flatMap((g) => g.rows).filter((x) => x.a)) assert.ok(off.includes(`<span class="ka">${r.a}</span>`), r.a);
});

test('the H list is the same table: every verb on the page is in the list, and the pro rows follow', () => {
  const list = strip(LIST_ROWS.join(' ')), proList = strip(PRO_ROWS.join(' '));
  for (const g of GROUPS) for (const r of g.rows) assert.ok(list.includes(strip(r.v)), `list says "${r.v}"`);
  for (const r of PRO.rows) assert.ok(proList.includes(strip(r.v)), `pro list says "${r.v}"`);
  assert.ok(LIST_ROWS.length >= 10 && LIST_ROWS.length <= 16, `${LIST_ROWS.length} lines`);
});

// key-cleanup (owner 2026-10-30): settings-like functions have no key; each has an on-screen path
import { readFileSync } from 'node:fs';
import { CRUISE_KEYMAP } from '../src/sail/keys.js';
import { SETTINGS } from '../src/ui/settings.js';
import { TRIM } from '../src/stations/sloop/trimPanel.js';
import { installShell } from '../classic/src/shell.js';

// Sail's real controls in node (helpers/sail-controls.mjs) under the real shell (src/shell.js: the settings, the home card's
// Settings page from index.html's loading card), built once for the tests below
const SHELL_BODY = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/ {2}<!-- lk-load:body -->[\s\S]*?<!-- lk-load:body:end -->/)[0];
let game = null;
function sailGame() {
  if (game) return game;
  const s = mountSail();
  document.body.insertAdjacentHTML('afterbegin', SHELL_BODY);
  document.documentElement.classList.add('lk-nol');   // ?noload: no loading card, the boat is up
  s.services.provide('core', { ...s.core, switchMode: async () => {} }); s.services.provide('stats', () => ({}));   // the core's api (src/main.js)
  installShell({ services: s.services, modes: { sail: async () => ({ name: 'sail' }) }, current: 'sail' });
  s.step(2);
  return (game = { s, L: window.__lakeshore, c: s.c, row: (r) => document.querySelector(`#lk-load [data-r="${r}"]`) });
}
test.after(() => game?.s.dispose());

test('removed keys: no P, T, Shift+K or Shift+J in either key table, the Keys page or the H list', () => {
  for (const t of [KEYMAP, CRUISE_KEYMAP]) {
    assert.ok(!t.some((k) => k.code === 'KeyP' || k.code === 'KeyT'), 'no P / T');
    assert.ok(!t.some((k) => (k.code === 'KeyK' || k.code === 'KeyJ') && k.shift === true), 'no Shift+K / Shift+J');
  }
  const caps = [...GROUPS.flatMap((g) => g.rows), ...PRO.rows, ...ESSENTIALS].flatMap((r) => r.k);
  for (const c of ['P', 'T', '⇧K', '⇧J']) assert.ok(!caps.includes(c), `no ${c} cap`);
  const page = strip(keysPageHtml({ pro: true })) + strip(LIST_ROWS.join(' ') + PRO_ROWS.join(' '));
  assert.doesNotMatch(page, /pro on, off|auto-reef|the crew trims|wait for/);
  // Sail's controls (controls.js, seamanship.js, the shell): P and T do nothing
  const { s, c } = sailGame();
  const snap = () => ({ pro: c.pro, crewTrim: c.crewTrim, autoReef: c.autoReef, pilot: c.pilot, view: c.view, furl: c.sea.furlWant, lever: s.phys.engine.lever, menu: window.__lakeshore.menu?.isOpen });
  const before = snap();
  for (const k of ['KeyP', 'KeyT']) { s.tap(k); s.step(3); s.tap(k, { shiftKey: true }); s.step(3); }
  assert.deepEqual(snap(), before, 'P and T change nothing');
});

test('every removed function is on screen: Settings rows, the Dawn button, the TRIM+ drawer', () => {
  assert.equal(SETTINGS.autoReef, true);
  const { s, c, L, row } = sailGame();
  // the Settings page (the home card): a "sailing" row (basic | pro), "crew trims" and "auto-reef" (on | off)
  const set = (k) => document.querySelector(`#lk-load .set[data-set=${k}]`);
  assert.equal(set('sailing')?.querySelector('.k').textContent, 'sailing');
  for (const [k, rs] of [['sailing', ['pro:basic', 'pro:pro']], ['crewTrim', ['crewTrim:on', 'crewTrim:off']], ['autoReef', ['autoReef:on', 'autoReef:off']]])
    assert.deepEqual(set(k).querySelectorAll('[data-r]').map((b) => b.dataset.r), rs, `${k}: ${rs.join(' | ')}`);
  // a click acts on the live boat: the shell's settings reach the controls
  row('autoReef:off').click(); assert.equal(L.settings.get('autoReef'), false); assert.equal(c.autoReef, false, 'auto-reef off'); assert.equal(c.ctl.autoReef, false, 'the physics\' auto-reef off');
  row('autoReef:on').click(); assert.equal(c.ctl.autoReef, true, 'and on');
  row('crewTrim:off').click(); assert.equal(c.crewTrim, false, 'the crew trims: off');
  row('crewTrim:on').click(); assert.equal(c.crewTrim, true, 'on');
  row('pro:pro').click(); assert.equal(c.pro, true, 'sailing: pro');
  row('pro:basic').click(); assert.equal(c.pro, false, 'sailing: basic');
  // the Dawn button: a dock item with no key, shown only anchored (held) after dark; it waits for the sunrise
  const dock = L.dock, sea = c.sea, tk = sea.tackle, sun = s.core.sun;
  assert.equal(dock.spec('dawn')?.key, '', 'no key');
  const vis = (mode, phase, elev) => { tk.state.mode = mode; tk.state.anchor.phase = phase; sun.elevationDeg = elev; return dock.visible('dawn'); };
  assert.equal(vis('free', 'stowed', -5), false, 'sailing at night: no Dawn');
  assert.equal(vis('anchor', 'down', -5), false, 'the anchor not yet holding');
  assert.equal(vis('anchor', 'held', 10), false, 'at anchor by day');
  assert.equal(vis('anchor', 'held', -5), true, 'at anchor after dark: Dawn');
  dock.run('dawn');
  assert.ok(sea.waking && sea.waking.hour > 24, 'a press waits for the next sunrise');
  // the pro trim panel (replaces the TRIM+ drawer, owner 2026-10-30): every pro control has its hardware, shown only in Pro;
  // the panel's TRIM button is the same switch
  assert.deepEqual(TRIM.map((t) => t.id).sort(), ['backstay', 'jibLead', 'traveller', 'twist', 'vhf', 'wing']);
  // the cockpit (a desktop, stage 2): the PRO recess is the trim's hardware; its PRO button is the same switch (the grid keeps the panel)
  const cockpit = L.station?.rects?.form === 'cockpit', trimUp = () => (cockpit ? c.proRecess.shown : c.trimPanel.shown);
  s.step(2); assert.equal(trimUp(), false, 'basic: no trim hardware');
  dock.run('pro'); s.step(2); assert.equal(c.pro, true, 'TRIM: pro on'); assert.equal(trimUp(), true, 'pro: the trim hardware');
  if (cockpit) assert.equal(c.trimPanel.shown, false, 'the cockpit: no floating trim panel over it');
  document.querySelector(cockpit ? '.lk-pro .c[data-id=pro]' : '.lk-cp .c[data-id=pro]').click(); s.step(2);
  assert.equal(c.pro, false, 'the PRO (TRIM) button: pro off'); assert.equal(trimUp(), false);
});

test('one row per key set (fix/tack-wind: A/D was listed twice, "steer" and "turn through the wind"); the tack has its own row', () => {
  for (const g of GROUPS) { const ks = g.rows.map((r) => r.k.join(' ')); assert.equal(new Set(ks).size, ks.length, `${g.title}: ${ks.join(' | ')}`); }
  const sailing = GROUPS.find((g) => g.id === 'sailing').rows;
  assert.equal(sailing.filter((r) => r.k.join(' ') === 'A D').length, 1);
  const tack = sailing.find((r) => r.k[0] === 'Space');
  assert.ok(tack && /tack/.test(tack.v) && /Tack button/.test(tack.a), 'Space: tack, the Tack button');
  assert.ok(KEYMAP.some((k) => k.code === 'Space' && /tack/.test(k.action)));
});
