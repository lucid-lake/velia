// The helm dashboard: the rest dimming, the two message channels, the layout rules.
// The live wiring in Sail (the bar's events reach the subtitle line, a wind key says its level, the chart's dock key) is checked in a
// real browser: tests/pages/helmWiring.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DimClock, DIM } from '../classic/src/ui/dashboard.js';
import { GROUP, WORD } from '../src/ui/toolDock.js';
import { installDom, memStorage } from './helpers/dom-helm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const FS = { supported: () => true, active: () => false, on() {}, toggle() {} };   // the fullscreen API's stand-in

test('the dashboard dims after 8 s without input, never in the first minute, and any input or a hint brings it back', () => {
  const c = new DimClock();
  for (let i = 0; i < 100; i++) assert.equal(c.tick(0.5), false, 'no dimming in the first minute');
  assert.equal(c.t, 50);
  c.tick(10); assert.equal(c.dim, true, 'idle past the minute: dim');
  c.touch(); assert.equal(c.dim, false, 'an input brings it back');
  c.tick(7.9); assert.equal(c.dim, false); c.tick(0.2); assert.equal(c.dim, true, 'dim again after 8 s');
  c.tick(5, { busy: true }); assert.equal(c.dim, false, 'a hint on screen counts as activity');
  assert.equal(DIM.idleS, 8); assert.equal(DIM.minSessionS, 60);
});

test('one message channel under the bar: game events and statuses are brief lines in the subtitle line (no pill); the bar never carries a hint', async () => {
  const dom = installDom();
  const { createViewSwitch, ISLAND } = await import('../src/ui/viewSwitch.js');
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const said = [];
  let hint = null;   // built second, as in Sail: the bar is already on the page when the hint line arrives
  const vs = createViewSwitch({ view: () => 'follow', set() {}, storage: memStorage(), once: true, modality: () => 'mouse', fullscreen: FS,
    windPick: { level: () => 3, set() {} }, subtitle: (text, o) => { said.push({ text, ...o }); hint.flash(text, o); } });
  vs.update(0.1);
  hint = createControlsHint({ state: () => null, once: false, storage: null });
  const bar = dom.text(vs.el);
  // a game event: one brief line, said through the subtitle (ISLAND.msgS), shown by the hint line; the capsule's words do not change
  vs.say('Wind level 2');
  assert.deepEqual(said, [{ text: 'Wind level 2', secs: ISLAND.msgS }]);
  assert.equal(ISLAND.msgS, 2.4);
  hint.update(0.1);
  assert.equal(hint.current, 'flash'); assert.equal(dom.text(hint.el), 'Wind level 2', 'the subtitle line says it');
  assert.equal(dom.text(vs.el), bar, 'the capsule carries no line');
  assert.ok(!vs.el.contains(hint.el) && !hint.el.contains(vs.el), 'two channels, two elements');
  // the hint line's own lines (a skill hint, the keys list, R.'s note) never write into the capsule
  hint.force('pull'); hint.force('keys'); hint.force('off'); hint.note('slow under 1 kn to anchor', 'J');
  for (let i = 0; i < 40; i++) { hint.update(0.1); vs.update(0.1); }
  assert.equal(dom.text(vs.el), bar, 'no hint and no skipper line in the capsule');
  // the first-session nudge: its words go to the subtitle line too (with the key), never into the capsule
  for (let i = 0; i < 250; i++) vs.update(0.1);
  const nudge = said.find((s) => s.text === 'the helm');
  assert.ok(nudge && nudge.key === 'C' && nudge.secs === 4, JSON.stringify(said));
  assert.doesNotMatch(dom.text(vs.el), /the helm/, 'the nudge glows the segment; its words are the subtitle\'s');
  // no pill under the bar: no message layer in the capsule, and its stylesheet draws none
  assert.equal(vs.el.querySelectorAll('.msg, .line, .talk, .lk-mcap').length, 0);
  assert.doesNotMatch(dom.style('lk-view-css'), /\.lk-view \.msg|\.lk-view \.line|\.talk/);
  hint.dispose(); vs.dispose(); dom.uninstall();
});

