// M10: the boat on the water, one object for the assembly. It owns the hull float (heave, pitch and the waves' roll
// from 6 probes), the bow spray, and drives the wake map; it hands the physics the CPU wave surface.
// The spray and the wake are the engine's (Sprint 0): the spray comes from makeSpray (v1: src/boat/ride.js
// passes src/boat/spray.js createSpray), the wake is handed in; with neither, the ride is the float alone.
//
//   const wake = createWake();                                        // before the water: the water shader reads it
//   const water = createWater({ ..., wake });
//   const ride = new BoatOnWater({ water, wake, makeSpray });  scene.add(ride.spray.mesh);
//   env.waveAt = ride.waveAt                                          // for the physics (contract.js)
//   env.sea = () => ride.wave                                         // the waves' surge and the bow's slam (src/sim/boat.js § 6b)
//   each frame: const pose = ride.step(renderer, phys.state, t, dt);  boat.update(pose, dt)
// pose is the physics STATE with heave and pitch from the float and the waves' roll added to the physics' heel.
// water: the water surface the sim reads (src/sim/waterSurface.js).
import { HullFloat } from './float.js';
import { DEFAULT_DIMS } from './dims.js';
import { liveSurface } from '../waterSurface.js';

export class BoatOnWater {
  // dims: the boat's (src/sim/boat/dims.js; this page's boat by default); makeSpray({ dims, length, beam, seed }) → the
  // engine's spray ({ update(state, wave, dt) }), or none
  constructor({ water, wake, dims = DEFAULT_DIMS, length = dims.HULL.lwl, beam = dims.HULL.beam, seed = 1, makeSpray = null } = {}) {
    this.water = water; this.wake = wake; this.length = length;
    // the float reads water.surface each call (it is rebuilt when the wind or the fetch changes)
    this.float = new HullFloat({ surface: liveSurface(water), dims, length, beam });
    this.spray = makeSpray ? makeSpray({ dims, length, beam, seed }) : null;
    this.wave = { heave: 0, pitch: 0, roll: 0, slopeX: 0, bowRel: 0, bowRelVel: 0 };   // the float's last answer (env.sea)
    // the surface at a point, waves shorter than half the hull averaged out (what a hull feels)
    this.waveAt = (x, z, t) => water.waveAt(x, z, t, { filterM: 0.5 * length });
    // the waves' orbital velocity the hull rides (the physics' env.currentAt): the sea filtered at half the hull, the Smith effect at its draft
    this.currentAt = (x, z, t) => water.orbitAt?.(x, z, t, { filterM: 0.5 * length, depthM: this.float.depthM }) ?? null;
    this.afterStep = [];   // fn(dt, t, state, pose) after each step (src/sim/craft/hull.js: the air steps with the boat)
  }

  step(renderer, state, t, dt) {
    this.wave = this.float.update(state, t, dt);
    if (this.wake) this.wake.update(renderer, state, dt);
    this.spray?.update(state, this.wave, dt);
    const pose = { ...state, heave: this.wave.heave, pitch: this.wave.pitch, heel: (state.heel ?? 0) + this.wave.roll };
    for (const f of this.afterStep) f(dt, t, state, pose);
    return pose;
  }
}
