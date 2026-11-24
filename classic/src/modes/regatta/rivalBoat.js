// The rival's boat: Halcyon's modules (hull, cockpit, hardware, spars, sails, lines, crew) on a second Boat, its
// own physics and its own float and wake; the main carries a navy sail number and class insignia (the sail decal in
// src/boat/sails.js). It is Halcyon's hull: nothing about the hull or the polar differs, by design.
//   const rb = await createRivalBoat(core, { pose: { x, z, headingDeg, speed }, number: 17 });
//   rb.phys, rb.boat, rb.ride;  rb.step(dt, ctl, t, windAt)  physics + float;  rb.draw(dt, t)  pose into the scene;  rb.dispose()
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Boat } from '../../boat/Boat.js';
import { vesselDims } from '../../../../src/sim/boat/dims.js';
import { CURRENT_VESSEL } from '../../../../src/sim/vessels/current.js';
import { BoatPhysics } from '../../../../src/sim/boat.js';
import { BoatOnWater } from '../../boat/ride.js';
import { createRigging } from '../../boat/spars-mesh.js';
import { createDetails } from '../../boat/details-mesh.js';
import { makeMainsail, makeJib } from '../../boat/sails.js';
import { makeLines } from '../../boat/lines.js';
import { createGround } from '../../../../src/sim/boat/ground.js';
import { groundTerrain } from '../../../../src/sim/boat/groundTerrain.js';
import { applyHullMaterials } from '../../boat/hullMaterials.js';
import { createCrew } from '../../boat/crew.js';
import { applyCockpitLook, applyWheelLook, HULL_ORDER } from '../../boat/cockpitLook.js';

// The sail number and the class insignia on a navy ground-free texture over the main's own uv (u along the chord from the luff,
// v up the luff): a real sail carries the number on the upper leech panel. Navy ink, transparent elsewhere.
function sailDecal(number = 17) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d'); g.clearRect(0, 0, 512, 512);
  g.fillStyle = '#1C2340'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '500 150px Jost, "Helvetica Neue", sans-serif'; g.fillText(String(number), 330, 330);
  // the insignia: a small osprey-wing chevron pair over a wave line, above the number
  g.strokeStyle = '#1C2340'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(262, 190); g.quadraticCurveTo(300, 150, 330, 190); g.quadraticCurveTo(360, 150, 398, 190); g.stroke();
  g.beginPath(); g.moveTo(272, 214); g.quadraticCurveTo(330, 236, 388, 214); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// vessel: the rival's boat (its profile: src/vessels/<id>.json; the player's class, this page's boat, by default)
export async function createRivalBoat(core, { pose, number = 17, vessel = core.vessel ?? CURRENT_VESSEL } = {}) {
  const { scene, atmosphere, sunWorld, lum, water, wake, wind, SEED } = core;
  const dims = vesselDims(vessel), M = vessel.models;
  const boat = new Boat({ dims }); boat.name = 'rival'; scene.add(boat);
  const rigging = createRigging({ dims }), details = createDetails({ rig: rigging.rig, dims });
  boat.attach('mast', new THREE.Group()); boat.attach('boom', new THREE.Group());
  boat.attach('rigging', rigging.group); boat.attach('details', details.group);
  rigging.setLight?.({ sunDir: sunWorld, sunColor: new THREE.Color(1.0, 0.85, 0.7), skyColor: new THREE.Color(0.55, 0.65, 0.8) });
  boat.setUpdate('rigging', (st, dt) => rigging.update(st, dt || 1 / 60));
  const L = new GLTFLoader();
  const [hullG, ckG, whG, hwG] = await Promise.all(['hull', 'cockpit', 'wheel', 'hardware'].map((n) => L.loadAsync(M[n])));   // the profile's models
  boat.attach('hull', hullG.scene.getObjectByName('hull') ?? hullG.scene);
  boat.attach('cockpit', ckG.scene.getObjectByName('cockpit') ?? ckG.scene);
  boat.modules.hull.traverse((o) => { if (o.isMesh) o.renderOrder = HULL_ORDER; });   // meshes only (cockpitLook.js: after the cabin and the portal)
  applyCockpitLook(boat.modules.cockpit, { lum });
  boat.attach('wheel', whG.scene.getObjectByName('wheel') ?? whG.scene); applyWheelLook(boat.modules.wheel);
  boat.attach('hardware', hwG.scene.getObjectByName('hardware') ?? hwG.scene);
  { const mats = new Map(); applyHullMaterials(boat.modules.hull, mats); applyHullMaterials(boat.modules.hardware, mats); applyHullMaterials(boat.modules.cockpit, mats); }
  boat.sockets.wheel.position.set(...vessel.sockets.wheel);
  const crew = createCrew(); boat.heelPivot.add(crew);
  boat.attach('main', makeMainsail({ atmosphere, decal: sailDecal(number) }));
  boat.attach('jib', makeJib({ atmosphere }));
  boat.attach('lines', makeLines(boat));
  const phys = new BoatPhysics({ x: pose.x, z: pose.z, heading: pose.headingDeg * Math.PI / 180, speed: pose.speed ?? 0, vessel });
  const ride = new BoatOnWater({ water, wake, dims, seed: SEED + 17 });
  ride.spray.uniforms.uColor.value.set(0xf2f0ea).multiplyScalar(lum * 3.9);
  if (wake) scene.add(ride.spray.mesh);
  const GT = groundTerrain(core.terrain), ground = createGround({ ...GT, dims });
  boat.update(phys.state, 0);
  let last = ride.step(core.renderer, phys.state, core.time, 1 / 60);
  return {
    boat, phys, ride, vessel,
    // one physics tick (the caller's fixed 60 Hz) in this boat's own sea and wind
    step(dt, ctl, t, windAt) {
      phys.step(dt, ctl, { t, ext: ground.ext, post: ground.post, waveAt: ride.waveAt, currentAt: ride.currentAt, sea: () => ride.wave, windAt });
      last = ride.step(core.renderer, phys.state, t, dt);
    },
    draw(dt, t) { boat.update(last, dt, { t }); },
    dispose() { scene.remove(boat); if (wake) scene.remove(ride.spray.mesh); },
  };
}
