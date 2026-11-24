// The whole lake's box (x east, z south, m; Fannette Island's summit the origin): Lake Tahoe's water sampled every 200 m on v1's
// terrain spans x −5400…15000, z −32600…2800; this is that and 400 m round it. The planner's chart (planChart.js LAKE, the bake)
// and the enlarged chart's lake zooms (sail.js → src/ui/chartplotter.js { lake }) both read it. Pure.
export const LAKE_BOX = Object.freeze({ x0: -5800, x1: 15400, z0: -33000, z1: 3200 });
// the enlarged chart's lake base: the square the widest zoom (19.2 km half-height) shows round the lake's middle, so its land
// reaches the chart's edges (the terrain covers it: the lake and ring grids)
export const LAKE_CHART = Object.freeze({ x0: -14400, x1: 24000, z0: -34100, z1: 4300 });
