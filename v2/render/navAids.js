// The channel markers on the water (BACKLOG "Channel markers"; v2/sim/channelMarks.js): the
// waters' buoys as instances of a few small meshes, modelled on the private aids Lake Tahoe's channels use (round 2, owner
// 2026-11-18: "the texture and shape don't look real"): foam-filled polyethylene cans and nuns about a metre high, a small lighted
// buoy with a solar lantern, and the white regulatory buoy with orange bands, the orange circle and black lettering. Smooth lathe
// shapes (revolved profiles, normals along the profile), a plastic sheen (a soft sun highlight and the sky's Fresnel), a little
// weathering (sun-faded paint, faint vertical streaks, the waterline's olive stain and green slime under it), the white reflective
// numbers and the regulatory lettering drawn in the shader from a 5 × 7 bitmap (no texture), and the mooring chain hanging under
// the hull into the clear water. ONE pipeline ('nav-aids': lit, solid, instanced), declared at load in the boat effects' group (a
// phone builds it before play; a desktop after the first frame). A frame writes the near buoys' instances (≤ MAX_AIDS × 48 B, one
// writeBuffer from a Float32Array made at load) and draws each mesh's run (≤ AID_KINDS.length draws); with none near, nothing.
//   const NA = createNavAids({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa, depthFormat });
//   NA.begin(); NA.put(kind, x, y, z, face, tiltX, tiltZ, rgba, label, seed); NA.end()   once a frame (label: the number, 0 none)
//   NA.draw(pass, c)
// Regatta's marks ride the same pipeline (the race fixes round 2, owner 2026-11-18: "improve these props to at least the channel buoys'
// quality level"): the inflatable racing cylinder (mark 1: tall, rounded ends, welded panel seams, a
// coloured number band, the top's lifting handle, the weighted skirt and its anchor line), the inflatable tetrahedron (rounded edges
// with their welds) and the pin end's dan buoy (a round float on a weighted pole, its flag streaming and fluttering downwind). Their
// own queue (render/raceProps.js forwards its marks: NA.raceBegin(); NA.racePut(…); NA.raceEnd()), drawn with the channel's.
import { ATMO_WGSL, SKY_READ } from './sky.js';

// the shapes. The lateral buoys are the Coast Guard's foam-filled buoys seen in Emerald Bay (DVIDS
// 5760675: a big glossy smooth cylinder, wider than a man's chest, a white retroreflective strip): a 0.66 m round hull, rounded
// edges, the can flat-topped 1.0 m out of the water, the nun's cone to 1.3 m. The regulatory buoy is the slim white spar of the
// Tahoe photo and the Commons "SLOW NO WAKE" buoys: 0.30 m across, 1.05 m out, thin orange bands at the top and over the water. m, y
// up from the waterline. label: the number's band centre y, letter height, the radius there, the mode (1 a number, 2 the words)
export const AID_SPECS = Object.freeze({
  aidCan: Object.freeze({ r: 0.33, top: 1.0, draft: 0.45, band: Object.freeze([0.8, 0.88]), label: Object.freeze([0.47, 0.3, 0.33, 1]) }),
  aidNun: Object.freeze({ r: 0.33, shoulder: 0.58, top: 1.32, draft: 0.45, band: Object.freeze([0.5, 0.56]), label: Object.freeze([0.25, 0.26, 0.33, 1]) }),
  aidLit: Object.freeze({ r: 0.33, top: 1.0, draft: 0.45, lamp: 1.16, band: Object.freeze([0.8, 0.88]), label: Object.freeze([0.47, 0.3, 0.33, 1]) }),
  aidSpar: Object.freeze({ r: 0.15, top: 1.05, draft: 0.5, label: Object.freeze([0.55, 0.068, 0.15, 2]) }),
  // the race marks (the photos: Helgoland's numbered cylinders, the Laser fleet's yellow cylinder, the
  // orange tetrahedron): the cylinder 1.1 m across, 1.95 m out of the water (the night lantern's height), the band 1.05–1.45 m with
  // the number on a white disc (label mode 3); the tetrahedron 2.0 m on its base's edge, its apex at 2.25 m; the dan buoy's float
  // 0.76 m across, the pole to 3.85 m, a 1.0 × 0.7 m flag
  raceCyl: Object.freeze({ r: 0.55, top: 1.95, draft: 0.45, band: Object.freeze([1.05, 1.45]), label: Object.freeze([1.25, 0.24, 0.55, 3]) }),
  raceTetra: Object.freeze({ r: 1.55, top: 2.25, draft: 0.35, label: Object.freeze([0.0, 0.0, 0.0, 0]) }),
  danBuoy: Object.freeze({ r: 0.38, top: 3.85, draft: 0.3, flag: Object.freeze([1.0, 0.7]), label: Object.freeze([0.0, 0.0, 0.0, 0]) }),
  // the mooring ball (v2/sim/moorings.js): the 24-inch white ball (0.30 m radius) riding a third under, its centre 0.15 m
  // up, the blue band round it above the water (33 CFR 62.35, 14 CCR 7007: slot 9), the galvanised eye and shackle on top, the riser
  // chain under it into the clear water
  mooringBall: Object.freeze({ r: 0.3, top: 0.47, draft: 0.15, band: Object.freeze([0.1, 0.25]), label: Object.freeze([0.0, 0.0, 0.0, 0]) }),
});
// the race marks' first kind index and their count (the shader's weathering: new vinyl, no slime); the mooring ball after them is
// weathered as the channel's buoys
export const RACE_KIND0 = 4, RACE_KINDS = 3;
export const AID_KINDS = Object.freeze(Object.keys(AID_SPECS));
export const CULL_R = 6, CULL_DY = -0.5;   // m: the cull's sphere (render/navAids.js setView)
export const MAX_AIDS = 64;   // the channel's 10, the Boat Camp's 22 balls, a race's marks, the pin and Sail's practice marks
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128, VERTEX: 32 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const VF = 7;   // a vertex: position, normal, the slot (0 the paint, 1 white, 2 dark hardware, 3 orange, 4 the lens, 5 the chain,
// 6 the flag's cloth, 7 the anchor line, 8 the number band, 9 the mooring ball's blue band)

