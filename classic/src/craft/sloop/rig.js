// The sloop's rig (refactor round 2, Phase C step 6): the spars and standing
// rigging, the cockpit's fittings (the traveller car, the instruments, the bulkhead) and the sails and lines, moved from
// src/sail/assemble.js. Three phases around the body's load, so the Boat's attach order (render order for equal-depth
// draws) stays today's: spars before the hull, fittings after the cockpit, the sails last.
//   const rig = createRig(core, boat, { vessel, dims, craft });
//   rig.spars(); await loadBody(…); rig.fittings(body.look); rig.sails();
//   rig.instruments, rig.bulkhead   (null in captures: the 'boat' service's)
// A rig needs a sail craft: a paddle craft (a kayak) throws.
import * as THREE from 'three/webgpu';
import { createRigging } from '../../boat/spars-mesh.js';
import { createDetails } from '../../boat/details-mesh.js';
import { makeMainsail, makeJib } from '../../boat/sails.js';
import { makeLines, travellerCarX } from '../../boat/lines.js';
import { ropeNearFor } from '../../boat/rope.js';
import { sailParams, mainPoint, jibPoint, bandFill, bandStall } from '../../../../src/boat/rig.js';
import { createInstruments } from '../../boat/instruments.js';
import { createBulkhead } from '../../boat/bulkhead.js';
import { craftOf } from '../../../../src/sim/craft/index.js';

export function createRig(core, boat, { vessel, dims, craft = craftOf(vessel) }) {
  if (craft?.kind !== 'sail') throw new Error('rig: a sloop\'s rig needs a sail craft');
  const { headless, camera, atmosphere, sunWorld, elev, wind, SEED } = core;
  let rigging = null, details = null;
  const rig = {
    instruments: null, bulkhead: null,
    // M4/M9 (f4): spars, standing rigging, burgee, telltales, nav lights. The rigging group carries mast and boom.
    spars() {
      rigging = createRigging({ dims }); details = createDetails({ rig: rigging.rig, dims });
      boat.attach('mast', new THREE.Group()); boat.attach('boom', new THREE.Group());
      boat.attach('rigging', rigging.group); boat.attach('details', details.group);
      rigging.setLight?.({ sunDir: sunWorld, sunColor: new THREE.Color(1.0, 0.85, 0.7), skyColor: new THREE.Color(0.55, 0.65, 0.8) });
      boat.setUpdate('rigging', (st, dt) => rigging.update(st, dt || 1 / 60));
    },
    // look: the body's cockpit look (its traveller track)
    fittings(look) {
      // the traveller car slides with the boom (the captain's view shows it), in step with the tackle in lines.js
      const travCar = boat.modules.cockpit.getObjectByName('traveller_car'), travX0 = travCar?.position.x ?? 0;
      // the skipper's instruments: the compass card under the dome, the wind-and-speed display by the companionway
      const instruments = rig.instruments = headless ? null : createInstruments();
      if (instruments) boat.sockets.hull.add(instruments.group);
      // feat/instruments: the heel meter, barometer and clock on the companionway bulkhead (src/boat/bulkhead.js)
      const bulkhead = rig.bulkhead = instruments ? createBulkhead({ hour: () => core.sun?.hour ?? 12, advisory: !!wind.day?.advisory, seed: SEED }) : null;
      if (bulkhead) boat.sockets.hull.add(bulkhead.group);
      boat.setUpdate('cockpit', (st, dt, e) => { if (travCar) { travCar.position.x = travX0 + travellerCarX(st.boomAngle ?? 0, st.traveller ?? 0); travCar.position.y = look.trackY(travCar.position.x) ?? travCar.position.y; } instruments?.update(st, e?.t); bulkhead?.update(st, e?.t); });
    },
    sails() {
      boat.attach('main', makeMainsail({ atmosphere }));
      boat.attach('jib', makeJib({ atmosphere }));
      // the lines: rope tubes near the camera (inside the tier's distance: 15 m, 6 m on Low; src/boat/rope.js), ribbons beyond
      boat.attach('lines', makeLines({ camera, origin: boat, nearM: ropeNearFor(core.tier?.name) }));
      // the sail telltales sit on the sails' own surface (rig.js) and read the physics' fill and stall (the stall cue)
      boat.setUpdate('details', (st, dt, e) => {
        const t = e?.t ?? core.time, sp = sailParams(st);
        details.update(t, { apparentWind: st.apparentWind, sunElevDeg: core.sun?.elevationDeg ?? Math.asin(elev) * 57.3, camera,
          sails: { main: (u, v) => mainPoint(u, v, sp.main, t), jib: (u, v) => jibPoint(u, v, sp.jib, t), mainFill: st.mainFill, jibFill: st.jibFill,
            lee: Math.sign(st.boomAngle) || 1, jibLee: Math.sign(st.jibAngle) || 1, mainStall: st.mainStall, jibStall: st.jibStall, groove: st.groove,
            // pro: the bands by height (only when they differ: a basic boat reads the whole sail)
            fillAt: (k, v) => (sp[k].fillTop != null ? bandFill(sp[k], v) : undefined),
            stallAt: (k, v) => (sp[k].twistX != null ? bandStall(st, k, v) : undefined) } });
      });
    },
    dispose() {},   // the rig leaves with the Boat (the composer's scene.remove(boat))
  };
  return rig;
}
