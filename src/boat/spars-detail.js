// The rig's fittings up close: what a rigger looks at from the deck
// and the helm. Generic shapes, no maker's castings or marks. Plain JS (no three.js), called by spars.js buildSpars:
//
//   masthead(md, rig)           the masthead casting: halyard sheaves forward, the backstay crane with its topping-lift
//                               sheave, the forestay tang and pin, the cap-shroud tangs, the light's base, the VHF
//                               antenna's bracket and base
//   spreaderFittings(md, rig)   the root castings and the tip clamps; the white boots, taped round the wire
//   rigScrew(md, a, dir)        the chainplate, a toggle, an open-body rigging screw with its studs, the wire's swage
//   furler(rig)                 { drum: MeshData in its own frame, at, axis }: the drum, its flanges, the line guide
//   boomFittings(boom, rig)     the gooseneck hinge, the end casting with its three sheaves, the outhaul car, the
//                               mainsheet bail and double block, the vang's end fittings
//   lazyBag(boom, rig)          the toast lazy bag: two panels sagging between the lazy-jack points, a zip, seams, grime
//   vane(md)                    the wind vane (its own MeshData, turned to the apparent wind by spars-mesh.js)
//
// Frames: the RIG frame (dims.js); the boom's own frame (origin at the gooseneck pin, +Z aft along the boom).
import { MAT, MeshData, sweepRings, member, box, circle, oval, frame, mastHalf, srgb } from './spars.js';

// local vector ops (spars.js imports this module: its own bindings aren't ready while this one evaluates)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const lin = (hex) => [16, 8, 0].map((s) => { const c = ((hex >> s) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

