// Sail's controls as orders (refactor round 2, Phase C step 8, c): the seam
// fixtures the controls split must keep. Recorded on main before the cut (tools/sail-order.mjs --write), compared after
// (tests/sailDomOrder.test.mjs, tests/sailFrameOrder.test.mjs).
//   domOrder({ w, h, coarse, params })   → { body, head, window, canvas }: the body's and the head's children in order
//     (an element by its id, else its first class, else its tag) after the mount and after 3 frames, and the listeners on
//     the window and the canvas by type (a count each). CSS stacking with equal z-index follows DOM order, a style's place
//     in the head is its place in the cascade, and a listener left on the wrong signal changes a count.
//   frameOrder({ w, h, coarse, params }) → [name, …]: the calls one update(1/60) makes, in order, after three warm frames
//     (spies on the parts the frame drives: the physics, the drawn boat, the cameras, the pose onto the camera, the sounds,
//     the clock, the dock, the hint, the bar, the tools)
import { mountSail, any } from './sail-controls.mjs';

const tag = (e) => e.id || (typeof e.className === 'string' ? e.className.split(' ')[0] : '') || e.tagName;
const listeners = (t) => Object.fromEntries([...(t?._ls ?? new Map())].filter(([, a]) => a.length).map(([k, a]) => [k, a.length]).sort(([a], [b]) => (a < b ? -1 : 1)));

export const DOM_CASES = { desktop: { w: 1280, h: 720 }, phone: { w: 390, h: 844, coarse: true } };
export const FRAME_CASES = { follow: { w: 1280, h: 720 }, helm: { w: 1280, h: 720, params: 'view=helm' }, phone: { w: 390, h: 844, coarse: true } };

export function domOrder(o) {
  const s = mountSail(o);
  try {
    const snap = () => ({ body: [...document.body.children].map(tag), head: [...document.head.children].map(tag) });
    const mounted = snap();
    s.step(3);
    const stepped = snap();
    return { mounted, stepped, window: listeners(document.defaultView), canvas: listeners(s.core.renderer.domElement) };
  } finally { s.dispose(); }
}

// a spy on obj[key]: logs `name` on each call, then calls through
function spy(log, obj, key, name) {
  if (!obj || typeof obj[key] !== 'function') return;
  const f = obj[key];
  obj[key] = function (...a) { log.push(name); return f.apply(this, a); };
}

export function frameOrder(o) {
  const log = [];
  let on = false;
  const L = { push: (n) => { if (on) log.push(n); } };
  const boatAudio = { update() { L.push('boatAudio.update'); } };
  const sfx = any('sfx'); sfx.update = () => L.push('sfx.update');
  const s = mountSail({ ...o, boatAudio, sfx });
  try {
    const { c, core, services } = s;
    spy(L, s.ride, 'step', 'ride.step');
    spy(L, s.boat, 'update', 'boat.update');
    spy(L, s.follow, 'update', 'follow.update');
    spy(L, c.helmCam, 'update', 'helmCam.update');
    spy(L, core.camera.position, 'set', 'camera.position.set');
    spy(L, core, 'setTime', 'core.setTime');
    spy(L, c.sim, 'step', 'sim.step');
    spy(L, c.dock, 'update', 'dock.update');
    spy(L, c.hint, 'update', 'hint.update');
    spy(L, c.viewSwitch, 'update', 'viewSwitch.update');
    spy(L, c.pads, 'update', 'pads.update');
    spy(L, c.tools, 'update', 'tools.update');
    spy(L, c.tools, 'camera', 'tools.camera');
    spy(L, c.sea, 'camera', 'sea.camera');
    spy(L, c.sea, 'pre', 'sea.pre');
    spy(L, c.sea, 'post', 'sea.post');
    spy(L, c.rumble, 'update', 'rumble.update');
    spy(L, c.helmPick, 'update', 'helmPick.update');
    spy(L, c.ripple, 'update', 'ripple.update');
    spy(L, c.blend, 'step', 'blend.step');
    spy(L, c.trimPanel, 'update', 'trimPanel.update');
    spy(L, c.captain, 'update', 'captain.update');
    spy(L, services.get('station'), 'update', 'station.update');
    spy(L, services.get('panel'), 'update', 'panel.update');
    spy(L, services.get('tackBtn'), 'update', 'tackBtn.update');
    for (let i = 0; i < 3; i++) { c.update(1 / 60); s.dom.frame(); }
    on = true; c.update(1 / 60); on = false;
    return log;
  } finally { s.dispose(); }
}