// ---- the meshes (local frame: x, y up, z; metres; the waterline at y 0) ----
export function buildAidMeshes() {
  const out = {};
  AID_KINDS.forEach((k) => {
    const S = AID_SPECS[k], v = [];
    const push = (p, n, slot) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], slot);
    const tri = (a, b, c, slot) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
      push(a, n, slot); push(b, n, slot); push(c, n, slot);
    };
    const quad = (a, b, c, d, slot) => { tri(a, b, c, slot); tri(a, c, d, slot); };
    const box = (cx, cy, cz, sx, sy, sz, slot) => {
      const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], slot); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], slot);
      quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], slot); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], slot);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], slot); quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], slot);
    };
    // a lathe: the profile [[r, y], …] from the bottom up, revolved in n steps, smooth normals along the profile (the slot per span)
    const lathe = (prof, n, slotOf = () => 0) => {
      const nrm = prof.map((p, i) => { const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)], dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; });
      for (let i = 1; i < prof.length; i++) {
        const [r0, y0] = prof[i - 1], [r1, y1] = prof[i], n0 = nrm[i - 1], n1 = nrm[i], slot = slotOf(i - 1, (y0 + y1) / 2);
        if (Math.abs(y1 - y0) < 1e-6 && Math.abs(r1 - r0) < 1e-6) continue;
        for (let j = 0; j < n; j++) {
          const a0 = (j / n) * 2 * Math.PI, a1 = ((j + 1) / n) * 2 * Math.PI, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
          const P = (r, y, c, s) => [r * c, y, r * s], N = (nn, c, s) => [nn[0] * c, nn[1], nn[0] * s];
          // wound so the outside faces out under the props' mapping (as the first round's cyl: bottom a0, top a0, top a1)
          push(P(r0, y0, c0, s0), N(n0, c0, s0), slot); push(P(r1, y1, c0, s0), N(n1, c0, s0), slot); push(P(r1, y1, c1, s1), N(n1, c1, s1), slot);
          push(P(r0, y0, c0, s0), N(n0, c0, s0), slot); push(P(r1, y1, c1, s1), N(n1, c1, s1), slot); push(P(r0, y0, c1, s1), N(n0, c1, s1), slot);
        }
      }
    };
    // the mooring chain: short links turned 90° from one to the next, hanging from the hull's bottom eye toward the sinker
    const chain = (y0, len) => {
      const L = 0.09, w = 0.035;
      for (let i = 0, y = y0; i < len / L; i++, y -= L * 0.82) { const sway = 0.06 * Math.sin(i * 0.35); if (i % 2) box(sway, y - L / 2, 0, w, L, 0.012, 5); else box(sway, y - L / 2, 0, 0.012, L, w, 5); }
    };
    // a smooth surface from a parametric function f(u, v) → [x, y, z] (u round, v up, both 0..1): its normals from the grid's own
    // central differences (smooth across the seams and the rounded edges; the slot per vertex from slotOf(u, v, y))
    const surf = (f, nu, nv, slotOf, closed = true) => {
      const P = [];
      for (let j = 0; j <= nv; j++) { const row = []; for (let i = 0; i <= nu; i++) row.push(f(i / nu, j / nv)); P.push(row); }
      const N = P.map((row, j) => row.map((p, i) => {
        const iu0 = closed ? (i - 1 + nu) % nu : Math.max(0, i - 1), iu1 = closed ? (i + 1) % nu : Math.min(nu, i + 1);
        const a = P[j][iu0], b = P[j][iu1], c = P[Math.max(0, j - 1)][i], e = P[Math.min(nv, j + 1)][i];
        const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dv = [e[0] - c[0], e[1] - c[1], e[2] - c[2]];
        let n = [dv[1] * du[2] - dv[2] * du[1], dv[2] * du[0] - dv[0] * du[2], dv[0] * du[1] - dv[1] * du[0]];
        let l = Math.hypot(...n);
        if (l < 1e-9) { n = [0, j > nv / 2 ? 1 : -1, 0]; l = 1; }   // a pole of the grid (the apex, the bottom's centre)
        return n.map((x) => x / l);
      }));
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const q = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]], sl = slotOf((i + 0.5) / nu, (j + 0.5) / nv, (P[j][i][1] + P[j + 1][i][1]) / 2);
        for (const t of [[0, 1, 2], [0, 2, 3]]) for (const k2 of t) { const [a, b] = q[k2]; push(P[b][a], N[b][a], sl); }
      }
    };
    // a rope: a thin tube through the points (6 sides; the slot)
    const rope = (pts, r, slot) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d0) || 1, t = d0.map((x) => x / l);
        let u = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const nx = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]], ln = Math.hypot(...nx) || 1; for (let m = 0; m < 3; m++) nx[m] /= ln;
        const ny = [t[1] * nx[2] - t[2] * nx[1], t[2] * nx[0] - t[0] * nx[2], t[0] * nx[1] - t[1] * nx[0]];
        for (let m = 0; m < 6; m++) {
          const a0 = (m / 6) * 2 * Math.PI, a1 = ((m + 1) / 6) * 2 * Math.PI;
          const o = (ang) => [nx[0] * Math.cos(ang) + ny[0] * Math.sin(ang), nx[1] * Math.cos(ang) + ny[1] * Math.sin(ang), nx[2] * Math.cos(ang) + ny[2] * Math.sin(ang)];
          const o0 = o(a0), o1 = o(a1), P0 = (c, oo) => [c[0] + oo[0] * r, c[1] + oo[1] * r, c[2] + oo[2] * r];
          push(P0(a, o0), o0, slot); push(P0(b, o0), o0, slot); push(P0(b, o1), o1, slot);
          push(P0(a, o0), o0, slot); push(P0(b, o1), o1, slot); push(P0(a, o1), o1, slot);
        }
      }
    };
    const d = -S.draft, R = S.r;
    if (k === 'raceCyl') {
      // the inflatable cylinder: four welded panels that bulge a little between their seams (the seams pinch in), a soft sag low down,
      // rounded ends (the top a dome of 0.22 m radius), the weighted skirt under the water (slot 2) and the number band (slot 8)
      const H = S.top, rr = 0.22, y0 = d + 0.1;
      const prof = (v) => {   // v 0..1 up the profile: the bottom's centre, the rounded foot, the side, the top's dome, its centre
        const a = v * 4;
        if (a < 1) { const t = a * Math.PI / 2; return [R - 0.16 + 0.16 * Math.sin(t) - (1 - Math.sin(t)) * (R - 0.16) * (1 - a), y0 - 0.16 * Math.cos(t)]; }
        if (a < 3) { const t = (a - 1) / 2; return [R, y0 + t * (H - rr - y0)]; }
        const t = (a - 3) * Math.PI / 2; return [(R - rr) + rr * Math.cos(t), H - rr + rr * Math.sin(t)];
      };
      surf((u, v) => {
        const th = u * 2 * Math.PI, [r0, y] = prof(v), side = v > 0.25 && v < 0.75 ? 1 : v <= 0.25 ? v / 0.25 : (1 - v) / 0.25;
        const sag = 1 + 0.03 * Math.exp(-(((y - 0.25) / 0.45) ** 2));                       // the soft sag low down
        const panel = 1 + 0.035 * Math.pow(Math.abs(Math.sin(2 * th)), 0.6) * side;            // the panels bulge between the seams (pinched at the welds)
        const rad = r0 * sag * panel;
        return [Math.cos(th) * rad, y, Math.sin(th) * rad];
      }, 64, 40, (u, v, y) => (y < -0.12 ? 2 : y > S.band[0] && y < S.band[1] ? 8 : 0));
      // the top's centre closed (the dome's last ring is at r ≈ 0): a small cap disc
      lathe([[R - rr, H - 0.001], [0, H]], 32, () => 0);
      // the lifting handle: a webbing loop arched over the top (slot 2)
      // the lifting handle: two webbing loops crossed over the top (slot 2)
      for (const [cx, cz] of [[1, 0], [0, 1]]) { const hp = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12, r0 = -0.2 * Math.cos(a); hp.push([r0 * cx, H - 0.01 + 0.13 * Math.sin(a), r0 * cz]); } rope(hp, 0.022, 2); }
      rope([[0, y0 - 0.16, 0], [0.05, y0 - 0.9, 0.02], [0.12, y0 - 1.8, 0.05], [0.22, y0 - 2.8, 0.08]], 0.012, 7);   // the anchor line
    } else if (k === 'raceTetra') {
      // the inflatable tetrahedron: a triangle in plan that shrinks to the apex, its corners rounded (each corner's radius shrinking up
      // the edge), the faces welded along the three edges (the seams drawn in the shader), the base's rounded edge just under the water
      const H = S.top, yb = d, R0 = R, rc0 = 0.26;
      const V = [0, 1, 2].map((m) => { const a = Math.PI / 2 + m * 2 * Math.PI / 3; return [Math.cos(a), Math.sin(a)]; });
      surf((u, v) => {
        const phi = u * 2 * Math.PI, dir = [Math.cos(phi), Math.sin(phi)];
        let best = V[0], bd = -9; for (const q of V) { const dd = q[0] * dir[0] + q[1] * dir[1]; if (dd > bd) { bd = dd; best = q; } }
        // v: 0..0.12 the base's underside and rounded edge, 0.12..1 up the faces to the apex
        if (v < 0.12) {
          const t = v / 0.12, a = t * Math.PI / 2, s0 = (R0 - rc0) * Math.min(1, t * 3), rc = rc0;
          const rx = best[0] * s0 + dir[0] * rc * Math.sin(a), rz = best[1] * s0 + dir[1] * rc * Math.sin(a);
          return [rx, yb + 0.18 - 0.18 * Math.cos(a), rz];
        }
        const t = (v - 0.12) / 0.88, y = yb + 0.18 + t * (H - yb - 0.18 - 0.06), shrink = 1 - t, rc = rc0 * (0.35 + 0.65 * shrink) * (1 - 0.0 * t);
        const s0 = (R0 - rc0) * shrink, tip = t > 0.96 ? (t - 0.96) / 0.04 : 0;
        const bulge = 0.035 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - Math.abs(bd - 0.5) * 2 * 0);   // the faces bulge with the air
        const rad = rc * (1 - tip * 0.85) + bulge * shrink;
        return [best[0] * s0 + dir[0] * rad, y + 0.06 * tip, best[1] * s0 + dir[1] * rad];
      }, 96, 28, () => 0);
      const hp = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; hp.push([-0.09 * Math.cos(a), H + 0.01 + 0.08 * Math.sin(a), 0]); }
      rope(hp, 0.014, 2);   // the apex's lifting loop
      rope([[0, yb, 0], [0.06, yb - 0.9, 0.02], [0.14, yb - 1.9, 0.05], [0.24, yb - 2.9, 0.08]], 0.012, 7);   // the anchor line
    } else if (k === 'danBuoy') {
      // the dan buoy (the pin end): a round float (slightly flattened, a dark rubbing band round its middle), the weighted pole through
      // it (the ballast weight below in the clear water), the lantern on the truck and the flag (slot 6, fluttering in the vertex shader)
      const fy = 0.08, fp = [];
      for (let i = 0; i <= 18; i++) { const a = -Math.PI / 2 + Math.PI * i / 18; fp.push([Math.cos(a) * R, fy + Math.sin(a) * R * 0.86]); }
      fp[0][0] = 0; fp[18][0] = 0;
      lathe(fp, 32, (i, y) => (Math.abs(y - fy) < 0.045 ? 2 : 0));
      lathe([[0.03, -1.45], [0.03, S.top - 0.02], [0.02, S.top], [0, S.top]], 10, () => 2);                  // the pole
      lathe([[0, -1.6], [0.085, -1.58], [0.09, -1.5], [0.09, -1.1], [0.06, -1.06], [0.03, -1.04]], 14, () => 2);   // the ballast
      lathe([[0.045, S.top - 0.1], [0.045, S.top + 0.02], [0.03, S.top + 0.05], [0, S.top + 0.06]], 10, () => 4); // the lantern
      const [fw, fh] = S.flag, fx0 = 0.035, ft = S.top - 0.14;
      for (let j = 0; j < 6; j++) for (let i = 0; i < 12; i++) {
        const P = (ii, jj) => [fx0 + fw * ii / 12, ft - fh * jj / 6, 0], n = [0, 0, 1];
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), e = P(i, j + 1);
        push(a, n, 6); push(b, n, 6); push(c, n, 6); push(a, n, 6); push(c, n, 6); push(e, n, 6);
      }
      rope([[0, -1.6, 0], [0.05, -2.3, 0.02], [0.12, -3.1, 0.05]], 0.01, 7);   // the anchor line
    } else if (k === 'mooringBall') {
      // the ball: a sphere (smooth normals) centred cy, the blue band a slot of its own; the eye on top, the riser chain below
      const cy = S.top - R - 0.02, prof = [];
      for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + Math.PI * i / 16; prof.push([Math.max(0, Math.cos(a) * R), cy + Math.sin(a) * R]); }
      prof[0][0] = 0; prof[16][0] = 0;
      lathe(prof, 28, (i, y) => (y > S.band[0] && y < S.band[1] ? 9 : 0));
      lathe([[0.05, S.top - 0.03], [0.05, S.top - 0.01], [0.035, S.top], [0, S.top]], 12, () => 2);   // the top's moulded boss
      const eye = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10; eye.push([-0.04 * Math.cos(a), S.top - 0.005 + 0.05 * Math.sin(a), 0]); }
      rope(eye, 0.009, 2);                                                                                  // the galvanised eye
      lathe([[0, cy - R - 0.08], [0.025, cy - R - 0.075], [0.025, cy - R + 0.01], [0, cy - R + 0.015]], 10, () => 2);   // the bottom's through-rod
      chain(cy - R - 0.08, 2.4);
    } else if (k === 'aidSpar') {
      // the regulatory spar: a plain white tube, the thin orange bands (slot 3) at the top and just over the water, a rounded foot
      // and the ballast tail below, the lifting eye on the flat top
      const B = (y) => (y > S.top - 0.07 || (y > 0.06 && y < 0.13) ? 3 : 0);
      lathe([[0.05, d - 0.3], [0.06, d], [R * 0.85, d + 0.02], [R, d + 0.08], [R, 0.06], [R, 0.13], [R, S.top - 0.07], [R, S.top - 0.012], [R * 0.9, S.top], [0, S.top]], 22, (i, y) => B(y));
      box(0, S.top + 0.035, 0, 0.012, 0.07, 0.05, 2);
      chain(d - 0.3, 2.3);
    } else {
      // the foam buoy: a smooth round hull with rounded edges, the white retroreflective strip (slot 1), the can's flat top, the
      // nun's cone, the lighted buoy's lantern on the can's top
      const [b0, b1] = S.band, body = [[0, d], [R * 0.82, d], [R * 0.96, d + 0.04], [R, d + 0.12], [R, b0], [R, b1]];
      const top = k === 'aidNun' ? [[R, S.shoulder - 0.03], [R * 0.95, S.shoulder + 0.02], [0.05, S.top - 0.02], [0, S.top]] : [[R, S.top - 0.06], [R * 0.95, S.top - 0.012], [R * 0.82, S.top], [0, S.top]];
      lathe([...body, ...top], 28, (i, y) => (y > b0 && y < b1 ? 1 : 0));
      if (k === 'aidLit') {   // the solar LED lantern on the top: the base and its panel, the tinted lens, the cap
        lathe([[0.1, S.top], [0.1, S.top + 0.05], [0.06, S.top + 0.055], [0, S.top + 0.055]], 14, () => 2);
        lathe([[0.055, S.top + 0.05], [0.058, S.lamp], [0.045, S.lamp + 0.03], [0, S.lamp + 0.035]], 14, () => 4);
        lathe([[0.065, S.lamp + 0.02], [0.065, S.lamp + 0.045], [0, S.lamp + 0.05]], 14, () => 2);
      } else if (k === 'aidCan') box(0, S.top + 0.04, 0, 0.22, 0.03, 0.03, 2);   // the lifting bail
      else box(0, S.top + 0.03, 0, 0.02, 0.06, 0.02, 2);
      chain(d, 2.6);
    }
    out[k] = new Float32Array(v);
  });
  return out;
}

