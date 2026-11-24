// The music (BACKLOG-v2 #7) and Setup's rows (#9) on v2. The schedule is v1's: the same cues (bed, piece, time) as v1's own
// src/audio.js createAudio for the same day, wind, seed and taps, through the dawn, the wind, the golden hour and the night; the
// arrive, next-song and groove rules; the bus's one owner (Cruise's playlist, the fireworks); Settings' sound, music and effects
// on the buses; the pieces stream (nothing decoded) on a live page and load only after the context (the first gesture). Every
// Setup row acts on v2's systems or is disabled; every row of v1's Setup page is in the table. A stand-in Web Audio (node has
// none) records the gains; the real sound is the proof clip (tools/v2-music-render.mjs) and v2/tests/pages/setup.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAudio as createV1Audio, BUS_LEVELS, MASTER, BED_LEVEL, GROOVE_SWELL } from '../../src/audio.js';
import { SAIL_BEDS } from '../../src/core/sailMusic.js';
import { createSettings } from '../../src/ui/settings.js';
import { pagesHtml } from '../../src/ui/homePages.js';
import { featureSettings } from '../../src/features/setup.js';
import { WATERS, WATERS_SOON } from '../../src/sim/waters/index.js';
import { VESSELS, VESSELS_SOON } from '../../src/sim/vessels/index.js';
import { createMusic, createLateCore, sailBeds, cruiseBeds, MUSIC_FILES, CRUISE_HANDBACK_S } from '../audio/music.js';
import { SETUP_ROWS, applySetup, qualityLevel, qualityStatus } from '../ui/setup.js';

// ---- a stand-in Web Audio: params remember their last target; sources count their starts
function fakeAudio() {
  const log = { sources: 0, starts: 0, decoded: 0, fetched: [] };
  const param = (v = 0) => ({ value: v, target: v, setValueAtTime(x) { this.target = x; }, setTargetAtTime(x) { this.target = x; }, linearRampToValueAtTime(x) { this.target = x; }, cancelScheduledValues() {} });
  const ctx = { currentTime: 0, state: 'running', sampleRate: 48000, destination: {}, decodeAudioData: async () => { log.decoded++; return { duration: 180, numberOfChannels: 2, length: 180 * 48000, sampleRate: 48000 }; } };
  class Node { constructor(c, o = {}) { this.context = c; Object.assign(this, o); } connect(n) { return n; } disconnect() {} }
  globalThis.GainNode = class extends Node { constructor(c, o = {}) { super(c); this.gain = param(o.gain ?? 1); } };
  globalThis.AudioBufferSourceNode = class extends Node { constructor(c, o) { super(c, o); log.sources++; } start() { log.starts++; } stop() {} };
  globalThis.OscillatorNode = class extends Node { constructor(c, o) { super(c, o); } start() {} stop() {} };
  globalThis.BiquadFilterNode = class extends Node { constructor(c, o) { super(c, o); this.frequency = param(o?.frequency ?? 350); } };
  const master = new GainNode(ctx, { gain: 0.8 });
  let resolve; const ready = new Promise((r) => { resolve = r; });
  const audio = { ready, starts: 0, start() { this.starts++; }, open: () => resolve({ ctx, master }) };
  const fetchFn = async (u) => { log.fetched.push(u); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }; };
  return { ctx, master, audio, log, fetchFn };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

// a day on the lake: the hour from 05:00 to 23:30 at v1's day pace, the wind rising past 7 m/s in the afternoon
function day() {
  const out = [];
  for (let t = 0; t < 7200; t += 0.5) {
    const hour = 5 + (t / 7200) * 18.5;
    const windSpeed = hour > 13 && hour < 16 ? 8 + Math.sin(t / 30) : 3;
    out.push({ t, state: { hour, windSpeed } });
  }
  return out;
}

