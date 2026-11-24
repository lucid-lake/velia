// The sloop's body (refactor round 2, Phase C step 6): its shell on the Boat's
// sockets, GLBs built in Blender from dims.js (the hull and deck, the cockpit, the wheel, the deck hardware), their KTX2
// swap and materials, the stowed anchor, the small parts' LOD and the helmsman. Moved from src/sail/assemble.js in the
// same order, so the scene's attach order (render order for equal-depth draws) is today's.
//   const body = await loadBody(core, boat, { vessel, dims })   → { look, detailLod, crewVis, dispose() }
// look: the cockpit's look (src/boat/cockpitLook.js: the traveller track the rig's fittings read).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadGltf } from '../../../../src/prefetch.js';
import { ktx2On } from '../../ktx2-layout.js';
import { ktx2Supported, swapGltfTextures } from '../../ktx2.js';
import { applyHullMaterials, hullDetailLod } from '../../boat/hullMaterials.js';
import { createCrew, crewLod } from '../../boat/crew.js';
import { applyCockpitLook, applyWheelLook, HULL_ORDER } from '../../boat/cockpitLook.js';
import { FLAGS } from '../../../../src/sim/core/flags.js';

export async function loadBody(core, boat, { vessel }) {
  const { flags, headless, camera, lum } = core;
  const M = vessel.models;
  // M1 (4e): the hull and deck, a GLB built in Blender from dims.js. M5–M7 (a0): the sails and lines.
  core.stage('boat', 0.95);
  const hullGltf = await loadGltf(new GLTFLoader(), M.hull);   // the profile's models (the loading screen's prefetched bytes, src/prefetch.js)
  boat.attach('hull', hullGltf.scene.getObjectByName('hull') ?? hullGltf.scene);
  // M3 cockpit + wheel and M8 deck hardware (4e), GLBs built in Blender from dims.js
  const loader = new GLTFLoader();
  const [ckG, whG, hwG] = await Promise.all(['cockpit', 'wheel', 'hardware'].map((n) => loadGltf(loader, M[n])));
  // phones and Low: the cockpit's textures from their KTX2 twins (tiers.js ktx2.boat; 13 MB of GPU memory to 3), else as authored
  if (ktx2On('boat', FLAGS, core.tier?.ktx2) && ktx2Supported()) await swapGltfTextures(ckG.scene, { warn: console.warn }).catch((e) => console.warn(e.message));
  boat.attach('cockpit', ckG.scene.getObjectByName('cockpit') ?? ckG.scene);
  boat.modules.hull.traverse((o) => { if (o.isMesh) o.renderOrder = HULL_ORDER; });   // after the companionway's cabin and portal (cockpitLook.js; meshes only: a Group's renderOrder becomes its children's groupOrder, which sorts before renderOrder)
  const look = applyCockpitLook(boat.modules.cockpit, { lum });   // the LOD, the companionway's cabin, the clear dodger vinyl
  // the smoked acrylic (the compass dome, the dropboards) sees through to the compass card (instruments.js)
  boat.modules.cockpit.traverse((o) => { if (o.isMesh && o.name === 'smoked') { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } });
  boat.attach('wheel', whG.scene.getObjectByName('wheel') ?? whG.scene);
  applyWheelLook(boat.modules.wheel);   // polished stainless: the highlight streaks round the rim
  boat.attach('hardware', hwG.scene.getObjectByName('hardware') ?? hwG.scene);
  // the hull and deck materials (hero hull): procedural gelcoat, non-skid, antifouling, smoked acrylic, stainless, aluminium;
  // the cockpit's coamings and non-skid panels carry the same names, so they share the deck's materials
  { const mats = new Map(); const n = applyHullMaterials(boat.modules.hull, mats) + applyHullMaterials(boat.modules.hardware, mats) + applyHullMaterials(boat.modules.cockpit, mats); if (headless) console.log(`[hull] materials swapped: ${n} (${[...mats.keys()].join(', ')})`); }
  // the stowed anchor rides its socket (the features engineer lowers the socket); the small parts' LOD (hullDetailLod)
  { const anc = boat.modules.hardware.getObjectByName('anchor'); if (anc) { anc.position.set(0, 0, 0); boat.attach('anchor', anc); } }
  const detailLod = hullDetailLod(boat, flags.detailfar ? { far: parseFloat(flags.detailfar) } : {});   // ?detailfar= (m): the LOD check
  // the helmsman, seen only from afar (src/boat/crew.js: hidden within 25 m, so never in the helm view); ?crew=1|0 forces it
  const crewG = createCrew(); boat.heelPivot.add(crewG);
  const crewVis = crewLod(boat, crewG, null);
  boat.sockets.wheel.position.set(...vessel.sockets.wheel);   // the wheel's axle (4e's M3; the profile's sockets.wheel)
  boat.setUpdate('hardware', () => { detailLod.update(camera.position); crewVis.update(camera.position); });   // the small parts' LOD, each frame
  return {
    look, detailLod, crewVis,
    dispose() {},   // the body leaves with the Boat (the composer's scene.remove(boat))
  };
}
