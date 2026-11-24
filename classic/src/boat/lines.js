// Lakeshore running rigging (M7): the main sheet tackle, the jib sheets (the working one tight to leeward, the lazy one
// slack to windward), the halyards. Catenary-ish polylines between points the sail state moves (rig.js), drawn as
// screen-space ribbons: at least 1 px wide, with the opacity set to the rope's true coverage, so an 8 mm line seen
// from 50 m (≈ 0.3 px) reads as a faint steady line instead of flickering in and out. Near the camera (boat detail
// step 1: inside 15 m of the hull on High and Balanced, 6 m on Low; src/boat/rope.js) the lines the helm eye sees from
// 1–4 m are real rope instead (tubes with a braided cover): the sheets with their turns on the winch drums and their tails,
// the mainsheet tackle, the halyards aft of the mast with their wraps and tails, the reef lines, the coils.
//
//   boat.attach('lines', makeLines({ camera, origin: boat, nearM }));   // RIG frame; Boat.update calls lines.update(state, dt, env)
//   makeLines()   no camera: the ribbons only (the rival boats, the tests)
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, float, vec2, vec3, vec4, varying, max, mix, abs, sin, asin, clamp, sqrt, fract, smoothstep, fwidth, normalize,
  cameraProjectionMatrix, modelViewMatrix, screenSize,
} from 'three/tsl';
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { sailParams, boomPoint, jibClew, mainPoint, outsideMain, insideMain, offMast, LUFF_Z, GOOSENECK_PIN } from '../../../src/boat/rig.js';
import { COCKPIT as CK, trackY, toRig } from '../../../src/boat/cockpitPoints.js';
import { SPARS, solveRig, buildSpars } from '../../../src/boat/spars.js';
import { bagTop, BAG } from '../../../src/boat/spars-detail.js';
import { winchWrap, createRopeMesh, ropeLod, ROPE_NEAR } from './rope.js';

// the rig's and the deck's numbers: this page's boat (its profile, src/vessels/current.js); the line set is per page
const { RIG, HULL } = DEFAULT_DIMS;
const SEGS = 24;                 // points per line
// Deck heights in the RIG frame (origin at the mast step on the cabin top, dims.js).
// DECK_LOW: a floor under the crowned cabin top's sides (the leads' own points sit on the deck there)
const DECK_LOW = -0.25;
const CABIN = 0, SIDE = HULL.sideDeckY - HULL.mastStepY, COCKPIT = HULL.sternDeckY - HULL.mastStepY + 0.35;
// Fixed points (RIG frame), the Catalina 28 layout: mid-boom sheeting
// to a traveller on the cabin top forward of the companionway; jib cars on the side decks; the two sheet winches on
// the cockpit coamings; the halyards and the boom's control lines led aft from turning blocks at the mast base through
// an organiser and the clutches to the halyard winches either side of the companionway. The cockpit's points come from
// its Blender build (models/boat/cockpit.json via cockpitPoints.js), so the lines meet the hardware (hero pass).
const TRAV_HULL_Z = CK.traveller[2];
export const DECKPTS = {
  // the fiddle block's sheaves on the traveller car (≈ 0.10 m over the track's top), the car's x along the crowned track
  traveller: (x) => toRig([x, (trackY(x) ?? HULL.mastStepY + 0.04) + 0.10, TRAV_HULL_Z]),
  jibCar: (sx, lead = 0) => [sx * 1.22, SIDE + 0.04, 0.55 + 0.3 * lead],   // pro: the lead's car, ± 0.3 m along the track (+ aft)
  winch: (sx) => toRig(CK.winch(sx)),
  halyardWinch: (sx) => toRig(CK.halyardWinch(sx)),
  halyardStop: (sx) => toRig(CK.clutches(sx)[1]),
  clutch: (sx, k) => toRig(CK.clutches(sx)[k]),
  organiser: (sx, k) => toRig(CK.organiser(sx)[k]),
  mastBlock: (sx, k) => toRig(CK.mastBlocks(sx)[k]),
};
const RIGPTS = solveRig(SPARS);
const FURL_GUIDE = buildSpars(RIGPTS).furler.guide;   // the furler drum's line guide (spars-detail.js)
// The winches' drums, tailers and strippers (blender/m3_hero.py winch(): a primary is s = 1, a halyard winch 0.8), from the
// drum's point in cockpit.json (0.10 s over the base): the turns from 0.065 to 0.12 s over the base, the rope's centre a
// rope's radius off the drum (r 0.052 s), the tailer's groove at 0.152 s; the stripper arm's tip 0.105 s out toward the
// cockpit's centreline, 0.146 s up, 0.02 s aft. sx: the winch's side (+1 starboard).
const WINCH = (s) => ({ r: 0.052 * s + 0.005, y0: -0.035 * s, y1: 0.020 * s, tailer: { y: 0.052 * s, r: 0.062 * s } });
const stripperExit = (sx) => (sx > 0 ? Math.PI : 0);   // the angle in the x–z plane toward the centreline
const stripperTip = (c, sx, s) => [c[0] - sx * 0.105 * s, c[1] + 0.046 * s, c[2] + 0.02 * s];
// a point in the boom's frame (origin at the gooseneck pin, +z aft) → the RIG frame, for a boom angle (rad)
const onBoom = (p, rad) => [GOOSENECK_PIN[0] + p[0] * Math.cos(rad) + p[2] * Math.sin(rad), GOOSENECK_PIN[1] + p[1], GOOSENECK_PIN[2] - p[0] * Math.sin(rad) + p[2] * Math.cos(rad)];

