// The contract between the boat physics (S1, src/boat.js), the assembly (Boat.js), the camera and the controls.
// Plain JS, no three.js. Frame: x east, y up, z south (the world frame of src/terrain.js); bow along heading.
// heading: radians clockwise from north (−z), the same convention as src/camera.js yaw.
//
// Physics API (S1 implements it):
//   const phys = new BoatPhysics({ x, z, heading });
//   phys.step(dt, controls, env)   // dt s; env = { windAt(x, z, t) → { vx, vz }, currentAt(x, z, t) → { vx, vz }, waveAt(x, z, t) → { y, nx, nz }, t }
//   phys.state → STATE (below)
//
// controls: { rudder: −1..1 (port..starboard), main: 0..1 (sheeted in..eased out), jib: 0..1, autoTrim: bool,
//             flatten: 0..1, reef: 0 | 1 | 2 }

export const STATE = {
  x: 0, z: 0, heading: 0,          // m, m, rad
  u: 0, v: 0,                      // surge, sway through the water, m/s (boat frame: +u forward, +v to starboard)
  yawRate: 0,                      // rad/s
  heel: 0, pitch: 0, heave: 0,     // rad (+heel = to starboard), rad (+ bow up), m
  rudderAngle: 0,                  // rad, + to starboard
  boomAngle: 0, jibAngle: 0,       // rad from the centreline, + to starboard (the side the sail sits on)
  mainFill: 1, jibFill: 1,         // 0 = luffing, 1 = full
  mainDraft: 1, jibDraft: 1,       // 0..1 sail fullness (flatten reduces it)
  jibBacked: false,                // the jib is pressed from the wrong side (mid-tack)
  reef: 0,
  apparentWind: { speed: 0, angle: 0 },   // m/s; rad from the bow, + from starboard
  trueWind: { speed: 0, angle: 0 },
  sog: 0, cog: 0,                  // speed and course over ground (with current), m/s and rad
};

export const DEFAULT_SPEED = 2;
