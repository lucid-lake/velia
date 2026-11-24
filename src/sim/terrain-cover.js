// Cover classes (build_tahoe.py): 0 none, 1 lake, 2 urban, 3 open developed, 4 rock, 5 forest, 6 shrub, 7 grass,
// 8 wetland, 9 snow/ice, 10 another lake (a pond above ours). Its own module (v2 seam): src/sim/lake.js reads it without
// terrain-data.js's fetch and node paths; terrain-data.js re-exports it.
export const COVER = ['none', 'water', 'urban', 'open', 'rock', 'forest', 'shrub', 'grass', 'wetland', 'snow', 'pond'];
