// Play as Tessie's sound: the state mapping, pure. Speed to the rush's level, the eye's depth to the low-pass and the
// ambience, the distant engines, and the one-shots firing once from events and edges. Then the voices on an offline context (they render,
// are finite and calm) and the page's switches (the effects switch mutes her door).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TMIX, rushMix, gaitHz, worldLowpassHz, underK, ambienceMix, boatHums, nearestHull, surgeLevel, hullOf, createCueTracker } from '../audio/tessieMix.js';
import { voice, createTessieSound } from '../living/tessie-sound.js';

test('the rush follows speed: silent-ish at rest, rising with the square of her speed, louder and brighter on the dash, never past a calm ceiling', () => {
  const a = rushMix(0), b = rushMix(0.3), c = rushMix(0.6), d = rushMix(1), dash = rushMix(1, { dash: true });
  assert.ok(a.gain <= TMIX.rush.floor + 1e-9 && a.pulse === 0);
  assert.ok(a.gain < b.gain && b.gain < c.gain && c.gain < d.gain, 'monotonic in speed');
  assert.ok(a.hz < b.hz && b.hz < d.hz, 'pitch rises with speed');
  assert.ok(dash.gain > d.gain && dash.hz > d.hz, 'the dash is louder and brighter');
  assert.ok(dash.gain < 0.6, 'calm: under the beds');
  assert.ok(rushMix(0.6, { under: true }).hz < c.hz, 'heard from under the water it is duller');
});

test('the rush follows her gait: the stroke rate is 0.35 Hz adrift, about 0.8 at the surface, 1.0 under the water, 1.6 on the dash', () => {
  assert.ok(Math.abs(gaitHz(0, 0) - 0.35) < 1e-9);
  assert.ok(Math.abs(gaitHz(8, 0) - 0.8) < 1e-9);
  assert.ok(Math.abs(gaitHz(11, 5) - 1.0) < 1e-9);
  assert.equal(gaitHz(19, 5, true), 1.6);
  assert.equal(rushMix(0.5, { speed: 9, nose: 4 }).strokeHz, gaitHz(9, 4));
});

test('depth to the low-pass: open in the air, 800 Hz just under, 350 Hz at 20 m, never rising with depth', () => {
  assert.equal(worldLowpassHz(-3), 20000); assert.equal(worldLowpassHz(0), 20000); assert.equal(worldLowpassHz(null), 20000);
  assert.ok(Math.abs(worldLowpassHz(0.6) - 800) < 1);
  assert.ok(Math.abs(worldLowpassHz(20) - 350) < 1); assert.ok(Math.abs(worldLowpassHz(40) - 350) < 1);
  let prev = Infinity;
  for (let d = 0; d <= 22; d += 0.25) { const f = worldLowpassHz(d); assert.ok(f <= prev + 1e-9, `no rise at ${d} m`); prev = f; }
});

test('depth to the ambience: nothing in the air, the rumble and reverb in by 1.5 m, the wash thinning with depth, bubbles only under', () => {
  const air = ambienceMix(-2), shallow = ambienceMix(1.5), deep = ambienceMix(15);
  assert.deepEqual([air.rumble, air.wash, air.reverb, air.bubbles], [0, 0, 0, 0]);
  assert.ok(shallow.rumble > 0 && shallow.reverb > 0 && shallow.bubbles > 0);
  assert.ok(deep.wash < shallow.wash, 'the wash falls with depth'); assert.ok(deep.washHz < shallow.washHz);
  assert.equal(underK(-1), 0); assert.equal(underK(1.5), 1);
});

test('the engines: only the glass boat and motoring hulls, heard to 150 m, nearer louder, panned by bearing, at most three', () => {
  const her = { x: 0, z: 0, psi: 0 };   // heading north (−z); right is +x
  const boats = [
    { id: 'g', kind: 'glass', x: 30, z: 0, u: 2 }, { id: 'k', kind: 'kayak', x: 5, z: 0 }, { id: 's', kind: 'sail', x: -60, z: 0, motoring: false },
    { id: 'm', kind: 'sail', x: -80, z: 0, motoring: true }, { id: 'far', kind: 'glass', x: 400, z: 0, u: 2 },
  ];
  const h = boatHums(boats, her);
  assert.deepEqual(h.map((x) => x.id), ['g', 'm'], 'the glass boat and the motoring sailboat; not the kayak, the sailing hull or the far one');
  assert.ok(h[0].gain > h[1].gain && h[0].pan > 0.9 && h[1].pan < -0.9, 'near first; right and left');
  assert.deepEqual(boatHums(boats, her, 0), [], 'none in the air');
  const four = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, kind: 'glass', x: 20 + 10 * i, z: 0, u: 1 }));
  assert.equal(boatHums(four, her).length, TMIX.engines.max);
  assert.ok(boatHums([{ id: 'a', kind: 'glass', x: 20, z: 0, u: 2 }], her)[0].blade > boatHums([{ id: 'a', kind: 'glass', x: 20, z: 0, u: 0 }], her)[0].blade, 'the propeller turns faster with speed');
  assert.equal(nearestHull(boats, her)?.id, undefined, 'no hull within 20 m but a kayak');
  assert.equal(nearestHull([{ id: 'h', kind: 'sail', x: 10, z: 10 }], her).id, 'h');
});

