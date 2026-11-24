// Sailor's words (src/ui/words.js, gloss.js;'s words): the one table covers every term the game says;
// the line is plain first with the term beside it and fades by skill; the setting; the met list and its save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, BY_ID, TOTAL, WATCH, PHRASES, createWords, termsIn, markupIds, phraseKeys } from '../src/ui/words.js';
import { SKILL_IDS, createSkills } from '../src/sail/skills.js';
import { createSettings, SETTINGS } from '../src/ui/settings.js';
import { install, key } from './helpers/dom-stub.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// a stand-in skill model: which skills are mastered, is the pro detected
const stub = (mastered = [], pro = false) => ({ mastered: (id) => mastered.includes(id), pro });
const html2text = (h) => String(h).replace(/<[^>]*>/g, ' ');
const unmarked = (s) => String(s).replace(/§[a-z]+§/g, ' ').replace(/\{[^}]*\}/g, ' ');
const bare = (s) => termsIn(html2text(unmarked(s)));   // terms left outside any markup

test('the table: about 30+ terms, unique ids, a gloss of 8 words or fewer, one-line why, real skill ids', () => {
  assert.ok(TOTAL >= 30, `${TOTAL} terms`);
  assert.equal(new Set(TERMS.map((t) => t.id)).size, TOTAL, 'unique ids');
  for (const t of TERMS) {
    assert.ok(t.term && t.gloss && t.why, t.id);
    assert.ok(t.gloss.split(/\s+/).length <= 8, `${t.id}: gloss "${t.gloss}" is over 8 words`);
    assert.ok(!/\n/.test(t.why) && t.why.length <= 90, `${t.id}: why is one short line`);
    for (const s of t.skills) assert.ok(SKILL_IDS.includes(s), `${t.id}: skill ${s}`);
  }
  for (const id of ['tack', 'gybe', 'trim', 'ease', 'sheet', 'mainsheet', 'jib', 'halyard', 'winch', 'helm', 'bear-away', 'head-up', 'close-hauled', 'reach', 'run', 'in-irons',
    'luff', 'telltales', 'heel', 'header', 'lift', 'traveller', 'backstay', 'twist', 'reef', 'leeward', 'windward', 'port', 'starboard', 'apparent-wind', 'groove', 'anchor', 'rode']) assert.ok(BY_ID[id], `the owner's list: ${id}`);
  for (const [id] of WATCH) assert.ok(BY_ID[id], `the detector's ${id} is in the table`);
});

test('coverage: every term a hint, the H list or a note says is in the table and wrapped in markup (so it can gloss)', async () => {
  const { HINTS, MOUSE, SETTINGS: SET, LIST, PRO_LIST } = await import('../src/ui/controlsHint.js');
  const sk = createSkills();
  const strings = [...Object.values(HINTS).map((h) => h.html), ...Object.values(MOUSE), ...LIST, ...PRO_LIST, ...SET(sk, true).map((x) => x)];
  assert.ok(strings.length > 30);
  for (const s of strings) {
    for (const id of markupIds(s)) assert.ok(BY_ID[id], `markup {${id}} in "${html2text(s).slice(0, 60)}" is not in the table`);
    for (const k of phraseKeys(s)) assert.ok(PHRASES[k], `phrase §${k}§`);
    assert.deepEqual(bare(s), [], `a bare term in "${html2text(unmarked(s)).replace(/\s+/g, ' ').trim()}": wrap it as {id}`);
  }
  for (const [k, p] of Object.entries(PHRASES)) {
    assert.ok(BY_ID[p.term], `${k}: term ${p.term}`);
    for (const f of ['plain', 'mouse']) if (p[f]) assert.deepEqual(termsIn(p[f]), [], `${k}.${f} is plain: "${p[f]}"`);
    for (const f of ['sailor', 'mouseSailor']) if (p[f]) { assert.deepEqual(bare(p[f]), [], `${k}.${f}`); for (const id of markupIds(p[f])) assert.ok(BY_ID[id], `${k}.${f}: ${id}`); }
  }
  // the notes R. says (the anchor, the engine, the bottom, the first visit): seamanship.js, grounding.js and firstStage.js
  // speak only NOTES entries (an id, never a literal), in the text or, on a touch screen, the touch wording; {d} is a depth
  const { NOTES } = await import('../src/ui/skipper.js');
  assert.ok(Object.keys(NOTES).length >= 20);
  for (const [id, n] of Object.entries(NOTES)) for (const f of ['text', 'touch', 'thumb']) if (n[f]) assert.deepEqual(bare(n[f].replace('{d}', '4 m')), [], `note ${id}.${f}: wrap sailing words as {id}`);
});

