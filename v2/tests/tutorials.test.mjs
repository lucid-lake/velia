// Help › Tutorials and Help › About on v2 (owner, 2026-11-18): the chaptered tutorial and the one About page. Behaviour of the pure
// parts: the chapters' shape, every key cap against v2/ui/keyMap.js, the finger's and the phone's words carry no key, the About page's
// hooks (the address, copy, Send feedback, the Ko-fi link). The page itself: v2/tests/pages/tutorials.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, tutorialsHtml, capsIn, COCKPIT_PARTS, PHONE_PARTS } from '../ui/tutorials.js';
import { KEY_ROWS, FLAT_ROWS } from '../ui/keyMap.js';
import { aboutHtml, ABOUT } from '../ui/aboutPage.js';
import { TUTORIALS } from '../../src/ui/homePages.js';

const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const rows = new Map(KEY_ROWS.map((r) => [r.id, r]));

test('twelve chapters a newcomer can read: a title, 1 to 6 short lines, a Try it line each', () => {
  assert.deepEqual(CHAPTERS.map((c) => c.id), ['first', 'cockpit', 'wind', 'nav', 'tack', 'gusts', 'anchor', 'start', 'time', 'tessie', 'race', 'keys']);
  for (const c of CHAPTERS) {
    assert.ok(c.title && c.title.length <= 32, `${c.id}: a short title (${c.title})`);
    assert.ok(c.lines.length >= 1 && c.lines.length <= 6, `${c.id}: ${c.lines.length} lines`);
    assert.ok(c.try && (typeof c.try === 'string' || (c.try.k && c.try.t)), `${c.id}: a Try it line`);
  }
  const h = tutorialsHtml();
  assert.equal((h.match(/class="tu-li"/g) ?? []).length, 12, 'the list names every chapter');
  assert.equal((h.match(/<article class="tu-c"/g) ?? []).length, 12, 'one view per chapter');
  assert.equal((h.match(/<article class="tu-c"[^>]* hidden>/g) ?? []).length, 11, 'one chapter shown at a time');
  assert.equal((h.match(/class="tu-try"/g) ?? []).length, 12, 'every chapter ends with Try it');
});

test('every key cap named is one of its key-map row\'s caps (v2/ui/keyMap.js)', () => {
  const caps = capsIn(tutorialsHtml());
  assert.ok(caps.length >= 24, `the chapters name keys (${caps.length} caps)`);
  for (const { row, k } of caps) {
    const r = rows.get(row);
    assert.ok(r, `a key-map row "${row}"`);
    assert.ok(r.k.includes(k), `"${k}" is a cap of ${row} (${r.k.join(' ')})`);
  }
  // the keys the owner named: the chart N, the menu Esc, steering A D, the turn Space, anchor J (the lean set: no ` and no K any more)
  const named = new Set(caps.map((c) => `${c.row}:${c.k}`));
  for (const want of ['chart:N', 'menu:Esc', 'steer:A', 'steer:D', 'tack:Space', 'anchor:J', 'sheets:W', 'sheets:S', 'fold:H']) assert.ok(named.has(want), want);
  // NAV has no key: the chapters never draw one for it; none for a key that went
  assert.ok(!caps.some((c) => c.row === 'auto'), 'no cap for NAV');
  assert.ok(!caps.some((c) => ['K', 'G', 'U', 'L', 'O', 'M', '`', '1', '2', '3', '4', '?'].includes(c.k)), 'no cap for a removed key');
  const all = text(tutorialsHtml());
  assert.doesNotMatch(all, /hold H|Hold H|press K|\[K\]/, 'no hold-H list, no reef key');
  assert.ok(all.includes('Mark set. Click NAV to sail there.') && all.includes('Mark set. Tap NAV to sail there.'), 'the mark\'s own line, by hand');
});

test('a cap that is not in the key map cannot be written', async () => {
  const { CHAPTERS: C, tutorialsHtml: render } = await import('../ui/tutorials.js');
  assert.throws(() => render([{ ...C[0], lines: ['Press {key:chart:M}.'] }]), /not a cap of key-map row "chart"/);
  assert.throws(() => render([{ ...C[0], lines: ['Press {key:nope}.'] }]), /no key-map row/);
});

