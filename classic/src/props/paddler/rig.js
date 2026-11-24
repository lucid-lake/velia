// The paddler's rig (feat/kayak-paddler): the controls a pose sets, solved on the figure's
// skeleton every frame from its rest pose (so nothing drifts and the same pose always gives the same bones).
//
//   controls: the hips on the seat; the chest's twist, lean and side bend spread over the pelvis, abdomen and chest; the
//   head's look (the neck and head take what the chest does not); the paddle as its own control (kayak.paddle.group); the
//   hands by two-bone IK to the grip anchors on the shaft (elbows out and down), the palms turned to the shaft and the
//   fingers closed round it; the legs by two-bone IK to the heels (knees up and a little out), the feet riding the shins.
//
//   createRig(figure, kayak) → { apply(pose), handError() }   handError: the worst hand-to-grip distance (m) after apply
import * as THREE from 'three/webgpu';
import { paddleFrame } from './poses.js';

const D = Math.PI / 180;
const RATE = 35;   // the guards' correction follows at 1 − e^(−35·dt) per stage (two stages: about 60 ms)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// turn a bone by a world-space rotation q (about its own origin)
// (B2, refactor round 2: every helper here works on module scratch, the same operations in the same order: the same
// numbers bit for bit, no garbage a frame; none of them calls another while its scratch is live)
const _tw1 = new THREE.Quaternion(), _tw2 = new THREE.Quaternion();
function turnWorld(bone, q) {
  bone.getWorldQuaternion(_q2);
  const parentQ = bone.parent.getWorldQuaternion(_tw1);
  const nw = _tw2.copy(q).multiply(_q2);
  bone.quaternion.copy(parentQ.invert().multiply(nw));
  bone.updateMatrixWorld(true);
}
// turn a bone so the point 'from' (world, moving with it) lands on the ray toward 'to'
const _ao = new THREE.Vector3(), _aa = new THREE.Vector3(), _ab = new THREE.Vector3(), _aq = new THREE.Quaternion();
function aim(bone, fromWorld, toWorld) {
  const o = bone.getWorldPosition(_ao);
  const a = _aa.copy(fromWorld).sub(o).normalize(), b = _ab.copy(toWorld).sub(o).normalize();
  if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) return;
  turnWorld(bone, _aq.setFromUnitVectors(a, b));
}
// two-bone IK: upper bone A, lower bone B, the end point endOf() (world, riding on B); target T, pole P (world)
const _iS = new THREE.Vector3(), _iE = new THREE.Vector3(), _iD = new THREE.Vector3(), _ip = new THREE.Vector3(), _iel = new THREE.Vector3(), _iw = new THREE.Vector3(), _it = new THREE.Vector3(), _it2 = new THREE.Vector3();
function ik2(A, B, endOf, T, P, front = null, swivel = null, frames = null) {
  const S = A.getWorldPosition(_iS), E0 = B.getWorldPosition(_iE), F0 = endOf();
  const a = S.distanceTo(E0), b = E0.distanceTo(F0);
  const Dv = _iD.copy(T).sub(S); let d = Dv.length();
  d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const n = Dv.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const p = _ip.copy(P).sub(S); p.addScaledVector(n, -p.dot(n));
  if (p.lengthSq() < 1e-10) p.set(0, 1, 0).addScaledVector(n, -n.y);
  p.normalize();
  // an elbow never bends backward past the chest: the bend direction keeps no component behind 'front'
  // (a soft limit: the forward part x becomes (x + sqrt(x² + w²)) / 2, w 0.15, smooth everywhere; a hard clamp at zero
  // put a kink in the elbow's path, a spike in the upper arm's turn the frame it engaged)
  if (front) { const x = p.dot(front), g = 0.5 * (x + Math.sqrt(x * x + 0.0225)); p.addScaledVector(front, g - x); p.addScaledVector(n, -p.dot(n)); if (p.lengthSq() < 1e-8) p.copy(front); p.normalize(); }
  // the elbow's swing eases (owner, 2026-11-07: no snaps): the bend direction follows its new value from last frame's by a
  // frame-rate-independent factor, so an arm folding fast near the shoulder cannot whip the elbow round in one frame
  if (swivel) {
    if (swivel.prev && swivel.k < 1) { p.copy(_it.copy(swivel.prev).lerp(p, swivel.k)); p.addScaledVector(n, -p.dot(n)); if (p.lengthSq() < 1e-8) p.copy(swivel.prev); p.normalize(); }
    swivel.cur = p.clone();
  }
  const elbow = _iel.copy(S).addScaledVector(n, a * cosA).addScaledVector(p, a * Math.sqrt(1 - cosA * cosA));
  if (frames) {
    // each bone's whole turn from its axis and the bend direction (no minimal turn from where it was: that left the
    // bones' roll to history, and near a half turn it flipped the forearm's roll in a frame)
    const wrist = _iw.copy(S).addScaledVector(n, d);
    setFrame(A, frames.A, _it.copy(elbow).sub(S), p);
    setFrame(B, frames.B, _it2.copy(wrist).sub(elbow), p);
    return;
  }
  aim(A, E0, elbow);
  aim(B, endOf(), _it.copy(S).addScaledVector(n, d));
}
// a bone's world turn from two directions: its own axis (local, toward its child) onto axisW and its local reference (a
// direction square to the axis) onto refW projected square to axisW
const _fx = new THREE.Vector3(), _fr = new THREE.Vector3(), _fc = new THREE.Vector3(), _fB = new THREE.Matrix4(), _fBl = new THREE.Matrix4(), _fQ = new THREE.Quaternion(), _fP = new THREE.Quaternion();
function setFrame(bone, fr, axisW, refW) {
  const x = _fx.copy(axisW).normalize(), r = _fr.copy(refW).addScaledVector(x, -refW.dot(x));
  if (r.lengthSq() < 1e-10) return;
  r.normalize();
  const Bw = _fB.makeBasis(x, r, _fc.copy(x).cross(r));
  const Qw = _fQ.setFromRotationMatrix(Bw.multiply(_fBl.copy(fr.Bl).transpose()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(_fP).invert().multiply(Qw));
  bone.updateMatrixWorld(true);
}

export function createRig(fig, kayak) {
  const B = fig.bones;
  const bones = Object.values(B);
  const rest = new Map(bones.map((b) => [b, { p: b.position.clone(), q: b.quaternion.clone() }]));
  const seatA = kayak.anchors.seat, paddle = kayak.paddle;
  const kg = kayak.group;
  // rest measures (in the bones' own frames): the foot's transform relative to the shin, the leg's end (the heel)
  kg.updateMatrixWorld(true);
  const relFoot = {}, heelLocal = {};
  for (const s of ['L', 'R']) {
    relFoot[s] = B[`LowerLeg${s}`].matrixWorld.clone().invert().multiply(B[`Foot${s}`].matrixWorld);
    heelLocal[s] = B[`LowerLeg${s}`].worldToLocal(B[`Foot${s}`].getWorldPosition(new THREE.Vector3()));
  }
  // the figure's profile (figure.js PROFILES): where the hand holds, the finger chains, the heels' lift
  const prof = fig.profile ?? { grip: ['MiddleHand', 'Fingers', 0.25], fingers: [[['Fingers'], 1.4]], thumb: [['Thumb1'], 0.8], heelLift: 0 };
  const boneOf = (n, s) => B[`${n}${s}`] ?? fig.scene?.getObjectByName(`${n}_${s.toLowerCase()}`) ?? null;
  const chains = {}, thumbs = {};
  for (const s of ['L', 'R']) {
    chains[s] = prof.fingers.map(([names, a]) => [names.map((n) => boneOf(n, s)).filter(Boolean), a]);
    thumbs[s] = [prof.thumb[0].map((n) => boneOf(n, s)).filter(Boolean), prof.thumb[1]];
  }
  // the grip point in the hand (between two of its bones), carried in the MiddleHand bone's frame
  const gripLocal = {};
  for (const s of ['L', 'R']) {
    const [a, b, t] = prof.grip, mh = B[`MiddleHand${s}`];
    gripLocal[s] = mh.worldToLocal(B[`${a}${s}`].getWorldPosition(new THREE.Vector3()).lerp(B[`${b}${s}`].getWorldPosition(new THREE.Vector3()), t));
  }
  // the overhand grip (owner, 2026-11-07: "the paddle is not in the hand"; "do people hold left palm down, right palm up?").
  // Both hands overhand: knuckles up, the palm facing down (toward the paddler as the hand rises), the thumb under the
  // shaft, the index finger toward the paddle's middle, the wrist kept straight. The shaft drives the hand: from the grip on
  // the shaft and the shaft's axis comes the hand bone's whole transform (its turn and the wrist's place), the arm reaches
  // that wrist, and the fingers close round the shaft to touch it. Measured once at rest in each hand bone's own frame:
  // the finger line (wrist → middle knuckle), the knuckle line (index → little finger), the palm's side (the thumb's) and
  // the palm skin's depth below the bone line (from the skinned vertices); the shaft's centre then sits one shaft radius
  // past the palm skin, under the knuckles' base.
  const ubc = !!boneOf('index_04_leaf', 'L');
  const shaftR = (kayak.dims.paddle?.shaftD ?? 0.03) / 2;
  const hand = {};
  if (ubc) for (const s of ['L', 'R']) {
    const H = B[`Palm${s}`], loc = (n) => H.worldToLocal(boneOf(n, s).getWorldPosition(new THREE.Vector3()));
    const m1 = loc('middle_01'), i1 = loc('index_01'), p1 = loc('pinky_01'), th = loc('thumb_02');
    const f = m1.clone().normalize(), across = p1.clone().sub(i1); across.addScaledVector(f, -across.dot(f)).normalize();
    const n = new THREE.Vector3().crossVectors(f, across).normalize();
    if (th.clone().sub(m1.clone().multiplyScalar(0.5)).dot(n) < 0) n.negate();   // the palm is on the thumb's side
    const dPalm = palmDepth(fig, H, f, n, across, m1.length());
    const h = Math.sign(new THREE.Vector3().crossVectors(f, n).dot(across));
    const mid = i1.clone().add(p1).multiplyScalar(0.5);
    const g = f.clone().multiplyScalar(m1.length() * 0.8).addScaledVector(across, mid.dot(across)).addScaledVector(n, dPalm + shaftR);
    const sc = H.getWorldScale(new THREE.Vector3()).x;   // the armature's scale: the grip offset in world units
    hand[s] = { f, n, across, h, g, gw: g.clone().multiplyScalar(sc), dPalm, Br: new THREE.Matrix4().makeBasis(f, n, f.clone().cross(n)), curl: null };
  }
  // the arm bones' frames for the overhand arms (ik2 frames): each bone's axis toward its child and, as the reference, the
  // direction an elbow sticks out at rest when the arm bends forward (aft, square to the axis), in the bone's own frame
  const armFrames = {};
  if (ubc) for (const s of ['L', 'R']) {
    const mk = (bone, child) => {
      const ax = bone.worldToLocal(child.getWorldPosition(new THREE.Vector3())).normalize();
      const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
      const r = new THREE.Vector3(0, 0, 1).transformDirection(kg.matrixWorld).applyQuaternion(q);
      r.addScaledVector(ax, -r.dot(ax)).normalize();
      return { Bl: new THREE.Matrix4().makeBasis(ax, r, ax.clone().cross(r)), ax };
    };
    armFrames[s] = { A: mk(B[`UpperArm${s}`], B[`LowerArm${s}`]), B: mk(B[`LowerArm${s}`], B[`Palm${s}`]) };
  }
  // each arm's reach (shoulder → elbow → grip, or → wrist for the overhand hand), measured at rest
  const reach = {};
  for (const s of ['L', 'R']) {
    const a = B[`UpperArm${s}`].getWorldPosition(new THREE.Vector3()), b = B[`LowerArm${s}`].getWorldPosition(new THREE.Vector3());
    const g = ubc ? B[`Palm${s}`].getWorldPosition(new THREE.Vector3()) : B[`MiddleHand${s}`].localToWorld(gripLocal[s].clone());
    reach[s] = a.distanceTo(b) + b.distanceTo(g);
  }
  // the reach to the grip for the reach guard: the arm to the wrist plus most of the hand's length to the shaft's centre
  const reachG = Object.fromEntries(['L', 'R'].map((s) => [s, ubc ? reach[s] + 0.6 * hand[s].gw.length() : reach[s]]));
  // the overhand hand on the shaft: from the grip G (world), the shaft's axis and a finger direction biased to the forearm
  // (a straight wrist), the hand's world turn Q and the wrist's place W
  const gripOf = (s, v = new THREE.Vector3()) => (s === 'L' ? kayak.anchors.gripL : kayak.anchors.gripR).getWorldPosition(v);
  // (B2: on scratch; the answer is one object refilled by the next call, so a caller reads it before calling again)
  const ph = { a: new THREE.Vector3(), o: new THREE.Vector3(), t: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), fb: new THREE.Vector3(),
    n0: new THREE.Vector3(), pd: new THREE.Vector3(), pz: new THREE.Vector3(), nw: new THREE.Vector3(), fw: new THREE.Vector3(), c: new THREE.Vector3(),
    q: new THREE.Quaternion(), Bw: new THREE.Matrix4(), Br: new THREE.Matrix4(), out: { Q: new THREE.Quaternion(), W: new THREE.Vector3(), G: new THREE.Vector3(), a: null, palm: new THREE.Vector3() } };
  function placeHand(s, forearm = null) {
    const hd = hand[s], R = ph.out, G = gripOf(s, R.G);
    const a = ph.a.set(1, 0, 0).applyQuaternion(paddle.group.getWorldQuaternion(ph.q));
    const o = ph.o.copy(a).multiplyScalar(Math.sign(ph.t.copy(G).sub(paddle.group.getWorldPosition(ph.c)).dot(a)) || 1);
    const fwdW = Kd(0, 0, -1, ph.fwd), upW = Kd(0, 1, 0, ph.up);
    const fb = forearm ? ph.fb.copy(forearm).multiplyScalar(0.6).addScaledVector(fwdW, 0.25).addScaledVector(upW, 0.35) : ph.fb.copy(fwdW).multiplyScalar(0.8).addScaledVector(upW, 0.45);   // a straight wrist, the knuckles a little up (the wrist under the shaft keeps the elbow low)
    const f0 = fb.addScaledVector(a, -fb.dot(a)).normalize();
    // the palm: from a straight wrist, but kept within 55° of facing down and toward the chest (a soft limit about the
    // shaft's axis, smooth everywhere): the wrist never turns the palm up
    const n0 = ph.n0.crossVectors(o, f0).multiplyScalar(hd.h);
    const toChest = B.Torso.getWorldPosition(ph.t).sub(G).normalize();
    const pd = Kd(0, -1, 0, ph.pd).add(toChest); pd.addScaledVector(a, -pd.dot(a)).normalize();
    let beta = Math.atan2(ph.c.crossVectors(pd, n0).dot(a), pd.dot(n0));
    const lim = 55 * D;
    // the control hand (the right) turns the shaft for the feather: its wrist rolls with the shaft (a third of the shaft's
    // own roll from the power face's mean), the left hand lets the shaft turn in its loose fingers (it keeps its place)
    if (s === 'R') {
      const pz = ph.pz.set(0, 0, 1).applyQuaternion(paddle.group.getWorldQuaternion(ph.q));
      pz.addScaledVector(a, -pz.dot(a));
      if (pz.lengthSq() > 1e-8) { pz.normalize(); const roll = Math.atan2(ph.c.crossVectors(pd, pz).dot(a), pd.dot(pz)); beta += 0.33 * Math.sin(roll); }
    }
    // (the straight wrist's pull fades out as its palm turns away from facing down: at a half turn the two ways round meet,
    // and a signed angle there flipped the hand in a frame)
    const nw = ph.nw.copy(pd).applyAxisAngle(a, lim * Math.tanh(beta / lim) * Math.sqrt(0.5 * (1 + Math.cos(beta))));
    const fw = ph.fw.crossVectors(nw, o).multiplyScalar(hd.h);
    const Bw = ph.Bw.makeBasis(fw, nw, ph.c.copy(fw).cross(nw));
    const Q = R.Q.setFromRotationMatrix(Bw.multiply(ph.Br.copy(hd.Br).transpose()));
    R.W.copy(G).sub(ph.t.copy(hd.gw).applyQuaternion(Q)); R.a = a; R.palm.copy(hd.n).applyQuaternion(Q);
    return R;
  }
  // the fingers and the thumb close round the shaft until they touch it (each joint turns about the shaft's axis as far as
  // its next joint reaches the shaft's skin plus half a finger). The hand sits on the shaft the same way in every frame
  // (the shaft's axis and centre are fixed in the hand's frame), so the closing is solved once and kept
  function closeHand(s, pl) {
    const hd = hand[s];
    if (hd.curl) { for (const [b, q] of hd.curl) b.quaternion.copy(q); B[`Palm${s}`].updateMatrixWorld(true); return; }
    const digits = ['index', 'middle', 'ring', 'pinky', 'thumb'].map((f) => [f === 'thumb' ? ['thumb_02', 'thumb_03'] : [`${f}_01`, `${f}_02`, `${f}_03`], `${f}_04_leaf`]);
    const line = (v) => { const d = v.clone().sub(pl.G); return d.addScaledVector(pl.a, -d.dot(pl.a)).length(); };
    const target = shaftR + 0.0085, curl = [];
    // the thumb first swings under the shaft: its tip aimed past the shaft on the far side from the palm, toward the index
    const t1 = boneOf('thumb_01', s), tLeaf = boneOf('thumb_04_leaf', s);
    if (t1 && tLeaf) {
      const H = B[`Palm${s}`], g = hd.g.clone().addScaledVector(hd.n, shaftR + 0.006).addScaledVector(hd.f, -0.012).addScaledVector(hd.across, -0.012);
      aim(t1, tLeaf.getWorldPosition(new THREE.Vector3()), H.localToWorld(g));
      curl.push([t1, t1.quaternion.clone()]);
    }
    for (const [names, leafN] of digits) {
      const bones = names.map((n) => boneOf(n, s)).filter(Boolean), leaf = boneOf(leafN, s);
      for (let j = 0; j < bones.length; j++) {
        const jb = bones[j], child = bones[j + 1] ?? leaf, q0 = jb.quaternion.clone();
        const at = (th) => { jb.quaternion.copy(q0); turnWorld(jb, new THREE.Quaternion().setFromAxisAngle(pl.a, th)); return line(child.getWorldPosition(new THREE.Vector3())); };
        const sg = at(0.15) < at(-0.15) ? 1 : -1;
        let best = 0, bestD = at(0), prev = 0, hit = null;
        for (let th = 0.0875; th <= 1.75 + 1e-9; th += 0.0875) { const d = at(sg * th); if (d < bestD) { bestD = d; best = th; } if (d <= target) { hit = [prev, th]; break; } prev = th; }
        if (hit) { let [lo, hi] = hit; for (let it = 0; it < 8; it++) { const m = 0.5 * (lo + hi); if (at(sg * m) <= target) hi = m; else lo = m; } best = hi; }
        at(sg * best);
        curl.push([jb, jb.quaternion.clone()]);
      }
    }
    hd.curl = curl;
  }
  const K = (x, y, z, v = new THREE.Vector3()) => v.set(x, y, z).applyMatrix4(kg.matrixWorld);          // a kayak-frame point → world
  const Kd = (x, y, z, v = new THREE.Vector3()) => v.set(x, y, z).transformDirection(kg.matrixWorld);   // a kayak-frame direction → world
  const pf = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), dir: new THREE.Vector3() };
  let lastErr = 0;

  // ---- the paddle's clearance (the hard constraint; paddleClearance() measures it the same way for the tests) ----
  const S = kayak.shape;
  let body0 = null;
  const solids = () => (body0 = bodySolids(fig, kayak, body0));   // refilled in place (B2): each caller reads it before the next call
  const pts = paddlePoints(kayak);
  // the guards aim 4 mm wide of the true clearance, so a paddle that follows their answer a frame or two behind still keeps
  // the true clearance (and the hard limit below, which would ride the hull and leave it with a jolt, need not act)
  let ptsG = pts.map((pt) => ({ ...pt, r: pt.r + 0.004 }));
  // the bake solves its clips wider still (setMargin(0.015)), so the smoothing it applies afterwards cannot bring the
  // paddle back into the hull or the body
  let elbowMargin = 0;   // the bake also keeps the elbows this far in front of the chest's plane (room for the lock's drag)
  let aboveMargin = null;   // and, unless null, this far under their shoulders (the paddle comes down: a sprint's top hand is exempt)
  const setMargin = (m, elbow = 0, above = null) => { ptsG = pts.map((pt) => ({ ...pt, r: pt.r + m })); elbowMargin = elbow; aboveMargin = above; };
  // every penetrating point asks for a push; the moves combine per direction (the largest up, the largest out each side,
  // the largest along each other direction), so a shaft caught between the gunwale and a knee goes up over both instead
  // of bouncing between them
  // the planted blade (apply's blade option): the paddle pivots on it. The blade's centre goes to its place and the shaft
  // swings to run from there through the paddle's middle as it now stands, so every guard (the hull, the body, the reach,
  // the elbows) moves the hands and the shaft without dragging the blade through the water
  let planted = null;
  const clearEase = new THREE.Vector3();   // the eased clearance push on the baked clip
  const swivels = { L: { prev: null, cur: null, k: 1 }, R: { prev: null, cur: null, k: 1 } };   // the elbows' eased swing
  const clav_ = { L: { prev: null, cur: null, k: 1 }, R: { prev: null, cur: null, k: 1 } };   // the clavicles' eased turn
  const corr = { p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), rawP: new THREE.Vector3(), rawQ: new THREE.Quaternion(), mp: new THREE.Vector3(), mq: new THREE.Quaternion(), ep: new THREE.Vector3(), eq: new THREE.Quaternion(), emp: new THREE.Vector3(), emq: new THREE.Quaternion(), init: false };   // the paddle shown (it follows the guards' target)
  function repivot() {
    if (!planted) return;
    paddle.group.updateMatrixWorld(true);
    const mid = paddle.group.position.clone();
    const c = new THREE.Vector3(paddle.blades[planted.side].centre, 0, 0).applyMatrix4(paddle.group.matrix);
    const from = mid.clone().sub(c), to = mid.clone().sub(planted.pos), len = from.length();
    if (to.lengthSq() < 1e-8 || len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()).multiply(paddle.group.quaternion.clone());
    const pos = planted.pos.clone().addScaledVector(to, len);
    paddle.group.quaternion.slerp(q, planted.w); paddle.group.position.lerp(pos, planted.w);
    paddle.group.updateMatrixWorld(true);
  }
  const moved = { clear: 0, reach: 0, elbow: 0 };
  function clearPaddle(points = ptsG, rounds = 16) {
    const body = solids();
    const p0 = paddle.group.position.clone();
    for (let it = 0; it < rounds; it++) {
      const nh = penetrationsInto(points, kayak, S, body);
      if (!nh) break;
      // the pushes combined per axis (the largest up, the largest each way across and along): continuous in every push
      // (sorting pushes into up / out / other by a direction threshold made the answer jump as a push's direction crossed it)
      let up = 0, xp = 0, xn = 0, zp = 0, zn = 0;
      for (let i = 0; i < nh; i++) {
        const h = _pen[i], v = _v.copy(h.push).multiplyScalar(h.depth);
        up = Math.max(up, v.y); xp = Math.max(xp, v.x); xn = Math.min(xn, v.x); zp = Math.max(zp, v.z); zn = Math.min(zn, v.z);
      }
      const m = new THREE.Vector3(xp + xn, up, zp + zn);
      if (m.lengthSq() < 1e-8) break;
      m.addScaledVector(m.clone().normalize(), 0.0002);   // just past the contact (a 2 mm overshoot made the target jump the frame a contact began)
      paddle.group.position.add(m); paddle.group.updateMatrixWorld(true);
      repivot();
    }
    moved.clear += paddle.group.position.distanceTo(p0);
  }

  const _rgT = new THREE.Vector3(), _rgS = new THREE.Vector3();
  function reachGuard() {
    const p0 = paddle.group.position.clone();
      // reach: a pose (or a spline between poses) may ask a hand for more than this figure's arm; the paddle then comes in
      // toward that shoulder by the excess, so the hands stay locked (and a figure with other arms still fits)
      for (let it = 0; it < 4; it++) {
        let moved = false;
        for (const s of ['L', 'R']) {
          // (the grip itself, against the arm plus most of the hand: the overhand wrist's place turns with the paddle, and
          // as a target it fed back on the push and ran away in a frame)
          const T = gripOf(s, _rgT);
          const S = B[`UpperArm${s}`].getWorldPosition(_rgS);
          // a soft push (it grows from zero with the excess: no kink where it starts, which kicked the shaft at a catch);
          // its residual, under 1 cm past 97 % of the arm, is still inside the arm's reach
          const d = T.distanceTo(S), ex0 = d - reachG[s] * 0.92, ex = ex0 > 0 ? ex0 * ex0 / (ex0 + 0.025) : 0;
          if (ex > 0.0005) {
            const move = S.clone().sub(T).normalize().multiplyScalar(ex);
            paddle.group.parent.worldToLocal(move.add(paddle.group.getWorldPosition(new THREE.Vector3())));
            paddle.group.position.copy(move); paddle.group.updateMatrixWorld(true); repivot(); moved = true;
          }
        }
        if (!moved) break;
      }
    moved.reach += paddle.group.position.distanceTo(p0);
  }
  // the paddle settles: the hull and body first (hard), then the reach (the hands stay locked), until both hold
  function settlePaddle() {
    for (let k = 0; k < 6; k++) {
      clearPaddle(); reachGuard();
      if (!penetrationsInto(ptsG, kayak, S, solids(), true)) break;
    }
    clearPaddle();
  }
  const armBones = ['L', 'R'].flatMap((s) => ['Shoulder', 'UpperArm', 'LowerArm', 'Palm', 'MiddleHand'].map((n) => B[`${n}${s}`]))
    .concat(...['L', 'R'].map((s) => [...chains[s].flatMap((c) => c[0]), ...thumbs[s][0], ...(ubc ? ['thumb_03'].map((n) => boneOf(n, s)).filter(Boolean) : [])]));
  const ae = { front: new THREE.Vector3(), a: new THREE.Vector3(), T: new THREE.Vector3(), co: new THREE.Vector3(), ua: new THREE.Vector3(), t1: new THREE.Vector3(), t2: new THREE.Vector3(),
    full: new THREE.Quaternion(), want: new THREE.Quaternion(), sh: new THREE.Vector3(), pu: new THREE.Vector3(), pv: new THREE.Vector3(), rd: new THREE.Vector3(), P: new THREE.Vector3(),
    wr: new THREE.Vector3(), fa: new THREE.Vector3(), laQ: new THREE.Quaternion(), rel: new THREE.Quaternion(), ax: new THREE.Vector3(), tq: new THREE.Quaternion(), pq: new THREE.Quaternion(), g: new THREE.Vector3() };
  // apply(pose, { blade }): blade = { side: 'stbd' | 'port', pos (kayak frame), w 0..1 }: the working blade's centre held
  // there (a blade planted in the water: index.js keeps it fixed in the world while the boat moves past it)
  function apply(pose, { blade = null, dt = 0, baked = null } = {}) {
    for (const sw of Object.values(swivels)) { sw.k = dt > 0 ? 1 - Math.exp(-dt * 25) : 1; if (dt <= 0) sw.prev = null; }
    for (const cv of Object.values(clav_)) { cv.k = dt > 0 ? 1 - Math.exp(-dt * 20) : 1; if (dt <= 0) cv.prev = null; }
    moved.clear = moved.reach = moved.elbow = 0; planted = null;
    for (const b of bones) { const r = rest.get(b); b.position.copy(r.p); b.quaternion.copy(r.q); }
    fig.root.position.set(0, 0, 0); fig.root.quaternion.identity();
    fig.root.updateMatrixWorld(true);
    const seat = seatA.position;
    // 1. hips: put the hip joints' middle on the seat target (kayak frame; the figure's root is a child of the kayak group)
    const hipNow = B.UpperLegL.getWorldPosition(new THREE.Vector3()).add(B.UpperLegR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const hipWant = K(seat.x + pose.hip[0], seat.y + pose.hip[1], seat.z + pose.hip[2]);
    fig.root.parent.worldToLocal(hipNow); const hw = fig.root.parent.worldToLocal(hipWant.clone());
    fig.root.position.add(hw.sub(hipNow));
    fig.root.updateMatrixWorld(true);
    // 2. the chest: lean (about the kayak's x), side bend (about z), twist (about y), spread down the spine
    const ax = Kd(1, 0, 0), ay = Kd(0, 1, 0), az = Kd(0, 0, 1);
    const lean = (pose.lean ?? 0) * D, side = (pose.side ?? 0) * D, twist = (pose.twist ?? 0) * D;
    for (const [name, wl, wt] of [['Hips', 0.35, 0.10], ['Abdomen', 0.35, 0.40], ['Torso', 0.30, 0.50]]) {
      // forward lean: the bow is −z, so a positive lean turns the chest toward −z about the kayak's x (negative angle)
      const q = new THREE.Quaternion().setFromAxisAngle(ay, twist * wt)
        .multiply(new THREE.Quaternion().setFromAxisAngle(ax, -lean * wl))
        .multiply(new THREE.Quaternion().setFromAxisAngle(az, -side * wl));
      turnWorld(B[name], q);
    }
    // 3. the head: its look in the kayak frame; the neck and head undo the chest's twist and add the look
    const hy = (pose.head?.[0] ?? 0) * D, hp = (pose.head?.[1] ?? 0) * D;
    for (const [name, w] of [['Neck', 0.4], ['Head', 0.6]]) {
      const q = new THREE.Quaternion().setFromAxisAngle(ay, (-hy - twist) * w)   // + head yaw looks to starboard (a −y turn); undo the chest's
        .multiply(new THREE.Quaternion().setFromAxisAngle(ax, (lean * 0.8 + hp) * w));
      turnWorld(B[name], q);
    }
    // 4. legs to the heels: knees up and a little out (before the paddle, which must clear the thighs and shins)
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? -1 : 1, h = s === 'L' ? pose.heelL : pose.heelR;
      const T = K(seat.x + h[0], seat.y + h[1] + (prof.heelLift ?? 0), seat.z + h[2] + (prof.heelForward ?? 0));   // a longer leg: the feet further forward
      const up = B[`UpperLeg${s}`].getWorldPosition(new THREE.Vector3());
      const P = up.clone().add(Kd(sx * 0.6, 1.0, -0.3));   // knees apart, as rental paddlers sit (c16)
      const ll = B[`LowerLeg${s}`];
      ik2(B[`UpperLeg${s}`], ll, () => ll.localToWorld(heelLocal[s].clone()), T, P);
      // the foot rides the shin (its rest offset), the bone is a child of the armature's root
      const foot = B[`Foot${s}`];
      const want = ll.matrixWorld.clone().multiply(relFoot[s]);
      const local = foot.parent.matrixWorld.clone().invert().multiply(want);
      local.decompose(foot.position, foot.quaternion, _v);
      foot.updateMatrixWorld(true);
    }
    // 6. arms to the grips. The elbows stay in the paddler's box: forward of the chest, below the shoulders, out a little
    // (the pole is in the chest's own frame, turned with the twist, so the torso's rotation does the work, never an elbow
    // pulled back behind the body)
    const fwd = Kd(-Math.sin(twist), 0, -Math.cos(twist)), right = Kd(Math.cos(twist), 0, -Math.sin(twist)), down = Kd(0, -1, 0);
    // the arms, then the elbow guard: an elbow more than 3 cm behind the chest's plane brings the paddle forward by the
    // excess (the hands reach ahead, the torso does the work), the paddle's clearance checked again, the arms solved again
    let err = 0;
    const armsAndElbows = (guard) => {
      for (let pass = 0; pass < (guard ? 4 : 1); pass++) {
        for (const bn of armBones) { const r = rest.get(bn); if (r) bn.quaternion.copy(r.q); }   // every pass from the rest pose (the aims are minimal turns: a different start gave a different arm)
        fig.root.updateMatrixWorld(true);
        err = 0;
        // the chest's plane as the elbows are judged: the line through the shoulders (its normal, level, toward the bow)
        const front = ae.front.copy(ay).cross(B.UpperArmR.getWorldPosition(ae.t1).sub(B.UpperArmL.getWorldPosition(ae.t2))).normalize();
        for (const s of ['L', 'R']) {
          const sx = s === 'L' ? -1 : 1;
          const T = (s === 'L' ? kayak.anchors.gripL : kayak.anchors.gripR).getWorldPosition(ae.T);
          // the shoulder girdle follows the reach a little (the scapula protracts on a long reach): the clavicle bone turns a
          // quarter of the way toward the grip
          const clav = B[`Shoulder${s}`], co = clav.getWorldPosition(ae.co);
          const ua = B[`UpperArm${s}`].getWorldPosition(ae.ua);
          const full = ae.full.setFromUnitVectors(ae.t1.copy(ua).sub(co).normalize(), ae.t2.copy(T).sub(co).normalize());
          // the clavicle's turn eases toward its target (k 20/s); the guards judge the elbows with the same eased clavicle
          // (so the arm they check is the arm shown), and only the arm shown sets next frame's start
          const want = ae.want.identity().slerp(full, 0.34), cv = clav_[s];
          if (cv.prev && cv.k < 1) want.copy(ae.tq.copy(cv.prev).slerp(want, cv.k));
          if (!guard) cv.cur = want.clone();
          turnWorld(clav, want);   // a long reach protracts the shoulder blade
          const sh = B[`UpperArm${s}`].getWorldPosition(ae.sh);
          // the pole: out and down off the reach line. A hand reaching down and out along that very line (a back stroke's low
          // hand) leaves the bend undefined and the elbow swung round in a few frames; there a second pole (out and back:
          // where an elbow goes when the hand is low and wide) takes over smoothly as the reach lines up with the first
          const pu = ae.pu.set(0, 0, 0).addScaledVector(right, sx * 0.55).addScaledVector(down, 0.80).addScaledVector(fwd, 0.15).normalize();
          const pv = ae.pv.set(0, 0, 0).addScaledVector(right, sx * 0.5).addScaledVector(fwd, -0.7).addScaledVector(down, 0.5).normalize();
          const reachDir = ae.rd.copy(T).sub(sh).normalize(), wv = THREE.MathUtils.smoothstep(Math.abs(reachDir.dot(pu)), 0.8, 0.97);
          const P = ae.P.copy(sh).add(pu.multiplyScalar(1 - wv).addScaledVector(pv, wv));
          const mh = B[`MiddleHand${s}`];
          if (ubc && paddle) {
            // the shaft drives the hand: its place and turn from the grip, the arm to its wrist, then the wrist kept straight
            // (the finger line biased to the forearm's) and the arm solved again; the hand then takes its turn exactly
            const H = B[`Palm${s}`], wrist = () => H.getWorldPosition(ae.wr), sw = guard ? null : swivels[s];
            let pl = placeHand(s);
            ik2(B[`UpperArm${s}`], B[`LowerArm${s}`], wrist, pl.W, P, front, null, armFrames[s]);   // the first pass uneased: the hand's turn must not depend on last frame (fed back, it rang frame to frame)
            pl = placeHand(s, ae.fa.copy(pl.W).sub(B[`LowerArm${s}`].getWorldPosition(ae.t1)).normalize());
            ik2(B[`UpperArm${s}`], B[`LowerArm${s}`], wrist, pl.W, P, front, sw, armFrames[s]);
            // the forearm takes half of the hand's roll about it (the radius turns over the ulna: no twist all at the wrist)
            const LA = B[`LowerArm${s}`], laQ = LA.getWorldQuaternion(ae.laQ);
            const rel = ae.rel.copy(laQ).invert().multiply(pl.Q), ax = armFrames[s].B.ax, dd = rel.x * ax.x + rel.y * ax.y + rel.z * ax.z;
            const tw = 2 * Math.atan2(dd, rel.w), twist = Math.atan2(Math.sin(tw), Math.cos(tw));
            turnWorld(LA, ae.tq.setFromAxisAngle(ae.ax.copy(ax).applyQuaternion(laQ), twist * 0.5));
            H.quaternion.copy(H.parent.getWorldQuaternion(ae.pq).invert().multiply(pl.Q)); H.updateMatrixWorld(true);
            if (!guard) closeHand(s, pl);
            err = Math.max(err, H.localToWorld(ae.g.copy(hand[s].g)).distanceTo(pl.G));
            continue;
          }
          ik2(B[`UpperArm${s}`], B[`LowerArm${s}`], () => mh.localToWorld(gripLocal[s].clone()), T, P, front, guard ? null : swivels[s]);
          // the palm: knuckles across the shaft, the shaft in the palm; the fingers round it
          if (paddle) {
            const palm = B[`Palm${s}`];
            const along = new THREE.Vector3(1, 0, 0).applyQuaternion(paddle.group.getWorldQuaternion(new THREE.Quaternion()));
            // the hand's knuckle direction (palm → fingers) wants to be across the shaft, pointing forward-down past it
            const pw = palm.getWorldPosition(new THREE.Vector3());
            const want = T.clone().sub(pw); want.addScaledVector(along, -want.dot(along));
            if (want.lengthSq() > 1e-8) aim(palm, B[`Fingers${s}`].getWorldPosition(new THREE.Vector3()), pw.clone().add(want.normalize()));
            // close the fingers: each joint of each finger turns about the shaft, so the chain wraps over it; the thumb under
            for (const [chain, a] of chains[s]) for (const bone of chain) turnWorld(bone, new THREE.Quaternion().setFromAxisAngle(along, sx * a));
            for (const bone of thumbs[s][0]) turnWorld(bone, new THREE.Quaternion().setFromAxisAngle(along, -sx * thumbs[s][1]));
            // the palm's turn swung the grip point: solve the arm again (twice) with the hand as it now is
            for (let k = 0; k < 2; k++) ik2(B[`UpperArm${s}`], B[`LowerArm${s}`], () => mh.localToWorld(gripLocal[s].clone()), T, P, front, guard ? null : swivels[s]);
          }
          err = Math.max(err, mh.localToWorld(gripLocal[s].clone()).distanceTo(T));
        }
        if (!paddle || !guard) break;
        const sL = B.UpperArmL.getWorldPosition(new THREE.Vector3()), sR = B.UpperArmR.getWorldPosition(new THREE.Vector3()), mid = sL.clone().add(sR).multiplyScalar(0.5);
        const f2 = ay.clone().cross(sR.clone().sub(sL)).normalize();
        let worstBehind = 0;
        for (const s of ['L', 'R']) worstBehind = Math.max(worstBehind, -B[`LowerArm${s}`].getWorldPosition(new THREE.Vector3()).sub(mid).dot(f2));
        // a soft guard, continuous in the elbow's place (an on/off push at a threshold made the answer flicker frame to
        // frame): a push that grows smoothly from zero at the chest plane toward the excess over 1 cm
        const ex = worstBehind + elbowMargin, push = ex > 0 ? ex * ex / (ex + 0.01) : 0;
        // (the bake only) an elbow over its shoulder brings the paddle down, softly, by its excess
        let worstAbove = -1;
        if (aboveMargin != null) for (const s of ['L', 'R']) worstAbove = Math.max(worstAbove, B[`LowerArm${s}`].getWorldPosition(new THREE.Vector3()).y - B[`UpperArm${s}`].getWorldPosition(new THREE.Vector3()).y);
        const ea = worstAbove + (aboveMargin ?? 0), lower = aboveMargin != null && ea > 0 ? ea * ea / (ea + 0.01) : 0;
        if (push < 0.0005 && lower < 0.0005) break;
        const move = f2.multiplyScalar(push).addScaledVector(ay, -lower); moved.elbow += push + lower;
        paddle.group.parent.worldToLocal(move.add(paddle.group.getWorldPosition(new THREE.Vector3())));
        paddle.group.position.copy(move); paddle.group.updateMatrixWorld(true); repivot();
        settlePaddle();
      }
    };
    // 5. the paddle and the arms. A planted blade: the whole solve (the hull, the body, the reach, the elbows) pivots on
    // it, so no guard drags it through the water. While the lock fades in or out, the planted and the free solutions are
    // each solved in full and blended by the lock's weight (no switch between two guard behaviours: no snap)
    const solve = (plant) => {
      paddleFrame(pose, seat, pf);
      paddle.group.position.copy(pf.position); paddle.group.quaternion.copy(pf.quaternion); paddle.group.updateMatrixWorld(true);
      planted = plant; repivot(); settlePaddle(); armsAndElbows(true);
      return { p: paddle.group.position.clone(), q: paddle.group.quaternion.clone() };
    };
    // The guards' answer is found fresh each frame by threshold-triggered pushes, so from one frame to the next it can jump
    // (the elbow guard on, then off; a push that overshoots). Played straight, that read as a judder every frame (owner,
    // 2026-11-07). So the guards only produce a target, the paddle shown follows it smoothly, and the arms are solved once
    // on the paddle shown, always from the rest pose (the IK is then a continuous map: smooth paddle, smooth arms).
    if (paddle && baked) {
      // the baked clip (tools/paddler-bake.mjs): the paddle's place comes from the keyframed track, solved offline with every
      // rule. At runtime the layers are light and every one is eased toward its target by a frame-rate-independent factor
      // (1 − e^(−k·dt)), never snapped:
      //   the raw place: the clip, pivoted once onto the planted blade's world-fixed place by the lock (which eases in/out);
      //   the guards (the hull and body clearance, the reach, the elbows) run on it and give a target; the CORRECTION from
      //   the raw place to that target is eased (k 30/s: ≈ 35 ms), small because the clip already keeps the rules;
      //   the arms are solved once on the paddle shown, from the rest pose, their elbows' swing eased.
      const setT = (p, q) => { paddle.group.position.copy(p); paddle.group.quaternion.copy(q); paddle.group.updateMatrixWorld(true); };
      setT(baked.p, baked.q);
      planted = blade && blade.w > 0 ? blade : null; repivot();
      const rawP = paddle.group.position.clone(), rawQ = paddle.group.quaternion.clone();
      planted = blade && blade.w > 0 ? blade : null;   // the guards pivot on the blade by the lock's weight (no switch when the lock completes)
      // the guards at run time, as two corrections from the clip, each followed through two lerp/slerp stages (each
      // 1 − e^(−k·dt): a second-order follow, so a jump in a guard's answer reaches the paddle with a continuous velocity):
      //   the hull and body clearance and the reach, quickly (k RATE, ≈ 30 ms);
      //   the elbows, slowly (k 18/s, ≈ 0.12 s): on a paddle pivoted on a planted blade the elbow guard's answer swings
      //   fast as the lock lets go, and a quick follow passed that on as a kick
      settlePaddle();
      const cP = paddle.group.position.clone().sub(rawP), cQ = paddle.group.quaternion.clone().multiply(rawQ.clone().invert());
      const p1 = paddle.group.position.clone(), q1 = paddle.group.quaternion.clone();
      armsAndElbows(true);
      const eP = paddle.group.position.clone().sub(p1), eQ = paddle.group.quaternion.clone().multiply(q1.invert());
      const k = dt > 0 ? 1 - Math.exp(-RATE * dt) : 1, ke = dt > 0 ? 1 - Math.exp(-18 * dt) : 1;
      if (!corr.init || dt <= 0) { corr.p.copy(cP); corr.q.copy(cQ); corr.mp.copy(cP); corr.mq.copy(cQ); corr.ep.copy(eP); corr.eq.copy(eQ); corr.emp.copy(eP); corr.emq.copy(eQ); corr.init = true; }
      else {
        corr.mp.lerp(cP, k); corr.mq.slerp(cQ, k); corr.p.lerp(corr.mp, k); corr.q.slerp(corr.mq, k);
        corr.emp.lerp(eP, ke); corr.emq.slerp(eQ, ke); corr.ep.lerp(corr.emp, ke); corr.eq.slerp(corr.emq, ke);
      }
      setT(rawP.clone().add(corr.p).add(corr.ep), corr.eq.clone().multiply(corr.q).multiply(rawQ));
      repivot();   // a locked blade stays exactly at its place
      // the hard limit: a lagging correction that still touches the hull or the body is pushed out at once
      let left = 0; for (let i = 0, nh = penetrationsInto(pts, kayak, S, solids()); i < nh; i++) left = Math.max(left, _pen[i].depth);
      // (a projection: memoryless, it puts the paddle just at the contact and is continuous in the paddle's place; fed back
      // into the follow it made the paddle bounce off the hull and back the next frames)
      if (left > 0) clearPaddle(pts, 60);   // (more rounds: on a planted blade each push is partly undone by the pivot)
      planted = null;
      armsAndElbows(false);
    } else if (!paddle) armsAndElbows(false);
    else {
      // the guards' target (as before: the planted and free solutions, blended through the lock's fades)
      let T;
      if (blade && blade.w >= 0.999) T = solve({ ...blade, w: 1 });
      else if (blade && blade.w > 0) {
        const A = solve({ ...blade, w: 1 }), F = solve(null);
        T = { p: F.p.clone().lerp(A.p, blade.w), q: F.q.clone().slerp(A.q, blade.w) };
      } else T = solve(null);
      // the paddle shown = its raw place (the loop's spline, pivoted on a planted blade by the lock's weight: smooth in
      // time, and it carries all the fast motion) plus the guards' CORRECTION from there, the correction smoothed by an exact
      // critically damped step (smooth time 50 ms: stable at any frame rate) and an exponential follow on its turn. A jump
      // in the guards' answer (a guard switching on or off) is spread over ≈ 0.1 s; a still pose (dt 0) takes it whole.
      paddleFrame(pose, seat, pf);
      paddle.group.position.copy(pf.position); paddle.group.quaternion.copy(pf.quaternion); paddle.group.updateMatrixWorld(true);
      planted = blade && blade.w > 0 ? blade : null; repivot();
      const rawP = paddle.group.position.clone(), rawQ = paddle.group.quaternion.clone();
      const cP = T.p.clone().sub(rawP), cQ = T.q.clone().multiply(rawQ.clone().invert());
      if (!corr.init || dt <= 0) { corr.p.copy(cP); corr.q.copy(cQ); corr.v.set(0, 0, 0); corr.init = true; }
      else {
        const st = 0.05, om = 2 / st, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const change = corr.p.clone().sub(cP), temp = corr.v.clone().addScaledVector(change, om).multiplyScalar(dt);
        corr.v.addScaledVector(temp, -om).multiplyScalar(ex);
        corr.p.copy(cP).add(change.add(temp).multiplyScalar(ex));
        corr.q.slerp(cQ, 1 - Math.exp(-dt / st));
      }
      const showQ = corr.q.clone().multiply(rawQ), showP = rawP.clone().add(corr.p);
      paddle.group.position.copy(showP); paddle.group.quaternion.copy(showQ); paddle.group.updateMatrixWorld(true);
      planted = blade && blade.w >= 0.999 ? blade : null; repivot();   // locked: the blade exactly at its place
      // the hard constraint still holds: a lagging paddle that touches the hull or the body is pushed out at once
      if (penetrationsInto(pts, kayak, S, solids(), true)) { const before = paddle.group.position.clone(); clearPaddle(pts); corr.p.add(paddle.group.position.clone().sub(before)); }   // the smoothing carries on from the cleared place
      planted = null;
      armsAndElbows(false);
    }
    for (const sw of Object.values(swivels)) if (sw.cur) sw.prev = sw.cur;
    for (const cv of Object.values(clav_)) if (cv.cur) cv.prev = cv.cur;
    lastErr = err;
    return err;
  }
  // grip(): each hand on the shaft as shown: the gap between where the shaft's centre sits in the hand and the grip on the
  // shaft (m), and the palm's normal (world) with the paddler's chest, for the tests
  function grip() {
    if (!ubc) return null;
    const chest = B.Torso.getWorldPosition(new THREE.Vector3());
    return Object.fromEntries(['L', 'R'].map((s) => {
      const H = B[`Palm${s}`], q = H.getWorldQuaternion(new THREE.Quaternion());
      return [s, { gap: H.localToWorld(hand[s].g.clone()).distanceTo(gripOf(s)), palm: hand[s].n.clone().applyQuaternion(q), toChest: chest.sub(H.getWorldPosition(new THREE.Vector3())).normalize(), up: Kd(0, 1, 0) }];
    }));
  }
  // how far the elbows are behind the chest's plane as shown (m; the worse one, ≤ 0 in front)
  function elbowBehind() {
    const sL = B.UpperArmL.getWorldPosition(new THREE.Vector3()), sR = B.UpperArmR.getWorldPosition(new THREE.Vector3()), mid = sL.clone().add(sR).multiplyScalar(0.5);
    const f2 = Kd(0, 1, 0).cross(sR.clone().sub(sL)).normalize();
    return Math.max(...['L', 'R'].map((s) => -B[`LowerArm${s}`].getWorldPosition(new THREE.Vector3()).sub(mid).dot(f2)));
  }
  // how far the higher elbow is over its shoulder as shown (m)
  const elbowAbove = () => Math.max(...['L', 'R'].map((s) => B[`LowerArm${s}`].getWorldPosition(new THREE.Vector3()).y - B[`UpperArm${s}`].getWorldPosition(new THREE.Vector3()).y));
  return { apply, setMargin, elbowBehind, elbowAbove,  handError: () => lastErr, grip, clearance: () => paddleClearance(fig, kayak), moved: () => ({ ...moved }) };
}

