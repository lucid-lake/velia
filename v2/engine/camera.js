// The camera's pose from the URL (M2): v1's presets (src/sim/core/presets.js CAMERAS: ?cam=A is above the bay by the
// mouth, B a boat's eye on the water, O the overlook…), so a v2 capture and a v1 capture of the same URL share the
// pose; ?campos=x,y,z&camlook=x,y,z (v1's proof rows) any viewpoint; ?camyaw / ?campitch (compass and elevation, deg)
// turn the preset's eye; ?camfov the vertical field (v1's default 50°). Pure: main.js and the tests.
//   const c = cameraPose(flags);  c.eye [x, y, z], c.fwd (unit), c.fovDeg, c.near, c.far
import { CAMERAS } from '../../src/sim/core/presets.js';
import { forwardOf } from './math.js';

export const NEAR = 0.5, FAR = 120000, FOV = 50;   // v1's near and fov (src/core/index.js); far past the ring (±49 km)
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const vec = (s) => { const a = String(s ?? '').split(',').map(Number); return a.length === 3 && a.every(Number.isFinite) ? a : null; };

export function cameraPose(f) {
  const preset = CAMERAS[f.cam] ?? CAMERAS.A;
  let eye = preset.pos.slice(), look = preset.look.slice(), fovDeg = preset.fov ?? FOV;
  const cp = vec(f.campos);
  if (cp) { eye = cp; look = vec(f.camlook) ?? [0, 0, 0]; }
  let fwd = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
  const l = Math.hypot(...fwd) || 1; fwd = fwd.map((x) => x / l);
  const yaw = num(f.camyaw), pitch = num(f.campitch);
  if (yaw != null || pitch != null) {
    const y0 = (Math.atan2(fwd[0], -fwd[2]) * 180) / Math.PI, p0 = (Math.asin(fwd[1]) * 180) / Math.PI;
    forwardOf(fwd, yaw ?? y0, pitch ?? (yaw != null ? 2 : p0));   // a yaw alone looks level-ish (M1's 2° up)
  }
  const fov = num(f.camfov);
  if (fov != null) fovDeg = fov;
  return { eye, fwd, fovDeg, near: NEAR, far: FAR, cam: cp ? 'pos' : (CAMERAS[f.cam] ? f.cam : 'A') };
}
