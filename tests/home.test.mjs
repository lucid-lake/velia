// The home card: the idle attract's timer and its return, the URL switches, the data the pages
// read, the card's contract in the shell, the Cruise key. The card runs here on a stub DOM (tests/helpers/dom-card.mjs,
// home-mount.mjs) with the real shell markup; the browser side is tools/probe_home.mjs, tests/pages/menu.page.mjs and
// tests/pages/shellSettings.page.mjs (the shell's half), tests/pages/cruiseKey.page.mjs (the ` key in Sail). Run: node --test tests/
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createIdle, attractSettings, ATTRACT_S } from '../src/ui/attract.js';
import { MODES, ICONS } from '../src/ui/home.js';
import { PAGES_CSS } from '../src/ui/homePages.js';
import { KEYMAP, KEY, collisions } from '../src/sail/keys.js';
import { SETTINGS, DISPLAY, QUALITY } from '../src/ui/settings.js';
import { GROUPS, LIST_ROWS, keysPageHtml } from '../src/ui/keysContent.js';
import { mountHome } from './helpers/home-mount.mjs';
import { parse } from './helpers/dom-card.mjs';

test('attract: 45 s untouched sends the card away; any input before that starts the count again', () => {
  const log = [];
  const idle = createIdle({ onAway: () => log.push('away'), onBack: () => log.push('back') });
  assert.equal(ATTRACT_S, 45); assert.equal(idle.idleS, 45);
  idle.tick(100); assert.deepEqual(log, [], 'not armed: no count');
  idle.arm();
  idle.tick(30); idle.poke(); idle.tick(30); idle.poke(); idle.tick(44.9);
  assert.deepEqual(log, [], '30 + 30 with a poke between, then 44.9: still here');
  idle.tick(0.2);
  assert.deepEqual(log, ['away']); assert.equal(idle.away, true);
  idle.tick(500); idle.poke(); assert.deepEqual(log, ['away'], 'once, and a poke does not bring it back');
});

test('attract: a key, click or touch (wake) brings the card back, and it counts from 0 again', () => {
  const log = [];
  const idle = createIdle({ idleS: 10, onAway: () => log.push('away'), onBack: () => log.push('back') });
  assert.equal(idle.wake(), false, 'nothing to wake');
  idle.arm(); idle.tick(10);
  assert.equal(idle.wake(), true); assert.deepEqual(log, ['away', 'back']); assert.equal(idle.away, false);
  idle.tick(9.9); assert.deepEqual(log, ['away', 'back']);
  idle.tick(0.2); assert.deepEqual(log, ['away', 'back', 'away'], 'and again after another 10 s');
});

test('attract: a page opening or Enter stops the count; the esc card never arms it', async (t) => {
  const log = [];
  const idle = createIdle({ idleS: 5, onAway: () => log.push('away'), onBack: () => log.push('back') });
  idle.arm(); idle.tick(3); idle.disarm(); idle.tick(60);
  assert.deepEqual(log, []);
  idle.arm(); idle.tick(5); idle.disarm(); assert.equal(idle.away, false, 'disarmed while away: the card is simply back');
  assert.deepEqual(log, ['away']);
  // only the home card, on its main page, counts
  const c = await mountHome({ clock: t, state: 'company' });
  c.home.show('home', false); assert.equal(c.home.idle.armed, false, 'loading: no count');
  c.root.dataset.state = 'home'; c.home.show('home', false); assert.equal(c.home.idle.armed, true, 'the live home card counts');
  c.home.show('settings', false); assert.equal(c.home.idle.armed, false, 'a page stops it');
  c.home.show('home', false); assert.equal(c.home.idle.armed, true, 'back on the main page');
  c.D.press(c.q('.lk-go')); assert.equal(c.home.idle.armed, false, 'Enter stops it');
  c.root.dataset.state = 'gone'; c.home.open(); assert.equal(c.home.state, 'menu');
  assert.equal(c.home.idle.armed, false, 'the esc card (menu) never arms it');
  c.home.show('settings', false); c.home.show('home', false); assert.equal(c.home.idle.armed, false);
  c.home.dispose();
});

