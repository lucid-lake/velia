// A race's wind shift pattern ("Shifts", step B4): the shape of the beat's tactics, set on the one wind module
// (src/sim/wind.js WindField.pattern: the pattern's turn in place of the lake's own wander and readable shifts while a race runs; the
// valley still steers it, and every effect that reads the wind sees the same turn). Pure: v2/tests/regatta-custom.test.mjs.
//   Steady       no shift: the wind holds its direction (the valley's own bend only)
//   Oscillating  the direction swings ±OSC.ampDeg about the mean with a period of OSC.periodS (sim seconds), zero at the gun and at the
//                start of the pre-start (the box is laid on the mean wind): tack on the headers
//   Persistent   the direction turns steadily to one side, PERSIST.deg over the race (left: the wind backs, counter-clockwise; right:
//                it veers), from the gun: the side it turns to pays
//   makePattern(id, { tGun, raceS }) → { id, deg(t), maxDeg } | null (null: the lake's own shifts, as before patterns)
//   shiftTo(id, deltaDeg, tack) → 'lift' | 'header' | null: a shift of deltaDeg (+ veer) on a tack ('stbd' | 'port')
export const OSC = Object.freeze({ ampDeg: 10, periodS: 90 });
export const PERSIST = Object.freeze({ deg: 12, minS: 240 });
export const SHIFT_IDS = Object.freeze(['steady', 'oscillating', 'left', 'right']);
export const SHIFTS = Object.freeze([
  Object.freeze({ id: 'steady', label: 'Steady', word: 'steady wind', coach: 'A steady wind today: sail the shorter tack first, then the long one.' }),
  Object.freeze({ id: 'oscillating', label: 'Oscillating', word: 'oscillating shifts', coach: 'The wind swings 10° each way: tack when it heads you.' }),
  Object.freeze({ id: 'left', label: 'Persistent left', word: 'persistent left shift', coach: 'The wind will turn left all race: the left side pays.' }),
  Object.freeze({ id: 'right', label: 'Persistent right', word: 'persistent right shift', coach: 'The wind will turn right all race: the right side pays.' }),
]);
export const shiftOf = (id) => SHIFTS.find((s) => s.id === id) ?? SHIFTS[1];

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export function makePattern(id, { tGun = 0, raceS = 600 } = {}) {
  if (id === 'steady') return { id, maxDeg: 0, deg: () => 0 };
  if (id === 'oscillating') { const w = (2 * Math.PI) / OSC.periodS; return { id, maxDeg: OSC.ampDeg, deg: (t) => OSC.ampDeg * Math.sin(w * (t - tGun)) }; }
  if (id === 'left' || id === 'right') {
    const s = id === 'left' ? -1 : 1, T = Math.max(PERSIST.minS, raceS);
    return { id, maxDeg: PERSIST.deg, deg: (t) => s * PERSIST.deg * smooth((t - tGun) / T) };
  }
  return null;
}

// a header forces a close-hauled boat away from the mark; a lift lets her point higher. Starboard tack (the wind over the starboard
// side, heading = windFrom − α): the wind backing (− degrees) heads her; port tack: veering (+) heads her
export function shiftTo(deltaDeg, tack) {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) < 1e-9 || (tack !== 'stbd' && tack !== 'port')) return null;
  const header = tack === 'stbd' ? deltaDeg < 0 : deltaDeg > 0;
  return header ? 'header' : 'lift';
}
