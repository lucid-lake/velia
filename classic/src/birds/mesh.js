// The birds on the GPU: one draw per species and level of detail. The body (src/birds/build.js) is posed in the
// vertex shader from a few numbers per bird (the wingbeat's shoulder angle, the hand's dihedral and sweep, the fold,
// the primaries' splay and curl, the tail's spread, the legs, the fish, the head's turn): rigid bones blended at the
// shoulder and the wrist, like a skinned mesh, but instanced, so twenty gulls cost one draw.
// The flight model (src/birds/flight.js) writes those numbers each frame; nothing here keeps time.
//
// Lit by the scene's own sun and sky (MeshStandardNodeMaterial), hazed by the aerial-perspective pass like the rest of
// the world. Feathers are two-sided vanes whose outline (the rounded tip, the emarginated outer primaries' slots) is cut
// per pixel; the top and the underside take their own plumage. A per-bird fade dithers the near and far meshes into each
// other (no popping) and fades a bird in or out.
import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, vec3, vec4, float, cos, sin, mix, smoothstep, clamp, abs, select, frontFacing,
  Discard, If, fract, screenCoordinate, max, sqrt, cross, dot, step, uniform, normalView, positionView, cameraViewMatrix, sign } from 'three/tsl';
import { build, STRIDE, OFF, KIND } from '../../../src/birds/build.js';
import { SPECIES } from '../../../src/birds/species.js';

// the sun's direction in the world (src/birds/index.js keeps it from the daylight): the feathers' translucency
export const BIRD_SUN = uniform(new THREE.Vector3(0.3, 0.8, 0.2));

// per-bird instance layout (floats): pos.xyz + scale, quat, poseA, poseB, poseC, poseD
const ISTRIDE = 24;
// poseA: flap (rad, shoulder elevation), hand dihedral (rad), arm sweep (rad, + back), hand sweep (rad, + back)
// poseB: fold 0–1, splay 0–1, tail spread 0–1, curl (m per m of lever)
// poseC: legs (0 tucked, 1 down, 1.5 thrown forward), fish 0–1, head yaw (rad), fade 0–1
// poseD: head pitch (rad, + down), tail pitch (rad, + down), body flex, spare

const rotY = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };
const rotZ = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z); };
const rotX = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c))); };
const qrot = (q, v) => { const u = q.xyz; const t = cross(u, v).mul(2); return v.add(t.mul(q.w)).add(cross(u, t)); };

