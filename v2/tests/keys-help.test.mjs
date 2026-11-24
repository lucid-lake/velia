// The desktop key help, on the LEAN key set (owner, 2026-11-20): every key v2's handlers act on is on the Keys page
// (Menu › Keys, v2/ui/keyMap.js KEY_TABLE through src/ui/keysContent.js keysPageHtml), nothing on it is dead, Sail's table holds only the
// lean set (A D, W S, Space, C, B, Y, I + − 0, J, N, Esc, H; Pro's R F, Q E, Z X, Shift+Z X), and every removed code does nothing.
// The handlers are probed through their pure halves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_ROWS, KEY_TABLE, KEY_PRO, KEY_HANDS } from '../ui/keyMap.js';
import { keysPageHtml } from '../../src/ui/keysContent.js';
import { keyAction } from '../ui/keys.js';
import { seaKey } from '../ui/seamanship.js';
import { keysToAxes, keysToTrim } from '../sim/controls.js';
import { cruiseKind } from '../../src/sail/keys.js';
import { keyClass } from '../../src/modes/chill/intent.js';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => `Key${c}`), DIGITS = [...'0123456789'].map((d) => `Digit${d}`);
const ALL = [...LETTERS, ...DIGITS, 'Space', 'Escape', 'Backquote', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'BracketLeft', 'BracketRight',
  'Slash', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
// the handlers with no pure half, each read in its module: B (ui/captain.js), N (src/ui/chartplotter.js), H (src/ui/calmHud.js: a tap,
// on key-down), Esc (src/ui/home.js)
const LITERAL = ['KeyB', 'KeyN', 'KeyH', 'Escape'];
// Cruise's own passenger keys (cruise/index.js acts on these after keyClass says 'passenger')
const CRUISE_OWN = ['KeyC', 'KeyV', 'BracketLeft', 'BracketRight', 'KeyP'];
// what took off the keyboard: Shift+C chase, L, O, M, `, 1–4, K, G, U, ?, Shift+F, V in Sail, the H list and H+5/6/7
// G came back for the gennaker and went again the same day (round 2, owner: "this UX of G should not exist")
const REMOVED = ['KeyG', 'KeyL', 'KeyO', 'KeyM', 'Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyK', 'KeyU', 'KeyV', 'Slash', 'Digit5', 'Digit6', 'Digit7'];

function bound({ pro = true } = {}) {
  const out = new Set(LITERAL);
  for (const code of ALL) for (const shift of [false, true]) {
    const name = shift ? `Shift+${code}` : code;
    const a = keyAction({ code, shiftKey: shift });
    if (a) out.add(code === 'KeyC' ? name : code);
    if (seaKey({ code })) out.add(code);
    const ax = keysToAxes(new Set([code])); if (ax.steer || ax.pull) out.add(code);
    const tr = keysToTrim(new Set(shift ? [code, 'ShiftLeft'] : [code]), { pro }), tr0 = keysToTrim(new Set([code]), { pro });
    if (Object.values(tr).some(Boolean)) out.add(shift && JSON.stringify(tr) !== JSON.stringify(tr0) ? name : code);   // a shift that changes nothing is the plain key
    if (CRUISE_OWN.includes(code) && cruiseKind(code, shift, true) === 'passenger') out.add(code === 'KeyC' ? name : code);
  }
  return out;
}
const listed = new Set(KEY_ROWS.flatMap((r) => r.codes));

test('every key the handlers act on is on the Keys page table, and every listed key acts', () => {
  const b = bound();
  assert.deepEqual([...b].filter((c) => !listed.has(c)).sort(), [], 'bound but not listed');
  assert.deepEqual([...listed].filter((c) => !b.has(c)).sort(), [], 'listed but not bound');
  assert.ok(!listed.has('KeyP'), 'no P: Cruise drops it (CRUISE_KEYMAP has none)');
  assert.ok(!listed.has('KeyV') || KEY_ROWS.find((r) => r.codes.includes('KeyV')).modes.join() === 'cruise', 'V acts only in Cruise on v2');
});

test('Sail\'s table is the lean set, and only it', () => {
  const sail = new Set(KEY_ROWS.filter((r) => r.modes.includes('sail')).flatMap((r) => r.codes));
  const lean = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'Space', 'KeyC', 'KeyB', 'KeyY', 'KeyI',
    'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'KeyJ', 'KeyN', 'Escape', 'KeyH',
    'KeyR', 'KeyF', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'Shift+KeyZ', 'Shift+KeyX'];   // the last two rows: Pro's
  assert.deepEqual([...sail].sort(), lean.sort());
  // no chord in basic: the only Shift codes are the Pro trims'
  assert.deepEqual([...sail].filter((c) => c.startsWith('Shift+')).sort(), ['Shift+KeyX', 'Shift+KeyZ']);
  for (const r of KEY_ROWS.filter((x) => x.pro)) assert.ok(KEY_PRO.rows.includes(r), `${r.id}: a Pro row is on the Pro tab`);
});

