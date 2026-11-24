// The gulls that come to the boat (owner, 2026-11-24: "their gulls circle the boat, glide in the classic gull 'M' shape and
// bank into turns. We'd keep our own 4 species and models and take only the behaviour"). Our California gulls, our mesh and
// our flight model (src/birds/flight.js Bird.steer, Bird.wings); the behaviour is Web Ocean 3D's ship circlers
// (github.com/2600th/web-ocean-3d src/scene/Birds.ts, MIT, ATTRIBUTION.md), ported:
//   - the circuit: a circle plus a second and a third harmonic in the same parameter (W: Birds.ts positionOf, ENVELOPES.ship),
//     centred on an anchor that follows the boat with a 2.5 s lag (W: SHIP_ANCHOR_LAG), so they fall behind on her turns;
//     the lap rate from an airspeed (a wide circuit takes longer), one direction for the flock, two skeins half a lap apart;
//   - the glide gate: a slow oscillator per bird (a 14–30 s period) thresholded by a per-bird bias; the flapping's
//     amplitude is gated, not its phase, so a bird settles into the glide (W: style, GLIDE_WIDTH);
//   - the M: the arm raised 0.26 rad and the hand drooped −0.48 rad in the glide (W: ARM_DIHEDRAL_GLIDE, HAND_DROOP_GLIDE);
//   - the bank: the coordinated turn's roll × a gain (birds over-bank), capped at 0.95 rad (W: BANK_GAIN, MAX_ROLL);
//   - the cries: Poisson flurries of 1–3 (the count drawn squared: an answer is the exception), a 2.5 s floor between flurries,
//     none in the first 6 s, thinner in rain and in strong wind (W: AudioSystem.ts GULL_FLURRY_*, GULL_RAIN_*, GULL_WIND_*).
// Ours, not theirs: our gulls are flown, not evaluated in closed form: each pursues its point on the circuit through
// Bird.steer (the turn limited by the bank a real wing allows), so they fly in from the far flock and away again without a
// jump; they come and go in visits (a visit of 3–6 gulls every few minutes; the rest stay v1's far flock); the hour, the
// storm's shelter and the night keep v1's rules.
// THE RULE (owner, 2026-11-24, after the first stills: "allow closer birds", replacing for these gulls the 2026-11-05 "no bird
// within 40 m of the camera"): a circling gull keeps keepM (15 m) from the camera, in the follow and the helm views alike; every
// other bird keeps 40 m (sim/birds.js KEEP_M). The circuit is centred on the boat (its lagged anchor) and moved off her only as
// far as keeps its near edge camPlan (16 m) from the camera, so it sweeps round her and crosses in front of the follow camera at
// 15–25 m (a 1.5 m gull ≈ 60–90 px across at 1280 × 720). In the helm view (the camera on the boat) that rule lays it ahead of
// the bow. A circling gull is exempt from the 75 m soft push, never from its floor (sim/birds.js keepAway).
// No landing on the boat (that needs the owner's OK). Pure: no GPU, no DOM, no Math.random, no wall clock.
//   const G = createGulls({ gulls, seed, env, keepM });   G.step(dt, simT, { day, shelter })   (inside the sim's fixed substep)
//   G.state → { visiting, circling, visits, anchor, centre }; G.calls (every cry it asked for: the tests)
import { rng, hashSeed, glidePose, G as GRAV } from '../../src/birds/flight.js';
import { clamp, clamp01, smooth } from '../../src/sim/core/math.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;

