// What's new (src/ui/news.js): every entry is well formed, newest first, and player-facing only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEWS, BUILD_ID, VERSION, VERSION_LINE, newsReleases, prettyDate } from '../src/ui/news.js';
import { NEWS_V2, NEWS as NEWS_V2_ALL, V2_NEWS } from '../v2/ui/news.js';

const FORBIDDEN = /lakeshore|owner|\bCEO\b|agent|contractor|window|team|notes\/|\.(js|mjs|md|json|html)\b|\/Users|\b[0-9a-f]{7,40}\b|metric|analytic|telemetry|\bkeys?\s+(?:are|is)\b|api[- ]?key|secret|token|cloudflare|hosting|deploy|worker|golden|bless|commit|branch|merge/i;

const LISTS = [['v1', NEWS], ['v2', NEWS_V2_ALL]];
test('entries are well formed and newest first (v1\'s list and v2\'s)', () => {
  for (const [, list] of LISTS) {
  assert.ok(list.length >= 10 && list.length <= 80, `${list.length} entries`);   // one scrolling page, older releases folded
  let prev = '9999-99-99';
  for (const n of list) {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(n.date <= prev, `not newest first at ${n.date}`); prev = n.date;
    assert.ok(typeof n.text === 'string' && n.text.length > 10 && n.text.length <= 140, `text: ${n.text}`);
    assert.ok(typeof n.see === 'string' && n.see.length > 5 && n.see.length <= 80, `see: ${n.see}`);
    assert.ok(n.date >= '2026-10-29', 'nothing before the first public day');
  }
  }
});

test('v1 (/classic/) is frozen: its list ends at 6 November; v2\'s own releases sit on top of it', () => {
  assert.equal(NEWS[0].date, '2026-11-06');
  assert.ok(NEWS_V2.length > 0 && NEWS_V2.every((n) => n.date > NEWS[0].date), 'v2\'s entries are newer than v1\'s');
  assert.deepEqual(NEWS_V2_ALL, [...NEWS_V2, ...NEWS]);
  assert.equal(V2_NEWS.cardLine, `Version ${V2_NEWS.version} · ${prettyDate(NEWS_V2[0].date)}`);
  assert.notEqual(V2_NEWS.version, VERSION, 'v2 counts its own release days');
});

test('no internal words, paths or ids in any entry', () => {
  for (const n of NEWS_V2_ALL) for (const s of [n.text, n.see]) assert.doesNotMatch(s, FORBIDDEN, s);
});

test('releases hold every entry once, one per date, newest first; dates read plainly; a build id exists', () => {
  const rel = newsReleases();
  assert.equal(rel.flatMap((r) => r.items).length, NEWS.length);
  assert.deepEqual(rel.map((r) => r.date), [...new Set(NEWS.map((n) => n.date))], 'one release a date, in NEWS order');
  assert.equal(prettyDate('2026-11-04'), '4 November');
  assert.ok(typeof BUILD_ID === 'string' && BUILD_ID.length > 0);
});

test('the version counts release days and reads plainly', () => {
  assert.equal(VERSION, `0.${new Set(NEWS.map((n) => n.date)).size}`);
  assert.match(VERSION_LINE, /^Version 0\.\d+ · \S+$/);
});
