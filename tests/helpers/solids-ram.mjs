// Our boat rammed at a solid prop (fix/barge-collision): the real BoatPhysics under its engine, full ahead, the helm held on
// an aim point on the prop, the props' contact in the physics' env.post (as the 'boat' service's env runs it in the game).
// No wind, sails furled. → the record: the smallest gap at any tick, the contacts, the speed before and after, the prop's moves.
import { BoatPhysics, CONTROLS, Helm, DT } from '../../src/sim/boat.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSolids } from '../../classic/src/fireworks/solids.js';
import { bargesWorld, VIEW } from '../../src/fireworks/stage.js';
import { sailboatSpots } from '../../classic/src/fireworks/spectators.js';

const DEG = Math.PI / 180;
// opts: solids (createSolids opts), target { x, z } (the aim), fromDeg (the bearing from the aim to the start), dist (m),
// speed (m/s at the start), secs
export function ram({ solids: so, target, fromDeg, dist = 60, speed = 3, secs = 40, offset = 0 }) {
  const solids = createSolids(so);
  const a = fromDeg * DEG, x = target.x + Math.sin(a) * dist, z = target.z - Math.cos(a) * dist;
  const heading = Math.atan2(target.x - x, -(target.z - z));
  // offset: the aim moved sideways (m) so the boat strikes a glancing blow
  const aim = { x: target.x + Math.cos(heading) * offset, z: target.z + Math.sin(heading) * offset };
  const phys = new BoatPhysics({ x, z, heading, speed });
  phys.engine.start();
  const helm = new Helm({ rudderMaxDeg: phys.P.rudder.maxDeg });
  const ctl = { ...CONTROLS, furl: 1, throttle: 1 };
  phys.furlPos = 1;
  const env = { windAt: () => ({ vx: 0, vz: 0 }), post: (s, dt, t) => solids.post(s, dt, t) };
  const home = solids.bodies.map((b) => [b.x, b.z]);
  const rec = { minGap: Infinity, contacts: 0, uBefore: 0, uAfter: null, maxMove: solids.bodies.map(() => 0), hitAt: null };
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const s = phys.state, before = solids.stats.contacts, sog = Math.hypot(s.u, s.v);
    ctl.rudder = helm.toHeading(s, Math.atan2(aim.x - s.x, -(aim.z - s.z)));
    phys.step(DT, ctl, { ...env, t: i * DT });
    if (solids.stats.contacts > before) { rec.contacts++; if (rec.hitAt == null) { rec.hitAt = i * DT; rec.uBefore = sog; } }
    rec.minGap = Math.min(rec.minGap, solids.gap(phys.state));
    solids.bodies.forEach((b, k) => { rec.maxMove[k] = Math.max(rec.maxMove[k], Math.hypot(b.x - home[k][0], b.z - home[k][1])); });
    // 0.5 s after the first touch: the boat's velocity toward the aim (m/s; negative: bounced back)
    if (rec.hitAt != null && rec.uAfter == null && i * DT > rec.hitAt + 0.5) { const st = phys.state, vx = st.u * Math.sin(st.heading) + st.v * Math.cos(st.heading), vz = -st.u * Math.cos(st.heading) + st.v * Math.sin(st.heading); rec.uAfter = vx * Math.sin(heading) - vz * Math.cos(heading); }
  }
  rec.state = { ...phys.state }; rec.solids = solids; rec.home = home;
  return rec;
}

// a point on a body's outline (body frame bx forward, by starboard) and its outward bearing (deg)
export const onBody = (b, bx, by, outDeg) => ({ x: b.x + Math.sin(b.heading) * bx + Math.cos(b.heading) * by, z: b.z - Math.cos(b.heading) * bx + Math.sin(b.heading) * by, out: b.heading / DEG + outDeg });

// our boat at 3 m/s at one barge (index i): its side, its bow, its corner, the tug's side and stern, each from 5 angles
export function rammingSweep(i) {
  test(`our boat driven at barge ${i} and its tug from several angles never ends inside: it bumps back head on, slides along a glancing blow`, () => {
    const SO = { barges: bargesWorld(), toward: VIEW, sailboats: sailboatSpots(VIEW) };
    const b = createSolids(SO).bodies.filter((q) => q.kind === 'barge')[i];
    for (const [bx, by, out] of [[0, 9, 90], [30, 0, 0], [-40, -4.1, -90], [-51, 0, 180], [30, -9, -45]]) {
      const p = onBody(b, bx, by, out);
      for (const rel of [-60, -25, 0, 25, 60]) {
        const r = ram({ solids: SO, target: p, fromDeg: p.out + rel, dist: 30, speed: 3, secs: 18 });
        const tag = `barge ${i} at (${bx}, ${by}) from ${rel}°`;
        assert.ok(r.hitAt != null, `${tag}: it touched`);
        assert.ok(r.minGap > -0.02, `${tag}: ${(-r.minGap * 100).toFixed(1)} cm inside`);
        assert.ok(r.solids.stats.maxPen < 0.1, `${tag}: one tick's overlap ${r.solids.stats.maxPen.toFixed(3)} m`);
        assert.ok(r.uBefore > 2.5, `${tag}: under way at ${r.uBefore.toFixed(2)} m/s`);
        if (rel === 0 && out % 180 === 0) assert.ok(r.uAfter < 0 && r.uAfter > -1.2, `${tag}: head on, a bump back at ${r.uAfter.toFixed(2)} m/s`);
        if (Math.abs(rel) === 60 && out % 90 === 0) assert.ok(r.uAfter > 0.4 * r.uBefore, `${tag}: a glancing blow slides along (${r.uAfter.toFixed(2)} m/s on)`);
        r.maxMove.forEach((m, k) => { if (!r.solids.bodies[k].light) assert.equal(m, 0, `${tag}: the ${r.solids.bodies[k].kind} never moves`); });
      }
    }
  });
}
