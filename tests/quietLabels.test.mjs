// Quiet labels (owner, 2026-11-05: "avoid unnecessary secondary labels; let the layout do the explaining"; no pop-up pills under the top bar).
// Cruise's status line and Regatta's quiet course are checked in a real browser: tests/pages/helmWiring.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from './helpers/dom-stub.mjs';
import { installDom, memStorage } from './helpers/dom-helm.mjs';
import * as THREE from 'three/webgpu';
import { parseFlags } from '../src/sim/core/flags.js';
import { createServices } from '../src/sim/core/services.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const FS = { supported: () => true, active: () => false, on() {}, toggle() {} };   // the fullscreen API's stand-in

test('the subtitle line takes a status for its seconds, then the line it replaced returns', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const hint = createControlsHint({ state: () => null, once: false, storage: null });
  hint.force('off'); hint.force('pull', { animate: false });
  hint.force('off');   // a capture's pin ends; flash works only unpinned
  assert.equal(hint.flash('One reef in', { secs: 2 }), true);
  hint.update(0.1);
  assert.equal(hint.current, 'flash');
  assert.match(text(hint.el.innerHTML), /^One reef in$/, 'the words alone: no tag, no key');
  assert.equal(hint.flash('Sails down', { secs: 2 }), true, 'the newest wins');
  hint.update(0.1);
  assert.match(text(hint.el.innerHTML), /^Sails down$/);
  for (let i = 0; i < 40; i++) hint.update(0.1);
  assert.notEqual(hint.current, 'flash', 'it is gone after its seconds');
  hint.dispose();
});

test('a status is not shown while a capture pins a hint', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const hint = createControlsHint({ state: () => null, once: false, storage: null });
  hint.force('pull');
  assert.equal(hint.flash('One reef in'), false);
  hint.dispose();
});

// the top bar with a music source whose song can change, and a wind picker
async function bar({ width = 1280, level = 3 } = {}) {
  const dom = installDom({ width });
  const { createViewSwitch, MCAP_S } = await import('../src/ui/viewSwitch.js');
  const m = { songId: 1, title: 'Lake Song', paused: false, off: false, next() {}, turnOn() {}, toggle() {}, setVolume() {} };
  const said = [];
  const w = { level };
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: memStorage(), once: false, nudge: false, fullscreen: FS, music: () => m, subtitle: (t, o) => said.push(t),
    windPick: { level: () => w.level, set: (n) => { w.level = n; } } });
  vs.update(0.1);
  return { dom, vs, m, w, said, MCAP_S };
}

test('nothing floats under the bar: no msg layer, no line, no caption pill; the song title opens inside the music segment', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { dom, vs, m, said, MCAP_S } = await bar();
  const css = dom.style('lk-view-css');
  assert.equal(vs.el.querySelectorAll('.lk-mcap, .msg, .line').length, 0, 'no message layer, no line under the bar');
  assert.doesNotMatch(css, /lk-mcap|\.lk-view \.line\{/);
  // a new song: its title opens inside the music segment (a note, the title, a skip), for MCAP_S, then eases back
  m.songId = 2; m.title = 'Evening on the Bay'; vs.update(0.1);
  const mus = vs.el.querySelector('.mus'), ttl = mus.querySelector('.ttl');
  assert.ok(ttl && ttl.parentNode === mus, 'the title lives in the music segment');
  assert.equal(ttl.textContent, 'Evening on the Bay');
  assert.ok(mus.classList.contains('song') && vs.el.classList.contains('song'), 'the segment widens');
  assert.deepEqual(said, [], 'the song is not a subtitle line either');
  assert.match(css, /\.lk-view \.mus\.song \.ttl\{max-width:var\(--tw,12em\);opacity:\.95/, 'its stylesheet opens the title only while .song');
  for (let i = 0; i < MCAP_S * 10 + 2; i++) vs.update(0.1);
  assert.ok(!mus.classList.contains('song'), `gone after ${MCAP_S} s`);
  t.mock.timers.tick(700); assert.ok(!vs.el.classList.contains('song'));
  // reduced motion: the title and the stepping-aside snap
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.lk-view \.mus \.ttl,\.lk-view \.lay\.full>\*,\.lk-view\.tight[^}]*\{transition:none\}/);
  assert.doesNotMatch(read('src/ui/tokens.css'), /lk-view\.(talk|nudge)\) \.lk-hint/, 'the subtitle no longer steps down for a pill');
  vs.dispose(); dom.uninstall();
});

