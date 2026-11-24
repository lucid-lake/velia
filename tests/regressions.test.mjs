// The 2026-10-30 evening regressions (fix/regressions): each test failed on main at a63e855 and passes with the fix.
//  1. the skipper's voice: the shore and situation notes were muted for a player the skill model calls a pro ("not a
//     newbie") or who set "I sail"; clips fetched only when a line shows missed the 400 ms deadline under load.
//  2. the shallow-water assist was off in Pro mode, which a Cruise hand-over or the Settings row turns on without a word.
//  3. Sail's music waited on a scene clock that started at page load (the home card's time counted), not on the entry.
//  4. one fixed piece per world state, the same order every visit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from './helpers/dom-stub.mjs';
import { NOTES } from '../src/ui/skipper.js';
import { createSkipperVoice } from '../src/ui/skipperVoice.js';
import { hashText } from '../src/ui/skipperText.js';
import * as AUDIO from '../src/audio.js';
import { pieceAt, BEDS } from '../src/modes/chill/music.js';
import { parseFlags } from '../src/sim/core/flags.js';
const { BedScheduler, createAudio } = AUDIO;
// the new modules load per test, so on the old code each test fails on its own point, not on an import
const sailBeds = async () => (await import('../src/core/sailMusic.js')).SAIL_BEDS;

const manifest = JSON.parse(readFileSync(new URL('../audio/skipper/manifest.json', import.meta.url), 'utf8'));

// ---- 1. the voice ----
test('regression 1: a detected pro (or "I sail") still hears and reads the shore warning', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const { createSkills } = await import('../src/sail/skills.js');
  const sk = createSkills({ storage: null });
  sk.setISail(true);
  assert.equal(sk.muted, true, 'the hints are muted for this player');
  const said = [];
  const hint = createControlsHint({ state: () => null, skills: sk, once: false, storage: null, voice: { say: (t) => said.push(t) } });
  hint.note(NOTES.shoreAuto?.text ?? NOTES.shoal.text, 'A', NOTES.shoreAuto?.speak ?? NOTES.shoal.speak);
  for (let i = 0; i < 20; i++) hint.update(0.1);
  assert.deepEqual(said, [NOTES.shoreAuto?.speak ?? NOTES.shoal.speak], 'the warning is spoken');
  assert.equal(hint.current, 'note', 'and shown');
  hint.dispose();
});

function slowRig(fetchMs) {
  const ctx = {
    state: 'running', currentTime: 0,
    decodeAudioData: async (ab) => ({ duration: ab.byteLength / 1000 }),
    createGain: () => ({ gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
  };
  let attach = null;
  const audio = { muted: false, attach: (fn, bus) => { attach = [fn, bus]; }, duck() {} };
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(url.split('/').pop());
    await new Promise((r) => setTimeout(r, url.endsWith('manifest.json') ? 1 : fetchMs));
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(2500) };
  };
  return { audio, fetchFn, fetched, start: () => attach[0]({ ctx, master: {} }) };
}
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('regression 1: with prefetch on, a line whose clip is slow to fetch (busy page) is still spoken when it shows', async () => {
  const A = 'Sails shaking. Pull the sails in.';
  const r = slowRig(8);
  const v = createSkipperVoice({ audio: r.audio, storage: mem(), fetchFn: r.fetchFn, loadMs: 4, exts: ['opus', 'm4a'], prefetch: true, prefetchGapMs: 0 });
  r.start();   // the first gesture: the clips' bytes come in the background, one at a time
  await new Promise((res) => setTimeout(res, 12 * Object.keys(manifest.clips).length + 300));
  assert.ok(r.fetched.includes(`${hashText(A)}.opus`), 'prefetched');
  assert.equal(await v.say(A), 'spoken', 'the line is spoken (it was "late" with lazy fetching)');
  // without prefetch (the unit default) it is late, and stays text only: the rule "never late" holds
  const r2 = slowRig(8);
  const v2 = createSkipperVoice({ audio: r2.audio, storage: mem(), fetchFn: r2.fetchFn, loadMs: 4, exts: ['opus', 'm4a'] });
  r2.start();
  assert.equal(await v2.say(A), 'late');
});

