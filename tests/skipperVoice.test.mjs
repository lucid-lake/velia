// The old skipper's spoken hints: the manifest covers every line the game can show, and the playback
// rules hold against a stubbed audio context: once per line, no sound before a gesture, off means no fetch, no overlap,
// the music ducks, a late clip is never spoken late.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { allLines, HINT_NAMES, LEVELS } from '../src/ui/skipperLines.js';
import { hashText, lineText } from '../src/ui/skipperText.js';
import { createSkipperVoice } from '../src/ui/skipperVoice.js';
import { NOTES } from '../src/ui/skipper.js';
import { HINTS, MOUSE } from '../src/ui/controlsHint.js';
import { createAudio } from '../src/audio.js';
import { createSettings, SETTINGS } from '../src/ui/settings.js';
import { pagesHtml } from '../src/ui/homePages.js';
import { install } from './helpers/dom-stub.mjs';
import { parseFlags } from '../src/sim/core/flags.js';

const DIR = new URL('../audio/skipper/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8'));
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

// the check the render tool and this test share: the hashes of lines that have no clip (either format) in the manifest
const noClip = (lines, man = manifest, has = (f) => existsSync(new URL(f, DIR))) =>
  lines.filter((l) => !man.clips[l.hash] || !has(`${l.hash}.opus`) || !has(`${l.hash}.m4a`)).map((l) => l.hash);

test('the lines: every hint, every wording and every note the code can show has a clip in both formats', () => {
  const lines = allLines();
  assert.ok(lines.length >= 40, `${lines.length} lines`);
  assert.deepEqual(noClip(lines), [], 'a line with no clip: rerun tools/skipper_voice.py');
  assert.deepEqual(Object.keys(manifest.clips).filter((h) => !lines.some((l) => l.hash === h)), [], 'a clip for a line the game no longer says');
  for (const l of lines) { assert.equal(manifest.clips[l.hash].text, l.text, `${l.hash}: the clip was made from other words`); assert.equal(hashText(l.text), l.hash); }
  // the check can fail: a line with no clip is found
  assert.deepEqual(noClip([...lines, { hash: hashText('A new hint nobody voiced.'), text: 'A new hint nobody voiced.' }]), [hashText('A new hint nobody voiced.')]);
  // sizes: Opus about 25 KB a clip; the whole set well under 1 MB
  const total = lines.reduce((n, l) => n + statSync(new URL(`${l.hash}.opus`, DIR)).size, 0);
  assert.ok(total < 1_000_000, `opus total ${total}`);
  for (const l of lines) { const d = manifest.clips[l.hash].dur; assert.ok(d > 0.8 && d < 9, `${l.hash} ${d} s`); }
});

test('the lines are derived: every hint name, every mouse wording and every note is in the list; a plain and a sailor line differ where the words fade', async () => {
  assert.deepEqual([...HINT_NAMES].sort(), Object.keys(HINTS).sort(), 'HINTS (controlsHint.js) and the voice list name the same hints');
  const ids = new Set(allLines().flatMap((l) => l.ids));
  for (const n of HINT_NAMES) for (const hand of ['keys', 'pointer']) for (const lvl of Object.keys(LEVELS)) assert.ok(ids.has(`${n}.${hand}.${lvl}`), `${n}.${hand}.${lvl}`);
  for (const n of Object.keys(MOUSE)) assert.ok(HINT_NAMES.includes(n), `mouse line ${n}`);
  for (const id of Object.keys(NOTES)) assert.ok(ids.has(`note.${id}`), id);
  // every note can be said: no dead entry in the NOTES table (each id below is checked to be said by its owner)
  const said = await saidNotes();
  assert.deepEqual(Object.keys(NOTES).filter((id) => !said.has(id)), [], 'a note nobody says: drive its owner in saidNotes() below');
  const plain = LEVELS.plain(), sailor = LEVELS.sailor();
  assert.equal(lineText('pull', plain), 'Sails shaking. Pull the sails in.');
  assert.equal(lineText('pull', sailor), 'Sails shaking. Trim the sheets.');
  assert.equal(lineText('pull', plain, { mouse: true, mouseHtml: MOUSE.pull }), 'Sails shaking. Pull the sails in.');
  assert.equal(lineText('irons', plain, { mouse: true, mouseHtml: MOUSE.irons }), 'Nothing’s pulling. Click the water off the wind.');
  assert.equal(lineText('gusts', plain), 'Look up the lake. Dark water means wind.');
  assert.equal(lineText('chart', plain, { mouse: true, mouseHtml: MOUSE.chart }), 'Lost? Click the chart, top right.');
  for (const l of allLines()) assert.ok(!/[=<>{}§]|&\w+;/.test(l.text), `markup in a spoken line: ${l.text}`);
});

