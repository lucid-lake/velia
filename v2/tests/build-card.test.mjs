// The phone's card while the shaders build (v2/ui/buildCard.js, v2/ui/loadFacts.js; owner 2026-11-17: "while loading show more info
// on the phone to hold the user"): the facts and tips list, the stage line and percentage following the gate, the modes dimmed until
// it opens, a new line every FACT_MS, nothing on a gate that is off. On the stub DOM with the real shell markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, TIPS, LINES, LINE_MAX } from '../ui/loadFacts.js';
import { mountBuildCard, FACTS_KEY, firstLine, FACT_MS } from '../ui/buildCard.js';
import { createBuildGate } from '../engine/buildGate.js';
import { installDom, shellBody } from '../../tests/helpers/dom-card.mjs';
import { memStorage } from '../../tests/helpers/home-mount.mjs';

test('the facts and tips: each 60 characters or fewer, English, no internal names, every one shown in turn', () => {
  assert.ok(FACTS.length >= 6 && TIPS.length >= 6);
  for (const l of LINES) {
    assert.ok(l.length <= LINE_MAX, `${l.length}: ${l}`);
    assert.match(l, /^[A-Za-z0-9 .,'?⋯:-]+$/, `plain English: ${l}`);
    assert.match(l, /^[A-Z]/); assert.match(l, /[.?]$/);
    assert.doesNotMatch(l, /lakeshore|owner|\(owner|v2|pipeline|shader|todo|fixme/i, l);
  }
  assert.equal(new Set(LINES).size, LINES.length, 'no line twice');
  for (const f of FACTS) assert.ok(LINES.includes(f)); for (const t of TIPS) assert.ok(LINES.includes(t));
});

test('the card: stage, percentage and line follow the gate; the modes dimmed until it opens; onReady once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  installDom({ body: shellBody() });
  const root = document.getElementById('lk-load'); root.dataset.state = 'home';
  const gate = createBuildGate().configure({ on: true });
  let ready = 0;
  const storage = memStorage();
  const c = mountBuildCard(root, gate, { storage, onReady: () => ready++ });
  assert.ok(c, 'mounted on a shut gate');
  const q = (s) => root.querySelector(s);
  assert.equal(root.dataset.build, 'wait', 'the modes dimmed (data-build=wait)');
  assert.equal(q('.lk-bld-st').textContent, 'Filling the lake');
  gate.update({ built: 40, total: 88, group: 'forest' });
  assert.equal(q('.lk-bld-st').textContent, 'Raising the forest');
  assert.equal(q('.lk-bld-pc').textContent, `${Math.floor(4000 / 91)} %`);
  assert.equal(q('.lk-bld-ln').getAttribute('aria-valuenow'), String(Math.floor(4000 / 91)));
  gate.update({ built: 70, total: 88, group: 'boatDetail' }); assert.equal(q('.lk-bld-st').textContent, 'Rigging the boat');
  gate.update({ built: 80, total: 88, group: 'night' }); assert.equal(q('.lk-bld-st').textContent, 'Setting the sails');
  assert.equal(ready, 0);
  gate.update({ built: 88, total: 88, group: null, assets: { lake: true, forest: true, towns: true } });
  assert.equal(q('.lk-bld-st').textContent, 'Ready'); assert.equal(q('.lk-bld-pc').textContent, '100 %');
  assert.equal(root.dataset.build, 'ready', 'the modes light'); assert.equal(ready, 1);
  gate.update({ built: 88, total: 88 }); assert.equal(ready, 1, 'once');
  c.dispose(); assert.equal(q('.lk-bld'), null); assert.equal(root.dataset.build, undefined);
});

test('the fact line: a new one every FACT_MS; the next load starts where this one stopped', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  installDom({ body: shellBody() });
  const root = document.getElementById('lk-load'); root.dataset.state = 'home';
  const storage = memStorage();
  const c = mountBuildCard(root, createBuildGate().configure({ on: true }), { storage });
  const seen = [c.line];
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(FACT_MS); t.mock.timers.tick(450); seen.push(c.line); }
  assert.deepEqual(seen, LINES.slice(0, 4), 'a fact, a tip, a fact, a tip');
  c.dispose();
  assert.equal(firstLine(storage), 4, 'the next load starts at the next line');
  const d = mountBuildCard(root, createBuildGate().configure({ on: true }), { storage });
  assert.equal(d.line, LINES[4]); d.dispose();
  storage.setItem(FACTS_KEY, String(LINES.length + 1)); assert.equal(firstLine(storage), 1, 'wraps');
});

test('a gate that is off (a tablet, a desktop) or already open mounts nothing', () => {
  installDom({ body: shellBody() });
  const root = document.getElementById('lk-load');
  assert.equal(mountBuildCard(root, createBuildGate().configure({ on: false })), null);
  assert.equal(root.querySelector('.lk-bld'), null);
});

test('reduced motion: the line swaps at once (no fade), the stage still follows', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  installDom({ body: shellBody() });
  const was = window.matchMedia;
  window.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  try {
    const root = document.getElementById('lk-load'); root.dataset.state = 'home';
    const c = mountBuildCard(root, createBuildGate().configure({ on: true }), { storage: memStorage() });
    t.mock.timers.tick(FACT_MS);
    assert.equal(c.line, LINES[1], 'swapped in the same tick');
    assert.equal(root.querySelector('.lk-bld-fx').classList.contains('off'), false, 'never faded out');
    c.dispose();
  } finally { window.matchMedia = was; }
});

test('setLineProgress: the progress line\'s one entry point (clamped 0..1; the shared bar can take its place at merge)', async () => {
  const { setLineProgress } = await import('../ui/buildCard.js');
  installDom({ body: shellBody() });
  const root = document.getElementById('lk-load'); root.dataset.state = 'home';
  const c = mountBuildCard(root, createBuildGate().configure({ on: true }), { storage: memStorage() });
  c.setProgress(0.5); assert.equal(c.progressEl.getAttribute('aria-valuenow'), '50');
  assert.equal(setLineProgress(c.progressEl, 3), 1); assert.equal(c.progressEl.getAttribute('aria-valuenow'), '100');
  c.dispose();
});
