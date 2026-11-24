// The barges' salute (Pass the Channel; owner go 2026-11-19): when the PLAYER crosses the finish of a race that
// carries the salute, the barges past the mouth fire SALUTE.lengthS of the July 4th show's own shells (its stars, sound and
// reflection: living/fireworksPlugin.js salute()). Desktop and tablet only: a phone has no fireworks (features.js 'fireworks', the
// 2026-11-17 ruling), so a phone's finish gets the committee horn and no salute. Pure (v2/tests/regatta-places.test.mjs).
//   saluteDue(events, { hooks, fired }) → true on the step the player's 'finished' event comes in a race whose hooks name 'salute'
//   saluteShow(show, { n, lengthS }) → a short script from the show's own events: its n biggest aerial shells (a spread of types),
//                                      launched one every gap s from 0.5 s, each keeping its own rise, so all burst inside lengthS
export const SALUTE = Object.freeze({ lengthS: 15, shells: 8, firstS: 0.5, gapS: 1.3 });

export function saluteDue(events = [], { hooks = [], fired = false } = {}) {
  if (fired || !hooks.includes('salute')) return false;
  return events.some((e) => e.type === 'finished' && e.id === 'me');
}

export function saluteShow(show, { n = SALUTE.shells, lengthS = SALUTE.lengthS, firstS = SALUTE.firstS, gapS = SALUTE.gapS } = {}) {
  const aerial = (show?.events ?? []).filter((e) => (e.height ?? 0) > 0 && Number.isFinite(e.rise));
  // the biggest of each type first, then the next size down: the salute is varied, not eight of one shell
  const byType = new Map();
  for (const e of [...aerial].sort((a, b) => (b.inches ?? 0) - (a.inches ?? 0) || a.t - b.t)) { if (!byType.has(e.type)) byType.set(e.type, []); byType.get(e.type).push(e); }
  const picked = [];
  for (let round = 0; picked.length < n && round < 8; round++) for (const list of byType.values()) { if (list[round] && picked.length < n) picked.push(list[round]); }
  const events = picked.map((e, i) => { const t = firstS + i * gapS; return { ...e, i, t: +t.toFixed(4), burst: +(t + e.rise).toFixed(4), barge: i % 2 }; })
    .filter((e) => e.burst < lengthS - 1);
  return { ...(show ?? {}), length: lengthS, events };
}
