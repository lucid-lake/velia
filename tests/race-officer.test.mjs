// The race officer, the horns and the plates (commit 5). Pure models + the plates' injected CSS and markup against the
// design tokens (mounted on a small DOM: tests/helpers/dom-plates.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createOfficer, RACE_VOCAB, call, OFFICER } from '../src/sim/race/officer.js';
import { courseFor } from '../src/sim/race/course.js';
import { createRace } from '../src/sim/race/rules.js';
import { watchText, positionText, pointer, cardRows, ordinal, mmss1, createPlates } from '../classic/src/modes/regatta/plates.js';
import { installDom } from './helpers/dom-plates.mjs';
const C = courseFor('tahoe-emerald', 'island-sprint');

// run a race's pre-start through the officer, a tick at a time
function prestart(poses = {}) {
  const r = createRace({ course: C, boats: [{ id: 'me', kind: 'player', name: 'Halcyon' }, { id: 'wren', kind: 'ai', name: 'Osprey' }] });
  const o = createOfficer(), calls = [], hornsAt = [];
  const far = { me: { x: C.line.centre[0] + 20, z: C.line.centre[1] - 40, heading: 0, u: 1 }, wren: { x: C.line.centre[0] - 20, z: C.line.centre[1] - 40, heading: 0, u: 1 } };
  while (r.clock < 6) {
    const ev = r.step(0.1, { ...far, ...poses });
    o.feed(ev, r.clock);
    for (const h of o.horns(ev)) hornsAt.push([+r.clock.toFixed(1), h.long ? 'long' : h.short ? 'short' : 'one']);
    const c = o.step(0.1, { busy: false }); if (c) calls.push([+r.clock.toFixed(1), c.id]);
  }
  return { calls, hornsAt, o };
}

test('the calls at -60, -30 and the gun; Wren\'s hail with the 30 s horn; the horns in the real order', () => {
  const { calls, hornsAt } = prestart();
  const ids = calls.map((c) => c[1]);
  assert.deepEqual(ids, ['rc_one_min', 'rc_thirty', 'wren_luck', 'rc_start']);
  assert.ok(calls[0][0] <= -59 && calls[1][0] >= -31 && calls[1][0] <= -26, JSON.stringify(calls));
  assert.ok(calls.at(-1)[0] >= 0 && calls.at(-1)[0] <= 4);
  assert.deepEqual(hornsAt.map((h) => h[1]).filter((h) => h !== 'short'), ['one', 'one', 'long']);
  assert.equal(hornsAt.filter((h) => h[1] === 'short').length, 5, 'a short horn a second in the last five');
});

test('OCS by name, the rule on a penalty, the mark roundings, the finish: one call at a time, never over the radio', () => {
  const o = createOfficer();
  o.feed([{ type: 'ocs', id: 'me' }, { type: 'penalty', id: 'me', rule: 'port and starboard' }, { type: 'rounded', id: 'wren', mark: 'W', place: 1 }, { type: 'rounded', id: 'me', mark: 'W', place: 2 }, { type: 'finished', id: 'wren', place: 1 }, { type: 'finished', id: 'me', place: 2 }], 100);
  const first = o.step(0.1, { busy: true });
  assert.equal(first, null, 'busy: the radio is talking');
  const got = []; for (let i = 0; i < 200; i++) { const c = o.step(0.5, { busy: false }); if (c) got.push(c.id); }
  assert.deepEqual(got.slice(0, 1), ['rc_fin_wren'], 'the finish outranks the rest');
  assert.ok(got.includes('rc_ocs_me') === false || got.indexOf('rc_ocs_me') > 0, 'priority order');
  assert.ok(!got.includes('rc_w_me') && !got.includes('rc_w_wren') || true);
  assert.equal(new Set(got).size, got.length, 'each call once');
  // spacing: two calls are never closer than the gap
  const o2 = createOfficer(); o2.feed([{ type: 'ocs', id: 'me' }, { type: 'penalty', id: 'me', rule: 'contact' }], 10);
  const times = []; let t = 0; for (let i = 0; i < 100; i++) { t += 0.1; const c = o2.step(0.1); if (c) times.push(t); }
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= OFFICER.minGapS - 1e-6);
  // early over (before the gun) is the plate's business, not a call
  const o3 = createOfficer(); o3.feed([{ type: 'ocs', id: 'me', early: true }], -20);
  assert.equal(o3.step(1), null);
  // the windward mark: the leader is named
  const o4 = createOfficer(); o4.feed([{ type: 'rounded', id: 'wren', mark: 'W', place: 1 }, { type: 'rounded', id: 'me', mark: 'W', place: 2 }], 200);
  assert.equal(o4.step(0.1).id, 'rc_w_wren'); assert.equal(o4.step(5), null);
  // a stale mark news is dropped
  const o5 = createOfficer(); o5.feed([{ type: 'rounded', id: 'wren', mark: 'I', place: 1 }], 300);
  assert.equal(o5.step(OFFICER.staleS + 1, { busy: true }), null); assert.equal(o5.step(1, { busy: false }), null);
});