test('schedule (By time of day): v2 cues v1\'s pieces at v1\'s times for a whole day (the same scheduler, pools and seeds as v1\'s createAudio)', async () => {
  const { audio } = fakeAudio();
  for (const seed of [1, 7, 90210]) {
    const v1 = createV1Audio({ beds: SAIL_BEDS, seed, musicSeed: seed });   // never started: v1's scheduler runs silently, as before a gesture
    const v2 = createMusic({ audio, seed, musicSeed: seed, base: '/audio/', pick: 'time' });
    for (const { t, state } of day()) { v1.update(t, state); v2.update(t, state); }
    const a = v1.scheduler.cues.map((c) => [c.bed, c.piece, c.t]), b = v2.core.scheduler.cues.map((c) => [c.bed, c.piece, c.t]);
    assert.ok(a.length >= 5, `seed ${seed}: v1 cues ${a.length} pieces in the day`);
    assert.deepEqual(b, a, `seed ${seed}: the same cues`);
    // each piece from its own bed's pool, each bed at its hours (v1's windows)
    for (const c of v2.core.scheduler.cues) {
      assert.ok(SAIL_BEDS[c.bed].includes(c.piece), `${c.piece} is in the ${c.bed} pool`);
      const h = 5 + (c.t / 7200) * 18.5;
      if (c.bed === 'golden') assert.ok(h >= 18.3 && h < 20.7, `golden at ${h.toFixed(2)}`);
      if (c.bed === 'night') assert.ok(h >= 20.7 && h < 22.6, `night at ${h.toFixed(2)}`);
      if (c.bed === 'dawn') assert.ok((h >= 5.9 && h < 9) || (h >= 18.3 && h < 20.5), `dawn at ${h.toFixed(2)}`);
    }
  }
});

test('schedule: the entry piece, the bar\'s next song and the groove\'s swell follow v1\'s rules', async () => {
  const { audio } = fakeAudio();
  const v1 = createV1Audio({ beds: SAIL_BEDS, seed: 3, musicSeed: 3 });
  const v2 = createMusic({ audio, seed: 3, musicSeed: 3, base: '/audio/', pick: 'time' });
  // v1's arrive needs its context; drive both schedulers' arrive and skip directly with the same states
  const st = { hour: 19.2, windSpeed: 2 };
  v1.update(10, st); v2.update(10, st);
  assert.deepEqual(v2.core.scheduler.arrive(10, st), v1.scheduler.arrive(10, st));
  assert.equal(v2.core.scheduler.cues[0].bed, 'golden', 'the golden hour\'s piece on entering at 19:12');
  assert.deepEqual(v2.core.scheduler.skip(40, { hour: 21, windSpeed: 2 }), v1.scheduler.skip(40, { hour: 21, windSpeed: 2 }));
  assert.equal(v2.core.scheduler.cues[1].bed, 'night', 'a tap at 21:00 picks a night piece');
  // the groove's swell: never within firstS, once per gapS, never over a piece (v1's BedScheduler.groove)
  const g = createMusic({ audio, seed: 1, base: '/audio/', pick: 'time' });
  assert.equal(g.groove(30), null, 'no swell in the first 90 s');
  assert.ok(g.groove(100), 'a swell at 100 s');
  assert.equal(g.groove(200), null, `none again within ${GROOVE_SWELL.gapS} s`);
  assert.ok(g.groove(100 + GROOVE_SWELL.gapS + 1), 'the next one after the gap');
});

test('playback: nothing loads before the context (the first gesture); then the entry piece streams through a media element', async () => {
  const F = fakeAudio();
  const made = [];
  globalThis.Audio = class { constructor() { made.push(this); this.duration = 0; } set src(u) { this._src = u; setTimeout(() => { this.duration = 175; this.onloadedmetadata?.(); }, 0); } get src() { return this._src; } removeAttribute() {} setAttribute() {} canPlayType() { return 'probably'; } play() { return Promise.resolve(); } pause() {} load() {} };
  F.ctx.createMediaElementSource = () => ({ connect: (d) => d, disconnect() {} });
  const m = createMusic({ audio: F.audio, seed: 1, base: '/audio/', stream: true, fetchFn: F.fetchFn, pick: 'time' });
  m.update(5, { hour: 19, windSpeed: 2 }); m.arrive();
  await tick();
  assert.equal(made.length, 0, 'no element, no fetch before the context');
  assert.equal(F.log.fetched.length, 0);
  F.audio.open(); await tick(); await tick(); await tick(); await tick();
  const s = m.stats();
  assert.equal(s.cues.length, 1); assert.equal(s.cues[0].bed, 'golden');
  assert.equal(s.loads.streamed, 1, 'streamed'); assert.equal(s.loads.decoded, 0, 'nothing decoded'); assert.equal(F.log.decoded, 0);
  assert.equal(F.log.fetched.length, 0, 'no whole-file fetch');
  assert.equal(s.song?.title, 'Golden hour on the lake');
  assert.ok(made.length >= 2, 'a metadata element, then the playing element');
  m.core.hold(true); await new Promise((r) => setTimeout(r, 500));   // the piece let go (its stop timer ends now, not in 175 s)
  delete globalThis.Audio;
});