// A turned part along a→b: profile [[t (0..1 along), r]], k segments round; caps at both ends.
export function turned(md, a, b, profile, col, mr, k = 16, hint) {
  const ax = sub(b, a);
  sweepRings(md, profile.map(([t, r]) => ({ o: lerp(a, b, t), a: ax, s: [Math.max(r, 1e-4), Math.max(r, 1e-4)] })), circle(k), col, mr,
    { capStart: true, capEnd: true, hint });
}
// A disc (a short cylinder) centred at c, its axis along `axis`.
export const disc = (md, c, axis, r, h, col, mr, k = 16) => {
  const d = mul(norm(axis), h / 2);
  member(md, sub(c, d), add(c, d), r, r, col, mr, k);
};
// A flat plate: centre c, its normal n, the long side along u: half sizes (hu, hv), thickness t.
export function plate(md, c, n, u, hu, hv, t, col, mr) {
  const nn = norm(n), uu = norm(sub(u, mul(nn, dot(u, nn))));
  box(md, sub(c, mul(uu, hu)), add(c, mul(uu, hu)), t, 2 * hv, col, mr, nn);
}
// A torus ring (an eye, a shackle's bow) about `axis` at c.
export function ring(md, c, axis, R, r, col, mr, n = 16, m = 6) {
  const [a, u, v] = frame(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const base = md.vertexCount;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI, d = add(mul(u, Math.cos(t)), mul(v, Math.sin(t)));
    for (let j = 0; j < m; j++) {
      const p = (j / m) * 2 * Math.PI;
      const nn = add(mul(d, Math.cos(p)), mul(a, Math.sin(p)));
      md.vert(add(c, add(mul(d, R), mul(nn, r))), nn, col, mr);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const q = (x, y) => base + ((x + n) % n) * m + ((y + m) % m);
    md.tri(q(i, j), q(i + 1, j), q(i + 1, j + 1)); md.tri(q(i, j), q(i + 1, j + 1), q(i, j + 1));
  }
}

const SHEAVE = { c: lin(0x1E2022), mr: [0.0, 0.45] };
const CAST = { c: lin(0xA9ACB0), mr: [1.0, 0.48] };   // cast aluminium: a touch greyer and rougher than the extrusion

// ---- the masthead -------------------------------------------------------------------------------------------------
export function masthead(md, rig) {
  const S = rig.S, top = S.mastTop;
  const [hx, hz] = mastHalf(S, top);
  // the casting: a cap following the section, a little proud of it
  sweepRings(md, [top - 0.06, top + 0.02, top + 0.06].map((y, i) => ({ o: [0, y, 0], a: [0, 1, 0], s: [hz + 0.006 - (i === 2 ? 0.012 : 0), hx + 0.006 - (i === 2 ? 0.010 : 0)] })),
    oval(20, 0.85), CAST.c, CAST.mr, { capEnd: true, hint: [0, 0, 1] });
  // the sheave box forward: two cheeks and two halyard sheaves (the main and jib halyards), axle pins through
  for (const sx of [-1, 1]) plate(md, [sx * 0.032, top - 0.03, -hz - 0.035], [1, 0, 0], [0, 0, 1], 0.05, 0.065, 0.006, CAST.c, CAST.mr);
  for (const sx of [-0.5, 0.5]) disc(md, [sx * 0.030, top - 0.03, -hz - 0.035], [1, 0, 0], 0.045, 0.012, SHEAVE.c, SHEAVE.mr, 18);
  disc(md, [0, top - 0.03, -hz - 0.035], [1, 0, 0], 0.008, 0.082, MAT.steel.c, MAT.steel.mr, 8);
  // the backstay crane aft: a tapering arm, the topping-lift sheave in it, the backstay tang at its end
  sweepRings(md, [{ o: [0, top + 0.03, hz - 0.02], a: [0, 0, 1], s: [0.022, 0.034] }, { o: [0, top + 0.06, rig.points.crane[2] + 0.01], a: [0, 0, 1], s: [0.014, 0.018] }],
    oval(12, 0.8), CAST.c, CAST.mr, { capEnd: true, hint: [0, 1, 0] });
  disc(md, [0, top + 0.035, hz + 0.08], [1, 0, 0], 0.028, 0.012, SHEAVE.c, SHEAVE.mr, 14);
  ring(md, add(rig.points.crane, [0, -0.012, 0]), [1, 0, 0], 0.014, 0.004, MAT.steel.c, MAT.steel.mr, 12, 5);
  // the forestay tang: two stainless plates either side of the fitting, the clevis pin and its toggle
  const ft = rig.points.houndsTang;
  for (const sx of [-1, 1]) plate(md, [sx * 0.012, ft[1] + 0.03, ft[2] + 0.015], [1, 0, 0], [0, 1, 0], 0.05, 0.022, 0.005, MAT.steel.c, MAT.steel.mr);
  disc(md, [0, ft[1], ft[2] - 0.004], [1, 0, 0], 0.007, 0.036, MAT.steel.c, MAT.steel.mr, 8);
  // the cap shrouds' T-ball tangs: a stainless backing plate and the T-socket each side
  for (const sx of [-1, 1]) {
    const c = [sx * (mastHalf(S, S.capTang)[0] + 0.002), S.capTang, 0];
    plate(md, c, [sx, 0, 0], [0, 1, 0], 0.06, 0.025, 0.004, MAT.steel.c, MAT.steel.mr);
    disc(md, add(c, [sx * 0.012, 0, 0]), [1, 0, 0], 0.014, 0.02, MAT.steel.c, MAT.steel.mr, 10);
  }
  // casting detail: a moulded bead round the shoulder, four gussets down the cap, screws round the collar, and the
  // sheave axle's hex nuts either side with the rope-exit lips under the cheeks
  for (const [gx, gz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const bx = gx * (hx + 0.002), bz = gz * (hz + 0.002);
    box(md, [bx, top - 0.10, bz], [gx ? bx + gx * 0.012 : bx, top - 0.02, gz ? bz + gz * 0.012 : bz], 0.010, 0.006, CAST.c, CAST.mr, gx ? [0, 0, 1] : [1, 0, 0]);
  }
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8;
    disc(md, [Math.sin(a) * (hx + 0.007), top - 0.015, Math.cos(a) * (hz + 0.007)], [Math.sin(a), 0, Math.cos(a)], 0.0042, 0.003, MAT.steel.c, MAT.steel.mr, 6);
  }
  for (const sx of [-1, 1]) {
    disc(md, [sx * 0.058, top - 0.03, -hz - 0.035], [1, 0, 0], 0.0085, 0.006, MAT.steel.c, MAT.steel.mr, 6);   // the axle's hex nut
    plate(md, [sx * 0.030, top - 0.075, -hz - 0.040], [0, 1, 0], [1, 0, 0], 0.030, 0.012, 0.004, CAST.c, CAST.mr);   // the rope-exit lip
  }
  // the crane's web: a thin rib along its side, with two rivets
  for (const sx of [-1, 1]) box(md, [sx * 0.019, top + 0.035, hz + 0.02], [sx * 0.019, top + 0.045, rig.points.crane[2] - 0.02], 0.002, 0.012, CAST.c, CAST.mr, [1, 0, 0]);
  // the light's base: a short stainless post on the cap (the lens is details-mesh's)
  member(md, [0, top + 0.06, 0], [0, top + 0.10, 0], 0.012, 0.012, MAT.steel.c, MAT.steel.mr, 10);
  disc(md, [0, top + 0.105, 0], [0, 1, 0], 0.032, 0.012, MAT.dark.c, MAT.dark.mr, 18);
  // the VHF antenna: a stainless L-bracket off the side of the cap, a black loading-coil base
  const ab = [0.045, top + 0.12, -0.04];
  box(md, [hx * 0.6, top + 0.04, -0.04], [ab[0] + 0.012, top + 0.04, -0.04], 0.025, 0.004, MAT.steel.c, MAT.steel.mr, [0, 1, 0]);
  member(md, [ab[0], top + 0.04, -0.04], [ab[0], top + 0.07, -0.04], 0.010, 0.010, MAT.steel.c, MAT.steel.mr, 8);
  turned(md, [ab[0], top + 0.07, -0.04], [ab[0], top + 0.13, -0.04], [[0, 0.012], [0.15, 0.014], [0.85, 0.012], [1, 0.006]], MAT.dark.c, MAT.dark.mr, 10);
}

// ---- the wind vane (its own geometry: spars-mesh.js turns it about the stick) ----------------------------------
// An arrow vane of the Windex kind at ≈ 1.3× life size (a real one is ≈ 0.33 m long). Parts and materials (albedo kept
// physical: stainless ≈ 0.6 as the hull's, a red that is a pigment not a lamp):
//   the arm       anodised aluminium tube, satin (the vane material gives it a slight anisotropic sheen);
//   the head      a moulded ABS/polycarbonate arrowhead: a thin wedge with crisp edges, a slightly translucent signal red,
//                 UV-faded paler along its upper edge, with one scuff; a polished stainless bead at the very tip;
//   the feather   the tail: three moulded panels with slots between them, the same red;
//   the pivot     a stainless collar and bushing, and a small stainless counterweight on the aft end of the arm.
// vaneTabs() is the fixed part (it does not turn): the base plate with its screws, the stem, and the two reference tabs on
// thin stainless rods, each with a strip of reflective tape.
const VANE_REF_DEG = 45;   // the two reference tabs sit this far off the bow: the arrow lies on one close-hauled
const VANE_MAT = {
  alu: { c: lin(0xB4B7BB), mr: [1.0, 0.48] },        // anodised aluminium, satin
  steel: { c: [0.62, 0.615, 0.60], mr: [1.0, 0.30] },   // stainless, the hull's own value (0.62)
  bead: { c: [0.62, 0.62, 0.62], mr: [1.0, 0.06] },     // the polished tip: a mirror, but no brighter than stainless
  red: { c: lin(0xA23A2C), mr: [0.0, 0.38] },          // moulded red polycarbonate (the vane material gives these a clear coat and a faint translucency)
  redFaded: { c: lin(0xB9604C), mr: [0.0, 0.42] },     // UV-faded at the edges: paler, a little chalky
  scuff: { c: lin(0xA98F86), mr: [0.0, 0.62] },        // a scuff: the red worn to a dull grey-pink
  tape: { c: [0.58, 0.58, 0.55], mr: [0.0, 0.20] },     // reflective tape: pale, glossy, not metal
  red2: { c: lin(0xA33A33), mr: [0.0, 0.46] }, green: { c: lin(0x2F6B47), mr: [0.0, 0.46] },
};
export function vane() {
  const md = new MeshData(), V = VANE_MAT, sq = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const wedge = (z0, z1, s0, s1, mat, y = 0) => sweepRings(md, [{ o: [0, y, z0], a: [0, 0, 1], s: s0 }, { o: [0, y, z1], a: [0, 0, 1], s: s1 }], sq, mat.c, mat.mr, { capStart: true, capEnd: true, hint: [0, 1, 0] });
  // the arm: a satin aluminium tube from the head to the counterweight
  turned(md, [0, 0, -0.20], [0, 0, 0.26], [[0, 0.0050], [0.04, 0.0055], [0.96, 0.0055], [1, 0.0050]], V.alu.c, V.alu.mr, 12);
  // the head: a moulded wedge, 0.15 m long, 0.052 tall at the base and 0.006 thick, tapering to a point, with a crisp edge
  wedge(-0.335, -0.19, [0.0007, 0.0020], [0.0030, 0.0260], V.red);
  wedge(-0.280, -0.200, [0.0012, 0.0030], [0.0032, 0.0262], V.redFaded, 0.0);          // overlaps the red: paler (UV-faded) along the whole upper edge band
  // the upper-edge fade as a thin strip standing on the top edge, and a lower-edge one narrower: the weathering reads at the edges only
  wedge(-0.300, -0.192, [0.0009, 0.0006], [0.0033, 0.0013], V.redFaded, 0.0135);
  wedge(-0.250, -0.192, [0.0009, 0.0004], [0.0033, 0.0009], V.redFaded, -0.0128);
  wedge(-0.215, -0.202, [0.0034, 0.0032], [0.0034, 0.0040], V.scuff, -0.004);          // a tiny scuff on the starboard-facing flank
  // the moulded rib along the head's root, where it meets the arm
  turned(md, [0, 0, -0.205], [0, 0, -0.185], [[0, 0.0085], [0.5, 0.0095], [1, 0.0085]], V.red.c, V.red.mr, 12);
  // the polished tip
  turned(md, [0, 0, -0.350], [0, 0, -0.327], [[0, 0.002], [0.45, 0.0085], [1, 0.0070]], V.bead.c, V.bead.mr, 14);
  // the tail feather: three moulded panels with slots between, each a rounded, tapering fin (tall at the root, a soft
  // point aft, raked up from the arm) with a thin faded upper edge, not a block
  [[0.100, 0.152, 0.056], [0.158, 0.210, 0.046], [0.216, 0.268, 0.034]].forEach(([z0, z1, h], k) => {
    const N = 6, rings = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, z = z0 + (z1 - z0) * t;
      const root = Math.min(1, 0.45 + t * 5);                        // a rounded leading edge (the front corner is eased off)
      const half = (h / 2) * root * (1 - 0.50 * Math.pow(t, 1.6));   // tapers aft
      const lift = (h / 2) * 0.12 * t;                               // the trailing edge rakes up a little
      rings.push({ o: [0, lift, z], a: [0, 0, 1], s: [0.0013 * (1 - 0.35 * t), Math.max(half, 0.0012)] });
    }
    sweepRings(md, rings, sq, V.red.c, V.red.mr, { capStart: true, capEnd: true, hint: [0, 1, 0] });
    const rf = rings.map((r) => ({ o: [0, r.o[1] + r.s[1] - 0.0035, r.o[2]], a: [0, 0, 1], s: [0.0014, 0.0035] }));
    sweepRings(md, rf, sq, V.redFaded.c, V.redFaded.mr, { capStart: true, capEnd: true, hint: [0, 1, 0] });   // the faded top edge
    if (k === 1) turned(md, [0, 0.004, z0 + 0.012], [0, 0.004, z0 + 0.016], [[0, 0.0016], [1, 0.0016]], V.alu.c, V.alu.mr, 8);   // a rivet
  });
  // the pivot: a stainless collar over a dark bushing, and the counterweight (a small stainless barrel) aft
  turned(md, [0, -0.012, 0], [0, 0.012, 0], [[0, 0.0105], [1, 0.0105]], V.steel.c, V.steel.mr, 16);
  turned(md, [0, -0.020, 0], [0, -0.012, 0], [[0, 0.0070], [1, 0.0100]], MAT.dark.c, MAT.dark.mr, 12);
  turned(md, [0, 0, 0.250], [0, 0, 0.292], [[0, 0.0060], [0.12, 0.0105], [0.88, 0.0105], [1, 0.0070]], V.steel.c, V.steel.mr, 14);
  return md;
}
// The fixed part: the base plate with four screws, the stem, and the two reference tabs (red to port, green to starboard)
// on thin stainless rods, each tab with a strip of reflective tape on both faces.
export function vaneTabs() {
  const md = new MeshData(), V = VANE_MAT;
  const r = Math.sin(VANE_REF_DEG * Math.PI / 180), q = Math.cos(VANE_REF_DEG * Math.PI / 180), y = -0.052;
  // the base plate (anodised aluminium, 0.07 m across, 4 mm) with its four screws, on the masthead stick's cap
  disc(md, [0, -0.090, 0], [0, 1, 0], 0.036, 0.004, V.alu.c, V.alu.mr, 20);
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; disc(md, [Math.cos(a) * 0.027, -0.0875, Math.sin(a) * 0.027], [0, 1, 0], 0.0042, 0.002, V.steel.c, V.steel.mr, 8); }
  member(md, [0, -0.088, 0], [0, y, 0], 0.0075, 0.0075, MAT.dark.c, MAT.dark.mr, 10);   // the stem
  disc(md, [0, y, 0], [0, 1, 0], 0.015, 0.012, V.alu.c, V.alu.mr, 16);                  // the hub the rods thread into
  for (const s of [-1, 1]) {
    const dir = [s * r, 0, -q], tip = mul(dir, 0.235), col = s < 0 ? V.red2 : V.green;
    member(md, mul(dir, 0.010), tip, 0.0022, 0.0022, V.steel.c, V.steel.mr, 8);      // the thin stainless rod
    const t0 = add(tip, mul(dir, -0.034)), t1 = add(tip, mul(dir, 0.010));
    box(md, t0, t1, 0.0030, 0.072, col.c, col.mr, [0, 1, 0]);                         // the tab: a small moulded flag standing up
    // reflective tape: a pale strip across the tab, on both faces (6 mm proud of nothing: 0.4 mm)
    for (const f of [-1, 1]) {
      const n = [dir[2] * f, 0, -dir[0] * f];   // the face normal, horizontal
      box(md, add(add(t0, mul(dir, 0.004)), mul(n, 0.0017)), add(add(t1, mul(dir, -0.004)), mul(n, 0.0017)), 0.0004, 0.012, V.tape.c, V.tape.mr, [0, 1, 0]);
    }
  }
  return md;
}

