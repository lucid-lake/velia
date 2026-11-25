// The paddle-wheeler (South Lake's birthplace, phase C part 1): a generic, unnamed 46 m stern-wheel excursion boat, one model for
// every paddle-wheeler on the lake (the south shore's and Emerald Bay's). This part places her and runs her straight at a set speed
// along a heading (the review row ?paddle=x,z,heading[,kn]); her routes come later. Pure: no GPU (the tests drive it).
//   const S = createPaddleWheeler({ x, z, headingDeg, kn, depthAt })
//   S.post(dt)                       the boat's tick: her speed eased toward the target (a 300 t hull: slow), the wheel turned by it
//   S.boat                           { x, z, heading (rad, 0 north, + clockwise), v (m/s), wheel (rad), wheelRate (rad/s), stopped }
//   S.trail                          her wake's record (render/vesselWake.js): newest first every TRAIL_DT s
//   S.emitters()                     her as a wake emitter (render/vesselWake.js): the wheel's wash, the V, the stem's foam
//   S.lights(out, o, { sunElevDeg, eye, heightAt })   her nav lights as glow records (0 by day)
// Frames: x east, z south (world); her own frame x starboard, y up from the waterline, z aft (the bow at −z), as every boat's.
import { GLOW_FLOATS, NAV_GLOW, navLevel, navSector } from './night.js';

const KN = 0.514444, DEG = Math.PI / 180;
// her numbers (the lake's real stern-wheelers: 40-50 m, about 9-10 m on the guards, a 1.5 m draft, 8-10 kn cruising; the wheel
// 6-7 m across turning 12-20 rpm)
export const PADDLE = Object.freeze({
  name: null,                                 // unnamed (no real boat's name or livery is drawn)
  length: 46, beam: 10.0, hullBeam: 9.2, draft: 1.5,
  bowZ: -21.5, transomZ: 17.5,                // the hull's stem and transom (her frame, m)
  wheel: Object.freeze({ z: 21.3, y: 2.35, r: 3.2, halfW: 3.5, buckets: 16, slip: 0.22 }),   // the axle (m aft, m up), the radius, half the width, the slip
  decks: Object.freeze([1.85, 4.45, 7.05]),   // the main, the second and the sun deck (m over the water)
  cruiseKn: 8,
  accelS: 45,                                 // s: the speed's time constant (a 300 t hull on one wheel)
  shoalM: 3.2, lookM: 80,                     // she eases to a stop where the water ahead (lookM) is shallower than shoalM
});
export const TRAIL_DT = 0.5;                  // s between wake samples (render/vesselWake.js VESSEL.dt)
const TRAIL_KEEP = 40;                        // s of trail kept (the wash's life)

// the review row: "x,z,heading[,kn]" (m, m, degrees true, knots: the cruise's 8 by default) → a pose, or null (absent, 0, junk)
export function parsePaddle(v) {
  if (v == null || v === false || v === '0' || v === 'off') return null;
  const a = String(v).split(',').map((s) => parseFloat(s));
  if (a.length < 2 || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) return null;
  const headingDeg = Number.isFinite(a[2]) ? a[2] : 0, kn = Number.isFinite(a[3]) ? Math.max(0, Math.min(14, a[3])) : PADDLE.cruiseKn;
  return { x: a[0], z: a[1], headingDeg, kn };
}

// the wheel's turn rate for a speed: the buckets move aft through the water faster than she moves ahead by the slip
export const wheelRate = (v, W = PADDLE.wheel) => v / (W.r * (1 - W.slip));