test('buses: v1\'s levels, Settings\' sound, music and effects, M and the volume', async () => {
  const F = fakeAudio();
  const settings = createSettings({ storage: memStore() });
  const m = createMusic({ audio: F.audio, settings, base: '/audio/', stream: false, fetchFn: F.fetchFn });
  F.audio.open(); await tick();
  const other = new GainNode(F.ctx, { gain: 1 }); m.follow(other, 1);
  const buses = {};
  m.core.attach(({ master }) => { buses.music = master; }, 'music');
  m.core.attach(({ master }) => { buses.effects = master; }, 'effects');
  m.core.attach(({ master }) => { buses.voice = master; }, 'voice');
  assert.equal(buses.music.gain.target, BUS_LEVELS.music); assert.equal(buses.effects.gain.target, BUS_LEVELS.effects); assert.equal(buses.voice.gain.target, 1);
  assert.equal(F.master.gain.target, MASTER);
  settings.set('music', false); assert.equal(buses.music.gain.target, 0, 'music off: the music bus to 0');
  settings.set('music', true); assert.equal(buses.music.gain.target, BUS_LEVELS.music);
  settings.set('effects', false); assert.equal(buses.effects.gain.target, 0, 'effects off');
  settings.set('sound', false); assert.equal(F.master.gain.target, 0, 'sound off: the master to 0'); assert.equal(other.gain.target, 0, 'and the birds\' context');
  settings.set('sound', true); assert.equal(F.master.gain.target, MASTER); assert.equal(other.gain.target, 1);
  m.core.toggleMute(); assert.equal(F.master.gain.target, 0, 'M mutes'); m.core.toggleMute();
  m.player.setVolume(0.5); assert.equal(buses.music.gain.target, BUS_LEVELS.music * 0.5, 'the bar\'s volume');
  m.core.duck(-8); assert.ok(m.core.duckDb === -8, 'the skipper\'s voice ducks the music');
});

//, 2026-11-17: "the music bed downloads only when music is on"; every device)
test('music off: a cue fetches no piece (Settings\' music, sound, M); back on, the next cue fetches and plays', async () => {
  const F = fakeAudio();
  const settings = createSettings({ storage: memStore() });
  settings.set('music', false);
  const m = createMusic({ audio: F.audio, settings, seed: 1, base: '/audio/', stream: false, fetchFn: F.fetchFn, pick: 'time' });
  m.update(5, { hour: 19, windSpeed: 2 });
  F.audio.open(); await tick();
  m.arrive(); await tick(); await tick();
  assert.equal(F.log.fetched.length, 0, 'music off: no piece fetched');
  assert.equal(m.stats().loads.skipped, 1);
  settings.set('music', true); settings.set('sound', false);
  m.core.nextSong(); await tick(); await tick();
  assert.equal(F.log.fetched.length, 0, 'sound off: none either');
  settings.set('sound', true); m.core.toggleMute();
  m.core.nextSong(); await tick(); await tick();
  assert.equal(F.log.fetched.length, 0, 'M muted: none either');
  m.core.toggleMute();
  m.core.nextSong(); await tick(); await tick(); await tick();
  assert.equal(F.log.fetched.length, 1, 'music on: the piece fetched');
  assert.equal(F.log.starts > 0, true, 'and played');
  m.core.hold(true);
});

test('the bar\'s Music: next song plays a new piece at once, pause holds the beds, the title follows', async () => {
  const F = fakeAudio();
  const m = createMusic({ audio: F.audio, seed: 1, base: '/audio/', stream: false, fetchFn: F.fetchFn, pick: 'time' });
  F.audio.open(); await tick();
  m.update(200, { hour: 21, windSpeed: 2 });
  const c = m.player.next(); await tick(); await tick(); await tick();
  assert.ok(c && c.bed === 'night', 'next song at 21:00: a night piece');
  assert.ok(['Dusk over the water', 'Golden hour on the lake'].includes(m.player.title), `the night pool's title (${m.player.title})`);
  assert.equal(BED_LEVEL, 0.9);
  m.player.toggle(); assert.equal(m.player.paused, true, 'paused');
  const n = m.core.scheduler.cues.length; m.update(5000, { hour: 21, windSpeed: 2 }); assert.equal(m.core.scheduler.cues.length, n, 'held: no new cue');
});

