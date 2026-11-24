// The controls' sounds (src/sfx.js) and sound-on-by-default (src/audio.js): the winch's click tempo, the ease's length,
// the wheel, the wind cue, the find's note; the first gesture of any kind starts the sound, M mutes, the music ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SfxMix, CLICK_DEG, LEVEL, windCue, woodNote, WIND_CUE } from '../src/sfx.js';
import { createAudio, startOnFirstGesture, GESTURES, BedScheduler, MASTER } from '../src/audio.js';
import { HAND } from '../src/sim/sail/sheets.js';
import { BEDS } from '../src/modes/chill/music.js';
import { SAIL_BEDS } from '../src/core/sailMusic.js';
import { URLS as RACE_URLS } from '../classic/src/modes/regatta/raceMusic.js';

const DEG = Math.PI / 180, dt = 1 / 60;
// drive the mix like the controls do: the sheet moves at the hand's rates while W or S is held
function session(steps, { seed = 1, load = 0.5, sog = 2.5 } = {}) {
  const m = new SfxMix({ seed }), out = [];
  let sheet = 50 * DEG, t = 0;
  for (const [pull, secs, extra = {}] of steps) {
    for (let i = 0; i < Math.round(secs / dt); i++) {
      t += dt;
      if (pull > 0) sheet = Math.max(HAND.min, sheet - HAND.rate * dt);
      if (pull < 0) sheet = Math.min(HAND.max, sheet + HAND.easeRate * dt);
      const r = m.step(t, { pull, sheet, sog, load, ...extra });
      out.push({ t, ...r });
    }
  }
  return out;
}
const events = (rows, kind, a = 0, b = 1e9) => rows.flatMap((r) => r.events.filter((e) => e.kind === kind).map((e) => ({ t: r.t, ...e }))).filter((e) => e.t >= a && e.t < b);

test('winch: one click per 1.5° of sheet, 8 a second at the 12°/s pull, firmer under load', () => {
  const rows = session([[0, 1], [1, 2], [0, 1]]);
  const clicks = events(rows, 'click', 1, 3.05);
  near(clicks.length, 1 + (HAND.rate / DEG) * 2 / CLICK_DEG, 1, 'clicks in a 2 s pull');
  const gaps = clicks.slice(2).map((c, i) => c.t - clicks[i + 1].t);
  for (const g of gaps) assert.ok(Math.abs(g - CLICK_DEG / (HAND.rate / DEG)) < 0.02, `click gap ${g}`);
  assert.equal(events(rows, 'click', 3.05).length, 0, 'no clicks once the hand lets go');
  const light = events(session([[1, 1]], { load: 0 }), 'click'), heavy = events(session([[1, 1]], { load: 1 }), 'click');
  const mean = (a) => a.reduce((s, e) => s + e.gain, 0) / a.length;
  assert.ok(mean(heavy) > 1.5 * mean(light), 'firmer under load');
  for (let i = 1; i < clicks.length; i++) assert.ok(clicks[i].slot !== clicks[i - 1].slot, 'never the same click twice in a row');
});

test('winch: a press at the stop still clicks once (never silent), and the loaded sheet creaks on the first pull', () => {
  const m = new SfxMix();
  const at = m.step(0, { pull: 0, sheet: HAND.min }); assert.equal(at.events.length, 0);
  const r = m.step(dt, { pull: 1, sheet: HAND.min, load: 0.6 });
  assert.deepEqual(r.events.map((e) => e.kind), ['click']);
  const creaky = session([[1, 6]], { load: 0.8 });
  const cr = events(creaky, 'sheetCreak');
  assert.ok(cr.length >= 1 && cr[0].t < 0.1, 'the sheet groans as the winch takes the load');
  for (let i = 1; i < cr.length; i++) assert.ok(cr[i].t - cr[i - 1].t >= 3, 'creaks ≥ 3 s apart');
  assert.equal(events(session([[1, 3]], { load: 0.1 }), 'sheetCreak').length, 0, 'an unloaded sheet does not creak');
});

test('ease: the run plays exactly while the sheet runs, its level by the ease rate', () => {
  const rows = session([[0, 0.5], [-1, 1.2], [0, 1]]);
  const during = rows.filter((r) => r.t > 0.6 && r.t < 1.65), after = rows.filter((r) => r.t > 1.75);
  assert.ok(during.every((r) => r.gains.run > 0.4 * LEVEL.run), 'running');
  assert.ok(after.every((r) => r.gains.run === 0), 'stops with the hand');
  assert.equal(events(rows, 'easeStart').length, 1, 'one lift off the cleat');
  // at the stop (80°) S still gives the lift, but no run
  const stop = session([[-1, 3], [0, 0.5], [-1, 1]]);
  assert.equal(events(stop, 'easeStart').length, 2, 'the second press, at the stop, is not silent');
  assert.ok(stop.filter((r) => r.t > 3.7).every((r) => r.gains.run === 0), 'nothing runs at the stop');
});

test('wheel and rudder: the first turn creaks, then sparse; the rudder water by angle and speed', () => {
  const m = new SfxMix({ seed: 3 }), wheel = [];
  let rud = 0;
  for (let i = 0; i < 600; i++) {
    const t = i * dt, steer = i < 300 ? 1 : 0;
    rud += ((steer ? 1 : 0) - rud) * Math.min(1, dt / 0.4);
    for (const e of m.step(t, { steer, rudder: rud, sog: 3 }).events) if (e.kind === 'wheel') wheel.push(t);
  }
  assert.ok(wheel.length >= 1 && wheel[0] < 0.05, 'the first turn creaks at once');
  for (let i = 1; i < wheel.length; i++) assert.ok(wheel[i] - wheel[i - 1] >= 0.9);
  assert.ok(wheel.length <= 6, `${wheel.length} creaks in 5 s of steering: sparse`);
  const g = (rudder, sog) => new SfxMix().step(0, { rudder, sog }).gains.rudder;
  assert.equal(g(0, 3), 0); assert.equal(g(0.8, 0.2), 0, 'no way on, no water');
  assert.ok(g(0.8, 3.5) > g(0.3, 3.5) && g(0.8, 3.5) <= LEVEL.rudder);
});