export function createPaddleWheeler({ x = 0, z = 0, headingDeg = 0, kn = PADDLE.cruiseKn, depthAt = null, settled = true } = {}) {
  const target = kn * KN;
  // settled: she is already at her speed (a review pose and a capture see her under way at once; a real start eases up)
  const boat = { x, z, heading: headingDeg * DEG, v: settled ? target : 0, wheel: 0, wheelRate: 0, stopped: false, target };
  const trail = [];
  let trailT = 0, t = 0;
  const stats = { shoal: false, steps: 0 };
  function post(dt) {
    if (!(dt > 0)) return;
    t += dt; stats.steps++;
    const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
    // shoal water ahead: the target falls to 0 (she stops short, as a skipper would; her routes later keep her in deep water)
    let want = boat.target;
    if (depthAt) {
      let shoal = false;
      for (let d = 10; d <= PADDLE.lookM; d += 10) if (!(depthAt(boat.x + fx * (PADDLE.length / 2 + d), boat.z + fz * (PADDLE.length / 2 + d)) > PADDLE.shoalM)) { shoal = true; break; }
      stats.shoal = shoal;
      if (shoal) want = 0;
    }
    boat.v += (want - boat.v) * (1 - Math.exp(-dt / PADDLE.accelS * (want < boat.v ? 3 : 1)));   // a stop (the wheel backed) is quicker than a start
    if (boat.v < 0.02 && want === 0) boat.v = 0;
    boat.stopped = boat.v === 0;
    boat.x += fx * boat.v * dt; boat.z += fz * boat.v * dt;
    boat.wheelRate = wheelRate(boat.v);
    boat.wheel = (boat.wheel + boat.wheelRate * dt) % (Math.PI * 2);
    // the trail (her wake's record): every TRAIL_DT s, aged by dt
    for (const p of trail) p.age += dt;
    trailT -= dt;
    if (trailT <= 0) {
      trailT += TRAIL_DT;
      trail.unshift({ age: 0, x: boat.x, z: boat.z, fx, fz, v: boat.v, churn: Math.min(1.2, boat.v / (PADDLE.cruiseKn * KN)) });
      while (trail.length && trail[trail.length - 1].age > TRAIL_KEEP) trail.pop();
    }
  }
  // her nav lights (COLREGs rule 23: a power-driven vessel over 20 m: the masthead light forward, the sidelights, the stern light):
  // the masthead on the pilothouse's mast, red and green on the pilothouse's wings, the stern light over the wheel's beam
  const LENS = Object.freeze([
    { at: [8.1, 13.0, 0], c: [1.0, 0.95, 0.85], kind: 'steaming' },
    { at: [7.0, 8.3, -2.75], c: [1.0, 0.22, 0.16], kind: 'red' },
    { at: [7.0, 8.3, 2.75], c: [0.2, 1.0, 0.45], kind: 'green' },
    { at: [-PADDLE.wheel.z + 0.2, PADDLE.wheel.y + PADDLE.wheel.r + 0.9, 0], c: [1.0, 0.95, 0.85], kind: 'stern' },
  ]);   // (her frame: m forward, m up, m to starboard)
  function lights(out, o, { sunElevDeg = 90, eye = [0, 0, 0], heightAt = () => 0 } = {}) {
    const level = navLevel(sunElevDeg);
    if (!(level > 0)) return 0;
    const cap = Math.floor((out.length - o) / GLOW_FLOATS), fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), y0 = heightAt(boat.x, boat.z);
    let n = 0;
    for (const L of LENS) {
      if (n >= cap) break;
      const [f, y, s] = L.at, lx = boat.x + fx * f - fz * s, lz = boat.z + fz * f + fx * s, w = o + n * GLOW_FLOATS;
      const dx = eye[0] - lx, dz = eye[2] - lz, brg = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) / DEG;
      out[w] = lx; out[w + 1] = y0 + y; out[w + 2] = lz; out[w + 3] = -NAV_GLOW.size;   // a far point light (render/night.js)
      out[w + 4] = L.c[0]; out[w + 5] = L.c[1]; out[w + 6] = L.c[2];
      out[w + 7] = NAV_GLOW.radiance * level * navSector(L.kind, brg);
      n++;
    }
    return n;
  }
  return {
    boat, trail, post, lights, stats, lenses: LENS,
    get t() { return t; },
    // her as a wake emitter (render/vesselWake.js): the wheel's wash (7 m wide, white for seconds, the longest-lived), a stronger V
    // than the glass boat's (a 46 m displacement hull), the V's arms breaking white off her guards, the stem's foam
    emitters() {
      const W = PADDLE.wheel;
      return [{ trail, length: PADDLE.length * 0.85, kelvinAmp: 3.6, kelvinAge: 14, arms: { foam: 0.55, w: 1.2, life: 9, x0: PADDLE.beam / 2 },
        noses: [[-PADDLE.bowZ - 0.4, 0]], noseR: 0.9, noseFoam: 0.8,
        lines: [{ x: 0, aft: W.z + W.r * 0.4, w: W.halfW * 2, foam: 1.25, life: 40 }, { x: -PADDLE.hullBeam / 2 + 0.3, aft: PADDLE.transomZ - 1, w: 1.2, foam: 0.35, life: 10 }, { x: PADDLE.hullBeam / 2 - 0.3, aft: PADDLE.transomZ - 1, w: 1.2, foam: 0.35, life: 10 }] }];
    },
  };
}
