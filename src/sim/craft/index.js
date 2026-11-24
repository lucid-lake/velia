// The craft registry (refactor round 2, Phase C step 5): what the player
// steers, keyed by the profile's `craft` field ('sloop' | 'kayak'). Each craft row gives the Simulation one interface:
//   craft.id, craft.kind ('sail' | 'paddle': src/core/player.js PLAYER_KINDS), craft.inputs (the input record its
//   controller writes), craft.createPhysics({ x, z, heading, speed, params, vessel }) → a stepper
//   ({ state, t, vessel, step(dt, inputs, env) }), craft.restorePhysics(data, params, vessel) → the same from a snapshot.
// Static imports: the Simulation is synchronous and node runs it. Plain JS, no DOM.
//   craftOf(vessel)   the craft that sails this profile (no `craft` field: a sloop); throws on an unknown craft
//   craftById(id)     the row by its id
//   vesselFor(id)     a profile by id: a craft-local one (the kayak's), else this page's boat, else the registry's
//   camerasFor(vessel)  the craft's camera settings for this profile ({ follow: { hull }, helm: { eye } }, step 7; this
//                     page's boat when null); a craft with none yet (the kayak) gives { follow: {}, helm: {} }: the cameras' defaults
import { craft as sloop } from './sloop/index.js';
import { craft as kayak } from './kayak/index.js';
import KAYAK_VESSEL from '../../craft/kayak/vessel.json' with { type: 'json' };
import { CURRENT_VESSEL } from '../vessels/current.js';
import { vesselById } from '../vessels/index.js';

export const CRAFTS = Object.freeze({ sloop, kayak });
// the profiles that live with their craft, not in src/vessels/index.json (no home-card row, no menu)
export const CRAFT_VESSELS = Object.freeze({ [KAYAK_VESSEL.id]: KAYAK_VESSEL });

export function craftById(id) {
  const c = Object.hasOwn(CRAFTS, id) ? CRAFTS[id] : null;
  if (!c) throw new Error(`craft: no craft '${id}' (one of ${Object.keys(CRAFTS).join(', ')})`);
  return c;
}
export const craftOf = (vessel) => craftById(vessel?.craft ?? 'sloop');

export function vesselFor(id) {
  if (id != null && Object.hasOwn(CRAFT_VESSELS, id)) return CRAFT_VESSELS[id];
  return id == null || id === CURRENT_VESSEL.id ? CURRENT_VESSEL : vesselById(id);
}

const NO_CAMERAS = Object.freeze({ follow: Object.freeze({}), helm: Object.freeze({}) });
export function camerasFor(vessel) {
  const v = vessel ?? CURRENT_VESSEL;
  return craftOf(v).cameras?.(v) ?? NO_CAMERAS;
}
