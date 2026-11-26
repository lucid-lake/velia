// South Lake's small power craft (v2/living/powerTraffic.js), all by code: a generic 6.6 m bowrider runabout and a 3.2 m sit-down jet
// ski, each with its seated figure. Pure: plain arrays, no GPU (the tests and render/smallCraft.js build them once). Two LODs each in
// one vertex set (near: the lofted hull with its sheer, deadrise and chines, the windscreen, the console, the seats, the outboard or the
// jet's hood, the figure; far: a few dozen triangles of hull, deck block and figure), each LOD drawn in one call for every craft of
// its kind (instanced). No names, no lettering, no liveries: the hull's colour and its one stripe are the instance's (the region row's
// hull and stripe). The figures' slots (>= SLOT.rider) duck in the vertex shader when Tessie splashes them (nobody goes in the water).
// Frame (every boat's): x starboard, y up from her waterline, z aft (the bow at −z), metres. A vertex: position (3), normal (3), the
// material slot (1) (the glass boat's layout: render/tourBoatMesh.js VF).
import { builder, VF } from './tourBoatMesh.js';
import { POWER } from '../living/powerTraffic.js';

export { VF };
export const SLOT = Object.freeze({ hull: 0, deck: 1, glass: 2, seat: 3, seatDark: 4, dark: 5, metal: 6, rider: 10, skin: 11, vest: 12, hair: 13, trunks: 14 });
export const LOD_M = Object.freeze({ power: 300, jetski: 200, hyst: 0.08 });       // m: the near LOD within these
export const DRAW_M = Object.freeze({ full: Object.freeze({ power: 4000, jetski: 2500 }), lite: Object.freeze({ power: 2000, jetski: 1200 }) });
export const KINDS = Object.freeze(['power', 'jetski']);

// a hull's shape: length L, beam B, its sheer, keel and chine along it (u 0 at the stem, 1 at the transom)
export const HULLS = Object.freeze({
  power: Object.freeze({ L: POWER.power.length, B: POWER.power.beam, sheer: 0.86, sheerBow: 0.28, keel: -0.34, forefoot: 0.5, deadrise: 0.3, chine: 0.9, entry: 0.36, stripe: Object.freeze([0.42, 0.6]) }),
  jetski: Object.freeze({ L: POWER.jetski.length, B: POWER.jetski.beam, sheer: 0.5, sheerBow: 0.12, keel: -0.2, forefoot: 0.3, deadrise: 0.16, chine: 0.86, entry: 0.4, stripe: Object.freeze([0.3, 0.42]) }),
});
export function hullAt(H, u) {
  u = Math.max(0, Math.min(1, u));
  const hb = H.B / 2 * (u < H.entry ? Math.sin((u / H.entry) * Math.PI / 2) ** 0.7 : 1 - 0.05 * ((u - H.entry) / (1 - H.entry)));
  const ys = H.sheer + (u < 0.45 ? H.sheerBow * (1 - u / 0.45) ** 2 : -0.04 * (u - 0.45));
  const yk = H.keel + (u < 0.3 ? H.forefoot * (1 - u / 0.3) ** 2 : 0);
  return { hb, ys, yk, yc: yk + H.deadrise * (hb / (H.B / 2)), xc: hb * H.chine };
}

function hull(B, H, n) {
  const zAt = (u) => -H.L / 2 + u * H.L;
  // the sides as one open sheet per station pair: port sheer, port chine, keel, starboard chine, starboard sheer (smooth across
  // the chine's run, sharp at the sheer where the deck meets it)
  const ring = (u) => { const s = hullAt(H, u), z = zAt(u); return [[-s.hb, s.ys, z], [-s.xc, s.yc, z], [0, s.yk, z], [s.xc, s.yc, z], [s.hb, s.ys, z]]; };
  const rows = []; for (let i = 0; i <= n; i++) rows.push(ring((i / n) ** 1.15));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const R = rows.length, N = 5;
  const nrm = (i, j) => B.norm(cross(sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]), sub(rows[i][Math.min(N - 1, j + 1)], rows[i][Math.max(0, j - 1)])));
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) B.squad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), SLOT.hull);
  // the deck (flat between the sheers, a little crown) and the transom
  for (let i = 0; i < R - 1; i++) { const a = rows[i], b = rows[i + 1]; B.quad(a[4], a[0], b[0], b[4], SLOT.deck); }
  const t = rows[R - 1]; B.quad(t[0], t[1], t[3], t[4], SLOT.hull); B.tri(t[1], t[2], t[3], SLOT.hull);
}

