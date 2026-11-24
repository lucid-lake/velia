// The strip (src/ui/attractStrip.js): while the film plays behind a live card the full card stays away and a slim row stands
// in; Menu, Skip and the stills bring the card back; the film's end (the live lake) keeps the strip; the row's controls delegate to the card's own.
// Behaviour on the stub DOM (tests/helpers/dom-card.mjs) with the real film module. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installReel, STORE_KEY, decideReel } from '../src/ui/attractReel.js';
import { installStrip } from '../src/ui/attractStrip.js';
import { installDom, shellBody } from './helpers/dom-card.mjs';

const Ev = class { constructor(type) { this.type = type; this.bubbles = false; } };
function page(t, { decision, stored = null } = {}) {
  const D = installDom({ body: shellBody() });
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = D.document.getElementById('lk-load');
  const m = new Map(stored ? [[STORE_KEY, stored]] : []);
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const facts = { reduced: false, saveData: false, effectiveType: '4g', canPlay: true, coarse: false, phone: false, webdriver: false };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  const clicks = [];
  root.querySelector('.lk-go').addEventListener('click', () => clicks.push('go'));
  for (const p of root.querySelectorAll('.lk-pick')) p.addEventListener('click', () => { clicks.push(p.dataset.mode); for (const o of root.querySelectorAll('.lk-pick')) o.setAttribute('aria-checked', String(o === p)); });
  let now = 0;
  const reel = installReel({ root, decision, facts, storage, doc: D.document, win: window, now: () => now, clock: (f, ms) => setTimeout(f, ms), unclock: clearTimeout, first: false });
  const focused = [];
  const strip = installStrip({ root, reel, doc: D.document, win: window, focusDelay: (f) => f() });
  for (const sel of ['.lk-sgo', '.lk-go']) { const el = root.querySelector(sel); el.focus = () => focused.push(sel); }
  const home = () => { root.dataset.state = 'home'; window.dispatchEvent(new CustomEvent('lakeshore:home')); };
  const playing = () => reel.video?.dispatchEvent(new Ev('playing'));
  return { D, root, reel, strip, clicks, focused, home, playing, tick: (ms) => { now += ms; t.mock.timers.tick(ms); } };
}

test('the strip stands in at ready only while the film runs; the card is inert behind it and comes back on Menu', (t) => {
  const { D, root, strip, home, playing, focused } = page(t);
  playing(); home();
  assert.equal(root.dataset.strip, 'on'); assert.equal(strip.showing, true);
  assert.equal(root.querySelector('.lk-strip').hidden, false);
  assert.equal(root.querySelector('.lk-card').hasAttribute('inert'), true, 'the card is inert while the strip stands in');
  assert.deepEqual(focused.slice(-1), ['.lk-sgo'], 'ENTER on the strip takes focus: the Enter key enters');
  D.fire(root.querySelector('.lk-smenu'), 'click');
  assert.equal(root.dataset.strip, undefined); assert.equal(strip.showing, false);
  assert.equal(root.querySelector('.lk-card').hasAttribute('inert'), false);
  assert.equal(root.querySelector('.lk-strip').hidden, true);
  assert.deepEqual(focused.slice(-1), ['.lk-go'], 'the card\'s ENTER takes focus back');
});

test('no film to watch (the stills): the card, as before; a film that starts moving after ready brings the strip in', (t) => {
  const a = page(t, { decision: decideReel({ flags: { reel: null }, stored: 'skip' }), stored: 'skip' });
  a.home();
  assert.equal(a.root.dataset.strip, undefined); assert.equal(a.root.querySelector('.lk-card').hasAttribute('inert'), false);
  const b = page(t);
  b.home();   // ready before the first frame (a slow link): the card
  assert.equal(b.strip.showing, false);
  b.playing();
  assert.equal(b.strip.showing, true, 'the first moving frame after ready: the strip');
});

test('the strip\'s controls delegate to the card: the cells pick the mode and mirror the card, ENTER clicks the card\'s ENTER', (t) => {
  const { D, root, home, playing, clicks } = page(t);
  playing(); home();
  D.fire(root.querySelector('.lk-sp[data-mode="cruise"]'), 'click');
  assert.deepEqual(clicks, ['cruise']);
  assert.equal(root.querySelector('.lk-sp[data-mode="cruise"]').getAttribute('aria-checked'), 'true');
  assert.equal(root.querySelector('.lk-sp[data-mode="sail"]').getAttribute('aria-checked'), 'false');
  D.fire(root.querySelector('.lk-sgo'), 'click');
  assert.deepEqual(clicks, ['cruise', 'go']);
});

test('the film\'s end keeps the strip over the live lake; Skip and an error open the card; the film played again brings the strip back', (t) => {
  const { D, root, reel, strip, home, playing } = page(t);
  playing(); home();
  assert.equal(strip.showing, true);
  reel.video.dispatchEvent(new Ev('ended'));   // no loop: the live lake
  assert.equal(root.dataset.reelEnd, 'live');
  assert.equal(strip.showing, true, 'the end keeps the strip (and ENTER) up over the lake');
  D.fire(root.querySelector('.lk-skip'), 'click');   // "Reel": the film again
  assert.equal(reel.mode, 'video'); assert.equal(strip.showing, true);
  playing();
  D.key('Escape');   // Skip by key only while loading (company); at home the pill skips
  assert.equal(strip.showing, true);
  D.fire(root.querySelector('.lk-skip'), 'click');
  assert.equal(root.dataset.reelEnd, 'live', 'Skip with the card up: the live lake at once'); assert.equal(strip.showing, false, 'Skip opens the card');
  D.fire(root.querySelector('.lk-skip'), 'click');   // "Reel" again
  assert.equal(strip.showing, true, 'the film again: the strip');
  reel.video.dispatchEvent(new Ev('error'));
  assert.equal(strip.showing, false, 'an error: the card');
});

test('the film ends before the world is ready: it loops (owner, 2026-11-09); at ready the strip over the film, its end the live lake', (t) => {
  const { root, reel, strip, home, playing } = page(t);
  root.dataset.state = 'company';
  playing();
  const first = reel.video;
  first.dispatchEvent(new Ev('ended'));
  assert.equal(root.dataset.reelEnd, undefined, 'no frozen last frame'); assert.notEqual(reel.video, first, 'a new copy from the fireworks');
  home();
  assert.equal(strip.showing, true, 'the strip over the looping film');
  reel.video.dispatchEvent(new Ev('ended'));
  assert.equal(root.dataset.reelEnd, 'live'); assert.equal(strip.showing, true);
});

test('the shell carries the strip: one row, the three modes, ENTER and Menu, hidden until the module decides', () => {
  const D = installDom({ body: shellBody() });
  const s = D.document.querySelector('#lk-load .lk-strip');
  assert.ok(s && s.hidden);
  assert.deepEqual([...s.querySelectorAll('.lk-sp')].map((b) => b.dataset.mode), ['cruise', 'sail', 'regatta']);
  assert.equal(s.querySelector('.lk-sgo').textContent, 'ENTER');
  assert.equal(s.querySelector('.lk-smenu').textContent, 'Menu');
});