function birdMaterial(name, info, { far = false } = {}) {
  const sp = SPECIES[name];
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  m.name = `bird-${name}-${far ? 'far' : 'near'}`;
  const S = vec3(...info.shoulder), Wr = vec3(...info.wrist);
  const neck = vec3(0, sp.body.at(-3)[3], info.neckZ);
  const foldOut = Math.max(...sp.body.map((s) => s[1])) - info.shoulder[0] + 0.006;
  const tailRoot = vec3(0, sp.body[0][3], sp.body[0][0] + 0.03);

  const iPos = attribute('iPos', 'vec4'), iQuat = attribute('iQuat', 'vec4');
  const pA = attribute('poseA', 'vec4'), pB = attribute('poseB', 'vec4'), pC = attribute('poseC', 'vec4'), pD = attribute('poseD', 'vec4');
  const bw = attribute('bw', 'vec3'), fx = attribute('fx', 'vec4'), fb = attribute('fb', 'vec4'), fc = attribute('fc', 'vec4');

  // the vertex: pose in the bird's frame, then the bird's place in the world (the mesh itself sits at the origin)
  const deform = () => {
    const p = attribute('position', 'vec3'), n = attribute('normal', 'vec3');
    const side = fx.w, kind = fx.z, M = vec3(side, 1, 1);
    // --- the body's own parts, in the true frame: the tail's fan and pitch, the legs, the fish, the head
    const pb = p.toVar(), nb = n.toVar();
    If(kind.equal(KIND.tail), () => {
      const ang = fb.w.mul(pB.z).mul(0.42), tp = pD.y.negate();   // + pitch: the tail's tip down
      pb.assign(rotX(rotY(pb.sub(tailRoot), ang), tp).add(tailRoot)); nb.assign(rotX(rotY(nb, ang), tp));
    });
    const leg = fc.y;
    If(leg.greaterThan(0.5), () => {
      const hip = fb.xyz, legs = pC.x;
      const a = float(1).sub(legs).mul(select(legs.lessThan(1), float(1.65), float(1.1)));
      const k = mix(0.3, 1, clamp(legs, 0, 1));
      pb.assign(rotX(pb.sub(hip).mul(k), a).add(hip)); nb.assign(rotX(nb, a));
    });
    If(fc.z.greaterThan(0.5), () => { pb.assign(fb.xyz.add(pb.sub(fb.xyz).mul(pC.y))); });
    const hw = fc.w;
    If(hw.greaterThan(0.001), () => {
      const r = rotY(rotX(pb.sub(neck), pD.x), pC.z).add(neck);   // pitch (+ the bill down), then yaw
      pb.assign(mix(pb, r, hw)); nb.assign(mix(nb, rotY(rotX(nb, pD.x), pC.z), hw));
    });
    // --- the wing, in the right wing's frame (the left is mirrored in and out)
    const pr = p.mul(M).toVar(), nr = n.mul(M).toVar();
    const fold = pB.x;
    If(kind.equal(KIND.primary), () => {   // the splay: the outer primaries fan forward from their bases (slots open)
      const base = fb.xyz.mul(M), a = pB.y.sub(0.6).mul(fb.w).mul(-0.55);
      pr.assign(rotY(pr.sub(base), a).add(base)); nr.assign(rotY(nr, a));
    });
    pr.y.addAssign(fc.x.mul(pB.w));   // the curl: the vanes bend up under load (fc.x = lever² · length)
    // the fold: the arm's span closes (humerus and forearm along each other), the hand rides in with the wrist
    const k = mix(1, 0.3, fold);
    const wx = S.x.add(Wr.x.sub(S.x).mul(k));
    const wh = bw.z;
    pr.x.assign(mix(S.x.add(pr.x.sub(S.x).mul(k)), pr.x.add(wx.sub(Wr.x)), wh));
    pr.z.assign(S.z.add(pr.z.sub(S.z).mul(mix(1, 0.5, fold))));   // and the chord: the secondaries stack
    const Wp = vec3(wx, Wr.y, Wr.z);
    const handSweep = pA.w.add(fold.mul(0.55)), handDih = pA.y.mul(float(1).sub(fold));
    const armSweep = pA.z.add(fold.mul(1.25)), flap = mix(pA.x, 1.15, fold);   // folded: swept back, then rolled to hang against the flank
    const H = rotZ(rotY(pr.sub(Wp), handSweep), handDih).add(Wp);
    const nH = rotZ(rotY(nr, handSweep), handDih);
    const A = (v) => rotZ(rotY(v.sub(S), armSweep), flap).add(S);
    const An = (v) => rotZ(rotY(v, armSweep), flap);
    const lift = vec3(fold.mul(foldOut), fold.mul(0.035), 0);
    const pw = A(pr).mul(bw.y).add(A(H).mul(bw.z)).add(lift.mul(bw.y.add(bw.z))).mul(M);
    const nw = An(nr).mul(bw.y).add(An(nH).mul(bw.z)).mul(M);
    const pos = pb.mul(bw.x).add(pw);
    const nrm = nb.mul(bw.x).add(nw).normalize();
    // the bird in the world
    positionLocal.assign(qrot(iQuat, pos.mul(iPos.w)).add(iPos.xyz));
    normalLocal.assign(qrot(iQuat, nrm));
  };
  m.setupPosition = function setupPosition() { deform(); return positionLocal; };

  // the pixel: the feather's outline (cut), the plumage (top or under, bars, the rachis), the dithered fade
  const u = fx.x, v = fx.y, kind = fx.z;
  const shp = attribute('shp', 'vec4');
  const feather = kind.greaterThan(0.5).and(kind.lessThan(3.5));
  const tipR = sqrt(clamp(float(1).sub(v.sub(0.72).div(0.28).max(0).pow(2)), 0, 1));
  const em = shp.x;
  const outer = select(u.greaterThan(0), mix(1, float(1).sub(em.mul(0.62)), smoothstep(0.38, 0.55, v)), mix(1, float(1).sub(em.mul(0.3)), smoothstep(0.5, 0.64, v)));
  const halfW = tipR.mul(outer).mul(select(kind.equal(KIND.secondary), float(1).sub(smoothstep(0.9, 1.0, v).mul(0.25).mul(step(abs(u), 0.15))), float(1)));
  const fade = attribute('poseC', 'vec4').w;
  const ign = fract(float(52.9829189).mul(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)))));
  m.colorNode = Fn(() => {
    If(feather.and(abs(u).greaterThan(halfW)), () => { Discard(); });
    if (far) { If(ign.lessThan(float(1).sub(fade)), () => { Discard(); }); }
    else { If(ign.greaterThanEqual(fade), () => { Discard(); }); }
    const top = attribute('colTop', 'vec3'), bot = attribute('colBot', 'vec3');
    const col = select(frontFacing, top, bot).toVar();
    If(feather, () => {
      // dark bars across the flight and tail feathers (the osprey's barred underwing), softer on the top
      const bars = smoothstep(0.25, 0.75, abs(fract(v.mul(shp.y)).sub(0.5)).mul(2)).mul(shp.z).mul(select(frontFacing, float(0.3), float(1))).mul(step(0.5, shp.y));
      col.mulAssign(float(1).sub(bars.mul(0.55)));
      const rachis = float(1).sub(smoothstep(0.02, 0.07, abs(u))).mul(smoothstep(0.0, 0.1, v));
      col.assign(mix(col, col.mul(1.5).add(0.02), rachis.mul(0.45)));
      col.mulAssign(mix(1, 0.82, smoothstep(0.55, 1.0, abs(u).div(max(halfW, 0.05)))));   // the vane's edge, a shade darker
      col.mulAssign(float(0.95).add(sin(v.mul(150).add(abs(u).mul(30))).mul(0.05)));     // the barbs, faintly
    });
    If(kind.equal(KIND.body), () => {   // the body's contour feathers, overlapping like scales
      const g = vec3(u.mul(64), v.mul(36), 0), row = fract(g.y.mul(0.5)).greaterThan(0.5);
      const cell = fract(vec3(g.x.add(select(row, float(0.5), float(0))), g.y, 0));
      const edge = smoothstep(0.6, 1.0, cell.y).mul(0.5).add(smoothstep(0.35, 0.5, abs(cell.x.sub(0.5))).mul(0.2));
      const id = fract(sin(g.x.floor().mul(12.9898).add(g.y.floor().mul(78.233))).mul(43758.5));
      col.mulAssign(float(1).sub(edge.mul(0.22)).mul(float(0.93).add(id.mul(0.14))));
    });
    If(kind.equal(KIND.covert), () => {   // the coverts' rows of small feathers: a paler fringe at each tip
      const g = vec3(v.mul(46), u.mul(9), 0), row = fract(g.y).greaterThan(0.5);
      const cell = fract(vec3(g.x.add(select(row, float(0.5), float(0))), g.y, 0));
      const fringe = smoothstep(0.7, 0.98, cell.y).mul(smoothstep(0.5, 0.2, abs(cell.x.sub(0.5))));
      col.assign(mix(col, col.mul(1.45).add(0.015), fringe.mul(0.5)));
      col.mulAssign(float(0.92).add(fract(sin(cell.x.add(g.x.floor().mul(12.9898)).add(g.y.floor().mul(78.233))).mul(43758.5)).mul(0.16)));
    });
    If(kind.equal(KIND.eye), () => {
      const r = u;
      col.assign(select(r.lessThan(0.45), vec3(0.004), select(r.greaterThan(0.86), vec3(0.02), col)));
    });
    return vec4(col, 1);
  })();
  // translucency: a thin vane lit from behind glows through (the pale ones most: melanin absorbs). The shading normal
  // of a back-lit vane is bent toward the sun by how much light reaches its far side, so the scene's own sun (its colour,
  // its strength at this hour) lights it, not a hand-set glow
  {
    const facing = normalView.mul(sign(dot(normalView, positionView.negate())));
    const sV = cameraViewMatrix.mul(vec4(BIRD_SUN, 0)).xyz.normalize();
    const behind = max(dot(facing, sV).negate(), 0);
    const pale = dot(select(frontFacing, attribute('colBot', 'vec3'), attribute('colTop', 'vec3')), vec3(0.3, 0.55, 0.15));
    const k = select(feather, mix(0.35, 1.3, smoothstep(0.05, 0.6, pale)), select(kind.equal(KIND.covert), float(0.25), float(0)));
    m.normalNode = facing.add(sV.mul(behind.mul(k))).normalize();
  }
  m.roughnessNode = select(kind.equal(KIND.eye), float(0.05), select(kind.equal(KIND.bill), float(0.38), select(kind.equal(KIND.fish), float(0.22), select(kind.equal(KIND.foot), float(0.55), float(0.82)))));
  m.metalnessNode = float(0);
  // feathers are matte: a weak, broad specular (a plastic's 4 % at grazing angles made a dark eagle's wings read white)
  m.specularIntensityNode = select(kind.equal(KIND.eye).or(kind.equal(KIND.fish)), float(1), select(kind.equal(KIND.bill), float(0.6), float(0.18)));
  return m;
}

