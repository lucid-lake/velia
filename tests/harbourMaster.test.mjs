// The harbour master's calls (src/vhf/harbourMaster.js): once each, only when the moment is real, never over the radio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarbourMaster, HM_VOCAB, HM } from '../src/vhf/harbourMaster.js';
import { BY_ID, termsIn } from '../src/ui/words.js';

const KT = 0.514444;
const run = (hm, secs, o) => { const out = []; for (let i = 0; i < secs; i++) { const c = hm.step(1, typeof o === 'function' ? o(i) : o); if (c) out.push(c.id); } return out; };

test('the anchor call: only on the edge from under way to holding, once', () => {
  const hm = createHarbourMaster();
  assert.deepEqual(run(hm, 30, { anchored: false, tws: 5 }), []);
  assert.deepEqual(run(hm, 5, { anchored: true, tws: 5 }), ['hm_anchor']);
  assert.deepEqual(run(hm, 200, (i) => ({ anchored: i % 40 < 20, tws: 5 })), [], 'once per session');
  assert.deepEqual(run(createHarbourMaster(), 60, { anchored: true, tws: 5 }), [], 'a start at anchor is not an arrival');
});

test('the gust warning: a real jump over the slow mean, after the warm-up, once', () => {
  const hm = createHarbourMaster();
  assert.deepEqual(run(hm, 100, { tws: 6 * KT * 2 }), [], 'steady 12 kn: none');
  assert.deepEqual(run(hm, 3, { tws: 17 * KT }), ['hm_gust']);
  assert.deepEqual(run(createHarbourMaster(), 20, { tws: 3 }).concat(run(createHarbourMaster(), 1, { tws: 20 * KT })), [], 'inside the warm-up: none');
  assert.deepEqual(run(createHarbourMaster(), 100, (i) => ({ tws: i < 90 ? 3 * KT : 8 * KT })), [], 'a big ratio but under 12 kn: none');
});

test('an advisory day, held; calls wait for a quiet radio and sit 60 s apart', () => {
  const hm = createHarbourMaster();
  assert.deepEqual(run(hm, 7, { advisory: true }), []);
  assert.deepEqual(run(hm, 3, { advisory: true, busy: true }), [], 'the radio is talking');
  assert.deepEqual(run(hm, 2, { advisory: true }), ['hm_advisory']);
  const h2 = createHarbourMaster(); run(h2, 50, { anchored: false });
  const a = run(h2, 100, (i) => ({ anchored: i > 10, advisory: i > 5, tws: 3 }));
  assert.deepEqual(a, ['hm_anchor', 'hm_advisory'].filter((x) => a.includes(x)));
  assert.equal(a.length, 2);
});

test('the words: plain, one clip each, no exclamation mark, and every sailing term is in the table', () => {
  for (const [id, say] of Object.entries(HM_VOCAB)) {
    assert.ok(!/!/.test(say) && say.split(/\s+/).length <= 20, id);
    for (const term of termsIn(say)) assert.ok(BY_ID[term], term);
  }
  assert.ok(HM.minGapS >= 60);
});
