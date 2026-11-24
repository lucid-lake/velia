// The chart's lake fact (v2/ui/chart/chartFact.js; 2026-11-24, moved from the loading screen): the list (each 60 characters or fewer,
// plain English, every one reachable), one fact a day picked by the local date (the same all day, the next day the next, a deterministic
// page the first), a tap shows the next and never reaches the map, shown and hidden by its owner. On the stub DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, factIndex, mountChartFact } from '../ui/chart/chartFact.js';
import { LINE_MAX } from '../ui/loadFacts.js';
import { installDom } from '../../tests/helpers/dom-card.mjs';

test('the facts: six or more, each 60 characters or fewer, plain English, no internal words, none twice', () => {
  assert.ok(FACTS.length >= 6, `${FACTS.length}`);
  for (const f of FACTS) {
    assert.ok(f.length <= LINE_MAX && LINE_MAX === 60, `${f.length}: ${f}`);
    assert.match(f, /^[A-Z][A-Za-z0-9 .,'-]+\.$/, f);
    assert.doesNotMatch(f, /lakeshore|owner|v2|todo|fixme/i, f);
  }
  assert.equal(new Set(FACTS).size, FACTS.length);
});

test('one fact a day: the local date picks it, the same all day, the next day the next, every fact in turn; no date: the first', () => {
  const n = FACTS.length;
  const a = factIndex(new Date(2026, 10, 24, 0, 5)), b = factIndex(new Date(2026, 10, 24, 23, 55)), c = factIndex(new Date(2026, 10, 25, 9));
  assert.equal(a, b, 'the same all day');
  assert.equal(c, (a + 1) % n, 'the next day, the next fact');
  const seen = new Set(); for (let d = 0; d < n; d++) seen.add(factIndex(new Date(2026, 0, 1 + d)));
  assert.equal(seen.size, n, 'every fact over n days');
  assert.equal(factIndex(null), 0); assert.equal(factIndex(new Date(NaN)), 0);
  for (let d = 0; d < 40; d++) { const i = factIndex(new Date(1969, 11, 1 + d)); assert.ok(i >= 0 && i < n, `before 1970 too (${i})`); }
});

test('the line: the day\'s fact, hidden until shown, a tap the next (not the map\'s), wraps, gone on dispose', () => {
  const D = installDom({ body: '<div id="lk-load"><div class="lk-livechart"></div></div>' });
  const host = document.querySelector('.lk-livechart');
  let mapTaps = 0; host.addEventListener('click', () => mapTaps++); host.addEventListener('pointerdown', () => mapTaps++);
  const day = new Date(2026, 10, 24);
  const f = mountChartFact(host, { date: () => day });
  const el = host.querySelector('.lkc-fact');
  assert.ok(f && el && el.tagName.toLowerCase() === 'button', 'a button on the chart');
  assert.equal(el.textContent, FACTS[factIndex(day)]); assert.equal(f.text, el.textContent);
  assert.equal(el.hidden, true, 'hidden until its owner shows it (the entrance)');
  f.show(true); assert.equal(el.hidden, false); f.show(false); assert.equal(el.hidden, true); f.show(true);
  D.fire(el, 'pointerdown'); D.fire(el, 'click');
  assert.equal(el.textContent, FACTS[(factIndex(day) + 1) % FACTS.length], 'a tap: the next fact');
  assert.equal(mapTaps, 0, 'the press never reaches the map');
  for (let k = 1; k < FACTS.length; k++) D.fire(el, 'click');
  assert.equal(el.textContent, FACTS[factIndex(day)], 'round the list');
  assert.ok(document.getElementById('lk-chartfact-css'), 'its rules, once');
  f.dispose(); assert.equal(host.querySelector('.lkc-fact'), null);
  assert.equal(mountChartFact(null), null, 'no parent: nothing');
  const g = mountChartFact(host, { date: () => null }); assert.equal(g.text, FACTS[0], 'a deterministic page: the first'); g.dispose();
  const h = mountChartFact(host, { date: () => { throw new Error('no clock'); } }); assert.equal(h.text, FACTS[0], 'a clock that throws: the first'); h.dispose();
});
