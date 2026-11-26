// South Lake's small power craft (v2/living/powerTraffic.js), all by code: a generic 6.6 m bowrider runabout and a 3.2 m sit-down jet
// ski, each with its seated figure. Pure: plain arrays, no GPU (the tests and render/smallCraft.js build them once). Two LODs each in
// one vertex set (near: the lofted hull (a raked stem, a flared bow, the sheer rising forward, a deep V forward carried aft at 19°,
// rounded chines, a crowned deck, a rubrail), the wrap-around windscreen, the console, the seats, the outboard or the
// jet's hood, the figure; far: a few dozen triangles of hull, deck block and figure), each LOD drawn in one call for every craft of
// its kind (instanced). No names, no lettering, no liveries: the hull's colour and its one stripe are the instance's (the region row's
// hull and stripe). The figures' slots (>= SLOT.rider) duck in the vertex shader when Tessie splashes them (nobody goes in the water).
// Frame (every boat's): x starboard, y up from her waterline, z aft (the bow at −z), metres. A vertex: position (3), normal (3), the
// material slot (1) (the glass boat's layout: render/tourBoatMesh.js VF).
import { builder, VF } from './tourBoatMesh.js';
import { POWER } from '../living/powerTraffic.js';

export { VF };
export const SLOT = Object.freeze({ hull: 0, deck: 1, glass: 2, seat: 3, seatDark: 4, dark: 5, metal: 6, mat: 7, hood: 8, rider: 10, skin: 11, vest: 12, hair: 13, trunks: 14, helmet: 15, glove: 16 });
export const LOD_M = Object.freeze({ power: 300, jetski: 200, hyst: 0.08 });       // m: the near LOD within these
export const DRAW_M = Object.freeze({ full: Object.freeze({ power: 4000, jetski: 2500 }), lite: Object.freeze({ power: 2000, jetski: 1200 }) });
export const KINDS = Object.freeze(['power', 'jetski']);

// a hull's shape: length L, beam B, its sheer (ys) rising to the bow (sheerBow over sheerRun), the keel with its forefoot rising
// forward, the deadrise (deg) from the transom's to the entry's, the chine's half-width (a share of the sheer's) and its own fuller-
// aft entry (the topsides flare out above it at the bow), the stem's rake (m aft per m down at the stem), the chine's round (m), the
// deck's crown (m) (u 0 at the stem, 1 at the transom)
export const HULLS = Object.freeze({
  power: Object.freeze({ L: POWER.power.length, B: POWER.power.beam, sheer: 0.84, sheerBow: 0.38, sheerRun: 0.62, keel: -0.34, forefoot: 0.52, footRun: 0.34, deadrise: 19, deadriseBow: 52, chine: 0.88, entry: 0.44, chineEntry: 0.6, rake: 0.8, round: 0.11, crown: 0.07, stripe: Object.freeze([0.42, 0.6]) }),
  jetski: Object.freeze({ L: POWER.jetski.length, B: POWER.jetski.beam, sheer: 0.5, sheerBow: 0.12, keel: -0.2, forefoot: 0.3, deadrise: 0.16, chine: 0.86, entry: 0.4, stripe: Object.freeze([0.3, 0.42]) }),
});
export function hullAt(H, u) {
  u = Math.max(0, Math.min(1, u));
  const half = H.B / 2;
  // the deck's plan: a fine point at the stem opening to a full bow, then a hint of taper to the transom
  const hb = half * (u < H.entry ? Math.sin((u / H.entry) * Math.PI / 2) ** 0.85 : 1 - 0.05 * ((u - H.entry) / (1 - H.entry)));
  const ys = H.sheer + (u < H.sheerRun ? H.sheerBow * (1 - u / H.sheerRun) ** 1.8 : -0.05 * (u - H.sheerRun) / (1 - H.sheerRun));
  const yk = H.keel + (u < H.footRun ? H.forefoot * (1 - u / H.footRun) ** 2 : 0);
  // the chine's plan runs finer than the deck's at the bow (the flare), its V deep forward and carried aft at the transom's deadrise
  const xc = half * H.chine * (u < H.chineEntry ? Math.sin((u / H.chineEntry) * Math.PI / 2) ** 1.1 : 1 - 0.05 * ((u - H.chineEntry) / (1 - H.chineEntry)));
  const dr = (H.deadrise + (H.deadriseBow - H.deadrise) * Math.max(0, 1 - u / 0.65) ** 1.5) * Math.PI / 180;
  return { hb, ys, yk, yc: Math.min(ys - 0.12 * (hb / half), yk + xc * Math.tan(dr)), xc };
}

