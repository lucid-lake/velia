// A rental sit-on-top kayak (feat/kayak, K2-kayak-build.md). Not placed in the world:
// the owner wants no empty kayak on the water; the demo stage (stage.js, ?kayak=) shows it, and a paddler comes later.
//
//   const k = createKayak({ colour: 'yellow', wear: 0.35, seed: 1, seatback: true, paddle: 'stowed' });
//   scene.add(k.group);
//   k.setColour('red' | '#RRGGBB' | 'sunset' | 'orange-white')   k.setWear(0..1)   k.setBlade(colour)   uniforms only: no rebuild
//   k.setWaterline(yKayak)           the wet band's height in the kayak frame (the float's draft)
//   k.setSun(dirWorld, colour)       the backlight through the thin plastic
//   k.update(cameraPosition)         the LOD (the small hardware hides past ≈ 40 m; a light shell past 45 m; nearPartsM and
//                                    shellLodM move them: the lake's kayaks, seen from the boat's follow camera, use 60 and 90 m)
//   k.anchors.seat / gripL / gripR   Object3Ds for a paddler: the hips on the seat, the two hands on the shaft
//   k.draft(massKg)                  the floating draft (m over the keel datum) for that all-up mass
//   paddle: 'held'                   the paddle as its own control (k.paddle.group, its frame in parts.js buildHeldPaddle):
//                                    the grip anchors ride on its shaft at x = ±GRIP_HALF; a paddler's rig moves it
//
// Frame: x starboard, y up from the keel's lowest point, z aft; the bow at −z (as the boat's hull frame).
import * as THREE from 'three/webgpu';
import { KAYAK, KAYAK_COLOURS, KAYAK_SCHEMES } from '../../../../src/props/kayak/dims.js';
import { kayakShape, buildShell, waterlineFor, waterlinePlan } from './shape.js';
import { buildParts, buildHeldPaddle } from './parts.js';
import { createKayakMaterials, kayakColour, kayakScheme } from './materials.js';

export { KAYAK, KAYAK_COLOURS, KAYAK_SCHEMES };
const NEAR_PARTS_M = 40, SHELL_LOD_M = 45;
export const GRIP_HALF = 0.35;   // the hands on the shaft: 0.70 m apart (wide, a relaxed low-angle grip; owner 2026-11-07)
const RINGS = [[0.004, 1, 0], [0.09, 0, 0], [0.12, 0, 0], [0.155, 0, 1], [0.22, 0, 0]];   // [offset m, dark, light]

// shared: true reuses one set of built geometries (the shells, the parts, the held paddle, the drafts) for every kayak of
// the same options (the lake's fleet, src/kayaks/: a build costs ≈ 330 ms of shape sampling, a shared one a few ms);
// dispose() then leaves the shared geometries alone
const SHARED = new Map();
function builtGeometry(dims, { seatback, paddle, bag }) {
  const S = kayakShape(dims);
  const hiG = buildShell(S, { rows: 220, hull: 40, roll: 7, deck: 84 });
  const loG = buildShell(S, { rows: 64, hull: 12, roll: 3, deck: 22 });
  const parts = buildParts(S, { seatback, paddle: paddle === 'held' ? 'none' : paddle, bag });
  // grime gathers round every fitting on the deck (a dark ring 2–5 cm out), and the plastic round the handles wears light
  for (const g of [hiG, loG]) {
    const p = g.attributes.position, w = g.attributes.kwear;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = S.unshift(p.getZ(i), y);
      let gr = 0, h = 0;
      for (const [fx, fy, fz, kind] of parts.fittings) {
        const d2 = (x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2;
        if (d2 > 0.01) continue;
        if (kind === 'handle') h = Math.max(h, Math.exp(-d2 / (0.045 ** 2)));
        else gr = Math.max(gr, Math.exp(-d2 / (0.030 ** 2)) * 0.8);
      }
      if (gr > 0) w.setX(i, Math.max(w.getX(i), gr));
      if (h > 0) w.setW(i, Math.max(w.getW(i), h));
    }
  }
  return { S, hiG, loG, parts, held: paddle === 'held' ? buildHeldPaddle(dims) : null, drafts: new Map() };
}

