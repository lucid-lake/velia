// The ship's clock in the top bar (src/ui/shipClock.js): "4 Jul · 21:45" (24-hour, no weekday), the map's date per day
// choice, and the bar's readout following the game's hour (never the wall clock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shipClock, widest, minuteOfDay } from '../src/ui/shipClock.js';
import { makePlace } from '../src/sim/place.js';
import { pickDay } from '../src/sim/day.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
import { SETTINGS } from '../src/ui/settings.js';
import { installDom, memStorage } from './helpers/dom-helm.mjs';

const dateOf = (choice) => makePlace(CURRENT_WATERS, pickDay(CURRENT_WATERS, choice)).date;

test('the words: day, month, 24-hour time, zero-padded, no weekday, no am / pm', () => {
  const r = shipClock({ hour: 21.75, date: '2026-07-04' });
  assert.equal(r.full, '4 Jul · 21:45');
  assert.equal(r.time, '21:45');
  assert.equal(r.label, '4 July, 21:45');
  assert.equal(shipClock({ hour: 0, date: '2026-07-04' }).time, '00:00');
  assert.equal(shipClock({ hour: 6.5, date: '2026-07-04' }).full, '4 Jul · 06:30');
  assert.equal(shipClock({ hour: 12, date: '2026-07-04' }).time, '12:00');
  assert.equal(shipClock({ hour: 23.9999, date: '2026-07-04' }).time, '23:59');
  assert.doesNotMatch(shipClock({ hour: 15, date: '2026-07-04' }).full, /Sat|am|pm/i);
});

test('minute resolution: the minute that has begun; wraps; unknown hour reads nothing', () => {
  assert.equal(minuteOfDay(9.7499), 9 * 60 + 44);
  assert.equal(minuteOfDay(9.75), 9 * 60 + 45);
  assert.equal(minuteOfDay(24.5), 30);   // an unwrapped hour past midnight
  assert.equal(minuteOfDay(-0.25), 23 * 60 + 45);
  assert.equal(shipClock({ hour: null, date: '2026-07-04' }), null);
  assert.equal(shipClock({ hour: NaN, date: '2026-07-04' }), null);
});

test('the date is the map\'s day: 4 Jul by default, 15 Jun on ?day=normal, any ISO date', () => {
  assert.equal(shipClock({ hour: 18.75, date: dateOf(null) }).full, '4 Jul · 18:45');
  assert.equal(shipClock({ hour: 18.75, date: dateOf('highlight') }).full, '4 Jul · 18:45');
  assert.equal(shipClock({ hour: 18.75, date: dateOf('normal') }).full, '15 Jun · 18:45');
  assert.equal(shipClock({ hour: 9, date: dateOf('2026-12-25') }).full, '25 Dec · 09:00');
});

test('the widest reading reserves the bar\'s width: no other reading is longer', () => {
  assert.equal(widest({ date: '2026-07-04' }).full, '4 Jul · 20:59');
  for (let h = 0; h < 24; h += 0.25) assert.ok(shipClock({ hour: h, date: '2026-07-04' }).full.length <= widest({ date: '2026-07-04' }).full.length);
});

test('Settings has no clock row: 24-hour is the only format', () => {
  assert.equal('clock24' in SETTINGS, false);
});

test('the bar reads the game\'s hour, writes only when the minute changes, hides with no hour', async () => {
  const dom = installDom();
  const { createViewSwitch } = await import('../src/ui/viewSwitch.js');
  const FS = { supported: () => true, active: () => false, on() {}, toggle() {} };
  let hour = 21.75, none = false;
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: memStorage(), once: true, modality: () => 'mouse', fullscreen: FS,
    clock: { hour: () => (none ? null : hour), date: () => '2026-07-04' } });
  vs.update(0.1);
  const tx = () => vs.el.querySelector('.clk .tx')?.textContent;
  assert.equal(tx(), '4 Jul · 21:45');
  assert.equal(vs.el.querySelector('.clk .gh')?.textContent, '4 Jul · 20:59');
  hour = 21.76; vs.update(0.1); assert.equal(tx(), '4 Jul · 21:45', 'same minute: same words');
  hour = 21.7667; vs.update(0.1); assert.equal(tx(), '4 Jul · 21:46');
  for (let i = 0; i < 60; i++) { hour += 0.0167; vs.update(0.016); }   // a time-lapse: the minutes only count up
  assert.match(tx(), /^4 Jul · 21:(4\d|5\d)$|^4 Jul · 22:\d\d$/);
  none = true; vs.update(0.1); assert.equal(vs.el.querySelector('.clk').hidden, true, 'no hour yet: no readout');
  vs.dispose(); dom.uninstall();
});