// a side's section at u (sx −1 port, +1 starboard): sheer, the chine's round (above, on, below), keel; the stem raked (the lower points
// drawn aft near the bow, so her sheer keeps the 6.6 m and the stem leans forward from the forefoot)
function section(H, u, sx, round) {
  const s = hullAt(H, u), z0 = -H.L / 2 + u * H.L, w = Math.max(0, 1 - u / 0.3) ** 2;
  const P = (x, y) => [sx * x, y, z0 + H.rake * (s.ys - y) * w];
  if (!round) return [P(s.hb, s.ys), P(s.xc, s.yc), P(0, s.yk)];
  const C = [s.xc, s.yc], toS = [s.hb - s.xc, s.ys - s.yc], toK = [-s.xc, s.yk - s.yc];
  const lS = Math.hypot(...toS) || 1, lK = Math.hypot(...toK) || 1, r = Math.min(H.round, 0.3 * lS, 0.3 * lK);
  const cu = [C[0] + toS[0] / lS * r, C[1] + toS[1] / lS * r], cl = [C[0] + toK[0] / lK * r, C[1] + toK[1] / lK * r];
  const cm = [C[0] * 0.45 + (cu[0] + cl[0]) / 2 * 0.55, C[1] * 0.45 + (cu[1] + cl[1]) / 2 * 0.55];
  return [P(s.hb, s.ys), P(cu[0], cu[1]), P(cm[0], cm[1]), P(cl[0], cl[1]), P(0, s.yk)];
}

