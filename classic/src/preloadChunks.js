// The chunks the mode's start imports one after another (perf/slow-loading-2): on Slow 4G each import waited a
// round trip (562 ms) after the last (the kayak fleet, then the fireworks' world, its spectators, stage, show, music,
// then the audio format: ≈ 4 rounds in the phone's 'mode' step). Fetched and evaluated together during the bake, when the
// link is idle, they are in the module map by the time the boot asks; the same modules, so nothing runs differently
// (none has top-level work beyond its definitions). A failure here is silent: the boot imports them as before.
const MODE_CHUNKS = [
  () => import('./kayaks/fleet.js'),
  () => import('./fireworks/world.js'),
  () => import('./fireworks/composite.js'),
  () => import('./birds/index.js'),
  () => import('../../src/birds/sound.js'),
  () => import('three/addons/tsl/display/FXAANode.js'),
  () => import('./waters/ultra/gpuBridge.js'),
  () => import('../../src/audioFormat.js'),
  () => import('./shell.js'),
];
export function preloadModeChunks(list = MODE_CHUNKS) {
  for (const load of list) Promise.resolve().then(load).catch(() => {});
  return list.length;
}
