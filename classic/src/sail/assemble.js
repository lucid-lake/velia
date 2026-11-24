// Day Sail's boat (refactor round 2, Phase C step 6: the composer): the Boat
// root, then the sloop's rig (src/craft/sloop/rig.js) in three phases around its body (src/craft/sloop/body.js: the
// GLBs), the hull frame any craft shares (src/craft/hull.js: the physics, the float/wake/spray, the boat's own sound, the
// follow camera, the air, the bottom), and in captures (?headless) the settle (src/craft/sloop/capture.js). The call
// order is the contract (the Boat's attach order is the render order for equal-depth draws). Provides the 'boat' service
// (core.services) = { phys, boat, follow, env, … } and the 'player' service.
import { Boat } from '../boat/Boat.js';
import { vesselDims } from '../../../src/sim/boat/dims.js';
import { CURRENT_VESSEL } from '../../../src/sim/vessels/current.js';
import { createPlayer } from '../../../src/sim/core/player.js';
import { craftOf } from '../../../src/sim/craft/index.js';
import { createHull } from '../craft/hull.js';
import { loadBody } from '../craft/sloop/body.js';
import { createRig } from '../craft/sloop/rig.js';
import { settleCapture } from '../craft/sloop/capture.js';
import { attachBoatShadow } from '../boat/boatShadow.js';

// vessel: the boat's profile (src/vessels/<id>.json; the core's, this page's boat by default): its dims, models,
// sockets and physics
export async function assembleBoat(core, START, { vessel = core.vessel ?? CURRENT_VESSEL } = {}) {
  const { flags, headless, scene, services } = core;
  const craft = craftOf(vessel), dims = vesselDims(vessel);
  const boat = new Boat({ dims }); scene.add(boat);
  if (!flags.boat) boat.visible = false;   // ?boat=0: the frame-time budget check (the boat alone)
  const rig = createRig(core, boat, { vessel, dims, craft });
  rig.spars();
  const body = await loadBody(core, boat, { vessel, dims });
  rig.fittings(body.look);
  rig.sails();
  // the boat's own shadow map (High and Balanced; core.sunShadow is null on Low): its casters, receivers and light box
  const offShadow = attachBoatShadow(boat, core.sunShadow);
  const hull = createHull(core, { craft, vessel, start: START, dims });
  const { phys, follow, ride, boatAudio, sfx, air, ground, env, addPost } = hull;
  boat.update(phys.state, 0);   // after the rig: the sails' first pose
  hull.pose0();
  if (headless) await settleCapture(core, { boat, START, phys, ride, follow, env, air, detailLod: body.detailLod, crewVis: body.crewVis });
  const { instruments, bulkhead } = rig;
  const pub = services.provide('boat', { phys, boat, follow, env, addPost, sfx, ride, instruments, bulkhead, air, ground, vessel });   // instruments: pro's trend (controls.js)   // ride: for tools/motion.mjs
  // the player (src/core/player.js): what everything outside the sail code reads (the shell, the HUD, the birds, the fireworks, the kayaks)
  const player = services.provide('player', createPlayer({ craft: vessel.id, kind: craft.kind, phys, follow, group: boat, addPost, cue: sfx ? (name, o) => sfx.cue?.(name, o) : null }));

  return {
    boat, phys, follow, ride, boatAudio, sfx, air, ground, groundTerrain: hull.groundTerrain,
    dispose() {
      scene.remove(boat);
      offShadow();
      hull.dispose();
      body.dispose(); rig.dispose();
      services.remove('boat', pub);
      services.remove('player', player);
    },
  };
}
