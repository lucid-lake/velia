// The two views (M4): v1's follow view and helm view with the ≈ 1 s move between them, as src/deck/index.js runs them, on
// v1's own pure pieces: the helm camera (src/sim/boat/helmCamera.js: the eye in the boat's cockpit, the horizon steadied by
// STEADY), the blend (src/boat/viewBlend.js: ViewBlend, blendPose) and the sloop's camera numbers. Pure (no DOM): a capture
// (?view=helm on a headless page) and the live page share it; tests drive it.
//   const V = createViews({ vessel, view: 'follow' | 'helm' });
//   V.set('helm'), V.toggle(), V.cut('follow') (no move), V.view, V.k (0 follow … 1 helm)
//   V.pose(dt, followPose, boatPose, { look, zoom }) → { pos, target, up, fov, near }
//   The Helm view steadies itself with the sea, always (no setting; owner 2026-11-19; sim/steadyCamera.js AUTO: heel and pitch cancel
//   0.4 → 0.7, smoothing 0.1 → 0.35 s, heave 1 → 0.5, by the measured heel + pitch rate); the OS's Reduce Motion holds CALM's values
//   (0.85, 0.5 s, 35 % heave). V.auto → { k, rate } for tests and captures.
import { HelmCamera } from '../../src/sim/boat/helmCamera.js';
import { ViewBlend, blendPose } from '../../src/boat/viewBlend.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { CALM, autoAt, createSeaSense, reducedNow } from '../sim/steadyCamera.js';

export const STEADY = 0.4;   // src/deck/index.js: the helm view cancels this share of the heel and pitch

export function createViews({ vessel, view: start = 'follow', followYaw = () => null, reduced = reducedNow } = {}) {
  const helmCam = new HelmCamera(sloopCameras(vessel).helm);
  helmCam.steady = STEADY;
  let heaveK = 1;
  const sense = createSeaSense();
  // each frame: Reduce Motion holds the calm values; else the sea decides between STEADY and AUTO.rough (the cfg is the helm camera's own copy)
  const apply = (r) => {
    if (r) { helmCam.steady = CALM.steady; helmCam.cfg.tau = CALM.helmTau; heaveK = CALM.heave; }
    else { const a = autoAt(sense.k); helmCam.steady = a.steady; helmCam.cfg.tau = a.tau; heaveK = a.heave; }
  };
  apply(false);
  let view = start === 'helm' ? 'helm' : 'follow';
  const blend = new ViewBlend(view);
  let followPose = null, lastBoat = null, onSet = null;
  const V = {
    helmCam, blend,
    get view() { return view; }, get k() { return blend.k; }, get moving() { return blend.k > 0 && blend.k < 1; },
    onChange(fn) { onSet = fn; },
    get auto() { return { k: sense.k, rate: sense.rate }; },
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
      const r = reduced(); sense.update(dt, boat); apply(r);
      const helmP = view === 'helm' || blend.k > 0 ? helmCam.update(dt, heaveK === 1 ? boat : { ...boat, heave: (boat.heave ?? 0) * heaveK }, { look: view === 'helm' ? look : null, zoom: view === 'helm' ? zoom : 1 }) : null;
      blend.step(dt);
      return blend.k <= 0 || !helmP ? { ...follow, near: 0.5 } : blend.k >= 1 ? helmP : blendPose(follow, helmP, blend.e, { eye: helmP.pos, heading: boat.heading });
    },
  };
  return V;
}
