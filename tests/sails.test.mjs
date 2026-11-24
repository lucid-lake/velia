// M5 mainsail, M6 jib, M7 lines, the fast part (no browser): the geometry, the meshes and their budgets.
// The browser captures live in tests/pages/sails.page.mjs (retired 2026-11-18) (npm run test:pages).
// Dimensions come from src/boat/dims.js (they will change to the real boat): the checks are ratios, contacts and
// ceilings, not exact counts.
import { test } from 'node:test';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
const { RIG } = DEFAULT_DIMS;   // this page's boat (its profile)
import { mainPoint, jibPoint, area, sailParams, stubState, boomPoint, jibTack, jibHeadPt, LUFF_Z, STAY_A, STAY_B } from '../src/boat/rig.js';
import { lineSet, makeLines } from '../classic/src/boat/lines.js';
import { makeMainsail, makeJib } from '../classic/src/boat/sails.js';
import { BUDGET } from './helpers/sail-budgets.mjs';

let fails = 0;
const failed = [];
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) { fails++; failed.push(what); } };
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const DEG = Math.PI / 180;

const st = stubState({ awaDeg: 40, awsMs: 7 });          // close-hauled, wind from starboard: sails to port
const p = sailParams(st);
check(st.boomAngle < 0 && st.jibAngle < 0 && st.heel < 0, `wind from starboard: boom ${(st.boomAngle / DEG).toFixed(0)}°, jib ${(st.jibAngle / DEG).toFixed(0)}°, heel ${(st.heel / DEG).toFixed(1)}° (all to port, − in contract.js)`);
const run = stubState({ awaDeg: 150, awsMs: 7, main: 0.95 });
check(Math.abs(run.heel) < Math.abs(stubState({ awaDeg: 90, awsMs: 7 }).heel), `the heel falls off downwind (${(run.heel / DEG).toFixed(1)}° on a run)`);

// Contacts with the spars (f4's points).
let luffOff = 0;
for (let v = 0; v <= 1; v += 0.1) { const q = mainPoint(0, v, p.main); luffOff = Math.max(luffOff, Math.abs(q[0]), Math.abs(q[2] - LUFF_Z)); }
check(luffOff < 0.005, `main luff on the mast track (z ${LUFF_Z}): max off ${(luffOff * 1000).toFixed(1)} mm`);
const clewM = mainPoint(1, 0, p.main), boomEndP = boomPoint(p.main.boomRad, RIG.boom);
check(d3(clewM, boomEndP) < 0.06, `main clew at the boom end: ${(d3(clewM, boomEndP) * 100).toFixed(1)} cm apart`);
const onStay = (q) => { const ab = STAY_B.map((x, i) => x - STAY_A[i]), t = ((q[1] - STAY_A[1]) * ab[1] + (q[2] - STAY_A[2]) * ab[2]) / (ab[1] ** 2 + ab[2] ** 2); return d3(q, STAY_A.map((x, i) => x + ab[i] * t)); };
let stayOff = 0;
for (let v = 0; v <= 1; v += 0.1) stayOff = Math.max(stayOff, onStay(jibPoint(0, v, p.jib)));
check(stayOff < 0.005 && d3(jibPoint(0, 0, p.jib), jibTack) < 1e-6 && d3(jibPoint(0, 1, p.jib), jibHeadPt) < 1e-6, `jib luff on the forestay, tack to head: max off ${(stayOff * 1000).toFixed(1)} mm`);

// Shape: camber to leeward, twist opening with height, backed jib inside out.
const mid = mainPoint(0.42, 0.5, p.main), chordLine = mainPoint(0, 0.5, p.main).map((x, i) => x + (mainPoint(1, 0.5, p.main)[i] - x) * 0.42);
const lee = Math.sign(p.main.boomRad);
const belly = (mid[0] - chordLine[0]) * Math.cos(p.main.boomRad) - (mid[2] - chordLine[2]) * Math.sin(p.main.boomRad);
check(Math.sign(belly) === lee && Math.abs(belly) > 0.1, `main bellies to leeward: ${(belly * 100).toFixed(0)} cm at 42 % chord, mid height`);
const ang = (v) => Math.atan2(mainPoint(1, v, p.main)[0] - mainPoint(0, v, p.main)[0], mainPoint(1, v, p.main)[2] - mainPoint(0, v, p.main)[2]);
check(Math.abs(ang(0.9)) > Math.abs(ang(0.1)) + 8 * DEG, `the leech twists open: chord ${(ang(0.1) / DEG).toFixed(0)}° low → ${(ang(0.9) / DEG).toFixed(0)}° high`);
const jibBelly = (s) => { const a = jibPoint(0.42, 0.4, s), b = jibPoint(0, 0.4, s), c = jibPoint(1, 0.4, s); return a[0] - (b[0] + (c[0] - b[0]) * 0.42); };
const pb = sailParams(stubState({ awaDeg: 25, backed: true }));
check(Math.sign(jibBelly(p.jib)) === Math.sign(p.jib.sheetRad) && Math.sign(jibBelly(pb.jib)) === -Math.sign(pb.jib.sheetRad), `backed jib bellies to the clew's other side (${(jibBelly(pb.jib) * 100).toFixed(0)} cm vs ${(jibBelly(p.jib) * 100).toFixed(0)} cm drawing)`);

