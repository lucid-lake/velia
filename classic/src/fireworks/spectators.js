// The spectators (owner, 2026-11-08: "under fireworks, if possible, have two sailboats and a few kayaks there"; S3 fix,
// owner: "the kayak is very bad"): between the player's spot (stage.js VIEW) and the safety zone, 60–150 m out, riding the water.
//   const sp = await createSpectators(core, { from: VIEW, boat }); scene.add(sp.group); sp.update(dt, t, exposure, camPos)
// The kayaks: the approved kayak and paddler (src/props/kayak, src/props/paddler: the rest clip with its idles, the
// kayak's own shell LOD by distance), seated at their real draft and rocking on the waves; a headlamp each. The paddler's
// rest pose steps only every PADDLER_EVERY frames (its step is ≈ 0.5 ms for four; a rest barely moves).
// The sailboats: the player's own boat (Halcyon) cloned with the sails, sheets, deck details, cockpit and hardware left
// out (sails down; a faithful far LOD: hull, mast, boom, stays), swinging slowly round the anchor; the anchor light a small
// point at the masthead (a screen-sized sprite, ≈ 3 px), a soft warm point from the cabin.
// GPU (polish round): the sailboats are one merged vertex-coloured mesh each (farLod), the kayaks drop the parts under a
// pixel at their range, and none of them casts shadows: 122 → 46 draw calls, ≈ +0.35 → ≈ +0.2 ms at the finale.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { at } from '../../../src/fireworks/stage.js';

export const SPECTATORS = {
  // from the viewing spot (stage.js VIEW; realism round: the barges came in, the crowd moved with the player's spot)
  // (wow round: the show 250 m off to the south-west, 243°; the crowd 50–120 m on toward it, 130–200 m from the barges)
  sailboats: [{ bearing: 222, d: 115, heading: 30 }, { bearing: 266, d: 105, heading: 350 }],
  kayaks: [
    { bearing: 232, d: 60, heading: 200, seed: 3, colour: 'red', pfd: 'yellow' },
    { bearing: 240, d: 85, heading: 260, seed: 5, colour: 'yellow', pfd: 'red' },
    { bearing: 250, d: 52, heading: 310, seed: 8, colour: 'orange', pfd: 'blue' },
    { bearing: 257, d: 80, heading: 220, seed: 11, colour: 'teal', pfd: 'orange' },
  ],
  anchorLight: 3.0, cabin: 0.4, headlamp: 1.6,   // screen levels (× 1 / exposure)
};
const PADDLER_EVERY = 4;
// a sailboat's swing round its anchor (rad, rad/s): heading h0 + amp sin(w t + bearing × 0.37)
const SWING = { amp: 0.21, w: 0.07 };
// the sailboats' spots and swings (the solids, src/fireworks/solids.js: the same hulls)
export const sailboatSpots = (from, list = SPECTATORS) => list.sailboats.map((s) => {
  const [x, z] = at(s.bearing, s.d, from);
  return { x, z, heading: s.heading * DEG, swing: { amp: SWING.amp, w: SWING.w, ph: s.bearing * 0.37 } };
});
const FAR_DROP = /^(Eyes|Eyebrows|kayak_seatback|kayak_seat_frame|kayak_paddle_rings)$/;   // the kayaks' parts under a pixel at 60 m   // frames between two paddler steps (the rest clip)
const DEG = Math.PI / 180;

