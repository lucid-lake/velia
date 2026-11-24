// The PRO recess's pure parts (src/stations/sloop/proRecess.js; owner 2026-11-06, the cockpit's stage 2): the four sliders map the controls'
// own values (src/boat.js PRO) onto the track and back, VANG reads the twist from the vang's side, and a step stays on the track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRO_SLIDERS, PRO_BUTTONS, PRO_TOOLS, PRO_ROWS, proLayout, fOf, valueOf, stepF, demoNudge, demoAllowed, DEMO, DEMO_S } from '../src/stations/sloop/proRecess.js';
import { COCKPIT } from '../classic/src/stations/sloop/cockpit3d.js';

const S = Object.fromEntries(PRO_SLIDERS.map((t) => [t.id, t]));

test('the recess carries the four trim controls and PRO (look C3), the 3D and the hit layer naming the same parts; BINOS and VHF are the tools', () => {
  assert.deepEqual(PRO_SLIDERS.map((t) => t.id), COCKPIT.pro.sliders.map(([id]) => id));
  assert.deepEqual(PRO_BUTTONS.map(([id]) => id), COCKPIT.pro.buttons.map(([id]) => id));
  assert.deepEqual(COCKPIT.pro.sliders.map(([, w]) => w), ['TRAVELLER', 'JIB LEAD', 'VANG', 'BACKSTAY']);
  assert.deepEqual(COCKPIT.pro.buttons.map(([, w]) => w), ['PRO']);
  assert.deepEqual(PRO_TOOLS.map(([id]) => id), ['binoculars', 'radio']);
  assert.deepEqual(PRO_ROWS, [['traveller', 'jibLead'], ['vang', 'backstay']], 'a 2 x 2 grid; PRO a toggle in its own column');
  assert.deepEqual(PRO_SLIDERS.map((t) => t.key), ['traveller', 'jibLead', 'twist', 'backstay'], 'the controls\' own values');
});

test('a value and its car: the ends, the middle, null at the middle, out of range clamped; and back', () => {
  assert.equal(fOf(S.traveller, -1), 0); assert.equal(fOf(S.traveller, 1), 1); assert.equal(fOf(S.traveller, 0), 0.5); assert.equal(fOf(S.traveller, null), 0.5);
  assert.equal(fOf(S.backstay, 0), 0); assert.equal(fOf(S.backstay, 1), 1); assert.equal(fOf(S.backstay, 3), 1);
  for (const t of PRO_SLIDERS) for (const f of [0, 0.25, 0.5, 1]) assert.ok(Math.abs(fOf(t, valueOf(t, f)) - f) < 1e-9, `${t.id} ${f}`);
});

test('VANG: more vang, less twist (the car right is the twist closed)', () => {
  assert.equal(valueOf(S.vang, 1), -1); assert.equal(valueOf(S.vang, 0), 1); assert.equal(fOf(S.vang, -1), 1);
});

test('a step is a twentieth of the track, snapped, and never leaves it', () => {
  assert.equal(stepF(0.5, 1), 0.55); assert.equal(stepF(0.5, -1), 0.45); assert.equal(stepF(0.98, 1), 1); assert.equal(stepF(0.01, -1), 0);
});

