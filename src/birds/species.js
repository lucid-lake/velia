// The cast of Emerald Bay's birds from mid-June to early July (the same cast on both of the map's days): their size, plumage and flight numbers.
// Plain data, no three.js: src/birds/mesh.js builds each body from these, src/birds/flight.js flies them.
//
// Frame: x right, y up, z forward (the bill), metres; the origin near the centre of mass. Colours are linear sRGB
// (srgb() below converts a field-guide hex). Every number with a source is
export const srgb = (hex) => [16, 8, 0].map((s) => { const c = ((hex >> s) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

// Body loft stations: [z, halfWidth, halfHeight, yCentre] from the vent (tail base) to the face; the bill is its own part.
// wing: semispan (m, body centre to tip), arm (shoulder → wrist as a share of the semispan), chord at the root and the
// wrist (m), primaries (count, the outer ones' "fingers": how many separate as slots, their emargination 0–1), secondaries.
// flight: cruise airspeed (m/s), wingbeat (Hz), the flap stroke (deg, half-amplitude), the burst/glide pattern (beats,
// glide s), the soaring circle (radius m, bank deg). colours: top/under for the wing, body regions, bare parts.
export const SPECIES = {
  osprey: {
    name: 'osprey', massKg: 1.6, spanM: 1.6, lengthM: 0.57,
    body: [[-0.17, 0.028, 0.026, 0.0], [-0.11, 0.055, 0.05, -0.006], [-0.04, 0.072, 0.066, -0.004], [0.03, 0.07, 0.066, 0.006],
      [0.09, 0.054, 0.054, 0.022], [0.13, 0.04, 0.042, 0.036], [0.165, 0.036, 0.04, 0.044], [0.2, 0.034, 0.036, 0.046], [0.228, 0.024, 0.026, 0.04]],
    bill: { len: 0.042, depth: 0.022, hook: 1, colour: srgb(0x26221f), cere: srgb(0x6b7276) },
    eye: { z: 0.205, a: 0.3, fwd: 0.35, r: 0.0085, iris: srgb(0xe8c21a) },
    wing: { semispan: 0.8, arm: 0.44, shoulder: [0.035, 0.03, 0.05], rootChord: 0.25, wristChord: 0.27, tipChord: 0.13,
      primaries: 10, fingers: 4, emarg: 0.75, secondaries: 14, wristForward: 0.06, tipBack: 0.12, crook: 1 },
    tail: { len: 0.2, width: 0.11, feathers: 12, shape: 'square', bars: 6 },
    legs: { len: 0.13, colour: srgb(0xb8b4a8), talon: srgb(0x111111) },
    colours: {
      back: srgb(0x3b2a1e), belly: srgb(0xeeebe4), head: srgb(0xf0ede6), crown: srgb(0x5a4330), stripe: srgb(0x2e2118),
      breastBand: srgb(0x8a6a4a), wingTop: srgb(0x3d2c20), wingUnder: srgb(0xe9e5dc), carpal: srgb(0x2b1f17),
      flightUnder: srgb(0xc9c3b8), flightBar: srgb(0x5d4b3c), tailTop: srgb(0x4a3828), tailUnder: srgb(0xd8d2c6),
    },
    flight: { cruise: 10.6, hz: 3.31, stroke: 32, burst: [3, 7], glide: [1.5, 4.5], circleR: 30, bankDeg: 28, hoverHz: 4.2 },
  },
  eagle: {
    name: 'bald eagle', massKg: 4.7, spanM: 2.05, lengthM: 0.86,
    body: [[-0.25, 0.04, 0.036, 0.0], [-0.16, 0.08, 0.072, -0.008], [-0.06, 0.1, 0.092, -0.006], [0.04, 0.098, 0.092, 0.008],
      [0.13, 0.076, 0.074, 0.03], [0.19, 0.058, 0.06, 0.05], [0.24, 0.052, 0.056, 0.062], [0.29, 0.048, 0.05, 0.064], [0.325, 0.034, 0.036, 0.058]],
    bill: { len: 0.07, depth: 0.04, hook: 1.2, colour: srgb(0xe2b52a), cere: srgb(0xe9c24a) },
    eye: { z: 0.292, a: 0.38, fwd: 0.45, r: 0.011, iris: srgb(0xf0dc8a) },
    wing: { semispan: 1.02, arm: 0.45, shoulder: [0.05, 0.04, 0.07], rootChord: 0.4, wristChord: 0.42, tipChord: 0.22,
      primaries: 10, fingers: 7, emarg: 0.85, secondaries: 16, wristForward: 0.05, tipBack: 0.06, crook: 0.25 },
    tail: { len: 0.3, width: 0.17, feathers: 12, shape: 'wedge', bars: 0 },
    legs: { len: 0.17, colour: srgb(0xe3b53c), talon: srgb(0x111111) },
    colours: {
      back: srgb(0x2e2015), belly: srgb(0x2a1d13), head: srgb(0xf3f1ea), crown: srgb(0xf3f1ea), stripe: srgb(0xf3f1ea),
      breastBand: srgb(0x2a1d13), wingTop: srgb(0x30231a), wingUnder: srgb(0x241a12), carpal: srgb(0x241a12),
      flightUnder: srgb(0x1f1813), flightBar: srgb(0x1f1813), tailTop: srgb(0xf1efe8), tailUnder: srgb(0xe9e6de),
    },
    flight: { cruise: 11.2, hz: 2.72, stroke: 28, burst: [2, 4], glide: [12, 40], circleR: 38, bankDeg: 24, hoverHz: 3 },
  },
  gull: {
    name: 'California gull', massKg: 0.6, spanM: 1.32, lengthM: 0.53,
    body: [[-0.13, 0.026, 0.024, 0.004], [-0.07, 0.05, 0.048, -0.004], [-0.0, 0.06, 0.058, -0.004], [0.06, 0.056, 0.055, 0.006],
      [0.11, 0.04, 0.044, 0.022], [0.145, 0.03, 0.034, 0.034], [0.175, 0.03, 0.034, 0.042], [0.205, 0.026, 0.03, 0.044], [0.226, 0.018, 0.02, 0.04]],
    bill: { len: 0.048, depth: 0.016, hook: 0.35, colour: srgb(0xe5c95a), cere: srgb(0xe5c95a), spot: true },
    eye: { z: 0.2, a: 0.35, fwd: 0.15, r: 0.006, iris: srgb(0x2a1f18) },
    wing: { semispan: 0.66, arm: 0.42, shoulder: [0.03, 0.025, 0.06], rootChord: 0.17, wristChord: 0.17, tipChord: 0.05,
      primaries: 10, fingers: 0, emarg: 0.0, secondaries: 14, wristForward: 0.07, tipBack: 0.24, crook: 0.6 },
    tail: { len: 0.13, width: 0.09, feathers: 12, shape: 'square', bars: 0 },
    legs: { len: 0.1, colour: srgb(0xc9c25a), talon: srgb(0x3a3a2a) },
    colours: {
      back: srgb(0x8f98a3), belly: srgb(0xf4f4f1), head: srgb(0xf4f4f1), crown: srgb(0xf4f4f1), stripe: srgb(0xf4f4f1),
      breastBand: srgb(0xf4f4f1), wingTop: srgb(0x8d96a2), wingUnder: srgb(0xeeeeeb), carpal: srgb(0xeeeeeb),
      flightUnder: srgb(0xdfe0de), flightBar: srgb(0xdfe0de), tailTop: srgb(0xf4f4f1), tailUnder: srgb(0xf0f0ed),
      tip: srgb(0x15161a), mirror: srgb(0xf2f2ef),
    },
    flight: { cruise: 9.9, hz: 3.05, stroke: 30, burst: [3, 6], glide: [1.5, 5], circleR: 26, bankDeg: 26, hoverHz: 3.4 },
  },
  goose: {
    name: 'Canada goose', massKg: 4.2, spanM: 1.6, lengthM: 0.92,
    body: [[-0.2, 0.05, 0.05, 0.0], [-0.12, 0.11, 0.09, -0.004], [-0.02, 0.125, 0.1, -0.004], [0.08, 0.115, 0.095, 0.004],
      [0.15, 0.07, 0.07, 0.02], [0.19, 0.032, 0.036, 0.04], [0.27, 0.026, 0.03, 0.06], [0.35, 0.028, 0.03, 0.08], [0.39, 0.036, 0.038, 0.09],
      [0.425, 0.034, 0.036, 0.094], [0.455, 0.022, 0.024, 0.088]],
    bill: { len: 0.05, depth: 0.02, hook: 0, colour: srgb(0x141414), cere: srgb(0x141414), flat: true },
    eye: { z: 0.432, a: 0.3, fwd: 0.1, r: 0.0065, iris: srgb(0x1a140f) },
    wing: { semispan: 0.8, arm: 0.43, shoulder: [0.08, 0.035, 0.08], rootChord: 0.24, wristChord: 0.22, tipChord: 0.08,
      primaries: 10, fingers: 0, emarg: 0.1, secondaries: 15, wristForward: 0.05, tipBack: 0.16, crook: 0.2 },
    tail: { len: 0.13, width: 0.12, feathers: 16, shape: 'round', bars: 0 },
    legs: { len: 0.13, colour: srgb(0x1a1a1a), talon: srgb(0x111111) },
    colours: {
      back: srgb(0x6b5a48), belly: srgb(0xc9bba6), head: srgb(0x111111), crown: srgb(0x111111), stripe: srgb(0x111111),
      breastBand: srgb(0xb3a28a), wingTop: srgb(0x645444), wingUnder: srgb(0x5e5246), carpal: srgb(0x5e5246),
      flightUnder: srgb(0x3e352d), flightBar: srgb(0x3e352d), tailTop: srgb(0x141414), tailUnder: srgb(0xf2efe8),
      chin: srgb(0xf0ece4), neck: srgb(0x121212), vent: srgb(0xf2efe8), tip: srgb(0x2a241f),
    },
    flight: { cruise: 18.7, hz: 4.7, stroke: 36, burst: [999, 999], glide: [0.4, 0.8], circleR: 60, bankDeg: 20, hoverHz: 4 },
  },
};

// The flap stroke over one wingbeat (phase 0–1, 0 = top of the stroke). The downstroke takes ~55 % of the cycle and
// the hand is flexed and swept back on the upstroke (the wing's lift-off).
// Returns the shoulder elevation (rad, +up), the hand's dihedral relative to the arm (rad), and the hand's sweep (rad).
const DOWN = 0.56;
export function strokeAt(phase, strokeDeg, mean = 0.1) {
  const p = phase - Math.floor(phase), A = strokeDeg * Math.PI / 180;
  // an eased triangle: down over DOWN of the cycle, up over the rest; cosine-eased so velocity is continuous at the ends
  const s = p < DOWN ? Math.cos(Math.PI * p / DOWN) : -Math.cos(Math.PI * (p - DOWN) / (1 - DOWN));
  const flap = mean + A * s;
  const up = p >= DOWN ? Math.sin(Math.PI * (p - DOWN) / (1 - DOWN)) : 0;   // 0 → 1 → 0 through the upstroke
  const down = p < DOWN ? Math.sin(Math.PI * p / DOWN) : 0;
  // the hand lags: it trails low at the start of the upstroke (flexed), and leads down at mid-downstroke
  return { flap, hand: -0.55 * A * up + 0.12 * A * down, sweep: -0.5 * up, up, down };
}
