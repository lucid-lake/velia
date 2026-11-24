// M10: the boat on the water, v1's: the shared sim's ride (src/sim/boat/ride.js: the hull float, the wake's step, the
// wave surface for the physics) with this engine's bow spray (spray.js, TSL) made in its place.
//   const ride = new BoatOnWater({ water, wake });  scene.add(ride.spray.mesh);   (the rest: src/sim/boat/ride.js)
import { BoatOnWater as RideSim } from '../../../src/sim/boat/ride.js';
import { createSpray } from './spray.js';

export class BoatOnWater extends RideSim {
  constructor(o = {}) { super({ makeSpray: createSpray, ...o }); }
}