test('wind cue: rising for more wind, falling for less, over the blow-in; none for the same level', () => {
  assert.equal(windCue(3, 3), null);
  const up = windCue(2, 4), down = windCue(3, 1);
  assert.equal(up.dir, 1); assert.equal(down.dir, -1);
  assert.ok(up.toHz > up.fromHz && down.toHz < down.fromHz, 'the band sweeps with the change');
  assert.ok(windCue(1, 4).gain > windCue(1, 2).gain, 'a bigger step, a bigger whoosh');
  assert.equal(up.durS, WIND_CUE.durS);
});

test('find: a struck wood bar, its partials decaying fastest at the top', () => {
  const n = woodNote(392);
  assert.equal(n.partials[0].hz, 392);
  for (let i = 1; i < n.partials.length; i++) assert.ok(n.partials[i].decayS < n.partials[i - 1].decayS && n.partials[i].gain < n.partials[i - 1].gain);
  assert.ok(LEVEL.find < LEVEL.wind, 'quiet');
});

test('deterministic: the same session twice gives the same sounds', () => {
  const s = () => session([[1, 2], [0, 0.5], [-1, 1], [0, 1, { steer: 1, rudder: 0.6 }]], { seed: 5 }).flatMap((r) => r.events);
  assert.deepEqual(s(), s());
});

// a fake Web Audio, enough for createAudio.start()
function fakeAudio() {
  const made = [];
  class P { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} }
  class Node { connect(n) { return n; } }
  globalThis.GainNode = class extends Node { constructor(c, o) { super(); this.gain = new P(o.gain); } };
  globalThis.BiquadFilterNode = class extends Node { constructor(c, o) { super(); this.frequency = new P(o.frequency); } };
  globalThis.AudioBufferSourceNode = class extends Node { start() {} stop() {} };
  class Ctx { constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; made.push(this); } async resume() { this.state = 'running'; } async decodeAudioData() { return { duration: 30 }; } }
  return { Ctx, made };
}

test('sound on by default: the first gesture of any kind starts it; layers are built before any await; M mutes', async () => {
  const { Ctx, made } = fakeAudio();
  const audio = createAudio({ Ctx, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  const ls = new Map(), target = { addEventListener: (k, f) => ls.set(k, f), removeEventListener: (k) => ls.delete(k) };
  startOnFirstGesture(audio, target, {});
  assert.deepEqual([...ls.keys()].sort(), [...GESTURES].sort(), 'keys, clicks, touches and drags');
  for (const k of ['keydown', 'pointerdown', 'touchstart', 'mousedown']) assert.ok(GESTURES.includes(k));
  let attachedAt = null;
  audio.attach(({ ctx }) => { attachedAt = ctx.state; });
  ls.get('touchstart')();
  assert.equal(made.length, 1, 'a touch started the context');
  assert.equal(attachedAt, 'suspended', 'attached layers are built inside the gesture, before the resume');
  assert.equal(ls.size, 0, 'the listeners are gone after the first');
  assert.equal(audio.toggleMute(), true); assert.equal(audio.muted, true);
  assert.equal(audio.setMuted(false), false);
  // a gesture before the listeners existed (the loading card): sticky activation starts it at once
  const a2 = createAudio({ Ctx, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) });
  startOnFirstGesture(a2, target, { userActivation: { hasBeenActive: true } });
  assert.equal(a2.started, true);
  assert.ok(MASTER > 0);
  await new Promise((r) => setTimeout(r, 0));
});

test('music: first light calls the calm bed, the golden hour and dusk their own; Day Sail and Chill point at shipped files', () => {
  const s = new BedScheduler({ seed: 2 });
  assert.equal(s.update(100, { hour: 19, windSpeed: 3 })[0]?.bed, 'golden', 'the golden hour');
  assert.equal(new BedScheduler({ seed: 2 }).update(100, { hour: 21.3, windSpeed: 1 })[0]?.bed, 'night', 'dusk and night');
  assert.equal(new BedScheduler({ seed: 2 }).update(100, { hour: 6.8, windSpeed: 1 })[0]?.bed, 'dawn', 'first light');
  const n = new BedScheduler({ seed: 2 });
  assert.equal(n.update(100, { hour: 14, windSpeed: 3 }).length, 0, 'midday: silence');
  assert.equal(new BedScheduler({ calmHours: [4.5, 8] }).update(100, { hour: 5 })[0]?.bed, 'dawn', 'the old single window still works');
  // every piece the game can ask for, read from the exported lists: Sail's pools (world.js plays them), Cruise's beds and
  // Regatta's score
  const urls = [...Object.values(SAIL_BEDS).flat(), ...BEDS, ...Object.values(RACE_URLS)];
  assert.ok(new Set(Object.values(SAIL_BEDS).flat()).size >= 9, 'Sail plays the ten pieces');
  for (const u of urls) {
    assert.ok(!u.includes('renders/'), `${u}: not a git-ignored draft`);
    assert.ok(existsSync(new URL(`..${u}`, import.meta.url)), `${u} exists in the repo`);
  }
  const src = JSON.parse(readFileSync(new URL('../audio/sources.json', import.meta.url), 'utf8'));
  for (const u of new Set(urls)) assert.ok(src.music.some((e) => u.endsWith(`/${e.name}.opus`)), `${u} in sources.json`);
});

function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} ± ${tol}`); }