// a seated figure: hips at (x, y, z) facing the bow; lean (rad forward); vest: a buoyancy aid (the jet ski's rider); hands to (hx, hy, hz)
function figure(B, { x, y, z, lean = 0.15, vest = false, hands = null, near = true }) {
  const seg = near ? 8 : 4, up = [0, Math.cos(lean), -Math.sin(lean)];
  const P = (h) => [x + up[0] * h, y + up[1] * h, z + up[2] * h];
  const torso = vest ? SLOT.vest : SLOT.rider;
  // the thighs forward along the seat, the shins down
  for (const sx of [-0.11, 0.11]) { B.cyl([x + sx, y + 0.06, z], [x + sx, y + 0.08, z - 0.42], 0.075, seg, SLOT.trunks); B.cyl([x + sx, y + 0.08, z - 0.42], [x + sx, y - 0.32, z - 0.5], 0.06, seg, SLOT.skin); }
  B.cyl(P(0.02), P(0.5), 0.17, seg, torso, { cap: true, r1: 0.19 });
  B.cyl(P(0.5), P(0.6), 0.07, seg, SLOT.skin);
  B.ball(P(0.72), 0.115, SLOT.skin, near ? 8 : 4);
  B.ball([P(0.75)[0], P(0.75)[1] + 0.03, P(0.75)[2] + 0.01], 0.118, SLOT.hair, near ? 6 : 3);   // hair (a cap's crown)
  const sh = P(0.46);
  for (const sx of [-1, 1]) {
    const s0 = [sh[0] + sx * 0.2, sh[1], sh[2]], h = hands ? [hands[0] + sx * hands[3], hands[1], hands[2]] : [s0[0], s0[1] - 0.25, s0[2] - 0.3];
    const el = [(s0[0] + h[0]) / 2 + sx * 0.06, (s0[1] + h[1]) / 2 - 0.08, (s0[2] + h[2]) / 2 + 0.05];
    B.cyl(s0, el, 0.05, seg, vest ? SLOT.skin : SLOT.rider); B.cyl(el, h, 0.045, seg, SLOT.skin);
  }
}

