// The first-visit flow inside the world. Two layers:
//   createFirstSail({ settings, effects })  the rules: pure, driven by update(dt, ctx), tested in tests/firstVisit.test.mjs
//   attachFirstSail({ settings, services, core, getOptions, menu })  the live layer: the chips, the island beacon, the hint row
// The rules and the chips are three-free in src/ui/firstSailGuide.js (v2 runs them as they are: v2/ui/firstSail.js); this
// file adds v1's beacon on the island (a three sprite) and the staged first visit's timing (src/ui/firstStage.js).
// What it does, by profile (settings.profile, set by the welcome on the home card):
//   new      Sail: one subtitle line once ("Drag the wheel to steer…"), then a goal, "Sail to Fannette Island", with a
//            soft beacon on the island and a pointer chip; on arrival (the logbook's island find, the postcard) R.'s
//            line, then one next suggestion. Cruise: after 60 s a gentle "Take the helm".
//   sail     one winch hint.   race   one line pointing at Regatta on Hard.
//   any      once, when the skills model rates the player pro (and Pro mode is off): "Sailing like a pro — switch to Pro mode?"
// Each line shows once per welcome (the flags in settings; "show the welcome again" clears them).
import { STAGE } from './firstStage.js';
import { attachFirstSailGuide } from '../../../src/ui/firstSailGuide.js';
export { TIMING, createFirstSail } from '../../../src/ui/firstSailGuide.js';
const STAGED_LINE = 'Drag the wheel to steer.';   // the staged first visit: the first steering line, short (owner, 2026-11-05)

export function attachFirstSail({ settings, services, core, getOptions = () => services.get('modeOptions') ?? {}, menu, stage = null }) {
  // the beacon on the island: a soft column of warm light, a sprite that always faces the camera (3D only; none in a headless capture)
  let beacon = null, beaconOn = false, THREE = null, loading = false, at = null;   // three is fetched the first time a beacon is wanted (the menu's stand-in page has no bundler)
  function makeBeacon() {
    if (beacon || !core.scene) return;
    if (!THREE) { if (!loading) { loading = true; import('three/webgpu').then((m) => { THREE = m; if (beaconOn) { makeBeacon(); place(); } }).catch(() => {}); } return; }
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'), img = g.createImageData(64, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {   // a soft column: a gaussian across, brightest at the foot, gone at the top
      const u = (x - 31.5) / 32, v = 1 - y / 127, a = Math.exp(-u * u * 7) * Math.pow(v, 1.6) * 0.9;
      const i = (y * 64 + x) * 4; img.data[i] = 255; img.data[i + 1] = 206; img.data[i + 2] = 140; img.data[i + 3] = Math.round(255 * a);
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, opacity: 0 });
    beacon = new THREE.Sprite(mat); beacon.name = 'first-visit-beacon'; beacon.renderOrder = 5; beacon.frustumCulled = false;
    core.scene.add(beacon);
  }
  function place() {
    if (!beacon) return;
    beacon.visible = beaconOn;
    if (!beaconOn || !at) return;
    const { dist, island } = at, h = 90 + dist * 0.06, w = 14 + dist * 0.02;
    beacon.position.set(island.x, h / 2, island.z); beacon.scale.set(w, h, 1);
    beacon.material.opacity = Math.min(0.8, Math.max(0.15, (dist - 150) / 700));   // soft up close, so it never blocks the postcard's view
  }
  const hook = {
    set(on, dist, island) { beaconOn = on; at = { dist, island }; if (on) makeBeacon(); place(); },
    dispose() { if (beacon) { core.scene?.remove(beacon); beacon.material.map?.dispose(); beacon.material.dispose(); } },
  };
  return attachFirstSailGuide({ settings, services, getOptions, menu, beacon: hook, stage, introLineS: STAGE.introLineS, stagedLine: STAGED_LINE });
}