// regression 1, Sail turns the voice's prefetch on: the live Sail page fetches the clips once audio starts, before any
// line shows (tests/pages/liveFlags.page.mjs (retired 2026-11-18))

// ---- 2. the assist ----
test('regression 2: the shallow-water assist is decided by the Settings switch only; Pro mode does not turn it off', async () => {
  const { attachGrounding, assistEnabled } = await import('../src/sail/grounding.js');
  assert.equal(assistEnabled({ on: true, held: false }), true);
  assert.equal(assistEnabled({ on: false, held: false }), false, 'off is the switch');
  assert.equal(assistEnabled({ on: true, held: true }), false, 'made fast: stands down');
  // the live path: grounding.update with pro: true still enables the assist
  const phys = { state: { x: 0, z: 0, heading: 0, u: 3, v: 0, sog: 3 } };
  const ground = { state: { mode: 'afloat', under: 10, depth: 12, scrape: 0, mat: 'sand' }, take: () => [], kedge: () => ({ ok: false }) };
  const GT = { depthAt: () => 20, rockAt: () => false };
  const core = { flags: parseFlags('') };
  const g = attachGrounding(core, { phys, ground, groundTerrain: GT }, {});
  const seen = [];
  g.assist.update = (s, dt, o) => { seen.push(o.enabled); return { engaged: false, event: null }; };
  g.update(0.1, { steering: false, pro: true, windFrom: 0 });
  g.update(0.1, { steering: false, pro: false, windFrom: 0 });
  assert.deepEqual(seen, [true, true], 'Pro on and off: the assist is enabled');
  g.setAssist(false); g.update(0.1, { pro: false });
  assert.equal(seen.at(-1), false, 'the switch off: disabled');
});

// ---- 3. the music starts on the gesture that enters Sail ----
test('regression 3: arrive() cues a piece at once, whatever the scene clock and the hour (the home card\'s minutes do not count)', () => {
  const s = new BedScheduler({ seed: 1 });
  // the card sat 5 minutes: a golden cue ran silently before any gesture, then its repeat window
  for (let t = 0; t <= 300; t += 1) s.update(t, { hour: 18.75, windSpeed: 3 });
  assert.equal(s.update(301, { hour: 18.75, windSpeed: 3 }).length, 0, 'the scheduler alone stays silent here');
  const c = s.arrive(301, { hour: 13, windSpeed: 3 });
  assert.ok(c && c.t === 301, 'a piece at the entry, even at midday in light wind');
  assert.equal(s.arrive(302, { hour: 13, windSpeed: 3 }), null, 'never over a playing piece');
  assert.ok(s.next >= c.end + s.gapS[0], 'then the silence-first gaps');
  const off = new BedScheduler({ seed: 1 }); off.next = Infinity;
  assert.equal(off.arrive(10, { hour: 13 }), null, 'Cruise keeps the beds out (next = Infinity)');
});

test('regression 3: createAudio.arrive() before the context exists plays at start(); the entry hook waits for the card to go', async () => {
  const played = [];
  class Node { constructor() { this.gain = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }; this.frequency = { setTargetAtTime() {} }; } connect() { return this; } }
  class Src extends Node { constructor(_c, o) { super(); this.buffer = o?.buffer; } start() { played.push(this.buffer?.url); } stop() {} }
  const g = globalThis; const keep = { GainNode: g.GainNode, AudioBufferSourceNode: g.AudioBufferSourceNode, BiquadFilterNode: g.BiquadFilterNode };
  Object.assign(g, { GainNode: Node, AudioBufferSourceNode: Src, BiquadFilterNode: Node });
  class Ctx { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } async resume() {} addEventListener() {} async decodeAudioData(ab) { return { duration: 200, url: ab.url }; } }
  const fetchFn = async (url) => ({ ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(8), { url }) });
  try {
    const a = createAudio({ Ctx, fetchFn, beds: { vista: ['/m/v1.opus'], golden: ['/m/g1.opus'] } });
    a.update(400, { hour: 13, windSpeed: 3, shoreDist: -200 });
    a.arrive();                          // the entry, before the first gesture made the context
    await a.start();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(played.some((u) => u === '/m/v1.opus'), `the arrival piece played: ${played}`);
    // the hook: a gesture while the card is up does nothing; the one that takes the card away arrives once
    let calls = 0, card = 'home';
    const target = new EventTarget();
    AUDIO.arriveOnEntry({ arrive: () => calls++ }, { target, cardUp: () => card === 'home', defer: (f) => f() });
    target.dispatchEvent(new Event('pointerdown'));
    assert.equal(calls, 0, 'a click on the card');
    card = 'out'; target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    assert.equal(calls, 1, 'Enter: once');
  } finally { Object.assign(g, keep); }
});