export function buildCraft(kind, { lod = 'near' } = {}) {
  const B = builder(), H = HULLS[kind], near = lod === 'near';
  if (kind === 'power') {
    hull(B, H, near ? 22 : 5);
    const s = hullAt(H, 0.42), y0 = s.ys;
    if (near) {
      // the windscreen: two raked panes either side of the walk-through, framed; the console behind it on the starboard side
      for (const sx of [-1, 1]) {
        const x0 = sx * 0.12, x1 = sx * (s.hb - 0.08), zf = -0.75, zb = -0.48, yb = y0 + 0.02, yt = y0 + 0.36;
        B.quad([x0, yb, zf], [x1, yb, zf + 0.05], [x1, yt, zb + 0.05], [x0, yt, zb], SLOT.glass);
        B.cyl([x0, yt, zb], [x1, yt, zb + 0.05], 0.018, 4, SLOT.metal);
      }
      B.box(0.25, y0, -0.45, 0.95, y0 + 0.38, -0.05, SLOT.hull);
      B.box(0.55, y0 + 0.38, -0.32, 0.62, y0 + 0.45, -0.25, SLOT.dark);   // the wheel's hub
      // the seats: the helm and the companion's bucket seats, the stern bench across, the bow's cushions
      for (const sx of [-0.6, 0.6]) { B.box(sx - 0.26, y0, 0.25, sx + 0.26, y0 + 0.36, 0.75, SLOT.seat); B.box(sx - 0.26, y0 + 0.36, 0.68, sx + 0.26, y0 + 0.82, 0.8, SLOT.seat); }
      B.box(-1.05, y0, 2.15, 1.05, y0 + 0.34, 2.75, SLOT.seat); B.box(-1.05, y0 + 0.34, 2.68, 1.05, y0 + 0.7, 2.85, SLOT.seat);
      const sb = hullAt(H, 0.2); B.box(-sb.hb * 0.7, sb.ys, -2.2, sb.hb * 0.7, sb.ys + 0.14, -1.35, SLOT.seat);
      // the outboard on the transom: cowling, the leg into the water
      B.box(-0.28, y0 + 0.05, H.L / 2 + 0.02, 0.28, y0 + 0.82, H.L / 2 + 0.66, SLOT.dark);
      B.box(-0.1, -0.5, H.L / 2 + 0.2, 0.1, y0 + 0.05, H.L / 2 + 0.42, SLOT.dark);
      // the skipper at the helm, hands on the wheel
      figure(B, { x: 0.6, y: y0 + 0.36, z: 0.5, lean: 0.1, hands: [0.6, y0 + 0.5, -0.22, 0.13], near: true });
    } else {
      B.box(-0.9, y0, -0.6, 0.9, y0 + 0.32, -0.45, SLOT.glass);
      B.box(-1.0, y0, 2.15, 1.0, y0 + 0.5, 2.8, SLOT.seat);
      B.box(-0.25, y0, H.L / 2, 0.25, y0 + 0.8, H.L / 2 + 0.6, SLOT.dark);
      figure(B, { x: 0.6, y: y0 + 0.36, z: 0.5, lean: 0.1, near: false });
    }
  } else {
    hull(B, H, near ? 18 : 5);
    const s = hullAt(H, 0.3);
    // the hood over the bow (the hull's colour), the seat (black), the handlebar, the pump's nozzle aft
    const hood = []; const n = near ? 6 : 3;
    for (let i = 0; i <= n; i++) { const u = 0.05 + 0.33 * i / n, q = hullAt(H, u), z = -H.L / 2 + u * H.L, top = q.ys + 0.12 + 0.28 * Math.sin(Math.min(1, i / n * 1.3) * Math.PI / 2); hood.push([[-q.hb * 0.9, q.ys, z], [-q.hb * 0.55, top - 0.05, z], [0, top, z], [q.hb * 0.55, top - 0.05, z], [q.hb * 0.9, q.ys, z]]); }
    for (let i = 0; i < hood.length - 1; i++) for (let j = 0; j < 4; j++) B.quad(hood[i][j], hood[i + 1][j], hood[i + 1][j + 1], hood[i][j + 1], SLOT.hull);
    const last = hood[hood.length - 1]; for (let j = 0; j < 4; j++) B.tri(last[j], last[j + 1], [0, s.ys, last[0][2]], SLOT.hull);
    const sy = hullAt(H, 0.6).ys;
    B.box(-0.22, sy, -0.3, 0.22, sy + 0.3, 1.15, SLOT.seatDark);
    const hz = -0.42, hy = sy + 0.55;
    B.cyl([-0.36, hy, hz], [0.36, hy, hz], 0.022, near ? 6 : 3, SLOT.dark);
    B.cyl([0, sy + 0.25, hz + 0.12], [0, hy, hz], 0.05, near ? 6 : 3, SLOT.dark);
    if (near) B.cyl([0, 0.0, H.L / 2 - 0.05], [0, 0.0, H.L / 2 + 0.18], 0.07, 6, SLOT.metal);
    // the rider: forward on the seat, leaning into the bars, a bright buoyancy aid
    figure(B, { x: 0, y: sy + 0.3, z: 0.15, lean: 0.38, vest: true, hands: [0, hy, hz, 0.33], near });
  }
  return new Float32Array(B.v);
}

export function buildCraftMeshes() {
  const parts = {}; for (const k of KINDS) for (const lod of ['near', 'far']) parts[`${k}-${lod}`] = buildCraft(k, { lod });
  const total = Object.values(parts).reduce((n, a) => n + a.length, 0), data = new Float32Array(total), runs = {};
  let o = 0;
  for (const [k, a] of Object.entries(parts)) { data.set(a, o); runs[k] = { first: o / VF, count: a.length / VF }; o += a.length; }
  return { data, runs };
}

// the LOD for a distance (m), with hysteresis about the last one
export function lodFor(kind, d, last = null) {
  const b = LOD_M[kind], k = last === 'near' ? b * (1 + LOD_M.hyst) : last == null ? b : b * (1 - LOD_M.hyst);
  return d < k ? 'near' : 'far';
}
