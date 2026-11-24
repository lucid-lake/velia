// The kayak's paddler (feat/kayak-paddler): a stylised seated person in a PFD and a cap, on the
// kayak's seat anchor, hands on the held paddle's grips, paddling from a small controller. The figure is swappable: the
// motion drives the rig's controls (the hips, the chest, the head, the paddle, the grips), never a figure's own bones.
//
//   const gltf = await loadPaddlerGltf();     // { male, female }: models/paddler/ubc-*.glb (Quaternius, CC0; ATTRIBUTION.md)
//                                             // (loadPaddlerGltf('man'): the first round's figure, models/paddler/paddler.glb)
//   const k = createKayak({ paddle: 'held', … });
//   const p = createPaddler({ gltf, kayak: k, seed: 3, mode: 'cruise' });   // adds itself to k.group
//   p.setMode('rest' | 'cruise' | 'sprint' | 'turnLeft' | 'turnRight' | 'back')
//   p.setIntent({ throttle: -1..1, turn: -1..1 })                 // for a traffic system or a later player mode
//   const out = p.update(dt)                                       // one step: the pose, then the blades read back
//     out.events: [{ type: 'catch' | 'exit', side: 'L' | 'R', t }]   a blade entering / leaving the water this step
//     out.blades: { L: { depth, speed, tip }, R: … }   depth (m) of the blade's centre under the water (≤ 0: out), speed
//                  (m/s) of the blade aft through the water in the kayak frame (+ pushes the kayak ahead), tip (kayak frame)
//     out.thrust: the planted blade's drive (m/s² on the hull); out.yaw: its turning moment (+ the bow to starboard)
//     out.boat: { v (m/s ahead), r (rad/s, + to starboard), advance (m this step), dyaw (rad this step) }: the hull the
//               strokes drive; a host moves the kayak by advance and dyaw (stage.js) so the planted blade stays put
//     out.planted: { side, anchor (kayak frame), travel, slip } while a blade is locked in the water, else null
//     out.state: motion.state() (mode, intent, phase 0..1, hz, the gait weights, the stroke side, the stroke count)
//   p.setPose('cruise_catchR')                                     // hold a key pose (poses.js KEY_POSES), no motion
//   p.handError()                                                  // the worst hand-to-grip distance (m) of the last pose
//   p.setBoat({ v, r })                                            // the hull's surge (m/s) and yaw rate (rad/s), from a host
//   p.setLook(deg | null)                                          // a look over the water (deg, + to starboard), on top of the
//                                                                  // motion's own head: the lake's kayakers watching a boat
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildFigure } from './figure.js';
import { createRig } from './rig.js';
import { KEY_POSES } from './poses.js';
import { createPaddleMotion, loadSpeed, VBAR, MODES } from '../../../../src/sim/props/paddler/motion.js';
import { paddleFrame } from './poses.js';
import { CLIPS } from './clips.js';
import { pickLook, createPaddlerMaterials } from './look.js';

export { KEY_POSES, MODES };
export { createSplash } from './splash.js';
export { prepareFigure, prepareFigureSteps } from './figure.js';   // the shared figure shapes built ahead (the lake's fleet: as steps, one per idle task)
export const PULL_WINDOWS = Object.freeze({ cruise: 0.29, sprint: 0.26, back: 0.28, sweepR: 0.30, sweepL: 0.30 });   // each half's pull (phase)
export { skinLook, SKIN } from './look.js';
const PADDLER_GLB = '/models/paddler/paddler.glb';
const PADDLER_UBC = Object.freeze({ male: '/models/paddler/ubc-male.glb', female: '/models/paddler/ubc-female.glb' });

