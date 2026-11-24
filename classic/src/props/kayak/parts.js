// The kayak's hardware and paddle (§ Paddle), each placed on the shape's own
// surface (shape.js deck / section / bottomY), so a change of the sheet moves the parts with the hull.
//
//   buildParts(S, { seatback, paddle: 'stowed' | 'none' }) → { nylon, cord, hole, pad, shaft, blade } (one merged
//   BufferGeometry per material, null when empty) and { paddleLine } (the shaft's two ends, for the tests)
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// a tube along points (a Catmull-Rom curve), radius r
function tube(points, r, seg = 24, radial = 8) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(c, seg, r, radial, false);
}
// a straight tube with flat ends between a and b
function rod(a, b, r, radial = 10) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const strip = (g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; };
const merge = (list) => (list.length ? mergeGeometries(list.map(strip), false) : null);

// the blades: an asymmetric outline (the upper edge longer and straighter), a spine ridge on the back, a slight spoon
function bladeGeometry(P, flip = false) {
  const nu = 18, nv = 9, pos = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv * 2 - 1;                      // u: neck → tip; v: lower edge → upper edge
    const widthHalf = (P.bladeW / 2) * Math.pow(Math.sin(Math.min(1, u * 1.15) * Math.PI / 2), 0.7) * (u > 0.85 ? Math.sqrt(1 - ((u - 0.85) / 0.15) ** 2 * 0.65) : 1);
    const asym = v > 0 ? 1.0 : 0.82 + 0.18 * u;                // the lower edge cut back near the neck
    const y = v * widthHalf * asym + 0.012 * u;                  // the blade's offset from the shaft line (its upper side)
    const spoon = 0.010 * (1 - v * v) * Math.sin(u * Math.PI);  // the power face's curve
    pos.push(u * P.bladeL, y, -spoon);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a0 = i * (nv + 1) + j, b0 = a0 + 1, c0 = a0 + nv + 1, d0 = c0 + 1; idx.push(a0, c0, b0, b0, c0, d0); }
  const top = new THREE.BufferGeometry(); top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); top.setIndex(idx);
  // thickness: a back face offset by the spine (4 mm at the edges, 10 mm along the spine)
  const back = top.clone(); const bp = back.attributes.position;
  for (let k = 0; k < bp.count; k++) {
    const v = (k % (nv + 1)) / nv * 2 - 1, u = Math.floor(k / (nv + 1)) / nu;
    bp.setZ(k, bp.getZ(k) + 0.004 + 0.008 * Math.exp(-((v / 0.22) ** 2)) * (1 - 0.5 * u));
  }
  const bi = back.index.array; for (let k = 0; k < bi.length; k += 3) { const t = bi[k + 1]; bi[k + 1] = bi[k + 2]; bi[k + 2] = t; }
  const g = mergeGeometries([top, back], false); g.computeVertexNormals();
  if (flip) g.scale(1, 1, -1);
  return g;
}