// ---- who says the notes (behaviour: each owner driven, the notes it hands the hint line recorded) ----
// the bottom (src/sail/grounding.js) on stub physics: the bottom's events, the assist, the lookahead's warnings, the kedge
async function groundingSays() {
  const { attachGrounding } = await import('../src/sail/grounding.js');
  const said = [];
  const hint = { note: (text, key, speak) => { said.push(Object.keys(NOTES).find((id) => NOTES[id].text === text && NOTES[id].speak === speak)); return true; } };
  let events = [], kedge = { ok: true };
  const ground = { state: { mode: 'afloat', under: 5, depth: 6, scrape: 0, mat: 'sand' }, take: () => { const e = events; events = []; return e; }, kedge: () => kedge };
  const phys = { state: { x: 0, z: 0, sog: 3, heading: 0 } };
  const g = attachGrounding({ flags: parseFlags('') }, { phys, ground, groundTerrain: { depthAt: () => 6, rockAt: () => 0 } }, { hint });
  let out = null; g.assist.update = () => out;   // the assist's verdict, scripted
  const step = (o = {}) => { out = { engaged: false, event: null, warn: null, ...o }; return g.update(60); };   // a minute apart: the talk's gaps never hold a line back
  events = [{ type: 'aground' }]; step();
  events = [{ type: 'refloat' }]; step();
  for (const reason of ['shoal', 'rocks', 'shore']) { step({ event: 'engage', engaged: true, reason, trapped: false }); step({ warn: { reason } }); }
  step({ event: 'engage', engaged: true, reason: 'rocks', trapped: true });
  g.kedge(); kedge = { ok: false, why: 'shallow' }; g.kedge();
  return said;
}
async function saidNotes() {
  const said = new Set(await groundingSays());
  const { LINES } = await import('../classic/src/ui/firstStage.js');   // the staged first visit's lines
  for (const n of Object.values(LINES)) said.add(Object.keys(NOTES).find((id) => NOTES[id] === n));
  // let fly (src/sail/letFly.js): the jib alone, then both, at each words level
  const { LetFly } = await import('../src/sim/sail/letFly.js');
  for (const level of ['plain', 'sailor']) { const f = new LetFly(); f.letGo('jib'); said.add(f.says(level)); f.letGo('main'); said.add(f.says(level)); }
  // the upright phone's turn line (src/ui/turnPhone.js): driven upright, it says NOTES.turnPhone
  const { createTurnLine } = await import('../classic/src/ui/turnPhone.js');
  { let line = null; const tl = createTurnLine({ storage: null, text: NOTES.turnPhone.text, say: () => { line = NOTES.turnPhone.text; return true; }, shown: () => line ?? '' });
    for (let i = 0; i < 100; i++) tl.update(0.1, { kind: 'phone-port', sailing: true });
    if (tl.seen) said.add(Object.keys(NOTES).find((id) => NOTES[id].text === line)); }
  // Tessie's revenge (v2/sim/tessieRevenge.js, v2's plug-in says them as notes): its chase and escape lines (its events carry
  // them: v2/tests/tessie-revenge.test.mjs)
  const { REVENGE } = await import('../v2/sim/tessieRevenge.js');
  for (const t of Object.values(REVENGE.lines)) said.add(Object.keys(NOTES).find((id) => NOTES[id].text === t));
  // kept: a reference lint for the two owners too heavy for a node test (they need the live world): the anchor and engine
  // notes (seamanship.js) and Cruise's hand-over (chill/index.js). Path-free: any module under src/ that names the id.
  const { readdirSync, readFileSync: rf } = await import('node:fs');
  const files = ['../src/', '../classic/src/'].flatMap((d) => readdirSync(new URL(d, import.meta.url), { recursive: true }).filter((f) => /\.m?js$/.test(f)).map((f) => rf(new URL(`${d}${f}`, import.meta.url), 'utf8')));   // C7b: both trees
  const named = (id) => files.some((src) => !/export const NOTES\s*=/.test(src) && (src.includes(`say('${id}'`) || src.includes(`NOTES.${id}`) || src.includes(`'${id}'`)));
  for (const id of ['fast', 'deep', 'shallow', 'tied', 'ballFast', 'ball', 'pierFast', 'pier', 'dawn', 'engine', 'engineOffSails', 'engineOffAnchor', 'engineOffFast', 'motorKeys', 'sailsDown', 'ballNear', 'helm']) if (named(id)) said.add(id);
  return said;
}