// A coil (a tail made up and hung, or flaked down): `turns` loops of radius r round c, in the plane normal to n, each
// loop a little offset along −y by `drop`: a polyline.
export function coil(c, r, n, turns = 4, per = 14, drop = 0.012) {
  const l = Math.hypot(...n) || 1, nn = n.map((v) => v / l);
  const ref = Math.abs(nn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [ref[1] * nn[2] - ref[2] * nn[1], ref[2] * nn[0] - ref[0] * nn[2], ref[0] * nn[1] - ref[1] * nn[0]];
  const ul = Math.hypot(...u); for (let i = 0; i < 3; i++) u[i] /= ul;
  const v = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
  const out = [];
  for (let k = 0; k <= turns * per; k++) {
    const t = (k / per) * 2 * Math.PI, w = k / per, rr = r * (1 + 0.06 * Math.sin(w * 2.3));
    out.push([0, 1, 2].map((i) => c[i] + rr * (Math.cos(t) * u[i] + Math.sin(t) * v[i]) - (i === 1 ? w * drop : 0)));
  }
  return out;
}

// A sagging line from a to b: `slack` is the extra length as a share of the span (0 = tight); a parabola in −y,
// resting on `floor` where it would sag below it.
export function sag(a, b, slack, n = SEGS, floor = SIDE + 0.02) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const d = L * Math.sqrt(3 * Math.max(slack, 0) / 8);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const y = a[1] + (b[1] - a[1]) * f - 4 * d * f * (1 - f);
    out.push([a[0] + (b[0] - a[0]) * f, Math.max(y, floor), a[2] + (b[2] - a[2]) * f]);
  }
  return out;
}
// A polyline through several legs (each leg sagged on its own), the joints shared.
const legs = (pts, slacks, floor) => pts.slice(1).flatMap((p, i) =>
  sag(pts[i], p, slacks[i] ?? 0, Math.max(4, Math.round(SEGS / (pts.length - 1))), floor).slice(i ? 1 : 0));

// The traveller car's athwartships position (m, RIG and HULL x, + starboard) for a boom angle (rad): the car follows
// the boom's block, inside the track's ends (cockpit.json: 1.16 m of travel). The cockpit GLB's `traveller_car` is
// moved here too (assemble.js), so the car and the tackle agree.
// pro: trav −1 … +1 (state.traveller; + up to windward) moves the car up to 0.35 m off the boom's block, to windward or leeward.
export const travellerCarX = (boomRad, trav = 0) => Math.max(-0.58, Math.min(0.58, boomPoint(boomRad, DECKPTS.traveller(0)[2] - 0.12)[0] * 0.6 - (Math.sign(boomRad) || 1) * 0.35 * trav));