// the palm skin's depth below the hand bone's line along the palm normal n (hand frame): the 90th percentile over the
// skinned vertices held mostly by the hand bone, between 30 % and 90 % of the way to the knuckles, near the hand's middle
function palmDepth(fig, H, f, n, across, len) {
  const ds = [], v = new THREE.Vector3();
  fig.root.updateMatrixWorld(true);
  const meshes = []; (fig.scene ?? fig.root).traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) {
    const bi = m.skeleton.bones.indexOf(H); if (bi < 0) continue;
    m.skeleton.update();
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let w = 0; for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === bi) w += sw.getComponent(i, c);
      if (w < 0.5) continue;
      v.fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); m.localToWorld(v); H.worldToLocal(v);
      const t = v.dot(f) / len, x = v.dot(across);
      if (t > 0.3 && t < 0.9 && Math.abs(x) < 0.025) { const d = v.dot(n); if (d > 0) ds.push(d); }
    }
  }
  if (!ds.length) return 0.012;
  ds.sort((a, b) => a - b);
  return ds[Math.floor(ds.length * 0.9)];
}

// the paddle as points in its own frame: the shaft every 5 cm (radius 1.5 cm) and each blade as a 5 × 3 grid over its face
// (the port blade turned by the feather), each with the clearance it must keep from the hull (blades 3 cm, shaft 1 cm)
export function paddlePoints(kayak) {
  const P = kayak.paddle, K = kayak.dims.paddle, half = K.length / 2, neck = half - K.bladeL, out = [];
  for (let x = -neck; x <= neck + 1e-6; x += 0.05) out.push({ p: new THREE.Vector3(x, 0, 0), r: K.shaftD / 2, hull: 0.01, blade: false });
  const f = (P?.feather ?? 60) * D;
  for (const side of [1, -1]) for (let i = 0; i <= 4; i++) for (const v of [-1, 0, 1]) {
    const x = side * (neck + K.bladeL * (0.05 + 0.9 * i / 4)), y = v * K.bladeW * 0.42;
    const q = new THREE.Vector3(x, y, 0);
    if (side < 0) q.set(x, y * Math.cos(f), y * Math.sin(f));
    out.push({ p: q, r: 0.006, hull: 0.03, blade: true });
  }
  return out;
}

