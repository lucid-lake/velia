// The loading screen's contract (src/ui/loading.js, the inline shell, the brand files). loading.js runs here on a stub DOM
// (tests/helpers/dom-card.mjs) with the shell markup from index.html; the shell's half (the language saved): tests/pages/shellSettings.page.mjs.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, READY_LINE, LANGS } from '../src/ui/loading.js';
import { createSettings, LANGS as SET_LANGS } from '../src/ui/settings.js';
import { installDom, shellBody } from './helpers/dom-card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const block = (html, name) => html.match(new RegExp(`<!-- lk-load:${name}[\\s\\S]*?<!-- lk-load:${name}:end -->`))?.[0];

test('the stages: fractions rise, stay under 1, every stage has a caption', () => {
  let last = -1;
  for (const [name, [caption, f]] of Object.entries(STAGES)) {
    assert.ok(f > last, `${name} ${f} after ${last}`); last = f;
    assert.ok(f < 1 && caption.length > 0);
  }
});

test('index.html and demos/loading.html carry the same shell (head and body blocks), and it is current', () => {
  const a = read('index.html'), b = read('demos/loading.html');
  assert.equal(block(a, 'head'), block(b, 'head'));
  assert.equal(block(a, 'body').replace(' data-auto', ''), block(b, 'body'));
  assert.ok(block(a, 'body').includes('data-auto') && !block(b, 'body').includes('data-auto'));
  execFileSync('python3', ['-I', 'tools/loading_shell.py', '--check'], { cwd: ROOT });
});

