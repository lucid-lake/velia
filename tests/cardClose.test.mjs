// The shared close path of the cards over the world (src/ui/cardClose.js): a press outside closes the card and is eaten
// whole; a press inside does not; Esc closes when asked. The home card and the logbook both close this way: the home card
// here on a stub DOM (tests/helpers/home-mount.mjs), the logbook in a real browser (tests/pages/logbookClose.page.mjs).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeOnOutside, OUTSIDE } from '../src/ui/cardClose.js';
import { mountHome } from './helpers/home-mount.mjs';

function bus() {
  const L = new Map();
  return { addEventListener: (t, f) => { (L.get(t) ?? L.set(t, new Set()).get(t)).add(f); }, removeEventListener: (t, f) => L.get(t)?.delete(f),
    fire(type, extra = {}) { const ev = { type, target: 'water', stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...extra }; for (const f of L.get(type) ?? []) f(ev); return ev; },
    count: () => [...L.values()].reduce((n, s) => n + s.size, 0) };
}

test('a press outside closes the card and is eaten whole (down, up, click); the next press is free', () => {
  const b = bus(); let open = true, closed = 0;
  closeOnOutside({ isOpen: () => open, inside: (t) => t === 'card', close: () => { closed++; open = false; }, target: b });
  const down = b.fire('pointerdown'); assert.equal(closed, 1); assert.ok(down.stopped && down.prevented, 'the press is not passed on');
  for (const t of ['touchstart', 'mousedown', 'pointerup', 'mouseup']) assert.ok(b.fire(t).stopped, t + ' eaten');
  assert.ok(b.fire('click').stopped, 'click eaten');
  assert.equal(b.fire('pointerdown').stopped, false, 'closed: the next press goes to the world');
});

test('a press inside the card does nothing', () => {
  const b = bus(); let closed = 0;
  closeOnOutside({ isOpen: () => true, inside: (t) => t === 'card', close: () => closed++, target: b });
  const ev = b.fire('pointerdown', { target: 'card' });
  assert.equal(closed, 0); assert.equal(ev.stopped, false);
  assert.equal(b.fire('click', { target: 'card' }).stopped, false);
});

test('Esc closes only when asked, only while open, never on a repeat or with a modifier', () => {
  for (const [esc, open, extra, want] of [[true, true, {}, 1], [true, false, {}, 0], [false, true, {}, 0], [true, true, { repeat: true }, 0], [true, true, { metaKey: true }, 0]]) {
    const b = bus(); let closed = 0;
    closeOnOutside({ isOpen: () => open, inside: () => false, close: () => closed++, esc, target: b });
    b.fire('keydown', { code: 'Escape', key: 'Escape', ...extra });
    assert.equal(closed, want, JSON.stringify({ esc, open, extra }));
  }
});

test('the returned off() removes every listener', () => {
  const b = bus(); const off = closeOnOutside({ isOpen: () => true, inside: () => false, close() {}, esc: true, target: b });
  assert.equal(b.count(), OUTSIDE.length + 1); off(); assert.equal(b.count(), 0);
});

test('the home card closes the same way: a press outside eats the whole press (down, up, click) and closes it; Esc goes through its own back-a-page first', async (t) => {
  const c = await mountHome({ clock: t, state: 'gone' });
  const water = c.D.document.createElement('canvas'); c.D.document.body.appendChild(water);
  const world = []; for (const t of OUTSIDE) water.addEventListener(t, () => world.push(t));
  c.home.open();
  const inside = c.D.press(c.q('.lk-word'));
  assert.equal(c.home.isOpen, true, 'a press inside the card does nothing');
  assert.ok(!inside.some((e) => e.prevented), 'and is not cancelled');
  const ev = ['pointerdown', 'touchstart', 'mousedown', 'pointerup', 'mouseup', 'click'].map((t) => c.D.fire(water, t));   // a tap's sequence
  assert.equal(c.home.isOpen, false, 'a press outside closes it');
  assert.deepEqual(world, [], 'the water never sees the press that closed it');
  assert.ok(ev.every((e) => e.stopped), 'down, up and click all stop');
  assert.ok(ev.filter((e) => e.type !== 'touchstart').every((e) => e.prevented));
  c.D.press(water);
  assert.deepEqual(world, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'], 'closed: the next press goes to the world');
  // Esc: a page first steps back (the card's own Esc), then the card closes; one Esc never does both
  t.mock.timers.tick(500);   // the close's fade
  c.home.open(); c.home.show('settings', false);
  c.D.key('Escape'); assert.deepEqual([c.home.view, c.home.isOpen], ['home', true]);
  c.D.key('Escape'); assert.equal(c.home.isOpen, false);
  c.home.dispose();
  assert.equal(c.D.press(water)[0].stopped, false, 'dispose removes its listeners');
});
