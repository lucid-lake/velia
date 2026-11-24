// The species' geometry, generated from the seed: a unit-height tree (y 0 .. 1, x/z in units of the height) with
// the base at the origin. Trunk: a tapered, swept tube with the species' bark strip. Crown: tiers of branches, each
// a crossed pair of needle-cluster cards (horizontal and vertical quads bent along the branch's droop), the crown's
// radius by height from the species' silhouette (src/forest/species.js). A snag: a bare, broken trunk with stubs.
// A shrub: a low dome of leaf cards.
//
//   import { treeGeometry } from './forest/tree-gen.js';
//   const g = treeGeometry(species, { variant, seed, detail: 'full' | 'lite' });
// Attributes: position, normal (bent toward the crown's ellipsoid so the cards shade as one volume), uv (the atlas,
// src/forest/textures.js), extra = vec4(ao, branchPhase, isBark, tip)  (ao: crown ambient occlusion 0.35 .. 1;
// branchPhase 0 .. 1 per branch for the wind; isBark 1 on the trunk; tip 0 at a branch's base .. 1 at its tip).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARD_UV, BARK_UV } from './textures.js';

function lcg(seed) { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.extra = []; this.bark = []; this.idx = []; }
  vert(p, n, uv, ex, bk = [0, 0, 0, 0]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.extra.push(ex[0], ex[1], ex[2], ex[3]); this.bark.push(bk[0], bk[1], bk[2], bk[3]); return this.pos.length / 3 - 1; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('extra', new THREE.Float32BufferAttribute(this.extra, 4));
    g.setAttribute('bark', new THREE.Float32BufferAttribute(this.bark, 4));   // (tint rgb, atlas slot) on trunk vertices
    g.setIndex(this.idx);
    return g;
  }
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// the trunk: a tube of `rings` rings, swept by a gentle curve, tapered to the top; returns the centre line for the crown
function trunk(B, sp, rnd, { rings = 7, segs = 7, topY = 1, baseR, sweep = 0.02, bark, broken = false, height = 1, skirt = 0.3, apex = 0.05 }) {
  const [u0, , du] = bark;
  void u0; void du;
  const bk = [sp.bark[0], sp.bark[1], sp.bark[2], sp.barkSlot ?? 0], wraps = Math.max(1, Math.round(baseR * height * 6.28 / 2.2));   // integer wraps of a ≈ 2.2 m tile round the trunk
  const line = [];
  const sx = (rnd() - 0.5) * 2 * sweep, sz = (rnd() - 0.5) * 2 * sweep, ph = rnd() * 6.28;
  const first = B.pos.length / 3;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, y = t * topY;
    const cx = sx * Math.sin(t * 2.1 + ph) * t, cz = sz * Math.sin(t * 1.7 + ph * 0.7) * t;   // a slow S-curve, 0 at the base
    const rad = baseR * (broken ? Math.pow(1 - t * 0.6, 0.9) : Math.pow(1 - t, 0.75) + 0.006);
    line.push([cx, y, cz, rad]);
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
      // along the trunk: the crown's shadow (dark from the skirt up, lighter again near the top), baked as AO
      const crownAO = 1 - 0.45 * Math.min(1, Math.max(0, (y - skirt + 0.05) / 0.15)) * (1 - Math.min(1, Math.max(0, (y - (1 - apex - 0.15)) / 0.15)));
      B.vert([cx + nx * rad, y, cz + nz * rad], [nx, 0, nz], [(s / segs) * wraps, (y * height) / 6], [broken ? 1 : crownAO, sp.lichen ?? 0, 1, 0], bk);   // u: wraps round; v: metres / 6; the shader wraps both
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = first + r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
    B.quad(a, c, d, b);
  }
  return line;
}
const lineAt = (line, y) => {
  let k = 0; while (k < line.length - 2 && line[k + 1][1] < y) k++;
  const a = line[k], b = line[k + 1], f = Math.min(1, Math.max(0, (y - a[1]) / Math.max(1e-6, b[1] - a[1])));
  return [a[0] + (b[0] - a[0]) * f, y, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
};

// a branch: two cards crossed in an X about the branch's axis (±roll from horizontal), `segs` segments along it,
// drooping; the normals bent toward the crown's ellipsoid so the cards shade as one volume
function branch(B, { base, angle, len, droop, width, card, ao, phase, up = 0.6, segs = 2, curl = 0, roll = 0.7, tilt = 0, isBark = 0, bk = [0, 0, 0, 0] }) {
  const [u0, v0, du, dv] = card;
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const radial = norm([dx, up, dz]);
  const n = norm([radial[0] * 0.75, 0.65, radial[2] * 0.75]);        // the crown's "pillow" normal for this branch
  const sideX = -dz, sideZ = dx;                                      // across the branch, horizontal
  for (const sgn of [1, -1]) {
    const cr = Math.cos(roll * sgn), sr = Math.sin(roll * sgn);
    const ax = sideX * cr, ay = sr, az = sideZ * cr;                   // the card's across vector, rolled about the branch
    let prev = null;
    for (let s = 0; s <= segs; s++) {
      const f = s / segs, L = len * f;
      const y = base[1] - droop * len * f * f + (curl + tilt) * len * f;   // droops along its length (a parabola); tilt: this branch's own rise
      const px = base[0] + dx * L, pz = base[2] + dz * L;
      const w = width * (s === 0 ? 0.35 : 0.65 + 0.35 * Math.sin(f * Math.PI)) + 1e-4;   // narrow at the trunk, widest mid-length
      const vv = v0 + dv * (1 - f), aoF = Math.min(1, ao + (1 - ao) * f);
      const a = B.vert([px - ax * w, y - ay * w, pz - az * w], n, [u0, vv], [aoF, phase, isBark, f], bk);
      const b = B.vert([px + ax * w, y + ay * w, pz + az * w], n, [u0 + du, vv], [aoF, phase, isBark, f], bk);
      if (prev) B.quad(prev[0], prev[1], b, a);
      prev = [a, b];
    }
  }
}

export function treeGeometry(sp, { variant = 0, seed = 1, detail = 'full' } = {}) {
  const rnd = lcg(seed * 977 + variant * 131 + 17);
  const B = new Builder();
  const C = sp.crown, spi = sp.index ?? 0;
  const card = CARD_UV(spi), bark = BARK_UV(spi);
  const full = detail === 'full';
  if (C.shape === 'shrub') {
    // a low mound (manzanita, huckleberry oak): many short leaf cards arching out from the middle at every azimuth and a
    // spread of rises, the low ones long and flat (the skirt on the ground), the high ones short (the crown), dark at the
    // root (baked AO) so the mound sits in its own shade
    const n = full ? 26 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 * 1.618 + rnd() * 0.6, rise = Math.pow(rnd(), 1.3);   // 0 flat on the ground .. 1 the crown
      branch(B, { base: [0, 0.04, 0], angle: a, len: C.radius * (1 - 0.55 * rise) * (0.75 + 0.35 * rnd()), droop: 0.35, width: 0.55, card, ao: 0.28, phase: rnd(), up: 0.5, segs: 2, curl: 0, tilt: 0.25 + 0.7 * rise, roll: 0.5 + 0.7 * rnd() });
    }
    return B.geometry();
  }
  if (C.shape === 'snag') {
    const line = trunk(B, sp, rnd, { rings: 8, segs: full ? 7 : 5, topY: 0.95, baseR: sp.trunkR * 1.1, sweep: 0.03, bark, broken: true, height: 22 });
    // broken stubs: short bare branches (narrow bark-textured cards)
    const stubs = full ? 7 : 4;
    for (let k = 0; k < stubs; k++) {
      const y = 0.35 + 0.55 * rnd(), p = lineAt(line, y), a = rnd() * Math.PI * 2;
      branch(B, { base: [p[0], y, p[2]], angle: a, len: 0.04 + 0.12 * rnd(), droop: 0.3 + 0.6 * rnd(), width: 0.012, card: [0, 0, 1, 1], ao: 1, phase: rnd(), segs: 1, isBark: 1, bk: [sp.bark[0], sp.bark[1], sp.bark[2], sp.barkSlot ?? 5] });
    }
    return B.geometry();
  }
  // a conifer: the trunk to the apex, the crown from the skirt to just under the apex
  const skirt = C.skirt * (0.8 + 0.4 * rnd()), apex = C.apex;
  const line = trunk(B, sp, rnd, { rings: full ? 9 : 6, segs: full ? 8 : 6, topY: 1, baseR: sp.trunkR * (0.9 + 0.2 * rnd()), sweep: 0.015 + 0.02 * rnd(), bark, height: 28, skirt, apex });
  const tiers = Math.round(C.tiers * (full ? 1 : 0.6) * (0.9 + 0.2 * rnd()));
  const R = C.radius * (0.85 + 0.3 * rnd());
  const lean = rnd() * Math.PI * 2, leanAmt = C.open * 0.15;      // an asymmetry: one side a little fuller
  let skipped = false;
  for (let i = 0; i < tiers; i++) {
    const t = (i + 0.5) / tiers;                                    // 0 at the skirt .. 1 at the apex
    if (C.gap > 0 && rnd() < C.gap * 0.35 && i > 0 && i < tiers - 1 && !skipped) { skipped = true; continue; }   // an open crown: a tier missing now and then
    skipped = false;
    const y = skirt + (1 - skirt - apex) * t;
    let r = R * Math.pow(1 - t, C.taper) * (0.85 + 0.3 * rnd());
    if (C.shape === 'sugar') r *= 0.6 + 0.7 * Math.sin(t * Math.PI);  // the widest branches high up, a flat top
    if (C.shape === 'pine') r *= 0.75 + 0.5 * Math.sqrt(t);             // rounder at the top, open low
    r = Math.max(r, 0.012);
    const dense = C.open < 0.3 ? 1.4 : 1;
    const per = Math.max(3, Math.round((full ? 10 : 5) * dense * (0.6 + r / R) * (C.shape === 'sugar' ? 0.7 : 1)));
    const p = lineAt(line, y);
    const droop = C.droop * (0.7 + 0.6 * rnd()) + (C.shape === 'pine' ? -0.1 * t : 0);
    const ao = 0.35 + 0.25 * t;
    const seg = full ? (r > 0.08 ? 3 : 2) : 1;
    for (let k = 0; k < per; k++) {
      const a = (k / per) * Math.PI * 2 + i * 0.9 + rnd() * 0.8;
      const sideBoost = 1 + leanAmt * Math.cos(a - lean);
      const len = r * (0.75 + 0.5 * rnd()) * sideBoost;
      const width = len * (C.shape === 'pine' || C.shape === 'sugar' ? 0.42 : 0.5);
      const tilt = (rnd() - 0.4) * (C.shape === 'pine' || C.shape === 'sugar' ? 0.5 : 0.25);   // sprays rise and fall about the tier
      branch(B, { base: [p[0], y, p[2]], angle: a, len, droop, width, card, ao, phase: rnd(), segs: seg, up: 0.5 + 0.3 * t, curl: C.shape === 'cedar' ? 0.15 : 0, tilt, roll: 0.5 + 0.5 * rnd() });
    }
  }
  // the leader: a short vertical pair of cards at the apex
  const top = lineAt(line, 1 - apex - 0.02);
  branch(B, { base: [top[0], 1 - apex - 0.04, top[2]], angle: 0, len: 0.012, droop: -3.5, width: 0.03, card, ao: 1, phase: rnd(), segs: 1, up: 1, roll: 1.2 });
  return B.geometry();
}

