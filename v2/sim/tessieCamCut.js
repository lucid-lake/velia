// Tessie M3, Cruise's camera cut (owner, 2026-11-18: "in Cruise, when she appears, the camera turns to show
// her for a few seconds, gently, then returns"; the owner's camera ruling: slow, no sharp turns, at most 15°/s, eased). Pure: no
// DOM, no GPU, no wall clock: the frame's dt only.
// The cut is a yaw offset on Cruise's own shot: once a sighting, when she has broken the surface, the aim turns toward her (the
// angle off the shot's middle, at most CAMCUT.maxDeg), holds while she is up for holdS, then turns back to the shot. The turn
// is a rate- and acceleration-limited move: it speeds up at CAMCUT.accDeg °/s², never past rateDeg °/s, and slows to a stop on
// its mark (the speed allowed is what can still stop in the angle left), so it starts and ends softly. The player's own look
// (a drag, the binoculars) sends it back at once at the same gentle rate.
//   const K = createCamCut()
//   K.step(dt, { cue: bool, angle: rad | null, input: bool }) → the yaw offset (rad, + to the right)
//     cue: a new sighting has broken the surface (the plug-in says so once); angle: her bearing off the shot's middle now
//   K.apply(c, yaw) → the camera { pos, target, … } turned about its position by yaw
//   K.state { phase ('idle' | 'turn' | 'hold' | 'back'), yaw, rate, t, cuts }
export const CAMCUT = Object.freeze({ rateDeg: 15, accDeg: 10, holdS: 4, maxDeg: 50, minDeg: 4 });
const DEG = Math.PI / 180;

export function createCamCut({ K = CAMCUT } = {}) {
  const st = { phase: 'idle', yaw: 0, rate: 0, t: 0, cuts: 0, want: 0 };
  const vmax = K.rateDeg * DEG, acc = K.accDeg * DEG;
  // one step of the gentle move toward `want`: accelerate, cap, brake to stop on it
  function move(dt, want) {
    const e = want - st.yaw;
    const h = acc * dt / 2, stopV = Math.sqrt(h * h + 2 * acc * Math.abs(e)) - h;   // the speed that can still stop in what is left (in whole frames)
    const vWant = Math.sign(e) * Math.min(vmax, stopV);
    const dv = Math.max(-acc * dt, Math.min(acc * dt, vWant - st.rate));
    st.rate += dv;
    let step = st.rate * dt;
    if (Math.abs(step) > Math.abs(e) || (Math.abs(e) < 2e-5 && Math.abs(st.rate) < acc * dt)) { step = e; st.rate = 0; }
    st.yaw += step;
  }
  const self = {
    K, state: st,
    step(dt, { cue = false, angle = null, input = false } = {}) {
      if (!(dt > 0)) return st.yaw;
      st.t += dt;
      if (cue && st.phase === 'idle' && angle != null && Math.abs(angle) > K.minDeg * DEG && !input) { st.phase = 'turn'; st.t = 0; st.cuts++; }
      if (input && st.phase !== 'idle') st.phase = 'back';
      if (st.phase === 'turn' || st.phase === 'hold') {
        if (angle == null) st.phase = 'back';
        else {
          // her angle off the shot's own middle (before the turn): the turn aims at her, within maxDeg
          st.want = Math.max(-K.maxDeg * DEG, Math.min(K.maxDeg * DEG, angle));
          if (st.phase === 'turn' && ((Math.abs(st.want - st.yaw) < 1 * DEG && Math.abs(st.rate) < 1 * DEG) || st.t > 8)) { st.phase = 'hold'; st.t = 0; }
          if (st.phase === 'hold' && st.t >= K.holdS) st.phase = 'back';
        }
      }
      if (st.phase === 'back') st.want = 0;
      move(dt, st.phase === 'idle' ? 0 : st.want);
      if (st.phase === 'back' && Math.abs(st.yaw) < 1e-4 && Math.abs(st.rate) < 1e-4) { st.phase = 'idle'; st.yaw = 0; st.rate = 0; }
      return st.yaw;
    },
    apply(c, yaw = st.yaw) {
      if (Math.abs(yaw) < 1e-5) return c;
      // + to the right: the aim's heading (x = sin, z = −cos) grows by yaw
      const cs = Math.cos(yaw), sn = Math.sin(yaw), dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2];
      return { ...c, target: [c.pos[0] + dx * cs - dz * sn, c.target[1], c.pos[2] + dx * sn + dz * cs] };
    },
  };
  return self;
}
