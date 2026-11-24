// The storm's sea (owner, 2026-11-18, storm round 2: "storm waves must read as a storm … cheat on the sea state for the storm";
// "the owner's goal beats realism here"). Under the outflow the sea is built from a stronger wind over a longer fetch than the
// spot has: the outflow from 250° crosses only the west shore's 2–3 km of water off Emerald Bay's mouth, which held v2's storm
// sea at 0.29 m, the fair day's. The cheat is on the sea's inputs alone (the spectrum's wind and fetch): the boat floats on the
// sea that is drawn, so her pitch and heel follow it physically; her sails still feel the true wind.
//   k = the outflow's strength (the storm state's front[3]: up from 50 to 90 s, down from 220 to 260 s, eased in and out with
//   the storm; 0 with no storm, so a fair sea is untouched)
//   speed × (1 + wind · k), fetch toward fetchM (never shorter than the spot's own)
// caps (round 3): the whitecaps' share of the sea × (1 + caps · k): the law v2 keeps for fair days is linear in the wind (1.8 % of the
// 12 m tile at the storm's sea wind); Beaufort 6–7 has white crests everywhere (the NOAA plates), the Jacobian's own storm breakers (render/water.js) carry the rest; ×2 here
export const STORM_SEA = Object.freeze({ wind: 0.6, fetchM: 10000, caps: 0.5 });

// o: the sea's wind record ({ speedMs, fetchM, … }: main.js seaNow), changed in place; W: the storm's weather state
export function stormSea(o, W, S = STORM_SEA) {
  const k = W && W.on > 0.5 ? Math.min(1, Math.max(0, W.front?.[3] ?? 0)) : 0;
  o.capK = 1 + S.caps * k;
  if (k <= 0) return o;
  o.speedMs *= 1 + S.wind * k;
  o.fetchM = Math.max(o.fetchM, o.fetchM + (S.fetchM - o.fetchM) * k);
  return o;
}
