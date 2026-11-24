// A headless run at the shore on the real physics and the real terrain (tests/ground.test.mjs, tools/ground_probe.mjs):
// the boat held at a speed by a tow, sailed at a shore point from an angle, with or without the shallow-water assist.
import { heightAt, shoreDistance, coverAt, LAKE, islandR } from '../../src/sim/terrain.js';
import { BoatPhysics, CONTROLS, Helm, DT, KN } from '../../src/sim/boat.js';
import { createGround, predict, bedMaterial } from '../../src/sim/boat/ground.js';
import { ShoalAssist } from '../../src/sim/boat/shoalAssist.js';
import { groundTerrain } from '../../src/sim/boat/groundTerrain.js';
import * as T from '../../src/sim/terrain.js';

export const DEG = Math.PI / 180;
const GT = groundTerrain(T);
export const depthAt = GT.depthAt, rockAt = GT.rockAt;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// shore points by kind, found once by a scan of the bay: { x, z, n: [nx, nz] (toward deeper water), kind }
let cache = null;
export function shorePoints() {
  if (cache) return cache;
  const out = { beach: [], rock: [], island: [] };
  const e = 2;
  for (let z = -1900; z <= 1100; z += 12) for (let x = -1250; x <= 1650; x += 12) {
    const d = shoreDistance(x, z);
    if (!(d < -1 && d > -5)) continue;   // water, 1 to 5 m off the shore
    const gx = (depthAt(x + e, z) - depthAt(x - e, z)) / (2 * e), gz = (depthAt(x, z + e) - depthAt(x, z - e)) / (2 * e), m = Math.hypot(gx, gz);
    if (m < 0.03) continue;
    const n = [gx / m, gz / m];
    // inland 12 m (up the slope)
    const ix = x - n[0] * 12, iz = z - n[1] * 12;
    const cov = coverAt(ix, iz, {});
    const isl = islandR(x, z) < 1.8;
    const kind = isl ? 'island' : bedMaterial(depthAt, x, z, 2, rockAt) === 'rock' ? 'rock' : cov.beach > 0.3 || m < 0.3 ? 'beach' : null;
    if (!kind) continue;
    // the approach from 160 m out along the normal is at sea (3 m or more at the start)
    const sx = x + n[0] * 160, sz = z + n[1] * 160;
    if (!(depthAt(sx, sz) > 4)) continue;
    out[kind].push({ x, z, n, kind, slope: m });
  }
  cache = out;
  return out;
}
// n points picked evenly from a list
export const pick = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i + 0.5) * list.length / n)]));