// ---- 4. variety ----
test('regression 4: each state has a pool of pieces; a visit seed picks them; never the last two again', async () => {
  const SAIL_BEDS = await sailBeds();
  for (const [bed, pool] of Object.entries(SAIL_BEDS)) assert.ok(pool.length >= 3, `${bed}: ${pool.length}`);
  const files = new Set(Object.values(SAIL_BEDS).flat());
  assert.equal(files.size, 10, 'all ten of the Sail pieces (both takes of five briefs) are in use');
  for (const f of files) assert.ok(!/race_/.test(f), 'the race score stays Regatta\'s');
  const run = (pieceSeed, mins = 20) => {
    const s = new BedScheduler({ seed: 1, pieceSeed, pools: SAIL_BEDS });
    const out = [s.arrive(0, { hour: 18.75, windSpeed: 3 })];
    for (let t = 1; t <= mins * 60; t += 1) out.push(...s.update(t, { hour: 18.75, windSpeed: 3 }));
    return out.filter(Boolean).map((c) => c.piece);
  };
  assert.deepEqual(run(7), run(7), 'the same seed, the same order');
  const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((k) => run(k * 7919, 1)[0]));
  assert.ok(firsts.size >= 2, `different visits start differently: ${[...firsts]}`);
  const long = run(12345, 240);
  for (let i = 2; i < long.length; i++) assert.ok(long[i] !== long[i - 1] && long[i] !== long[i - 2], `piece ${i} repeats one of the last two`);
  const distinct = new Set(run(12345, 20)).size;
  assert.ok(distinct >= 3, `a 20-minute golden-hour sail plays ${distinct} distinct pieces (was 1)`);
  // before: one fixed file per state, the bed blocked for 30 min after it played
  const old = new BedScheduler({ seed: 1 }); const oc = [];
  for (let t = 0; t <= 1200; t += 1) oc.push(...old.update(t, { hour: 18.75, windSpeed: 3 }));
  assert.equal(new Set(oc.map((c) => c.bed)).size, 1, 'the old path: one piece in 20 minutes');
});

test('regression 4: the visit seed is random per visit, and the URL seed only for ?seed, headless or a golden', async () => {
  const { visitSeed } = await import('../src/visitSeed.js');
  let n = 0; const rand = () => [11, 22, 33][n++ % 3];
  const P = (q) => parseFlags(q);
  assert.notEqual(visitSeed(P(''), { rand }), visitSeed(P(''), { rand }), 'two visits differ');
  assert.equal(visitSeed(P('seed=5'), { rand }), 5);
  assert.equal(visitSeed(P('headless=1'), { rand }), 1);
  assert.equal(visitSeed(P('golden=home'), { rand }), 1);
});

test('regression 4: Cruise: a visit seed, and a new round never starts with either of the last two pieces', () => {
  // Cruise's music seeded per visit (visitSeed, not the URL's seed 1): the live Cruise page, tests/pages/liveFlags.page.mjs (retired 2026-11-18)
  const n = BEDS.length;
  for (const seed of [1, 2, 3, 99, 4242]) {
    const seq = Array.from({ length: n * 6 }, (_, k) => pieceAt(seed, k, n));
    for (let i = 2; i < seq.length; i++) assert.ok(seq[i] !== seq[i - 1] && seq[i] !== seq[i - 2], `seed ${seed}: piece ${i}`);
  }
});
