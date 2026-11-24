// Help › What's new and Credits as one scrolling page each (owner 2026-11-15: no numbered pages): the pages' markup on the
// mounted card (tests/helpers/home-mount.mjs), the keys' scroll and the bottom fade (src/ui/helpScroll.js) on small fakes.
// The real scroll, the fold and the fade in a browser: v2/tests/pages/helpScroll.page.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountHome } from './helpers/home-mount.mjs';
import { NEWS, prettyDate } from '../src/ui/news.js';
import { CREDITS, CREDIT_TOPICS } from '../src/ui/credits.js';
import { scrollKey, applyScroll, createScrollFade, LINE_PX } from '../src/ui/helpScroll.js';

test('What\'s new: no page pills; a date heading per release, newest first; the newest open, the older folded', async (t) => {
  const c = await mountHome({ state: 'home', clock: t });
  c.home.show('news', false);
  const pg = c.q('.pg[data-page=news]');
  assert.equal(pg.querySelectorAll('[role=tab], [role=tablist]').length, 0, 'no numbered page buttons');
  assert.ok(pg.classList.contains('scr'), 'a scrolling page');
  const rel = [...pg.querySelectorAll('details.rel')];
  const dates = [...new Set(NEWS.map((n) => n.date))];
  assert.deepEqual(rel.map((d) => d.querySelector('summary').textContent.trim()), dates.map(prettyDate), 'one date heading a release, newest first');
  assert.deepEqual(rel.map((d) => d.hasAttribute('open')), dates.map((_, i) => i === 0), 'only the newest is open');
  assert.equal(pg.querySelectorAll('.nw').length, NEWS.length, 'every entry once');
  assert.equal(rel[0].querySelectorAll('.nw').length, NEWS.filter((n) => n.date === dates[0]).length, 'the newest release holds its entries');
  // a reader opens an older one; the page shown again opens as new: the newest open, the rest folded
  rel[2].setAttribute('open', ''); rel[0].removeAttribute('open');
  c.home.show('credits', false); c.home.show('news', false);
  assert.deepEqual([...pg.querySelectorAll('details.rel')].map((d) => d.hasAttribute('open')), dates.map((_, i) => i === 0), 'shown again: the newest open');
  c.home.dispose();
});

test('Credits: one page, the opening line, a heading per topic, every credit once', async (t) => {
  const c = await mountHome({ state: 'home', clock: t });
  c.home.show('credits', false);
  const pg = c.q('.pg[data-page=credits]');
  assert.equal(pg.querySelectorAll('[role=tab], [role=tablist], [role=tabpanel]').length, 0, 'no numbered page buttons');
  assert.ok(pg.classList.contains('scr'), 'a scrolling page');
  assert.match(pg.querySelector('.pg-b > p').textContent, /^Velia, by Lucid Lake Studio\./);
  const heads = [...pg.querySelectorAll('.cgrp > .ch3')].map((h) => h.textContent);
  assert.deepEqual(heads, CREDIT_TOPICS.filter(([k]) => CREDITS.some((x) => x.topic === k)).map(([, h]) => h), 'the topics in order');
  assert.equal(pg.querySelectorAll('.credit').length, CREDITS.length, 'every credit once');
  for (const x of CREDITS) assert.ok(CREDIT_TOPICS.some(([k]) => k === x.topic), `${x.what} has a topic`);
  c.home.dispose();
});

test('the keys: arrows step, PageUp/PageDown and Space leaf, Home/End jump; the nav keeps its arrows; a date keeps Space', () => {
  assert.deepEqual(scrollKey('ArrowDown'), { by: LINE_PX });
  assert.deepEqual(scrollKey('ArrowUp'), { by: -LINE_PX });
  assert.deepEqual(scrollKey('PageDown', { page: 400 }), { by: 340 });
  assert.deepEqual(scrollKey('Space', { page: 400, shift: true }), { by: -340 });
  assert.deepEqual(scrollKey('End'), { to: 'end' });
  assert.equal(scrollKey('ArrowDown', { inNav: true }), null, 'in the nav the arrows walk the nav');
  assert.deepEqual(scrollKey('PageDown', { inNav: true, page: 400 }), { by: 340 }, 'PageDown scrolls from the nav too');
  assert.equal(scrollKey('Space', { onSummary: true }), null, 'Space on a date opens or folds it');
  assert.equal(scrollKey('KeyA'), null);
  // a body 1000 px tall in a 300 px window
  const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 300, scrollBy({ top }) { this.scrollTop = Math.max(0, Math.min(700, this.scrollTop + top)); }, scrollTo({ top }) { this.scrollTop = Math.max(0, Math.min(700, top)); } };
  assert.equal(applyScroll(el, scrollKey('ArrowUp')), false, 'at the top an arrow up does not scroll (the focus walk takes it)');
  assert.equal(applyScroll(el, scrollKey('PageDown', { page: 300 })), true); assert.equal(el.scrollTop, 255);
  assert.equal(applyScroll(el, scrollKey('End')), true); assert.equal(el.scrollTop, 700);
  assert.equal(applyScroll(el, scrollKey('ArrowDown')), false, 'at the end nothing moves');
  assert.equal(applyScroll(el, scrollKey('Home')), true); assert.equal(el.scrollTop, 0);
});

test('the fade: data-more while more is below, gone at the end; a scroll and a fold update it', () => {
  const at = {};
  const body = { scrollTop: 0, scrollHeight: 900, clientHeight: 300, attrs: new Set(), setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); }, matches: (s) => s === '.pg.scr > .pg-b' };
  const root = { querySelectorAll: () => [body], addEventListener: (k, f) => { at[k] = f; }, removeEventListener: (k) => { delete at[k]; } };
  const fade = createScrollFade(root);
  fade.update(); assert.ok(body.attrs.has('data-more'), 'more below: the fade');
  body.scrollTop = 600; at.scroll({ target: body }); assert.ok(!body.attrs.has('data-more'), 'at the end: no fade');
  body.scrollHeight = 1400; at.toggle({}); assert.ok(body.attrs.has('data-more'), 'a release opened: more below again');
  fade.dispose(); assert.deepEqual(Object.keys(at), [], 'disposed: no listener left');
});