export async function loadPaddlerGltf(which = 'ubc') {
  const L = new GLTFLoader();
  if (which === 'man') return L.loadAsync(PADDLER_GLB);
  const [male, female] = await Promise.all([L.loadAsync(PADDLER_UBC.male), L.loadAsync(PADDLER_UBC.female)]);
  return { male, female };
}
// parse a GLB already in memory; { textures: false } drops its images first (Node has no image decoder: the tests)
export function parsePaddlerGltf(arrayBuffer, { textures = true } = {}) {
  let ab = arrayBuffer;
  if (!textures) {
    const dv = new DataView(ab), len = dv.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, len)));
    for (const m of doc.materials ?? []) { const p = m.pbrMetallicRoughness; if (p) delete p.baseColorTexture; delete m.normalTexture; }
    delete doc.images; delete doc.textures; delete doc.samplers;
    let js = new TextEncoder().encode(JSON.stringify(doc)); const pad = (4 - (js.length % 4)) % 4;
    if (pad) { const t = new Uint8Array(js.length + pad); t.set(js); t.fill(32, js.length); js = t; }
    const rest = new Uint8Array(ab, 20 + len), out = new Uint8Array(20 + js.length + rest.length);
    out.set(new Uint8Array(ab, 0, 12)); new DataView(out.buffer).setUint32(8, out.length, true);
    new DataView(out.buffer).setUint32(12, js.length, true); out.set(new Uint8Array(ab, 16, 4), 16);
    out.set(js, 20); out.set(rest, 20 + js.length); ab = out.buffer;
  }
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

// a clip's periodic C2 spline (uniform knots): its channels (x, y, z, then the quaternion parts with their signs aligned
// round the loop) and their second derivatives, from M[i−1] + 4 M[i] + M[i+1] = 6 (y[i+1] − 2 y[i] + y[i−1]) solved by
// Gauss–Seidel (diagonally dominant: 60 sweeps reach 1e-15); cached per clip
const SPLINES = new WeakMap();
function clipSpline(c) {
  let S = SPLINES.get(c);
  if (S) return S;
  const n = c.n, y = Array.from({ length: 7 }, () => new Float64Array(n));
  let prev = null;
  for (let i = 0; i < n; i++) {
    let q = c.q.slice(4 * i, 4 * i + 4);
    if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map((v) => -v);
    for (let j = 0; j < 3; j++) y[j][i] = c.p[3 * i + j];
    for (let j = 0; j < 4; j++) y[3 + j][i] = q[j];
    prev = q;
  }
  const M = y.map((ch) => {
    const m = new Float64Array(n), r = ch.map((v, i) => 6 * (ch[(i + 1) % n] - 2 * v + ch[(i - 1 + n) % n]));
    for (let it = 0; it < 60; it++) for (let i = 0; i < n; i++) m[i] = (r[i] - m[(i - 1 + n) % n] - m[(i + 1) % n]) / 4;
    return m;
  });
  S = { y, M };
  SPLINES.set(c, S);
  return S;
}

