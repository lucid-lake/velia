// The clock's menu (src/ui/timeMenu.js, the top bar's clock button): five rows, each row's hour, the lit row,
// Fireworks starting the show (or the share link where there is none), and the bar's open / close behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TimeOfDay } from '../src/sim/timeOfDay.js';
import { timeMenu, TIME_ROWS, rowFor, FIREWORKS_LEAD_H } from '../src/ui/timeMenu.js';
import { SHOW_START_HOUR } from '../src/fireworks/show.js';
import { installDom, memStorage } from './helpers/dom-helm.mjs';

const mk = (hour = 15, extra = {}) => {
  const clock = new TimeOfDay({ hour, rate: 20, t0: 0 });
  let simT = 100; const calls = [];
  const fw = { phase: 'before', invite: () => calls.push('invite') };
  const m = timeMenu({ clock, simT: () => simT, hour: () => clock.hourOfDay(simT), fireworks: () => extra.noShow ? null : fw, search: () => '?day=normal', go: (q) => calls.push(`go ${q}`), ...extra.o });
  return { clock, m, calls, fw, simT: () => simT, tick: (s) => { simT += s; } };
};

test('five rows in order, short words', () => {
  assert.deepEqual(TIME_ROWS.map((r) => r.name), ['Dawn', 'Midday', 'Golden hour', 'Night', 'Fireworks']);
  assert.deepEqual(mk().m.rows.map((r) => r.id), ['dawn', 'midday', 'golden', 'night', 'fireworks']);
});

test('each time row puts the clock on its hour, always ahead (never back in time)', () => {
  const want = { dawn: 5.6, midday: 13, golden: 19.25, night: 22.5 };
  for (const [id, h] of Object.entries(want)) {
    for (const from of [3, 9, 15, 23]) {
      const { clock, m, simT } = mk(from);
      const before = clock.hourAt(simT());
      assert.equal(m.pick(id), 'time');
      assert.ok(Math.abs(clock.hourOfDay(simT()) - h) < 1e-9, `${id} from ${from}: ${clock.hourOfDay(simT())}`);
      assert.ok(clock.hourAt(simT()) > before, 'the unwrapped hour only grows');
    }
  }
});

test('the lit row is the one that matches now; mid-morning, afternoon and dusk match none; the show wins', () => {
  assert.equal(rowFor(5.6), 'dawn'); assert.equal(rowFor(13), 'midday'); assert.equal(rowFor(19.25), 'golden'); assert.equal(rowFor(22.5), 'night');
  assert.equal(rowFor(0.5), 'night'); assert.equal(rowFor(9), null); assert.equal(rowFor(17), null); assert.equal(rowFor(20.4), null);
  assert.equal(rowFor(21.8, 'show'), 'fireworks'); assert.equal(rowFor(21, 'lapse'), 'fireworks'); assert.equal(rowFor(13, 'before'), 'midday');
  const { m, clock, fw, tick } = mk(13);
  assert.equal(m.current(), 'midday');
  m.pick('night'); assert.equal(m.current(), 'night');
  fw.phase = 'show'; assert.equal(m.current(), 'fireworks');
  void clock; void tick;
});

test('Fireworks: the clock to 10 game s before the first shell and the evening invited; no show on the page: the share link', () => {
  const a = mk(15);
  assert.equal(a.m.pick('fireworks'), 'show');
  assert.ok(Math.abs(a.clock.hourOfDay(a.simT()) - (SHOW_START_HOUR - FIREWORKS_LEAD_H)) < 1e-9);
  assert.deepEqual(a.calls, ['invite']);
  const b = mk(15, { noShow: true });
  const h0 = b.clock.hourOfDay(b.simT());
  assert.equal(b.m.pick('fireworks'), 'share');
  assert.equal(b.clock.hourOfDay(b.simT()), h0, 'no jump: the page reloads on the show\'s day');
  assert.equal(b.calls.length, 1); assert.match(b.calls[0], /^go \?.*show=fireworks/);
  const c = mk(15, { o: { fireworksGo: () => 'trip' } });   // Cruise: its own button
  assert.equal(c.m.pick('fireworks'), 'trip'); assert.deepEqual(c.calls, []);
});

test('the clock button opens the menu, a row picks and closes it, Escape and a press outside close it', async () => {
  const dom = installDom();
  const { createViewSwitch } = await import('../src/ui/viewSwitch.js');
  const FS = { supported: () => true, active: () => false, on() {}, toggle() {} };
  const picked = []; let now = 'golden';
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: memStorage(), once: true, modality: () => 'mouse', fullscreen: FS,
    clock: { hour: () => 19.5, date: () => '2026-07-04' },
    clockMenu: { rows: TIME_ROWS.map(({ id, name }) => ({ id, name })), current: () => now, pick: (id) => picked.push(id) } });
  vs.update(0.1);
  const btn = vs.el.querySelector('button.clk'), menu = vs.el.querySelector('.lk-timepick');
  assert.ok(btn && menu, 'the clock is a button with a menu beside it');
  assert.equal(menu.hidden, true, 'closed by default'); assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.querySelectorAll('button').length, 5);
  btn.click();
  assert.equal(menu.hidden, false); assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const lit = menu.querySelectorAll('button').filter((b) => b.classList.contains('on')).map((b) => b.dataset.id);
  assert.deepEqual(lit, ['golden'], 'the matching row is lit');
  btn.click(); assert.equal(menu.hidden, true, 'a second click closes');
  btn.click();
  menu.querySelectorAll('button').find((b) => b.dataset.id === 'night').click();
  assert.deepEqual(picked, ['night']); assert.equal(menu.hidden, true, 'a pick closes it');
  btn.click(); dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true, 'Escape closes');
  btn.click(); dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, true, 'a press outside closes');
  btn.click(); now = null; vs.update(0.1);
  assert.deepEqual(menu.querySelectorAll('button').filter((b) => b.classList.contains('on')), [], 'no row matches: none lit');
  vs.dispose(); dom.uninstall();
});
