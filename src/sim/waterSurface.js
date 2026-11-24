// The water surface the sim floats on (Sprint 0): the hull float (src/sim/boat/float.js), the marks and the
// kayaks read the water's height through this interface, never through the renderer.
//   surface = { heightAt(x, z, t, opts) → m }   opts: { depthM, filterM, … } (the Smith effect, the hull's filter)
//   water   = { surface, waveAt(x, z, t, opts), orbitAt?(x, z, t, opts) }   the water a craft rides (src/sim/boat/ride.js)
// Each engine provides one; the sim never asks which:
//   v1 classic   the CPU spectrum (makeSpectrumSurface: src/sim/water-spectrum.js), the waves the Gerstner shader draws;
//   v1 Ultra     the read-back surface (makeCpuSurface: src/sim/waters/ultra/surface.js), filled each frame from the GPU
//                FFT's read-back by src/waters/ultra/gpuBridge.js (surface.pushWindow(layers, t): one frame late, carried
//                forward along the last two reads' trend);
//   v2           the same read-back surface filled from its own compute pass, or any object with heightAt.
export { makeCpuSurface } from './waters/ultra/surface.js';
export { makeSurface as makeSpectrumSurface } from './water-spectrum.js';

// A live view of water.surface: the water rebuilds its surface when the wind or the fetch changes, so a holder (the hull
// float) reads through the water each call
export const liveSurface = (water) => ({ heightAt: (...a) => water.surface.heightAt(...a) });
