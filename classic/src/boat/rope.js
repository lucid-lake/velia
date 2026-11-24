// Rope as real tubes (boat detail step 1): the running rigging the helm eye sees from
// 1–4 m (the sheets, their wraps on the winch drums and their tails, the mainsheet tackle, the halyards aft of the mast
// and their tails, the coils) as 3D rope with a braided cover, instead of lines.js's screen ribbons (right from 32 m, a
// hairline from 1 m). Procedural: no texture, no bytes on the wire. lines.js switches between the two by the camera's
// distance (ropeNear below).
//
//   winchWrap(c, from, { r, y0, y1, turns, tailer, exit })   a sheet's turns on a winch drum (a polyline, RIG frame)
//   ropeLod(nearM, band)   → { update(d) → near? }   the switch with its hysteresis (lines.js; the tests)
//   ROPE_NEAR              the switch distances (m from the hull's origin): 15 on High and Balanced, 6 on Low
//   createRopeMesh(maxVerts)   → { mesh, fill(lines) → triangles, clear(), triangles() }   one draw for every tube
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, float, vec4, mix, sin, cos, fract, smoothstep, fwidth, normalize, normalView, modelViewMatrix,
} from 'three/tsl';
import { CABIN_ORDER } from './cockpitLook.js';

// The switch, by tier (plan 41 § 6.1): the near LOD's 15 m on desktops; a phone's helm eye (3.9 m) sees the drums, not
// the coils, and the phone is CPU-bound, so its tubes start inside 6 m (the helm view only).
export const ROPE_NEAR = Object.freeze({ high: 15, balanced: 15, low: 6 });
export const ropeNearFor = (tierName) => ROPE_NEAR[tierName] ?? ROPE_NEAR.high;

// near inside nearM − band, far past nearM + band; in between it keeps what it was (no flicker at the edge)
export function ropeLod(nearM = ROPE_NEAR.high, band = 1) {
  let near = false;
  return {
    get near() { return near; },
    update(d) { near = near ? d < nearM + band : d < nearM - band; return near; },
  };
}

// A sheet's turns on a self-tailing winch (blender/m3_hero.py winch(): the drum r 0.052 m from 0.058 to 0.126 m over the
// base, the tailer's V groove at 0.152 m, the stripper arm toward the cockpit). c: the drum's centre point (cockpit.json,
// 0.10 m over the base; RIG frame), from: where the loaded part comes from (the jib car). The rope meets the drum on the
// tangent from `from`, wraps clockwise seen from above (as a winch turns), climbing from y0 to y1 over `turns`, rises into
// the tailer's groove for half a turn and leaves at the stripper (`exit`: the angle in the x–z plane, + toward +z).
// Returns the points from the tangent point on, the first one the loaded part's end.
export function winchWrap(c, from, { r = 0.057, y0 = -0.035, y1 = 0.018, turns = 3, tailer = { y: 0.052, r: 0.062 }, exit = 0, per = 12 } = {}) {
  const ux = c[0] - from[0], uz = c[2] - from[2], ul = Math.hypot(ux, uz) || 1;
  // the tangent direction (−sin θ, cos θ) along the turn equals the rope's run from `from`
  const th0 = Math.atan2(-ux / ul, uz / ul);
  const out = [];
  const n = Math.max(2, Math.round(turns * per));
  for (let k = 0; k <= n; k++) {
    const f = k / n, th = th0 + f * turns * 2 * Math.PI;
    out.push([c[0] + r * Math.cos(th), c[1] + y0 + (y1 - y0) * f, c[2] + r * Math.sin(th)]);
  }
  // up into the tailer, then round its groove to the stripper: the angle from the last turn's to `exit`, forward
  const thA = th0 + turns * 2 * Math.PI;
  let thB = exit; while (thB < thA + Math.PI * 0.5) thB += 2 * Math.PI;
  const m = Math.max(3, Math.round((thB - thA) / (2 * Math.PI) * per));
  for (let k = 1; k <= m; k++) {
    const f = k / m, th = thA + f * (thB - thA), rise = Math.min(1, f * 3);
    const rr = r + (tailer.r - r) * rise;
    out.push([c[0] + rr * Math.cos(th), c[1] + y1 + (tailer.y - y1) * rise, c[2] + rr * Math.sin(th)]);
  }
  return out;
}

