// The storm's sea (storm round 2, 2026-11-18): a storm's waves must read as a storm, and the look's goal beats realism here.
// Left to the outflow alone the sea follows its veer to 250°, which crosses only a few hundred metres of water off Emerald
// Bay's mouth and held the storm's sea at or under the fair day's. The cheat is on the sea's inputs alone (the spectrum's wind
// and fetch): the boat floats on the sea that is drawn, so her pitch and heel follow it physically; her sails still feel the
// true wind.
// Calmer (2026-11-26): the first cheat (the sea's wind × 1.6 on top of the outflow's own × 1.4–1.55, the fetch toward 10 km)
// drew a sea 2.3–4 × the fair day's significant height at the same spot (2.1 m off Emerald Bay's mouth against 0.53 m), too
// big to sail. The storm's sea is now pinned to the fair day's: its wind is the day's wind under the storm (the outflow's
// gain taken back out) × (1 + wind), its fetch the spot's own along the day's wind (main.js seaNow traces it there, so the
// outflow's veer to 250° neither shortens it off the west shore nor stretches it out of a bay's mouth). The fetch-limited sea
// grows about linearly with the wind, so the storm's sea is about (1 + wind) × the fair day's wherever it passes:
// 1.3–1.45 × at Emerald Bay's mouth, the open lake and the bay's entrance (v2/tests/storm-phone.test.mjs holds the band).
//   k = the outflow's strength (the storm state's front[3]: up from 50 to 90 s, down from 220 to 260 s, eased in and out with
//   the storm; 0 with no storm, so a fair sea is untouched)
//   speed → mix(the outflow's speed, the day's speed × (1 + wind), k); the day's speed = the speed / gain (storm.waterWind's gain)
// caps: the whitecaps' share of the sea × (1 + caps · k): the law v2 keeps for fair days is linear in the wind's power; at the
// storm's lower sea wind × 2 keeps about 0.8 of the first cheat's share (2.2 % of the 12 m tile against 2.7 %), so the crests
// still read white everywhere (Beaufort 6–7, the NOAA plates); the Jacobian's own storm foam (render/water.js) carries the rest
export const STORM_SEA = Object.freeze({ wind: 0.4, caps: 1 });

// o: the sea's wind record ({ speedMs, gain, fetchM, … }: main.js seaNow), changed in place; gain: the outflow's gain on the
// day's speed (1 or absent: none); W: the storm's weather state
export function stormSea(o, W, S = STORM_SEA) {
  const k = W && W.on > 0.5 ? Math.min(1, Math.max(0, W.front?.[3] ?? 0)) : 0;
  o.capK = 1 + S.caps * k;
  if (k <= 0) return o;
  const day = o.speedMs / (o.gain > 0 ? o.gain : 1);
  o.speedMs += (day * (1 + S.wind) - o.speedMs) * k;
  return o;
}