function hull(B, H, n, near) {
  const us = []; for (let i = 0; i <= n; i++) us.push((i / n) ** 1.15);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // each side its own sheet (sheer to keel; smooth across the chine's round, a sharp crease at the keel and at the sheer)
  const sides = [-1, 1].map((sx) => us.map((u) => section(H, u, sx, near)));
  for (const rows of sides) {
    const R = rows.length, N = rows[0].length;
    const nrm = (i, j) => B.norm(cross(sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]), sub(rows[i][Math.min(N - 1, j + 1)], rows[i][Math.max(0, j - 1)])));
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) B.squad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), SLOT.hull);
  }
  const [port, stbd] = sides, R = port.length, N = port[0].length;
  // the deck: a crowned foredeck and cockpit sole between the sheers (port sheer, the crown, starboard sheer)
  for (let i = 0; i < R - 1; i++) {
    const a0 = port[i][0], a1 = stbd[i][0], b0 = port[i + 1][0], b1 = stbd[i + 1][0];
    const ca = [0, a0[1] + H.crown * Math.abs(a0[0]) / (H.B / 2), a0[2]], cb = [0, b0[1] + H.crown * Math.abs(b0[0]) / (H.B / 2), b0[2]];
    if (near) { B.quad(a0, ca, cb, b0, SLOT.deck); B.quad(ca, a1, b1, cb, SLOT.deck); } else B.quad(a1, a0, b0, b1, SLOT.deck);
  }
  // the rubrail: a dark band along each sheer, a hand deep
  if (near) for (const rows of sides) for (let i = 0; i < R - 1; i++) {
    const a = rows[i][0], b = rows[i + 1][0], o = Math.sign(a[0] || b[0] || 1) * 0.025;
    B.quad([a[0] + o, a[1] + 0.01, a[2]], [b[0] + o, b[1] + 0.01, b[2]], [b[0] + o, b[1] - 0.07, b[2]], [a[0] + o, a[1] - 0.07, a[2]], SLOT.dark);
  }
  // the transom: a fan from its middle
  const tp = port[R - 1], ts = stbd[R - 1], ring = [...tp, ...ts.slice(0, N - 1).reverse()], c = [0, (tp[0][1] + tp[N - 1][1]) / 2, tp[0][2]];
  for (let j = 0; j < ring.length - 1; j++) B.tri(c, ring[j], ring[j + 1], SLOT.hull);
  B.tri(c, ring[ring.length - 1], ring[0], SLOT.hull);
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
    hull(B, H, near ? 20 : 6, near);
    const s = hullAt(H, 0.42), y0 = s.ys;
    if (near) {
      // the windscreen: a wrap-around in two halves either side of the walk-through, raked aft about 40°, each half three panes (the
      // front, the corner swept aft, the wing back along the gunwale), lower toward the sides; a bright frame along the top
      for (const sx of [-1, 1]) {
        const base = [[0.14, -0.86], [0.55, -0.8], [0.9, -0.62], [0.97, -0.22]], hs = [0.4, 0.38, 0.32, 0.2];
        const bot = base.map(([f, z]) => { const q = hullAt(H, (z + H.L / 2) / H.L); return [sx * Math.min(f * q.hb, q.hb - 0.05), q.ys + 0.01, z]; });
        const top = bot.map((p, k) => [p[0] - sx * 0.05 * k / 3, p[1] + hs[k], p[2] + hs[k] * (0.85 - 0.35 * k / 3)]);
        for (let k = 0; k < 3; k++) B.quad(bot[k], bot[k + 1], top[k + 1], top[k], SLOT.glass);
        B.tube(top, 0.016, 4, SLOT.metal);
      }
      B.box(0.25, y0, -0.45, 0.95, y0 + 0.38, -0.05, SLOT.hull);
      B.box(0.55, y0 + 0.38, -0.32, 0.62, y0 + 0.45, -0.25, SLOT.dark);   // the wheel's hub
      // the seats: the helm and the companion's bucket seats, the stern bench across, the bow's cushions
      for (const sx of [-0.6, 0.6]) { B.box(sx - 0.26, y0, 0.25, sx + 0.26, y0 + 0.36, 0.75, SLOT.seat); B.box(sx - 0.26, y0 + 0.36, 0.68, sx + 0.26, y0 + 0.82, 0.8, SLOT.seat); }
      const yb = hullAt(H, 0.85).ys + 0.02; B.box(-1.05, yb, 2.15, 1.05, yb + 0.34, 2.75, SLOT.seat); B.box(-1.05, yb + 0.34, 2.68, 1.05, yb + 0.7, 2.85, SLOT.seat);
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
    jetSki(B, near);
  }
  return new Float32Array(B.v);
}

