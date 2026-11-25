// The point of sail from the true wind angle (pure): the wind dial's label and its sector ring.
//   pointOfSail(twaDeg, prev)   // → a POINTS row's id; prev (the last id) holds within HYST degrees past its edges, so a boat
//                               //   on a boundary does not flicker between two words
//   POINTS                      // [{ id, label, from, to }] in |TWA| degrees, bow to stern
export const POINTS = Object.freeze([
  { id: 'irons', label: 'In irons', from: 0, to: 40 },
  { id: 'close', label: 'Close-hauled', from: 40, to: 55 },
  { id: 'closeReach', label: 'Close reach', from: 55, to: 80 },
  { id: 'beam', label: 'Beam reach', from: 80, to: 100 },
  { id: 'broad', label: 'Broad reach', from: 100, to: 150 },
  { id: 'run', label: 'Running', from: 150, to: 180 },
]);
export const HYST = 3;   // degrees

const byId = Object.fromEntries(POINTS.map((p) => [p.id, p]));
export const pointLabel = (id) => byId[id]?.label ?? '';

export function pointOfSail(twaDeg, prev = null, hyst = HYST) {
  const a = Math.min(180, Math.abs(twaDeg));
  const p = prev && byId[prev];
  if (p && a >= p.from - hyst && a <= p.to + hyst) return p.id;
  for (const q of POINTS) if (a < q.to) return q.id;
  return 'run';
}