// ---- spreaders --------------------------------------------------------------------------------------------------
export function spreaderFittings(md, rig, side, i, root, tip) {
  const ax = norm(sub(tip, root));
  // the root casting: a tapered socket on a base plate riveted to the mast side
  plate(md, add(root, mul(ax, -0.006)), [side, 0, 0], [0, 1, 0], 0.07, 0.045, 0.006, CAST.c, CAST.mr);
  sweepRings(md, [{ o: root, a: ax, s: [0.040, 0.020] }, { o: add(root, mul(ax, 0.09)), a: ax, s: [0.034, 0.014] }], oval(12, 0.8), CAST.c, CAST.mr,
    { capStart: true, hint: [0, 1, 0] });
  // the tip clamp the shroud passes through, then the boot: a rounded PVC sleeve taped on (two tape wraps)
  const t0 = add(tip, mul(ax, -0.10)), t1 = add(tip, mul(ax, 0.035));
  turned(md, t0, t1, [[0, 0.020], [0.08, 0.030], [0.5, 0.034], [0.9, 0.030], [1, 0.014]], MAT.boot.c, MAT.boot.mr, 14, [0, 1, 0]);
  const tape = { c: srgb(0xD6D3CB), mr: [0, 0.45] };
  for (const f of [0.05, 0.16]) turned(md, lerp(t0, t1, f - 0.04), lerp(t0, t1, f + 0.04), [[0, 0.031], [1, 0.031]], tape.c, tape.mr, 14, [0, 1, 0]);
}