// The working jib sheet's tail off its winch ('s team list: the sheet tail moves with W/S): it lies aft along
// the coaming, longer the harder the sheet is in (0.25 m eased right out, 1.0 m hauled in: the rope comes off the
// drum); while W hauls it lifts and goes taut toward the trimmer's hand, while S eases it snakes back into the winch.
// haul: −1 (easing) … +1 (hauling at the full rate). The winch drums are merged into cockpit.glb's material meshes,
// so they do not turn (a Blender re-export with the drums as their own nodes would let them).
const TAIL = { min: 0.25, max: 1.0, sheetIn: 12 * Math.PI / 180, sheetOut: 80 * Math.PI / 180 };
// from: the points the tail starts with (near: the wrap's end in the tailer, then the stripper's tip), else the crown's top
export function sheetTail(state, work, haul = 0, t = 0, { from = null } = {}) {
  const sh = state.mainSheet > 0 ? state.mainSheet : 45 * Math.PI / 180;
  const inn = Math.max(0, Math.min(1, (TAIL.sheetOut - sh) / (TAIL.sheetOut - TAIL.sheetIn)));
  const L = TAIL.min + (TAIL.max - TAIL.min) * inn, h = Math.max(-1, Math.min(1, haul));
  const w = DECKPTS.winch(work), pull = Math.max(0, h), ease = Math.max(0, -h);
  const top = [w[0], w[1] + 0.07, w[2] + 0.02];
  const lay = [w[0] - work * 0.06, w[1] - 0.1 + 0.12 * pull, w[2] + 0.22];
  const end = [w[0] - work * (0.1 + 0.08 * pull), w[1] - 0.1 + 0.3 * pull, w[2] + 0.22 + L];
  const head = from ?? [top];
  const pts = legs([...head, lay, end], [...head.slice(1).map(() => 0), 0.02 * (1 - pull), 0.015 * (1 - pull)], w[1] - 0.12);
  // easing: a small travelling wave along the lying tail as it runs back into the winch
  return ease > 0 ? pts.map((q, i) => (i < 3 ? q : [q[0] + work * 0.02 * ease * Math.sin(i * 1.3 + t * 9), q[1], q[2]])) : pts;
}

