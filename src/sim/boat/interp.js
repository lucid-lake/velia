// Render-state interpolation ("fix your timestep", Glenn Fiedler): the physics ticks at a fixed 1/60 s, a display
// refreshes at 60, 90, 120 or 144 Hz with jitter. Drawing the last physics state moves the boat in 60 Hz steps (some
// frames by nothing, some by two) while the camera glides every frame, so the boat judders against the world.
// Instead keep the state before the last tick and draw prev → cur at alpha = (time left in the accumulator) / tick.
//   const ip = new StateInterp();
//   while (acc >= STEP) { ip.mark(phys.state); phys.step(...); acc -= STEP; }
//   const render = ip.at(phys.state, acc / STEP);   // what the boat, the wake and the camera see
// Plain JS, no three.js. Angles take the short way round; non-numbers (flags, strings, null) come from the newer state.

const TAU = Math.PI * 2;
// radians that wrap: the heading and the angles measured from it (apparent/true wind angle sit inside the nested objects)
const ANGLES = new Set(['heading', 'cog', 'angle', 'boomAngle', 'jibAngle', 'rudderAngle', 'heel', 'pitch']);

function lerpAngle(a, b, k) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return a + d * k;
}

function lerpState(a, b, k) {
  if (!a || k >= 1) return b;
  const out = {};
  for (const key of Object.keys(b)) {
    const x = a[key], y = b[key];
    if (typeof y === 'number' && typeof x === 'number') out[key] = ANGLES.has(key) ? lerpAngle(x, y, k) : x + (y - x) * k;
    else if (y && typeof y === 'object' && !Array.isArray(y) && x && typeof x === 'object') out[key] = lerpState(x, y, k);
    else out[key] = y;
  }
  return out;
}

export class StateInterp {
  constructor() { this.prev = null; }
  // call just before each physics tick: remembers the state the tick starts from
  mark(state) { this.prev = cloneNums(state); }
  // the state to draw: alpha 0 = the state before the last tick, 1 = the state after it
  at(state, alpha) {
    if (!this.prev) return state;
    return lerpState(this.prev, state, Math.min(1, Math.max(0, alpha)));
  }
}

function cloneNums(s) {
  const o = {};
  for (const k of Object.keys(s)) { const v = s[k]; o[k] = v && typeof v === 'object' && !Array.isArray(v) ? cloneNums(v) : v; }
  return o;
}