test('coverage: the VHF text and the chart labels use only table terms (their gloss is one hover away)', async () => {
  const { VOCAB } = await import('../src/vhf/forecast.js');
  const vhf = Object.values(VOCAB).join(' . ');
  const found = new Set(termsIn(vhf));
  assert.ok(found.has('knot') && found.has('gust'), `the detector sees the VHF's knots and gusts: ${[...found]}`);
  for (const id of found) assert.ok(BY_ID[id], id);
  // the chart's pro line as drawn (chartplotterData.js proLine): upwind and downwind, a lift and a header, on the big chart
  const { proLine } = await import('../src/ui/chartplotterData.js');
  const lines = [{ upwind: true, twaDeg: 43, trend: 'lift' }, { upwind: false, twaDeg: 155, trend: 'header' }]
    .map(({ trend, ...plan }) => proLine({ vmgKn: 4.2, underM: 3.4, trend, plan, big: true }));
  const cf = new Set(termsIn(lines.join(' . ')));
  for (const id of ['tack', 'gybe', 'knot', 'lift', 'header', 'keel', 'vmg']) assert.ok(cf.has(id) && BY_ID[id], `the chart says ${id}`);
});

test('fade: a newcomer reads the plain line with the term beside it; a learned skill, the sailor\'s line; the pro, the sailor\'s', () => {
  const plain = createWords({ skills: stub() }).expand('§pull§');
  assert.match(plain, /^pull the sails in/); assert.doesNotMatch(plain, /data-term="trim"|class="tag"/, 'no trailing term tag'); assert.doesNotMatch(html2text(plain), /·\s*trim/);
  const learned = createWords({ skills: stub(['trim']) }).expand('§pull§');
  assert.equal(html2text(learned).replace(/\s+/g, ' ').trim(), 'trim the sheets'); assert.match(learned, /data-term="sheet"/);
  assert.equal(html2text(createWords({ skills: stub([], true) }).expand('§pull§')).replace(/\s+/g, ' ').trim(), 'trim the sheets');
  // other skills fade on their own: trim learned does not touch the tack line
  const t = createWords({ skills: stub(['trim']) }).expand('§tack§'); assert.match(t, /steer through faster/);
  assert.equal(html2text(createWords({ skills: stub(['tacking']) }).expand('§tack§')).replace(/\s+/g, ' ').trim(), 'tack through the wind faster');
  // the mouse phrasing fades too
  assert.match(createWords({ skills: stub() }).expand('§pull§', { mouse: true }), /^pull the sails in/);
  assert.match(html2text(createWords({ skills: stub(['trim']) }).expand('§pull§', { mouse: true })).replace(/\s+/g, ' '), /trim the sheets/);
  // deterministic: the same save reads the same
  assert.equal(createWords({ skills: stub(['trim']) }).expand('§ease§'), createWords({ skills: stub(['trim']) }).expand('§ease§'));
  // an inline term: the plain alternative first, the term once the skill is learned
  assert.match(createWords({ skills: stub() }).expand('the {helm|helm|wheel}'), />wheel</);
  assert.match(createWords({ skills: stub(['steering']) }).expand('the {helm|helm|wheel}'), />helm</);
  // a term with no skill (anchor) fades by meeting: three meetings
  const w = createWords({ skills: stub() }); assert.equal(w.level('rode'), 'plain'); w.meet('rode'); w.meet('rode'); assert.equal(w.level('rode'), 'plain'); w.meet('rode'); assert.equal(w.level('rode'), 'sailor');
});