// ---- chainplates and rigging screws -----------------------------------------------------------------------------
// Returns the height along the wire (m) where the wire's swage ends: the wire starts there.
export const RIGSCREW_LEN = 0.24;
export function rigScrew(md, a, d) {
  // the chainplate: a stainless strap out of the deck with a cover plate, its pin hole at a + 0.035
  const cz = cross(d, [0, 0, 1]);
  const across = len(cz) > 1e-3 ? norm(cz) : [1, 0, 0];
  box(md, add(a, [0, -0.012, 0]), add(a, [0, 0.045, 0]), 0.008, 0.040, MAT.steel.c, MAT.steel.mr, [0, 0, 1]);
  plate(md, add(a, [0, -0.010, 0]), [0, 1, 0], [0, 0, 1], 0.06, 0.035, 0.004, MAT.steel.c, MAT.steel.mr);
  const at = (h) => add(a, mul(d, h));
  // the toggle: a fork round the strap and a pin
  for (const s of [-1, 1]) box(md, add(at(0.025), mul(across, s * 0.010)), add(at(0.06), mul(across, s * 0.010)), 0.004, 0.026, MAT.steel.c, MAT.steel.mr, across);
  disc(md, at(0.035), across, 0.005, 0.032, MAT.steel.c, MAT.steel.mr, 8);
  turned(md, at(0.055), at(0.07), [[0, 0.012], [1, 0.010]], MAT.steel.c, MAT.steel.mr, 10);
  // the lower stud, the open body (two side bars, end bosses), the upper stud
  member(md, at(0.07), at(0.10), 0.0055, 0.0055, MAT.steel.c, MAT.steel.mr, 8);
  turned(md, at(0.095), at(0.11), [[0, 0.011], [1, 0.011]], MAT.steel.c, MAT.steel.mr, 12);
  turned(md, at(0.175), at(0.19), [[0, 0.011], [1, 0.011]], MAT.steel.c, MAT.steel.mr, 12);
  const [, u] = frame(d, [0, 0, 1]);
  for (const s of [-1, 1]) member(md, add(at(0.105), mul(u, s * 0.010)), add(at(0.18), mul(u, s * 0.010)), 0.0035, 0.0035, MAT.steel.c, MAT.steel.mr, 6);
  member(md, at(0.185), at(0.205), 0.0055, 0.0055, MAT.steel.c, MAT.steel.mr, 8);
  // the wire's swage terminal, tapering into the wire
  turned(md, at(0.20), at(RIGSCREW_LEN), [[0, 0.0065], [0.75, 0.0060], [1, 0.0040]], MAT.steel.c, MAT.steel.mr, 10);
}

