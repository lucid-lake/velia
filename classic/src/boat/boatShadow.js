// The boat in the sun's shadow map (boat detail step 1; src/core/sunShadow.js holds the light): which of the boat's meshes
// cast (they join SHADOW_LAYER) and which receive, and the light box following the hull each frame.
//
//   const off = attachBoatShadow(boat, core.sunShadow)   after the body, the rig and the sails are on (src/sail/assemble.js)
//   casters(boat), receivers(boat)   the lists (the tests)
//
// Casters: the solid parts (the hull and deck, the cockpit, the wheel, the hardware, the spars, the sails, the rope).
// Not: see-through parts (the dodger's vinyl, the smoked acrylic), the depth portal, the cabin seen through it (inside),
// unlit ones and the screen-space ribbons (the wires, the far lines: a custom vertex stage has no place in a depth pass).
// Receivers: the opaque parts of the hull, the cockpit, the hardware, the wheel and the rope, where the helm eye sees the
// shadows (a see-through part shows none worth its cost; three builds a two-sided see-through draw's pipelines in the draw).
import { SHADOW_LAYER } from '../core/sunShadow.js';

const CAST = ['hull', 'cockpit', 'wheel', 'hardware', 'rigging', 'main', 'jib', 'lines', 'anchor'];
const RECEIVE = ['hull', 'cockpit', 'wheel', 'hardware', 'lines', 'anchor'];

const solid = (m) => m && !m.transparent && m.colorWrite !== false && !m.isMeshBasicMaterial && !m.isMeshBasicNodeMaterial && !m.vertexNode;
// a multi-material mesh (the dodger: canvas + smoked side windows) casts if its first (main) material is solid
const meshes = (boat, names, ok) => {
  const out = [];
  for (const n of names) boat.modules?.[n]?.traverse?.((o) => { if (o.isMesh && !o.name.startsWith('companion_') && ok([o.material].flat())) out.push(o); });
  return out;
};
export const casters = (boat) => meshes(boat, CAST, (ms) => solid(ms[0]));
export const receivers = (boat) => meshes(boat, RECEIVE, (ms) => ms.every(solid));

export function attachBoatShadow(boat, sh) {
  if (!sh || !boat) return () => {};
  for (const o of casters(boat)) { o.castShadow = true; o.layers.enable(SHADOW_LAYER); }
  for (const o of receivers(boat)) o.receiveShadow = true;
  const follow = () => sh.follow(boat.position);
  boat.afterUpdate.push(follow);
  follow();
  return () => { const i = boat.afterUpdate.indexOf(follow); if (i >= 0) boat.afterUpdate.splice(i, 1); };
}