// the body the paddle must miss, as capsules in the kayak frame: the chest in its PFD, the head, the thighs and shins
export function bodySolids(fig, kayak, out = null) {
  const B = fig.bones, kg = kayak.group;
  // (B2: `out`, the capsules of an earlier call, refilled in place: the same numbers, no garbage)
  const c = out ?? [
    { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.15 },   // the chest in its PFD
    { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.11 },
    { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.075, leg: true }, { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.055, leg: true },
    { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.075, leg: true }, { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.055, leg: true },
  ];
  const L = (b, v) => kg.worldToLocal(b.getWorldPosition(v));
  L(B.UpperLegL, c[0].a).add(L(B.UpperLegR, _bs)).multiplyScalar(0.5).add(_bs.set(0, 0.12, 0));   // the hips' middle, up
  L(B.Neck, c[0].b).add(_bs.set(0, -0.06, 0));
  const head = L(B.Head, _bs2);
  c[1].a.copy(head).add(_bs.set(0, 0.06, 0)); c[1].b.copy(head).add(_bs.set(0, 0.12, 0));
  let k = 2;
  for (const s of ['L', 'R']) {
    L(B[`UpperLeg${s}`], c[k].a); L(B[`LowerLeg${s}`], c[k].b); k++;
    L(B[`LowerLeg${s}`], c[k].a); L(B[`Foot${s}`], c[k].b); k++;
  }
  return c;
}
const _bs = new THREE.Vector3(), _bs2 = new THREE.Vector3();