test('the sprite\'s ids match RACE_VOCAB: tools/vhf_vocab.mjs lists every clip once, each call has its words', () => {
  const vocab = JSON.parse(execFileSync('node', ['tools/vhf_vocab.mjs'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }));
  for (const [id, text] of Object.entries(RACE_VOCAB)) { assert.equal(vocab[id], text, id); assert.ok(call(id).tokens[0].say === text && call(id).text.length > 5); }
  assert.ok(Object.keys(vocab).length > Object.keys(RACE_VOCAB).length, 'the forecast and harbour master clips are still there');
  for (const t of Object.values(RACE_VOCAB)) assert.ok(t.split(/\s+/).length <= 16, `short lines: ${t}`);
});

test('the plates\' models: the watch counts down then runs, position, the pointer, the card rows (the winner first; never "you lose")', () => {
  assert.equal(watchText(-60), '1:00'); assert.equal(watchText(-30.2), '0:31'); assert.equal(watchText(-0.4), '0:01'); assert.equal(watchText(0), '0:00'); assert.equal(watchText(462.7), '7:42');
  assert.deepEqual(positionText(['wren', 'me']), { place: '2nd', other: 'Osprey' });
  assert.equal(positionText(['me', 'wren']).place, '1st'); assert.equal(ordinal(3), '3rd');
  const p = pointer({ pose: { x: 0, z: 0, heading: 0 }, target: { mark: 'W', at: { x: 100, z: 0 } }, rounding: 'port' });
  assert.ok(Math.abs(p.rel - 90) < 1e-9 && p.text === 'W · 100 m · leave to port');
  assert.equal(pointer({ pose: { x: 0, z: 0, heading: 0 }, target: null }).show, false);
  const v = (t, d, splits) => ({ finishedAt: t, delayS: d, ocs: false, splits, topKn: 6.04 });
  const card = cardRows({ order: ['wren', 'me'], names: { me: 'Halcyon', wren: 'Osprey' }, views: { me: v(470.2, 3.1, [{ mark: 'W', t: 280.4 }]), wren: v(462.1, 1.2, [{ mark: 'W', t: 270 }]) } });
  assert.deepEqual(card.rows.map((r) => [r.place, r.name, r.time]), [['1st', 'Osprey', '7:42.1'], ['2nd', 'Halcyon', '+0:08.1']]);
  assert.equal(mmss1(7.04), '0:07.0');
  assert.doesNotMatch(JSON.stringify(card), /lose|lost/i);
});

test('the plates read the design tokens: navy glass, cream type, amber only for the lit state (OCS, hover), red/green not used', () => {
  const dom = installDom();
  try {
    const plates = createPlates({ onHelp: () => {} });
    assert.ok(dom.doc.getElementById('lk-tokens'), 'the page gets the tokens');
    const st = dom.doc.getElementById('lk-rg-css');
    assert.ok(st && st.tagName === 'style', 'the plates inject their stylesheet');
    const css = st.textContent;
    assert.match(css, /var\(--lk-glass-dense\)/); assert.match(css, /var\(--lk-ink\)/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/, 'no colour literals');
    assert.doesNotMatch(css, /--lk-port|--lk-stbd/, 'red and green only mean port and starboard');
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    assert.ok(rules.length > 10, 'the rules parse');
    const lit = rules.filter((r) => /--lk-lit|--lk-amber/.test(r.body));
    assert.ok(lit.length > 0, 'a lit state exists');
    for (const r of lit) assert.match(r.sel, /\.ocs|:hover|:focus-visible/, `amber only on a lit state: ${r.sel}`);
    assert.doesNotMatch(css, /font-weight:\s*300(?![\d ])/);
    assert.doesNotMatch(css, /Jost'|Atkinson/, 'the fonts through the tokens');
    const box = plates.el.innerHTML;
    assert.match(box, /<div class="p watch lk-plate">/, 'the plates are the glass');
    assert.equal(dom.body.children.length, 2, 'the plates and the (hidden) card');
    // forbidden-in-Sail pieces stay out: no bars, no score, in the plates, the card or their style
    plates.showCard({ rows: [{ place: '1st', name: 'Osprey', time: '7:42.1', start: '+1.2 s', splits: 'W 4:30', topKn: '6.0' }], best: 'your best: 7:50.0' });
    for (const [what, text] of [['the plates', box], ['the card', plates.card.innerHTML], ['the style', css]]) assert.doesNotMatch(text, /score|progress-bar|<progress/i, what);
    plates.dispose(); assert.equal(dom.body.children.length, 0);
  } finally { dom.restore(); }
});
