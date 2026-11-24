// Sail's live controls in node: the real attachControls (src/sail/controls.js) with its real tool dock,
// seamanship, view switch, hint line, pads, helm station, control panel and throttle lever, on the dom-cascade.mjs document, a real
// BoatPhysics and a real Boat; the GPU's parts are stand-ins (the 3D HUD's slots, the renderer, the sea's ride, the sounds).
// The keys go in as window events, the frames as update(dt); the boat, the controls' state and the DOM come out.
//
//   const s = mountSail({ w: 390, h: 844, coarse: true });   // a phone held upright
//   s.key('KeyW'); s.step(30); s.key('KeyW', false);          // hold W for 30 frames
//   s.c.sheet; s.phys.state; s.c.dock.spec('helm'); document.querySelector('.lk-view')
//   s.dispose();
// The src modules load before any DOM is installed (src/terrain-data.js takes the node path only while there is no window),
// on terrain-small.mjs's small lake (the real grids cost ≈ 110 ms to load and none of this reads them).
import './terrain-small.mjs';
import * as THREE from 'three/webgpu';
import { attachControls } from '../../classic/src/sail/controls.js';
import { BoatPhysics, steadyWind } from '../../src/sim/boat.js';
import { Boat } from '../../classic/src/boat/Boat.js';
import { FollowCamera } from '../../src/sim/boat/followCamera.js';
import { watchDevice } from '../../src/ui/device.js';
import { isCoarse } from '../../src/ui/touchMap.js';
import { installDom } from './dom-cascade.mjs';
import { parseFlags } from '../../src/sim/core/flags.js';
import { createServices } from '../../src/sim/core/services.js';
import { installMirror } from '../../classic/src/core/mirror.js';

// a stand-in for what the controls only pass along (the sounds, the LOD, the sea's spray): any property is another stand-in,
// any call returns one, and as a number it is 0
export const any = (name = 'any') => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === Symbol.iterator ? function* () {} : (t[k] ??= any(`${name}.${String(k)}`))),
  apply: () => any(`${name}()`), construct: () => any(`new ${name}`),
});

// w × h: the window (css px); coarse: a finger; params: the page's query; hud: false is a page without the 3D HUD (no helm
// station, panel or lever); windKn: a steady true wind from the north; headingDeg: the boat's start (90: a beam reach);
// pads: the gamepads navigator.getGamepads() returns
// boatAudio, sfx: the boat's sound and the controls' sounds (null: none, as before; the frame-order test passes spies)
// vessel: the boat's profile (this page's boat by default; tests/lessons.test.mjs gives a paddle craft's to see the seam refuse it)
export function mountSail({ w = 1280, h = 720, coarse = false, params = '', hud = true, windKn = 12, headingDeg = 90, pads = [], wind: windIn = null, env = null, boatAudio = null, sfx = null, vessel = undefined } = {}) {
  const dom = installDom({ w, h, coarse, search: `?mode=sail&once=0&${params}` });
  // a finger: the device profile reads the fake pointer (watchDevice below publishes data-input; lk-touch is retired)
  watchDevice({ coarse: () => isCoarse() });   // the device tier's classes on <html>, as the shell sets them
  const gp = navigator.getGamepads;
  navigator.getGamepads = () => pads;           // the test's gamepads (pads.js reads them each frame)
  const wind = windIn ?? { level: 3, calls: [], setLevel(n, o) { this.level = n; this.calls.push(n); }, gustAt: null };   // wind: a real WindField (tests/helpers/sim-sail.mjs)
  // the 3D HUD (hud3d.js): slots that never draw; the helm station, the panel and the lever are built as on a page with a GPU
  const hud3d = hud ? { slots: [], slot(o) { this.slots.push(o); return { get rect() { return o.rect?.() ?? null; }, setOpacity() {}, opacity: 1, dispose() {} }; }, crisp: false, render: () => 0, present: () => false } : null;
  // the page's registry (src/main.js): the controls get a mode's scope of it, and window.__lakeshore mirrors it as on a page
  const services = createServices(); installMirror(services);
  const core = { services: services.scope(), flags: parseFlags(`once=0&${params}`), renderer: { domElement: document.createElement('canvas'), getPixelRatio: () => 1 }, camera: new THREE.PerspectiveCamera(),
    lod: any('lod'), msg: document.createElement('div'), T0: 0, wind, scene: new THREE.Scene(), terrain: { heightAt: () => -20 }, audio: any('audio'),
    setTime() {}, sun: { hour: 12, elevationDeg: 40, exposure: 1 }, hud: hud3d,
    clock: { hourAt: () => 12, setHour() {}, rateAt: () => 1 } };
  document.body.appendChild(core.renderer.domElement);
  const heading = headingDeg * Math.PI / 180;
  const phys = new BoatPhysics({ x: 400, z: 400, heading, vessel });   // on open water, clear of the island (vessel: this page's boat unless given)
  const boat = new Boat();
  boat.modules.wheel ??= new THREE.Group(); boat.modules.cockpit ??= new THREE.Group();   // the GLBs' nodes (empty: no file loads in node)
  const follow = new FollowCamera({ x: 400, z: 400, heading });
  const ride = { step: (r, s) => ({ ...s, heave: 0, pitch: 0 }), wave: {}, spray: any('spray') };
  const windAt = steadyWind(windKn * 0.514444, 0);
  core.services.provide('boat', { phys, boat, follow, env: env ?? ((t) => ({ windAt, t })) });
  let c;
  try { c = attachControls(core, { boat, phys, follow, ride, boatAudio, sfx, air: null }); }
  catch (e) { core.services.dispose(); navigator.getGamepads = gp; dom.uninstall(); throw e; }   // a refused mount (tests/lessons.test.mjs) leaves no page behind
  // every line the skipper is given (the hint line's note and flash), in order
  const said = [];
  for (const k of ['note', 'flash']) { const f = c.hint[k]; if (f) c.hint[k] = (text, ...a) => { said.push(String(text)); return f.call(c.hint, text, ...a); }; }
  const step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { c.update(dt); dom.frame(); } };
  const key = (code, down = true, extra = {}) => dom.key(down ? 'keydown' : 'keyup', code, extra);
  const tap = (code, extra = {}) => { key(code, true, extra); key(code, false, extra); };
  return { c, dom, phys, boat, follow, ride, wind, core, services, hud: hud3d, said, pads, step, key, tap,
    dispose() { c.dispose(); core.services.dispose(); navigator.getGamepads = gp; dom.uninstall(); } };
}