export function buildParts(S, { seatback = true, paddle = 'stowed', feather = S.K.paddle.feather, bag = false } = {}) {
  const K = S.K, L = S.L;
  const nylon = [], cord = [], hole = [], pad = [], shaft = [], blade = [], bagG = [], frame = [];
  const fittings = [];   // [x, y, z, kind] in the station frame: the shell's grime and wear gather round them (index.js)
  const deckY = (x, z) => S.deck(x, z).y;
  const R = (v) => { v.z += S.dz(v.z, v.y); return v; };   // a station-frame point to the raked hull's frame (shape.js dz)
  const Rg = (g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + S.dz(p.getZ(i), p.getY(i))); g.computeVertexNormals(); return g; };
  const gunwaleX = (z) => S.halfBeam(S.sOf(z));
  // the hull side's half-width at height y (bisection up the section)
  const sideX = (z, y) => {
    const s = S.sOf(z); let lo = 0.2, hi = Math.PI / 2;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (S.section(s, m)[1] < y) lo = m; else hi = m; }
    return S.section(s, (lo + hi) / 2)[0];
  };

  // ---- side carry handles: a moulded grip on two mounting blocks, on the hull side under the gunwale, amidships ----
  for (const sx of [-1, 1]) {
    const z0 = -0.04, s = S.sOf(z0), y = S.sheerY(s) - 0.085;
    const xs = (z) => sideX(z, y);
    const pts = [V(xs(z0 - 0.10), y, z0 - 0.10), V(xs(z0 - 0.075) + 0.026, y - 0.006, z0 - 0.07), V(xs(z0) + 0.032, y - 0.012, z0),
      V(xs(z0 + 0.075) + 0.026, y - 0.006, z0 + 0.07), V(xs(z0 + 0.10), y, z0 + 0.10)].map((p) => (p.x *= sx, p));
    nylon.push(tube(pts, 0.010, 20, 8));
    for (const dz of [-0.10, 0.10]) {
      const b = new THREE.BoxGeometry(0.018, 0.034, 0.040); b.translate(sx * (xs(z0 + dz) + 0.004), y, z0 + dz); nylon.push(b);
      fittings.push([sx * xs(z0 + dz), y, z0 + dz, 'handle']);
    }
  }

  // ---- the bow toggle: a cord loop through the moulded handle hole at the tip, a T-grip hanging off the end ----
  for (const end of [-1]) {   // the bow; the stern carries a moulded bar handle (below)
    const zt = end * L / 2, s = end < 0 ? 0 : 1, yTop = S.sheerY(s);
    const yHole = yTop - 0.04, zIn = zt - end * 0.07, zU = S.unshift(zIn, yHole);   // the hole, 7 cm in from the deck's tip
    // the handle hole: a dark slot through the tip, both faces
    for (const sx of [-1, 1]) {
      const h = new THREE.CircleGeometry(0.011, 14); h.rotateY(sx * Math.PI / 2);
      h.translate(sx * (sideX(zU, yHole) + 0.0015), yHole, zIn); hole.push(h);
    }
    // the stem's face at the grip's height (the toggle hangs against it)
    const yT = yHole - 0.10, zStem = S.zOf(s) + S.dz(S.zOf(s), yT), zT = zStem + end * 0.03;
    for (const sx of [-1, 1]) cord.push(tube([V(sx * 0.004, yHole, zIn), V(sx * 0.010, yHole + 0.014, (zIn + zt) / 2), V(sx * 0.016, yHole - 0.01, zt + end * 0.02), V(sx * 0.03, yT + 0.004, zT)], 0.0032, 16, 6));
    const grip = new THREE.CylinderGeometry(0.0125, 0.0125, 0.115, 12, 1); grip.rotateZ(Math.PI / 2); grip.translate(0, yT - 0.006, zT); nylon.push(grip);
    const boss = new THREE.SphereGeometry(0.017, 12, 8); boss.scale(1, 0.8, 0.8); boss.translate(0, yT - 0.004, zT); nylon.push(boss);
  }

  // ---- the stern's carry handle (P2): a black moulded bar on two feet, across the deck near the tip ----
  {
    const zs = S.L / 2 - S.K.rake.stern - 0.16, ys = deckY(0, zs), w = 0.10, h = 0.040;
    const bar = tube([V(-w / 2, ys + 0.004, zs), V(-w / 2 + 0.004, ys + h, zs), V(w / 2 - 0.004, ys + h, zs), V(w / 2, ys + 0.004, zs)], 0.0115, 24, 10);
    nylon.push(Rg(bar));
    for (const sx of [-1, 1]) { const f = new THREE.BoxGeometry(0.030, 0.012, 0.040); f.translate(sx * w / 2, ys + 0.004, zs); nylon.push(Rg(f)); }
    fittings.push([0, ys, zs, 'handle']);
  }

  // ---- pad-eyes and shock cord: the rear tank well's X lacing (6 eyes) and a bow X (4 eyes) ----
  const padEye = (x, z) => {
    const y = deckY(x, z);
    const g = new THREE.SphereGeometry(0.016, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.45, 0.75); g.translate(x, y - 0.001, z + S.dz(z, y)); nylon.push(g);
    fittings.push([x, y, z, 'eye']);
    return V(x, y + 0.008, z);   // station frame: lace() rakes it
  };
  // the dry bag (deck clutter, P2): a rolled cylinder lying across the tank well, under its shock cord
  const twk = K.tankWell, bagZ = (twk.front + twk.back) / 2 + 0.02, bagR = 0.075, bagY = deckY(0, bagZ) + bagR;
  const bagTop = (x, z) => (bag && Math.abs(x) < 0.16 && Math.abs(z - bagZ) < bagR ? bagY + Math.sqrt(bagR * bagR - (z - bagZ) ** 2) : -1);
  if (bag) {
    const g = new THREE.CapsuleGeometry(bagR, 0.20, 6, 16); g.rotateZ(Math.PI / 2); g.scale(1, 0.92, 1);
    const p = g.attributes.position;   // a soft, slightly squashed roll with a few creases
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) * (1 + 0.05 * Math.sin(x * 40))); }
    g.computeVertexNormals(); g.translate(0, bagY - 0.006, bagZ); bagG.push(Rg(g));
    const roll = new THREE.BoxGeometry(0.05, 0.03, 0.13); roll.translate(0.165, bagY + 0.02, bagZ); bagG.push(Rg(roll));
  }
  // shock cord: each span sags (≈ 1.5 cm + 1 cm a metre, more over a well) and rests on the deck where it meets it
  const lace = (pts, sag = 1) => {
    const all = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1], len = p.distanceTo(q), n = Math.max(6, Math.round(len / 0.03));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n, v = p.clone().lerp(q, t);
        v.y -= sag * (0.015 + 0.010 * len) * 4 * t * (1 - t);
        v.y = Math.max(v.y, deckY(v.x, v.z) + 0.0045, bagTop(v.x, v.z) + 0.004);
        all.push(v);
      }
    }
    cord.push(tube(all.map((v) => R(v.clone())), 0.0042, all.length * 2, 6));
  };
  {
    const tw = K.tankWell, zs = [tw.front + 0.05, (tw.front + tw.back) / 2, tw.back - 0.05];
    const hwAt = (z) => tw.hwFront + (tw.hwBack - tw.hwFront) * (z - tw.front) / (tw.back - tw.front);
    const Lp = zs.map((z) => padEye(-(hwAt(z) + 0.040), z)), Rp = zs.map((z) => padEye(hwAt(z) + 0.040, z));
    lace([Lp[0], Rp[1], Lp[2]], 1.6); lace([Rp[0], Lp[1], Rp[2]], 1.6);
    lace([Lp[0], Rp[0]], 1.2); lace([Lp[2], Rp[2]], 1.2);
  }
  {
    // round the bow well: an X and a bar across its back
    const bw = K.bowWell, za = bw.front + 0.03, zb = bw.back - 0.01, xa = bw.hw + 0.030, xb = bw.hw + 0.035;
    const A = [padEye(-xa, za), padEye(xa, za)], B = [padEye(-xb, zb), padEye(xb, zb)];
    lace([A[0], B[1]], 1.5); lace([A[1], B[0]], 1.5); lace([B[0], B[1]], 1.2);
  }

  // ---- the scuppers: a dark throat from each well's floor, its outlet under the hull ----
  for (const [x, z] of K.scupper.at) {
    const top = deckY(x, z), bot = S.bottomY(x, z), r = K.scupper.r;
    const th = new THREE.CylinderGeometry(r, r * 0.92, Math.max(0.02, top - bot - 0.004), 16, 1, true);
    th.translate(x, (top + bot) / 2 - 0.002, z); hole.push(th);
    const d1 = new THREE.CircleGeometry(r * 1.02, 16); d1.rotateX(Math.PI / 2); d1.translate(x, bot - 0.0015, z); hole.push(d1);
  }

  // ---- the drain plug on the stern deck, the paddle keeper on the port gunwale ----
  {
    const z0 = 1.30, y = deckY(0, z0), z = z0 + S.dz(z0, y);
    const g = new THREE.CylinderGeometry(0.022, 0.024, 0.008, 18); g.translate(0, y + 0.002, z); nylon.push(g);
    fittings.push([0, y, z0, 'plug']);
    const t = new THREE.BoxGeometry(0.032, 0.010, 0.007); t.translate(0, y + 0.010, z); nylon.push(t);
  }
  // ---- the stern skid plate: a replaceable wear plate conformed to the keel's last 0.30 m ----
  {
    const rows = 14, cols = 9, pos = [], idx = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const s = 0.905 + (0.983 - 0.905) * i / (rows - 1), phi = (j / (cols - 1) * 2 - 1) * 0.40;
      const [x, y] = S.section(s, Math.abs(phi));
      pos.push(Math.sign(phi) * x, y - 0.003, S.zOf(s));
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    nylon.push(Rg(g));
  }

  // ---- the console's 6 in hatch: a black rim and a lid with a grip bar ----
  {
    const co = K.console, z = (co.front + co.back) / 2, y = deckY(0, z), r = co.hatchR;
    const rim = new THREE.TorusGeometry(r, 0.008, 8, 32); rim.rotateX(Math.PI / 2); rim.scale(1, 0.6, 1); rim.translate(0, y + 0.003, z); nylon.push(rim);
    const lid = new THREE.CylinderGeometry(r - 0.004, r, 0.012, 32); lid.translate(0, y + 0.006, z); nylon.push(lid);
    const bar = new THREE.BoxGeometry(0.018, 0.012, r * 1.3); bar.translate(0, y + 0.017, z); nylon.push(bar);
    for (let k = 0; k < 8; k++) fittings.push([Math.cos(k * Math.PI / 4) * r, y, z + Math.sin(k * Math.PI / 4) * r, 'rim']);
  }

  // ---- the strap-on seat back (rental standard): a padded, curved back on two straps to the gunwale ----
  if (seatback) {
    // the rental seat (P1): a padded black pan on the seat well's floor and a high padded back (≈ 33 cm over the pan) on a
    // dark grey tube frame, held by two straps to the gunwale aft
    const padded = (w, h, t, wrap, sx = 14, sy = 10) => {
      const g = new THREE.BoxGeometry(w, h, t, sx, sy, 2), q = g.attributes.position;
      for (let i = 0; i < q.count; i++) {
        let x = q.getX(i), y = q.getY(i), z = q.getZ(i);
        const r = Math.min(1, Math.hypot(x / (w / 2), y / (h / 2)));
        z *= Math.max(0.45, 1 - 0.5 * Math.max(0, r - 0.7) / 0.3);       // rounded, padded edges
        z += wrap * (x / (w / 2)) ** 2;
        q.setXYZ(i, x, y, z);
      }
      g.computeVertexNormals();
      return g;
    };
    const zs = K.seatZ + 0.01, ys = deckY(0, zs);
    const pan = padded(0.36, 0.40, 0.035, 0.0); pan.rotateX(-Math.PI / 2); pan.translate(0, ys + 0.020, zs); pad.push(pan);
    const zb = zs + 0.20, yb = ys + 0.035, H = 0.34, lean = 0.26;   // the back: its foot at the pan's rear, leaning ≈ 15°
    const back = padded(0.38, H, 0.055, 0.06);
    back.translate(0, H / 2, 0); back.rotateX(-lean); back.translate(0, yb, zb); pad.push(back);
    // the frame: a U of 16 mm tube behind the back, its feet on the pan's rear corners
    const off = (y) => zb + 0.035 + Math.sin(lean) * y;
    const U = [V(-0.18, yb, off(0)), V(-0.195, yb + H * 0.6, off(H * 0.6)), V(-0.17, yb + H * 0.98, off(H * 0.98)),
      V(0, yb + H * 1.02, off(H * 1.02)), V(0.17, yb + H * 0.98, off(H * 0.98)), V(0.195, yb + H * 0.6, off(H * 0.6)), V(0.18, yb, off(0))];
    frame.push(tube(U, 0.008, 40, 8));
    for (const sx of [-1, 1]) frame.push(rod(V(sx * 0.18, yb, off(0)), V(sx * 0.17, ys + 0.02, zs + 0.17), 0.008, 8));
    const topL = V(-0.17, yb + H * 0.95, off(H * 0.95)), topR = V(0.17, yb + H * 0.95, off(H * 0.95));
    const aftL = padEye(-(gunwaleX(0.66) - 0.05), 0.66), aftR = padEye(gunwaleX(0.66) - 0.05, 0.66);
    cord.push(rod(topL, aftL, 0.005, 6), rod(topR, aftR, 0.005, 6));
  }

  // ---- the paddle: 2.30 m black aluminium shaft, asymmetric dihedral polypropylene blades, feathered ----
  let paddleLine = null;
  if (paddle === 'stowed') {
    // laid along the port gunwale (the keeper clip by the seat holds it): a straight line from a point over the bow deck to
    // one over the stern quarter, lifted until the shaft and the blades' lowest edges clear the deck
    const P = K.paddle;
    const zA = -1.12, zB = zA + P.length * 0.999;
    const xA = -0.16, xB = -0.26;   // the blades inboard of the gunwale, the shaft by the cockpit's port lip
    const a = V(xA, 0, zA), b = V(xB, 0, zB), dir = new THREE.Vector3().subVectors(b, a).normalize();
    const featherRad = feather * Math.PI / 180;
    const need = [];
    for (let k = 0; k <= 60; k++) {
      const t = k / 60, q = a.clone().lerp(b, t), dl = t * P.length;
      const inBlade = dl < P.bladeL ? 0 : dl > P.length - P.bladeL ? 1 : -1;
      const drop = inBlade === 1 ? (P.bladeW / 2) * Math.sin(featherRad) : inBlade === 0 ? 0.006 : P.shaftD / 2;
      // over the water (outside the hull) nothing to clear
      const inside = Math.abs(q.x) < S.halfBeam(S.sOf(q.z));
      need.push([t, inside ? deckY(q.x, q.z) + drop + 0.002 : -1]);
    }
    // the support line: the lowest line over every need (two-point contact)
    let best = null;
    for (let i = 0; i < need.length; i++) for (let j = i + 1; j < need.length; j++) {
      const [ti, yi] = need[i], [tj, yj] = need[j];
      if (yi < 0 || yj < 0) continue;
      const m = (yj - yi) / (tj - ti), c = yi - m * ti;
      if (need.every(([t, y]) => m * t + c >= y - 1e-6)) { const area = c + m * 0.5; if (!best || area < best.area) best = { m, c, area }; }
    }
    a.y = best.c; b.y = best.c + best.m;
    paddleLine = [a.clone(), b.clone()];
    shaft.push(rod(a.clone().addScaledVector(dir, P.bladeL - 0.06), b.clone().addScaledVector(dir, -(P.bladeL - 0.06)), P.shaftD / 2, 14));
    // drip rings
    for (const t of [0.27, 0.73]) {
      const g = new THREE.TorusGeometry(0.026, 0.004, 6, 18); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir));
      const c = a.clone().lerp(b, t); g.translate(c.x, c.y, c.z); nylon.push(g);
    }
    const bladeGeo = (flip) => bladeGeometry(P, flip);
    // blade 0 lies flat on the bow deck (its face down), blade 1 turned by the feather angle about the shaft
    const basis = (end) => {
      const out = end === 0 ? dir.clone().negate() : dir.clone();
      const side = new THREE.Vector3(0, 1, 0).cross(out).normalize();   // horizontal, across the shaft
      const normal = new THREE.Vector3().crossVectors(out, side).normalize();   // up
      const rot = end === 0 ? 0 : featherRad;
      const s2 = side.clone().applyAxisAngle(out, rot), n2 = normal.clone().applyAxisAngle(out, rot);
      return new THREE.Matrix4().makeBasis(out, s2, n2);
    };
    for (const end of [0, 1]) {
      const g = bladeGeo(false);
      // local: x along the blade (out from the neck), y across, z the face normal; the face lies 'down' on the deck
      const m = basis(end);
      const neck = end === 0 ? a.clone().addScaledVector(dir, P.bladeL) : b.clone().addScaledVector(dir, -P.bladeL);
      // map local (x, y, z) → out·x + side·y + normal·z
      const M = new THREE.Matrix4().makeBasis(new THREE.Vector3().setFromMatrixColumn(m, 0), new THREE.Vector3().setFromMatrixColumn(m, 1), new THREE.Vector3().setFromMatrixColumn(m, 2));
      g.applyMatrix4(M); g.translate(neck.x, neck.y, neck.z);
      blade.push(g);
    }
    // the keeper: a shock-cord loop round the shaft by the seat, tied down to a pad-eye on the gunwale outboard of it
    for (const zc of [-0.30, 0.45]) {
      const t = (zc - a.z) / (b.z - a.z), c = a.clone().lerp(b, t);
      const loop = new THREE.TorusGeometry(P.shaftD / 2 + 0.005, 0.0042, 6, 16);
      loop.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir)); loop.translate(c.x, c.y, c.z); cord.push(loop);
      const eye = padEye(c.x - 0.05, zc);
      cord.push(rod(V(c.x - 0.012, c.y - 0.012, c.z), eye, 0.0042, 6), rod(V(c.x + 0.010, c.y - 0.014, c.z), eye, 0.0042, 6));
    }
  }

  return { nylon: merge(nylon), cord: merge(cord), hole: merge(hole), pad: merge(pad), shaft: merge(shaft), blade: merge(blade), bag: merge(bagG), frame: merge(frame), paddleLine, fittings };
}