// Luffing: the flutter moves the cloth when luffing, not when full; deterministic in t.
const lp = sailParams(stubState({ awaDeg: 40, main: 0.55 }));
const moved = (s) => Math.max(...[0.07, 0.13, 0.19, 0.27].map((t) => d3(mainPoint(0.8, 0.5, s, 0.0), mainPoint(0.8, 0.5, s, t))));
check(lp.main.fill < 0.5 && moved(lp.main) > 0.02 && moved(p.main) < 1e-9, `luffing main flutters (up to ${(moved(lp.main) * 100).toFixed(1)} cm within 0.27 s), a full one is still`);
check(d3(mainPoint(0.8, 0.5, lp.main, 1.7), mainPoint(0.8, 0.5, lp.main, 1.7)) === 0, 'flutter deterministic in t');

// Reef and furl.
const a0 = area(mainPoint, p.main), a1 = area(mainPoint, { ...p.main, reef: 1 }), a2 = area(mainPoint, { ...p.main, reef: 2 });
check(a1 / a0 > 0.72 && a1 / a0 < 0.86 && a2 / a0 > 0.55 && a2 / a0 < 0.7, `main area ${a0.toFixed(1)} m²; reef 1 ${(a1 / a0 * 100).toFixed(0)} %, reef 2 ${(a2 / a0 * 100).toFixed(0)} %`);
const j0 = area(jibPoint, p.jib), j2 = area(jibPoint, sailParams({ ...st, reef: 2 }).jib);
check(j2 / j0 > 0.38 && j2 / j0 < 0.5, `jib area ${j0.toFixed(1)} m²; furled with reef 2 to ${(j2 / j0 * 100).toFixed(0)} %`);

// Lines: the working sheet tight, the lazy one slack; nothing under its deck; endpoints on the sails.
const L = Object.fromEntries(lineSet(st).map((l) => [l.name, l]));
const sagOf = (pts) => { const a = pts[0], b = pts[pts.length - 1]; let m = 0; for (const q of pts) m = Math.max(m, (a[1] + b[1]) / 2 - q[1]); return m; };
const len = (pts) => pts.slice(1).reduce((s, q, i) => s + d3(q, pts[i]), 0);
const slack = (l) => len(l.points) / l.points.slice(1).reduce((s, q, i, arr) => s, d3(l.points[0], l.points[l.points.length - 1])) - 1;
check(len(L['jibsheet-lazy'].points) > len(L['jibsheet-working'].points), `lazy jib sheet longer and slacker than the working one (${len(L['jibsheet-lazy'].points).toFixed(2)} vs ${len(L['jibsheet-working'].points).toFixed(2)} m)`);
check(d3(L['jibsheet-working'].points[0], jibPoint(1, 0, p.jib)) < 1e-6 && d3(L['jibsheet-lazy'].points[0], jibPoint(1, 0, p.jib)) < 1e-6, 'both jib sheets start at the clew');
const floor = Math.min(...lineSet(st).flatMap((l) => l.points.map((q) => q[1])));
check(floor > -0.5, `no line below the side deck (lowest point y ${floor.toFixed(2)} m in the RIG frame)`);
void sagOf; void slack;

// Budgets (main 8 k, jib 6 k triangles; lines as ribbons), from the real meshes.
// Ceilings, not exact counts: detail work may add or drop triangles and lines under them.
const main = makeMainsail({}), jib = makeJib({});
check(main.triangles() <= BUDGET.mainTris && jib.triangles() <= BUDGET.jibTris && main.triangles() > 0.25 * BUDGET.mainTris && jib.triangles() > 0.25 * BUDGET.jibTris,
  `triangles: main ${main.triangles()} (≤ ${BUDGET.mainTris}), jib ${jib.triangles()} (≤ ${BUDGET.jibTris})`);
// The lines' ribbon buffer has a fixed capacity; a line past it is silently dropped (makeLines stops filling). Every
// line of every state must fit, with room for more detail; and the ribbons stay under the lines' ceiling.
const lm = makeLines();
const cap = lm.children[0].geometry.index.count / 6;   // the ribbon's point capacity
let worst = { pts: 0 };
for (const q of [{ awaDeg: 40, awsMs: 7 }, { awaDeg: 150, awsMs: 7, main: 0.95 }, { awaDeg: 90, awsMs: 12, reef: 2 }, { awaDeg: 25, backed: true }, { awaDeg: 40, main: 0.55, jib: 0.5 }]) {
  const s = stubState(q), set = lineSet(s), pts = set.reduce((n, l) => n + l.points.length, 0);
  lm.update(s, 0, { t: 1.3 });
  const drawn = lm.triangles(), want = 2 * (pts - set.length);
  check(drawn === want, `lines ${JSON.stringify(q)}: all ${set.length} drawn (${drawn} of ${want} ribbon triangles)`);
  if (pts > worst.pts) worst = { pts, lines: set.length, tris: drawn };
}
check(worst.pts <= 0.8 * cap && worst.tris <= BUDGET.lineTris && worst.lines >= BUDGET.minLines,
  `lines: ${worst.lines} lines, ${worst.pts} points of the ribbon's ${cap} (≤ 80 %), ${worst.tris} triangles (≤ ${BUDGET.lineTris})`);

test('M5–M7 geometry, meshes and budgets', () => { if (fails) throw new Error(`${fails} FAIL: ${failed.join('; ')}`); });