// ---- the furler ---------------------------------------------------------------------------------------------------
// The drum in its own frame (origin on the stay at the drum's centre, +Y up the stay), so the features engineer can turn
// it about +Y as the line pays out. Also returns where it sits.
export function furler(rig) {
  const S = rig.S, f = rig.forestayAt;
  const vTop = (S.drumTop - S.stem[1]) / (f(1)[1] - f(0)[1]);
  const p0 = f(0.0), p1 = f(vTop), axis = norm(sub(f(1), f(0)));
  const L = len(sub(p1, p0));
  const at = lerp(p0, p1, 0.45);
  const md = new MeshData();
  const y = (h) => [0, h - L * 0.45, 0];
  // the line drum between two flanges, a few turns of the furling line on it, the guard's rods
  turned(md, y(L * 0.18), y(L * 0.62), [[0, 0.070], [0.06, 0.072], [0.10, 0.040], [0.90, 0.040], [0.94, 0.072], [1, 0.070]], MAT.dark.c, MAT.dark.mr, 24);
  const rope = { c: srgb(0x3B4A5E), mr: [0, 0.8] };
  for (let k = 0; k < 5; k++) ring(md, y(L * (0.26 + 0.07 * k)), [0, 1, 0], 0.046, 0.0045, rope.c, rope.mr, 20, 5);
  return { drum: md, at, axis, L, p0, p1 };
}
// The furler's fixed parts (in the mast group): the link plates and toggle at the stem fitting, the drum's cage and
// the line guide, the torque tube up to the tack swivel.
export function furlerFixed(md, rig, fu) {
  const { p0, p1, axis, L } = fu;
  const at = (t) => lerp(p0, p1, t);
  for (const s of [-1, 1]) box(md, add(at(0.0), [s * 0.010, 0, 0]), add(at(0.18), [s * 0.010, 0, 0]), 0.004, 0.030, MAT.steel.c, MAT.steel.mr, [1, 0, 0]);
  disc(md, at(0.04), [1, 0, 0], 0.006, 0.030, MAT.steel.c, MAT.steel.mr, 8);
  // the cage: four rods round the drum, a ring top and bottom
  const [, u, v] = frame(axis, [1, 0, 0]);
  for (const t of [0.16, 0.64]) ring(md, at(t), axis, 0.085, 0.004, MAT.steel.c, MAT.steel.mr, 24, 5);
  for (let k = 0; k < 4; k++) {
    const d = add(mul(u, Math.cos((k + 0.5) * Math.PI / 2) * 0.085), mul(v, Math.sin((k + 0.5) * Math.PI / 2) * 0.085));
    member(md, add(at(0.16), d), add(at(0.64), d), 0.004, 0.004, MAT.steel.c, MAT.steel.mr, 6);
  }
  // the line guide: a stainless arm out to starboard-aft with a fairlead eye (the line leaves toward the cockpit)
  const g0 = at(0.40), g1 = add(at(0.40), [0.12, -0.01, 0.05]);
  member(md, g0, g1, 0.005, 0.005, MAT.steel.c, MAT.steel.mr, 6);
  ring(md, g1, [0.92, 0, 0.38], 0.012, 0.004, MAT.steel.c, MAT.steel.mr, 12, 5);
  // the torque tube and the tack swivel on top (the jib's tack shackles to it)
  turned(md, at(0.64), at(1.0), [[0, 0.030], [0.15, 0.024], [0.85, 0.024], [1, 0.030]], MAT.alu.c, MAT.alu.mr, 16);
  turned(md, at(0.96), add(at(1.0), mul(axis, 0.03)), [[0, 0.040], [1, 0.036]], MAT.alu.c, MAT.alu.mr, 18);
  return { guide: g1 };
}

