// The one source of the boat's dimensions (2026-10-29: Boat.js, the sails and the rig had disagreed). Metres, +y up,
// bow toward −z. The numbers are the boat profile's (src/vessels/<id>.json: spec in feet and pounds as published, hull
// and rig in metres); vesselDims(vessel) derives the frames from them. A module takes the dims of the boat it builds
// (its caller passes them, or the boat's own: boat.dims); DEFAULT_DIMS is this page's boat (src/vessels/current.js).
//
// THE BOAT IS A CATALINA 28 Mk II (owner, 2026-10-29: build close to a real boat).
// Real numbers where sourced; [est] where not (mast height above deck, freeboard, deck heights, fitting positions).
//
// Two frames:
//   HULL frame: origin at the hull's centre on the waterline. The hull, keel, rudder, cockpit, wheel, hardware.
//   RIG frame:  origin at the mast step on the cabin top (HULL [0, HULL.mastStepY, HULL.mastStepZ]); deck-stepped
//               (4e's M1 question, the developer's call 2026-10-29). The mast, boom, sails, standing and running
//               rigging, telltales, burgee. Boat.js mounts the rig frame at that point.
import { CURRENT_VESSEL } from '../vessels/current.js';

const FT = 0.3048;

// { SPEC (the published numbers, feet and pounds), HULL, RIG, SAIL_AREA } for a boat profile; the same profile object
// gives the same object (modules memoise on it)
const memo = new WeakMap();
export function vesselDims(vessel) {
  let d = memo.get(vessel);
  if (!d) memo.set(vessel, (d = build(vessel)));
  return d;
}

function build(v) {
  const C28 = v.spec, h = v.hull, r = v.rig;   // C28: the published numbers (feet and pounds), the profile's spec
  const HULL = {
    loa: C28.loa * FT,            // 8.64
    lwl: C28.lwl * FT,            // 7.26
    beam: C28.beam * FT,          // 3.15
    draft: C28.draftFin * FT,     // 1.60 (fin keel)
    displacementKg: C28.displacementLb * 0.4536,   // 3,765
    ballastKg: C28.ballastLb * 0.4536,             // 1,452
    freeboard: h.freeboard,       // [est] sheer height above the waterline amidships (4e's M1)
    stemZ: h.stemZ,               // the forestay fitting, HULL z [est: just aft of the bow at −LOA/2]
    mastFrontZ: h.mastFrontZ,     // the mast's front face is 0.08 m forward of the step centre (f4)
    mastStepZ: h.stemZ + C28.J * FT + h.mastFrontZ, // −0.74: J runs from the forestay fitting to the mast's front face
    mastStepY: h.mastStepY,       // the cabin top at the mast, centreline (M1, blender/m1_hull.py)
    // deck heights at the rig fittings, from M1 (its build checks them against this file within 5 mm): the stem fitting
    // (z stemZ), the chainplates (±chainplateX, z mastStepZ), the backstay plates (±0.70, z transomZ: a split
    // backstay either side of the walk-through transom)
    bowDeckY: h.bowDeckY, sideDeckY: h.sideDeckY, sternDeckY: h.sternDeckY,   // the backstay plates stand on the stern corner seats (0.40 m over the sole)
    rudderZ: h.rudderZ, wheelZ: h.wheelZ,  // [est] from the T-cockpit layout
    chainplateX: h.chainplateX,   // [est] INBOARD chainplates against the cabin trunk (a Catalina 28 hallmark; f4)
    transomZ: h.transomZ,         // [est] the backstay plate at the transom (stern platform aft of it)
    // nav light lenses (f4, M9) [est]: the bicolour on the bow pulpit, the sternlight on the stern pulpit; until 4e's M8
    navBow: h.navBow, navStern: h.navStern,   // on M8's pulpits (hero hull): the bow pulpit's tip, the starboard stern pulpit's inner end
    // the engine and the anchor (hero hull, 2026-10-29; sockets in Boat.js for the features engineer) [est]:
    // exhaust: the outlet on the starboard quarter (M1 builds the ring there; x is the hull's as built, hull.json);
    // prop: the propeller hub on the shaft, forward of the rudder, the shaft rising forward at propShaftDeg;
    // anchorPin: the stowed anchor's shackle, aft of the roller (M8 builds the anchor there, hardware.json; the roller
    // sits 0.12 m to starboard of the furler drum); anchorRoller: the front roller's axle, where the chain leaves the bow
    exhaust: h.exhaust, prop: h.prop, propShaftDeg: h.propShaftDeg,
    anchorPin: h.anchorPin, anchorRoller: h.anchorRoller,
    // the engine's single-lever control on the starboard cockpit side by the helm (feat/engine-anchor; until the cockpit
    // engineer's M3 places it) [est]
    throttle: h.throttle,
  };

  // The rig, in the RIG frame (z from the mast step, y above the cabin top).
  const HULL_MAST_FRONT = HULL.mastFrontZ;
  const iAboveStep = C28.I * FT - (HULL.mastStepY - HULL.sideDeckY);   // I is measured from the sheer at the mast
  const RIG = {
    forestayTang: iAboveStep,       // 10.66: the masthead forestay tang (I from the sheer)
    mastTop: iAboveStep + r.truckAboveTang,   // 10.78: the truck (f4); air draft ≈12.4 m + antenna, matching brokers' 40.4–41 ft
    gooseneck: r.gooseneck,         // f4: the main's head band at 1.05 + P = 10.50, under the tang
    boom: C28.E * FT,               // E: 3.28
    mainLuff: C28.P * FT,           // P: 9.45
    mainHead: r.mainHead,
    roach: r.roach,
    battens: r.battens,             // full-batten main (reference sheet §15)
    reefs: r.reefs,
    tack: [0, HULL.bowDeckY + r.tackAboveBowDeck - HULL.mastStepY, HULL.stemZ - HULL.mastStepZ],   // the furler drum: z −3.30
    head: [0, iAboveStep - r.headBelowTang, -HULL_MAST_FRONT],   // masthead rig: the jib head just under the forestay tang
    jibLP: r.jibLP,                 // [est] ≈18.4 m² (the 100 % jib, 197.6 ft²) with the luff below
    jibHead: r.jibHead,
    mainDraft: r.mainDraft, jibDraft: r.jibDraft,
    mainTwistDeg: r.mainTwistDeg, jibTwistDeg: r.jibTwistDeg,
    spreaders: r.spreaders,         // double in-line spreaders, sweep 0 (f4)
    capTang: r.capTang,             // cap shroud tangs (f4)
    lowerChainplates: [[HULL.chainplateX - r.lowerInboard, HULL.sideDeckY - HULL.mastStepY, -r.lowerZ], [HULL.chainplateX - r.lowerInboard, HULL.sideDeckY - HULL.mastStepY, r.lowerZ]],   // fore-and-aft lowers (f4), ±x
    chainplate: [HULL.chainplateX, HULL.sideDeckY - HULL.mastStepY, 0],
    backstayPlate: [0, HULL.sternDeckY - HULL.mastStepY, HULL.transomZ - HULL.mastStepZ],
  };

  // Areas for the physics (m²): the published sail areas, not the geometry.
  const SAIL_AREA = { main: v.sails.main.areaFt2 * FT * FT, jib: v.sails.jib.areaFt2 * FT * FT };   // 15.5, 18.4
  return { SPEC: C28, HULL, RIG, SAIL_AREA };
}

// this page's boat (src/vessels/current.js)
export const DEFAULT_DIMS = vesselDims(CURRENT_VESSEL);