test('attract: ?attract=0 turns it off; automation skips it unless ?attract=1; ?attractS= shortens it', () => {
  assert.deepEqual(attractSettings('', false), { on: true, idleS: 45 });
  assert.equal(attractSettings('?attract=0', false).on, false);
  assert.equal(attractSettings('', true).on, false, 'a webdriver browser skips it');
  assert.equal(attractSettings('?attract=1', true).on, true);
  assert.equal(attractSettings('?attract=1&attractS=3', true).idleS, 3);
  assert.equal(attractSettings('?attractS=-1', false).idleS, 45);
});

test('attract: the card keeps the plan; the world is switched to Cruise and back with the quiet flag, no sound before a gesture', async (t) => {
  // any sound object made on the way fails the test: Cruise's own music waits for the browser's first gesture
  const made = [];
  const trap = (name) => class { constructor() { made.push(name); } start() { made.push(name + '.start'); } play() { made.push(name + '.play'); return Promise.resolve(); } };
  const saved = { AudioContext: globalThis.AudioContext, Audio: globalThis.Audio, webkitAudioContext: globalThis.webkitAudioContext };
  Object.assign(globalThis, { AudioContext: trap('AudioContext'), Audio: trap('Audio'), webkitAudioContext: trap('webkitAudioContext') });
  try {
    const c = await mountHome({ clock: t, state: 'home', idleS: 5 });
    assert.equal(c.home.idle.armed, true);
    c.home.idle.tick(5);
    assert.equal(c.home.state, 'attract', 'the card slides aside');
    await c.D.settle();
    assert.deepEqual(c.log.mode, ['cruise'], 'the world plays Cruise');
    assert.equal(c.home.mode, 'sail', 'an attract switch never changes the chosen plan (planState.js: quiet keeps it)');
    const game = []; addEventListener('keydown', (e) => game.push(e.code));
    const k = c.D.key('KeyA');
    assert.equal(c.home.state, 'home', 'a key brings the card back'); assert.ok(k.immediate, 'and stops there');
    assert.deepEqual(game, []);
    await c.D.settle();
    assert.deepEqual(c.log.mode, ['cruise', 'sail'], 'back on the plan the card shows');
    assert.equal(c.home.mode, 'sail');
    // a second round, woken by a press on the card
    c.home.idle.tick(5); await c.D.settle(); assert.equal(c.home.state, 'attract');
    c.D.fire(c.card, 'pointerdown'); await c.D.settle();
    assert.equal(c.home.state, 'home'); assert.deepEqual(c.log.mode, ['cruise', 'sail', 'cruise', 'sail']);
    // a quiet switch keeps the plan; a switch that is not the attract's (the shell landing a pick) moves it
    c.home.setMode('cruise'); assert.equal(c.home.mode, 'cruise', 'an ordinary landing is the new plan');
    c.home.dispose();
    assert.deepEqual(made, [], 'the card starts no sound');
  } finally { Object.assign(globalThis, saved); }
});

test('the plan row: Cruise, Sail, Regatta, in that order; Sail is the default; the icons are vectors', async (t) => {
  assert.deepEqual(MODES.map((m) => m.id), ['cruise', 'sail', 'regatta']);
  assert.equal(MODES[2].soon, undefined);
  for (const svg of Object.values(ICONS)) assert.doesNotMatch(svg, /<image|data:image|href=/);
  const c = await mountHome({ clock: t });
  assert.deepEqual(c.root.querySelectorAll('.lk-pick').map((b) => [b.dataset.mode, b.getAttribute('aria-checked')]), [['cruise', 'false'], ['sail', 'true'], ['regatta', 'false']]);
  c.home.dispose();
});