// The line set for one physics state (contract.js STATE): [{ name, points, diameterM, color }], RIG frame.
// Colours: the art bible (sheets off-white #E8E4DA, halyards one muted colour each #4A5A70 / #6B7A5A).
// opts.haul: the sheet's motion (sheetTail above). opts.near: the set the rope tubes draw (makeLines' near LOD): the lines
// marked tube: true are drawn as rope, the rest stay ribbons; the sheets carry their turns on the winches, the halyards
// split at the mast's foot (the run up the mast stays a ribbon). Far (the default) is the ribbons' set, unchanged.
export function lineSet(state, t = 0, { haul = 0, near = false } = {}) {
  const tube = near, cper = near ? 12 : 20;   // a coil's points per turn (and the tackle's points): tubes need fewer
  const p = sailParams(state);
  const out = [];
  // Main sheet: a 4-part tackle between a block on the boom above the traveller and the traveller car.
  const blk = boomPoint(p.main.boomRad, RIGPTS.points.bails.mainsheet);   // the double block under the boom's bail
  blk[1] -= 0.16;
  const car = DECKPTS.traveller(travellerCarX(p.main.boomRad, p.main.trav ?? 0));
  const eased = Math.min(1, Math.abs(p.main.boomRad) / 1.1);
  for (let k = 0; k < 4; k++) {
    const o = (k - 1.5) * 0.018;
    out.push({ name: `mainsheet-${k}`, points: sag([blk[0] + o, blk[1], blk[2]], [car[0] + o, car[1], car[2]], 0.002 + 0.012 * eased + 0.006 * (1 - p.main.fill), near ? 10 : SEGS, CABIN), diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d, tube });
  }
  // the tail: out of the fiddle block's cam cleat (aft of the car), down to the cabin top, flaked in a coil beside the track
  const camOut = [car[0], car[1] - 0.05, car[2] + 0.06], coilAt = [car[0] * 0.5 + 0.22, CABIN + 0.015, car[2] + 0.24];
  const mcoil = coil(coilAt, 0.10, [0, 1, 0], 4, cper, -0.004);
  out.push({ name: 'mainsheet-tail', points: [...(near ? sag(camOut, mcoil[0], 0.08, 12, CABIN) : legs([camOut, mcoil[0]], [0.08], CABIN)), ...mcoil.slice(1)], diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d, tube });
  // Jib sheets from the clew: the working sheet to leeward, tight through its car to the winch; the lazy one slack
  // to windward, around the mast's front over the cabin top.
  const clew = jibClew(p.jib, t);
  const work = (Math.sign(p.jib.sheetRad) || -1);
  const wcar = DECKPTS.jibCar(work, p.jib.lead ?? 0), ww = DECKPTS.winch(work);
  if (!near) {
    out.push({ name: 'jibsheet-working', points: legs([clew, wcar, ww], [0.003 + 0.012 * (1 - p.jib.fill), 0.01]), diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d });
    out.push({ name: 'jibsheet-tail', points: sheetTail(state, work, haul, t), diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d });
  } else {
    // near: three turns on the drum from the car's side, up into the tailer, the tail out over the stripper (plan 41 A1)
    const wrap = winchWrap(ww, wcar, { ...WINCH(1), turns: 3, exit: stripperExit(work) });
    out.push({ name: 'jibsheet-working', points: [...legs([clew, wcar, wrap[0]], [0.003 + 0.012 * (1 - p.jib.fill), 0.004]), ...wrap.slice(1)], diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d, tube });
    out.push({ name: 'jibsheet-tail', points: sheetTail(state, work, haul, t, { from: [wrap[wrap.length - 1], stripperTip(ww, work, 1)] }), diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d, tube });
  }
  const lazyPts = legs([clew, [0, CABIN + 0.04, -0.3], [-work * 0.45, CABIN + 0.03, 0.4], DECKPTS.jibCar(-work), DECKPTS.winch(-work)], [0.04, 0.02, 0.03, 0.02], CABIN)
    .map((q, i, arr) => (i === 0 || i === arr.length - 1 ? q : [q[0], Math.max(q[1], Math.abs(q[0]) > 0.9 ? SIDE + 0.02 : CABIN + 0.02), q[2]]));
  if (near) {
    // the lazy sheet's two turns on its idle drum (its last point on the drum's tangent instead of its axis)
    const lwrap = winchWrap(DECKPTS.winch(-work), DECKPTS.jibCar(-work), { ...WINCH(1), turns: 2, exit: stripperExit(-work) });
    lazyPts.splice(lazyPts.length - 1, 1, lwrap[0]); lazyPts.push(...lwrap.slice(1));
  }
  out.push({ name: 'jibsheet-lazy', points: lazyPts, diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d, tube });
  // the lazy sheet's tail, coiled on its idle winch's self-tailer
  const lw = DECKPTS.winch(-work);
  out.push({ name: 'jibsheet-lazy-coil', points: coil([lw[0], lw[1] + 0.035, lw[2]], 0.085, [0, 1, 0], 3, cper, 0.01), diameterM: 0.010, color: 0xe8e4da, tracer: 0x2b345d, tube });
  // Halyards and the boom's control lines: down to the turning blocks at the mast base, aft through the organiser and
  // the clutches; the halyards on to their winches, their tails coiled and hung on the winch. Colours: one muted colour
  // each (art bible §2), no bright red or yellow.
  const mh = mainPoint(0, 1, p.main);
  const aft = (sx, k) => [DECKPTS.mastBlock(sx, k), DECKPTS.organiser(sx, k), DECKPTS.clutch(sx, k)];
  const byMain = (pts) => pts.map((q) => outsideMain(q.slice(), p.main));   // the main's belly presses the line out (rig.js)
  const halyard = (name, top, sx, k, color) => {
    const exit = [sx * 0.03, CABIN + 0.32, LUFF_Z + 0.01];
    const w = DECKPTS.halyardWinch(sx), wIn = [w[0] - sx * 0.07, w[1] + 0.02, w[2] - 0.02];
    const hc = coil([w[0] - sx * 0.19, w[1] - 0.065, w[2] - 0.20], 0.10, [0, 1, 0], 4, cper, -0.004);
    // the run down the mast at full resolution, so the points the main's belly moves out follow its curve
    const mast = byMain(sag(top, exit, 0.0005, SEGS, DECK_LOW));
    if (!near) out.push({ name, points: [...mast, ...legs([exit, ...aft(sx, k), wIn], [0.005, 0.004, 0.003, 0.004], DECK_LOW).slice(1)], diameterM: 0.009, color });
    else {
      // near: the run up the mast stays a ribbon; from the mast's foot aft it is rope, three turns on its winch, the tail
      // out over the stripper and down to its coil
      const a = aft(sx, k), wrap = winchWrap(w, a[2], { ...WINCH(0.8), turns: 3, exit: stripperExit(sx) });
      out.push({ name, points: mast, diameterM: 0.009, color });
      out.push({ name: `${name}-deck`, points: [...legs([exit, ...a, wrap[0]], [0.005, 0.004, 0.003, 0.004], DECK_LOW), ...wrap.slice(1)], diameterM: 0.009, color, tube });
      out.push({ name: `${name}-tail`, points: legs([wrap[wrap.length - 1], stripperTip(w, sx, 0.8), hc[0]], [0, 0.05], hc[0][1]), diameterM: 0.009, color, tube });
    }
    // the tail made up and laid flat on the cabin top, inboard and forward of its winch
    out.push({ name: `${name}-coil`, points: hc, diameterM: 0.009, color, tube });
  };
  halyard('main-halyard', [0.03, mh[1] + 0.15, LUFF_Z + 0.01], 1, 0, 0x4a5a70);
  halyard('jib-halyard', [-0.03, RIG.head[1] + 0.1, LUFF_Z + 0.01], -1, 0, 0x6b7a5a);
  // reef pennants and the outhaul: out of the boom's front underside, down to the blocks, aft to their clutches, a tail
  const front = (dx) => onBoom([dx, -SPARS.boom.depth / 2 - 0.01, 0.10], p.main.boomRad);
  const ctl = (name, dx, sx, k, color) => {
    const c = DECKPTS.clutch(sx, k);
    out.push({ name, points: legs([front(dx), ...aft(sx, k), [c[0], CABIN + 0.012, c[2] + 0.30]], [0.01, 0.004, 0.003, 0.02], DECK_LOW), diameterM: 0.008, color, tube });
  };
  ctl('reef-1', -0.02, 1, 1, 0x7a5c4a);
  ctl('reef-2', 0.0, 1, 2, 0x5c6a72);
  ctl('outhaul', 0.02, -1, 1, 0x8a8270);
  out.push({ name: 'topping-lift', points: sag([0, RIG.mastTop - 0.05, LUFF_Z + 0.05], boomPoint(p.main.boomRad, RIG.boom - 0.05), 0.004, SEGS, CABIN), diameterM: 0.006, color: 0xe8e4da });   // reference §15: masthead to the boom end, slack while the main is up
  // the lazy jacks: from the mast under the lower spreaders, through a ring, to the bag's top edge (spars-detail BAG);
  // held inside the main's belly off the mast (rig.js insideMain: the leeward ones ran into the cloth ≈ 0.2 m aft of it)
  // (the first leg gets points 2–12 cm off the mast, so the one crossing stays at the luff groove, inside the mast's width)
  const jack = (pts, from = 1) => (from ? offMast(pts) : pts).map((q, i) => (i < from ? q : insideMain(q.slice(), p.main, 0.02)));
  for (const sx of [1, -1]) {
    const m0 = [sx * 0.06, RIG.spreaders[0].y - 0.15, 0.04], m1 = [sx * 0.06, RIG.spreaders[0].y - 0.65, 0.05];
    const bag = BAG.jacks.map((zj) => onBoom(bagTop(RIGPTS, zj, sx), p.main.boomRad));
    const ringP = onBoom([sx * 0.10, 1.25, (BAG.jacks[1] + BAG.jacks[2]) / 2], p.main.boomRad);
    const n = sx > 0 ? 'S' : 'P';
    out.push({ name: `lazyjack-${n}-a`, points: jack(legs([m0, ringP, bag[1]], [0.002, 0.004], CABIN)), diameterM: 0.005, color: 0x3a3f45 });
    out.push({ name: `lazyjack-${n}-b`, points: jack(legs([ringP, bag[2]], [0.004], CABIN), 0), diameterM: 0.005, color: 0x3a3f45 });
    out.push({ name: `lazyjack-${n}-c`, points: jack(legs([m1, bag[0]], [0.004], CABIN)), diameterM: 0.005, color: 0x3a3f45 });
  }
  // the furling line: from the drum's guide aft along the starboard side deck (fairleads at the stanchion bases) to a
  // cleat at the cockpit's forward end, its tail flaked on the seat
  // fairleads 0.10 m inboard of the sheer (M1's half-beam there: 0.77, 1.19, 1.50 m), a cleat on the side deck by the coaming
  const st = [[0.67, -2.55, 0.03], [1.09, -1.25, 0.0], [1.40, 0.15, 0.0]].map(([x, z, dy]) => toRig([x, HULL.sideDeckY + 0.05 + dy, z]));
  const cleat = toRig([1.42, HULL.sideDeckY + 0.04, 1.62]);
  out.push({ name: 'furling-line', points: legs([FURL_GUIDE, ...st, cleat], [0.02, 0.006, 0.006, 0.006], SIDE + 0.01), diameterM: 0.008, color: 0x3b4a5e, tube });
  out.push({ name: 'furling-coil', points: coil([cleat[0] - 0.14, cleat[1] + 0.012, cleat[2] + 0.12], 0.10, [0, 1, 0], 3, cper, -0.004), diameterM: 0.008, color: 0x3b4a5e, tube });
  return out;
}