// One species at one level of detail: a Mesh on an InstancedBufferGeometry (never culled: its birds are everywhere),
// up to max birds; set(i, bird) fills a slot from the flight model's pose, commit(n) draws the first n.
export function createSpeciesMesh(name, { max = 16, far = false } = {}) {
  const g = build(name, { lod: far ? 1 : 0 });
  const geo = new THREE.InstancedBufferGeometry();
  const ib = new THREE.InterleavedBuffer(g.data, STRIDE);
  const A = (k, n) => new THREE.InterleavedBufferAttribute(ib, n, OFF[k]);
  geo.setAttribute('position', A('position', 3)); geo.setAttribute('normal', A('normal', 3));
  geo.setAttribute('colTop', A('colTop', 3)); geo.setAttribute('colBot', A('colBot', 3));
  geo.setAttribute('bw', A('bw', 3)); geo.setAttribute('fx', A('fx', 4)); geo.setAttribute('fb', A('fb', 4)); geo.setAttribute('fc', A('fc', 4)); geo.setAttribute('shp', A('shp', 4));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  const inst = new THREE.InstancedInterleavedBuffer(new Float32Array(max * ISTRIDE), ISTRIDE, 1);
  inst.setUsage(THREE.DynamicDrawUsage);
  const I = (k, o) => geo.setAttribute(k, new THREE.InterleavedBufferAttribute(inst, 4, o));
  I('iPos', 0); I('iQuat', 4); I('poseA', 8); I('poseB', 12); I('poseC', 16); I('poseD', 20);
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mesh = new THREE.Mesh(geo, birdMaterial(name, g.info, { far }));
  mesh.name = `birds-${name}-${far ? 'far' : 'near'}`;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const arr = inst.array;
  let n = 0;
  return {
    mesh, info: g.info, max, triangles: g.info.triangles,
    begin() { n = 0; },
    // b: { pos [x,y,z], quat [x,y,z,w], pose {…}, fade } from flight.js
    push(b, fade) {
      if (n >= max) return;
      const o = n * ISTRIDE, P = b.pose;
      arr[o] = b.pos[0]; arr[o + 1] = b.pos[1]; arr[o + 2] = b.pos[2]; arr[o + 3] = b.scale ?? 1;
      arr[o + 4] = b.quat[0]; arr[o + 5] = b.quat[1]; arr[o + 6] = b.quat[2]; arr[o + 7] = b.quat[3];
      arr[o + 8] = P.flap; arr[o + 9] = P.hand; arr[o + 10] = P.armSweep; arr[o + 11] = P.handSweep;
      arr[o + 12] = P.fold; arr[o + 13] = P.splay; arr[o + 14] = P.tail; arr[o + 15] = P.curl;
      arr[o + 16] = P.legs; arr[o + 17] = P.fish; arr[o + 18] = P.headYaw; arr[o + 19] = fade;
      arr[o + 20] = P.headPitch; arr[o + 21] = P.tailPitch; arr[o + 22] = 0; arr[o + 23] = 0;
      n++;
    },
    commit() {
      geo.instanceCount = n;
      mesh.visible = n > 0;
      if (n) { inst.addUpdateRange(0, n * ISTRIDE); inst.needsUpdate = true; }
      return n;
    },
  };
}