// 5 × 7 glyphs, a row of 5 bits each (bit 4 the left column), top row first: rows 0–3 in A, rows 4–6 in B
const GLYPHS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};
export const GLYPH_ORDER = Object.freeze(Object.keys(GLYPHS));
const glyphWords = () => {
  const A = [], B = [];
  for (const k of GLYPH_ORDER) { const r = GLYPHS[k].map((s) => parseInt(s, 2)); A.push((r[0] << 15) | (r[1] << 10) | (r[2] << 5) | r[3]); B.push((r[4] << 10) | (r[5] << 5) | r[6]); }
  return { A, B };
};

const NAV_AIDS_WGSL = (fs) => {
  const { A, B } = glyphWords(), L = AID_KINDS.map((k) => AID_SPECS[k].label), gi = (c) => GLYPH_ORDER.indexOf(c);
  const C = AID_SPECS.raceCyl, f4 = (x) => x.toFixed(4);
  const RACE_K = RACE_KIND0, SPEC_CYL_TOP = f4(C.top), SPEC_BAND0 = f4(C.band[0]), SPEC_BAND1 = f4(C.band[1]), SPEC_CYL_R = f4(C.r), SPEC_LABEL_Y = f4(C.label[0]);
  return `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
@group(2) @binding(0) var<storage, read> I: array<vec4f>;   // per instance: (x, y, z, face yaw), (tilt x, tilt z, label, seed), (rgba8 bits, kind, 0, 0)
var<private> GA: array<u32, ${A.length}> = array<u32, ${A.length}>(${A.map((x) => `${x}u`).join(', ')});
var<private> GB: array<u32, ${B.length}> = array<u32, ${B.length}>(${B.map((x) => `${x}u`).join(', ')});
// per kind: the label's band centre y, letter height, the hull's radius there, the mode (1 a number, 2 the regulatory words)
var<private> KT: array<vec4f, ${L.length}> = array<vec4f, ${L.length}>(${L.map((l) => `vec4f(${l.map((x) => x.toFixed(4)).join(', ')})`).join(', ')});
struct PV { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) lp: vec3f, @location(2) w: vec3f, @location(3) @interpolate(flat) col: vec3f,
  @location(4) @interpolate(flat) slot: f32, @location(5) @interpolate(flat) minfo: vec3f }
fn unpackCol(u: u32) -> vec3f { return vec3f(f32(u & 255u), f32((u >> 8u) & 255u), f32((u >> 16u) & 255u)) / 255.0; }
@vertex fn vs(@location(0) p0: vec3f, @location(1) n0: vec3f, @location(2) slot: f32, @builtin(instance_index) ii: u32) -> PV {
  var o: PV;
  let a = I[3u * ii]; let b = I[3u * ii + 1u]; let c = I[3u * ii + 2u];
  // the face: the yaw (the props' mapping, render/raceProps.js), steady so the numbers face the channel; then the tilt, the up axis
  // leaned toward (b.x, b.z) by its length (rad: the sea's slope and the swing; Rodrigues about the horizontal axis across it). The
  // chain hangs plumb: no tilt
  let cy = cos(a.w); let sy = sin(a.w);
  var p = vec3f(p0.x * cy + p0.z * sy, p0.y, p0.x * sy - p0.z * cy); var n = vec3f(n0.x * cy + n0.z * sy, n0.y, n0.x * sy - n0.z * cy);
  // the dan buoy's flag (slot 6): it streams downwind (the face yaw is the wind's) and flutters, the wave running from the pole to the
  // fly, growing toward the fly (F.cam.w: the sim time; the seed sets the phase)
  if (slot > 5.5 && slot < 6.5) {
    let fx = max(p0.x - 0.035, 0.0); let ph = F.cam.w * 7.0 + b.w * 6.28;
    let wv = sin(fx * 5.0 - ph) * (0.05 + 0.24 * fx) + 0.07 * sin(fx * 10.0 - ph * 1.7 + p0.y * 3.0) * fx;
    p = vec3f(p.x, p.y - 0.12 * fx * fx * (0.6 + 0.4 * sin(ph * 0.3)), p.z) + vec3f(-sy, 0.0, cy) * wv;   // the fly droops and flogs
    n = normalize(vec3f(n.x, n.y, n.z) + vec3f(cy, 0.0, sy) * cos(fx * 5.5 - ph) * (0.22 + 0.8 * fx));
  }
  let th = length(b.xy);
  if (th > 1e-5 && (slot < 4.5 || (slot > 5.5 && slot < 6.5) || slot > 7.5)) {
    let k = vec3f(b.y, 0.0, -b.x) / th; let ct = cos(th); let st = sin(th);
    p = p * ct + cross(k, p) * st + k * dot(k, p) * (1.0 - ct); n = n * ct + cross(k, n) * st + k * dot(k, n) * (1.0 - ct);
  }
  let w = p + a.xyz;
  o.n = n;
  o.pos = F.viewProj * vec4f(w, 1.0);
  o.lp = p0; o.w = w; o.slot = slot; o.col = unpackCol(bitcast<u32>(c.x)); o.minfo = vec3f(b.z, b.w, c.y);
  return o;
}
fn hash(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn vnoise(x: f32) -> f32 { let i = floor(x); let f = fract(x); let u = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), u); }
// a glyph's bit at (col 0–4, row 0–6 from the top)
fn bit(g: u32, col: i32, row: i32) -> bool {
  if (col < 0 || col > 4 || row < 0 || row > 6) { return false; }
  var word = GA[g]; var r = row; var rows = 4;
  if (row > 3) { word = GB[g]; r = row - 4; rows = 3; }
  let shift = u32((rows - 1 - r) * 5 + (4 - col));
  return ((word >> shift) & 1u) == 1u;
}
// the text line (glyph indices, up to 4) centred at (0, 0) in letter units: u across (a letter is 6 wide with its gap), v up (7 tall)
fn textAt(u: f32, v: f32, g: vec4i, n: i32) -> bool {
  let x = u + f32(n) * 3.0 - 0.5; let row = i32(floor(3.5 - v)); let k = i32(floor(x / 6.0)); let col = i32(floor(x - f32(k) * 6.0));
  if (x < 0.0 || k >= n || row < 0 || row > 6) { return false; }
  return bit(u32(g[k]), col, row);
}
@fragment fn fs(v: PV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(v.n);
  let V0 = normalize(F.cam.xyz - v.w);
  if (v.slot > 5.5 && v.slot < 6.5) { if (dot(n, V0) < 0.0) { n = -n; } }   // the flag's cloth: lit on the side seen
  else if (dot(n, V0) < 0.0 && (v.slot < 4.5 || v.slot > 7.5)) { n = n - V0 * (1.2 * dot(n, V0)); n = normalize(n); }   // a smooth normal turned past the silhouette, back toward the eye
  let label = i32(v.minfo.x + 0.5); let seed = v.minfo.y; let kind = i32(v.minfo.z + 0.5);
  let lp = v.lp; let ang = atan2(lp.z, lp.x); let rad = length(lp.xz);
  var col = v.col; var rough = 0.55; var spec = 0.35; var emit = vec3f(0.0);
  if (v.slot < 0.5) {   // the paint: glossy moulded colour, a touch sun-faded by the seed
    col = mix(col, col * 0.8 + vec3f(0.06, 0.05, 0.045), 0.1 + 0.2 * seed); rough = 0.28; spec = 0.75;
  } else if (v.slot < 1.5) { col = vec3f(0.86, 0.86, 0.83); }
  else if (v.slot < 2.5) { col = vec3f(0.12, 0.12, 0.13); rough = 0.4; spec = 0.5; }
  else if (v.slot < 3.5) { col = vec3f(0.88, 0.2, 0.04) * (0.92 + 0.08 * seed); }
  else if (v.slot < 4.5) { col = mix(v.col, vec3f(0.9), 0.35) * 0.55; rough = 0.15; spec = 1.2; }   // the lantern's tinted lens
  else if (v.slot < 5.5) { col = vec3f(0.11, 0.085, 0.07); rough = 0.7; spec = 0.15; }              // the galvanised chain, rusted
  else if (v.slot < 6.5) { col = vec3f(0.86, 0.13, 0.012); rough = 0.8; spec = 0.05; }                // the dan buoy's flag (orange, the pin end's; linear)
  else if (v.slot < 7.5) { col = vec3f(0.78, 0.76, 0.68); rough = 0.75; spec = 0.1; }                 // the anchor line (braided, off-white)
  else if (v.slot > 8.5) { col = vec3f(0.012, 0.075, 0.33) * (0.92 + 0.08 * seed); rough = 0.3; spec = 0.7; }   // the mooring ball's blue band (linear; a marine blue)
  else {   // the number band: green for a mark left to port, red to starboard (label ≥ 100), the white disc and its number on two faces
    col = select(vec3f(0.004, 0.16, 0.035), vec3f(0.5, 0.01, 0.008), label >= 100); rough = 0.3; spec = 0.7;   // linear
  }
  let race = kind >= ${RACE_K} && kind < ${RACE_K + RACE_KINDS};
  if (race && v.slot < 0.5) { col = pow(v.col, vec3f(2.2)); rough = 0.22; spec = 0.95; }   // new vinyl: glossy, unfaded (its sRGB colour made linear: the vivid yellow and orange of the photos)
  if (race && (v.slot < 0.5 || v.slot > 7.5)) {
    // the welds: the cylinder's four panel seams (meridians) and its end welds, the tetrahedron's three edge seams; a narrow darker
    // line with a sheen along it
    var seam = 0.0;
    if (kind == ${RACE_K}) {
      let a4 = abs(fract(ang / 1.5707963 + 0.5) - 0.5) * 1.5707963 * rad;   // metres from the nearest seam round the side
      seam = (1.0 - smoothstep(0.004, 0.012, a4)) * step(0.05, lp.y) * step(lp.y, ${SPEC_CYL_TOP} - 0.08);
      seam = max(seam, 1.0 - smoothstep(0.004, 0.012, abs(lp.y - (${SPEC_CYL_TOP} - 0.21))));
      seam = max(seam, (1.0 - smoothstep(0.004, 0.012, abs(lp.y - ${SPEC_BAND0}))) + (1.0 - smoothstep(0.004, 0.012, abs(lp.y - ${SPEC_BAND1}))));
    } else if (kind == ${RACE_K} + 1) {
      let a3 = abs(fract((ang - 1.5707963) / 2.0943951 + 0.5) - 0.5) * 2.0943951 * max(rad, 0.05);   // metres from the nearest edge's seam
      seam = (1.0 - smoothstep(0.006, 0.016, a3)) * step(-0.1, lp.y);
      seam = max(seam, (1.0 - smoothstep(0.006, 0.016, abs(lp.y + 0.17))));
    }
    col = mix(col, col * 0.62, clamp(seam, 0.0, 1.0)); spec = spec + 0.4 * clamp(seam, 0.0, 1.0);
    if (kind == ${RACE_K} && v.slot > 7.5) {
      // a white disc in the middle of each of the four panels and the mark's number in black on it (seen from every side)
      let pa = (fract((ang - 0.7853982) / 1.5707963 + 0.5) - 0.5) * 1.5707963; let arc = pa * ${SPEC_CYL_R}; let dy = lp.y - ${SPEC_LABEL_Y};
      if (length(vec2f(arc, dy)) < 0.17) {
        col = vec3f(0.82, 0.82, 0.79);
        let h = 0.2; let u = arc / (h / 7.0); let vv = dy / (h / 7.0); let num = label % 100;
        var g = vec4i(0); var nn = 1;
        if (num >= 10) { g = vec4i(num / 10, num % 10, 0, 0); nn = 2; } else { g = vec4i(num, 0, 0, 0); }
        if (num > 0 && (textAt(u, vv, g, nn) || textAt(u + 0.4, vv, g, nn))) { col = vec3f(0.03, 0.03, 0.035); }
      }
    }
  }
  if (race) {
    // new vinyl: a wet, darker sheen at the waterline and a faint film under it (no slime)
    let wet = (1.0 - smoothstep(0.0, 0.12, lp.y)) * smoothstep(-0.03, 0.01, lp.y);
    col = col * (1.0 - 0.18 * wet); rough = mix(rough, 0.1, wet); spec = spec + 0.5 * wet;
    if (lp.y < -0.03 && v.slot < 6.5) { col = mix(col, vec3f(0.12, 0.16, 0.12), 0.25) * mix(0.75, 0.4, (1.0 - smoothstep(-0.6, -0.03, lp.y))); spec = 0.2; }
  } else if ((v.slot < 3.5 && v.slot != 2.0) || v.slot > 8.5) {
    // the label on the two faces (toward local ±z): white reflective numbers, or the regulatory buoy's circle and words
    let K = KT[kind]; let face = sign(lp.z + 1e-4); let phi = atan2(lp.x, abs(lp.z)); let arc = phi * K.z; let dy = lp.y - K.x;
    if (rad > K.z * 0.9 && abs(phi) < 1.2) {
      if (K.w < 1.5 && label > 0) {
        let h = K.y; let u = -arc / (h / 7.0) * face; let vv = dy / (h / 7.0);
        var g = vec4i(0); var nn = 1;
        if (label >= 10) { g = vec4i(label / 10, label % 10, 0, 0); nn = 2; } else { g = vec4i(label, 0, 0, 0); }
        // a stroke a little wider than the cell (the decal's bold face), the white of reflective film
        if (textAt(u, vv, g, nn) || textAt(u + 0.35, vv, g, nn)) { col = vec3f(0.9, 0.9, 0.86); rough = 0.35; spec = 0.6; }
      } else if (K.w > 1.5) {
        // the regulatory legend (the Commons and Tahoe photos): SLOW over a big orange circle with NO inside it, WAKE under it, in bold black
        let h = K.y; let u = -arc / (h / 7.0) * face; let cr = length(vec2f(arc, dy));
        if (cr > 0.074 && cr < 0.11) { col = vec3f(0.86, 0.16, 0.04); }
        let w1 = vec4i(${gi('S')}, ${gi('L')}, ${gi('O')}, ${gi('W')}); let w2 = vec4i(${gi('N')}, ${gi('O')}, 0, 0); let w3 = vec4i(${gi('W')}, ${gi('A')}, ${gi('K')}, ${gi('E')});
        if (textAt(u, (dy - 0.165) / (h / 7.0), w1, 4) || textAt(u + 0.6, (dy - 0.165) / (h / 7.0), w1, 4) || textAt(u, dy / (h / 7.0), w2, 2) || textAt(u + 0.6, dy / (h / 7.0), w2, 2)
          || textAt(u, (dy + 0.165) / (h / 7.0), w3, 4) || textAt(u + 0.6, (dy + 0.165) / (h / 7.0), w3, 4)) { col = vec3f(0.03, 0.03, 0.035); }
      }
    }
    // weathering: faint vertical streaks (rain and bird lime), the waterline's olive stain, green slime under the water
    let streak = vnoise(ang * 9.0 + seed * 31.0) * vnoise(lp.y * 2.5 + ang * 3.0 + seed * 7.0);
    col *= 1.0 - 0.07 * streak;
    let wl = (1.0 - smoothstep(0.0, 0.09, lp.y)) * smoothstep(-0.04, 0.02, lp.y);
    col = mix(col, vec3f(0.24, 0.24, 0.15) * (0.7 + 0.3 * vnoise(ang * 14.0 + seed)), 0.55 * wl);
    if (lp.y < -0.03) { col = mix(col, vec3f(0.05, 0.1, 0.08), 0.6) * mix(0.55, 0.2, (1.0 - smoothstep(-0.45, -0.03, lp.y))); rough = 0.8; spec = 0.0; }   // under the water: slimed, darker with depth
  }
  if (race && v.slot < 0.5) {
    // the vinyl's soft creases: shallow folds near the welds and a few low down where the skin sags (a ripple of the normal round
    // the side, fading away from them)
    let t = vec3f(-sin(ang), 0.0, cos(ang));
    let nearSeam = select(abs(fract(ang / 1.5707963 + 0.5) - 0.5) * 1.5707963 * rad, abs(fract((ang - 1.5707963) / 2.0943951 + 0.5) - 0.5) * 2.0943951 * max(rad, 0.05), kind != ${RACE_K});
    let fold = exp(-nearSeam * 9.0) * 0.6 + (1.0 - smoothstep(0.0, 0.7, lp.y)) * 0.35;
    let rip = sin(lp.y * 23.0 + vnoise(ang * 6.0 + seed * 9.0) * 6.0) * vnoise(ang * 11.0 + lp.y * 2.0 + seed * 3.0);
    n = normalize(n + t * rip * 0.16 * fold);
  }
  // the light: the sky and the sun, a soft Blinn highlight (the plastic's sheen) and the sky's Fresnel on the grazing side
  let L = normalize(F.sun.xyz); let V = normalize(F.cam.xyz - v.w); let H = normalize(L + V);
  var nl = max(dot(n, L), 0.0); let nv = max(dot(n, V), 0.0);
  if (v.slot > 5.5 && v.slot < 6.5) { nl = nl + 0.7 * max(-dot(n, L), 0.0); }   // the flag lets the sun through
  if (race && v.slot < 5.5) { nl = max((dot(n, L) + 0.3) / 1.3, 0.0); }   // the vinyl's shade side keeps a soft wrap of the sun (the lake's bounce; the photos' shade faces stay coloured)
  let shin = mix(8.0, 90.0, 1.0 - rough);
  let hl = pow(max(dot(n, H), 0.0), shin) * spec * nl;
  let fres = 0.05 + 0.6 * pow(1.0 - nv, 4.0);
  let diffuse = LIGHT.sky.rgb * (0.8 + 0.3 * n.y) + LIGHT.sun.rgb * nl;   // the sky and the bright lake's bounce on the sides (a buoy's shade side reads its colour)
  let rgb = col * diffuse / PI + LIGHT.sun.rgb * hl * select(0.15, 0.4, race) + LIGHT.sky.rgb * (fres + 0.03 * max(n.y, 0.0)) * spec * 0.25 + emit;
  return vec4f(rgb, 1.0);
}`;
};

