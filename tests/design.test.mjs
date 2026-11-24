// The design system: the tokens are there and every UI reads them, the feedback mailto,
// the settings store, the credits against ATTRIBUTION.md, the loading card's mode row. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS } from '../src/ui/tokens.js';
import { feedbackMailto, sceneLines, browserName, FEEDBACK, CONTACT, ATTACH_NOTE } from '../src/ui/feedback.js';
import { createSettings, SETTINGS, QUALITY } from '../src/ui/settings.js';
import { CREDITS, COVERS } from '../src/ui/credits.js';
import { MODES, ICONS } from '../src/ui/home.js';
import { pagesHtml, welcomeHtml, PAGES_CSS } from '../src/ui/homePages.js';
import { WATERS, WATERS_SOON } from '../src/sim/waters/index.js';
import { VESSELS, VESSELS_SOON } from '../src/sim/vessels/index.js';
import { PALETTES } from '../src/ui/chartplotterData.js';
import { CAPTAIN } from '../src/ui/captainView.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const css = read('src/ui/tokens.css');
const tok = (name) => css.match(new RegExp(`--${name}:([^;]+);`))?.[1].trim();

test('tokens.css defines every token of', () => {
  for (const t of ['lk-font', 'lk-light', 'lk-book', 'lk-track', 'lk-fs-caption', 'lk-fs-body', 'lk-fs-label', 'lk-fs-title', 'lk-fs-word',
    'lk-cream', 'lk-ink', 'lk-hair', 'lk-rest', 'lk-lit', 'lk-lit-fill', 'lk-navy', 'lk-veil', 'lk-blur', 'lk-line', 'lk-radius',
    'lk-halo', 'lk-ui', 'lk-brand', 'lk-regular', 'lk-medium', 'lk-amber', 'lk-port', 'lk-stbd', 'lk-glass', 'lk-glass-blur', 'lk-glass-edge', 'lk-icon', 'lk-stroke', 'lk-ease', 'lk-ease-out', 'lk-in', 'lk-out', 'lk-rise', 'lk-stagger', 'lk-mx', 'lk-my', 'lk-z-hud', 'lk-z-page', 'lk-z-menu', 'lk-z-card']) {
    assert.ok(tok(t), `--${t}`);
  }
  assert.match(tok('lk-font'), /^'Jost'/);
  assert.equal(tok('lk-blur'), 'blur(14px) saturate(.8)');
  assert.match(tok('lk-glass-blur'), /^blur\(12px\)/, 'the plate blurs 12 px');
  assert.match(tok('lk-ui'), /^'Atkinson Hyperlegible Next'/);
  assert.equal(tok('lk-brand'), '500', 'brand type: Jost 500');
  assert.equal(tok('lk-stroke'), '1.7'); assert.equal(tok('lk-icon'), '24px');
  assert.equal(tok('lk-in'), '.6s'); assert.equal(tok('lk-out'), '.45s'); assert.equal(tok('lk-rise'), '6px');
  // one accent: binnacle amber. Port red and starboard green exist for port and starboard only.
  assert.equal(tok('lk-amber-hex').toLowerCase(), '#f7c060');
  assert.equal((css.match(/--lk-amber:/g) ?? []).length, 2, 'amber, and its night tint');
});

test('TOKENS (canvas) equal tokens.css', () => {
  assert.equal(tok('lk-cream'), TOKENS.cream.join(' '));
  assert.equal(tok('lk-navy'), TOKENS.navy.join(' '));
  assert.equal(tok('lk-shade'), TOKENS.shade.join(' '));
  assert.equal(tok('lk-cream-hex').toLowerCase(), '#' + TOKENS.cream.map((v) => v.toString(16).padStart(2, '0')).join(''));
  assert.equal(tok('lk-amber'), TOKENS.amber.join(' '));
  assert.equal(tok('lk-port'), TOKENS.port.join(' ')); assert.equal(tok('lk-stbd'), TOKENS.stbd.join(' '));
  for (const [k, a, v] of [['lk-ink', TOKENS.ink, 'cream'], ['lk-ink-soft', TOKENS.soft, 'cream'], ['lk-ink-faint', TOKENS.faint, 'cream'], ['lk-hair', TOKENS.hair, 'cream'], ['lk-rest', TOKENS.rest, 'cream'], ['lk-lit-fill', TOKENS.litFill, 'amber'], ['lk-glass', TOKENS.glass, 'brand-navy'], ['lk-glass-edge', TOKENS.glassEdge, 'cream']]) {
    const m = tok(k).match(new RegExp(`^rgb\\(var\\(--lk-${v}\\) \\/ (\\.\\d+)\\)$`));
    assert.ok(m, k); assert.equal(+m[1], a, k);
  }
  assert.ok(TOKENS.faint >= 0.8 && TOKENS.soft >= 0.8 && TOKENS.ink >= 0.9, 'no text under 80 %, ink at 90 % or more');
  const night = css.match(/:root\[data-lk-theme=night\]\{([\s\S]*?)\n\}/)[1];
  for (const k of ['cream', 'amber', 'port', 'stbd', 'navy', 'shade']) assert.equal(night.match(new RegExp(`--lk-${k}:([^;]+);`))[1].trim(), TOKENS.night[k].join(' '), `night ${k}`);
  assert.equal(tok('lk-in'), `.${String(TOKENS.inS).split('.')[1]}s`);
  assert.equal(PALETTES.day.ink, TOKENS.cream, 'the chart draws in the token cream');
  assert.equal(PALETTES.day.bg, TOKENS.navy, 'on the token navy');
  assert.equal(tok('lk-d').replace(/\s/g, ''), CAPTAIN.size.replace(/\s/g, ''), 'the large instrument\'s diameter (the dial and the chart share it)');
  assert.equal(CAPTAIN.on, TOKENS.ink); assert.equal(CAPTAIN.rest, TOKENS.rest);
});