// run one approach. opts: { target, angleDeg, kn, assist, towMode: 'hold' | 'touch' (released when the keel touches), seconds, windKn,
// engine: reverse engine after grounding (s) }
export function approach(o) {
  const { target: T, angleDeg = 0, kn = 3, assist = false, towMode = 'touch', seconds = null, windKn = 12, startM = 150, windRelDeg = 180, reverseAfterS = null, kedgeAfterS = null } = o;
  const base = Math.atan2(-T.n[0], T.n[1]);                // heading from deep water toward the shore, along -n (heading 0 = -z)
  const heading = base + angleDeg * DEG;
  const dirx = Math.sin(heading), dirz = -Math.cos(heading);
  const x0 = T.x - dirx * startM, z0 = T.z - dirz * startM;
  if (!(depthAt(x0, z0) > 8)) return null;   // the spawn is on land or in the shallows: not a run
  const phys = new BoatPhysics({ x: x0, z: z0, heading, speed: kn * KN });
  const gr = createGround({ depthAt, rockAt });
  const windFromRad = heading + windRelDeg * DEG, wv = windKn * KN;
  const windAt = () => ({ vx: -Math.sin(windFromRad) * wv, vz: Math.cos(windFromRad) * wv });
  const as = new ShoalAssist({ depthAt, predict: (d, st, o) => predict(d, st, { ...o, rockAt }) });
  const helm = new Helm(), ctl = { ...CONTROLS, rudder: 0 };
  let tow = true, hold = heading, firstTouchT = null, firstTouchPos = null, stopDist = null, stopT = null, engagedAt = null, trapped = false;
  const rec = { minHull: 99, minKeel: 99, maxKeelPen: 0, maxHullPen: 0, maxHeel: 0, assistEvents: [], events: [], track: [], underMin: 99, depthMin: 99, grounded: false, refloat: false, grounds: 0, thuds: 0 };
  const env = { t: 0, windAt,
    ext: (s, dt, t, b) => {
      const g = gr.ext(s, dt, t, b);
      if (tow) { const F = Math.max(-12000, Math.min(12000, 4000 * (kn * KN - s.u))); g.X += F; }
      return g;
    },
    post: (s, dt, t, b) => gr.post(s, dt, t, b) };
  const n = Math.round((seconds ?? (startM / (kn * KN) + 70)) / DT);
  let reversing = false, kedged = false;
  for (let i = 0; i < n; i++) {
    const t = i * DT; env.t = t;
    const s = phys.state;
    const out = assist ? as.update(s, DT, { enabled: true, steering: false, windFrom: windFromRad }) : null;
    if (out?.event) { rec.assistEvents.push({ t, ev: out.event, reason: out.reason, trapped: out.trapped, heading: out.heading / DEG }); if (out.event === 'engage') engagedAt ??= t; if (out.event === 'release') hold = s.heading; }
    const steerTo = out?.engaged ? out.heading : hold;
    if (reversing) { ctl.throttle = -1; if (!phys.engine.on) phys.engine.start?.(); }
    ctl.rudder = helm.toHeading(s, steerTo, DT);
    phys.step(DT, ctl, env);
    if (phys.engine?.on === false && reversing) phys.engine.start?.();
    const st = gr.state;
    rec.minHull = Math.min(rec.minHull, st.minHullClear); rec.minKeel = Math.min(rec.minKeel, st.minKeelClear);
    rec.maxKeelPen = Math.max(rec.maxKeelPen, st.keelPen); rec.maxHullPen = Math.max(rec.maxHullPen, st.hullPen);
    rec.maxHeel = Math.max(rec.maxHeel, Math.abs(s.heel)); rec.underMin = Math.min(rec.underMin, st.under); rec.depthMin = Math.min(rec.depthMin, st.depth);
    if (i % 30 === 0) rec.track.push([s.x, s.z, Math.hypot(s.u, s.v), st.under]);
    for (const ev of gr.take()) { rec.events.push({ ...ev, t }); if (ev.type === 'aground') { rec.grounded = true; rec.grounds++; } if (ev.type === 'refloat') rec.refloat = true; if (ev.type === 'thud') rec.thuds++; }
    if (firstTouchT == null && st.mode !== 'afloat') { firstTouchT = t; firstTouchPos = [s.x, s.z]; if (towMode === 'touch') tow = false; }
    if (firstTouchT != null && stopT == null && Math.hypot(s.u, s.v) < 0.3) { stopT = t; stopDist = Math.hypot(s.x - firstTouchPos[0], s.z - firstTouchPos[1]); }
    if (reverseAfterS != null && rec.grounded && !reversing) { const ev = rec.events.find((e) => e.type === 'aground'); if (t - ev.t >= reverseAfterS) { reversing = true; phys.engine.start?.(); } }
    if (kedgeAfterS != null && rec.grounded && !kedged) { const ev = rec.events.find((e) => e.type === 'aground'); if (t - ev.t >= kedgeAfterS) { kedged = true; rec.kedge = gr.kedge(s); } }
    if (reversing && rec.refloat) { /* keep going to see it clear */ }
  }
  Object.assign(rec, { firstTouchT, stopDist, stopT, engagedAt, final: { ...gr.state }, end: [phys.state.x, phys.state.z], x0, z0, heading, T, state: phys.state, ground: gr });
  return rec;
}
