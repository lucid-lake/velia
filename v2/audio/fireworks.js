// The fireworks' sound and music on v2 (v1's src/fireworks/sound.js and music.js, imported as they are: every shell heard
// at its real time and place, the echo off the walls, the finale's wall, the shore's cheer; "Over The Clouds" as the
// finale's echoes die). Both join a context through `audio.attach(fn, bus)`, src/audio.js's contract; v2 has no audio
// core yet, so this is the least of one: one AudioContext made on the player's first gesture (a key, a tap, a click:
// the browser's rule), a master gain and a music gain into it, and the music bus's owner (claimMusic / yieldMusic).
// A capture (?headless) and ?fwsound=0 make none (v1's rule: a capture builds the plan only).
//   const a = createFireworksAudio({ show, barges, scale, seed, phone, base })   → { update(showT, listener, dt, hour), leave(), stats }
import { createFireworksSound } from '../../src/fireworks/sound.js';
import { createFireworksMusic, musicWant } from '../../src/fireworks/music.js';
import { UNLOCKERS } from '../../src/audio.js';

export const GESTURES = Object.freeze(['keydown', 'pointerdown', 'touchstart', 'mousedown']);
export const LEVEL = Object.freeze({ master: 0.8, music: 0.9 });
export const LEAVE_FADE_S = 0.25;   // s: a show piece's fade when the show is left (fix 2026-11-18)

// the least audio core: attach(fn, bus) runs fn({ ctx, master }) once the context exists (now, or on the first gesture)
export function createAudioCore({ Ctx = globalThis.AudioContext, target = globalThis } = {}) {
  let ctx = null, master = null, music = null, owner = null;
  const waiting = [];
  function start() {
    if (ctx || !Ctx) return;
    ctx = new Ctx();
    master = new GainNode(ctx, { gain: LEVEL.master }); master.connect(ctx.destination);
    music = new GainNode(ctx, { gain: LEVEL.music }); music.connect(master);
    for (const [fn, bus] of waiting.splice(0)) fn({ ctx, master: bus === 'music' ? music : master });
  }
  // iOS runs a context only from a touchend, pointerup, click or key (v1's UNLOCKERS): those re-try resume() too (fix/v2-ios-audio)
  const onGesture = () => { start(); if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
  const heard = [...new Set([...GESTURES, ...UNLOCKERS])];
  for (const e of heard) target.addEventListener?.(e, onGesture, { passive: true, capture: true });
  return {
    attach(fn, bus = 'effects') { if (ctx) fn({ ctx, master: bus === 'music' ? music : master }); else waiting.push([fn, bus]); },
    claimMusic(player = null) { if (owner && owner !== player) owner.release?.(1.5); owner = player; },
    yieldMusic(player) { if (owner === player) owner = null; },
    start,
    get state() { return ctx?.state ?? 'none'; },
    dispose() { for (const e of heard) target.removeEventListener?.(e, onGesture, { capture: true }); },
  };
}

// core: the page's music door (v2/audio/music.js createLateCore: the page's context, v1's music bus and its one owner, the boat's
// radio from Setup's row, the mode for Cruise's score); without one, the least core above (its own context)
export function createFireworksAudio({ show, barges, scale, seed = 1, phone = false, base = 'audio/fireworks/', on = true, core = null } = {}) {
  const audio = on ? core ?? createAudioCore() : null;
  const root = new URL(base, globalThis.document?.baseURI ?? 'http://localhost/').pathname;
  const mode = core?.mode ?? (() => 'sail');
  const music = createFireworksMusic({ audio, base: `${root}music/`, mode, score: () => mode() === 'cruise', radioOn: core?.radioOn ?? (() => false) });   // v1's src/fireworks/world.js
  // the shells' sound needs the show's script: made with it (show null: later, by setShow, when the plug-in makes the show
  // off the boot path: v2/sim/lazyShow.js); the music needs no script and is made now (the radio plays all evening)
  let sound = null;
  const setShow = (s) => { if (!sound && s) sound = createFireworksSound({ audio, show: s, barges, scale, seed, phone, base: root, onBang: (when, gain) => music.duck(when, gain) }); };
  setShow(show);
  const radioOn = core?.radioOn ?? (() => false);
  let leaving = false, leaves = 0;
  return {
    audio, music, setShow,
    get sound() { return sound; },
    get leaves() { return leaves; },
    // the show left at once (a time pick, skipping time, a race, a cut: the plug-in's leave; fix 2026-11-18): every shell's
    // voice, the murmur and the wall stopped now; at the next update a show piece (the score, the drift home's) the new hour
    // does not want fades in LEAVE_FADE_S, not its own seconds (the radio is the player's: it plays on)
    leave() { sound?.hush(); leaving = true; leaves++; },
    // every frame: the show clock (null outside its window), the camera (listener: { x, y, z, fx, fz }), the real dt, the hour
    update(showT, listener, dt, hour) {
      sound?.update(showT, listener, dt || 1 / 60);
      if (leaving) {
        leaving = false;
        const p = music.playing, m = mode();
        if (p && p.want !== 'radio' && musicWant({ showT, hour, mode: m, score: m === 'cruise', radio: radioOn() }).want !== p.want) music.stop(LEAVE_FADE_S);
      }
      music.update({ showT, hour }); music.prefetch(hour);
    },
  };
}