export function createKayak({ colour = 'yellow', wear = 0.35, seed = 1, seatback = true, paddle = 'stowed', blade = '#1A66B4', bag = false, contact = false, dims = KAYAK, shared = false, nearPartsM = NEAR_PARTS_M, shellLodM = SHELL_LOD_M } = {}) {
  const key = shared ? `${dims === KAYAK ? 'K' : JSON.stringify(dims)}|${seatback}|${paddle}|${bag}` : null;
  let G = key ? SHARED.get(key) : null;
  if (!G) { G = builtGeometry(dims, { seatback, paddle, bag }); if (key) SHARED.set(key, G); }
  const S = G.S, parts = G.parts;
  const mats = createKayakMaterials({ colour, wear, seed, blade });
  const group = new THREE.Group(); group.name = 'kayak';
  const hi = new THREE.Mesh(G.hiG, mats.hull);
  const lo = new THREE.Mesh(G.loG, mats.hull);
  hi.name = 'kayak_shell'; lo.name = 'kayak_shell_lod';
  const lod = new THREE.LOD(); lod.addLevel(hi, 0); lod.addLevel(lo, shellLodM); lod.name = 'kayak_lod';
  group.add(lod);
  const near = new THREE.Group(); near.name = 'kayak_hardware';
  const far = new THREE.Group(); far.name = 'kayak_big_parts';
  const add = (geo, mat, name, into) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.name = name; into.add(m); return m; };
  add(parts.nylon, mats.nylon, 'kayak_nylon', near);
  add(parts.cord, mats.cord, 'kayak_cord', near);
  add(parts.hole, mats.hole, 'kayak_holes', near);
  add(parts.pad, mats.pad, 'kayak_seatback', far);
  add(parts.shaft, mats.shaft, 'kayak_paddle_shaft', far);
  add(parts.blade, mats.blade, 'kayak_paddle_blades', far);
  add(parts.bag, mats.pad, 'kayak_bag', far);
  add(parts.frame, mats.frame, 'kayak_seat_frame', far);
  group.add(near, far);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // the paddler's anchors (no person this round): the hips on the seat's bowl, the hands on the shaft at a forward stroke's
  // catch-neutral point, 0.62 m apart (shoulder width plus a fist each side)
  const seatY = S.deck(0, dims.seatZ).y;
  const anchors = {
    seat: new THREE.Object3D(), gripL: new THREE.Object3D(), gripR: new THREE.Object3D(),
  };
  anchors.seat.name = 'kayak_seat'; anchors.seat.position.set(0, seatY, dims.seatZ);
  anchors.gripL.name = 'kayak_grip_l'; anchors.gripL.position.set(-0.31, seatY + 0.46, dims.seatZ - 0.42);
  anchors.gripR.name = 'kayak_grip_r'; anchors.gripR.position.set(0.31, seatY + 0.46, dims.seatZ - 0.42);
  for (const a of Object.values(anchors)) group.add(a);
  // the held paddle: its own group in the kayak frame (at the anchors' catch-neutral spot until a rig moves it), the grips on it
  let held = null;
  if (paddle === 'held') {
    const hp = G.held;
    const pg = new THREE.Group(); pg.name = 'kayak_paddle_held';
    add(hp.shaft, mats.shaft, 'kayak_paddle_shaft', pg);
    add(hp.blade, mats.blade, 'kayak_paddle_blades', pg);
    add(hp.nylon, mats.nylon, 'kayak_paddle_rings', pg);
    pg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    pg.position.set(0, seatY + 0.46, dims.seatZ - 0.42);
    anchors.gripL.position.set(-GRIP_HALF, 0, 0); anchors.gripR.position.set(GRIP_HALF, 0, 0);
    pg.add(anchors.gripL, anchors.gripR);
    group.add(pg);
    held = { group: pg, blades: hp.blades, feather: hp.feather, grip: GRIP_HALF };
  }

  const drafts = G.drafts;
  const draft = (mass) => { const k = Math.round(mass * 10); if (!drafts.has(k)) drafts.set(k, waterlineFor(S, mass)); return drafts.get(k); };
  mats.u.stainY.value = draft(dims.mass.empty + dims.mass.paddle + dims.mass.paddler);
  mats.u.waterY.value = -1;   // dry until a float sets it

  // the waterline's contact: a soft dark band on the water hugging the hull (the hull's shadow and the meniscus), 9 cm
  // wide, faded outward; built for the float's draft (setWaterline), hidden when dry
  let skirt = null, skirtY = null;
  function buildSkirt(y) {
    const loop = waterlinePlan(S, y);
    if (skirt) { group.remove(skirt); skirt.geometry.dispose(); skirt = null; }
    if (loop.length < 3) return;
    const n = loop.length, pos = [], al = [], rg = [], idx = [];
    for (let i = 0; i < n; i++) {
      const [x0, z0] = loop[(i - 1 + n) % n], [x1, z1] = loop[i], [x2, z2] = loop[(i + 1) % n];
      let nx = z2 - z0, nz = -(x2 - x0); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if (nx * x1 + nz * (z1 - (loop[0][1] + loop[Math.floor(n / 2)][1]) / 2) < 0) { nx = -nx; nz = -nz; }   // outward
      // five rings out from the hull: the dark contact (4 mm → 9 cm), then a faint light ripple ring (≈ 15 cm out)
      for (const [o, d, r] of RINGS) { pos.push(x1 + nx * o, y + 0.003, z1 + nz * o); al.push(d); rg.push(r); }
    }
    const m = RINGS.length;
    for (let i = 0; i < n; i++) for (let r = 0; r + 1 < m; r++) { const a = m * i + r, b = m * ((i + 1) % n) + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('kalpha', new THREE.Float32BufferAttribute(al, 1)); g.setAttribute('kring', new THREE.Float32BufferAttribute(rg, 1)); g.setIndex(idx);
    skirt = new THREE.Mesh(g, mats.skirt); skirt.name = 'kayak_contact'; skirt.renderOrder = 2; group.add(skirt);
  }

  let nearShown = true;
  const tmp = new THREE.Vector3();
  return {
    group, shape: S, dims, materials: mats, anchors, parts, lod, paddle: held,
    // a colour preset, a CSS colour, or a scheme ('sunset', 'orange-white', 'blue-white', or { mode, a, b })
    setColour(c) { const s = kayakScheme(c); mats.u.colour.value.copy(s.a); mats.u.colour2.value.copy(s.b); mats.u.mode.value = s.mode; },
    setWear(w) { mats.u.wear.value = Math.min(1, Math.max(0, w)); },
    setBlade(c) { mats.u.blade.value.copy(kayakColour(c)); },
    // the contact band is off by default (owner, 2026-11-07: a flat ribbon on moving water read as a ghost ring round the hull)
    setWaterline(y) { mats.u.waterY.value = y; if (!contact) return; if (y !== skirtY) { skirtY = y; if (y > 0) buildSkirt(y); else if (skirt) skirt.visible = false; } },
    setSun(dir, col) { mats.u.sunDir.value.copy(dir).normalize(); mats.u.sunCol.value.copy(col); },
    draft,
    update(cameraPos) {
      group.getWorldPosition(tmp);
      const d = tmp.distanceTo(cameraPos);
      const want = nearShown ? d < nearPartsM + 1 : d < nearPartsM - 1;
      if (want !== nearShown) { nearShown = want; near.visible = want; }
      return { distance: d, near: nearShown };
    },
    dispose() { if (!shared) group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); else if (skirt) skirt.geometry.dispose(); for (const m of Object.values(mats)) if (m?.isMaterial) m.dispose(); },
  };
}