test('the removed keys do nothing: no Sail handler, no Cruise intent, no chord', () => {
  for (const code of REMOVED) {
    for (const shift of [false, true]) {
      if (code === 'KeyV') continue;   // Cruise's own, not Sail's
      assert.equal(keyAction({ code, shiftKey: shift }), null, `keyAction ${code} ${shift}`);
    }
    assert.equal(seaKey({ code }), null, `seaKey ${code}`);
    const ax = keysToAxes(new Set([code])); assert.deepEqual(ax, { steer: 0, pull: 0 }, `axes ${code}`);
    assert.ok(Object.values(keysToTrim(new Set([code]))).every((v) => !v), `trim ${code}`);
    if (code !== 'KeyV') assert.equal(cruiseKind(code, false, true), 'none', `Cruise ${code}`);
    assert.ok(!listed.has(code) && !listed.has(`Shift+${code}`) || code === 'KeyV', `${code} is not on the Keys page`);
  }
  assert.equal(keyAction({ code: 'KeyC', shiftKey: true }), null, 'Shift+C: no chase camera in Sail');
  assert.deepEqual(keyAction({ code: 'KeyC' }), { view: 'toggle' });
  assert.equal(keyClass({ code: 'KeyK', key: 'k' }, true), 'none', 'K takes no helm in Cruise any more');
  assert.equal(keyClass({ code: 'KeyI', key: 'i' }, true), 'intent', 'I still does');
  assert.equal(cruiseKind('KeyC', true, true), 'passenger', 'Cruise keeps its own Shift+C (the previous camera)');
  assert.equal(cruiseKind('KeyV', false, true), 'passenger', 'and its V');
  assert.equal(cruiseKind('KeyK', false), 'intent', 'v1 (no lean flag) is unchanged');
});

test('R/F: the jib alone, in Pro only (basic: the jib\'s winch); W/S both sails; Space tacks', () => {
  const jib = KEY_ROWS.find((r) => r.id === 'jib');
  assert.deepEqual(jib.k, ['R', 'F']); assert.equal(jib.pro, true, 'a Pro row'); assert.match(jib.v, /jib/); assert.match(jib.v, /gennaker/, 'R/F trim whichever headsail flies (round 2)');
  assert.ok(KEY_PRO.rows.includes(jib), 'on the Pro tab');
  assert.ok(!KEY_PRO.rows.some((r) => /lead/.test(r.v)), 'no jib-lead row');
  assert.equal(keysToTrim(new Set(['KeyR']), { pro: true }).jib, 1); assert.equal(keysToTrim(new Set(['KeyF']), { pro: true }).jib, -1);
  assert.equal(keysToTrim(new Set(['KeyR']), { pro: false }).jib, 0, 'basic: R does nothing');
  assert.equal(keysToTrim(new Set(['KeyF']), { pro: false }).jib, 0, 'basic: F does nothing');
  assert.equal(keysToTrim(new Set(['KeyF']), { pro: true }).lead, 0, 'R/F never move the lead');
  assert.match(KEY_ROWS.find((r) => r.id === 'sheets').v, /both sails/);
  assert.deepEqual(keyAction({ code: 'Space' }), { tack: true });
  const auto = KEY_ROWS.find((r) => r.id === 'auto');
  assert.deepEqual(auto.codes, [], 'AUTO has no key'); assert.match(auto.g, /no key/);
});

test('every function the audit took off the keyboard has its on-screen way on the Mouse, touch tab', () => {
  const hands = new Map(KEY_HANDS.map((r) => [r.id, r]));
  for (const id of ['mark', 'jib-hand', 'reef-hand', 'wind-hand', 'moor-hand', 'log-hand', 'sound-hand', 'vhf-hand', 'cruise-hand']) {
    const r = hands.get(id); assert.ok(r, id); assert.deepEqual(r.codes, [], `${id}: no key`); assert.ok(r.a && r.v, `${id}: a way and a verb`);
  }
  assert.match(hands.get('mark').g, /NAV/, 'the mark says NAV comes next');
});

test('the page shows every row and its caps; the Pro tab carries R F; the key table has no H list', () => {
  const html = keysPageHtml({ table: KEY_TABLE });
  for (const r of KEY_ROWS) {
    assert.ok(html.includes(`data-row="${r.id}"`), `row ${r.id} on the page`);
    for (const k of r.k) assert.ok(html.includes(`data-k="${k}"`), `cap ${k} (${r.id})`);
  }
  assert.deepEqual([...html.matchAll(/role="tab"[^>]*data-tab="(\w+)"/g)].map((m) => m[1]), ['keys', 'cruise', 'hand', 'pro']);
  const proRows = KEY_PRO.rows.map((r) => r.k.join(' '));
  assert.ok(proRows.includes('R F'), 'R F on the Pro tab');
  assert.ok(!KEY_ROWS.some((r) => /^(hint|held|list|chase|wind|reef|wing|moor|log|vhf|sound)$/.test(r.id)), 'the removed rows are gone');
});