// a fallen log: a tapered tube along +x, radius 1 at the butt, length 1 (scaled per instance)
export function logGeometry(barkUV, segs = 7) {
  const B = new Builder(), [u0, v0, du, dv] = barkUV;
  void v0; void dv;
  const rings = 4;
  const first = 0;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, x = t, rad = 1 - 0.35 * t;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, ny = Math.cos(a), nz = Math.sin(a);
      B.vert([x, ny * rad, nz * rad], [0, ny, nz], [(s / segs) * 2, t * 2], [1, 0, 1, 0], [0.22, 0.17, 0.12, 3]);   // the log's bark: a dark cedar-like slot
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = first + r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
    B.quad(a, b, d, c);
  }
  // the butt end
  const centre = B.vert([0, 0, 0], [-1, 0, 0], [0.5, 0.5], [0.7, 0, 1, 0], [0.3, 0.24, 0.17, 3]);
  for (let s = 0; s < segs; s++) B.idx.push(centre, first + s + 1, first + s);
  return B.geometry();
}

// a granite boulder: a lumpy, squashed icosphere (unit radius; the instance squashes it)
export function rockGeometry(seed = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const rnd = lcg(seed * 71 + 3), p = g.attributes.position;
  const bumps = [];
  for (let k = 0; k < 6; k++) bumps.push([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 0.15 + 0.25 * rnd()]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let s = 1;
    for (const [bx, by, bz, a] of bumps) s += a * Math.max(0, x * bx + y * by + z * bz);
    p.setXYZ(i, x * s, y * s * 0.8, z * s);
  }
  g.computeVertexNormals();
  g.setAttribute('extra', new THREE.Float32BufferAttribute(new Float32Array(p.count * 4).fill(1), 4));
  g.setAttribute('bark', new THREE.Float32BufferAttribute(new Float32Array(p.count * 4), 4));
  return mergeGeometries([g]);
}
