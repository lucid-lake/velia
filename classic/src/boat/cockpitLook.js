// The cockpit's look on the page: what the GLB can't say by itself.
//
//   import { applyCockpitLook } from './cockpitLook.js';
//   const look = applyCockpitLook(cockpitRoot);   // once, after Boat.attach('cockpit', …)
//   look.trackY(x)                                // the traveller car's height on the crowned track (hull frame)
//   look.engine                                   // { throttle, gear, key, setLamps(oil, temp) }: the features engineer's sockets
//
// 1. LOD: the GLB's "lod_near" (winch drums and tailers, handles, clutches, the pedestal's controls, the engine panel,
//    the cabin seen through the companionway) and "lod_far" (plain drums) become one THREE.LOD: near inside NEAR_M of
//    the hull's origin (the helm view, close orbits), far beyond (the follow camera at ≈ 32 m).
// 2. The companionway portal: the hull's face and hatch top are closed surfaces (M1). The cabin draws first (CABIN_ORDER),
//    then the portal quads (4 mm proud of the face, PORTAL_ORDER) with no colour and their own depth, depth-tested as
//    usual, then the hull (HULL_ORDER): where the portal is seen, the hull's face behind it fails the depth test and the
//    cabin's colour stays; where the topsides are in front of it (seen from outside), the portal fails and the hull
//    draws over the cabin. (boat detail step 1: the portal used to write the far depth with no test, so from outside the
//    cabin's teak showed through the topsides, plan 41's b-beam-low.) The cabin is lit by its baked vertex light (a
//    sunlit cabin read as a white box; the boat's shadow map leaves it out), scaled by the daylight level.
// 3. The dodger's vinyl: clear from both sides (it rendered as a dark sheet from inside), the canvas colour on the
//    cushions, their piping and the bimini boot (canvas.json), the smoked dropboards see-through.
// 4. The dodger's side panels, smoked (feat/kayaks-lake step 2b, owner 2026-11-08: a kayak 20–35° off the bow hid behind
//    the solid canvas beside the windscreen from the helm): the panels' faces that look sideways, inside a canvas border,
//    become a smoked vinyl window (see SIDE_WINDOW); the frame, the top and the front stay canvas.
import * as THREE from 'three/webgpu';
import { uniform, attribute, texture, uv } from 'three/tsl';
import { trackY } from '../../../src/boat/cockpitPoints.js';
import { cabinShare, nightK } from '../../../src/boat/nightLight.js';

export const NEAR_M = 15;   // m from the hull origin: the helm eye is ≈ 3.9 m, the follow camera ≈ 32 m
// the cabin draws first (CABIN_ORDER), the portal next, then the hull (HULL_ORDER); everything else at 0. Nothing else
// may draw before the portal: what it hides would keep its colour in the opening
export const HULL_ORDER = -2, PORTAL_ORDER = -3, CABIN_ORDER = -4;

export { trackY };

export const CABIN_LIGHT = 0.55;   // × the scene's luminance unit (core.lum: lit white ≈ 3.5 of it): a cabin in shade
// the side windows: faces whose normal is this sideways (|n.x|), between these heights (m, cockpit frame: from below the
// dodger's own foot, so the window's lower edge is the canvas's edge on the coaming, not a stepped line of faces) and lengths
const SIDE_WINDOW = Object.freeze({ nx: 0.55, y: [0.9, 2.22], z: [0.16, 1.3], opacity: 0.22 });

