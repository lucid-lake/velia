// The clear look (moved from living/busyLake.js, refactor round 3 C6, so sim/tessieFlee.js reads it without reaching living/).
// CLEAR: the water it wants (living/busyLake.js BUSY spreads these two rows)
export const CLEAR = Object.freeze({
  minDepthM: 2.6,        // m: water a boat may be in (the keel's 1.6 m and 1 m under it: planChart's LANE_DEPTH)
  clearDepthM: 4.5,      // m: the clear look sees water under this as shoal (a margin round the island's fringe and the shore's shelf)
});
// is a heading clear of shoal water for `seconds` (src/sim/race/rival.js makeClear's question): every 15 m ahead in clearDepthM of water
// or more; inside that margin already (a fringe she was pushed into), the water ahead must only not get shallower than here, so a
// heading out to deeper water is clear and she is never boxed in by her own margin
// keepOut: discs [x, z, r] (an island and its fringe, a region row's data): a heading whose look enters one is not clear, unless she is
// inside it already and the heading takes her out (moving away from its centre)
export function clearLook(depthAt, K = CLEAR, keepOut = []) {
  return (heading, seconds, s) => {
    const here = depthAt(s.x, s.z), need = here >= K.clearDepthM ? K.clearDepthM : Math.max(K.minDepthM, here - 0.3);
    const sp = Math.max(2, Math.hypot(s.u ?? 2, s.v ?? 0)), L = sp * seconds, sx = Math.sin(heading), sz = -Math.cos(heading);
    for (const [cx, cz, r] of keepOut) {
      const ox = s.x - cx, oz = s.z - cz, out = ox * sx + oz * sz;   // + : heading away from the centre
      if (ox * ox + oz * oz < r * r) { if (out <= 0) return false; continue; }
      const t = Math.max(0, Math.min(L, -out)), qx = ox + sx * t, qz = oz + sz * t;
      if (qx * qx + qz * qz < r * r) return false;
    }
    for (let d = 15; d <= L; d += 15) if (!(depthAt(s.x + sx * d, s.z + sz * d) >= need)) return false;
    return true;
  };
}
