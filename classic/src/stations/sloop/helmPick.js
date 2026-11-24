// The helm view's hands-on parts (owner, 2026-10-29: mouse friendly). In the helm view the boat's
// parts take the mouse: the working sheet winch pulls in while held, the sheet's tail eases while held, a drag on the
// wheel steers, and the radio and the binoculars (feat/bino-vhf) call their features. Each part is an invisible
// proxy (a sphere, a box or a ring a little larger than the part) on the boat's sockets; a hovered part's proxy
// shows as a soft cream rim glow (additive, 0 → HELM_PICK.glow over 0.15 s). The winch drums are merged into cockpit.glb's
// material meshes (src/boat/lines.js), so the proxies stand in for them; the ray is also tested against the cockpit,
// the hull and the wheel meshes, and a part behind them by more than HELM_PICK.occludeM is not hit.
//
//   const hp = createHelmPick({ boat, THREE });     // the 'helmPick' service
//   hp.register({ id, object, kind: 'hold' | 'drag' | 'click', action, visible, glow })   // a feature's part (an Object3D in the boat); glow: its own peak (0: none)
// The built-in parts carry a role the controls act on: 'pull' (a winch), 'ease' (the tail), 'steer' (the wheel).
//   hp.pick(raycaster) → part | null;  hp.hover(part | null);  hp.update(dt, state)
// kind 'hold': action(true) on press, action(false) on release; 'drag': the controls read the drag; 'click': action().
import { uniform, float, abs, dot, normalView, positionViewDirection } from 'three/tsl';
import { sheetTail } from '../../boat/lines.js';

const HELM_PICK = { glow: 0.7, glowTau: 0.15, occludeM: 0.08, color: 0xefe6d2, gain: 1.4 };