test('the button row: every dock id is in a group, or belongs to the top; every row button has a short word', () => {
  for (const id of Object.keys(GROUP)) assert.ok(WORD[id], `${id} has a word`);
  for (const w of Object.values(WORD)) assert.ok(w.length <= 10, `${w}: short`);
  assert.deepEqual([...new Set(Object.values(GROUP))], ['tools', 'prop', 'tackle', 'sails', 'passage']);
  const tokensCss = read('src/ui/tokens.css');
  assert.match(tokensCss, /--lk-u:round\(down,clamp\(\.8px/, 'one unit for the whole row: every slot is 48 u (a strict grid)');
  assert.match(tokensCss, /--lk-row-h:calc\(var\(--lk-u\) \* 46\)/, 'the row is one 46 u plate');
});

test('the helm view steps the circles down to 70 %; a phone on its side shows the wind dial and the chart circle above the wheel, upright both at the top (no flip dots)', () => {
  const tokensCss = read('src/ui/tokens.css');
  assert.match(tokensCss, /:root\[data-lk-view=helm\]\{--lk-dm:\.7\}/);
  assert.match(tokensCss, /:root\[data-screen~=compact\]\.lk-cpanel \.lk-chart \.opener\{display:none!important\}/);
  assert.match(tokensCss, /:root\[data-screen~=compact\]:where\(:not\(\[data-screen~=portrait\]\)\)\.lk-cpanel \.lk-chart \.small\{left:var\(--lk-chart-l/, 'landscape: the heading circle above the wheel');
  assert.match(tokensCss, /:root\[data-screen~=portrait\]:where\(\[data-screen~=compact\]\)\.lk-cpanel \.lk-chart \.small\{right:auto;bottom:auto;left:var\(--lk-chart-l/, 'upright: the chart circle top-left (feat/portrait)');
  assert.ok(!tokensCss.includes('data-lk-circle'), 'no flip between the circles');
});

test('the skipper line is a film subtitle: no backing, white, outlined, 42 characters a line, two lines at most, upright', async () => {
  const tokensCss = read('src/ui/tokens.css');
  assert.match(tokensCss, /:root \.lk-hint > \.row\{background:none;/);
  assert.match(tokensCss, /-webkit-text-stroke:\.1em/); assert.match(tokensCss, /max-width:min\(42ch,92vw\)/); assert.match(tokensCss, /4\.2vh/);
  assert.doesNotMatch(tokensCss, /:root \.lk-hint \.say\{[^}]*italic/);
  const { LEADS, TEXT, NOTES } = await import('../src/ui/skipper.js');
  for (const [k, v] of Object.entries(LEADS)) assert.ok(v.length + 28 <= 84, `${k}: lead + phrase fits two lines of 42`);
  for (const v of [...Object.values(TEXT), ...Object.values(NOTES).map((n) => n.text.replace(/\{(?:[^|}]*\|)*([^}|]*)\}/g, '$1'))]) assert.ok(v.length <= 84, `${v}: two lines of 42 at most`);
});

test('the key sprites: a sheet and a placard at 1x, 2x, 3x; one row per key id, a column per state', async () => {
  const { existsSync } = await import('node:fs');
  for (const n of ['switches', 'plate', 'screw']) for (const x of [1, 2, 3]) assert.ok(existsSync(new URL(`../brand/dash/${n}@${x}x.webp`, import.meta.url)), `${n}@${x}x.webp`);
  const { SPRITE } = await import('../src/ui/toolDock.js');
  assert.deepEqual(SPRITE.rows, ['engine', 'anchor', 'lines', 'sails', 'logbook', 'binoculars', 'radio', 'cruise', 'chart']);
});

test('the subtitle face: Fraunces by default, `?subfont=b..e` picks another; every face is self-hosted with its licence', async () => {
  const tokensCss = read('src/ui/tokens.css');
  assert.match(tokensCss, /--lk-sub-font:'Velia Sub A'/);
  for (const k of ['b', 'c', 'd', 'e']) assert.match(tokensCss, new RegExp(`:root\\[data-subfont=${k}\\]`));
  // the hint line reads ?subfont= and marks the page; an unknown face or none leaves the default
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  for (const [search, want] of [['?subfont=c', 'c'], ['?mode=sail&subfont=E', 'e'], ['?subfont=z', undefined], ['', undefined]]) {
    const dom = installDom({ search });
    const h = createControlsHint({ state: () => null, once: false, storage: null });
    assert.equal(document.documentElement.dataset.subfont, want, search || '(no query)');
    h.dispose(); dom.uninstall();
  }
  const { existsSync } = await import('node:fs');
  for (const f of ['fraunces-soft', 'cormorant-garamond-600', 'newsreader', 'spectral-500', 'figtree']) assert.ok(existsSync(new URL(`../fonts/sub/${f}.woff2`, import.meta.url)), f);
  for (const f of ['fraunces', 'cormorant-garamond', 'newsreader', 'spectral', 'figtree']) assert.ok(existsSync(new URL(`../fonts/OFL-${f}.txt`, import.meta.url)), `OFL ${f}`);
});

test('the subtitle wind: the direction is the true wind on the screen, the stagger is quick, the line keeps its words', async () => {
  const { windOnScreen, letterPlan, prepareLine, WIND_SUB } = await import('../src/ui/subtitleWind.js');
  const stbd = windOnScreen({ angle: Math.PI / 2, speed: 5 }), port = windOnScreen({ angle: -Math.PI / 2, speed: 5 });
  assert.ok(stbd.x < -0.9 && port.x > 0.9, 'a starboard wind blows toward screen-left, a port wind toward screen-right');
  const head = windOnScreen({ angle: 0, speed: 5 }), astern = windOnScreen({ angle: Math.PI, speed: 5 });
  assert.ok(head.y > 0 && astern.y < 0, 'a head wind blows toward the viewer (down), a following wind lifts the letters (up)');
  assert.ok(Math.abs(Math.hypot(stbd.x, stbd.y) - 1) < 1e-9);
  assert.ok(windOnScreen({ angle: 1, speed: 0 }).g >= WIND_SUB.gustMin && windOnScreen({ angle: 1, speed: 99 }).g <= WIND_SUB.gustMax, 'the gust only scales the drift a little');
  const d = letterPlan(38, 1); assert.equal(d[0], 0); assert.ok(d.at(-1) <= WIND_SUB.inTotalS + 1e-9, 'the whole stagger is under 0.3 s');
  assert.ok(d[1] - d[0] <= WIND_SUB.inPerLetterS + 1e-9, 'at most 25 ms a letter');
  const r = letterPlan(5, -1); assert.ok(r[4] === 0 && r[0] > 0, 'the wave starts at the upwind end');
  // the line in the page: its letters become spans, the words stay whole for a screen reader (aria-label), the letters are hidden from it
  const dom = installDom();
  const row = document.createElement('div'); row.innerHTML = '<span class="say">Ease the <b>main</b>  out</span>';
  const n = prepareLine(row, stbd), say = row.querySelector('.say');
  assert.equal(n, 'Easethemainout'.length);
  assert.equal(say.getAttribute('aria-label'), 'Ease the main out');
  assert.equal(say.querySelectorAll('.wd').length, 4); assert.ok(say.querySelectorAll('.wd').every((w) => w.getAttribute('aria-hidden') === 'true'));
  assert.equal(say.textContent.replace(/\s+/g, ' '), 'Ease the main out', 'the words are kept');
  assert.equal(prepareLine(row, stbd), 0, 'idempotent');
  // reduced motion: the hint line's own stylesheet turns the letters' animation off
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const h = createControlsHint({ state: () => null, once: false, storage: null });
  assert.match(dom.style('lk-hint-css'), /prefers-reduced-motion:reduce\)\{\.lk-hint \.row\{transform:none\}\.lk-hint \.row \.lt[^}]*animation:none!important/);
  h.dispose(); dom.uninstall();
});

test('the chart is a captain tool in the bottom panel (Log, Chart, Glasses, VHF in the legacy row); the home card lists no Chart and no Log', async () => {
  const { GROUP, WORD } = await import('../src/ui/toolDock.js');
  assert.equal(GROUP.chart, 'tools'); assert.equal(WORD.chart, 'Chart');
  // the small chart circle is a button with a hover hint: a press pins the enlarged chart
  const dom = installDom();
  const { createChartplotter } = await import('../src/ui/chartplotter.js');
  const cp = createChartplotter({ terrain: { heightAt: () => -20 }, boat: { state: { x: 0, z: 0, heading: 0 } } });
  const small = cp.el.querySelector('.small');
  assert.equal(small.title, 'Open the chart (N)');
  assert.equal(cp.toggle.pinned, false);
  small.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(cp.toggle.pinned, true, 'a press on the circle opens the chart large');
  cp.dispose(); dom.uninstall();
  const shell = read('src/ui/loading-shell.html');
  assert.doesNotMatch(shell, /data-go="chart"/);
  // the card's row is one row (owner, 2026-11-06): no Log (the L key and the menu in play), Contact inside About
  assert.doesNotMatch(shell, /<button class="lk-link" type="button" data-go="contact"/);
  for (const k of ['keys', 'settings', 'about']) assert.match(shell, new RegExp(`data-go="${k}"`));
});
