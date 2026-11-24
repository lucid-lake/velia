// The grounding's view of the terrain (feat/grounding): the depth every module reads, and where the bed is rock. Plain JS.
//   const { depthAt, rockAt } = groundTerrain(terrain);     // terrain: makeTerrain() (src/terrain.js)
// depthAt(x, z): m of water over the bed, < 0 on land: −terrain.heightAt, the bathymetry the navigator's chart, the anchor
// and the chart plotter's DPT already read (one depth for the whole game). rockAt(x, z, slope): the island, a rocky
// shore (the cover 12 m up the slope is rock), or a bank past the angle of repose.
export function groundTerrain(terrain) {
  const depthAt = (x, z) => -terrain.heightAt(x, z);
  const cov = {};
  const rockAt = (x, z, slope = 0) => {
    if (terrain.islandR && terrain.islandR(x, z) < 1.7) return true;
    if (slope > 0.2 && terrain.coverAt) {
      const e = 2, gx = (depthAt(x + e, z) - depthAt(x - e, z)), gz = (depthAt(x, z + e) - depthAt(x, z - e)), m = Math.hypot(gx, gz) || 1;
      const c = terrain.coverAt(x - gx / m * 12, z - gz / m * 12, cov);
      if (c.rock > 0.25) return true;
    }
    return false;
  };
  return { depthAt, rockAt };
}
