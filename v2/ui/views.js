// The two views (M4): v1's follow view and helm view with the ≈ 1 s move between them, as src/deck/index.js runs them, on
// v1's own pure pieces: the helm camera (src/sim/boat/helmCamera.js: the eye in the boat's cockpit), its horizon held level
// (sim/steadyCamera.js HelmHorizonCamera), the blend (src/boat/viewBlend.js: ViewBlend, blendPose) and the sloop's camera
// numbers. Pure (no DOM): a capture (?view=helm on a headless page) and the live page share it; tests drive it.
//   const V = createViews({ vessel, view: 'follow' | 'helm' });
//   V.set('helm'), V.toggle(), V.cut('follow') (no move), V.view, V.k (0 follow … 1 helm)
//   V.pose(dt, followPose, boatPose, { look, zoom }) → { pos, target, up, fov, near }
//   The Helm view holds the horizon, always (no setting; owner 2026-11-19, 2026-11-25): the view keeps 20 % of the hull's slow
//   pitch and 15 % of its slow heel (2.5 s low-pass), the eye's wave bob out to ± 0.15 m; the cockpit heels and pitches in the
//   frame. The OS's Reduce Motion holds HORIZON_REDUCED (steadier still). V.helmCam.horizon → the numbers in force.
import { ViewBlend, blendPose } from '../../src/boat/viewBlend.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { HORIZON, HORIZON_REDUCED, HelmHorizonCamera, reducedNow } from '../sim/steadyCamera.js';

export function createViews({ vessel, view: start = 'follow', followYaw = () => null, reduced = reducedNow } = {}) {
  const helmCam = new HelmHorizonCamera(sloopCameras(vessel).helm, reduced() ? HORIZON_REDUCED : HORIZON);
  let view = start === 'helm' ? 'helm' : 'follow';
  const blend = new ViewBlend(view);
  let followPose = null, lastBoat = null, onSet = null;
  const V = {
    helmCam, blend,
    get view() { return view; }, get k() { return blend.k; }, get moving() { return blend.k > 0 && blend.k < 1; },
    onChange(fn) { onSet = fn; },
    // deck.setView: a move from the follow camera's place now, slower when it had orbited away from astern
    set(v) {
      if ((v !== 'helm' && v !== 'follow') || v === view) return view;
      if (v === 'helm' && blend.k === 0) helmCam.reset();
      view = v;
      const s = lastBoat, d = followPose && s ? Math.hypot(followPose.pos[0] - s.x, followPose.pos[1], followPose.pos[2] - s.z) : undefined;
      blend.to(v, { distM: d, swingRad: s && followYaw() != null ? followYaw() - s.heading : 0 });   // the follow camera orbited away from astern: a slower swing
      onSet?.(view);
      return view;
    },
    toggle() { return V.set(view === 'helm' ? 'follow' : 'helm'); },
    // a cut, no move (K2: knocked down past 45° the Helm view cuts to the Boat view: a 90° horizon makes people sick)
    cut(v) { if (v !== 'helm' && v !== 'follow') return view; const was = view; view = v; blend.jump(v); if (was !== v) onSet?.(view); return view; },
    get dur() { return blend.dur; },
    // the camera chain's views part (deck.camera): the helm camera runs while it is the view or on the way; then the blend
    pose(dt, follow, boat, { look = null, zoom = 1 } = {}) {
      followPose = follow; lastBoat = boat;
      helmCam.horizon = reduced() ? HORIZON_REDUCED : HORIZON;   // read live: the filters keep their state, so the switch never pops
      const helmP = view === 'helm' || blend.k > 0 ? helmCam.update(dt, boat, { look: view === 'helm' ? look : null, zoom: view === 'helm' ? zoom : 1 }) : null;
      blend.step(dt);
      return blend.k <= 0 || !helmP ? { ...follow, near: 0.5 } : blend.k >= 1 ? helmP : blendPose(follow, helmP, blend.e, { eye: helmP.pos, heading: boat.heading });
    },
  };
  return V;
}
