// The modes' public names (owner, 2026-10-29): Cruise, Sail, Regatta, School. No player-facing text may use the old
// words. The UI modules' exported data is walked (every string a src/ui module or the shell exports: labels, lines,
// tables, keys included); the pages' HTML is read with comments, <script> and <style> removed (what is left is text a
// player can read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { modeId, MODE_LABELS } from '../src/modeNames.js';
import { MODES } from '../src/ui/home.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const OLD = /chill|day[ -]?sail|racing|sailing[ -]school/i;

const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const htmlFiles = ['index.html', 'demos/loading.html', 'src/ui/loading-shell.html'];

// every string in an exported value (objects, arrays, frozen tables; their keys too), with where it sits
function strings(v, path, out = [], seen = new Set()) {
  if (typeof v === 'string') { out.push([path, v]); return out; }
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  for (const [k, x] of Object.entries(v)) { out.push([`${path}.${k} (key)`, k]); strings(x, `${path}.${k}`, out, seen); }
  return out;
}
const uiModules = ['src/ui/', 'classic/src/ui/'].flatMap((d) => readdirSync(new URL(d, root)).filter((f) => f.endsWith('.js')).map((f) => `${d}${f}`)).concat('classic/src/shell.js');   // C7b: v1's private UI in classic/src/ui/

test('no old mode name in the UI modules\' exported text, the shell or the pages', async () => {
  const bad = [];
  let n = 0;
  for (const f of uiModules) {
    const m = await import(new URL(f, root));
    for (const [name, v] of Object.entries(m)) for (const [where, s] of strings(v, `${f} ${name}`)) { n++; if (OLD.test(s)) bad.push(`${where}: ${s.trim().slice(0, 100)}`); }
  }
  assert.ok(n > 2000, `${n} strings walked`);
  for (const f of htmlFiles) for (const l of stripHtml(read(f)).split('\n')) if (OLD.test(l)) bad.push(`${f}: ${l.trim().slice(0, 100)}`);
  assert.deepEqual(bad, []);
});

test('the inline script of the pages keeps the old ?mode= values working (the only place the old word may sit in a page)', () => {
  for (const f of ['index.html', 'demos/loading.html']) assert.match(read(f), /mode=\(cruise\|chill\)/, f);
});

test('the menu row and the shell captions use the public names', () => {
  assert.deepEqual(MODES.map((m) => [m.id, m.label]), [['cruise', 'Cruise'], ['sail', 'Sail'], ['regatta', 'Regatta']]);
  assert.equal(MODES.find((m) => m.id === 'regatta').soon, undefined);
  for (const l of Object.values(MODE_LABELS)) assert.doesNotMatch(l, OLD);
  assert.deepEqual([MODE_LABELS.cruise, MODE_LABELS.sail, MODE_LABELS.regatta, MODE_LABELS.school], ['Cruise', 'Sail', 'Regatta', 'School']);
});

test('?mode= aliases: the old values map to the new ids', () => {
  const want = { cruise: 'cruise', chill: 'cruise', CHILL: 'cruise', sail: 'sail', daysail: 'sail', 'day-sail': 'sail', day_sail: 'sail', regatta: 'regatta', racing: 'regatta', race: 'regatta', school: 'school', 'sailing-school': 'school', fly: 'fly', nonsense: null, '': null };
  for (const [k, v] of Object.entries(want)) assert.equal(modeId(k), v, k);
  assert.equal(modeId(null), null);
});
