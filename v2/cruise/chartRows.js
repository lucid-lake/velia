// v2/cruise/chartWorld.json's rows as v1's buildChart reads them (tools/v2-cruise-bake.mjs writes the file; null widths take
// buildChart's own defaults, the harbour's slips empty as v1's page has them). Pure.
const nn = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
export function chartInputs(w) {
  return {
    shoreline: { ...w.shoreline, piers: w.shoreline.piers.map(nn) },
    harbour: { breakwaters: w.harbour.breakwaters.map(nn), docks: w.harbour.docks.map(nn), enclosure: w.harbour.enclosure, boats: [] },
  };
}