export async function createSpectators(core, { from, boat = null, list = SPECTATORS } = {}) {
  const water = core?.water;
  const group = new THREE.Group(); group.name = 'fireworks-spectators';
  const uWhite = uniform(0), uWarm = uniform(0), uLamp = uniform(0);
  // a light as a point: a sprite of a fixed screen size (sizeAttenuation off), a soft round falloff
  const pointMat = (u, c) => {
    const m = new THREE.SpriteNodeMaterial({ sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    m.colorNode = vec4(vec3(...c).mul(u), 1);
    return m;
  };
  const anchorMat = pointMat(uWhite, [1, 0.96, 0.9]), lampPoint = pointMat(uLamp, [0.95, 0.97, 1]), cabinMat = pointMat(uWarm, [1, 0.6, 0.25]);
  const H = (x, z, t) => water?.surface?.heightAt?.(x, z, t, {}) ?? 0;
  const items = [];

  if (boat) {
    const hide = ['main', 'jib', 'lines', 'details', 'cockpit', 'hardware', 'wheel', 'anchor'].map((n) => boat.modules?.[n]).filter(Boolean);
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    // the far LOD (polish round, the GPU cost): the boat's visible meshes merged once into one mesh per material (a few
    // draw calls instead of the clone's dozens), shared by both sailboats, no shadows (at 130–150 m, at night, none show)
    const lod = farLod(boat);
    const box = new THREE.Box3().setFromObject(lod);
    const top = Math.max(box.max.y, 10);
    for (const s of list.sailboats) {
      const g = new THREE.Group();
      for (const m of lod.children) { const c = new THREE.Mesh(m.geometry, m.material); c.castShadow = false; c.receiveShadow = false; g.add(c); }
      const light = new THREE.Sprite(anchorMat); light.scale.setScalar(0.006); light.position.set(0, top + 0.15, 0); g.add(light);
      const cabin = new THREE.Sprite(cabinMat); cabin.scale.setScalar(0.004); cabin.position.set(0, 1.3, 0.6); g.add(cabin);
      const [x, z] = at(s.bearing, s.d, from);
      group.add(g);
      items.push({ kind: 'sail', g, x, z, h0: s.heading * DEG, ph: s.bearing * 0.37 });
    }
    hide.forEach((o, i) => { o.visible = was[i]; });
  }

  // no static kayaks (the live fleet's own kayakers rest at these spots in Sail and Cruise): no paddler figures to fetch
  // (perf/slow-loading: their 1.2 MB were fetched before the first live frame on every July 4 load, at any hour)
  const K = list.kayaks.length ? await import('../props/kayak/index.js') : null, P = list.kayaks.length ? await import('../props/paddler/index.js') : null;
  const gltf = P ? await P.loadPaddlerGltf('ubc') : null;
  for (const s of list.kayaks) {
    const k = K.createKayak({ colour: s.colour, seed: s.seed, paddle: 'held' });
    const p = P.createPaddler({ gltf, kayak: k, seed: s.seed, look: { pfd: s.pfd }, mode: 'rest' });
    p.update(1 / 60);
    const lamp = new THREE.Sprite(lampPoint); lamp.scale.setScalar(0.0035); lamp.position.set(0, 0.98, 0.32); k.group.add(lamp);
    const draft = k.draft(k.dims.mass.empty + k.dims.mass.paddle + k.dims.mass.paddler);
    k.setWaterline(draft);
    const [x, z] = at(s.bearing, s.d, from);
    // 60–120 m at night: no shadow passes, and the parts under a pixel there (eyes, brows, the seat, the paddle's drip rings)
    // left out of the draw (each one a draw call)
    const drop = []; k.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; if (FAR_DROP.test(o.name)) drop.push(o); } });
    drop.forEach((o) => o.parent?.remove(o));
    group.add(k.group);
    items.push({ kind: 'kayak', k, p, x, z, h0: s.heading * DEG, draft, ph: s.seed * 1.7, acc: 0 });
  }

  let frame = 0;
  function update(dt, t, exposure = 2172, camPos = null) {
    const g = 1 / Math.max(exposure, 1e-6);
    uWhite.value = list.anchorLight * g; uWarm.value = list.cabin * g; uLamp.value = list.headlamp * g;
    frame++;
    for (const it of items) {
      if (it.kind === 'sail') {
        // it.solid (src/fireworks/solids.js): its body, shoved by our boat and swinging back on its rode
        const sb = it.solid, x = it.x + (sb ? sb.x - sb.x0 : 0), z = it.z + (sb ? sb.z - sb.z0 : 0);
        const hdg = it.h0 + SWING.amp * Math.sin(t * SWING.w + it.ph) + (sb?.dh ?? 0), L = 4, B = 1.6;
        const fx = Math.sin(hdg), fz = -Math.cos(hdg), sx = Math.cos(hdg), sz = Math.sin(hdg);
        const bow = H(x + fx * L, z + fz * L, t), stern = H(x - fx * L, z - fz * L, t), port = H(x - sx * B, z - sz * B, t), stbd = H(x + sx * B, z + sz * B, t);
        it.g.position.set(x, (bow + stern + port + stbd) / 4, z);
        it.g.rotation.set(Math.atan2(bow - stern, 2 * L) * 0.7, -hdg, Math.atan2(stbd - port, 2 * B) * 0.7, 'YXZ');
      } else {
        const hdg = it.h0 + 0.3 * Math.sin(t * 0.05 + it.ph), x = it.x + 1.5 * Math.sin(t * 0.03 + it.ph), z = it.z + 1.5 * Math.cos(t * 0.025 + it.ph);
        const L = 1.6, B = 0.3, fx = Math.sin(hdg), fz = -Math.cos(hdg), sx = Math.cos(hdg), sz = Math.sin(hdg);
        const c = H(x, z, t), bow = H(x + fx * L, z + fz * L, t), stern = H(x - fx * L, z - fz * L, t), port = H(x - sx * B, z - sz * B, t), stbd = H(x + sx * B, z + sz * B, t);
        it.k.group.position.set(x, (2 * c + bow + stern + port + stbd) / 6 - it.draft, z);
        it.k.group.rotation.set(Math.atan2(bow - stern, 2 * L) * 0.85, -hdg, Math.atan2(stbd - port, 2 * B) * 0.6, 'YXZ');
        it.acc += dt;
        if (frame % PADDLER_EVERY === 0 && it.acc > 0) { it.p.update(Math.min(0.2, it.acc)); it.acc = 0; }
        if (camPos) it.k.update(camPos);
      }
    }
  }
  return { group, update, items };
}

// the boat's visible meshes (in the boat's own frame) merged into ONE mesh: each part keeps its material's base colour as
// a vertex colour under one plain standard material (at 130–150 m, at night, the parts' own shading and patterns are below
// a pixel). Plain meshes only (instanced and skinned parts are left out: none of the kept modules use them)
function farLod(boat) {
  boat.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(boat.matrixWorld).invert(), m = new THREE.Matrix4(), list = [];
  boat.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat?.transparent) return;   // glass and glows: the cabin's own sprite stands in
    const src = o.geometry, g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position.clone());
    if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
    if (src.index) g.setIndex(src.index.clone());
    const geo = g.index ? g.toNonIndexed() : g;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    const c = mat?.color ?? new THREE.Color(1, 1, 1), n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    list.push(geo);
  });
  const out = new THREE.Group(); out.name = 'sailboat-far-lod';
  const merged = list.length ? mergeGeometries(list, false) : null;
  if (merged) out.add(new THREE.Mesh(merged, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 })));
  return out;
}