// One ribbon mesh for all lines: per point two vertices (side ±1); `other` is the neighbour along the line.
function ribbonGeometry(maxPoints) {
  const g = new THREE.BufferGeometry();
  const n = maxPoints * 2;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('other', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('side', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('diam', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('tracer', new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // the braid's tracer yarn colour
  g.setAttribute('along', new THREE.BufferAttribute(new Float32Array(n), 1));        // metres along the line
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(maxPoints * 6), 1));
  return g;
}

// opts: { camera, origin, nearM }: the camera and the boat (its origin) the rope's switch measures (src/boat/rope.js
// ropeLod); without a camera (or given a Boat, as the rival boats do) the lines stay ribbons
export function makeLines(opts = {}) {
  const { camera = null, origin = null, nearM = ROPE_NEAR.high } = opts?.isObject3D ? {} : (opts ?? {});
  const group = new THREE.Group();
  group.name = 'lines';
  const MAXP = 1536;
  const geo = ribbonGeometry(MAXP);
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, transparent: true, depthWrite: false });
  const coverage = varying(float(1), 'vCoverage');
  mat.vertexNode = Fn(() => {
    const p = attribute('position', 'vec3'), o = attribute('other', 'vec3');
    const side = attribute('side', 'float'), diam = attribute('diam', 'float');
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(p, 1)).toVar();
    const clipO = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(o, 1));
    const aspect = screenSize.x.div(screenSize.y);
    const a = clip.xy.div(clip.w), b = clipO.xy.div(clipO.w);
    const dir = normalize(b.sub(a).mul(vec2(aspect, 1)).add(vec2(1e-6, 0)));
    const nrm = vec2(dir.y.negate(), dir.x).div(vec2(aspect, 1));
    // The rope's projected diameter in pixels; drawn at least 1 px wide, the opacity carries the rest.
    const focalPx = cameraProjectionMatrix.element(1).y.mul(screenSize.y).mul(0.5);
    const px = diam.mul(focalPx).div(clip.w);
    const drawn = max(px, 1.0);
    coverage.assign(px.div(drawn).min(1.0));
    const off = nrm.mul(drawn.div(screenSize.y)).mul(side).mul(clip.w);
    return vec4(clip.xy.add(off), clip.zw);
  })();
  // The braid (a 16-plait cover): two families of yarns spiralling opposite ways round the rope make a herringbone.
  // The ribbon's side (−1 … 1) stands for the angle round the rope, so the yarns wrap; the cylinder darkens toward
  // the edges. A tracer yarn (sheets: navy) shows as a fleck. The pattern fades out once a yarn is under ≈ a pixel.
  const vSide = varying(attribute('side', 'float'), 'vRopeSide');
  mat.colorNode = Fn(() => {
    const base = attribute('color', 'vec3'), tr = attribute('tracer', 'vec3');
    const al = attribute('along', 'float'), d = attribute('diam', 'float');
    const sd = clamp(vSide, -0.999, 0.999), th = asin(sd).div(Math.PI);            // −½ … ½ round the visible half
    const pitch = d.mul(0.85);
    const u1 = fract(al.div(pitch).add(th.mul(4))), u2 = fract(al.div(pitch).sub(th.mul(4)));
    const y1 = sin(u1.mul(Math.PI)), y2 = sin(u2.mul(Math.PI));
    const weave = mix(y1, y2, smoothstep(0.45, 0.55, fract(al.div(pitch).mul(2))));   // over-under alternation
    const fp = fwidth(al).div(pitch);                                                // yarns per pixel along
    const k = float(1).sub(smoothstep(0.35, 0.9, fp));
    const tracer = smoothstep(0.80, 0.92, u1).mul(k);
    const round = sqrt(float(1).sub(sd.mul(sd))).mul(0.45).add(0.55);
    const col = mix(base, tr, tracer.mul(0.85));
    return col.mul(round).mul(mix(float(0.92), weave.mul(0.30).add(0.75), k));
  })();
  mat.opacityNode = coverage;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'running-rigging';
  mesh.frustumCulled = false;
  group.add(mesh);
  // the rope (near): one more draw, shown only inside the switch's distance
  const rope = createRopeMesh();
  // always shown, empty when far: a hidden mesh is left out of the warm-up (src/core/warmup.js), and its first near
  // frame (the helm view, in play) would build its pipeline in the draw
  group.add(rope.mesh);
  const lod = ropeLod(nearM), _o = new THREE.Vector3();

  let count = 0, clock = 0, prevSheet = null, haul = 0, last = null;
  function update(state, dt = 0, env = {}) {
    clock += dt; last = [state, env];
    // the sheet's motion, smoothed over ≈ 0.15 s: + coming in (W), − running out (S); full rate 12°/s in
    if (dt > 0 && prevSheet != null && state.mainSheet > 0) haul += (Math.max(-1, Math.min(1, (prevSheet - state.mainSheet) / dt / (12 * Math.PI / 180))) - haul) * Math.min(1, dt / 0.15);
    if (state.mainSheet > 0) prevSheet = state.mainSheet;
    let near = false;
    if (camera && origin) { origin.getWorldPosition(_o); near = lod.update(_o.distanceTo(camera.position)); }
    const all = lineSet(state, env.t ?? clock, { haul, near });
    const set = near ? all.filter((l) => !l.tube) : all;
    if (near) rope.fill(all.filter((l) => l.tube)); else if (rope.triangles()) rope.clear();
    const pos = geo.attributes.position.array, oth = geo.attributes.other.array, side = geo.attributes.side.array;
    const diam = geo.attributes.diam.array, col = geo.attributes.color.array, idx = geo.index.array;
    const trc = geo.attributes.tracer.array, alg = geo.attributes.along.array;
    let v = 0, ii = 0;
    const c = new THREE.Color(), ct = new THREE.Color();
    for (const line of set) {
      const pts = line.points;
      if (v / 2 + pts.length > MAXP) break;
      c.setHex(line.color); ct.setHex(line.tracer ?? line.color);
      let L = 0;
      for (let i = 0; i < pts.length; i++) {
        const last = i === pts.length - 1;
        const q = last ? pts[i - 1] : pts[i + 1];
        if (i > 0) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
        for (const s of [1, -1]) {
          pos.set(pts[i], v * 3); oth.set(q, v * 3);
          side[v] = last ? -s : s;                  // the neighbour is behind for the last point: flip to keep the side
          diam[v] = line.diameterM;
          col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
          trc[v * 3] = ct.r; trc[v * 3 + 1] = ct.g; trc[v * 3 + 2] = ct.b;
          alg[v] = L;
          v++;
        }
        if (i < pts.length - 1) {
          const a = v - 2, b = v - 1, cc = v, d = v + 1;
          idx[ii++] = a; idx[ii++] = b; idx[ii++] = d; idx[ii++] = a; idx[ii++] = d; idx[ii++] = cc;
        }
      }
    }
    for (const a of ['position', 'other', 'side', 'diam', 'color', 'tracer', 'along']) geo.attributes[a].needsUpdate = true;
    geo.index.needsUpdate = true;
    geo.setDrawRange(0, ii);
    count = all.length;
  }
  group.update = update;
  group.lineCount = () => count;
  group.triangles = () => geo.drawRange.count / 3;   // the ribbons'
  group.ropeTriangles = () => rope.triangles();
  group.ropeNear = () => lod.near;
  // the same state again, for a camera that moved after the boat's update (a capture places its camera after the settle)
  group.refresh = () => { if (last) update(last[0], 0, last[1]); };
  return group;
}
