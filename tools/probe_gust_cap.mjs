// Gust cap check (owner, 2026-10-30: peak gust <= 1.5 x the local 10-min mean). Per level, seeds 1-5, 18:45 and 15:00:
// over the open bay's lattice points, 600 s at 5 s: pooled mean, p95, peak, peak/mean; the worst per-point peak/mean;
// the lull share (< 0.8 x the point's mean) and the gust upcrossings (of 1.2 x the point's mean) per point per 600 s.
// The local mean is the point's mean over the first 30 min (a 10-min window's own mean swings 0.75-1.1 x with the
// big patches, so a peak against it alone is weather, not the cap); the peak is the point's highest over those 30 min.
// Run: node tools/probe_gust_cap.mjs [--json]
import { WindField, WIND_LEVELS } from '../src/sim/wind.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
const BAY = CURRENT_WATERS.windBay;   // the open bay's box (the lake profile's)
import { makeTerrain } from '../src/sim/terrain.js';
const KN = 0.514444;
export function gustStats({ seeds = [1, 2, 3, 4, 5], hours = [18.75, 15], levels = [1, 2, 3, 4], dt = 5 } = {}) {
  const out = [];
  for (const hour of hours) for (const L of levels) {
    const all = []; let worst = 0, lull = 0, cross = 0, n = 0, np = 0;
    for (const seed of seeds) {
      const T = makeTerrain({ seed });
      const w = new WindField({ seed, day: { hour, rate: 1 }, level: L }); w.setTerrain(T.heightAt);
      for (let z = BAY.z0; z <= BAY.z1; z += BAY.dz) for (let x = BAY.x0; x <= BAY.x1; x += BAY.dx) {
        if (T.heightAt(x, z) >= BAY.deep) continue;
        const h = []; for (let t = 0; t < 1800; t += 10) h.push(w.sample(x, z, t).speed);
        const hm = h.reduce((a, b) => a + b, 0) / h.length;
        worst = Math.max(worst, Math.max(...h) / hm);
        const v = []; for (let t = 0; t < 600; t += dt) v.push(w.sample(x, z, t).speed);
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        for (let i = 0; i < v.length; i++) { all.push(v[i]); if (v[i] < 0.8 * m) lull++; if (i && v[i] >= 1.2 * m && v[i - 1] < 1.2 * m) cross++; n++; }
        np++;
      }
    }
    all.sort((a, b) => a - b);
    const mean = all.reduce((a, b) => a + b, 0) / all.length, peak = all[all.length - 1];
    out.push({ hour, L, band: WIND_LEVELS[L - 1].kn, meanKn: mean / KN, p95Kn: all[Math.floor(0.95 * all.length)] / KN, peakKn: peak / KN, pooled: peak / mean, worstPoint: worst, lullShare: lull / n, gustsPer600: cross / np });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = gustStats();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else for (const q of r) console.log(`${q.hour === 18.75 ? '18:45' : '15:00'} L${q.L} band ${q.band.join('-')} | mean ${q.meanKn.toFixed(1)} p95 ${q.p95Kn.toFixed(1)} peak ${q.peakKn.toFixed(1)} kn | peak/mean ${q.pooled.toFixed(2)} worst point (30-min peak / mean) ${q.worstPoint.toFixed(2)} | lull ${(q.lullShare * 100).toFixed(1)} % | gusts ${q.gustsPer600.toFixed(2)}/600 s`);
}