// ---- the boom's fittings ------------------------------------------------------------------------------------------
export function boomFittings(boom, rig, { sheetAt, vangAt }) {
  const S = rig.S, B = S.boom;
  const hw = B.width / 2, hd = B.depth / 2;
  // the gooseneck: the boom's front casting, the hinge knuckles and the vertical pin on the mast's fitting
  sweepRings(boom, [-0.02, 0.07].map((z) => ({ o: [0, 0, z], a: [0, 0, 1], s: [hw + 0.006, hd + 0.006] })), oval(16, 0.7), CAST.c, CAST.mr,
    { capStart: true, hint: [0, 1, 0] });
  for (const y of [-0.035, 0.035]) box(boom, [0, y, -0.11], [0, y, -0.02], 0.05, 0.022, CAST.c, CAST.mr, [0, 1, 0]);
  member(boom, [0, -0.06, -0.085], [0, 0.06, -0.085], 0.009, 0.009, MAT.steel.c, MAT.steel.mr, 8);
  // the reef lines and the outhaul leave the boom's front through three sheave slots underneath
  for (const x of [-0.02, 0, 0.02]) disc(boom, [x, -hd - 0.004, 0.10], [1, 0, 0], 0.018, 0.006, SHEAVE.c, SHEAVE.mr, 10);
  // the end casting: a cap that follows the boom's own section (a "snout" read as a separate oversized part), rounding
  // off over its last 30 mm; three sheave slots through its sides (the outhaul and two reef pennants), each a dark
  // slot with the sheave's edge and its stainless pin; the topping lift's eye on top
  const e = B.length;
  sweepRings(boom, [{ o: [0, 0, e - 0.17], a: [0, 0, 1], s: [hw + 0.003, hd + 0.003] }, { o: [0, 0, e - 0.02], a: [0, 0, 1], s: [hw + 0.003, hd + 0.003] },
    { o: [0, 0, e + 0.005], a: [0, 0, 1], s: [hw * 0.82, hd * 0.82] }, { o: [0, 0, e + 0.014], a: [0, 0, 1], s: [hw * 0.45, hd * 0.45] }],
    oval(16, 0.7), CAST.c, CAST.mr, { capEnd: true, hint: [0, 1, 0] });
  for (const [z, y] of [[e - 0.115, 0.028], [e - 0.07, -0.002], [e - 0.115, -0.032]]) {
    for (const sx of [-1, 1]) {
      box(boom, [sx * (hw + 0.0035), y, z - 0.026], [sx * (hw + 0.0035), y, z + 0.026], 0.002, 0.013, SHEAVE.c, SHEAVE.mr, [1, 0, 0]);
      disc(boom, [sx * (hw + 0.0045), y, z], [1, 0, 0], 0.0045, 0.002, MAT.steel.c, MAT.steel.mr, 8);
    }
  }
  ring(boom, [0, hd + 0.022, e - 0.03], [1, 0, 0], 0.014, 0.004, MAT.steel.c, MAT.steel.mr, 12, 5);
  // the outhaul car on the boom's top, where the clew sits, with its shackle
  box(boom, [0, hd + 0.012, e - 0.34], [0, hd + 0.012, e - 0.22], 0.05, 0.022, MAT.dark.c, MAT.dark.mr, [0, 1, 0]);
  ring(boom, [0, hd + 0.045, e - 0.28], [1, 0, 0], 0.016, 0.004, MAT.steel.c, MAT.steel.mr, 12, 5);
  // the mainsheet bail and a double block hanging from it (cheeks, two sheaves, the swivel)
  member(boom, [0, -hd - 0.006, sheetAt - 0.04], [0, -hd - 0.006, sheetAt + 0.04], 0.020, 0.010, MAT.steel.c, MAT.steel.mr, 8);
  member(boom, [0, -hd - 0.012, sheetAt], [0, -hd - 0.045, sheetAt], 0.008, 0.008, MAT.steel.c, MAT.steel.mr, 8);
  for (const sx of [-1, 0, 1]) plate(boom, [sx * 0.019, -hd - 0.09, sheetAt], [1, 0, 0], [0, 1, 0], 0.045, 0.034, 0.004, MAT.steel.c, MAT.steel.mr);
  for (const sx of [-0.5, 0.5]) disc(boom, [sx * 0.019, -hd - 0.09, sheetAt], [1, 0, 0], 0.030, 0.012, SHEAVE.c, SHEAVE.mr, 16);
  // the vang: its bail and the rigid vang's top fitting
  member(boom, [0, -hd - 0.006, vangAt - 0.04], [0, -hd - 0.006, vangAt + 0.04], 0.020, 0.010, MAT.steel.c, MAT.steel.mr, 8);
}

