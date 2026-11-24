// The kayak's numbers: a generic rotomoulded polyethylene sit-on-top single, the
// rental class that paddles at Sand Harbor, Kings Beach and Zephyr Cove. Not any maker's design: the numbers sit inside
// the class's published range (3.4–3.6 m × 0.75–0.78 m × ≈ 0.32 m, 22–26 kg), the layout is the class's common one.
//
// Frame (as the boat's hull frame): x starboard, y up from the lowest point of the keel strip, z aft; the bow at −z.
// Every length in metres.
export const KAYAK = Object.freeze({
  length: 3.40,          // overall, stem to stern (sheet 1)
  beam: 0.78,            // at the gunwale, the widest station (sheet 2)
  beamAt: 0.53,          // the widest station, a fraction of the length from the bow (sheet 3)
  plan: { bowP: 2.4, bowQ: 0.60, sternP: 3.0, sternQ: 0.48 },   // half-beam = B/2·(1 − |u|^p)^q, u ∈ [−1, 1] bow → stern
  sheerMid: 0.310,       // the gunwale's top over the keel datum at the seat (sheet 4)
  sheerBow: 0.140,       // the deck's rise to the bow (sheet 5)
  sheerStern: 0.045,     // and to the stern
  rocker: { bow: 0.095, stern: 0.055, bowStem: 0.13, sternStem: 0.085 },   // keel lift at the ends; the stems' sweep (sheet 6)
  rake: { bow: 0.16, stern: 0.06 },   // the stems' rake: the deck's tip overhangs the forefoot by this much (sheet 6)
  deadrise: 0.035,       // the bottom's V, centre to chine (sheet 7)
  keelStrip: { h: 0.018, w: 0.036 },        // the moulded keel strip, proud of the V (sheet 8)
  sponson: { h: 0.026, at: 0.58, w: 0.12 }, // the two sponsons (tri-form bottom), at 60 % of the half-beam (sheet 8)
  gunwaleR: 0.036,       // the rounded hull–deck edge (rotomoulding: blunt, never crisp)
  panel: { depth: 0.012, lo: 0.30, hi: 0.70 },   // the side's recessed panel between the chine ridge and the rail (P1's crease), as fractions of the side's height
  lip: { depth: 0.010, below: 0.055, w: 0.014 },   // the moulded rail line along the side, under the gunwale
  crown: { mid: 0.012, ends: 0.045 },       // the deck's camber
  // the moulded cockpit (one recess from the footwells to the seat back; sheet 9–11)
  cockpit: { front: -1.04, back: 0.44, hwSeat: 0.235, hwFeet: 0.200, r: 0.10, wall: 0.026,
    seatFloor: 0.140, footFloor: 0.170, frontFloor: 0.200 },
  seatZ: 0.20,           // the hips (the seat anchor)
  footSteps: { z0: -0.98, n: 5, pitch: 0.105, h: 0.075, w: 0.050, inner: 0.100, pocket: 0.045 },   // foot-brace ridges at each side (sheet 12)
  console: { front: -0.60, back: -0.20, hw: 0.080, r: 0.06, wall: 0.035, top: 0.215, hatchR: 0.076 },   // the raised console between the legs, a 6 in hatch on it (sheet 10)
  tankWell: { front: 0.60, back: 1.14, hwFront: 0.195, hwBack: 0.150, r: 0.07, wall: 0.024, depth: 0.105 },
  bowWell: { front: -1.30, back: -1.10, hw: 0.105, r: 0.06, wall: 0.020, depth: 0.040, ribs: 3 },   // a shallow ribbed bow well under the bow's shock cord
  cup: { x: 0.315, z: -0.08, r: 0.036, depth: 0.045 },   // sheet 13
  scupper: { r: 0.016, at: [[-0.085, 0.30], [0.085, 0.30], [-0.075, -0.70], [0.075, -0.70], [-0.09, 0.86], [0.09, 0.86]] },   // sheet 14
  mass: { empty: 24.0, paddle: 1.0, paddler: 80.0 },   // kg (sheet 15)
  paddle: { length: 2.30, shaftD: 0.030, bladeL: 0.465, bladeW: 0.170, feather: 60 },   // sheet 16
  rho: 1000,             // kg/m³, Tahoe's fresh water
});

// Real rotomould shades, sRGB (never pure primaries; albedo capped at 0.82 linear by the material). Set by eye against the
// reference photos under the game's own light and AgX (which pushes a bright saturated albedo toward pastel: the first
// #C23A2E red rendered salmon). Sun fade lightens and greys them toward a chalky pastel (materials.js).
// Colour schemes (owner, round 2: P1 and P2 are the look targets): a single colour, a two-tone deck over a light hull
// (P2: the deck and the side's upper band in colour, white below the parting line), or a two-colour swirl blended along
// the length (P1: yellow at the bow into red at the stern, soft streaky mixing). Our own presets, no maker's.
export const KAYAK_SCHEMES = Object.freeze({
  'orange-white': { mode: 'twotone', a: '#E89404', b: '#DAD8D0' },
  sunset: { mode: 'swirl', a: '#D6BA0C', b: '#B8420F' },
  'blue-white': { mode: 'twotone', a: '#1C4F8C', b: '#DAD8D0' },
});

export const KAYAK_COLOURS = Object.freeze({
  yellow: '#D6BA0C',     // a warm "sunrise" yellow (P1's yellow: hue ≈ 44°)
  red: '#B8420F',        // tomato red (P1's red: hue ≈ 12°)
  orange: '#E89404',
  lime: '#6A9620',
  blue: '#1C4F8C',
  teal: '#0F6E6E',
});