// One mesh for every tube: per point a ring of SIDES + 1 vertices (the seam doubled for the braid's coordinate), flat
// caps at both ends. Attributes: position, normal, color, tracer (the braid's tracer yarn), along (m), around (0…1), diam,
// rtan (the rope's direction, for the twist's normal).
const SIDES = 8;
export function createRopeMesh(maxVerts = 16384) {
  const g = new THREE.BufferGeometry();
  const f3 = () => new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const f1 = () => new THREE.BufferAttribute(new Float32Array(maxVerts), 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', f3()); g.setAttribute('normal', f3()); g.setAttribute('color', f3()); g.setAttribute('tracer', f3());
  g.setAttribute('rtan', f3()); g.setAttribute('along', f1()); g.setAttribute('around', f1()); g.setAttribute('diam', f1());
  const maxIdx = maxVerts * 6;
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(maxIdx), 1).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(g, ropeMaterial());
  mesh.name = 'running-rigging-rope';
  mesh.frustumCulled = false;
  // with the cabin, before the companionway's portal (cockpitLook.js): the halyard coils lie on the cabin top beside the
  // open hatch, and the portal's raised top quad, drawn first, hid their inboard edge from the helm eye
  mesh.renderOrder = CABIN_ORDER;
  const A = g.attributes;
  const c = new THREE.Color(), ct = new THREE.Color();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), Tp = new THREE.Vector3(), tmp = new THREE.Vector3();
  // lines: [{ points, diameterM, color, tracer, sides? }]; returns the triangles drawn (a line that would overflow ends the
  // fill). Sides: 8 for the 10 mm sheets (the helm eye's nearest rope), 6 for the thinner halyards and control lines
  function fill(lines) {
    const pos = A.position.array, nrm = A.normal.array, col = A.color.array, trc = A.tracer.array, tan = A.rtan.array;
    const alg = A.along.array, aro = A.around.array, dia = A.diam.array, idx = g.index.array;
    let v = 0, ii = 0;
    const put = (p, n, t, L, a, l) => {
      pos[v * 3] = p[0] + n.x * l.r; pos[v * 3 + 1] = p[1] + n.y * l.r; pos[v * 3 + 2] = p[2] + n.z * l.r;
      nrm[v * 3] = n.x; nrm[v * 3 + 1] = n.y; nrm[v * 3 + 2] = n.z;
      tan[v * 3] = t.x; tan[v * 3 + 1] = t.y; tan[v * 3 + 2] = t.z;
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      trc[v * 3] = ct.r; trc[v * 3 + 1] = ct.g; trc[v * 3 + 2] = ct.b;
      alg[v] = L; aro[v] = a; dia[v] = l.d;
      return v++;
    };
    for (const line of lines) {
      const P = line.points, n = P.length;
      if (n < 2) continue;
      const sides = line.sides ?? (line.diameterM >= 0.0095 ? SIDES : 6), ring = sides + 1;
      if (v + n * ring + 2 * (sides + 1) > maxVerts || ii + (n - 1) * sides * 6 + 6 * sides > maxIdx) break;
      c.setHex(line.color); ct.setHex(line.tracer ?? line.color);
      const l = { r: line.diameterM / 2, d: line.diameterM };
      const base = v;
      let L = 0;
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (T.lengthSq() < 1e-12) T.copy(Tp.lengthSq() ? Tp : tmp.set(1, 0, 0)); T.normalize();
        if (i === 0) {
          // a first normal across the rope: from world up, or x when the rope runs vertically
          N.set(0, 1, 0); if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
          N.addScaledVector(T, -N.dot(T)).normalize();
        } else {
          // parallel transport: N follows the turn from the last direction to this one (no twist, no flip)
          N.addScaledVector(T, -N.dot(T));
          if (N.lengthSq() < 1e-10) N.set(0, 1, 0).addScaledVector(T, -T.y);
          N.normalize();
          L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
        }
        B.crossVectors(T, N);
        for (let k = 0; k <= sides; k++) {
          const ang = (k / sides) * 2 * Math.PI;
          tmp.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(B, Math.sin(ang));
          put(P[i], tmp, T, L, k / sides, l);
        }
        Tp.copy(T);
        if (i > 0) {
          const r0 = base + (i - 1) * ring, r1 = base + i * ring;
          for (let k = 0; k < sides; k++) {
            idx[ii++] = r0 + k; idx[ii++] = r1 + k; idx[ii++] = r1 + k + 1;
            idx[ii++] = r0 + k; idx[ii++] = r1 + k + 1; idx[ii++] = r0 + k + 1;
          }
        }
      }
      // the cut ends: a flat cap each (whipped ends; most hide in a coil, a block or the drum)
      for (const [i, s] of [[0, -1], [n - 1, 1]]) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize().multiplyScalar(s);
        const r0 = base + i * ring;
        const cv = put(P[i], tmp.set(0, 0, 0), T, i === 0 ? 0 : L, 0, { r: 0, d: l.d });
        nrm[cv * 3] = T.x; nrm[cv * 3 + 1] = T.y; nrm[cv * 3 + 2] = T.z;
        for (let k = 0; k < sides; k++) {
          if (s > 0) { idx[ii++] = cv; idx[ii++] = r0 + k; idx[ii++] = r0 + k + 1; } else { idx[ii++] = cv; idx[ii++] = r0 + k + 1; idx[ii++] = r0 + k; }
        }
      }
    }
    for (const k of ['position', 'normal', 'color', 'tracer', 'rtan', 'along', 'around', 'diam']) { A[k].needsUpdate = true; A[k].clearUpdateRanges?.(); A[k].addUpdateRange?.(0, v * A[k].itemSize); }
    g.index.needsUpdate = true; g.index.clearUpdateRanges?.(); g.index.addUpdateRange?.(0, ii);
    g.setDrawRange(0, ii);
    return ii / 3;
  }
  // far: one degenerate triangle (three indices on one vertex: nothing drawn), so the mesh stays shown for the warm-up
  // without an empty draw (WebGPU warns on an index count of 0)
  let idle = true;
  function clear() {
    g.index.array[0] = g.index.array[1] = g.index.array[2] = 0;
    g.index.needsUpdate = true; g.index.clearUpdateRanges?.(); g.index.addUpdateRange?.(0, 3);
    g.setDrawRange(0, 3); idle = true;
  }
  clear();
  return { mesh, fill: (lines) => { idle = false; return fill(lines); }, clear, triangles: () => (idle ? 0 : g.drawRange.count / 3) };
}