// ---- the lazy bag -------------------------------------------------------------------------------------------------
// Two panels along the boom's top, flared out and up, sagging between the lazy-jack points (where the lines hold their
// top edge up), a zip along the top edge in the trim colour, vertical seams, grime toward the foot and the ends. The old
// bag was two flat quads per side in one colour: from below at the helm it read as an untraced flat grey patch.
export const BAG = { z0: 0.18, z1: -0.25, jacks: [0.95, 1.95, 2.80], hMax: 0.30, wMax: 0.19 };
export function lazyBag(boom, rig) {
  const S = rig.S, B = S.boom;
  const z0 = BAG.z0, z1 = B.length + BAG.z1, nz = 36, nv = 5;
  const C = MAT.canvas.c, trim = srgb(0x27324A);
  const shade = (k) => C.map((c) => c * k);
  for (const side of [1, -1]) {
    const idx = [];
    for (let j = 0; j <= nz; j++) {
      const z = z0 + (z1 - z0) * (j / nz);
      const t = Math.sin(Math.PI * Math.min(1, (j / nz) * 1.25)) ** 0.5;
      // the top edge sags between the jacks' points (held up there), up to 40 mm
      const dj = Math.min(...BAG.jacks.map((zj) => Math.abs(z - zj)));
      const sag = 0.04 * Math.min(1, dj / 0.45) ** 1.5;
      const h = (0.09 + (BAG.hMax - 0.09) * t) - sag, w = 0.05 + (BAG.wMax - 0.05) * t;
      const row = [];
      for (let i = 0; i <= nv; i++) {
        const v = i / nv;
        // the panel bellies out a little between its foot and its top edge
        const belly = 0.025 * Math.sin(Math.PI * v) * t;
        const p = [side * (B.width * 0.45 + (w - B.width * 0.45) * v + belly), B.depth / 2 + h * v, z];
        // the normal: across the panel's slope, outward
        const n = norm([side * h, -(w - B.width * 0.45) * 1, 0]);
        // tone: a seam every 0.8 m, grime at the foot and the ends, the zip's trim along the top
        const seam = Math.abs(((z - z0) % 0.8) - 0.4) > 0.385 ? 0.74 : 1;
        const grime = 0.86 + 0.14 * Math.min(1, v * 2.2) * (0.85 + 0.15 * t);
        const col = i === nv ? trim : shade(seam * grime);
        row.push([boom.vert(p, n, col, MAT.canvas.mr), boom.vert(p, mul(n, -1), shade(0.55 * grime), MAT.canvas.mr)]);
      }
      idx.push(row);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nv; i++) {
      const [a0, a1] = idx[j][i], [b0, b1] = idx[j][i + 1], [c0, c1] = idx[j + 1][i + 1], [d0, d1] = idx[j + 1][i];
      if (side > 0) { boom.tri(a0, b0, c0); boom.tri(a0, c0, d0); boom.tri(a1, c1, b1); boom.tri(a1, d1, c1); }
      else { boom.tri(a0, c0, b0); boom.tri(a0, d0, c0); boom.tri(a1, b1, c1); boom.tri(a1, c1, d1); }
    }
  }
}
// Where a lazy jack meets the bag's top edge (boom frame), for the lines (lines.js).
export function bagTop(rig, zj, side) {
  const S = rig.S, B = S.boom;
  const z0 = BAG.z0, z1 = B.length + BAG.z1;
  const j = (zj - z0) / (z1 - z0);
  const t = Math.sin(Math.PI * Math.min(1, Math.max(0, j) * 1.25)) ** 0.5;
  return [side * (0.05 + (BAG.wMax - 0.05) * t), B.depth / 2 + 0.09 + (BAG.hMax - 0.09) * t, zj];
}
