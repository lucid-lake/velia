// node --test tests/binoToggle.test.mjs — B is the binoculars' toggle, the same as the dock's icon (owner, 2026-11-12:
// "click B should be same as mouse left click, i.e can stay in that mode, right now I have to hold B"). Sail's live
// controls in node (helpers/sail-controls.mjs); Cruise and Regatta share the one listener (src/sail/captainTools.js).
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tools = (s) => s.services.get('captainTools');

test('B: a press and release leaves the glasses up; a second press lowers them', () => {
  const s = mountSail();
  try {
    const t = tools(s);
    s.step(2);
    assert.equal(t.latched, false, 'down at the start');
    s.key('KeyB'); s.step(2); s.key('KeyB', false);
    assert.equal(t.latched, true, 'B latches them up');
    s.step(60);   // 2 s
    assert.equal(t.latched, true, 'the key up did not lower them');
    assert.ok(t.k > 0.99, `fully raised after 2 s (k ${t.k})`);
    s.key('KeyB'); s.key('KeyB', false); s.step(30);
    assert.equal(t.latched, false, 'B again lowers them');
    assert.ok(t.k < 0.01, `lowered (k ${t.k})`);
  } finally { s.dispose(); }
});

test('B: one press toggles once; a held key repeating, a dock or pad stand-in key, a modifier or a text field do not', () => {
  const s = mountSail();
  try {
    const t = tools(s);
    s.key('KeyB');
    for (let i = 0; i < 5; i++) s.key('KeyB', true, { repeat: true });
    s.key('KeyB', false);
    assert.equal(t.latched, true, 'the repeats of a held B change nothing');
    s.tap('KeyB', { lkDock: true }); s.tap('KeyB', { lkVirtual: true });
    assert.equal(t.latched, true, 'stand-in keys change nothing');
    s.tap('KeyB', { metaKey: true }); s.tap('KeyB', { ctrlKey: true });
    assert.equal(t.latched, true, 'Cmd+B, Ctrl+B change nothing');
    const field = document.createElement('input'); document.body.appendChild(field); field.focus();
    s.tap('KeyB');
    assert.equal(t.latched, true, 'typing B in a field changes nothing');
    field.blur(); field.remove();
    s.tap('KeyB');
    assert.equal(t.latched, false, 'a plain B lowers them');
  } finally { s.dispose(); }
});

test('B and the dock icon are one toggle; Escape lowers them; the mouse aims without a drag', () => {
  const s = mountSail();
  try {
    const t = tools(s), dock = s.services.get('dock');
    const click = () => dock.spec('binoculars').action();
    click(); assert.equal(t.latched, true, 'the icon raises them');
    s.tap('KeyB'); assert.equal(t.latched, false, 'B lowers what the icon raised');
    s.tap('KeyB'); assert.equal(t.latched, true, 'B raises them');
    click(); assert.equal(t.latched, false, 'the icon lowers what B raised');
    s.tap('KeyB'); s.tap('Escape'); assert.equal(t.latched, false, 'Escape lowers them');
    s.tap('KeyB'); s.step(30);
    const y0 = t.bino.yaw;
    for (let i = 0; i < 5; i++) { dispatchEvent(new Event('mousemove', { movementX: 40, movementY: 0 })); s.step(1); }
    assert.notEqual(t.bino.yaw, y0, 'a plain mouse move aims while latched');
  } finally { s.dispose(); }
});
