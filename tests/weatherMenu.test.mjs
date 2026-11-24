// The weather menu (src/weather/weatherMenu.js) and its button in the top bar (src/ui/viewSwitch.js).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherMenu, WEATHER, WEATHER_ROWS } from '../src/sim/weather/weatherMenu.js';
import { strikesBetween, FRONT, ARC, rainbowEnv } from '../src/sim/weather/stormArc.js';
import { installDom, memStorage } from './helpers/dom-helm.mjs';

// a storm that records what the menu asks of it
const stubStorm = () => {
  const calls = [];
  const s = { running: false, calls,
    start(o) { calls.push(['start', o]); s.running = true; },
    choose(w) { calls.push(['choose', w]); },
    stop() { calls.push(['stop']); s.running = false; } };
  return s;
};

test('three rows in order, short words; a page starts Fair', () => {
  assert.deepEqual(WEATHER_ROWS.map((r) => r.name), ['Clear', 'Fair', 'Storm']);
  const sky = weatherMenu({ storm: stubStorm(), deck: { value: 0.6 } });
  assert.deepEqual(sky.rows.map((r) => r.id), ['clear', 'fair', 'storm']);
  assert.equal(sky.current(), 'fair'); assert.equal(sky.choice, 'fair');
});

test('Storm starts the arc at stormS0 with an ease-in, once; the row is Storm while it runs', () => {
  const storm = stubStorm(), sky = weatherMenu({ storm, deck: { value: 0.6 } });
  assert.equal(sky.pick('storm'), 'storm');
  assert.deepEqual(storm.calls, [['start', { s0: WEATHER.stormS0, easeS: WEATHER.easeS }]]);
  assert.equal(sky.current(), 'storm');
  sky.pick('storm');
  assert.equal(storm.calls.length, 1, 'a second tap does not restart a running storm');
  assert.equal(sky.choice, 'fair', 'the sky under the storm is still the one chosen before it');
});

test('the landing second: just ahead of the gust front, the first lightning within 10 s (default seed), the rainbow still to come', () => {
  const s0 = WEATHER.stormS0;
  assert.ok(s0 >= ARC.front[0] && s0 < FRONT.atS, 'inside the front phase, before the front crosses');
  assert.ok(FRONT.atS - s0 <= 10, `the front within 10 s (${FRONT.atS - s0})`);
  const first = strikesBetween(1, s0, s0 + 10, [0, 0])[0];
  assert.ok(first, 'a strike in the first 10 s');
  assert.ok(first.s - s0 > 1.5, 'after the ease-in, so its flash is at full strength');
  assert.equal(rainbowEnv(s0), 0);
  assert.ok(rainbowEnv(s0 + 138) > 0.99, 'the rainbow is full 138 s after the tap');
});

test('Clear or Fair during a storm sends it away by its own path, once; the pick is the sky after it', () => {
  const storm = stubStorm(), sky = weatherMenu({ storm, deck: { value: 0.6 } });
  sky.pick('storm');
  assert.equal(sky.pick('clear'), 'clear');
  assert.deepEqual(storm.calls.at(-1), ['choose', 'fair']);
  assert.equal(sky.current(), 'clear', 'the row follows the pick while the storm clears');
  sky.pick('fair');
  assert.equal(storm.calls.filter((c) => c[0] === 'choose').length, 1, 'a clearing storm is not asked twice');
  assert.equal(sky.current(), 'fair');
  sky.pick('storm');
  assert.equal(storm.calls.at(-1)[0], 'start', 'Storm again while it clears starts it over');
  assert.equal(sky.current(), 'storm');
});