test('every UI module reads the tokens: no stray cream, halo, margin or font literals', () => {
  const files = ['src/ui/controlsHint.js', 'src/ui/captainView.js', 'src/ui/logbook.js', 'src/ui/chartplotter.js', 'src/ui/toolDock.js', 'src/ui/home.js', 'src/ui/viewSwitch.js', 'src/ui/loading-shell.html', 'src/modes/chill/quietLine.js'];   // the quiet line's CSS moved out of passenger.js (quietLine.js, Velia v2's Cruise)
  for (const f of files) {
    const s = read(f);
    assert.match(s, /var\(--lk-/, `${f} uses the tokens`);
    assert.doesNotMatch(s, /239[ ,]+230[ ,]+210/, `${f}: the cream as a literal`);
    assert.doesNotMatch(s, /rgb\(6 12 18/, `${f}: the halo's dark as a literal`);
    assert.doesNotMatch(s, /clamp\(28px,3\.2vw,56px\)|clamp\(26px,4\.6vh,50px\)/, `${f}: a safe margin as a literal`);
    assert.doesNotMatch(s, /font:\s*[0-9]{3} [^;]*'Jost'/, `${f}: the font as a literal`);
    assert.doesNotMatch(s.replace(/@font-face\{[^}]*\}/g, ''), /'Jost'|'Atkinson/, `${f}: a font family name outside @font-face`);
    assert.doesNotMatch(s, /font-weight:\s*300(?![\d ])/, `${f}: nothing draws in Jost 300 but the loading card`);
  }
  for (const f of ['src/ui/controlsHint.js', 'src/ui/captainView.js', 'src/ui/logbook.js', 'src/ui/chartplotter.js', 'src/ui/toolDock.js', 'src/ui/home.js', 'src/ui/viewSwitch.js']) {
    assert.match(read(f), /ensureTokens\(\)/, `${f} makes sure the page has the tokens`);
  }
});

test('the first paint has the tokens inline (index.html and the loading demo), copied from tokens.css', () => {
  const body = css.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  for (const page of ['index.html', 'demos/loading.html']) {
    const html = read(page);
    const block = html.match(/<style id="lk-tokens">([\s\S]*?)<\/style>/)?.[1];
    assert.ok(block, `${page}: the lk-tokens style`);
    assert.deepEqual(block.trim().split('\n').map((l) => l.trim()).filter(Boolean), body, `${page}: the tokens as in tokens.css`);
    assert.ok(html.indexOf('id="lk-tokens"') < html.indexOf('#lk-load{'), `${page}: the tokens before the card's CSS`);
  }
});

test('the loading page carries no mode row (the menu does: Cruise · Sail · Regatta); the card still marks the mode', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<p class="lk-mode"/);
  assert.match(html, /lk-m-cruise' : 'lk-m-sail'/, 'the mode the card speaks for, from ?mode=');
});

test('the menu: the mode row, Regatta chosen like the others; the icons are vectors', () => {
  assert.deepEqual(MODES.map((m) => m.id), ['cruise', 'sail', 'regatta']);
  assert.equal(MODES.find((m) => m.id === 'regatta').soon, undefined);
  assert.ok(!MODES.find((m) => m.id === 'sail').soon && !MODES.find((m) => m.id === 'cruise').soon);
  for (const [k, svg] of Object.entries(ICONS)) {
    assert.match(svg, /^<(path|circle|rect)/, k);
    assert.doesNotMatch(svg, /<image|data:image|href=/, `${k}: vector only`);
  }
  // the pages' stylesheet (createHome injects it): the icons draw at the stroke token (1.7 px). In a real browser, with
  // the mark top-left (the chart owns top-right): tests/pages/design.page.mjs
  const ic = PAGES_CSS.match(/#lk-load \.ic\{([^}]*)\}/)?.[1];
  assert.ok(ic, 'the pages style their icons'); assert.match(ic, /stroke-width:var\(--lk-stroke\)/, 'the icons draw at the stroke token (1.7 px)');
});

test('feedback: a prefilled mailto to the contact address; the scene only when ticked; no endpoint', () => {
  assert.equal(CONTACT, 'contact@lucidlakelabs.com');
  assert.equal(FEEDBACK.endpoint, null, 'no network endpoint until the owner says go');
  const scene = { mode: 'sail', windLevel: 3, hour: 18.75, x: 1200.4, z: -1050.2, headingDeg: 251, browser: 'Chrome 141 · macOS', gpuMs: 8.123, viewport: '1280×720 @1.00' };
  const m = feedbackMailto({ text: 'The jib & the hints?\nLine two', email: 'a@b.co', scene });
  assert.ok(m.startsWith('mailto:contact@lucidlakelabs.com?subject=Velia%20feedback&body='));
  const body = decodeURIComponent(m.split('body=')[1]);
  assert.match(body, /^The jib & the hints\?\nLine two\n/);
  assert.match(body, /reply to: a@b\.co/);
  for (const line of ['mode: sail', 'wind level: 3', 'hour: 18:45', 'position: 1200, -1050 m, heading 251°', 'browser: Chrome 141 · macOS', 'gpu frame: 8.12 ms']) assert.ok(body.includes(line), line);
  assert.equal(m.split('?')[1].split('&').length, 2, 'two fields only: an & in the text is encoded');
  const bare = decodeURIComponent(feedbackMailto({ text: 'hi', scene: null }).split('body=')[1]);
  assert.doesNotMatch(bare, /mode:|position:|browser:/, 'unticked: no scene');
  assert.doesNotMatch(bare, /reply to/, 'no email: no reply line');
  const long = feedbackMailto({ text: 'x'.repeat(5000) });
  assert.ok(decodeURIComponent(long.split('body=')[1]).length < FEEDBACK.maxText + 20, 'the text is cut to maxText');
  assert.equal(sceneLines({}).length, 7);
  assert.match(ATTACH_NOTE, /mode.*wind level.*hour.*position.*browser.*frame time/);
  assert.equal(browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'Chrome 141 · macOS');
  assert.equal(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'), 'Safari 26 · iOS');
});

test('the page never calls a feedback endpoint: no fetch, beacon or form post in the menu or the shell', () => {
  for (const f of ['src/ui/home.js', 'src/ui/homePages.js', 'src/ui/attract.js', 'src/ui/feedback.js']) {
    const s = read(f).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(s, /fetch\(|sendBeacon|XMLHttpRequest|method=["']post/i, f);
  }
});

test('settings: defaults, a store per browser, bad values refused, listeners told', () => {
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = createSettings({ storage });
  assert.deepEqual(s.all(), SETTINGS);
  const seen = []; s.on((k, v) => seen.push([k, v]));
  s.set('music', false); s.set('quality', 'balanced'); s.set('quality', 'ultra'); s.set('pilot', 'no'); s.set('nope', 1);
  assert.deepEqual(seen, [['music', false], ['quality', 'balanced']]);
  const again = createSettings({ storage });
  assert.equal(again.get('music'), false); assert.equal(again.get('quality'), 'balanced'); assert.equal(again.get('pilot'), true);
  const broken = createSettings({ storage: { getItem: () => '{not json', setItem: () => { throw new Error('full'); } } });
  assert.equal(broken.get('sound'), true); broken.set('sound', false); assert.equal(broken.get('sound'), false, 'memory only when the store throws');
  assert.deepEqual(QUALITY, ['auto', 'high', 'balanced', 'low']); s.set('quality', 'low'); assert.equal(s.get('quality'), 'low');
});

test('credits: every name is in ATTRIBUTION.md, and every section of it is covered', () => {
  const attr = read('ATTRIBUTION.md');
  for (const c of CREDITS) {
    for (const name of c.note.match(/[A-Za-z_][\w]*(?=[,.])/g) ?? []) if (/^[a-z_]*[A-Z_]|^[a-z]+\d|^_/.test(name)) assert.ok(attr.includes(name), `${name} in ATTRIBUTION.md`);
  }
  for (const n of ['OpenStreetMap', 'U.S. Geological Survey', 'MusicAPI', 'ambientCG', 'Owen Earl', 'CC0']) assert.ok(attr.includes(n) && JSON.stringify(CREDITS).includes(n), n);
  const lines = new Set(CREDITS.map((c) => c.what));
  for (const [, h] of attr.matchAll(/^## (.+)$/gm)) {
    const sec = CREDITS.find((c) => h.startsWith(c.section)) ?? Object.entries(COVERS).find(([k]) => h.startsWith(k));
    assert.ok(sec, `ATTRIBUTION.md section "${h}" has a credit line`);
    if (Array.isArray(sec)) assert.ok(lines.has(sec[1]), `${h} → ${sec[1]}`);
  }
});

test('the public name is Velia wherever the player reads a name; Lakeshore stays the code name', () => {
  const html = read('index.html');
  assert.match(html, /<title>Velia · Sail Lake Tahoe in your browser<\/title>/);
  assert.match(html, /aria-label="Velia"/);
  assert.match(html, /Your browser can.t run Velia/);
  const menu = pagesHtml({ waters: WATERS, vessels: VESSELS, wChosen: WATERS[0].id, vChosen: VESSELS[0].id, wSoon: WATERS_SOON, vSoon: VESSELS_SOON });
  assert.match(read('index.html'), /<h1 class="lk-word" aria-label="Velia">Velia<\/h1>/, 'the card\'s title is the public name');
  const page = (id) => menu.match(new RegExp(`<section[^>]*data-page="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';
  assert.match(page('credits'), /<p>Velia, by Lucid Lake Studio\. The lake is real: [^<]+\.<\/p>/, 'the credits open with the studio');
  assert.match(page('about'), /<span class="by">Velia is made by Zhao Lou at Lucid Lake Studio\.<\/span>/, 'the About page names the studio in full');
  assert.equal(FEEDBACK.subject, 'Velia feedback');
  for (const f of ['brand/velia-lockup-plush.svg', 'brand/velia-word-plush.svg']) assert.ok(read(f).includes('<path'), f);
  assert.doesNotMatch(read('brand/favicon.svg'), /<text/, 'the favicon carries no name');
  // nothing the player sees says Lakeshore (comments and identifiers may)
  const visible = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visible(read('src/ui/loading-shell.html')), />[^<]*Lakeshore|'Lakeshore[ a-z]|"Lakeshore"/, 'the loading card');
  // what the menu pages, the welcome, the credits and the feedback mail say (the mounted menu: tests/pages/design.page.mjs)
  const said = [menu, welcomeHtml(), JSON.stringify(CREDITS), JSON.stringify(MODES), JSON.stringify(FEEDBACK), ATTACH_NOTE,
    decodeURIComponent(feedbackMailto({ text: 'hi', email: 'a@b.co', scene: { mode: 'sail', windLevel: 3, hour: 12, x: 0, z: 0, headingDeg: 0, browser: 'x', gpuMs: 1, viewport: 'y' } }))].join('\n');
  assert.ok(said.length > 5000 && said.includes('Velia'), 'the text is there');
  assert.doesNotMatch(said.replace(/<[^>]*>/g, ' '), /Lakeshore/, 'no Lakeshore in what the player reads');
});

test('the brand navy is the logo\'s: #1C2340, not black', () => {
  assert.equal(tok('lk-brand-navy'), TOKENS.brandNavy.join(' '));
  assert.equal(tok('lk-brand-navy-hex').toLowerCase(), '#' + TOKENS.brandNavy.map((v) => v.toString(16).padStart(2, '0')).join(''));
  assert.match(read('brand/lucidlake/lucidlake-lockup-mono.svg'), /#1C2340/i, 'sampled from the logo mark');
  assert.match(tok('lk-chrome-bg'), /lk-brand-navy/, 'the capsule is navy, not near-black');
});

test('the round family: two sizes, one gap, plain glass, one lit state', () => {
  for (const t of ['lk-d', 'lk-b', 'lk-gap']) assert.ok(tok(t), `--${t}`);
  assert.match(tok('lk-b'), /^clamp\(44px,/, 'the small button is never under 44 px');
  // the dial and the chart as round instruments (lk-rd), the chart the bottom-left circle and the dial the bottom-right
  // one, both --lk-d, no readout plate under either: laid out in a real browser, tests/pages/design.page.mjs
  assert.match(css, /\.lk-rd\.on::after,button\.lk-rd:hover::after/, 'one lit state for every round piece');
  assert.doesNotMatch(css, /lk-metal|lk-ring-shadow/, 'no ornamental bezel');
  assert.match(tok('lk-d').replace(/\s/g, ''), /min\(clamp\(140px,30\.6vh,340px\),40vw\)/, 'the chart\'s original size');
});