test('the setting: "sailor\'s only" shows the sailor\'s line to a newcomer; "plain + sailor\'s" is the default', () => {
  assert.equal(SETTINGS.words, 'both');
  const w = createWords({ skills: stub() }); assert.equal(w.mode, 'both');
  assert.match(w.expand('§pull§'), /^pull the sails in/);
  let changed = 0; w.onChange((e) => { if (e.type === 'mode') changed++; });
  w.mode = 'sailor'; assert.equal(changed, 1);
  assert.equal(html2text(w.expand('§pull§')).replace(/\s+/g, ' ').trim(), 'trim the sheets'); assert.equal(w.level('tack'), 'sailor');
  w.mode = 'nonsense'; assert.equal(w.mode, 'both', 'anything but sailor is both');
  const st = mem(); const s = createSettings({ storage: st });
  assert.equal(s.get('words'), 'both'); assert.equal(s.set('words', 'sailor'), 'sailor'); assert.equal(s.set('words', 'x'), 'sailor', 'a bad value is refused');
  assert.equal(createSettings({ storage: st }).get('words'), 'sailor', 'saved');
});

test('met: a term is listed once met, "n of N"; the save survives a reload; gloss lines are short', () => {
  const st = mem(); const w = createWords({ storage: st, skills: stub() });
  assert.equal(w.metCount, 0); assert.deepEqual(w.met(), []);
  let ev = 0; w.onChange((e) => { if (e.type === 'met') ev++; });
  assert.equal(w.meet('winch'), true); assert.equal(w.meet('winch'), false); w.meet('tack'); w.meet('nonsense');
  assert.equal(w.metCount, 2); assert.equal(ev, 2); assert.deepEqual(w.met().map((t) => t.id).sort(), ['tack', 'winch']);
  const again = createWords({ storage: st, skills: stub() });
  assert.equal(again.metCount, 2); assert.ok(again.metAt('winch')); assert.equal(again.total, TOTAL);
  assert.deepEqual(again.gloss('winch').gloss, 'winds the rope in'); assert.equal(again.gloss('winch').term, 'Winch');
  assert.equal(again.gloss('nope'), null);
  // a corrupt save starts clean
  st.setItem('lakeshore.words.v1', '{bad'); assert.equal(createWords({ storage: st }).metCount, 0);
});

test('the hint: shows the plain line, meets its term, fades with the skill model, and the H list wraps its terms', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const sk = createSkills(); const words = createWords({ skills: sk });
  const hint = createControlsHint({ state: () => null, skills: sk, words, once: false, storage: null });
  hint.force('pull');
  assert.match(html2text(hint.el.innerHTML), /pull the sails in/); assert.doesNotMatch(html2text(hint.el.innerHTML), /·\s*trim/); assert.ok(words.isMet('trim'), 'seeing it is meeting it');
  hint.force('off'); hint.force('tack'); assert.match(hint.el.innerHTML, /steer through faster/); assert.ok(words.isMet('tack'));
  // the setting redraws the shown line
  hint.force('pull'); words.mode = 'sailor';
  assert.equal(html2text(hint.el.innerHTML).replace(/\s+/g, ' ').trim(), 'W Sails shaking \u2014 trim the sheets');   // the old skipper's lead, no quote marks: a film subtitle (round 3); the phrase is words.js's own
  words.mode = 'both'; hint.force('off');
  key('KeyH', true); hint.update(0.1);
  assert.equal(hint.current, 'keys'); assert.match(hint.el.innerHTML, /data-term="trim"/); assert.match(hint.el.innerHTML, /data-term="anchor"/); assert.match(html2text(hint.el.innerHTML), /sails/);
  key('KeyH', false); hint.dispose();
});