test('the strike surge swells over the rise and is gone outside it', () => {
  assert.equal(surgeLevel(null), 0); assert.equal(surgeLevel({ phase: 'breach', t: 0 }), 0);
  const a = surgeLevel({ phase: 'rise', t: 0 }), b = surgeLevel({ phase: 'rise', t: 1 }), c = surgeLevel({ phase: 'rise', t: 3 });
  assert.ok(a > 0 && a < b && b < c && c <= 1);
  assert.deepEqual(['halcyon', 'sail', 'glass', 'kayak'].map(hullOf), ['wood', 'glass', 'glass', 'shell']);
});

test('the one-shots fire once: the dash, the ready tick, the wind-up, the knock, the lock; none repeats while its state holds', () => {
  const T = createCueTracker(); let t = 0;
  const f = (o = {}) => { t += 0.1; return T.step({ t, skill: { phase: 'ready' }, phase: 'swim', ...o }).map((c) => c.type); };
  assert.deepEqual(f(), []);
  assert.deepEqual(f({ events: [{ type: 'dash' }], skill: { phase: 'active' } }), ['dash']);
  assert.deepEqual(f({ skill: { phase: 'active' } }), [], 'the dash event is gone next frame');
  assert.deepEqual(f({ skill: { phase: 'cool' } }), []);
  assert.deepEqual(f({ skill: { phase: 'cool' } }), []);
  t += 1;
  assert.deepEqual(f({ skill: { phase: 'ready' } }), ['ready'], 'the cooldown ends: one tick');
  assert.deepEqual(f({ skill: { phase: 'ready' } }), [], 'and only one');
  assert.deepEqual(f({ phase: 'windup', bite: { kind: 'rail' } }), ['windup']);
  assert.deepEqual(f({ phase: 'windup', bite: { kind: 'rail' } }), [], 'held wind-up: once');
  assert.deepEqual(f({ phase: 'strike' }), []);
  assert.deepEqual(f({ phase: 'strike', knocks: [{ hit: true, boat: 'sail', x: 1, z: 2, where: 'rail' }] }), ['knock']);
  assert.deepEqual(f({ phase: 'swim', knocks: [{ hit: true, boat: 'sail' }] }), [], 'a second contact inside 0.2 s is swallowed')
  t += 1;
  assert.deepEqual(f({ lockId: 'b1' }), ['lock']);
  assert.deepEqual(f({ lockId: 'b1' }), [], 'the lock holds: no repeat');
  assert.deepEqual(f({ lockId: null }), []);
  t += 2;
  assert.deepEqual(f({ lockId: 'b2' }), ['lock'], 'a new lock cues again');
  assert.deepEqual(f({ lunge: { phase: 'rise' } }), ['riseStart']);
  assert.deepEqual(f({ lunge: { phase: 'rise' } }), []);
});

test('every voice builds on an offline context and renders finite, quiet audio (no clipping)', async (t) => {
  const Ctx = globalThis.OfflineAudioContext;
  if (!Ctx) { t.skip('no OfflineAudioContext in this node'); return; }
  for (const type of ['dash', 'ready', 'windup', 'knock', 'creak', 'lock', 'riseStart', 'under', 'break']) {
    const ctx = new Ctx({ numberOfChannels: 2, length: 48000 * 3, sampleRate: 48000 }), out = new GainNode(ctx, { gain: 0.9 });
    out.connect(ctx.destination);
    voice(ctx, out, { type, x: 5, z: 5, s: 1, boat: 'halcyon', where: 'rail', kind: 'rail', mult: 1 }, 0.01, { gain: 1, pan: 0, seed: 3 });
    const b = await ctx.startRendering(), d = b.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) { assert.ok(Number.isFinite(d[i])); peak = Math.max(peak, Math.abs(d[i])); }
    assert.ok(peak > 0.0005, `${type} makes sound`); assert.ok(peak < 0.9, `${type} stays under the master's ceiling (${peak.toFixed(2)})`);
  }
});

test('her sound obeys the effects switch and the master: a muted effects switch closes her door; a frame with her off builds nothing', async (t) => {
  const Ctx = globalThis.OfflineAudioContext;
  if (!Ctx) { t.skip('no OfflineAudioContext in this node'); return; }
  const ctx = new Ctx({ numberOfChannels: 2, length: 48000, sampleRate: 48000 }), master = new GainNode(ctx, { gain: 1 }); master.connect(ctx.destination);
  const on = {}; const settings = { get: (k) => (k === 'effects' ? false : true), on: (fn) => { on.fn = fn; } };
  const S = createTessieSound({ audio: { ready: Promise.resolve({ ctx, master }), master }, settings });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(S.play({ type: 'slap', x: 0, z: 0, s: 1 }, { x: 0, z: 0, yaw: 0 }), true, 'it plays into a closed door (nothing audible)');
  assert.equal(S.played({ on: false }), true);
  assert.equal(S.stats.cues ?? 0, 0, 'off: no cue');
  assert.equal(S.played({ on: true, speedK: 0.5, speed: 9, nose: 3, eyeDepth: 3, dt: 1 / 60, boats: [], her: { x: 0, z: 0, psi: 0 }, events: [{ type: 'dash' }], skill: { phase: 'active' } }), true);
  assert.equal(S.stats.lastCue, 'dash'); assert.equal(S.stats.cues, 1);
  S.played({ on: true, speedK: 0.5, speed: 9, nose: 3, eyeDepth: 3, dt: 1 / 60, boats: [], her: { x: 0, z: 0, psi: 0 }, events: [], skill: { phase: 'active' } });
  assert.equal(S.stats.cues, 1, 'the one-shot fired once across two frames');
  assert.ok(S.stats.under < 800 && S.stats.under > 350, `the world's low-pass at 3 m (${S.stats.under} Hz)`);
});