// The braid (a 16-plait cover, as lines.js's ribbon draws it): two families of yarns spiralling opposite ways round the
// rope, over and under; a tracer yarn (sheets: navy) as a fleck; the yarns' crowns a touch smoother than the valleys, and
// the twist tilts the normal so the cover catches the light in a herringbone. All of it fades once a yarn is under ≈ a
// pixel (fwidth), so a rope at 10 m is a clean round line.
export function ropeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ name: 'rope', roughness: 0.78, metalness: 0 });
  const base = attribute('color', 'vec3'), tr = attribute('tracer', 'vec3');
  const al = attribute('along', 'float'), aro = attribute('around', 'float'), d = attribute('diam', 'float');
  const pitch = d.mul(0.85);
  const ph1 = al.div(pitch).add(aro.mul(8)), ph2 = al.div(pitch).sub(aro.mul(8));
  const u1 = fract(ph1), u2 = fract(ph2);
  const sel = smoothstep(0.45, 0.55, fract(al.div(pitch).mul(2)));                  // over-under alternation
  const y1 = sin(u1.mul(Math.PI)), y2 = sin(u2.mul(Math.PI));
  const weave = mix(y1, y2, sel);
  const k = float(1).sub(smoothstep(0.35, 0.9, fwidth(al).div(pitch)));            // yarns per pixel along
  const tracer = smoothstep(0.80, 0.92, u1).mul(k);
  mat.colorNode = Fn(() => mix(base, tr, tracer.mul(0.85)).mul(mix(float(0.92), weave.mul(0.30).add(0.75), k)))();
  mat.roughnessNode = mix(float(0.8), float(0.86).sub(weave.mul(0.14)), k);
  // the twist: the height's slope along the rope (d/dphase of sin(πu)) tilts the normal toward the rope's direction
  mat.normalNode = Fn(() => {
    const slope = mix(cos(u1.mul(Math.PI)), cos(u2.mul(Math.PI)).negate(), sel).mul(0.35).mul(k);
    const tView = modelViewMatrix.mul(vec4(attribute('rtan', 'vec3'), 0)).xyz;
    return normalize(normalView.sub(normalize(tView).mul(slope)));
  })();
  return mat;
}