test('the bottom says its notes: aground, afloat, the assist for each reason, boxed in, the warnings, the kedge', async () => {
  assert.deepEqual(await groundingSays(), ['aground', 'floating', 'shoalAuto', 'shoal', 'rocksAuto', 'rocks', 'shoreAuto', 'shore', 'boxed', 'kedge', 'noKedge']);
});

// ---- a stubbed audio context ----
function rig({ state = 'running', slowMs = 0, fail = [] } = {}) {
  const fetched = [], playing = [], ducks = [];
  const ctx = {
    state, currentTime: 0,
    decodeAudioData: async (ab) => ({ duration: ab.byteLength / 1000 }),
    createGain: () => ({ gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
    createBufferSource: () => { const s = { connect() {}, start() { s.started = true; playing.push(s); }, stop() { s.stopped = true; }, onended: null }; return s; },
  };
  let attach = null;
  const audio = { muted: false, attach: (fn, bus) => { attach = [fn, bus]; }, duck: (db) => ducks.push(db) };
  const start = () => attach[0]({ ctx, master: { bus: attach[1] } });
  const fetchFn = async (url) => {
    fetched.push(url);
    if (slowMs && !url.endsWith('manifest.json')) await new Promise((r) => setTimeout(r, slowMs));
    if (fail.some((f) => url.endsWith(f))) return { ok: false };
    const file = url.split('/').pop();
    if (file === 'manifest.json') return { ok: true, json: async () => manifest };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(2500) };
  };
  return { ctx, audio, start, fetchFn, fetched, playing, ducks };
}
const A = 'Sails shaking. Pull the sails in.', B = 'She’s overpowered. Ease the sails out.';

test('playback: nothing before the first gesture (no context), nothing while it is not running; no fetch either', async () => {
  const r = rig(); const v = createSkipperVoice({ audio: r.audio, storage: mem(), fetchFn: r.fetchFn });
  assert.equal(await v.say(A), 'no-gesture'); assert.equal(r.fetched.length, 0);
  r.start(); r.ctx.state = 'suspended';
  assert.equal(await v.say(A), 'no-gesture'); assert.equal(r.fetched.length, 0);
  assert.ok(!v.hasSeen(A), 'a line not spoken is not marked seen');
  r.ctx.state = 'running';
  assert.equal(await v.say(A), 'spoken'); assert.equal(r.playing.length, 1);
});

test('playback: a line is spoken the first time only, per exact line, kept across a reload; lazy fetch of its clip', async () => {
  const r = rig(), storage = mem();
  const v = createSkipperVoice({ audio: r.audio, storage, fetchFn: r.fetchFn, exts: ['opus', 'm4a'] });
  r.start();
  assert.equal(r.fetched.length, 0, 'no preload');
  assert.equal(await v.say(A), 'spoken');
  assert.deepEqual(r.fetched.map((u) => u.split('/').pop()), ['manifest.json', `${hashText(A)}.opus`], 'the manifest and that one clip');
  assert.equal(await v.say(A), 'seen'); assert.equal(r.fetched.length, 2, 'the second time: text only, nothing fetched'); assert.equal(r.playing.length, 1);
  assert.equal(await v.say('Sails shaking. Trim the sheets.'), 'spoken', 'a changed level is a new line, spoken once more');
  // a new session (a reload) with the same storage
  const r2 = rig(); const v2 = createSkipperVoice({ audio: r2.audio, storage, fetchFn: r2.fetchFn }); r2.start();
  assert.equal(await v2.say(A), 'seen'); assert.equal(r2.fetched.length, 0);
  assert.equal(await v2.say(B), 'spoken');
  // a text with no clip is text only
  assert.equal(await v2.say('Nobody recorded this.'), 'no-clip'); assert.ok(!v2.hasSeen('Nobody recorded this.'));
});

test('playback: the setting off fetches nothing and keeps the line fresh; on speaks it; the master sound off is silent too', async () => {
  const r = rig(); const v = createSkipperVoice({ audio: r.audio, storage: mem(), fetchFn: r.fetchFn, enabled: false }); r.start();
  assert.equal(await v.say(A), 'off'); assert.equal(r.fetched.length, 0); assert.equal(r.playing.length, 0);
  v.setEnabled(true);
  r.audio.muted = true;
  assert.equal(await v.say(A), 'muted'); assert.equal(r.fetched.length, 0);
  r.audio.muted = false;
  assert.equal(await v.say(A), 'spoken');
  v.setEnabled(false); assert.equal(r.playing[0].stopped, true, 'off stops a line that is speaking');
});

test('playback: never overlaps; a newer line stops the older; the music ducks −8 dB and returns; the radio wins', async () => {
  const r = rig(); let radio = false; const v = createSkipperVoice({ audio: r.audio, storage: mem(), fetchFn: r.fetchFn, blocked: () => radio }); r.start();
  assert.equal(await v.say(A), 'spoken'); assert.equal(v.speaking, true); assert.deepEqual(r.ducks, [-8]);
  assert.equal(await v.say(B), 'spoken');
  assert.equal(r.playing[0].stopped, true, 'the older line was cut'); assert.ok(!r.playing[1].stopped);
  assert.equal(r.playing.filter((s) => s.started && !s.stopped).length, 1, 'one voice at a time');
  r.playing[1].onended(); assert.equal(v.speaking, false); assert.equal(r.ducks.at(-1), 0, 'the music comes back');
  radio = true; assert.equal(await v.say('Lost? The chart shows where you are.'), 'busy'); assert.ok(!v.hasSeen('Lost? The chart shows where you are.'));
  // two calls at once: only the newer one plays
  radio = false;
  const [x, y] = await Promise.all([v.say('Want a different breeze? Try these.'), v.say('Forgot a key? Hold it down.')]);
  assert.deepEqual([x, y], ['superseded', 'spoken']);
});

test('playback: a clip that is not ready in 400 ms is never spoken late (and is there for the next time)', async () => {
  const r = rig({ slowMs: 80 }); const v = createSkipperVoice({ audio: r.audio, storage: mem(), fetchFn: r.fetchFn, loadMs: 20 }); r.start();
  assert.equal(await v.say(A), 'late'); assert.equal(r.playing.length, 0); assert.ok(!v.hasSeen(A));
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(await v.say(A), 'spoken', 'cached by now');
});

test('playback: Opus first where the browser says so; a clip that will not decode falls back to AAC', async () => {
  const r = rig({ fail: ['.opus'] }); const v = createSkipperVoice({ audio: r.audio, storage: mem(), fetchFn: r.fetchFn, exts: ['opus', 'm4a'] }); r.start();
  assert.equal(await v.say(A), 'spoken');
  assert.deepEqual(r.fetched.slice(1).map((u) => u.split('.').pop()), ['opus', 'm4a']);
});

test('the hint speaks what it shows: key and mouse wording, the notes; not when the hints are hidden or the voice is off', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const { createSkills } = await import('../src/sail/skills.js');
  const { createWords } = await import('../src/ui/words.js');
  const said = []; const voice = { say: (t) => said.push(t) };
  let kind = 'keys';
  const sk = createSkills({ storage: null });
  const hint = createControlsHint({ state: () => null, skills: sk, words: createWords({ skills: sk }), once: false, storage: null, voice, modality: () => kind });
  hint.force('pull'); hint.force('off'); hint.force('tack'); hint.force('off');
  assert.deepEqual(said, ['Sails shaking. Pull the sails in.', 'Keep her moving. Steer through faster.']);
  said.length = 0; kind = 'mouse'; hint.force('pull');
  assert.deepEqual(said, ['Sails shaking. Pull the sails in.']);
  said.length = 0; hint.force('chart'); hint.force('off'); hint.force('look');
  assert.deepEqual(said, ['Lost? Click the chart, top right.', 'Have a look round. Come closer.']);
  hint.force('off'); said.length = 0;
  hint.el.style.display = 'none'; hint.force('pull'); assert.deepEqual(said, [], 'hints hidden: nothing spoken');
  hint.el.style.display = '';
  // a redraw of a shown line (the hand changed) is not a new line
  kind = 'keys'; hint.force('pull'); said.length = 0; kind = 'mouse'; globalThis.dispatchEvent?.(new Event('lk-modality'));
  assert.deepEqual(said, []);
  hint.dispose();
});