test('the hit rects (look C3): every target ≥ 44 px, none over another, each slider\'s drag ends inside its cell, closed one cover', () => {
  for (const [H, k] of [[1080, 1], [720, 2 / 3], [1440, 4 / 3]]) {   // a desktop's shares (a phone has its own lens: tests/pages/cockpitPhone)
    const at = (x, y) => ({ x: x * k, y: y * k });
    const pts = { 'p:r0': at(470, 992), 'p:r1': at(770, 1078), 'p:g0': at(540, 1012), 'p:traveller:a': at(555, 1012), 'p:traveller:b': at(635, 1012), 'p:jibLead:a': at(675, 1010), 'p:jibLead:b': at(755, 1010),
      'p:btn:pro': at(505, 1030), 'p:vang:a': at(555, 1048), 'p:vang:b': at(635, 1048), 'p:backstay:a': at(675, 1046), 'p:backstay:b': at(755, 1046), binos: at(430, 1035), vhf: at(1470, 1035) };
    const r = proLayout(pts, { H });
    const ids = ['traveller', 'jibLead', 'pro', 'vang', 'backstay', 'binoculars', 'radio'];
    for (const id of ids) assert.ok(r[id].w >= 44 && r[id].h >= 44, `${H}: ${id} ${r[id].w}x${r[id].h}`);
    for (const p of ids) for (const q of ids) if (p < q) {
      const A = r[p], B = r[q], ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      assert.ok(ox <= 0 || oy <= 0, `${H}: ${p} over ${q}`);
    }
    for (const id of ['traveller', 'jibLead', 'vang', 'backstay']) assert.ok(r[id].a >= r[id].x && r[id].b <= r[id].x + r[id].w, `${H}: ${id}'s drag inside its cell`);
    assert.ok(r.pro.y === r.traveller.y && r.pro.y + r.pro.h === r.vang.y + r.vang.h && r.pro.x + r.pro.w === r.traveller.x, `${H}: PRO's toggle a column the height of both rows, beside the grid`);
    assert.ok(r.traveller.x === r.vang.x && r.jibLead.x === r.backstay.x && r.traveller.w === r.vang.w, `${H}: the grid's columns aligned`);
    assert.ok(r.cover.w > 0 && r.cover.h >= 44);
  }
});

test('the one quiet demo (look/pro-sliders): about 1 s in all, staggered, a little way toward the middle and back, still at both ends', () => {
  assert.ok(DEMO_S > 0.8 && DEMO_S <= 1.1, `${DEMO_S} s`);
  for (let i = 0; i < PRO_SLIDERS.length; i++) {
    const t0 = DEMO.stagger * i;
    assert.equal(demoNudge(t0, i), 0, 'still at its start'); assert.equal(demoNudge(t0 + DEMO.each, i), 0, 'back where it was');
    assert.equal(demoNudge(t0 - 0.01, i), 0); assert.equal(demoNudge(DEMO_S + 0.01, i), 0, 'nothing after the demo');
    assert.ok(Math.abs(demoNudge(t0 + DEMO.each / 2, i, 0.2) - DEMO.amp) < 1e-9, 'its peak: a little way');
    assert.ok(demoNudge(t0 + DEMO.each / 2, i, 0.9) < 0, 'a car past the middle slides left: it stays on its track');
    assert.ok(Math.abs(demoNudge(t0 + 0.01, i, 0.2)) < 0.01, 'eased in: no snap');
  }
  assert.ok(DEMO.amp <= 0.25, 'a little way, not the whole track');
  // staggered: at one moment the cars stand at different places
  const t = DEMO.stagger * 1.5 + 0.1, xs = PRO_SLIDERS.map((_, i) => demoNudge(t, i, 0.2));
  assert.equal(new Set(xs.map((x) => x.toFixed(4))).size, PRO_SLIDERS.length);
});

test("the demo plays only on a person's first PRO open of a session: never headless, golden, film, automated or with reduced motion", () => {
  const mem = (v) => ({ getItem: () => v, setItem() {} });
  assert.equal(demoAllowed({ storage: mem(null) }), true);
  assert.equal(demoAllowed({ storage: mem('1') }), false, 'once a session');
  for (const flags of [{ headless: '1' }, { golden: true }, { film: true }]) assert.equal(demoAllowed({ flags, storage: mem(null) }), false, JSON.stringify(flags));
  assert.equal(demoAllowed({ webdriver: true, storage: mem(null) }), false, 'Playwright pages and the goldens');
  assert.equal(demoAllowed({ reduced: true, storage: mem(null) }), false, 'prefers-reduced-motion');
  assert.equal(demoAllowed({ storage: { getItem() { throw new Error('blocked'); } } }), false, 'no storage: no demo (it could repeat)');
  assert.equal(demoAllowed({ flags: { prodemo: '1' }, webdriver: true, storage: mem('1') }), true, '?prodemo=1 forces it (the review shots)');
  assert.equal(demoAllowed({ flags: { prodemo: '0' }, storage: mem(null) }), false);
});
