// LOG on v2's card (fix(v2): LOG, owner 2026-11-13: "click Log button nothing happen"): v1's home card (src/ui/home.js) with
// front.js's links (logLinks) on the stub DOM and the real loading-shell markup. Until Sail's logbook is up LOG is v1's quiet
// italic "in Sail" and does nothing; once it is (ui/logbook.js provides Sail's 'logbook' service) LOG is lit, the card closes
// first (from home: ENTER's hand-off) and the logbook opens, as v1's shell; an open logbook takes Esc first. The browser half:
// v2/tests/pages/logbook.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHome } from '../../tests/helpers/home-mount.mjs';
import { logLinks } from '../ui/front.js';
import { createServices } from '../../src/sim/core/services.js';

test('LOG: "in Sail" until the logbook is up; then lit, and a press closes the card and opens the logbook', async (t) => {
  let ui = null;
  const links = logLinks(() => ui);
  const c = await mountHome({ state: 'home', clock: t, ...links });
  const log = c.q('.lk-link[data-go=logbook]');
  assert.ok(log, 'the card has LOG');
  c.home.paint();
  assert.equal(log.getAttribute('aria-disabled'), 'true'); assert.equal(log.title, 'in Sail'); assert.equal(log.style.fontStyle, 'italic');
  // Sail's UI up, but no logbook yet: still off; a press does nothing
  ui = { services: createServices() };
  c.home.paint();
  c.D.press(log); t.mock.timers.tick(800); await c.D.settle();
  assert.equal(c.log.entering, 0, 'a disabled LOG does not enter');
  // the logbook up (ui/logbook.js provides it): lit, no tooltip
  const opened = [];
  const book = { isOpen: false, open() { opened.push(1); this.isOpen = true; } };
  ui.services.provide('logbook', { logbook: book });
  c.home.paint();
  assert.equal(log.getAttribute('aria-disabled'), 'false'); assert.equal(log.title, ''); assert.equal(log.style.fontStyle, '');
  // a press from the home card: the card goes (ENTER's hand-off), then the logbook opens (v1's 700 ms)
  c.D.press(log);
  assert.equal(c.log.entering, 1, 'the card closes first');
  t.mock.timers.tick(699); assert.equal(opened.length, 0);
  t.mock.timers.tick(2); assert.equal(opened.length, 1, 'then the logbook opens');
  assert.equal(links.escFirst(), true, 'an open logbook takes Esc first');
  book.isOpen = false; assert.equal(links.escFirst(), false);
  assert.equal(links.can.chart(), true, 'CHART is always live (owner 2026-11-17); its go opens the enlarged chart once mounted');
  const tg = { pinned: false, shown: false, pin() { this.pinned = true; }, unpin() { this.pinned = false; } };
  ui.services.provide('chart', { chart: { toggle: tg } });
  links.go.chart(); assert.deepEqual([tg.shown, tg.pinned], [true, true], 'CHART pins the enlarged chart, as the top bar does');
  links.go.chart(); assert.equal(tg.pinned, false, 'and a second press unpins it');
});

test('LOG in play: the Menu card closes and the logbook opens (v1\'s 60 ms)', async (t) => {
  const opened = [];
  const ui = { services: createServices() };
  ui.services.provide('logbook', { logbook: { isOpen: false, open() { opened.push(1); } } });
  const c = await mountHome({ state: 'gone', clock: t, ...logLinks(() => ui) });   // in play (the card gone)
  c.home.open();
  assert.equal(c.home.isOpen, true, 'the in-play Menu card is up');
  c.home.paint();
  c.D.press(c.q('.lk-link[data-go=logbook]'));
  t.mock.timers.tick(61);
  assert.equal(opened.length, 1, 'the logbook opens');
  t.mock.timers.tick(600); await c.D.settle();
  assert.equal(c.home.isOpen, false, 'the Menu card closed');
});
