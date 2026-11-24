// The loading page's words and hold (v2/ui/loadWords.js; owner, 2026-11-21): the hold lifts only when the
// card's layout is there and a phone's advice has stood its time; the advice's words fit a sideways phone; a phone gets it by the profile.
// No lake fact under the stage caption (2026-11-24): the facts are the chart's (v2/tests/chart-fact.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdDone, adviceLines, installLoadWords, ADVICE, ADVICE_MIN_MS, HOLD_MAX_MS, HOLD_LINE, FIRST_MS } from '../ui/loadWords.js';
import { installDom, shellBody } from '../../tests/helpers/dom-card.mjs';

test('the hold: lifts once the map card is set (or none will come), never before a phone\'s advice stood ADVICE_MIN_MS, always by HOLD_MAX_MS', () => {
  assert.equal(holdDone({ mapSet: false, homeAt: 0, now: 1000 }), false, 'no layout yet: the old card stays hidden');
  assert.equal(holdDone({ mapSet: true, homeAt: 0, now: 1000 }), true, 'the panel or the phone card is there');
  assert.equal(holdDone({ mapSet: false, waitMap: false, homeAt: 0, now: 0 }), true, '?livechart=0: no map comes, no hold');
  assert.equal(holdDone({ mapSet: true, adviceAt: 0, now: ADVICE_MIN_MS - 1, homeAt: 0 }), false, 'a fast phone load: the advice is not flashed');
  assert.equal(holdDone({ mapSet: true, adviceAt: 0, now: ADVICE_MIN_MS, homeAt: 0 }), true);
  assert.equal(holdDone({ mapSet: false, adviceAt: 0, homeAt: 100, now: 100 + HOLD_MAX_MS }), true, 'a map that never comes never keeps the card away');
});

test('the words: the advice names the Home Screen and a computer (the app: the computer alone), each line 60 characters or fewer', () => {
  assert.match(adviceLines().join(' '), /Home Screen/); assert.match(adviceLines().join(' '), /computer/);
  assert.doesNotMatch(adviceLines({ standalone: true }).join(' '), /Home Screen/); assert.match(adviceLines({ standalone: true }).join(' '), /computer/);
  for (const l of [...ADVICE.tab, ...ADVICE.app, HOLD_LINE]) assert.ok(l.length <= 60, `${l} (${l.length})`);
  assert.doesNotMatch([...ADVICE.tab, ...ADVICE.app, HOLD_LINE].join(' '), /Calm|steady horizon|Lakeshore/);
});

test('the line under the stage caption: no lake fact on a desktop or a phone; a phone gets its advice plate alone', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const phone of [false, true]) {
    installDom({ body: shellBody(new URL('../', import.meta.url)) });
    const root = document.getElementById('lk-load'); root.dataset.state = 'company';
    const w = installLoadWords({ root, phone, waitMap: true });
    assert.ok(w, 'installed on the shell\'s progress line');
    t.mock.timers.tick(FIRST_MS + 12000);
    const words = [...root.querySelectorAll('.lk-prog p')].map((p) => p.className);
    const extra = words.filter((c) => !/lk-psay|lk-padv/.test(c));
    assert.deepEqual(extra, [], `${phone ? 'phone' : 'desktop'}: nothing but the caption and the advice (${words})`);
    assert.equal(words.some((c) => /lk-padv/.test(c)), phone, 'the advice: a phone only');
    assert.equal('fact' in w.state(), false, 'no fact in the words\' state');
    w.dispose();
  }
});

// the policy (loadPhoneAdvice: a phone only, by the profile's form) is in features.test.mjs's six-device table, beside phoneCard