test('the Settings page keeps every row the old menu had, on the same settings keys (legible: display, larger text; mastery: words, assists)', async (t) => {
  const wind = { level: 3, get() { return this.level; }, set(n) { this.level = n; } };
  const c = await mountHome({ clock: t, state: 'home', wind, can: { wind: () => true } });
  const pg = c.q('.pg[data-page=settings]');
  for (const row of ['sound', 'assists', 'words', 'wind', 'quality', 'display']) assert.ok(pg.querySelector(`[data-set=${row}]`), row);
  // the switches: each on its stored key; a click flips it and the switch shows it
  for (const k of ['sound', 'music', 'effects', 'pilot', 'hints', 'largeText']) {
    assert.ok(k in SETTINGS, k);
    const b = pg.querySelector(`.opt[data-t=${k}]`); assert.ok(b, k);
    const was = c.settings.get(k);
    b.click(); assert.equal(c.settings.get(k), !was, `${k} flips`); assert.equal(b.getAttribute('aria-checked'), String(!was));
    b.click(); assert.equal(c.settings.get(k), was);
  }
  // the radios: words, display, quality write the stored key; wind sets the live level
  for (const [r, k, v] of [['words:sailor', 'words', 'sailor'], ['words:both', 'words', 'both'], ...DISPLAY.map((d) => [`display:${d}`, 'display', d]), ...[['high', 'high'], ['low', 'low'], ['auto', 'auto']].map(([r, q]) => [`quality:${r}`, 'quality', q])]) {   // the three cards (Auto · High · Battery)
    const b = pg.querySelector(`[data-r="${r}"]`); assert.ok(b, r);
    b.click(); assert.equal(c.settings.get(k), v, r); assert.equal(b.getAttribute('aria-checked'), 'true', `${r} shows checked`);
  }
  assert.deepEqual(DISPLAY, ['auto', 'day', 'night']);
  pg.querySelector('.opt[data-r="display:night"]').click();
  assert.equal(JSON.parse(c.storage.mem.get('lakeshore.settings.v1')).display, 'night', 'a click writes the stored key the shell\'s theme reads');
  for (const n of [1, 2, 3, 4]) { const b = pg.querySelector(`.opt[data-r="wind:${n}"]`); assert.ok(b, `wind ${n}`); b.click(); assert.equal(wind.level, n); }
  c.home.dispose();
});

test('the choice is saved in this browser next to the URL\'s ?waters= and ?vessel=', async (t) => {
  assert.equal(SETTINGS.waters, 'tahoe-emerald'); assert.equal(SETTINGS.vessel, 'halcyon');
  const c = await mountHome({ clock: t, state: 'home' });
  c.settings.set('waters', 'elsewhere'); c.settings.set('vessel', 'elsewhere');
  c.q('.tile[data-waters=tahoe-emerald]').click();
  assert.equal(c.settings.get('waters'), 'tahoe-emerald', 'the pick is saved'); assert.deepEqual(c.log.waters, [], 'the same lake: no reload');
  c.q('.tile[data-vessel=halcyon]').click();
  assert.equal(c.settings.get('vessel'), 'halcyon'); assert.deepEqual(c.log.vessel, []);
  // another lake or boat (none is ready yet: a stand-in tile) is saved and handed to the shell, which reloads with it (shellSettings.page.mjs)
  for (const [k, list] of [['waters', c.log.waters], ['vessel', c.log.vessel]]) {
    const t = c.q(`.tile[data-${k}]`), other = c.D.document.createElement('button');
    other.className = 'tile'; other.dataset[k] = 'kawartha'; t.parentNode.appendChild(other);
    other.click();
    assert.equal(c.settings.get(k), 'kawartha'); assert.deepEqual(list, ['kawartha']); assert.equal(c.home[k], 'kawartha');
  }
  c.home.dispose();
});