test('on a narrow screen the other items step aside while the title shows', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { dom, vs, m } = await bar({ width: 390 });
  const css = dom.style('lk-view-css');
  // a phone's bar: the items fill most of the width, the title would not fit beside them (layout measured as a phone draws it)
  const lay = vs.el.querySelector('.lay.full'), ttl = vs.el.querySelector('.mus .ttl');
  Object.defineProperty(lay, 'scrollWidth', { get: () => 300 }); Object.defineProperty(ttl, 'scrollWidth', { get: () => 120 });
  for (const n of lay.children) Object.defineProperty(n, 'offsetWidth', { get: () => 40 });
  m.songId = 2; m.title = 'Evening on the Bay'; vs.update(0.1);
  assert.ok(vs.el.classList.contains('tight'), 'the other items step aside');
  assert.ok(lay.children.filter((n) => !n.classList.contains('mus')).every((n) => n.style.width === '40px'), 'their widths pinned first, so the collapse eases');
  assert.match(css, /\.lk-view\.tight \.lay\.full>:not\(\.mus\)\{width:0!important/, 'its stylesheet folds them while .tight');
  for (let i = 0; i < 50; i++) vs.update(0.1);
  assert.ok(!vs.el.classList.contains('tight'), 'and come back');
  t.mock.timers.tick(700); assert.ok(lay.children.every((n) => n.style.width === ''), 'unpinned');
  vs.dispose(); dom.uninstall();
});

test('the top bar names the wind by its word; the number and range are its tip', async () => {
  const { dom, vs, w } = await bar({ level: 3 });
  const b = vs.el.querySelector('.xt[data-x=wind]');
  assert.equal(b.querySelector('.w').textContent, 'Fresh');
  assert.equal(b.dataset.tip, 'Wind 3 · Fresh, 13–17 kn'); assert.equal(b.getAttribute('aria-label'), 'Wind 3 · Fresh, 13–17 kn'); assert.ok(!b.title, 'no browser title');
  w.level = 1; vs.update(0.1);
  assert.equal(b.querySelector('.w').textContent, 'Light');
  assert.equal(b.dataset.tip, 'Wind 1 · Light, 4–7 kn'); assert.equal(b.getAttribute('aria-label'), b.dataset.tip);
  vs.dispose(); dom.uninstall();
});

