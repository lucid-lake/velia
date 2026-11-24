// Regatta's marks as the player reads them (owner 2026-11-16, the guidance pass): on screen the marks are numbered by their order in a
// lap, 1, 2, 3 … and the finish F; a later lap says so ("2 (lap 2)"). The course JSON's ids (W, I, L …) stay internal. The watch's
// first line names the leg, the mark and the side ("Leg 1 of 3 · Mark 1 · round to port"; a compact screen "Leg 1/3 · ⟲ 1"). The rounding
// gate's arc sits on the side of the mark the player must not pass. Pure: v2/tests/regatta-guidance.test.mjs.
//   markNumbers(course)            → Map id → number (1-based, the order the marks are first sailed in a lap)
//   legMark(course, leg)           → { num: '1' | 'F', text: '1' | '2 (lap 2)' | 'FINISH', lap, laps, finish, rounding, id }
//   legLine(course, leg, compact)  → the watch's first line (compact: the race's compact screen, regatta/ui.js compactScreen)
//   gateArc(a, rounding, sweep)    → { a0, sgn, sweep, mid }: the gate's arc about the mark (a: the boat's bearing angle from the mark,
//                                     atan2(z, x)); its colour: GATE_INK[rounding]
export const ROUND_SYMBOL = Object.freeze({ port: '⟲', starboard: '⟳' });   // ⟲ round to port (anticlockwise from above), ⟳ to starboard
// the gate (owner 2026-11-16): a short arc on the water at 1.5 zone radii, on the side the player must not pass; leave-to-port → green,
// leave-to-starboard → red (the side of the boat the gate shows on is the other); arrowheads the way round
export const GATE = Object.freeze({ zoneK: 1.5, sweep: 0.75 * Math.PI, heads: 3, freezeK: 1.8 });

export function markNumbers(course) {
  const m = new Map(), lap = (course?.lapLegs ?? course?.legs?.map((l) => ({ to: l.toId })) ?? []);
  for (const l of lap) { const id = l.to ?? l.toId; if (id && id !== 'finish' && !m.has(id)) m.set(id, m.size + 1); }
  return m;
}

export function legMark(course, leg) {
  const legs = course?.legs ?? [], i = Math.max(0, Math.min(legs.length - 1, leg | 0)), g = legs[i];
  const laps = course?.laps ?? 1, perLap = Math.max(1, (legs.length - 1) / laps);
  if (!g || g.toId === 'finish') return { num: 'F', text: 'FINISH', lap: laps, laps, finish: true, rounding: null, id: 'finish', leg: i };
  const n = markNumbers(course).get(g.toId) ?? i + 1, lap = Math.floor(i / perLap) + 1;
  return { num: String(n), text: lap > 1 ? `${n} (lap ${lap})` : String(n), lap, laps, finish: false, rounding: g.rounding ?? 'port', id: g.toId, leg: i };
}

export function legLine(course, leg, compact = false) {
  const n = course?.legs?.length ?? 1, k = legMark(course, leg), L = k.leg + 1;
  if (k.finish) return compact ? `Leg ${L}/${n} · F` : `Leg ${L} of ${n} · Finish`;
  if (course?.byId?.[k.id]?.kind === 'gate') return compact ? `Leg ${L}/${n} · Gate ${k.text}` : `Leg ${L} of ${n} · Gate ${k.text} · red to port`;   // a place race's gate
  const side = k.rounding === 'starboard' ? 'starboard' : 'port';
  return compact ? `Leg ${L}/${n} · ${ROUND_SYMBOL[side]} ${k.text}` : `Leg ${L} of ${n} · Mark ${k.text} · round to ${side}`;
}

// the boat at bearing angle a from the mark (atan2(z, x) on the water, x east, z south). Rounding to port the boat goes round the
// mark with the angle decreasing (turnArrow's sense, sgn −1), so she passes it abeam at a + sgn·π/2; the side she must not pass is
// a − sgn·π/2. The arc is centred there, `sweep` wide: clear of her own line in (a) and of the far point (a + π) by (π − sweep)/2
export function gateArc(a, rounding = 'port', sweep = GATE.sweep) {
  const sgn = rounding === 'starboard' ? 1 : -1, mid = a - sgn * Math.PI / 2;
  return { a0: mid - sgn * sweep / 2, sgn, sweep, mid };
}
