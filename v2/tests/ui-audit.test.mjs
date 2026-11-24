// The UI consistency audit (owner, 2026-11-21; decisions A–E agreed): Tessie's top-bar switch reads Halcyon | Tessie with the one you
// are lit; her lines go through Sail's skipper line (a tip kind, inline key caps, the lean skipper's once-ever / gap / busy rules and
// the phone's quiet rule); the Keys page has a Tessie tab only where she is playable, T included; the phone's load advice is short.
import test from 'node:test';
import assert from 'node:assert/strict';
import { topSwitchHtml, SWITCH_ORDER, createTipQueue, TESSIE_KEYS } from '../living/tessiePlayer.js';
import { LINES } from '../sim/tessiePlay.js';
import { createLeanSkipper, classOf, LEAN, TIP } from '../ui/leanSkipper.js';
import { createPhoneQuiet } from '../../src/ui/phoneQuiet.js';
import { keyTable, KEY_TABLE, KEY_TESSIE } from '../ui/keyMap.js';
import { keysPageHtml } from '../../src/ui/keysContent.js';
import { ADVICE } from '../ui/loadWords.js';

test('decision A + D: the top bar\'s switch reads Halcyon | Tessie, the one you are lit (.on, aria-pressed)', () => {
  assert.deepEqual([...SWITCH_ORDER], ['halcyon', 'tessie']);
  const html = topSwitchHtml('tessie');
  const segs = [...html.matchAll(/<button[^>]*class="seg( on)?"[^>]*data-tw="(\w+)"[^>]*aria-pressed="(\w+)"/g)].map(([, on, id, p]) => `${id}:${!!on}:${p}`);
  assert.deepEqual(segs, ['halcyon:false:false', 'tessie:true:true']);
  assert.ok(html.indexOf('>Halcyon<') < html.indexOf('>Tessie<'), 'the words in that order');
  assert.deepEqual([...topSwitchHtml('halcyon').matchAll(/class="seg on"[^>]*data-tw="(\w+)"/g)].map((m) => m[1]), ['halcyon']);
});

// a hint line as controlsHint.note behaves on v2: the lean skipper (its phoneQuiet) decides; a line it allows shows
function hintWith(lean) {
  const shown = [];
  return { shown, phoneQuiet: lean, note(text, key, speak, { kind = null } = {}) { if (lean.allow(kind)) shown.push({ text, kind }); return true; } };
}

test('her lines go through the skipper\'s line: tip kinds, caps inline, once ever, the 20 s gap and the busy rule', () => {
  for (const k of ['tip.tessie.swim', 'tip.tessie.dive', 'tip.tessie.dash', 'tip.tessie.look']) assert.equal(classOf(k), TIP, k);
  let busy = false;
  const lean = createLeanSkipper({ storage: null, busy: () => busy }), h = hintWith(lean);
  const Q = createTipQueue({ hint: () => h, active: () => true });
  Q.want('tip.tessie.swim', LINES.tip); Q.want('tip.tessie.dive', LINES.fast);
  const run = (secs) => { for (let t = 0; t < secs; t += 0.1) { lean.update(0.1); Q.step(0.1); } };
  run(0.2);
  assert.equal(h.shown.length, 1, 'one line at once');
  assert.equal(h.shown[0].kind, 'tip.tessie.swim');
  assert.match(h.shown[0].text, /<span class="cap" data-k="W">W<\/span>/, 'key caps inline'); assert.match(h.shown[0].text, /data-k="SPC"/);
  assert.doesNotMatch(h.shown[0].text, /\[/, 'no bare key marks');
  run(LEAN.gapS - 2);
  assert.equal(h.shown.length, 1, 'the second waits out the 20 s gap');
  busy = true; run(4);
  assert.equal(h.shown.length, 1, 'nothing mid-manoeuvre');
  busy = false; run(1.5);
  assert.deepEqual(h.shown.map((s) => s.kind), ['tip.tessie.swim', 'tip.tessie.dive'], 'then it shows');
  assert.equal(Q.waiting.length, 0);
  Q.want('tip.tessie.swim', LINES.tip); run(30);
  assert.equal(h.shown.length, 2, 'once ever: a shown kind is never asked again');
});

test('her lines wait while you are the boat, and a phone\'s quiet rule drops them', () => {
  const lean = createLeanSkipper({ storage: null }), h = hintWith(lean);
  let playing = false;
  const Q = createTipQueue({ hint: () => h, active: () => playing });
  Q.want('tip.tessie.look', LINES.look); Q.step(2);
  assert.equal(h.shown.length, 0, 'not while you are the boat'); assert.deepEqual(Q.waiting, ['tip.tessie.look']);
  playing = true; Q.step(2);
  assert.deepEqual(h.shown.map((s) => s.text), ['Look up to see the boats.']);
  const phone = createPhoneQuiet({ on: () => true, storage: null }), pl = createLeanSkipper({ phone, storage: null }), ph = hintWith(pl);
  const P = createTipQueue({ hint: () => ph, active: () => true });
  P.want('tip.tessie.swim', LINES.tipTouch); for (let i = 0; i < 40; i++) { pl.update(1); P.step(1); }
  assert.equal(ph.shown.length, 0, 'a phone keeps none of them');
});

test('no status lines and whole short sentences: "Got them!" and "Next time…" are gone; the tablet\'s tip names no key', () => {
  assert.ok(!('got' in LINES) && !('miss' in LINES));
  for (const [k, l] of Object.entries(LINES)) assert.match(l, /\.$/, `${k}: a whole sentence`);
  for (const k of ['tipTouch', 'fastTouch', 'dashTouch']) assert.doesNotMatch(LINES[k], /\[/, `${k}: no key cap on a tablet`);
  assert.doesNotMatch(LINES.tipTouch, /(^|\. )Bite\.$/, 'no "Bite." fragment');
});

test('the Keys page: a Tessie tab only where she is playable; every key she acts on is on it, T included', () => {
  assert.equal(keyTable({ tessie: false }), KEY_TABLE);
  assert.doesNotMatch(keysPageHtml({ table: keyTable({ tessie: false }) }), /data-tab="tessie"/);
  const html = keysPageHtml({ table: keyTable({ tessie: true }) });
  assert.match(html, /data-tab="tessie"[^>]*>Tessie</);
  for (const r of KEY_TESSIE.rows) assert.match(html, new RegExp(`data-row="${r.id}"`), r.id);
  const listed = new Set(KEY_TESSIE.rows.flatMap((r) => r.codes));
  assert.deepEqual([...TESSIE_KEYS].filter((c) => !listed.has(c)).sort(), [], 'every key of hers listed');
  assert.deepEqual([...listed].filter((c) => !TESSIE_KEYS.has(c)).sort(), [], 'every listed key acts');
  assert.ok(KEY_TESSIE.rows.find((r) => r.codes.includes('KeyT')), 'T: the swap');
});

test('the phone\'s load advice is two short sentences', () => {
  assert.deepEqual([...ADVICE.tab], ['Add Velia to your Home Screen.', 'A computer runs it best.']);
});