test('Cruise lands the storm earlier: a build-up first, no strike for 20 s, the front 35 s out; null puts Sail\'s second back', () => {
  const storm = stubStorm(), sky = weatherMenu({ storm, deck: { value: 0.6 } });
  assert.equal(sky.stormS0, WEATHER.stormS0);
  sky.stormS0 = WEATHER.cruiseS0;
  sky.pick('storm');
  assert.deepEqual(storm.calls, [['start', { s0: WEATHER.cruiseS0, easeS: WEATHER.easeS }]]);
  const s0 = WEATHER.cruiseS0;
  assert.ok(s0 >= ARC.build[0] && s0 < ARC.build[1], 'inside the build phase');
  assert.ok(FRONT.atS - s0 >= 30 && FRONT.atS - s0 <= 60, `the front 30 to 60 s after the pick (${FRONT.atS - s0})`);
  const first = strikesBetween(1, s0, FRONT.atS + 10, [0, 0])[0];
  assert.ok(first && first.s - s0 >= 20 && first.s < FRONT.atS, `the first lightning 20 s or more after the pick, before the front (${first?.s})`);
  assert.equal(rainbowEnv(s0 + 140), 0); assert.ok(rainbowEnv(s0 + 165) > 0.99, 'the rainbow is full 165 s after the pick');
  sky.stormS0 = null;
  assert.equal(sky.stormS0, WEATHER.stormS0);
});

test('a storm that ends on its own leaves the sky chosen before it', () => {
  const storm = stubStorm(), sky = weatherMenu({ storm, deck: { value: 0.6 } });
  sky.pick('clear'); sky.pick('storm');
  assert.equal(sky.current(), 'storm');
  storm.running = false;
  assert.equal(sky.current(), 'clear');
});

test('the deck eases to the chosen sky at WEATHER.rate, never a cut, and stops on the value', () => {
  const deck = { value: 0.6 }, sky = weatherMenu({ storm: stubStorm(), deck });
  sky.update(0);
  sky.pick('clear');
  sky.update(0.1);
  assert.ok(Math.abs(deck.value - (0.6 - WEATHER.rate * 0.1)) < 1e-12);
  sky.update(5);   // a long frame counts as 0.1 s at most
  assert.ok(Math.abs(deck.value - (0.6 - WEATHER.rate * 0.2)) < 1e-12);
  for (let t = 5; t < 20; t += 0.1) sky.update(t);
  assert.equal(deck.value, WEATHER.clear);
  sky.pick('fair');
  for (let t = 20; t < 40; t += 0.1) sky.update(t);
  assert.equal(deck.value, 0.6, 'Fair is the deck as the page started it');
  sky.pick('cloudy');
  for (let t = 40; t < 60; t += 0.1) sky.update(t);
  assert.equal(deck.value, WEATHER.cloudy);
});

test('a page that started with a thin or a thick deck: Clear never adds cloud, Cloudy never thins it', () => {
  const thin = { value: 0.1 }, a = weatherMenu({ deck: thin });
  a.pick('clear'); for (let t = 0; t < 10; t += 0.1) a.update(t);
  assert.equal(thin.value, 0.1);
  const thick = { value: 0.9 }, b = weatherMenu({ deck: thick });
  b.pick('cloudy'); for (let t = 0; t < 10; t += 0.1) b.update(t);
  assert.equal(thick.value, 0.9);
});

test('unknown ids and a page with no storm or no deck do nothing', () => {
  const sky = weatherMenu({});
  assert.equal(sky.pick('fog'), null); assert.equal(sky.pick('storm'), null);
  assert.equal(sky.pick('clear'), 'clear'); sky.update(1); sky.update(2);
  assert.equal(sky.current(), 'clear');
});