test('the finger\'s and the phone\'s words name no key; the keyboard\'s say click where the finger says tap', () => {
  for (const c of CHAPTERS) for (const l of [...c.lines, c.try]) {
    if (typeof l === 'string') { assert.doesNotMatch(l, /\{key:|\bclick|\bpress\b/i, `${c.id}: a line for every hand has no key (${l.slice(0, 60)})`); continue; }
    for (const w of [l.t, l.f].filter(Boolean)) {
      assert.doesNotMatch(w, /\{key:/, `${c.id}: no key in "${w.slice(0, 60)}"`);
      assert.doesNotMatch(w, /\bclick/i, `${c.id}: a finger taps ("${w.slice(0, 60)}")`);
    }
  }
});

test('the facts the owner asked for are there, true to the code', () => {
  const all = text(tutorialsHtml());
  for (const s of ['NAV', 'Set as target', 'beating', 'layline', 'no-go zone', 'in irons', 'Overpowered — ease the sails or reef', 'past 55°', 'Start again',
    'Cruise never knocks down', 'A · 0 · 1 · 2', '3 to 20 m', 'Boat Camp', '22 white balls', 'Sail from here', 'Tessie’s water',
    'Never charge her', 'Tessie said no.', '21:44', 'Dawn 05:36', 'Osprey 17', 'to port', 'starboard tack', 'Settings that help', 'your sailing', 'Set sail', 'Resume', 'Cruise ⇄', 'Add waypoint', 'Set course', 'Clear route', 'double-click']) assert.ok(all.includes(s), s);
  // what is not on main stays out: no glass boat, no white rival hulls, no meteors; the top bar has no Chart button since the Sail ⇄ Cruise one
  assert.doesNotMatch(all, /glass[- ]bottom|glass boat|white hull|meteor|shooting star|Chart on the top bar|Tap Chart/i);
  assert.doesNotMatch(all, /Surprise me|for a random one/, 'Surprise me is gone (owner, 2026-11-25)');
  assert.match(all, /Off Fannette/, 'the start page names Off Fannette (Tessie\u2019s water joined it)');
  assert.doesNotMatch(all, /show the welcome again|welcome-again/, 'no skill question to reopen (owner 2026-11-21: Setup only)');
  assert.doesNotMatch(all, /\(owner|research\/|notes\/|BACKLOG|Lakeshore/, 'no internal names');
});

test('the cockpit picture and the phone\'s: every numbered point inside its picture, one legend line each', () => {
  for (const parts of [COCKPIT_PARTS, PHONE_PARTS]) for (const p of parts) {
    assert.ok(p.w > 0 && p.h > 0 && /\.webp/.test(p.src), p.src);
    for (const [x, y, label] of p.pins) assert.ok(x > 0 && x < 1 && y > 0 && y < 1 && label.length > 3, `${label}: inside (${x}, ${y})`);
  }
  const names = COCKPIT_PARTS.flatMap((p) => p.pins.map((q) => q[2])).join(' | ');
  for (const s of ['Chart', 'JIB winch', 'Round key', 'NAV', 'SAILS', 'ANCHOR', 'REEF', 'MAIN winch', 'Coach', 'Hide tab']) assert.ok(names.includes(s), s);
});

test('v1 keeps its own Tutorials list (src/ui/homePages.js), untouched', () => {
  assert.deepEqual(TUTORIALS.map((r) => r[0]), ['First sail', 'Hints', 'Wind lines', 'Sailor’s words', 'Every key']);
});

test('About: Velia, Get in touch, Support Velia, Privacy and the version, with the old pages\' hooks; two panels (tabs on a phone)', () => {
  const h = aboutHtml({ versionLine: 'Version 0.7 · dev', playtest: true });
  const t = text(h.replace(/<span class="ab-nw">([^<]*)<\/span>/g, '$1'));   // the lead keeps "no sign-up" on one line
  for (const s of [ABOUT.lead, ABOUT.by, 'lucidlakelabs.com', 'Get in touch', 'contact@lucidlakelabs.com', 'Send feedback', 'Support Velia', 'Buy the skipper a coffee', 'Privacy', 'No cookies, no personal data.', 'Version 0.7', 'What’s new']) assert.ok(t.includes(s), s);
  assert.match(h, /<span class="mail">contact@lucidlakelabs\.com<\/span><button class="pbtn" type="button" data-act="copy">/, 'the address and copy (home.js copy())');
  assert.match(h, /href="mailto:contact@lucidlakelabs\.com"/);
  assert.match(h, /data-go="feedback"/);
  assert.match(h, /<a class="pbtn kl" href="https:\/\/ko-fi\.com\/lucidlake" target="_blank" rel="noopener" data-support="about">/, 'the Ko-fi link, counted as about');
  assert.match(h, /data-act="export-session"/, 'the playtest export when asked');
  assert.doesNotMatch(aboutHtml({}), /export-session/);
  assert.match(h, /data-go="news"/, 'What\'s new from the version line');
  assert.match(h, /role="tab"[^>]*data-tab="velia"/); assert.match(h, /data-tab="touch"/);
  assert.match(h, /data-tp="velia"[^>]*>[\s\S]*Privacy[\s\S]*stamp-b[\s\S]*data-tp="touch"[^>]*hidden>[\s\S]*Get in touch[\s\S]*Support Velia/, 'Velia, Privacy and the version in one panel; contact and support in the other');
});

test('the phone\'s Controls rows name its flat controls, never the cockpit\'s wheel, winch or lever', () => {
  const t = FLAT_ROWS.map(([a, b]) => `${a} ${b}`).join(' | ');
  assert.doesNotMatch(t, /wheel|winch|lever|helm strip/i);
  for (const s of ['left ring', 'right ring', 'bottom-left corner', 'bottom-right corner', '⋯', 'Cruise ⇄', 'Menu', 'chart']) assert.ok(t.includes(s), s);
});