export function createPaddler({ gltf, kayak, seed = 1, look: lookOverrides = {}, pose = null, mode = 'cruise' } = {}) {
  if (!kayak?.paddle) throw new Error('createPaddler: the kayak needs paddle: "held"');
  const look = pickLook(seed, lookOverrides);
  const mats = createPaddlerMaterials(look, kayak.materials?.u);
  // gltf: one figure, or { male, female } (the seed picks: look.sex)
  const fig = buildFigure(gltf.scene ? gltf : gltf[look.sex] ?? gltf.male, look, mats);
  const group = new THREE.Group(); group.name = 'paddler';
  group.add(fig.root);
  kayak.group.add(group);
  const rig = createRig(fig, kayak);
  const motion = createPaddleMotion({ seed, mode: MODES[mode] ? mode : 'cruise' });
  const waterY = kayak.draft(kayak.dims.mass.empty + kayak.dims.mass.paddle + kayak.dims.mass.paddler);
  const P = kayak.paddle;
  const blade = { L: { depth: 0, speed: 0, tip: new THREE.Vector3(), prev: null, wet: false }, R: { depth: 0, speed: 0, tip: new THREE.Vector3(), prev: null, wet: false } };
  let current = null, held = null;

  // ---- the planted blade and the boat it drives (owner, 2026-11-07: "the boat will move"; 2026-11-08: "the boat is not
  // moving forward convincingly based on physics and math") ----
  // At the catch the working blade locks in the water: its place is fixed in the world while the boat runs past it, with
  // a little slip; the pull is the boat moving up to the blade, not the blade dragged back. The surge is integrated each
  // step from the blade's force: m·dv/dt = F_blade(t) − k·v·|v| − c·v (K3 § Round 9: the masses, the drag and their
  // sources). F_blade is zero in the air, a sine through the pull (peaking mid-stroke), eased in and out with the blade's
  // hold. The pull's pace follows the boat (motion's phase runs as fast as the boat passes the blade, see update), so the
  // planted blade and the stroke agree at any speed: from rest the first strokes slip more and accelerate the boat.
  const PULL = PULL_WINDOWS;
  const M_EFF = 108;                 // kg: kayak 25 + paddler 78 + paddle 1, plus ≈ 4 % added mass (a slender hull, surging)
  const DRAG_K = 7.5, DRAG_C = 6.0;  // N·s²/m², N·s/m: a wide recreational sit-on-top ≈ 2× a touring sea kayak's measured drag
  const FORCE = { cruise: 55, sprint: 112, back: -60, sweepR: 40, sweepL: 40 };   // N: the blade force's peak in the pull
  const SLIP = { cruise: 0.12, sprint: 0.18, back: 0.15, sweepR: 0.15, sweepL: 0.15 };   // blade slip / boat travel, under way
  const PULL_MIN = { cruise: 0.9, sprint: 1.2, back: 0.45, sweepR: 0.5, sweepL: 0.5 };   // m/s: the slowest the blade moves past the hull (from rest it slips)
  const I_YAW = 120, YAW_DAMP = 140;  // kg·m² (the boat and paddler about the vertical), N·m·s (the hull's yaw resistance)
  const YAW_ARM = { cruise: 1.0, sprint: 1.0, back: 1.0, sweepR: 2.6, sweepL: 2.6 };   // a sweep's force acts far forward and aft: a longer arm
  const boat = { v: 0, r: 0 };
  const plant = { on: false, side: null, gait: null, anchor: new THREE.Vector3(), travel: 0, slip: 0, w: 0, wm: 0, w2: 0, done: false };
  const _pf = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), dir: new THREE.Vector3() };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const Y = new THREE.Vector3(0, 1, 0);
  // where the blade really is now (after every guard of the last step), kayak frame: the catch plants it there
  function actualBlade(side) { P.group.updateMatrix(); return new THREE.Vector3(P.blades[side].centre, 0, 0).applyMatrix4(P.group.matrix); }
  // the loop's own blade centre (no constraints), kayak frame
  function splineBlade(pose, side) {
    paddleFrame(pose, kayak.anchors.seat.position, _pf);
    const m = new THREE.Matrix4().compose(_pf.position, _pf.quaternion, new THREE.Vector3(1, 1, 1));
    return new THREE.Vector3(P.blades[side].centre, 0, 0).applyMatrix4(m);
  }
  function strokeStep(pose, st, dt) {
    let g = null, wmax = 0;
    for (const [k, w] of Object.entries(st.weights)) if (k !== 'rest' && w > wmax) { wmax = w; g = k; }
    const active = g && st.weights.rest < 0.7;
    const h = st.phase % 0.5, win = active ? PULL[g] : 0, u = active ? h / win : 2;
    const side = g === 'sweepR' ? 'stbd' : g === 'sweepL' ? 'port' : st.phase < 0.5 ? 'stbd' : 'port';
    // the blade's exit: the loop's own (the pull's end), or sooner when the boat has run the blade back to the hip (the
    // bottom hand ends at the hip; the elbow never goes back behind the body)
    const hipZ = kayak.anchors.seat.position.z - (g === "sprint" ? 0.12 : 0.02);   // a sprint exits a hand sooner (the boat runs the blade back fastest)
    if (active && u < 1) {
      if (!plant.on && !plant.done || plant.side !== side || u < 0.05 && plant.u > 0.5) {
        if (plant.w < 0.05 || plant.side !== side) {
          plant.on = true; plant.done = false; plant.side = side; plant.gait = g; plant.anchor.copy(actualBlade(side)); plant.travel = 0; plant.slip = 0; plant.fast = false;
        }
      }
      plant.u = u;
      if (plant.on && plant.gait !== 'back' && !plant.gait.startsWith('sweep') && plant.anchor.z > hipZ) { plant.on = false; plant.done = true; }
    } else { plant.on = false; plant.done = false; }
    // the drive: the planted blade's push through the pull (a sine), scaled by how much of the blend paddles and by the
    // lock's eased weight (so the push builds and ends with the blade's hold, never a step: the boat's surge and yaw ease)
    const hold = plant.w > 0 && plant.gait ? plant.w : 0;
    // (a paddler's power, not force, is what runs out: at low speed the same effort pulls harder, up to 1.6 × from rest)
    const lowSpeedGain = 1 + 2.0 * Math.max(0, 1 - Math.abs(boat.v) / 1.15) ** 1.2;
    // (back paddling while the boat still runs ahead: the blade brakes, slipping, whether or not it holds still)
    const braking = g === 'back' && active && u < 1 && boat.v > 0.05;
    const drive = braking ? FORCE.back * Math.sin(Math.PI * u) * (1 - st.weights.rest)
      : hold ? FORCE[plant.gait] * Math.pow(Math.sin(Math.PI * Math.min(1, plant.u)), 0.6) * (1 - st.weights.rest) * hold * lowSpeedGain : 0;   // N (a full-bodied pull: the force rises quickly, holds, eases off at the exit)
    const lever = hold ? plant.anchor.x : 0;
    // the surge (midpoint step) and the yaw: the blade's force against the hull's drag; its moment about the vertical
    const accel = (vv) => (drive - DRAG_K * vv * Math.abs(vv) - DRAG_C * vv) / M_EFF;
    boat.v += accel(boat.v + 0.5 * dt * accel(boat.v)) * dt;
    boat.r += (-(drive * lever) * (YAW_ARM[plant.gait] ?? 1) - YAW_DAMP * boat.r) / I_YAW * dt;
    const advance = boat.v * dt, dyaw = boat.r * dt;
    if (plant.w > 0) {
      // the world-fixed blade, seen from the moving boat: it turns against the boat's yaw and runs aft by the boat's
      // travel, plus the slip (the blade gives a little through the water: a share of the travel under way, more from
      // rest, where the blade moves past the hull at least at the stroke's slowest pace)
      const g2 = plant.gait, sp = Math.abs(boat.v), slipV = Math.max(SLIP[g2] * sp, (PULL_MIN[g2] ?? 0.5) - sp) * hold;
      const dir = g2 === 'back' ? -1 : 1, slip = slipV * dt;
      plant.anchor.applyAxisAngle(Y, dyaw);
      plant.anchor.z += advance + dir * slip;
      plant.travel += Math.abs(advance); plant.slip += slip;
      plant.relSpeed = sp + slipV;   // how fast the blade moves past the hull (m/s): the pull's pace
    } else plant.relSpeed = 0;
    // the lock's weight: in over the catch, out over the exit; an early release fades over 0.08 s (never a jump)
    // (a sweep's blade, whose loop does not follow the boat's pace, holds less as the boat runs faster: at speed it skims
    // round more than it grips, else the boat would carry it out of the arm's reach)
    const skim = plant.gait?.startsWith('sweep') ? THREE.MathUtils.clamp(1.25 - 0.75 * Math.abs(boat.v), 0.25, 1) : 1;
    let want = plant.on ? ss(0, 0.08, plant.u) * (1 - ss(plant.gait === "sprint" ? 0.72 : 0.85, 1, plant.u)) * skim : 0;
    // (a catch whose hands already fall short of the grips grips no harder: the hold waits for the arms)
    if (((plant.errPrev ?? 0) > 0.002 || (rig.moved().clear > 0.08 && rig.moved().reach > 0.08)) && plant.u < 0.4) want = Math.min(want, plant.w * 0.8);
    const half = 0.5 / Math.max(0.3, st.hz);   // a stroke's length (s): the lock eases in and out over 0.3 of it
    // three lerp stages toward the wanted weight (each 1 − e^(−r·dt), settling in ≈ 0.3 of a stroke): the weight, its rate
    // and its acceleration all change smoothly, whatever the wanted weight does (a straight-line fade started with a step in
    // its rate, a kick in the forearm; two stages still stepped the paddle's acceleration the frame a release began); under
    // 1 % it is off. A release is a little quicker than a catch (but not snapped: the lock has drawn the paddle a few degrees off its clip, and a quick fade swung it back in a jolt)
    // (the catch is quick: the blade grips as it goes in, so it is held over nearly all its time in the water)
    const r = want < plant.wm ? Math.max(1.4 * 15 / half, 18) : 45, kw = dt > 0 ? 1 - Math.exp(-r * dt) : 1;
    plant.wm += (want - plant.wm) * kw; plant.w2 += (plant.wm - plant.w2) * kw; plant.w += (plant.w2 - plant.w) * kw;
    if (plant.w < 0.01 && want === 0) plant.w = plant.w2 = plant.wm = 0;
    const wl = Math.min(1, plant.w / 0.97), we = wl * wl * (3 - 2 * wl);   // full lock a little before the follow reaches 1
    return { blade: plant.w > 0 ? { side: plant.side, pos: plant.anchor, w: we >= 0.999 ? 1 : we } : null, drive, lever, advance, dyaw };
  }

  function apply(pose, opts) { kayak.group.updateMatrixWorld(true); return rig.apply(pose, opts); }
  // the pull's pace follows the boat: while the blade is held, the stroke's phase runs at the speed that keeps the clip's
  // own blade moving past the hull as fast as the planted blade does (its speed through the loop measured on the clip,
  // in the hull's frame), so the hands pull the boat up to the blade at the boat's own pace; eased in with the hold,
  // followed through two stages (the phase's rate changes smoothly), bounded 0.5–4 × the loop's own pace
  const pace = { scale: 1, m1: 1 };
  function updatePace(st, we, dt) {
    let target = 1;
    const g = plant.gait;
    // through the pull window (from the catch: the blade grips as it goes in), the blade's speed past the hull: the planted
    // blade's own, or before it holds the boat's speed with the slip it will have
    const inPull = plant.on && plant.u < 1, sp = Math.abs(boat.v);
    const rel = plant.relSpeed > 0 ? plant.relSpeed : Math.max(sp * (1 + (SLIP[g] ?? 0.12)), PULL_MIN[g] ?? 0.5);
    if (clips && inPull && (g === 'cruise' || g === 'sprint' || g === 'sweepR' || g === 'sweepL')) {   // (back paddling keeps its loop's pace: the boat may still run the other way)
      const e = 0.004, own = (ph) => { const b = bakedAt({ ...st, phase: ph }); return new THREE.Vector3(P.blades[plant.side].centre, 0, 0).applyQuaternion(b.q).add(b.p); };
      const a0 = own(st.phase - e), a1 = own(st.phase + e);
      const dzdph = Math.abs(a1.z - a0.z) / (2 * e);                                  // m per unit phase
      const rate = st.hz * loadSpeed(st.phase) / VBAR;                               // phase per second, the loop's own
      if (dzdph * rate > 0.05) target = THREE.MathUtils.clamp(rel / (dzdph * rate), 0.5, 4);
      // eased in over the catch and out over the exit (a step in the phase's rate is a kick in every joint)
      target = 1 + (target - 1) * ss(0, 0.2, plant.u) * (1 - ss(0.8, 1, plant.u));
    }
    const k = dt > 0 ? 1 - Math.exp(-16 * dt) : 1;
    pace.m1 += (target - pace.m1) * k; pace.scale += (pace.m1 - pace.scale) * k;
  }
  // the baked clips for this figure (a UBC man or woman; the first round's figure has none and keeps the live solver)
  const clips = fig.profileName === 'ubc' ? CLIPS[look.sex] : null;
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  // the paddle's keyframed place at this phase: each gait's track sampled by a periodic C2 cubic spline through its samples
  // (places and sign-aligned quaternion parts, renormalised: the velocity and the acceleration are continuous, where a
  // Catmull-Rom's acceleration stepped at every sample), then the gaits cross-faded by their weights (a weighted lerp of
  // the places, a sign-aligned weighted blend of the turns)
  function bakedAt(st) {
    if (!clips) return null;
    const pos = new THREE.Vector3(), acc = new THREE.Vector4(0, 0, 0, 0); let ref = null, wsum = 0;
    for (const [g, w] of Object.entries(st.weights)) {
      if (w < 1e-4 || !clips[g]) continue;
      const c = clips[g];
      let p;
      if (c.n === 1) { p = new THREE.Vector3().fromArray(c.p); _q.fromArray(c.q); }
      else {
        const S = clipSpline(c), f = st.phase * c.n, i0 = ((Math.floor(f) % c.n) + c.n) % c.n, i1 = (i0 + 1) % c.n, t = f - Math.floor(f), u = 1 - t;
        const ev = (y, M) => u * y[i0] + t * y[i1] + ((u * u * u - u) * M[i0] + (t * t * t - t) * M[i1]) / 6;
        p = new THREE.Vector3(ev(S.y[0], S.M[0]), ev(S.y[1], S.M[1]), ev(S.y[2], S.M[2]));
        _q.set(ev(S.y[3], S.M[3]), ev(S.y[4], S.M[4]), ev(S.y[5], S.M[5]), ev(S.y[6], S.M[6])).normalize();
      }
      if (!ref) ref = _q.clone();
      const sgn = _q.dot(ref) < 0 ? -1 : 1;
      pos.addScaledVector(p, w); acc.x += sgn * w * _q.x; acc.y += sgn * w * _q.y; acc.z += sgn * w * _q.z; acc.w += sgn * w * _q.w; wsum += w;
    }
    if (!wsum) return null;
    pos.multiplyScalar(1 / wsum); acc.normalize();
    return { p: pos, q: new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w) };
  }
  // setPose(pose, { blade }): a still pose; blade = { side, pos, w } plants a blade (the bake holds the pulls' blades in
  // the water this way, so the guards work round a planted blade instead of lifting it out)
  function setPose(p, opts = {}) {
    const ps = typeof p === 'string' ? KEY_POSES[p] : p;
    if (!ps) throw new Error(`unknown pose ${p}`);
    current = typeof p === 'string' ? p : 'custom'; held = ps;
    return apply(ps, opts);
  }
  // where each blade is, in the kayak frame (the paddle group is a child of the kayak group)
  function readBlades(dt, t) {
    const events = [];
    P.group.updateMatrix();
    for (const [s, def] of [['R', P.blades.stbd], ['L', P.blades.port]]) {
      const b = blade[s];
      const c = new THREE.Vector3(def.centre, 0, 0).applyMatrix4(P.group.matrix);
      b.tip.set(def.tip, 0, 0).applyMatrix4(P.group.matrix);
      b.depth = waterY - c.y;
      b.speed = b.prev && dt > 0 ? (c.z - b.prev.z) / dt : 0;
      b.prev = c;
      const wet = b.wet ? b.depth > 0.0 : b.depth > 0.03;   // hysteresis: no flicker at the surface
      if (wet !== b.wet) events.push({ type: wet ? 'catch' : 'exit', side: s, t, at: c.clone() });
      b.wet = wet;
    }
    return { events };
  }
  if (pose) setPose(pose); else apply(motion.update(0));
  let tAcc = 0;
  // a look on top of the motion (src/kayaks/mind.js: the head turns to the sailboat): eased in two stages (≈ 0.5 s); the head
  // looks up to 100° off the bow, the chest turning a quarter of it toward the look (at most 12°: more would pull the hands
  // off the grips), so the neck turns at most 88° on the shoulders
  const gaze = { want: 0, m: 0, v: 0 };
  function addLook(pose, dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1;
    gaze.m += (gaze.want - gaze.m) * k; gaze.v += (gaze.m - gaze.v) * k;
    if (Math.abs(gaze.v) < 0.05) return pose;
    const head = Math.max(-100, Math.min(100, gaze.v)), chest = Math.max(-12, Math.min(12, 0.25 * head));
    pose.head = [(pose.head?.[0] ?? 0) + head, pose.head?.[1] ?? 0];
    pose.twist = (pose.twist ?? 0) - chest;   // (+ twist turns the chest to port: the rig's own convention, the idle look's)
    return pose;
  }
  return {
    group, figure: fig, look, materials: mats, motion, waterY,
    setPose, handError: rig.handError, pose: () => current,
    clearance: () => rig.clearance(),
    bakedAt: (st) => bakedAt(st ?? motion.state()),
    elbowBehind: () => rig.elbowBehind(),   // how far the worse elbow is behind the chest's plane (m)   // the clip's place for a state (the tests and the tools)
    grip: () => rig.grip(),
    setGuardMargin: (m, elbow, above) => rig.setMargin(m, elbow, above),   // the guards' margins (m): past the true clearance (0.004 at run time, the bake 0.015) and the elbows' in front of the chest (the bake 0.03)      // each hand on the shaft: { L, R: { gap (m), palm (normal, world), toChest, up } } (the UBC figures)
    guards: () => rig.moved(),   // how far the hull/body, reach and elbow guards moved the paddle in the last step (m)
    setMode(m) { held = null; current = null; motion.setMode(m); },
    setIntent(i) { held = null; current = null; motion.setIntent(i); },
    snap(phase) { held = null; plant.on = false; motion.snap(phase); const pose = motion.update(0); apply(pose, { baked: bakedAt(motion.state()) }); readBlades(0, tAcc); },
    boat: () => ({ ...boat }),
    // the hull's surge and yaw rate, set from outside (the lake's fleet hands a kayak over from its own hull model at the
    // same speed: src/kayaks/agent.js); the planted blade lets go (the next catch plants afresh)
    setLook(deg) { gaze.want = deg == null || !Number.isFinite(deg) ? 0 : deg; },
    setBoat({ v = boat.v, r = boat.r } = {}) { boat.v = v; boat.r = r; plant.on = false; plant.w = plant.w2 = plant.wm = 0; },
    update(dt) {
      tAcc += dt;
      let err, k = { drive: 0, lever: 0, advance: 0, dyaw: 0, blade: null };
      if (held) err = rig.handError();
      else {
        const pose = addLook(motion.update(dt, pace.scale), dt);
        k = strokeStep(pose, motion.state(), dt);
        updatePace(motion.state(), k.blade?.w ?? 0, dt);
        const baked = bakedAt(motion.state());
        // the planted blade holds its place along and across the water; its depth follows the clip's own (the blade dips in
        // as it bites and rises toward the exit), so a blade caught near the surface is not held there
        if (baked && plant.w > 0) {
          const own = new THREE.Vector3(P.blades[plant.side].centre, 0, 0).applyQuaternion(baked.q).add(baked.p);
          plant.anchor.y = own.y;
          // a blade letting go slices toward where the clip's own blade is while its hold fades, so the paddle does not
          // swing across the whole gap between them in the fade's few frames
          if (!plant.on && dt > 0) { const kr = (1 - Math.exp(-10 * dt)) * (1 - plant.w) ** 2;   // easing in as the hold fades (no step in the blade's speed)
            plant.anchor.x += (own.x - plant.anchor.x) * kr; plant.anchor.z += (own.z - plant.anchor.z) * kr; }
        }
        // a stroke planted while the boat still runs the other way (a sweep straight after back paddling): the lock lets go
        // (fading, never a snap) once the boat has carried the blade 6 cm from where the clip's own blade is, or the arms
        // would be dragged far out of the clip's reach
        // (or a stroke planted in one gait while the blend has moved on to another: a back stroke's blade under a sweep)
        let gNow = null, wNow = 0; for (const [g2, w2] of Object.entries(motion.state().weights)) if (g2 !== 'rest' && w2 > wNow) { wNow = w2; gNow = g2; }
        const against = (gNow === 'back' ? boat.v > 0.2 : boat.v < -0.05) || plant.gait !== gNow;
        if (baked && plant.on && against) {
          const own = new THREE.Vector3(P.blades[plant.side].centre, 0, 0).applyQuaternion(baked.q).add(baked.p);
          if (Math.hypot(own.x - plant.anchor.x, own.z - plant.anchor.z) > 0.06) { plant.on = false; plant.done = true; }
        }
        err = apply(pose, { blade: k.blade, dt, baked });
        // the elbow rule ends a pull too (the hip rule's twin): once the planted blade has drawn an elbow 3 cm behind the
        // chest's plane, the blade lets go (fading) and the paddle returns to its clip, which keeps the elbows in front
        // and so does the reach: a blade the boat has carried out of the arm's reach lets go the same way
        const elbowOut = (plant.gait !== 'back' && rig.elbowBehind() > (plant.gait?.startsWith('sweep') ? 0.015 : 0.03))
          || (plant.gait === 'cruise' && rig.elbowAbove() > 0.022);   // (nor an elbow lifted over its shoulder)
        plant.errPrev = err;
        if (baked && plant.w > 0 && (elbowOut || err > 0.003 || (plant.gait?.startsWith("sweep") && rig.moved().reach > 0.07) || (plant.u > 0.6 && rig.moved().reach > 0.06))) { plant.on = false; plant.done = true; plant.fast = true; }
      }
      const r = readBlades(dt, tAcc);
      return {
        ...r, thrust: k.drive, yaw: -k.drive * k.lever,
        boat: { v: boat.v, r: boat.r, advance: k.advance, dyaw: k.dyaw },
        planted: plant.w > 0 ? { side: plant.side === 'stbd' ? 'R' : 'L', anchor: plant.anchor.clone(), travel: plant.travel, slip: plant.slip, gait: plant.gait, u: plant.u, w: k.blade?.w ?? 0, locked: k.blade?.w >= 0.999 } : null,
        blades: { L: { depth: blade.L.depth, speed: blade.L.speed, tip: blade.L.tip.clone() }, R: { depth: blade.R.depth, speed: blade.R.speed, tip: blade.R.tip.clone() } },
        state: motion.state(), handError: err, pace: pace.scale,   // pace: the pull's speed against the loop's own (the boat sets it)
      };
    },
    dispose() {
      kayak.group.remove(group);
      if (!fig.pfd.geometry.userData.shared) fig.pfd.geometry.dispose();   // the UBC figure's PFD is shared (figure.js ubcShapes)
      fig.hat.geometry.dispose();
      for (const m of Object.values(mats)) if (m?.isMaterial) m.dispose();
    },
  };
}