test('the bar: a Weather button after Wind, its symbol the weather now; the menu opens, lights the current row, picks and closes', async () => {
  const dom = installDom();
  const { createViewSwitch, WEATHER_ICONS } = await import('../src/ui/viewSwitch.js');
  const FS = { supported: () => true, active: () => false, on() {}, toggle() {} };
  const picked = []; let now = 'fair';
  const api = { rows: WEATHER_ROWS.map(({ id, name }) => ({ id, name })), current: () => now, pick: (id) => { picked.push(id); now = id; } };
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: memStorage(), once: true, modality: () => 'mouse', fullscreen: FS,
    clock: { hour: () => 15, date: () => '2026-07-04' },
    clockMenu: { rows: [{ id: 'night', name: 'Night' }], current: () => null, pick() {} },
    weatherMenu: api });
  vs.update(0.1);
  const xt = vs.el.querySelectorAll('.xt').map((b) => b.dataset.x);
  assert.equal(xt.indexOf('weather'), xt.indexOf('wind') + 1, 'next to Wind');
  const btn = vs.el.querySelector('.xt[data-x=weather]');
  const menus = vs.el.querySelectorAll('.lk-timepick');
  const menu = menus.find((m) => m.querySelectorAll('button').some((b) => b.dataset.id === 'storm'));
  const timeMenu = menus.find((m) => m !== menu);
  assert.ok(btn && menu && timeMenu, 'the button, its menu, and the clock menu of the same class');
  assert.equal(btn.dataset.wx, 'fair'); assert.equal(btn.getAttribute('aria-label'), 'Weather · Fair');
  assert.equal(menu.hidden, true); assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(menu.querySelectorAll('button').map((b) => b.dataset.id), ['clear', 'fair', 'storm']);
  for (const b of menu.querySelectorAll('button')) assert.ok(b.innerHTML.includes('<svg'), `${b.dataset.id} has its symbol`);
  btn.click();
  assert.equal(menu.hidden, false); assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(menu.querySelectorAll('button').filter((b) => b.classList.contains('on')).map((b) => b.dataset.id), ['fair']);
  menu.querySelectorAll('button').find((b) => b.dataset.id === 'storm').click();
  assert.deepEqual(picked, ['storm']); assert.equal(menu.hidden, true, 'a pick closes it');
  vs.update(0.1);
  assert.equal(btn.dataset.wx, 'storm'); assert.equal(btn.getAttribute('aria-label'), 'Weather · Storm');
  assert.ok(btn.querySelector('svg').innerHTML.includes('M12.9 11.2 10 15.9') && WEATHER_ICONS.storm.includes('M12.9 11.2 10 15.9'), 'the button wears the storm (its bolt)');
  btn.click();
  assert.deepEqual(menu.querySelectorAll('button').filter((b) => b.classList.contains('on')).map((b) => b.dataset.id), ['storm']);
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true, 'Escape closes');
  btn.click(); dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, true, 'a press outside closes');
  btn.click(); vs.el.querySelector('button.clk').click();
  assert.equal(menu.hidden, true, 'one menu at a time'); assert.equal(timeMenu.hidden, false);
  btn.click();
  assert.equal(timeMenu.hidden, true); assert.equal(menu.hidden, false);
  now = 'clear'; vs.update(0.1);
  assert.equal(btn.dataset.wx, 'clear', 'a change from Setup shows on the bar');
  assert.deepEqual(menu.querySelectorAll('button').filter((b) => b.classList.contains('on')).map((b) => b.dataset.id), ['clear']);
  vs.dispose(); dom.uninstall();
});

test('the bar without a weather menu has no Weather button', async () => {
  const dom = installDom();
  const { createViewSwitch } = await import('../src/ui/viewSwitch.js');
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: memStorage(), once: true, modality: () => 'mouse' });
  assert.equal(vs.el.querySelector('.xt[data-x=weather]'), null);
  vs.dispose(); dom.uninstall();
});

test('holdClear (the staged first minute, R0): Clear at once whatever the pick, then eases back to the pick', () => {
  const deck = { value: 0.6 };
  const sky = weatherMenu({ deck });
  sky.holdClear(true);
  assert.equal(deck.value, WEATHER.clear, 'no ease in: the first frame is clear');
  for (let t = 0; t < 30; t += 0.1) sky.update(t);
  assert.equal(deck.value, WEATHER.clear, 'held while Fair is the pick');
  assert.equal(sky.current(), 'fair', 'the row still says the pick');
  sky.holdClear(false);
  for (let t = 30; t < 32; t += 0.1) sky.update(t);
  assert.ok(deck.value > WEATHER.clear && deck.value < 0.6, 'easing back, never a cut');
  for (let t = 32; t < 50; t += 0.1) sky.update(t);
  assert.equal(deck.value, 0.6);
});