export const GULLS = Object.freeze({
  on: true,
  lagS: 2.5,                     // s: the anchor's lag behind the boat (W: SHIP_ANCHOR_LAG)
  jumpMps: 30,                   // m/s: a boat moving faster than this jumped (a reset, a cut): the anchor re-seats
  keepM: 15,                     // m: a circling gull's floor from the camera (owner, 2026-11-24: "allow closer birds")
  camPlan: 16,                   // m: the circuit's near edge from the camera (the floor + a margin for the pursuit)
  squash: 1,                     // the circuit's depth along the line of sight, × its width across it (round: it circles her)
  helmM: 8,                      // m: a camera this close to the boat (the helm view) lays the circuit ahead of the bow
  radius: [17, 24],              // m: the circuit's radius round the boat (W: ship 16–46)
  harm2: [0.08, 0.14], harm3: [0.03, 0.06],   // the 2nd and 3rd harmonics' amplitudes, × the radius (W: 0.08–0.22, 0.03–0.08)
  alt: [8, 13],                   // m over the water: low in the follow camera's frame, not at its top edge (W: 11–34); over the
                                 // boat they hold the mast's top + clearM (below)
  bob: [1, 2.5],                 // m: the climb and sink twice a lap
  scale: [1.15, 1.3],             // × our 1.32 m gull (W: the ship birds' scale, 1.0–1.3 on its 1.3 m gull): they read clearly at 15–25 m
  mastTop: 11.5, clearM: 4,      // m: inside boatR of the boat a gull holds at least mastTop + clearM
  boatR: 14,
  speed: [8, 10],                // m/s: the mean speed round the circuit (our gull cruises at 9.9; W: 8.5–11.5)
  maxSpeed: 15,                  // m/s: flying in to the circuit, and its fast side with the boat's drift
  pursueK: 0.35,                 // 1/s: how hard a gull closes on its point
  bankGain: 1.5, maxRoll: 0.95,  // W: BANK_GAIN 3 on its 16–46 m circuits; 1.5 on ours (a coordinated 24° shows ≈ 34°)
  arm: 0.26, hand: -0.48,        // rad: the M glide (W: ARM_DIHEDRAL_GLIDE, HAND_DROOP_GLIDE)
  gateS: [14, 30],               // s: the glide gate's period (W)
  gateBias: [-0.2, 0.6],         // the gate's threshold on sin: higher glides more (W: ship −0.7–0.5; ours glide more)
  maxCircling: 6,                // gulls that may come in (the rest stay v1's far flock)
  farM: 320, joinM: 140,         // m: a joining gull further than farM from the boat starts joinM from the camera, out of view
  visit: { firstS: 8, stayS: [70, 120], awayS: [60, 150], size: [3, 6], joinS: [0, 8], leaveS: [0, 10] },
  calls: { firstS: 6, meanS: 18, floorS: 2.5, flurry: 3, answerS: [0.6, 2.0], range: 160,
    windThin: 6, windLow: 12, windFloor: 0.3,   // m/s: thinner from about level 3's top (12 kn), to 0.3 × at level 4's top (24 kn)
    rainThin: 0.25, rainSilent: 0.8 },          // the storm's rain (shelter / 1.5): thin, then silent (W)
});

// the circuit's offset of bird i at its parameter θ: [across, along, up] (pure: the tests read it)
export function circuitOffset(p, th) {
  const a2 = th * 2 + p.ph2, a3 = th * 3 + p.ph3;
  const x = p.R * Math.cos(th) + p.h2 * Math.cos(a2) + p.h3 * Math.cos(a3);
  const z = p.R * Math.sin(th) + p.h2 * Math.sin(a2) + p.h3 * Math.sin(a3);
  return [x, z, p.bob * Math.sin(th * 2 + p.phb)];
}
// the centre's distance from the camera that keeps bird i's whole circuit at least camPlan from it: the circuit's near edge
// is on the line of sight (the squashed ellipse's nearest point to a camera on its axis is the axis's end), at depth
// squash × (R + h2 + h3); dy is the bird's height over the camera's eye
export function centreDistance(p, dy, D = GULLS) {
  const ext = D.squash * (p.R + p.h2 + p.h3);
  const dyMin = Math.max(0, Math.abs(dy) - p.bob);
  return ext + Math.sqrt(Math.max(0, D.camPlan * D.camPlan - dyMin * dyMin));
}
// the roll a gull shows for its turn (W: the coordinated turn × the gain, capped); + right wing down (flight.js)
export const bankOf = (speed, turn, D = GULLS) => -clamp(Math.atan(D.bankGain * speed * turn / GRAV), -D.maxRoll, D.maxRoll);