export function createHelmPick({ boat, THREE }) {
  const parts = new Map();
  // a soft glow: brighter at the proxy's silhouette than its face (a rim, 1 − |n·v| squared), so a hovered drum reads
  // as lit from around, not as a cream ball over it; uGlow rides 0 → glow
  const mat = () => {
    const m = new THREE.MeshBasicNodeMaterial({ color: HELM_PICK.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const u = uniform(0); m.userData.glow = u;
    const rim = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2);
    m.opacityNode = u.mul(rim.mul(0.75).add(0.25));
    return m;
  };
  const proxy = (geo, parent, pos, name) => {
    const m = new THREE.Mesh(geo, mat()); m.name = `pick:${name}`; m.position.set(...pos); m.visible = false; m.renderOrder = 4;   // hidden until hovered; the Raycaster tests layers, not .visible
    parent.add(m); return m;
  };
  const add = (spec) => { const p = { glowA: 0, ...spec }; parts.set(spec.id, p); return p; };

  // the four winch drums (cockpit.glb, measured from its 'black' tailer caps, HULL frame): the primaries on the
  // coamings (the jib sheets) and the two on the cabin top by the companionway (the main sheet's, lines.js); in the
  // game's one sheet, any of them is "the winch". The hull socket's frame is the HULL frame.
  const hull = boat.sockets.cockpit;
  for (const [id, pos, r] of [['winch-s', [1.277, 1.27, 2.65], 0.15], ['winch-p', [-1.277, 1.27, 2.65], 0.15],
    ['winch-cabin-s', [0.529, 1.44, 1.139], 0.13], ['winch-cabin-p', [-0.529, 1.44, 1.139], 0.13]]) {
    add({ id, name: 'winch', role: 'pull', kind: 'hold', object: proxy(new THREE.SphereGeometry(r, 20, 12), hull, pos, id) });
  }
  // the working jib sheet's tail (lines.js sheetTail, the RIG frame of the lines socket): a box over its points,
  // refitted each frame as the tail lengthens and moves to the leeward side
  add({ id: 'tail', name: 'sheet tail', role: 'ease', kind: 'hold', object: proxy(new THREE.BoxGeometry(1, 1, 1), boat.sockets.lines, [0, 0, 0], 'tail') });
  // the wheel: a ring over its rim (rim radius 0.41 m; the socket turns with the rudder, the ring is round)
  // no glow on the wheel (owner, 2026-11-07: the hovered ring read as a cream wash over the whole wheel; the camera sits
  // just behind it): the grab cursor and the name tag say it; the ring stays as the pick proxy
  add({ id: 'wheel', name: 'wheel', role: 'steer', kind: 'drag', glow: 0, object: proxy(new THREE.TorusGeometry(0.41, 0.07, 10, 40), boat.sockets.wheel, [0, 0, 0], 'wheel') });

  // the ray's blockers: the hull, the cockpit (coamings, dodger, the merged winch drums) and the wheel's own mesh
  const blockers = () => ['hull', 'cockpit', 'hardware'].map((n) => boat.modules[n]).filter(Boolean);

  function register(spec) {
    const p = add({ kind: 'click', ...spec });
    if (p.object && !p.object.isMesh) {
      // a group: its bounds as the proxy, in its own frame
      const box = new THREE.Box3().setFromObject(p.object), size = box.getSize(new THREE.Vector3()).multiplyScalar(1.15), c = box.getCenter(new THREE.Vector3());
      p.object.worldToLocal(c);
      p.target = p.object;
      p.object = proxy(new THREE.BoxGeometry(Math.max(size.x, 0.12), Math.max(size.y, 0.12), Math.max(size.z, 0.12)), p.target, [c.x, c.y, c.z], spec.id);
    }
    return p;
  }

  const live = (p) => { try { return p.visible ? !!p.visible() : true; } catch { return false; } };
  function pick(raycaster) {
    let best = null;
    for (const p of parts.values()) {
      if (!p.object || !live(p)) continue;
      const hit = raycaster.intersectObject(p.object, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { p, d: hit.distance, point: hit.point };
    }
    if (!best) return null;
    for (const b of blockers()) {
      const h = raycaster.intersectObject(b, true).find((x) => !x.object.name.startsWith('pick:') && x.object.visible);
      if (h && h.distance < best.d - HELM_PICK.occludeM && !nearPart(best.p, h.point)) return null;
    }
    return best.p;
  }
  // a hit on a blocker inside the part's own proxy (the winch drum inside its sphere) is the part
  const _v = new THREE.Vector3(), _s = new THREE.Vector3();
  const nearPart = (p, point) => {
    if (!p.object.geometry.boundingSphere) p.object.geometry.computeBoundingSphere();
    p.object.getWorldPosition(_v); p.object.getWorldScale(_s);
    return point.distanceTo(_v) <= p.object.geometry.boundingSphere.radius * Math.max(_s.x, _s.y, _s.z) * 1.1;
  };

  let hovered = null;
  function hover(p) { hovered = p ?? null; }
  function update(dt, state, exposure = 1) {
    // the tail's box: the working side is the jib sheet's (lines.js: the sign of the jib's angle)
    if (state) {
      const pts = sheetTail(state, Math.sign(state.jibAngle ?? 0) || -1, 0, 0), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const q of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); }
      const tp = parts.get('tail').object;
      tp.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
      tp.scale.set(hi[0] - lo[0] + 0.14, hi[1] - lo[1] + 0.12, hi[2] - lo[2] + 0.1);
    }
    const k = 1 - Math.exp(-dt / HELM_PICK.glowTau);
    for (const p of parts.values()) {
      if (!p.object) continue;
      const want = p === hovered || p.held ? (p.glow ?? HELM_PICK.glow) : 0;
      p.glowA += (want - p.glowA) * k;
      if (want === 0 && p.glowA < 0.004) p.glowA = 0;
      p.object.material.userData.glow.value = p.glowA;
      if (p.glowA > 0) p.object.material.color.setHex(HELM_PICK.color).multiplyScalar(HELM_PICK.gain / Math.max(0.05, exposure));   // the hints' cream after AgX
      p.object.visible = p.glowA > 0;
    }
  }
  return { register, pick, hover, update, parts, get hovered() { return hovered; } };
}
