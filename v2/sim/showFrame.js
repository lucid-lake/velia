// Cruise's camera during the fireworks (owner, 2026-11-15: "we might just have a camera to look at that fireworks angle").
// The boat keeps her own autopilot route; only the camera on screen turns toward the show while it plays, from where it is
// (its position stays: the rig's own shot), and turns back after the finale. Sail has no show camera at all (owner,
// 2026-11-15: "fireworks on means fireworks on, the boat is independent"): the player sails toward it and looks up.
//   const sf = createShowFrame({ aim, length }); sf.step(dt, t, { input, instant }) → w (0..1, eased)
//   sf.apply(pose, w) → a new pose: the forward turned toward the aim by w, the lens a little wider (pos and up kept)
// The weight eases in over easeIn s from 2 s before the first riser (t = −2), holds through the show, and eases out over
// easeOut s from the show's end (t = length). Its rate is bounded, so a jump of the show clock (the time menu) never snaps
// the view. The player's own look wins: any look input while the show plays lets the view go (over yieldS) for the rest of
// that show. A capture (instant) sets the weight from t at once: deterministic, whatever came before.
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export const SHOW_FRAME_CRUISE = Object.freeze({
  easeIn: 2, easeOut: 2, yieldS: 0.75,   // s
  lead: 2,                               // s before t = 0 the turn starts (full by the first riser)
  aimY: 200,                             // m over the water: the bursts' middle sits above the frame's centre (median burst ≈ 310 m)
  pitchMin: 4, pitchMax: 34,             // deg: the turned view's tilt up, kept off the zenith and off the water
  fov: 14, fovMax: 80,                   // deg added to the shot's lens at full weight, and the cap
});

export function createShowFrame({ aim = [0, 0], length = 300, F = SHOW_FRAME_CRUISE } = {}) {
  let raw = 0, yielded = false;
  const self = {
    get weight() { return smooth(raw); },
    get yielded() { return yielded; },
    // the weight the show clock asks for (before the yield)
    want(t) { return t != null && t >= -F.lead && t < length ? 1 : 0; },
    step(dt, t, { input = false, instant = false } = {}) {
      const inShow = self.want(t) === 1;
      if (!inShow) yielded = false;   // the next show frames again
      else if (input) yielded = true;
      const target = inShow && !yielded ? 1 : 0;
      if (instant) raw = target;
      else {
        const rate = target > raw ? 1 / F.easeIn : (yielded ? 1 / F.yieldS : 1 / F.easeOut);
        const d = Math.max(0, dt) * rate;
        raw = target > raw ? Math.min(target, raw + d) : Math.max(target, raw - d);
      }
      return self.weight;
    },
    // pose: { pos, target, up?, fov, ... } → the same pose turned toward the show by w
    apply(pose, w = self.weight) {
      if (!pose || !(w > 0)) return pose;
      const p = pose.pos, dx0 = pose.target[0] - p[0], dy0 = pose.target[1] - p[1], dz0 = pose.target[2] - p[2];
      const L = Math.hypot(dx0, dy0, dz0) || 1;
      const yaw0 = Math.atan2(dx0, dz0), pitch0 = Math.asin(Math.max(-1, Math.min(1, dy0 / L)));
      const ax = aim[0] - p[0], az = aim[1] - p[2], flat = Math.hypot(ax, az) || 1;
      const yaw1 = Math.atan2(ax, az);
      const pitch1 = Math.min(F.pitchMax, Math.max(F.pitchMin, Math.atan2(F.aimY - p[1], flat) * 180 / Math.PI)) * Math.PI / 180;
      let dyaw = yaw1 - yaw0; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));   // the short way round
      const yaw = yaw0 + dyaw * w, pitch = pitch0 + (pitch1 - pitch0) * w;
      const c = Math.cos(pitch);
      const target = [p[0] + Math.sin(yaw) * c * L, p[1] + Math.sin(pitch) * L, p[2] + Math.cos(yaw) * c * L];
      const fov = Math.min(Math.max(pose.fov, F.fovMax), pose.fov + F.fov * w);
      return { ...pose, target, fov };
    },
  };
  return self;
}