test('Cruise: setMode(\'cruise\') starts v1\'s playlist on the music bus, holds the beds, and gives the bus back on Sail', async () => {
  const F = fakeAudio();
  const timers = [];
  const m = createMusic({ audio: F.audio, seed: 4, musicSeed: 4, base: '/audio/', stream: false, fetchFn: F.fetchFn, setTimer: (f, ms) => timers.push([f, ms]) });
  F.audio.open(); await tick();
  m.update(100, { hour: 19, windSpeed: 2 }); m.arrive(); await tick(); await tick();
  assert.equal(m.core.musicHolder, 'beds');
  m.setMode('cruise'); await tick(); await tick(); await tick();
  assert.equal(m.mode, 'cruise'); assert.equal(m.core.musicHolder, 'cruise', 'the playlist holds the bus');
  assert.equal(m.core.scheduler.next, Infinity, 'the beds stay out');
  assert.ok(m.player === m.playlist, 'the bar drives the playlist');
  assert.ok(m.playlist.stats().started && m.playlist.stats().playing, 'a piece plays');
  assert.ok(cruiseBeds('/audio/').some((u) => u.endsWith(m.playlist.stats().piece)), 'from v1\'s Cruise list');
  m.update(300, { hour: 19, windSpeed: 2 });
  m.setMode('sail');
  assert.equal(m.core.musicHolder, 'beds', 'the bus back to the beds');
  assert.equal(m.core.scheduler.next, 300 + CRUISE_HANDBACK_S, 'the beds wait v1\'s 240 s after the hand-over');
});

test('fireworks: the late door queues the evening\'s players until the music exists, then shares its bus and owner; the radio follows Setup', async () => {
  const F = fakeAudio();
  const settings = createSettings({ storage: memStore() });
  const door = createLateCore();
  let got = null; door.attach(({ master }) => { got = master; }, 'music');
  assert.equal(door.radioOn(), false);
  const m = createMusic({ audio: F.audio, settings, base: '/audio/', stream: false, fetchFn: F.fetchFn });
  door.bind(m, settings); F.audio.open(); await tick();
  assert.ok(got && got.gain.target === BUS_LEVELS.music, 'the fireworks\' music on v1\'s music bus');
  const fw = { name: 'fireworks', released: 0, release() { this.released++; } };
  door.claimMusic(fw); assert.equal(m.core.musicHolder, 'fireworks');
  m.player.next(); assert.equal(fw.released, 1, 'the bar\'s next song takes the bus back');
  settings.set('boatRadio', true); assert.equal(door.radioOn(), true, 'Setup\'s radio row');
  assert.equal(door.mode(), 'sail');
});

test('files: the pieces the music can play are the ones the build ships (vite.config.js musicAudio)', async () => {
  const { MUSIC_PIECES: shipped } = await import('../vite.config.js');
  assert.deepEqual([...shipped].sort(), [...MUSIC_FILES].sort());
  assert.deepEqual(Object.keys(sailBeds('/x/')), Object.keys(SAIL_BEDS));
  assert.ok(Object.values(sailBeds('/x/')).flat().every((u) => u.startsWith('/x/music/')), 'v1\'s paths under the page\'s base');
});

