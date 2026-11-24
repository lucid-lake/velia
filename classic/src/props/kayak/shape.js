// The kayak's shape: plain functions of the sheet's numbers (dims.js), so the
// geometry, the hardware's placement, the float and the tests read one surface.
//
//   const S = kayakShape();            S.halfBeam(s), S.keelY(s), S.sheerY(s): the plan, the rocker and the sheer at
//                                      s ∈ [0, 1] bow → stern; S.section(s, phi) a hull point; S.deck(x, z) the deck's
//                                      height and its wear masks; S.bottomY(x, z) the hull's underside
//   buildShell(S, { rows, hull, roll, deck })   one closed BufferGeometry (hull + deck as one ring per station, so the
//                                      gunwale has no seam), with a 'kwear' vec4 per vertex: (cavity, edge, contact, touch)
//   waterlineFor(S, massKg)           the draft (m over the keel datum) that floats that mass in fresh water
//
// Frame: x starboard, y up from the keel strip's lowest point, z aft (bow at −z). Deterministic: no randomness here.
import * as THREE from 'three/webgpu';
import { KAYAK } from '../../../../src/props/kayak/dims.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };

// a rounded rectangle's signed distance in plan (x across, z along), centred on (0, zc)
function sdRound(x, z, zc, hw, hl, r) {
  const qx = Math.abs(x) - (hw - r), qz = Math.abs(z - zc) - (hl - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

export function kayakShape(K = KAYAK) {
  const L = K.length, B2 = K.beam / 2;
  // the stations run over the keel's length; the raked stems carry the deck's tips out to ±L/2 (dz below)
  const z0 = -L / 2 + K.rake.bow, Lk = L - K.rake.bow - K.rake.stern;
  const sOf = (z) => clamp((z - z0) / Lk);
  const zOf = (s) => z0 + s * Lk;
  const uOf = (s) => (s < K.beamAt ? (s - K.beamAt) / K.beamAt : (s - K.beamAt) / (1 - K.beamAt));

  function halfBeam(s) {
    const u = uOf(s), a = Math.abs(u), bow = u < 0;
    const p = bow ? K.plan.bowP : K.plan.sternP, q = bow ? K.plan.bowQ : K.plan.sternQ;
    return B2 * Math.pow(Math.max(0, 1 - Math.pow(a, p)), q);
  }
  // the keel line (the V's centre, over the datum): rocker toward the ends, then the stem's sweep up
  function keelY(s) {
    const u = uOf(s), a = Math.abs(u), bow = u < 0;
    const R = bow ? K.rocker.bow : K.rocker.stern, St = bow ? K.rocker.bowStem : K.rocker.sternStem;
    return K.keelStrip.h + R * Math.pow(a, 2.2) + St * Math.pow(smooth(0.74, 1.0, a), 1.7);
  }
  function sheerY(s) {
    const u = uOf(s), a = Math.abs(u);
    return K.sheerMid + (u < 0 ? K.sheerBow : K.sheerStern) * a * a;
  }
  const rollR = (s) => Math.min(K.gunwaleR, 0.45 * halfBeam(s), 0.3 * (sheerY(s) - keelY(s)));
  // the stems' rake: a point at height y over station s moves out along the length by up to K.rake at the deck's tip
  function dz(z, y) {
    const s = sOf(z), u = uOf(s), a = Math.abs(u);
    const yk = keelY(s) - K.keelStrip.h, ys = sheerY(s);
    const h = clamp((y - yk) / Math.max(ys - yk, 1e-6), 0, 1.06);
    const w = Math.pow(smooth(0.55, 1.0, a), 1.5) * Math.pow(h, 1.3);
    return u < 0 ? -K.rake.bow * w : K.rake.stern * w;
  }

  // a hull point at station s, phi ∈ [0, π/2] from the keel to the gunwale's foot (starboard; mirror for port).
  // Returns [x, y, bottomness 0..1, chine 0..1]
  function section(s, phi) {
    const b = halfBeam(s), yk = keelY(s), R = rollR(s), ytop = sheerY(s) - R;
    const a = Math.abs(uOf(s));
    const n = 2.9 + 1.3 * (1 - a * a * a);                  // full and boxy amidships, a little rounder toward the ends
    const sn = Math.sin(phi), cs = Math.cos(phi);
    const S = Math.pow(Math.max(sn, 0), 2 / n), C = Math.pow(Math.max(cs, 0), 2 / n);
    let x = b * S, y = yk + (ytop - yk) * (1 - C);
    const w = smooth(0.55, 0.92, C);                         // 1 on the bottom, 0 up the side
    const xn = b > 1e-6 ? x / b : 0;
    y += w * K.deadrise * Math.pow(xn, 1.2) * (1 - 0.4 * a);  // the V
    y -= w * K.keelStrip.h * Math.exp(-Math.pow(x / (K.keelStrip.w / 2), 4));   // the keel strip
    const spm = 1 - smooth(0.70, 0.92, a);                   // the sponsons fade before the stems
    y -= w * K.sponson.h * spm * Math.exp(-Math.pow((xn - K.sponson.at) / (K.sponson.w), 2));
    // the moulded rail line under the gunwale (a 6 mm step in, read as a highlight line from the side)
    const lipD = (ytop - K.lip.below - y) / (K.lip.w / 2);
    x -= (1 - w) * K.lip.depth * Math.exp(-lipD * lipD) * smooth(0.0, 0.25, b);
    // the side's recessed panel: a crisp chine ridge below it, the rail above (P1's horizontal crease); blunt edges
    const yf = (y - yk) / Math.max(ytop - yk, 1e-6);
    const pan = smooth(K.panel.lo - 0.05, K.panel.lo + 0.03, yf) - smooth(K.panel.hi - 0.03, K.panel.hi + 0.06, yf);
    x -= (1 - w) * K.panel.depth * pan * smooth(0.0, 0.25, b) * (1 - smooth(0.80, 0.97, a));
    const chine = Math.max(Math.exp(-Math.pow((C - 0.62) / 0.16, 2)), Math.exp(-(((yf - K.panel.lo + 0.02) / 0.03) ** 2)) * (1 - w) * 0.4);   // the crease: an edge, barely a scratch line
    // concave: the tunnels between the keel strip and the sponsons, the panel's lower corner (a fake ambient occlusion)
    const tunnel = w * spm * Math.exp(-Math.pow((xn - 0.30) / 0.14, 2));
    const cav = Math.max(tunnel * 0.55, (1 - w) * Math.exp(-(((yf - K.panel.lo - 0.04) / 0.035) ** 2)) * 0.45);
    return [x, y, w, chine, cav, clamp(yf)];
  }

  // the deck at plan point (x, z): { y, cav, edge, touch, recess } (recess: 0 on the deck, 1 on a well's floor)
  const ck = K.cockpit, tw = K.tankWell, fs = K.footSteps;
  function deck(x, z) {
    const s = sOf(z), b = halfBeam(s), R = rollR(s), ys = sheerY(s), ax = Math.abs(x);
    const a = Math.abs(uOf(s));
    if (ax > b - R) {   // the rounded gunwale
      const dx = clamp((ax - (b - R)) / Math.max(R, 1e-6));
      return { y: ys - R + R * Math.sqrt(Math.max(0, 1 - dx * dx)), cav: 0, edge: 1, touch: 0, recess: 0, pad: 0 };
    }
    const xn = b - R > 1e-6 ? x / (b - R) : 0;
    const crown = (ck.front < z && z < tw.back ? K.crown.mid : K.crown.mid + (K.crown.ends - K.crown.mid) * smooth(0.45, 0.85, a));
    const top = ys + crown * (1 - xn * xn) * smooth(0.0, 0.10, b);   // no crown peak at the stems' tips
    let y = top, cav = 0, edge = 0, touch = 0, recess = 0, pad = 0;
    // the cockpit: the footwells forward, the seat aft, one moulded recess; the seat's back wall slopes (a backrest)
    let hw = ck.hwFeet + (ck.hwSeat - ck.hwFeet) * smooth(-0.45, -0.05, z);
    // the footwell scallops (P1): between the foot-brace steps the wall is cut out into the gunwale, so the steps read as
    // a row of deep pockets along the cockpit's sides
    {
      let rz = 0;
      for (let k = 0; k < fs.n; k++) rz = Math.max(rz, Math.exp(-(((z - (fs.z0 + k * fs.pitch)) / (fs.w / 2)) ** 8)));
      const inFeet = smooth(fs.z0 - 0.06, fs.z0 - 0.02, z) * smooth(fs.z0 + (fs.n - 1) * fs.pitch + 0.06, fs.z0 + (fs.n - 1) * fs.pitch + 0.02, z);
      hw += fs.pocket * (1 - rz) * inFeet;
    }
    const zc = (ck.front + ck.back) / 2, hl = (ck.back - ck.front) / 2;
    const sd = sdRound(x, z, zc, hw, hl, ck.r);
    const wall = ck.wall + (0.10 - ck.wall) * smooth(0.22, 0.44, z) + 0.03 * smooth(-0.80, -1.04, z);
    const m = smoother(-sd / wall);
    if (m > 0) {
      const toFeet = smooth(0.10, -0.50, z), toFront = smooth(-0.60, -1.0, z);
      let fl = ck.seatFloor + (ck.footFloor - ck.seatFloor) * toFeet + (ck.frontFloor - ck.footFloor) * toFront;
      const ex = clamp(1 - (x / 0.20) ** 2);
      fl -= 0.014 * Math.exp(-(((z - K.seatZ) / 0.13) ** 2)) * ex;            // the hip bowl
      fl += 0.020 * Math.exp(-(((z + 0.20) / 0.09) ** 2)) * ex;               // the thigh rise ahead of it
      // the foot-brace ridges along each side wall
      let ridge = 0;
      for (let k = 0; k < fs.n; k++) {
        const d = (z - (fs.z0 + k * fs.pitch)) / (fs.w / 2);
        ridge = Math.max(ridge, Math.exp(-(d ** 8)));   // blocky steps, near-vertical faces
      }
      ridge *= smooth(fs.inner, fs.inner + 0.020, ax);
      fl += fs.h * ridge;
      // the scuppers' dished drains
      for (const [sx, sz] of K.scupper.at) { const d2 = ((x - sx) ** 2 + (z - sz) ** 2) / (0.035 ** 2); fl -= 0.005 * Math.exp(-d2); }
      // the raised console between the legs (its top carries the hatch)
      const co = K.console;
      const sdc = sdRound(x, z, (co.front + co.back) / 2, co.hw, (co.back - co.front) / 2, co.r);
      const mc = smoother(-sdc / co.wall);
      fl = fl + (co.top - fl) * mc;
      y = top + (fl - top) * m;
      edge = Math.max(edge, Math.exp(-((sdc / 0.010) ** 2)) * 0.8 * m);
      // the moulded hexagon non-slip: on the seat and the footwell floors, off the walls, the ridges and the console
      pad = smooth(0.92, 1.0, m) * (1 - mc) * (1 - smooth(0.05, 0.4, ridge)) * smooth(-0.95, -0.85, z) * smooth(0.40, 0.30, z);
      recess = m;
      const foot = Math.exp(-(((-sd - wall * 1.15) / (wall * 0.55)) ** 2));   // just inside the wall's foot
      cav = Math.max(cav, m * (0.30 + 0.70 * foot) + 0.5 * ridge * m);
      edge = Math.max(edge, Math.exp(-((sd / 0.012) ** 2)) * 0.9 + ridge * 0.6 * m);
      touch = Math.max(touch, Math.exp(-(((z - K.seatZ) / 0.16) ** 2) - ((x / 0.17) ** 2)) * m);
    }
    // the rear tank well
    {
      const hwt = tw.hwFront + (tw.hwBack - tw.hwFront) * clamp((z - tw.front) / (tw.back - tw.front));
      const sdt = sdRound(x, z, (tw.front + tw.back) / 2, hwt, (tw.back - tw.front) / 2, tw.r);
      const mt = smoother(-sdt / tw.wall);
      if (mt > 0) {
        let fl = top - tw.depth;
        fl += 0.006 * Math.exp(-(((ax - 0.075) / 0.012) ** 2));               // two low ribs
        for (const [sx, sz] of K.scupper.at) { const d2 = ((x - sx) ** 2 + (z - sz) ** 2) / (0.03 ** 2); fl -= 0.004 * Math.exp(-d2); }
        y = Math.min(y, top + (fl - top) * mt);
        recess = Math.max(recess, mt);
        const foot = Math.exp(-(((-sdt - tw.wall * 1.1) / (tw.wall * 0.6)) ** 2));
        cav = Math.max(cav, mt * (0.35 + 0.65 * foot));
        edge = Math.max(edge, Math.exp(-((sdt / 0.010) ** 2)) * 0.9);
      }
    }
    // the bow well: a shallow ribbed recess under the bow's shock cord
    {
      const bw = K.bowWell;
      const sdb = sdRound(x, z, (bw.front + bw.back) / 2, bw.hw, (bw.back - bw.front) / 2, bw.r);
      const mb = smoother(-sdb / bw.wall);
      if (mb > 0) {
        let fl = top - bw.depth;
        const rp = (bw.back - bw.front) / (bw.ribs + 1);
        for (let k = 1; k <= bw.ribs; k++) fl += 0.018 * Math.exp(-(((z - bw.front - k * rp) / 0.012) ** 8));
        y = Math.min(y, top + (fl - top) * mb);
        recess = Math.max(recess, mb);
        const foot = Math.exp(-(((-sdb - bw.wall * 1.1) / (bw.wall * 0.6)) ** 2));
        cav = Math.max(cav, mb * (0.35 + 0.65 * foot));
        edge = Math.max(edge, Math.exp(-((sdb / 0.010) ** 2)) * 0.9);
      }
    }
    // the cup holder in the starboard gunwale beside the knees
    {
      const cu = K.cup, d = Math.hypot(x - cu.x, z - cu.z);
      const mc = smoother((cu.r - d) / 0.010);
      if (mc > 0) { y -= cu.depth * mc; recess = Math.max(recess, mc); cav = Math.max(cav, mc * 0.8); }
      edge = Math.max(edge, Math.exp(-(((d - cu.r) / 0.008) ** 2)) * 0.9);
    }
    // a low moulded ridge between the seat back and the tank well
    y += 0.010 * Math.exp(-(((z - 0.52) / 0.035) ** 2)) * (1 - recess) * clamp(1 - (x / 0.24) ** 2);
    // hands and the paddle shaft rub the gunwale tops beside the seat
    touch = Math.max(touch, Math.exp(-(((z - 0.0) / 0.35) ** 2)) * smooth(0.55, 0.95, Math.abs(xn)) * 0.8);
    edge = Math.max(edge, smooth(0.80, 1.0, Math.abs(xn)) * 0.5);
    return { y, cav: clamp(cav), edge: clamp(edge), touch: clamp(touch), recess, pad };
  }

  // the hull's underside height at plan (x, z) (for the scuppers' outlets and the skid plate)
  function bottomY(x, z) {
    const s = sOf(z), ax = Math.abs(x);
    let prev = section(s, 0);
    for (let i = 1; i <= 64; i++) {
      const p = section(s, (i / 64) * (Math.PI / 2));
      if (p[0] >= ax) { const t = (ax - prev[0]) / Math.max(p[0] - prev[0], 1e-9); return prev[1] + (p[1] - prev[1]) * t; }
      prev = p;
    }
    return prev[1];
  }

  // the inverse of the rake (a shifted z at height y back to its station's z), by fixed-point iteration
  const unshift = (z, y) => { let u = z; for (let i = 0; i < 6; i++) u = z - dz(u, y); return u; };
  return { K, L, Lk, sOf, zOf, uOf, halfBeam, keelY, sheerY, rollR, section, deck, bottomY, dz, unshift };
}

// One ring per station: port gunwale foot → keel → starboard gunwale foot (the hull), then the starboard roll up, the deck
// across to port, the port roll down (back to the start). Stations crowd toward the stems (cosine spacing).
export function buildShell(S, { rows = 220, hull = 26, roll = 6, deck = 64 } = {}) {
  const ring = [];
  for (let j = hull - 1; j >= 1; j--) ring.push({ k: 'h', side: -1, t: j / (hull - 1) });
  ring.push({ k: 'h', side: 1, t: 0 });
  for (let j = 1; j < hull; j++) ring.push({ k: 'h', side: 1, t: j / (hull - 1) });
  for (let j = 1; j < roll; j++) ring.push({ k: 'r', side: 1, t: 1 - j / roll });   // α: π/2 (side) → 0 (top), the top excluded
  for (let j = 0; j < deck; j++) ring.push({ k: 'd', t: 1 - 2 * j / (deck - 1) });   // x: +(b−R) → −(b−R)
  for (let j = 1; j < roll; j++) ring.push({ k: 'r', side: -1, t: j / roll });
  const C = ring.length;
  const pos = new Float32Array(rows * C * 3), wear = new Float32Array(rows * C * 4), uvs = new Float32Array(rows * C * 2);
  const part = new Float32Array(rows * C * 2);   // (height up the side 0..1, deck 1; the non-slip pad mask)
  const L = S.L;
  for (let i = 0; i < rows; i++) {
    const s = 0.5 - 0.5 * Math.cos(Math.PI * i / (rows - 1));
    const z = S.zOf(s), b = S.halfBeam(s), R = S.rollR(s), ys = S.sheerY(s);
    const a = Math.abs(S.uOf(s));
    const stem = Math.pow(smooth(0.80, 1.0, a), 1.2);
    for (let j = 0; j < C; j++) {
      const c = ring[j];
      let x, y, cav = 0, edge = 0, contact = 0, touch = 0, hf = 1, pd = 0;
      if (c.k === 'h') {
        const [px, py, w, chine, hcav, yf] = S.section(s, c.t * Math.PI / 2);
        x = c.side * px; y = py; cav = hcav; hf = yf;
        const keel = Math.exp(-((px / 0.03) ** 2)) * w;
        const spon = Math.exp(-((((px / Math.max(b, 1e-6)) - S.K.sponson.at) / 0.10) ** 2)) * w;
        edge = Math.max(chine * 0.8, keel, stem * 0.7);
        contact = clamp(Math.max(keel, spon * 0.8, chine * 0.6, w * 0.10, stem * (0.6 + 0.4 * w)) * (0.55 + 0.45 * smooth(0.3, 0.9, a)));
        if (s > 0.90) contact = Math.max(contact, w * smooth(0.90, 0.95, s));   // the stern skid's zone
      } else if (c.k === 'r') {
        const al = c.t * Math.PI / 2;
        x = c.side * (b - R + R * Math.sin(al)); y = ys - R + R * Math.cos(al);
        edge = 1; contact = 0.25 * stem;
        touch = Math.exp(-(((z - 0.0) / 0.35) ** 2)) * 0.7;
      } else {
        x = c.t * Math.max(b - R, 0);
        const d = S.deck(x, z);
        y = d.y; cav = d.cav; edge = Math.max(d.edge, stem * 0.5); touch = d.touch; pd = d.pad;
      }
      const o = i * C + j;
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z + S.dz(z, y);
      wear[o * 4] = cav; wear[o * 4 + 1] = edge; wear[o * 4 + 2] = contact; wear[o * 4 + 3] = touch;
      uvs[o * 2] = z / L + 0.5; uvs[o * 2 + 1] = j / C;
      part[o * 2] = hf; part[o * 2 + 1] = pd;
    }
  }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < C; j++) {
    const a = i * C + j, b = i * C + ((j + 1) % C), c = (i + 1) * C + j, d = (i + 1) * C + ((j + 1) % C);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('kwear', new THREE.BufferAttribute(wear, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('kpart', new THREE.BufferAttribute(part, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the stems close every ring to a vertical line: the end rows have no area of their own, so take the next row's normal
  // (pointing along the length, outward), else they shade black
  const nrm = g.attributes.normal;
  for (const [i, k] of [[0, 1], [rows - 1, rows - 2]]) for (let j = 0; j < C; j++) {
    const o = i * C + j, n = k * C + j;
    const dz = i === 0 ? -1 : 1;
    const v = new THREE.Vector3(nrm.getX(n), nrm.getY(n), nrm.getZ(n) + dz * 0.6).normalize();
    nrm.setXYZ(o, v.x, v.y, v.z);
  }
  g.userData = { rows, ring: C };
  return g;
}

// The hull's outline at height y (kayak frame), a closed loop of [x, z] round the hull (starboard bow → stern, port back),
// raked as the shell; empty where the hull does not reach y. For the waterline's contact shading (index.js skirt).
export function waterlinePlan(S, y, n = 90) {
  const half = [];
  for (let i = 0; i <= n; i++) {
    const s = 0.5 - 0.5 * Math.cos(Math.PI * i / n);
    if (S.keelY(s) - S.K.keelStrip.h > y) continue;
    let lo = 0, hi = Math.PI / 2;
    for (let k = 0; k < 28; k++) { const m = (lo + hi) / 2; if (S.section(s, m)[1] < y) lo = m; else hi = m; }
    const x = S.section(s, (lo + hi) / 2)[0], z = S.zOf(s);
    half.push([x, z + S.dz(z, y)]);
  }
  if (half.length < 3) return [];
  return [...half, ...half.slice().reverse().map(([x, z]) => [-x, z])];
}

// The draft (the waterline's height over the keel datum) that floats massKg, by bisection on the hull's sections.
export function waterlineFor(S, massKg, { rows = 120, cols = 48 } = {}) {
  const vol = massKg / S.K.rho;
  const below = (w) => {
    let v = 0;
    for (let i = 0; i < rows; i++) {
      const s0 = i / rows, s1 = (i + 1) / rows, s = (s0 + s1) / 2;
      let area = 0;
      const n = 40, yk = S.keelY(s) - S.K.keelStrip.h;
      for (let k = 0; k < n; k++) {
        const y = yk + (w - yk) * (k + 0.5) / n;
        if (y <= yk) continue;
        area += 2 * halfWidthAt(s, y) * (w - yk) / n;
      }
      v += area * (s1 - s0) * S.Lk;
    }
    return v;
  };
  const halfWidthAt = (s, y) => {
    let prev = S.section(s, 0);
    if (y < prev[1]) return 0;
    for (let j = 1; j <= cols; j++) {
      const p = S.section(s, (j / cols) * Math.PI / 2);
      if (p[1] >= y) { const t = (y - prev[1]) / Math.max(p[1] - prev[1], 1e-9); return prev[0] + (p[0] - prev[0]) * t; }
      prev = p;
    }
    return prev[0];
  };
  let lo = 0, hi = S.K.sheerMid;
  for (let it = 0; it < 32; it++) { const mid = (lo + hi) / 2; if (below(mid) > vol) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}
