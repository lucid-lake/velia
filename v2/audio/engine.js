// The engine's sound and the anchor chain on v2 (#14, #8; hybrid, as the beds): v1's src/engineAudio.js as it is (its recordings
// engine_idle, engine_run and chain_run, its synthesised beat, wet exhaust and starter, its mix rules), on v1's effects bus of
// the music's core (v1: audio.attach(fn), bus 'effects'), so Settings' sound and effects and M apply as in v1. Live pages only: the files load after the first gesture, by v1's paths (audio/boat/, Opus or the AAC twin).
//   const eng = createEngineSound({ beds, base });   // beds: v2/audio/bedsLive.js
//   each frame: eng.update(state, { camDist, chainMs })   (state: the physics': engineRpm, engineState, thrust)
// Offline (the film's sound): renderEngine({ frames, fps, base }) renders the same engine from recorded frames.
import { createEngineAudio } from '../../src/engineAudio.js';

// core: the music's v1 audio contract (v2/audio/music.js music.core): v1 attaches the engine there, on the effects bus (Settings'
// effects, sound and M); without the music (?music=0, a ?filmui=1 film) the beds' boat input (beds.attach) instead
export function createEngineSound({ core = null, beds = null, base = 'audio/', fetchFn = (u, o) => fetch(u, o) }) {
  let ea = null;
  const make = (ctx, destination) => { ea = createEngineAudio({ ctx, destination, base: `${base}boat/`, fetchFn }); };
  if (core) core.attach(({ ctx, master }) => make(ctx, master), 'effects');
  else beds?.attach(({ ctx, effects }) => make(ctx, effects));
  return {
    update(state, opts) { return ea && ea.update(state, opts); },
    get mix() { return ea?.mix ?? null; },
    get ready() { return ea?.ready ?? null; },
    get log() { return ea?.log ?? []; },
  };
}

// frames: [{ engineRpm, engineState, thrust, camDist, chainMs }] at fps; → { channels: [Float32Array, Float32Array], sampleRate }
export async function renderEngine({ frames, fps = 30, base = 'audio/', sampleRate = 48000, fetchFn = (u, o) => fetch(u, o) }) {
  const length = Math.ceil((frames.length / fps + 0.5) * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const ea = createEngineAudio({ ctx, destination: ctx.destination, base: `${base}boat/`, fetchFn });
  await ea.ready;
  frames.forEach((f, i) => ea.update({ engineRpm: f.engineRpm, engineState: f.engineState, thrust: f.thrust }, { camDist: f.camDist, chainMs: f.chainMs }, i / fps));
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate, log: ea.log };
}