export function applyCockpitLook(root, { lum = 1 } = {}) {
  const byName = (n) => root.getObjectByName(n);
  const level = uniform(lum * CABIN_LIGHT);   // the cabin's light; the daylight's level scales it
  const tint = uniform(new THREE.Color(1, 1, 1));   // white by day; the red night light's colour by night (nightLight.js)

  // 1. the LOD
  const near = byName('lod_near'), far = byName('lod_far');
  let lod = null;
  if (near && far) {
    lod = new THREE.LOD(); lod.name = 'cockpit-lod';
    root.add(lod);
    near.removeFromParent(); far.removeFromParent();
    lod.addLevel(near, 0, 0.05); lod.addLevel(far, NEAR_M, 0.05);
  }

  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name, m = o.material;
    // 2. the portal and the cabin
    if (n.startsWith('companion_portal')) {
      // after the cabin, before the hull: a depth-only quad with the usual test, so it closes the hull's face behind it
      // and hides itself behind the topsides; parts in front of the opening (the wheel, the pedestal) draw later and win
      const pm = new THREE.MeshBasicNodeMaterial({ colorWrite: false, side: THREE.DoubleSide });
      o.material = pm; o.renderOrder = PORTAL_ORDER; o.castShadow = false; o.receiveShadow = false;
    } else if (n.startsWith('companion_interior')) {
      const bm = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      const col = attribute('color', 'vec3');
      bm.colorNode = m?.map ? texture(m.map, uv()).rgb.mul(col).mul(level).mul(tint) : col.mul(level).mul(tint);
      o.material = bm; o.renderOrder = CABIN_ORDER; o.castShadow = false; o.receiveShadow = false;
    } else if (m?.name === 'dodger_vinyl') {
      // 3. clear vinyl, both sides: a faint tint, a glossy surface (the sky's reflection comes from the Fresnel term)
      const v = m.clone();
      v.color.setRGB(0.80, 0.84, 0.84); v.opacity = 0.10; v.transparent = true; v.depthWrite = false;
      v.side = THREE.DoubleSide; v.roughness = 0.04; v.metalness = 0; if ('clearcoat' in v) v.clearcoat = 0.6;
      o.material = v;
    } else if (n === 'dodger' || n === 'dodger_shade') {
      sideWindows(o);
    } else if (n.startsWith('dropboards')) {
      const v = m.clone();
      v.transparent = true; v.opacity = 0.78; v.depthWrite = false;
      o.material = v; o.renderOrder = 12;
    }
  });

  // the engine's sockets: levers rotate about their local x (+ forward), the key about its local z, the lamps glow
  const lamps = ['engine_lamp_oil', 'engine_lamp_temp'].map(byName).filter(Boolean);
  for (const l of lamps) l.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive?.setRGB(0, 0, 0); } });
  const engine = {
    throttle: byName('engine_throttle'), gear: byName('engine_gear'), key: byName('engine_key'), hatch: byName('companion_hatch'),
    setLamps(oil = 0, temp = 0) {
      [oil, temp].forEach((on, i) => lamps[i]?.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB(on ? 1.6 : 0, on ? 0.25 : 0, on ? 0.08 : 0); }));
    },
  };
  root.userData.engine = engine;
  // the daylight's frame (src/daylight.js collects userData.daylight hooks): the cabin's light follows the day
  // fix/helm-view-cockpit: the old floor (6 % of the day's level, × an exposure that rises ≈ 360 × by night) lit the cabin brighter
  // than noon at night; now a dim red night light holds its own on-screen level (nightLight.js cabinShare)
  const NIGHT_TINT = new THREE.Color(1, 0.32, 0.2), WHITE = new THREE.Color(1, 1, 1);
  root.userData.daylight = (f) => {
    level.value = lum * CABIN_LIGHT * cabinShare(f);
    tint.value.copy(WHITE).lerp(NIGHT_TINT, nightK(f.elevDeg));
  };
  return { lod, trackY, engine, level, tint };
}

// 4. split a dodger mesh's side-panel faces into a second group drawn as smoked vinyl (both sides, no depth write)
function sideWindows(o, W = SIDE_WINDOW) {
  const g = o.geometry, p = g.attributes.position, idx = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const keep = [], win = [];
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(p, idx[t]); b.fromBufferAttribute(p, idx[t + 1]); c.fromBufferAttribute(p, idx[t + 2]);
    const n = e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
    const cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    const side = Math.abs(n.x) > W.nx && cy > W.y[0] && cy < W.y[1] && cz > W.z[0] && cz < W.z[1];
    (side ? win : keep).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (!win.length) return;
  const ng = g.clone(); ng.setIndex([...keep, ...win]); ng.clearGroups(); ng.addGroup(0, keep.length, 0); ng.addGroup(keep.length, win.length, 1);
  const smoked = new THREE.MeshStandardNodeMaterial({ name: 'dodger_side_window', color: new THREE.Color(0.18, 0.2, 0.21), transparent: true, opacity: W.opacity, depthWrite: false, side: THREE.DoubleSide, roughness: 0.06, metalness: 0 });
  o.geometry = ng; o.material = [o.material, smoked];
}

// The wheel's stainless, polished on a lathe: an anisotropic highlight that streaks round the rim and the hub (the
// GLB has no UVs, so the tangent is set here: round the axle, the wheel's local z). Returns the material.
export function applyWheelLook(root, { anisotropy = 0.75, roughness = 0.16 } = {}) {
  let mat = null;
  root.traverse((o) => {
    if (!o.isMesh || !o.material?.name?.startsWith('stainless')) return;
    const g = o.geometry, p = g.attributes.position, n = p.count, t = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), l = Math.hypot(x, y) || 1;
      t[4 * i] = -y / l; t[4 * i + 1] = x / l; t[4 * i + 2] = 0; t[4 * i + 3] = 1;   // z × r̂: round the axle
    }
    g.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
    mat ??= new THREE.MeshPhysicalNodeMaterial({ name: 'stainless_turned', color: o.material.color, metalness: 1, roughness, anisotropy, clearcoat: 0.3, clearcoatRoughness: 0.08 });
    o.material = mat;
  });
  return mat;
}