// the hull's half beam and deck top at a station z (kayak frame), the clearance queries' only reads of the hull: tabled
// once per shape every 1 mm along the length and read by linear interpolation (feat/kayaks-lake step 2: the analytic
// deck and section were ≈ 40 % of a paddler step; a cell across a step in the deck is read exactly; elsewhere the table agrees to under 0.1 mm, tests/kayaksLake)
const HULL_TABLES = new WeakMap(), HULL_DZ = 0.001, _hp = { hb: 0, top: 0 };
export function hullAt(S, z, out = { hb: 0, top: 0 }) {
  let T = HULL_TABLES.get(S);
  if (!T) {
    const z0 = S.zOf(0) - 0.4, n = Math.ceil((S.zOf(1) + 0.4 - z0) / HULL_DZ) + 1, hb = new Float64Array(n), top = new Float64Array(n);
    for (let i = 0; i < n; i++) { const zz = z0 + i * HULL_DZ, b = S.halfBeam(S.sOf(zz)); hb[i] = b; top[i] = Math.max(S.deck(Math.max(0, b - 0.012), zz).y, S.deck(0, zz).y); }
    // a cell across a step in the deck (a well's edge) is read exactly
    const step = new Uint8Array(n);
    for (let i = 0; i + 1 < n; i++) {
      const mid = hullAtExact(S, z0 + (i + 0.5) * HULL_DZ);
      if (Math.abs(mid.top - (top[i] + top[i + 1]) / 2) > 1e-4 || Math.abs(mid.hb - (hb[i] + hb[i + 1]) / 2) > 1e-4) step[i] = 1;
    }
    T = { z0, n, hb, top, step }; HULL_TABLES.set(S, T);
  }
  const f = Math.min(T.n - 1.000001, Math.max(0, (z - T.z0) / HULL_DZ)), i = f | 0, t = f - i;
  if (T.step[i]) { const e = hullAtExact(S, z); out.hb = e.hb; out.top = e.top; return out; }
  out.hb = T.hb[i] + (T.hb[i + 1] - T.hb[i]) * t; out.top = T.top[i] + (T.top[i + 1] - T.top[i]) * t;
  return out;
}
// (exact, uncached: the table's own reference)
export function hullAtExact(S, z) { const hb = S.halfBeam(S.sOf(z)); return { hb, top: Math.max(S.deck(Math.max(0, hb - 0.012), z).y, S.deck(0, z).y) }; }

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// every penetration of the paddle into the hull or the body: [{ depth, push, kind, blade }] (the solver's input). A shaft
// in a thigh or a shin goes over it (up), never under.
export function penetrations(pts, kayak, S, body) {
  const n = penetrationsInto(pts, kayak, S, body);
  const out = [];
  for (let i = 0; i < n; i++) { const h = _pen[i]; out.push({ depth: h.depth, push: h.push.clone(), kind: h.kind, blade: h.blade }); }
  return out;
}
// (B2, refactor round 2: the solver's own form, no garbage. The hits go into a pool reused by the next call (_pen[0..n));
// any: stop at the first. The maths is penetrations' own, step for step, on scratch vectors: the same numbers bit for bit)
const _pen = [], _UP = new THREE.Vector3(0, 1, 0);
function hitAt(i) { return _pen[i] ?? (_pen[i] = { depth: 0, push: new THREE.Vector3(), kind: 'hull', blade: false }); }
function penetrationsInto(pts, kayak, S, body, any = false) {
  // (in plain numbers: a write of a double into a shared Vector3 boxed a new number in the browser, 0.19 MB a frame. Each
  // line is the Vector3 method's own arithmetic in its order: applyMatrix4, sub, dot, lengthSq, addScaledVector,
  // distanceTo, normalize)
  const e = kayak.paddle.group.matrix.elements, half = kayak.dims.length / 2 - 0.02;
  let n = 0;
  for (const pt of pts) {
    const x0 = pt.p.x, y0 = pt.p.y, z0 = pt.p.z;
    const w = 1 / (e[3] * x0 + e[7] * y0 + e[11] * z0 + e[15]);
    const px = (e[0] * x0 + e[4] * y0 + e[8] * z0 + e[12]) * w, py = (e[1] * x0 + e[5] * y0 + e[9] * z0 + e[13]) * w, pz = (e[2] * x0 + e[6] * y0 + e[10] * z0 + e[14]) * w;
    if (Math.abs(pz) < half) {
      const hb = hullAt(S, pz, _hp).hb, top = _hp.top;
      const c = pt.hull + pt.r, dx = hb + c - Math.abs(px), dy = top + c - py;
      // a shaft point goes out over the deck or past the side, whichever is nearer, blended where the two are about as near
      // (a hard choice of face flipped the push between up and sideways frame to frame at the gunwale); a blade goes sideways
      if (dx > 0 && dy > 0) {
        const h = hitAt(n++);
        h.kind = 'hull'; h.blade = pt.blade;
        if (pt.blade) { h.depth = dx; h.push.set(Math.sign(px) || 1, 0, 0); }
        else {
          const s2 = dx * dx + dy * dy, vx = (Math.sign(px) || 1) * dx * dy * dy / s2, vy = dy * dx * dx / s2, d = Math.sqrt(vx * vx + vy * vy + 0 * 0), k = 1 / d;
          h.depth = d; h.push.set(vx * k, vy * k, 0 * k);
        }
        if (any) return n;
      }
    }
    for (const cap of body) {
      const A = cap.a, B = cap.b, abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z;
      const t = Math.min(1, Math.max(0, ((px - A.x) * abx + (py - A.y) * aby + (pz - A.z) * abz) / ((abx * abx + aby * aby + abz * abz) || 1)));
      const qx = A.x + abx * t, qy = A.y + aby * t, qz = A.z + abz * t;
      const ex = px - qx, ey = py - qy, ez = pz - qz, d = Math.sqrt(ex * ex + ey * ey + ez * ez), depth = cap.r + pt.r - d;
      if (depth <= 0) continue;
      const h = hitAt(n++);
      const k = 1 / (Math.sqrt(ex * ex + ey * ey + ez * ez) || 1), ux = ex * k, uy = ey * k, uz = ez * k;   // the push: (p − q) normalised
      h.kind = 'body'; h.blade = pt.blade;
      // a leg: out over it, the push leaning up from the surface's normal (and growing from zero with the depth: a straight
      // up push by the chord's height jumped by centimetres the frame a point first touched a thigh from the side)
      if (cap.leg) {
        let fx = ux + _UP.x * 1.5, fy = uy + _UP.y * 1.5, fz = uz + _UP.z * 1.5;
        const kf = 1 / (Math.sqrt(fx * fx + fy * fy + fz * fz) || 1); fx *= kf; fy *= kf; fz *= kf;
        h.depth = depth / Math.max(0.35, fx * ux + fy * uy + fz * uz); h.push.set(fx, fy, fz);
      } else { h.depth = depth; h.push.set(ux, uy, uz); }
      if (any) return n;
    }
  }
  return n;
}
// the deepest point of the paddle inside the hull (with its clearance) or a body capsule: { depth, push (unit, kayak frame) }
function worstPenetration(pts, kayak, S, body) {
  const M = kayak.paddle.group.matrix;   // the paddle frame → the kayak frame
  let worst = null;
  const hit = (depth, push, kind, blade) => { if (!worst || depth > worst.depth) worst = { depth, push, kind, blade }; };
  for (const pt of pts) {
    const p = _a.copy(pt.p).applyMatrix4(M);
    // the hull: inside the gunwale's plan and under the deck's top at this station
    if (Math.abs(p.z) < kayak.dims.length / 2 - 0.02) {
      const hb = hullAt(S, p.z, _hp).hb, top = _hp.top;
      const c = pt.hull + pt.r, dx = hb + c - Math.abs(p.x), dy = top + c - p.y;
      if (dx > 0 && dy > 0) {
        if (dy < dx) hit(dy, new THREE.Vector3(0, 1, 0), 'hull', pt.blade);
        else hit(dx, new THREE.Vector3(Math.sign(p.x) || 1, 0, 0), 'hull', pt.blade);
      }
    }
    for (const cap of body) {
      const ab = _b.copy(cap.b).sub(cap.a), t = Math.min(1, Math.max(0, p.clone().sub(cap.a).dot(ab) / (ab.lengthSq() || 1)));
      const q = cap.a.clone().addScaledVector(ab, t), d = p.distanceTo(q), depth = cap.r + pt.r - d;
      if (depth > 0) hit(depth, p.clone().sub(q).normalize(), 'body', pt.blade);
    }
  }
  return worst;
}

// the paddle's clearance now: the worst penetration into the hull (with the blades' 3 cm and the shaft's 1 cm margins)
// and into the body (≤ 0: clear), in metres
function paddleClearance(fig, kayak) {
  const pts = paddlePoints(kayak), S = kayak.shape;
  const hull = worstPenetration(pts, kayak, S, []);
  const body = worstPenetration(pts, { ...kayak, dims: { ...kayak.dims, length: 0 } }, S, bodySolids(fig, kayak));
  return { hull: hull ? hull.depth : 0, body: body ? body.depth : 0 };
}
