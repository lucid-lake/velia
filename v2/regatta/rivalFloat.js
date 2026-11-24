// The rivals on the waves (fix/v2-rival-float, 2026-11-18; owner: "the other boats don't float following the physics properly: they
// vibrate up and down a lot, unlike the user's sailboat"). Each rival rides the player's own hull float (src/sim/boat/float.js
// HullFloat: 21 patches over the waterplane, the Smith effect at the canoe body's depth, the heave, pitch and roll of a 3-tonne keelboat
// with its added mass and damping, the sails' roll damping), on the same surface the player's float reads (v2/sim/surface.js with the
// hull's filter: no 12 m tile, the newest read carried to the wave clock's time), from the whole 600 and 85 m tiles (heightAt's
// { coarse: true }: the sea she sails in, wherever she is; the player's 21 m window would give her none of it a few lengths off).
// Before: the drawn surface at the hull's middle, each frame (the 12 m tile's ripples and the readback's steps straight onto the
// hull: 6-12 times the player's vertical acceleration, no pitch, no wave roll). One pose for every detail band (near, mid, far), so a
// band change moves nothing.
//   const F = createRivalFloats({ heightAt, now });   heightAt(x, z, opts) → m (the page's water.heightAt); now() the wave clock (s)
//   F.step(id, state, t, dt) → { heave, pitch, roll }   state: the rival's physics state ({ x, z, heading, heel, apparentWind, … });
//                                                       t, dt: the boat's sim clock, as the player's float (B.step's simDt)
//   F.get(id) → the last { heave, pitch, roll } | undefined     F.reset()   (a new race, a restart: every float starts on the water again)
import { HullFloat } from '../../src/sim/boat/float.js';
import { vesselDims } from '../../src/sim/boat/dims.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';

// a jump in her clock or her place past these (a restart's box, a capture's settle, a cut) puts the float back on the water at once
const FLOAT_JUMP = Object.freeze({ dtS: 0.5, moveM: 20 });

export function createRivalFloats({ heightAt = null, now = null, vessel = CURRENT_VESSEL } = {}) {
  const dims = vesselDims(vessel);
  const opt = { depthM: 0, filterM: 0, t: null, coarse: true };
  // the player's float reads (x, z, t, { depthM }) through v2/sim/boat.js waterFor: the same filters here, the coarse tiles
  const surface = { heightAt: (x, z, t, o) => { if (!heightAt) return 0; opt.depthM = o?.depthM ?? 0; opt.filterM = o?.filterM ?? 0; opt.t = now ? now() : null; return heightAt(x, z, opt); } };
  const floats = new Map();   // id → { float, pose, x, z, t }
  return {
    step(id, state, t, dt) {
      let f = floats.get(id);
      if (!f) { f = { float: new HullFloat({ surface, dims, length: dims.HULL.lwl, beam: dims.HULL.beam }), pose: { heave: 0, pitch: 0, roll: 0 }, x: state.x, z: state.z, t }; floats.set(id, f); }
      if (!(dt >= 0) || dt > FLOAT_JUMP.dtS || Math.hypot(state.x - f.x, state.z - f.z) > FLOAT_JUMP.moveM) f.float.state = null;   // re-seat on the surface
      const w = f.float.update(state, t, Math.max(0, Math.min(FLOAT_JUMP.dtS, dt || 0)));
      f.x = state.x; f.z = state.z; f.t = t;
      f.pose.heave = w.heave; f.pose.pitch = w.pitch; f.pose.roll = w.roll;
      return f.pose;
    },
    get(id) { return floats.get(id)?.pose; },
    reset() { floats.clear(); },
    get size() { return floats.size; },
  };
}