test('the Cruise key: ` , free in the table, taught by the dock\'s hover label and the H list', () => {
  assert.equal(KEY.cruise, 'Backquote');
  assert.deepEqual(KEYMAP.filter((k) => k.code === 'Backquote').length, 1);
  assert.deepEqual(collisions(), []);
  // the H list and the Keys page share one table: both say it, on the ` cap (the key itself and the dock: cruiseKey.page.mjs)
  const row = GROUPS.flatMap((g) => g.rows).find((r) => r.v === 'let her sail herself');
  assert.deepEqual(row?.k, ['`']);
  // the cap just before each "let her sail herself" label
  const said = (html, cls) => { const out = []; const walk = (ns) => { for (const n of ns) { if (n.nodeType !== 1) continue; if (n.classList.contains(cls) && n.textContent.startsWith('let her sail herself')) { const sib = n.parentNode.children; out.push(sib[sib.indexOf(n) - 1]?.textContent); } walk(n.childNodes); } }; walk(parse(`<div>${html}</div>`, null)); return out; };
  { const k = said(keysPageHtml(), 'kv'); assert.ok(k.length >= 1 && k.every((x) => x === '`'), `the Keys page: ${k}`); }
  assert.deepEqual(LIST_ROWS.flatMap((l) => said(l, 'label')), ['`'], 'the H list');
});

test('the card in play: Esc and the mark bring back the same card; Esc steps back a page, then Resume; keys never reach the boat', async (t) => {
  const c = await mountHome({ clock: t, state: 'home' });
  assert.equal(c.q('.lk-go .pq').textContent, 'ENTER', 'the live card says ENTER');
  const game = []; addEventListener('keydown', (e) => game.push(e.code));   // the game's listener: bubble phase, on window
  c.root.dataset.state = 'gone';
  c.D.key('Escape'); assert.equal(c.home.state, 'menu', 'Esc in play opens the card'); assert.equal(c.log.opened, 1);
  assert.equal(c.q('.lk-go .pq').textContent, 'Resume', 'paused mid-play: Resume');
  c.q('[data-go=settings]').click(); assert.equal(c.home.view, 'settings');
  c.D.key('Escape'); assert.equal(c.home.view, 'home', 'Esc steps back a page'); assert.equal(c.home.isOpen, true);
  c.home.show('credits', false); c.D.key('Escape'); assert.equal(c.home.view, 'home', 'a Help section steps back to the card (the nav stands beside it)');
  c.home.show('feedback', false); c.D.key('Escape'); assert.equal(c.home.view, 'contact', 'Send feedback steps back to Contact');
  c.D.key('Escape'); assert.equal(c.home.view, 'home');
  for (const code of ['KeyW', 'KeyL', 'Space', 'ArrowLeft']) assert.ok(c.D.key(code).immediate, code);
  c.home.show('feedback', false); const ta = c.q('#lk-fb-text'); ta.focus();
  assert.ok(c.D.key('KeyW', { target: ta }).immediate, 'typing in the form never reaches the boat');
  c.home.show('home', false);
  assert.deepEqual(game, [], 'no key reached the game while the card was up');
    c.D.key('Escape'); assert.equal(c.home.isOpen, false, 'Esc on the main page resumes'); assert.equal(c.log.closed, 1);
  t.mock.timers.tick(500); assert.equal(c.home.state, 'gone');
  c.D.key('KeyW'); assert.deepEqual(game, ['KeyW'], 'closed: keys reach the boat again');
  c.D.press(c.home.mark); assert.equal(c.home.state, 'menu', 'the mark opens the same card');
  c.q('.lk-go').click(); assert.equal(c.home.isOpen, false, 'Resume closes it');
  c.home.dispose();
});

test('the card goes live only when the home logic is there (loading.js waits for createHome\'s setHome)', async (t) => {
  const c = await mountHome({ clock: t });
  c.home.dispose();
  const { installLoading } = await import('../src/ui/loading.js');
  window.__veliaLoading = undefined;
  const L = installLoading({ root: c.root, minCard: 0, reducedMotion: true, home: true });
  L.ready();
  for (let i = 0; i < 5; i++) c.D.frame(performance.now());
  assert.equal(c.root.dataset.state, 'company', 'ready, but no home logic yet: the card waits');
  L.setHome({ queued: null });
  c.D.frame(performance.now());
  assert.equal(c.root.dataset.state, 'home');
  L.dispose();
});

