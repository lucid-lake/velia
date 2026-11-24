// fix/card-enter: a tap on Cruise, Sail or Regatta enters that mode; the button reads ENTER.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnter } from '../src/ui/planEnter.js';
import { createPlan } from '../src/ui/planState.js';
import { startMetrics, EVENTS } from '../src/metrics.js';
import { mountHome } from './helpers/home-mount.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// the live metrics layer on a stand-in browser: every beacon is kept; sent() flushes and returns the events
const beacons = [];
const M = startMetrics({ g: { document: { visibilityState: 'visible' }, navigator: { sendBeacon: (url, body) => { beacons.push(body); return true; } }, location: { search: '?metrics=1', hostname: 'velia.test' }, addEventListener() {} } });
async function sent() { M.flush(); const out = []; for (const b of beacons.splice(0)) out.push(...JSON.parse(typeof b === 'string' ? b : await b.text()).e); return out; }

// the card as home.js wires it: the plan, the state, the entry
function card({ state = 'company', welcome = false } = {}) {
  const log = { entered: [], said: [], started: [] };
  const P = createPlan('sail'); let st = state;
  const E = createEnter({
    ready: () => st === 'home',
    enter: (m) => { P.pick(m); log.started.push(P.toStart()); log.entered.push(m); st = 'out'; },
    queued: (m) => { P.pick(m); log.said.push(m); },
    dropped: () => P.reset(),
  });
  return { E, P, log, live() { st = 'home'; return E.flush(welcome); } };
}

test('a mode tap enters directly when the world is ready', () => {
  const c = card({ state: 'home' });
  assert.equal(c.E.pick('cruise'), true);
  assert.deepEqual(c.log.entered, ['cruise']);
  assert.deepEqual(c.log.started, ['cruise'], 'the plan to start is the tapped mode');
});

test('a tap while loading is lit and queued, and enters at ready', () => {
  const c = card();
  assert.equal(c.E.pick('regatta'), false);
  assert.equal(c.P.plan, 'regatta', 'lit');
  assert.equal(c.E.mode, 'regatta'); assert.deepEqual(c.log.said, ['regatta']); assert.equal(c.log.entered.length, 0);
  assert.equal(c.live(), true);
  assert.deepEqual(c.log.entered, ['regatta']); assert.equal(c.E.mode, null);
});

test('the last queued tap wins', () => {
  const c = card(); c.E.pick('cruise'); c.E.pick('sail'); c.live();
  assert.deepEqual(c.log.entered, ['sail']);
});

test('no double entry: a second tap, flush or Enter after entering does nothing', () => {
  const c = card({ state: 'home' });
  c.E.pick('sail'); c.E.pick('cruise'); assert.equal(c.E.flush(false), false);
  assert.deepEqual(c.log.entered, ['sail']);
  const q = card(); q.E.pick('cruise'); q.live(); q.E.pick('sail'); q.E.flush(false);
  assert.deepEqual(q.log.entered, ['cruise']);
});

test('the first-visit welcome comes first: a queued tap is dropped, nothing enters', () => {
  const c = card({ welcome: true });
  c.E.pick('cruise');
  assert.equal(c.live(), false);
  assert.equal(c.log.entered.length, 0); assert.equal(c.E.mode, null); assert.equal(c.P.plan, 'sail', 'the plan is back to what runs');
});

test('on the card: a tap while loading waits; at live the welcome comes first and drops it; the welcome\'s own choice switches the plan but never enters', async (t) => {
  const c = await mountHome({ clock: t, welcomed: false });
  c.q('.lk-pick[data-mode=cruise]').click();
  assert.equal(c.home.queued, 'cruise'); assert.deepEqual(c.log.mode, [], 'loading: nothing switches yet');
  c.root.dataset.state = 'home'; dispatchEvent(new Event('lakeshore:home')); await c.D.settle();
  assert.equal(c.home.view, 'welcome', 'the first-visit welcome');
  assert.equal(c.home.queued, null); assert.equal(c.home.mode, 'sail', 'the plan is back to what runs');
  assert.deepEqual([c.log.mode, c.log.entered, c.log.entering], [[], 0, 0], 'the dropped tap entered nothing');
  // the welcome's own choice (data-w buttons): New to it, then "just enjoy the view" puts Cruise on the plan, still on the card
  c.q('[data-w="profile:new"]').click(); assert.equal(c.home.view, 'welcome2');
  c.q('[data-w="start:cruise"]').click(); await c.D.settle();
  assert.equal(c.home.view, 'home'); assert.equal(c.home.state, 'home', 'still on the card');
  assert.deepEqual(c.log.mode, ['cruise'], 'the world switches to the plan'); assert.equal(c.home.mode, 'cruise');
  assert.equal(c.q('.lk-pick[data-mode=cruise]').getAttribute('aria-checked'), 'true', 'and the plan row shows it');
  assert.deepEqual([c.log.entered, c.log.entering], [0, 0], 'the welcome never enters');
  assert.deepEqual((await sent()).filter((e) => e.n === 'set_sail'), [], 'and tracks no set_sail');
  c.home.dispose();
  // a choice that is already the plan switches nothing
  const d = await mountHome({ clock: t, welcomed: false, state: 'home' });
  d.q('[data-w="profile:sail"]').click(); await d.D.settle();
  assert.equal(d.home.view, 'home'); assert.deepEqual(d.log.mode, []); assert.equal(d.log.entered, 0);
  d.home.dispose();
});