// ---- Setup's rows
test('Setup: every row of v1\'s Setup page is in v2\'s table, with a status', () => {
  const html = pagesHtml({ waters: WATERS, vessels: VESSELS, wChosen: WATERS[0].id, vChosen: VESSELS[0].id, wSoon: WATERS_SOON, vSoon: VESSELS_SOON, features: featureSettings({ fireworks: true, kayaks: '1' }) });
  const panel = html.slice(html.indexOf('data-page="settings"'), html.indexOf('data-page="about"'));
  const keys = new Set([...panel.matchAll(/data-t="([a-zA-Z]+)"/g)].map((m) => `t:${m[1]}`).concat([...panel.matchAll(/data-r="([a-zA-Z]+):/g)].map((m) => `r:${m[1]}:`)));
  for (const k of ['r:autoReef:', 'r:wind:', 'r:weather:', 'r:pro:', 'r:edgeInst:', 'r:steady:', 'r:kayakCam:', 'r:windLines:']) keys.delete(k);   // v1's rows v2 takes off its card (setup.js REMOVED_ROWS: each has another on-screen path, owner 2026-11-17)
  const covered = new Set(SETUP_ROWS.map((r) => r.data));
  for (const k of keys) assert.ok(covered.has(k), `${k} has a row in SETUP_ROWS`);
  for (const r of SETUP_ROWS) assert.equal(r.acts, true, `${r.key}: every row on the page acts (owner 2026-11-19: no disabled "soon" rows)`);
  for (const k of ['sound', 'effects', 'music', 'boatRadio', 'skipperVoice', 'words', 'display', 'hud', 'largeText', 'lang', 'quality', 'pilot', 'crewTrim', 'shoalAssist', 'hints', 'tips', 'profile'])
    assert.ok(SETUP_ROWS.some((r) => r.key === k), `${k} listed`);
});

test('Setup: each row changes what it names on v2 (crew trim, auto-reef, shallow water, hints, words, voice, display, text, quality, profile)', () => {
  const settings = createSettings({ storage: memStore() });
  const B = { assists: { pilot: true, crewTrim: false, shoal: null }, ctl: {} };
  const pins = [];
  let assist = true, voiceOn = true, iSail = false;
  const theme = { mode: 'auto', large: false, set(m) { this.mode = m; }, setLargeText(v) { this.large = v; } };
  const ui = { hint: { el: { style: { display: '' } } }, words: { mode: 'both' }, voice: { setEnabled: (v) => (voiceOn = v) }, theme,
    grounding: { setAssist: (v) => (assist = v) }, skills: { get iSail() { return iSail; }, setISail: (v) => { iSail = v; } } };
  const s = applySetup({ settings, ui: () => ui, B, quality: { pin: (k) => pins.push(k) }, flags: {}, root: null, doc: null });
  s.wire();
  const flip = [
    ['crewTrim', true, () => B.assists.crewTrim === true],
    ['shoalAssist', false, () => assist === false], ['hints', false, () => ui.hint.el.style.display === 'none'], ['words', 'sailor', () => ui.words.mode === 'sailor'],
    ['skipperVoice', false, () => voiceOn === false], ['display', 'night', () => theme.mode === 'night'], ['largeText', true, () => theme.large === true],
    ['quality', 'high', () => pins.at(-1) === 0], ['quality', 'balanced', () => pins.at(-1) === 1], ['quality', 'low', () => pins.at(-1) === 2], ['quality', 'auto', () => pins.at(-1) === null],
  ];
  for (const [k, v, ok] of flip) { settings.set(k, v); assert.ok(ok(), `${k} = ${v} acts (${JSON.stringify(s.applied)})`); }
  settings.set('welcomed', true); settings.set('profile', 'sail'); assert.equal(iSail, true, 'profile "I sail": the skill model\'s iSail');
  // the URL's own rows win at the start, as v1's shell
  const B2 = { assists: { pilot: true, crewTrim: false }, ctl: {} };
  settings.set('crewTrim', true);
  applySetup({ settings, ui: () => ({}), B: B2, flags: { hand: '1' }, root: null, doc: null }).wire();
  assert.equal(B2.assists.crewTrim, false, '?hand= keeps the sheet in the hand at the start');
  // v1's stored pilot no longer acts on v2: steady hands (ui/steadyHands.js, applied by ui/sail.js) decides the let-go hold by profile
  settings.set('pilot', false); assert.equal(B2.assists.pilot, true, 'the pilot key leaves the boat to steady hands');
});

test('Setup: quality maps to the ladder (auto ↔ the ladder, high L0, balanced L1, low L2), and its status line', () => {
  assert.deepEqual(['auto', 'high', 'balanced', 'low'].map(qualityLevel), [null, 0, 1, 2]);
  const settings = createSettings({ storage: memStore() });
  const q = qualityStatus({ state: () => ({ name: 'L2', pending: ['msaa'] }) }, settings);
  assert.equal(q.active(), 'auto: Light, more after a reload', 'plain words, no rung name or part (owner 2026-11-15)');
  settings.set('quality', 'high'); q.reset(); assert.equal(settings.get('quality'), 'auto', 'the Auto card resets');
});