// the jet ski (JET, her frame: the bow at −z): a shaped hull (a pointed bow, a chine, a sponson ledge, the gunwale's tumblehome), the
// two-tone deck (the hood and the seat's pedestal in the row's colour, the footwells' black mat, a grey rear deck), the steering
// column and raised bars with grips and a mirror pair, the cushion with piping, a grab handle, the pump's nozzle, and the rider:
// seated, knees bent, feet in the footwells, hands on the grips, a buoyancy aid and a helmet. near ≈ 2.1 k triangles, far ≈ 300.
export const JET = Object.freeze({ L: POWER.jetski.length, B: POWER.jetski.beam, sponsonY: 0.16, footY: 0.3, seatTop: 0.74, seatZ: 0.32, barY: 1.02, barZ: -0.52, nozzleY: 0.08 });
export function jetAt(u) {
  u = Math.max(0, Math.min(1, u));
  const hb = JET.B / 2 * (u < 0.45 ? Math.sin((u / 0.45) * Math.PI / 2) ** 0.62 : 1 - 0.1 * ((u - 0.45) / 0.55) ** 2);
  const ys = 0.44 + (u < 0.35 ? 0.2 * (1 - u / 0.35) ** 2 : -0.04 * (u - 0.35) / 0.65);
  const yk = -0.18 + (u < 0.42 ? 0.55 * (1 - u / 0.42) ** 2 : 0.03 * (u - 0.42));   // a long raked forefoot (the stem out of the water)
  const w = hb / (JET.B / 2), yc = yk + 0.15 * w;
  return { hb, ys, yk, yc, xc: hb * 0.76, ysp: yc + JET.sponsonY * w };
}
const jz = (u) => -JET.L / 2 + u * JET.L;
function jetSki(B, near) {
  const n = near ? 26 : 6;
  // the hull: gunwale, sponson ledge (out and down), chine, keel; a sheet port to starboard, smooth across, a sharp edge at the sponson
  const ring = (u) => { const q = jetAt(u), z = jz(u); return [[-q.hb * 0.95, q.ys, z], [-q.hb, q.ysp + 0.03, z], [-q.hb * 0.97, q.ysp, z], [-q.xc, q.yc, z], [0, q.yk, z], [q.xc, q.yc, z], [q.hb * 0.97, q.ysp, z], [q.hb, q.ysp + 0.03, z], [q.hb * 0.95, q.ys, z]]; };
  const rows = []; for (let i = 0; i <= n; i++) rows.push(ring((i / n) ** 1.1));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const R = rows.length, N = 9;
  const nrm = (i, j) => B.norm(cross(sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]), sub(rows[i][Math.min(N - 1, j + 1)], rows[i][Math.max(0, j - 1)])));
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) B.squad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), SLOT.hull);
  const t = rows[R - 1]; for (let j = 1; j < N - 1; j++) B.tri(t[4], t[j], t[j + 1], SLOT.hull); B.quad(t[0], t[1], t[7], t[8], SLOT.hull);   // the transom
  // the hood: lofted over the bow from the gunwales to a rounded crown that peaks ahead of the bars
  const hood = [], hn = near ? 8 : 3;
  for (let i = 0; i <= hn; i++) {
    const u = 0.02 + 0.36 * i / hn, q = jetAt(u), z = jz(u), top = q.ys + 0.06 + 0.34 * Math.sin(Math.min(1, (i / hn) * 1.15) * Math.PI / 2);
    hood.push([[-q.hb * 0.95, q.ys, z], [-q.hb * 0.78, top - 0.1, z], [-q.hb * 0.42, top - 0.02, z], [0, top, z], [q.hb * 0.42, top - 0.02, z], [q.hb * 0.78, top - 0.1, z], [q.hb * 0.95, q.ys, z]]);
  }
  for (let i = 0; i < hood.length - 1; i++) for (let j = 0; j < 6; j++) B.quad(hood[i][j], hood[i + 1][j], hood[i + 1][j + 1], hood[i][j + 1], SLOT.hood);
  // the hood's back face down to the pedestal and the footwells' floor
  const hb0 = hood[hood.length - 1], zb = hb0[0][2], zp = zb + 0.1, py = JET.seatTop - 0.14;
  B.quad(hb0[2], hb0[4], [0.21, py, zp], [-0.21, py, zp], SLOT.hood);
  B.quad(hb0[1], hb0[2], [-0.21, py, zp], [-0.5, JET.footY, zp], SLOT.hood); B.quad(hb0[4], hb0[5], [0.5, JET.footY, zp], [0.21, py, zp], SLOT.hood);
  // the pedestal under the seat (the row's colour) between the footwells; the footwells' mat; their outer walls up to the gunwale
  const z1 = jz(0.86), zr = jz(1.0);
  B.box(-0.21, JET.footY, zp, 0.21, py, z1, SLOT.hood, { bottom: false });
  for (const sx of [-1, 1]) {
    const a = sx < 0 ? -0.5 : 0.21, b = sx < 0 ? -0.21 : 0.5;
    B.quad([a, JET.footY, zp], [a, JET.footY, z1], [b, JET.footY, z1], [b, JET.footY, zp], SLOT.mat);
    const qf = jetAt(0.5), qr = jetAt(0.86), xf = sx * qf.hb * 0.93, xr = sx * qr.hb * 0.93;
    B.quad([sx * 0.5, JET.footY, zp], [xf, qf.ys, zp], [xr, qr.ys, z1], [sx * 0.5, JET.footY, z1], SLOT.hood);
    B.quad([xf, qf.ys, zp], [sx * jetAt(0.4).hb * 0.95, jetAt(0.4).ys, zb], [sx * 0.5, JET.footY, zp], [xf, qf.ys, zp], SLOT.hood);
  }
  // the rear deck (grey non-skid) and its step face down to the footwells
  const qr = jetAt(0.86), qt = jetAt(1.0);
  B.quad([-qr.hb * 0.95, qr.ys, z1], [qr.hb * 0.95, qr.ys, z1], [qt.hb * 0.95, qt.ys, zr], [-qt.hb * 0.95, qt.ys, zr], SLOT.deck);
  B.quad([-0.5, JET.footY, z1], [0.5, JET.footY, z1], [qr.hb * 0.95, qr.ys, z1], [-qr.hb * 0.95, qr.ys, z1], SLOT.hood);
  // the cushion: rounded rings along the pedestal, a pale piping at its foot
  const cs = [], cn = near ? 7 : 2, cm = near ? 8 : 4;
  for (let i = 0; i <= cn; i++) {
    const u = i / cn, z = zp + 0.03 + (z1 - zp - 0.1) * u, end = Math.sin(Math.max(0.2, Math.min(1, Math.min(u, 1 - u) * 6)) * Math.PI / 2);
    const w = 0.2 * end, h = 0.14 * (0.6 + 0.4 * end) + (u < 0.3 ? 0.03 * (1 - u / 0.3) : 0);
    cs.push(Array.from({ length: cm }, (_, k) => { const a = Math.PI * k / (cm - 1); return [-Math.cos(a) * w, py + Math.sin(a) * h, z]; }));
  }
  for (let i = 0; i < cs.length - 1; i++) for (let k = 0; k < cm - 1; k++) B.quad(cs[i][k], cs[i + 1][k], cs[i + 1][k + 1], cs[i][k + 1], SLOT.seatDark);
  for (const ring of [cs[0], cs[cs.length - 1]]) for (let k = 1; k < cm - 1; k++) B.tri(ring[0], ring[k], ring[k + 1], SLOT.seatDark);
  if (near) for (const sx of [-1, 1]) B.tube(cs.map((r) => [sx * 0.205, py + 0.01, r[0][2]]), 0.012, 4, SLOT.seat);
  const seg = near ? 8 : 3;
  // the grab handle behind the seat; the steering column and the raised bars, the grips, the mirrors on the hood
  B.tube([[-0.16, py, z1 - 0.02], [-0.16, py + 0.16, z1 + 0.04], [0.16, py + 0.16, z1 + 0.04], [0.16, py, z1 - 0.02]], 0.016, near ? 6 : 3, SLOT.dark);
  const colA = [0, jetAt(0.3).ys + 0.36, jz(0.3)], colB = [0, JET.barY - 0.04, JET.barZ + 0.06];
  B.cyl(colA, colB, 0.045, seg, SLOT.dark, { cap: true, r1: 0.04 });
  B.box(-0.07, JET.barY - 0.07, JET.barZ - 0.02, 0.07, JET.barY + 0.01, JET.barZ + 0.1, SLOT.hood);   // the column's cowl over the clamp
  B.tube([[-0.36, JET.barY + 0.03, JET.barZ + 0.02], [-0.16, JET.barY, JET.barZ], [0.16, JET.barY, JET.barZ], [0.36, JET.barY + 0.03, JET.barZ + 0.02]], 0.014, near ? 6 : 3, SLOT.metal);
  for (const sx of [-1, 1]) {
    B.cyl([sx * 0.25, JET.barY + 0.02, JET.barZ + 0.01], [sx * 0.37, JET.barY + 0.03, JET.barZ + 0.02], 0.022, seg, SLOT.seatDark, { cap: true });
    if (near) {
      const m0 = [sx * 0.3, jetAt(0.22).ys + 0.27, jz(0.22)], m1 = [sx * 0.4, m0[1] + 0.1, m0[2] + 0.02];
      B.cyl(m0, m1, 0.008, 4, SLOT.dark);
      B.box(m1[0] - 0.05, m1[1] - 0.03, m1[2] - 0.012, m1[0] + 0.05, m1[1] + 0.03, m1[2] + 0.012, SLOT.dark);
      B.quad([m1[0] - 0.045, m1[1] - 0.025, m1[2] + 0.013], [m1[0] + 0.045, m1[1] - 0.025, m1[2] + 0.013], [m1[0] + 0.045, m1[1] + 0.025, m1[2] + 0.013], [m1[0] - 0.045, m1[1] + 0.025, m1[2] + 0.013], SLOT.glass);
    }
  }
  // the pump's nozzle and its ride plate at the stern
  B.cyl([0, JET.nozzleY, zr - 0.08], [0, JET.nozzleY, zr + 0.16], 0.08, seg, SLOT.metal, { cap: true, r1: 0.065 });
  if (near) B.box(-0.2, -0.02, zr - 0.25, 0.2, 0.0, zr + 0.06, SLOT.metal);
  // the rider: hips on the cushion, knees bent up and out, feet on the mat, the torso leaning to the bars, a buoyancy aid and a helmet
  const hipY = JET.seatTop + 0.04, hipZ = JET.seatZ, lean = 0.42, up = [0, Math.cos(lean), -Math.sin(lean)];
  const T = (h) => [0, hipY + up[1] * h, hipZ + up[2] * h];
  for (const sx of [-1, 1]) {
    const hip = [sx * 0.11, hipY + 0.02, hipZ], knee = [sx * 0.24, hipY + 0.08, hipZ - 0.44], foot = [sx * 0.33, JET.footY + 0.05, hipZ - 0.22];
    B.cyl(hip, knee, 0.088, seg, SLOT.trunks, { r1: 0.07 }); if (near) B.ball(knee, 0.07, SLOT.trunks, 6);
    B.cyl(knee, foot, 0.064, seg, SLOT.skin, { r1: 0.05 });
    if (near) B.box(foot[0] - 0.05, JET.footY, foot[2] - 0.12, foot[0] + 0.05, JET.footY + 0.07, foot[2] + 0.06, SLOT.dark);   // water shoes
  }
  B.cyl(T(0.0), T(0.22), 0.15, seg, SLOT.trunks, { r1: 0.15 });
  B.cyl(T(0.18), T(0.52), 0.185, seg, SLOT.vest, { cap: true, r1: 0.2 });   // the buoyancy aid over the chest
  if (near) for (const h of [0.27, 0.4]) B.tube(Array.from({ length: 9 }, (_, k) => { const a = Math.PI * 2 * k / 8; const c = T(h); return [c[0] + Math.cos(a) * 0.192, c[1], c[2] + Math.sin(a) * 0.192]; }), 0.012, 3, SLOT.dark);   // its straps
  B.cyl(T(0.52), T(0.62), 0.06, seg, SLOT.skin);
  const head = T(0.74); if (near) B.ball(head, 0.1, SLOT.skin, 8);
  B.ball([head[0], head[1] + 0.035, head[2] + 0.01], 0.125, SLOT.helmet, near ? 10 : 3);   // the helmet's shell
  if (near) B.box(-0.09, head[1] - 0.02, head[2] - 0.13, 0.09, head[1] + 0.04, head[2] - 0.09, SLOT.glass);   // its visor
  const sh = T(0.48);
  for (const sx of [-1, 1]) {
    const s0 = [sx * 0.21, sh[1], sh[2]], hand = [sx * 0.33, JET.barY + 0.03, JET.barZ + 0.02], el = [sx * 0.3, (s0[1] + hand[1]) / 2 - 0.06, (s0[2] + hand[2]) / 2 + 0.06];
    if (near) B.ball(s0, 0.075, SLOT.vest, 6);
    B.cyl(s0, el, 0.05, seg, SLOT.skin, { r1: 0.045 }); B.cyl(el, hand, 0.042, seg, SLOT.skin, { r1: 0.038 });
    if (near) B.ball(hand, 0.045, SLOT.glove, 6);
  }
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