// The paddle in a paddler's hands (feat/kayak-paddler): the same shaft, drip rings and blades as
// the stowed one, in the paddle's own frame, so a rig moves it as one control.
//   frame: x along the shaft (the starboard blade at +x), the origin at the shaft's middle; the starboard blade's power
//   face looks along +z with its long edge up (+y); the port blade is its mirror turned by the feather about x (a roll of
//   −feather about x brings the port power face to +z).
export function buildHeldPaddle(K, { feather = K.paddle.feather } = {}) {
  const P = K.paddle, half = P.length / 2, neck = half - P.bladeL;
  const shaft = [rod(V(-(neck + 0.06), 0, 0), V(neck + 0.06, 0, 0), P.shaftD / 2, 14)];
  const nylon = [];
  for (const s of [-1, 1]) {
    const g = new THREE.TorusGeometry(0.026, 0.004, 6, 18); g.rotateY(Math.PI / 2); g.translate(s * 0.52, 0, 0); nylon.push(g);
  }
  const stbd = bladeGeometry(P); stbd.translate(neck, 0, 0);
  // the port blade: mirrored in x (out along −x, the same power face and long edge), its winding put back, then feathered
  const port = bladeGeometry(P); port.scale(-1, 1, 1);
  const ix = port.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
  port.translate(-neck, 0, 0); port.rotateX(feather * Math.PI / 180); port.computeVertexNormals();
  return {
    shaft: merge(shaft), nylon: merge(nylon), blade: merge([stbd, port]),
    // the blades' centres and tips along the shaft (x in the paddle frame), for the water test
    blades: { stbd: { centre: neck + P.bladeL / 2, tip: half }, port: { centre: -(neck + P.bladeL / 2), tip: -half } },
    feather,
  };
}
