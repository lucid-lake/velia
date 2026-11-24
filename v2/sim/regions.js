// The region table (refactor round 3 C5, "the world grows birthplace by birthplace"): one row per region of
// the lake, in the lake profile (src/waters/<id>.json `regions`, read through CURRENT_WATERS). Everything the game keys by region
// reads its row here: the busy lake's traffic, the kayakers' lanes and launch spots, the birthplaces, Regatta's cup and its place
// races, the chart's region name. Adding a region is adding a row (v2/README.md § The region table). Pure: no DOM, no GPU.
//
// A row (world metres: x east, z south, Fannette's summit at 0, 0):
//   id, name           'emerald-bay', 'Emerald Bay'
//   centre, radiusM    the traffic's circle: the region the player is in is the nearest centre within its radius (busyLake.js)
//   area               the cup's area: boxes [x0, x1, z0, z1] (null: open on that side; strict bounds); null: the rest of the lake
//                      (the hub opens on the cup of the area the boat is in: cupAt)
//   neighbours         region ids live with it;  keepOut: discs [x, z, r] no cruising boat heads into (optional)
//   label              the chart's name for it (v2/ui/chart/chartModel.js NAMES' shape)
//   birthplaces        [{ id, name, x, z, look, why, unlock? }] (v2/sim/birthplace.js); a region with none spends nothing
//   kayaks             [{ id, lane, colour, pfd, mate? }] its resident kayakers' lanes (busyLake.js residentKayaks)
//   launchSpots        [{ id, name, at }] its put-ins (kayakLaunch.js)
//   boats              [{ id, prio, tint, sail, route }] its cruising sailboats (busyLake.js); the region's traffic count is its length
//   cup                { id, name, line, races: [place race ids], hunt, huntName } or null (v2/sim/racePlaces.js)
//
//   regionsOf(waters)      → the rows, frozen (a profile without `regions`: [])
//   birthplaceRows(waters) → the birthplaces, each with its region, in table order (a profile with the old top-level list: that list)
//   busyRegionsOf(waters)  → [{ id, centre, radiusM, neighbours, keepOut?, kayaks, boats }] (busyLake.js REGIONS)
//   launchSpotsOf(waters)  → { [regionId]: [{ id, name, at }] } (kayakLaunch.js LAUNCH_SPOTS)
//   cupsOf(waters)         → [{ id, name, line, races, hunt }] in table order (places.js CUPS);  huntNamesOf(waters) → { [hunt]: name }
//   cupAtOf(waters)        → (x, z) → cup id (places.js cupAt)
//   regionLabelsOf(waters) → the chart's region names (chartModel.js NAMES)

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const cache = new WeakMap();

export function regionsOf(waters) {
  if (!waters || typeof waters !== 'object') return Object.freeze([]);
  if (cache.has(waters)) return cache.get(waters);
  const rows = deepFreeze(structuredClone(Array.isArray(waters.regions) ? waters.regions : []));
  cache.set(waters, rows);
  return rows;
}

export function birthplaceRows(waters) {
  if (!Array.isArray(waters?.regions)) return Array.isArray(waters?.birthplaces) ? waters.birthplaces : [];
  return regionsOf(waters).flatMap((r) => (r.birthplaces ?? []).map((b) => ({ ...b, region: b.region ?? r.id })));
}

export const busyRegionsOf = (waters) => Object.freeze(regionsOf(waters).map((r) => Object.freeze({
  id: r.id, centre: r.centre, radiusM: r.radiusM, neighbours: r.neighbours ?? Object.freeze([]), ...(r.keepOut ? { keepOut: r.keepOut } : {}),
  kayaks: r.kayaks ?? Object.freeze([]), boats: r.boats ?? Object.freeze([]),
})));

export const launchSpotsOf = (waters) => Object.freeze(Object.fromEntries(regionsOf(waters).filter((r) => r.launchSpots?.length).map((r) => [r.id, r.launchSpots])));

export const cupsOf = (waters) => Object.freeze(regionsOf(waters).filter((r) => r.cup).map((r) => { const { huntName, ...c } = r.cup; return Object.freeze(c); }));
export const huntNamesOf = (waters) => Object.freeze(Object.fromEntries(regionsOf(waters).filter((r) => r.cup?.hunt).map((r) => [r.cup.hunt, r.cup.huntName ?? r.cup.hunt])));

const inBox = (b, x, z) => (b[0] == null || x > b[0]) && (b[1] == null || x < b[1]) && (b[2] == null || z > b[2]) && (b[3] == null || z < b[3]);
export function cupAtOf(waters) {
  const rows = regionsOf(waters).filter((r) => r.cup);
  const rest = (rows.find((r) => !r.area) ?? rows[0])?.cup.id ?? null, boxed = rows.filter((r) => r.area);
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return rest;
    for (const r of boxed) if (r.area.some((b) => inBox(b, x, z))) return r.cup.id;
    return rest;
  };
}

export const regionLabelsOf = (waters) => Object.freeze(regionsOf(waters).filter((r) => r.label).map((r) => r.label));