export function createNavAids({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa = 1, depthFormat = 'depth32float' }) {
  const meshes = buildAidMeshes();
  const runs = {}; let total = 0;
  for (const k of AID_KINDS) { runs[k] = { first: total, count: meshes[k].length / VF }; total += meshes[k].length / VF; }
  const all = new Float32Array(total * VF); for (const k of AID_KINDS) all.set(meshes[k], runs[k].first * VF);
  const vbuf = device.createBuffer({ label: 'nav-aids-mesh', size: all.byteLength, usage: BUF.VERTEX | BUF.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, all);
  const inst = new Float32Array(MAX_AIDS * 12), instU = new Uint32Array(inst.buffer);
  const ibuf = device.createBuffer({ label: 'nav-aids', size: inst.byteLength, usage: BUF.STORAGE | BUF.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'nav-aids', entries: [{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'read-only-storage' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ibuf } }] });
  const m = reg.shader('nav-aids', NAV_AIDS_WGSL(frameStruct));
  reg.add('nav-aids', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }),
    vertex: { module: m, entryPoint: 'vs', buffers: [{ arrayStride: VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] }] },
    fragment: { module: m, entryPoint: 'fs', targets: [hdrTarget] }, primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const byKind = Object.fromEntries(AID_KINDS.map((k) => [k, { first: 0, n: 0 }]));
  // two queues, made once: the channel's (begin/put/end, main.js) and the race's (raceBegin/racePut/raceEnd, render/raceProps.js);
  // either end uploads both, grouped by kind
  const mkQ = () => ({ q: new Float32Array(MAX_AIDS * 8), kind: new Uint8Array(MAX_AIDS), col: new Uint32Array(MAX_AIDS), n: 0 });
  const QC = mkQ(), QR = mkQ(), QQ = [QC, QR];
  const stats = { instances: 0, race: 0, culled: 0, draws: 0, uploads: 0, vertices: total, triangles: total / 3, meshBytes: all.byteLength, instBytes: inst.byteLength };
  const putQ = (Q, kind, x, y, z, face, tx, tz, rgba, label, seed) => {
    const k = AID_KINDS.indexOf(kind); if (Q.n >= MAX_AIDS || k < 0) return false;
    const o = Q.n * 8; Q.q[o] = x; Q.q[o + 1] = y; Q.q[o + 2] = z; Q.q[o + 3] = face; Q.q[o + 4] = tx; Q.q[o + 5] = tz; Q.q[o + 6] = label; Q.q[o + 7] = seed;
    Q.kind[Q.n] = k; Q.col[Q.n] = rgba >>> 0; Q.n++; return true;
  };
  // perf(v2) phone Regatta: the camera's side planes (setView, once a frame before the queues end); a buoy whose bounding sphere
  // (CULL_R round a point CULL_DY under its waterline: the tallest race mark and the dan buoy's flag above, the chains below) is
  // wholly outside one is not uploaded (it draws no pixel); no view yet (a test, the first frame), every buoy
  const planes = new Float32Array(16); let culling = false;
  const outside = (x, y, z) => {
    const cy = y + CULL_DY;
    for (let k = 0; k < 16; k += 4) if (planes[k] * x + planes[k + 1] * cy + planes[k + 2] * z + planes[k + 3] < -CULL_R * Math.hypot(planes[k], planes[k + 1], planes[k + 2])) return true;
    return false;
  };
  function upload() {
    let w = 0; stats.culled = 0;
    for (let k = 0; k < AID_KINDS.length; k++) {
      const r = byKind[AID_KINDS[k]]; r.first = w; r.n = 0;
      for (const Q of QQ) for (let i = 0; i < Q.n && w < MAX_AIDS; i++) if (Q.kind[i] === k) {
        const s0 = i * 8, o = w * 12;
        if (culling && outside(Q.q[s0], Q.q[s0 + 1], Q.q[s0 + 2])) { stats.culled++; continue; }
        for (let j = 0; j < 8; j++) inst[o + j] = Q.q[s0 + j];
        instU[o + 8] = Q.col[i]; inst[o + 9] = k; inst[o + 10] = 0; inst[o + 11] = 0;
        w++; r.n++;
      }
    }
    if (w) { device.queue.writeBuffer(ibuf, 0, inst.buffer, 0, w * 48); stats.uploads++; }
    stats.instances = w; stats.race = QR.n;
  }
  return {
    stats, meshes, runs,
    // the frame's view-projection (column-major): the left, right, bottom and top planes (Gribb-Hartmann; near and far not tested)
    setView(vp) {
      for (let r = 0; r < 2; r++) for (let sg = 0; sg < 2; sg++) { const o = (r * 2 + sg) * 4, f = sg ? -1 : 1; for (let j = 0; j < 4; j++) planes[o + j] = vp[j * 4 + 3] + f * vp[j * 4 + r]; }
      culling = true;
    },
    begin() { QC.n = 0; },
    // face: the steady yaw; tx, tz: the tilt (rad, toward the side that goes down: markPose's heel along its yaw)
    put(kind, x, y, z, face = 0, tx = 0, tz = 0, rgba = 0xffffffff, label = 0, seed = 0) { return putQ(QC, kind, x, y, z, face, tx, tz, rgba, label, seed); },
    end() { upload(); },
    // the race's marks (render/raceProps.js forwards them): the same arguments; label: the mark's number (+ 100 for a mark left to
    // starboard: the band red), the face: the flag's downwind yaw for the dan buoy
    raceBegin() { QR.n = 0; },
    racePut(kind, x, y, z, face = 0, tx = 0, tz = 0, rgba = 0xffffffff, label = 0, seed = 0) { return putQ(QR, kind, x, y, z, face, tx, tz, rgba, label, seed); },
    raceEnd() { upload(); },
    raceClear() { if (QR.n) { QR.n = 0; upload(); } },
    draw(pass, c) {
      if (!stats.instances) return;   // none near: nothing recorded
      pass.setPipeline(reg.get('nav-aids'));
      pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setVertexBuffer(0, vbuf);
      for (const k of AID_KINDS) { const r = byKind[k]; if (!r.n) continue; pass.draw(runs[k].count, r.n, runs[k].first, r.first); c.calls++; c.triangles += (runs[k].count / 3) * r.n; }
      stats.draws++;
    },
  };
}