const main0 = () => read('index.html');
test('the shell: paints before any script, hides in headless captures, the hero page (owner, 2026-10-29: the loading page is our hero)', () => {
  const head = block(read('index.html'), 'head'), body = block(read('index.html'), 'body');
  assert.ok(head.indexOf('<script>') < head.indexOf('<style>'), 'the stub script before the CSS');
  assert.match(head, /lk-nol/);
  assert.match(head, /headless\|noload/);
  assert.match(body, /aria-label="Lucid Lake"/);
  assert.match(body, /<p class="lk-by"><svg class="lk-mk"[\s\S]*?<\/svg><span>by Lucid Lake Studio<\/span><\/p>/, 'the studio mark sits with the byline, through the progress and the invitation');
  assert.match(body, /<h1 class="lk-word" aria-label="Velia">/, 'the public name is the title');
  assert.doesNotMatch(body, /aria-label="Lakeshore"/);
  // the attract loading (owner 2026-11-07): the studio mark holds over a navy ground from the first paint and thins by a
  // class the film module adds (never a CSS clock: it waits for the film's first frame); the first still is the film's first shot
  // (golden hour off Fannette: the osprey's sky read empty as a still), preloaded from the head with a webp ladder, over a sky-to-water gradient; the loading line and the film's
  // words are in the markup; the card is away while the state is company
  assert.match(head, /\.lk-company\{[^}]*opacity:1;[^}]*transition:opacity 1\.7s cubic-bezier/);
  assert.match(head, /\.lk-company\.off\{opacity:0/);
  assert.doesNotMatch(head, /\.lk-company\{[^}]*animation:/, 'no CSS clock on the mark');
  assert.doesNotMatch(head, /rel="preload"[^>]*lucidlake-g1/, 'the studio mark is not preloaded');
  assert.match(head, /<link rel="preload" as="image" href="\/brand\/stills\/reel-golden-1920\.webp"[^>]*reel-golden-1280\.webp 1280w/);
  assert.match(body, /<img class="lk-still"[^>]*srcset="\/brand\/stills\/reel-golden-960\.webp 960w, \/brand\/stills\/reel-golden-1280\.webp 1280w, \/brand\/stills\/reel-golden-1920\.webp 1920w"/);
  assert.match(head, /\.lk-bg\{[^}]*linear-gradient\(180deg,#81848b/);
  for (const [f, max] of [['stills/reel-golden-960.webp', 80_000], ['stills/reel-golden-1280.webp', 120_000], ['stills/reel-golden-1920.webp', 260_000], ['stills/reel-fireworks-1920.webp', 260_000], ['stills/reel-clear-1920.webp', 260_000]]) assert.ok(statSync(resolve(ROOT, 'brand', f)).size < max, `${f} under ${max} B`);
  assert.match(body, /<div class="lk-prog" role="progressbar"[^>]*aria-valuenow="0">[\s\S]*class="lk-sailed"[\s\S]*class="lk-psloop"[\s\S]*<p class="lk-psay"/, 'the loading line: a boat on a line across the screen, the status under it');
  assert.match(head, /\.lk-sailed\{[^}]*transform:scaleX\(var\(--p\)\)/);
  assert.match(head, /\.lk-psloop\{[^}]*left:calc\(var\(--p\) \* 100%\)/);
  assert.match(head, /#lk-load\[data-state=company\] \.lk-card\{opacity:0!important/, 'the card waits for ready');
  assert.match(body, /<button class="lk-skip"[^>]*aria-label="Skip the film">/);
  assert.match(body, /<button class="lk-sound"[^>]*aria-pressed="false"/);
  assert.match(body, /<div class="lk-brand"><div class="lk-bword">Velia<\/div><p class="lk-bslogan">The water is real\. The helm is yours\.<\/p>/);
  // the copy: the place, the boat (a name, never a maker or a model), the invitation; no key table, no mode row
  for (const line of ['by Lucid Lake Studio', 'Emerald Bay · Lake Tahoe', 'Halcyon · 28 ft', 'The water is real. The helm is yours.', 'Checking the wind…', 'English', '中文 (soon)', 'ENTER', '38°57′ N 120°06′ W']) assert.ok(body.includes(line), line);
  // the card's order (V2, owner 2026-11-06): title, the hero paragraph, byline, the choices, the (screen-reader) status line
  const order = ['lk-word', 'lk-sub', 'lk-by', 'lk-plan', 'lk-status', 'lk-fail'].map((c) => body.indexOf(`class="${c}"`));
  assert.ok(order.every((i, k) => i > (order[k - 1] ?? -1)), `card order ${order}`);
  assert.doesNotMatch(body.match(/<p class="lk-sub">[\s\S]*?<\/p>/)[0], /Tahoe/, 'the hero line names no lake');
  assert.doesNotMatch(body, /class="lk-rule"|class="lk-what"/, 'no rule under the byline; the plain line is the hero\'s second sentence');
  assert.match(main0(), /A sailing game in your browser: real wind, real water on Lake Tahoe's Emerald Bay\. Free, no sign-up\./, 'the meta description says what Velia is');
  assert.match(body, /<p class="lk-sub">The water is real\. The helm is yours\. <span class="lk-free">Free, no sign-up\.<\/span><\/p>/, 'one hero paragraph, two sentences (V2); the one tagline (owner, 2026-11-07)');
  assert.doesNotMatch(body, /Sail a real lake in your browser/, 'the earlier hero line is gone');
  assert.doesNotMatch(body, /Catalina|C ?28\b/i, 'never the maker or the model');
  assert.doesNotMatch(body, /lk-keys|class="lk-cap"|lk-place|lk-where|lk-snd|lk-boat/, 'the key table, the place block and the boat line are gone: the float plan has them as rows');
  // the float plan (V2): the lake and the boat as one summary line (inert while loading) that opens the chooser, then the mode
  assert.match(body, /<div class="lk-plan"[^>]*>[\s\S]*class="lk-row lk-sum" type="button" data-go="waters" inert>[\s\S]*data-v="waters">Emerald Bay · Lake Tahoe<[\s\S]*data-v="vessel">Halcyon · 28 ft<[\s\S]*data-mode="cruise"[\s\S]*data-mode="sail"[\s\S]*data-mode="regatta" aria-checked="false">Regatta/);
  assert.doesNotMatch(body, /data-go="vessel"/, 'one line, one chooser');
  // one row (owner, 2026-11-06): ENTER · KEYS · SETTINGS · ABOUT; Log is back (owner, 2026-11-09), Contact is inside About, the language is the corner's
  const row = body.match(/<nav class="lk-links"[^>]*inert>([\s\S]*?)<div class="lk-foot">/)[1];
  assert.deepEqual([...row.matchAll(/<button class="lk-link[^"]*"[^>]*>(?:<span class="pq">)?([^<]+)/g)].map((m) => m[1]), ['ENTER', 'Log', 'Keys', 'Setup', 'About']);
  assert.doesNotMatch(row, /data-go="contact"|lk-lang/);
  // the voyage: the loading bar is a sloop on a hairline, driven by --p
  assert.match(body, /class="lk-wake"[\s\S]*class="lk-sloop"[\s\S]*<div class="lk-voyage">/);
  assert.match(head, /\.lk-sloop\{[^}]*translate\(calc\(var\(--p\) \* /);   // the sloop sails the pencilled course on the chart
  assert.match(head, /\.lk-wk\{width:calc\(var\(--p\) \* /);
  assert.match(head, /@property --p\{syntax:'<number>'/);
  assert.match(head, /prefers-reduced-motion:reduce/);
  const main = read('index.html');
  assert.ok(main.indexOf('/src/ui/loading.js') < main.indexOf('/classic/src/main.js'), 'the module loads before main.js');
  // the share card: absolute og:image (crawlers need it), summary_large_image
  assert.match(main, /<meta property="og:image" content="https:\/\/velia\.lucidlakelabs\.com\/brand\/social\/velia-share\.jpg" \/>/);
  assert.match(main, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(main, /<meta property="og:description" content="The water is real\. The helm is yours\. Free, no sign-up\." \/>/);
  assert.match(main, /<meta property="og:title" content="Velia" \/>/);
  assert.ok(statSync(resolve(ROOT, 'brand/social/velia-share.jpg')).size <= 150_000);
});

// loading.js on the shell markup: installLoading() (or, with auto, the module's own start as index.html runs it: data-auto, the
// URL, navigator.webdriver, a GPU-recovery resume), driven to the hand-off: ready(), then frames until the card goes live or out;
// t: the node:test context (its mocked clock)
let fresh = 0;
async function boot(t, { search = '', webdriver = false, resume = false, auto = false, opts = {} } = {}) {
  const D = installDom({ body: shellBody(), search });
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout'] });   // the line's swap, the caption, the 1.8 s dissolve: on a mocked clock
  window.__veliaLoading = { t0: performance.now() - 5000, q: [] };   // the inline stub, 5 s ago (past the card's minimum)
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { webdriver }, configurable: true });
  const ss = new Map(resume ? [['lakeshore.resume.v1', String(Date.now() - 1000)]] : []);
  globalThis.sessionStorage = { getItem: (k) => ss.get(k) ?? null, removeItem: (k) => ss.delete(k), setItem: (k, v) => ss.set(k, v) };
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) });   // reduced motion: the bar jumps, the lines swap at once
  const root = D.document.getElementById('lk-load');
  if (!auto) root.removeAttribute('data-auto');
  const mod = await import(`../src/ui/loading.js?boot=${++fresh}`);   // a fresh module: its start runs again
  Object.defineProperty(globalThis, 'navigator', nav);
  const L = auto ? window.__veliaLoading : mod.installLoading({ root, ...opts });
  L.setHome({ queued: null });   // the home logic is there (src/ui/home.js createHome hands itself over)
  const say = () => root.querySelector('.lk-say').textContent;
  const tick = () => t.mock.timers.tick(1);   // the status line swaps (at once with reduced motion)
  const live = async () => { L.ready(); for (let i = 0; i < 4 && !['home', 'out'].includes(root.dataset.state); i++) D.frame(performance.now()); tick(); };
  return { D, L, root, say, live, tick };
}

test('the home card waits for Enter by default; ?gate=0 and automated browsers go straight in', async (t) => {
  const b = await boot(t, { opts: { minCard: 0 } });
  await b.live(); assert.equal(b.root.dataset.state, 'home', 'installLoading() gates by default: the card goes live as the home card');
  for (const [search, webdriver, resume, want] of [['', false, false, 'home'], ['?gate=0', false, false, 'out'], ['', true, false, 'out'], ['?gate=1', true, false, 'home'], ['?gate=0', true, false, 'out'], ['', false, true, 'out'], ['?menu=0', false, false, 'out']]) {
    const c = await boot(t, { search, webdriver, resume, auto: true });
    assert.equal(c.root.dataset.state, 'company', 'loading');
    await c.live();
    assert.equal(c.root.dataset.state, want, JSON.stringify({ search, webdriver, resume }));
    c.L.dispose();
  }
});

test('the card never stops the gesture that starts the sound (src/audio.js listens on window); only the language chip keeps its own keys', async (t) => {
  const b = await boot(t, { opts: { minCard: 0 } });
  const audio = [];   // src/audio.js: plain window listeners, bubble phase
  for (const t of ['keydown', 'pointerdown', 'click']) addEventListener(t, (e) => audio.push(`${t}:${e.code ?? ''}`));
  b.D.key('Enter', { target: b.root.querySelector('.lk-say') }); b.D.press(b.root.querySelector('.lk-card'));
  await b.live();
  b.D.key('Enter', { target: b.root.querySelector('.lk-go') }); b.D.press(b.root.querySelector('.lk-go'));
  b.D.key('KeyW', { target: b.D.document.body });
  assert.deepEqual(audio.filter((a) => a.startsWith('keydown')), ['keydown:Enter', 'keydown:Enter', 'keydown:KeyW'], 'every key reaches the window');
  assert.equal(audio.filter((a) => a.startsWith('pointerdown')).length, 2, 'every press too');
  // the chip's own list keys stop there (the card's arrow-walk and Esc must not take them)
  const btn = b.root.querySelector('.lk-langbtn');
  const down = b.D.key('ArrowDown', { target: btn, key: 'ArrowDown' });
  assert.ok(down.immediate, 'ArrowDown on the chip is its own'); assert.equal(b.root.querySelector('.lk-langlist').hidden, false, 'and opens the list');
  const esc = b.D.key('Escape', { target: btn, key: 'Escape' });
  assert.ok(esc.immediate); assert.equal(b.root.querySelector('.lk-langlist').hidden, true, 'Esc closes the list first');
  b.L.dispose();
});

test('the brand files are current and hand-built (no text, no font)', () => {
  execFileSync('python3', ['-I', 'tools/brand/gen_lakeshore_mark.py', '--check'], { cwd: ROOT });
  for (const f of ['velia-mark-plush.svg', 'favicon.svg', 'velia-lockup-plush.svg', 'velia-word-plush.svg', 'velia-lockup-mono.svg']) {
    const s = read(`brand/${f}`);
    assert.doesNotMatch(s, /<text|font-family/, f);
  }
  assert.match(read('brand/lucidlake/lucidlake-lockup-plush.svg'), /#F6F1E7/);
});

test('the per-lake descriptor: coordinates match the world origin; the chart is current; no maker or model', async () => {
  const lakeJson = JSON.parse(read('src/waters/tahoe-emerald.json')), { ORIGIN } = await import('../src/sim/geo.js');
  assert.equal(lakeJson.lat, ORIGIN.lat); assert.equal(lakeJson.lon, ORIGIN.lon);
  assert.equal(lakeJson.invitation, undefined, 'the invitation line is gone: the status line replaced it');
  assert.ok(lakeJson.hero && lakeJson.place && lakeJson.region && lakeJson.chart.destination.name);
  assert.doesNotMatch(JSON.stringify(lakeJson), /Catalina|C ?28\b/i);
  const boatJson = JSON.parse(read('src/vessels/halcyon.json'));
  assert.ok(boatJson.name && boatJson.kind && boatJson.plate.length >= 5);
  assert.doesNotMatch(JSON.stringify(boatJson), /Catalina|C ?28\b/i, 'no maker or model on a plate');
  execFileSync('node', ['tools/brand/chart_bay.mjs', '--check'], { cwd: ROOT });
  assert.ok(statSync(resolve(ROOT, 'brand/chart-bay.svg')).size < 16_000, 'the chart fragment stays small');
});

test('the status line follows the stages, ends "Ready to cast off.", and the language chip exists (owner, 2026-10-30)', { skip: "not in the public tree: it reads a private design note" }, async () => {
  // every stage names a sailor's line; the lines move forward with the bar and never repeat out of order
  const lines = Object.values(STAGES).map((st) => st[2]);
  assert.ok(lines.every(Boolean), 'every stage has a status line');
  assert.deepEqual([...new Set(lines)], ['Checking the wind…', 'Rigging Halcyon…', 'Hoisting the main…']);
  assert.deepEqual(lines, [...lines].sort((a, b) => lines.indexOf(a) - lines.indexOf(b)), 'the lines run in order');
  assert.equal(READY_LINE, 'Ready to cast off.');
  // the markup: the first paint already has the first line, Enter stays, no copy uses the banned signs
  const body = block(read('index.html'), 'body');
  assert.match(body, /<p class="lk-invite" role="status"[^>]*><span class="lk-say">Checking the wind…<\/span><\/p>/);
  assert.match(body, /class="lk-langbtn"[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"[^>]*aria-label="Language"><span class="lk-langname">EN<\/span> <i aria-hidden="true">▾<\/i>/, 'a small "EN ▾" text control');
  assert.match(body, /data-lang="en" aria-selected="true">English<[\s\S]*data-lang="zh" aria-selected="false" aria-disabled="true"[^>]*>中文 \(soon\)</);
  assert.match(body, /<div class="lk-lang" inert>[\s\S]*?<\/div>\s*<nav class="lk-links"/, 'the chip is the card\'s top-right corner, out of the button row: inert until the card is live, like the plan rows');
  assert.match(body, /<nav class="lk-links"[^>]*inert>\s*<button class="lk-link lk-go"[^>]*><span class="pq">ENTER<\/span><\/button>/, 'Enter / Resume is the first item of the links row');
  assert.doesNotMatch(block(read('index.html'), 'head'), /\.lk-go\{[^}]*position:absolute/, 'Enter is not placed over the other buttons');
  assert.match(block(read('index.html'), 'head'), /\.lk-lang\{position:absolute;right:[^;]+;top:/, 'the language sits in the top-right corner');
  assert.match(block(read('index.html'), 'head'), /pointer:coarse\)\{\.lk-langbtn,\.lk-langlist li\{min-height:44px/, 'a 44 px target on phones');
  assert.doesNotMatch(body.replace(/<svg[\s\S]*?<\/svg>/g, ''), /[±≈≤≥]/);
  assert.doesNotMatch(body, /evening breeze|The bay is yours/);
  assert.match(block(read('index.html'), 'head'), /\.lk-sub\{[^}]*max-width:13em;text-wrap:balance/, 'the hero line wraps after "real." and clears the compass rose in the card art');
  // the picker: English now, the choice saved as settings.lang, a setLang hook for the Chinese work (P2)
  assert.deepEqual(LANGS, ['en']); assert.deepEqual(SET_LANGS, ['en']);
  const mem = new Map(), st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = createSettings({ storage: st });
  assert.equal(s.get('lang'), 'en');
  s.set('lang', 'zh'); assert.equal(s.get('lang'), 'en', 'Chinese is not selectable yet');
  s.set('lang', 'en'); assert.equal(JSON.parse(mem.get('lakeshore.settings.v1')).lang, 'en');
  assert.match(read(''), /setLang/, 'names the P2 hook');
});

test('the status line on the card: each stage says its line, the card going live says it is ready (or the mode it enters), the demo pins say it too', async (t) => {
  const b = await boot(t, { opts: { minCard: 0 } });
  for (const [name, [, , line]] of Object.entries(STAGES)) { b.L.stage(name); b.tick(); assert.equal(b.say(), line, `${name} says its line`); }
  await b.live(); assert.equal(b.root.dataset.state, 'home');
  assert.equal(b.say(), READY_LINE, 'the card going live says it is ready');
  b.L.dispose();
  const q = await boot(t, { opts: { minCard: 0 } });
  q.L.setHome({ queued: 'cruise' });   // a mode tapped while loading
  await q.live(); assert.equal(q.say(), 'Entering Cruise…');
  q.L.dispose();
  const d = await boot(t, { opts: { minCard: 0 } });
  for (const pin of ['ready', 'gate', 'home', 'out']) { d.L.pin(pin); assert.equal(d.say(), READY_LINE, `the demo pin ${pin}`); }
  d.L.pin('progress', { stage: 'trees' }); assert.equal(d.say(), STAGES.trees[2]);
  d.L.pin('company'); assert.equal(d.say(), STAGES.modules[2]);
  d.L.dispose();
});

test('the language chip: English picked and announced (the shell saves it: shellSettings.page.mjs); Chinese shows but cannot be picked yet', async (t) => {
  const b = await boot(t, { opts: { minCard: 0 } });
  const heard = []; addEventListener('lakeshore:lang', (e) => heard.push(e.detail?.lang));
  assert.equal(typeof b.L.setLang, 'function', 'the P2 hook');
  assert.equal(b.L.setLang('zh'), false); assert.deepEqual(heard, []);
  b.root.querySelector('.lk-langbtn').click(); assert.equal(b.root.querySelector('.lk-langlist').hidden, false);
  b.root.querySelector('[data-lang=zh]').click();
  assert.deepEqual(heard, [], 'the disabled option does nothing'); assert.equal(b.root.querySelector('[data-lang=en]').getAttribute('aria-selected'), 'true');
  b.root.querySelector('[data-lang=en]').click();
  assert.deepEqual(heard, ['en'], 'a pick is announced'); assert.equal(b.root.querySelector('.lk-langlist').hidden, true, 'and closes the list');
  assert.equal(b.D.document.documentElement.lang, 'en');
  assert.equal(b.L.setLang('en', { silent: true }), true); assert.deepEqual(heard, ['en'], 'the shell\'s own restore is silent');
  b.L.dispose();
});