test('the home card: no Waters / Boat / Plan label column, one status line at a time', () => {
  const sh = read('src/ui/loading-shell.html');
  assert.match(sh, /\.lk-row\{all:unset;[^}]*grid-template-columns:1fr auto/);
  assert.match(sh, /\.lk-row \.k\{position:absolute;width:1px;height:1px/, 'the labels stay for a screen reader only');
  assert.match(sh, /\.lk-voyage \.lk-stage\{position:absolute;width:1px/, 'the stage caption does not show beside the sailor\'s line');
});

test('the dials carry no maker stamp; the throttle prints no ENGINE OFF', async () => {
  const dom = installDom();
  const { createCaptainView } = await import('../src/ui/captainView.js');
  const { createChartplotter } = await import('../src/ui/chartplotter.js');
  const cv = createCaptainView({ storage: null, always: true });
  const cp = createChartplotter({ terrain: { heightAt: () => -20 }, boat: { state: { x: 0, z: 0, heading: 0 } } });
  for (const [name, el, css] of [['wind dial', cv.el, dom.style('lk-cv-css')], ['chart', cp.el, dom.style('lk-chart-css')]]) {
    assert.ok(css.length > 100, name);
    assert.doesNotMatch(el.outerHTML, /badge/i, `${name}: no maker's badge on the plate`);
    assert.doesNotMatch(css, /badge/i, `${name}: no badge style`);
    assert.doesNotMatch(dom.text(el), /Velia|Lucid Lake/, `${name}: no maker's name`);
  }
  cp.dispose(); cv.dispose?.();
  const { createThrottleColumn, NOTCHES } = await import('../src/stations/sloop/throttleLever.js');
  let st = 'off', lever = 0;
  const thr = createThrottleColumn({ lever: () => lever, engineState: () => st });
  for (const s of ['off', 'stopped', 'cranking', 'running']) for (const n of NOTCHES) {
    st = s; lever = n.v; thr.update();
    assert.doesNotMatch(dom.text(thr.el), /ENGINE OFF/, `${s} at ${n.id}`);
    if (s === 'off' || s === 'stopped') assert.equal(thr.word, '', 'stopped: no word (the lever at N says it)');
    else assert.equal(thr.word, n.lit, 'running: the notch');
  }
  st = 'off'; lever = 0; thr.update();
  assert.match(thr.el.querySelector('[role=slider]').getAttribute('aria-valuetext'), /engine off/, 'a screen reader still hears the engine');
  thr.dispose(); dom.uninstall();
});

test('the regatta briefing says the course once, and the difficulty buttons carry their line', async () => {
  const dom = installDom();
  const { createBriefing } = await import('../classic/src/modes/regatta/briefingUi.js');
  const { createFlow, DIFFICULTY } = await import('../src/sim/race/newbie.js');
  const { courseFor } = await import('../src/sim/race/course.js');
  const flow = createFlow();
  const b = createBriefing({ course: courseFor('tahoe-emerald', 'island-sprint'), flow, onStart() {} });
  b.show();
  const words = dom.text(b.el);
  assert.equal(b.el.querySelectorAll('.keep, .dline').length, 0, 'no list of the marks, no line under the choice');
  assert.doesNotMatch(words, /Finish across the start line/);
  for (const m of b.model.marks) assert.ok(!words.includes(m.text), `the chart shows it, not a line: ${m.text}`);
  assert.match(b.el.querySelector('svg.chart').getAttribute('aria-label'), /start line, then the island mark, then back to the line/, 'the chart says the course once');
  const btns = b.el.querySelectorAll('.dif button');
  assert.deepEqual(btns.map((x) => x.dataset.d), DIFFICULTY.map((d) => d.id));
  for (const [i, d] of DIFFICULTY.entries()) {
    assert.equal(btns[i].title, d.line); assert.equal(btns[i].getAttribute('aria-label'), `${d.label}: ${d.line}`);
    assert.equal(btns[i].textContent, d.label, 'the button shows the word only');
  }
  assert.ok(!words.includes(DIFFICULTY[0].line), 'the line is the title, not text under the buttons');
  btns[2].click();
  assert.equal(flow.difficulty, DIFFICULTY[2].id); assert.equal(b.el.querySelector('.dif [aria-checked=true]').dataset.d, DIFFICULTY[2].id);
  b.dispose(); dom.uninstall();
});

test('the marks\' lines go to the hint row as plain words: no raw tag passed as a key cap; a race lays its course quietly', async () => {
  const dom = installDom();
  const { attachMarks } = await import('../classic/src/marks/scene.js');
  const services = createServices();
  services.provide('boat', { env: () => ({ windAt: () => ({ vx: 0, vz: -5 }) }) });
  let deep = -40;
  const core = { services, flags: parseFlags(''), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), terrain: { heightAt: () => deep }, water: { surface: { heightAt: () => 0 } }, headless: true, time: 0 };
  const notes = [];
  const marks = attachMarks(core, { phys: { state: { x: 0, z: 0, heading: 0 } } }, { controls: { hint: { note: (...a) => notes.push(a) } } });
  assert.ok(marks.lay('windward-leeward', { settleS: 1 }));
  assert.ok(marks.lay('windward-leeward', { settleS: 1, quiet: true }), 'a race lays its own course');
  deep = 5; assert.equal(marks.lay('triangle', { settleS: 1 }), null, 'no room in shallow water');
  assert.deepEqual(notes.map((a) => a[0]), ['Windward-leeward, 0.50 nm, port: 4 marks laid', 'no room for a course here'], 'the quiet lay says nothing');
  for (const a of notes) assert.equal(a.length, 1, `"${a[0]}": the words only, no key cap (${a.slice(1)})`);
  assert.deepEqual(marks.log.map((l) => l.text), notes.map((a) => a[0]), 'the course log keeps the same lines');
  marks.dispose?.(); dom.uninstall();
});