export function createGulls({ gulls, seed = 1, env, D = GULLS } = {}) {
  const n = Math.min(D.maxCircling, gulls.length);
  const r0 = rng(hashSeed(seed, 7171));
  const dir = r0() < 0.4 ? -1 : 1;                 // one direction for the flock (W: mixed directions fly through each other)
  const skein0 = r0() * TAU;
  const P = [];
  for (let i = 0; i < n; i++) {
    const r = rng(hashSeed(seed, 7200 + i));
    const R = lerp(D.radius, r()), v = lerp(D.speed, r());
    const p = {
      R, h2: R * lerp(D.harm2, r()), ph2: r() * TAU, h3: R * lerp(D.harm3, r()), ph3: r() * TAU,
      alt: lerp(D.alt, r()), bob: lerp(D.bob, r()), phb: r() * TAU,
      w: 0, v,
      th0: skein0 + (i % 2) * Math.PI + (r() - 0.5) * 1.1,   // two skeins half a lap apart, strung out (W)
      scale: lerp(D.scale, r()), gateW: TAU / lerp(D.gateS, r()), gatePh: r() * TAU, gateBias: lerp(D.gateBias, r()),
      join: lerp(D.visit.joinS, r()), leave: lerp(D.visit.leaveS, r()),
      th: 0, yawWant: null, pv: [0, 0], prev: null,
    };
    // the lap rate from the airspeed (W), over the path as it is flown (squashed, with its harmonics): the mean speed is v
    let L = 0, q0 = circuitOffset(p, 0);
    for (let k = 1; k <= 96; k++) { const q = circuitOffset(p, (k / 96) * TAU); L += Math.hypot(q[0] - q0[0], (q[1] - q0[1]) * D.squash); q0 = q; }
    p.w = dir * v * TAU / L;
    P.push(p);
  }
  // the visits: [start, end, size] laid out lazily on the scene clock from the seed (deterministic under ?hour)
  const rv = rng(hashSeed(seed, 7301));
  const visits = [];
  let laidTo = 0;
  const layVisits = (t) => {
    while (laidTo <= t + 600) {
      const start = visits.length ? laidTo + lerp(D.visit.awayS, rv()) : D.visit.firstS;
      const end = start + lerp(D.visit.stayS, rv());
      const size = Math.round(lerp(D.visit.size, rv()));
      visits.push({ start, end, size: Math.min(n, size) });
      laidTo = end;
    }
  };
  const visitAt = (t) => { layVisits(t); for (const v of visits) { if (t < v.start - 30) break; if (t >= v.start && t < v.end + 15) return v; } return null; };

  const anchor = { x: 0, z: 0, ok: false, lastX: 0, lastZ: 0, v: 0 };
  const U = { x: 0, z: -1, ok: false };          // the line of sight through the boat, lagged as the anchor
  const st = { visiting: false, circling: 0, visit: null, centreD: 0 };
  const calls = [];
  const rc = rng(hashSeed(seed, 7401));
  let nextCall = D.calls.firstS, pending = [];

  function track(dt, boat, cam) {
    if (!anchor.ok || !(dt > 0)) { anchor.x = boat.x; anchor.z = boat.z; anchor.lastX = boat.x; anchor.lastZ = boat.z; anchor.ok = true; }
    else {
      const step = Math.hypot(boat.x - anchor.lastX, boat.z - anchor.lastZ);
      anchor.lastX = boat.x; anchor.lastZ = boat.z;
      if (step > D.jumpMps * dt) { anchor.x = boat.x; anchor.z = boat.z; }
      else {
        const k = 1 - Math.exp(-dt / D.lagS), x0 = anchor.x, z0 = anchor.z;
        anchor.x += (boat.x - anchor.x) * k; anchor.z += (boat.z - anchor.z) * k;
        anchor.v += (Math.hypot(anchor.x - x0, anchor.z - z0) / dt - anchor.v) * (1 - Math.exp(-dt / 1.5));   // its speed (the bird clock's: Sail's 2× boat reads 2×)
      }
    }
    // the line of sight: from the camera through the anchor; the helm view (the camera on the boat): her bow
    let ux = anchor.x - cam[0], uz = anchor.z - cam[2], l = Math.hypot(ux, uz);
    if (l < D.helmM) { ux = Math.sin(boat.heading); uz = -Math.cos(boat.heading); l = 1; }
    ux /= l; uz /= l;
    if (!U.ok || !(dt > 0)) { U.x = ux; U.z = uz; U.ok = true; }
    else { const k = 1 - Math.exp(-dt / D.lagS); U.x += (ux - U.x) * k; U.z += (uz - U.z) * k; const m = Math.hypot(U.x, U.z) || 1; U.x /= m; U.z /= m; }
  }
  // bird i's point on its circuit now: [x, y, z], and the centre's distance from the camera
  function pointOf(i, cam) {
    const p = P[i];
    const H = Math.hypot(anchor.x - cam[0], anchor.z - cam[2]);
    const Hc = Math.max(H, centreDistance(p, p.alt - cam[1], D));
    const cx = cam[0] + U.x * Hc, cz = cam[2] + U.z * Hc;
    const [a, b, up] = circuitOffset(p, p.th);
    const ax = -U.z, az = U.x;                     // across the line of sight
    const x = cx + ax * a + U.x * b * D.squash, z = cz + az * a + U.z * b * D.squash;
    let y = p.alt + up;
    y = Math.max(y, env.heightAt(x, z) + 14);      // over a point of land: well over it
    return [x, y, z, Hc];
  }

  const mPose = { ...glidePose('gull', 0.4), flap: D.arm, hand: D.hand };

  function fly(b, i, dt, cam, boat) {
    const p = P[i];
    // the lap slows as the boat speeds up, so the fast side (lap + drift) stays inside a gull's speed: gulls behind a fast boat
    // hang and stretch their circuit rather than race round it
    p.th += p.w * clamp((D.maxSpeed - 1 - anchor.v) / (p.v * 1.25), 0.35, 1) * dt;
    b.scale = (b.scale ?? 1) + (p.scale - (b.scale ?? 1)) * clamp01(dt / 3);   // eased in over ≈ 3 s
    const [px, py, pz, Hc] = pointOf(i, cam);
    st.centreD = Hc;
    // the point's own velocity (the circuit's tangent × its rate, plus the anchor's drift: by difference, smoothed over 0.4 s:
    // the boat and the camera move once a frame, the substeps between) and the pursuit
    if (p.prev) { const k = 1 - Math.exp(-dt / 0.4); p.pv[0] += ((px - p.prev[0]) / dt - p.pv[0]) * k; p.pv[1] += ((pz - p.prev[2]) / dt - p.pv[1]) * k; }
    const pv = p.pv;
    p.prev = [px, py, pz];
    let vx = pv[0] + (px - b.pos[0]) * D.pursueK, vz = pv[1] + (pz - b.pos[2]) * D.pursueK;
    // round the camera, never at it: inside camPlan + 10 m a closing velocity loses its inward part (the bird slides round the
    // keep-out and on to its point, instead of pressing on its floor)
    const cx = b.pos[0] - cam[0], cz = b.pos[2] - cam[2], ch = Math.hypot(cx, cz) || 1;
    if (ch < D.keepM + 4) {
      const nx = cx / ch, nz = cz / ch, vin = vx * nx + vz * nz;
      if (vin < 0) { vx -= vin * nx; vz -= vin * nz; const k = (D.keepM + 4 - ch) * 0.3; vx += nx * k; vz += nz * k; }
    }
    const vh = Math.hypot(vx, vz);
    const want = clamp(vh, D.speed[0] * 0.8, D.maxSpeed);
    const yaw = Math.atan2(vx, vz);
    const ffRaw = p.yawWant == null ? 0 : wrapPi(yaw - p.yawWant) / dt;
    p.ff = (p.ff ?? 0) + (clamp(ffRaw, -1.2, 1.2) - (p.ff ?? 0)) * (1 - Math.exp(-dt / 0.3));
    const ff = p.ff;
    p.yawWant = yaw;
    // the boat's rig: never lower than its masthead + clearM within boatR of her (they circle well above the sail)
    let floorY = 0;
    if (boat && Math.hypot(b.pos[0] - boat.x, b.pos[2] - boat.z) < D.boatR + 6) floorY = D.mastTop + D.clearM + 1;
    const wantY = Math.max(py, floorY);
    const vy = clamp((wantY - b.pos[1]) * 0.6, -2, 2.4);
    const roll0 = b.roll;
    b.steer(dt, yaw, want, vy, { maxBankDeg: 50, ff, accel: 3 });
    // the bank: W's over-banked coordinated turn, from the turn rate the steer flew
    b.roll = roll0 + (bankOf(b.speed, b.turn, D) - roll0) * clamp01(dt * 3);
    if (boat && Math.hypot(b.pos[0] - boat.x, b.pos[2] - boat.z) < D.boatR && b.pos[1] < D.mastTop + D.clearM) b.pos[1] = D.mastTop + D.clearM;
    // the glide gate: flapping while the slow oscillator is over the bird's bias, or climbing; the M between (W)
    const gate = Math.sin(p.gateW * b.t + p.gatePh) > p.gateBias;
    b.beatsLeft = 0; b.glideLeft = 1e9;
    b.forceFlap = gate || vy > 1.6 || want > D.maxSpeed - 0.5 ? 1 : 0;   // the gate, a climb, flying in at full speed
    b.wings(dt, { base: mPose });
  }

  function cry(dt, simT, cam, gain) {
    // answers due now
    for (let k = pending.length - 1; k >= 0; k--) if (simT >= pending[k].t) { emitFrom(pending[k].i, cam, gain); pending.splice(k, 1); }
    if (simT < nextCall) return;
    const C = D.calls;
    nextCall = simT + Math.max(C.floorS, -Math.log(1 - rc() * 0.999) * C.meanS);
    if (gain <= 0.02) return;
    const near = [];
    for (let i = 0; i < n; i++) { const b = gulls[i]; if (b.mode === 'circle' && b.fade > 0.5 && Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]) < C.range) near.push(i); }
    if (!near.length) return;
    const u = rc(), count = 1 + Math.floor(u * u * C.flurry);   // squared: most flurries are one bird (W)
    let t = simT;
    for (let k = 0; k < count; k++) {
      const i = near[(Math.floor(rc() * near.length) + k) % near.length];
      if (k === 0) emitFrom(i, cam, gain);
      else { t += lerp(C.answerS, rc()); pending.push({ t, i }); }
    }
  }
  function emitFrom(i, cam, gain) {
    const b = gulls[i];
    if (!b || b.mode !== 'circle' || b.fade < 0.3) return;
    const e = { kind: 'call', species: 'gull', pos: [...b.pos], gain, id: b.id };
    env.emit(e); calls.push({ t: env.simT, id: b.id, gain, d: +Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]).toFixed(1) });
    if (calls.length > 2000) calls.splice(0, 500);
  }
  // the cries' gain: thinner in strong wind and in the rain (W's gates, on the lake's levels)
  function cryGain(shelter) {
    const C = D.calls, w = Math.hypot(env.wind[0], env.wind[1]), rain = shelter / 1.5;
    const kw = 1 - (1 - C.windFloor) * smooth(C.windThin, C.windLow, w);
    const kr = 1 - smooth(C.rainThin, C.rainSilent, rain);
    return kw * kr;
  }

  function step(dt, simT, { day = 1, shelter = 0 } = {}) {
    if (!D.on || !(dt > 0)) return;
    const boat = env.boat();
    if (!boat) return;                             // no boat (v1's scenes, the parity test): v1's flock as it is
    const cam = env.camera;
    track(dt, boat, cam);
    const v = day > 0.5 && shelter < 0.3 ? visitAt(simT) : null;
    st.visit = v; st.visiting = !!v;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const b = gulls[i];
      const inV = v && i < v.size && simT >= v.start + P[i].join && simT < v.end + P[i].leave;
      if (inV && b.mode === 'flock') {
        // a gull far off (the flock is v1's, roaming; the boat may have started elsewhere) is moved in, unseen: beside the camera
        // and out of its view (54–74° off the line of sight: outside a 16:9 frame's half-width, on the boat's side), joinM away, faded out to fade in (cheat on where, not on motion)
        if (Math.hypot(b.pos[0] - anchor.x, b.pos[2] - anchor.z) > D.farM) {
          const side = i % 2 ? 1 : -1, a = Math.atan2(U.x, U.z) + side * (0.95 + 0.35 * P[i].join / D.visit.joinS[1]), r = D.joinM + 4 * i;
          b.pos[0] = cam[0] + Math.sin(a) * r; b.pos[2] = cam[2] + Math.cos(a) * r; b.pos[1] = P[i].alt + 8;
          b.yaw = Math.atan2(anchor.x - b.pos[0], anchor.z - b.pos[2]); b.fade = 0;
        }
        b.mode = 'circle'; P[i].prev = null; P[i].yawWant = null; P[i].pv = [Math.sin(b.yaw) * b.speed, Math.cos(b.yaw) * b.speed];
        // its parameter where the circuit passes nearest the bird (it flies in to it, no jump)
        let best = 0, bd = Infinity;
        for (let k = 0; k < 24; k++) { P[i].th = (k / 24) * TAU; const q = pointOf(i, cam); const d = Math.hypot(q[0] - b.pos[0], q[2] - b.pos[2]); if (d < bd) { bd = d; best = P[i].th; } }
        P[i].th = best;
      } else if (!inV && b.mode === 'circle') {
        b.mode = 'flock'; b.glideLeft = b.rand(...b.sp.flight.glide); b.forceFlap = 0;   // its scale kept (no pop in view)
      }
      if (b.mode === 'circle') { fly(b, i, dt, cam, boat); c++; }
    }
    st.circling = c;
    cry(dt, simT, cam, cryGain(shelter));
  }

  return {
    step, calls, params: P, n,
    get state() { return { ...st, anchor: [anchor.x, anchor.z], los: [U.x, U.z], visits: visits.slice() }; },
    pointOf: (i, cam) => pointOf(i, cam),
  };
}