test('the pages keep the card\'s one height (owner, 2026-11-06): Setup in four tabs (Sail, Aids, Sound, Screen), each fitting the card with no scroll, the menu with no veil over the world', async (t) => {
  const shell = readFileSync(new URL('../src/ui/loading-shell.html', import.meta.url), 'utf8');
  const c = await mountHome({ clock: t, state: 'home' });
  const pg = c.q('.pg[data-page=settings]');
  assert.equal(pg.querySelectorAll('[role=tablist]').length, 1, 'one tab row: the page\'s sections are tabs, not a scroll (owner, 2026-11-09)');
  assert.deepEqual(pg.querySelectorAll('[role=tab]').map((b) => [b.dataset.tab, b.textContent]), [['sail', 'Sail'], ['aids', 'Aids'], ['sound', 'Sound'], ['screen', 'Screen']]);
  const rows = { sail: ['wind', 'weather', 'sailing', 'crewTrim', 'autoReef', 'shoalAssist', 'steady', 'kayakCam'], aids: ['assists', 'profile', 'words', 'windlines', 'keyHints', 'edgeInstruments', 'tips'], sound: ['sound', 'skipperVoice'], screen: ['display', 'hud', 'text', 'lang', 'quality'] };
  for (const [tab, keys] of Object.entries(rows)) for (const k of keys) assert.ok(pg.querySelector(`[data-tp=${tab}] [data-set=${k}]`), `${k} is on the ${tab} tab`);
  assert.equal(pg.querySelectorAll('.set').length, Object.values(rows).flat().length - (pg.querySelector('[data-set=kayakCam]') ? 0 : 1), 'every one of the 22 rows is on a tab, none dropped');
  assert.equal(pg.querySelectorAll('[data-tp]:not([hidden])').length, 1, 'one tab shows at a time');
  pg.querySelector('#tab-set-screen').click();   // the last tab is kept while the card lives
  assert.equal(pg.querySelector('[data-tp=screen]').hidden, false); assert.equal(pg.querySelector('[data-tp=sail]').hidden, true);
  assert.equal(pg.querySelector('#tab-set-screen').getAttribute('aria-selected'), 'true');
  assert.equal(pg.querySelectorAll('.setnote, .hint').length, 0, 'no hint lines');
  // the page style the card injects
  const css = c.D.document.getElementById('lk-home-css')?.textContent ?? '';
  assert.ok(css.includes(PAGES_CSS), 'the pages\' style is on the page');
  // one card height for every page (owner, 2026-11-06; replaces "the page hugs its content"): a page never resizes the card, its body scrolls
  assert.doesNotMatch(css, /#lk-load\[data-pg\][^{]*\.lk-card\{[^}]*(height|max-height|min-height):/, 'no page sets the card\'s height');
  assert.ok(css.includes('#lk-load .pg.on > .pg-b{flex:1 1 auto;min-height:0;overflow:hidden auto'), 'a long page scrolls inside its body');
  // (the measured boxes at 1280×720, 390×844 and 844×390: tests/pages/solaria.page.mjs (retired 2026-11-18))
  assert.match(shell, /#lk-load\[data-state=menu\] \.lk-veil\{display:none\}/, 'no full-screen veil in play');
  assert.match(shell, /#lk-load\[data-state=menu\]\{pointer-events:none\}/, 'the world around the card takes its own presses');
  // a press outside the card closes the menu, as the veil did (cardClose.js); a press inside does not
  c.root.dataset.state = 'gone'; c.home.open();
  const water = c.D.document.createElement('canvas'); c.D.document.body.appendChild(water);
  const inside = c.D.press(c.q('.lk-pick[data-mode=cruise]'));
  assert.equal(c.home.isOpen, true, 'a press inside keeps it'); assert.equal(inside[0].stopped, true, 'and stops at the card');
  const out = c.D.press(water);
  assert.equal(c.home.isOpen, false, 'a press outside closes it');
  assert.ok(out.every((e) => e.stopped), 'and never reaches the water');
  c.home.dispose();
});