test('the markup: the button reads ENTER; the picks take taps while loading; the lake-and-boat line stays inert', () => {
  const html = read('index.html');
  assert.match(html, /<button class="lk-link lk-go"[^>]*><span class="pq">ENTER<\/span><\/button>/);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /Set sail/i);
  assert.doesNotMatch(html, /<div class="lk-plan"[^>]*inert/);
  assert.match(html, /data-go="waters" inert/);   // V2: the lake and the boat are one summary line
  assert.doesNotMatch(html, /title="or press Enter"/, 'no key named in the button hint');
});

test('the card: ENTER live, Resume paused mid-play; a mode tap enters when live, queues while loading, and only switches the plan mid-play', async (t) => {
  const a = await mountHome({ clock: t, state: 'home' });
  assert.equal(a.q('.lk-go .pq').textContent, 'ENTER');
  a.q('.lk-pick[data-mode=cruise]').click(); await a.D.settle();
  assert.deepEqual([a.log.mode, a.log.entering, a.log.entered], [['cruise'], 1, 1], 'live: the tap enters Cruise');
  a.q('.lk-pick[data-mode=sail]').click(); await a.D.settle();
  assert.deepEqual([a.log.entering, a.log.entered], [1, 1], 'one entry a page load');
  a.home.dispose();
  const b = await mountHome({ clock: t });   // loading (company)
  b.q('.lk-pick[data-mode=regatta]').click();
  assert.equal(b.home.queued, 'regatta'); assert.equal(b.root.dataset.queued, 'regatta', 'lit and waiting');
  assert.equal(b.q('.lk-pick[data-mode=regatta]').getAttribute('aria-checked'), 'true');
  assert.match(b.log.said.at(-1), /^Regatta picked/, 'the status line says so');
  assert.deepEqual([b.log.mode, b.log.entering], [[], 0]);
  b.root.dataset.state = 'home'; await b.D.settle();
  assert.deepEqual([b.log.mode, b.log.entering, b.log.entered], [['regatta'], 1, 1], 'it enters the moment the card goes live');
  b.home.dispose();
  const c = await mountHome({ clock: t, state: 'gone' });
  c.home.open();
  assert.equal(c.q('.lk-go .pq').textContent, 'Resume', 'paused mid-play stays Resume');
  c.q('.lk-pick[data-mode=cruise]').click(); await c.D.settle();
  assert.deepEqual(c.log.mode, ['cruise'], 'mid-play: the plan switches behind the card');
  assert.deepEqual([c.log.entering, c.log.entered, c.home.isOpen], [0, 0, true], 'and the card stays up until Resume');
  c.home.dispose();
});

test('metrics: set_sail fires on entering any mode, with the mode as its prop', async (t) => {
  assert.deepEqual(EVENTS.set_sail, ['mode']);
  await sent();
  for (const [m, how] of [['cruise', 'tap'], ['regatta', 'queued tap'], ['sail', 'ENTER']]) {
    const c = await mountHome({ clock: t, state: how === 'queued tap' ? 'company' : 'home' });
    if (how === 'ENTER') c.q('.lk-go').click(); else c.q(`.lk-pick[data-mode=${m}]`).click();
    if (how === 'queued tap') { assert.deepEqual(await sent(), [], 'not before it enters'); c.root.dataset.state = 'home'; await c.D.settle(); }
    assert.deepEqual(await sent(), [{ n: 'set_sail', p: { mode: m } }], `${how}: one set_sail, the mode its only prop`);
    c.q('.lk-go').click(); c.q('.lk-pick[data-mode=cruise]').click();
    assert.deepEqual(await sent(), [], `${how}: once a page load`);
    c.home.dispose();
  }
});

// v2 phones (owner, 2026-11-17: "build the shaders, then present"; v2/engine/buildGate.js): canEnter() false while the shaders build
test('canEnter: a tap on the live card waits while the modes are not ready, lights its mode, and enters at released(); a loading tap waits too', async (t) => {
  let ok = false;
  const a = await mountHome({ clock: t, state: 'home', canEnter: () => ok });
  a.q('.lk-pick[data-mode=regatta]').click(); await a.D.settle();
  assert.deepEqual([a.log.mode, a.log.entering, a.log.entered], [[], 0, 0], 'not ready: nothing enters');
  assert.equal(a.home.queued, 'regatta'); assert.equal(a.q('.lk-pick[data-mode=regatta]').getAttribute('aria-checked'), 'true', 'the remembered tap is lit');
  a.home.released(); await a.D.settle();
  assert.deepEqual([a.log.mode, a.log.entering], [[], 0], 'released() while still not ready does nothing');
  ok = true; a.home.released(); await a.D.settle();
  assert.deepEqual([a.log.mode, a.log.entering, a.log.entered], [['regatta'], 1, 1], 'ready: the remembered mode enters at once');
  a.home.dispose();
  ok = false;
  const b = await mountHome({ clock: t, canEnter: () => ok });   // loading (company): the card goes live before the build is done
  b.q('.lk-pick[data-mode=cruise]').click();
  b.root.dataset.state = 'home'; dispatchEvent(new Event('lakeshore:home')); await b.D.settle();
  assert.deepEqual([b.log.mode, b.log.entering], [[], 0], 'card live, modes not ready: still waiting');
  assert.equal(b.home.queued, 'cruise');
  ok = true; b.home.released(); await b.D.settle();
  assert.deepEqual([b.log.mode, b.log.entering, b.log.entered], [['cruise'], 1, 1]);
  b.home.dispose();
  const c = await mountHome({ clock: t, state: 'home' });   // no canEnter (v1, a tablet, a desktop): a tap enters at once
  c.q('.lk-pick[data-mode=cruise]').click(); await c.D.settle();
  assert.deepEqual([c.log.mode, c.log.entering], [['cruise'], 1]);
  c.home.dispose();
});