test('the notes: the engine and anchor notes pass their spoken text to the voice, once the quiet moment comes', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const said = [];
  const hint = createControlsHint({ state: () => null, once: false, storage: null, voice: { say: (t) => said.push(t) } });
  hint.note(NOTES.engine.text, 'I', NOTES.engine.speak);
  for (let i = 0; i < 20; i++) hint.update(0.1);
  assert.deepEqual(said, ['The sails can carry her now. Stop the engine.']);
  hint.dispose();
});

test('the setting: "skipper’s voice" is on by default, saved, and a row on the Settings page', () => {
  assert.equal(SETTINGS.skipperVoice, true);
  const st = mem(); const s = createSettings({ storage: st });
  assert.equal(s.get('skipperVoice'), true); s.set('skipperVoice', false);
  assert.equal(createSettings({ storage: st }).get('skipperVoice'), false, 'kept per browser');
  assert.equal(s.set('skipperVoice', 'off'), false, 'only a boolean');
  const html = pagesHtml({ waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' });
  assert.match(html, /data-set="skipperVoice"[\s\S]{0,200}skipper’s voice/);
  assert.match(html, /data-r="voice:on"/); assert.match(html, /data-r="voice:off"/);
});

test('audio: the voice has its own bus, the music bus runs through a duck stage, duck() eases it down and back', async () => {
  const gains = [];
  class P { constructor(v) { this.value = v; this.log = []; } setTargetAtTime(v, t, tc) { this.value = v; this.log.push([v, t, tc]); } setValueAtTime() {} linearRampToValueAtTime() {} }
  class Node { connect(n) { this.to = n; return n; } }
  globalThis.GainNode = class extends Node { constructor(c, o) { super(); this.gain = new P(o.gain); gains.push(this); } };
  globalThis.BiquadFilterNode = class extends Node { constructor(c, o) { super(); this.frequency = new P(o.frequency); } };
  globalThis.AudioBufferSourceNode = class extends Node { start() {} stop() {} };
  class Ctx { constructor() { this.state = 'suspended'; this.currentTime = 1; this.destination = {}; } async resume() { this.state = 'running'; } async decodeAudioData() { return { duration: 30 }; } }
  const audio = createAudio({ Ctx, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  let got = null; audio.attach(({ master }) => { got = master; }, 'voice');
  let music = null; audio.attach(({ master }) => { music = master; }, 'music');
  assert.equal(audio.duck(-8), -8, 'before the sound starts it only remembers');
  await audio.start();
  assert.ok(got && got !== music, 'a bus of its own');
  const stage = music.to; assert.notEqual(stage, got.to, 'the music reaches the master through the duck stage');
  assert.ok(Math.abs(stage.gain.value - 10 ** (-8 / 20)) < 1e-9, 'it starts ducked when asked early');
  audio.duck(-8, { attackS: 0.3 }); const [v1, , tc1] = stage.gain.log.at(-1);
  assert.ok(Math.abs(v1 - 0.398) < 0.001 && Math.abs(tc1 - 0.1) < 1e-9, 'down over 0.3 s (time constant a third)');
  audio.duck(0, { releaseS: 1.2 }); const [v2, , tc2] = stage.gain.log.at(-1);
  assert.equal(v2, 1); assert.ok(Math.abs(tc2 - 0.4) < 1e-9, 'back over 1.2 s');
  assert.equal(audio.duckDb, 0);
});
